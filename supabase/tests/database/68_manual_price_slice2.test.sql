-- Manual-price quote, slice 2 (migration 20261030090000): the manual kind in the database, GST required.
--   A GST is a required choice    B the table checks of the two kinds    C creating a manual quote (figures, rounding, flags, state, requirement)
--   D who may, and never inside an agent context    E refusals (typed lines, recomputation)    F approval, staleness, withdrawal, rejection
--   G visibility and cross-tenant    H list-price quotes are unchanged
-- SYNTHETIC numbers only. The expected figures below are worked out by hand, not read back from the code under test.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_seed_quote_reference_data('tenant-a');

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.code(p_user text, p_sql text) returns text language sql as $$ select split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1) $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || sqlerrm; end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;

-- ---------------------------------------------------------------------------- fixtures: item types, a policy, enquiries
create function pg_temp.save_type(p_tenant text, p_code text, p_name text, p_active boolean, p_min text, p_max text) returns text language sql as $$
  select pg_temp.sc(case p_tenant when 'a' then 'a_owner' else 'b_owner' end,
                    format('select public.save_item_type(%L, %L, %L, 1, %s, %s, %s)', tests.tid(p_tenant), p_code, p_name, p_active::text, p_min, p_max)) $$;
select pg_temp.save_type('a', '01', 'Item type one', true, 'null', 'null');
select pg_temp.save_type('a', '02', 'Item type two', true, '100000', '500000');
select pg_temp.save_type('a', '03', 'Item type three (not sold)', false, 'null', 'null');
select pg_temp.save_type('a', '04', 'Item type four', true, 'null', 'null');
select pg_temp.save_type('b', '01', 'Tenant B item type', true, 'null', 'null');

