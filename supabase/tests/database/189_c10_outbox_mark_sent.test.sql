-- C10 (owner yes, 13 Nov 2026): public.outbox_mark_sent, "I sent it". The owner sent an approved message by hand from their own WhatsApp; the database records it as sent (adapter 'manual').
--   A catalog  B the mark  C the refusals (state, role, tenant, customer)  D a dispatch in flight  E the lead's touch  F audit
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

update public.platform_flags set enabled = true where key = 'outbox_enabled';
select pg_temp.pin('2026-10-05 14:00:00+05:30');

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'outbox_mark_sent' and p.prosecdef and 'search_path=""' = any (p.proconfig)), 1::bigint, 'outbox_mark_sent is SECURITY DEFINER with an empty search_path (the role is proven inside)');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'outbox_mark_sent' and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon cannot execute it');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'outbox_mark_sent' and has_function_privilege('authenticated', p.oid, 'execute')), 1::bigint, 'a signed-in caller can (the role is proven inside)');

-- ---------------------------------------------------------------------------------------------
-- B. the mark
-- ---------------------------------------------------------------------------------------------
select pg_temp.settings();
select pg_temp.mk('m1'); select pg_temp.mk('m2'); select pg_temp.mk('m3'); select pg_temp.mk('m4'); select pg_temp.mk('m5'); select pg_temp.mk('m6'); select pg_temp.mk('m7'); select pg_temp.mk('m8');
select pg_temp.sub('m_1', 'm1', 'Our shop is open today.');
select is(pg_temp.mst('m_1'), 'queued/auto_allowed', 'a message the policy allowed is queued');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_1')), 'aal1'), 'status'), 'sent', 'THE OWNER marks it sent, with NO second factor (aal1)');
select is((select adapter || '/' || adapter_message_id from public.outbox_messages where id = tests.rid('m_1')), 'manual/manual:' || tests.rid('m_1')::text, '...by hand: adapter manual, and a generated id with no customer data');
select is((select sent_at from public.outbox_messages where id = tests.rid('m_1')), '2026-10-05 14:00:00+05:30'::timestamptz, '...at the moment of the (pinned) clock');
select is(pg_temp.ev('m_1'), 'made,queued:auto_allowed,sent', 'the usual steps: made, queued, sent');
select is(pg_temp.act('m_1'), 'assistant,system,person', '...and the "sent" step names a PERSON (the one who pressed the button)');
select is((select actor_user_id from public.outbox_events where message_id = tests.rid('m_1') and kind = 'sent'), tests.uid('a_owner'), '...the Owner');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_1'))), 'replayed'), 'true', 'IDEMPOTENT: the same call again answers replayed = true');
select is(pg_temp.ev('m_1'), 'made,queued:auto_allowed,sent', '...and writes no second step');
select pg_temp.sub('m_2', 'm2', 'Our shop is open today.');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_2'))), 'status'), 'sent', 'an Admin may too');
select is(pg_temp.priv(format($q$update public.outbox_messages set body = 'Changed after it was sent' where id = %L$q$, tests.rid('m_1'))), '42501', 'GUARD: a message marked sent stays closed (42501)');

-- ---------------------------------------------------------------------------------------------
-- C. the refusals
-- ---------------------------------------------------------------------------------------------
select pg_temp.sub('m_3', 'm3', 'Our shop is open tomorrow.');
select is(pg_temp.sc('a_sales', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_3'))), 'ERR:42501', 'Sales cannot (42501)');
select is(pg_temp.sc('a_viewer', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_3'))), 'ERR:42501', 'a Viewer cannot (42501)');
select is(pg_temp.sc('b_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_3'))), 'ERR:42501', 'another business''s Owner cannot (42501)');
select is(pg_temp.sc('b_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('b'), tests.rid('m_3'))), 'ERR:23503', '...and cannot reach it through their own business either (23503)');
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('no_such_message'))), 'ERR:23503', 'an unknown message is a reference error (23503)');
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, null)', tests.tid('a'))), 'ERR:42501', 'no message id is refused (42501)');
select is(pg_temp.mst('m_3'), 'queued/auto_allowed', '(none of the refused calls changed the message)');
-- a message that waits for approval, a rejected one, one the system already sent
select pg_temp.settings(p_auto => 'false');
select pg_temp.sub('m_4', 'm4', 'Our shop is open on Sunday.');
select is(pg_temp.mst('m_4'), 'needs_approval/auto_off', 'with automatic sending off a message waits for approval');
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_4'))), 'ERR:SM501', 'NOT APPROVED: a message waiting for approval cannot be marked (SM501)');
select pg_temp.sc('a_owner', format('select public.outbox_decide(%L, %L, %L)', tests.tid('a'), tests.rid('m_4'), 'reject'));
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_4'))), 'ERR:SM501', '...nor a rejected one (SM501)');
select pg_temp.settings();
select pg_temp.sub('m_5', 'm5', 'Our shop is open on Monday.');
select is(pg_temp.priv(format($q$update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'fake-1' where id = %L$q$, tests.rid('m_5'))), 'ok', '(the system sent one: the fake adapter)');
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_5'))), 'ERR:SM501', 'ALREADY SENT BY THE SYSTEM: marking it again is refused, it is not a manual replay (SM501)');
select is((select adapter from public.outbox_messages where id = tests.rid('m_5')), 'fake', '...and the record of who sent it is untouched');

