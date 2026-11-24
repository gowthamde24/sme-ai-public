-- VoiceLink as a provider (24 Nov 2026): the lists accept it, still refuse any other word, and the old providers behave as before.  A the line  B phone_call_begin  C the line lookup  D webhook events
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

-- A: the line
insert into public.phone_numbers (id, tenant_id, number, label, inbound_on, provider) values (tests.rid('vl_line'), tests.tid('a'), '+918065590140', 'VoiceLink line', true, 'voicelink');
select is((select provider from public.phone_numbers where id = tests.rid('vl_line')), 'voicelink', 'A1: a VoiceLink line can be recorded');
select throws_ok($$insert into public.phone_numbers (tenant_id, number, provider) values ((select id from public.tenants limit 1), '+918065590141', 'nonsense')$$, '23514', null, 'A2: any other provider word is still refused');

-- B: phone_call_begin
select is((pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'voicelink', true, null, 'inbound', 'te', null, true)::text$q$, tests.tid('a')))::jsonb ->> 'provider'), 'voicelink', 'B1: a call can be begun for VoiceLink');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'exotel', true, null, 'inbound', 'te', null, true)::text$q$, tests.tid('a')))::jsonb ->> 'provider', 'exotel', 'B2: Exotel as before');
select is(pg_temp.sc('a_owner', format($q$select public.phone_call_begin(%L, 'inbound', 'twilio', true, null, 'inbound', 'te', null, true)::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: another provider name is still refused');
select is((select count(*) from public.phone_calls where provider in ('voicelink', 'exotel') and tenant_id = tests.tid('a')), 2::bigint, 'B4: the two calls are recorded with their providers');

-- C: the line lookup (the scheduler account only) names the provider
select is((select pg_temp.q('outsider', $q$select public.phone_line_find('+918065590140')::text$q$)::jsonb ->> 'provider'), 'voicelink', 'C1: the phone server learns that the line is a VoiceLink line');
select isnt(pg_temp.q('outsider', format($q$select public.phone_line_for_tenant(%L, 'voicelink')::text$q$, tests.tid('a'))), 'ERR:22023', 'C2: the per-business lookup takes voicelink');
select is(pg_temp.q('outsider', format($q$select public.phone_line_for_tenant(%L, 'twilio')::text$q$, tests.tid('a'))), 'ERR:22023', 'C3: and still refuses another word');

-- D: webhook events
insert into integrations.webhook_events (provider, event_id, outcome) values ('voicelink', 'voicelink-event-0001', 'applied');
select is((select count(*) from integrations.webhook_events where provider = 'voicelink'), 1::bigint, 'D1: a VoiceLink message can be recorded as seen');
select throws_ok($$insert into integrations.webhook_events (provider, event_id, outcome) values ('twilio', 'twilio-evt-0001', 'applied')$$, '23514', null, 'D2: another provider is still refused');

select * from finish();
rollback;
