-- T008 commit 3b: the human "add missing field", the delivery-city rule, the SM208 race mapping, the guard's timing, requirement_v1.
--   A add_requirement_field   B the agent's delivery-city rule   C SM208 on a lost race   D timing of app.text_has_contact   E requirement_v1
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 100 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
select app.operator_enable_requirement('tenant-a');

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;

insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values
  (tests.rid('en1'), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', E'Hello,\nNeed  20 kanjivaram   sarees\tby 15 November 2026.\nDeliver to Navi  Mumbai. Payment 30 days credit.'),
  (tests.rid('en2'), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Need 10 paithani sarees in Pune'),
  (tests.rid('en3'), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Archived enquiry'),
  (tests.rid('en4'), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Need 4 banarasi sarees, deliver to Surat, 50% advance'),
  (tests.rid('enb'), tests.tid('b'), tests.rid('b_lead'), 'email', now() - interval '1 hour', 'Tenant B wants 5 paithani sarees');
update public.enquiries set archived_at = now() where id = tests.rid('en3');
create function pg_temp.body(p_enquiry text) returns text language sql as $$ select body from public.enquiries where id = tests.rid(p_enquiry) $$;
create function pg_temp.add(p_user text, p_enquiry uuid, p_line int, p_key text, p_code text default null, p_int bigint default null, p_date date default null,
                            p_text text default null, p_basis text default null, p_quote text default null, p_start int default null, p_end int default null) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, %L::date, %L, %L, %L, %L::integer, %L::integer)',
                                   p_enquiry, p_line, p_key, p_code, p_int, p_date, p_text, p_basis, p_quote, p_start, p_end)) $$;
create function pg_temp.adde(p_user text, p_enquiry uuid, p_line int, p_key text, p_code text default null, p_int bigint default null, p_date date default null,
                             p_text text default null, p_basis text default null, p_quote text default null, p_start int default null, p_end int default null) returns text language sql as $$
  select pg_temp.err(p_user, format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, %L::date, %L, %L, %L, %L::integer, %L::integer)',
                                    p_enquiry, p_line, p_key, p_code, p_int, p_date, p_text, p_basis, p_quote, p_start, p_end)) $$;

-- ============================================================================ A. add_requirement_field
select ok(not has_function_privilege('anon', 'public.add_requirement_field(uuid,smallint,text,text,bigint,date,text,text,text,integer,integer)', 'execute'), 'anon cannot execute add_requirement_field');
select is(pg_temp.j(pg_temp.add('a_sales', tests.rid('en1'), 1, 'saree_type', 'kanjivaram'), 'replayed'), 'false', 'Sales adds a field a human can see in the text (no quote needed)');
select is((select f.state::text || '|' || f.created_via::text || '|' || f.certainty::text || '|' || (f.decided_by = tests.uid('a_sales'))::text || '|' || (f.created_by = tests.uid('a_sales'))::text || '|' || (f.quote is null)::text
             from public.requirement_fields f where f.tenant_id = tests.tid('a') and f.field_key = 'saree_type'),
          'corrected|manual|stated|true|true|true', 'it is stored as corrected, decided and created by the caller, manual, with no quote');
