-- Job DP part 2 (migration 20261130090000): the SEND LOG of marks messages. The platform never stores a child's marks: the table holds who was written to, when, which template, what happened.
--   A school only   B who may   C guardians from phone numbers   D the Owner approves (begin)   E what the channel said (finish)   F the log never changes   G reading   H what the table can never hold
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.val1(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

-- tenant b is a school; tenant a (the default pack) is not
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) select tests.tid('b'), 'education', max(version), 'operator' from packs.pack_versions where code = 'education'
  on conflict (tenant_id) do update set pack_code = excluded.pack_code, pack_version = excluded.pack_version;

-- guardians of the school (invented numbers in the reserved range)
insert into public.contacts (id, tenant_id, full_name, phone) values
  (tests.rid('g1'), tests.tid('b'), 'Guardian One', '+00 90000 00001'),
  (tests.rid('g2'), tests.tid('b'), 'Guardian Two', '+00 90000 00002'),
  (tests.rid('g3'), tests.tid('b'), 'Guardian Three', '+00 90000 00003'),
  (tests.rid('g4'), tests.tid('b'), 'Guardian Four', '+00 90000 00004'),
  (tests.rid('g5'), tests.tid('b'), 'Guardian Five', '+00 90000 00005'),
  (tests.rid('g1b'), tests.tid('b'), 'Guardian One Twin', '+00 90000 00001');
update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out' where id = tests.rid('g3');
update public.contacts set whatsapp_consent = 'withdrawn' where id = tests.rid('g4');
alter table public.contacts disable trigger contacts_guard_erased;
update public.contacts set erased_at = now(), archived_at = now() where id = tests.rid('g5');
alter table public.contacts enable trigger contacts_guard_erased;

create function pg_temp.res(p_user text, p_tenant text, p_phones text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.marks_send_resolve(%L, %L::text[])::text$q$, tests.tid(p_tenant), p_phones)) $$;
create function pg_temp.beg(p_user text, p_tenant text, p_batch text, p_items text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.marks_send_begin(%L, %L, %L::jsonb)::text$q$, tests.tid(p_tenant), tests.rid(p_batch), p_items)) $$;
create function pg_temp.fin(p_user text, p_tenant text, p_batch text, p_items text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.marks_send_finish(%L, %L, %L::jsonb)::text$q$, tests.tid(p_tenant), tests.rid(p_batch), p_items)) $$;
create function pg_temp.item(p_seq int, p_contact text, p_template text default 'marks.en') returns text language sql as $$
  select jsonb_build_object('seq', p_seq, 'contact_id', tests.rid(p_contact), 'template_id', p_template)::text $$;

-- ============================================================================ A. school only
select is(pg_temp.res('a_owner', 'a', '{9000000001}'), 'ERR:SM701', 'A1 a business without the school module cannot resolve guardians');
select is(pg_temp.beg('a_owner', 'a', 'x1', '[' || pg_temp.item(1, 'a_contact') || ']'), 'ERR:SM701', 'A2 ...cannot approve a batch');
select is(pg_temp.fin('a_owner', 'a', 'x1', '[{"seq":1,"status":"sent"}]'), 'ERR:SM701', 'A3 ...cannot finish one');
select is(pg_temp.val('a_owner', format($q$select public.marks_send_batches(%L, 10, null)::text$q$, tests.tid('a'))), 'ERR:SM701', 'A4 ...cannot read the log');
select is(pg_temp.sc(format($q$insert into public.marks_send_log (tenant_id, batch_id, seq, contact_id, template_id, status, approved_by) values (%L, %L, 1, %L, 'marks.en', 'pending', %L)$q$,
                            tests.tid('a'), tests.rid('x1'), tests.rid('a_contact'), tests.uid('a_owner'))), 'SM701', 'A5 and the table itself refuses a row (the module guard)');

