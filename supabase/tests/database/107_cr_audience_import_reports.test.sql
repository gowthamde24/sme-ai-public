-- Job CR (ADR 0087), part 4: ANNOUNCEMENTS (the audience from the students), THE IMPORT of guardians and students, THE REPORTS of the education pack, the children's review before real data, and the import job kind.
--   A announcements    B the students import    C the real-data gate    D reports: collection, today, pending, the admissions funnel (worked by hand)    E the import job kind
-- The clock is NOT pinned here: the funnel counts enquiries made "now". Every date that matters is either far in the past or the day itself (app.dues_today()).
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
create function pg_temp.today() returns text language sql as $$ select app.dues_today()::text $$;

insert into public.programmes (id, tenant_id, name, kind, group_kind, created_by) values
  (tests.rid('p5'), tests.tid('a'), 'Class 5', 'class', 'section', tests.uid('a_owner')),
  (tests.rid('p6'), tests.tid('a'), 'Class 6', 'class', 'none', tests.uid('a_owner'));
insert into public.programme_groups (id, tenant_id, programme_id, label, created_by) values
  (tests.rid('g5a'), tests.tid('a'), tests.rid('p5'), 'A', tests.uid('a_owner')),
  (tests.rid('g5b'), tests.tid('a'), tests.rid('p5'), 'B', tests.uid('a_owner'));
insert into public.contacts (id, tenant_id, full_name, phone) values
  (tests.rid('g1'), tests.tid('a'), 'Rao Parent', '+00 90040 00001'),
  (tests.rid('g2'), tests.tid('a'), 'Reddy Parent', '+00 90040 00002'),
  (tests.rid('g3'), tests.tid('a'), 'Sita Parent', '+00 90040 00003');
insert into public.contacts (id, tenant_id, full_name) values (tests.rid('g4'), tests.tid('a'), 'No Phone Parent');
select app.edu_edit(true);
insert into public.students (id, tenant_id, contact_id, is_adult, child_label, programme_id, group_id, created_by) values
  (tests.rid('s1'), tests.tid('a'), tests.rid('g1'), false, 'Asha', tests.rid('p5'), tests.rid('g5a'), tests.uid('a_owner')),
  (tests.rid('s2'), tests.tid('a'), tests.rid('g1'), false, 'Bala', tests.rid('p5'), tests.rid('g5b'), tests.uid('a_owner')),
  (tests.rid('s3'), tests.tid('a'), tests.rid('g2'), false, 'Chitra', tests.rid('p5'), tests.rid('g5a'), tests.uid('a_owner')),
  (tests.rid('s4'), tests.tid('a'), tests.rid('g3'), false, 'Dev', tests.rid('p6'), null, tests.uid('a_owner')),
  (tests.rid('s5'), tests.tid('a'), tests.rid('g4'), false, 'Esha', tests.rid('p5'), tests.rid('g5b'), tests.uid('a_owner'));
select app.edu_edit(false);

-- ============================================================================ A. announcements: the audience from the students
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) values
  (tests.rid('tpl'), tests.tid('a'), 'notice', 'en', 'utility', 'reminder', 'Hello, a notice from the school: {{1}} Thank you.', 'approved');
create function pg_temp.camp(p_id text, p_kind text default 'event', p_text text default 'Dear {{name}}, the annual day is on {{due_date}}. We look forward to seeing you.') returns text language sql as $$
  select pg_temp.try('a_owner', format($q$select public.campaign_save(%L, %L, 'Notice', %L, 'en', %L, %L, '[{"offset_days": -2, "time": "10:00"}]'::jsonb, null, 24)$q$, tests.rid(p_id), tests.tid('a'), p_kind, tests.rid('tpl'), p_text))
$$;
create function pg_temp.aud(p_user text, p_camp text, p_filter jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.campaign_recipients_from_students(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid(p_camp), p_filter::text))
$$;
create function pg_temp.n(p_camp text) returns bigint language sql as $$ select count(*) from public.campaign_recipients where campaign_id = tests.rid(p_camp) $$;
select is(pg_temp.camp('ev1'), 'ok', 'A1 (setup) an event campaign (a service message: no amount)');
select is(pg_temp.val('a_sales', format($q$select (public.campaign_recipients_from_students(%L, %L, %L::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('ev1'),
          jsonb_build_object('scope', 'programme', 'programme_id', tests.rid('p5'), 'date', '2026-12-20')::text)), '2', 'A2 ALLOW: Sales choose the guardians of Class 5: Rao (two children, ONE message) and Reddy; the guardian with no phone number is skipped');
select is(pg_temp.n('ev1'), 2::bigint, 'A3 two recipients');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.campaign_recipients_from_students(%L, %L, %L::jsonb) -> 'skipped')::text$q$, tests.tid('a'), tests.rid('ev1'),
          jsonb_build_object('scope', 'programme', 'programme_id', tests.rid('p5'), 'date', '2026-12-20')::text)), '3', 'A4 asking again adds nobody twice (the two are skipped as duplicates, the guardian with no number as unreachable)');
