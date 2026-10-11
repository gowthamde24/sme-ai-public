-- Job BB (ADR 0070): the gaps the Outbox page could not draw (the English gloss, the events of a message, the filtered and paged log, the counts per tab), the worker's way to read the photos of a message
-- it has claimed (and nothing else), and quiet hours per business.
--   A catalog  B gloss  C events  D the log  E the summary  F the worker's photos  G quiet hours  H settings  I audit
--
-- THE CLOCK. The outbox clock app.outbox_now() (the AT seam) is replaced for this transaction. Sections A, B, D and H run at one pinned instant, Monday 2026-10-05 14:00 IST by default; to run them at
-- another start psql with PGOPTIONS='-c tests.bb_pin=2026-10-05T23:30:00+05:30' (nothing in them depends on the hour: the messages they make are made with a pin of their own where the hour matters).
-- Sections C, E, F and G are about WHEN things happen, so they pin their own instants (14:00, 19:30, 20:59, 21:00, 23:30, 08:59, 09:00, 09:59, 10:00 ...) and test the day and the night side by side.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.main_pin() returns void language sql as $$
  select pg_temp.pin(coalesce(nullif(current_setting('tests.bb_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz) $$;
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.mk(p_label text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:bb')$q$, tests.tid(p_tenant), tests.rid(p_label || '_c')));
  end if;
end $$;
create function pg_temp.sub(p_msg text, p_lead text, p_text text, p_gloss text default null, p_media text default '{}', p_user text default 'a_sales', p_tenant text default 'a', p_cat text default 'info') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, 'te', %L, 'assistant', false, false, %L::uuid[], false, %L)$q$,
                                   tests.rid(p_msg), tests.tid(p_tenant), tests.rid(p_lead), p_text, p_cat, p_media, p_gloss)) $$;
create function pg_temp.mst(p_msg text) returns text language sql as $$ select status || '/' || reason from public.outbox_messages where id = tests.rid(p_msg) $$;
create function pg_temp.ev(p_msg text) returns text language sql as $$
  select coalesce(string_agg(kind || coalesce(':' || reason, ''), ',' order by seq), '') from public.outbox_events where message_id = tests.rid(p_msg) $$;
create function pg_temp.act(p_msg text) returns text language sql as $$
  select coalesce(string_agg(actor_kind, ',' order by seq), '') from public.outbox_events where message_id = tests.rid(p_msg) $$;
create function pg_temp.ids(variadic p_labels text[]) returns text language sql as $$ select '{' || string_agg(tests.rid(l)::text, ',' order by ord) || '}' from unnest(p_labels) with ordinality as t(l, ord) $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.settings(p_start text default 'null', p_end text default 'null', p_user text default 'a_owner', p_aal text default 'aal2', p_tenant text default 'a', p_auto text default 'true') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.outbox_set_settings(%L, %s, 5, %s, %s)', tests.tid(p_tenant), p_auto, p_start, p_end), p_aal) $$;
create function pg_temp.list(p_args text default '', p_user text default 'a_owner', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.outbox_list(%L%s)', tests.tid(p_tenant), p_args)) $$;
create function pg_temp.listed(p_json text) returns text language sql as $$
  select case when p_json like 'ERR:%' then p_json else coalesce((select string_agg(e ->> 'id', ',' order by ord) from jsonb_array_elements(p_json::jsonb) with ordinality as t(e, ord)), '') end $$;
create function pg_temp.mine(variadic p_labels text[]) returns text language sql as $$ select string_agg(tests.rid(l)::text, ',' order by ord) from unnest(p_labels) with ordinality as t(l, ord) $$;
-- the catalogue, only as much as a message with photos needs
create function pg_temp.photo(p_item text, p_photo text) returns void language plpgsql as $$
begin
  perform pg_temp.sc('a_owner', format($q$select public.catalogue_item_save(%L, %L, 'Maroon Kanchi pattu', 'kanchi_pattu', '{maroon}'::text[], 'rich', 'Contrast border', '{wedding}'::text[], '25k_50k', 'in_stock', false, null, false)$q$,
                                       tests.rid(p_item), tests.tid('a')));
  insert into storage.objects (bucket_id, name, metadata)
  values (app.catalogue_bucket(tests.tid('a')), tests.rid(p_item)::text || '/' || tests.rid(p_photo)::text || '.jpg', jsonb_build_object('mimetype', 'image/jpeg', 'size', 1000)),
         (app.catalogue_bucket(tests.tid('a')), tests.rid(p_item)::text || '/' || tests.rid(p_photo)::text || '_t.jpg', jsonb_build_object('mimetype', 'image/jpeg', 'size', 100));
  perform pg_temp.sc('a_owner', format('select public.catalogue_photo_add(%L, %L, %L, 640, 800, 1000, 100)', tests.rid(p_photo), tests.tid('a'), tests.rid(p_item)));
  perform pg_temp.sc('a_owner', format($q$select public.catalogue_item_save(%L, %L, 'Maroon Kanchi pattu', 'kanchi_pattu', '{maroon}'::text[], 'rich', 'Contrast border', '{wedding}'::text[], '25k_50k', 'in_stock', true, null, false)$q$,
                                       tests.rid(p_item), tests.tid('a')));
end $$;

select app.operator_register_scheduler('outsider@test.local');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select pg_temp.main_pin();
select pg_temp.sc('b_owner', format('select public.catalogue_ensure_bucket(%L)', tests.tid('b')));
select pg_temp.sc('a_owner', format('select public.catalogue_ensure_bucket(%L)', tests.tid('a')));

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'outbox_events' and c.relrowsecurity and c.relforcerowsecurity), 1::bigint, 'outbox_events: row-level security is on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'outbox_events' and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'), 0::bigint, 'no client role can write the events');
select is((select count(*) from pg_trigger t where t.tgrelid = 'public.outbox_events'::regclass and not t.tgisinternal and t.tgname in ('outbox_events_no_update', 'outbox_events_no_delete', 'outbox_events_no_truncate', 'audit_outbox_events')), 4::bigint, 'the guards (update, delete, truncate) and the audit trigger are there');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('outbox_list', 'outbox_summary') and p.prosecdef and 'search_path=""' = any (p.proconfig)), 2::bigint, 'the log reads are SECURITY DEFINER with an empty search_path (the role is proven inside)');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('outbox_list', 'outbox_summary') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon cannot execute either');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('outbox_actor', 'outbox_event', 'outbox_messages_events', 'outbox_quiet_hours_of', 'outbox_events_guard')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'the event writer, the actor reader and the quiet-hours reader are callable by no client role');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('outbox_in_quiet_hours', 'outbox_next_open') and pronargs = 2 and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'the two per-business quiet-hours helpers are callable by no client role');
select is(has_function_privilege('authenticated', 'app.worker_may_read_object(text, text)', 'execute'), true, 'the storage rule can call the worker''s read check as the signed-in caller...');
select is(has_function_privilege('anon', 'app.worker_may_read_object(text, text)', 'execute'), false, '...but anon cannot');
select is(pg_temp.priv('select app.outbox_actor()') in ('ok', '42501'), true, '(sanity: the actor reader is callable here as the owner of the database)');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'outbox_events' and column_name in ('body', 'gloss_en', 'phone', 'full_name', 'note', 'text')), 0::bigint, 'NO MESSAGE TEXT or personal field in the events table');
select is((select count(*) from erasure.registry where table_name = 'outbox_messages' and column_name = 'gloss_en'), 4::bigint, 'the gloss is in the erasure registry for the four scopes');
select is((select col_description('public.outbox_messages'::regclass, a.attnum) like 'PII:%' from pg_attribute a where a.attrelid = 'public.outbox_messages'::regclass and a.attname = 'gloss_en'), true, 'the gloss column is marked PII');

