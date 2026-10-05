-- T007 M2 / 3: the per-tenant DAILY COST CAP (ADR 0013, note added with this migration).
--
-- A tenant's agents may spend at most `cap` micro-units of the billing currency per UTC day (default 2.00; hard ceiling 20.00).
-- The cap is enforced where the money would be spent, not after:
--
--   1. start_agent_run   refuses (SM207) when the tenant's spend today already fills the cap. A cheap early refusal.
--   2. agent_reserve_cost is called by the runtime BEFORE EVERY model call. Under a per-tenant advisory lock it computes the worst
--      case of that call (declared max input tokens x input price + max output tokens x output price, rounded UP, prices from
--      the operator table agent_model_prices), refuses when spent-today + that worst case would exceed the cap, and otherwise
--      records a RESERVATION. Two concurrent runs of one tenant cannot both fit into the last bit of headroom.
--   3. agent_record_usage settles the reservation with what the call really used (tokens x the SAME price snapshot, rounded UP;
--      the larger of that and the runtime's own reported cost). Settling never moves a cost to another day.
--
-- Fail closed: no price row for the model, a zero price (the table CHECK forbids it; the function also refuses), a zero cap,
-- an unknown limit: all are a refusal, never "free". A refusal is SM207, except that agent_reserve_cost RETURNS the refusal
-- ({granted: false, reason}) instead of raising it, so that the audit event written for the cap hit is not rolled back with the
-- call (a raise aborts the whole statement). The API port turns that result into SM207's exception.
--
-- Which UTC day a cost belongs to: the day on which the model call was AUTHORISED (the reservation), taken from
-- app.agent_utc_today(). A run that starts on day D and calls the model on D+1 is charged to D+1; a call reserved at 23:59:58 and
-- settled at 00:00:03 stays on D. The run's start day does not matter. Rollover is testable because the helper is a function
-- the tests replace inside their rolled-back transaction (there is no override hook in production code).
--
-- Who may change the cap: the tenant's OWNER (not Admin), with a second factor (ADR 0016), through set_tenant_daily_cost_cap, to
-- 0 .. 20.00 per day (CHECK constraints on both the tenant column and the operator default). The change is audited by the
-- audit trigger of tenant_agent_settings (who, old value, new value).
--
-- The legacy path stays, and is capped too: agent_record_usage for a step key that has NO reservation charges the reported cost
-- and refuses (SM207) when it would not fit. (A raise cannot also write an audit event; reservations are the audited path.)
--
-- Maximum overshoot of the cap: see ADR 0013 (the section "Daily cost cap"). In short: none while the provider's usage stays
-- inside the declared bounds; the ledger records the true cost, with an audit event, when it does not.

-- ---------------------------------------------------------------------------------------------
-- 1. The operator default (agent_limits) and the per-tenant override (tenant_agent_settings)
-- ---------------------------------------------------------------------------------------------
alter table public.agent_limits drop constraint agent_limits_limit_key_check;
alter table public.agent_limits add constraint agent_limits_limit_key_check check (limit_key in
  ('ttl_default_seconds', 'ttl_max_seconds', 'max_concurrent_runs', 'max_runs_per_hour', 'max_writes_per_day', 'daily_cost_micros'));
-- the hard ceiling: 20.00 per day, whatever anyone sets
alter table public.agent_limits add constraint agent_limits_daily_cost_ceiling_chk
  check (limit_key <> 'daily_cost_micros' or limit_value <= 20000000);
insert into public.agent_limits (limit_key, limit_value) values ('daily_cost_micros', 2000000);

alter table public.tenant_agent_settings add column daily_cost_cap_micros bigint;
alter table public.tenant_agent_settings add constraint tenant_agent_settings_daily_cost_cap_chk
  check (daily_cost_cap_micros is null or daily_cost_cap_micros between 0 and 20000000);
comment on column public.tenant_agent_settings.daily_cost_cap_micros is
  'The tenant''s own daily cost cap in millionths of the billing currency (NULL = the operator default in agent_limits). 0 .. 20000000 (20.00).';

-- ---------------------------------------------------------------------------------------------
-- 2. Prices (operator-managed, no client privilege) and the reservation ledger
-- ---------------------------------------------------------------------------------------------
create table public.agent_model_prices (
  model                  text primary key check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'),
  -- millionths of the billing currency per million tokens. NEVER zero: a zero price would make every call free.
  input_micros_per_mtok  bigint not null check (input_micros_per_mtok > 0 and input_micros_per_mtok <= 1000000000),
  output_micros_per_mtok bigint not null check (output_micros_per_mtok > 0 and output_micros_per_mtok <= 1000000000),
  updated_at             timestamptz not null default now()
);
-- the scripted development model (refused outside development by the API). Real models are added by the operator, from the
-- provider's price list; until then a real model has no price and every call to it is refused.
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('fake-selftest', 1000000, 1000000);

revoke all on public.agent_model_prices from public, anon, authenticated;
alter table public.agent_model_prices enable row level security;
alter table public.agent_model_prices force row level security;

create table public.agent_cost_reservations (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete restrict,
  run_id                 uuid not null,
  -- the usage step key of the model call this reservation covers (usage-1, usage-2, ...)
  step_key               text not null check (step_key ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  -- the UTC day the cost belongs to: fixed when the call is authorised, never moved
  cost_day               date not null,
  -- NULL model / prices / bounds: a legacy usage record that had no reservation (charged at the reported cost)
  model                  text check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'),
  input_micros_per_mtok  bigint check (input_micros_per_mtok > 0),
  output_micros_per_mtok bigint check (output_micros_per_mtok > 0),
  max_input_tokens       bigint not null check (max_input_tokens >= 0),
  max_output_tokens      bigint not null check (max_output_tokens >= 0),
  reserved_micros        bigint not null check (reserved_micros >= 0),
  settled_micros         bigint check (settled_micros >= 0),
  args_sha256            text not null check (args_sha256 ~ '^[0-9a-f]{64}$'),
  created_at             timestamptz not null default now(),
  settled_at             timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, run_id, step_key),
  foreign key (tenant_id, run_id) references public.agent_runs (tenant_id, id),
  check ((settled_micros is null) = (settled_at is null)),
  check ((model is null) = (input_micros_per_mtok is null) and (model is null) = (output_micros_per_mtok is null))
);
-- the daily sum is an index range scan on (tenant, day)
create index agent_cost_reservations_day_idx on public.agent_cost_reservations (tenant_id, cost_day);

create trigger agent_cost_reservations_forbid_tenant_id_change before update on public.agent_cost_reservations
  for each row execute function app.forbid_tenant_id_change();

comment on column public.agent_cost_reservations.step_key  is 'SAFE: deterministic key chosen by our runtime. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.agent_cost_reservations.model     is 'SAFE: a model id from the operator price table (or NULL). CLEAN-EXEMPT: strict anchored pattern';
comment on column public.agent_cost_reservations.args_sha256 is 'SAFE: sha256 of the reservation arguments. CLEAN-EXEMPT: strict anchored hex pattern';

-- Owners and Admins READ their tenant's ledger (they see what the agents spend); nobody writes it directly: only the
-- definer functions below do. Every change is audited like the other agent tables.
revoke all on public.agent_cost_reservations from public, anon, authenticated;
grant select on public.agent_cost_reservations to authenticated;
alter table public.agent_cost_reservations enable row level security;
alter table public.agent_cost_reservations force row level security;
create policy agent_cost_reservations_select_admin on public.agent_cost_reservations for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger audit_agent_cost_reservations after insert or update or delete on public.agent_cost_reservations
  for each row execute function app.audit_row_change('agent_cost_reservation');

-- ---------------------------------------------------------------------------------------------
-- 3. Internal helpers (schema app, callable by no client role). All SECURITY DEFINER with an empty search_path.
-- ---------------------------------------------------------------------------------------------
-- "today" in UTC. The ONE place the day comes from (tests replace this function, inside their own transaction, to move the clock).
create function app.agent_utc_today() returns date
language sql
stable
security definer
set search_path = ''
as $$ select (now() at time zone 'UTC')::date $$;

-- cost = ceil((tokens_in x price_in + tokens_out x price_out) / 1,000,000): ALWAYS rounded UP, in numeric (no overflow).
create function app.agent_cost_micros(p_tokens_in bigint, p_tokens_out bigint, p_in_price bigint, p_out_price bigint) returns bigint
language sql
immutable
security definer
set search_path = ''
as $$ select ceil((p_tokens_in::numeric * p_in_price + p_tokens_out::numeric * p_out_price) / 1000000)::bigint $$;

-- the cap that applies to a tenant today: its own override, else the operator default, else 0 (fail closed)
create function app.agent_daily_cap(p_tenant uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.daily_cost_cap_micros from public.tenant_agent_settings s where s.tenant_id = p_tenant),
                  app.agent_limit('daily_cost_micros', 0))::bigint
