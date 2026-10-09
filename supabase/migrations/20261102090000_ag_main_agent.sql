-- Job AG / G2: the Main agent (the assistant the owner talks to). Database side.
--
-- WHAT IT IS. A chat. The owner asks; the assistant READS the owner's own business (through the caller's own row-level security, never wider) and answers with
-- sources; it may leave DRAFTS (a draft quote through the quote engine, a follow-up draft, a customer-reply draft, a recorded enquiry); it sends nothing, sets
-- no price and approves nothing. Every message is a run of the existing agent runtime: the kill switches, the per-run budgets, the rate limits and the DAILY COST
-- CAP (the Asia/Kolkata day) apply to it exactly as they do to the other agents.
--
--   agent definition 'assistant'        + platform flag 'assistant_enabled' (OFF). All three switches must be on: the platform's agents flag, this flag, and the
--                                         workspace's own switch (public.set_tenant_agents_enabled). app.operator_enable_assistant(slug) turns them on locally.
--   agent_runs.conversation_id          a fourth kind of run target (exactly one of company, lead, enquiry, conversation).
--   assistant_conversations             one per chat, PRIVATE to the person who started it (and their role: Owner, Admin or Sales).
--   assistant_messages                  the chat, in order. Body text only: the sources and the draft cards are stored as TYPE + ID, never as a name, so what is
--                                         shown beside an answer is read fresh (and is erased with the thing it points to).
--   assistant_reply_drafts              a customer-reply DRAFT written by the model in the customer's language, with an English gloss, marked machine text.
--                                         It states no price (a check). Nothing here is ever sent.
--   public.assistant_begin_message      stores the owner's message and STARTS the run in one step (idempotent: the same message id replays; an answered message
--                                         replays its answer without spending anything again).
--   public.assistant_save_reply         stores the assistant's answer for a running run.
--   public.assistant_save_reply_draft   stores a customer-reply draft for a running run.
--   app.agent_switch_on(tenant, agent)  the three switches as one boolean (so the status read can say "switched off" apart from "not available").
--   public.agents_status                replaced: the Main agent is now one of the helpers (its own state and latest event), and every helper reports whether its switch is on.
--
-- Nothing writes these tables from a client: no INSERT, UPDATE or DELETE grant at all. Erasure (ADR 0014) registers the free-text columns.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The agent, its flag, the operator's local switch
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled', 'requirement_enabled', 'assistant_enabled'));
insert into public.platform_flags (key, enabled) values ('assistant_enabled', false);

insert into public.agent_definitions
  (agent_name, allowed_predicates, allowed_evidence_kinds, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros,
   requires_flag, allowed_tenants)
values
  ('assistant', '{}'::text[], '{}'::public.evidence_kind[], 30, 40, 200000, 12000, 1000000, 'assistant_enabled', '{}'::uuid[]);

create function app.operator_enable_assistant(p_tenant_slug text) returns void
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
  update public.platform_flags set enabled = true where key in ('agents_enabled', 'assistant_enabled');
  update public.agent_definitions d
     set allowed_tenants = (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(coalesce(d.allowed_tenants, '{}'::uuid[]) || v_tenant) x)
   where d.agent_name = 'assistant';
  insert into public.tenant_agent_settings (tenant_id, enabled) values (v_tenant, true)
  on conflict (tenant_id) do update set enabled = true, updated_at = now();
end;
$$;
revoke all on function app.operator_enable_assistant(text) from public, anon, authenticated, service_role;

