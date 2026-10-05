-- T008 commit 1: enquiries, requirements, requirement_fields, the contact guard and the enquiry run target.
--   A the contact guard (app.text_has_contact)         B enquiries: who may insert, what the database fills in, immutability, the guard as a CHECK
--   C requirements: one active per enquiry, no client writes   D requirement_fields: the typed-value shape and the caps (quote-engine bounds)
--   E agent_runs: exactly one of company / lead / enquiry      F the closed vocabulary, the retention hook, tenant isolation
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.out(p_user text, p_sql text) returns text language sql as $$ select tests.outcome_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.enq_sql(p_id uuid, p_tenant text, p_lead text, p_body text, p_subject text default null, p_at text default 'now() - interval ''1 hour''') returns text language sql as $$
  select format('insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, subject, body) values (%L, %L, %L, ''whatsapp'', %s, %L, %L)',
                p_id, tests.tid(p_tenant), tests.rid(p_lead), p_at, p_subject, p_body) $$;

-- ============================================================================ A. the contact guard
create function pg_temp.g(p text) returns boolean language sql as $$ select app.text_has_contact(p) $$;
select is(pg_temp.g('mail me at buyer@example.com please'), true, 'an e-mail address is a contact');
select is(pg_temp.g('call +91 98765 43210 tomorrow'), true, '+91 with groups of five is a contact');
select is(pg_temp.g('call +91-9876543210'), true, '+91 and ten digits is a contact');
select is(pg_temp.g('ph 9876543210.'), true, 'ten digits starting 9 is a contact');
select is(pg_temp.g('ph 098765 43210'), true, 'a 0 prefix and ten digits is a contact');
select is(pg_temp.g('ph 919876543210'), true, '91 and ten digits is a contact');
select is(pg_temp.g('ph 6123456789'), true, 'ten digits starting 6 is a contact');
select is(pg_temp.g('ph 5123456789'), false, 'ten digits starting 5 is not a mobile number');
select is(pg_temp.g('1,00,00,000 sarees'), false, 'a comma-grouped number is not a contact');
select is(pg_temp.g('budget Rs 5,00,000'), false, 'Rs 5,00,000 is not a contact');
select is(pg_temp.g('budget Rs. 9000000000'), false, 'a Rs-prefixed amount is not a contact');
select is(pg_temp.g('budget INR 9876543210'), false, 'an INR-prefixed amount is not a contact');
select is(pg_temp.g('amount ₹9876543210'), false, 'a rupee-sign amount is not a contact');
select is(pg_temp.g('50000000'), false, 'an eight-digit number is not a contact');
select is(pg_temp.g('GSTIN 29ABCDE1234F1Z5 for the invoice'), false, 'a GSTIN is not a contact');
select is(pg_temp.g('deliver to PIN 560001'), false, 'a pincode is not a contact');
select is(pg_temp.g('PO 9876543210 refers'), false, 'a PO number is not a contact');
select is(pg_temp.g('order no. 9876543210'), false, 'an order number is not a contact');
select is(pg_temp.g('60000 70000 rupees'), false, 'two round amounts are not a contact');
select is(pg_temp.g('need 500 pieces by 2026-11-15, 12 sarees each of 3 colours'), false, 'quantities and dates are not contacts');
select is(pg_temp.g(null), false, 'null is not a contact');

