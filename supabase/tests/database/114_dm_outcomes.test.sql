-- Job DM (C1 part; migration 20261129090000): OUTCOMES of calls and WhatsApp follow-ups.
--   A who may record   B what is refused   C the same source twice   D the AI (the channel account)   E correction   F reading: the timeline, a day, the totals   G education: no reason   H guards and doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select app.operator_register_channel_agent('x6@test.local');

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
-- record: (tenant, contact, source name, outcome, category, reason, when)
create function pg_temp.rec(p_user text, p_name text, p_outcome text, p_category text, p_reason text default null, p_at text default '2026-10-26T11:00:00+05:30', p_kind text default 'call', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.outcome_record(%L, %L, null, %L, %L, %L, %L, %L, %L)::text$q$,
                                    tests.tid(p_tenant), tests.rid(p_tenant || '_contact'), p_kind, tests.rid(p_name), p_outcome, p_category, p_reason, p_at)) $$;
create function pg_temp.j(p_text text, p_key text) returns text language sql as $$ select case when p_text like 'ERR:%' then p_text else (p_text::jsonb ->> p_key) end $$;

-- ============================================================================ A. who may record
select is(pg_temp.j(pg_temp.rec('a_owner', 'o1', 'positive', 'interested', 'Asked for the price list.'), 'outcome'), 'positive', 'A1 an Owner records an outcome');
select is(pg_temp.j(pg_temp.rec('a_admin', 'o2', 'negative', 'too_costly'), 'category'), 'too_costly', 'A2 an Admin records one');
select is(pg_temp.j(pg_temp.rec('a_sales', 'o3', 'unclear', null), 'outcome'), 'unclear', 'A3 a Sales person records one (unclear, no category)');
select is(pg_temp.rec('a_viewer', 'o4', 'positive', 'interested'), 'ERR:42501', 'A4 DENY: a Viewer');
select is(pg_temp.rec('b_owner', 'o5', 'positive', 'interested'), 'ERR:42501', 'A5 DENY: another business''s Owner');
select is(pg_temp.rec('anon', 'o6', 'positive', 'interested'), 'ERR:42501', 'A6 DENY: anon');
select is(pg_temp.j(pg_temp.rec('a_owner', 'o1', 'negative', 'not_interested'), 'recorded_by'), 'person', 'A7 a person''s row says so');
select is((select count(*)::int from public.outcomes where tenant_id = tests.tid('a')), 3, 'A8 three rows (the denied ones wrote nothing)');
select is((select ai_outcome is null and ai_category is null from public.outcomes where source_id = tests.rid('o1')), true, 'A9 a person''s row has no "what the AI said"');