select is(pg_temp.n('ev1'), 2::bigint, 'A5 (still two)');
select is((select count(*) from public.campaign_recipients r where r.campaign_id = tests.rid('ev1') and r.contact_id = tests.rid('g1')), 1::bigint, 'A7 Rao has one message though two children are in Class 5');
select is((select amount_paise is null and reference is null and ledger_scope = 'account' from public.campaign_recipients where campaign_id = tests.rid('ev1') and contact_id = tests.rid('g1')), true, 'A8 an announcement carries no amount and no reference');
select is(pg_temp.camp('ev2'), 'ok', 'A9 (setup) a second event campaign');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_students(%L, %L, %L::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('ev2'),
          jsonb_build_object('scope', 'group', 'group_id', tests.rid('g5a'), 'date', '2026-12-20')::text)), '2', 'A10 a section: Asha''s guardian Rao and Chitra''s guardian Reddy');
select is(pg_temp.camp('ev3'), 'ok', 'A11 (setup) a third');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_students(%L, %L, %L::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('ev3'), jsonb_build_object('scope', 'all', 'date', '2026-12-20')::text)), '3', 'A12 the whole school: three guardians with a number');
select is(pg_temp.camp('hol1', 'holiday', 'Dear {{name}}, the school is closed on {{due_date}} for the holiday.'), 'ok', 'A13 a holiday notice is a campaign too');
select is(pg_temp.camp('exm1', 'exam', 'Dear {{name}}, the term exam begins on {{due_date}}. Please be on time.'), 'ok', 'A14 so is an exam notice');
select is(pg_temp.camp('fee1', 'fee_due', 'Dear {{name}}, fees of {{amount}} fall due on {{due_date}}.'), 'ok', 'A15 (setup) a fee reminder');
select is(pg_temp.aud('a_owner', 'fee1', jsonb_build_object('scope', 'all', 'date', '2026-12-20')), 'ERR:22023', 'A16 a fee reminder is built from the LEDGER, not from the students: refused here');
select is(pg_temp.aud('a_viewer', 'ev3', jsonb_build_object('scope', 'all', 'date', '2026-12-20')), 'ERR:42501', 'A17 DENY: a Viewer');
select is(pg_temp.aud('b_owner', 'ev3', jsonb_build_object('scope', 'all', 'date', '2026-12-20')), 'ERR:42501', 'A18 DENY: another business');
select is(pg_temp.aud('a_owner', 'ev3', jsonb_build_object('scope', 'everyone', 'date', '2026-12-20')), 'ERR:22023', 'A19 a scope outside the list is invalid');
select is(pg_temp.aud('a_owner', 'ev3', jsonb_build_object('scope', 'programme', 'date', '2026-12-20')), 'ERR:22023', 'A20 a programme scope names the programme');
select is(pg_temp.aud('a_owner', 'ev3', jsonb_build_object('scope', 'all', 'programme_id', tests.rid('p5'), 'date', '2026-12-20')), 'ERR:22023', 'A21 `all` names nothing');
select is(pg_temp.aud('a_owner', 'ev3', jsonb_build_object('scope', 'all')), 'ERR:22023', 'A22 the date is required');
select is(pg_temp.aud('a_owner', 'ev3', jsonb_build_object('scope', 'all', 'date', '2026-12-20', 'note', 'x')), 'ERR:22023', 'A23 nothing else is accepted in the filter');
select is(pg_temp.aud('a_owner', 'ev3', jsonb_build_object('scope', 'programme', 'programme_id', gen_random_uuid(), 'date', '2026-12-20')), 'ERR:23503', 'A24 a programme that does not exist is not found');
select is(pg_temp.val('a_owner', format($q$select public.campaign_recipients_from_students(%L, gen_random_uuid(), '{"scope": "all", "date": "2026-12-20"}'::jsonb)::text$q$, tests.tid('a'))), 'ERR:23503', 'A25 nor a campaign');
select is(pg_temp.val('b_owner', format($q$select public.campaign_recipients_from_students(%L, gen_random_uuid(), '{"scope": "all", "date": "2026-12-20"}'::jsonb)::text$q$, tests.tid('b'))), 'ERR:SM701', 'A26 textiles: no campaigns module (SM701)');
select is((select audience_kind from public.campaigns where id = tests.rid('ev3')), 'filter', 'A27 the campaign remembers how its list was made');
select is((select count(*) from public.campaign_recipients r join public.contacts c on c.id = r.contact_id where r.campaign_id = tests.rid('ev3') and (c.full_name ~ '(Asha|Bala|Chitra|Dev|Esha)')), 0::bigint, 'A28 no child''s name is on the list');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_preview(%L, %L) -> 'samples' -> 0 ->> 'body') ~ '(Asha|Bala|Chitra|Dev|Esha)'$q$, tests.tid('a'), tests.rid('ev3'))), 'false', 'A29 nor in the message the Owner approves');
insert into public.contacts (id, tenant_id, full_name, phone) values (tests.rid('g5'), tests.tid('a'), 'Erased Child Parent', '+00 90040 00005');
select app.edu_edit(true);
insert into public.students (id, tenant_id, contact_id, is_adult, child_label, programme_id, created_by, erased_at) values (tests.rid('s6'), tests.tid('a'), tests.rid('g5'), false, 'erased:1', tests.rid('p6'), tests.uid('a_owner'), now());
select app.edu_edit(false);
select is(pg_temp.camp('ev4'), 'ok', 'A30 (setup)');
select is(pg_temp.val('a_owner', format($q$select (public.campaign_recipients_from_students(%L, %L, %L::jsonb) ->> 'added')$q$, tests.tid('a'), tests.rid('ev4'), jsonb_build_object('scope', 'all', 'date', '2026-12-20')::text)), '3', 'A31 a guardian whose only child was erased is no longer reached through them (Erased Child Parent is left out)');

