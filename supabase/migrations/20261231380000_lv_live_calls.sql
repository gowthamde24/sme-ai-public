-- lv: the live-calls bar never lies (owner, 9 Nov 2026).
--   * A call is LIVE only while it is in a live state AND started less than 10 minutes ago AND its phone server said it was still going within the last 6 minutes (heartbeat_at; a call that never beat
--     counts from its start). One definition, app.phone_call_is_live, used by the list, the detail, and the AI team page's "on a call".
--   * An ORPHANED call (the server died, the line dropped without a word) is closed by the worker: nothing for the call cap + 60 s (the worker passes the seconds) -> state failed, end reason error.
--   * The call carries the assistant's name as it was on that call, and the line it came in on; the list gives them (the line's name only to the Owner and Admin, who can read the lines).

alter table public.phone_calls
  add column assistant_name text check (assistant_name is null or (char_length(assistant_name) between 1 and 40 and app.text_is_clean(assistant_name) and assistant_name ~ '^[^<>{}@/\\|]+$')),
  add column line_id        uuid,
  add column heartbeat_at   timestamptz;
comment on column public.phone_calls.assistant_name is 'SAFE: the name the workspace gave its assistant (Settings > AI assistant), as it was on this call: chosen by the owner, not a person''s data. Clean text; no markup characters (the same rule as the setting).';
comment on column public.phone_calls.line_id is 'SAFE: the id of the platform line (public.phone_numbers) the call came in on. CLEAN-EXEMPT: uuid';
comment on column public.phone_calls.heartbeat_at is 'SAFE: when the phone server last said the call was still going. CLEAN-EXEMPT: timestamp';

-- a finished call still never moves, except: once, the "handled" mark; the correction fields; and the three facts about the call itself that may arrive a moment after a very short call
create or replace function app.phone_calls_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed text[] := array['updated_at', 'handled_at', 'handled_by', 'summary_corrected', 'captured_corrected', 'correction_note', 'corrected_by', 'corrected_at', 'assistant_name', 'line_id', 'heartbeat_at'];
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'calls are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.state in ('completed', 'no_answer', 'busy', 'voicemail', 'failed', 'refused', 'cancelled') and not app.erasure_running(old.tenant_id)
       and ((to_jsonb(old) - v_fixed) is distinct from (to_jsonb(new) - v_fixed)
            or (old.handled_at is not null and (old.handled_at, old.handled_by) is distinct from (new.handled_at, new.handled_by))) then
      raise exception 'a finished call does not change' using errcode = 'SM961';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create function app.phone_call_is_live(c public.phone_calls) returns boolean
language sql
stable
set search_path = ''
as $$
  select c.state in ('queued', 'ringing', 'in_progress')
     and c.created_at >= now() - interval '10 minutes'
     and coalesce(c.heartbeat_at, c.answered_at, c.created_at) >= now() - interval '6 minutes'
$$;
revoke all on function app.phone_call_is_live(public.phone_calls) from public, anon, authenticated, service_role;

create or replace function app.phone_call_json(c public.phone_calls, p_with_transcript boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'direction', c.direction, 'state', c.state, 'live', app.phone_call_is_live(c), 'refuse_reason', c.refuse_reason, 'purpose', c.purpose, 'language', c.language,
    'contact_id', c.contact_id, 'lead_id', c.lead_id, 'task_id', c.task_id,
    'contact_name', (select x.full_name from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
    'contact_phone', (select x.phone from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
    'assistant_name', c.assistant_name,
    'line', case when app.has_tenant_role(c.tenant_id, array['owner', 'admin']::public.app_role[])
                 then (select p.label from public.phone_numbers p where p.tenant_id = c.tenant_id and p.id = c.line_id) end,
    'line_ending', (select right(p.number, 3) from public.phone_numbers p where p.tenant_id = c.tenant_id and p.id = c.line_id),
    'provider', c.provider, 'sandbox', c.sandbox, 'simulated', c.simulated, 'ai_disclosed', c.ai_disclosed, 'recorded', c.recorded,
    'created_at', c.created_at, 'answered_at', c.answered_at, 'ended_at', c.ended_at, 'duration_s', c.duration_s, 'end_reason', c.end_reason,
    'outcome', c.outcome, 'category', c.category, 'callback_at', c.callback_at, 'captured', c.captured, 'summary', c.summary, 'cost_paise', c.cost_paise)
    || case when p_with_transcript then jsonb_build_object('transcript', c.transcript) else '{}'::jsonb end
$$;
revoke all on function app.phone_call_json(public.phone_calls, boolean) from public, anon, authenticated, service_role;

-- live = fresh (the one definition above); finished = no longer in a live state; all = everything. A call stuck in a live state shows in "all" with live false until the worker closes it.
create or replace function public.phone_calls_list(p_tenant_id uuid, p_state text default 'all', p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  if p_state is null or p_state not in ('all', 'live', 'finished') or p_limit is null or p_limit < 1 or p_limit > 200 then
    perform app.phone_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.lv desc, x.ca desc, x.id desc)
      from (select app.phone_call_json(c, false) as j, app.phone_call_is_live(c) as lv, c.created_at as ca, c.id as id
              from public.phone_calls c
             where c.tenant_id = p_tenant_id
               and (p_state = 'all'
                    or (p_state = 'live' and app.phone_call_is_live(c))
                    or (p_state = 'finished' and c.state not in ('queued', 'ringing', 'in_progress')))
               and (p_before is null or c.created_at < p_before)
             order by app.phone_call_is_live(c) desc, c.created_at desc, c.id desc
             limit p_limit) x), '[]'::jsonb);
