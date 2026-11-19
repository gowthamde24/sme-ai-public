-- Free early access: one Lead Finder search a month, raised per business by the operator (migration 20261231984800; planner decision, 19 Nov 2026).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.cp_pack('a', 'textiles');
select tests.cp_pack('b', 'textiles');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

-- A. a plan that carries the finder has no limit (whatever the source of the searches)
select is(app.lf_limit(tests.tid('a')), null, 'A1 a workspace on the default plan: no monthly limit');
select is(pg_temp.val('a_owner', format($q$select (public.lead_finder_allowance(%L) ->> 'per_month')$q$, tests.tid('a'))), null, 'A2 the allowance says null');
-- B. early access counts as a plan without it
update public.tenants set plan = 'early_access' where id = tests.tid('a');
select is(app.lf_limit(tests.tid('a')), 2, 'B1 early access: two searches a month (migration 985500)');
select is(pg_temp.val('a_owner', format($q$select public.lead_finder_allowance(%L)::text$q$, tests.tid('a'))), '{"left": 2, "used": 0, "entitled": false, "per_month": 2}', 'B2 the allowance: 2 left');
insert into public.prospect_searches (id, tenant_id, query, area, max_results, provider, sku, state, source_label, created_by, approved_at)
values (tests.rid('s1'), tests.tid('a'), 'saree shops', 'Jayanagar', 20, 'fixture', 'fixture', 'done', 'Made-up', tests.uid('a_owner'), now());
select is(pg_temp.val('a_owner', format($q$select (public.lead_finder_allowance(%L) ->> 'left')$q$, tests.tid('a'))), '1', 'B3 a FIXTURE search counts too: 1 left');
-- C. the operator raises one business's number
select is((select app.operator_set_lead_finder_limit(tests.tid('a'), 3))::text, '', 'C1 the operator sets 3 for this business');
select is(pg_temp.val('a_owner', format($q$select (public.lead_finder_allowance(%L) ->> 'left')$q$, tests.tid('a'))), '2', 'C2 two left');
select is(app.lf_limit(tests.tid('b')), null, 'C3 another business is untouched');
select app.operator_set_lead_finder_limit(tests.tid('a'), null);
select is(app.lf_limit(tests.tid('a')), 2, 'C4 taking the override away goes back to the plan''s number');
select is(pg_temp.val('a_owner', format($q$select app.operator_set_lead_finder_limit(%L, 5)::text$q$, tests.tid('a'))), 'ERR:42501', 'C5 a client cannot set it');
select * from finish();
rollback;
