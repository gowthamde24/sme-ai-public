-- T007 M3b: owner review of the daily cost cap (commits 3, 3b and 4).
--
--   1. agent_record_usage counts the CHARGE (the larger of the reported cost and the cost computed from the tokens), not the reported cost, in
--      agent_runs.cost_micros_used and in the usage step: a runtime that reports 0 for real tokens still spends the run's cost budget (SM203).
--   2. ONE rule for a reservation that is never settled: it STAYS OPEN and keeps counting at its worst case until its UTC day ends (the day is fixed
--      when it is made, so it ages out at midnight on its own). A run that is cancelled, expired, killed or crashed mid-call cannot say whether the
--      provider billed the call, so the worst case is the only safe number, and the cost is bounded: one call's worst case per interrupted run.
--      The runtime settles what it KNOWS: a finished call at its real tokens, and a call that provably never reached a billing provider at zero
--      (agent_release_cost, with a closed reason). Everything else stays open. reservations gain `outcome` ('used' | 'not_billed').
--   3. agent_cost_summary(tenant): the Owner's / Admin's view of today's day: cap, settled, open (worst case) and each open reservation with its run's status.
--   4. agent_write_evidence refuses a URL that is not http:// or https:// (any case), a port other than 80 / 443, and any '@', backslash, whitespace or
--      control character, with the clean 'value' error.
--      The host rule is unchanged and is the runtime's rule too: the company's website host or its www. twin, nothing else (no other subdomain).

alter table public.agent_cost_reservations add column outcome text check (outcome in ('used', 'not_billed'));
comment on column public.agent_cost_reservations.outcome is 'SAFE: a closed word (used | not_billed). CLEAN-EXEMPT: closed CHECK list';
update public.agent_cost_reservations set outcome = 'used' where settled_micros is not null;
alter table public.agent_cost_reservations add constraint agent_cost_reservations_outcome_chk
  check ((settled_micros is null) = (outcome is null));

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
         cost_micros_used = a.cost_micros_used + v_charge
   where a.id = r.id;
  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, tokens_in, tokens_out, cost_micros)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'usage', 'usage', 'ok', v_sha, p_tokens_in::integer, p_tokens_out::integer, v_charge);
  return jsonb_build_object('step_key', p_step_key, 'replayed', false);
end;
$function$;

create or replace function public.agent_write_evidence(p_run_id uuid, p_step_key text, p_kind evidence_kind, p_url text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_snippet text DEFAULT NULL::text, p_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r         public.agent_runs;
  v_sha     text;
  v_replay  jsonb;
  v_evid    uuid;
  v_link    uuid;
  v_ref     text;
  v_company uuid;
  v_host    text;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_kind is null then
    perform app.agent_state_error('invalid');
  end if;
  -- the agent's definition names the kinds it may write (the run is proven the caller's by now)
  if not exists (select 1 from public.agent_definitions d where d.agent_name = r.agent_name and p_kind = any (d.allowed_evidence_kinds)) then
    perform app.agent_state_error('value');
  end if;
  -- a URL is http:// or https:// (any case) and nothing else: website_host() strips ANY scheme, so ftp://host/x, file:// or javascript: must be
  -- refused here, before the host rule; the evidence_url_check CHECK stays as the second layer. An explicit port must be 80 or 443 (the only
  -- ports the fetcher ever uses).
  -- Also refused anywhere in the URL: '@' (userinfo tricks such as https://user@host:443/), a backslash (browsers read it as '/'), whitespace and
  -- control characters (including tab, newline, DEL). evidence_url_check refuses some of these too; this is the first layer, with the clean error.
  if p_url is not null and (p_url !~* '^https?://' or p_url ~* '^https?://[^/?#]*:(?!(80|443)([/?#]|$))'
                            or p_url ~ '[@\\[:space:][:cntrl:]]') then
    perform app.agent_state_error('value');
  end if;
  -- WEB evidence: a quote (at most 300 characters) and a URL on the run target's OWN website. The host is decided HERE, from the
  -- company the run is about, never by the caller; a query string or a fragment cannot carry data out.
  if p_kind = 'web_page' then
    v_company := coalesce(r.company_id, (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id));
    v_host := app.website_host((select c.website from public.companies c where c.tenant_id = r.tenant_id and c.id = v_company));
    if v_host is null or p_url is null or p_url ~ '[?#]' or app.website_host(p_url) is distinct from v_host
       or p_snippet is null or char_length(p_snippet) > 300 then
      perform app.agent_state_error('value');
    end if;
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
$function$;

-- the runtime's "this call provably never reached a billing provider": settle an OPEN reservation at ZERO. Closed reasons only. The run must still
-- be running (a terminal run's open reservations stay open: the one rule above).
create function public.agent_release_cost(p_run_id uuid, p_step_key text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
  e public.agent_cost_reservations;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_reason is null or p_reason not in ('rate_limited', 'rejected', 'not_configured') then
    perform app.agent_state_error('invalid');
  end if;
  perform app.agent_cost_lock(r.tenant_id);
  select * into e from public.agent_cost_reservations x where x.tenant_id = r.tenant_id and x.run_id = r.id and x.step_key = p_step_key;
  if not found then
    perform app.agent_state_error('reference');
  end if;
  if e.settled_micros is not null then
    if e.outcome = 'not_billed' then
      return jsonb_build_object('step_key', p_step_key, 'released', true, 'replayed', true);
    end if;
    perform app.agent_state_error('reference');  -- already settled at real usage: it cannot be released
  end if;
  update public.agent_cost_reservations x set settled_micros = 0, settled_at = now(), outcome = 'not_billed' where x.id = e.id;
  perform app.write_audit_event(r.tenant_id, 'agent_cost.released', 'agent_run', r.id, null,
    jsonb_build_object('step_key', p_step_key, 'cost_day', e.cost_day, 'reserved_micros', e.reserved_micros, 'reason', p_reason));
  return jsonb_build_object('step_key', p_step_key, 'released', true, 'replayed', false);
end;
$$;
revoke all on function public.agent_release_cost(uuid, text, text) from public, anon;
grant execute on function public.agent_release_cost(uuid, text, text) to authenticated;

-- today's (UTC) spend for an Owner or Admin: the cap, what is settled, and what is still OPEN (counted at its worst case until its day ends)
create function public.agent_cost_summary(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := app.agent_utc_today();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  return jsonb_build_object(
    'day', v_day,
    'cap_micros', app.agent_daily_cap(p_tenant_id),
    'settled_micros', (select coalesce(sum(x.settled_micros), 0) from public.agent_cost_reservations x
                        where x.tenant_id = p_tenant_id and x.cost_day = v_day and x.settled_micros is not null),
    'open_micros', (select coalesce(sum(x.reserved_micros), 0) from public.agent_cost_reservations x
                     where x.tenant_id = p_tenant_id and x.cost_day = v_day and x.settled_micros is null),
    'open', (select coalesce(jsonb_agg(jsonb_build_object('run_id', o.run_id, 'step_key', o.step_key, 'reserved_micros', o.reserved_micros,
                                                          'run_status', o.status, 'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
               from (select x.run_id, x.step_key, x.reserved_micros, r.status, x.created_at
                       from public.agent_cost_reservations x join public.agent_runs r on r.tenant_id = x.tenant_id and r.id = x.run_id
                      where x.tenant_id = p_tenant_id and x.cost_day = v_day and x.settled_micros is null
                      order by x.created_at desc limit 50) o));
end;
$$;
revoke all on function public.agent_cost_summary(uuid) from public, anon;
grant execute on function public.agent_cost_summary(uuid) to authenticated;
