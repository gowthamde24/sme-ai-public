-- Job BY (ADR 0077): the "needs you" feed with its unread mark, and web-push: subscriptions, the opt-in, and the worker's three calls (migration 20261118090200).
--   A catalog   B the items equal today_summary's, per role   C the feed and the unread mark   D subscriptions and the opt-in   E what the worker is told to push, and when not
-- THE CLOCK: app.outbox_now() is pinned for this transaction (quiet hours are the business's own: 21:00 to 09:00 India time). Default Monday 2026-10-05 14:00 IST;
-- PGOPTIONS='-c tests.by_pin=2026-10-05T23:30:00+05:30' runs it at another instant (section E then expects NOTHING to be pushed).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.base() returns timestamptz language sql as $$ select coalesce(nullif(current_setting('tests.by_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz $$;
select pg_temp.pin(pg_temp.base());
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.sc('x5', p_sql) $$;   -- the worker (registered below)
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.msg(p_id text, p_status text default 'needs_approval', p_tenant text default 'a', p_later interval default interval '0') returns void language plpgsql as $$
begin
  alter table public.outbox_messages disable trigger user;
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by, created_at)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), (select contact_id from public.leads where id = tests.rid(p_tenant || '_lead')), 'whatsapp', 'Hello ' || p_id, 'en', 'info', p_status, case p_status when 'blocked' then 'stopped' else 'money' end, pg_temp.h(p_id), tests.uid(p_tenant || '_owner'), now() + p_later);
  alter table public.outbox_messages enable trigger user;
end $$;
create function pg_temp.call(p_id text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.call_requests (id, tenant_id, lead_id, contact_id, reason, script_draft, language, request_sha256, requested_by)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), (select contact_id from public.leads where id = tests.rid(p_tenant || '_lead')), 'a question about an order', 'Namaste, we are calling about your order.', 'en', pg_temp.h(p_id), tests.uid(p_tenant || '_owner'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'notify' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), 4::bigint, 'A: the four notify tables have row-level security on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'notify' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A: no client role holds any privilege on them (subscriptions are secrets)');
select is((select count(*) from information_schema.schemata where schema_name = 'notify' and (has_schema_privilege('anon', schema_name, 'usage') or has_schema_privilege('authenticated', schema_name, 'usage'))), 0::bigint, 'A: no client role can use the notify schema');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('notifications_list', 'notifications_mark_seen', 'push_subscribe', 'push_unsubscribe', 'push_prefs_get', 'push_prefs_set', 'push_worker_pending', 'push_worker_mark', 'push_worker_report')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 9::bigint, 'A: all nine functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('notifications_list', 'notifications_mark_seen', 'push_subscribe', 'push_unsubscribe', 'push_prefs_get', 'push_prefs_set', 'push_worker_pending', 'push_worker_mark', 'push_worker_report') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'A: anon can execute none of them');
select is(pg_temp.sc('a_owner', 'select count(*) from notify.push_subscriptions'), 'ERR:42501', 'A: even a SELECT on the subscriptions is refused to a client role');

-- ---------------------------------------------------------------------------------------------
-- B. the items equal today_summary's, role by role
-- ---------------------------------------------------------------------------------------------
select pg_temp.msg('w1');
select pg_temp.msg('w2');
select pg_temp.msg('s1', 'blocked');
select pg_temp.call('k1');
select pg_temp.msg('bw1', 'needs_approval', 'b');
create function pg_temp.ids_today(p_user text) returns text language sql as $$
  select coalesce((select string_agg(x ->> 'kind' || ':' || (x ->> 'id'), ',' order by x ->> 'kind', x ->> 'id') from jsonb_array_elements(pg_temp.sc(p_user, format('select public.today_summary(%L)', tests.tid('a')))::jsonb -> 'needs_you') x), '') $$;
create function pg_temp.ids_mine(p_user text) returns text language sql as $$
  select coalesce((select string_agg(n.kind || ':' || n.id, ',' order by n.kind, n.id::text) from app.needs_you_items(tests.tid('a'), tests.uid(p_user)) n), '') $$;