create function pg_temp.policy(p_over jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('discount_ceiling_bps', 0, 'shipping_flat_fee_paise', 5000, 'shipping_tax_bps', 1800, 'validity_days', 15, 'new_advance_bps', 5000,
                            'repeat_advance_bps', 2500, 'new_net_days', 10, 'repeat_net_days', 45, 'gst_rate_bps', 500, 'rounding_mode', 'half_even',
                            'seller_state', 'TS', 'repeat_credit_limit_paise', 1000000000) || p_over $$;
create function pg_temp.qp_sql(p_id uuid, p_tenant text, p_policy jsonb) returns text language sql as $$
  select format('select public.create_quote_policy_version(%L, %L, %L, %L::jsonb)', p_id, tests.tid(p_tenant), pg_temp.today(), p_policy::text) $$;

-- ============================================================================ A. GST is a required choice
select is(pg_temp.code('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy() - 'gst_rate_bps')), '22023', 'A1 a policy without gst_rate_bps is refused: invalid argument');
select is(pg_temp.code('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy('{"gst_rate_bps": null}'))), '22023', 'A2 ...and so is an explicit null');
select is(pg_temp.code('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy('{"gst_rate_bps": 2801}'))), '23514', 'A3 above 28 %: still not allowed');
select is((select column_default is null and is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'quote_policy_versions' and column_name = 'gst_rate_bps'), true,
          'A4 the column has no default and is required');
select is(pg_temp.priv(format('insert into public.quote_policy_versions (tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_effective_from, seller_state, content_sha256) values (%L, 99, current_date, 0, 0, 0, 15, 0, 0, 30, 30, current_date, ''TS'', repeat(''1'', 64))', tests.tid('a'))) like '23502|%', true,
          'A5 a row inserted without the rate is refused by the table too (not null)');
select is((select gst_rate_bps from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 1), 500, 'A6 the seeded version carries the rate the seed now sends explicitly (SYNTHETIC 5 %)');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy())), 'version_no'), '2', 'A7 an Owner publishes version 2: 5 %, half-even rounding, a freight fee and a freight tax of 18 % (all list-price settings)');
select is((select gst_effective_from = effective_from from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 2), true, 'A8 the GST date still defaults to the version''s own start date');
select is(pg_temp.code('a_sales', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy())), '42501', 'A9 Sales still cannot publish a policy');

-- enquiries (no requirement yet) and helpers
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid(n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || n
  from unnest(array['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'l1', 'l2']) n;
create function pg_temp.ln(p_code text, p_qty int, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('item_type_code', p_code, 'qty', p_qty, 'unit_price_paise', p_price) $$;
create function pg_temp.resolved(p_lines jsonb) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('item_type_code', l.j ->> 'item_type_code', 'name', t.name, 'qty', (l.j ->> 'qty')::int, 'unit_price_paise', (l.j ->> 'unit_price_paise')::bigint) order by l.n)
    from jsonb_array_elements(p_lines) with ordinality as l(j, n) join public.item_types t on t.tenant_id = tests.tid('a') and t.code = l.j ->> 'item_type_code' $$;
create function pg_temp.mbuild(p_kind text, p_lines jsonb) returns jsonb language sql as $$
  select app.quote_build_manual(tests.tid('a'), pg_temp.today(), p_kind, app.quote_active_policy_version(tests.tid('a'), pg_temp.today()), pg_temp.resolved(p_lines)) $$;
create function pg_temp.honest(p_build jsonb) returns jsonb language sql as $$
  select (p_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.1.0', 'canonical_hash', app.quote_request_hash('1.1.0', (p_build -> 'request')::text), 'trace', '[]'::jsonb,
           'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(p_build -> 'flags') > 0,
                                       'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb) from jsonb_array_elements_text(p_build -> 'flags') c))) $$;
-- the SQL of a create call; the request and the result default to the database's own honest ones
create function pg_temp.mc_sql(p_id uuid, p_enq text, p_kind text, p_state text, p_lines jsonb, p_req jsonb default null, p_res jsonb default null) returns text language sql as $$
  select format('select public.create_manual_quote_draft(%L, %L, %L, %L, ''1.1.0'', %L, %L, %L::jsonb)', p_id, tests.rid(p_enq), p_kind, p_state,
                coalesce(p_req, pg_temp.mbuild(p_kind, p_lines) -> 'request')::text, coalesce(p_res, pg_temp.honest(pg_temp.mbuild(p_kind, p_lines)))::text, p_lines::text) $$;
create function pg_temp.mc(p_user text, p_id uuid, p_enq text, p_kind text, p_state text, p_lines jsonb) returns text language sql as $$
  select pg_temp.sc(p_user, pg_temp.mc_sql(p_id, p_enq, p_kind, p_state, p_lines)) $$;
create function pg_temp.approve_sql(p_quote uuid) returns text language sql as $$
  select format('select public.approve_quote(%L, %L)', p_quote, (select canonical_hash from public.quotes where id = p_quote)) $$;
create temp table qid as select gen_random_uuid() as q1, gen_random_uuid() as q2, gen_random_uuid() as q3, gen_random_uuid() as q4, gen_random_uuid() as q5, gen_random_uuid() as q6,
                                gen_random_uuid() as q7, gen_random_uuid() as q8, gen_random_uuid() as q9, gen_random_uuid() as l1;

-- ============================================================================ C. creating a manual quote
-- Q1: 3 x INR 2,500.00 and 1 x INR 999.99, a new customer, no delivery state. Worked by hand (integer paise):
--   lines 750000 and 99999; GST 5 % per line: 37500 exactly, and 4999.95 -> 5000 (half up); net 849999, tax 42500, total 892499;
--   advance 50 %: 446249.5 -> 446250 (half up), balance 446249. No courier: shipping 0 whatever the policy says.
select is(pg_temp.j(pg_temp.mc('a_owner', (select q1 from qid), 'm1', 'new', null, jsonb_build_array(pg_temp.ln('01', 3, 250000), pg_temp.ln('04', 1, 99999))), 'status'), 'draft', 'C1 an Owner makes a manual draft');
select is((select pricing_kind::text || '|' || (price_list_version_id is null)::text || '|' || (delivery_state is null)::text || '|' || (gst_supply is null)::text || '|' || created_via::text
             from public.quotes where id = (select q1 from qid)), 'manual|true|true|true|manual', 'C2 kind manual; no price list; no delivery state and no GST label; made by a person');
select is((select merchandise_net_paise || '|' || item_tax_paise || '|' || shipping_net_paise || '|' || shipping_tax_paise || '|' || total_paise || '|' || advance_paise || '|' || balance_paise
             from public.quotes where id = (select q1 from qid)), '849999|42500|0|0|892499|446250|446249', 'C3 the figures, worked by hand');
select is((select string_agg(line_no || ':' || item_type_code || ':' || sku || ':' || qty || ':' || unit_price_applied_paise || ':' || tax_paise || ':' || tax_bps || ':' || price_source || ':' || (product_id is null)::text,
                              ' ' order by line_no) from public.quote_lines where quote_id = (select q1 from qid)),
          '1:01:LINE-1:3:250000:37500:500:typed_by_person:true 2:04:LINE-2:1:99999:5000:500:typed_by_person:true', 'C4 each line stores its item type code, its typed price, its tax and the RATE USED (500)');
select is((select string_agg(name, '|' order by line_no) from public.quote_lines where quote_id = (select q1 from qid)), 'Item type one|Item type four', 'C5 the line label is the item type''s name');
select is((select due_date - as_of from public.quotes where id = (select q1 from qid)), 10, 'C6 a new customer''s balance is due after the new-customer days');
select is((select review_flags::text || '|' || engine_flags::text || '|' || needs_owner_approval::text from public.quotes where id = (select q1 from qid)), '{}|{}|false', 'C7 no flag, no Owner approval needed');
select is((select request_text::jsonb -> 'policy' -> 'shipping' || (request_text::jsonb -> 'policy' -> 'payment_terms')::jsonb from public.quotes where id = (select q1 from qid)) ->> 'tax_bps', '500',
          'C8 the shipping tax of the request is the GST rate (500), not the policy''s shipping_tax_bps (1800)');
select is((select request_text::jsonb -> 'policy' -> 'shipping' ->> 'flat_fee' || '|' || (request_text::jsonb -> 'policy' ->> 'rounding_mode') from public.quotes where id = (select q1 from qid)), '0|half_up',
          'C9 no courier fee although the policy has one (5000), and half-up rounding although the policy says half-even');
select is((select count(*) from public.requirements where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m1') and status = 'confirmed'), 1::bigint, 'C10 the function confirmed one requirement for the enquiry...');
select is((select count(*) from public.requirement_fields f join public.requirements r on r.id = f.requirement_id where r.enquiry_id = tests.rid('m1')), 0::bigint, 'C11 ...and it has no fields: no item type is written into the saree vocabulary');
select is((select r.confirmed_by = tests.uid('a_owner') and r.agent_run_id is null and r.created_via = 'manual' from public.requirements r where r.enquiry_id = tests.rid('m1')), true, 'C12 confirmed by the person who typed the prices');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'quote' and actor_user_id = tests.uid('a_owner') and action = 'quote.create'), 1::bigint, 'C13 creating the quote is audited as that person');

-- rounding: 10 paise at 5 % is exactly 0.5 paisa: half up gives 1 (half-even, the policy''s mode, would give 0); one line, a new customer, on another enquiry
select is(pg_temp.j(pg_temp.mc('a_admin', (select q2 from qid), 'm2', 'new', 'TS', jsonb_build_array(pg_temp.ln('04', 1, 10))), 'status'), 'draft', 'C14 an Admin makes a draft too (and names the delivery state this time)');
select is((select merchandise_net_paise || '|' || item_tax_paise || '|' || total_paise from public.quotes where id = (select q2 from qid)), '10|1|11', 'C15 the half paisa rounds UP, per line, although the policy''s mode is half-even');
select is((select delivery_state || '|' || gst_supply::text from public.quotes where id = (select q2 from qid)), 'TS|intra_state', 'C16 a delivery state equal to the seller''s: the intra-state label');
select is(pg_temp.j(pg_temp.mc('a_owner', (select q3 from qid), 'm3', 'new', 'KA', jsonb_build_array(pg_temp.ln('01', 2, 1000))), 'status'), 'draft', 'C17 another state...');
select is((select gst_supply::text from public.quotes where id = (select q3 from qid)), 'inter_state', 'C18 ...the inter-state label');
-- one tied pair per line: 3 lines of 10, 30 and 50 paise at 5 % (0.5, 1.5, 2.5): each rounds up on its own, so the tax is 1 + 2 + 3, not the 4.5 of the sum
select is(pg_temp.j(pg_temp.mc('a_owner', gen_random_uuid(), 'm3', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 10), pg_temp.ln('01', 1, 30), pg_temp.ln('01', 1, 50))), 'status'), 'draft', 'C19 three tied lines (a new draft on the same enquiry replaces the last one)');
select is((select item_tax_paise from public.quotes where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m3') and status = 'draft'), 6::bigint, 'C20 tax is rounded per LINE: 1 + 2 + 3 = 6 (not 5, the rounded sum 4.5)');
select is((select status::text from public.quotes where id = (select q3 from qid)), 'superseded', 'C21 the older draft of that enquiry is superseded');
select is((select count(*) from public.requirements where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m3')), 1::bigint, 'C22 and both drafts hang on the one requirement');

-- a repeat customer: the Owner decides (the kind is a claim); advance 25 %, balance due after the repeat days
select is(pg_temp.j(pg_temp.mc('a_admin', (select q4 from qid), 'm4', 'repeat', null, jsonb_build_array(pg_temp.ln('01', 1, 100000))), 'needs_owner_approval'), 'true', 'C23 a repeat customer needs the Owner');
select is((select review_flags::text || '|' || total_paise || '|' || advance_paise || '|' || balance_paise || '|' || (due_date - as_of) from public.quotes where id = (select q4 from qid)),
          '{REPEAT_CUSTOMER_CLAIMED}|105000|26250|78750|45', 'C24 the flag, 100000 + 5000 GST, 25 % advance, 45 days');

-- the item type's price range: a soft warning that flags the quote for the Owner; nothing is refused
select is(pg_temp.j(pg_temp.mc('a_admin', (select q5 from qid), 'm5', 'new', null, jsonb_build_array(pg_temp.ln('02', 1, 600000))), 'status'), 'draft', 'C25 a price above the item type''s highest (500000) is NOT refused: the draft is made');
select is((select review_flags::text || '|' || needs_owner_approval::text from public.quotes where id = (select q5 from qid)), '{TYPED_PRICE_OUTSIDE_RANGE}|true', 'C26 the database derived the warning flag, and the quote is flagged for the Owner');
select is(pg_temp.err('a_admin', pg_temp.approve_sql((select q5 from qid))), 'SM218|quote needs owner approval||||', 'C27 an Admin is told it needs the Owner');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q5 from qid))), 'status'), 'approved', 'C28 the Owner can approve it: the warning never blocks');
select is(pg_temp.j(pg_temp.mc('a_owner', gen_random_uuid(), 'm6', 'new', null, jsonb_build_array(pg_temp.ln('02', 1, 99999))), 'status'), 'draft', 'C29 below the lowest (INR 999.99 < 1000.00): made, not refused');
select is((select review_flags::text from public.quotes where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m6')), '{TYPED_PRICE_OUTSIDE_RANGE}', 'C30 and flagged');
select is((select count(*) from (select pg_temp.mc('a_owner', gen_random_uuid(), 'm7', 'new', null, jsonb_build_array(pg_temp.ln('02', 1, p))) r from unnest(array[100000, 250000, 500000]::bigint[]) p) z
            where r like '%error%'), 0::bigint, 'C31 the floor, a middle price and the ceiling are all inside: made without a flag');
select is((select count(*) from public.quotes where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m7') and review_flags <> '{}'), 0::bigint, 'C32 none of those three carries a flag');
select is((select review_flags::text from public.quotes where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m7') and status = 'draft'), '{}', 'C33 (the last of them is the draft)');
select is(pg_temp.j(pg_temp.mc('a_owner', gen_random_uuid(), 'm8', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 1), pg_temp.ln('04', 10000, 100000000))), 'status'), 'draft', 'C34 the smallest price (1 paisa) and the largest quantity and price are accepted');
select is((select merchandise_net_paise || '|' || item_tax_paise from public.quotes where tenant_id = tests.tid('a') and enquiry_id = tests.rid('m8')), '1000000000001|50000000000', 'C35 10000 x 100000000 + 1 = 1000000000001; GST 5 % per line = 0 (0.05 of a paisa rounds down) + 50000000000 (exact): integer paise, no overflow');

-- ============================================================================ D. who may, and never inside an agent context
create function pg_temp.fresh_sql(p_enq text) returns text language sql as $$ select pg_temp.mc_sql(gen_random_uuid(), p_enq, 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 1000))) $$;
select is(pg_temp.code('a_sales', pg_temp.fresh_sql('m9')), '42501', 'D1 Sales cannot type a price');
select is(pg_temp.code('a_viewer', pg_temp.fresh_sql('m9')), '42501', 'D2 a Viewer cannot');
select is(pg_temp.code('b_owner', pg_temp.fresh_sql('m9')), '42501', 'D3 another workspace''s Owner cannot');
select is(pg_temp.err('b_owner', pg_temp.fresh_sql('m9')), pg_temp.err('b_owner', replace(pg_temp.fresh_sql('m9'), tests.rid('m9')::text, gen_random_uuid()::text)), 'D4 a foreign enquiry and an unknown one: the identical refusal');
select is((select count(*) from public.quotes where enquiry_id = tests.rid('m9')), 0::bigint, 'D5 none of those left a quote...');
select is((select count(*) from public.requirements where enquiry_id = tests.rid('m9')), 0::bigint, 'D6 ...or a requirement');
select tests.as_aal('aal1');
select is(pg_temp.code('a_owner', pg_temp.mc_sql(gen_random_uuid(), 'm9', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 1000)))), 'ok', 'D7 the draft needs no second factor (the approval keeps it)');
select tests.as_aal('aal2');
-- an agent context: the agent functions set these two settings for one call; the manual function refuses under either
select set_config('app.agent_run_id', gen_random_uuid()::text, true);
select is(pg_temp.err('a_owner', pg_temp.fresh_sql('m10')), 'SM260|a price can only be typed by a person||||', 'D8 inside an agent run (app.agent_run_id set): refused with SM260');
select set_config('app.agent_run_id', '', true);
select set_config('app.created_via', 'agent', true);
select is(pg_temp.code('a_owner', pg_temp.fresh_sql('m10')), 'SM260', 'D9 with app.created_via = agent: refused with SM260');
select set_config('app.created_via', '', true);
select is((select count(*) from public.quotes where enquiry_id = tests.rid('m10')) + (select count(*) from public.requirements where enquiry_id = tests.rid('m10')), 0::bigint, 'D10 nothing was written by the refused calls');
select is(pg_temp.code('a_owner', pg_temp.fresh_sql('m10')), 'ok', 'D11 control: the same call outside an agent context works');
select set_config('app.created_via', 'agent', true);
select is(pg_temp.priv(format($f$insert into public.quotes select (jsonb_populate_record(null::public.quotes, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'quote_no', 9001, 'status', 'superseded', 'created_via', 'agent'))).* from public.quotes z where z.id = %L$f$, (select q1 from qid))) like '23514|%quotes_manual_origin_check%', true,
          'D12 the table refuses a manual quote stamped by an agent context, even if the function''s own guard were removed');
select set_config('app.created_via', '', true);
select is(pg_temp.priv(format($f$insert into public.quotes select (jsonb_populate_record(null::public.quotes, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'quote_no', 9002, 'status', 'superseded'))).* from public.quotes z where z.id = %L$f$, (select q1 from qid))), 'ok',
          'D13 control: the same copy with created_via manual is accepted by the table');
select ok(not has_function_privilege('anon', 'public.create_manual_quote_draft(uuid,uuid,text,text,text,text,text,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.create_manual_quote_draft(uuid,uuid,text,text,text,text,text,jsonb)', 'execute'), 'D14 anon cannot execute it; authenticated can (the role is proven inside)');
select ok(not has_function_privilege('authenticated', 'app.quote_build_manual(uuid,date,text,uuid,jsonb)', 'execute'), 'D15 the builder is not callable by a client');

-- ============================================================================ E. refusals
create function pg_temp.mcl(p_lines jsonb, p_enq text default 'm11', p_kind text default 'new', p_state text default null) returns text language sql as $$
  select pg_temp.code('a_owner', format('select public.create_manual_quote_draft(%L, %L, %L, %L, ''1.1.0'', %L, %L, %L::jsonb)', gen_random_uuid(), tests.rid(p_enq), p_kind, p_state,
         (pg_temp.mbuild('new', jsonb_build_array(pg_temp.ln('01', 1, 1000))) -> 'request')::text, '{}', p_lines::text)) $$;
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1, 'unit_price_paise', 1000, 'price_source', 'list'))), '22023', 'E1 a line with a price_source key (or any key beyond the three) is refused');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1, 'unit_price_paise', 1000, 'name', 'Mine'))), '22023', 'E2 ...so is a name of the caller''s');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1))), '22023', 'E3 a missing price is invalid');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('qty', 1, 'unit_price_paise', 1000))), '22023', 'E4 a missing item type is invalid');
select is(pg_temp.mcl('[]'::jsonb), '22023', 'E5 no line is invalid');
select is(pg_temp.mcl((select jsonb_agg(pg_temp.ln('01', 1, 1000)) from generate_series(1, 6))), '22023', 'E6 six lines are invalid (five at most)');
select is(pg_temp.mcl('{"a": 1}'::jsonb), '22023', 'E7 lines that are not an array are invalid');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01', 0, 1000))), '23514', 'E8 a quantity of 0: not allowed');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01', 10001, 1000))), '23514', 'E9 a quantity above 10000: not allowed');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01', 1, 0))), '23514', 'E10 a price of 0: not allowed');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01', 1, 100000001))), '23514', 'E11 a price above INR 1,000,000: not allowed');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1, 'unit_price_paise', -5))), '22023', 'E12 a negative price is invalid');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1, 'unit_price_paise', 10.5))), '22023', 'E13 a fractional price is invalid (no floats)');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1, 'unit_price_paise', '1000'))), '22023', 'E14 a price as a string is invalid');
select is(pg_temp.mcl(jsonb_build_array(jsonb_build_object('item_type_code', '01', 'qty', 1.5, 'unit_price_paise', 1000))), '22023', 'E15 a fractional quantity is invalid');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('ZZ', 1, 1000))), '23503', 'E16 an unknown item type: invalid reference');
select is(pg_temp.err('a_owner', replace(pg_temp.mc_sql(gen_random_uuid(), 'm11', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 1000))), '"item_type_code": "01"', '"item_type_code": "ZZ"')),
          pg_temp.err('a_owner', replace(pg_temp.mc_sql(gen_random_uuid(), 'm11', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 1000))), '"item_type_code": "01"', '"item_type_code": "B2"')), 'E17 two codes that do not exist in this workspace give the same refusal');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('03', 1, 1000))), '23514', 'E18 an item type that is no longer sold (inactive): not allowed');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01 ', 1, 1000))), '22023', 'E19 a code with a space is invalid');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01', 1, 1000)), 'm11', 'vip'), '22023', 'E20 an unknown customer kind is invalid');