end;
$$;

-- the phone server: which assistant name and which line this call has (once; a second note keeps the first)
create function public.phone_call_note(p_tenant_id uuid, p_call_id uuid, p_assistant_name text, p_line_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  if p_assistant_name is not null and (char_length(btrim(p_assistant_name)) not between 1 and 40 or not app.text_is_clean(p_assistant_name) or p_assistant_name !~ '^[^<>{}@/\\|]+$') then
    perform app.phone_error('invalid');
  end if;
  update public.phone_calls c set assistant_name = coalesce(c.assistant_name, nullif(btrim(p_assistant_name), '')), line_id = coalesce(c.line_id, p_line_id)
   where c.tenant_id = p_tenant_id and c.id = p_call_id;
  if not found then
    perform app.phone_error('reference');
  end if;
end;
$$;
revoke all on function public.phone_call_note(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.phone_call_note(uuid, uuid, text, uuid) to authenticated;

-- the phone server, every few seconds while the call goes on
create function public.phone_call_heartbeat(p_tenant_id uuid, p_call_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  update public.phone_calls c set heartbeat_at = now()
   where c.tenant_id = p_tenant_id and c.id = p_call_id and c.state in ('queued', 'ringing', 'in_progress');
  return found;
end;
$$;
revoke all on function public.phone_call_heartbeat(uuid, uuid) from public, anon;
grant execute on function public.phone_call_heartbeat(uuid, uuid) to authenticated;

-- the worker, every tick: a call that said nothing for the call cap + 60 s is over (the server died or the line dropped without a word); so is any call still in a live state after 15 minutes, whatever it says
create function public.phone_calls_close_orphans(p_stale_seconds integer default 240) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  if p_stale_seconds is null or p_stale_seconds not between 60 and 900 then
    perform app.phone_error('invalid');
  end if;
  with closed as (
    update public.phone_calls c
       set state = 'failed', ended_at = now(), end_reason = 'error', outcome = 'failed',
           duration_s = greatest(0, extract(epoch from now() - coalesce(c.answered_at, c.created_at))::integer)
     where c.state in ('ringing', 'in_progress')
       and (coalesce(c.heartbeat_at, c.answered_at, c.created_at) < now() - make_interval(secs => p_stale_seconds) or c.created_at < now() - interval '15 minutes')
    returning 1)
  select count(*) into v_n from closed;
  return v_n;
end;
$$;
revoke all on function public.phone_calls_close_orphans(integer) from public, anon;
grant execute on function public.phone_calls_close_orphans(integer) to authenticated;

-- the line lookup also names the line (its id), so the call can carry it
create or replace function public.phone_line_find(p_number text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
  v_name text;
  v_assistant text;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  select * into n from public.phone_numbers x where x.number = p_number;
  if not found then
    return null;
  end if;
  select t.name into v_name from public.tenants t where t.id = n.tenant_id;
  v_name := coalesce(nullif(btrim(n.spoken_business_name), ''), v_name);
  select a.assistant_name into v_assistant from public.assistant_settings a where a.tenant_id = n.tenant_id;
  return jsonb_build_object('tenant_id', n.tenant_id, 'line_id', n.id, 'inbound_on', n.inbound_on, 'business', v_name, 'assistant', v_assistant);
end;
$$;
