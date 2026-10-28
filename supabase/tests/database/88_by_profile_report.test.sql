-- Job BY (ADR 0077): the shop's basics and the weekly report (migration 20261118090100).
--   A catalog   B the profile   C the weekly report: roles, the India week and its edges, visits, messages, response time, top sarees, the allowance, isolation
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'workspace' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), 6::bigint, 'A: the workspace tables (the business''s profile, the members'' profiles and, since job DT, the opening line and its switch, and the voice choices) have row-level security on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A: no client role holds any privilege on it');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('workspace_profile_get', 'workspace_profile_save', 'weekly_report') and p.prosecdef and p.proconfig @> array['search_path=""']), 3::bigint, 'A: the three functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('workspace_profile_get', 'workspace_profile_save', 'weekly_report') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'A: anon can execute none of them');

-- ---------------------------------------------------------------------------------------------
-- B. the profile
-- ---------------------------------------------------------------------------------------------
create function pg_temp.pget(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.workspace_profile_get(%L)', tests.tid(p_tenant))) $$;
create function pg_temp.psave(p_user text, p_name text, p_town text, p_langs text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.workspace_profile_save(%L, %L, %L, %s)', tests.tid(p_tenant), p_name, p_town, p_langs), 'aal1') $$;
select is(pg_temp.j(pg_temp.pget('a_viewer'), 'setup_complete'), 'false', 'B: a new workspace is not set up');
select is(pg_temp.pget('a_viewer')::jsonb -> 'missing', '["town", "languages"]'::jsonb, 'B: ...and says what is missing');
select is(pg_temp.j(pg_temp.pget('a_viewer'), 'name'), 'Tenant A', 'B: the shop name is the workspace''s name');
select is(pg_temp.pget('b_owner', 'a'), 'ERR:42501', 'B: another business reads nothing of ours');
select is(pg_temp.pget('anon'), 'ERR:42501', 'B: anon neither');
select is(pg_temp.psave('a_sales', null, 'Guntur', 'null'), 'ERR:42501', 'B: Sales cannot save');
select is(pg_temp.psave('a_viewer', null, 'Guntur', 'null'), 'ERR:42501', 'B: a Viewer cannot');
select is(pg_temp.psave('b_owner', null, 'Guntur', 'null', 'a'), 'ERR:42501', 'B: another business cannot');
select is(pg_temp.j(pg_temp.psave('a_admin', null, 'Guntur', 'null'), 'town'), 'Guntur', 'B: an Admin saves the town (no second factor is asked: it is not a risky setting)');
select is(pg_temp.pget('a_owner')::jsonb -> 'missing', '["languages"]'::jsonb, 'B: ...languages are still missing');
select is(pg_temp.j(pg_temp.psave('a_owner', null, null, 'array[''te'',''en'',''te'']'), 'languages'), '["en", "te"]', 'B: the Owner saves languages (a set: duplicates folded, in order)');
select is(pg_temp.j(pg_temp.pget('a_owner'), 'setup_complete'), 'true', 'B: now it is set up');
select is(pg_temp.j(pg_temp.pget('a_owner'), 'town'), 'Guntur', 'B: ...and the town was kept when only languages were saved');
select is(pg_temp.j(pg_temp.psave('a_owner', 'Ravi Silks & Sarees', null, 'null'), 'name'), 'Ravi Silks & Sarees', 'B: the name can be changed');
select is((select name from public.tenants where id = tests.tid('a')), 'Ravi Silks & Sarees', 'B: ...it is the workspace''s name');
select is(pg_temp.psave('a_owner', '   ', null, 'null'), 'ERR:22023', 'B: a blank name is invalid');
select is(pg_temp.psave('a_owner', repeat('x', 121), null, 'null'), 'ERR:22023', 'B: a name over 120 characters is invalid');
select is(pg_temp.psave('a_owner', null, 'x', 'null'), 'ERR:22023', 'B: a one-letter town is invalid');
select is(pg_temp.psave('a_owner', null, '   ', 'null'), 'ERR:22023', 'B: a blank town is invalid');
select is(pg_temp.psave('a_owner', null, null, 'array[]::text[]'), 'ERR:22023', 'B: no language at all is invalid');
select is(pg_temp.psave('a_owner', null, null, 'array[''fr'']'), 'ERR:22023', 'B: an unknown language is invalid');
select is(pg_temp.j(pg_temp.pget('a_owner'), 'town'), 'Guntur', 'B: a refused save changed nothing');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace.profile_saved'), 3::bigint, 'B: each save was audited');
select is((select bool_and(new_values::text !~* '(guntur|ravi)') from public.audit_events where action = 'workspace.profile_saved'), true, 'B: ...with which fields changed, not their values');
select is(pg_temp.j(pg_temp.pget('b_owner', 'b'), 'town'), null, 'B: the other business''s profile is its own');

-- ---------------------------------------------------------------------------------------------
-- C. the weekly report: the India week Monday 2026-09-28 to Sunday 2026-10-04
-- ---------------------------------------------------------------------------------------------
create function pg_temp.rep(p_user text, p_week text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.weekly_report(%L, %L)', tests.tid(p_tenant), p_week)) $$;
create function pg_temp.ist(p text) returns timestamptz language sql as $$ select (p || '+05:30')::timestamptz $$;
-- a second customer, for the unanswered one
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('c2'), tests.tid('a'), tests.rid('a_company'), 'Second Customer', '+00 9000 000 002');
insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid('l2'), tests.tid('a'), tests.rid('a_company'), tests.rid('c2'));
alter table public.store_visits disable trigger user;
alter table public.outbox_messages disable trigger user;
alter table public.enquiries disable trigger user;
create function pg_temp.visit(p_id text, p_when text, p_status text, p_outcome text default null, p_tenant text default 'a') returns void language plpgsql as $$
declare v_start timestamptz := pg_temp.ist(p_when);
begin
  insert into public.store_visits (id, tenant_id, lead_id, visit_date, starts_at, ends_at, party_size, purpose, status, source, outcome, request_sha256, created_by, arrived_at, closed_at, cancel_reason, confirmed_at)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), (v_start at time zone 'Asia/Kolkata')::date, v_start, v_start + interval '30 minutes', 2, 'saree shopping', p_status, 'staff', p_outcome, pg_temp.h(p_id), tests.uid(p_tenant || '_owner'),
          case when p_status in ('arrived', 'completed') then v_start end, case when p_status in ('completed', 'no_show', 'cancelled') then v_start + interval '1 hour' end,
          case when p_status = 'cancelled' then 'changed mind' end, case when p_status = 'confirmed' then v_start - interval '1 day' end);