select is(pg_temp.mcl(jsonb_build_array(pg_temp.ln('01', 1, 1000)), 'm11', 'new', 'ts'), '22023', 'E21 a delivery state that is not two capital letters is invalid');
select is(pg_temp.code('a_owner', format('select public.create_manual_quote_draft(%L, %L, ''new'', null, ''9.9.9'', ''{"as_of": "2026-01-01"}'', ''{}'', %L::jsonb)', gen_random_uuid(), tests.rid('m11'), jsonb_build_array(pg_temp.ln('01', 1, 1000))::text)), '23514',
          'E22 an engine version that is not on the allow-list: not allowed');
select is(pg_temp.code('a_owner', format('select public.create_manual_quote_draft(%L, %L, ''new'', null, ''1.1.0'', ''{"as_of": "2000-01-01"}'', ''{}'', %L::jsonb)', gen_random_uuid(), tests.rid('m11'), jsonb_build_array(pg_temp.ln('01', 1, 1000))::text)), 'SM215',
          'E23 a quote date that is not today: stale (SM215)');
-- the recomputation: the request and every figure must be the database's own
create function pg_temp.tamper(p_req_path text[], p_req_val jsonb, p_res_path text[], p_res_val jsonb) returns text language plpgsql as $$
declare
  v_lines jsonb := jsonb_build_array(pg_temp.ln('01', 2, 1000)); v_b jsonb := pg_temp.mbuild('new', v_lines); v_req jsonb := v_b -> 'request'; v_res jsonb := pg_temp.honest(v_b);
