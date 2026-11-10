-- Job 3 phase B: the two reads of the outbound path.  A grants  B phone_line_for_tenant  C phone_call_state
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.sch(p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid('outsider'), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.phone_numbers (id, tenant_id, number, label, inbound_on, provider) values
  (tests.rid('ex'), tests.tid('a'), '+914045903172', 'Exotel line', true, 'exotel'),
  (tests.rid('pl'), tests.tid('a'), '+918065590129', 'Plivo line', true, 'plivo'),
  (tests.rid('plb'), tests.tid('b'), '+918065590130', 'Plivo line of B', true, 'plivo');
insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, created_at) values
  (tests.rid('c1'), tests.tid('a'), 'outbound', 'plivo', true, 'visit_reminder', 'te', true, 'ringing', now());

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('phone_line_for_tenant', 'phone_call_state')
  and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 2::bigint, 'A1: two security-definer functions with a fixed search path, for signed-in people only');

select is(pg_temp.q('a_owner', format($q$select public.phone_line_for_tenant(%L, 'plivo')::jsonb ->> 'number'$q$, tests.tid('a'))), '+918065590129', 'B1: the Owner learns the business''s Plivo line');
select is(pg_temp.q('a_admin', format($q$select public.phone_line_for_tenant(%L, 'exotel')::jsonb ->> 'number'$q$, tests.tid('a'))), '+914045903172', 'B2: an Admin too, and each provider has its own line');
select is(pg_temp.sch(format($q$select public.phone_line_for_tenant(%L, 'plivo')::jsonb ->> 'number'$q$, tests.tid('a'))), '+918065590129', 'B3: the phone server may ask for any business''s line');
select is(pg_temp.q('a_sales', format($q$select public.phone_line_for_tenant(%L, 'plivo')::text$q$, tests.tid('a'))), 'ERR:42501', 'B4: Sales does not');
select is(pg_temp.q('b_owner', format($q$select public.phone_line_for_tenant(%L, 'plivo')::text$q$, tests.tid('a'))), 'ERR:42501', 'B5: nor another business''s Owner');
select is(pg_temp.q('anon', format($q$select public.phone_line_for_tenant(%L, 'plivo')::text$q$, tests.tid('a'))), 'ERR:42501', 'B6: nor anon');
select is(pg_temp.q('a_owner', format($q$select public.phone_line_for_tenant(%L, 'twilio')::text$q$, tests.tid('a'))), 'ERR:22023', 'B7: a provider that is not one of ours is refused');
select is(pg_temp.q('a_owner', format($q$select public.phone_line_for_tenant(%L, 'vobiz')$q$, tests.tid('a'))), null, 'B8: no line with that provider is null');

select is(pg_temp.sch(format($q$select public.phone_call_state(%L, %L)::jsonb ->> 'state'$q$, tests.tid('a'), tests.rid('c1'))), 'ringing', 'C1: the phone server reads the state of a call');
select is(pg_temp.q('a_sales', format($q$select public.phone_call_state(%L, %L)::jsonb ->> 'direction'$q$, tests.tid('a'), tests.rid('c1'))), 'outbound', 'C2: Sales too');
select is(pg_temp.q('a_viewer', format($q$select public.phone_call_state(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))), 'ERR:42501', 'C3: a Viewer does not');
select is(pg_temp.q('b_owner', format($q$select public.phone_call_state(%L, %L)::text$q$, tests.tid('a'), tests.rid('c1'))), 'ERR:42501', 'C4: nor another business');
select is(pg_temp.sch(format($q$select public.phone_call_state(%L, %L)$q$, tests.tid('b'), tests.rid('c1'))), null, 'C5: a call of another business is simply not there');
select is(pg_temp.sch(format($q$select (public.phone_call_state(%L, %L)::jsonb) ?| array['transcript', 'summary', 'contact_id', 'contact_phone', 'contact_name']$q$, tests.tid('a'), tests.rid('c1'))), 'false', 'C6: no transcript, summary or contact in it');

select * from finish();
rollback;