-- ============================================================================ B. enquiries
select is(pg_temp.out('a_sales', pg_temp.enq_sql(tests.rid('e1'), 'a', 'a_lead', 'Need 20 kanjivaram sarees by 15 November', 'Saree enquiry')), 'rows:1', 'Sales captures an enquiry on a lead');
select is(pg_temp.out('a_admin', pg_temp.enq_sql(tests.rid('e2'), 'a', 'a_lead', 'Second enquiry')), 'rows:1', 'Admin captures one');
select is(pg_temp.out('a_owner', pg_temp.enq_sql(tests.rid('e3'), 'a', 'a_lead', 'Third enquiry')), 'rows:1', 'Owner captures one');
select is(pg_temp.out('a_viewer', pg_temp.enq_sql(tests.rid('e4'), 'a', 'a_lead', 'Viewer enquiry')), '42501', 'a Viewer cannot capture an enquiry');
select is(substr(pg_temp.err('b_sales', pg_temp.enq_sql(tests.rid('e5'), 'a', 'a_lead', 'Other tenant')), 1, 5), '42501', 'another tenant cannot insert into this tenant');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(tests.rid('e6'), 'a', 'b_lead', 'Aimed at the other tenant''s lead')), 1, 5), '23503', 'a lead of another tenant is refused (composite foreign key)');
select is((select company_id from public.enquiries where id = tests.rid('e1')), tests.rid('a_company'), 'the company is copied from the lead');
select is((select contact_id from public.enquiries where id = tests.rid('e1')), tests.rid('a_contact'), '...and the contact');
select is((select body_sha256 from public.enquiries where id = tests.rid('e1')), encode(sha256(convert_to('Need 20 kanjivaram sarees by 15 November', 'UTF8')), 'hex'), 'the body hash is set by the database');
select is((select created_via::text || '|' || (created_by = tests.uid('a_sales'))::text from public.enquiries where id = tests.rid('e1')), 'manual|true', 'created_by / created_via are server-owned');
-- the guard as a CHECK
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'write to buyer@example.com')), 1, 5), '23514', 'a body with an e-mail address is refused');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'call +91 98765 43210')), 1, 5), '23514', 'a body with a phone number is refused');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'fine body', 'Re: 9876543210')), 1, 5), '23514', 'a subject with a phone number is refused');
select is(pg_temp.out('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'Need 1,00,00,000 sarees, Rs 5,00,000, GSTIN 29ABCDE1234F1Z5, PIN 560001, 2026-11-15')), 'rows:1', 'amounts, a GSTIN, a pincode and a date are stored as written');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', repeat('a', 6001))), 1, 5), '23514', 'a body over 6,000 characters is refused');
select is(pg_temp.out('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', repeat('a', 6000))), 'rows:1', '...6,000 is fine');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', '   ')), 1, 5), '23514', 'a blank body is refused');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'hidden' || chr(8203) || 'text')), 1, 5), '23514', 'an invisible character in the body is refused');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'ok', repeat('s', 201))), 1, 5), '23514', 'a subject over 200 characters is refused');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'future', null, 'now() + interval ''1 day''')), 1, 5), '23514', 'a received time in the future is refused');
select is(substr(pg_temp.err('a_sales', pg_temp.enq_sql(gen_random_uuid(), 'a', 'a_lead', 'ancient', null, '''2019-12-31''')), 1, 5), '23514', 'a received time before 2020 is refused');
-- columns clients cannot write
select is(pg_temp.out('a_sales', format('insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, company_id) values (%L, %L, %L, ''email'', now(), ''x'', %L)', gen_random_uuid(), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_company'))), '42501', 'company_id is not client-writable');
select is(pg_temp.out('a_sales', format('insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, retain_until) values (%L, %L, %L, ''email'', now(), ''x'', now())', gen_random_uuid(), tests.tid('a'), tests.rid('a_lead'))), '42501', 'retain_until is not client-writable (the retention hook is for a later definer function)');
select is(pg_temp.out('a_sales', format('insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, body_sha256) values (%L, %L, %L, ''email'', now(), ''x'', repeat(''0'', 64))', gen_random_uuid(), tests.tid('a'), tests.rid('a_lead'))), '42501', 'body_sha256 is not client-writable');
-- immutable except archived_at
select is(pg_temp.out('a_owner', format('update public.enquiries set body = ''changed'' where id = %L', tests.rid('e1'))), '42501', 'the body cannot be edited by an Owner');
select is(pg_temp.out('a_sales', format('update public.enquiries set archived_at = now() where id = %L', tests.rid('e1'))), '42501', 'Sales cannot archive');
select is(pg_temp.out('a_admin', format('update public.enquiries set archived_at = now() where id = %L', tests.rid('e1'))), 'rows:1', 'Admin archives');
select is(pg_temp.out('a_admin', format('delete from public.enquiries where id = %L', tests.rid('e1'))), '42501', 'nobody deletes');
do $$ begin
  begin update public.enquiries set body = 'edited by the table owner' where id = tests.rid('e2'); raise exception 'no error'; exception when sqlstate '42501' then null; end;
end $$;
select pass('even the privileged session cannot edit a body (immutable record)');
-- reads
select is(pg_temp.out('a_viewer', 'select * from public.enquiries'), 'rows:5', 'a Viewer reads the enquiries of the workspace (every row inserted above, one archived)');
select is(tests.rows_as(tests.uid('b_owner'), 'select * from public.enquiries'), 0::bigint, 'another tenant sees none of them');
-- audit: the text is never recorded, only the column names
select is((select count(*) from public.audit_events where entity_type = 'enquiry' and (new_values::text like '%kanjivaram%' or old_values::text like '%kanjivaram%')), 0::bigint, 'the audit trail never holds the enquiry text');

-- ============================================================================ C. requirements
create function pg_temp.req_sql(p_id uuid, p_enquiry text, p_status text default 'draft') returns text language sql as $$
  select format('insert into public.requirements (id, tenant_id, enquiry_id, status) values (%L, %L, %L, %L)', p_id, tests.tid('a'), tests.rid(p_enquiry), p_status) $$;
select is(pg_temp.out('a_sales', pg_temp.req_sql(tests.rid('r1'), 'e2')), '42501', 'no client writes a requirement');
select lives_ok(pg_temp.req_sql(tests.rid('r1'), 'e2'), 'the privileged session (the definer functions) creates a draft');
select throws_ok(pg_temp.req_sql(tests.rid('r2'), 'e2'), '23505', null, 'a second ACTIVE requirement for the same enquiry is refused');
select lives_ok(format('update public.requirements set status = ''superseded'' where id = %L', tests.rid('r1')), 'a requirement can be superseded');
select lives_ok(pg_temp.req_sql(tests.rid('r2'), 'e2'), '...and then a new draft is allowed');
select throws_ok(format('update public.requirements set status = ''confirmed'' where id = %L', tests.rid('r2')), '23514', null, 'confirmed needs confirmed_by and confirmed_at');
select lives_ok(format('update public.requirements set status = ''confirmed'', confirmed_by = %L, confirmed_at = now() where id = %L', tests.uid('a_sales'), tests.rid('r2')), 'a confirmed requirement carries who and when');
select throws_ok(pg_temp.req_sql(tests.rid('r3'), 'e2'), '23505', null, 'a confirmed requirement also blocks a new active one (a human discards first)');
select throws_ok(format('insert into public.requirements (id, tenant_id, enquiry_id) values (%L, %L, %L)', gen_random_uuid(), tests.tid('a'), tests.rid('b_enquiry')), '23503', null, 'a requirement cannot point at another tenant''s enquiry');
select is(pg_temp.out('a_viewer', 'select * from public.requirements'), 'rows:' || (select count(*) from public.requirements where tenant_id = tests.tid('a'))::text, 'every member reads requirements');
select is(tests.rows_as(tests.uid('b_owner'), format('select * from public.requirements where id = %L', tests.rid('r2'))), 0::bigint, 'another tenant does not');

-- ============================================================================ D. requirement_fields: shape and caps
create function pg_temp.fld_sql(p_key text, p_line int, p_code text, p_int bigint, p_date text, p_text text, p_basis text, p_slot int default 0) returns text language sql as $$
  select format('insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_code, value_int, value_date, value_text, basis, certainty, quote, quote_start, quote_end)
                 values (%L, %L, %L, %L, %L, %L, %L, %L, %L, ''stated'', ''q'', %s, %s)',
                tests.tid('a'), tests.rid('r2'), p_line, p_key, p_code, p_int, p_date, p_text, p_basis, p_slot, p_slot + 1) $$;
create function pg_temp.accepts(p_sql text) returns boolean language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'rollback' using errcode = 'P0001';
  exception when sqlstate 'P0001' then return true;
            when others then return false;
  end;
end $$;
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', 1, null, 20, null, null, 'piece')), true, 'quantity 20 pieces is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', 1, null, 10000, null, null, 'piece')), true, 'quantity 10,000 (the engine''s MAX_QUANTITY_PER_LINE) is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', 1, null, 10001, null, null, 'piece')), false, 'quantity 10,001 is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', 1, null, 0, null, null, 'piece')), false, 'quantity 0 is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', 1, null, 5, null, null, 'kg')), false, 'quantity needs a piece / set basis');
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', null, null, 5, null, null, 'piece')), false, 'a quantity needs a line');
select is(pg_temp.accepts(pg_temp.fld_sql('quantity', 6, null, 5, null, null, 'piece')), false, 'line 6 is refused (at most five lines)');
select is(pg_temp.accepts(pg_temp.fld_sql('saree_type', 2, 'dharmavaram_pattu', null, null, null, null)), true, 'dharmavaram_pattu is in the saree_type vocabulary');
select is(pg_temp.accepts(pg_temp.fld_sql('saree_type', 2, 'plastic', null, null, null, null)), false, 'a code outside the vocabulary is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('saree_type', null, 'banarasi', null, null, null, null)), false, 'a line field needs a line');
select is(pg_temp.accepts(pg_temp.fld_sql('colour', 1, 'red', 5, null, null, null)), false, 'a stray integer on a vocabulary field is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('fabric', 1, 'tussar', null, null, null, null)), true, 'fabric tussar is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('budget', null, null, 100000000, null, null, 'per_piece')), true, 'a per-piece budget of INR 1,000,000 is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('budget', null, null, 100000001, null, null, 'per_piece')), false, 'a per-piece budget above INR 1,000,000 is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('budget', null, null, 1000000000, null, null, 'total')), true, 'a total budget of INR 10,000,000 is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('budget', null, null, 1000000001, null, null, 'total')), false, 'a total budget above INR 10,000,000 is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('budget', null, null, 500000, null, null, null)), false, 'a budget needs a basis');
select is(pg_temp.accepts(pg_temp.fld_sql('budget', null, null, 0, null, null, 'total')), false, 'a zero budget is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('deadline', null, null, null, '2026-11-15', null, null)), true, 'a deadline date is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('deadline', null, null, null, '2101-01-01', null, null)), false, 'a deadline in the next century is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('deadline', null, null, null, null, null, null)), false, 'a deadline needs a date');
select is(pg_temp.accepts(pg_temp.fld_sql('delivery_city', null, null, null, null, 'Hyderabad', null)), true, 'a delivery city is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('delivery_city', null, null, null, null, repeat('c', 61), null)), false, 'a city over 60 characters is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('delivery_city', null, null, null, null, '  ', null)), false, 'a blank city is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'net_days', 30, null, null, 'days')), true, 'net 30 days is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'net_days', 180, null, null, 'days')), true, 'net 180 days (the engine''s MAX_PAYMENT_NET_DAYS) is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'net_days', 181, null, null, 'days')), false, 'net 181 days is refused');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'advance_partial', 5000, null, null, 'bps')), true, '50% advance is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'advance_partial', 10000, null, null, 'bps')), false, 'a "partial" advance of 100% is refused (that is advance_full)');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'advance_full', null, null, null, null)), true, 'advance_full is accepted');
select is(pg_temp.accepts(pg_temp.fld_sql('payment_terms', null, 'cash_on_delivery', 3, null, null, null)), false, 'cash on delivery carries no number');
-- slots, spans, state
select lives_ok(pg_temp.fld_sql('quantity', 1, null, 20, null, null, 'piece'), 'a field is written (privileged)');
select throws_ok(pg_temp.fld_sql('quantity', 1, null, 30, null, null, 'piece'), '23505', null, 'one field per (requirement, line, key)');
select lives_ok(pg_temp.fld_sql('quantity', 2, null, 30, null, null, 'piece'), '...a second line is a different slot');
select lives_ok(pg_temp.fld_sql('deadline', null, null, null, '2026-11-15', null, null), 'an order-level field has no line');
select throws_ok(pg_temp.fld_sql('deadline', null, null, null, '2026-12-15', null, null), '23505', null, '...and only one deadline per requirement');
select throws_ok(format('insert into public.requirement_fields (tenant_id, requirement_id, field_key, value_text, certainty, quote, quote_start, quote_end) values (%L, %L, ''delivery_city'', ''Pune'', ''stated'', ''Pune'', 9, 5)', tests.tid('a'), tests.rid('r2')), '23514', null, 'a span must end after it starts');
select throws_ok(format('insert into public.requirement_fields (tenant_id, requirement_id, field_key, value_text, certainty, quote, quote_start, quote_end) values (%L, %L, ''delivery_city'', ''Pune'', ''stated'', %L, 0, 4)', tests.tid('a'), tests.rid('r2'), repeat('q', 301)), '23514', null, 'a quote over 300 characters is refused');
select throws_ok(format('insert into public.requirement_fields (tenant_id, requirement_id, field_key, value_text, certainty, quote, quote_start, quote_end, state) values (%L, %L, ''delivery_city'', ''Pune'', ''stated'', ''Pune'', 0, 4, ''confirmed'')', tests.tid('a'), tests.rid('r2')), '23514', null, 'a decided field needs decided_by and decided_at');
select throws_ok(format('insert into public.requirement_fields (tenant_id, requirement_id, field_key, value_text, certainty, quote, quote_start, quote_end) values (%L, %L, ''delivery_city'', ''Pune'', ''stated'', ''Pu%sne'', 0, 4)', tests.tid('a'), tests.rid('r2'), chr(8203)), '23514', null, 'an invisible character in a quote is refused');
select is(pg_temp.out('a_sales', pg_temp.fld_sql('quantity', 3, null, 5, null, null, 'piece')), '42501', 'no client writes a field');
select is(tests.rows_as(tests.uid('b_owner'), 'select * from public.requirement_fields'), 0::bigint, 'another tenant reads no fields');
select throws_ok(format('insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_code, certainty, quote, quote_start, quote_end) values (%L, %L, 1, ''colour'', ''red'', ''stated'', ''red'', 0, 3)', tests.tid('a'), tests.rid('b_requirement')), '23503', null, 'a field cannot point at another tenant''s requirement');

-- ============================================================================ E. agent_runs: exactly one target
create function pg_temp.run_sql(p_company text, p_lead text, p_enquiry text) returns text language sql as $$
  select format('insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, enquiry_id, expires_at, input_sha256)
                 values (%L, %L, %L, ''selftest'', ''v1'', %L, %L, %L, now() + interval ''15 minutes'', repeat(''1'', 64))',
                gen_random_uuid(), tests.tid('a'), tests.uid('a_sales'),
                case when p_company is not null then tests.rid(p_company) end, case when p_lead is not null then tests.rid(p_lead) end,
                case when p_enquiry is not null then tests.rid(p_enquiry) end) $$;
select lives_ok(pg_temp.run_sql(null, null, 'e2'), 'a run may target an enquiry');
select lives_ok(pg_temp.run_sql('a_company', null, null), '...a company');
select lives_ok(pg_temp.run_sql(null, 'a_lead', null), '...or a lead');
select throws_ok(pg_temp.run_sql('a_company', null, 'e2'), '23514', null, 'a company AND an enquiry is refused');
select throws_ok(pg_temp.run_sql(null, 'a_lead', 'e2'), '23514', null, 'a lead AND an enquiry is refused');
select throws_ok(pg_temp.run_sql(null, null, null), '23514', null, 'no target at all is refused');
select throws_ok(pg_temp.run_sql(null, null, 'b_enquiry'), '23503', null, 'another tenant''s enquiry is refused (composite foreign key)');

-- ============================================================================ F. vocabulary, retention hook, sanity
select is(app.requirement_vocab('saree_type'), array['kanjivaram', 'banarasi', 'mysore_silk', 'paithani', 'dharmavaram_pattu', 'patola', 'chanderi', 'other'], 'the saree_type vocabulary (a placeholder for the family to replace)');
select is(app.requirement_vocab('payment_terms'), array['advance_full', 'advance_partial', 'net_days', 'cash_on_delivery'], 'the payment_terms vocabulary');
select is(app.requirement_vocab('quantity'), null, 'a key without a vocabulary has none');
select has_index('public', 'enquiries', 'enquiries_retain_idx', 'the retention column is indexed (a later rule needs no table change)');
select is((select count(*) from pg_class where relname in ('requirement_questions') and relnamespace = 'public'::regnamespace), 0::bigint, 'there is no requirement_questions table: questions are derived at read time (owner change E)');

select * from finish();
rollback;