begin
  if p_req_path is not null then v_req := jsonb_set(v_req, p_req_path, p_req_val); end if;
  if p_res_path is not null then v_res := jsonb_set(v_res, p_res_path, p_res_val); end if;
  return pg_temp.code('a_owner', pg_temp.mc_sql(gen_random_uuid(), 'm11', 'new', null, v_lines, v_req, v_res));
end $$;
select is(pg_temp.tamper(array['price_list', '0', 'unit_price'], '999'::jsonb, null, null), 'SM216', 'E24 a request with another price than the typed one: refused (SM216)');
select is(pg_temp.tamper(array['price_list', '0', 'tax_bps'], '0'::jsonb, null, null), 'SM216', 'E25 a request with another GST rate than the policy''s: refused');
select is(pg_temp.tamper(array['policy', 'rounding_mode'], '"half_even"'::jsonb, null, null), 'SM216', 'E26 a request that rounds half-even: refused');
select is(pg_temp.tamper(array['policy', 'shipping', 'flat_fee'], '5000'::jsonb, null, null), 'SM216', 'E27 a request with a courier fee: refused');
select is(pg_temp.tamper(array['policy', 'shipping', 'tax_bps'], '1800'::jsonb, null, null), 'SM216', 'E28 a request whose shipping tax is the shipping_tax_bps instead of the GST rate: refused');
select is(pg_temp.tamper(null, null, array['totals', 'item_tax'], '1'::jsonb), 'SM216', 'E29 a result with another tax: refused');
select is(pg_temp.tamper(null, null, array['lines', '0', 'tax'], '1'::jsonb), 'SM216', 'E30 a result with another line tax: refused');
select is(pg_temp.tamper(null, null, array['payment_terms', 'balance'], '1'::jsonb), 'SM216', 'E31 a result with another balance: refused');
select is(pg_temp.tamper(null, null, array['payment_terms', 'due_date'], '"2099-01-01"'::jsonb), 'SM216', 'E32 a result with another due date: refused');
select is(pg_temp.tamper(null, null, array['flags', 'needs_owner_approval'], 'true'::jsonb), 'SM216', 'E33 a result that claims an approval flag the engine does not raise: refused');
select is(pg_temp.tamper(null, null, array['canonical_hash'], to_jsonb(repeat('0', 64))), 'SM216', 'E34 a result with another hash: refused');
select is((select count(*) from public.quotes where enquiry_id = tests.rid('m11')), 0::bigint, 'E35 none of the refusals stored anything');
select is(pg_temp.tamper(null, null, null, null), 'ok', 'E36 control: the untouched request and result are accepted');