end $$;
select pg_temp.visit('v1', '2026-09-28 10:00:00', 'completed', 'bought');
select pg_temp.visit('v2', '2026-09-29 11:00:00', 'completed', 'will_return');
select pg_temp.visit('v3', '2026-09-30 12:00:00', 'booked');
select pg_temp.visit('v4', '2026-10-01 12:00:00', 'no_show');
select pg_temp.visit('v5', '2026-10-02 12:00:00', 'cancelled');
select pg_temp.visit('v6', '2026-10-04 23:30:00', 'confirmed');   -- the last half hour of the week (Sunday)
select pg_temp.visit('v7', '2026-10-05 00:30:00', 'booked');      -- Monday 00:30: next week
select pg_temp.visit('v8', '2026-09-27 23:30:00', 'booked');      -- Sunday 23:30: last week
select pg_temp.visit('v9', '2026-09-28 00:00:00', 'booked');      -- exactly Monday 00:00 India time: this week
select pg_temp.visit('vb', '2026-09-29 10:00:00', 'completed', 'bought', 'b');   -- another business: never counted
create function pg_temp.msg(p_id text, p_status text, p_created text, p_sent text default null, p_lead text default 'a_lead', p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by, created_at, sent_at, adapter, adapter_message_id, failure_code)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_lead), (select contact_id from public.leads where id = tests.rid(p_lead)), 'whatsapp', 'Hello there ' || p_id, 'en', 'info', p_status,
          case p_status when 'sent' then 'auto_allowed' when 'failed' then 'send_failed' when 'blocked' then 'stopped' when 'needs_approval' then 'money' else 'auto_allowed' end, pg_temp.h(p_id), tests.uid(p_tenant || '_owner'),
          pg_temp.ist(p_created), case when p_sent is not null then pg_temp.ist(p_sent) end, case when p_status = 'sent' then 'fake' end, case when p_status = 'sent' then 'fake-' || p_id end, case when p_status = 'failed' then 'adapter_error' end);
