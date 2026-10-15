-- Job CR (ADR 0087), part 1: THE EDUCATION CORE. The institution profile, programmes and their groups, the MINIMAL student record (children's data), the generic enquiry path that needs no companies module,
-- erasure (a guardian takes their children with them; one child on request) and the retention rule.
--   A structure, grants, RLS, module    B the profile    C programmes and groups    D students: who, what is refused, replay, the doors    E listing and status    F the generic enquiry path
--   G erasure    H retention    I guards and audit
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'education');
select tests.open_gate('a');
select tests.open_gate('b');

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.vala(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;

-- the day is pinned: Wednesday 14 October 2026
create or replace function app.dues_today() returns date language sql stable set search_path = '' as $$ select date '2026-10-14' $$;
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);

create function pg_temp.prog(p_user text, p_id text, p_name text, p_kind text default 'class', p_gk text default 'section', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.programme_save(%L, %L, %L, %L, %L, true)$q$, tests.rid(p_id), tests.tid(p_tenant), p_name, p_kind, p_gk))
$$;
create function pg_temp.grp(p_user text, p_id text, p_prog text, p_label text, p_timing text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.programme_group_save(%L, %L, %L, %L, %L, true)$q$, tests.rid(p_id), tests.tid('a'), tests.rid(p_prog), p_label, p_timing))
$$;
create function pg_temp.stu(p_user text, p_id text, p_contact text, p_adult boolean, p_label text, p_prog text, p_group text default null, p_adm text default null, p_guardian text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.student_save(%L, %L, %L, %L::boolean, %L, %L, %L, %L, %L)$q$, tests.rid(p_id), tests.tid('a'), tests.rid(p_contact), p_adult, p_label, tests.rid(p_prog),
                                    case when p_group is null then null else tests.rid(p_group)::text end, p_adm, case when p_guardian is null then null else tests.rid(p_guardian)::text end))
$$;

