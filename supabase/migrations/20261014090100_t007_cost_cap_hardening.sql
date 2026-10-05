-- T007 M2 / 3b: hardening of the daily cost cap (owner review of commit 3).
--
--   1. agent_record_usage REQUIRES a reservation. The legacy path (a usage record with no reservation, charged at whatever cost the
--      caller reported) is removed: a member calling the function directly could report any cost up to the run's budget and, with a
--      few runs, fill a tenant's day. A usage record for a step key nobody reserved is now the same refusal as an unknown reference.
--   2. The runtime-reported cost is BOUNDED per call: it may be at most twice the reserved worst case (23514 otherwise; the
--      reservation stays open and keeps counting). With the prices of the table and the config equal, a real report is never above
--      the reservation, so the factor is slack for rounding and for a price drifting a little, not for abuse.
--   3. What is charged to the day is also checked against the run's own cost budget (SM203), like the reported cost always was, so a
--      single recorded call can never exceed its run's cap. (This is what makes the overshoot bound in ADR 0013 exact.)
--   4. A reservation must fit the run's own REMAINING token budgets (minus its other open reservations): a member cannot reserve a
--      whole day's cap with one call on one run (SM203, before any model call; the same budget the usage record would refuse later).

create or replace function public.agent_reserve_cost(
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
  v_open_in  numeric;
  v_open_out numeric;
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

  -- the call must fit what is LEFT of the run's token budgets, counting the run's other open reservations
  select coalesce(sum(x.max_input_tokens), 0), coalesce(sum(x.max_output_tokens), 0) into v_open_in, v_open_out
    from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.settled_micros is null;
  if r.input_tokens_used + v_open_in + p_max_input_tokens > r.max_input_tokens
     or r.output_tokens_used + v_open_out + p_max_output_tokens > r.max_output_tokens then
    perform app.agent_state_error('SM203');
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

  -- the tenant's daily ledger: the SAME per-tenant lock as a reservation, and a reservation is REQUIRED (nothing is charged to
  -- the day that nobody reserved)
  perform app.agent_cost_lock(r.tenant_id);
  select * into e from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.step_key = p_step_key;
  if not found or e.settled_micros is not null then
    perform app.agent_state_error('reference');
  end if;
  -- a reported cost is bounded by the reservation: at most twice the reserved worst case
  if p_cost_micros::numeric > 2 * e.reserved_micros then
    perform app.agent_state_error('value');
  end if;
  -- the real cost: the call's tokens at the price that was reserved with (rounded up), or what the runtime reported if larger
  v_charge := greatest(p_cost_micros,
                       app.agent_cost_micros(p_tokens_in, p_tokens_out, e.input_micros_per_mtok, e.output_micros_per_mtok));
  -- what is charged can never exceed the run's own cost budget
  if r.cost_micros_used::numeric + v_charge > r.max_cost_micros then
    perform app.agent_state_error('SM203');
  end if;
  update public.agent_cost_reservations x set settled_micros = v_charge, settled_at = now() where x.id = e.id;
  if v_charge > e.reserved_micros then
    -- the provider billed more than the call's worst case: the ledger holds the TRUE cost and the excess is on record
    perform app.write_audit_event(r.tenant_id, 'agent_cost.overshoot', 'agent_run', r.id, null,
      jsonb_build_object('step_key', p_step_key, 'cost_day', e.cost_day, 'reserved_micros', e.reserved_micros,
                         'settled_micros', v_charge, 'excess_micros', v_charge - e.reserved_micros));
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