-- ============================================================================ B. the students import
create function pg_temp.imp(p_user text, p_batch text, p_rows jsonb) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.students_import(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), tests.rid(p_batch), p_rows::text))
$$;
create function pg_temp.out(p_json text, p_row int, p_key text) returns text language sql as $$ select ((p_json::jsonb) -> 'rows' -> (p_row - 1)) ->> p_key $$;
create function pg_temp.row(p_name text, p_phone text, p_prog text, p_label text, p_group text default null, p_adm text default null, p_adult boolean default false) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('guardian_name', p_name, 'guardian_phone', p_phone, 'programme', p_prog, 'child_label', p_label, 'group', p_group, 'admission_no', p_adm, 'is_adult', p_adult))
$$;
create temp table imp1 as select pg_temp.imp('a_admin', 'ib1', jsonb_build_array(
  pg_temp.row('Imp Parent One', '+00 90050 00001', 'class 5', 'Gita', 'a', 'IMP-1'),
  pg_temp.row('Imp Parent One', '+00 90050 00001', 'Class 5', 'Hari', 'B', 'IMP-2'),
  pg_temp.row('Imp Parent Two', '+00 90050 00002', 'Class 6', 'Indu'),
  pg_temp.row('Imp Adult', '+00 90050 00003', 'Class 6', null, null, null, true),
  pg_temp.row('Rao Parent', '+00 90040 00001', 'Class 6', 'Jaya'),
  pg_temp.row('Imp Parent One', '+00 90050 00001', 'Class 5', 'gita', 'A'),
  pg_temp.row('Imp Parent Three', '+00 90050 00004', 'Class 5', 'Kiran', null, 'imp-1'),
  pg_temp.row('Imp Parent Four', '+00 90050 00005', 'Class 9', 'Lata'),
  pg_temp.row('Imp Parent Five', '+00 90050 00006', 'Class 5', 'Mohan', 'Z'),
  pg_temp.row('Imp Parent Six', '+00 90050 00007', 'Class 5', 'Nila 2'),
  pg_temp.row('', '+00 90050 00008', 'Class 5', 'Om'),
  pg_temp.row('Imp Parent Eight', 'not a number', 'Class 5', 'Pia'),
  pg_temp.row('Imp Parent Nine', '+00 90050 00009', 'Class 5', null))) as j;
