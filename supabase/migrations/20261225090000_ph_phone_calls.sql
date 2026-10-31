-- Job phone-calls part 1 (31 Oct 2026): the data an AI phone call leaves behind, and the numbers the platform answers on. Plan: docs/plans/phone-calls.md.
--
--   public.phone_numbers   the numbers (ExoPhones) that belong to a workspace; inbound calls to a number go to its workspace. One workspace per number.
--   public.phone_calls     one row per call, outbound or inbound, from "queued" to a finished state; the outcome, a short summary and the transcript (PII; read by people, never by a model) are written when it ends.
--   public.phone_call_begin / phone_call_update / phone_call_finish / phone_calls_list / phone_call_get / phone_calls_stats
--
-- Who: Owner, Admin and Sales read the calls; a Viewer does not. The scheduler account and the API's telephony worker write through the functions (nobody writes a table). Owner and Admin read the transcript.
-- Recording: `recorded` is always false (a CHECK), no audio is stored anywhere. A finished call never moves again, a call is never deleted.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM961 the call is not in a state that allows this.

create function app.phone_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'state'     then raise exception 'the call is not in a state that allows this' using errcode = 'SM961';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.phone_error(text) from public, anon, authenticated, service_role;

create table public.phone_numbers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  number     text not null check (number ~ '^\+[0-9]{8,15}$'),
  label      text check (char_length(label) <= 60),
  inbound_on boolean not null default false,
  created_at timestamptz not null default now(),
  unique (number),
  unique (tenant_id, id)
);
comment on table public.phone_numbers is 'Job phone-calls part 1: a number the platform answers on and calls from, and the workspace it belongs to. Written only by the operator.';
comment on column public.phone_numbers.number is 'SAFE: the platform''s own telephone number (an ExoPhone), not a person''s. CLEAN-EXEMPT: pattern CHECK';
comment on column public.phone_numbers.label is 'PII: a short name the operator gave the line (it may carry a person''s name). Erased with the workspace. CLEAN-EXEMPT: length CHECK, written by the operator only, never read by a model';
create index phone_numbers_tenant_idx on public.phone_numbers (tenant_id, created_at desc, id);

create table public.phone_calls (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  direction         text not null check (direction in ('outbound', 'inbound')),
  state             text not null default 'queued' check (state in ('queued', 'ringing', 'in_progress', 'completed', 'no_answer', 'busy', 'voicemail', 'failed', 'refused', 'cancelled')),
  refuse_reason     text check (refuse_reason in ('telephony_off', 'live_not_confirmed', 'bad_number', 'not_on_sandbox_list', 'not_approved', 'workspace_paused', 'billing_blocked', 'purpose_not_allowed', 'school_rule',
                    'outside_window', 'outside_hours', 'holiday', 'weekly_limit', 'daily_cap', 'minutes_cap', 'no_consent', 'suppressed', 'erased_or_archived', 'dnd', 'dnd_unknown', 'no_ai_disclosure',
                    'already_calling', 'too_many_calls', 'inbound_off', 'no_such_line', 'blocked_caller')),
  contact_id        uuid,
  lead_id           uuid,
  task_id           uuid,
  outreach_item_id  uuid,
  purpose           text check (purpose in ('sales_followup', 'payment_reminder', 'admission_followup', 'visit_reminder', 'event_reminder', 'inbound')),
  language          text check (language in ('te', 'en', 'hi', 'kn', 'ta', 'ml')),
  provider          text not null check (provider in ('exotel', 'sandbox')),
  provider_call_sid text check (char_length(provider_call_sid) between 4 and 100 and provider_call_sid ~ '^[A-Za-z0-9_.-]+$'),
  sandbox           boolean not null default true,
  simulated         boolean not null default false,
  recorded          boolean not null default false check (recorded = false),
  ai_disclosed      boolean not null default false,
  created_by        uuid,
  answered_at       timestamptz,
  ended_at          timestamptz,
  duration_s        integer check (duration_s >= 0),
  end_reason        text check (end_reason in ('goodbye', 'caller_hung_up', 'we_hung_up', 'longest_call', 'silence', 'voicemail', 'no_answer', 'busy', 'error', 'stopped', 'handover')),
  outcome           text check (outcome in ('positive', 'negative', 'unclear', 'no_answer', 'failed')),
  category          text check (category in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'call_back_later', 'already_bought', 'do_not_call')),
  callback_at       timestamptz,
  captured          jsonb check (captured is null or jsonb_typeof(captured) = 'object'),
  summary           text check (char_length(summary) <= 1200),
  transcript        jsonb check (transcript is null or jsonb_typeof(transcript) = 'array'),
  cost_paise        bigint not null default 0 check (cost_paise >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id),
  check ((state = 'refused') = (refuse_reason is not null)),
  check (state not in ('completed', 'no_answer', 'busy', 'voicemail', 'failed', 'refused', 'cancelled') or ended_at is not null)
);
comment on table public.phone_calls is 'Job phone-calls part 1: one AI phone call, outbound or inbound, and what came of it. Written only by the phone functions. A model never reads the summary or the transcript.';
comment on column public.phone_calls.captured is 'PII: what the person said in answer to the questions (a price, a day, a yes). Erased with the workspace. CLEAN-EXEMPT: a validated document, never read by a model';
comment on column public.phone_calls.summary is 'PII: three lines about the call, written by the fast model from the transcript. Erased with the workspace. CLEAN-EXEMPT: read by people only, never by a model';
comment on column public.phone_calls.transcript is 'PII: the conversation, turn by turn. Erased with the workspace. CLEAN-EXEMPT: read by people only, never by a model';
comment on column public.phone_calls.provider_call_sid is 'SAFE: the telephony provider''s call id. CLEAN-EXEMPT: pattern CHECK';
comment on column public.phone_calls.direction is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.refuse_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.purpose is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.end_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_calls.category is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create index phone_calls_tenant_idx on public.phone_calls (tenant_id, created_at desc, id);
create index phone_calls_state_idx on public.phone_calls (tenant_id, state) where state in ('queued', 'ringing', 'in_progress');
create index phone_calls_contact_idx on public.phone_calls (tenant_id, contact_id, created_at desc);
create index phone_calls_lead_idx on public.phone_calls (tenant_id, lead_id);
create index phone_calls_task_idx on public.phone_calls (tenant_id, task_id);