-- ============================================================================ A. structure, grants, RLS, module
select is((select count(*) from pg_class where relname in ('institution_profiles', 'programmes', 'programme_groups', 'students') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 4::bigint, 'A1 RLS is enabled and forced on the four tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('institution_profiles', 'programmes', 'programme_groups', 'students') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only read them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('institution_profiles', 'programmes', 'programme_groups', 'students') and grantee in ('anon', 'public', 'service_role')), 0::bigint, 'A3 anon, PUBLIC and the service role hold nothing');
select is((select string_agg(guard, ',' order by code) from packs.modules where code in ('programmes', 'fees')), 'tables,tables', 'A4 the modules `programmes` and `fees` own tables now (guard kind tables)');
select is(pg_temp.prog('b_owner', 'xp', 'Class 1', 'class', 'section', 'b'), 'SM701', 'A5 textiles: programmes are not on (SM701)');
select is(pg_temp.val('b_owner', format($q$select public.institution_profile_get(%L)::text$q$, tests.tid('b'))), 'ERR:SM701', 'A6 nor the profile');
select is(pg_temp.try('a_owner', format($q$insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values (gen_random_uuid(), %L, 'Direct', 'class', 'none', %L)$q$, tests.tid('a'), tests.uid('a_owner'))), '42501', 'A7 DENY: a client cannot write a programme directly');
select is(pg_temp.try('a_owner', format($q$insert into public.students (id, tenant_id, contact_id, programme_id, child_label, created_by) values (gen_random_uuid(), %L, %L, gen_random_uuid(), 'Direct', %L)$q$, tests.tid('a'), tests.rid('a_contact'), tests.uid('a_owner'))), '42501', 'A8 DENY: nor a student');
select is(pg_temp.try('anon', format($q$select public.programmes_list(%L)$q$, tests.tid('a'))), '42501', 'A9 DENY: anon');

-- ============================================================================ B. the profile
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_get(%L)::text$q$, tests.tid('a'))), '{"configured": false}', 'B1 a school with no profile yet says so');
select is(pg_temp.val('a_admin', format($q$select (public.institution_profile_set(%L, 'school', 6, '[{"label": "Term 1", "start_month": 6, "end_month": 9}, {"label": "Term 2", "start_month": 10, "end_month": 3}]'::jsonb, array['en', 'te']) ->> 'institution_type')$q$, tests.tid('a'))), 'school', 'B2 ALLOW: an Admin sets the profile');
select is(pg_temp.val('a_sales', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:42501', 'B3 DENY: Sales');
select is(pg_temp.val('a_viewer', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:42501', 'B4 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:42501', 'B5 DENY: another business');
select is(pg_temp.val('a_viewer', format($q$select (public.institution_profile_get(%L) ->> 'year_start_month')$q$, tests.tid('a'))), '6', 'B6 every member reads it');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.institution_profile_get(%L) -> 'terms')::text$q$, tests.tid('a'))), '2', 'B7 two terms');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'primary', 6, '[]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B8 a type outside the list is invalid');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 13, '[]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B9 the year starts in month 1 to 12');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[{"label": "T", "start_month": 6, "end_month": 9, "x": 1}]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B10 a term holds a label and two months, nothing else');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[{"label": "T", "start_month": 6, "end_month": 13}]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B11 months 1 to 12');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en', 'xx'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B12 a language outside en, te, hi, kn, ta is invalid');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, '{}'::text[])::text$q$, tests.tid('a'))), 'ERR:22023', 'B13 at least one language');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, jsonb_build_array(1,2,3,4,5,6,7), array['en'])::text$q$, tests.tid('a'))), 'ERR:22023', 'B14 at most six terms');
select is(pg_temp.vala('aal1', 'a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'], 24)::text$q$, tests.tid('a'))), 'ERR:SM306', 'B15 a retention rule needs a second factor');
select is(pg_temp.val('a_admin', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'], 24)::text$q$, tests.tid('a'))), 'ERR:42501', 'B16 ... and is the Owner''s alone');
select is(pg_temp.val('a_owner', format($q$select (public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'], 24) ->> 'student_retention_months')$q$, tests.tid('a'))), '24', 'B17 ALLOW: the Owner sets it (24 months)');
select is(pg_temp.val('a_owner', format($q$select public.institution_profile_set(%L, 'school', 6, '[]'::jsonb, array['en'], 0)::text$q$, tests.tid('a'))), 'ERR:22023', 'B18 a retention of 0 months is invalid');
select is(pg_temp.val('a_admin', format($q$select (public.institution_profile_set(%L, 'school', 4, '[]'::jsonb, array['en', 'hi'], 24) ->> 'year_start_month')$q$, tests.tid('a'))), '4', 'B19 an Admin may change the rest while the retention months stay as they are');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'institution_profile'), 3::bigint, 'B20 the profile''s creation and its two changes are in the audit trail');

-- ============================================================================ C. programmes and groups
select is(pg_temp.prog('a_owner', 'p5', 'Class 5'), 'ok', 'C1 ALLOW: the Owner makes a class set');
select is(pg_temp.prog('a_admin', 'pbcom', 'B.Com', 'course', 'year'), 'ok', 'C2 ALLOW: the Admin makes a course with years');
select is(pg_temp.prog('a_admin', 'pbatch', 'IIT coaching', 'course', 'batch'), 'ok', 'C3 ... and a coaching course with batches');
select is(pg_temp.prog('a_admin', 'pnone', 'Short course', 'course', 'none'), 'ok', 'C4 ... and one without groups');
select is(pg_temp.prog('a_sales', 'px', 'Class 6'), '42501', 'C5 DENY: Sales');
select is(pg_temp.prog('a_viewer', 'px', 'Class 6'), '42501', 'C6 DENY: a Viewer');
select is(pg_temp.prog('b_owner', 'px', 'Class 6'), '42501', 'C7 DENY: another business');
select is(pg_temp.prog('a_owner', 'p5', 'Class 5'), 'ok', 'C8 an exact repeat replays');
select is(pg_temp.prog('a_owner', 'px', 'class 5'), '23505', 'C9 a second programme with the same name (any case) is a conflict');
select is(pg_temp.prog('a_owner', 'p5', 'Class 5', 'course'), '23505', 'C10 the kind of a programme never changes (conflict)');
select is(pg_temp.prog('a_owner', 'px', ''), '22023', 'C11 a name is required');
select is(pg_temp.prog('a_owner', 'px', 'Call 9876543210 school'), '22023', 'C12 a name with a phone number is refused');
select is(pg_temp.prog('a_owner', 'px', 'Hall', 'room', 'section'), '22023', 'C13 a kind outside class and course is invalid');
select is(pg_temp.grp('a_owner', 'g5a', 'p5', 'A'), 'ok', 'C14 ALLOW: section A of Class 5');
select is(pg_temp.grp('a_owner', 'g5b', 'p5', 'B'), 'ok', 'C15 ... and B');
select is(pg_temp.grp('a_owner', 'gy1', 'pbcom', 'Year 1'), 'ok', 'C16 Year 1 of B.Com');
select is(pg_temp.grp('a_owner', 'gb6', 'pbatch', '6 am batch', '6 to 8 am'), 'ok', 'C17 a batch has a timing');
select is(pg_temp.grp('a_owner', 'gx', 'p5', 'C', '6 to 8 am'), '22023', 'C18 only a batch has a timing');
select is(pg_temp.grp('a_owner', 'gx', 'pnone', 'Whole'), '22023', 'C19 a programme without groups has none');
select is(pg_temp.grp('a_owner', 'gx', 'p5', 'a'), '23505', 'C20 a group label is unique in its programme (any case)');
select is(pg_temp.grp('a_sales', 'gx', 'p5', 'C'), '42501', 'C21 DENY: Sales');
select is(pg_temp.try('a_owner', format($q$select public.programme_group_save(%L, %L, %L, 'C', null, true)$q$, tests.rid('gx'), tests.tid('a'), gen_random_uuid())), '23503', 'C22 a programme that does not exist is not found');
select is(pg_temp.grp('a_owner', 'g5a', 'pbcom', 'A'), '23505', 'C23 a group id used under another programme is a conflict');
select is(pg_temp.val('a_viewer', format($q$select jsonb_array_length(public.programmes_list(%L))::text$q$, tests.tid('a'))), '4', 'C24 every member reads the programmes (4)');
select is(pg_temp.val('a_viewer', format($q$select jsonb_array_length((select e -> 'groups' from jsonb_array_elements(public.programmes_list(%L)) e where e ->> 'name' = 'Class 5'))::text$q$, tests.tid('a'))), '2', 'C25 ... with their groups (Class 5 has two)');
select is(pg_temp.try('a_owner', format($q$update public.programmes set name = 'Edited' where id = %L$q$, tests.rid('p5'))), '42501', 'C26 DENY: a client cannot edit one directly');
select is(pg_temp.sc(format($q$update public.programmes set name = 'Edited' where id = %L$q$, tests.rid('p5'))), '42501', 'C27 nor can a privileged session: the rows change only through their functions');
select is(pg_temp.sc($q$delete from public.programmes$q$), '42501', 'C28 and a programme is never deleted');

-- ============================================================================ D. students
select is((select tests.rid('guard1') is not null), true, 'D0 (setup)');
insert into public.contacts (id, tenant_id, full_name, phone) values
  (tests.rid('guard1'), tests.tid('a'), 'Rao Parent', '+00 90010 00001'),
  (tests.rid('guard2'), tests.tid('a'), 'Reddy Parent', '+00 90010 00002'),
  (tests.rid('adult1'), tests.tid('a'), 'Meena Adult', '+00 90010 00003');
select is(pg_temp.stu('a_owner', 's1', 'guard1', false, 'Asha', 'p5', 'g5a', 'ADM-001'), 'ok', 'D1 ALLOW: the Owner admits a child (a first name, a section, an admission number)');
select is(pg_temp.stu('a_admin', 's2', 'guard1', false, 'Bala', 'p5', 'g5b', 'ADM-002'), 'ok', 'D2 ALLOW: the Admin admits a second child of the same guardian');
select is(pg_temp.stu('a_owner', 's3', 'adult1', true, null, 'pbcom', 'gy1'), 'ok', 'D3 an adult student IS the contact (no label)');
select is(pg_temp.stu('a_owner', 's4', 'guard2', false, 'Chitra K', 'pnone', null), 'ok', 'D4 initials after a first name are allowed; a programme without groups needs none');
select is(pg_temp.stu('a_sales', 'sx', 'guard1', false, 'Dev', 'p5'), '42501', 'D5 DENY: Sales do not write students');
select is(pg_temp.stu('a_viewer', 'sx', 'guard1', false, 'Dev', 'p5'), '42501', 'D6 DENY: a Viewer');
select is(pg_temp.stu('b_owner', 'sx', 'guard1', false, 'Dev', 'p5'), '42501', 'D7 DENY: another business');
select is(pg_temp.stu('a_owner', 'sx', 'guard1', false, 'Dev 5', 'p5'), '22023', 'D8 a label with a digit is refused (it is a name, not a class or a roll number)');
select is(pg_temp.stu('a_owner', 'sx', 'guard1', false, 'dev@school', 'p5'), '22023', 'D9 nor an e-mail address');
select is(pg_temp.stu('a_owner', 'sx', 'guard1', false, 'Call me', 'p5', null, null), 'ok', 'D10 (a plain word is a name as far as the database can tell)');
select is(pg_temp.stu('a_owner', 'sy', 'guard1', false, null, 'p5'), '22023', 'D11 a child needs a label');
select is(pg_temp.stu('a_owner', 'sy', 'adult1', true, 'Meena', 'pbcom'), '22023', 'D12 an adult student has none');
select is(pg_temp.stu('a_owner', 'sy', 'guard1', false, 'Dev', 'p5', null, null, 'guard2'), '22023', 'D13 only an adult student has a separate guardian');
select is(pg_temp.stu('a_owner', 's3', 'adult1', true, null, 'pbcom', 'gy1', null, 'guard2'), 'ok', 'D14 an adult student may have a guardian contact too');
select is(pg_temp.stu('a_owner', 'sy', 'guard1', false, 'Dev', 'p5', 'gy1'), '23503', 'D15 a group of another programme is not found');
select is(pg_temp.stu('a_owner', 'sy', 'guard1', false, 'Dev', 'pnone', 'g5a'), '23503', 'D16 nor a group of a programme the student is not in');
select is(pg_temp.stu('a_owner', 'sy', 'b_contact', false, 'Dev', 'p5'), '23503', 'D17 a contact of another business is not found');
select is(pg_temp.stu('a_owner', 'sy', 'guard1', false, 'Dev', 'p5', null, 'adm-001'), 'SM811', 'D18 an admission number is unique in the school (any case): SM811');
select is(pg_temp.stu('a_owner', 'sy', 'guard1', false, 'Dev', 'p5', null, 'ADM 9'), '22023', 'D19 an admission number is letters, digits and / . _ -');
select is(pg_temp.stu('a_owner', 's1', 'guard1', false, 'Asha', 'p5', 'g5a', 'ADM-001'), 'ok', 'D20 an exact repeat replays');
select is(pg_temp.stu('a_owner', 's1', 'guard2', false, 'Asha', 'p5', 'g5a', 'ADM-001'), '23505', 'D21 the contact of a student never changes (conflict)');
select is(pg_temp.stu('a_owner', 's1', 'guard1', true, null, 'p5', 'g5a', 'ADM-001'), '23505', 'D22 nor does the kind');
select is(pg_temp.val('a_owner', format($q$select (public.student_save(%L, %L, %L, false, 'Asha', %L, %L, 'ADM-001') ->> 'created')$q$, tests.rid('s1'), tests.tid('a'), tests.rid('guard1'), tests.rid('p5'), tests.rid('g5b'))), 'false', 'D23 the placement can change (moved to section B)');
select is((select group_id from public.students where id = tests.rid('s1')), tests.rid('g5b'), 'D24 ... and it did');
select is(pg_temp.try('a_owner', format($q$update public.students set child_label = 'Edited' where id = %L$q$, tests.rid('s1'))), '42501', 'D25 DENY: a client cannot edit a student directly');
select is(pg_temp.sc(format($q$update public.students set child_label = 'Edited' where id = %L$q$, tests.rid('s1'))), '42501', 'D26 nor a privileged session outside the functions');
select is(pg_temp.sc(format($q$update public.students set contact_id = %L where id = %L$q$, tests.rid('guard2'), tests.rid('s1'))), '42501', 'D27 a student cannot be handed to another contact');
select is(pg_temp.sc($q$delete from public.students$q$), '42501', 'D28 a student is never deleted (mark as left)');
select is(pg_temp.val('a_sales', format($q$select (public.student_get(%L, %L) ->> 'display_name')$q$, tests.tid('a'), tests.rid('s1'))), 'Asha', 'D29 Sales read a child''s label (the front desk needs it)');
select is(pg_temp.val('a_viewer', format($q$select public.student_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'D30 a Viewer sees no child');
select is(pg_temp.val('a_viewer', format($q$select count(*)::text from public.students where tenant_id = %L$q$, tests.tid('a'))), '0', 'D31 ... not even through the table');
select is(pg_temp.val('a_sales', format($q$select count(*)::text from public.students where tenant_id = %L$q$, tests.tid('a'))), '5', 'D32 Sales read the five students through the table');
select is(pg_temp.val('b_owner', format($q$select count(*)::text from public.students where tenant_id = %L$q$, tests.tid('a'))), '0', 'D33 another business sees none');
select is(pg_temp.val('a_owner', format($q$select (public.student_get(%L, %L) ->> 'display_name')$q$, tests.tid('a'), tests.rid('s3'))), 'Meena Adult', 'D34 an adult student shows the contact''s own name');
select is(pg_temp.val('a_owner', format($q$select public.student_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('s1'))), 'ERR:42501', 'D35 another business''s id with my tenant is refused');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'student' and (new_values::text like '%Asha%' or new_values::text like '%ADM-00%' or old_values::text like '%Asha%')), 0::bigint, 'D36 the audit trail never holds a child''s label or admission number (audited by name only)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'student'), 8::bigint, 'D37 ... but it does say that students were made and changed (5 made, 3 saved again)');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'students'
            and column_name ~* '(birth|dob|photo|address|aadhaar|health|religion|caste|income|marks|attendance|behaviour|behavior|note|remark|phone|email|handle)'), null, 'D38 there is no column for a date of birth, a photograph, an address, an identity number, health, religion, caste, income, marks, attendance, behaviour, a note, a phone number, an e-mail address or a handle');

-- ============================================================================ E. listing and status
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L))::text$q$, tests.tid('a'))), '5', 'E1 the school lists its five students (the two of guard1, the adult, Chitra and Call me)');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L, %L))::text$q$, tests.tid('a'), tests.rid('p5'))), '3', 'E2 filtered by programme');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L, null, %L))::text$q$, tests.tid('a'), tests.rid('g5b'))), '2', 'E3 filtered by section');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L, null, null, null, %L))::text$q$, tests.tid('a'), tests.rid('guard1'))), '3', 'E4 filtered by guardian');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L, null, null, null, null, 2))::text$q$, tests.tid('a'))), '2', 'E5 a page of two');
select is(pg_temp.val('a_owner', format($q$select public.students_list(%L, null, null, null, null, 0)::text$q$, tests.tid('a'))), 'ERR:22023', 'E6 a page of none is invalid');
select is(pg_temp.val('a_viewer', format($q$select public.students_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'E7 DENY: a Viewer');
select is(pg_temp.val('a_owner', format($q$select (public.student_set_status(%L, %L, 'left', date '2026-09-30') ->> 'status')$q$, tests.tid('a'), tests.rid('s2'))), 'left', 'E8 ALLOW: a student leaves (with the day they left)');
select is(pg_temp.val('a_owner', format($q$select public.student_set_status(%L, %L, 'left')::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:22023', 'E9 a student who left has the day');
select is(pg_temp.val('a_owner', format($q$select public.student_set_status(%L, %L, 'active', date '2026-09-30')::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:22023', 'E10 one who is active has none');
select is(pg_temp.val('a_owner', format($q$select public.student_set_status(%L, %L, 'left', date '2030-01-01')::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:22023', 'E11 nor a day in the future');
select is(pg_temp.val('a_sales', format($q$select public.student_set_status(%L, %L, 'left', date '2026-09-30')::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'E12 DENY: Sales');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L, null, null, 'left'))::text$q$, tests.tid('a'))), '1', 'E13 one student has left');
select is(pg_temp.val('a_owner', format($q$select (e ->> 'students') from jsonb_array_elements(public.programmes_list(%L)) e where e ->> 'name' = 'Class 5'$q$, tests.tid('a'))), '2', 'E14 the programme counts only the students who are still there (2 of 3)');
select is(pg_temp.val('a_owner', format($q$select (public.student_set_status(%L, %L, 'active') ->> 'status')$q$, tests.tid('a'), tests.rid('s2'))), 'active', 'E15 and a student can come back');

-- ============================================================================ F. the generic enquiry path (no companies module)
select is(app.module_enabled(tests.tid('a'), 'companies'), false, 'F1 (setup) the school has no companies module');
select is(pg_temp.sc(format($q$insert into public.companies (id, tenant_id, name) values (gen_random_uuid(), %L, 'A normal company')$q$, tests.tid('a'))), 'SM701', 'F2 a company is still refused in a school (SM701)');
select is(pg_temp.sc(format($q$insert into public.companies (id, tenant_id, name, created_via) values (gen_random_uuid(), %L, 'Enquiry abcdef', 'manual')$q$, tests.tid('a'))), 'SM701', 'F3 ... also one that only looks like a placeholder (it must come from trusted code)');
select is((select app.contact_lead(tests.tid('a'), tests.rid('guard1'), 'test') is not null), true, 'F4 a guardian with no company gets a lead (job CP could not reach them before)');
select is((select name ~ '^Enquiry [0-9a-f]{6}$' from public.companies where id = (select company_id from public.contacts where id = tests.rid('guard1'))), true, 'F5 through a generic placeholder company that holds no personal data');
select is((select app.contact_lead(tests.tid('a'), tests.rid('guard1'), 'test')), (select id from public.leads where contact_id = tests.rid('guard1') order by created_at limit 1), 'F6 asked again it gives the same lead');
select is((select count(*) from public.leads where contact_id = tests.rid('guard1')), 1::bigint, 'F7 and makes no second one');
select is((select app.contact_lead(tests.tid('a'), gen_random_uuid(), 'test')), null, 'F8 an unknown contact has none');
select is((select app.contact_lead(tests.tid('b'), tests.rid('guard1'), 'test')), null, 'F9 nor does another business''s');
select is((select app.campaign_lead_for(tests.tid('a'), tests.rid('guard2')) is not null), true, 'F10 job CP''s campaign helper uses it: a second guardian can be sent a reminder');
select is((select count(*) from public.companies where tenant_id = tests.tid('a') and name ~ '^Enquiry '), 2::bigint, 'F11 two placeholder companies in all (one per guardian)');

-- ============================================================================ G. erasure
select tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, jsonb_build_object('version', 1, 'phone', %L))$q$, tests.rid('guard2'), md5('g2a') || md5('g2b')));
select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('er1'), tests.tid('a'), tests.rid('guard2')));
select is(pg_temp.val('a_owner', format($q$select (public.execute_erasure(%L, false) ->> 'status')$q$, tests.rid('er1'))), 'executed', 'G1 the Owner erases a guardian');
select results_eq(format($$select child_label, admission_no, erased_at is not null, status from public.students where id = %L$$, tests.rid('s4')),
  $$values ('erased:1'::text, null::text, true, 'active'::text)$$, 'G2 their child''s label is tombstoned, the admission number is gone, and the record is marked erased');
select is((select count(*) from public.students where contact_id = tests.rid('guard2') and erased_at is null), 0::bigint, 'G3 none of their students is left');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.students_list(%L, null, null, null, %L))::text$q$, tests.tid('a'), tests.rid('guard2'))), '1', 'G4 an erased student is not listed (only the adult student whose separate guardian they were remains)');
select is(pg_temp.val('a_owner', format($q$select (public.student_get(%L, %L) ->> 'display_name') is null$q$, tests.tid('a'), tests.rid('s4'))), 'true', 'G5 and shows no name');
select is(pg_temp.stu('a_owner', 's4', 'guard2', false, 'Chitra K', 'pnone', null), '23503', 'G6 an erased contact cannot be given a student');
select is((select count(*) from public.students where contact_id = tests.rid('guard1') and erased_at is null), 3::bigint, 'G7 another guardian''s children are untouched');
select is(pg_temp.sc(format($q$update public.students set status = 'left', left_on = date '2026-10-01' where id = %L$q$, tests.rid('s4'))), '42501', 'G8 an erased student never changes again');
-- one child on request
select is(pg_temp.vala('aal1', 'a_owner', format($q$select public.student_erase(%L, %L)::text$q$, tests.tid('a'), tests.rid('s2'))), 'ERR:SM306', 'G9 erasing one child needs a second factor');
select is(pg_temp.val('a_admin', format($q$select public.student_erase(%L, %L)::text$q$, tests.tid('a'), tests.rid('s2'))), 'ERR:42501', 'G10 DENY: an Admin (it is the Owner''s)');
select is(pg_temp.val('a_owner', format($q$select (public.student_erase(%L, %L) ->> 'erased')$q$, tests.tid('a'), tests.rid('s2'))), 'true', 'G11 ALLOW: the Owner erases one child');
select results_eq(format($$select child_label, admission_no, erased_at is not null from public.students where id = %L$$, tests.rid('s2')), $$values ('erased:1'::text, null::text, true)$$, 'G12 their label and number are gone');
select is((select count(*) from public.students where id = tests.rid('s1') and child_label = 'Asha' and erased_at is null), 1::bigint, 'G13 their sibling is untouched');
select is(pg_temp.val('a_owner', format($q$select (public.student_erase(%L, %L) ->> 'replayed')$q$, tests.tid('a'), tests.rid('s2'))), 'true', 'G14 asking again changes nothing');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'student.erase'), 1::bigint, 'G15 the erasure is in the audit trail, without the label');