-- ============================================================================ B. what is refused
select is(pg_temp.rec('a_owner', 'b1', 'positive', 'not_interested'), 'ERR:22023', 'B1 the category must belong to the outcome (positive + not_interested)');
select is(pg_temp.rec('a_owner', 'b2', 'negative', 'interested'), 'ERR:22023', 'B2 (negative + interested)');
select is(pg_temp.rec('a_owner', 'b3', 'positive', null), 'ERR:22023', 'B3 positive needs a category');
select is(pg_temp.rec('a_owner', 'b4', 'unclear', 'interested'), 'ERR:22023', 'B4 unclear takes call_back_later or none');
select is(pg_temp.rec('a_owner', 'b5', 'maybe', null), 'ERR:22023', 'B5 an unknown outcome word');
select is(pg_temp.rec('a_owner', 'b6', 'positive', 'interested', null, '2026-10-27T11:00:00+05:30'), 'ERR:22023', 'B6 not in the future');
select is(pg_temp.rec('a_owner', 'b7', 'positive', 'interested', null, '2026-09-01T11:00:00+05:30'), 'ERR:22023', 'B7 not older than 30 days');
select is(pg_temp.rec('a_owner', 'b8', 'positive', 'interested', repeat('x', 201)), 'ERR:22023', 'B8 a reason of at most 200 characters');
select is(pg_temp.rec('a_owner', 'b9', 'positive', 'interested', 'a' || chr(8238) || 'b'), 'ERR:22023', 'B9 a reason with a direction override is refused (clean text)');
select is(pg_temp.rec('a_owner', 'b10', 'positive', 'interested', null, '2026-10-26T11:00:00+05:30', 'email'), 'ERR:22023', 'B10 the kind is call or whatsapp_followup');
select is(pg_temp.val('a_owner', format($q$select public.outcome_record(%L, %L, null, 'call', %L, 'positive', 'interested', null, '2026-10-26T11:00:00+05:30')::text$q$, tests.tid('a'), tests.rid('b_contact'), tests.rid('b11'))), 'ERR:23503', 'B11 a contact of another business is "not found"');
select is(pg_temp.val('a_owner', format($q$select public.outcome_record(%L, %L, %L, 'call', %L, 'positive', 'interested', null, '2026-10-26T11:00:00+05:30')::text$q$, tests.tid('a'), tests.rid('a_contact'), tests.rid('b_lead'), tests.rid('b12'))), 'ERR:23503', 'B12 a lead of another business is "not found"');
insert into public.contacts (id, tenant_id, company_id, full_name) values (tests.rid('a_gone'), tests.tid('a'), tests.rid('a_company'), 'Contact gone');
alter table public.contacts disable trigger contacts_guard_erased;
update public.contacts set erased_at = now(), archived_at = now() where id = tests.rid('a_gone');
alter table public.contacts enable trigger contacts_guard_erased;
select is(pg_temp.val('a_owner', format($q$select public.outcome_record(%L, %L, null, 'call', %L, 'positive', 'interested', null, '2026-10-26T11:00:00+05:30')::text$q$, tests.tid('a'), tests.rid('a_gone'), tests.rid('b13'))), 'ERR:23503', 'B13 an erased contact takes no outcome');
select is((select count(*)::int from public.outcomes), 3, 'B14 nothing refused wrote a row');

-- ============================================================================ C. the same source twice
select is(pg_temp.j(pg_temp.rec('a_owner', 'o1', 'negative', 'wrong_number'), 'replayed'), 'true', 'C1 the same (kind, source) again: replayed');
select is((select outcome from public.outcomes where source_id = tests.rid('o1')), 'positive', 'C2 ...and the first word stands');
select is(pg_temp.j(pg_temp.rec('a_owner', 'o1', 'negative', 'wrong_number', null, '2026-10-20T11:00:00+05:30', 'whatsapp_followup'), 'replayed'), 'false', 'C3 the same id as another KIND is a different source');