end $$;
select pg_temp.msg('m0', 'sent', '2026-09-27 23:50:00', '2026-09-27 23:59:00');   -- last week
select pg_temp.msg('m1', 'sent', '2026-09-28 09:09:00', '2026-09-28 09:10:00');
select pg_temp.msg('m2', 'sent', '2026-09-29 09:29:00', '2026-09-29 09:30:00');
select pg_temp.msg('m3', 'sent', '2026-10-01 09:59:00', '2026-10-01 10:00:00');
select pg_temp.msg('m4', 'sent', '2026-10-05 09:00:00', '2026-10-05 09:01:00');   -- next week
select pg_temp.msg('mb', 'blocked', '2026-09-30 10:00:00');
select pg_temp.msg('mf', 'failed', '2026-09-30 11:00:00');
select pg_temp.msg('mw1', 'needs_approval', '2026-10-02 10:00:00');
select pg_temp.msg('mw2', 'queued', '2026-10-03 10:00:00');
select pg_temp.msg('mx', 'blocked', '2026-10-06 10:00:00');                       -- next week
select pg_temp.msg('mbb', 'sent', '2026-09-30 09:00:00', '2026-09-30 09:01:00', 'b_lead', 'b');   -- another business
create function pg_temp.enq(p_id text, p_when text, p_lead text default 'a_lead', p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.enquiries (id, tenant_id, lead_id, company_id, contact_id, channel, received_at, body, body_sha256)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_lead), (select company_id from public.leads where id = tests.rid(p_lead)), (select contact_id from public.leads where id = tests.rid(p_lead)), 'whatsapp', pg_temp.ist(p_when), 'Question ' || p_id, pg_temp.h(p_id));
end $$;
select pg_temp.enq('e1', '2026-09-28 09:00:00');     -- answered in 10 minutes (m1 at 09:10)
select pg_temp.enq('e2', '2026-09-29 09:00:00');     -- answered in 30 minutes (m2 at 09:30)
select pg_temp.enq('e3', '2026-09-29 09:05:00');     -- a second message before the answer: not a new question
select pg_temp.enq('e4', '2026-09-30 09:00:00', 'l2');   -- never answered
select pg_temp.enq('e5', '2026-10-05 09:00:00');     -- next week
alter table public.store_visits enable trigger user;
alter table public.outbox_messages enable trigger user;
alter table public.enquiries enable trigger user;
-- the sarees whose photos went out
insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values
  (tests.rid('i1'), tests.tid('a'), 'Kanjivaram Red', 'kanchi_pattu', array['red'], '25k_50k', tests.uid('a_owner')),
  (tests.rid('i2'), tests.tid('a'), 'Banarasi Blue', 'banarasi', array['blue'], '10k_25k', tests.uid('a_owner'));
create function pg_temp.photo(p_id text, p_item text, p_pos int) returns void language sql as $$
  insert into public.catalogue_photos (id, tenant_id, item_id, position, bucket, path, thumb_path, width, height, bytes, thumb_bytes, created_by)
  values (tests.rid(p_id), tests.tid('a'), tests.rid(p_item), p_pos, app.catalogue_bucket(tests.tid('a')), tests.rid(p_item)::text || '/' || tests.rid(p_id)::text || '.jpg', tests.rid(p_item)::text || '/' || tests.rid(p_id)::text || '_t.jpg', 800, 800, 1000, 100, tests.uid('a_owner')) $$;
select pg_temp.photo('p1', 'i1', 1);
select pg_temp.photo('p2', 'i1', 2);
select pg_temp.photo('p3', 'i2', 1);
insert into public.outbox_message_media (tenant_id, message_id, photo_id, position) values
  (tests.tid('a'), tests.rid('m1'), tests.rid('p1'), 1), (tests.tid('a'), tests.rid('m1'), tests.rid('p3'), 2),
  (tests.tid('a'), tests.rid('m2'), tests.rid('p1'), 1), (tests.tid('a'), tests.rid('m3'), tests.rid('p2'), 1),
  (tests.tid('a'), tests.rid('m0'), tests.rid('p3'), 1), (tests.tid('a'), tests.rid('m4'), tests.rid('p3'), 1), (tests.tid('a'), tests.rid('mw2'), tests.rid('p3'), 1);

