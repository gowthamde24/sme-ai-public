-- Job 3 phase A: the provider and the account of a phone line, and the provider names the call tables accept.  A the new columns  B phone_call_begin  C the line lookup  D webhook events
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A: the columns
insert into public.phone_numbers (id, tenant_id, number, label, inbound_on) values (tests.rid('old_line'), tests.tid('a'), '+914045903172', 'Hyderabad ExoPhone', true);
select is((select provider from public.phone_numbers where id = tests.rid('old_line')), 'exotel', 'A1: every line that exists is an Exotel line (the default)');
select is((select account_ref is null and external_ref is null from public.phone_numbers where id = tests.rid('old_line')), true, 'A2: and sits in the platform''s own account (no account named)');
insert into public.phone_numbers (id, tenant_id, number, label, inbound_on, provider) values (tests.rid('pl_line'), tests.tid('a'), '+918065590129', 'Plivo Bangalore', true, 'plivo');
select is((select provider from public.phone_numbers where id = tests.rid('pl_line')), 'plivo', 'A3: a Plivo line');
insert into public.phone_numbers (tenant_id, number, provider, account_ref, external_ref) values (tests.tid('b'), '+918065590130', 'vobiz', 'sme-ws-b-vobiz-account', 'SA2025RK4E639VJFZAMM');
select is((select count(*) from public.phone_numbers where provider = 'vobiz'), 1::bigint, 'A4: a Vobiz line, with the name of its secret and the provider''s account id');
select throws_ok($$insert into public.phone_numbers (tenant_id, number, provider) values ((select id from public.tenants limit 1), '+918065590131', 'twilio')$$, '23514', null, 'A5: a provider that is not one of ours is refused');
select throws_ok($$insert into public.phone_numbers (tenant_id, number, account_ref) values ((select id from public.tenants limit 1), '+918065590132', 'Has Spaces And A Secret Value')$$, '23514', null, 'A6: account_ref is a secret''s NAME, not free text');
select throws_ok($$insert into public.phone_numbers (tenant_id, number, external_ref) values ((select id from public.tenants limit 1), '+918065590133', 'a b')$$, '23514', null, 'A7: external_ref is an id');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'phone_numbers' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0::bigint, 'A8: nobody but the operator writes a line');

-- B: phone_call_begin
select is((pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'plivo', true, null, 'inbound', 'te', null, true)::text$q$, tests.tid('a')))::jsonb ->> 'provider'), 'plivo', 'B1: a call can be begun for Plivo');
select is((pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'vobiz', true, null, 'inbound', 'te', null, false)::text$q$, tests.tid('a')))::jsonb ->> 'ai_disclosed'), 'false', 'B2: for Vobiz, and the record says whether the greeting told the caller it is an AI');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'exotel', true, null, 'inbound', 'te', null, true)::text$q$, tests.tid('a')))::jsonb ->> 'provider', 'exotel', 'B3: Exotel as before');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'twilio', true, null, 'inbound', 'te', null, true)::text$q$, tests.tid('a'))), 'ERR:22023', 'B4: another provider name is refused');
select is((select count(*) from public.phone_calls where provider in ('plivo', 'vobiz', 'exotel') and tenant_id = tests.tid('a')), 3::bigint, 'B5: the three calls are recorded with their providers');

-- C: the line lookup (the scheduler account only)
select is(pg_temp.sc('a_owner', $q$select public.phone_line_find('+918065590129')::text$q$), 'ERR:42501', 'C1: a member cannot look a line up (the phone server can)');
select is((select pg_temp.q('outsider', $q$select public.phone_line_find('+918065590129')::text$q$)::jsonb ->> 'provider'), 'plivo', 'C2: the phone server learns the line''s provider');
select is((select pg_temp.q('outsider', $q$select public.phone_line_find('+914045903172')::text$q$)::jsonb ->> 'provider'), 'exotel', 'C3: and an old line is Exotel');
select is((select pg_temp.q('outsider', $q$select public.phone_line_find('+918065590130')::text$q$)::jsonb ->> 'external_ref'), 'SA2025RK4E639VJFZAMM', 'C4: with the account id');
select is((select (pg_temp.q('outsider', $q$select public.phone_line_find('+918065590129')::text$q$)::jsonb) ?& array['tenant_id', 'line_id', 'inbound_on', 'business', 'assistant', 'provider', 'account_ref', 'external_ref']), true, 'C5: every old key is still there');
select is(pg_temp.q('outsider', $q$select public.phone_line_find('+910000000000')::text$q$), null, 'C6: an unknown number is null');

-- D: webhook events
insert into integrations.webhook_events (provider, event_id, outcome) values ('plivo', 'plivo-event-0001', 'applied'), ('vobiz', 'vobiz-event-0001', 'applied');
select is((select count(*) from integrations.webhook_events where provider in ('plivo', 'vobiz')), 2::bigint, 'D1: Plivo and Vobiz messages can be recorded as seen');
select throws_ok($$insert into integrations.webhook_events (provider, event_id, outcome) values ('twilio', 'twilio-evt-0001', 'applied')$$, '23514', null, 'D2: another provider is refused');

select * from finish();
rollback;
