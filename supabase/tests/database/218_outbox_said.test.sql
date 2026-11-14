-- Migration 20261231840000: "send it" said in the chat. The Owner's instruction approves the assistant's message (no second factor), queued for a short grace window; Undo cancels it inside the window.
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


select pg_temp.mk('m1');
select pg_temp.mk('m2');
select is(pg_temp.j(pg_temp.sub('s1', 'm1', 'How are you?'), 'status'), 'needs_approval', 'A0: the assistant''s first message waits for approval');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.outbox_approve_said(%L, %L)$q$, tests.tid('a'), tests.rid('s1'))), 'x'), 'ERR:42501', 'A1: Sales cannot approve');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_approve_said(%L, %L)$q$, tests.tid('a'), tests.rid('s1')), 'aal1'), 'status'), 'queued', 'A2: the Owner''s instruction approves it with NO second factor (aal1)');
select is(pg_temp.mst('s1'), 'queued/owner_approved', 'A3: queued, reason owner_approved');
select is((select (scheduled_for - app.outbox_now())::text from public.outbox_messages where id = tests.rid('s1')), '00:00:30', 'A4: held for the 30 second grace window, not for the next opening hour');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_unsend_said(%L, %L)$q$, tests.tid('a'), tests.rid('s1')), 'aal1'), 'status'), 'blocked', 'B1: Undo inside the window cancels it');
select is(pg_temp.mst('s1'), 'blocked/owner_rejected', 'B2: blocked, owner_rejected');
select ok(pg_temp.sc('a_owner', format($q$select public.outbox_unsend_said(%L, %L)$q$, tests.tid('a'), tests.rid('s1')), 'aal1') like 'ERR:%', 'B3: a second Undo is refused (state)');
select is(pg_temp.j(pg_temp.sub('s2', 'm2', 'Hello again'), 'status'), 'needs_approval', 'C0: a second message');
select pg_temp.sc('a_owner', format($q$select public.outbox_approve_said(%L, %L, 0)$q$, tests.tid('a'), tests.rid('s2')), 'aal1');
select ok(pg_temp.sc('a_owner', format($q$select public.outbox_unsend_said(%L, %L)$q$, tests.tid('a'), tests.rid('s2')), 'aal1') like 'ERR:%', 'C1: with no grace window there is nothing to undo');
select is(pg_temp.sc('b_owner', format($q$select public.outbox_approve_said(%L, %L)$q$, tests.tid('a'), tests.rid('s2'))), 'ERR:42501', 'D1: another workspace cannot');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_approve_said(%L, %L, 100000)$q$, tests.tid('a'), tests.rid('s2')), 'aal1'), 'ERR:22023', 'D2: a hold of more than a day is refused');
select * from finish();
rollback;
