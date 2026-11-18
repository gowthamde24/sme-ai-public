-- Plans as feature switches (migrations 20261230090000 + 20261230090100; owner decision 4 Nov 2026): AI Workforce = every feature, Lead Desk = every feature except the Lead Finder.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'textiles');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A: the catalogue in force names a product for every plan
select is((select v.version from billing.catalogue_versions v order by v.version desc limit 1), 4, 'A1 catalogue version 4 is the latest');
select is((select string_agg(p ->> 'id' || '=' || (p ->> 'product'), ',' order by (p ->> 'sort')::int) from billing.catalogue_versions v, jsonb_array_elements(v.manifest -> 'plans') p where v.version = 4),
          'free_trial=ai_workforce,starter=ai_workforce,growth=ai_workforce,business=ai_workforce,calls_payg=lead_desk,calls_300=lead_desk,calls_1000=lead_desk', 'A2 each plan names its product');

-- B: the switches
update public.tenants set plan = 'growth' where id = tests.tid('a');
select is(app.workspace_product(tests.tid('a')), 'ai_workforce', 'B1 Growth is AI Workforce');
select ok(app.entitled(tests.tid('a'), 'lead_finder') and app.entitled(tests.tid('a'), 'lead_desk'), 'B2 AI Workforce has every feature');
select ok(app.entitled(tests.tid('a'), 'reports'), 'B3 a feature no product names is on for every plan');
update public.tenants set plan = 'calls_300' where id = tests.tid('a');
select is(app.workspace_product(tests.tid('a')), 'lead_desk', 'B4 a calls plan is Lead Desk');
select ok(not app.entitled(tests.tid('a'), 'lead_finder') and app.entitled(tests.tid('a'), 'lead_desk'), 'B5 Lead Desk: every feature except the Lead Finder');

-- C: what the screens read (any member), and nobody else
select is(pg_temp.sc('a_viewer', format($q$select public.workspace_entitlements(%L) ->> 'product'$q$, tests.tid('a'))), 'lead_desk', 'C1 a Viewer reads the product');
select is(pg_temp.sc('a_owner', format($q$select (public.workspace_entitlements(%L) -> 'features')::text$q$, tests.tid('a'))), '{"lead_desk": true, "lead_finder": false}', 'C2 the switches');
select is(pg_temp.sc('a_owner', format($q$select public.workspace_entitlements(%L) -> 'upgrade' ->> 'product'$q$, tests.tid('a'))), 'ai_workforce', 'C3 the upgrade card names AI Workforce');
select is(pg_temp.sc('b_owner', format($q$select public.workspace_entitlements(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C4 another workspace: refused');

-- D: the Lead Finder's gate asks the switch after the module
select ok(pg_temp.sc('a_owner', format($q$select public.lead_finder_settings_get(%L)::text$q$, tests.tid('a'))) like '{%', 'D1 a Lead Desk workspace is not refused for its plan any more (owner, 18 Nov 2026: the Lead Finder is visible on every plan)');
update public.tenants set plan = 'business' where id = tests.tid('a');
select ok(pg_temp.sc('a_owner', format($q$select public.lead_finder_settings_get(%L)::text$q$, tests.tid('a'))) like '{%', 'D2 on AI Workforce it answers');
select is(pg_temp.sc('a_owner', format($q$select public.workspace_entitlements(%L) ->> 'upgrade'$q$, tests.tid('a'))), null, 'D3 nothing to upgrade to');

-- E: one free search a month where the plan does not carry the Lead Finder (India calendar month)
update public.tenants set plan = 'calls_300' where id = tests.tid('a');
select is(pg_temp.sc('a_owner', format($q$select (public.lead_finder_allowance(%L) - 'used')::text$q$, tests.tid('a'))), '{"left": 1, "entitled": false, "per_month": 1}', 'E1 Lead Desk: one free search a month, none used');
insert into public.prospect_searches (id, tenant_id, query, area, max_results, provider, sku, source_label, state, approved_at) values (tests.rid('s0'), tests.tid('a'), 'retailers', 'Jayanagar', 5, 'fixture', 'fixture', 'Made-up', 'planned', null);
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::jsonb ->> 'state'$q$, tests.tid('a'), tests.rid('s0'))), 'approved', 'E2 the first search of the month is approved');
select is(pg_temp.sc('a_owner', format($q$select (public.lead_finder_allowance(%L) ->> 'left')$q$, tests.tid('a'))), '0', 'E3 and the free search is used');
insert into public.prospect_searches (id, tenant_id, query, area, max_results, provider, sku, source_label, state) values (tests.rid('s1'), tests.tid('a'), 'retailers', 'Malleshwaram', 5, 'fixture', 'fixture', 'Made-up', 'planned');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:SM974', 'E4 a second search in the same month is refused (SM974: the free search is used)');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_get(%L, %L)::jsonb ->> 'state'$q$, tests.tid('a'), tests.rid('s0'))), 'approved', 'E5 the one already approved can still be read');
update public.prospect_searches set approved_at = now() - interval '45 days' where id = tests.rid('s0');
select is(pg_temp.sc('a_owner', format($q$select (public.lead_finder_allowance(%L) ->> 'left')$q$, tests.tid('a'))), '1', 'E6 a search of an earlier month does not count: the allowance is back');
update public.tenants set plan = 'business' where id = tests.tid('a');
select is(pg_temp.sc('a_owner', format($q$select public.lead_finder_allowance(%L)::text$q$, tests.tid('a'))) like '%"per_month": null%', true, 'E7 on AI Workforce there is no monthly limit (null)');
select is(pg_temp.sc('a_viewer', format($q$select public.lead_finder_allowance(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'E8 a Viewer cannot ask');
select is(pg_temp.sc('b_owner', format($q$select public.lead_finder_allowance(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'E9 nor another workspace');


select * from finish();
rollback;