select is((select r.status::text || '|' || r.created_via::text || '|' || coalesce(r.agent_run_id::text, '-') from public.requirements r where r.enquiry_id = tests.rid('en1')), 'draft|manual|-', 'the draft requirement was created for it (manual, no run)');
select is(pg_temp.j(pg_temp.add('a_admin', tests.rid('en1'), 1, 'quantity', null, 20, null, null, 'piece', 'Need  20 kanjivaram   sarees', strpos(pg_temp.body('en1'), 'Need  20') - 1, strpos(pg_temp.body('en1'), 'Need  20') - 1 + char_length('Need  20 kanjivaram   sarees')), 'replayed'), 'false', 'Admin adds a quantity WITH a quote: it is verified like the agent''s');
select is((select quote from public.requirement_fields where field_key = 'quantity' and tenant_id = tests.tid('a')), 'Need 20 kanjivaram sarees', 'the stored quote is whitespace-normalised');
select is((select count(*) from public.requirements where enquiry_id = tests.rid('en1')), 1::bigint, 'the second add used the SAME draft (one requirement)');
select is(pg_temp.j(pg_temp.add('a_owner', tests.rid('en1'), null, 'delivery_city', null, null, null, 'Navi Mumbai'), 'replayed'), 'false', 'Owner adds the delivery city');
select is(pg_temp.j(pg_temp.add('a_sales', tests.rid('en1'), 1, 'saree_type', 'kanjivaram'), 'replayed'), 'true', 'an exact retry by the same person is a replay');
select is(pg_temp.add('a_admin', tests.rid('en1'), 1, 'saree_type', 'kanjivaram'), '{"error": "23514"}', 'the same slot by someone else is refused (change a field with decide_requirement_field)');
select is(pg_temp.add('a_sales', tests.rid('en1'), 1, 'saree_type', 'banarasi'), '{"error": "23514"}', 'the same slot with another value is refused');
-- who may
select is(pg_temp.add('a_viewer', tests.rid('en2'), 1, 'saree_type', 'paithani'), '{"error": "42501"}', 'a Viewer cannot add');
select is(pg_temp.add('b_owner', tests.rid('en2'), 1, 'saree_type', 'paithani'), '{"error": "42501"}', 'another tenant''s Owner cannot add');
select is(pg_temp.adde('b_owner', tests.rid('en2'), 1, 'saree_type', 'paithani'), pg_temp.adde('b_owner', gen_random_uuid(), 1, 'saree_type', 'paithani'), 'a foreign enquiry and an unknown one fail identically');
select is(pg_temp.add('a_sales', tests.rid('en3'), 1, 'saree_type', 'paithani'), '{"error": "23503"}', 'an archived enquiry: refused');
-- shape and caps (the same as the agent path)
select is(pg_temp.add('a_sales', tests.rid('en2'), 1, 'quantity', null, 10001, null, null, 'piece'), '{"error": "23514"}', 'quantity 10,001: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 1, 'quantity', null, 10000, null, null, 'piece') like '%field_id%', true, 'quantity 10,000: accepted');
select is(pg_temp.add('a_sales', tests.rid('en2'), null, 'budget', null, 100000001, null, null, 'per_piece'), '{"error": "23514"}', 'a per-piece budget over INR 1,000,000: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'saree_type', 'plastic'), '{"error": "23514"}', 'a code outside the vocabulary: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 6, 'colour', 'red'), '{"error": "23514"}', 'a sixth line: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), null, 'colour', 'red'), '{"error": "23514"}', 'a line field without a line: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 1, 'price', 'red'), '{"error": "22023"}', 'an unknown field key: invalid');
select is(pg_temp.add('a_sales', tests.rid('en2'), null, 'delivery_city', null, null, null, repeat('c', 61)), '{"error": "23514"}', 'a city over 60 characters: refused');
-- the quote, when given, is verified
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, 'Need 99 paithani sarees', 0, 23), '{"error": "23514"}', 'a quote that is not the span: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, 'Need 10 paithani sarees', 0, 6000), '{"error": "23514"}', 'an end beyond the text: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, 'Need 10', 5, 12), '{"error": "23514"}', 'right words, wrong offsets: refused');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, 'in Pune', strpos(pg_temp.body('en2'), 'in Pune') - 1, char_length(pg_temp.body('en2')) + 5), '{"error": "23514"}', 'an end beyond the text is refused even when the tail it would cut equals the quote');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, 'Need 10', null, null), '{"error": "22023"}', 'a quote without offsets: invalid');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, null, 0, 7), '{"error": "22023"}', 'offsets without a quote: invalid');
select is(pg_temp.add('a_sales', tests.rid('en2'), 2, 'fabric', 'silk', null, null, null, null, 'Need 10', 0, 7) like '%field_id%', true, 'the true span is accepted');
-- agent fields still need their quote; manual fields may lack it; all three or none
select set_config('app.created_via', 'agent', true);
select throws_ok(format($$insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_code, certainty)
                          select tenant_id, id, 3, 'colour', 'red', 'stated' from public.requirements where enquiry_id = %L$$, tests.rid('en2')), '23514', null, 'an AGENT field without a quote is refused by the table');
select set_config('app.created_via', '', true);
select throws_ok(format($$insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_code, certainty, quote, quote_start, quote_end)
                          select tenant_id, id, 3, 'colour', 'red', 'stated', 'x', 0, null from public.requirements where enquiry_id = %L$$, tests.rid('en2')), '23514', null, 'a quote with only one offset is refused (all or none)');