select is((select j from imp1) is not null and (select j from imp1) not like 'ERR:%', true, 'B1 ALLOW: an Admin imports thirteen rows');
select is(pg_temp.out((select j from imp1), 1, 'outcome'), 'created', 'B2 a child with a section and an admission number');
select is(pg_temp.out((select j from imp1), 2, 'outcome'), 'created', 'B3 a second child of the same guardian');
select is((select count(*) from public.contacts where full_name = 'Imp Parent One'), 1::bigint, 'B4 the guardian was found by phone and made ONCE');
select is(pg_temp.out((select j from imp1), 1, 'contact_created'), 'true', 'B5 the first row made the contact...');
select is(pg_temp.out((select j from imp1), 2, 'contact_created'), 'false', 'B6 ... the second found them');
select is(pg_temp.out((select j from imp1), 3, 'outcome'), 'created', 'B7 a programme without groups needs none');
select is(pg_temp.out((select j from imp1), 4, 'outcome') || '/' || (select is_adult::text || '/' || (child_label is null)::text from public.students where id = (pg_temp.out((select j from imp1), 4, 'student_id'))::uuid), 'created/true/true', 'B8 an adult student is the contact, with no label');
select is(pg_temp.out((select j from imp1), 5, 'outcome') || '/' || pg_temp.out((select j from imp1), 5, 'contact_created'), 'created/false', 'B9 an existing guardian (by phone) gets another child without a second contact');
select is(pg_temp.out((select j from imp1), 6, 'reason'), 'same_child', 'B10 the same child again (any case) is a duplicate');
select is(pg_temp.out((select j from imp1), 7, 'reason'), 'admission_no', 'B11 an admission number already used (any case) is a duplicate');
select is(pg_temp.out((select j from imp1), 8, 'reason'), 'programme_not_found', 'B12 a programme the school does not have');
select is(pg_temp.out((select j from imp1), 9, 'reason'), 'group_not_found', 'B13 a section the programme does not have');
select is(pg_temp.out((select j from imp1), 10, 'reason'), 'invalid_row', 'B14 a label with a digit');
select is(pg_temp.out((select j from imp1), 11, 'reason'), 'invalid_row', 'B15 a guardian with no name');
select is(pg_temp.out((select j from imp1), 12, 'reason'), 'invalid_row', 'B16 a phone that is not a number');
select is(pg_temp.out((select j from imp1), 13, 'reason'), 'invalid_row', 'B17 a child with no label');
select is(((select j from imp1)::jsonb -> 'counts')::text, '{"created": 5, "rejected": 6, "skipped_duplicate": 2}', 'B18 five created, two duplicates, six refused');
select is((select count(*) from public.contacts where full_name in ('Imp Parent Four', 'Imp Parent Five', 'Imp Parent Six', 'Imp Parent Eight', 'Imp Parent Nine')), 0::bigint, 'B19 a refused row leaves NOTHING behind: no contact either');
select is((select count(*) from public.students s join public.contacts c on c.id = s.contact_id where c.full_name like 'Imp %'), 4::bigint, 'B20 four students for the new guardians (Gita, Hari, Indu, the adult), plus Jaya for Rao');
select is((select count(*) from public.students where tenant_id = tests.tid('a')), 11::bigint, 'B21 eleven students in all (six before, five from the file)');
select is(pg_temp.out(pg_temp.imp('a_admin', 'ib1', jsonb_build_array(pg_temp.row('Imp Parent One', '+00 90050 00001', 'Class 5', 'Gita', 'a', 'IMP-1'))), 1, 'reason'), 'replay', 'B23 the same batch again adds nothing (the ids are derived from the batch)');
select is(pg_temp.imp('a_sales', 'ib2', jsonb_build_array(pg_temp.row('X', '+00 90050 00010', 'Class 5', 'Xan'))), 'ERR:42501', 'B24 DENY: Sales');
select is(pg_temp.imp('a_viewer', 'ib2', jsonb_build_array(pg_temp.row('X', '+00 90050 00010', 'Class 5', 'Xan'))), 'ERR:42501', 'B25 DENY: a Viewer');
select is(pg_temp.imp('b_owner', 'ib2', jsonb_build_array(pg_temp.row('X', '+00 90050 00010', 'Class 5', 'Xan'))), 'ERR:42501', 'B26 DENY: another business');
select is(pg_temp.imp('a_admin', 'ib2', '[]'::jsonb), 'ERR:22023', 'B27 an empty file is invalid');
select is(pg_temp.imp('a_admin', 'ib2', (select jsonb_agg(pg_temp.row('Bulk Parent ' || g, '+00 91' || lpad(g::text, 8, '0'), 'Class 6', 'Bulk')) from generate_series(1, 501) g)), 'ERR:22023', 'B28 at most 500 rows a call (the API cuts a larger file into parts)');
select is(pg_temp.out(pg_temp.imp('a_admin', 'ib3', jsonb_build_array(to_jsonb('just a string'::text))), 1, 'reason'), 'invalid_row', 'B29 a row that is not an object is refused, not fatal');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'student' and new_values::text ~ '(Gita|Hari|Indu|IMP-)'), 0::bigint, 'B31 the audit trail holds no label and no admission number from the import');
-- the real-data gate refuses a real-looking number while it is closed
select app.operator_close_real_data_gate((select slug from public.tenants where id = tests.tid('a')));
select is(pg_temp.out(pg_temp.imp('a_admin', 'ib4', jsonb_build_array(pg_temp.row('Real Parent', '+91 98765 43210', 'Class 6', 'Real'))), 1, 'reason'), 'real_data_gate', 'B32 with the gate closed, a real-looking phone number is refused row by row');
select is(pg_temp.out(pg_temp.imp('a_admin', 'ib5', jsonb_build_array(pg_temp.row('Fake Parent', '+00 90060 00001', 'Class 6', 'Fake'))), 1, 'outcome'), 'created', 'B33 ... a synthetic number (+00) is accepted');