-- ============================================================================ D. the AI (the registered channel account)
select is(pg_temp.j(pg_temp.rec('x6', 'd1', 'positive', 'order_likely', 'Said they will order.'), 'recorded_by'), 'ai', 'D1 the channel account records a call outcome in any business: recorded_by ai');
select is((select ai_outcome || '/' || ai_category from public.outcomes where source_id = tests.rid('d1')), 'positive/order_likely', 'D2 what the AI said is kept in ai_outcome and ai_category');
select is(pg_temp.rec('x6', 'd2', 'positive', 'interested', null, '2026-10-26T11:00:00+05:30', 'whatsapp_followup'), 'ERR:22023', 'D3 a WhatsApp follow-up outcome needs a follow-up we really sent in the last 14 days');
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by)
values (tests.rid('m1'), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'whatsapp', 'Synthetic follow-up', 'en', 'followup', 'queued', 'auto_allowed', md5('m1') || md5('m1'), tests.uid('a_owner'));
update public.outbox_messages set status = 'sent', sent_at = '2026-10-24T10:00:00+05:30', adapter = 'fake', adapter_message_id = 'fake-m1' where id = tests.rid('m1');
select is(pg_temp.j(pg_temp.rec('x6', 'd2', 'positive', 'interested', 'Showed interest or asked for details.', '2026-10-26T11:00:00+05:30', 'whatsapp_followup'), 'outcome'), 'positive', 'D4 ...and with one sent two days ago it is recorded');
select is(pg_temp.j(pg_temp.rec('x6', 'd3', 'unclear', 'call_back_later', null, '2026-10-26T11:30:00+05:30', 'whatsapp_followup'), 'replayed'), 'true', 'D5 a second reply of the SAME conversation (24 hours) is not a second outcome');
select is(pg_temp.j(pg_temp.rec('x6', 'd4', 'negative', 'not_interested', 'Asked us to stop messaging.', '2026-10-26T11:40:00+05:30', 'whatsapp_followup'), 'replayed'), 'false', 'D6 ...but a NEGATIVE word turns the AI''s positive one into a negative');
select is((select outcome || '/' || category || '/' || ai_outcome from public.outcomes where source_id = tests.rid('d2')), 'negative/not_interested/negative', 'D7 the row now says negative (ai_outcome follows the AI''s latest word)');
select is(pg_temp.j(pg_temp.rec('x6', 'd5', 'positive', 'interested', null, '2026-10-26T11:50:00+05:30', 'whatsapp_followup'), 'replayed'), 'true', 'D8 a later positive word never undoes a negative one');
select is(pg_temp.j(pg_temp.rec('x6', 'd6', 'positive', 'interested', null, '2026-10-28T09:00:00+05:30', 'whatsapp_followup'), 'outcome'), 'ERR:22023', 'D9 (a time in the future is refused for the AI too)');
select pg_temp.pin('2026-10-28T12:00:00+05:30'::timestamptz);
select is(pg_temp.j(pg_temp.rec('x6', 'd6', 'positive', 'interested', null, '2026-10-28T09:00:00+05:30', 'whatsapp_followup'), 'replayed'), 'false', 'D10 two days later it is a new conversation: a new outcome (the sent follow-up is still inside 14 days)');
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select is(pg_temp.val('a_owner', format($q$select public.outcome_correct(%L, %L, 'positive', 'order_likely', null)::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('d1')))) is not null, true, 'D11 (setup) the owner corrects the AI''s call outcome');
select is(pg_temp.j(pg_temp.rec('x6', 'd7', 'negative', 'not_interested', null, '2026-10-26T11:45:00+05:30', 'whatsapp_followup'), 'replayed'), 'true', 'D12 the AI''s word is a repeat inside the conversation of d2 (still the same 24 hours)');

-- ============================================================================ E. correction
select is(pg_temp.j(pg_temp.val('a_owner', format($q$select public.outcome_correct(%L, %L, 'negative', 'too_costly', 'Said the price is too high.')::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('d1')))), 'corrected'), 'true', 'E1 the Owner corrects what the AI said: corrected = true');
select is((select outcome || '/' || category || '/' || ai_outcome || '/' || ai_category from public.outcomes where source_id = tests.rid('d1')), 'negative/too_costly/positive/order_likely', 'E2 the word changed; what the AI said is kept');
select is((select corrected_by = tests.uid('a_owner') and corrected_at = app.outbox_now() from public.outcomes where source_id = tests.rid('d1')), true, 'E3 who and when are recorded');
select is(pg_temp.val('a_admin', format($q$select public.outcome_correct(%L, %L, 'unclear', null, null)::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('o2')))) like '%"unclear"%', true, 'E4 an Admin may correct');
select is(pg_temp.val('a_sales', format($q$select public.outcome_correct(%L, %L, 'unclear', null, null)::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('o2')))), 'ERR:42501', 'E5 DENY: a Sales person may record but not correct');
select is(pg_temp.val('a_viewer', format($q$select public.outcome_correct(%L, %L, 'unclear', null, null)::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('o2')))), 'ERR:42501', 'E6 DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.outcome_correct(%L, %L, 'unclear', null, null)::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('o2')))), 'ERR:42501', 'E7 DENY: another business');
select is(pg_temp.val('b_owner', format($q$select public.outcome_correct(%L, %L, 'unclear', null, null)::text$q$, tests.tid('b'), (select id from public.outcomes where source_id = tests.rid('o2')))), 'ERR:23503', 'E8 an outcome of another business is "not found" through one''s own workspace');
select is(pg_temp.val('a_owner', format($q$select public.outcome_correct(%L, %L, 'positive', 'too_costly', null)::text$q$, tests.tid('a'), (select id from public.outcomes where source_id = tests.rid('o2')))), 'ERR:22023', 'E9 a correction keeps the pair rule');
select is(pg_temp.j(pg_temp.rec('x6', 'd8', 'positive', 'interested', null, '2026-10-26T11:55:00+05:30', 'whatsapp_followup'), 'replayed'), 'true', 'E10 a further AI word inside a conversation already decided changes nothing');