-- it attaches to an AGENT draft too, never creating a second active requirement
select tests.outcome_as(tests.uid('a_sales'), format('select public.start_agent_run(%L, %L, ''requirement'', ''requirement-1'', ''enquiry'', %L, %L, ''{}''::jsonb)', tests.rid('r1'), tests.tid('a'), tests.rid('en4'), repeat('a', 64)));
select pg_temp.sc('a_sales', format('select public.agent_write_requirement_field(%L, ''k1'', 1::smallint, ''saree_type'', ''banarasi'', null, null, null, null, ''stated'', ''banarasi'', %s, %s, false)', tests.rid('r1'), strpos(pg_temp.body('en4'), 'banarasi') - 1, strpos(pg_temp.body('en4'), 'banarasi') - 1 + 8));
select is(pg_temp.j(pg_temp.add('a_sales', tests.rid('en4'), 1, 'quantity', null, 4, null, null, 'piece'), 'replayed'), 'false', 'a human adds to the draft an agent started');
select is((select count(*) from public.requirements where enquiry_id = tests.rid('en4') and status in ('draft', 'confirmed')), 1::bigint, '...still one active requirement');
select is((select string_agg(f.created_via::text, ',' order by f.created_via::text) from public.requirement_fields f join public.requirements q on q.id = f.requirement_id where q.enquiry_id = tests.rid('en4')), 'agent,manual', '...holding one agent field and one manual field');
-- confirm: manual fields count as settled
select pg_temp.sc('a_sales', format($$select public.decide_requirement_field(%L, 'confirm')$$, (select f.id from public.requirement_fields f join public.requirements q on q.id = f.requirement_id where q.enquiry_id = tests.rid('en4') and f.field_key = 'saree_type')));
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.confirm_requirement(%L)', (select id from public.requirements where enquiry_id = tests.rid('en4') and status = 'draft'))), 'status'), 'confirmed', 'a confirmed agent type + a MANUAL quantity make a confirmable requirement');
select is(pg_temp.add('a_sales', tests.rid('en4'), null, 'delivery_city', null, null, null, 'Surat'), '{"error": "SM208"}', 'adding to an enquiry with a CONFIRMED requirement: SM208');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', (select id from public.requirements where enquiry_id = tests.rid('en4') and status = 'confirmed'))), 'status'), 'discarded', 'a human discards it');
select is(pg_temp.j(pg_temp.add('a_sales', tests.rid('en4'), null, 'delivery_city', null, null, null, 'Surat'), 'replayed'), 'false', '...and then may add again (a new manual draft)');
-- audit: the actor is the user; the city and the quote are never in the trail
select ok(exists (select 1 from public.audit_events where entity_type = 'requirement_field' and action like '%create%' and actor_user_id = tests.uid('a_sales') and actor_type = 'user')
          and not exists (select 1 from public.audit_events where entity_type = 'requirement_field' and action like '%create%' and actor_type = 'agent' and actor_user_id is null), 'a manual field is audited as a user action by the person who added it');
select is((select count(*) from public.audit_events where entity_type = 'requirement_field' and (new_values::text like '%Navi Mumbai%' or new_values::text like '%Surat%' or new_values::text like '%paithani sarees%')), 0::bigint, 'the audit trail holds no city and no quote');

-- ============================================================================ B. the agent's delivery-city rule
create function pg_temp.start_sql(p_run uuid, p_enq text) returns text language sql as $$
  select format('select public.start_agent_run(%L, %L, ''requirement'', ''requirement-1'', ''enquiry'', %L, %L, ''{}''::jsonb)', p_run, tests.tid('a'), tests.rid(p_enq), repeat('a', 64)) $$;
create function pg_temp.city_sql(p_run uuid, p_step text, p_enq text, p_phrase text, p_city text) returns text language sql as $$
  select format('select public.agent_write_requirement_field(%L, %L, null, ''delivery_city'', null, null, null, %L, null, ''stated'', %L, %s, %s, false)',
                p_run, p_step, p_city, p_phrase, strpos(pg_temp.body(p_enq), p_phrase) - 1, strpos(pg_temp.body(p_enq), p_phrase) - 1 + char_length(p_phrase)) $$;