-- ============================================================================ B. who may
select isnt(pg_temp.res('b_owner', 'b', '{9000000001}'), 'ERR:42501', 'B1 the Owner resolves');
select isnt(pg_temp.res('b_admin', 'b', '{9000000001}'), 'ERR:42501', 'B2 an Admin resolves (the preview)');
select is(pg_temp.res('b_sales', 'b', '{9000000001}'), 'ERR:42501', 'B3 DENY: Sales');
select is(pg_temp.res('b_viewer', 'b', '{9000000001}'), 'ERR:42501', 'B4 DENY: a Viewer');
select is(pg_temp.res('a_owner', 'b', '{9000000001}'), 'ERR:42501', 'B5 DENY: another business''s Owner');
select is(pg_temp.res('anon', 'b', '{9000000001}'), 'ERR:42501', 'B6 DENY: anon');
select is(pg_temp.beg('b_admin', 'b', 'b1', '[' || pg_temp.item(1, 'g1') || ']'), 'ERR:42501', 'B7 DENY: an Admin cannot approve a send (the Owner does)');
select is(pg_temp.beg('b_sales', 'b', 'b1', '[' || pg_temp.item(1, 'g1') || ']'), 'ERR:42501', 'B8 DENY: Sales');
select is(pg_temp.beg('a_owner', 'b', 'b1', '[' || pg_temp.item(1, 'g1') || ']'), 'ERR:42501', 'B9 DENY: another business''s Owner');
select is(pg_temp.val1('b_owner', format($q$select public.marks_send_begin(%L, %L, %L::jsonb)::text$q$, tests.tid('b'), tests.rid('b1'), '[' || pg_temp.item(1, 'g1') || ']')), 'ERR:SM306', 'B10 the Owner needs the second factor to approve');
select is(pg_temp.val1('b_owner', format($q$select public.marks_send_finish(%L, %L, %L::jsonb)::text$q$, tests.tid('b'), tests.rid('b1'), '[{"seq":1,"status":"sent"}]')), 'ERR:SM306', 'B11 ...and to finish');
select is((select count(*)::int from public.marks_send_log), 0, 'B12 nothing refused wrote a row');

-- ============================================================================ C. guardians from phone numbers
select is((select pg_temp.res('b_owner', 'b', '{9000000002,"+91 90000 00002","09000000002",99999,"९००००००००२"}')::jsonb -> 0 ->> 'state'), 'ok', 'C1 a ten-digit number finds the guardian');
select is((select array_agg(e ->> 'contact_id' order by o)::text from jsonb_array_elements(pg_temp.res('b_owner', 'b', '{9000000002,"+91 90000 00002","09000000002","९००००००००२"}')::jsonb) with ordinality as t(e, o)),
          (select array_fill(tests.rid('g2')::text, array[4])::text), 'C2 +91, a leading 0 and Devanagari digits find the same guardian');
select is((select pg_temp.res('b_owner', 'b', '{99999}')::jsonb -> 0 ->> 'state'), 'unknown', 'C3 a number nobody holds is unknown');
select is((select pg_temp.res('b_owner', 'b', '{9000000001}')::jsonb -> 0 ->> 'contact_id'), tests.rid('g1')::text, 'C4 a number two contacts hold is the OLDEST contact''s');
select is((select pg_temp.res('b_owner', 'b', '{9000000003}')::jsonb -> 0 ->> 'reason'), 'suppressed', 'C5 an opted-out guardian is blocked: suppressed');
select is((select pg_temp.res('b_owner', 'b', '{9000000004}')::jsonb -> 0 ->> 'reason'), 'consent_withdrawn', 'C6 WhatsApp consent withdrawn is blocked');
select is((select pg_temp.res('b_owner', 'b', '{9000000005}')::jsonb -> 0 ->> 'state'), 'blocked', 'C7 an erased guardian is blocked');
select is(pg_temp.res('b_owner', 'b', '{}'), 'ERR:22023', 'C8 no numbers is invalid');
select is((select jsonb_array_length(pg_temp.res('b_owner', 'b', '{9000000001,9000000002,9000000001}')::jsonb)), 3, 'C9 one answer per number, in order');
select is(pg_temp.val('b_owner', format($q$select public.marks_send_resolve(%L, null::text[])::text$q$, tests.tid('b'))), 'ERR:22023', 'C10 null is invalid');
select is((select pg_temp.res('a_owner', 'a', '{9000000001}')), 'ERR:SM701', 'C11 the other business does not see the school''s guardians');