-- the three switches as one answer, for a member of the tenant (the status read is an INVOKER function and cannot read the flags itself)
create function app.agent_switch_on(p_tenant uuid, p_agent text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.is_tenant_member(p_tenant) and app.agent_switches_on(p_tenant, p_agent) $$;
revoke all on function app.agent_switch_on(uuid, text) from public, anon;
grant execute on function app.agent_switch_on(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- A fourth kind of run target: a conversation
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.assistant_conversations (
  id         uuid primary key,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index assistant_conversations_keyset_idx on public.assistant_conversations (tenant_id, created_at, id);
create index assistant_conversations_owner_idx  on public.assistant_conversations (tenant_id, created_by, updated_at);
create trigger assistant_conversations_set_updated_at before update on public.assistant_conversations for each row execute function app.set_updated_at();
create trigger assistant_conversations_forbid_tenant_id_change before update on public.assistant_conversations for each row execute function app.forbid_tenant_id_change();

alter table public.agent_runs add column conversation_id uuid;
alter table public.agent_runs add constraint agent_runs_conversation_fk foreign key (tenant_id, conversation_id) references public.assistant_conversations (tenant_id, id);
alter table public.agent_runs drop constraint agent_runs_one_target;
alter table public.agent_runs add constraint agent_runs_one_target check (num_nonnulls(company_id, lead_id, enquiry_id, conversation_id) = 1);
create index agent_runs_conversation_idx on public.agent_runs (tenant_id, conversation_id) where conversation_id is not null;

create table public.assistant_messages (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  conversation_id uuid not null,
  seq             integer not null check (seq >= 1),
  created_by      uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  body            text not null check (char_length(body) between 1 and 12000 and app.text_is_clean(body)),
  language        text check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  -- [{type, id}] and [{type, id}]: ids only, never a name (the names are read fresh); at most 20 and 10
  sources         jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  drafts          jsonb not null default '[]'::jsonb check (jsonb_typeof(drafts) = 'array' and jsonb_array_length(drafts) <= 10),
  run_id          uuid,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, conversation_id, seq),
  foreign key (tenant_id, conversation_id) references public.assistant_conversations (tenant_id, id),
  foreign key (tenant_id, run_id) references public.agent_runs (tenant_id, id)
);
create index assistant_messages_keyset_idx on public.assistant_messages (tenant_id, created_at, id);
create index assistant_messages_run_idx on public.assistant_messages (tenant_id, run_id);
create trigger assistant_messages_forbid_tenant_id_change before update on public.assistant_messages for each row execute function app.forbid_tenant_id_change();
comment on column public.assistant_messages.body is 'PII: what the owner wrote and what the assistant answered; it can name customers. Erased by the tenant scope and swept for exact identifiers (ADR 0014).';
comment on column public.assistant_messages.sources is 'SAFE: [{type, id}] pairs only (ids, no names). CLEAN-EXEMPT: shape-checked jsonb';
comment on column public.assistant_messages.drafts is 'SAFE: [{type, id}] pairs only (ids, no names). CLEAN-EXEMPT: shape-checked jsonb';
comment on column public.assistant_messages.language is 'SAFE: a closed word (en, te, hi, kn, ta). CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_messages.created_by is 'SAFE: a user id (the person whose chat this is). CLEAN-EXEMPT: uuid';
comment on column public.assistant_messages.role is 'SAFE: a closed word (user, assistant). CLEAN-EXEMPT: closed CHECK list';

-- a customer-reply draft: written by the model, in the customer's language, with an English gloss for the owner; machine text, a draft, never sent
create table public.assistant_reply_drafts (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  conversation_id uuid not null,
  run_id          uuid not null,
  lead_id         uuid,
  enquiry_id      uuid,
  language        text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  body            text not null check (char_length(body) between 2 and 4000 and app.text_is_clean(body)
                                       and body !~* '(₹|\mrs\.?\s*[0-9]|\minr\M|rupee|रुपय|रुपये|రూపాయ|రూ\.?\s*[0-9]|ರೂಪಾಯಿ|ರೂ\.?\s*[0-9]|ரூபாய்|ரூ\.?\s*[0-9]|/-)'),
  gloss_en        text not null check (char_length(gloss_en) between 2 and 4000 and app.text_is_clean(gloss_en)
                                        and gloss_en !~* '(₹|\mrs\.?\s*[0-9]|\minr\M|rupee|/-)'),
  machine_draft   boolean not null default true check (machine_draft),
  status          text not null default 'draft' check (status in ('draft', 'discarded')),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.assistant_conversations (tenant_id, id),
  foreign key (tenant_id, run_id) references public.agent_runs (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, enquiry_id) references public.enquiries (tenant_id, id),
  check (num_nonnulls(lead_id, enquiry_id) >= 1)
);
create index assistant_reply_drafts_keyset_idx on public.assistant_reply_drafts (tenant_id, created_at, id);
create index assistant_reply_drafts_conversation_idx on public.assistant_reply_drafts (tenant_id, conversation_id);
create index assistant_reply_drafts_run_idx on public.assistant_reply_drafts (tenant_id, run_id);
create index assistant_reply_drafts_lead_idx on public.assistant_reply_drafts (tenant_id, lead_id) where lead_id is not null;
create index assistant_reply_drafts_enquiry_idx on public.assistant_reply_drafts (tenant_id, enquiry_id) where enquiry_id is not null;
create trigger assistant_reply_drafts_forbid_tenant_id_change before update on public.assistant_reply_drafts for each row execute function app.forbid_tenant_id_change();
comment on column public.assistant_reply_drafts.body is 'PII: machine-written text addressed to a customer; it can name them. Erased by the tenant scope and swept for exact identifiers (ADR 0014).';
comment on column public.assistant_reply_drafts.gloss_en is 'PII: the English gloss of the draft; same as body.';
comment on column public.assistant_reply_drafts.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_reply_drafts.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- every tenant-owned table is audited (the PII-aware trigger records column NAMES for the columns marked PII, never their text)
create trigger audit_assistant_conversations after insert or update or delete on public.assistant_conversations for each row execute function app.audit_row_change('assistant_conversation');
create trigger audit_assistant_messages after insert or update or delete on public.assistant_messages for each row execute function app.audit_row_change('assistant_message', 'body');
create trigger audit_assistant_reply_drafts after insert or update or delete on public.assistant_reply_drafts for each row execute function app.audit_row_change('assistant_reply_draft', 'body,gloss_en');

-- Row-level security: a person reads only the chats they started (and only while they hold a role that may use the assistant); nobody writes directly.
do $$
declare t text;
begin
  foreach t in array array['assistant_conversations', 'assistant_messages', 'assistant_reply_drafts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy assistant_conversations_select on public.assistant_conversations for select to authenticated
  using (created_by = (select auth.uid())
         and tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy assistant_messages_select on public.assistant_messages for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[])
         and created_by = (select auth.uid()));
create policy assistant_reply_drafts_select on public.assistant_reply_drafts for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[])
         and created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Erasure (ADR 0014): the free-text columns, in the tenant scope and in the sweep (an exact e-mail or phone found inside is replaced)
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('assistant_messages',      'body',     'tenant', 'tombstone', 'erased:1'),
  ('assistant_reply_drafts',  'body',     'tenant', 'tombstone', 'erased:1'),
  ('assistant_reply_drafts',  'gloss_en', 'tenant', 'tombstone', 'erased:1'),
  ('assistant_messages',      'body',     'sweep',  'substring', 'erased:1'),
  ('assistant_reply_drafts',  'body',     'sweep',  'substring', 'erased:1'),
  ('assistant_reply_drafts',  'gloss_en', 'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Begin a message: store the owner's words and start the run, in one step
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_begin_message(
  p_run_id uuid, p_tenant_id uuid, p_conversation_id uuid, p_message_id uuid, p_text text, p_language text, p_input_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_text  text := btrim(coalesce(p_text, ''));
  c       public.assistant_conversations;
  m       public.assistant_messages;
  rp      public.assistant_messages;
  d       public.agent_definitions;
  e       public.agent_runs;
  v_seq   integer;
  v_ttl   integer;
  v_exp   timestamptz;
  v_token bigint;
begin
  if v_uid is null or p_tenant_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  if p_run_id is null or p_conversation_id is null or p_message_id is null or p_input_sha256 is null
     or char_length(v_text) not between 1 and 4000 or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta')) then
    perform app.agent_state_error('invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assistant:' || p_conversation_id::text, 0));

  -- the conversation: made now, or the caller's own (anyone else's, or another business's, is the same generic refusal as an unknown one)
  select * into c from public.assistant_conversations x where x.id = p_conversation_id;
  if found and (c.tenant_id <> p_tenant_id or c.created_by <> v_uid) then
    perform app.agent_deny();
  end if;

  -- a retry of a message already stored: the same words replay (with the answer, if it was given); other words under the same id conflict
  select * into m from public.assistant_messages x where x.id = p_message_id;
  if found then
    if m.tenant_id <> p_tenant_id or m.conversation_id <> p_conversation_id or m.role <> 'user' or m.body <> v_text then
      raise exception 'message id already used' using errcode = '23505', constraint = 'assistant_messages_pkey', table = 'assistant_messages', schema = 'public';
    end if;
    select * into rp from public.assistant_messages x where x.tenant_id = m.tenant_id and x.conversation_id = m.conversation_id and x.seq = m.seq + 1 and x.role = 'assistant';
    return jsonb_build_object('replayed', true, 'conversation_id', m.conversation_id, 'message_id', m.id, 'run_id', m.run_id,
                              'reply_message_id', rp.id);
  end if;

  -- a NEW message: only now may the answers say why it cannot start
  select * into d from public.agent_definitions a where a.agent_name = 'assistant';
  if not found then
    perform app.agent_state_error('reference');
  end if;
  perform app.agent_assert_enabled(p_tenant_id, 'assistant'); -- SM204: a switch is off

  if (select count(*) from public.assistant_messages x where x.tenant_id = p_tenant_id and x.conversation_id = p_conversation_id) >= 200 then
    perform app.agent_state_error('invalid'); -- a chat has at most 200 messages: start a new one
  end if;

  -- the same limits as any run: concurrent runs, runs per hour (serialised per business), the early refusal at the day's cost cap
  perform pg_advisory_xact_lock(hashtextextended('agent_start:' || p_tenant_id::text, 0));
  if (select count(*) from public.agent_runs a
       where a.tenant_id = p_tenant_id and a.status = 'running' and a.expires_at > now() and a.cancel_requested_at is null)
       >= app.agent_limit('max_concurrent_runs', 0)
     or (select count(*) from public.agent_runs a where a.tenant_id = p_tenant_id and a.created_at > now() - interval '1 hour')
       >= app.agent_limit('max_runs_per_hour', 0) then
    perform app.agent_state_error('SM206');
  end if;
  if app.agent_day_spend(p_tenant_id, app.agent_utc_today()) >= app.agent_daily_cap(p_tenant_id) then
    perform app.agent_state_error('SM207');
  end if;

  v_ttl := least(greatest(app.agent_limit('ttl_default_seconds', 900), 30), app.agent_limit('ttl_max_seconds', 1800));
  v_exp := now() + make_interval(secs => v_ttl);
  v_token := nullif(auth.jwt() ->> 'exp', '')::bigint;
  if v_token is not null then
    v_exp := least(v_exp, to_timestamp(v_token));
  end if;
  if v_exp <= now() + interval '5 seconds' then
    perform app.agent_state_error('SM202');
  end if;

  if c.id is null then
    insert into public.assistant_conversations (id, tenant_id, created_by) values (p_conversation_id, p_tenant_id, v_uid) returning * into c;
  end if;
  begin
    insert into public.agent_runs
      (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at,
       max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros, input_sha256, input_refs)
    values
      (p_run_id, p_tenant_id, v_uid, 'assistant', 'assistant-1', p_conversation_id, v_exp,
       d.max_writes, d.max_tool_calls, d.max_input_tokens, d.max_output_tokens, d.max_cost_micros, p_input_sha256, '{}'::jsonb)
    returning * into e;
  exception when unique_violation then
    raise exception 'agent run id already used' using errcode = '23505', constraint = 'agent_runs_pkey', table = 'agent_runs', schema = 'public';
  end;

  select coalesce(max(x.seq), 0) + 1 into v_seq from public.assistant_messages x where x.tenant_id = p_tenant_id and x.conversation_id = p_conversation_id;
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, run_id, created_by)
  values (p_message_id, p_tenant_id, p_conversation_id, v_seq, 'user', v_text, p_language, e.id, v_uid);
  update public.assistant_conversations set updated_at = now() where id = c.id;

  return jsonb_build_object('replayed', false, 'conversation_id', c.id, 'message_id', p_message_id, 'run_id', e.id, 'seq', v_seq,
                            'expires_at', e.expires_at, 'reply_message_id', null);
end;
$$;
revoke all on function public.assistant_begin_message(uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.assistant_begin_message(uuid, uuid, uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Save the answer of a running run (the run's own checks: the starter, still running, the switches, not expired)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.assistant_pairs_ok(p jsonb, p_types text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) x
     where jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x)) <> 2
        or (x ->> 'type') is null or not ((x ->> 'type') = any (p_types))
        or (x ->> 'id') is null or (x ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
$$;
revoke all on function app.assistant_pairs_ok(jsonb, text[]) from public;

create function public.assistant_save_reply(
  p_run_id uuid, p_message_id uuid, p_body text, p_language text, p_sources jsonb, p_drafts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.agent_runs;
  m      public.assistant_messages;
  v_seq  integer;
  v_body text := btrim(coalesce(p_body, ''));
begin
  r := app.agent_open_run(p_run_id);
  if r.conversation_id is null or p_message_id is null or char_length(v_body) not between 1 and 12000
     or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta'))
     or not app.assistant_pairs_ok(coalesce(p_sources, '[]'::jsonb), array['quote', 'lead', 'enquiry', 'order', 'company', 'customer', 'price_item', 'followup_draft', 'reply_draft'])
     or not app.assistant_pairs_ok(coalesce(p_drafts, '[]'::jsonb), array['quote', 'followup_draft', 'reply_draft', 'enquiry']) then
    perform app.agent_state_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant:' || r.conversation_id::text, 0));
  select * into m from public.assistant_messages x where x.id = p_message_id;
  if found then
    if m.tenant_id <> r.tenant_id or m.run_id is distinct from r.id or m.role <> 'assistant' then
      raise exception 'message id already used' using errcode = '23505', constraint = 'assistant_messages_pkey', table = 'assistant_messages', schema = 'public';
    end if;
    return jsonb_build_object('replayed', true, 'message_id', m.id, 'seq', m.seq);
  end if;
  select coalesce(max(x.seq), 0) + 1 into v_seq from public.assistant_messages x where x.tenant_id = r.tenant_id and x.conversation_id = r.conversation_id;
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, sources, drafts, run_id, created_by)
  values (p_message_id, r.tenant_id, r.conversation_id, v_seq, 'assistant', v_body, p_language, coalesce(p_sources, '[]'::jsonb), coalesce(p_drafts, '[]'::jsonb), r.id, r.started_by);
  update public.assistant_conversations set updated_at = now() where tenant_id = r.tenant_id and id = r.conversation_id;
  return jsonb_build_object('replayed', false, 'message_id', p_message_id, 'seq', v_seq);
end;
$$;
revoke all on function public.assistant_save_reply(uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.assistant_save_reply(uuid, uuid, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Save a customer-reply draft of a running run: machine text in the customer's language with an English gloss; no price (a check)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_save_reply_draft(
  p_run_id uuid, p_draft_id uuid, p_lead_id uuid, p_enquiry_id uuid, p_language text, p_body text, p_gloss_en text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
  d public.assistant_reply_drafts;
  v_lead uuid := p_lead_id;
begin
  r := app.agent_open_run(p_run_id);
  if r.conversation_id is null or p_draft_id is null or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta')
     or (p_lead_id is null and p_enquiry_id is null) or p_body is null or p_gloss_en is null then
    perform app.agent_state_error('invalid');
  end if;
  -- the lead or enquiry must be this business's own
  if p_enquiry_id is not null then
    select e.lead_id into v_lead from public.enquiries e where e.tenant_id = r.tenant_id and e.id = p_enquiry_id and e.archived_at is null;
    if not found or (p_lead_id is not null and p_lead_id is distinct from v_lead) then
      perform app.agent_state_error('reference');
    end if;
  elsif not exists (select 1 from public.leads l where l.tenant_id = r.tenant_id and l.id = p_lead_id and l.archived_at is null) then
    perform app.agent_state_error('reference');
  end if;
  select * into d from public.assistant_reply_drafts x where x.id = p_draft_id;
  if found then
    if d.tenant_id <> r.tenant_id or d.run_id <> r.id or d.body <> btrim(p_body) or d.language <> p_language then
      raise exception 'draft id already used' using errcode = '23505', constraint = 'assistant_reply_drafts_pkey', table = 'assistant_reply_drafts', schema = 'public';
    end if;
    return jsonb_build_object('replayed', true, 'draft_id', d.id);
  end if;
  begin
    insert into public.assistant_reply_drafts (id, tenant_id, conversation_id, run_id, lead_id, enquiry_id, language, body, gloss_en, created_by)
    values (p_draft_id, r.tenant_id, r.conversation_id, r.id, v_lead, p_enquiry_id, p_language, btrim(p_body), btrim(p_gloss_en), r.started_by);
  exception when check_violation then
    perform app.agent_state_error('value'); -- a price in the text, control characters, or a length
  end;
  return jsonb_build_object('replayed', false, 'draft_id', p_draft_id);
end;
$$;
revoke all on function public.assistant_save_reply_draft(uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.assistant_save_reply_draft(uuid, uuid, uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- agents_status, replaced: the Main agent is a helper now, and each helper says whether its switch is on (all three layers)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.agents_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_switch   boolean;
  v_main     jsonb;
  v_research jsonb;
  v_require  jsonb;
  v_quote    jsonb;
  v_followup jsonb;
  v_order    jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not (select app.is_tenant_member(p_tenant_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_switch := coalesce((select s.enabled from public.tenant_agent_settings s where s.tenant_id = p_tenant_id), false);

  -- a run is "working" while it is running and its time has not run out; the last event is the newest run that ended (else the one that started)
  select jsonb_build_object(
           'switched_on', app.agent_switch_on(p_tenant_id, a.name),
           'running', exists (select 1 from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name and r.status = 'running' and r.expires_at > now()),
           'last_status', (select r.status from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1),
           'last_at', (select coalesce(r.finished_at, r.created_at) from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1))
    into v_main from (select 'assistant'::text as name) a;
  select jsonb_build_object(
           'switched_on', app.agent_switch_on(p_tenant_id, a.name),
           'running', exists (select 1 from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name and r.status = 'running' and r.expires_at > now()),
           'last_status', (select r.status from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1),
           'last_at', (select coalesce(r.finished_at, r.created_at) from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1))
    into v_research from (select 'research'::text as name) a;
  select jsonb_build_object(
           'switched_on', app.agent_switch_on(p_tenant_id, a.name),
           'running', exists (select 1 from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name and r.status = 'running' and r.expires_at > now()),
           'last_status', (select r.status from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1),
           'last_at', (select coalesce(r.finished_at, r.created_at) from public.agent_runs r where r.tenant_id = p_tenant_id and r.agent_name = a.name order by coalesce(r.finished_at, r.created_at) desc, r.id desc limit 1))
    into v_require from (select 'requirement'::text as name) a;

  select jsonb_build_object('last_no', q.quote_no, 'last_at', q.created_at)
    into v_quote from public.quotes q where q.tenant_id = p_tenant_id order by q.created_at desc, q.id desc limit 1;
  select jsonb_build_object('last_touch', d.touch_number, 'last_at', d.created_at)
    into v_followup from public.followup_drafts d where d.tenant_id = p_tenant_id order by d.created_at desc, d.id desc limit 1;
  select jsonb_build_object('last_type', e.type, 'last_at', e.recorded_at)
    into v_order from public.order_events e where e.tenant_id = p_tenant_id order by e.recorded_at desc, e.id desc limit 1;

  return jsonb_build_object(
    'agents_enabled', v_switch,
    'main', v_main,
    'researcher', v_research,
    'requirement_analyst', v_require,
    'quote_writer', coalesce(v_quote, '{}'::jsonb),
    'followup_desk', coalesce(v_followup, '{}'::jsonb),
    'order_desk', coalesce(v_order, '{}'::jsonb));
end;
$$;