-- ============================================================================ C (again). replay, conflict, requirement rules
create temp table rp as select gen_random_uuid() as id;
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.mc_sql((select id from rp), 'm10', 'new', null, jsonb_build_array(pg_temp.ln('01', 4, 5000)))), 'replayed'), 'false', 'R1 a fresh id makes a draft');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.mc_sql((select id from rp), 'm10', 'new', null, jsonb_build_array(pg_temp.ln('01', 4, 5000)))), 'replayed'), 'true', 'R2 an exact retry replays');
select is((select count(*) from public.quotes where id = (select id from rp)), 1::bigint, 'R3 no second quote');
select is(pg_temp.code('a_owner', pg_temp.mc_sql((select id from rp), 'm10', 'new', null, jsonb_build_array(pg_temp.ln('01', 4, 5001)))), '23505', 'R4 the same id with another price: the constant conflict');
select is(pg_temp.code('a_owner', pg_temp.mc_sql((select id from rp), 'm10', 'new', null, jsonb_build_array(pg_temp.ln('04', 4, 5000)))), '23505', 'R5 the same id with another item type (same name would hash alike): conflict');
select is(pg_temp.code('a_owner', pg_temp.mc_sql((select id from rp), 'm10', 'new', 'KA', jsonb_build_array(pg_temp.ln('01', 4, 5000)))), '23505', 'R6 the same id with a delivery state added: conflict');
select is(pg_temp.code('b_owner', pg_temp.mc_sql((select id from rp), 'm10', 'new', null, jsonb_build_array(pg_temp.ln('01', 4, 5000)))), '42501', 'R7 another workspace''s Owner with tenant A''s quote id: refused before anything else');
-- an enquiry that already has a requirement of the list flow (fields) is not taken over
select pg_temp.sc('a_owner', format('select public.add_requirement_field(%L, 1::smallint, ''saree_type'', ''other'', null::bigint, null, null, null)', tests.rid('l1')));
select pg_temp.sc('a_owner', format('select public.add_requirement_field(%L, 1::smallint, ''quantity'', null, 5::bigint, null, null, ''piece'')', tests.rid('l1')));
select is(pg_temp.code('a_owner', pg_temp.mc_sql(gen_random_uuid(), 'l1', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 1000)))), 'SM208', 'R8 an enquiry with a requirement of the list flow (a draft with fields): refused with SM208 until it is discarded');
select is((select count(*) from public.quotes where enquiry_id = tests.rid('l1')), 0::bigint, 'R9 nothing was stored');

