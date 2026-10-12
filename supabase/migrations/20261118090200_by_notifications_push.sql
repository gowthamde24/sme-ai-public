-- Job BY (ADR 0077), part 3 of 3: NOTIFICATIONS. The "needs you" feed with a read mark per member, and web-push: subscriptions, an opt-in per member and workspace, and the worker's three calls.
--
--   app.needs_you_items(tenant, user)       the things waiting for THAT person (the same five kinds, with the same role rules, as public.today_summary: a test pins them equal)
--   notify.member_state                     when each member last looked at the feed (the unread mark: an item is unread when it is newer than that)
--   notify.push_prefs                       web-push is OFF until the member switches it on, per workspace
--   notify.push_subscriptions               the browser's subscription (endpoint and keys: secrets, private schema, never returned by any function except to the sender)
--   notify.push_sent                        which items a member was already told about (so each is sent once)
--   public.notifications_list / notifications_mark_seen / push_subscribe / push_unsubscribe / push_prefs_get / push_prefs_set
--   public.push_worker_pending / push_worker_mark / push_worker_report     the scheduler account's calls; nothing is sent to a member who did not opt in, and only for items that WAIT for them.
--
-- A push is sent only for an item that is already waiting for the member (never for anything else), not during the business's quiet hours, and once. The text is a fixed sentence by kind: no customer name, no amount.
-- SQLSTATEs: 42501 deny, 22023 invalid.

create schema notify;
revoke all on schema notify from public, anon, authenticated, service_role;

create function app.notify_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid' then raise exception 'invalid input' using errcode = '22023';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.notify_error(text) from public;

create table notify.member_state (
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  user_id      uuid not null,
  last_seen_at timestamptz not null,
  primary key (tenant_id, user_id)
);
create table notify.push_prefs (
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  user_id    uuid not null,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create table notify.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  endpoint        text not null check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) between 20 and 1000),
  p256dh          text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth            text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failures        integer not null default 0 check (failures >= 0),
  unique (user_id, endpoint)
);
create index push_subscriptions_user_idx on notify.push_subscriptions (user_id);
create table notify.push_sent (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id   uuid not null,
  kind      text not null,
  item_id   uuid not null,
  sent_at   timestamptz not null default now(),
  primary key (tenant_id, user_id, kind, item_id)
);
create index push_sent_at_idx on notify.push_sent (sent_at);
do $$ declare t text; begin
  foreach t in array array['member_state', 'push_prefs', 'push_subscriptions', 'push_sent'] loop
    execute format('alter table notify.%I enable row level security', t);
    execute format('alter table notify.%I force row level security', t);
    execute format('revoke all on notify.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
comment on column notify.push_subscriptions.endpoint is 'SECRET-LIKE: a capability to push to one browser. Private schema; returned only to the worker that sends.';
comment on column notify.push_subscriptions.auth is 'SECRET: the subscription''s authentication secret (RFC 8291).';

-- what waits for THIS person: the five kinds of public.today_summary with its role rules (Owner and Admin decide quotes, follow-ups and messages; only the Owner decides calls and held money)
create function app.needs_you_items(p_tenant uuid, p_user uuid) returns table (kind text, id uuid, customer text, city text, agent text, ref text, amount_paise bigint, at timestamptz, target_type text, target_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text := (select m.role::text from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user);
  v_decider boolean;
  v_owner boolean;
begin
  v_decider := v_role in ('owner', 'admin');
  v_owner := v_role = 'owner';
  return query
  with items as (
    select 'quote_approval'::text as k, qt.id as i, c.name as cu, c.city as ci, 'quote_writer'::text as ag, qt.quote_no::text as rf, qt.total_paise as am, qt.created_at as a, 'quote'::text as tt, qt.id as ti
      from public.quotes qt
      left join public.leads l on l.tenant_id = qt.tenant_id and l.id = qt.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and qt.tenant_id = p_tenant and qt.status = 'draft'
    union all
    select 'followup_due', d.id, c.name, c.city, 'followup_desk', d.touch_number::text, null::bigint, d.created_at, 'lead', d.lead_id
      from public.followup_drafts d
      left join public.leads l on l.tenant_id = d.tenant_id and l.id = d.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and d.tenant_id = p_tenant and d.status = 'draft'
    union all
    select 'order_money_held', o.id, c.name, c.city, 'order_desk', o.order_no::text, g.net_paise, coalesce(o.closed_at, o.updated_at), 'order', o.id
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
      left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and o.tenant_id = p_tenant and o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0
    union all
    select 'outbox_approval', m.id, c.name, c.city, 'followup_desk', m.category, null::bigint, m.created_at, 'outbox_message', m.id
      from public.outbox_messages m
      left join public.leads l on l.tenant_id = m.tenant_id and l.id = m.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and m.tenant_id = p_tenant and m.status = 'needs_approval'
    union all
    select 'call_approval', r.id, c.name, c.city, 'followup_desk', 'call', null::bigint, r.created_at, 'call_request', r.id
      from public.call_requests r
      left join public.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and r.tenant_id = p_tenant and r.status = 'requested'
  )
  select x.k, x.i, x.cu, x.ci, x.ag, x.rf, x.am, x.a, x.tt, x.ti from items x order by x.a desc, x.i;
end;
$$;
revoke all on function app.needs_you_items(uuid, uuid) from public;

-- the feed: the newest 50 things waiting for the caller, each with whether it is newer than the caller's last look
create function public.notifications_list(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_seen timestamptz;
  v_total integer;
  v_unread integer;
  v_items jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.notify_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.notify_error('invalid');
  end if;
  select s.last_seen_at into v_seen from notify.member_state s where s.tenant_id = p_tenant_id and s.user_id = v_uid;
  select count(*)::integer, count(*) filter (where v_seen is null or n.at > v_seen)::integer into v_total, v_unread from app.needs_you_items(p_tenant_id, v_uid) n;
  select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'id', t.id, 'customer', t.customer, 'city', t.city, 'agent', t.agent, 'ref', t.ref, 'amount_paise', t.amount_paise, 'at', t.at,
                                               'target', jsonb_build_object('type', t.target_type, 'id', t.target_id), 'unread', v_seen is null or t.at > v_seen) order by t.at desc, t.id), '[]'::jsonb)
    into v_items from (select * from app.needs_you_items(p_tenant_id, v_uid) limit p_limit) t;
  return jsonb_build_object('total', v_total, 'unread_count', v_unread, 'last_seen_at', v_seen, 'items', v_items);