select is(pg_temp.ids_mine('a_owner'), pg_temp.ids_today('a_owner'), 'B: the Owner''s items are exactly Today''s');
select is(pg_temp.ids_mine('a_admin'), pg_temp.ids_today('a_admin'), 'B: the Admin''s items are exactly Today''s');
select is(pg_temp.ids_mine('a_sales'), pg_temp.ids_today('a_sales'), 'B: the Sales member''s items are exactly Today''s (none)');
select is(pg_temp.ids_mine('a_viewer'), pg_temp.ids_today('a_viewer'), 'B: the Viewer''s items are exactly Today''s (none)');
select is((select count(*) from app.needs_you_items(tests.tid('a'), tests.uid('a_owner'))), 3::bigint, 'B: the Owner has three things waiting: two messages and a call');
select is((select count(*) from app.needs_you_items(tests.tid('a'), tests.uid('a_admin'))), 2::bigint, 'B: the Admin two (a call is the Owner''s)');
select is((select count(*) from app.needs_you_items(tests.tid('a'), tests.uid('b_owner'))), 0::bigint, 'B: a person of another business has none of ours');
select is((select count(*) from app.needs_you_items(tests.tid('a'), tests.uid('outsider'))), 0::bigint, 'B: a stranger has none');

-- ---------------------------------------------------------------------------------------------
-- C. the feed and the unread mark
-- ---------------------------------------------------------------------------------------------
create function pg_temp.nl(p_user text, p_tenant text default 'a', p_limit int default 20) returns text language sql as $$ select pg_temp.sc(p_user, format('select public.notifications_list(%L, %s)', tests.tid(p_tenant), p_limit)) $$;
select is(pg_temp.j(pg_temp.nl('a_owner'), 'unread_count'), '3', 'C: all three are unread before the first look');
select is(pg_temp.j(pg_temp.nl('a_owner'), 'total'), '3', 'C: three in all');
select is(jsonb_array_length(pg_temp.nl('a_owner', 'a', 2)::jsonb -> 'items'), 2, 'C: the list is limited ...');
select is(pg_temp.j(pg_temp.nl('a_owner', 'a', 2), 'unread_count'), '3', 'C: ... but the count is not');
select is(pg_temp.nl('a_owner', 'a', 0), 'ERR:22023', 'C: a page of 0 is invalid');
select is(pg_temp.nl('a_owner', 'a', 51), 'ERR:22023', 'C: a page over 50 is invalid');
select is(pg_temp.nl('b_owner', 'a'), 'ERR:42501', 'C: another business cannot read our feed');
select is(pg_temp.nl('anon'), 'ERR:42501', 'C: anon cannot');
select is(pg_temp.j(pg_temp.nl('a_viewer'), 'total'), '0', 'C: a Viewer has an empty feed');
select is((pg_temp.nl('a_owner')::jsonb -> 'items' -> 0 ->> 'unread')::boolean, true, 'C: each item says whether it is unread');
select is(pg_temp.nl('a_owner')::text !~* 'Hello w1', true, 'C: no message text is in the feed');
select is(pg_temp.sc('a_admin', format('select public.notifications_mark_seen(%L)', tests.tid('a'))) like 'ERR:%', false, 'C: the Admin marks the feed seen');
select is(pg_temp.j(pg_temp.nl('a_admin'), 'unread_count'), '0', 'C: ...nothing is unread for the Admin');
select is(pg_temp.j(pg_temp.nl('a_owner'), 'unread_count'), '3', 'C: ...the Owner''s own mark is separate: still three');
select pg_temp.sc('a_owner', format('select public.notifications_mark_seen(%L)', tests.tid('a')));
select is(pg_temp.j(pg_temp.nl('a_owner'), 'unread_count'), '0', 'C: the Owner looked: none unread');
select pg_temp.msg('w3', 'needs_approval', 'a', interval '1 minute');
select is(pg_temp.j(pg_temp.nl('a_owner'), 'unread_count'), '1', 'C: a new item is unread');
select is(pg_temp.j(pg_temp.nl('a_owner'), 'total'), '4', 'C: ...four wait in all');
select is(pg_temp.sc('b_owner', format('select public.notifications_mark_seen(%L)', tests.tid('a'))), 'ERR:42501', 'C: another business cannot mark our feed');
select is(pg_temp.sc('anon', format('select public.notifications_mark_seen(%L)', tests.tid('a'))), 'ERR:42501', 'C: anon cannot');

