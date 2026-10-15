-- Job CR (ADR 0087), part 2: ADMISSIONS. An enquiry from a parent or an adult student, without the companies module: the stages, the visit that moves it, the admission that makes a student, the list.
--   A structure, grants, RLS, module    B starting an enquiry    C the stages    D a campus visit    E admitted: the student is made    F reading    G guards
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'education');
select tests.open_gate('a');

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
create or replace function app.dues_today() returns date language sql stable set search_path = '' as $$ select date '2026-10-14' $$;
create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-14T11:00:00+05:30'::timestamptz);

insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values
  (tests.rid('pbcom'), tests.tid('a'), 'B.Com', 'course', 'year', tests.uid('a_owner')),
  (tests.rid('pbtech'), tests.tid('a'), 'B.Tech', 'course', 'year', tests.uid('a_owner'));
insert into public.programme_groups (id, tenant_id, programme_id, label, created_by) values (tests.rid('gy1'), tests.tid('a'), tests.rid('pbcom'), 'Year 1', tests.uid('a_owner'));
insert into public.contacts (id, tenant_id, full_name, phone) values
  (tests.rid('par1'), tests.tid('a'), 'Rao Parent', '+00 90020 00001'),
  (tests.rid('par2'), tests.tid('a'), 'Reddy Parent', '+00 90020 00002'),
  (tests.rid('par3'), tests.tid('a'), 'Sita Parent', '+00 90020 00003'),
  (tests.rid('par4'), tests.tid('a'), 'Kiran Adult', '+00 90020 00004');

create function pg_temp.adm(p_user text, p_id text, p_contact text, p_prog text, p_source text default 'walk_in', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.admission_create(%L, %L, %L, %L, %L)$q$, tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_contact), case when p_prog is null then null else tests.rid(p_prog)::text end, p_source))
$$;
create function pg_temp.stage(p_user text, p_id text, p_stage text, p_reason text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.admission_stage_set(%L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_id), p_stage, p_reason))
$$;
create function pg_temp.st(p_id text) returns text language sql as $$ select stage from public.admissions where id = tests.rid(p_id) $$;
create function pg_temp.visit(p_id text, p_lead_of text) returns void language plpgsql as $$
begin
  insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, request_sha256, created_by)
  select tests.rid(p_id), tests.tid('a'), a.lead_id, a.contact_id, date '2026-10-20', timestamptz '2026-10-20 11:00+05:30', timestamptz '2026-10-20 11:30+05:30', repeat('7', 64), tests.uid('a_owner')
    from public.admissions a where a.id = tests.rid(p_lead_of);
end $$;

-- ============================================================================ A. structure, grants, RLS, module
select is((select count(*) from pg_class where relname in ('admissions', 'admission_events') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 2::bigint, 'A1 RLS is enabled and forced on both tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('admissions', 'admission_events') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only read them');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('admissions', 'admission_events') and grantee in ('anon', 'public', 'service_role')), 0::bigint, 'A3 anon, PUBLIC and the service role hold nothing');
select is(pg_temp.adm('b_owner', 'xa', 'b_contact', null, 'walk_in', 'b'), 'SM701', 'A4 textiles: admissions are not on (SM701)');
select is(pg_temp.try('a_owner', format($q$insert into public.admissions (id, tenant_id, lead_id, contact_id, source, created_by) values (gen_random_uuid(), %L, %L, %L, 'other', %L)$q$, tests.tid('a'), tests.rid('a_lead'), tests.rid('par1'), tests.uid('a_owner'))), '42501', 'A5 DENY: a client cannot write an enquiry directly');
select is(app.module_enabled(tests.tid('a'), 'companies'), false, 'A6 (setup) the school has no companies module');