end;
$$;
revoke all on function public.notifications_list(uuid, integer) from public, anon;
grant execute on function public.notifications_list(uuid, integer) to authenticated;

create function public.notifications_mark_seen(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.notify_error('deny');
  end if;
  insert into notify.member_state (tenant_id, user_id, last_seen_at) values (p_tenant_id, auth.uid(), v_at)
  on conflict (tenant_id, user_id) do update set last_seen_at = excluded.last_seen_at;
  return jsonb_build_object('last_seen_at', v_at);
end;
$$;
revoke all on function public.notifications_mark_seen(uuid) from public, anon;
grant execute on function public.notifications_mark_seen(uuid) to authenticated;

-- the browser's subscription (the person's own, any workspace); at most 10 per person; the same endpoint again updates its keys
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s notify.push_subscriptions;
begin
  if v_uid is null then
    perform app.notify_error('deny');
  end if;
  if (select count(*) from notify.push_subscriptions x where x.user_id = v_uid and x.endpoint <> coalesce(p_endpoint, '')) >= 10 then
    perform app.notify_error('invalid');
  end if;
  begin
    insert into notify.push_subscriptions as x (user_id, endpoint, p256dh, auth) values (v_uid, p_endpoint, p_p256dh, p_auth)
    on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, failures = 0
    returning x.* into s;
  exception when check_violation or not_null_violation then
    perform app.notify_error('invalid');
  end;
  return jsonb_build_object('id', s.id, 'created_at', s.created_at);
end;
$$;
revoke all on function public.push_subscribe(text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text) to authenticated;

create function public.push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    perform app.notify_error('deny');
  end if;
  delete from notify.push_subscriptions x where x.user_id = auth.uid() and x.endpoint = p_endpoint;
  get diagnostics n = row_count;
  return jsonb_build_object('removed', n);
end;
$$;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

create function public.push_prefs_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.notify_error('deny');
  end if;
  return jsonb_build_object(
    'enabled', coalesce((select p.enabled from notify.push_prefs p where p.tenant_id = p_tenant_id and p.user_id = auth.uid()), false),
    'subscriptions', (select count(*) from notify.push_subscriptions s where s.user_id = auth.uid()));
end;
$$;
revoke all on function public.push_prefs_get(uuid) from public, anon;
grant execute on function public.push_prefs_get(uuid) to authenticated;