-- ---------------------------------------------------------------------------------------------
-- D. subscriptions and the opt-in
-- ---------------------------------------------------------------------------------------------
create function pg_temp.sub(p_user text, p_endpoint text default 'https://push.example.test/send/abc123', p_key text default null, p_auth text default null) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.push_subscribe(%L, %L, %L)', p_endpoint, coalesce(p_key, repeat('B', 87)), coalesce(p_auth, repeat('a', 22)))) $$;
select is(pg_temp.sub('anon'), 'ERR:42501', 'D: anon cannot subscribe');
select is(pg_temp.sub('a_owner', 'http://push.example.test/x'), 'ERR:22023', 'D: an endpoint must be https');
select is(pg_temp.sub('a_owner', 'https://x'), 'ERR:22023', 'D: ...and a real address');
select is(pg_temp.sub('a_owner', 'https://push.example.test/send/abc123', 'short'), 'ERR:22023', 'D: the public key must be the right size');
select is(pg_temp.sub('a_owner', 'https://push.example.test/send/abc123', null, 'x'), 'ERR:22023', 'D: ...and the auth secret');
select is(pg_temp.sub('a_owner', null), 'ERR:22023', 'D: a null endpoint is invalid');
select is(pg_temp.sub('a_owner') like 'ERR:%', false, 'D: the Owner subscribes a browser');
select is(pg_temp.sub('a_owner') like 'ERR:%', false, 'D: the same endpoint again updates it');
select is((select count(*) from notify.push_subscriptions where user_id = tests.uid('a_owner')), 1::bigint, 'D: ...one subscription');
select is(pg_temp.sub('a_admin', 'https://push.example.test/send/abc123') like 'ERR:%', false, 'D: another person may have the same endpoint (a shared browser): theirs is theirs');
select is((select count(*) from notify.push_subscriptions where endpoint = 'https://push.example.test/send/abc123'), 2::bigint, 'D: ...two rows');
do $$ begin for i in 1 .. 9 loop perform pg_temp.sub('a_sales', 'https://push.example.test/send/s' || i); end loop; end $$;
select is(pg_temp.sub('a_sales', 'https://push.example.test/send/s10') like 'ERR:%', false, 'D: ten subscriptions are allowed');
select is(pg_temp.sub('a_sales', 'https://push.example.test/send/s11'), 'ERR:22023', 'D: an eleventh is refused');
select is(pg_temp.j(pg_temp.sc('a_sales', $$select public.push_unsubscribe('https://push.example.test/send/s10')$$), 'removed'), '1', 'D: unsubscribing removes it');
select is(pg_temp.j(pg_temp.sc('a_sales', $$select public.push_unsubscribe('https://push.example.test/send/s10')$$), 'removed'), '0', 'D: ...and again removes nothing');
select is(pg_temp.j(pg_temp.sc('a_viewer', $$select public.push_unsubscribe('https://push.example.test/send/abc123')$$), 'removed'), '0', 'D: nobody removes another person''s subscription');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.push_prefs_get(%L)', tests.tid('a'))), 'enabled'), 'false', 'D: push is OFF until the member switches it on');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.push_prefs_get(%L)', tests.tid('a'))), 'subscriptions'), '1', 'D: ...and says how many browsers are subscribed');
select is(pg_temp.sc('b_owner', format('select public.push_prefs_set(%L, true)', tests.tid('a'))), 'ERR:42501', 'D: another business''s Owner cannot opt in to our feed');
select is(pg_temp.sc('a_owner', format('select public.push_prefs_set(%L, null)', tests.tid('a'))), 'ERR:22023', 'D: null is invalid');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.push_prefs_set(%L, true)', tests.tid('a'))), 'enabled'), 'true', 'D: the Owner opts in');
select is((select count(*) from notify.push_sent where user_id = tests.uid('a_owner') and tenant_id = tests.tid('a')), 4::bigint, 'D: what already waited (four things) counts as told: only what arrives AFTER is pushed');