-- ============================================================================ B. starting an enquiry
select is(pg_temp.adm('a_sales', 'a1', 'par1', 'pbcom', 'whatsapp'), 'ok', 'B1 ALLOW: Sales (the front desk) starts an enquiry for a parent');
select is(pg_temp.adm('a_admin', 'a2', 'par2', 'pbtech', 'website'), 'ok', 'B2 ALLOW: an Admin');
select is(pg_temp.adm('a_owner', 'a3', 'par3', null, 'ad'), 'ok', 'B3 ALLOW: the Owner; the programme is optional');
select is(pg_temp.adm('a_owner', 'a4', 'par4', 'pbcom', 'referral'), 'ok', 'B4 ... an adult student enquires for themself, as a contact');
select is(pg_temp.adm('a_viewer', 'ax', 'par1', 'pbcom'), '42501', 'B5 DENY: a Viewer');
select is(pg_temp.adm('b_owner', 'ax', 'par1', 'pbcom'), '42501', 'B6 DENY: another business');
select is(pg_temp.adm('anon', 'ax', 'par1', 'pbcom'), '42501', 'B7 DENY: anon');
select is(pg_temp.adm('a_owner', 'a1', 'par1', 'pbcom', 'whatsapp'), 'ok', 'B8 an exact repeat replays');
select is(pg_temp.adm('a_owner', 'a1', 'par2', 'pbcom', 'whatsapp'), '23505', 'B9 the same id for another guardian is a conflict');
select is(pg_temp.adm('a_owner', 'a1', 'par1', 'pbtech', 'whatsapp'), '23505', 'B10 ... or another programme');
select is(pg_temp.adm('a_owner', 'ax', 'par1', 'pbcom', 'newspaper'), '22023', 'B11 a source outside the list is invalid');
select is(pg_temp.adm('a_owner', 'ax', 'b_contact', 'pbcom'), '23503', 'B12 a contact of another business is not found');
select is(pg_temp.try('a_owner', format($q$select public.admission_create(%L, %L, %L, %L, 'other')$q$, tests.rid('ax'), tests.tid('a'), tests.rid('par1'), gen_random_uuid())), '23503', 'B13 a programme that does not exist is not found');
select is((select count(*) from public.admissions where tenant_id = tests.tid('a')), 4::bigint, 'B14 four enquiries, none from a refusal');
select is((select count(*) from public.admission_events where tenant_id = tests.tid('a') and stage = 'enquiry'), 4::bigint, 'B15 each began at `enquiry`, on record');
select is((select count(distinct lead_id) from public.admissions where tenant_id = tests.tid('a')), 4::bigint, 'B16 each parent has a lead, made without the companies module');
select is((select count(*) from public.companies c join public.contacts k on k.company_id = c.id where k.id in (tests.rid('par1'), tests.rid('par2'), tests.rid('par3'), tests.rid('par4')) and c.name ~ '^Enquiry [0-9a-f]{6}$'), 4::bigint, 'B17 through a placeholder company that holds no personal data');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'admission' and (new_values::text like '%Rao%')), 0::bigint, 'B18 the audit trail names no one');

-- ============================================================================ C. the stages
select is(pg_temp.stage('a_sales', 'a1', 'campus_visit'), 'ok', 'C1 ALLOW: enquiry -> campus_visit');
select is(pg_temp.stage('a_sales', 'a1', 'application'), 'ok', 'C2 ... -> application');
select is(pg_temp.stage('a_sales', 'a1', 'campus_visit'), 'SM812', 'C3 a stage never goes back (SM812)');
select is(pg_temp.stage('a_sales', 'a1', 'application'), 'ok', 'C4 the same stage again replays');
select is(pg_temp.stage('a_sales', 'a2', 'application'), 'ok', 'C5 a step may be skipped (enquiry -> application)');
select is(pg_temp.stage('a_sales', 'a2', 'admitted'), '22023', 'C6 `admitted` is never set by hand: only admission_admit makes the student');
select is(pg_temp.stage('a_sales', 'a3', 'lost'), '22023', 'C7 a lost enquiry needs a reason');
select is(pg_temp.stage('a_sales', 'a3', 'application', 'fees'), '22023', 'C8 a reason only goes with `lost`');
select is(pg_temp.stage('a_sales', 'a3', 'lost', 'cost'), '22023', 'C9 the reason is one of the closed words');
select is(pg_temp.stage('a_sales', 'a3', 'lost', 'fees'), 'ok', 'C10 ALLOW: lost, with a reason');
select is(pg_temp.stage('a_sales', 'a3', 'enquiry'), 'SM812', 'C11 Sales cannot re-open a lost enquiry');
select is(pg_temp.stage('a_admin', 'a3', 'enquiry'), 'ok', 'C12 ALLOW: an Admin re-opens it');
select is((select lost_reason is null from public.admissions where id = tests.rid('a3')), true, 'C13 ... and the reason is cleared');
select is(pg_temp.stage('a_viewer', 'a3', 'campus_visit'), '42501', 'C14 DENY: a Viewer');
select is(pg_temp.stage('b_owner', 'a3', 'campus_visit'), '42501', 'C15 DENY: another business');
select is(pg_temp.try('a_owner', format($q$select public.admission_stage_set(%L, %L, 'lost', 'other')$q$, tests.tid('a'), gen_random_uuid())), '23503', 'C16 an enquiry that does not exist is not found');
select is((select string_agg(stage, ',' order by seq) from public.admission_events where admission_id = tests.rid('a3')), 'enquiry,lost,enquiry', 'C17 the enquiry''s history is kept: enquiry, lost, enquiry');
select is((select count(*) from public.admission_events where admission_id = tests.rid('a1')), 3::bigint, 'C18 the funnel counts what was REACHED: a1 has three events');

