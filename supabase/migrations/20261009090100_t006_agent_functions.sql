-- T006 / M1 (2 of 3): the agent write path (ADR 0013, option A: delegated runs).
--
-- A run is started by a signed-in human (start_agent_run) and carried out by the runtime with THAT human's token. The runtime
-- may write only through the SECURITY DEFINER functions below. Each one:
--   * takes a RUN id (or, for a review, a CLAIM id), never a tenant: the tenant is read from that row;
--   * answers every refusal that happens BEFORE the caller is proven to own the run with the same generic 42501
--     ("agent action not permitted"), so a stranger cannot tell an unknown run from someone else's run;
--   * only AFTER ownership is proven uses the dedicated, fixed-message states SM201..SM206 (the API maps codes to
--     fixed messages; nothing here ever puts a row value in a message);
--   * re-checks the starter's role LIVE at every write (a removed or demoted starter stops at the next call);
--   * decides provenance itself: created_via = 'agent' and the run id are set through two transaction-local settings that
--     only these functions set (and the triggers of the previous migration only honour for non-client roles), confidence
--     is hard-coded 'unverified', provider is 'agent.<agent name>'. No parameter can name any of them.
--
-- SQLSTATEs (the API classifies by SQLSTATE only):
--   42501  not permitted / unknown / someone else's / role lost          SM201  run is not running (finished, cancelled)
--   SM202  run has expired (or the token is about to)                    SM203  budget exhausted
--   SM204  agents are disabled (platform, tenant, agent flag, allow-list) SM205  step key reused with different arguments
--   SM206  limit reached (concurrent runs, runs per hour, writes per day)
--   22023  invalid argument   23503  invalid reference   23514  value not allowed (also the natural CHECKs of the tables)
--   23505  id already used (a run id or a review id: the same answer whether it is yours or another tenant's)

-- ---------------------------------------------------------------------------------------------
-- Internal helpers (schema app; callable by no client role)
-- ---------------------------------------------------------------------------------------------
create function app.agent_deny() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'agent action not permitted' using errcode = '42501';
end;
$$;

create function app.agent_state_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'SM201' then 'agent run is not running'
      when 'SM202' then 'agent run has expired'
      when 'SM203' then 'agent run budget exhausted'
      when 'SM204' then 'agents are disabled'
      when 'SM205' then 'agent step key reused with different arguments'
      when 'SM206' then 'agent limit reached'
      when 'invalid' then 'invalid argument'
      when 'value' then 'value not allowed'
      else 'invalid reference' end
    using errcode = case p_code when 'invalid' then '22023' when 'value' then '23514' when 'reference' then '23503' else p_code end;
end;
$$;

create function app.agent_args_sha(p jsonb) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p::text, 'UTF8')), 'hex') $$;

-- Deterministic ids: the same (run, step key, what) always gives the same id, so a retry cannot create a second row.
-- sha256, not md5: the inputs are chosen by the caller.
create function app.agent_derived_id(p_run uuid, p_step text, p_what text) returns uuid
language sql
immutable
set search_path = ''
as $$ select encode(substring(sha256(convert_to(p_run::text || ':' || p_step || ':' || p_what, 'UTF8')) from 1 for 16), 'hex')::uuid $$;

-- Are the three switches on for this tenant and agent? (platform, tenant, the agent's own flag and tenant allow-list)
create function app.agent_switches_on(p_tenant uuid, p_agent text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select f.enabled from public.platform_flags f where f.key = 'agents_enabled'), false)
     and coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant), false)
     and coalesce((
           select (d.requires_flag is null or coalesce((select f.enabled from public.platform_flags f where f.key = d.requires_flag), false))
              and (d.allowed_tenants is null or p_tenant = any (d.allowed_tenants))
             from public.agent_definitions d where d.agent_name = p_agent), false)
$$;

