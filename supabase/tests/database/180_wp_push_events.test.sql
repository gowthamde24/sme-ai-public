-- Job WP (web push, part 2): the two EVENT kinds the worker may push, call_starting and customer_replied (migration 20261231420000).
--   A catalog   B call_starting: who, how fresh, how live   C customer_replied: who, how fresh, the 5-minute throttle   D the shared rules still hold (opt-in, quiet hours, once, the mark accepts the kinds)
--   E the Today feed is unchanged by the events
-- THE CLOCK: quiet hours use app.outbox_now() (pinned here to 14:00 India time on a Monday); the freshness windows use the real clock, because a call and a reply are only news for a minute or two.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-10-05T14:00:00+05:30');
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.sc('x5', p_sql) $$;   -- the worker (registered below)
select app.operator_register_scheduler('x5@test.local');

-- a live call, started p_age ago, in tenant a (state in_progress unless said otherwise)
create function pg_temp.call(p_id text, p_age interval default interval '10 seconds', p_state text default 'in_progress', p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.phone_calls (id, tenant_id, direction, provider, state, created_at, ended_at)
  values (tests.rid(p_id), tests.tid(p_tenant), 'inbound', 'sandbox', p_state, now() - p_age, case when p_state = 'completed' then now() end);
end $$;
-- a customer's reply recorded p_age ago on the tenant's lead
create function pg_temp.reply(p_id text, p_age interval default interval '1 minute', p_tenant text default 'a') returns void language plpgsql as $$
begin
  alter table public.lead_touches disable trigger user;
  insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), (select contact_id from public.leads where id = tests.rid(p_tenant || '_lead')), 'in', 'whatsapp', now() - p_age, now() - p_age);
  alter table public.lead_touches enable trigger user;
end $$;
create function pg_temp.kinds(p_user text) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from (select e.kind || ':' || 'true' as k from app.push_event_items(tests.tid('a'), tests.uid(p_user)) e) z
$$;
create function pg_temp.pend_kinds() returns text language sql as $$
  select coalesce(string_agg(x ->> 'kind', ',' order by x ->> 'kind'), '') from jsonb_array_elements(pg_temp.w('select public.push_worker_pending()')::jsonb) m, jsonb_array_elements(m -> 'items') x
$$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'push_event_items'
            and has_function_privilege('anon', p.oid, 'execute') is false and has_function_privilege('authenticated', p.oid, 'execute') is false and has_function_privilege('service_role', p.oid, 'execute') is false), 1::bigint,
          'A: app.push_event_items can be executed by no client role');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('push_worker_pending', 'push_worker_mark')
            and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('anon', p.oid, 'execute') is false), 2::bigint,
          'A: the two replaced worker functions are still SECURITY DEFINER, with an empty search_path, closed to anon');
select is(pg_temp.sc('a_owner', 'select public.push_worker_pending()'), 'ERR:42501', 'A: an Owner is still not the worker');

-- ---------------------------------------------------------------------------------------------
-- B. call_starting: Owner and Admin, a call that is live and began less than 90 seconds ago
-- ---------------------------------------------------------------------------------------------
select pg_temp.call('c_new');
select is(pg_temp.kinds('a_owner'), 'call_starting:true', 'B: the Owner is told a call is starting');
select is(pg_temp.kinds('a_admin'), 'call_starting:true', 'B: ...and the Admin');
select is(pg_temp.kinds('a_sales'), '', 'B: ...but not Sales');
select is(pg_temp.kinds('a_viewer'), '', 'B: ...and not a Viewer');
select is((select count(*) from app.push_event_items(tests.tid('b'), tests.uid('a_owner'))), 0::bigint, 'B: a person who is not a member of that workspace is told nothing about it');
select pg_temp.call('c_other', interval '5 seconds', 'in_progress', 'b');
select is(pg_temp.kinds('a_owner'), 'call_starting:true', 'B: another business''s call is never ours');
select pg_temp.call('c_old', interval '5 minutes');
select pg_temp.call('c_done', interval '10 seconds', 'completed');
select pg_temp.call('c_queued', interval '10 seconds', 'queued');
select is((select count(*) from app.push_event_items(tests.tid('a'), tests.uid('a_owner'))), 1::bigint, 'B: a call older than 90 seconds, a finished call and a queued one are not news (only the new live call)');