-- ============================================================================ F. reading
select pg_temp.pin('2026-10-26T23:50:00+05:30'::timestamptz);
select pg_temp.rec('a_owner', 'f1', 'positive', 'visit_booked', 'Booked a visit.', '2026-10-26T23:30:00+05:30');   -- late on the 26th in India (18:00 UTC)
select pg_temp.rec('a_owner', 'f2', 'positive', 'interested', null, '2026-10-26T00:10:00+05:30');                  -- just after midnight in India (the 25th, 18:40 UTC)
select pg_temp.rec('a_owner', 'f3', 'negative', 'not_interested', null, '2026-10-25T23:50:00+05:30');                -- the evening before in India
select pg_temp.pin('2026-10-26T12:00:00+05:30'::timestamptz);
select is(jsonb_array_length((pg_temp.val('a_viewer', format($q$select public.outcomes_list(%L, %L, null, 100, null, null)::text$q$, tests.tid('a'), tests.rid('a_contact')))::jsonb) -> 'items'), 10, 'F1 a Viewer reads the timeline of a customer (ten outcomes so far)');
select is((pg_temp.val('a_viewer', format($q$select public.outcomes_list(%L, %L, null, 100, null, null)::text$q$, tests.tid('a'), tests.rid('a_contact')))::jsonb) -> 'items' -> 0 ->> 'kind' is not null, true, 'F2 items carry their fields');
select is((pg_temp.val('a_owner', format($q$select public.outcomes_list(%L, null, null, 3, null, null)::text$q$, tests.tid('a')))::jsonb ->> 'has_more'), 'true', 'F3 a page of three says there is more');
select is((select string_agg(x ->> 'source_id', ',' order by ord) from jsonb_array_elements((pg_temp.val('a_owner', format($q$select public.outcomes_list(%L, null, null, 2, null, null)::text$q$, tests.tid('a')))::jsonb) -> 'items') with ordinality as t(x, ord)),
          tests.rid('d6')::text || ',' || tests.rid('f1')::text, 'F4 newest first (by when it happened, then id)');
select is((select string_agg(x ->> 'source_id', ',' order by ord) from jsonb_array_elements((pg_temp.val('a_owner', format($q$select public.outcomes_list(%L, null, null, 1, %L, %L)::text$q$, tests.tid('a'), '2026-10-28T09:00:00+05:30', (select id from public.outcomes where source_id = tests.rid('d6'))))::jsonb) -> 'items') with ordinality as t(x, ord)),
          tests.rid('f1')::text, 'F5 the next page continues after the cursor (occurred_at, id)');