-- ============================================================================ D. a campus visit (the existing visit, reused)
select pg_temp.visit('v1', 'a4');
select is(pg_temp.st('a4'), 'campus_visit', 'D1 booking a visit for the guardian moves an enquiry to `campus_visit`');
select is((select count(*) from public.admission_events where admission_id = tests.rid('a4') and stage = 'campus_visit'), 1::bigint, 'D2 on record');
select pg_temp.visit('v2', 'a4');
select is((select count(*) from public.admission_events where admission_id = tests.rid('a4') and stage = 'campus_visit'), 1::bigint, 'D3 a second visit changes nothing');
select pg_temp.visit('v3', 'a1');
select is(pg_temp.st('a1'), 'application', 'D4 a visit never moves an enquiry BACK (a1 stays at `application`)');
select is(pg_temp.val('a_sales', format($q$select (public.admission_get(%L, %L) ->> 'visits')$q$, tests.tid('a'), tests.rid('a4'))), '2', 'D5 the enquiry shows how many visits the guardian has');
select is(pg_temp.val('a_sales', format($q$select (public.admission_get(%L, %L) ->> 'next_visit') is not null$q$, tests.tid('a'), tests.rid('a4'))), 'true', 'D6 and the next one booked');

-- ============================================================================ E. admitted: the student is made
create function pg_temp.admit(p_user text, p_adm text, p_student text, p_adult boolean, p_label text, p_prog text, p_group text default null, p_no text default null) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.admission_admit(%L, %L, %L, %L::boolean, %L, %L, %L, %L)$q$, tests.tid('a'), tests.rid(p_adm), tests.rid(p_student), p_adult, p_label, tests.rid(p_prog),
                                    case when p_group is null then null else tests.rid(p_group)::text end, p_no))