-- ---------------------------------------------------------------------------------------------
-- B. the gloss
-- ---------------------------------------------------------------------------------------------
select pg_temp.settings();
select pg_temp.mk('b1'); select pg_temp.mk('b2'); select pg_temp.mk('b3');
select is(pg_temp.j(pg_temp.sub('b_m1', 'b1', 'మీ కోసం కొత్త చీరలు ఉన్నాయి.', 'We have new sarees for you.'), 'status'), 'queued', 'a message with a gloss is made like any other');
select is((select gloss_en from public.outbox_messages where id = tests.rid('b_m1')), 'We have new sarees for you.', '...and the gloss is stored with it');
select is(pg_temp.j(pg_temp.sub('b_m1', 'b1', 'మీ కోసం కొత్త చీరలు ఉన్నాయి.', 'We have new sarees for you.'), 'replayed'), 'true', 'IDEMPOTENT: the same message with the same gloss replays');
select is(pg_temp.sub('b_m1', 'b1', 'మీ కోసం కొత్త చీరలు ఉన్నాయి.', 'A different gloss.'), 'ERR:23505', 'the same id with another gloss is a conflict (23505)');
select is(pg_temp.sub('b_m1', 'b1', 'మీ కోసం కొత్త చీరలు ఉన్నాయి.'), 'ERR:23505', '...and so is the same id with none');
select is(pg_temp.j(pg_temp.sub('b_m2', 'b2', 'A note from the shop.'), 'status'), 'queued', 'a message with no gloss stays as before');
select is((select gloss_en from public.outbox_messages where id = tests.rid('b_m2')), null, '...the gloss is null');
select is(pg_temp.sub('b_m3', 'b3', 'A note from the shop.', 'x'), 'ERR:22023', 'INVALID: a gloss of one character (22023)');
select is(pg_temp.sub('b_m3', 'b3', 'A note from the shop.', repeat('y', 3001)), 'ERR:22023', 'INVALID: a gloss over 3,000 characters');
select is(pg_temp.sub('b_m3', 'b3', 'A note from the shop.', 'zero' || chr(8203) || 'width'), 'ERR:22023', 'INVALID: an invisible character in the gloss');
select is(pg_temp.j(pg_temp.sub('b_m3', 'b3', 'A note from the shop.', '   '), 'status'), 'queued', 'a gloss of only spaces is treated as none (the message is made without one)');
select is((select gloss_en from public.outbox_messages where id = tests.rid('b_m3')), null, '...and nothing blank is stored');
select is((select count(*) from public.outbox_messages where gloss_en is not null and btrim(gloss_en) = ''), 0::bigint, 'a blank gloss is never stored');
-- editing: while the message waits for approval, and only then
select pg_temp.settings(p_auto => 'false');
select pg_temp.mk('b4');
select is(pg_temp.j(pg_temp.sub('b_m4', 'b4', 'చీరలు ఉన్నాయి.', 'We have sarees.'), 'status'), 'needs_approval', 'with automatic sending off a message waits for approval');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, %L, %L)$q$, tests.tid('a'), tests.rid('b_m4'), 'కొత్త చీరలు ఉన్నాయి.', 'We have new sarees.')), 'status'), 'needs_approval', 'the Owner edits the words and the gloss together');
select is((select gloss_en from public.outbox_messages where id = tests.rid('b_m4')), 'We have new sarees.', '...the new gloss is stored');
select pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, %L)$q$, tests.tid('a'), tests.rid('b_m4'), 'మళ్ళీ కొత్త చీరలు ఉన్నాయి.'));
select is((select gloss_en from public.outbox_messages where id = tests.rid('b_m4')), null, 'EDITING THE WORDS WITHOUT A GLOSS CLEARS THE OLD GLOSS (it would describe other words)');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, %L, %L)$q$, tests.tid('a'), tests.rid('b_m4'), 'మళ్ళీ కొత్త చీరలు ఉన్నాయి.', 'x')), 'ERR:22023', 'INVALID: a one-character gloss on an edit');
select is(pg_temp.sc('a_sales', format($q$select public.outbox_edit(%L, %L, %L, %L)$q$, tests.tid('a'), tests.rid('b_m4'), 'x words', 'A gloss')), 'ERR:42501', 'Sales cannot edit (42501)');
select is(pg_temp.priv(format($q$update public.outbox_messages set gloss_en = 'Changed behind the back' where id = %L$q$, tests.rid('b_m1'))), '42501', 'GUARD: the gloss of a message that is no longer waiting for approval is never changed (42501)');
select is(pg_temp.priv(format($q$update public.outbox_messages set gloss_en = 'Changed while waiting' where id = %L$q$, tests.rid('b_m4'))), 'ok', '...while it waits it can be (the guard allows what the function allows)');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.outbox_messages'), '0', 'RLS: a Viewer reads no message, and so no gloss');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.outbox_messages where gloss_en is not null and tenant_id = ' || quote_literal(tests.tid('a'))), '0', '...nor another business');