-- Switching on counts what already waits as told (only what arrives AFTER is pushed). Off keeps the subscriptions.
create function public.push_prefs_set(p_tenant_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.notify_error('deny');
  end if;
  if p_enabled is null then
    perform app.notify_error('invalid');
  end if;
  insert into notify.push_prefs (tenant_id, user_id, enabled) values (p_tenant_id, v_uid, p_enabled)
  on conflict (tenant_id, user_id) do update set enabled = excluded.enabled, updated_at = now();
  if p_enabled then
    insert into notify.push_sent (tenant_id, user_id, kind, item_id) select p_tenant_id, v_uid, n.kind, n.id from app.needs_you_items(p_tenant_id, v_uid) n on conflict do nothing;
  end if;
  return jsonb_build_object('enabled', p_enabled);
end;
$$;
revoke all on function public.push_prefs_set(uuid, boolean) from public, anon;
grant execute on function public.push_prefs_set(uuid, boolean) to authenticated;

-- ---- the worker (the scheduler account)
-- For each opted-in member with a subscription: the items that wait for them and that they were not yet told about, outside the business's quiet hours. At most p_limit members.
create function public.push_worker_pending(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
  v_now timestamptz := app.outbox_now();   -- the outbox's clock seam: quiet hours are the business's own
begin
  if not app.is_scheduler() then
    perform app.notify_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.notify_error('invalid');
  end if;
  delete from notify.push_sent x where x.sent_at < v_now - interval '30 days';
  for r in
    select p.tenant_id, p.user_id from notify.push_prefs p
     where p.enabled and exists (select 1 from notify.push_subscriptions s where s.user_id = p.user_id)
       and exists (select 1 from public.memberships m where m.tenant_id = p.tenant_id and m.user_id = p.user_id)
       and not app.outbox_in_quiet_hours(v_now, p.tenant_id)
     order by p.tenant_id, p.user_id limit p_limit
  loop
    select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'id', n.id) order by n.at, n.id), '[]'::jsonb) into v_items
      from app.needs_you_items(r.tenant_id, r.user_id) n
     where not exists (select 1 from notify.push_sent x where x.tenant_id = r.tenant_id and x.user_id = r.user_id and x.kind = n.kind and x.item_id = n.id);
    if jsonb_array_length(v_items) > 0 then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'tenant_id', r.tenant_id, 'user_id', r.user_id, 'items', v_items,
        'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb) from notify.push_subscriptions s where s.user_id = r.user_id)));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.push_worker_pending(integer) from public, anon;
grant execute on function public.push_worker_pending(integer) to authenticated;

-- the items were told (at least one subscription accepted the push)
create function public.push_worker_mark(p_tenant_id uuid, p_user_id uuid, p_items jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not app.is_scheduler() then
    perform app.notify_error('deny');
  end if;
  if p_tenant_id is null or p_user_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    perform app.notify_error('invalid');
  end if;
  insert into notify.push_sent (tenant_id, user_id, kind, item_id)
  select p_tenant_id, p_user_id, x ->> 'kind', (x ->> 'id')::uuid from jsonb_array_elements(p_items) x
   where x ->> 'kind' in ('quote_approval', 'followup_due', 'order_money_held', 'outbox_approval', 'call_approval')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.push_worker_mark(uuid, uuid, jsonb) from public, anon;
grant execute on function public.push_worker_mark(uuid, uuid, jsonb) to authenticated;

-- what one subscription answered: ok, or gone (404/410: the browser forgot it: deleted), or another failure (five in a row delete it)
create function public.push_worker_report(p_subscription_id uuid, p_outcome text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.notify_error('deny');
  end if;
  if p_subscription_id is null or p_outcome is null or p_outcome not in ('ok', 'gone', 'failed') then
    perform app.notify_error('invalid');
  end if;
  if p_outcome = 'gone' then
    delete from notify.push_subscriptions where id = p_subscription_id;
  elsif p_outcome = 'ok' then
    update notify.push_subscriptions set last_success_at = now(), failures = 0 where id = p_subscription_id;
  else
    update notify.push_subscriptions set failures = failures + 1 where id = p_subscription_id;
    delete from notify.push_subscriptions where id = p_subscription_id and failures >= 5;
  end if;
end;
$$;
revoke all on function public.push_worker_report(uuid, text) from public, anon;
grant execute on function public.push_worker_report(uuid, text) to authenticated;