$$;
select is(pg_temp.admit('a_sales', 'a1', 'st1', false, 'Asha', 'pbcom'), '42501', 'E1 DENY: Sales cannot admit (it makes a child''s record)');
select is(pg_temp.admit('a_viewer', 'a1', 'st1', false, 'Asha', 'pbcom'), '42501', 'E2 DENY: a Viewer');
select is(pg_temp.admit('a_owner', 'a1', 'st1', false, 'Asha 2', 'pbcom'), '22023', 'E3 a label with a digit is invalid');
select is(pg_temp.admit('a_owner', 'a1', 'st1', false, null, 'pbcom'), '22023', 'E4 a child needs a label');
select is(pg_temp.admit('a_owner', 'a2', 'st1', false, 'Asha', 'pbcom', 'gy1', 'BC-001'), 'ok', 'E5 ALLOW: the Owner admits a2''s child into Year 1 of B.Com');
select is((select stage || '/' || (student_id = tests.rid('st1'))::text from public.admissions where id = tests.rid('a2')), 'admitted/true', 'E6 the enquiry is `admitted` and points at the student');
select is((select contact_id = tests.rid('par2') and programme_id = tests.rid('pbcom') and group_id = tests.rid('gy1') and child_label = 'Asha' and admission_no = 'BC-001' from public.students where id = tests.rid('st1')), true, 'E7 the student belongs to the enquiry''s guardian and is placed where the Owner said');
select is((select programme_id from public.admissions where id = tests.rid('a2')), tests.rid('pbtech'), 'E8 the programme the family first asked about is kept on the enquiry');
select is((select string_agg(stage, ',' order by seq) from public.admission_events where admission_id = tests.rid('a2')), 'enquiry,application,admitted', 'E9 the history ends with `admitted`');
select is(pg_temp.admit('a_owner', 'a2', 'st1', false, 'Asha', 'pbcom', 'gy1', 'BC-001'), 'ok', 'E10 an exact repeat replays');
select is(pg_temp.admit('a_owner', 'a2', 'st9', false, 'Bina', 'pbcom'), '23505', 'E11 another student id for an admitted enquiry is a conflict');
select is((select count(*) from public.students where contact_id = tests.rid('par2')), 1::bigint, 'E12 and nothing was made twice');
select is(pg_temp.stage('a_owner', 'a2', 'lost', 'fees'), 'SM812', 'E13 an admitted enquiry cannot be lost');
select is(pg_temp.stage('a_admin', 'a2', 'enquiry'), 'SM812', 'E14 nor re-opened');
select is(pg_temp.admit('a_owner', 'a3', 'st3', false, 'Dev', 'pbcom', null, 'BC-001'), 'SM811', 'E15 an admission number already used is refused (SM811) and the enquiry stays as it was');
select is(pg_temp.st('a3'), 'enquiry', 'E16 (still an enquiry)');
select is((select count(*) from public.students where id = tests.rid('st3')), 0::bigint, 'E17 and no student was made');
select pg_temp.stage('a_owner', 'a3', 'lost', 'distance');
select is(pg_temp.admit('a_owner', 'a3', 'st3', false, 'Dev', 'pbcom'), 'SM812', 'E18 a lost enquiry cannot be admitted until it is re-opened');
select is(pg_temp.admit('a_owner', 'a4', 'st4', true, null, 'pbtech'), 'ok', 'E19 an adult student: the enquirer IS the student (no label)');
select is((select is_adult and child_label is null and contact_id = tests.rid('par4') from public.students where id = tests.rid('st4')), true, 'E20 the contact is the student');
select is(pg_temp.try('a_owner', format($q$select public.admission_admit(%L, %L, %L, false, 'Eve', %L, null, null, %L, null)$q$, tests.tid('a'), tests.rid('a1'), tests.rid('st5'), tests.rid('pbcom'), gen_random_uuid())), '22023', 'E21 a plan needs its assignment id too (both or neither)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'student' and (new_values::text like '%Asha%')), 0::bigint, 'E23 the audit trail never holds the child''s label');

-- ============================================================================ F. reading
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admissions_list(%L))::text$q$, tests.tid('a'))), '4', 'F1 Sales read the pipeline (four enquiries)');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admissions_list(%L, 'admitted'))::text$q$, tests.tid('a'))), '2', 'F2 filtered by stage (two admitted)');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admissions_list(%L, null, %L))::text$q$, tests.tid('a'), tests.rid('pbcom'))), '2', 'F3 filtered by the programme asked about');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admissions_list(%L, null, null, 'ad'))::text$q$, tests.tid('a'))), '1', 'F4 filtered by source');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admissions_list(%L, null, null, null, 3))::text$q$, tests.tid('a'))), '3', 'F5 a page of three');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admissions_list(%L, null, null, null, 3, (select created_at from public.admissions order by created_at desc, id desc limit 1 offset 2), (select id from public.admissions order by created_at desc, id desc limit 1 offset 2)))::text$q$, tests.tid('a'))), '1', 'F6 and the rest after the cursor');
select is(pg_temp.val('a_sales', format($q$select public.admissions_list(%L, 'closed')::text$q$, tests.tid('a'))), 'ERR:22023', 'F7 a stage outside the list is invalid');
select is(pg_temp.val('a_viewer', format($q$select public.admissions_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'F8 DENY: a Viewer');
select is(pg_temp.val('a_viewer', format($q$select count(*)::text from public.admissions where tenant_id = %L$q$, tests.tid('a'))), '0', 'F9 ... not even through the table');
select is(pg_temp.val('b_owner', format($q$select count(*)::text from public.admissions where tenant_id = %L$q$, tests.tid('a'))), '0', 'F10 another business sees none');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.admission_get(%L, %L) -> 'events')::text$q$, tests.tid('a'), tests.rid('a2'))), '3', 'F11 one enquiry shows its history');
select is(pg_temp.val('a_sales', format($q$select (public.admission_get(%L, %L) ->> 'contact_name')$q$, tests.tid('a'), tests.rid('a2'))), 'Reddy Parent', 'F12 and the guardian''s name');

-- ============================================================================ G. guards
select is(pg_temp.sc(format($q$update public.admissions set stage = 'lost', lost_reason = 'fees' where id = %L$q$, tests.rid('a3'))), '42501', 'G1 an enquiry changes only through its functions, whoever asks');
select is(pg_temp.sc($q$delete from public.admissions$q$), '42501', 'G2 an enquiry is never deleted');
select is(pg_temp.sc($q$update public.admission_events set stage = 'lost', lost_reason = 'fees'$q$), '42501', 'G3 the history is never changed');
select is(pg_temp.sc($q$delete from public.admission_events$q$), '42501', 'G4 nor deleted');
select is(pg_temp.sc($q$truncate public.admissions cascade$q$), '42501', 'G5 nor truncated');
select * from finish();
rollback;