-- ============================================================================ H. retention
select pg_temp.stu('a_owner', 'sr1', 'adult1', false, 'Old one', 'p5', null, 'ADM-OLD1');
select pg_temp.stu('a_owner', 'sr2', 'adult1', false, 'Recent', 'p5', null, 'ADM-NEW1');
select pg_temp.stu('a_owner', 'sr3', 'adult1', false, 'Active', 'p5', null, 'ADM-ACT1');
select pg_temp.val('a_owner', format($q$select public.student_set_status(%L, %L, 'left', date '2024-08-01')::text$q$, tests.tid('a'), tests.rid('sr1')));
select pg_temp.val('a_owner', format($q$select public.student_set_status(%L, %L, 'left', date '2026-06-01')::text$q$, tests.tid('a'), tests.rid('sr2')));
select is(app.operator_register_scheduler('outsider@test.local'), tests.uid('outsider'), 'H1 (setup) the scheduler account is registered');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_students_retention()::text$q$)), 'ERR:42501', 'H2 DENY: only the scheduler runs the retention clean-up');
select is(pg_temp.val('outsider', $q$select (public.scheduler_students_retention() ->> 'erased')$q$), '1', 'H3 ALLOW: the scheduler erases the one student who left more than 24 months ago');
select results_eq(format($$select child_label, admission_no, erased_at is not null from public.students where id = %L$$, tests.rid('sr1')), $$values ('erased:1'::text, null::text, true)$$, 'H4 their label and number are gone');
select is((select count(*) from public.students where id in (tests.rid('sr2'), tests.rid('sr3')) and erased_at is null), 2::bigint, 'H5 a student who left 4 months ago and one who is still there are kept');
select is(pg_temp.val('outsider', $q$select (public.scheduler_students_retention() ->> 'erased')$q$), '0', 'H6 running it again erases nothing more');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'students.retention'), 1::bigint, 'H7 the clean-up is in the audit trail with a count only');
select is(pg_temp.val('outsider', $q$select (public.scheduler_students_retention(0))::text$q$), 'ERR:22023', 'H8 a limit of none is invalid');
select is(pg_temp.val('a_admin', format($q$select public.institution_profile_set(%L, 'school', 4, '[]'::jsonb, array['en'])::text$q$, tests.tid('a'))), 'ERR:42501', 'H9 an Admin saving the profile WITHOUT the months would switch the rule off, so it is refused: the months are part of what is saved, and they are the Owner''s');
select is(pg_temp.val('a_owner', format($q$select (public.institution_profile_get(%L) ->> 'student_retention_months') is null$q$, tests.tid('a'))), 'false', 'H10 the rule is still on');
select is(pg_temp.val('a_owner', format($q$select (public.institution_profile_set(%L, 'school', 4, '[]'::jsonb, array['en']) ->> 'student_retention_months') is null$q$, tests.tid('a'))), 'true', 'H11 the Owner (second factor) switches it off by saving without the months');

-- ============================================================================ I. guards
select is(pg_temp.sc($q$truncate public.students cascade$q$), '42501', 'I1 students are never truncated');
select is(pg_temp.sc($q$truncate public.programmes cascade$q$), '42501', 'I2 nor programmes');
select is(pg_temp.sc($q$delete from public.institution_profiles$q$), '42501', 'I3 nor the profile deleted');
select * from finish();
rollback;