-- ---------------------------------------------------------------------------------------------
-- C. the events of a message
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select pg_temp.settings();
select pg_temp.mk('c1'); select pg_temp.mk('c2'); select pg_temp.mk('c3'); select pg_temp.mk('c4'); select pg_temp.mk('c5'); select pg_temp.mk('c6');
-- by day, auto-allowed
select pg_temp.sub('c_m1', 'c1', 'Our shop is open today.');
select is(pg_temp.ev('c_m1'), 'made,queued:auto_allowed', 'DAY: a message Agent OWL made and the policy allowed: made, queued (auto_allowed)');
select is(pg_temp.act('c_m1'), 'assistant,system', '...by the assistant, then the system');
select is((select actor_user_id from public.outbox_events where message_id = tests.rid('c_m1') and kind = 'made'), tests.uid('a_sales'), '...and "made" names the person it was made for');
select is((select actor_user_id from public.outbox_events where message_id = tests.rid('c_m1') and kind = 'queued'), null, '...the policy''s step names nobody');
-- claim and mark by a person
create temp table claimed_c1 as select pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 50)', tests.tid('a')))::jsonb as j;
select pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-c1')$q$, tests.tid('a'), tests.rid('c_m1')));
select is(pg_temp.ev('c_m1'), 'made,queued:auto_allowed,sent', 'SENT: one more step');
select is((select actor_kind || '/' || (actor_user_id = tests.uid('a_owner'))::text from public.outbox_events where message_id = tests.rid('c_m1') and kind = 'sent'), 'person/true', '...by the person who marked it');
select pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-c1')$q$, tests.tid('a'), tests.rid('c_m1')));
select is(pg_temp.ev('c_m1'), 'made,queued:auto_allowed,sent', 'IDEMPOTENT: marking it again adds no event');
-- failed
select pg_temp.sub('c_m2', 'c2', 'Our shop is open tomorrow.');
select pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 50)', tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'failed', 'fake', null, 'timeout')$q$, tests.tid('a'), tests.rid('c_m2')));
select is(pg_temp.ev('c_m2'), 'made,queued:auto_allowed,failed:timeout', 'FAILED: with the closed failure word');
-- waiting for approval, approved by the Owner, edited, rejected
select pg_temp.settings(p_auto => 'false');
select pg_temp.sub('c_m3', 'c3', 'Our shop is open on Sunday.');
select is(pg_temp.ev('c_m3'), 'made,needs_approval:auto_off', 'WAITING: made, then waiting for approval with the reason');
select pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, 'Our shop is open on Sunday morning.')$q$, tests.tid('a'), tests.rid('c_m3')));
select is(pg_temp.ev('c_m3'), 'made,needs_approval:auto_off,edited', 'EDITED: one step, no words in it');
select is((select actor_user_id from public.outbox_events where message_id = tests.rid('c_m3') and kind = 'edited'), tests.uid('a_owner'), '...by the person who edited');
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('c_m3')));
select is(pg_temp.ev('c_m3'), 'made,needs_approval:auto_off,edited,approved', 'APPROVED BY DAY: approved (not held: it can go now)');
select is((select actor_kind || '/' || (actor_user_id = tests.uid('a_owner'))::text from public.outbox_events where message_id = tests.rid('c_m3') and kind = 'approved'), 'person/true', '...by the Owner');
select pg_temp.sub('c_m4', 'c4', 'Our shop is open on Monday.');
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'reject')$q$, tests.tid('a'), tests.rid('c_m4')));
select is(pg_temp.ev('c_m4'), 'made,needs_approval:auto_off,rejected', 'REJECTED: its own step (not "blocked")');
-- blocked by the policy before it is queued (no contact key was made for c7)
insert into public.leads (id, tenant_id, company_id) values (tests.rid('c7'), tests.tid('a'), tests.rid('a_company'));
select pg_temp.sub('c_m5', 'c7', 'Our shop is open on Tuesday.');
select is(pg_temp.ev('c_m5') like 'made,blocked:%', true, 'BLOCKED AT THE START: made, blocked with its reason (' || pg_temp.ev('c_m5') || ')');
-- by night: held
select pg_temp.settings();
select pg_temp.pin('2026-10-05 23:30:00+05:30');
select pg_temp.sub('c_m6', 'c5', 'Our shop opens at ten tomorrow.');
select is(pg_temp.ev('c_m6'), 'made,held:quiet_hours', 'NIGHT 23:30: made, then HELD for the morning (quiet_hours)');
select is(pg_temp.act('c_m6'), 'assistant,system', '...');
-- approval at night
select pg_temp.settings(p_auto => 'false');
select pg_temp.sub('c_m7', 'c6', 'Our shop opens at ten tomorrow, come over.');
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('c_m7')));
select is(pg_temp.ev('c_m7'), 'made,needs_approval:auto_off,approved,held:quiet_hours', 'APPROVED AT NIGHT: approved, then held for 09:00');
select is(pg_temp.act('c_m7'), 'assistant,system,person,system', '...person, then the system');
-- order is the order things happened
select is((select array_agg(seq order by seq) = array_agg(seq order by at, seq) from public.outbox_events where message_id = tests.rid('c_m7')), true, 'the events are in order');
-- the worker is its own actor kind
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select pg_temp.settings(p_auto => 'true');
select pg_temp.mk('c8');
select pg_temp.sub('c_m8', 'c8', 'Our shop is open on Wednesday.');
create temp table claimed_c8 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'fake-c8')$q$, tests.tid('a'), tests.rid('c_m8')));
select is(pg_temp.ev('c_m8'), 'made,queued:auto_allowed,sent', 'THE WORKER sends it: the same steps...');
select is((select actor_kind || '/' || coalesce(actor_user_id::text, 'nobody') from public.outbox_events where message_id = tests.rid('c_m8') and kind = 'sent'), 'worker/nobody', '...and the sent step says "worker", with no user id (the scheduler account is nobody''s name)');
-- an erasure tombstones words in a message that was sent: it is not an "edit" and writes no event
insert into public.erasure_requests (id, tenant_id, scope, subject_id, status, requested_by, execute_after)
values (tests.rid('bb_x1'), tests.tid('a'), 'contact', tests.rid('c1_c'), 'executing', tests.uid('a_owner'), now());
select set_config('app.erasure_request', tests.rid('bb_x1')::text, true);
select is(pg_temp.priv(format($q$update public.outbox_messages set body = 'erased:1', gloss_en = 'erased:1' where id = %L$q$, tests.rid('c_m1'))), 'ok', '(an erasure may tombstone the words of a sent message)');
select set_config('app.erasure_request', '', true);
select is(pg_temp.ev('c_m1'), 'made,queued:auto_allowed,sent', 'AN ERASURE adds no event ("edited" is for a person''s edit)');
-- guards and visibility
select is(pg_temp.priv('update public.outbox_events set reason = null'), '42501', 'GUARD: an event is never changed (42501)');
select is(pg_temp.priv('delete from public.outbox_events'), '42501', '...never deleted');
select is(pg_temp.priv('truncate public.outbox_events'), '42501', '...never truncated');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.outbox_events'), '0', 'RLS: a Viewer reads no event');
select is(tests.scalar_as(tests.uid('a_sales'), 'select count(*) from public.outbox_events') <> '0', true, '...Sales do');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.outbox_events where tenant_id = ' || quote_literal(tests.tid('a'))), '0', '...another business does not');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.outbox_events (tenant_id, message_id, kind, at, actor_kind) values (%L, %L, 'sent', now(), 'person')$q$, tests.tid('a'), tests.rid('c_m1'))), '42501', 'no client can write an event (42501)');
select is(pg_temp.priv(format($q$insert into public.outbox_events (tenant_id, message_id, kind, at, actor_kind) values (%L, %L, 'sent', now(), 'person')$q$, tests.tid('b'), tests.rid('c_m1'))), '23503', 'an event cannot point at another business''s message (23503)');
select is(pg_temp.priv(format($q$insert into public.outbox_events (tenant_id, message_id, kind, reason, at, actor_kind) values (%L, %L, 'blocked', 'Has Spaces And Words', now(), 'system')$q$, tests.tid('a'), tests.rid('c_m1'))), '23514', 'the reason must be a closed word, never text (23514)');
select is((select count(*) from public.outbox_events e where e.tenant_id = tests.tid('a') and e.message_id = tests.rid('c_m1') and e.reason ~ '[^a-z_]'), 0::bigint, '(no event holds anything but a closed word)');
-- only real edits make an "edited" event (b_m4 above, c_m3 here); a change of the gloss alone, a status change or a guard-allowed fixture update does not
select is((select count(distinct e.message_id) from public.outbox_events e where e.kind = 'edited'), 2::bigint, 'only the two messages a person really edited have an "edited" event');


