-- T006 / M1 review fixes (owner review of 20261009090000 and 20261009090100). New migration; the applied ones are untouched.
--
--   1  agent_definitions.allowed_evidence_kinds: an agent may write only the evidence kinds its definition names
--   2  provenance is decided by an ALLOW-LIST of the one trusted role, with the SAME predicate in app.set_created_meta and
--      app.set_agent_run_id (before: both blacklisted the two client roles, so any other role could declare an origin / run)
--   3  agent_record_step cannot register a tool name that the write functions own (a pre-registered step key could otherwise
--      "replay" a forged result and make the real write a no-op)
--   4  agent_record_usage: numeric comparison, bigint parameters, so oversized values are a budget refusal (SM203), never 22003
--   5  review_claim locks the claim row before it looks for a replay or inserts, so concurrent reviews serialise: the review
--      that acts last is the effective one, and an overlapping retry is a replay instead of a 'review id already used'

-- ---------------------------------------------------------------------------------------------
-- 1. allowed evidence kinds
-- ---------------------------------------------------------------------------------------------
alter table public.agent_definitions
  add column allowed_evidence_kinds public.evidence_kind[] not null default array['note']::public.evidence_kind[]
    constraint agent_definitions_allowed_evidence_kinds_check check (cardinality(allowed_evidence_kinds) between 1 and 7);
-- selftest is {note}; from here on a new definition must state its kinds
alter table public.agent_definitions alter column allowed_evidence_kinds drop default;

-- ---------------------------------------------------------------------------------------------
-- 2. the trusted-role predicate, identical in both triggers.
--    The predicate is: current_user = 'postgres'. Inside a SECURITY DEFINER function of this schema current_user is the function
--    owner (the migration role); in a client request (PostgREST) it is the request role. Everything else is NOT trusted and
--    gets origin 'manual' and no run id, whatever the transaction-local settings say. (The comments are kept out of the
--    function bodies on purpose: a test reads the bodies.)
-- ---------------------------------------------------------------------------------------------
create or replace function app.set_created_meta() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if current_user = 'postgres' then
      new.created_via := coalesce(nullif(current_setting('app.created_via', true), ''), 'manual')::public.record_origin;
    else
      new.created_via := 'manual';
    end if;
  else
    new.created_by := old.created_by;
    new.created_via := old.created_via;
  end if;
  return new;
end;
$$;

create or replace function app.set_agent_run_id() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'postgres' and new.created_via = 'agent' then
      new.agent_run_id := nullif(current_setting('app.agent_run_id', true), '')::uuid;
    else
      new.agent_run_id := null;
    end if;
  else
    new.agent_run_id := old.agent_run_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1 (continued). agent_write_evidence refuses a kind outside the agent's definition ('value' = 23514, fixed message)
-- ---------------------------------------------------------------------------------------------
create or replace function public.agent_write_evidence(
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
  -- the agent's definition names the kinds it may write (the run is proven the caller's by now)
  if not exists (select 1 from public.agent_definitions d where d.agent_name = r.agent_name and p_kind = any (d.allowed_evidence_kinds)) then
    perform app.agent_state_error('value');
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
-- 3. agent_record_step: the names the write / usage functions own cannot be registered here
-- ---------------------------------------------------------------------------------------------
create or replace function public.agent_record_step(
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
  -- reserved: every tool name a write function or the usage ledger records under. Registering one here would let a later
  -- write with the same step key "replay" the caller's forged result_ref and silently write nothing.
  if lower(p_tool_name) = 'usage' or lower(p_tool_name) like 'agent\_write%' then
    perform app.agent_state_error('value');
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

-- ---------------------------------------------------------------------------------------------
-- 4. agent_record_usage with bigint parameters and numeric comparisons. The old (integer, integer, bigint) signature is dropped
--    (exactly one overload must exist); a value PostgREST cannot even fit into a bigint never reaches the function (the API
--    maps any unexpected SQLSTATE to one fixed error).
-- ---------------------------------------------------------------------------------------------
drop function public.agent_record_usage(uuid, text, integer, integer, bigint);

create function public.agent_record_usage(
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
  -- numeric: the sum of two bigints cannot overflow, so an oversized value is a budget refusal, not a numeric error
  if r.input_tokens_used::numeric + p_tokens_in > r.max_input_tokens
     or r.output_tokens_used::numeric + p_tokens_out > r.max_output_tokens
     or r.cost_micros_used::numeric + p_cost_micros > r.max_cost_micros then
    perform app.agent_state_error('SM203');
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
revoke all on function public.agent_record_usage(uuid, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.agent_record_usage(uuid, text, bigint, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. review_claim: the claim row is locked before the replay lookup and the insert.
--    Order: (a) unlocked read, role check: a stranger can neither learn that a claim exists nor hold its row lock;
--           (b) lock the claim row; (c) replay lookup; (d) validation; (e) insert.
-- ---------------------------------------------------------------------------------------------
create or replace function public.review_claim(
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
  -- the caller is an Owner / Admin of the claim's tenant: now take the lock and re-read (reviews of one claim serialise)
  select * into c from public.claims x where x.id = p_claim_id for update;
  if not found then
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
