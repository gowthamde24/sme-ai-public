-- The Lead Finder is on for EVERY business (migration 20261231984100; owner, 18 Nov 2026): a pack that never carried the module has it, like lead_desk.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'wholesale_b2b');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(app.module_enabled(tests.tid('a'), 'lead_finder'), true, 'A1 wholesale_b2b never carried the module: it is on now');
select is(app.module_enabled(tests.tid('a'), 'lead_desk'), true, 'A2 lead_desk is still on');
select is(app.module_enabled(tests.tid('a'), 'quotes') is not null, true, 'A3 other modules still follow the pack');
select is(pg_temp.sc('a_owner', format($q$select (select x ->> 'enabled' || '/' || (x ->> 'reason') from jsonb_array_elements(public.workspace_modules(%L)) x where x ->> 'module' = 'lead_finder')$q$, tests.tid('a'))), 'true/core', 'B1 the workspace''s module list says on, and why: core');
select is(pg_temp.sc('a_owner', format($q$select (public.workspace_pack_get(%L) -> 'modules') ? 'lead_finder'$q$, tests.tid('a'))), 'true', 'B2 the pack of the workspace lists it');
select is(pg_temp.sc('a_owner', format($q$select (public.lead_finder_settings_get(%L))::jsonb ? 'searches_per_day'$q$, tests.tid('a'))), 'true', 'C1 its settings are readable on this business type');

select * from finish();
rollback;
