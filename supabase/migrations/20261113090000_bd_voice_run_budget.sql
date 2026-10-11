-- Job BD review (ADR 0071 addendum): the assistant run's cost budget goes BACK to Rs 1.00 (1,000,000 micros) for every run, and a run that carries voice (a reservation of the voice-stt or voice-tts accounting
-- model) may be charged up to Rs 3.00 in all, for its voice charges only. A new migration; the one before it (20261112090000) is not edited.
--
--   * agent_definitions.assistant.max_cost_micros: 3,000,000 -> 1,000,000.
--   * public.agent_record_usage: a FULL COPY of the T007 definition (20261014090500) with the changes marked "job BD": (1) whether the run carries voice is read from its reservations, (2) a voice charge is
--     not added to the run's own counter (cost_micros_used, which a table check holds to max_cost_micros: it counts what the MODEL spends) and is held, together with the model's spending, to
--     greatest(max_cost_micros, 3,000,000), (3) every other charge is held to max_cost_micros exactly as before. A run with no voice behaves exactly as before.
--     (Pinned by services/ai-api/tests/test_migration_copies_bd.py.) There is no flag a caller can set: a run is a voice run only by having been charged a voice model, and that charge is a real one on the
--     workspace's ledger, under the daily and monthly caps like any other.

update public.agent_definitions set max_cost_micros = 1000000 where agent_name = 'assistant';

create or replace function public.agent_record_usage(p_run_id uuid, p_step_key text, p_tokens_in bigint, p_tokens_out bigint, p_cost_micros bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r         public.agent_runs;
  e         public.agent_cost_reservations;
  v_sha     text;
  v_replay  jsonb;
  v_charge  bigint;
  v_voice   boolean;
  v_voice_used bigint;
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
  -- job BD: a run that carries voice (a reservation of a voice-* accounting model, which is always made before its usage) has a larger cost ceiling, Rs 3.00; a run without voice keeps its own
  v_voice := exists (select 1 from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.model like 'voice-%');
  -- numeric: the sum of two bigints cannot overflow, so an oversized value is a budget refusal, not a numeric error
  if r.input_tokens_used::numeric + p_tokens_in > r.max_input_tokens
     or r.output_tokens_used::numeric + p_tokens_out > r.max_output_tokens
     or r.cost_micros_used::numeric + p_cost_micros > (case when v_voice then greatest(r.max_cost_micros, 3000000) else r.max_cost_micros end) then
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
  -- what is charged can never exceed the run's own cost budget. Job BD: the run's own counter (cost_micros_used, which a table check holds to max_cost_micros) counts what the MODEL spends; a voice charge
  -- (speech to text, text to speech) is recorded on the ledger and the step but NOT in that counter, and is held instead to Rs 3.00 for the whole run (the model's spending and the voice charges together)
  select coalesce(sum(x.settled_micros), 0) into v_voice_used from public.agent_cost_reservations x
   where x.tenant_id = r.tenant_id and x.run_id = r.id and x.model like 'voice-%' and x.settled_micros is not null;
  if e.model like 'voice-%' then
    if r.cost_micros_used::numeric + v_voice_used + v_charge > greatest(r.max_cost_micros, 3000000) then
      perform app.agent_state_error('SM203');
    end if;
  elsif r.cost_micros_used::numeric + v_charge > r.max_cost_micros then
    perform app.agent_state_error('SM203');
  end if;
  update public.agent_cost_reservations x set settled_micros = v_charge, settled_at = now(), outcome = 'used' where x.id = e.id;
  if v_charge > e.reserved_micros then
    -- the provider billed more than the call's worst case: the ledger holds the TRUE cost and the excess is on record
    perform app.write_audit_event(r.tenant_id, 'agent_cost.overshoot', 'agent_run', r.id, null,
      jsonb_build_object('step_key', p_step_key, 'cost_day', e.cost_day, 'reserved_micros', e.reserved_micros,
                         'settled_micros', v_charge, 'excess_micros', v_charge - e.reserved_micros));
  end if;

  update public.agent_runs a
     set input_tokens_used = a.input_tokens_used + p_tokens_in::integer,
         output_tokens_used = a.output_tokens_used + p_tokens_out::integer,
         cost_micros_used = a.cost_micros_used + (case when e.model like 'voice-%' then 0 else v_charge end)
   where a.id = r.id;
  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, tokens_in, tokens_out, cost_micros)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'usage', 'usage', 'ok', v_sha, p_tokens_in::integer, p_tokens_out::integer, v_charge);
  return jsonb_build_object('step_key', p_step_key, 'replayed', false);
end;
$function$;