-- ============================================================================ D. the Owner approves (begin)
select is(pg_temp.beg('b_owner', 'b', 'd1', '[' || pg_temp.item(1, 'g1') || ',' || pg_temp.item(2, 'g2', 'marks.te') || ',' || pg_temp.item(3, 'g3') || ',' || pg_temp.item(4, 'g4', 'report_ready.hi') || ',' || pg_temp.item(5, 'g5') || ']')::jsonb,
          '{"blocked": 3, "already": 0, "to_send": [1, 2]}'::jsonb, 'D1 two lines to send, three blocked (opted out, consent withdrawn, erased)');
select is((select string_agg(seq || ':' || status || ':' || coalesce(reason, '-'), ',' order by seq) from public.marks_send_log where batch_id = tests.rid('d1')),
          '1:pending:-,2:pending:-,3:blocked:suppressed,4:blocked:consent_withdrawn,5:blocked:erased', 'D2 the log says so');
select is((select approved_by from public.marks_send_log where batch_id = tests.rid('d1') and seq = 1), tests.uid('b_owner'), 'D3 it says who approved');
select is(pg_temp.beg('b_owner', 'b', 'd1', '[' || pg_temp.item(1, 'g1') || ',' || pg_temp.item(2, 'g2', 'marks.te') || ',' || pg_temp.item(6, 'g1b') || ']')::jsonb, '{"blocked": 0, "already": 2, "to_send": [6]}'::jsonb,
          'D4 the same batch again: lines 1 and 2 are NOT sent again, a new line is');
select is((select count(*)::int from public.marks_send_log where batch_id = tests.rid('d1')), 6, 'D5 six rows, none twice');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[' || pg_temp.item(1, 'g1', 'marks.ta') || ']'), 'ERR:22023', 'D6 a template id that does not exist is invalid');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[' || pg_temp.item(1, 'g1', 'marks.en 80/100') || ']'), 'ERR:22023', 'D7 a template id cannot carry anything else (no marks)');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[{"seq":0,"contact_id":"' || tests.rid('g1') || '","template_id":"marks.en"}]'), 'ERR:22023', 'D8 line 0 is invalid');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[{"seq":"1","contact_id":"' || tests.rid('g1') || '","template_id":"marks.en"}]'), 'ERR:22023', 'D9 a line number must be a number');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[]'), 'ERR:22023', 'D10 an empty batch is invalid');
select is(pg_temp.beg('b_owner', 'b', 'd2', '{}'), 'ERR:22023', 'D11 not a list is invalid');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[' || pg_temp.item(1, 'a_contact') || ']'), 'ERR:23503', 'D12 a contact of another business is "not found"');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[{"seq":1,"contact_id":"not-a-uuid","template_id":"marks.en"}]'), 'ERR:22023', 'D13 a bad contact id is invalid');
select is(pg_temp.beg('b_owner', 'b', 'd2', '[{"seq":1,"contact_id":"' || tests.rid('g1') || '","template_id":"marks.en","marks":"80"}]')::jsonb ->> 'blocked', '0', 'D14 an extra key (marks) is ignored: it is never read, never stored');
select is((select count(*)::int from public.marks_send_log where batch_id = tests.rid('d2')), 1, 'D15 ...only the line was logged');
select is((select count(*)::int from public.marks_send_log where batch_id = tests.rid('d2') and seq in (0, 1) and contact_id = tests.rid('g1')), 1, 'D16 invalid lines wrote nothing');

