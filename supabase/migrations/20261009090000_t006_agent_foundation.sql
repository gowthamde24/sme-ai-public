-- T006 / M1 (1 of 3): the agent foundation (ADR 0013, accepted).
--
-- What a human-started agent run is, in the database, and how its output is marked. Nothing here lets an agent do
-- anything yet: the write functions are the next migration. This one adds the tables, the provenance columns and the
-- rules that make a forged "agent" origin impossible.
--
--   operator-managed, NO client privilege of any kind (changed by a migration only; decisions 2, 3, 9):
--     platform_flags         agents_enabled, selftest_enabled   (both OFF)
--     agent_limits           TTL, concurrency, rates            (15 min / 30 min cap / 3 / 30 per hour / 500 writes per day)
--     agent_definitions      per-agent predicate allow-list, stances, ceilings, which flag gates it, which tenants may use it
--   tenant-owned (clients can only READ them; every write goes through a SECURITY DEFINER function):
--     tenant_agent_settings  one row per tenant: agents ON or OFF (default OFF)
--     agent_runs             one row per run: who started it, its single target, status, expiry, budgets and what was used
--     agent_run_steps        append-only ledger: tool calls, writes, usage; unique (run, step key) = idempotency
--     claim_reviews          append-only human decisions on agent claims (promotion); origin forced manual
--   provenance:
--     evidence / evidence_links / claims gain agent_run_id (composite FK to agent_runs) and a CHECK tying
--     created_via = 'agent' to a run id. The column is set by a trigger that decides on the ROLE, never on the GUC alone.
--
-- Same rules as T003-T005: composite (tenant_id, x_id) foreign keys, no cascade, RLS enabled + forced with the
-- once-per-statement helpers, column-level grants (here: none for writes), text hygiene on every free-text / jsonb column,
-- audit through app.audit_row_change.

create type public.agent_run_status as enum ('running', 'succeeded', 'failed', 'cancelled', 'expired', 'killed');
create type public.agent_step_kind as enum ('tool_call', 'write', 'usage');
create type public.agent_step_status as enum ('ok', 'refused', 'failed');
-- a closed list: an error is a code, never model or exception text
create type public.agent_error_code as enum ('budget', 'expired', 'killed', 'cancelled', 'disabled', 'tool_failed', 'model_failed', 'invalid_output');
create type public.claim_review_decision as enum ('accepted', 'rejected');
create type public.claim_review_reason as enum ('incorrect', 'unsupported_by_evidence', 'outdated', 'duplicate', 'not_relevant');