select is(pg_temp.val('a_owner', format($q$select public.outcomes_list(%L, null, null, 1, %L, null)::text$q$, tests.tid('a'), '2026-10-26T23:30:00+05:30')), 'ERR:22023', 'F6 a half cursor is refused');
select is(pg_temp.val('a_owner', format($q$select public.outcomes_list(%L, null, null, 101, null, null)::text$q$, tests.tid('a'))), 'ERR:22023', 'F7 at most 100 a page');
select is(jsonb_array_length((pg_temp.val('a_owner', format($q$select public.outcomes_list(%L, null, date '2026-10-26', 100, null, null)::text$q$, tests.tid('a')))::jsonb) -> 'items'), 7, 'F8 one India day (the 26th): the one just after midnight counts for the 26th, the evening before does not');
select is(pg_temp.val('b_owner', format($q$select public.outcomes_list(%L, null, null, 5, null, null)::text$q$, tests.tid('a'))), 'ERR:42501', 'F9 DENY: another business');
select is((pg_temp.val('b_owner', format($q$select public.outcomes_list(%L, null, null, 5, null, null)::text$q$, tests.tid('b')))::jsonb) -> 'items', '[]'::jsonb, 'F10 another business sees none of a''s outcomes');
select is(pg_temp.val('anon', format($q$select public.outcomes_list(%L, null, null, 5, null, null)::text$q$, tests.tid('a'))), 'ERR:42501', 'F11 DENY: anon');
select is((pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, date '2026-10-26', date '2026-10-26')::text$q$, tests.tid('a')))::jsonb) -> 'total', '{"positive": 3, "negative": 2, "unclear": 2}'::jsonb, 'F12 totals of the 26th: every word counted once');
select is((pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, date '2026-10-26', date '2026-10-26')::text$q$, tests.tid('a')))::jsonb) -> 'days' -> 0 -> 'by_category' ->> 'visit_booked', '1', 'F13 and per category');
select is(jsonb_array_length((pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, date '2026-10-20', date '2026-10-27')::text$q$, tests.tid('a')))::jsonb) -> 'days'), 8, 'F14 a range is zero-filled: eight days');
select is((pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, date '2026-10-27', date '2026-10-27')::text$q$, tests.tid('a')))::jsonb) -> 'total', '{"positive": 0, "negative": 0, "unclear": 0}'::jsonb, 'F15 an empty day is all zeros');
select is((pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, null, null)::text$q$, tests.tid('a')))::jsonb) ->> 'from_day', '2026-10-26', 'F16 no dates = today (India)');
select is(pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, date '2026-01-01', date '2026-10-26')::text$q$, tests.tid('a'))), 'ERR:22023', 'F17 at most 92 days');
select is(pg_temp.val('a_viewer', format($q$select public.outcomes_totals(%L, date '2026-10-26', date '2026-10-25')::text$q$, tests.tid('a'))), 'ERR:22023', 'F18 to before from is refused');
select is(pg_temp.val('b_viewer', format($q$select public.outcomes_totals(%L, null, null)::text$q$, tests.tid('a'))), 'ERR:42501', 'F19 DENY: another business');

