-- T007 M2 / claim-home follow-ups (owner review of commit 2).
--
--   1. start_agent_run refuses a LEAD target whose lead has no company (the same 23503 'invalid reference' as an unknown lead), so no
--      run, no fetch and no model call is ever made for a lead that has no company to research and no home for a claim.
--   2. agent_write_claim: when a run names both a company and a lead, the lead must belong to that company, else the generic
--      'reference' refusal. agent_runs forbids naming both (CHECK num_nonnulls = 1), so this is defence in depth for the day that CHECK
--      is relaxed (a lead run for a known company).
-- Both functions are the previous definitions plus the lines above; nothing else changed.

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
  -- a lead with NO company has nothing to research and no home for a claim: refused here, before any fetch or model spend
  -- (the same refusal as an unknown lead)
  if p_target_kind = 'lead' and not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_target_id and l.company_id is not null) then
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
$function$;

create or replace function public.agent_write_claim(p_run_id uuid, p_step_key text, p_predicate text, p_value text, p_evidence_ids uuid[], p_stance evidence_stance DEFAULT 'supports'::evidence_stance)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r         public.agent_runs;
  d         public.agent_definitions;
  v_sha     text;
  v_replay  jsonb;
  v_claim   uuid;
  v_ev      uuid;
  v_ids     uuid[];
  v_company uuid;
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
  -- THE HOME: a company run writes about its company; a lead run writes about the lead's company. The tenant is the run's own.
  v_company := coalesce(r.company_id,
                        (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id));
  if v_company is null then
    perform app.agent_state_error('reference');
  end if;
  -- a run that names BOTH a company and a lead (the run table forbids it today; this does not rely on that) must name a lead OF that
  -- company, or the claim would be stored on one company with another's lead as its provenance
  if r.company_id is not null and r.lead_id is not null
     and (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id) is distinct from r.company_id then
    perform app.agent_state_error('reference');
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
  insert into public.claims (id, tenant_id, company_id, lead_id, source_lead_id, predicate, value, confidence)
  values (v_claim, r.tenant_id, v_company, null, r.lead_id, p_predicate, p_value, 'unverified');
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
$function$;