-- ---------------------------------------------------------------------------------------------
-- E. what the worker is told to push
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.sc('a_owner', 'select public.push_worker_pending()'), 'ERR:42501', 'E: an Owner is not the worker (42501)');
select is(pg_temp.sc('anon', 'select public.push_worker_pending()'), 'ERR:42501', 'E: anon is not');
select pg_temp.pin('2026-10-05T14:00:00+05:30');
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'E: nothing is new since the opt-in: nothing to push');
select pg_temp.pin('2026-10-05T14:00:00+05:30');
select pg_temp.msg('w4');
select pg_temp.call('k2');
select pg_temp.pin('2026-10-05T14:00:00+05:30');
create temp table pend2 as select pg_temp.w('select public.push_worker_pending()')::jsonb as r;
select is(jsonb_array_length((select r from pend2)), 1, 'E: by day: one member has something new to be told');
select is((select r -> 0 ->> 'user_id' from pend2), tests.uid('a_owner')::text, 'E: ...the opted-in Owner (not the Admin, who did not opt in)');
select is((select jsonb_array_length(r -> 0 -> 'items') from pend2), 2, 'E: ...two new things (a message and a call)');
select is((select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from pend2, jsonb_array_elements(r -> 0 -> 'items') x), 'call_approval,outbox_approval', 'E: ...by kind');
select is((select r -> 0 -> 'subscriptions' -> 0 ->> 'endpoint' from pend2), 'https://push.example.test/send/abc123', 'E: with the browser to push to');
select is((select r::text !~* '(hello|customer|order)' from pend2), true, 'E: and no customer text, name or amount');
select is(pg_temp.w(format($q$select public.push_worker_mark(%L, %L, %L::jsonb)$q$, tests.tid('a'), tests.uid('a_owner'), (select (r -> 0 -> 'items')::text from pend2))), '2', 'E: the worker marks them told');
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'E: and they are never offered again');
select is(pg_temp.w(format($q$select public.push_worker_mark(%L, %L, '[{"kind":"quote_approval","id":"%s"}]'::jsonb)$q$, tests.tid('a'), tests.uid('a_owner'), tests.rid('anything'))) like 'ERR:%', false, 'E: marking is idempotent and harmless');
select is(pg_temp.w(format($q$select public.push_worker_mark(%L, %L, '{}'::jsonb)$q$, tests.tid('a'), tests.uid('a_owner'))), 'ERR:22023', 'E: items must be a list');
select pg_temp.msg('w5');
select pg_temp.pin('2026-10-05T23:30:00+05:30');
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'E: at 23:30 India time (the business''s quiet hours) a new item waits until morning');
select pg_temp.pin('2026-10-06T09:00:00+05:30');
select is(jsonb_array_length(pg_temp.w('select public.push_worker_pending()')::jsonb), 1, 'E: at 09:00 it is pushed');
select pg_temp.pin('2026-10-05T14:00:00+05:30');
-- a member who switches off, or leaves, or has no subscription, is never pushed to
select pg_temp.sc('a_owner', format('select public.push_prefs_set(%L, false)', tests.tid('a')));
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'E: after switching push off, nothing is pushed');
select pg_temp.sc('a_owner', format('select public.push_prefs_set(%L, true)', tests.tid('a')));
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'E: switching on again counts what waits as told (nothing is pushed for the old things)');
select pg_temp.sc('a_admin', format('select public.push_prefs_set(%L, true)', tests.tid('a')));
select pg_temp.msg('w6');
select is(jsonb_array_length(pg_temp.w('select public.push_worker_pending()')::jsonb), 2, 'E: the Admin (opted in, one subscription) and the Owner both have something new');
delete from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('a_admin');
select is(jsonb_array_length(pg_temp.w('select public.push_worker_pending()')::jsonb), 1, 'E: a member who was removed is not pushed to');
delete from notify.push_subscriptions where user_id = tests.uid('a_owner');
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'E: nor one with no browser subscribed');
-- reports
select pg_temp.sub('a_owner', 'https://push.example.test/send/r1');
create function pg_temp.sid(p text) returns uuid language sql as $$ select id from notify.push_subscriptions where endpoint = p $$;
select is(pg_temp.w(format($q$select public.push_worker_report(%L, 'ok')$q$, pg_temp.sid('https://push.example.test/send/r1'))), '', 'E: an ok report is recorded');
select is((select last_success_at is not null from notify.push_subscriptions where endpoint = 'https://push.example.test/send/r1'), true, 'E: ...the time is kept');
do $$ begin for i in 1 .. 4 loop perform pg_temp.w(format($q$select public.push_worker_report(%L, 'failed')$q$, pg_temp.sid('https://push.example.test/send/r1'))); end loop; end $$;
select is((select failures from notify.push_subscriptions where endpoint = 'https://push.example.test/send/r1'), 4, 'E: four failures are kept');
select pg_temp.w(format($q$select public.push_worker_report(%L, 'failed')$q$, pg_temp.sid('https://push.example.test/send/r1')));
select is((select count(*) from notify.push_subscriptions where endpoint = 'https://push.example.test/send/r1'), 0::bigint, 'E: the fifth failure in a row deletes the subscription');
select pg_temp.sub('a_owner', 'https://push.example.test/send/r2');
select pg_temp.w(format($q$select public.push_worker_report(%L, 'gone')$q$, pg_temp.sid('https://push.example.test/send/r2')));
select is((select count(*) from notify.push_subscriptions where endpoint = 'https://push.example.test/send/r2'), 0::bigint, 'E: "gone" (the browser forgot it) deletes it at once');
select is(pg_temp.w(format($q$select public.push_worker_report(%L, 'exploded')$q$, gen_random_uuid())), 'ERR:22023', 'E: an unknown outcome is invalid');
select is(pg_temp.sc('a_owner', format($q$select public.push_worker_report(%L, 'ok')$q$, gen_random_uuid())), 'ERR:42501', 'E: only the worker reports');
select is(pg_temp.sc('a_owner', format($q$select public.push_worker_mark(%L, %L, '[]'::jsonb)$q$, tests.tid('a'), tests.uid('a_owner'))), 'ERR:42501', 'E: only the worker marks');

select * from finish();
rollback;