-- the customer page (a lead's): the lead's own and its contact's outcomes
select is(jsonb_array_length(pg_temp.val('a_sales', format($q$select public.outcomes_for_lead(%L, %L, 100)::text$q$, tests.tid('a'), tests.rid('a_lead')))::jsonb), 10, 'F20 the customer page of a lead lists the outcomes of its contact (ten)');
select is(pg_temp.val('a_sales', format($q$select (public.outcomes_for_lead(%L, %L, 1) -> 0 ->> 'source_id')$q$, tests.tid('a'), tests.rid('a_lead'))), tests.rid('d6')::text, 'F21 newest first');
select is(pg_temp.val('a_viewer', format($q$select public.outcomes_for_lead(%L, %L, 10)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'F22 DENY: a Viewer (Owner, Admin, Sales only)');
select is(pg_temp.val('b_owner', format($q$select public.outcomes_for_lead(%L, %L, 10)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'F23 DENY: another business');
select is(pg_temp.val('a_owner', format($q$select public.outcomes_for_lead(%L, %L, 10)::text$q$, tests.tid('a'), tests.rid('b_lead'))), 'ERR:23503', 'F24 a lead of another business is "not found"');
select is(pg_temp.val('a_owner', format($q$select public.outcomes_for_lead(%L, %L, 0)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:22023', 'F25 a limit of 1 to 100');

-- ============================================================================ G. education: no reason, ever
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), 'education', max(version), 'operator' from packs.pack_versions where code = 'education'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;
select is(pg_temp.j(pg_temp.rec('b_owner', 'g1', 'positive', 'visit_booked', 'Mother of a Class 5 pupil wants a visit', '2026-10-26T11:00:00+05:30', 'call', 'b'), 'reason') is null, true, 'G1 an education workspace stores no reason (nothing a sentence could carry)');
select is((select reason is null from public.outcomes where source_id = tests.rid('g1')), true, 'G2 ...in the table either');
select is(pg_temp.j(pg_temp.val('b_owner', format($q$select public.outcome_correct(%L, %L, 'negative', 'too_costly', 'Fee too high for the child')::text$q$, tests.tid('b'), (select id from public.outcomes where source_id = tests.rid('g1')))), 'reason') is null, true, 'G3 ...nor through a correction');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'outcomes' and (column_name ilike '%student%' or column_name ilike '%child%' or column_name ilike '%pupil%')), 0, 'G4 the table has no column that could name a student or a child');
select is((select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'outcomes' and c.contype = 'f' and c.confrelid = 'public.students'::regclass), 0, 'G5 and no reference to the students table');

-- ============================================================================ H. guards and doors
select is(tests.outcome_as(tests.uid('a_owner'), format($$insert into public.outcomes (tenant_id, contact_id, kind, source_id, outcome, recorded_by_kind, occurred_at) values (%L, %L, 'call', %L, 'unclear', 'person', now())$$, tests.tid('a'), tests.rid('a_contact'), tests.rid('h1'))), '42501', 'H1 DENY: a client cannot insert a row');
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.outcomes set outcome = 'negative', category = 'not_interested' where tenant_id = %L$$, tests.tid('a'))), '42501', 'H2 DENY: nor update one');
select is(tests.outcome_as(tests.uid('a_owner'), format($$delete from public.outcomes where tenant_id = %L$$, tests.tid('a'))), '42501', 'H3 DENY: nor delete one');
select is(pg_temp.sc(format($$delete from public.outcomes where id = %L$$, (select id from public.outcomes limit 1))), '42501', 'H4 not even the table''s owner deletes (the guard)');
select ok(pg_temp.sc('truncate public.outcomes') in ('42501', '0A000'), 'H5 nor truncates (no privilege, and since job DR a table references it)');
select is(pg_temp.sc(format($$update public.outcomes set source_id = %L where source_id = %L$$, tests.rid('h2'), tests.rid('o2'))), '42501', 'H6 what an outcome IS (its source) never changes');
select is(pg_temp.sc(format($$update public.outcomes set contact_id = %L where source_id = %L$$, tests.rid('a_contact'), tests.rid('o2'))), 'ok', 'H7 (the same value is no change)');
select is(pg_temp.sc(format($$update public.outcomes set ai_outcome = 'negative' where source_id = %L$$, tests.rid('d1'))), '42501', 'H8 what the AI said is kept once a person corrected it');
select is(pg_temp.sc(format($$update public.outcomes set reason = 'erased:1' where source_id = %L$$, tests.rid('o1'))), 'ok', 'H9 an erasure may blank a reason');
select is((select count(*)::int from erasure.registry where table_name = 'outcomes' and column_name = 'reason'), 2, 'H10 the reason is in the erasure registry (workspace and sweep)');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.outcomes'::regclass and tgname = 'audit_outcomes'), 1, 'H11 every change is audited');
select is((select count(*)::int from pg_policies where tablename = 'outcomes' and cmd = 'SELECT'), 1, 'H12 a select policy and no write policy');
select is((select count(*)::int from pg_policies where tablename = 'outcomes' and cmd <> 'SELECT'), 0, 'H13 ...no write policy');
select is((select has_table_privilege('authenticated', 'public.outcomes', 'insert') or has_table_privilege('authenticated', 'public.outcomes', 'update') or has_table_privilege('authenticated', 'public.outcomes', 'delete')), false, 'H14 a signed-in user holds select only');
select is(pg_temp.val('a_viewer', 'select count(*)::text from public.outcomes'), '10', 'H15 a Viewer reads the ten rows of the own business (and not the education workspace''s)');
select is(pg_temp.val('b_viewer', format($$select count(*)::text from public.outcomes where tenant_id = %L$$, tests.tid('a'))), '0', 'H16 another business reads none');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('outcome_record', 'outcome_correct', 'outcomes_list', 'outcomes_totals') and p.prosecdef and p.proconfig @> array['search_path=""']), 4, 'H17 the four public functions are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('outcome_record', 'outcome_correct', 'outcomes_list', 'outcomes_totals') and has_function_privilege('anon', p.oid, 'execute')), 0, 'H18 anon cannot execute any of them');

select * from finish();
rollback;