-- ============================================================================ E. what the channel said (finish)
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":1,"status":"sent"},{"seq":2,"status":"failed","reason":"provider_unreachable"}]'), '{"updated": 2}', 'E1 pending -> sent and failed');
select is((select status || ':' || (sent_at is not null)::text from public.marks_send_log where batch_id = tests.rid('d1') and seq = 1), 'sent:true', 'E2 a sent row has its time');
select is((select status || ':' || reason || ':' || (sent_at is null)::text from public.marks_send_log where batch_id = tests.rid('d1') and seq = 2), 'failed:provider_unreachable:true', 'E3 a failed row has its closed reason and no time');
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":1,"status":"failed","reason":"provider_refused"}]'), '{"updated": 0}', 'E4 a row already finished does not change');
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":3,"status":"sent"}]'), '{"updated": 0}', 'E5 a blocked row is never "sent"');
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":6,"status":"sent","reason":"x"}]'), 'ERR:22023', 'E6 sent takes no reason');
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":6,"status":"failed"}]'), 'ERR:22023', 'E7 failed needs a reason');
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":6,"status":"failed","reason":"the child scored 40"}]'), 'ERR:22023', 'E8 the reason is a closed word: free text (a child''s marks) is refused');
select is(pg_temp.fin('b_owner', 'b', 'd1', '[{"seq":6,"status":"pending"}]'), 'ERR:22023', 'E9 pending is not a result');
select is(pg_temp.fin('b_admin', 'b', 'd1', '[{"seq":6,"status":"sent"}]'), 'ERR:42501', 'E10 DENY: an Admin cannot finish');
select is(pg_temp.fin('a_owner', 'b', 'd1', '[{"seq":6,"status":"sent"}]'), 'ERR:42501', 'E11 DENY: another business');
select is(pg_temp.fin('b_owner', 'b', 'nope', '[{"seq":6,"status":"sent"}]'), '{"updated": 0}', 'E12 a batch that does not exist changes nothing');
select is((select status from public.marks_send_log where batch_id = tests.rid('d1') and seq = 6), 'pending', 'E13 line 6 is still pending');

-- ============================================================================ F. the log never changes
select is(pg_temp.sc(format($q$update public.marks_send_log set status = 'pending', sent_at = null where batch_id = %L and seq = 1$q$, tests.rid('d1'))), '42501', 'F1 a sent row never goes back');
select is(pg_temp.sc(format($q$update public.marks_send_log set template_id = 'marks.hi' where batch_id = %L and seq = 6$q$, tests.rid('d1'))), '42501', 'F2 a pending row''s template cannot be rewritten');
select is(pg_temp.sc(format($q$update public.marks_send_log set contact_id = %L where batch_id = %L and seq = 6$q$, tests.rid('g2'), tests.rid('d1'))), '42501', 'F3 nor its guardian');
select is(pg_temp.sc(format($q$delete from public.marks_send_log where batch_id = %L$q$, tests.rid('d1'))), '42501', 'F4 a row is never deleted');
select is(pg_temp.sc('truncate public.marks_send_log'), '42501', 'F5 nor truncated');
select is(pg_temp.val('b_owner', $q$insert into public.marks_send_log (tenant_id, batch_id, seq, contact_id, template_id, status, approved_by) values (gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 'marks.en', 'sent', gen_random_uuid())$q$), 'ERR:42501', 'F6 a client cannot insert directly');
select is(pg_temp.val('b_owner', $q$update public.marks_send_log set status = 'sent'$q$), 'ERR:42501', 'F7 a client cannot update directly');
select is(pg_temp.val('b_owner', $q$delete from public.marks_send_log$q$), 'ERR:42501', 'F8 nor delete');
select is(pg_temp.sc(format($q$insert into public.marks_send_log (tenant_id, batch_id, seq, contact_id, template_id, status, approved_by) values (%L, %L, 9, %L, 'marks.en', 'sent', %L)$q$,
                            tests.tid('b'), tests.rid('f1'), tests.rid('g1'), tests.uid('b_owner'))), '23514', 'F9 a sent row needs a time');
select is(pg_temp.sc(format($q$insert into public.marks_send_log (tenant_id, batch_id, seq, contact_id, template_id, status, reason, approved_by) values (%L, %L, 9, %L, 'marks.en', 'blocked', 'provider_refused', %L)$q$,
                            tests.tid('b'), tests.rid('f1'), tests.rid('g1'), tests.uid('b_owner'))), '23514', 'F10 a blocked row takes a block reason, not a provider one');