-- ============================================================================ H. a list-price quote (made now, under the same policy) is what it always was
create function pg_temp.prod(p_sku text) returns uuid language sql as $$ select id from public.products where tenant_id = tests.tid('a') and sku = p_sku $$;
create function pg_temp.field(p_enq text, p_line int, p_key text, p_code text default null, p_int bigint default null, p_basis text default null) returns text language sql as $$
  select pg_temp.sc('a_owner', format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, null, null, %L)', tests.rid(p_enq), p_line, p_key, p_code, p_int, p_basis)) $$;
create function pg_temp.req(p_enq text) returns uuid language sql as $$ select id from public.requirements where enquiry_id = tests.rid(p_enq) and status in ('draft', 'confirmed') $$;
select pg_temp.field('l2', 1, 'saree_type', 'kanjivaram');  select pg_temp.field('l2', 1, 'quantity', null, 12, 'piece');
select pg_temp.sc('a_owner', format('select public.confirm_requirement(%L)', pg_temp.req('l2')));
select pg_temp.sc('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 12::integer, ''piece'', ''manual'', null)', pg_temp.req('l2'), pg_temp.prod('SYN-KJ-RED-01')));
create function pg_temp.lbuild() returns jsonb language sql as $$
  select app.quote_build(tests.tid('a'), pg_temp.req('l2'), pg_temp.today(), 'new', app.quote_active_price_version(tests.tid('a'), pg_temp.today()), app.quote_active_policy_version(tests.tid('a'), pg_temp.today())) $$;
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.create_quote_draft(%L, %L, ''new'', ''TG'', ''1.1.0'', %L, %L)', (select l1 from qid), pg_temp.req('l2'),
          (pg_temp.lbuild() -> 'request')::text, pg_temp.honest(pg_temp.lbuild())::text)), 'status'), 'draft', 'H1 a list quote is made by the unchanged list function (Sales may; the price list and the pick are its inputs)');
select is((select pricing_kind::text || '|' || (price_list_version_id is not null)::text || '|' || delivery_state || '|' || gst_supply::text from public.quotes where id = (select l1 from qid)), 'list|true|TG|inter_state', 'H2 it is kind list, with its price list and its delivery state');
select is((select merchandise_net_paise || '|' || item_tax_paise || '|' || shipping_net_paise || '|' || shipping_tax_paise || '|' || total_paise || '|' || advance_paise from public.quotes where id = (select l1 from qid)),
          '4800000|240000|5000|900|5045900|2522950', 'H3 its figures, worked by hand: the item rate (5 %), the policy''s freight fee and its OWN shipping tax rate (18 %) all still apply');
select is((select price_source || '|' || (product_id is not null)::text || '|' || (item_type_code is null)::text || '|' || tax_bps from public.quote_lines where quote_id = (select l1 from qid)), 'list|true|true|500', 'H4 its line is priced from the list, names a product and no item type');
select is((select pg_temp.priv(format($f$insert into public.quotes select (jsonb_populate_record(null::public.quotes, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'quote_no', 9006, 'status', 'superseded', 'delivery_state', null, 'gst_supply', null))).* from public.quotes z where z.id = %L$f$, (select l1 from qid))) like '23514|%quotes_pricing_kind_check%'),
          true, 'H5 a LIST quote without a delivery state is refused by the table (the list rule is unchanged)');
