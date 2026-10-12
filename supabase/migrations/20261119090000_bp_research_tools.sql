-- Job BP (ADR 0078), part 1 of 1: WEB RESEARCH TOOLS. The database side of web search, reading a page, finding places (Google) and the metal prices, for Agent OWL.
--
--   * Accounting models, as voice did in job BD: a web tool is charged to the SAME run and the SAME ledger as a model call (`web-search`, `web-page`, `places-search`, `metal-price`), so the workspace's daily
--     and monthly caps, the pause and the usage screens already count it ("fair use"). Priced at the table's ceiling, 1,000 micros a token: a search 600 tokens = Rs 0.60, a page 50 = Rs 0.05, a places search
--     3,000 = Rs 3.00, a metal price 100 = Rs 0.10. A fair-use measure a little above the dearest published price (Tavily Rs 0.7, Brave Rs 0.4, Google Places Pro Rs 2.7 a call after its free monthly cap), not an invoice.
--   * `app.is_metered_model` / `app.metered_ceiling`, and `public.agent_record_usage` replaced as a FULL COPY of job BD's definition (20261113090000): every `voice-%` test becomes `app.is_metered_model`, and the
--     Rs 3.00 voice ceiling becomes `app.metered_ceiling(tenant, run)`: Rs 3.00 for a run with only voice, Rs 8.00 for a run that also searched the web (voice Rs 3.00 + the web tools' per-question worst case Rs 5.00). (Pinned by test_migration_copies_bp.py.)
--   * Per-shop daily limits by call count (`research.web_caps`, `public.web_quota_take`): the ledger rows ARE the usage record, so nothing new is stored per call.
--   * `public.web_query_check`: a query may not contain the full name of a person who is a contact of the business. (Phone numbers and e-mail addresses are refused in the API, before this is asked.)
-- SQLSTATEs: 42501 deny, 22023 invalid, SM251 the shop's daily limit for this kind of call is reached.

create schema research;
revoke all on schema research from public, anon, authenticated, service_role;

insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values
  ('web-search', 1000000000, 1000000000),
  ('web-page', 1000000000, 1000000000),
  ('places-search', 1000000000, 1000000000),
  ('metal-price', 1000000000, 1000000000)
on conflict (model) do nothing;

create function app.is_metered_model(p_model text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p_model like 'voice-%' or p_model like 'web-%' or p_model like 'places-%' or p_model like 'metal-%' $$;
revoke all on function app.is_metered_model(text) from public;

-- a run's ceiling for what is NOT the model's own spending: Rs 3.00 with voice only (job BD), Rs 8.00 once the run has used a web tool (voice 3.00 + the tools' worst case for one question: 3 searches 1.80, 2 pages 0.10, 1 places search 3.00, 1 metal price 0.10 = 5.00)
create function app.metered_ceiling(p_tenant uuid, p_run uuid) returns bigint
language sql
stable
set search_path = ''
as $$
  select case when exists (select 1 from public.agent_cost_reservations x where x.tenant_id = p_tenant and x.run_id = p_run
                            and (x.model like 'web-%' or x.model like 'places-%' or x.model like 'metal-%')) then 8000000 else 3000000 end
$$;
revoke all on function app.metered_ceiling(uuid, uuid) from public;

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
  v_voice := exists (select 1 from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and app.is_metered_model(x.model));
  -- numeric: the sum of two bigints cannot overflow, so an oversized value is a budget refusal, not a numeric error
  if r.input_tokens_used::numeric + p_tokens_in > r.max_input_tokens
     or r.output_tokens_used::numeric + p_tokens_out > r.max_output_tokens
     or r.cost_micros_used::numeric + p_cost_micros > (case when v_voice then greatest(r.max_cost_micros, app.metered_ceiling(r.tenant_id, r.id)) else r.max_cost_micros end) then
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
   where x.tenant_id = r.tenant_id and x.run_id = r.id and app.is_metered_model(x.model) and x.settled_micros is not null;
  if app.is_metered_model(e.model) then
    if r.cost_micros_used::numeric + v_voice_used + v_charge > greatest(r.max_cost_micros, app.metered_ceiling(r.tenant_id, r.id)) then
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
         cost_micros_used = a.cost_micros_used + (case when app.is_metered_model(e.model) then 0 else v_charge end)
   where a.id = r.id;
  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, tokens_in, tokens_out, cost_micros)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'usage', 'usage', 'ok', v_sha, p_tokens_in::integer, p_tokens_out::integer, v_charge);
  return jsonb_build_object('step_key', p_step_key, 'replayed', false);
end;
$function$;

create table research.web_caps (
  model   text primary key check (model in ('web-search', 'web-page', 'places-search', 'metal-price')),
  per_day integer not null check (per_day between 1 and 1000)
);
alter table research.web_caps enable row level security;
alter table research.web_caps force row level security;
revoke all on research.web_caps from public, anon, authenticated, service_role;
insert into research.web_caps (model, per_day) values ('web-search', 30), ('web-page', 60), ('places-search', 10), ('metal-price', 20);

-- Before a web call: may this workspace make another one today? The day is the AI ledger's own cost day. Counted from the ledger (the reservation is made right after, in the same tool call); a call that was
-- released as not billed (a provider that refused it, a page the guard refused) does not count. A soft limit: two calls at the very same moment can both pass.
-- Raises SM251 at the limit. Returns how many are left AFTER this one.
create function public.web_quota_take(p_run_id uuid, p_model text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
  v_cap integer;
  v_used integer;
begin
  r := app.agent_open_run(p_run_id);
  select c.per_day into v_cap from research.web_caps c where c.model = p_model;
  if v_cap is null then
    perform app.agent_state_error('invalid');
  end if;
  perform app.agent_cost_lock(r.tenant_id);
  select count(*)::integer into v_used from public.agent_cost_reservations x
   where x.tenant_id = r.tenant_id and x.model = p_model and x.cost_day = app.agent_cost_day(now()) and x.outcome is distinct from 'not_billed';
  if v_used >= v_cap then
    raise exception 'the daily limit for this kind of web call is reached' using errcode = 'SM251';
  end if;
  return jsonb_build_object('used', v_used + 1, 'cap', v_cap, 'left', v_cap - v_used - 1);
end;
$$;
revoke all on function public.web_quota_take(uuid, text) from public, anon;
grant execute on function public.web_quota_take(uuid, text) to authenticated;

-- What the shop has used today and may use (Owner/Admin read, for the settings screen)
create function public.web_usage_today(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(c.model, jsonb_build_object('used', (select count(*) from public.agent_cost_reservations x where x.tenant_id = p_tenant_id and x.model = c.model and x.cost_day = app.agent_cost_day(now()) and x.outcome is distinct from 'not_billed'), 'cap', c.per_day))
                     from research.web_caps c), '{}'::jsonb);
end;
$$;
revoke all on function public.web_usage_today(uuid) from public, anon;
grant execute on function public.web_usage_today(uuid) to authenticated;

-- A query for the open web may not name a person the business deals with. (Not STABLE: it opens the run, which may write, and PostgREST runs a stable function in a read-only transaction.) The run proves who is asking and for which business; true = fine to send. Names under four characters are not compared.
create function public.web_query_check(p_run_id uuid, p_query text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
  v_q text;
begin
  r := app.agent_open_run(p_run_id);
  if p_query is null or char_length(p_query) > 300 then
    perform app.agent_state_error('invalid');
  end if;
  v_q := lower(regexp_replace(p_query, '\s+', ' ', 'g'));
  return not exists (
    select 1 from public.contacts c
     where c.tenant_id = r.tenant_id and c.erased_at is null and char_length(btrim(c.full_name)) >= 4
       and position(lower(regexp_replace(btrim(c.full_name), '\s+', ' ', 'g')) in v_q) > 0);
end;
$$;
revoke all on function public.web_query_check(uuid, text) from public, anon;
grant execute on function public.web_query_check(uuid, text) to authenticated;
