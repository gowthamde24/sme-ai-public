-- A switch per helper (migration 20261231170000): the Owner switches a helper off for the workspace and it can no longer run; an Admin reads; another workspace is untouched.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.open_gate('a');
update public.platform_flags set enabled = true where key in ('agents_enabled', 'research_enabled', 'requirement_enabled', 'assistant_enabled');
update public.agent_definitions set allowed_tenants = null where agent_name in ('assistant', 'research', 'requirement');
insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('a'), true), (tests.tid('b'), true) on conflict (tenant_id) do update set enabled = true;

create function pg_temp.q(p_user text, p_sql text, p_tenant text default 'a') returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid(p_tenant)));
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.q('a_owner', $q$select string_agg(x ->> 'agent' || '=' || (x ->> 'enabled'), ',' order by x ->> 'agent') from jsonb_array_elements(public.agent_switches_get(%L)) x$q$), 'assistant=true,requirement=true,research=true', 'A1 every helper is on until switched');
select is(app.agent_switches_on(tests.tid('a'), 'research'), true, 'A2 the researcher may run');
select is(pg_temp.q('a_owner', $q$select public.agent_switch_set(%L, 'research', false) ->> 'enabled'$q$), 'false', 'B1 the Owner switches the researcher off');
select is(app.agent_switches_on(tests.tid('a'), 'research'), false, 'B2 ... and it can no longer run (enforced where every run starts)');
select is(app.agent_switches_on(tests.tid('b'), 'research'), true, 'B3 another workspace is untouched');
select is(app.agent_switches_on(tests.tid('a'), 'assistant'), true, 'B4 the other helpers still run');
select is(pg_temp.q('a_admin', $q$select public.agent_switch_set(%L, 'research', true) ->> 'enabled'$q$), 'ERR:42501', 'C1 an Admin does not switch');
select is(pg_temp.q('a_admin', $q$select (select x ->> 'enabled' from jsonb_array_elements(public.agent_switches_get(%L)) x where x ->> 'agent' = 'research')$q$), 'false', 'C2 ... but reads it');
select is(pg_temp.q('a_sales', $q$select public.agent_switches_get(%L)::text$q$), 'ERR:42501', 'C3 Sales does not read');
select is(pg_temp.q('a_owner', $q$select public.agent_switch_set(%L, 'selftest', false)::text$q$), 'ERR:22023', 'C4 only the helpers on the list');
update public.tenant_agent_settings set enabled = false where tenant_id = tests.tid('a');
select is(pg_temp.q('a_owner', $q$select (select x ->> 'reason_locked' from jsonb_array_elements(public.agent_switches_get(%L)) x where x ->> 'agent' = 'assistant')$q$), 'workspace_off', 'D1 the workspace switch off: said as the reason');
update public.platform_flags set enabled = false where key = 'agents_enabled';
select is(pg_temp.q('a_owner', $q$select (select (x ->> 'can_switch') || '/' || (x ->> 'reason_locked') from jsonb_array_elements(public.agent_switches_get(%L)) x where x ->> 'agent' = 'assistant')$q$), 'false/platform', 'D2 the platform off: not switchable');

select * from finish();
rollback;