-- (commit 3c) en1 and en2 hold a person's manual fields from section A: a run needs the draft discarded first
select pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', (select id from public.requirements where enquiry_id = tests.rid('en1') and status = 'draft')));
select pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', (select id from public.requirements where enquiry_id = tests.rid('en2') and status = 'draft')));
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('r2'), 'en1')), 'rows:1', 'a run on the Navi Mumbai enquiry starts');
select is(pg_temp.err('a_sales', pg_temp.city_sql(tests.rid('r2'), 'c1', 'en1', 'Navi  Mumbai', 'Chennai')), '23514|value not allowed||||', 'a city that is not in its quote: refused');
select is(pg_temp.err('a_sales', pg_temp.city_sql(tests.rid('r2'), 'c2', 'en1', 'Deliver to Navi  Mumbai', 'Pune')), '23514|value not allowed||||', '...even when the quote is about delivery');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.city_sql(tests.rid('r2'), 'c3', 'en1', 'Navi  Mumbai', 'navi mumbai')), 'replayed'), 'false', 'the city in the quote is accepted, case and whitespace aside');
select is((select value_text from public.requirement_fields where field_key = 'delivery_city' and created_via = 'agent' and tenant_id = tests.tid('a') and quote = 'Navi Mumbai'), 'navi mumbai', 'the stored value is the one the agent wrote');
select is(pg_temp.sc('a_sales', format($$select public.decide_requirement_field(%L, 'correct', null, null, null, 'Chennai', null)$$, (select f.id from public.requirement_fields f where f.field_key = 'delivery_city' and f.created_via = 'agent' and f.tenant_id = tests.tid('a')))) like '%corrected%', true, 'a HUMAN correction to a city that is not in the quote stays free');

-- ============================================================================ C. SM208 on a lost race (a confirm that commits between the check and the insert)
create function pg_temp.race() returns trigger language plpgsql as $$
begin
  insert into public.requirements (id, tenant_id, enquiry_id, status, confirmed_by, confirmed_at)
  values (gen_random_uuid(), new.tenant_id, new.enquiry_id, 'confirmed', tests.uid('a_owner'), now());
  return new;
end $$;
select tests.outcome_as(tests.uid('a_sales'), pg_temp.start_sql(tests.rid('r3'), 'en2'));
create trigger race_confirm before insert on public.requirements for each row when (new.status = 'draft') execute function pg_temp.race();
select is(pg_temp.err('a_sales', format('select public.agent_write_requirement_field(%L, ''x1'', 1::smallint, ''quantity'', null, 10, null, null, ''piece'', ''stated'', ''10 paithani'', 5, 16, false)', tests.rid('r3'))),
          'SM208|enquiry already has a confirmed requirement||||', 'the agent write that loses the race gets SM208, not a unique violation');
drop trigger race_confirm on public.requirements;
select is((select count(*) from public.requirements where enquiry_id = tests.rid('en2') and status = 'confirmed'), 0::bigint, 'the failed write left nothing behind (the lost insert and the simulated confirm both rolled back)');
create temp table en5 as select gen_random_uuid() as id;
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) select id, tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Need 8 chanderi sarees' from en5;
create trigger race_confirm2 before insert on public.requirements for each row when (new.status = 'draft') execute function pg_temp.race();
select is(pg_temp.adde('a_sales', (select id from en5), 1, 'saree_type', 'chanderi'), 'SM208|enquiry already has a confirmed requirement||||', 'add_requirement_field that loses the race gets SM208 too');
drop trigger race_confirm2 on public.requirements;

-- ============================================================================ D. the contact guard stays fast on adversarial 6,000-character inputs
create function pg_temp.ms(p_text text) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); r boolean;
begin r := app.text_has_contact(p_text); return extract(epoch from clock_timestamp() - t0) * 1000; end $$;
select cmp_ok(pg_temp.ms(repeat('a', 6000)), '<', 1000::numeric, 'all letters: well under a second');
select cmp_ok(pg_temp.ms(repeat('1', 6000)), '<', 1000::numeric, 'all digits');
select cmp_ok(pg_temp.ms(repeat('9', 6000)), '<', 1000::numeric, 'all nines');
select cmp_ok(pg_temp.ms(repeat('rs ', 2000)), '<', 1000::numeric, 'repeated "rs "');
select cmp_ok(pg_temp.ms(repeat('+91', 2000)), '<', 1000::numeric, 'repeated "+91"');
select cmp_ok(pg_temp.ms(repeat('+91 ', 1500)), '<', 1000::numeric, 'repeated "+91 "');
select cmp_ok(pg_temp.ms(repeat('98765 ', 1000)), '<', 1000::numeric, 'repeated phone halves');
select cmp_ok(pg_temp.ms(repeat('a@', 3000)), '<', 1000::numeric, 'repeated "a@"');
select cmp_ok(pg_temp.ms(repeat('a', 5999) || '@'), '<', 1000::numeric, 'a long local part and no domain');
select cmp_ok(pg_temp.ms(repeat('a.', 3000) || '@'), '<', 1000::numeric, 'dotted local part');
select cmp_ok(pg_temp.ms('a@' || repeat('b.', 2998)), '<', 1000::numeric, 'a long dotted domain');
select cmp_ok(pg_temp.ms(repeat('9876543210 ', 545)), '<', 1000::numeric, 'five hundred phone numbers');

