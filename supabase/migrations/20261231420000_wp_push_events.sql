-- Job WP (web push, part 2): two EVENTS the worker may push, next to the five "needs you" kinds of migration 20261118090200 (job BY, ADR 0077).
--
--   call_starting     a call of the workspace is live right now and began less than 90 seconds ago (the single definition app.phone_call_is_live). Owner and Admin only (they are the ones who can open the call).
--   customer_replied  a customer's reply was recorded (public.lead_touches, direction 'in') less than 15 minutes ago. Owner, Admin and Sales. Throttled: at most one such push per member per workspace every 5 minutes
--                     (replies that arrive meanwhile wait and go out together, as one "N customers replied").
--
-- What is the same as before, on purpose: a push is sent only to a member who switched it on for that workspace and has a subscription, never inside the business's quiet hours, once per item (notify.push_sent), and the text is a
-- FIXED sentence by kind: no customer name, no phone number, no message text (the payload is built by the worker from the kind and a count only).
-- What is new: these two kinds are EVENTS. They are not in app.needs_you_items (so the Today feed, the unread mark and today_summary are unchanged: BY's test that pins them equal still holds); only the worker sees them.
-- Switching push on does not need to "count what waits as told": an event is only fresh for 90 seconds / 15 minutes.
-- SQLSTATEs as before: 42501 deny, 22023 invalid. No table, no new grant: two replaced functions and one new internal one.

create function app.push_event_items(p_tenant uuid, p_user uuid) returns table (kind text, id uuid, at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text := (select m.role::text from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user);
begin
  if v_role in ('owner', 'admin') then
    return query
    select 'call_starting'::text, c.id, c.created_at
      from public.phone_calls c
     where c.tenant_id = p_tenant
       and c.state in ('ringing', 'in_progress')
       and c.created_at >= now() - interval '90 seconds'
       and app.phone_call_is_live(c);
  end if;
  if v_role in ('owner', 'admin', 'sales')
     and not exists (select 1 from notify.push_sent x
                      where x.tenant_id = p_tenant and x.user_id = p_user and x.kind = 'customer_replied' and x.sent_at > now() - interval '5 minutes') then
    return query
    select 'customer_replied'::text, t.id, t.recorded_at
      from public.lead_touches t
     where t.tenant_id = p_tenant and t.direction = 'in' and t.recorded_at >= now() - interval '15 minutes';
  end if;
end;
$$;
revoke all on function app.push_event_items(uuid, uuid) from public, anon, authenticated, service_role;

-- the worker's list: the five kinds that wait for the member, plus the two events; each told once; not in quiet hours
create or replace function public.push_worker_pending(p_limit integer default 50) returns jsonb
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
  delete from notify.push_sent x where x.sent_at < now() - interval '30 days';
  for r in
    select p.tenant_id, p.user_id from notify.push_prefs p
     where p.enabled and exists (select 1 from notify.push_subscriptions s where s.user_id = p.user_id)
       and exists (select 1 from public.memberships m where m.tenant_id = p.tenant_id and m.user_id = p.user_id)
       and not app.outbox_in_quiet_hours(v_now, p.tenant_id)
     order by p.tenant_id, p.user_id limit p_limit
  loop
    select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'id', n.id) order by n.at, n.id), '[]'::jsonb) into v_items
      from (select a.kind, a.id, a.at from app.needs_you_items(r.tenant_id, r.user_id) a
            union all
            select e.kind, e.id, e.at from app.push_event_items(r.tenant_id, r.user_id) e) n
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

-- the items were told (at least one subscription accepted the push): the two event kinds are accepted as well
create or replace function public.push_worker_mark(p_tenant_id uuid, p_user_id uuid, p_items jsonb) returns integer
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
   where x ->> 'kind' in ('quote_approval', 'followup_due', 'order_money_held', 'outbox_approval', 'call_approval', 'call_starting', 'customer_replied')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.push_worker_mark(uuid, uuid, jsonb) from public, anon;
grant execute on function public.push_worker_mark(uuid, uuid, jsonb) to authenticated;