select is(pg_temp.priv(format($f$insert into public.quote_lines select (jsonb_populate_record(null::public.quote_lines, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'line_no', 2, 'sku', 'X2', 'product_id', null))).* from public.quote_lines z where z.quote_id = %L$f$, (select l1 from qid))) like '23514|%quote_lines_price_source_kind_check%', true,
          'H6 a list line without a product is refused');
select is(pg_temp.priv(format($f$insert into public.quote_lines select (jsonb_populate_record(null::public.quote_lines, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'line_no', 3, 'sku', 'X3', 'item_type_code', '01'))).* from public.quote_lines z where z.quote_id = %L$f$, (select l1 from qid))) like '23514|%quote_lines_price_source_kind_check%', true,
          'H7 a list line that names an item type is refused');
select is(pg_temp.priv(format($f$insert into public.quote_lines select (jsonb_populate_record(null::public.quote_lines, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'line_no', 3, 'sku', 'X4', 'product_id', tests.rid('a_product')))).* from public.quote_lines z where z.quote_id = %L and z.price_source = 'typed_by_person' limit 1$f$, (select q3 from qid))) like '23514|%quote_lines_price_source_kind_check%', true,
          'H8 a manual line that also names a product is refused');
select is(pg_temp.priv(format($f$insert into public.quote_lines select (jsonb_populate_record(null::public.quote_lines, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'line_no', 3, 'sku', 'X5', 'item_type_code', '01'))).* from public.quote_lines z where z.quote_id = %L and z.price_source = 'typed_by_person' limit 1$f$, (select q3 from qid))) , 'ok',
          'H9 control: a manual line that names a tenant-A item type is accepted by the table');
select is(pg_temp.priv(format($f$insert into public.quote_lines select (jsonb_populate_record(null::public.quote_lines, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'line_no', 4, 'sku', 'X6', 'item_type_code', 'B1'))).* from public.quote_lines z where z.quote_id = %L and z.price_source = 'typed_by_person' limit 1$f$, (select q3 from qid))) like '23503|%', true,
          'H10 a manual line cannot name another tenant''s item type (composite foreign key)');
select is(pg_temp.priv(format($f$insert into public.quote_lines select (jsonb_populate_record(null::public.quote_lines, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'line_no', 5, 'sku', 'X7', 'price_source', 'agent'))).* from public.quote_lines z where z.quote_id = %L and z.price_source = 'typed_by_person' limit 1$f$, (select q3 from qid))) like '23514|%', true,
          'H11 price_source is a closed list: anything but list and typed_by_person is refused');
select is((select count(*) from public.quotes where pricing_kind = 'list' and (price_list_version_id is null or delivery_state is null or gst_supply is null)), 0::bigint, 'H12 no list quote in the database lacks a price list, a delivery state or a label');
select is((select count(*) from public.quotes where tenant_id = tests.tid('a') and pricing_kind = 'manual' and id <> (select q2 from qid) and price_list_version_id is not null), 0::bigint, 'H13 no manual quote names a price list');

-- ============================================================================ F. approval, staleness, withdrawal, rejection
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.approve_sql((select q2 from qid))), 'status'), 'approved', 'F1 an Admin approves an unflagged manual quote: the rebuild from its stored lines reproduces it');
select is(pg_temp.err('a_sales', pg_temp.approve_sql((select q1 from qid))), pg_temp.err('a_sales', pg_temp.approve_sql(gen_random_uuid())), 'F2 Sales cannot approve (the same refusal as for an unknown quote)');
select tests.as_aal('aal1');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select q1 from qid))), 'SM306|a second factor is required for this action||||', 'F3 the approval still needs the second factor');
select tests.as_aal('aal2');
select is(pg_temp.code('b_owner', pg_temp.approve_sql((select q1 from qid))), '42501', 'F4 another workspace''s Owner cannot approve it');
-- a NEW PRICE LIST does not make a manual quote stale (it has none)...
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_price_list_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(),
          jsonb_build_array(jsonb_build_object('product_id', tests.rid('a_product'), 'unit_price_paise', 100000, 'minimum_order_quantity', 1, 'tax_bps', 500))::text)), 'version_no'), '2',
          'F5 a new price list version is published');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q1 from qid))), 'status'), 'approved', 'F6 ...and a manual draft made before it still approves');
select is((select approved_by from public.quotes where id = (select q1 from qid)), tests.uid('a_owner'), 'F7 approved by that Owner');
-- withdrawal and rejection work as for any quote
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.withdraw_approved_quote(%L, ''price_changed'')', (select q1 from qid))), 'status'), 'superseded', 'F8 an approved manual quote can be withdrawn');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.reject_quote(%L, ''other'')', (select q4 from qid))), 'status'), 'rejected', 'F9 a manual draft can be rejected');
-- ...but a NEW POLICY does (the policy staleness rule is unchanged)
select is(pg_temp.j(pg_temp.mc('a_owner', (select q6 from qid), 'm9', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 7000))), 'status'), 'draft', 'F10 a manual draft under policy version 2...');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy('{"gst_rate_bps": 1200}'))), 'version_no'), '3', 'F11 ...then version 3 with a different rate (SYNTHETIC 12 %) is published');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select q6 from qid))), 'SM215|quote is stale||||', 'F12 the draft is stale: a new policy version makes it retyped as a new draft');
select is(pg_temp.j(pg_temp.mc('a_owner', (select q7 from qid), 'm9', 'new', null, jsonb_build_array(pg_temp.ln('01', 1, 7000))), 'status'), 'draft', 'F13 the retyped draft is made under version 3');
select is((select item_tax_paise || '|' || (select gst_rate_bps from public.quote_policy_versions where id = policy_version_id) from public.quotes where id = (select q7 from qid)), '840|1200',
          'F14 12 % of 7000 = 840, and the line stores the rate used (the older quotes keep 500)');