select is(pg_temp.sc(format($q$insert into public.marks_send_log (tenant_id, batch_id, seq, contact_id, template_id, status, approved_by) values (%L, %L, 9, %L, 'marks.en', 'pending', %L)$q$,
                            tests.tid('b'), tests.rid('f1'), tests.rid('a_contact'), tests.uid('b_owner'))), '23503', 'F11 a guardian of another business cannot be referenced (composite key)');

-- ============================================================================ G. reading
select is((select pg_temp.val('b_owner', format($q$select public.marks_send_batches(%L, 10, null)::text$q$, tests.tid('b')))::jsonb -> 'items' -> 0 ->> 'batch_id'), tests.rid('d2')::text, 'G1 the batches, newest first');
select is((select pg_temp.val('b_owner', format($q$select (public.marks_send_batches(%L, 10, null)::jsonb -> 'items')::text$q$, tests.tid('b')))::jsonb -> 1 ->> 'sent'), '1', 'G2 a batch line counts what was sent');
select is((select pg_temp.val('b_admin', format($q$select public.marks_send_batch(%L, %L)::text$q$, tests.tid('b'), tests.rid('d1')))::jsonb ->> 'total'), '6', 'G3 an Admin reads a batch');
select is((select pg_temp.val('b_admin', format($q$select public.marks_send_batch(%L, %L)::text$q$, tests.tid('b'), tests.rid('d1')))::jsonb -> 'rows' -> 0 ->> 'guardian_name'), 'Guardian One', 'G4 each row names the guardian (an adult)');
select is((select pg_temp.val('b_admin', format($q$select public.marks_send_batch(%L, %L)::text$q$, tests.tid('b'), tests.rid('d1')))::jsonb -> 'rows' -> 4 ->> 'guardian_name'), null, 'G5 an erased guardian''s name is not shown');
select is(pg_temp.val('b_sales', format($q$select public.marks_send_batch(%L, %L)::text$q$, tests.tid('b'), tests.rid('d1'))), 'ERR:42501', 'G6 DENY: Sales');
select is(pg_temp.val('a_owner', format($q$select public.marks_send_batch(%L, %L)::text$q$, tests.tid('b'), tests.rid('d1'))), 'ERR:42501', 'G7 DENY: another business');
select is(pg_temp.val('b_owner', format($q$select public.marks_send_batch(%L, %L)::text$q$, tests.tid('b'), tests.rid('nope'))), 'ERR:23503', 'G8 a batch that does not exist is "not found"');
select is(pg_temp.val('b_owner', format($q$select count(*)::text from public.marks_send_log$q$)), '7', 'G9 the Owner reads the table through RLS');
select is(pg_temp.val('b_sales', format($q$select count(*)::text from public.marks_send_log$q$)), '0', 'G10 Sales sees no row');
select is(pg_temp.val('b_viewer', format($q$select count(*)::text from public.marks_send_log$q$)), '0', 'G11 a Viewer sees no row');
select is(pg_temp.val('a_owner', format($q$select count(*)::text from public.marks_send_log$q$)), '0', 'G12 another business sees no row');
select is(pg_temp.val('b_owner', format($q$select public.marks_send_batches(%L, 0, null)::text$q$, tests.tid('b'))), 'ERR:22023', 'G13 a limit of 0 is invalid');

-- ============================================================================ H. what the table can never hold
select is((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'marks_send_log'),
          'id,tenant_id,batch_id,seq,contact_id,template_id,status,reason,approved_by,created_at,sent_at', 'H1 the table has exactly these columns: no marks, no child, no subject, no term, no text');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'marks_send_log' and data_type in ('text', 'jsonb', 'json', 'bytea') and column_name not in ('template_id', 'status', 'reason')), 0,
          'H2 the only text columns are the three closed words');
select is((select count(*)::int from pg_constraint where conrelid = 'public.marks_send_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'template_id'), 1, 'H3 the template id is held by a closed pattern');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'marks_send%' and p.prosecdef and not coalesce(p.proconfig::text ~ 'search_path', false)), 0, 'H4 every function pins its search path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'marks_send%' and has_function_privilege('anon', p.oid, 'execute')), 0, 'H5 anon can run none of them');

select * from finish();
rollback;