select is(pg_temp.rep('a_sales', '2026-09-28'), 'ERR:42501', 'C: Sales cannot read the report');
select is(pg_temp.rep('a_viewer', '2026-09-28'), 'ERR:42501', 'C: a Viewer cannot');
select is(pg_temp.rep('b_owner', '2026-09-28', 'a'), 'ERR:42501', 'C: another business cannot');
select is(pg_temp.rep('anon', '2026-09-28'), 'ERR:42501', 'C: anon cannot');
select is(pg_temp.rep('a_owner', '2026-09-29'), 'ERR:22023', 'C: a week must start on a Monday');
select is(pg_temp.rep('a_owner', '2999-01-04'), 'ERR:22023', 'C: a week in the future is invalid');
select is(pg_temp.rep('a_owner', '2020-01-06'), 'ERR:22023', 'C: more than two years back is invalid');
create temp table wk as select pg_temp.rep('a_owner', '2026-09-28')::jsonb as r;
select is((select r ->> 'week_start' || ' to ' || (r ->> 'week_end') || ' ' || (r ->> 'timezone') from wk), '2026-09-28 to 2026-10-04 Asia/Kolkata', 'C: the week is Monday to Sunday, India time');
select is((select r -> 'visits' from wk), '{"bought": 1, "booked": 6, "arrived": 2, "no_show": 1, "cancelled": 1, "will_return": 1, "not_interested": 0}'::jsonb,
          'C: visits: scheduled for the week (v1, v2, v3, v4, v6, v9 = 6; v5 cancelled; v7 and v8 are other weeks; the other business is not counted)');
select is((select r -> 'messages' from wk), '{"sent": 3, "failed": 1, "blocked": 1, "waiting": 2}'::jsonb, 'C: messages: 3 sent in the week (not the one before or after), 1 failed, 1 blocked, 2 made in the week and still waiting');
select is((select r -> 'response' from wk), '{"asked": 3, "answered": 2, "unanswered": 1, "median_seconds": 1200}'::jsonb, 'C: response: 3 questions (the second message before an answer is not a new one), 2 answered, the median of 10 and 30 minutes is 20 minutes');
select is((select r -> 'top_sarees' from wk), jsonb_build_array(jsonb_build_object('item_id', tests.rid('i1'), 'name', 'Kanjivaram Red', 'sent', 3), jsonb_build_object('item_id', tests.rid('i2'), 'name', 'Banarasi Blue', 'sent', 1)),
          'C: top sarees: photos of SENT messages of the week only (not last week''s, next week''s or a waiting message''s)');
select is((select r -> 'current' from wk), 'false'::jsonb, 'C: a past week is not "current"');
select is((select r -> 'ai_usage_percent' from wk), 'null'::jsonb, 'C: ...and has no allowance figure');
-- the edges of the India week
select is(pg_temp.j(pg_temp.rep('a_admin', '2026-09-21'), 'week_end'), '2026-09-27', 'C: an Admin reads another week');
select is((pg_temp.rep('a_admin', '2026-09-21')::jsonb -> 'visits' ->> 'booked'), '1', 'C: the previous week holds v8 (Sunday 23:30 India time) and nothing of this week');
select is((pg_temp.rep('a_admin', '2026-09-21')::jsonb -> 'messages' ->> 'sent'), '1', 'C: ...and the message sent at 23:59 on Sunday');
-- this week by default
select is((pg_temp.rep('a_owner', null)::jsonb ->> 'week_start')::date, app.india_week_start(now()), 'C: no week given = this India week');
select is((pg_temp.rep('a_owner', null)::jsonb ->> 'current'), 'true', 'C: ...and it is marked current');
select is(((pg_temp.rep('a_owner', null)::jsonb ->> 'ai_usage_percent')::int) between 0 and 100, true, 'C: ...with the allowance used (0 to 100)');
-- isolation
select is((pg_temp.rep('b_owner', '2026-09-28', 'b')::jsonb -> 'visits' ->> 'booked'), '1', 'C: the other business sees its own visit');
select is((pg_temp.rep('b_owner', '2026-09-28', 'b')::jsonb -> 'messages' ->> 'sent'), '1', 'C: ...and its own message');
select is((pg_temp.rep('b_owner', '2026-09-28', 'b')::jsonb -> 'top_sarees'), '[]'::jsonb, 'C: ...and none of our sarees');
select is((pg_temp.rep('a_owner', '2026-09-28', 'a')::jsonb -> 'messages' ->> 'sent'), '3', 'C: (ours is unchanged)');

select * from finish();
rollback;