select is((select string_agg(distinct tax_bps::text, ',') from public.quote_lines where quote_id = (select q6 from qid)), '500', 'F15 a rate published later changed no existing quote line');
-- no rate in force on the quote date: refused (nothing is guessed)
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy(jsonb_build_object('gst_rate_bps', 300, 'gst_effective_from', (pg_temp.today() + 5)::text)))), 'version_no'), '4',
          'F16 version 4 starts today but its GST rate only applies from five days later');
select is(app.quote_gst_bps_on(tests.tid('a'), app.quote_active_policy_version(tests.tid('a'), pg_temp.today()), pg_temp.today()), null, 'F17 so no rate is in force today');
select is(pg_temp.code('a_owner', format('select public.create_manual_quote_draft(%L, %L, ''new'', null, ''1.1.0'', %L, ''{}'', %L::jsonb)', gen_random_uuid(), tests.rid('m8'),
          jsonb_build_object('as_of', pg_temp.today()::text)::text, jsonb_build_array(pg_temp.ln('01', 1, 1000))::text)), 'SM217', 'F18 a manual quote is refused (SM217): no rate in force on the quote date');
select is((select count(*) from public.quotes where tenant_id = tests.tid('a') and policy_version_id = (select id from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 4)), 0::bigint, 'F19 nothing was stored');

-- ============================================================================ G. visibility and cross-tenant
create function pg_temp.manual_seen(p_user text) returns bigint language plpgsql as $$
declare v bigint; v_a uuid := tests.tid('a');
begin
  perform tests.set_identity(tests.uid(p_user));
  select count(*) into v from public.quotes q where q.tenant_id = v_a and q.pricing_kind = 'manual';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
create function pg_temp.manual_lines_seen(p_user text) returns bigint language plpgsql as $$
declare v bigint; v_a uuid := tests.tid('a');
begin
  perform tests.set_identity(tests.uid(p_user));
  select count(*) into v from public.quote_lines q where q.tenant_id = v_a and q.price_source = 'typed_by_person';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
select is(pg_temp.manual_seen('a_owner') > 0 and pg_temp.manual_seen('a_admin') > 0 and pg_temp.manual_seen('a_sales') > 0, true, 'G1 Owner, Admin and Sales of tenant A read the manual quotes');
select is(pg_temp.manual_seen('a_viewer'), 0::bigint, 'G2 a Viewer reads none');
select is(pg_temp.manual_seen('b_owner'), 0::bigint, 'G3 cross-tenant: tenant B''s Owner reads none of them');
select is(pg_temp.manual_lines_seen('a_owner') > 0 and pg_temp.manual_lines_seen('a_sales') > 0, true, 'G4 their lines (typed prices) are read by tenant A''s Owner and Sales');
select is(pg_temp.manual_lines_seen('a_viewer') + pg_temp.manual_lines_seen('b_owner'), 0::bigint, 'G5 a Viewer and another tenant read none of the lines');
select is(pg_temp.code('a_owner', format('update public.quotes set pricing_kind = ''list'' where id = %L', (select q2 from qid))), '42501', 'G6 a client cannot change a quote''s kind (no write grant)');
select is(pg_temp.priv(format('update public.quotes set pricing_kind = ''list'' where id = %L', (select q2 from qid))), '42501|quotes rows are immutable: record a new quote', 'G7 nor can anyone: quote content never changes');
select is(pg_temp.priv(format('update public.quote_lines set unit_price_applied_paise = 1 where quote_id = %L', (select q2 from qid))) like '42501|%', true, 'G8 a typed price is immutable once stored');
-- the two kinds are told apart by the table
select is(pg_temp.priv(format($f$insert into public.quotes select (jsonb_populate_record(null::public.quotes, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'quote_no', 9003, 'status', 'superseded', 'price_list_version_id', %L))).* from public.quotes z where z.id = %L$f$,
          (select id from public.price_list_versions where tenant_id = tests.tid('a') limit 1), (select q2 from qid))) like '23514|%quotes_pricing_kind_check%', true, 'G9 a manual quote that names a price list: refused by the table');
select is(pg_temp.priv(format($f$insert into public.quotes select (jsonb_populate_record(null::public.quotes, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'quote_no', 9004, 'status', 'superseded', 'gst_supply', null))).* from public.quotes z where z.id = %L$f$, (select q2 from qid))) like '23514|%quotes_pricing_kind_check%', true,
          'G10 a manual quote with a delivery state but no GST label: refused (both or neither)');
select is(pg_temp.priv(format($f$insert into public.quotes select (jsonb_populate_record(null::public.quotes, to_jsonb(z) || jsonb_build_object('id', gen_random_uuid(), 'quote_no', 9005, 'status', 'superseded', 'pricing_kind', 'list'))).* from public.quotes z where z.id = %L$f$, (select q2 from qid))) like '23514|%quotes_pricing_kind_check%', true,
          'G11 a LIST quote with no price list is refused');

select * from finish();
rollback;
