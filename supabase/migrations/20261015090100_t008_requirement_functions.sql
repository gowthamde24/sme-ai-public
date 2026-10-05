-- T008 / commit 3: the Requirement agent's database half and the human decision functions (docs/plans/t008-requirement-agent.md).
--
--   * flag 'requirement_enabled' (OFF), the definition 'requirement' (no claim predicates, no evidence kinds: it can write NEITHER claims
--     nor evidence, only requirement fields), allowed for NO tenant until the operator names one (app.operator_enable_requirement)
--   * agent_runs: target kind 'enquiry'. start_agent_run accepts it for the requirement agent ONLY (and the requirement agent only for it),
--     refuses an archived enquiry, and refuses an enquiry that already has a CONFIRMED requirement (SM208), all before any model spend
--   * public.agent_write_requirement_field: the agent's one write. The run must be a requirement run on an enquiry; the database VERIFIES
--     the quote against the stored enquiry body (offsets are characters; whitespace is exactly space, tab, CR, LF, as in
--     app/requirements/quote.py), the typed value's shape and caps (app.requirement_value_ok) and one field per (line, key); the first
--     write of a run creates the draft requirement and supersedes an older draft of the same enquiry
--   * public.decide_requirement_field (confirm | correct | reject), public.confirm_requirement, public.discard_requirement: HUMAN actions,
--     Owner / Admin / Sales of the tenant. Confirm needs a line whose saree type AND quantity a human has confirmed or corrected (SM210);
--     the delivery city, deadline and payment terms ("needed before quote") do not block it (owner decision 4)
--   * requirement_fields.conflict: the enquiry contradicts itself about this slot (set by the runtime, cleared only by a human decision)
-- SQLSTATEs: SM208 the enquiry already has a confirmed requirement   SM209 the requirement is not a draft   SM210 cannot be confirmed yet
--   42501 not permitted (an unknown id and another tenant's id are the same refusal)   plus the agent codes of ADR 0013.
-- The agent's delegated token is the starting HUMAN's token (ADR 0013 option A): the decision functions are reachable with it, like
-- review_claim. The sandbox has no code path to them (tests/test_agents_boundary.py); option B (a separate agent identity) is the real fix.

-- ---------------------------------------------------------------------------------------------
-- The agent definition may name no claim predicates and no evidence kinds
-- ---------------------------------------------------------------------------------------------
do $$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.agent_definitions'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) like '%cardinality(allowed_predicates)%' or pg_get_constraintdef(oid) like '%cardinality(allowed_evidence_kinds)%')
  loop
    execute format('alter table public.agent_definitions drop constraint %I', v_name);
  end loop;
end $$;
alter table public.agent_definitions add constraint agent_definitions_allowed_predicates_check check (
  cardinality(allowed_predicates) = 0
  or (cardinality(allowed_predicates) between 1 and 50
      and array_to_string(allowed_predicates, E'\n') ~ '^[a-z][a-z0-9_.]{1,63}(\n[a-z][a-z0-9_.]{1,63})*$'));
alter table public.agent_definitions add constraint agent_definitions_allowed_evidence_kinds_check
  check (cardinality(allowed_evidence_kinds) between 0 and 7);

alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled', 'requirement_enabled'));
insert into public.platform_flags (key, enabled) values ('requirement_enabled', false);

insert into public.agent_definitions
  (agent_name, allowed_predicates, allowed_evidence_kinds, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros,
   requires_flag, allowed_tenants)
values
  ('requirement', '{}'::text[], '{}'::public.evidence_kind[], 45, 60, 20000, 4000, 100000, 'requirement_enabled', '{}'::uuid[]);

-- the LOCAL operator switch (like operator_enable_research): callable by no application role
create function app.operator_enable_requirement(p_tenant_slug text) returns void
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
  update public.platform_flags set enabled = true where key in ('agents_enabled', 'requirement_enabled');
  update public.agent_definitions d
     set allowed_tenants = (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(coalesce(d.allowed_tenants, '{}'::uuid[]) || v_tenant) x)
   where d.agent_name = 'requirement';
  insert into public.tenant_agent_settings (tenant_id, enabled) values (v_tenant, true)
  on conflict (tenant_id) do update set enabled = true, updated_at = now();
end;
$$;
revoke all on function app.operator_enable_requirement(text) from public, anon, authenticated, service_role;

alter table public.requirement_fields add column conflict boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function app.requirement_deny() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'requirement action not permitted' using errcode = '42501';
end;
$$;

create function app.requirement_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'SM208' then 'enquiry already has a confirmed requirement'
      when 'SM209' then 'requirement is not a draft'
      when 'SM210' then 'requirement cannot be confirmed yet'
      when 'invalid' then 'invalid argument'
      when 'value' then 'value not allowed'
      else 'invalid reference' end
    using errcode = case p_code when 'invalid' then '22023' when 'value' then '23514' when 'reference' then '23503' else p_code end;
end;
$$;

-- whitespace is exactly space, tab, CR and LF (the same definition as app/requirements/quote.py): runs collapse to one space, the ends go
create function app.requirement_ws(p text) returns text
language sql
immutable
set search_path = ''
as $$ select btrim(regexp_replace(p, '[ ' || chr(9) || chr(10) || chr(13) || ']+', ' ', 'g'), ' ') $$;

-- is this field slot settled by a human?
create function app.requirement_confirmable(p_tenant uuid, p_requirement uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.requirement_fields t
     where t.tenant_id = p_tenant and t.requirement_id = p_requirement and t.field_key = 'saree_type' and t.state in ('confirmed', 'corrected')
       and exists (select 1 from public.requirement_fields u
                    where u.tenant_id = t.tenant_id and u.requirement_id = t.requirement_id and u.field_key = 'quantity'
                      and u.line_no = t.line_no and u.state in ('confirmed', 'corrected')))
$$;
revoke all on function app.requirement_deny(), app.requirement_error(text), app.requirement_ws(text), app.requirement_confirmable(uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------
-- start_agent_run: the previous definition plus the enquiry target
-- ---------------------------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------------------------
-- public.agent_write_requirement_field: the requirement agent's ONE write
-- ---------------------------------------------------------------------------------------------
create function public.agent_write_requirement_field(
  p_run_id      uuid,
  p_step_key    text,
  p_line        smallint,
  p_key         text,
  p_value_code  text,
  p_value_int   bigint,
  p_value_date  date,
  p_value_text  text,
  p_basis       text,
  p_certainty   text,
  p_quote       text,
  p_start       integer,
  p_end         integer,
  p_conflict    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.agent_runs;
  v_body   text;
  v_quote  text;
  v_sha    text;
  v_replay jsonb;
  v_req    uuid;
  v_field  uuid;
begin
  r := app.agent_open_run(p_run_id);
  if r.agent_name <> 'requirement' or r.enquiry_id is null then
    perform app.agent_state_error('value');
  end if;
  if p_step_key is null or p_key is null or p_certainty is null or p_quote is null or p_start is null or p_end is null or p_conflict is null
     or p_key <> all (array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'])
     or p_certainty <> all (array['stated', 'implied', 'ambiguous']) then
    perform app.agent_state_error('invalid');
  end if;
  -- bound the work before doing any: a quote is at most 300 characters, and the whitespace around it is not worth more than a few thousand
  if char_length(p_quote) > 4000 or char_length(coalesce(p_value_text, '')) > 200 or char_length(coalesce(p_value_code, '')) > 100
     or char_length(coalesce(p_basis, '')) > 100 or char_length(p_step_key) > 64 then
    perform app.agent_state_error('invalid');
  end if;
  v_quote := app.requirement_ws(p_quote);
  v_sha := app.agent_args_sha(jsonb_build_object('line', p_line, 'key', p_key, 'code', p_value_code, 'int', p_value_int, 'date', p_value_date,
                                                  'text', p_value_text, 'basis', p_basis, 'certainty', p_certainty, 'quote', v_quote,
                                                  'start', p_start, 'end', p_end, 'conflict', p_conflict));
  v_replay := app.agent_step_replay(r, p_step_key, 'agent_write_requirement_field', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;

  -- the enquiry the run is about (the tenant is the run's own); lock it so two runs cannot both create the active draft
  select e.body into v_body from public.enquiries e
   where e.tenant_id = r.tenant_id and e.id = r.enquiry_id and e.archived_at is null for update;
  if not found then
    perform app.agent_state_error('reference');
  end if;
  if exists (select 1 from public.requirements q where q.tenant_id = r.tenant_id and q.enquiry_id = r.enquiry_id and q.status = 'confirmed') then
    perform app.requirement_error('SM208');
  end if;

  -- THE QUOTE IS VERIFIED HERE, against the stored text: the span (in characters) must say the quote, whitespace aside
  if char_length(v_quote) not between 1 and 300 or p_start < 0 or p_end <= p_start or p_end > char_length(v_body) or p_end - p_start > 1200
     or app.requirement_ws(substr(v_body, p_start + 1, p_end - p_start)) is distinct from v_quote then
    perform app.agent_state_error('value');
  end if;
  -- the value's shape, the vocabulary and the caps
  if not app.requirement_value_ok(p_key, p_line, p_value_code, p_value_int, p_value_date, p_value_text, p_basis)
     or not app.text_is_clean(p_value_code) or not app.text_is_clean(p_value_text) or not app.text_is_clean(p_basis) or not app.text_is_clean(v_quote) then
    perform app.agent_state_error('value');
  end if;

  -- this run's draft requirement (the first write creates it and supersedes an older draft of the same enquiry)
  perform app.agent_charge_write(r);
  v_req := app.agent_derived_id(r.id, 'requirement', 'requirement');
  if not exists (select 1 from public.requirements q where q.tenant_id = r.tenant_id and q.id = v_req) then
    perform set_config('app.created_via', 'agent', true);
    update public.requirements q set status = 'superseded' where q.tenant_id = r.tenant_id and q.enquiry_id = r.enquiry_id and q.status = 'draft';
    insert into public.requirements (id, tenant_id, enquiry_id, agent_run_id, status) values (v_req, r.tenant_id, r.enquiry_id, r.id, 'draft');
    perform set_config('app.created_via', '', true);
  end if;
  if (select count(*) from public.requirement_fields f where f.tenant_id = r.tenant_id and f.requirement_id = v_req) >= 40
     or exists (select 1 from public.requirement_fields f where f.tenant_id = r.tenant_id and f.requirement_id = v_req
                   and f.field_key = p_key::public.requirement_field_key and f.line_no is not distinct from p_line) then
    perform app.agent_state_error('value');
  end if;

  v_field := app.agent_derived_id(r.id, p_step_key, 'field');
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', r.id::text, true);
  insert into public.requirement_fields
    (id, tenant_id, requirement_id, line_no, field_key, value_code, value_int, value_date, value_text, basis, certainty, quote, quote_start, quote_end, conflict)
  values
    (v_field, r.tenant_id, v_req, p_line, p_key::public.requirement_field_key, p_value_code, p_value_int, p_value_date, p_value_text, p_basis,
     p_certainty::public.requirement_certainty, v_quote, p_start, p_end, p_conflict);
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);

  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'write', 'agent_write_requirement_field', 'ok', v_sha,
          jsonb_build_object('field_id', v_field, 'requirement_id', v_req));
  return jsonb_build_object('field_id', v_field, 'requirement_id', v_req, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The human decisions. The tenant comes from the ROW: an unknown id and another tenant's id are the same refusal.
-- ---------------------------------------------------------------------------------------------
create function public.decide_requirement_field(
  p_field_id    uuid,
  p_decision    text,
  p_value_code  text default null,
  p_value_int   bigint default null,
  p_value_date  date default null,
  p_value_text  text default null,
  p_basis       text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  f     public.requirement_fields;
  q     public.requirements;
  v_state public.requirement_field_state;
begin
  if v_uid is null or p_field_id is null then
    perform app.requirement_deny();
  end if;
  select * into f from public.requirement_fields x where x.id = p_field_id;
  if not found or not app.has_tenant_role(f.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.requirement_deny();
  end if;
  if p_decision is null or p_decision <> all (array['confirm', 'correct', 'reject']) then
    perform app.requirement_error('invalid');
  end if;
  if p_decision <> 'correct' and (p_value_code is not null or p_value_int is not null or p_value_date is not null or p_value_text is not null or p_basis is not null) then
    perform app.requirement_error('invalid');
  end if;

  select * into q from public.requirements x where x.tenant_id = f.tenant_id and x.id = f.requirement_id for update;
  select * into f from public.requirement_fields x where x.id = p_field_id for update;
  if q.status <> 'draft' then
    perform app.requirement_error('SM209');
  end if;

  v_state := case p_decision when 'confirm' then 'confirmed' when 'correct' then 'corrected' else 'rejected' end;
  if p_decision = 'correct' then
    -- the human's value goes through the same shape and caps as the agent's, and must differ from nothing: an exact retry is a replay
    if not app.requirement_value_ok(f.field_key::text, f.line_no, p_value_code, p_value_int, p_value_date, p_value_text, p_basis)
       or not app.text_is_clean(p_value_code) or not app.text_is_clean(p_value_text) or not app.text_is_clean(p_basis) then
      perform app.requirement_error('value');
    end if;
    if f.state = 'corrected' and f.value_code is not distinct from p_value_code and f.value_int is not distinct from p_value_int
       and f.value_date is not distinct from p_value_date and f.value_text is not distinct from p_value_text and f.basis is not distinct from p_basis then
      return jsonb_build_object('field_id', f.id, 'state', f.state, 'replayed', true);
    end if;
    update public.requirement_fields x
       set value_code = p_value_code, value_int = p_value_int, value_date = p_value_date, value_text = p_value_text, basis = p_basis,
           state = v_state, decided_by = v_uid, decided_at = now(), conflict = false
     where x.id = f.id;
  else
    if f.state = v_state then
      return jsonb_build_object('field_id', f.id, 'state', f.state, 'replayed', true);
    end if;
    update public.requirement_fields x
       set state = v_state, decided_by = v_uid, decided_at = now(), conflict = case when v_state = 'confirmed' then false else x.conflict end
     where x.id = f.id;
  end if;
  return jsonb_build_object('field_id', f.id, 'state', v_state, 'replayed', false);
end;
$$;

create function public.confirm_requirement(p_requirement_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  q     public.requirements;
begin
  if v_uid is null or p_requirement_id is null then
    perform app.requirement_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id;
  if not found or not app.has_tenant_role(q.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.requirement_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if q.status = 'confirmed' then
    return jsonb_build_object('requirement_id', q.id, 'status', q.status, 'replayed', true);
  end if;
  if q.status <> 'draft' then
    perform app.requirement_error('SM209');
  end if;
  -- THE RULE (owner decision 4): at least one line whose saree type AND quantity a human confirmed or corrected. Nothing else blocks it.
  if not app.requirement_confirmable(q.tenant_id, q.id) then
    perform app.requirement_error('SM210');
  end if;
  update public.requirements x set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now() where x.id = q.id;
  return jsonb_build_object('requirement_id', q.id, 'status', 'confirmed', 'replayed', false);
end;
$$;

create function public.discard_requirement(p_requirement_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  q     public.requirements;
begin
  if v_uid is null or p_requirement_id is null then
    perform app.requirement_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id;
  if not found or not app.has_tenant_role(q.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.requirement_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if q.status = 'discarded' then
    return jsonb_build_object('requirement_id', q.id, 'status', q.status, 'replayed', true);
  end if;
  if q.status not in ('draft', 'confirmed') then
    perform app.requirement_error('SM209');
  end if;
  update public.requirements x set status = 'discarded', confirmed_by = null, confirmed_at = null where x.id = q.id;
  return jsonb_build_object('requirement_id', q.id, 'status', 'discarded', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: authenticated may call the four; nobody else
-- ---------------------------------------------------------------------------------------------
revoke all on function public.agent_write_requirement_field(uuid, text, smallint, text, text, bigint, date, text, text, text, text, integer, integer, boolean) from public, anon;
revoke all on function public.decide_requirement_field(uuid, text, text, bigint, date, text, text) from public, anon;
revoke all on function public.confirm_requirement(uuid) from public, anon;
revoke all on function public.discard_requirement(uuid) from public, anon;
grant execute on function public.agent_write_requirement_field(uuid, text, smallint, text, text, bigint, date, text, text, text, text, integer, integer, boolean) to authenticated;
grant execute on function public.decide_requirement_field(uuid, text, text, bigint, date, text, text) to authenticated;
grant execute on function public.confirm_requirement(uuid) to authenticated;
grant execute on function public.discard_requirement(uuid) to authenticated;
