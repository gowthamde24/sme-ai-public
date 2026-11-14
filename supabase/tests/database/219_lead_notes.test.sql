-- Migration 20261231850000: a free-text Notes field on a lead. The owner and the team set it with lead_profile_fix, the Lead Desk shows it, it is erased with the workspace.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

select is(pg_temp.val('a_sales', format($q$select (public.lead_profile_fix(%L, %L, '{"notes": "asked for a discount; prefers calls after 5 pm"}'::jsonb))::text$q$, tests.tid('a'), tests.rid('a_lead'))) like 'ERR:%', false, 'A1: a note is set through the profile fix');
select is((select notes from public.lead_profiles where lead_id = tests.rid('a_lead')), 'asked for a discount; prefers calls after 5 pm', 'A2: and stored');
select is(pg_temp.val('a_owner', format($q$select (public.lead_desk_get(%L, %L)::jsonb -> 'profile' ->> 'notes')$q$, tests.tid('a'), tests.rid('a_lead'))), 'asked for a discount; prefers calls after 5 pm', 'A3: the Lead Desk shows it on the lead');
select ok(pg_temp.val('a_sales', format($q$select public.lead_profile_fix(%L, %L, '{"notes": ""}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))) like 'ERR:%', 'A4: an empty note is refused (clear it with null)');
select ok(pg_temp.val('a_sales', format($q$select public.lead_profile_fix(%L, %L, jsonb_build_object('notes', repeat('x', 2001)))::text$q$, tests.tid('a'), tests.rid('a_lead'))) like 'ERR:%', 'A5: more than 2,000 characters is refused');
select is(pg_temp.val('b_owner', format($q$select public.lead_profile_fix(%L, %L, '{"notes": "x y"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'A6: another workspace cannot');
select is(pg_temp.val('a_viewer', format($q$select public.lead_profile_fix(%L, %L, '{"notes": "x y"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'A7: nor a Viewer');
select is(pg_temp.val('a_sales', format($q$select (public.lead_profile_fix(%L, %L, '{"notes": null}'::jsonb))::text$q$, tests.tid('a'), tests.rid('a_lead'))) like 'ERR:%', false, 'A8: a note is cleared with null');
select is((select count(*)::int from erasure.registry where table_name = 'lead_profiles' and column_name = 'notes'), 2, 'B1: the note leaves with the workspace and is swept when a person is forgotten (two registry rows)');
select * from finish();
rollback;