create function app.agent_assert_enabled(p_tenant uuid, p_agent text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.agent_switches_on(p_tenant, p_agent) then
    perform app.agent_state_error('SM204');
  end if;
end;
$$;

create function app.agent_limit(p_key text, p_default integer) returns integer
language sql
stable
set search_path = ''
as $$ select coalesce((select l.limit_value from public.agent_limits l where l.limit_key = p_key), p_default) $$;

-- Resolve and lock the caller's own run, with every check a write needs, in this order:
--   1. a JWT subject, and a run the caller started, and the caller STILL holds a writing role  -> else generic 42501
--   2. (row locked, re-read)  switches  -> SM204;  status / cancel request -> SM201;  expiry -> SM202
-- The first, unlocked read means a stranger can neither learn that a run exists nor hold its row lock.
create function app.agent_open_run(p_run_id uuid) returns public.agent_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     public.agent_runs;
begin
  if v_uid is null or p_run_id is null then
    perform app.agent_deny();
  end if;
  select * into r from public.agent_runs a where a.id = p_run_id and a.started_by = v_uid;
  if not found or not app.has_tenant_role(r.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  select * into r from public.agent_runs a where a.id = p_run_id for update;
  perform app.agent_assert_enabled(r.tenant_id, r.agent_name);
  if r.status <> 'running' or r.cancel_requested_at is not null then
    perform app.agent_state_error('SM201');
  end if;
  if r.expires_at <= now() then
    perform app.agent_state_error('SM202');
  end if;
  return r;
end;
$$;

-- A replay (same step key, same tool, same arguments) returns the stored ids; the same key with other arguments is SM205.
create function app.agent_step_replay(r public.agent_runs, p_step text, p_tool text, p_sha text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.agent_run_steps;
begin
  select * into s from public.agent_run_steps x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.step_key = p_step;
  if not found then
    return null;
  end if;
  if s.tool_name is distinct from p_tool or s.args_sha256 is distinct from p_sha then
    perform app.agent_state_error('SM205');
  end if;
  return coalesce(s.result_ref, '{}'::jsonb) || jsonb_build_object('replayed', true);
end;
$$;

-- One unit of the write budget, the tenant's daily cap (serialised per tenant so concurrent runs cannot overshoot it).
create function app.agent_charge_write(r public.agent_runs) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('agent_write:' || r.tenant_id::text, 0));
  if r.writes_used >= r.max_writes then
    perform app.agent_state_error('SM203');
  end if;
  if (select count(*) from public.agent_run_steps x
       where x.tenant_id = r.tenant_id and x.kind = 'write' and x.created_at > now() - interval '1 day')
     >= app.agent_limit('max_writes_per_day', 0) then
    perform app.agent_state_error('SM206');
  end if;
  update public.agent_runs a set writes_used = a.writes_used + 1 where a.id = r.id;
end;
$$;

revoke all on function app.agent_deny() from public;
revoke all on function app.agent_state_error(text) from public;
revoke all on function app.agent_args_sha(jsonb) from public;
revoke all on function app.agent_derived_id(uuid, text, text) from public;
revoke all on function app.agent_switches_on(uuid, text) from public;
revoke all on function app.agent_assert_enabled(uuid, text) from public;
revoke all on function app.agent_limit(text, integer) from public;
revoke all on function app.agent_open_run(uuid) from public;
revoke all on function app.agent_step_replay(public.agent_runs, text, text, text) from public;
revoke all on function app.agent_charge_write(public.agent_runs) from public;

-- ---------------------------------------------------------------------------------------------
-- public.set_tenant_agents_enabled: the tenant switch (level 2). Owner / Admin of that tenant.
-- ---------------------------------------------------------------------------------------------
create function public.set_tenant_agents_enabled(p_tenant_id uuid, p_enabled boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_enabled is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  insert into public.tenant_agent_settings as s (tenant_id, enabled, updated_by, updated_at)
  values (p_tenant_id, p_enabled, v_uid, now())
  on conflict (tenant_id) do update set enabled = excluded.enabled, updated_by = v_uid, updated_at = now();
  return jsonb_build_object('tenant_id', p_tenant_id, 'enabled', p_enabled);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.start_agent_run
-- ---------------------------------------------------------------------------------------------
create function public.start_agent_run(
  p_run_id        uuid,
  p_tenant_id     uuid,
  p_agent_name    text,
  p_agent_version text,
  p_target_kind   text,
  p_target_id     uuid,
  p_input_sha256  text,
  p_input_refs    jsonb   default '{}'::jsonb,
  p_ttl_seconds   integer default null,
  p_budgets       jsonb   default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     or p_input_sha256 is null or p_target_kind not in ('company', 'lead') or jsonb_typeof(v_refs) <> 'object'
     or jsonb_typeof(v_budget) <> 'object' or (p_ttl_seconds is not null and p_ttl_seconds < 0) then
    perform app.agent_state_error('invalid');
  end if;
  v_company := case when p_target_kind = 'company' then p_target_id end;
  v_lead    := case when p_target_kind = 'lead' then p_target_id end;

  -- 2. an exact retry of an earlier start by the same user is a replay (returns the run as it was)
  select * into e from public.agent_runs a where a.id = p_run_id;
  if found and e.tenant_id = p_tenant_id and e.started_by = v_uid and e.agent_name = p_agent_name
     and e.agent_version = p_agent_version and e.company_id is not distinct from v_company
     and e.lead_id is not distinct from v_lead and e.input_sha256 = p_input_sha256 and e.input_refs = v_refs then
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

  if p_target_kind = 'company' and not exists (select 1 from public.companies c where c.tenant_id = p_tenant_id and c.id = p_target_id)
     or p_target_kind = 'lead' and not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_target_id) then
    perform app.agent_state_error('reference');
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
     or (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour')
       >= app.agent_limit('max_runs_per_hour', 0) then
    perform app.agent_state_error('SM206');
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
      (id, tenant_id, started_by, agent_name, agent_version, company_id, lead_id, expires_at,
       max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, input_sha256, input_refs)
    values
      (p_run_id, p_tenant_id, v_uid, p_agent_name, p_agent_version, v_company, v_lead, v_exp,
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
$$;

-- ---------------------------------------------------------------------------------------------
-- public.agent_write_evidence: one evidence row, linked to the RUN'S target, atomically.
-- ---------------------------------------------------------------------------------------------
create function public.agent_write_evidence(
  p_run_id       uuid,
  p_step_key     text,
  p_kind         public.evidence_kind,
  p_url          text        default null,
  p_reference    text        default null,
  p_snippet      text        default null,
  p_published_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.agent_runs;
  v_sha     text;
  v_replay  jsonb;
  v_evid    uuid;
  v_link    uuid;
  v_ref     text;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_kind is null then
    perform app.agent_state_error('invalid');
  end if;
  v_sha := app.agent_args_sha(jsonb_build_object('kind', p_kind, 'url', p_url, 'reference', p_reference,
                                                  'snippet', p_snippet, 'published_at', p_published_at));
  v_replay := app.agent_step_replay(r, p_step_key, 'agent_write_evidence', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;
  perform app.agent_charge_write(r);

  v_evid := app.agent_derived_id(r.id, p_step_key, 'evidence');
  v_link := app.agent_derived_id(r.id, p_step_key, 'link');
  -- a source needs a url or a reference (table CHECK): a note defaults to a pointer at the run that wrote it
  v_ref := case when p_url is null and p_reference is null then 'run:' || r.id::text else p_reference end;

  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', r.id::text, true);
  insert into public.evidence (id, tenant_id, kind, provider, url, reference, snippet, published_at)
  values (v_evid, r.tenant_id, p_kind, 'agent.' || r.agent_name, p_url, v_ref, p_snippet, p_published_at);
  insert into public.evidence_links (id, tenant_id, evidence_id, company_id, lead_id)
  values (v_link, r.tenant_id, v_evid, r.company_id, r.lead_id);
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);

  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'write', 'agent_write_evidence', 'ok', v_sha,
          jsonb_build_object('evidence_id', v_evid, 'link_id', v_link));
  return jsonb_build_object('evidence_id', v_evid, 'link_id', v_link, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.agent_write_claim: one claim about the RUN'S target, linked to evidence THIS RUN wrote. Always 'unverified'.
-- ---------------------------------------------------------------------------------------------
create function public.agent_write_claim(
  p_run_id       uuid,
  p_step_key     text,
  p_predicate    text,
  p_value        text,
  p_evidence_ids uuid[],
  p_stance       public.evidence_stance default 'supports'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.agent_runs;
  d         public.agent_definitions;
  v_sha     text;
  v_replay  jsonb;
  v_claim   uuid;
  v_ev      uuid;
  v_ids     uuid[];
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_predicate is null or p_value is null or p_stance is null
     or p_evidence_ids is null or cardinality(p_evidence_ids) not between 1 and 5 or array_position(p_evidence_ids, null) is not null then
    perform app.agent_state_error('invalid');
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_evidence_ids) x;
  v_sha := app.agent_args_sha(jsonb_build_object('predicate', p_predicate, 'value', p_value, 'evidence', to_jsonb(v_ids), 'stance', p_stance));
  v_replay := app.agent_step_replay(r, p_step_key, 'agent_write_claim', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into d from public.agent_definitions a where a.agent_name = r.agent_name;
  if not found or p_predicate <> all (d.allowed_predicates) or p_stance <> all (d.allowed_stances) then
    perform app.agent_state_error('value');
  end if;
  -- every evidence id must be a row THIS run wrote, in this tenant (anything else looks like a missing id)
  if (select count(*) from public.evidence e where e.tenant_id = r.tenant_id and e.agent_run_id = r.id and e.id = any (v_ids))
     <> cardinality(v_ids) then
    perform app.agent_state_error('reference');
  end if;
  perform app.agent_charge_write(r);

  v_claim := app.agent_derived_id(r.id, p_step_key, 'claim');
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', r.id::text, true);
  insert into public.claims (id, tenant_id, company_id, lead_id, predicate, value, confidence)
  values (v_claim, r.tenant_id, r.company_id, r.lead_id, p_predicate, p_value, 'unverified');
  foreach v_ev in array v_ids loop
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance)
    values (app.agent_derived_id(r.id, p_step_key, 'link:' || v_ev::text), r.tenant_id, v_ev, v_claim, p_stance);
  end loop;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);

  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'write', 'agent_write_claim', 'ok', v_sha, jsonb_build_object('claim_id', v_claim));
  return jsonb_build_object('claim_id', v_claim, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.agent_record_step / agent_record_usage: the ledger of tool calls and of tokens / cost.
-- ---------------------------------------------------------------------------------------------
create function public.agent_record_step(
  p_run_id      uuid,
  p_step_key    text,
  p_tool_name   text,
  p_args_sha256 text,
  p_status      public.agent_step_status default 'ok',
  p_result_ref  jsonb                    default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.agent_runs;
  v_replay  jsonb;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_tool_name is null or p_status is null then
    perform app.agent_state_error('invalid');
  end if;
  v_replay := app.agent_step_replay(r, p_step_key, p_tool_name, p_args_sha256);
  if v_replay is not null then
    return v_replay;
  end if;
  if r.tool_calls_used >= r.max_tool_calls then
    perform app.agent_state_error('SM203');
  end if;
  update public.agent_runs a set tool_calls_used = a.tool_calls_used + 1 where a.id = r.id;
  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'tool_call', p_tool_name, p_status, p_args_sha256, p_result_ref);
  return jsonb_build_object('step_key', p_step_key, 'replayed', false);
end;
$$;

create function public.agent_record_usage(
  p_run_id      uuid,
  p_step_key    text,
  p_tokens_in   integer,
  p_tokens_out  integer,
  p_cost_micros bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.agent_runs;
  v_sha     text;
  v_replay  jsonb;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_tokens_in is null or p_tokens_out is null or p_cost_micros is null
     or p_tokens_in < 0 or p_tokens_out < 0 or p_cost_micros < 0 then
    perform app.agent_state_error('invalid');
  end if;
  v_sha := app.agent_args_sha(jsonb_build_object('in', p_tokens_in, 'out', p_tokens_out, 'cost', p_cost_micros));
  v_replay := app.agent_step_replay(r, p_step_key, 'usage', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;
  if r.input_tokens_used + p_tokens_in > r.max_input_tokens
     or r.output_tokens_used + p_tokens_out > r.max_output_tokens
     or r.cost_micros_used + p_cost_micros > r.max_cost_micros then
    perform app.agent_state_error('SM203');
  end if;
  update public.agent_runs a
     set input_tokens_used = a.input_tokens_used + p_tokens_in,
         output_tokens_used = a.output_tokens_used + p_tokens_out,
         cost_micros_used = a.cost_micros_used + p_cost_micros
   where a.id = r.id;
  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, tokens_in, tokens_out, cost_micros)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'usage', 'usage', 'ok', v_sha, p_tokens_in, p_tokens_out, p_cost_micros);
  return jsonb_build_object('step_key', p_step_key, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.cancel_agent_run (kill switch, level 1) and public.finish_agent_run.
-- Neither needs the switches ON: a run can always be cancelled and always be closed.
-- ---------------------------------------------------------------------------------------------
create function public.cancel_agent_run(p_run_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     public.agent_runs;
begin
  if v_uid is null or p_run_id is null then
    perform app.agent_deny();
  end if;
  select * into r from public.agent_runs a where a.id = p_run_id;
  -- the starter (while still allowed to start runs), or an Owner / Admin of the run's tenant
  if not found or not ((r.started_by = v_uid and app.has_tenant_role(r.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]))
                       or app.has_tenant_role(r.tenant_id, array['owner', 'admin']::public.app_role[])) then
    perform app.agent_deny();
  end if;
  select * into r from public.agent_runs a where a.id = p_run_id for update;
  if r.status <> 'running' then
    return jsonb_build_object('status', r.status, 'replayed', true);
  end if;
  update public.agent_runs a
     set status = 'cancelled', cancel_requested_at = now(), cancelled_by = v_uid, finished_at = now(), error_code = 'cancelled'
   where a.id = r.id;
  return jsonb_build_object('status', 'cancelled', 'replayed', false);
end;
$$;

create function public.finish_agent_run(
  p_run_id     uuid,
  p_status     public.agent_run_status,
  p_error_code public.agent_error_code default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     public.agent_runs;
begin
  if v_uid is null or p_run_id is null then
    perform app.agent_deny();
  end if;
  -- only the starter closes their run (no role or switch check: closing a run is always possible)
  select * into r from public.agent_runs a where a.id = p_run_id and a.started_by = v_uid;
  if not found then
    perform app.agent_deny();
  end if;
  select * into r from public.agent_runs a where a.id = p_run_id for update;
  if p_status is null or p_status = 'running' or (p_status = 'succeeded' and p_error_code is not null) then
    perform app.agent_state_error('invalid');
  end if;
  if r.status <> 'running' then
    if r.status = p_status then
      return jsonb_build_object('status', r.status, 'replayed', true);
    end if;
    perform app.agent_state_error('SM201');
  end if;
  -- a status must be TRUE when it is recorded
  if (p_status = 'cancelled' and r.cancel_requested_at is null)
     or (p_status = 'expired' and r.expires_at > now())
     or (p_status = 'killed' and app.agent_switches_on(r.tenant_id, r.agent_name)) then
    perform app.agent_state_error('value');
  end if;
  update public.agent_runs a set status = p_status, finished_at = now(), error_code = p_error_code where a.id = r.id;
  return jsonb_build_object('status', p_status, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.review_claim: promotion of an AGENT claim. Owner / Admin of the claim's tenant (decision 1). One claim per call.
-- ---------------------------------------------------------------------------------------------
create function public.review_claim(
  p_review_id   uuid,
  p_claim_id    uuid,
  p_decision    public.claim_review_decision,
  p_confidence  public.claim_confidence    default null,
  p_reason_code public.claim_review_reason default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  c      public.claims;
  e      public.claim_reviews;
  v_self boolean;
begin
  if v_uid is null or p_review_id is null or p_claim_id is null then
    perform app.agent_deny();
  end if;
  -- the tenant comes from the CLAIM; an unknown claim and another tenant's claim are the same refusal
  select * into c from public.claims x where x.id = p_claim_id;
  if not found or not app.has_tenant_role(c.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;

  -- an exact retry by the same reviewer is a replay
  select * into e from public.claim_reviews x where x.id = p_review_id;
  if found and e.tenant_id = c.tenant_id and e.claim_id = c.id and e.created_by = v_uid and e.decision = p_decision
     and e.confidence is not distinct from p_confidence and e.reason_code is not distinct from p_reason_code then
    return jsonb_build_object('review_id', e.id, 'replayed', true, 'self_review', e.self_review);
  end if;

  if p_decision is null
     or (p_decision = 'accepted' and (p_confidence is null or p_confidence not in ('low', 'medium', 'high') or p_reason_code is not null))
     or (p_decision = 'rejected' and (p_reason_code is null or p_confidence is not null)) then
    perform app.agent_state_error('invalid');
  end if;
  if c.created_via <> 'agent' or c.archived_at is not null then
    perform app.agent_state_error('value');
  end if;
  -- "medium" and "high" mean the evidence supports the claim: at least one live supporting link
  if p_decision = 'accepted' and p_confidence in ('medium', 'high')
     and not exists (select 1 from public.evidence_links l
                      where l.tenant_id = c.tenant_id and l.claim_id = c.id and l.stance = 'supports' and l.archived_at is null) then
    perform app.agent_state_error('value');
  end if;

  v_self := exists (select 1 from public.agent_runs r where r.tenant_id = c.tenant_id and r.id = c.agent_run_id and r.started_by = v_uid);
  -- a review is ALWAYS a human, manual record, whatever the settings held before
  perform set_config('app.created_via', 'manual', true);
  begin
    insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, reason_code, self_review)
    values (p_review_id, c.tenant_id, c.id, p_decision, p_confidence, p_reason_code, v_self);
  exception when unique_violation then
    raise exception 'review id already used' using errcode = '23505', constraint = 'claim_reviews_pkey', table = 'claim_reviews', schema = 'public';
  end;
  perform set_config('app.created_via', '', true);
  return jsonb_build_object('review_id', p_review_id, 'replayed', false, 'self_review', v_self);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- app.operator_enable_selftest: for the LOCAL dev seed (make seed-demo) and for the operator. Callable by NO application role
-- (owner decision c): it switches the platform on, allows the selftest agent for ONE named tenant, and turns that tenant on.
-- It never opens an agent to every tenant, and an unknown slug is an error.
-- ---------------------------------------------------------------------------------------------
create function app.operator_enable_selftest(p_tenant_slug text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  update public.platform_flags set enabled = true where key in ('agents_enabled', 'selftest_enabled');
  update public.agent_definitions d
     set allowed_tenants = (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(coalesce(d.allowed_tenants, '{}'::uuid[]) || v_tenant) x)
   where d.agent_name = 'selftest';
  insert into public.tenant_agent_settings (tenant_id, enabled) values (v_tenant, true)
  on conflict (tenant_id) do update set enabled = true, updated_at = now();
end;
$$;
revoke all on function app.operator_enable_selftest(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Grants: authenticated may call the nine public functions; nobody else.
-- ---------------------------------------------------------------------------------------------
revoke all on function public.set_tenant_agents_enabled(uuid, boolean) from public, anon;
revoke all on function public.start_agent_run(uuid, uuid, text, text, text, uuid, text, jsonb, integer, jsonb) from public, anon;
revoke all on function public.agent_write_evidence(uuid, text, public.evidence_kind, text, text, text, timestamptz) from public, anon;
revoke all on function public.agent_write_claim(uuid, text, text, text, uuid[], public.evidence_stance) from public, anon;
revoke all on function public.agent_record_step(uuid, text, text, text, public.agent_step_status, jsonb) from public, anon;
revoke all on function public.agent_record_usage(uuid, text, integer, integer, bigint) from public, anon;
revoke all on function public.cancel_agent_run(uuid) from public, anon;
revoke all on function public.finish_agent_run(uuid, public.agent_run_status, public.agent_error_code) from public, anon;
revoke all on function public.review_claim(uuid, uuid, public.claim_review_decision, public.claim_confidence, public.claim_review_reason) from public, anon;

grant execute on function public.set_tenant_agents_enabled(uuid, boolean) to authenticated;
grant execute on function public.start_agent_run(uuid, uuid, text, text, text, uuid, text, jsonb, integer, jsonb) to authenticated;
grant execute on function public.agent_write_evidence(uuid, text, public.evidence_kind, text, text, text, timestamptz) to authenticated;
grant execute on function public.agent_write_claim(uuid, text, text, text, uuid[], public.evidence_stance) to authenticated;
grant execute on function public.agent_record_step(uuid, text, text, text, public.agent_step_status, jsonb) to authenticated;
grant execute on function public.agent_record_usage(uuid, text, integer, integer, bigint) to authenticated;
grant execute on function public.cancel_agent_run(uuid) to authenticated;
grant execute on function public.finish_agent_run(uuid, public.agent_run_status, public.agent_error_code) to authenticated;
grant execute on function public.review_claim(uuid, uuid, public.claim_review_decision, public.claim_confidence, public.claim_review_reason) to authenticated;
