-- Two platform alerts that are COMPUTED when the staff open the alerts list (28 Nov 2026), so they cannot be missed by a process that is itself down:
--   worker_stale  the background worker's heartbeat (scheduler.heartbeat) is older than five of its own intervals (at least ten minutes); a system that has NEVER had a heartbeat (a fresh database) is not an alert
--   quiet_line    a live VoiceLink number (inbound on) got real inbound calls in the 14 days before but NONE in the last 24 hours: the carrier or the bot may be broken
-- Nothing is stored; the items appear and disappear with the facts. Visible to owner, support and finance (worker) and owner and finance (quiet line). No personal data: a sentence with a count.

create function admin.computed_alerts(p_role text) returns jsonb language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(x.item order by x.n), '[]'::jsonb) from (
    select 1 as n, jsonb_build_object('id', md5('worker_stale')::uuid, 'kind', 'worker_stale', 'severity', 'warn', 'title', 'The background worker has stopped',
             'detail', 'The worker last reported ' || (extract(epoch from (app.outbox_now() - h.last_tick_at)) / 60)::int || ' minutes ago (it reports every ' || h.interval_seconds || ' seconds). Messages, follow-ups and the daily checks are not running: look at the worker job in Cloud Run.',
             'created_at', app.outbox_now(), 'acknowledged', false) as item
      from scheduler.heartbeat h
     where p_role in ('owner', 'support', 'finance')
       and h.id = 1 and h.last_tick_at < app.outbox_now() - greatest(interval '10 minutes', h.interval_seconds * 5 * interval '1 second')
    union all
    select 2, jsonb_build_object('id', md5('quiet_line')::uuid, 'kind', 'quiet_line', 'severity', 'warn', 'title', 'A live phone number got no calls today',
             'detail', 'A number that was getting calls (' || before.n || ' in the 14 days before) has had none in the last 24 hours. Place one test call from a phone, and if it does not connect check the number at VoiceLink.',
             'created_at', app.outbox_now(), 'acknowledged', false)
      from (select count(*) as n from public.phone_calls c where c.direction = 'inbound' and not c.simulated and c.created_at >= app.outbox_now() - interval '14 days' and c.created_at < app.outbox_now() - interval '24 hours') before
     where p_role in ('owner', 'finance')
       and before.n > 0
       and exists (select 1 from public.phone_numbers n where n.inbound_on and n.provider = 'voicelink')
       and not exists (select 1 from public.phone_calls c where c.direction = 'inbound' and not c.simulated and c.created_at >= app.outbox_now() - interval '24 hours')
  ) x
$$;
revoke all on function admin.computed_alerts(text) from public, anon, authenticated;

do $patch$
declare
  v_def    text := pg_get_functiondef('public.admin_alerts_list(boolean)'::regprocedure);
  v_marker constant text := E'a), ''[]''::jsonb));';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'computed alerts: the alerts list is not the one this migration expects';
  end if;
  execute replace(v_def, v_marker, E'a), ''[]''::jsonb) || admin.computed_alerts(v_staff.role));');
end
$patch$;
