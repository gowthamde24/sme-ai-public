-- Job DM (owner decisions 25 Oct 2026): the EDUCATION pack hides lead finding (a school has admission enquiries, not leads to hunt), and no table holds marks or other children's results.
--   A the modules   B an agent that finds leads or researches businesses is refused   C no marks anywhere   D outcomes and the assistant settings name no child
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), 'education', max(version), 'operator' from packs.pack_versions where code = 'education'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('a'), 'textiles', max(version), 'operator' from packs.pack_versions where code = 'textiles'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;

-- ============================================================================ A. the modules
select is(app.module_enabled(tests.tid('b'), 'lead_finder'), false, 'A1 a school has no lead finder');
select is(app.module_enabled(tests.tid('b'), 'research'), false, 'A2 ...no business research');
select is(app.module_enabled(tests.tid('b'), 'companies'), false, 'A3 ...no companies list');
select is(app.module_enabled(tests.tid('a'), 'lead_finder') and app.module_enabled(tests.tid('a'), 'research'), true, 'A4 a textile shop has both (the pack decides, not the code)');
select is(app.module_enabled(tests.tid('b'), 'enquiries') and app.module_enabled(tests.tid('b'), 'fees') and app.module_enabled(tests.tid('b'), 'campaigns') and app.module_enabled(tests.tid('b'), 'voice_notes'), true, 'A5 what a school does stays on: admission enquiries, fee reminders from fee records, messages to parents, voice notes');

-- ============================================================================ B. the agent that finds and researches businesses is refused for a school
select is((select a.module from packs.agent_modules a where a.agent_name = 'research'), 'research', 'B1 the research agent belongs to the research module');
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
-- the guard (a BEFORE INSERT trigger) answers before any column is checked: a bare row is enough to see which door it is
select is(pg_temp.sc(format($q$insert into public.agent_runs (id, tenant_id, agent_name) values (gen_random_uuid(), %L, 'research')$q$, tests.tid('b'))), 'SM701', 'B2 a school cannot start the research agent (module_off)');
select isnt(pg_temp.sc(format($q$insert into public.agent_runs (id, tenant_id, agent_name) values (gen_random_uuid(), %L, 'research')$q$, tests.tid('a'))), 'SM701', 'B3 a textile shop is not stopped by the guard (the pack decides)');

-- ============================================================================ C. no marks anywhere
select is((select count(*)::int from information_schema.columns where table_schema in ('public', 'workspace', 'packs', 'voice', 'billing', 'integrations', 'privacy', 'notify', 'team')
             and column_name ~* '(^|_)(marks?|grade|grades|score|scores|percentage|attendance|rank|cgpa|gpa)($|_)' and table_name not in ('lead_labels', 'agent_runs', 'claims', 'claim_reviews')), 0, 'C1 no table has a column for marks, grades, scores, attendance or results (children''s results are not stored)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name ~* '(birth|dob|aadhaar|photo|address|religion|caste|income|health|marks|attendance|behaviour)'), 0, 'C2 the students table holds none of the things the model says are never stored');

-- ============================================================================ D. outcomes and the assistant settings name no child
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name in ('outcomes', 'assistant_settings') and column_name ~* '(student|child|pupil|ward|marks)'), 0, 'D1 neither table has a column that could name a child');

select * from finish();
rollback;