-- ---------------------------------------------------------------------------------------------
-- D. the log: tabs, customer, dates, paging. Each message is made at its own pinned instant, so created_at differs.
-- ---------------------------------------------------------------------------------------------
select pg_temp.settings(p_auto => 'false');
select pg_temp.mk('d1'); select pg_temp.mk('d2'); select pg_temp.mk('d3'); select pg_temp.mk('d4'); select pg_temp.mk('d5');
update public.companies set name = 'Lakshmi Textiles' where id = tests.rid('a_company');
update public.contacts set full_name = 'Ravi Kumar' where id = tests.rid('d1_c');
update public.contacts set full_name = 'Sita Devi' where id = tests.rid('d2_c');
update public.contacts set full_name = 'Percent 100% Sure' where id = tests.rid('d3_c');
update public.contacts set full_name = 'Under_score Name' where id = tests.rid('d4_c');
select pg_temp.pin('2026-10-01 10:00:00+05:30'); select pg_temp.sub('d_m1', 'd1', 'Hello about the order.');
select pg_temp.pin('2026-10-02 10:00:00+05:30'); select pg_temp.sub('d_m2', 'd2', 'Hello about the visit.');
select pg_temp.pin('2026-10-02 23:30:00+05:30'); select pg_temp.sub('d_m3', 'd3', 'Hello about the shop.');
select pg_temp.pin('2026-10-03 00:30:00+05:30'); select pg_temp.sub('d_m4', 'd4', 'Hello about the new stock.');
select pg_temp.pin('2026-10-04 12:00:00+05:30'); select pg_temp.sub('d_m5', 'd5', 'Secret keyword zebra in the words.');
select pg_temp.main_pin();
select is(pg_temp.mst('d_m1'), 'needs_approval/auto_off', '(the five wait for approval)');
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('d_m2')));
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'reject')$q$, tests.tid('a'), tests.rid('d_m3')));
select is(pg_temp.mst('d_m2') || ' ' || pg_temp.mst('d_m3'), 'queued/owner_approved blocked/owner_rejected', '(d_m2 approved, d_m3 rejected)');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''waiting'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m5', 'd_m4', 'd_m1'), 'TAB waiting: the three that wait, newest first');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''scheduled'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m2'), 'TAB scheduled: the approved one');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''blocked'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m3'), 'TAB blocked: the rejected one');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''sent'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), '', 'TAB sent: none in that range');
select is(pg_temp.list(', p_tab => ''blocked'', p_from => date ''2026-10-05'', p_to => date ''2026-10-05''') like '%' || tests.rid('c_m2')::text || '%', true, 'TAB blocked also holds a message that FAILED to send (c_m2)');
select is(pg_temp.list(', p_tab => ''scheduled'', p_from => date ''2026-10-05'', p_to => date ''2026-10-05''') like '%' || tests.rid('c_m2')::text || '%', false, '...and a failed message is not "scheduled"');
select is(pg_temp.list(', p_tab => ''sent'', p_from => date ''2026-10-05'', p_to => date ''2026-10-05''') like '%' || tests.rid('c_m1')::text || '%', true, 'TAB sent holds c_m1 (sent in section C)');
select is(pg_temp.listed(pg_temp.list(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m5', 'd_m4', 'd_m3', 'd_m2', 'd_m1'), 'NO TAB: all five, newest first');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''blocked'', p_from => date ''2026-10-05''')) like '%' || tests.rid('d_m3')::text || '%', false, '(the date range really limits it)');
-- customer
select is(pg_temp.listed(pg_temp.list(', p_q => ''Ravi'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m1'), 'CUSTOMER: by the contact''s name');
select is(pg_temp.listed(pg_temp.list(', p_q => ''sITa dev'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m2'), '...in any letter case, and part of a name');
select is(pg_temp.listed(pg_temp.list(', p_q => ''Lakshmi'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m5', 'd_m4', 'd_m3', 'd_m2', 'd_m1'), '...by the company''s name (all five are its customers)');
select is(pg_temp.listed(pg_temp.list(', p_q => ''0% S'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m3'), 'a % in the search is a literal percent sign...');
select is(pg_temp.listed(pg_temp.list(', p_q => ''1%'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), '', '...not a wildcard ("1%" is not in "100% Sure")');
select is(pg_temp.listed(pg_temp.list(', p_q => ''r_s'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), pg_temp.mine('d_m4'), 'an underscore is a literal underscore too ("Under_score")');
select is(pg_temp.listed(pg_temp.list(', p_q => ''rxs'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''')), '', '...not "any one character"');
select is(pg_temp.listed(pg_temp.list(', p_q => ''zebra''')), '', 'THE WORDS ARE NEVER SEARCHED: a word that is only in a message''s text finds nothing');
select is(pg_temp.listed(pg_temp.list(', p_q => ''zebra'', p_tab => ''waiting''')), '', '...with a tab either');
-- dates: the India day of created_at, both ends included
select is(pg_temp.listed(pg_temp.list(', p_from => date ''2026-10-02'', p_to => date ''2026-10-02''')), pg_temp.mine('d_m3', 'd_m2'), 'DATES: one India day (2 October) holds the 10:00 and the 23:30 message...');
select is(pg_temp.listed(pg_temp.list(', p_from => date ''2026-10-03'', p_to => date ''2026-10-03''')), pg_temp.mine('d_m4'), '...and 00:30 on 3 October (still 2 October in UTC) belongs to the 3rd');
select is(pg_temp.listed(pg_temp.list(', p_from => date ''2026-10-04''')) like '%' || tests.rid('d_m5')::text || '%', true, 'only a start date: from then on');
select is(pg_temp.listed(pg_temp.list(', p_to => date ''2026-10-01''')) like '%' || tests.rid('d_m1')::text || '%', true, 'only an end date: up to then (included)');
select is(pg_temp.listed(pg_temp.list(', p_to => date ''2026-10-01''')) like '%' || tests.rid('d_m2')::text || '%', false, '...and not after');
-- paging by (created_at, id)
select is(pg_temp.j((pg_temp.list(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'', p_limit => 2')::jsonb -> 0)::text, 'id'), tests.rid('d_m5')::text, 'PAGE 1 (limit 2) starts with the newest');
select is(jsonb_array_length(pg_temp.list(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'', p_limit => 2')::jsonb), 2, '...and holds two');
create temp table page1 as select (pg_temp.list(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'', p_limit => 2')::jsonb -> 1) as last;
select is(pg_temp.listed(pg_temp.list(format(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'', p_limit => 2, p_after_created_at => %L, p_after_id => %L', (select last ->> 'created_at' from page1), (select last ->> 'id' from page1)))), pg_temp.mine('d_m3', 'd_m2'), 'PAGE 2 continues after the last of page 1, with no gap and no repeat');
create temp table page2 as select (pg_temp.list(format(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'', p_limit => 2, p_after_created_at => %L, p_after_id => %L', (select last ->> 'created_at' from page1), (select last ->> 'id' from page1)))::jsonb -> 1) as last;
select is(pg_temp.listed(pg_temp.list(format(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'', p_limit => 2, p_after_created_at => %L, p_after_id => %L', (select last ->> 'created_at' from page2), (select last ->> 'id' from page2)))), pg_temp.mine('d_m1'), 'PAGE 3 holds the last one');
select is((pg_temp.list(', p_limit => 1')::jsonb -> 0) ? 'created_at', true, 'each entry carries id and created_at (the cursor)...');
select is((select count(*) from jsonb_object_keys(pg_temp.list(', p_limit => 1')::jsonb -> 0)), 2::bigint, '...and nothing else (no words, no names)');
-- invalid input and roles
select is(pg_temp.list(', p_tab => ''bogus'''), 'ERR:22023', 'INVALID: an unknown tab (22023)');
select is(pg_temp.list(', p_q => ''a'''), 'ERR:22023', 'INVALID: a one-character search');
select is(pg_temp.list(', p_q => ' || quote_literal(repeat('x', 61))), 'ERR:22023', 'INVALID: a search over 60 characters');
select is(pg_temp.list(', p_q => ' || quote_literal('zero' || chr(8203) || 'width')), 'ERR:22023', 'INVALID: an invisible character in the search');
select is(pg_temp.list(', p_from => date ''2026-10-04'', p_to => date ''2026-10-01'''), 'ERR:22023', 'INVALID: from after to');
select is(pg_temp.list(', p_from => date ''2025-01-01'', p_to => date ''2026-10-01'''), 'ERR:22023', 'INVALID: a range over a year');
select is(pg_temp.list(', p_limit => 0'), 'ERR:22023', 'INVALID: limit 0');
select is(pg_temp.list(', p_limit => 101'), 'ERR:22023', 'INVALID: limit over 100');
select is(pg_temp.list(', p_after_id => ' || quote_literal(gen_random_uuid())), 'ERR:22023', 'INVALID: half a cursor');
select is(pg_temp.list('', 'a_viewer'), 'ERR:42501', 'ROLE: a Viewer cannot read the log (a message can hold a price) (42501)');
select is(pg_temp.list('', 'b_owner'), 'ERR:42501', 'ROLE: another business''s Owner cannot (42501)');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''waiting'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''', 'a_sales')), pg_temp.mine('d_m5', 'd_m4', 'd_m1'), 'ROLE: Sales read it...');
select is(pg_temp.listed(pg_temp.list(', p_tab => ''waiting'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04''', 'a_admin')), pg_temp.mine('d_m5', 'd_m4', 'd_m1'), '...and so does an Admin');
select is(pg_temp.sc('a_owner', format('select public.outbox_list(%L)', tests.tid('b'))), 'ERR:42501', 'ROLE: an Owner of A asking for business B''s log is refused (42501)');

-- ---------------------------------------------------------------------------------------------
-- E. the counts per tab, and what is due now
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-05 14:00:00+05:30');
create function pg_temp.summ(p_args text default '', p_user text default 'a_owner', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.outbox_summary(%L%s)', tests.tid(p_tenant), p_args)) $$;
select is(pg_temp.j(pg_temp.summ(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'''), 'waiting'), '3', 'COUNTS: three wait in that range...');
select is(pg_temp.j(pg_temp.summ(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'''), 'scheduled'), '1', '...one is scheduled...');
select is(pg_temp.j(pg_temp.summ(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'''), 'sent'), '0', '...none sent...');
select is(pg_temp.j(pg_temp.summ(', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'''), 'blocked'), '1', '...one blocked');
select is(pg_temp.j(pg_temp.summ(', p_from => date ''2026-10-05'', p_to => date ''2026-10-05'''), 'blocked')::bigint,
          (select count(*) from public.outbox_messages m where m.tenant_id = tests.tid('a') and m.status in ('blocked', 'failed') and (m.created_at at time zone 'Asia/Kolkata')::date = date '2026-10-05'), 'the blocked count includes the messages that FAILED to send');
select ok((select count(*) from public.outbox_messages m where m.tenant_id = tests.tid('a') and m.status = 'failed') > 0, '(there is a failed message in the fixture)');
select is(pg_temp.j(pg_temp.summ(', p_q => ''Ravi'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'''), 'waiting'), '1', 'the customer filter applies to the counts: Ravi has one waiting...');
select is(pg_temp.j(pg_temp.summ(', p_q => ''Ravi'', p_from => date ''2026-10-01'', p_to => date ''2026-10-04'''), 'scheduled'), '0', '...and none scheduled');
select is((pg_temp.summ())::jsonb ?& array['waiting', 'scheduled', 'sent', 'blocked', 'due_now', 'held_for_later'], true, 'the answer has exactly the six counts...');
select is((select count(*) from jsonb_object_keys(pg_temp.summ()::jsonb)), 6::bigint, '...and nothing else');
select is((pg_temp.j(pg_temp.summ(), 'due_now'))::bigint, (select count(*) from public.outbox_messages m where m.tenant_id = tests.tid('a') and m.status = 'queued' and (m.scheduled_for is null or m.scheduled_for <= app.outbox_now())), 'DUE NOW equals the queued messages whose time has come (at the pinned instant)');
select is((pg_temp.j(pg_temp.summ(), 'held_for_later'))::bigint, (select count(*) from public.outbox_messages m where m.tenant_id = tests.tid('a') and m.status = 'queued' and m.scheduled_for > app.outbox_now()), '...and HELD FOR LATER the ones scheduled for after it');
select ok((pg_temp.j(pg_temp.summ(), 'due_now'))::bigint > 0 and (pg_temp.j(pg_temp.summ(), 'held_for_later'))::bigint > 0, '(both are non-zero in this fixture, so the two checks mean something)');
select is(pg_temp.j(pg_temp.summ(', p_q => ''Ravi'''), 'due_now') = pg_temp.j(pg_temp.summ(), 'due_now'), true, 'the due-now count is not narrowed by the customer filter (it is what the dispatch button would act on)');
select is(pg_temp.summ('', 'a_viewer'), 'ERR:42501', 'a Viewer is refused (42501)');
select is(pg_temp.summ('', 'b_owner'), 'ERR:42501', 'another business''s Owner is refused (42501)');
select is(pg_temp.j(pg_temp.summ('', 'a_sales'), 'waiting') is not null, true, 'Sales read the counts');
select is(pg_temp.summ(', p_from => date ''2026-10-04'', p_to => date ''2026-10-01'''), 'ERR:22023', 'INVALID: from after to (22023)');
select is(pg_temp.summ(', p_q => ''x'''), 'ERR:22023', 'INVALID: a one-character search (22023)');
select is(pg_temp.j(pg_temp.summ('', 'a_owner', 'b'), 'waiting'), 'ERR:42501', '(an Owner of A asking for business B gets 42501)');

-- ---------------------------------------------------------------------------------------------
-- F. the worker may read exactly the files of the messages it has claimed
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select pg_temp.settings();
select pg_temp.photo('f_i1', 'f_p1');
select pg_temp.photo('f_i2', 'f_p2');
select pg_temp.mk('f1'); select pg_temp.mk('f2');
create function pg_temp.worker_sees() returns text language sql as $$
  select coalesce(string_agg(regexp_replace(name, '^.*/', ''), ',' order by name collate "C"), '') from (
    select (tests.scalar_as(tests.uid('outsider'), 'select coalesce(string_agg(name, '','' order by name collate "C"), '''') from storage.objects')) as names) x,
         lateral unnest(string_to_array(x.names, ',')) as name
   where name <> '' $$;
select is(pg_temp.worker_sees(), '', 'THE WORKER reads no catalogue file at all while nothing is claimed');
select is(pg_temp.j(pg_temp.sub('f_m1', 'f1', 'Here is one saree you may like.', null, pg_temp.ids('f_p1')), 'status'), 'queued', '(a message with a photo is queued)');
select is(pg_temp.worker_sees(), '', '...a QUEUED message is not enough: still nothing readable');
create temp table claimed_f as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is((select count(*) from claimed_f, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('f_m1')::text), 1::bigint, '(the worker claims it)');
select is(pg_temp.worker_sees(), tests.rid('f_p1')::text || '.jpg,' || tests.rid('f_p1')::text || '_t.jpg', 'CLAIMED: the worker reads that message''s photo and its thumbnail, exactly those two files');
insert into storage.objects (bucket_id, name, metadata)
values (app.catalogue_bucket(tests.tid('b')), tests.rid('f_i1')::text || '/' || tests.rid('f_p1')::text || '.jpg', jsonb_build_object('mimetype', 'image/jpeg', 'size', 1000));
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from storage.objects where bucket_id = ' || quote_literal(app.catalogue_bucket(tests.tid('b')))), '0', 'THE BUCKET MATTERS: a file with the same name in another business''s bucket is not readable');
select is(tests.scalar_as(tests.uid('outsider'), format($q$select count(*) from storage.objects where name like %L$q$, '%' || tests.rid('f_p2')::text || '%')), '0', '...and not the photo of another saree (f_p2), which is in the same bucket');
select is(tests.outcome_as(tests.uid('outsider'), format($i$insert into storage.objects (bucket_id, name) values (%L, 'x/w.jpg')$i$, app.catalogue_bucket(tests.tid('a')))), '42501', '...and it can write nothing (42501)');
select is(tests.outcome_as(tests.uid('outsider'), format($i$delete from storage.objects where bucket_id = %L$i$, app.catalogue_bucket(tests.tid('a')))), '42501', '...or remove anything (42501)');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from storage.objects where bucket_id = ' || quote_literal(app.catalogue_bucket(tests.tid('a')))), '0', 'ANOTHER BUSINESS''s Owner still reads none of A''s files while it is claimed');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from storage.objects where bucket_id = ' || quote_literal(app.catalogue_bucket(tests.tid('a')))) <> '0', true, 'a member of the business is as before (the old rule stands)');
select is(tests.scalar_as(tests.uid('b_viewer'), 'select count(*) from storage.objects where bucket_id = ' || quote_literal(app.catalogue_bucket(tests.tid('a')))), '0', '(and a member of business B is not helped by the claim)');
-- a person who is not the registered worker gets nothing from the claim
select is(tests.scalar_as(tests.uid('a_owner'), 'select app.worker_may_read_object(' || quote_literal(app.catalogue_bucket(tests.tid('a'))) || ', ' || quote_literal(tests.rid('f_i1')::text || '/' || tests.rid('f_p1')::text || '.jpg') || ')'), 'false', 'THE FUNCTION says false for anyone who is not the registered worker (even a business Owner)');
select is(tests.scalar_as(tests.uid('outsider'), 'select app.worker_may_read_object(' || quote_literal(app.catalogue_bucket(tests.tid('a'))) || ', ' || quote_literal(tests.rid('f_i1')::text || '/' || tests.rid('f_p1')::text || '.jpg') || ')'), 'true', '...and true for the worker while the message is claimed');
select is(tests.scalar_as(tests.uid('outsider'), 'select app.worker_may_read_object(''avatars'', ''x/y.jpg'')'), 'false', '...false for any other bucket / file');
-- the lease lapses after ten minutes
select pg_temp.pin('2026-10-05 14:09:00+05:30');
select is(pg_temp.worker_sees() <> '', true, 'NINE MINUTES later the lease is still live: readable');
select pg_temp.pin('2026-10-05 14:11:00+05:30');
select is(pg_temp.worker_sees(), '', 'ELEVEN MINUTES later it has lapsed: nothing is readable (the message would be offered again, and claimed again)');
select pg_temp.pin('2026-10-05 14:00:30+05:30');
select is(pg_temp.worker_sees() <> '', true, '(back inside the lease: readable again)');
-- once the channel has said "sent" the files are closed again
select pg_temp.sch(format($q$select public.scheduler_mark(%L, %L, 'sent', 'fake', 'fake-f1')$q$, tests.tid('a'), tests.rid('f_m1')));
select is(pg_temp.mst('f_m1'), 'sent/auto_allowed', '(sent)');
select is(pg_temp.worker_sees(), '', 'SENT: the files are closed again');
-- a claimed message WITHOUT photos opens nothing, and another message's photo stays closed
select pg_temp.sub('f_m2', 'f2', 'A note without photos.');
create temp table claimed_f2 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is(pg_temp.worker_sees(), '', 'a claimed message with no photos opens nothing');
-- the scheduler is switched off: it reads nothing even with a claim
select pg_temp.sub('f_m3', 'f1', 'Here is one saree you may like again.', null, pg_temp.ids('f_p1'));
create temp table claimed_f3 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is(pg_temp.worker_sees() <> '', true, '(f_m3 is claimed: readable)');
select app.operator_remove_scheduler('outsider@test.local');
select is(pg_temp.worker_sees(), '', 'REMOVING THE REGISTRATION takes the power away at once');
select app.operator_register_scheduler('outsider@test.local');

-- ---------------------------------------------------------------------------------------------
-- G. quiet hours per business: day and night, the boundaries, every caller
-- ---------------------------------------------------------------------------------------------
select pg_temp.settings();
select pg_temp.main_pin();
-- the helper functions, directly
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 20:59:00+05:30', tests.tid('a')), false, 'DEFAULT 20:59: open');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 21:00:00+05:30', tests.tid('a')), true, 'DEFAULT 21:00: quiet');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 08:59:00+05:30', tests.tid('a')), true, 'DEFAULT 08:59: quiet');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 09:00:00+05:30', tests.tid('a')), false, 'DEFAULT 09:00: open');
select is(app.outbox_next_open(timestamptz '2026-10-05 21:00:00+05:30', tests.tid('a')), timestamptz '2026-10-06 09:00:00+05:30', 'DEFAULT: from 21:00 the next opening is 09:00 tomorrow');
select is(app.outbox_next_open(timestamptz '2026-10-05 08:00:00+05:30', tests.tid('a')), timestamptz '2026-10-05 09:00:00+05:30', 'DEFAULT: at 08:00 it is 09:00 today');
select is(app.outbox_next_open(timestamptz '2026-10-05 14:00:00+05:30', tests.tid('a')), timestamptz '2026-10-05 14:00:00+05:30', 'DEFAULT: by day it is now');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 21:00:00+05:30'), true, 'the one-argument helper keeps the default 21 / 9');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 19:30:00+05:30', tests.tid('b')), false, 'a business that never set anything has the default (b, 19:30: open)');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 08:59:00+05:30', tests.tid('b')) and not app.outbox_in_quiet_hours(timestamptz '2026-10-05 09:00:00+05:30', tests.tid('b')), true, '...and its morning is 09:00 (08:59 quiet, 09:00 open)');
select is(app.outbox_next_open(timestamptz '2026-10-05 22:00:00+05:30', tests.tid('b')), timestamptz '2026-10-06 09:00:00+05:30', '...and its next opening after 22:00 is 09:00 tomorrow');
-- Owner sets 19:00 to 10:00
select is(pg_temp.j(pg_temp.settings('19', '10'), 'quiet_hours_start') || '/' || pg_temp.j(pg_temp.settings('19', '10'), 'quiet_hours_end'), '19/10', 'the Owner sets quiet hours 19:00 to 10:00');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 18:59:00+05:30', tests.tid('a')), false, 'CUSTOM 18:59: open');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 19:00:00+05:30', tests.tid('a')), true, 'CUSTOM 19:00: quiet');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 09:59:00+05:30', tests.tid('a')), true, 'CUSTOM 09:59: still quiet');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 10:00:00+05:30', tests.tid('a')), false, 'CUSTOM 10:00: open');
select is(app.outbox_next_open(timestamptz '2026-10-05 19:30:00+05:30', tests.tid('a')), timestamptz '2026-10-06 10:00:00+05:30', 'CUSTOM: from 19:30 the next opening is 10:00 tomorrow');
select is(app.outbox_next_open(timestamptz '2026-10-05 09:30:00+05:30', tests.tid('a')), timestamptz '2026-10-05 10:00:00+05:30', 'CUSTOM: at 09:30 it is 10:00 today');
select is(app.outbox_in_quiet_hours(timestamptz '2026-10-05 19:30:00+05:30', tests.tid('b')), false, 'ANOTHER BUSINESS (b) is unaffected: 19:30 is open for it');
-- the policy at submit time
select pg_temp.mk('g1'); select pg_temp.mk('g2'); select pg_temp.mk('g3'); select pg_temp.mk('g4'); select pg_temp.mk('g5'); select pg_temp.mk('g6'); select pg_temp.mk('g7');
select pg_temp.pin('2026-10-05 18:59:00+05:30');
select is(pg_temp.j(pg_temp.sub('g_m1', 'g1', 'We are open tomorrow.'), 'reason'), 'auto_allowed', 'SUBMIT 18:59 with quiet from 19:00: goes (auto_allowed)');
select pg_temp.pin('2026-10-05 19:30:00+05:30');
select is(pg_temp.j(pg_temp.sub('g_m2', 'g2', 'We are open tomorrow.'), 'reason'), 'quiet_hours', 'SUBMIT 19:30: held (quiet_hours)');
select is((select scheduled_for from public.outbox_messages where id = tests.rid('g_m2')), timestamptz '2026-10-06 10:00:00+05:30', '...until 10:00 tomorrow, this business''s own morning');
select pg_temp.pin('2026-10-06 09:59:00+05:30');
select is(pg_temp.j(pg_temp.sub('g_m3', 'g3', 'We are open today.'), 'reason'), 'quiet_hours', 'SUBMIT 09:59 with the morning at 10:00: still held...');
select is((select scheduled_for from public.outbox_messages where id = tests.rid('g_m3')), timestamptz '2026-10-06 10:00:00+05:30', '...until 10:00 today');
select pg_temp.pin('2026-10-06 10:00:00+05:30');
select is(pg_temp.j(pg_temp.sub('g_m4', 'g4', 'We are open today.'), 'reason'), 'auto_allowed', 'SUBMIT 10:00: goes');
-- the owner's approval
select pg_temp.settings(p_auto => 'false');
select pg_temp.pin('2026-10-05 19:30:00+05:30');
select pg_temp.sub('g_m5', 'g5', 'We are open tomorrow, come over.');
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('g_m5')));
select is((select scheduled_for from public.outbox_messages where id = tests.rid('g_m5')), timestamptz '2026-10-06 10:00:00+05:30', 'APPROVAL at 19:30 is scheduled for this business''s morning (10:00)');
select pg_temp.settings(p_auto => 'true');
-- the release: claim at a quiet moment pushes the time, claim at an open moment hands it over
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select pg_temp.sub('g_m6', 'g6', 'We are open tomorrow, see you.');
select pg_temp.pin('2026-10-05 19:30:00+05:30');
select is(pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 50)', tests.tid('a'))) like '%' || tests.rid('g_m6')::text || '%', false, 'CLAIM at 19:30 (quiet from 19:00): g_m6 is not handed out...');
select is((select scheduled_for from public.outbox_messages where id = tests.rid('g_m6')), timestamptz '2026-10-06 10:00:00+05:30', '...it is pushed to 10:00 tomorrow');
select pg_temp.pin('2026-10-06 09:59:00+05:30');
select is((select count(*) from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb) e where e ->> 'id' = tests.rid('g_m6')::text), 0::bigint, 'THE WORKER at 09:59: still not released');
select pg_temp.pin('2026-10-06 10:00:00+05:30');
select is((select count(*) from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb) e where e ->> 'id' = tests.rid('g_m6')::text), 1::bigint, 'THE WORKER at 10:00: released');
-- night: 23:30 with 19 / 10 (inside quiet hours), and the default case again at 23:30
select pg_temp.pin('2026-10-05 23:30:00+05:30');
select pg_temp.settings(p_auto => 'true');
select is(pg_temp.j(pg_temp.sub('g_m7', 'g7', 'We are open tomorrow, welcome.'), 'reason'), 'quiet_hours', 'NIGHT 23:30: held');
-- reminders: the evening reminder at 19:00 (hour 19) and the heads-up
select pg_temp.pin('2026-10-05 12:00:00+05:30');
select pg_temp.settings();
select pg_temp.sc('a_owner', format($q$select public.visit_settings_set(%L, %L::jsonb, '{}'::date[], 30, 8)$q$,
                                    tests.tid('a'), jsonb_build_object('mon', jsonb_build_object('open', '00:00', 'close', '24:00'), 'tue', jsonb_build_object('open', '00:00', 'close', '24:00'),
                                                                       'wed', jsonb_build_object('open', '00:00', 'close', '24:00'), 'thu', jsonb_build_object('open', '00:00', 'close', '24:00'),
                                                                       'fri', jsonb_build_object('open', '00:00', 'close', '24:00'), 'sat', jsonb_build_object('open', '00:00', 'close', '24:00'), 'sun', null)::text));
select pg_temp.sc('a_owner', format('select public.scheduler_settings_set(%L, true, 19, true, 120, false, 30)', tests.tid('a')));
select pg_temp.mk('h1'); select pg_temp.mk('h2');
select pg_temp.sc('a_owner', format($q$select public.visit_book(%L, %L, %L, %L, %L, 2, null, null, null, 'staff')$q$, tests.rid('v_h1'), tests.tid('a'), tests.rid('h1'), date '2026-10-06', '11:00'));
select pg_temp.sc('a_owner', format($q$select public.visit_step(%L, %L, 'confirm', null)$q$, tests.tid('a'), tests.rid('v_h1')));
select is((select status from public.store_visits where id = tests.rid('v_h1')), 'confirmed', '(a confirmed visit tomorrow at 11:00)');
create function pg_temp.due(p_visit text, p_kind text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a')))::jsonb) e
                  where e ->> 'visit_id' = tests.rid(p_visit)::text and e ->> 'kind' = p_kind) $$;
select pg_temp.settings('21', '9');
select pg_temp.pin('2026-10-05 19:00:00+05:30');
select is(pg_temp.due('v_h1', 'evening_before'), true, 'REMINDER with the default hours at 19:00 (evening hour 19): due');
select pg_temp.settings('19', '10');
select is(pg_temp.due('v_h1', 'evening_before'), false, 'the same moment with quiet hours from 19:00: NOT due (a reminder is never queued in quiet hours)');
select pg_temp.settings('21', '9');
select pg_temp.pin('2026-10-06 09:30:00+05:30');
select pg_temp.sc('a_owner', format('select public.scheduler_settings_set(%L, true, 19, true, 120, false, 30)', tests.tid('a')));
select is(pg_temp.due('v_h1', 'heads_up'), true, 'HEADS-UP at 09:30 with the default morning (09:00): due (visit at 11:00, from 09:00)');
select pg_temp.settings('19', '10');
select is(pg_temp.due('v_h1', 'heads_up'), false, '...with the morning at 10:00: NOT due at 09:30');
select pg_temp.pin('2026-10-06 10:00:00+05:30');
select is(pg_temp.due('v_h1', 'heads_up'), true, '...and due at 10:00');
select is(app.scheduler_reminder_due((select v from public.store_visits v where v.id = tests.rid('v_h1')), 'heads_up', timestamptz '2026-10-06 09:30:00+05:30', app.scheduler_settings_json(tests.tid('a'))), false, 'THE CHECK ITSELF (19 / 10): not due at 09:30, inside this business''s quiet hours');
select pg_temp.settings('21', '9');
select is(app.scheduler_reminder_due((select v from public.store_visits v where v.id = tests.rid('v_h1')), 'heads_up', timestamptz '2026-10-06 09:30:00+05:30', app.scheduler_settings_json(tests.tid('a'))), true, '...the same instant with the default hours (21 / 9): due');
select pg_temp.settings('19', '10');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_queue_reminder(%L, %L, 'heads_up', %L, 'A reminder: your visit to our shop is coming up. We look forward to seeing you.', 'en', false)$q$, tests.tid('a'), tests.rid('v_h1'), tests.rid('h_m1'))), 'status'), 'queued', 'the reminder is queued at 10:00 (and not refused by the quiet-hours check)');

-- ---------------------------------------------------------------------------------------------
-- H. the setting itself
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select pg_temp.settings('21', '9');
select is(pg_temp.sc('a_owner', format('select public.outbox_settings_get(%L)', tests.tid('a')))::jsonb ->> 'quiet_hours_start', '21', 'the Owner reads the start...');
select is(pg_temp.sc('a_admin', format('select public.outbox_settings_get(%L)', tests.tid('a')))::jsonb ->> 'quiet_hours_end', '9', '...and an Admin the end');
select is(pg_temp.sc('a_sales', format('select public.outbox_settings_get(%L)', tests.tid('a'))), 'ERR:42501', 'Sales cannot read the settings (42501), as before');
select is(pg_temp.sc('b_owner', format('select public.outbox_settings_get(%L)', tests.tid('b')))::jsonb ->> 'quiet_hours_start', '21', 'a business with no settings row reads the defaults (b: 21)');
select is(pg_temp.settings('18', 'null'), 'ERR:22023', 'RANGE: a start before 19:00 is refused (22023)');
select is(pg_temp.settings('24', 'null'), 'ERR:22023', 'RANGE: a start of 24 is refused');
select is(pg_temp.settings('null', '6'), 'ERR:22023', 'RANGE: an end before 07:00 is refused');
select is(pg_temp.settings('null', '11'), 'ERR:22023', 'RANGE: an end after 10:00 is refused');
select is(pg_temp.j(pg_temp.settings('23', '7'), 'quiet_hours_start'), '23', 'the widest allowed values are accepted (23 and 7)...');
select is((select quiet_start_hour::text || '/' || quiet_end_hour::text from public.outbox_settings where tenant_id = tests.tid('a')), '23/7', '...and stored');
select is(pg_temp.j(pg_temp.settings('19', '10'), 'quiet_hours_end'), '10', 'and the narrowest (19 and 10)...');
select is((select quiet_start_hour::text || '/' || quiet_end_hour::text from public.outbox_settings where tenant_id = tests.tid('a')), '19/10', '...and stored');
select pg_temp.settings('22', 'null');
select is((select quiet_start_hour::text || '/' || quiet_end_hour::text from public.outbox_settings where tenant_id = tests.tid('a')), '22/10', 'a null leaves that end as it was (start 22, end still 10)');
select is(pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')))::jsonb ->> 'quiet_hours_start', '22', 'the three-argument call still works and changes no hour');
select is(pg_temp.settings('21', '9', 'a_owner', 'aal1'), 'ERR:SM306', 'THE OWNER NEEDS A SECOND FACTOR (SM306)');
select is(pg_temp.settings('21', '9', 'a_admin'), 'ERR:42501', 'an Admin cannot change them (42501)');
select is(pg_temp.settings('21', '9', 'a_sales'), 'ERR:42501', 'Sales cannot (42501)');
select is(pg_temp.settings('21', '9', 'b_owner'), 'ERR:42501', 'another business''s Owner cannot change this business''s (42501)');
select is((select quiet_start_hour::text || '/' || quiet_end_hour::text from public.outbox_settings where tenant_id = tests.tid('a')), '22/10', '(none of the refused calls changed anything)');
select is(pg_temp.priv(format($q$update public.outbox_settings set quiet_start_hour = 18 where tenant_id = %L$q$, tests.tid('a'))), '23514', 'THE TABLE refuses a start outside 19 to 23 even for a privileged writer (23514)');
select is(pg_temp.priv(format($q$update public.outbox_settings set quiet_end_hour = 6 where tenant_id = %L$q$, tests.tid('a'))), '23514', '...and an end outside 7 to 10 (23514)');
select is(pg_temp.priv(format($q$insert into public.outbox_settings (tenant_id, quiet_start_hour) values (%L, 5)$q$, tests.tid('b'))), '23514', '...also on insert');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.outbox_settings set quiet_start_hour = 19 where tenant_id = %L$q$, tests.tid('a'))), '42501', 'a client cannot write the table (42501)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_settings') > 0, true, 'every change of the settings is audited');

-- ---------------------------------------------------------------------------------------------
-- I. audit: events are audited without any text
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_event') > 0, true, 'every event is audited');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_event' and (coalesce(old_values::text, '') || coalesce(new_values::text, '')) ~* '(hello|saree|visit to our shop|open tomorrow)'), 0::bigint, 'NO MESSAGE TEXT is in the audit of an event');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_message' and (coalesce(old_values::text, '') || coalesce(new_values::text, '')) ~* '(We have new sarees for you|English gloss)'), 0::bigint, 'THE GLOSS is never audited by value...');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_message' and (coalesce(old_values::text, '') || coalesce(new_values::text, '')) ~ 'gloss_en'), 0::bigint, '...nor its column named with a value');

select * from finish();
rollback;