-- ---------------------------------------------------------------------------------------------
-- D. a dispatch in flight
-- ---------------------------------------------------------------------------------------------
select pg_temp.sub('m_6', 'm6', 'Our shop is open on Tuesday.');
select is(pg_temp.priv(format($q$update public.outbox_messages set claimed_at = '2026-10-05 13:59:00+05:30' where id = %L$q$, tests.rid('m_6'))), 'ok', '(a dispatch claimed it a minute ago)');
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_6'))), 'ERR:SM501', 'IN FLIGHT: while a dispatch holds it (two minutes) it cannot be marked (SM501)');
select is(pg_temp.priv(format($q$update public.outbox_messages set claimed_at = '2026-10-05 13:57:00+05:30' where id = %L$q$, tests.rid('m_6'))), 'ok', '(the claim lapsed three minutes ago)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_6'))), 'status'), 'sent', '...then it can');

-- ---------------------------------------------------------------------------------------------
-- E. the customer, the lead's touch
-- ---------------------------------------------------------------------------------------------
select pg_temp.sub('m_7', 'm7', 'Our shop is open on Wednesday.');
select is(pg_temp.priv(format($q$update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out' where id = %L$q$, tests.rid('m7_c'))), 'ok', '(the customer asked us to stop)');
select is(pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_7'))), 'ERR:SM501', 'A CUSTOMER WHO ASKED US TO STOP: refused (SM501: the stop had already blocked the waiting message; the function re-checks the customer too, SM502, for a stop that lands in between)');
select is(pg_temp.mst('m_7'), 'blocked/stopped', '...and the message stays blocked, not marked');
-- the touch: only for a message made with keep_record
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, 'te', 'info', 'assistant', false, false, '{}'::uuid[], true, null)$q$,
                                       tests.rid('m_8'), tests.tid('a'), tests.rid('m8'), 'Our shop is open on Thursday.')), 'status'), 'queued', 'a message made with keep_record is queued');
select is((select count(*) from public.lead_touches where lead_id = tests.rid('m8') and direction = 'out'), 0::bigint, '...no touch yet (nothing was sent)');
select pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_8')));
select is((select count(*) from public.lead_touches where lead_id = tests.rid('m8') and direction = 'out' and channel = 'whatsapp'), 1::bigint, 'MARKED SENT: one outgoing WhatsApp touch is kept on the lead');
select pg_temp.sc('a_owner', format('select public.outbox_mark_sent(%L, %L)', tests.tid('a'), tests.rid('m_8')));
select is((select count(*) from public.lead_touches where lead_id = tests.rid('m8') and direction = 'out'), 1::bigint, '...and a replay keeps no second one');
select is((select count(*) from public.lead_touches where lead_id = tests.rid('m1') and direction = 'out'), 0::bigint, 'a message made without keep_record leaves no touch');

-- ---------------------------------------------------------------------------------------------
-- F. audit
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_message' and entity_id = tests.rid('m_1')) > 0, true, 'the change of state is audited');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_message' and (coalesce(old_values::text, '') || coalesce(new_values::text, '')) ~ 'Our shop is open'), 0::bigint, 'NO MESSAGE TEXT is in the audit');

select * from finish();
rollback;
