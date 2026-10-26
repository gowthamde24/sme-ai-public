-- Night 4 extra, part E1 (migrations 20261209090000 to 20261209090200): Lead Desk is the core module of every business, schools keep their rules, the calls plans carry the Lead Desk names.
--   A the core module   B pack-specific modules stay default-deny   C the readers   D schools   E plans
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.pack(p_tenant text, p_code text) returns void language plpgsql as $$
begin
  update packs.workspace_pack set pack_code = p_code, pack_version = (select max(version) from packs.pack_versions where code = p_code) where tenant_id = tests.tid(p_tenant);
end $$;

-- ============================================================================ A. the core module
select is((select count(*) from packs.modules where code = 'lead_desk'), 1::bigint, 'A1 the module exists in the closed list');
select is((select guard || '/' || exists_today::text from packs.modules where code = 'lead_desk'), 'flag/false', 'A2 it is a flag module that no pack lists');
select is((select count(*) from packs.pack_modules where module = 'lead_desk'), 0::bigint, 'A3 no pack version lists it (pack versions stay immutable)');
create function pg_temp.on_for_every_pack() returns text language plpgsql as $$
declare
  c record;
  v_bad text := '';
begin
  for c in select distinct code from packs.pack_versions where status in ('preview', 'published') order by code loop
    perform pg_temp.pack('a', c.code);
    if not app.module_enabled(tests.tid('a'), 'lead_desk') then v_bad := v_bad || c.code || ' '; end if;
  end loop;
  return v_bad;
end $$;
select is(pg_temp.on_for_every_pack(), '', 'A4 Lead Desk is on for every pack: the three deep packs and every template business');
select cmp_ok((select count(distinct code) from packs.pack_versions where status in ('preview', 'published')), '>=', 12::bigint, 'A5 ... and there are at least twelve of them (not vacuous)');
select pg_temp.pack('a', 'textiles');
delete from packs.workspace_pack where tenant_id = tests.tid('b');
select is(app.module_enabled(tests.tid('b'), 'lead_desk'), false, 'A6 a business with no pack has nothing on (default deny stays)');
select is(app.module_enabled(tests.tid('a'), 'no_such_module'), false, 'A7 an unknown module is off');

-- ============================================================================ B. pack-specific modules stay default-deny
select is(app.module_enabled(tests.tid('a'), 'quotes'), true, 'B1 textiles still has quotes');
select pg_temp.pack('a', 'education');
select is(app.module_enabled(tests.tid('a'), 'quotes'), false, 'B2 a school still does not');
select is(app.module_enabled(tests.tid('a'), 'lead_finder'), false, 'B3 ... and still has no lead finding');
select is(app.module_enabled(tests.tid('a'), 'research'), false, 'B4 ... nor research');
select is(app.module_enabled(tests.tid('a'), 'lead_desk'), true, 'B5 but Lead Desk is on for it (admission enquiries)');