-- ============================================================================ C. the real-data gate asks for the children's review
select is((select pg_temp.sc(format($q$select app.operator_open_real_data_gate(%L, 'adr:0014', 'doc:hosting', 'doc:dpdp-review', 'doc:restore')$q$, (select slug from public.tenants where id = tests.tid('a'))))), 'SM816', 'C1 a school''s workspace does not open with the ordinary DPDP review reference (SM816)');
select is((select pg_temp.sc(format($q$select app.operator_open_real_data_gate(%L, 'adr:0014', 'doc:hosting', 'dpdp-children:review-17', 'doc:restore')$q$, (select slug from public.tenants where id = tests.tid('a'))))), 'ok', 'C2 ... it opens with the children''s review reference');
select is((select real_data_allowed from public.tenant_data_policy where tenant_id = tests.tid('a')), true, 'C3 and is open');
select app.operator_close_real_data_gate((select slug from public.tenants where id = tests.tid('b')));
select is((select pg_temp.sc(format($q$select app.operator_open_real_data_gate(%L, 'adr:0014', 'doc:hosting', 'doc:dpdp-review', 'doc:restore')$q$, (select slug from public.tenants where id = tests.tid('b'))))), 'ok', 'C4 a business with no student records (textiles) opens with the ordinary reference, as before');