-- ---------------------------------------------------------------------------------------------
-- C. customer_replied: Owner, Admin and Sales, a reply recorded less than 15 minutes ago, throttled
-- ---------------------------------------------------------------------------------------------
select pg_temp.reply('r1', interval '1 minute');
select is(pg_temp.kinds('a_owner'), 'call_starting:true,customer_replied:true', 'C: the Owner is told about the reply');
select is(pg_temp.kinds('a_sales'), 'customer_replied:true', 'C: Sales is told about a reply (but not about calls)');
select is(pg_temp.kinds('a_viewer'), '', 'C: a Viewer is told nothing');
select pg_temp.reply('r_old', interval '16 minutes');
select pg_temp.reply('r_b', interval '1 minute', 'b');
select is((select count(*) from app.push_event_items(tests.tid('a'), tests.uid('a_owner')) where kind = 'customer_replied'), 1::bigint, 'C: a reply older than 15 minutes, and another business''s reply, are not news');

-- ---------------------------------------------------------------------------------------------
-- D. the shared rules: opt-in, subscription, once, the throttle, quiet hours, the mark
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.pend_kinds(), '', 'D: nobody opted in: nothing is pushed');
select pg_temp.sc('a_owner', format('select public.push_subscribe(%L, %L, %L)', 'https://push.example.test/send/wp1', repeat('B', 87), repeat('a', 22)));
select pg_temp.sc('a_sales', format('select public.push_subscribe(%L, %L, %L)', 'https://push.example.test/send/wp2', repeat('B', 87), repeat('a', 22)));
select pg_temp.sc('a_owner', format('select public.push_prefs_set(%L, true)', tests.tid('a')));
select pg_temp.sc('a_sales', format('select public.push_prefs_set(%L, true)', tests.tid('a')));
select is(pg_temp.pend_kinds(), 'call_starting,customer_replied,customer_replied', 'D: opted in: the Owner gets the call and the reply, Sales the reply');
select is((select count(*) from jsonb_array_elements(pg_temp.w('select public.push_worker_pending()')::jsonb) m where m ->> 'user_id' = tests.uid('a_sales')::text), 1::bigint, 'D: Sales is one member entry');
select pg_temp.pin('2026-10-05T23:30:00+05:30');
select is(pg_temp.w('select public.push_worker_pending()'), '[]', 'D: in the business''s quiet hours nothing is pushed, events included');
select pg_temp.pin('2026-10-05T14:00:00+05:30');
select is(pg_temp.w(format($q$select public.push_worker_mark(%L, %L, %L::jsonb)$q$, tests.tid('a'), tests.uid('a_owner'),
          jsonb_build_array(jsonb_build_object('kind', 'call_starting', 'id', tests.rid('c_new')), jsonb_build_object('kind', 'customer_replied', 'id', tests.rid('r1'))))), '2', 'D: the mark accepts the two event kinds');
select is(pg_temp.pend_kinds(), 'customer_replied', 'D: told once: the Owner is not offered them again (Sales still has the reply)');
select pg_temp.reply('r2', interval '30 seconds');
select is(pg_temp.pend_kinds(), 'customer_replied,customer_replied', 'D: throttle: the Owner (told of a reply under 5 minutes ago) is offered nothing new; only Sales, never told, gets the two replies');
select is((select count(*) from jsonb_array_elements(pg_temp.w('select public.push_worker_pending()')::jsonb) m, jsonb_array_elements(m -> 'items') x where m ->> 'user_id' = tests.uid('a_sales')::text), 2::bigint, 'D: ...and Sales gets the two replies together');
update notify.push_sent set sent_at = now() - interval '6 minutes' where kind = 'customer_replied' and user_id = tests.uid('a_owner');
select is((select count(*) from jsonb_array_elements(pg_temp.w('select public.push_worker_pending()')::jsonb) m, jsonb_array_elements(m -> 'items') x where m ->> 'user_id' = tests.uid('a_owner')::text), 1::bigint, 'D: after five minutes the waiting reply goes out');
select is(pg_temp.w(format($q$select public.push_worker_mark(%L, %L, '[{"kind":"made_up","id":"%s"}]'::jsonb)$q$, tests.tid('a'), tests.uid('a_owner'), tests.rid('zz'))), '0', 'D: a kind the worker may not mark is ignored');
select is(pg_temp.w('select (public.push_worker_pending())::text') ~ '(Pushpa|Hello|\+91|name)', false, 'D: nothing in the worker''s list names a customer or carries a number');

-- ---------------------------------------------------------------------------------------------
-- E. the Today feed does not know the events
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from app.needs_you_items(tests.tid('a'), tests.uid('a_owner')) where kind in ('call_starting', 'customer_replied')), 0::bigint, 'E: needs_you_items never lists an event kind (the feed and today_summary stay equal)');

select * from finish();
rollback;