-- ============================================================================ C. the readers
select is(pg_temp.val('a_viewer', format($q$select m ->> 'reason' from jsonb_array_elements(public.workspace_modules(%L)) m where m ->> 'module' = 'lead_desk'$q$, tests.tid('a'))), 'core', 'C1 the modules list says lead_desk is on because it is core');
select is(pg_temp.val('a_viewer', format($q$select m ->> 'enabled' from jsonb_array_elements(public.workspace_modules(%L)) m where m ->> 'module' = 'lead_desk'$q$, tests.tid('a'))), 'true', 'C2 ... and enabled');
select is(pg_temp.val('a_viewer', format($q$select m ->> 'reason' from jsonb_array_elements(public.workspace_modules(%L)) m where m ->> 'module' = 'quotes'$q$, tests.tid('a'))), 'pack', 'C3 another module keeps the reason pack');
select is(pg_temp.val('a_viewer', format($q$select (public.workspace_pack_get(%L) -> 'modules') ? 'lead_desk'$q$, tests.tid('a'))), 'true', 'C4 the workspace''s pack lists lead_desk among its modules');
select pg_temp.pack('a', 'textiles');
select is(pg_temp.val('a_viewer', format($q$select (public.workspace_pack_get(%L) -> 'modules') ? 'lead_desk'$q$, tests.tid('a'))), 'true', 'C5 also for the default pack');
select is(pg_temp.val('b_owner', format($q$select public.workspace_modules(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C6 another business sees nothing');

-- ============================================================================ D. schools: no fees, marks or dues in Lead Desk
select pg_temp.pack('a', 'education');
select tests.open_gate('a');
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('s1'), tests.tid('a'), 'Demo Parent', '+00 000 000 7701');
select is(pg_temp.val('a_owner', format($q$select (public.outreach_batch_plan(%L, %L::jsonb) -> 'batch' ->> 'status')$q$, tests.tid('a'),
          jsonb_build_object('batch_id', tests.rid('sb1'), 'name', 'Admissions', 'goal', 'counselling', 'channel', 'call', 'language', 'en', 'who', jsonb_build_object('contact_ids', jsonb_build_array(tests.rid('s1'))), 'questions', jsonb_build_array('Which class is the child joining?'))::text)),
          'planned', 'D1 a school plans admission calls');
select is(pg_temp.val('a_owner', format($q$select public.outreach_batch_plan(%L, %L::jsonb)::text$q$, tests.tid('a'),
          jsonb_build_object('batch_id', tests.rid('sb2'), 'name', 'Dues', 'goal', 'counselling', 'channel', 'call', 'language', 'en', 'who', jsonb_build_object('contact_ids', jsonb_build_array(tests.rid('s1'))), 'questions', jsonb_build_array('Can you pay the pending fees of Rs 6,000 this week?'))::text)),
          'ERR:SM951', 'D2 a question about fees is refused');
select is(pg_temp.val('a_owner', format($q$select public.outreach_batch_plan(%L, %L::jsonb)::text$q$, tests.tid('a'),
          jsonb_build_object('batch_id', tests.rid('sb3'), 'name', 'Text', 'goal', 'counselling', 'channel', 'whatsapp', 'language', 'en', 'who', jsonb_build_object('contact_ids', jsonb_build_array(tests.rid('s1'))), 'message_text', 'Your fee of Rs 5,000 is due')::text)),
          'ERR:SM951', 'D3 so is a WhatsApp text with an amount');
select is(pg_temp.val('a_owner', format($q$select public.outreach_rule_save(%L, %L::jsonb)::text$q$, tests.tid('a'),
          jsonb_build_object('rule_id', tests.rid('sr1'), 'source', 'website_form', 'action', 'call_within_minutes', 'within_minutes', 2, 'goal', 'counselling', 'channel', 'call', 'language', 'en', 'questions', jsonb_build_array('Please pay the dues'))::text)),
          'ERR:SM951', 'D4 a standing rule that talks money is refused for a school');
select is(pg_temp.val('a_owner', format($q$select (public.outreach_rule_save(%L, %L::jsonb) ->> 'source')$q$, tests.tid('a'),
          jsonb_build_object('rule_id', tests.rid('sr2'), 'source', 'website_form', 'action', 'call_within_minutes', 'within_minutes', 2, 'goal', 'site_visit', 'channel', 'call', 'language', 'en', 'questions', jsonb_build_array('When can you visit the campus?'))::text)),
          'website_form', 'D5 a campus visit rule is fine');
select pg_temp.pack('a', 'textiles');
select is(pg_temp.val('a_owner', format($q$select (public.outreach_batch_plan(%L, %L::jsonb) -> 'batch' ->> 'status')$q$, tests.tid('a'),
          jsonb_build_object('batch_id', tests.rid('sb4'), 'name', 'Shop', 'goal', 'general', 'channel', 'call', 'language', 'en', 'who', jsonb_build_object('contact_ids', jsonb_build_array(tests.rid('s1'))), 'questions', jsonb_build_array('Can you pay Rs 5,000 for the saree?'))::text)),
          'planned', 'D6 a shop may talk about an amount (the owner approves the plan)');

-- ============================================================================ E. plans
select is((select string_agg(v.plan_id || '=' || (v.name ->> 'en'), ', ' order by v.sort) from billing.plan_versions v where v.catalogue_version = 3 and v.plan_id like 'calls\_%'),
          'calls_payg=Pay as you go, calls_300=Lead Desk 300, calls_1000=Lead Desk 1,000', 'E1 version 3 of the plans carries the Lead Desk names (ids unchanged)');
select is((select name ->> 'en' from billing.plan_versions where catalogue_version = 2 and plan_id = 'calls_300'), 'Calls 300', 'E2 version 2 is untouched (a synced version is never edited)');
select cmp_ok((select max(version) from billing.catalogue_versions), '>=', 3, 'E3 the catalogue is at version 3 or later');

select * from finish();
rollback;