-- ============================================================================ D. reports, worked by hand
-- Class 5: two instalments of Rs 10,000 (due 10 June and 10 October); Class 6: one of Rs 5,000 (due 1 September)
select app.edu_edit(false);
select is(pg_temp.try('a_owner', format($q$select public.fee_plan_save(%L, %L, 'Class 5 fees', %L, null, '2026-27', 'none', null, 0, null, true, %L::jsonb)$q$, tests.rid('pl5'), tests.tid('a'), tests.rid('p5'),
          jsonb_build_array(jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-06-10', 'amount_paise', 1000000), jsonb_build_object('head', 'tuition', 'instalment_no', 2, 'due_date', '2026-10-10', 'amount_paise', 1000000))::text)), 'ok', 'D1 (setup) the plan of Class 5');
select is(pg_temp.try('a_owner', format($q$select public.fee_plan_save(%L, %L, 'Class 6 fees', %L, null, '2026-27', 'none', null, 0, null, true, %L::jsonb)$q$, tests.rid('pl6'), tests.tid('a'), tests.rid('p6'),
          jsonb_build_array(jsonb_build_object('head', 'tuition', 'instalment_no', 1, 'due_date', '2026-09-01', 'amount_paise', 500000))::text)), 'ok', 'D2 (setup) the plan of Class 6');
-- Esha (s5) is not part of the money story; Asha, Bala, Chitra (Class 5) and Dev (Class 6) are
select is(pg_temp.try('a_owner', format($q$select public.fee_assign(%L, %L, %L, %L, date '2026-06-01')$q$, tests.rid('as1'), tests.tid('a'), tests.rid('s1'), tests.rid('pl5'))), 'ok', 'D3 (setup) Asha');
select is(pg_temp.try('a_owner', format($q$select public.fee_assign(%L, %L, %L, %L, date '2026-06-01')$q$, tests.rid('as2'), tests.tid('a'), tests.rid('s2'), tests.rid('pl5'))), 'ok', 'D4 (setup) Bala');
select is(pg_temp.try('a_owner', format($q$select public.fee_assign(%L, %L, %L, %L, date '2026-06-01')$q$, tests.rid('as3'), tests.tid('a'), tests.rid('s3'), tests.rid('pl5'))), 'ok', 'D5 (setup) Chitra');
select is(pg_temp.try('a_owner', format($q$select public.fee_assign(%L, %L, %L, %L, date '2026-08-01')$q$, tests.rid('as4'), tests.tid('a'), tests.rid('s4'), tests.rid('pl6'))), 'ok', 'D6 (setup) Dev');
select is(pg_temp.try('a_owner', format($q$select public.fee_payment_record(%L, %L, %L, date '2026-06-05', 1000000, 'cash')$q$, tests.rid('py1'), tests.tid('a'), tests.rid('s1'))), 'ok', 'D7 (setup) Asha pays Rs 10,000 on 5 June');
select is(pg_temp.try('a_owner', format($q$select public.fee_payment_record(%L, %L, %L, date '2026-06-06', 400000, 'upi')$q$, tests.rid('py2'), tests.tid('a'), tests.rid('s2'))), 'ok', 'D8 (setup) Bala pays Rs 4,000 on 6 June');
select is(pg_temp.try('a_owner', format($q$select public.fee_payment_record(%L, %L, %L, date %L, 2000000, 'upi')$q$, tests.rid('py3'), tests.tid('a'), tests.rid('s3'), pg_temp.today())), 'ok', 'D9 (setup) Chitra pays all Rs 20,000 today');
select is(pg_temp.try('a_owner', format($q$select public.fee_concession_apply(%L, %L, %L, 'amount', 100000, 'sibling')$q$, tests.rid('cn1'), tests.tid('a'), tests.rid('s1'))), 'ok', 'D10 (setup) Asha gets a Rs 1,000 concession');
create function pg_temp.rep(p_user text, p_code text, p_from text default null, p_to text default null) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.education_report(%L, %L, %s, %s)::text$q$, tests.tid('a'), p_code, case when p_from is null then 'null' else format('date %L', p_from) end, case when p_to is null then 'null' else format('date %L', p_to) end))
$$;
create function pg_temp.kpi(p_json text, p_key text) returns text language sql as $$ select (select e ->> 'value' from jsonb_array_elements((p_json::jsonb) -> 'kpis') e where e ->> 'key' = p_key) $$;
create function pg_temp.rows(p_json text, p_table text) returns text language sql as $$ select ((select t -> 'rows' from jsonb_array_elements((p_json::jsonb) -> 'tables') t where t ->> 'key' = p_table))::text $$;
create temp table rc as select pg_temp.rep('a_sales', 'education.collection') as j;
-- by hand, as of today: due = (10,000 + 10,000) x 3 + 5,000 = Rs 65,000. Asha: 10,000 paid + 1,000 conceded -> Rs 9,000 pending (all of instalment 2 but Rs 1,000). Bala: 4,000 paid -> Rs 16,000 pending.
-- Chitra: all paid -> 0. Dev: 5,000 pending. Pending in all: Rs 30,000.
select is(pg_temp.kpi((select j from rc), 'due_paise'), '6500000', 'D11 due so far: Rs 65,000');
select is(pg_temp.kpi((select j from rc), 'pending_paise'), '3000000', 'D12 pending: Rs 30,000');
select is(pg_temp.kpi((select j from rc), 'collected_paise'), '3400000', 'D13 collected in the year so far: Rs 34,000 (10,000 + 4,000 + 20,000)');
select is(pg_temp.kpi((select j from rc), 'concessions_paise'), '100000', 'D14 conceded: Rs 1,000');
select is(pg_temp.kpi((select j from rc), 'collection_pct'), '53.8', 'D15 collection (paid or conceded, of what has fallen due): 53.8 percent');
select is(pg_temp.kpi((select j from rc), 'students_pending'), '3', 'D16 three students have something pending');
select is(pg_temp.rows((select j from rc), 'by_programme'), '[["Class 5", 3, 6000000, 2500000, 58.3], ["Class 6", 1, 500000, 500000, 0.0]]', 'D17 by programme');
select is(pg_temp.rows((select j from rc), 'by_group'), '[["Class 5", "A", 2, 4000000, 900000, 77.5], ["Class 5", "B", 1, 2000000, 1600000, 20.0], ["Class 6", "", 1, 500000, 500000, 0.0]]', 'D18 by class and section');
select is(((select j from rc)::jsonb -> 'series' -> 0 ->> 'key'), 'collection_by_day', 'D19 the collection by day...');
select is(jsonb_array_length((select j from rc)::jsonb -> 'series' -> 0 -> 'points')::text, '3', 'D20 ... has three days of payments');
select is(pg_temp.kpi(pg_temp.rep('a_sales', 'education.collection', '2026-06-06', '2026-06-30'), 'collected_paise'), '400000', 'D21 a window: only Bala''s payment of 6 June falls in 6-30 June');
select is(pg_temp.kpi(pg_temp.rep('a_sales', 'education.collection', null, '2026-06-30'), 'due_paise'), '3000000', 'D22 as of 30 June, Rs 10,000 had fallen due for each of three Class 5 children');
select is(pg_temp.kpi(pg_temp.rep('a_sales', 'education.collection', null, '2026-06-30'), 'pending_paise'), '1600000', 'D24 and Rs 16,000 of it was pending on that day: Chitra''s Rs 10,000 (she paid only today) and Bala''s Rs 6,000 (he had paid Rs 4,000 of his Rs 10,000)');
create temp table rt as select pg_temp.rep('a_sales', 'education.today') as j;
select is(pg_temp.kpi((select j from rt), 'collected_paise'), '2000000', 'D25 today''s collection: Chitra''s Rs 20,000');
select is(pg_temp.kpi((select j from rt), 'receipts'), '1', 'D26 one receipt');
select is(pg_temp.rows((select j from rt), 'by_method'), '[["upi", 1, 2000000]]', 'D27 by method');
create temp table rp as select pg_temp.rep('a_sales', 'education.pending') as j;
select is(pg_temp.kpi((select j from rp), 'pending_paise'), '3000000', 'D28 the pending report: Rs 30,000');
select is(pg_temp.rows((select j from rp), 'by_programme'), '[["Class 5", 2, 2500000], ["Class 6", 1, 500000]]', 'D29 by programme, the most first');
select is(pg_temp.rep('a_viewer', 'education.collection'), 'ERR:42501', 'D30 DENY: a Viewer');
select is(pg_temp.rep('b_owner', 'education.collection'), 'ERR:42501', 'D31 DENY: another business');
select is(pg_temp.val('b_owner', format($q$select public.education_report(%L, 'education.collection')::text$q$, tests.tid('b'))), 'ERR:SM701', 'D32 textiles: not an education business (SM701)');
select is(pg_temp.rep('a_owner', 'education.defaulters'), 'ERR:22023', 'D33 a report code outside the four');
select is(pg_temp.rep('a_owner', 'education.collection', null, '2030-01-01'), 'ERR:22023', 'D34 not for a future day');
select is(pg_temp.rep('a_owner', 'education.collection', '2026-07-01', '2026-06-01'), 'ERR:22023', 'D35 the window must run forwards');
select is(((select j from rc)::jsonb ->> 'report') || '/' || ((select j from rc)::jsonb ->> 'from'), 'education.collection/2026-04-01', 'D36 with no profile the year starts in April');
-- the admissions funnel
select is(pg_temp.try('a_sales', format($q$select public.admission_create(%L, %L, %L, %L, 'whatsapp')$q$, tests.rid('fa1'), tests.tid('a'), tests.rid('g1'), tests.rid('p5'))), 'ok', 'D37 (setup) four enquiries: two from WhatsApp...');
select is(pg_temp.try('a_sales', format($q$select public.admission_create(%L, %L, %L, %L, 'walk_in')$q$, tests.rid('fa2'), tests.tid('a'), tests.rid('g2'), tests.rid('p5'))), 'ok', 'D38 ... a walk-in');
select is(pg_temp.try('a_sales', format($q$select public.admission_create(%L, %L, %L, %L, 'whatsapp')$q$, tests.rid('fa3'), tests.tid('a'), tests.rid('g3'), tests.rid('p6'))), 'ok', 'D39 ... ');
select is(pg_temp.try('a_sales', format($q$select public.admission_create(%L, %L, %L, null, 'ad')$q$, tests.rid('fa4'), tests.tid('a'), tests.rid('g4'))), 'ok', 'D40 ... and one from an advertisement');
select pg_temp.try('a_sales', format($q$select public.admission_stage_set(%L, %L, 'campus_visit')$q$, tests.tid('a'), tests.rid('fa1')));
select pg_temp.try('a_sales', format($q$select public.admission_stage_set(%L, %L, 'application')$q$, tests.tid('a'), tests.rid('fa1')));
select pg_temp.try('a_sales', format($q$select public.admission_stage_set(%L, %L, 'campus_visit')$q$, tests.tid('a'), tests.rid('fa4')));
select pg_temp.try('a_sales', format($q$select public.admission_stage_set(%L, %L, 'lost', 'fees')$q$, tests.tid('a'), tests.rid('fa2')));
select is(pg_temp.try('a_owner', format($q$select public.admission_admit(%L, %L, %L, false, 'Farah', %L, %L, null)$q$, tests.tid('a'), tests.rid('fa1'), tests.rid('sf1'), tests.rid('p5'), tests.rid('g5a'))), 'ok', 'D41 (setup) the first is admitted');
create temp table rf as select pg_temp.rep('a_sales', 'education.funnel') as j;
select is(pg_temp.kpi((select j from rf), 'enquiries'), '4', 'D42 four enquiries in the last 90 days');
select is(pg_temp.kpi((select j from rf), 'campus_visits'), '2', 'D43 two reached a campus visit');
select is(pg_temp.kpi((select j from rf), 'applications'), '1', 'D44 one reached an application');
select is(pg_temp.kpi((select j from rf), 'admitted'), '1', 'D45 one was admitted');
select is(pg_temp.kpi((select j from rf), 'lost'), '1', 'D46 one was lost');
select is(pg_temp.kpi((select j from rf), 'conversion_pct'), '25.0', 'D47 25 percent became students');
select is(pg_temp.rows((select j from rf), 'by_source'), '[["whatsapp", 2, 1], ["ad", 1, 0], ["walk_in", 1, 0]]', 'D48 by source');
select is(pg_temp.rows((select j from rf), 'by_programme'), '[["Class 5", 2, 1], ["", 1, 0], ["Class 6", 1, 0]]', 'D49 by programme (an enquiry that named none is shown with an empty name)');
select is(pg_temp.rows((select j from rf), 'by_lost_reason'), '[["fees", 1]]', 'D50 why they were lost');
select is(pg_temp.kpi(pg_temp.rep('a_sales', 'education.funnel', '2020-01-01', '2020-12-31'), 'enquiries'), '0', 'D51 a window with no enquiries says zero');
select is(pg_temp.kpi(pg_temp.rep('a_sales', 'education.funnel', '2020-01-01', '2020-12-31'), 'conversion_pct'), null, 'D52 and no percentage (nothing to divide)');
select is(position('defaulter' in lower((select j from rc) || (select j from rt) || (select j from rp) || (select j from rf))), 0, 'D53 the word "defaulter" appears nowhere in a report (the word is "pending")');

-- ============================================================================ E. the import job kind
select is(pg_temp.try('a_admin', format($q$select public.import_job_preview_save(%L, %L, 'students', %L, '{"guardian_name": 0}'::jsonb, %L, 3, '{}'::jsonb, '[]'::jsonb)$q$, tests.tid('a'), tests.rid('job1'), repeat('a', 64), repeat('b', 64))), 'ok', 'E1 ALLOW: a students file can be previewed as a job');
select is(pg_temp.try('a_admin', format($q$select public.import_job_preview_save(%L, %L, 'pupils', %L, '{"guardian_name": 0}'::jsonb, %L, 3, '{}'::jsonb, '[]'::jsonb)$q$, tests.tid('a'), tests.rid('job2'), repeat('a', 64), repeat('b', 64))), '22023', 'E2 a kind outside customers, stock and students is invalid');
select is(pg_temp.try('a_sales', format($q$select public.import_job_preview_save(%L, %L, 'students', %L, '{"guardian_name": 0}'::jsonb, %L, 3, '{}'::jsonb, '[]'::jsonb)$q$, tests.tid('a'), tests.rid('job3'), repeat('a', 64), repeat('b', 64))), '42501', 'E3 DENY: Sales');
select * from finish();
rollback;