-- ---------------------------------------------------------------------------------------------
-- Helper: a "reference map" is a small JSON object whose values are ids or numbers (never free text).
-- Used for agent_runs.input_refs and agent_run_steps.result_ref, so neither can carry a prompt, a document or a name.
-- ---------------------------------------------------------------------------------------------
create function app.is_ref_map(p jsonb) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) <> 'object' then false
    when octet_length(p::text) > 1024 then false
    else not exists (
      select 1 from jsonb_each(p) e
       where e.key !~ '^[a-z][a-z0-9_]{0,30}$'
          or not (jsonb_typeof(e.value) in ('number', 'boolean')
                  or (jsonb_typeof(e.value) = 'string'
                      and (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')))
  end
$$;
revoke all on function app.is_ref_map(jsonb) from public;

-- ---------------------------------------------------------------------------------------------
-- Operator-managed tables. No policy, no grant: only the migration role (and the definer functions it owns) can touch them.
-- ---------------------------------------------------------------------------------------------
create table public.platform_flags (
  key     text primary key check (key in ('agents_enabled', 'selftest_enabled')),
  enabled boolean not null default false
);
insert into public.platform_flags (key, enabled) values ('agents_enabled', false), ('selftest_enabled', false);

create table public.agent_limits (
  limit_key   text primary key check (limit_key in
                ('ttl_default_seconds', 'ttl_max_seconds', 'max_concurrent_runs', 'max_runs_per_hour', 'max_writes_per_day')),
  limit_value integer not null check (limit_value > 0)
);
-- decision 3: 15-minute default TTL, 30-minute hard cap, 3 concurrent runs, 30 runs per hour, 500 writes per day
insert into public.agent_limits (limit_key, limit_value) values
  ('ttl_max_seconds', 1800), ('ttl_default_seconds', 900), ('max_concurrent_runs', 3), ('max_runs_per_hour', 30), ('max_writes_per_day', 500);

create function app.guard_agent_limits() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_default integer := case when new.limit_key = 'ttl_default_seconds' then new.limit_value
                            else (select limit_value from public.agent_limits where limit_key = 'ttl_default_seconds') end;
  v_max     integer := case when new.limit_key = 'ttl_max_seconds' then new.limit_value
                            else (select limit_value from public.agent_limits where limit_key = 'ttl_max_seconds') end;
begin
  if v_default is not null and v_max is not null and v_default > v_max then
    raise exception 'the default TTL must not exceed the hard cap' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_agent_limits() from public;
create trigger agent_limits_guard before insert or update on public.agent_limits
  for each row execute function app.guard_agent_limits();

create table public.agent_definitions (
  agent_name         text primary key check (agent_name ~ '^[a-z][a-z0-9_]{1,29}$'),
  -- the ONLY claim predicates this agent may write: a prompt cannot widen it, the runtime cannot be configured around it
  allowed_predicates text[] not null check (
                       cardinality(allowed_predicates) between 1 and 50
                       and array_to_string(allowed_predicates, E'\n') ~ '^[a-z][a-z0-9_.]{1,63}(\n[a-z][a-z0-9_.]{1,63})*$'),
  allowed_stances    public.evidence_stance[] not null default array['supports', 'context', 'contradicts']::public.evidence_stance[]
                     check (cardinality(allowed_stances) between 1 and 3),
  -- ceilings: a run's budgets are clamped to these
  max_writes         integer not null check (max_writes between 0 and 1000),
  max_tool_calls     integer not null check (max_tool_calls between 0 and 1000),
  max_input_tokens   integer not null check (max_input_tokens between 0 and 2000000),
  max_output_tokens  integer not null check (max_output_tokens between 0 and 500000),
  max_cost_micros    bigint  not null check (max_cost_micros between 0 and 100000000),
  -- the platform flag that must be ON before this agent can start (NULL = only agents_enabled applies)
  requires_flag      text references public.platform_flags (key),
  -- NULL = any tenant; an array = only those tenants ('{}' = none)
  allowed_tenants    uuid[],
  created_at         timestamptz not null default now()
);
-- decision 3 (c): selftest is not startable by default. It needs its own flag (OFF) AND a tenant on its allow-list (empty).
insert into public.agent_definitions
  (agent_name, allowed_predicates, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, requires_flag, allowed_tenants)
values ('selftest', array['selftest.observation'], 6, 20, 20000, 4000, 250000, 'selftest_enabled', '{}'::uuid[]);

revoke all on public.platform_flags, public.agent_limits, public.agent_definitions from public, anon, authenticated;
alter table public.platform_flags    enable row level security;
alter table public.platform_flags    force row level security;
alter table public.agent_limits      enable row level security;
alter table public.agent_limits      force row level security;
alter table public.agent_definitions enable row level security;
alter table public.agent_definitions force row level security;

-- ---------------------------------------------------------------------------------------------
-- tenant_agent_settings: the per-tenant switch (default OFF). Written by set_tenant_agents_enabled() only.
-- ---------------------------------------------------------------------------------------------
create table public.tenant_agent_settings (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  enabled    boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- agent_runs
-- ---------------------------------------------------------------------------------------------
create table public.agent_runs (
  -- supplied by the caller (idempotent start); the same id with the same payload is a replay
  id                 uuid primary key,
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  -- the human who started the run (auth.uid()); a bare uuid, like created_by: the trail outlives the user
  started_by         uuid not null,
  agent_name         text not null references public.agent_definitions (agent_name)
                     check (agent_name ~ '^[a-z][a-z0-9_]{1,29}$'),
  agent_version      text not null check (agent_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  -- the run's one target (its scope): a write can only be about this company or lead
  company_id         uuid,
  lead_id            uuid,
  status             public.agent_run_status not null default 'running',
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  finished_at        timestamptz,
  -- budgets (ceilings come from agent_definitions, clamped when the run starts) and what has been used
  max_writes         integer not null default 10      check (max_writes >= 0),
  writes_used        integer not null default 0       check (writes_used >= 0),
  max_tool_calls     integer not null default 50      check (max_tool_calls >= 0),
  tool_calls_used    integer not null default 0       check (tool_calls_used >= 0),
  max_input_tokens   integer not null default 20000   check (max_input_tokens >= 0),
  input_tokens_used  integer not null default 0       check (input_tokens_used >= 0),
  max_output_tokens  integer not null default 4000    check (max_output_tokens >= 0),
  output_tokens_used integer not null default 0       check (output_tokens_used >= 0),
  max_cost_micros    bigint  not null default 250000  check (max_cost_micros >= 0),
  cost_micros_used   bigint  not null default 0       check (cost_micros_used >= 0),
  -- a hash of the normalised input (target ids + parameters), never the input itself
  input_sha256       text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  -- typed ids only (app.is_ref_map): no prompt, no document text, no name
  input_refs         jsonb not null default '{}'::jsonb check (
                       jsonb_typeof(input_refs) = 'object' and app.is_ref_map(input_refs) and app.text_is_clean(input_refs)),
  error_code         public.agent_error_code,
  cancel_requested_at timestamptz,
  cancelled_by       uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, lead_id)    references public.leads (tenant_id, id),
  check (num_nonnulls(company_id, lead_id) = 1),
  check (writes_used <= max_writes and tool_calls_used <= max_tool_calls
         and input_tokens_used <= max_input_tokens and output_tokens_used <= max_output_tokens
         and cost_micros_used <= max_cost_micros),
  check ((status = 'running') = (finished_at is null)),
  check (expires_at > created_at),
  check ((cancel_requested_at is null) = (cancelled_by is null))
);

-- ---------------------------------------------------------------------------------------------
-- agent_run_steps: the append-only ledger (tool calls, writes, usage). unique (tenant, run, step key) = idempotency.
-- ---------------------------------------------------------------------------------------------
create table public.agent_run_steps (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  run_id       uuid not null,
  -- copied from the run so that "a user reads the steps of their own runs" needs no sub-select in the policy
  started_by   uuid not null,
  step_key     text not null check (step_key ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  kind         public.agent_step_kind not null,
  tool_name    text check (tool_name ~ '^[a-z][a-z0-9_]{1,39}$'),
  status       public.agent_step_status not null,
  -- sha256 of the canonical arguments: a replay with the same key and the same arguments is the same step
  args_sha256  text check (args_sha256 ~ '^[0-9a-f]{64}$'),
  -- ids of what the step produced (so a replay can return them); typed ids only
  result_ref   jsonb check (result_ref is null or (jsonb_typeof(result_ref) = 'object' and app.is_ref_map(result_ref) and app.text_is_clean(result_ref))),
  tokens_in    integer not null default 0 check (tokens_in >= 0),
  tokens_out   integer not null default 0 check (tokens_out >= 0),
  cost_micros  bigint  not null default 0 check (cost_micros >= 0),
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, run_id, step_key),
  foreign key (tenant_id, run_id) references public.agent_runs (tenant_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- claim_reviews: promotion of an agent claim. Append-only; the newest review of a claim is its effective state.
-- ---------------------------------------------------------------------------------------------
create table public.claim_reviews (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  claim_id    uuid not null,
  decision    public.claim_review_decision not null,
  -- the level a HUMAN assigned (accepted only)
  confidence  public.claim_confidence,
  reason_code public.claim_review_reason,
  -- the reviewer started the run the claim came from (self-promotion is allowed in v1 and visible)
  self_review boolean not null,
  created_by  uuid,
  created_via public.record_origin not null default 'manual' check (created_via = 'manual'),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, claim_id) references public.claims (tenant_id, id),
  check ((decision = 'accepted') = (confidence is not null)),
  check (confidence is null or confidence in ('low', 'medium', 'high')),
  check ((decision = 'rejected') = (reason_code is not null))
);

-- ---------------------------------------------------------------------------------------------
-- Indexes: keyset pagination on the tenant tables; the child side of every composite foreign key.
-- ---------------------------------------------------------------------------------------------
create index agent_runs_tenant_created_idx      on public.agent_runs      (tenant_id, created_at desc, id);
create index agent_runs_company_idx             on public.agent_runs      (tenant_id, company_id) where company_id is not null;
create index agent_runs_lead_idx                on public.agent_runs      (tenant_id, lead_id) where lead_id is not null;
create index agent_runs_started_by_idx          on public.agent_runs      (tenant_id, started_by, created_at desc);
create index agent_runs_active_idx              on public.agent_runs      (tenant_id, status, expires_at);
create index agent_runs_agent_idx               on public.agent_runs      (agent_name);
create index agent_run_steps_tenant_created_idx on public.agent_run_steps (tenant_id, created_at desc, id);
create index agent_run_steps_started_by_idx     on public.agent_run_steps (tenant_id, started_by, created_at desc);
create index agent_run_steps_writes_idx         on public.agent_run_steps (tenant_id, kind, created_at desc);
create index claim_reviews_tenant_created_idx   on public.claim_reviews   (tenant_id, created_at desc, id);
-- "the newest review of this claim"
create index claim_reviews_latest_idx           on public.claim_reviews   (tenant_id, claim_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------------------------
-- Provenance on the three tables an agent writes to.
-- ---------------------------------------------------------------------------------------------
alter table public.evidence       add column agent_run_id uuid;
alter table public.evidence_links add column agent_run_id uuid;
alter table public.claims         add column agent_run_id uuid;

alter table public.evidence       add constraint evidence_agent_run_fk       foreign key (tenant_id, agent_run_id) references public.agent_runs (tenant_id, id);
alter table public.evidence_links add constraint evidence_links_agent_run_fk foreign key (tenant_id, agent_run_id) references public.agent_runs (tenant_id, id);
alter table public.claims         add constraint claims_agent_run_fk         foreign key (tenant_id, agent_run_id) references public.agent_runs (tenant_id, id);

-- Origin 'agent' <=> a run id. Neither can exist without the other, so an "agent" row is always traceable to a run
-- (and a run id never decorates a manual or imported row).
alter table public.evidence       add constraint evidence_agent_origin_chk       check ((created_via = 'agent') = (agent_run_id is not null));
alter table public.evidence_links add constraint evidence_links_agent_origin_chk check ((created_via = 'agent') = (agent_run_id is not null));
alter table public.claims         add constraint claims_agent_origin_chk         check ((created_via = 'agent') = (agent_run_id is not null));

create index evidence_agent_run_idx       on public.evidence       (tenant_id, agent_run_id) where agent_run_id is not null;
create index evidence_links_agent_run_idx on public.evidence_links (tenant_id, agent_run_id) where agent_run_id is not null;
create index claims_agent_run_idx         on public.claims         (tenant_id, agent_run_id) where agent_run_id is not null;

-- THE RULE (owner addition a): the run id is decided by the ROLE and the row's origin, never by the GUC alone.
--   * a client role (authenticated / anon) always gets NULL, whatever app.agent_run_id says;
--   * for any other role (inside a SECURITY DEFINER function the role is the function owner) the GUC is read only when
--     the origin, already decided by app.set_created_meta, is 'agent'; otherwise NULL;
--   * an UPDATE restores the old value.
-- The composite foreign key then proves the run exists in the same tenant, and the CHECK above ties it to the origin.
-- The trigger is named zz_ so that it fires AFTER <table>_set_created_meta (triggers fire in name order) and therefore
-- reads the origin that trigger decided.
create function app.set_agent_run_id() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') or new.created_via is distinct from 'agent' then
      new.agent_run_id := null;
    else
      new.agent_run_id := nullif(current_setting('app.agent_run_id', true), '')::uuid;
    end if;
  else
    new.agent_run_id := old.agent_run_id;
  end if;
  return new;
end;
$$;
revoke all on function app.set_agent_run_id() from public;

create trigger evidence_zz_set_agent_run_id       before insert or update on public.evidence       for each row execute function app.set_agent_run_id();
create trigger evidence_links_zz_set_agent_run_id before insert or update on public.evidence_links for each row execute function app.set_agent_run_id();
create trigger claims_zz_set_agent_run_id         before insert or update on public.claims         for each row execute function app.set_agent_run_id();

-- ---------------------------------------------------------------------------------------------
-- Triggers: tenant immutable, provenance server-set, append-only, audit.
-- ---------------------------------------------------------------------------------------------
create trigger tenant_agent_settings_forbid_tenant_id_change before update on public.tenant_agent_settings for each row execute function app.forbid_tenant_id_change();
create trigger agent_runs_forbid_tenant_id_change            before update on public.agent_runs            for each row execute function app.forbid_tenant_id_change();
create trigger agent_run_steps_forbid_tenant_id_change       before update on public.agent_run_steps       for each row execute function app.forbid_tenant_id_change();
create trigger claim_reviews_forbid_tenant_id_change         before update on public.claim_reviews         for each row execute function app.forbid_tenant_id_change();
create trigger claim_reviews_set_created_meta                before insert or update on public.claim_reviews for each row execute function app.set_created_meta();
-- steps and reviews are append-only, for every role including the owner
create trigger agent_run_steps_guard_immutable               before update on public.agent_run_steps       for each row execute function app.guard_immutable_record();
create trigger claim_reviews_guard_immutable                 before update on public.claim_reviews         for each row execute function app.guard_immutable_record();

create trigger audit_tenant_agent_settings after insert or update or delete on public.tenant_agent_settings
  for each row execute function app.audit_row_change('tenant_agent_settings');
create trigger audit_agent_runs            after insert or update or delete on public.agent_runs
  for each row execute function app.audit_row_change('agent_run');
create trigger audit_agent_run_steps       after insert or update or delete on public.agent_run_steps
  for each row execute function app.audit_row_change('agent_run_step');
create trigger audit_claim_reviews         after insert or update or delete on public.claim_reviews
  for each row execute function app.audit_row_change('claim_review');

-- ---------------------------------------------------------------------------------------------
-- Column classification (read by the audit and text-hygiene guards)
-- ---------------------------------------------------------------------------------------------
comment on column public.agent_runs.agent_name    is 'SAFE: slug of an operator-defined agent. CLEAN-EXEMPT: strict anchored slug pattern, and a foreign key to agent_definitions';
comment on column public.agent_runs.agent_version is 'SAFE: version / prompt-set label chosen by our code. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.agent_runs.input_sha256  is 'SAFE: sha256 of the normalised input; the input itself is never stored. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.agent_runs.input_refs    is 'SAFE: typed ids only (app.is_ref_map), never a prompt, a document or a name; hygiene-checked';
comment on column public.agent_run_steps.step_key    is 'SAFE: deterministic key chosen by our runtime. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.agent_run_steps.tool_name   is 'SAFE: slug of an allow-listed tool. CLEAN-EXEMPT: strict anchored slug pattern';
comment on column public.agent_run_steps.args_sha256 is 'SAFE: sha256 of the canonical arguments. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.agent_run_steps.result_ref  is 'SAFE: ids of what the step produced (app.is_ref_map), never content; hygiene-checked';

-- ---------------------------------------------------------------------------------------------
-- RLS: enabled and forced; default deny; policies TO authenticated; pattern-B helpers only. Nobody writes directly.
--   tenant_agent_settings : read = any member
--   claim_reviews         : read = any member
--   agent_runs / steps    : read = Owner / Admin (every run), anyone else (their own runs only)
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tenant_agent_settings', 'agent_runs', 'agent_run_steps', 'claim_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy tenant_agent_settings_select on public.tenant_agent_settings for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create policy claim_reviews_select on public.claim_reviews for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));

create policy agent_runs_select_admin on public.agent_runs for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create policy agent_runs_select_own on public.agent_runs for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]) and started_by = (select auth.uid()));
create policy agent_run_steps_select_admin on public.agent_run_steps for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create policy agent_run_steps_select_own on public.agent_run_steps for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]) and started_by = (select auth.uid()));