$$;

-- what the tenant has spent or reserved on one UTC day (a settled call counts its settled cost, an open one its reservation)
create function app.agent_day_spend(p_tenant uuid, p_day date) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce(x.settled_micros, x.reserved_micros)), 0)
    from public.agent_cost_reservations x
   where x.tenant_id = p_tenant and x.cost_day = p_day
$$;

-- serialises everything that reads-then-writes the tenant's daily spend
create function app.agent_cost_lock(p_tenant uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('agent_cost:' || p_tenant::text, 0));
end;
$$;

revoke all on function app.agent_utc_today() from public, anon, authenticated, service_role;
revoke all on function app.agent_cost_micros(bigint, bigint, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function app.agent_daily_cap(uuid) from public, anon, authenticated, service_role;
revoke all on function app.agent_day_spend(uuid, date) from public, anon, authenticated, service_role;
revoke all on function app.agent_cost_lock(uuid) from public, anon, authenticated, service_role;

-- the new state: SM207 (every other code keeps its text)
create or replace function app.agent_state_error(p_code text) returns void
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
      when 'SM207' then 'agent daily cost cap reached'
      when 'invalid' then 'invalid argument'
      when 'value' then 'value not allowed'
      else 'invalid reference' end
    using errcode = case p_code when 'invalid' then '22023' when 'value' then '23514' when 'reference' then '23503' else p_code end;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. public.agent_reserve_cost: the worst case of ONE model call, reserved before the call is made.
--    Returns {granted: true, reserved_micros, cost_day, replayed} or {granted: false, reason: 'daily_cap' | 'no_price'}.
-- ---------------------------------------------------------------------------------------------
create function public.agent_reserve_cost(
  p_run_id            uuid,
  p_step_key          text,
  p_model             text,
  p_max_input_tokens  bigint,
  p_max_output_tokens bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.agent_runs;
  e        public.agent_cost_reservations;
  pr       public.agent_model_prices;
  v_sha    text;
  v_day    date;
  v_cap    bigint;
  v_spent  numeric;
  v_res    bigint;
  v_reason text;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_model is null or p_max_input_tokens is null or p_max_output_tokens is null
     or p_step_key !~ '^[a-z0-9][a-z0-9_.:-]{0,63}$' or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'
     or p_max_input_tokens < 0 or p_max_output_tokens < 0
     or p_max_input_tokens > 100000000 or p_max_output_tokens > 100000000 then
    perform app.agent_state_error('invalid');
  end if;
  v_sha := app.agent_args_sha(jsonb_build_object('model', p_model, 'in', p_max_input_tokens, 'out', p_max_output_tokens));

  -- everything below reads and then writes the tenant's daily spend: one tenant at a time
  perform app.agent_cost_lock(r.tenant_id);

  -- a retry of the same reservation is a replay and does not reserve twice, settled or not (a resumed run replays its earlier
  -- turns: the runtime's resume contract); the same key with other arguments is the usual conflict
  select * into e from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.step_key = p_step_key;
  if found then
    if e.args_sha256 <> v_sha then
      perform app.agent_state_error('SM205');
    end if;
    return jsonb_build_object('granted', true, 'reserved_micros', e.reserved_micros, 'cost_day', e.cost_day, 'replayed', true);
  end if;

  v_day := app.agent_utc_today();
  v_cap := app.agent_daily_cap(r.tenant_id);
  v_spent := app.agent_day_spend(r.tenant_id, v_day);

  select * into pr from public.agent_model_prices m where m.model = p_model;
  if not found or pr.input_micros_per_mtok is null or pr.output_micros_per_mtok is null
     or pr.input_micros_per_mtok <= 0 or pr.output_micros_per_mtok <= 0 then
    v_reason := 'no_price';
  else
    v_res := app.agent_cost_micros(p_max_input_tokens, p_max_output_tokens, pr.input_micros_per_mtok, pr.output_micros_per_mtok);
    if v_spent + v_res > v_cap then
      v_reason := 'daily_cap';
    end if;
  end if;

  if v_reason is not null then
    -- the audit event of a cap hit (returned, not raised, so that it is kept)
    perform app.write_audit_event(r.tenant_id, 'agent_cost.refused', 'agent_run', r.id, null,
      jsonb_build_object('reason', v_reason, 'step_key', p_step_key, 'cost_day', v_day, 'cap_micros', v_cap,
                         'spent_micros', v_spent, 'requested_micros', v_res));
    return jsonb_build_object('granted', false, 'reason', v_reason);
  end if;

  insert into public.agent_cost_reservations
    (tenant_id, run_id, step_key, cost_day, model, input_micros_per_mtok, output_micros_per_mtok,
     max_input_tokens, max_output_tokens, reserved_micros, args_sha256)
  values
    (r.tenant_id, r.id, p_step_key, v_day, p_model, pr.input_micros_per_mtok, pr.output_micros_per_mtok,
     p_max_input_tokens, p_max_output_tokens, v_res, v_sha);
  return jsonb_build_object('granted', true, 'reserved_micros', v_res, 'cost_day', v_day, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. public.agent_record_usage: settles the reservation (or, with none, charges the reported cost under the cap).
--    Same signature as before; the run's own token and cost budgets are checked exactly as they were.
-- ---------------------------------------------------------------------------------------------
create or replace function public.agent_record_usage(
  p_run_id      uuid,
  p_step_key    text,
  p_tokens_in   bigint,
  p_tokens_out  bigint,
  p_cost_micros bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.agent_runs;
  e         public.agent_cost_reservations;
  v_sha     text;
  v_replay  jsonb;
  v_charge  bigint;
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
  -- numeric: the sum of two bigints cannot overflow, so an oversized value is a budget refusal, not a numeric error
  if r.input_tokens_used::numeric + p_tokens_in > r.max_input_tokens
     or r.output_tokens_used::numeric + p_tokens_out > r.max_output_tokens
     or r.cost_micros_used::numeric + p_cost_micros > r.max_cost_micros then
    perform app.agent_state_error('SM203');
  end if;

  -- the tenant's daily ledger
  perform app.agent_cost_lock(r.tenant_id);
  select * into e from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.step_key = p_step_key;
  if found then
    if e.settled_micros is not null then
      perform app.agent_state_error('SM205');
    end if;
    -- the real cost: the call's tokens at the price that was reserved with (rounded up), or what the runtime reported if larger
    v_charge := greatest(p_cost_micros,
                         app.agent_cost_micros(p_tokens_in, p_tokens_out, e.input_micros_per_mtok, e.output_micros_per_mtok));
    update public.agent_cost_reservations x set settled_micros = v_charge, settled_at = now() where x.id = e.id;
    if v_charge > e.reserved_micros then
      -- the provider billed more than the call's worst case: the ledger holds the TRUE cost and the excess is on record
      perform app.write_audit_event(r.tenant_id, 'agent_cost.overshoot', 'agent_run', r.id, null,
        jsonb_build_object('step_key', p_step_key, 'cost_day', e.cost_day, 'reserved_micros', e.reserved_micros,
                           'settled_micros', v_charge, 'excess_micros', v_charge - e.reserved_micros));
    end if;
  else
    -- no reservation (a caller that skipped it): charge the reported cost now, and refuse when it does not fit
    v_charge := p_cost_micros;
    if app.agent_day_spend(r.tenant_id, app.agent_utc_today()) + v_charge > app.agent_daily_cap(r.tenant_id) then
      perform app.agent_state_error('SM207');
    end if;
    insert into public.agent_cost_reservations
      (tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, settled_at, args_sha256)
    values
      (r.tenant_id, r.id, p_step_key, app.agent_utc_today(), p_tokens_in, p_tokens_out, v_charge, v_charge, now(), v_sha);
  end if;

  update public.agent_runs a
     set input_tokens_used = a.input_tokens_used + p_tokens_in::integer,
         output_tokens_used = a.output_tokens_used + p_tokens_out::integer,
         cost_micros_used = a.cost_micros_used + p_cost_micros
   where a.id = r.id;
  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, tokens_in, tokens_out, cost_micros)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'usage', 'usage', 'ok', v_sha, p_tokens_in::integer, p_tokens_out::integer, p_cost_micros);
  return jsonb_build_object('step_key', p_step_key, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. public.start_agent_run: the same function, plus the cap check after the rate limits (step 5b).
-- ---------------------------------------------------------------------------------------------
create or replace function public.start_agent_run(
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
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. public.set_tenant_daily_cost_cap: Owner only, second factor required, audited (by the tenant_agent_settings audit trigger).
--    p_cap_micros NULL clears the override (back to the operator default).
-- ---------------------------------------------------------------------------------------------
create function public.set_tenant_daily_cost_cap(p_tenant_id uuid, p_cap_micros bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  perform app.require_aal2();
  if p_cap_micros is not null and (p_cap_micros < 0 or p_cap_micros > 20000000) then
    perform app.agent_state_error('value');
  end if;
  insert into public.tenant_agent_settings as s (tenant_id, daily_cost_cap_micros, updated_by, updated_at)
  values (p_tenant_id, p_cap_micros, v_uid, now())
  on conflict (tenant_id) do update set daily_cost_cap_micros = excluded.daily_cost_cap_micros, updated_by = v_uid, updated_at = now();
  return jsonb_build_object('tenant_id', p_tenant_id, 'daily_cost_cap_micros', app.agent_daily_cap(p_tenant_id));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: authenticated may call the two new public functions; nobody else. (The replaced functions keep theirs.)
-- ---------------------------------------------------------------------------------------------
revoke all on function public.agent_reserve_cost(uuid, text, text, bigint, bigint) from public, anon;
revoke all on function public.set_tenant_daily_cost_cap(uuid, bigint) from public, anon;
grant execute on function public.agent_reserve_cost(uuid, text, text, bigint, bigint) to authenticated;
grant execute on function public.set_tenant_daily_cost_cap(uuid, bigint) to authenticated;