-- ============================================================================ E. requirement_v1
select is((select reloptions::text from pg_class where oid = 'public.requirement_v1'::regclass), '{security_invoker=true}', 'requirement_v1 is a security-invoker view (the caller''s RLS applies)');
select ok(not has_table_privilege('anon', 'public.requirement_v1', 'select') and has_table_privilege('authenticated', 'public.requirement_v1', 'select'), 'authenticated reads it; anon does not');
select is((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'requirement_v1'),
          'requirement_id,tenant_id,enquiry_id,schema_version,confirmed_by,confirmed_at,field_id,line_no,field_key,value_code,value_int,value_date,value_text,basis,state', 'it exposes the typed values and nothing of the enquiry text: no quote, no offsets, no body');
-- a confirmed requirement with an accepted field, a proposed one and a rejected one
create temp table v as select gen_random_uuid() as enq, gen_random_uuid() as req;
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) select enq, tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Need 12 banarasi sarees in red to Pune' from v;
insert into public.requirements (id, tenant_id, enquiry_id, status, confirmed_by, confirmed_at) select req, tests.tid('a'), enq, 'confirmed', tests.uid('a_owner'), now() from v;
insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_code, certainty, state, decided_by, decided_at, created_via) select tests.tid('a'), req, 1, 'saree_type', 'banarasi', 'stated', 'confirmed', tests.uid('a_owner'), now(), 'manual' from v;
insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_int, basis, certainty, state, decided_by, decided_at, created_via) select tests.tid('a'), req, 1, 'quantity', 12, 'piece', 'stated', 'corrected', tests.uid('a_owner'), now(), 'manual' from v;
insert into public.requirement_fields (tenant_id, requirement_id, line_no, field_key, value_code, certainty, created_via) select tests.tid('a'), req, 1, 'colour', 'red', 'stated', 'manual' from v;
insert into public.requirement_fields (tenant_id, requirement_id, field_key, value_text, certainty, state, decided_by, decided_at, created_via) select tests.tid('a'), req, 'delivery_city', 'Pune', 'stated', 'rejected', tests.uid('a_owner'), now(), 'manual' from v;
select is(tests.rows_as(tests.uid('a_sales'), format('select * from public.requirement_v1 where requirement_id = %L', (select req from v))), 2::bigint, 'only the confirmed and corrected fields of a CONFIRMED requirement (not the proposed one, not the rejected one)');
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select string_agg(field_key::text || '=' || coalesce(value_code, value_int::text), ',' order by field_key::text) from public.requirement_v1 where requirement_id = %L$$, (select req from v))), 'quantity=12,saree_type=banarasi', 'a Viewer reads the same two');
select is(tests.rows_as(tests.uid('b_owner'), format('select * from public.requirement_v1 where requirement_id = %L', (select req from v))), 0::bigint, 'another tenant reads none');
-- a draft, a superseded and a discarded requirement show nothing
select is(tests.rows_as(tests.uid('a_sales'), format('select * from public.requirement_v1 where enquiry_id = %L', tests.rid('en2'))), 0::bigint, 'a requirement that is not confirmed shows no field, accepted or not');
update public.requirements set status = 'discarded', confirmed_by = null, confirmed_at = null where id = (select req from v);
select is(tests.rows_as(tests.uid('a_sales'), format('select * from public.requirement_v1 where requirement_id = %L', (select req from v))), 0::bigint, 'a discarded requirement disappears from the view');

select * from finish();
rollback;
