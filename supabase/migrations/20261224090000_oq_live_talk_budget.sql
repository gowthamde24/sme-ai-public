-- Live talk gets its own budget (owner, 30 Oct). A small-talk or general-help turn (the router's `smalltalk` / `general`) is a light run: one model call, no tools, no records.
-- It is marked `light` and does not count against `max_runs_per_hour`, so hands-free talk cannot use up the allowance of the data and action turns.
-- A data or action turn counts as before. The concurrent-run limit and the day's cost cap still apply to every run; light turns have their own ceiling of eight times the hourly allowance.
alter table public.agent_runs add column light boolean not null default false;

-- a turn the router calls a data or action turn after the run was opened light (the router sees the previous turn; the cheap pre-check does not): it counts like any other
create function public.assistant_mark_heavy(p_run_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agent_runs r set light = false where r.id = p_run_id and r.started_by = auth.uid() and r.agent_name = 'assistant' and r.status = 'running';
end;
$$;
revoke all on function public.assistant_mark_heavy(uuid) from public, anon;
grant execute on function public.assistant_mark_heavy(uuid) to authenticated;

drop function public.assistant_begin_message(uuid, uuid, uuid, uuid, text, text, text);

create function public.assistant_begin_message(
  p_run_id uuid, p_tenant_id uuid, p_conversation_id uuid, p_message_id uuid, p_text text, p_language text, p_input_sha256 text,
  p_light boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_text  text := btrim(coalesce(p_text, ''));
  c       public.assistant_conversations;
  m       public.assistant_messages;
  rp      public.assistant_messages;
  d       public.agent_definitions;
  e       public.agent_runs;
  v_seq   integer;
  v_ttl   integer;
  v_exp   timestamptz;
  v_token bigint;
begin
  if v_uid is null or p_tenant_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  if p_run_id is null or p_conversation_id is null or p_message_id is null or p_input_sha256 is null
     or char_length(v_text) not between 1 and 4000 or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')) then
    perform app.agent_state_error('invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assistant:' || p_conversation_id::text, 0));

  -- the conversation: made now, or the caller's own (anyone else's, or another business's, is the same generic refusal as an unknown one)
  select * into c from public.assistant_conversations x where x.id = p_conversation_id;
  if found and (c.tenant_id <> p_tenant_id or c.created_by <> v_uid) then
    perform app.agent_deny();
  end if;

  -- a retry of a message already stored: the same words replay (with the answer, if it was given); other words under the same id conflict
  select * into m from public.assistant_messages x where x.id = p_message_id;
  if found then
    if m.tenant_id <> p_tenant_id or m.conversation_id <> p_conversation_id or m.role <> 'user' or m.body <> v_text then
      raise exception 'message id already used' using errcode = '23505', constraint = 'assistant_messages_pkey', table = 'assistant_messages', schema = 'public';
    end if;
    select * into rp from public.assistant_messages x where x.tenant_id = m.tenant_id and x.conversation_id = m.conversation_id and x.seq = m.seq + 1 and x.role = 'assistant';
    return jsonb_build_object('replayed', true, 'conversation_id', m.conversation_id, 'message_id', m.id, 'run_id', m.run_id,
                              'reply_message_id', rp.id);
  end if;

  -- a NEW message: only now may the answers say why it cannot start
  select * into d from public.agent_definitions a where a.agent_name = 'assistant';
  if not found then
    perform app.agent_state_error('reference');
  end if;
  perform app.agent_assert_enabled(p_tenant_id, 'assistant'); -- SM204: a switch is off

  if (select count(*) from public.assistant_messages x where x.tenant_id = p_tenant_id and x.conversation_id = p_conversation_id) >= 200 then
    perform app.agent_state_error('invalid'); -- a chat has at most 200 messages: start a new one
  end if;

  -- the same limits as any run: concurrent runs, runs per hour (serialised per business), the early refusal at the day's cost cap
  perform pg_advisory_xact_lock(hashtextextended('agent_start:' || p_tenant_id::text, 0));
  if (select count(*) from public.agent_runs a
       where a.tenant_id = p_tenant_id and a.status = 'running' and a.expires_at > now() and a.cancel_requested_at is null)
       >= app.agent_limit('max_concurrent_runs', 0)
     or (not coalesce(p_light, false)
         and (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light)
             >= app.agent_limit('max_runs_per_hour', 0))
     -- light turns have a ceiling of their own (eight times the hourly allowance: 240 an hour at 30), so the flag cannot be used to start unlimited runs
     or (coalesce(p_light, false)
         and (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and a.light)
             >= 8 * app.agent_limit('max_runs_per_hour', 0)) then
    perform app.agent_state_error('SM206');
  end if;
  if app.agent_day_spend(p_tenant_id, app.agent_utc_today()) >= app.agent_daily_cap(p_tenant_id) then
    perform app.agent_state_error('SM207');
  end if;

  v_ttl := least(greatest(app.agent_limit('ttl_default_seconds', 900), 30), app.agent_limit('ttl_max_seconds', 1800));
  v_exp := now() + make_interval(secs => v_ttl);
  v_token := nullif(auth.jwt() ->> 'exp', '')::bigint;
  if v_token is not null then
    v_exp := least(v_exp, to_timestamp(v_token));
  end if;
  if v_exp <= now() + interval '5 seconds' then
    perform app.agent_state_error('SM202');
  end if;

  if c.id is null then
    insert into public.assistant_conversations (id, tenant_id, created_by) values (p_conversation_id, p_tenant_id, v_uid) returning * into c;
  end if;
  begin
    insert into public.agent_runs
      (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at,
       max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, input_sha256, input_refs, light)
    values
      (p_run_id, p_tenant_id, v_uid, 'assistant', 'assistant-1', p_conversation_id, v_exp,
       d.max_writes, d.max_tool_calls, d.max_input_tokens, d.max_output_tokens, d.max_cost_micros, p_input_sha256, '{}'::jsonb, coalesce(p_light, false))
    returning * into e;
  exception when unique_violation then
    raise exception 'agent run id already used' using errcode = '23505', constraint = 'agent_runs_pkey', table = 'agent_runs', schema = 'public';
  end;

  select coalesce(max(x.seq), 0) + 1 into v_seq from public.assistant_messages x where x.tenant_id = p_tenant_id and x.conversation_id = p_conversation_id;
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, run_id, created_by)
  values (p_message_id, p_tenant_id, p_conversation_id, v_seq, 'user', v_text, p_language, e.id, v_uid);
  update public.assistant_conversations set updated_at = now() where id = c.id;

  return jsonb_build_object('replayed', false, 'conversation_id', c.id, 'message_id', p_message_id, 'run_id', e.id, 'seq', v_seq,
                            'expires_at', e.expires_at, 'reply_message_id', null);
end;
$$;
revoke all on function public.assistant_begin_message(uuid, uuid, uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.assistant_begin_message(uuid, uuid, uuid, uuid, text, text, text, boolean) to authenticated;

-- the hourly allowance of every other run start ignores light runs too
create or replace function public.start_agent_run(p_run_id uuid, p_tenant_id uuid, p_agent_name text, p_agent_version text, p_target_kind text, p_target_id uuid, p_input_sha256 text, p_input_refs jsonb DEFAULT '{}'::jsonb, p_ttl_seconds integer DEFAULT NULL::integer, p_budgets jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_refs    jsonb := coalesce(p_input_refs, '{}'::jsonb);
  d         public.agent_definitions;
  e         public.agent_runs;
  v_ttl     integer;
  v_ttl_max integer := app.agent_limit('ttl_max_seconds', 1800);
  v_exp     timestamptz;
  v_token   bigint;
  v_company uuid;
  v_lead    uuid;
  v_enquiry uuid;
  v_key     text;
  v_budget  jsonb := coalesce(p_budgets, '{}'::jsonb);
  v_max     integer[];
begin
  -- 1. the caller must hold a starting role in the tenant: Owner, Admin or Sales (a Viewer, an outsider, a foreign or an
  --    unknown tenant all fail here, identically)
  if v_uid is null or p_tenant_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  if p_run_id is null or p_agent_name is null or p_agent_version is null or p_target_kind is null or p_target_id is null
     or p_input_sha256 is null or p_target_kind not in ('company', 'lead', 'enquiry') or jsonb_typeof(v_refs) <> 'object'
     or jsonb_typeof(v_budget) <> 'object' or (p_ttl_seconds is not null and p_ttl_seconds < 0) then
    perform app.agent_state_error('invalid');
  end if;
  v_company := case when p_target_kind = 'company' then p_target_id end;
  v_lead    := case when p_target_kind = 'lead' then p_target_id end;
  v_enquiry := case when p_target_kind = 'enquiry' then p_target_id end;

  -- 2. an exact retry of an earlier start by the same user is a replay (returns the run as it was)
  select * into e from public.agent_runs a where a.id = p_run_id;
  if found and e.tenant_id = p_tenant_id and e.started_by = v_uid and e.agent_name = p_agent_name
     and e.agent_version = p_agent_version and e.company_id is not distinct from v_company
     and e.lead_id is not distinct from v_lead and e.enquiry_id is not distinct from v_enquiry and e.input_sha256 = p_input_sha256 and e.input_refs = v_refs then
    return jsonb_build_object('run_id', e.id, 'status', e.status, 'expires_at', e.expires_at, 'replayed', true,
                              'max_writes', e.max_writes, 'max_tool_calls', e.max_tool_calls,
                              'max_input_tokens', e.max_input_tokens, 'max_output_tokens', e.max_output_tokens,
                              'max_cost_micros', e.max_cost_micros);
  end if;

  -- 3. only now (the caller is a member allowed to start runs) may the answers say WHY a run cannot start
  select * into d from public.agent_definitions a where a.agent_name = p_agent_name;
  if not found then
    perform app.agent_state_error('reference');
  end if;
  perform app.agent_assert_enabled(p_tenant_id, p_agent_name);
  -- the requirement agent works on enquiries and nothing else; every other agent works on companies and leads and never on an enquiry
  if (p_agent_name = 'requirement') <> (p_target_kind = 'enquiry') then
    perform app.agent_state_error('reference');
  end if;

  if p_target_kind = 'company' and not exists (select 1 from public.companies c where c.tenant_id = p_tenant_id and c.id = p_target_id)
     or p_target_kind = 'lead' and not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_target_id)
     or p_target_kind = 'enquiry' and not exists (select 1 from public.enquiries x where x.tenant_id = p_tenant_id and x.id = p_target_id and x.archived_at is null) then
    perform app.agent_state_error('reference');
  end if;
  -- a lead with NO company has nothing to research and no home for a claim: refused here, before any fetch or model spend
  -- (the same refusal as an unknown lead)
  if p_target_kind = 'lead' and not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_target_id and l.company_id is not null) then
    perform app.agent_state_error('reference');
  end if;

  -- an enquiry that already has a CONFIRMED requirement is not extracted again: a human discards the requirement first
  if p_target_kind = 'enquiry' and exists (select 1 from public.requirements q where q.tenant_id = p_tenant_id and q.enquiry_id = p_target_id and q.status = 'confirmed') then
    perform app.requirement_error('SM208');
  end if;
  -- the active DRAFT holds a person's work (a decided or manually added field): a re-run would supersede it, so a person discards it first
  if p_target_kind = 'enquiry' and app.requirement_human_work(p_tenant_id, p_target_id) then
    perform app.requirement_error('SM211');
  end if;

  -- 4. budgets: a request can only LOWER the agent's ceilings
  for v_key in select jsonb_object_keys(v_budget) loop
    if v_key not in ('max_writes', 'max_tool_calls', 'max_input_tokens', 'max_output_tokens', 'max_cost_micros')
       or jsonb_typeof(v_budget -> v_key) <> 'number' or (v_budget ->> v_key)::numeric < 0 then
      perform app.agent_state_error('invalid');
    end if;
  end loop;

  -- 5. limits (the tenant's start rate is serialised so two concurrent starts cannot both slip under the cap)
  perform pg_advisory_xact_lock(hashtextextended('agent_start:' || p_tenant_id::text, 0));
  if (select count(*) from public.agent_runs a
       where a.tenant_id = p_tenant_id and a.status = 'running' and a.expires_at > now() and a.cancel_requested_at is null)
       >= app.agent_limit('max_concurrent_runs', 0)
     or (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour' and not a.light)
       >= app.agent_limit('max_runs_per_hour', 0) then
    perform app.agent_state_error('SM206');
  end if;
  -- 5b. the daily cost cap: nothing starts once today's spend fills the cap (a zero or missing cap fills it). The real
  --     enforcement is the reservation before each model call; this is the early, cheap refusal.
  if app.agent_day_spend(p_tenant_id, app.agent_utc_today()) >= app.agent_daily_cap(p_tenant_id) then
    perform app.agent_state_error('SM207');
  end if;

  -- 6. expiry: never beyond the hard cap, never beyond the starter's own access token
  v_ttl := least(greatest(coalesce(p_ttl_seconds, app.agent_limit('ttl_default_seconds', 900)), 30), v_ttl_max);
  v_exp := now() + make_interval(secs => v_ttl);
  v_token := nullif(auth.jwt() ->> 'exp', '')::bigint;
  if v_token is not null then
    v_exp := least(v_exp, to_timestamp(v_token));
  end if;
  if v_exp <= now() + interval '5 seconds' then
    perform app.agent_state_error('SM202');
  end if;

  begin
    insert into public.agent_runs
      (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, enquiry_id, expires_at,
       max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, input_sha256, input_refs)
    values
      (p_run_id, p_tenant_id, v_uid, p_agent_name, p_agent_version, v_company, v_lead, v_enquiry, v_exp,
       least(coalesce((v_budget ->> 'max_writes')::numeric, d.max_writes), d.max_writes)::integer,
       least(coalesce((v_budget ->> 'max_tool_calls')::numeric, d.max_tool_calls), d.max_tool_calls)::integer,
       least(coalesce((v_budget ->> 'max_input_tokens')::numeric, d.max_input_tokens), d.max_input_tokens)::integer,
       least(coalesce((v_budget ->> 'max_output_tokens')::numeric, d.max_output_tokens), d.max_output_tokens)::integer,
       least(coalesce((v_budget ->> 'max_cost_micros')::numeric, d.max_cost_micros), d.max_cost_micros)::bigint,
       p_input_sha256, v_refs)
    returning * into e;
  exception when unique_violation then
    -- the id is used: by this user with other arguments, or by another tenant. The answer must not say which.
    raise exception 'agent run id already used' using errcode = '23505', constraint = 'agent_runs_pkey', table = 'agent_runs', schema = 'public';
  end;

  return jsonb_build_object('run_id', e.id, 'status', e.status, 'expires_at', e.expires_at, 'replayed', false,
                            'max_writes', e.max_writes, 'max_tool_calls', e.max_tool_calls,
                            'max_input_tokens', e.max_input_tokens, 'max_output_tokens', e.max_output_tokens,
                            'max_cost_micros', e.max_cost_micros);
end;
$function$;