do $$
declare
  t text;
begin
  foreach t in array array['phone_numbers', 'phone_calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create policy phone_numbers_select on public.phone_numbers for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create policy phone_calls_select on public.phone_calls for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create trigger audit_phone_numbers after insert or update or delete on public.phone_numbers for each row execute function app.audit_row_change('phone_number', 'label');
create trigger audit_phone_calls after insert or update or delete on public.phone_calls for each row execute function app.audit_row_change('phone_call', 'captured,summary,transcript');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('phone_numbers', 'label',   'tenant', 'tombstone', 'erased:1'),
  ('phone_numbers', 'label',   'sweep',  'substring', 'erased:1'),
  ('phone_calls', 'summary',    'tenant', 'tombstone', 'erased:1'),
  ('phone_calls', 'summary',    'sweep',  'substring', 'erased:1'),
  ('phone_calls', 'captured',   'tenant', 'null',      'erased:1'),
  ('phone_calls', 'transcript', 'tenant', 'null',      'erased:1');

-- a finished call never moves again; a call is never deleted
create function app.phone_calls_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'calls are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.state in ('completed', 'no_answer', 'busy', 'voicemail', 'failed', 'refused', 'cancelled') and not app.erasure_running(old.tenant_id) then
      raise exception 'a finished call does not change' using errcode = 'SM961';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app.phone_calls_guard() from public, anon, authenticated, service_role;
create trigger phone_calls_guard before update or delete on public.phone_calls for each row execute function app.phone_calls_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the shape of one call, for people (the transcript only when asked for, and only for Owner and Admin)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.phone_call_json(c public.phone_calls, p_with_transcript boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'direction', c.direction, 'state', c.state, 'refuse_reason', c.refuse_reason, 'purpose', c.purpose, 'language', c.language,
    'contact_id', c.contact_id, 'lead_id', c.lead_id, 'task_id', c.task_id,
    'contact_name', (select x.full_name from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
    'contact_phone', (select x.phone from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
    'provider', c.provider, 'sandbox', c.sandbox, 'simulated', c.simulated, 'ai_disclosed', c.ai_disclosed, 'recorded', c.recorded,
    'created_at', c.created_at, 'answered_at', c.answered_at, 'ended_at', c.ended_at, 'duration_s', c.duration_s, 'end_reason', c.end_reason,
    'outcome', c.outcome, 'category', c.category, 'callback_at', c.callback_at, 'captured', c.captured, 'summary', c.summary, 'cost_paise', c.cost_paise)
    || case when p_with_transcript then jsonb_build_object('transcript', c.transcript) else '{}'::jsonb end
$$;
revoke all on function app.phone_call_json(public.phone_calls, boolean) from public, anon, authenticated, service_role;

create function app.phone_may_write(p_tenant_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and p_tenant_id is not null and (app.is_scheduler() or app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]))
$$;
revoke all on function app.phone_may_write(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- begin: a call is created (queued), or recorded as refused by the gate (with the reason)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.phone_call_begin(p_tenant_id uuid, p_direction text, p_provider text, p_sandbox boolean default true, p_contact_id uuid default null, p_purpose text default null, p_language text default null,
                                        p_task_id uuid default null, p_ai_disclosed boolean default false, p_refuse_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
  c      public.phone_calls;
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  if p_direction is null or p_direction not in ('outbound', 'inbound') or p_provider is null or p_provider not in ('exotel', 'sandbox') or p_sandbox is null or p_ai_disclosed is null then
    perform app.phone_error('invalid');
  end if;
  if p_contact_id is not null then
    select l.id into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.contact_id = p_contact_id order by l.created_at desc limit 1;
    if not exists (select 1 from public.contacts x where x.tenant_id = p_tenant_id and x.id = p_contact_id) then
      perform app.phone_error('reference');
    end if;
  end if;
  begin
    insert into public.phone_calls (tenant_id, direction, state, refuse_reason, contact_id, lead_id, task_id, purpose, language, provider, sandbox, ai_disclosed, created_by, ended_at)
    values (p_tenant_id, p_direction, case when p_refuse_reason is null then 'queued' else 'refused' end, p_refuse_reason, p_contact_id, v_lead, p_task_id, p_purpose, p_language, p_provider, p_sandbox, p_ai_disclosed,
            auth.uid(), case when p_refuse_reason is null then null else app.outbox_now() end)
    returning * into c;
  exception when check_violation or foreign_key_violation then
    perform app.phone_error('invalid');
  end;
  return app.phone_call_json(c, false);
end;
$$;
revoke all on function public.phone_call_begin(uuid, text, text, boolean, uuid, text, text, uuid, boolean, text) from public, anon;
grant execute on function public.phone_call_begin(uuid, text, text, boolean, uuid, text, text, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- update: queued -> ringing -> in_progress (answered_at is set when the call is answered); the provider's id is kept once
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.phone_call_update(p_tenant_id uuid, p_call_id uuid, p_state text, p_provider_call_sid text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  if p_state is null or p_state not in ('ringing', 'in_progress') then
    perform app.phone_error('invalid');
  end if;
  select * into c from public.phone_calls x where x.tenant_id = p_tenant_id and x.id = p_call_id for update;
  if not found then
    perform app.phone_error('reference');
  end if;
  if c.state not in ('queued', 'ringing', 'in_progress') or (p_state = 'ringing' and c.state <> 'queued') then
    perform app.phone_error('state');
  end if;
  begin
    update public.phone_calls set state = p_state, provider_call_sid = coalesce(provider_call_sid, p_provider_call_sid),
           answered_at = case when p_state = 'in_progress' then coalesce(answered_at, app.outbox_now()) else answered_at end
     where id = c.id returning * into c;
  exception when check_violation then
    perform app.phone_error('invalid');
  end;
  return app.phone_call_json(c, false);
end;
$$;
revoke all on function public.phone_call_update(uuid, uuid, text, text) from public, anon;
grant execute on function public.phone_call_update(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- finish: the call is over; what came of it
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.phone_call_finish(p_tenant_id uuid, p_call_id uuid, p_state text, p_end_reason text default null, p_outcome text default null, p_category text default null, p_callback_at timestamptz default null,
                                         p_captured jsonb default null, p_summary text default null, p_transcript jsonb default null, p_cost_paise bigint default 0) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   public.phone_calls;
  v_now timestamptz := app.outbox_now();
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  if p_state is null or p_state not in ('completed', 'no_answer', 'busy', 'voicemail', 'failed', 'cancelled') or p_cost_paise is null or p_cost_paise < 0 then
    perform app.phone_error('invalid');
  end if;
  select * into c from public.phone_calls x where x.tenant_id = p_tenant_id and x.id = p_call_id for update;
  if not found then
    perform app.phone_error('reference');
  end if;
  if c.state not in ('queued', 'ringing', 'in_progress') then
    perform app.phone_error('state');
  end if;
  begin
    update public.phone_calls set state = p_state, ended_at = v_now, end_reason = p_end_reason, outcome = p_outcome, category = p_category, callback_at = p_callback_at, captured = p_captured, summary = p_summary,
           transcript = p_transcript, cost_paise = p_cost_paise,
           duration_s = case when answered_at is null then 0 else greatest(0, extract(epoch from (v_now - answered_at))::integer) end
     where id = c.id returning * into c;
  exception when check_violation then
    perform app.phone_error('invalid');
  end;
  return app.phone_call_json(c, false);
end;
$$;
revoke all on function public.phone_call_finish(uuid, uuid, text, text, text, text, timestamptz, jsonb, text, jsonb, bigint) from public, anon;
grant execute on function public.phone_call_finish(uuid, uuid, text, text, text, text, timestamptz, jsonb, text, jsonb, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the Calls page: live first, then finished, newest first
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.phone_calls_list(p_tenant_id uuid, p_state text default 'all', p_limit integer default 50, p_before timestamptz default null) returns jsonb
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
      from (select app.phone_call_json(c, false) as j, (c.state in ('queued', 'ringing', 'in_progress')) as lv, c.created_at as ca, c.id as id
              from public.phone_calls c
             where c.tenant_id = p_tenant_id
               and (p_state = 'all' or (p_state = 'live') = (c.state in ('queued', 'ringing', 'in_progress')))
               and (p_before is null or c.created_at < p_before)
             order by (c.state in ('queued', 'ringing', 'in_progress')) desc, c.created_at desc, c.id desc
             limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.phone_calls_list(uuid, text, integer, timestamptz) from public, anon;
grant execute on function public.phone_calls_list(uuid, text, integer, timestamptz) to authenticated;

create function public.phone_call_get(p_tenant_id uuid, p_call_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  select * into c from public.phone_calls x where x.tenant_id = p_tenant_id and x.id = p_call_id;
  if not found then
    perform app.phone_error('reference');
  end if;
  return app.phone_call_json(c, app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]));
end;
$$;
revoke all on function public.phone_call_get(uuid, uuid) from public, anon;
grant execute on function public.phone_call_get(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the numbers the gate needs: live calls, today's calls and minutes (India day), this week's calls to the person
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.phone_calls_stats(p_tenant_id uuid, p_contact_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day  date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_week date := date_trunc('week', (app.outbox_now() at time zone 'Asia/Kolkata'))::date;
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  return (
    select jsonb_build_object(
      'active_total', count(*) filter (where c.state in ('queued', 'ringing', 'in_progress')),
      'active_to_contact', count(*) filter (where c.state in ('queued', 'ringing', 'in_progress') and c.contact_id = p_contact_id),
      'calls_today', count(*) filter (where c.direction = 'outbound' and c.state <> 'refused' and (c.created_at at time zone 'Asia/Kolkata')::date = v_day),
      'minutes_today', coalesce(sum(c.duration_s) filter (where (c.created_at at time zone 'Asia/Kolkata')::date = v_day), 0) / 60.0,
      'calls_to_contact_this_week', count(*) filter (where c.direction = 'outbound' and c.state <> 'refused' and c.contact_id = p_contact_id and (c.created_at at time zone 'Asia/Kolkata')::date >= v_week))
      from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at >= now() - interval '8 days');
end;
$$;
revoke all on function public.phone_calls_stats(uuid, uuid) from public, anon;
grant execute on function public.phone_calls_stats(uuid, uuid) to authenticated;

-- the lines a workspace answers on (the telephony worker finds the workspace of a rung number)
create function public.phone_line_find(p_number text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  select * into n from public.phone_numbers x where x.number = p_number;
  if not found then
    return null;
  end if;
  return jsonb_build_object('tenant_id', n.tenant_id, 'inbound_on', n.inbound_on);
end;
$$;
revoke all on function public.phone_line_find(text) from public, anon;
grant execute on function public.phone_line_find(text) to authenticated;
