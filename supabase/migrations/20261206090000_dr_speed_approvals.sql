-- Job DR part A3 (night run 27 Oct 2026): SPEED TO LEAD AND "APPROVE ONCE". The owner decided: approve once, not per contact (decision-auto-send-policy.md).
--
--   public.outreach_policy          one per workspace: the morning call for a lead that came after hours, how many attempts over how long, WhatsApp after the last unanswered call, the hand-off reminder, the call price estimate
--   public.outreach_batches         ONE plan for a whole list (who: count and sample, goal, channel, questions, window, estimated minutes and cost, caps); the Owner approves ALL with the second factor, bound to a hash of the plan
--   public.outreach_items           one row per person in a batch or per lead of a standing rule: the next step and when (call | whatsapp), the attempts so far, the reason it was skipped or stopped
--   public.outreach_attempts        every call or WhatsApp step that was made (the dialer is FAKE: no telephony exists), with its result and minutes
--   public.outreach_rules           a standing rule per lead source ("new leads from meta_lead_ads: call within 2 minutes in calling hours"), approved once by the Owner, pausable; it applies to leads that arrive AFTER the approval
--   public.outreach_handoffs        a hot lead assigned to a staff member with a one-line summary (sent on WhatsApp: fake), reminded once if nobody acted
--   public.outcome_details          the generic pack's captured fields and the call-back time, kept beside an outcome
--   public.lead_source_costs        optional cost per lead per source, for the cost-per-booking report
--   outcomes: a new category `already_bought` (negative)
--
-- THE RULES (in code, never a model): calling hours are the workspace's (call settings override the AI assistant's); a lead after hours gets WhatsApp now (if allowed) and the call next morning at the policy's time (09:30);
-- no answer, busy or voicemail: retry after the gap inside hours up to the attempts, then WhatsApp, then stop; a no, a STOP or a wrong number stops for good; only the workspace's own contacts, never a stranger;
-- a contact without consent for the channel, suppressed, erased or without a number is SKIPPED and counted. Caps on every batch and rule (calls a day, total minutes): when hit, the batch or rule PAUSES and a Needs-you item
-- appears. A running batch or rule spends nothing in a read-only workspace or beyond the plan's minutes. WhatsApp steps go through the outbox as ordinary messages (every per-message rule applies: STOP, quiet hours, daily limit,
-- kill switches); calls are recorded by the registered worker's fake dialer for now.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM306 second factor needed, SM811 not in a state that allows this, SM812 the plan changed since it was shown.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. outcomes: a new category and the details beside an outcome
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.outcomes'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%too_costly%' loop
    v_new := replace(r.def, '''too_costly''::text', '''too_costly''::text, ''already_bought''::text');
    execute format('alter table public.outcomes drop constraint %I', r.conname);
    execute format('alter table public.outcomes add constraint %I %s', r.conname, v_new);
  end loop;
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('outcome_record', 'outcome_correct') loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '''wrong_number'', ''too_costly''', '''wrong_number'', ''too_costly'', ''already_bought''');
    if v_new = v_def then
      raise exception 'dr_speed: % has no category list to extend', r.proname;
    end if;
    execute v_new;
  end loop;
  v_def := pg_get_functiondef('public.outcomes_totals(uuid, date, date)'::regprocedure);
  v_new := regexp_replace(v_def, '(''too_costly'',\s*\(select count\(\*\) from c where c\.day = d\.day and c\.category = ''too_costly''\),)',
                          E'\\1\n             ''already_bought'', (select count(*) from c where c.day = d.day and c.category = ''already_bought''),');
  if v_new = v_def then
    raise exception 'dr_speed: the totals function is not the one this migration expects';
  end if;
  execute v_new;
end;
$$;

create table public.outcome_details (
  id          uuid primary key default gen_random_uuid(),
  outcome_id  uuid not null unique,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  callback_at timestamptz,
  captured    jsonb check (captured is null or (jsonb_typeof(captured) = 'object' and octet_length(captured::text) <= 3000)),
  unique (tenant_id, outcome_id),
  foreign key (tenant_id, outcome_id) references public.outcomes (tenant_id, id)
);
comment on table public.outcome_details is 'Job DR A3: the pack''s captured fields (budget, area, ...) and the call-back time of an outcome. Written only by the outreach functions.';
comment on column public.outcome_details.captured is 'PII: what the customer said on the call (budget, area, preferred time): short fields, checked by app.outreach_captured_ok. Erased with the workspace. CLEAN-EXEMPT: written only by the outreach functions, never by a client';
comment on column public.outcome_details.callback_at is 'SAFE: a time. CLEAN-EXEMPT: timestamp';
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values ('outcome_details', 'captured', 'tenant', 'null', 'erased:1');

create function app.outreach_captured_ok(p jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (jsonb_typeof(p) = 'object' and (select count(*) from jsonb_object_keys(p)) <= 12
     and not exists (select 1 from jsonb_each(p) e where e.key !~ '^[a-z][a-z0-9_]{0,31}$' or jsonb_typeof(e.value) not in ('string', 'number', 'boolean')
                      or (jsonb_typeof(e.value) = 'string' and (char_length(e.value #>> '{}') not between 1 and 200 or not app.text_is_clean(e.value #>> '{}')))))
$$;
revoke all on function app.outreach_captured_ok(jsonb) from public;

-- the outcome as the screens read it now carries the call-back time and the captured fields
create or replace function app.outcome_json(o public.outcomes) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'contact_id', o.contact_id, 'lead_id', o.lead_id, 'kind', o.kind, 'source_id', o.source_id,
    'outcome', o.outcome, 'category', o.category, 'reason', o.reason,
    'recorded_by', o.recorded_by_kind, 'corrected', o.corrected_at is not null, 'corrected_at', o.corrected_at,
    'ai_outcome', o.ai_outcome, 'ai_category', o.ai_category,
    'occurred_at', o.occurred_at, 'recorded_at', o.recorded_at,
    'callback_at', (select d.callback_at from public.outcome_details d where d.tenant_id = o.tenant_id and d.outcome_id = o.id),
    'captured', coalesce((select d.captured from public.outcome_details d where d.tenant_id = o.tenant_id and d.outcome_id = o.id), '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.outreach_policy (
  tenant_id                uuid primary key references public.tenants (id) on delete restrict,
  night_call_minute        smallint not null default 570 check (night_call_minute between 540 and 720 and night_call_minute % 15 = 0),
  max_attempts             smallint not null default 3 check (max_attempts between 1 and 6),
  retry_gap_hours          smallint not null default 18 check (retry_gap_hours between 1 and 48),
  then_whatsapp            boolean not null default true,
  whatsapp_after_hours     boolean not null default true,
  handoff_reminder_minutes smallint not null default 15 check (handoff_reminder_minutes between 5 and 120),
  call_paise_per_minute    integer not null default 400 check (call_paise_per_minute between 0 and 5000),
  updated_by               uuid not null,
  updated_at               timestamptz not null default app.outbox_now()
);
comment on table public.outreach_policy is 'Job DR A3: the calling policy of a workspace. Written only by outreach_policy_set (Owner, second factor).';

create table public.outreach_batches (
  id                 uuid primary key,
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  name               text not null check (char_length(name) between 1 and 80 and app.text_is_clean(name)),
  goal               text not null check (goal in ('site_visit', 'counselling', 'appointment', 'qualify', 'test_drive', 'site_measurement', 'quote', 'trial', 'callback', 'general')),
  channel            text not null check (channel in ('call', 'whatsapp', 'both')),
  language           text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  questions          jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 8),
  message_text       text check (message_text is null or (char_length(message_text) between 2 and 600 and app.text_is_clean(message_text))),
  window_days        smallint not null default 7 check (window_days between 1 and 14),
  max_calls_per_day  integer check (max_calls_per_day is null or max_calls_per_day between 1 and 5000),
  max_total_minutes  integer check (max_total_minutes is null or max_total_minutes between 1 and 100000),
  status             text not null default 'planned' check (status in ('planned', 'running', 'paused', 'done', 'cancelled')),
  paused_reason      text check (paused_reason in ('owner', 'cap_calls', 'cap_minutes', 'billing')),
  paused_at          timestamptz,
  plan_sha256        text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  plan               jsonb not null default '{}'::jsonb,
  created_by         uuid not null,
  created_at         timestamptz not null default app.outbox_now(),
  approved_by        uuid,
  approved_at        timestamptz,
  finished_at        timestamptz,
  unique (tenant_id, id),
  check ((status = 'planned') = (approved_at is null)),
  check ((status = 'paused') = (paused_reason is not null))
);
comment on table public.outreach_batches is 'Job DR A3: one plan for a whole list. Approved ONCE by the Owner (second factor), bound to plan_sha256. Written only by the outreach functions.';
comment on column public.outreach_batches.name is 'SAFE: the owner''s own label of the list (guarded by app.text_is_clean in the CHECK)';
comment on column public.outreach_batches.questions is 'SAFE: the owner''s questions for the call (short texts about the business, no customer data). CLEAN-EXEMPT: checked by the outreach functions';
comment on column public.outreach_batches.message_text is 'SAFE: the WhatsApp text the owner approved (guarded by app.text_is_clean in the CHECK)';
comment on column public.outreach_batches.plan is 'SAFE: counts, three MASKED sample names (first letters only) and cities, estimates; nothing that identifies a person. CLEAN-EXEMPT: written only by the outreach functions, never by a client';

create table public.outreach_rules (
  id                uuid primary key,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  source            text not null check (char_length(source) between 1 and 64 and source ~ '^[a-z0-9_.-]+$'),
  action            text not null check (action in ('call_within_minutes', 'whatsapp_first', 'whatsapp_then_call')),
  within_minutes    smallint not null default 2 check (within_minutes between 1 and 120),
  goal              text not null check (goal in ('site_visit', 'counselling', 'appointment', 'qualify', 'test_drive', 'site_measurement', 'quote', 'trial', 'callback', 'general')),
  channel           text not null check (channel in ('call', 'whatsapp', 'both')),
  language          text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  questions         jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 8),
  message_text      text check (message_text is null or (char_length(message_text) between 2 and 600 and app.text_is_clean(message_text))),
  max_calls_per_day integer check (max_calls_per_day is null or max_calls_per_day between 1 and 5000),
  max_total_minutes integer check (max_total_minutes is null or max_total_minutes between 1 and 100000),
  active            boolean not null default true,
  paused_reason     text check (paused_reason in ('owner', 'cap_calls', 'cap_minutes', 'billing')),
  paused_at         timestamptz,
  approved_by       uuid not null,
  approved_at       timestamptz not null default app.outbox_now(),
  last_scan_at      timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  check (active = (paused_reason is null))
);
create unique index outreach_rules_one_active_per_source on public.outreach_rules (tenant_id, source) where active;
comment on table public.outreach_rules is 'Job DR A3: a standing rule per lead source, approved once by the Owner (second factor); it applies to leads that arrive after the approval. Written only by the outreach functions.';
comment on column public.outreach_rules.source is 'SAFE: the lead source tag (indiamart, meta_lead_ads, ...). CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.outreach_rules.questions is 'SAFE: the owner''s questions for the call. CLEAN-EXEMPT: checked by the outreach functions';
comment on column public.outreach_rules.message_text is 'SAFE: the WhatsApp text the owner approved (guarded by app.text_is_clean in the CHECK)';

create table public.outreach_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  batch_id       uuid,
  rule_id        uuid,
  contact_id     uuid not null,
  lead_id        uuid,
  status         text not null check (status in ('planned', 'waiting', 'done', 'stopped', 'skipped')),
  reason         text check (reason in ('no_phone', 'no_consent', 'stopped', 'duplicate', 'erased', 'excluded', 'refused', 'wrong_number', 'already_bought', 'interested', 'attempts_used', 'no_channel', 'cancelled', 'billing')),
  next_action    text check (next_action in ('call', 'whatsapp')),
  next_at        timestamptz,
  then_action    text check (then_action in ('call', 'whatsapp')),
  then_at        timestamptz,
  attempts       smallint not null default 0,
  callbacks      smallint not null default 0,
  arrival_at     timestamptz not null default app.outbox_now(),
  first_touch_at timestamptz,
  last_result    text,
  created_at     timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  foreign key (tenant_id, batch_id) references public.outreach_batches (tenant_id, id),
  foreign key (tenant_id, rule_id) references public.outreach_rules (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check ((batch_id is null) <> (rule_id is null)),
  check ((status = 'waiting') = (next_action is not null and next_at is not null))
);
create unique index outreach_items_batch_contact on public.outreach_items (batch_id, contact_id) where batch_id is not null;
create unique index outreach_items_rule_lead on public.outreach_items (rule_id, lead_id) where rule_id is not null;
create index outreach_items_due on public.outreach_items (next_at) where status = 'waiting';
create index outreach_items_batch_idx on public.outreach_items (tenant_id, batch_id, created_at, id);
create index outreach_items_rule_idx on public.outreach_items (tenant_id, rule_id);
create index outreach_items_contact_idx on public.outreach_items (tenant_id, contact_id);
comment on table public.outreach_items is 'Job DR A3: one person of a batch, or one lead of a rule: what comes next and when. Written only by the outreach functions.';
comment on column public.outreach_items.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outreach_items.last_result is 'SAFE: a closed word set by the outreach functions. CLEAN-EXEMPT: closed set';

create table public.outreach_attempts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  item_id    uuid not null,
  n          smallint not null,
  channel    text not null check (channel in ('call', 'whatsapp')),
  at         timestamptz not null default app.outbox_now(),
  result     text not null check (result in ('no_answer', 'busy', 'voicemail', 'connected', 'sent', 'failed', 'blocked')),
  minutes    numeric(6, 2) not null default 0 check (minutes between 0 and 120),
  message_id uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references public.outreach_items (tenant_id, id)
);
create index outreach_attempts_item_idx on public.outreach_attempts (tenant_id, item_id, at);
create index outreach_attempts_day_idx on public.outreach_attempts (tenant_id, at);
comment on column public.outreach_attempts.channel is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outreach_attempts.result is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.outreach_handoffs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  lead_id          uuid,
  contact_id       uuid not null,
  outcome_id       uuid,
  assigned_to      uuid not null,
  summary          text not null check (char_length(summary) between 2 and 300),
  notified_at      timestamptz not null default app.outbox_now(),
  reminder_sent_at timestamptz,
  acted_at         timestamptz,
  acted_by         uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
create index outreach_handoffs_open on public.outreach_handoffs (tenant_id, notified_at) where acted_at is null;
create index outreach_handoffs_contact_idx on public.outreach_handoffs (tenant_id, contact_id);
comment on column public.outreach_handoffs.summary is 'PII: one line about the customer (name, interest, what they said). Erased with the workspace. CLEAN-EXEMPT: written only by the outreach functions, never by a client';
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('outreach_handoffs', 'summary', 'tenant', 'tombstone', 'erased:1'),
  ('outreach_handoffs', 'summary', 'sweep',  'substring', 'erased:1');

create table if not exists public.lead_source_costs (
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  source              text not null check (char_length(source) between 1 and 64 and source ~ '^[a-z0-9_.-]+$' and app.text_is_clean(source)),
  cost_per_lead_paise bigint not null check (cost_per_lead_paise between 0 and 10000000),
  updated_by          uuid not null,
  created_at          timestamptz not null default app.outbox_now(),
  updated_at          timestamptz not null default app.outbox_now(),
  primary key (tenant_id, source)
);
comment on column public.lead_source_costs.source is 'SAFE: a lead source tag (leads.source), guarded by app.text_is_clean in the CHECK';

do $$
declare
  t text;
begin
  foreach t in array array['outreach_policy', 'outreach_batches', 'outreach_rules', 'outreach_items', 'outreach_attempts', 'outreach_handoffs', 'outcome_details', 'lead_source_costs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]))$p$, t || '_select', t);
  end loop;
  foreach t in array array['outreach_policy', 'outreach_batches', 'outreach_rules', 'outreach_items', 'outreach_attempts', 'outreach_handoffs', 'outcome_details', 'lead_source_costs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_forbid_tenant_id_change', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
-- the one who must call a hot lead back sees that hand-off (Today reads it as the caller); every other table is for the Owner and Admin
drop policy if exists outreach_handoffs_select on public.outreach_handoffs;
create policy outreach_handoffs_select on public.outreach_handoffs for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[])
         or (assigned_to = (select auth.uid()) and tenant_id = any (((select app.my_tenant_ids_with_role(array['sales']::public.app_role[])))::uuid[])));
create trigger audit_outreach_policy after insert or update or delete on public.outreach_policy for each row execute function app.audit_row_change('outreach_policy', '');
create trigger audit_outreach_batches after insert or update or delete on public.outreach_batches for each row execute function app.audit_row_change('outreach_batch', '');
create trigger audit_outreach_rules after insert or update or delete on public.outreach_rules for each row execute function app.audit_row_change('outreach_rule', '');
create trigger audit_outreach_items after insert or update or delete on public.outreach_items for each row execute function app.audit_row_change('outreach_item', '');
create trigger audit_outreach_attempts after insert or update or delete on public.outreach_attempts for each row execute function app.audit_row_change('outreach_attempt', '');
create trigger audit_outreach_handoffs after insert or update or delete on public.outreach_handoffs for each row execute function app.audit_row_change('outreach_handoff', 'summary');
create trigger audit_outcome_details after insert or update or delete on public.outcome_details for each row execute function app.audit_row_change('outcome_detail', 'captured');
drop trigger if exists audit_lead_source_costs on public.lead_source_costs;
create trigger audit_lead_source_costs after insert or update or delete on public.lead_source_costs for each row execute function app.audit_row_change('lead_source_cost', '');

-- the closed words and ids of these tables: classified for the catalogue guards (a CHECK list or the outreach functions decide them; no client can write any of these tables)
do $$
declare
  c record;
begin
  for c in select * from (values
    ('outreach_batches', 'goal'), ('outreach_batches', 'channel'), ('outreach_batches', 'language'), ('outreach_batches', 'paused_reason'), ('outreach_batches', 'plan_sha256'), ('outreach_batches', 'status'),
    ('outreach_rules', 'action'), ('outreach_rules', 'goal'), ('outreach_rules', 'channel'), ('outreach_rules', 'language'), ('outreach_rules', 'paused_reason'),
    ('outreach_items', 'next_action'), ('outreach_items', 'status'), ('outreach_items', 'then_action')) as v(t, col) loop
    execute format('comment on column public.%I.%I is %L', c.t, c.col, 'SAFE: a closed word, a hash or a source tag chosen by the outreach functions. CLEAN-EXEMPT: closed CHECK list or strict pattern, never client-written');
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. errors, the policy, the calling hours
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outreach_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'state'     then raise exception 'not in a state that allows this' using errcode = 'SM811';
    when 'changed'   then raise exception 'the plan changed since it was shown' using errcode = 'SM812';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.outreach_error(text) from public;

-- the policy in force (the defaults when nothing is saved)
create function app.outreach_pol(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'night_call_minute', coalesce(p.night_call_minute, 570), 'max_attempts', coalesce(p.max_attempts, 3), 'retry_gap_hours', coalesce(p.retry_gap_hours, 18),
    'then_whatsapp', coalesce(p.then_whatsapp, true), 'whatsapp_after_hours', coalesce(p.whatsapp_after_hours, true),
    'handoff_reminder_minutes', coalesce(p.handoff_reminder_minutes, 15), 'call_paise_per_minute', coalesce(p.call_paise_per_minute, 400))
  from (select 1) x left join public.outreach_policy p on p.tenant_id = p_tenant
$$;
revoke all on function app.outreach_pol(uuid) from public;

-- the calling hours in force: the call settings' own hours if set, else the AI assistant's, else Monday to Saturday 09:00 to 19:00; plus the holidays of the call settings
create function app.outreach_hours(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           (select s.settings -> 'hours' || jsonb_build_object('from', 'call_settings') from public.call_settings s
             where s.tenant_id = p_tenant and s.campaign_id is null and jsonb_typeof(s.settings -> 'hours') = 'object'),
           (select jsonb_build_object('days', to_jsonb(a.call_days), 'from_minute', a.call_from_minute, 'to_minute', a.call_to_minute, 'from', 'assistant') from public.assistant_settings a where a.tenant_id = p_tenant),
           jsonb_build_object('days', '[1,2,3,4,5,6]'::jsonb, 'from_minute', 540, 'to_minute', 1140, 'from', 'default'))
         || jsonb_build_object('holidays', coalesce((select s.settings -> 'holidays' from public.call_settings s where s.tenant_id = p_tenant and s.campaign_id is null), '[]'::jsonb))
$$;
revoke all on function app.outreach_hours(uuid) from public, anon, authenticated, service_role;

create function app.outreach_in_hours(p_tenant uuid, p_at timestamptz) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb := app.outreach_hours(p_tenant);
  l timestamp := p_at at time zone 'Asia/Kolkata';
  m integer := extract(hour from l)::integer * 60 + extract(minute from l)::integer;
begin
  return (h -> 'days') @> to_jsonb(extract(isodow from l)::integer)
     and not (h -> 'holidays') @> to_jsonb(to_char(l, 'YYYY-MM-DD'))
     and m >= (h ->> 'from_minute')::integer and m < (h ->> 'to_minute')::integer;
end;
$$;
revoke all on function app.outreach_in_hours(uuid, timestamptz) from public;

-- the first moment at or after p_from that is inside the calling hours (a holiday or a closed day is skipped)
create function app.outreach_slot(p_tenant uuid, p_from timestamptz) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb := app.outreach_hours(p_tenant);
  l timestamp := p_from at time zone 'Asia/Kolkata';
  d timestamp;
  v_start timestamp;
  v_end timestamp;
  v_cand timestamp;
  i integer;
begin
  for i in 0..30 loop
    d := date_trunc('day', l) + make_interval(days => i);
    if (h -> 'days') @> to_jsonb(extract(isodow from d)::integer) and not (h -> 'holidays') @> to_jsonb(to_char(d, 'YYYY-MM-DD')) then
      v_start := d + make_interval(mins => (h ->> 'from_minute')::integer);
      v_end := d + make_interval(mins => (h ->> 'to_minute')::integer);
      v_cand := case when i = 0 then greatest(v_start, l) else v_start end;
      if v_cand < v_end then
        return v_cand at time zone 'Asia/Kolkata';
      end if;
    end if;
  end loop;
  return p_from + interval '1 day';
end;
$$;
revoke all on function app.outreach_slot(uuid, timestamptz) from public;

-- the next occurrence of a time of day (minutes after midnight, India time) at or after p_from
create function app.outreach_next_clock(p_from timestamptz, p_minute integer) returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when (p_from at time zone 'Asia/Kolkata') <= date_trunc('day', p_from at time zone 'Asia/Kolkata') + make_interval(mins => p_minute)
              then (date_trunc('day', p_from at time zone 'Asia/Kolkata') + make_interval(mins => p_minute)) at time zone 'Asia/Kolkata'
              else (date_trunc('day', p_from at time zone 'Asia/Kolkata') + interval '1 day' + make_interval(mins => p_minute)) at time zone 'Asia/Kolkata' end
$$;
revoke all on function app.outreach_next_clock(timestamptz, integer) from public;

create function public.outreach_policy_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  return app.outreach_pol(p_tenant_id) || jsonb_build_object('hours', app.outreach_hours(p_tenant_id) - 'holidays', 'saved', exists (select 1 from public.outreach_policy x where x.tenant_id = p_tenant_id));
end;
$$;
revoke all on function public.outreach_policy_get(uuid) from public, anon;
grant execute on function public.outreach_policy_get(uuid) to authenticated;

create function public.outreach_policy_set(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  perform app.require_aal2();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform app.outreach_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if k not in ('night_call_minute', 'max_attempts', 'retry_gap_hours', 'then_whatsapp', 'whatsapp_after_hours', 'handoff_reminder_minutes', 'call_paise_per_minute') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  insert into public.outreach_policy as p (tenant_id, night_call_minute, max_attempts, retry_gap_hours, then_whatsapp, whatsapp_after_hours, handoff_reminder_minutes, call_paise_per_minute, updated_by)
  select p_tenant_id, (d ->> 'night_call_minute')::smallint, (d ->> 'max_attempts')::smallint, (d ->> 'retry_gap_hours')::smallint, (d ->> 'then_whatsapp')::boolean,
         (d ->> 'whatsapp_after_hours')::boolean, (d ->> 'handoff_reminder_minutes')::smallint, (d ->> 'call_paise_per_minute')::integer, v_uid
    from (select app.outreach_pol(p_tenant_id) || p_settings as d) x
  on conflict (tenant_id) do update set night_call_minute = excluded.night_call_minute, max_attempts = excluded.max_attempts, retry_gap_hours = excluded.retry_gap_hours,
    then_whatsapp = excluded.then_whatsapp, whatsapp_after_hours = excluded.whatsapp_after_hours, handoff_reminder_minutes = excluded.handoff_reminder_minutes,
    call_paise_per_minute = excluded.call_paise_per_minute, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  return public.outreach_policy_get(p_tenant_id);
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  perform app.outreach_error('invalid');
  return null;
end;
$$;
revoke all on function public.outreach_policy_set(uuid, jsonb) from public, anon;
grant execute on function public.outreach_policy_set(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the plan of a batch
-- ---------------------------------------------------------------------------------------------------------------------------------
-- why a contact cannot be reached on a channel (null = it can). Never a stranger: the contact must be one of the workspace's own.
create function app.outreach_skip(c public.contacts, p_channel text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when c.id is null or c.erased_at is not null then 'erased'
    when c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn' or c.phone_consent = 'withdrawn' then 'stopped'
    when c.phone is null or regexp_replace(c.phone, '[^0-9]', '', 'g') !~ '^[0-9]{7,15}$' then 'no_phone'
    when p_channel = 'call' and c.phone_consent <> 'granted' then 'no_consent'
    when p_channel = 'whatsapp' and c.whatsapp_consent <> 'granted' then 'no_consent'
    when p_channel = 'both' and c.phone_consent <> 'granted' and c.whatsapp_consent <> 'granted' then 'no_consent'
    else null end
$$;
revoke all on function app.outreach_skip(public.contacts, text) from public;

create function app.outreach_masked(p_name text) returns text
language sql
immutable
set search_path = ''
as $$ select left(split_part(btrim(coalesce(p_name, '')), ' ', 1), 20) || case when split_part(btrim(coalesce(p_name, '')), ' ', 2) <> '' then ' ' || left(split_part(btrim(p_name), ' ', 2), 1) || '.' else '' end $$;
revoke all on function app.outreach_masked(text) from public;

-- the plan as the Owner sees it: counts, why people were left out, three samples, the estimate
create function app.outreach_plan_of(b public.outreach_batches) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ready integer;
  v_all integer;
  v_pol jsonb := app.outreach_pol(b.tenant_id);
  v_calls integer;
  v_minutes integer;
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
begin
  select count(*) filter (where status in ('planned', 'waiting', 'done', 'stopped')), count(*) into v_ready, v_all from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id;
  v_calls := case when b.channel in ('call', 'both') then v_ready else 0 end;
  v_minutes := v_calls * 3;   -- one connected call of about three minutes per person (retries that nobody answers cost nothing)
  return jsonb_build_object(
    'count', v_all, 'ready', v_ready,
    'skipped', jsonb_build_object(
      'no_phone', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason = 'no_phone'),
      'no_consent', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason = 'no_consent'),
      'stopped', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason = 'stopped'),
      'duplicate', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason = 'duplicate'),
      'erased', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason = 'erased'),
      'excluded', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason = 'excluded'),
      'other', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'skipped' and i.reason not in ('no_phone', 'no_consent', 'stopped', 'duplicate', 'erased', 'excluded'))),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('contact_id', x.contact_id, 'name_masked', x.nm, 'city', x.city) order by x.cat, x.cid)
                          from (select i.contact_id, c.created_at as cat, c.id as cid, app.outreach_masked(c.full_name) as nm, co.city
                                  from public.outreach_items i join public.contacts c on c.tenant_id = i.tenant_id and c.id = i.contact_id
                                  left join public.companies co on co.tenant_id = c.tenant_id and co.id = c.company_id
                                 where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status in ('planned', 'waiting', 'done', 'stopped')
                                 order by c.created_at, c.id limit 3) x), '[]'::jsonb),
    'window', jsonb_build_object('from', v_today, 'to', v_today + b.window_days),
    'estimated_minutes', v_minutes,
    'estimated_messages', case when b.channel in ('whatsapp', 'both') then v_ready else 0 end,
    'estimated_cost_paise', v_minutes::bigint * (v_pol ->> 'call_paise_per_minute')::bigint,
    'caps', jsonb_build_object('max_calls_per_day', b.max_calls_per_day, 'max_total_minutes', b.max_total_minutes));
end;
$$;
revoke all on function app.outreach_plan_of(public.outreach_batches) from public;

create function app.outreach_plan_sha(b public.outreach_batches) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|', b.goal, b.channel, b.language, b.questions::text, coalesce(b.message_text, ''), b.window_days, coalesce(b.max_calls_per_day, 0), coalesce(b.max_total_minutes, 0),
           (select coalesce(string_agg(i.contact_id::text, ',' order by i.contact_id), '') from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status in ('planned', 'waiting', 'done', 'stopped'))), 'UTF8')), 'hex')
$$;
revoke all on function app.outreach_plan_sha(public.outreach_batches) from public;

create function app.outreach_batch_json(b public.outreach_batches) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'status', b.status, 'paused_reason', b.paused_reason, 'goal', b.goal, 'channel', b.channel, 'language', b.language,
    'questions', b.questions, 'message_text', b.message_text, 'window_days', b.window_days, 'max_calls_per_day', b.max_calls_per_day, 'max_total_minutes', b.max_total_minutes,
    'plan_sha256', b.plan_sha256, 'created_at', b.created_at, 'approved_at', b.approved_at, 'finished_at', b.finished_at)
$$;
revoke all on function app.outreach_batch_json(public.outreach_batches) from public;

-- the progress of a batch
create function app.outreach_progress(b public.outreach_batches) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status <> 'skipped'),
    'waiting', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status = 'waiting'),
    'done', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.status in ('done', 'stopped')),
    'calls_made', (select count(*) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id where i.tenant_id = b.tenant_id and i.batch_id = b.id and a.channel = 'call'),
    'connected', (select count(*) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id where i.tenant_id = b.tenant_id and i.batch_id = b.id and a.channel = 'call' and a.result = 'connected'),
    'interested', (select count(*) from public.outreach_items i where i.tenant_id = b.tenant_id and i.batch_id = b.id and i.reason = 'interested'),
    'minutes_used', (select coalesce(sum(a.minutes), 0) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id where i.tenant_id = b.tenant_id and i.batch_id = b.id))
$$;
revoke all on function app.outreach_progress(public.outreach_batches) from public;

-- recompute the plan and its hash from the items (after a plan or an exclusion)
create function app.outreach_refresh(p_batch uuid) returns public.outreach_batches
language plpgsql
set search_path = ''
as $$
declare
  b public.outreach_batches;
begin
  select * into b from public.outreach_batches where id = p_batch for update;
  update public.outreach_batches set plan_sha256 = app.outreach_plan_sha(b), plan = app.outreach_plan_of(b) where id = b.id returning * into b;
  return b;
end;
$$;
revoke all on function app.outreach_refresh(uuid) from public;

create function public.outreach_batch_plan(p_tenant_id uuid, p_doc jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_who     jsonb;
  v_goal    text;
  v_channel text;
  v_lang    text;
  v_q       jsonb := coalesce(p_doc -> 'questions', '[]'::jsonb);
  v_msg     text := nullif(btrim(coalesce(p_doc ->> 'message_text', '')), '');
  v_window  integer := coalesce((p_doc ->> 'window_days')::integer, 7);
  v_calls   integer := (p_doc ->> 'max_calls_per_day')::integer;
  v_mins    integer := (p_doc ->> 'max_total_minutes')::integer;
  v_name    text := btrim(coalesce(p_doc ->> 'name', ''));
  v_ids     uuid[];
  b         public.outreach_batches;
  c         public.contacts;
  q         jsonb;
  k         text;
  v_skip    text;
  v_seen    text[] := '{}';
  v_digits  text;
  v_lead    uuid;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    perform app.outreach_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_doc) loop
    if k not in ('batch_id', 'name', 'goal', 'channel', 'language', 'who', 'questions', 'message_text', 'window_days', 'max_calls_per_day', 'max_total_minutes') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  v_id := (p_doc ->> 'batch_id')::uuid;
  v_goal := p_doc ->> 'goal';
  v_channel := p_doc ->> 'channel';
  v_lang := p_doc ->> 'language';
  v_who := p_doc -> 'who';
  if v_id is null or char_length(v_name) not between 1 and 80 or not app.text_is_clean(v_name)
     or v_goal is null or v_goal not in ('site_visit', 'counselling', 'appointment', 'qualify', 'test_drive', 'site_measurement', 'quote', 'trial', 'callback', 'general')
     or v_channel is null or v_channel not in ('call', 'whatsapp', 'both') or v_lang is null or v_lang not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')
     or jsonb_typeof(v_q) <> 'array' or jsonb_array_length(v_q) > 8 or v_window not between 1 and 14
     or (v_msg is not null and (char_length(v_msg) not between 2 and 600 or not app.text_is_clean(v_msg)))
     or (v_calls is not null and v_calls not between 1 and 5000) or (v_mins is not null and v_mins not between 1 and 100000)
     or v_who is null or jsonb_typeof(v_who) <> 'object' or (select count(*) from jsonb_object_keys(v_who) x) <> 1
     or (v_channel in ('whatsapp', 'both') and v_msg is null) then
    perform app.outreach_error('invalid');
  end if;
  for q in select * from jsonb_array_elements(v_q) loop
    if jsonb_typeof(q) <> 'string' or char_length(q #>> '{}') not between 2 and 160 or not app.text_is_clean(q #>> '{}') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  -- a school's outreach is about admission only (the school rule: nothing about fees, marks or dues)
  if exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant_id and w.pack_code = 'education') and v_goal not in ('counselling', 'site_visit', 'callback') then
    perform app.outreach_error('invalid');
  end if;
  -- who: the workspace's own contacts only
  if v_who ? 'contact_ids' then
    select coalesce(array_agg(distinct c2.id), '{}') into v_ids from public.contacts c2 where c2.tenant_id = p_tenant_id and c2.id = any (select jsonb_array_elements_text(v_who -> 'contact_ids')::uuid);
  elsif v_who ? 'lead_ids' then
    select coalesce(array_agg(distinct l.contact_id), '{}') into v_ids from public.leads l where l.tenant_id = p_tenant_id and l.contact_id is not null and l.id = any (select jsonb_array_elements_text(v_who -> 'lead_ids')::uuid);
  elsif v_who ? 'source' then
    if jsonb_typeof(v_who -> 'source') <> 'object' or (v_who -> 'source' ->> 'source') is null then
      perform app.outreach_error('invalid');
    end if;
    select coalesce(array_agg(distinct l.contact_id), '{}') into v_ids from public.leads l
     where l.tenant_id = p_tenant_id and l.contact_id is not null and l.archived_at is null and l.source = (v_who -> 'source' ->> 'source')
       and (v_who -> 'source' ->> 'status' is null or l.status::text = (v_who -> 'source' ->> 'status'))
       and (v_who -> 'source' ->> 'since' is null or l.created_at >= (v_who -> 'source' ->> 'since')::date);
  else
    perform app.outreach_error('invalid');
  end if;
  if coalesce(cardinality(v_ids), 0) not between 1 and 2000 then
    perform app.outreach_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outreach_batch:' || v_id::text, 0));
  select * into b from public.outreach_batches x where x.id = v_id;
  if found then
    if b.tenant_id <> p_tenant_id then
      perform app.outreach_error('reference');
    end if;
    if b.status <> 'planned' then
      perform app.outreach_error('state');
    end if;
    delete from public.outreach_items i where i.tenant_id = p_tenant_id and i.batch_id = v_id;
    update public.outreach_batches set name = v_name, goal = v_goal, channel = v_channel, language = v_lang, questions = v_q, message_text = v_msg, window_days = v_window,
           max_calls_per_day = v_calls, max_total_minutes = v_mins where id = v_id returning * into b;
  else
    insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, questions, message_text, window_days, max_calls_per_day, max_total_minutes, plan_sha256, created_by)
    values (v_id, p_tenant_id, v_name, v_goal, v_channel, v_lang, v_q, v_msg, v_window, v_calls, v_mins, repeat('0', 64), v_uid) returning * into b;
  end if;
  for c in select * from public.contacts x where x.tenant_id = p_tenant_id and x.id = any (v_ids) order by x.created_at, x.id loop
    v_skip := app.outreach_skip(c, v_channel);
    v_digits := right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10);
    if v_skip is null and v_digits <> '' and v_digits = any (v_seen) then
      v_skip := 'duplicate';
    elsif v_skip is null and exists (select 1 from public.outreach_items r where r.tenant_id = p_tenant_id and r.contact_id = c.id and r.status = 'stopped' and r.reason = 'refused' and r.created_at > app.outbox_now() - interval '90 days') then
      v_skip := 'refused';
    end if;
    if v_skip is null and v_digits <> '' then
      v_seen := v_seen || v_digits;
    end if;
    select l.id into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.contact_id = c.id and l.archived_at is null order by l.created_at desc, l.id limit 1;
    insert into public.outreach_items (tenant_id, batch_id, contact_id, lead_id, status, reason) values (p_tenant_id, v_id, c.id, v_lead, case when v_skip is null then 'planned' else 'skipped' end, v_skip);
  end loop;
  b := app.outreach_refresh(v_id);
  return jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  perform app.outreach_error('invalid');
  return null;
end;
$$;
revoke all on function public.outreach_batch_plan(uuid, jsonb) from public, anon;
grant execute on function public.outreach_batch_plan(uuid, jsonb) to authenticated;

create function public.outreach_batch_get(p_tenant_id uuid, p_batch_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.outreach_batches;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  select * into b from public.outreach_batches x where x.tenant_id = p_tenant_id and x.id = p_batch_id;
  if not found then
    perform app.outreach_error('reference');
  end if;
  return jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan, 'progress', app.outreach_progress(b));
end;
$$;
revoke all on function public.outreach_batch_get(uuid, uuid) from public, anon;
grant execute on function public.outreach_batch_get(uuid, uuid) to authenticated;

create function public.outreach_batches_list(p_tenant_id uuid, p_status text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if p_status is not null and p_status not in ('planned', 'running', 'paused', 'done', 'cancelled') then
    perform app.outreach_error('invalid');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan, 'progress', app.outreach_progress(b)) order by b.created_at desc, b.id)
                     from (select * from public.outreach_batches x where x.tenant_id = p_tenant_id and (p_status is null or x.status = p_status) order by x.created_at desc, x.id limit 100) b), '[]'::jsonb);
end;
$$;
revoke all on function public.outreach_batches_list(uuid, text) from public, anon;
grant execute on function public.outreach_batches_list(uuid, text) to authenticated;

create function public.outreach_items_list(p_tenant_id uuid, p_batch_id uuid, p_limit integer default 50, p_after_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 or not exists (select 1 from public.outreach_batches b where b.tenant_id = p_tenant_id and b.id = p_batch_id) then
    perform app.outreach_error('reference');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'contact_id', x.contact_id, 'lead_id', x.lead_id, 'name', x.full_name, 'status', x.status, 'reason', x.reason, 'attempts', x.attempts,
                                                        'next_action', x.next_action, 'next_at', x.next_at, 'last_result', x.last_result, 'created_at', x.created_at) order by x.created_at, x.id)
                     from (select i.*, c.full_name from public.outreach_items i join public.contacts c on c.tenant_id = i.tenant_id and c.id = i.contact_id
                            where i.tenant_id = p_tenant_id and i.batch_id = p_batch_id and (p_after_at is null or (i.created_at, i.id) > (p_after_at, p_after_id))
                            order by i.created_at, i.id limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.outreach_items_list(uuid, uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.outreach_items_list(uuid, uuid, integer, timestamptz, uuid) to authenticated;

-- exclude people (before the approval: the plan changes and so does its hash; after: their waiting steps stop)
create function public.outreach_batch_exclude(p_tenant_id uuid, p_batch_id uuid, p_contact_ids uuid[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.outreach_batches;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if p_contact_ids is null or cardinality(p_contact_ids) not between 1 and 2000 then
    perform app.outreach_error('invalid');
  end if;
  select * into b from public.outreach_batches x where x.tenant_id = p_tenant_id and x.id = p_batch_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if b.status in ('done', 'cancelled') then
    perform app.outreach_error('state');
  end if;
  update public.outreach_items set status = 'skipped', reason = 'excluded', next_action = null, next_at = null, then_action = null, then_at = null
   where tenant_id = p_tenant_id and batch_id = p_batch_id and contact_id = any (p_contact_ids) and status = 'planned';
  update public.outreach_items set status = 'stopped', reason = 'excluded', next_action = null, next_at = null, then_action = null, then_at = null
   where tenant_id = p_tenant_id and batch_id = p_batch_id and contact_id = any (p_contact_ids) and status = 'waiting';
  b := app.outreach_refresh(p_batch_id);
  return jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan, 'progress', app.outreach_progress(b));
end;
$$;
revoke all on function public.outreach_batch_exclude(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.outreach_batch_exclude(uuid, uuid, uuid[]) to authenticated;

-- the first step of a person approved at p_now in a batch
create function app.outreach_first_batch_step(p_tenant uuid, p_channel text, p_now timestamptz, out next_action text, out next_at timestamptz, out then_action text, out then_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_channel = 'call' then
    next_action := 'call'; next_at := app.outreach_slot(p_tenant, p_now);
  elsif p_channel = 'whatsapp' then
    next_action := 'whatsapp'; next_at := p_now;
  else
    next_action := 'whatsapp'; next_at := p_now; then_action := 'call'; then_at := app.outreach_slot(p_tenant, p_now + interval '30 minutes');
  end if;
end;
$$;
revoke all on function app.outreach_first_batch_step(uuid, text, timestamptz) from public;

-- APPROVE ALL: once, by the Owner with the second factor, bound to the plan that was shown
create function public.outreach_batch_approve(p_tenant_id uuid, p_batch_id uuid, p_plan_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := app.outbox_now();
  b     public.outreach_batches;
  s     record;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  perform app.require_aal2();
  select * into b from public.outreach_batches x where x.tenant_id = p_tenant_id and x.id = p_batch_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if b.status <> 'planned' then
    perform app.outreach_error('state');
  end if;
  if p_plan_sha256 is distinct from app.outreach_plan_sha(b) then
    perform app.outreach_error('changed');
  end if;
  if (select count(*) from public.outreach_items i where i.tenant_id = p_tenant_id and i.batch_id = p_batch_id and i.status = 'planned') = 0 then
    perform app.outreach_error('invalid');
  end if;
  select * into s from app.outreach_first_batch_step(p_tenant_id, b.channel, v_now);
  update public.outreach_items set status = 'waiting', next_action = s.next_action, next_at = s.next_at, then_action = s.then_action, then_at = s.then_at, arrival_at = v_now
   where tenant_id = p_tenant_id and batch_id = p_batch_id and status = 'planned';
  update public.outreach_batches set status = 'running', approved_by = v_uid, approved_at = v_now where id = p_batch_id returning * into b;
  return jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan, 'progress', app.outreach_progress(b));
end;
$$;
revoke all on function public.outreach_batch_approve(uuid, uuid, text) from public, anon;
grant execute on function public.outreach_batch_approve(uuid, uuid, text) to authenticated;

create function public.outreach_batch_state(p_tenant_id uuid, p_batch_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.outreach_batches;
  v_now timestamptz := app.outbox_now();
begin
  if auth.uid() is null or p_tenant_id is null or p_action is null or p_action not in ('pause', 'resume', 'cancel')
     or not app.has_tenant_role(p_tenant_id, case when p_action = 'cancel' then array['owner']::public.app_role[] else array['owner', 'admin']::public.app_role[] end) then
    perform app.outreach_error('deny');
  end if;
  select * into b from public.outreach_batches x where x.tenant_id = p_tenant_id and x.id = p_batch_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if p_action = 'pause' then
    if b.status <> 'running' then perform app.outreach_error('state'); end if;
    update public.outreach_batches set status = 'paused', paused_reason = 'owner', paused_at = v_now where id = b.id returning * into b;
  elsif p_action = 'resume' then
    if b.status <> 'paused' or b.paused_reason = 'cap_minutes' then perform app.outreach_error('state'); end if;
    update public.outreach_batches set status = 'running', paused_reason = null, paused_at = null where id = b.id returning * into b;
  else
    if b.status in ('done', 'cancelled') then perform app.outreach_error('state'); end if;
    update public.outreach_items set status = 'stopped', reason = 'cancelled', next_action = null, next_at = null, then_action = null, then_at = null where tenant_id = p_tenant_id and batch_id = b.id and status in ('waiting', 'planned');
    update public.outreach_batches set status = 'cancelled', paused_reason = null, paused_at = null, finished_at = v_now where id = b.id returning * into b;
  end if;
  return jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan, 'progress', app.outreach_progress(b));
end;
$$;
revoke all on function public.outreach_batch_state(uuid, uuid, text) from public, anon;
grant execute on function public.outreach_batch_state(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. standing rules per lead source (approved once)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the first step for a lead of a rule that arrived at p_t0
create function app.outreach_rule_step(r public.outreach_rules, p_t0 timestamptz, out next_action text, out next_at timestamptz, out then_action text, out then_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pol jsonb := app.outreach_pol(r.tenant_id);
  v_t   timestamptz := p_t0 + make_interval(mins => r.within_minutes);
  v_wa  boolean := r.channel in ('both', 'whatsapp') and r.message_text is not null;
begin
  if r.action in ('whatsapp_first', 'whatsapp_then_call') then
    next_action := 'whatsapp'; next_at := p_t0;
    if r.channel in ('both', 'call') then
      then_action := 'call'; then_at := app.outreach_slot(r.tenant_id, v_t);
    end if;
  elsif r.channel = 'whatsapp' then
    next_action := 'whatsapp'; next_at := p_t0;
  elsif app.outreach_in_hours(r.tenant_id, v_t) then
    next_action := 'call'; next_at := v_t;
  elsif (v_pol ->> 'whatsapp_after_hours')::boolean and v_wa then
    -- a lead after hours: WhatsApp now, the call next morning
    next_action := 'whatsapp'; next_at := p_t0;
    then_action := 'call'; then_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  else
    next_action := 'call'; next_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  end if;
end;
$$;
revoke all on function app.outreach_rule_step(public.outreach_rules, timestamptz) from public;

create function app.outreach_rule_json(r public.outreach_rules) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'source', r.source, 'action', r.action, 'within_minutes', r.within_minutes, 'goal', r.goal, 'channel', r.channel, 'language', r.language,
    'questions', r.questions, 'message_text', r.message_text, 'max_calls_per_day', r.max_calls_per_day, 'max_total_minutes', r.max_total_minutes,
    'active', r.active, 'paused_reason', r.paused_reason, 'paused_at', r.paused_at, 'approved_at', r.approved_at,
    'usage', jsonb_build_object(
      'leads', (select count(*) from public.outreach_items i where i.tenant_id = r.tenant_id and i.rule_id = r.id and i.status <> 'skipped'),
      'calls_today', (select count(*) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id
                       where i.tenant_id = r.tenant_id and i.rule_id = r.id and a.channel = 'call' and (a.at at time zone 'Asia/Kolkata')::date = (app.outbox_now() at time zone 'Asia/Kolkata')::date),
      'minutes_used', (select coalesce(sum(a.minutes), 0) from public.outreach_attempts a join public.outreach_items i on i.tenant_id = a.tenant_id and i.id = a.item_id where i.tenant_id = r.tenant_id and i.rule_id = r.id)))
$$;
revoke all on function app.outreach_rule_json(public.outreach_rules) from public;

create function public.outreach_rule_save(p_tenant_id uuid, p_doc jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();
  v_id      uuid;
  v_source  text := lower(btrim(coalesce(p_doc ->> 'source', '')));
  v_action  text := p_doc ->> 'action';
  v_within  integer := coalesce((p_doc ->> 'within_minutes')::integer, 2);
  v_goal    text := p_doc ->> 'goal';
  v_channel text := p_doc ->> 'channel';
  v_lang    text := p_doc ->> 'language';
  v_q       jsonb := coalesce(p_doc -> 'questions', '[]'::jsonb);
  v_msg     text := nullif(btrim(coalesce(p_doc ->> 'message_text', '')), '');
  v_calls   integer := (p_doc ->> 'max_calls_per_day')::integer;
  v_mins    integer := (p_doc ->> 'max_total_minutes')::integer;
  r         public.outreach_rules;
  q         jsonb;
  k         text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  perform app.require_aal2();
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    perform app.outreach_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_doc) loop
    if k not in ('rule_id', 'source', 'action', 'within_minutes', 'goal', 'channel', 'language', 'questions', 'message_text', 'max_calls_per_day', 'max_total_minutes') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  v_id := (p_doc ->> 'rule_id')::uuid;
  if v_id is null or v_source !~ '^[a-z0-9_.-]{1,64}$' or v_action is null or v_action not in ('call_within_minutes', 'whatsapp_first', 'whatsapp_then_call') or v_within not between 1 and 120
     or v_goal is null or v_goal not in ('site_visit', 'counselling', 'appointment', 'qualify', 'test_drive', 'site_measurement', 'quote', 'trial', 'callback', 'general')
     or v_channel is null or v_channel not in ('call', 'whatsapp', 'both') or v_lang is null or v_lang not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')
     or jsonb_typeof(v_q) <> 'array' or jsonb_array_length(v_q) > 8 or (v_msg is not null and (char_length(v_msg) not between 2 and 600 or not app.text_is_clean(v_msg)))
     or (v_calls is not null and v_calls not between 1 and 5000) or (v_mins is not null and v_mins not between 1 and 100000)
     or (v_action in ('whatsapp_first', 'whatsapp_then_call') and (v_channel = 'call' or v_msg is null))
     or (v_action = 'call_within_minutes' and v_channel = 'whatsapp' and v_msg is null)
     or (v_channel in ('whatsapp', 'both') and v_msg is null) then
    perform app.outreach_error('invalid');
  end if;
  for q in select * from jsonb_array_elements(v_q) loop
    if jsonb_typeof(q) <> 'string' or char_length(q #>> '{}') not between 2 and 160 or not app.text_is_clean(q #>> '{}') then
      perform app.outreach_error('invalid');
    end if;
  end loop;
  if exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant_id and w.pack_code = 'education') and v_goal not in ('counselling', 'site_visit', 'callback') then
    perform app.outreach_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outreach_rule:' || p_tenant_id::text, 0));
  select * into r from public.outreach_rules x where x.id = v_id;
  if found then
    if r.tenant_id <> p_tenant_id then
      perform app.outreach_error('reference');
    end if;
    update public.outreach_rules set source = v_source, action = v_action, within_minutes = v_within, goal = v_goal, channel = v_channel, language = v_lang, questions = v_q, message_text = v_msg,
           max_calls_per_day = v_calls, max_total_minutes = v_mins, approved_by = v_uid, approved_at = v_now where id = v_id returning * into r;
  else
    insert into public.outreach_rules (id, tenant_id, source, action, within_minutes, goal, channel, language, questions, message_text, max_calls_per_day, max_total_minutes, approved_by, approved_at, last_scan_at)
    values (v_id, p_tenant_id, v_source, v_action, v_within, v_goal, v_channel, v_lang, v_q, v_msg, v_calls, v_mins, v_uid, v_now, v_now) returning * into r;
  end if;
  return app.outreach_rule_json(r);
exception when unique_violation then
  perform app.outreach_error('state');   -- one active rule per source
  return null;
when invalid_text_representation then
  perform app.outreach_error('invalid');
  return null;
end;
$$;
revoke all on function public.outreach_rule_save(uuid, jsonb) from public, anon;
grant execute on function public.outreach_rule_save(uuid, jsonb) to authenticated;

create function public.outreach_rules_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.outreach_rule_json(r) order by r.source, r.approved_at, r.id) from public.outreach_rules r where r.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.outreach_rules_list(uuid) from public, anon;
grant execute on function public.outreach_rules_list(uuid) to authenticated;

create function public.outreach_rule_state(p_tenant_id uuid, p_rule_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.outreach_rules;
begin
  if auth.uid() is null or p_tenant_id is null or p_action is null or p_action not in ('pause', 'resume') or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  select * into r from public.outreach_rules x where x.tenant_id = p_tenant_id and x.id = p_rule_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if p_action = 'pause' then
    if not r.active then perform app.outreach_error('state'); end if;
    update public.outreach_rules set active = false, paused_reason = 'owner', paused_at = app.outbox_now() where id = r.id returning * into r;
  else
    if r.active or r.paused_reason = 'cap_minutes' then perform app.outreach_error('state'); end if;
    -- leads that came while it was paused are not called afterwards (the rule applies to leads that arrive while it is on)
    update public.outreach_rules set active = true, paused_reason = null, paused_at = null, last_scan_at = app.outbox_now() where id = r.id returning * into r;
  end if;
  return app.outreach_rule_json(r);
exception when unique_violation then
  perform app.outreach_error('state');
  return null;
end;
$$;
revoke all on function public.outreach_rule_state(uuid, uuid, text) from public, anon;
grant execute on function public.outreach_rule_state(uuid, uuid, text) to authenticated;

-- raising a cap needs the Owner and the second factor again (it is a new spending decision); it lifts a cap pause
create function public.outreach_caps_set(p_tenant_id uuid, p_kind text, p_id uuid, p_max_calls_per_day integer, p_max_total_minutes integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.outreach_batches;
  r public.outreach_rules;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  perform app.require_aal2();
  if p_kind is null or p_kind not in ('batch', 'rule') or (p_max_calls_per_day is not null and p_max_calls_per_day not between 1 and 5000) or (p_max_total_minutes is not null and p_max_total_minutes not between 1 and 100000) then
    perform app.outreach_error('invalid');
  end if;
  if p_kind = 'batch' then
    update public.outreach_batches set max_calls_per_day = p_max_calls_per_day, max_total_minutes = p_max_total_minutes,
           status = case when status = 'paused' and paused_reason in ('cap_calls', 'cap_minutes') then 'running' else status end,
           paused_reason = case when status = 'paused' and paused_reason in ('cap_calls', 'cap_minutes') then null else paused_reason end,
           paused_at = case when status = 'paused' and paused_reason in ('cap_calls', 'cap_minutes') then null else paused_at end
     where tenant_id = p_tenant_id and id = p_id and status in ('running', 'paused') returning * into b;
    if not found then
      perform app.outreach_error('state');
    end if;
    return jsonb_build_object('batch', app.outreach_batch_json(b), 'plan', b.plan, 'progress', app.outreach_progress(b));
  end if;
  update public.outreach_rules set max_calls_per_day = p_max_calls_per_day, max_total_minutes = p_max_total_minutes,
         active = case when not active and paused_reason in ('cap_calls', 'cap_minutes') then true else active end,
         paused_reason = case when not active and paused_reason in ('cap_calls', 'cap_minutes') then null else paused_reason end,
         paused_at = case when not active and paused_reason in ('cap_calls', 'cap_minutes') then null else paused_at end
   where tenant_id = p_tenant_id and id = p_id returning * into r;
  if not found then
    perform app.outreach_error('reference');
  end if;
  return app.outreach_rule_json(r);
end;
$$;
revoke all on function public.outreach_caps_set(uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.outreach_caps_set(uuid, text, uuid, integer, integer) to authenticated;

create function public.outreach_source_costs_set(p_tenant_id uuid, p_costs jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if p_costs is null or jsonb_typeof(p_costs) <> 'array' or jsonb_array_length(p_costs) > 50 then
    perform app.outreach_error('invalid');
  end if;
  for e in select * from jsonb_array_elements(p_costs) loop
    if jsonb_typeof(e) <> 'object' or (e ->> 'source') !~ '^[a-z0-9_.-]{1,64}$' or (e ->> 'cost_per_lead_paise') !~ '^[0-9]{1,8}$' then
      perform app.outreach_error('invalid');
    end if;
    insert into public.lead_source_costs (tenant_id, source, cost_per_lead_paise, updated_by) values (p_tenant_id, e ->> 'source', (e ->> 'cost_per_lead_paise')::bigint, auth.uid())
    on conflict (tenant_id, source) do update set cost_per_lead_paise = excluded.cost_per_lead_paise, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  end loop;
  return public.outreach_source_costs_get(p_tenant_id);
end;
$$;
revoke all on function public.outreach_source_costs_set(uuid, jsonb) from public, anon;

create function public.outreach_source_costs_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('source', c.source, 'cost_per_lead_paise', c.cost_per_lead_paise) order by c.source) from public.lead_source_costs c where c.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.outreach_source_costs_get(uuid) from public, anon;
grant execute on function public.outreach_source_costs_get(uuid) to authenticated;
grant execute on function public.outreach_source_costs_set(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the worker: scan the sources, run what is due, take the results
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the owner of an item (its batch or its rule) as one document
create function app.outreach_owner(i public.outreach_items) returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when i.batch_id is not null
    then (select jsonb_build_object('kind', 'batch', 'id', b.id, 'active', b.status = 'running', 'channel', b.channel, 'language', b.language, 'goal', b.goal, 'questions', b.questions,
             'message_text', b.message_text, 'max_calls_per_day', b.max_calls_per_day, 'max_total_minutes', b.max_total_minutes, 'approved_by', b.approved_by)
            from public.outreach_batches b where b.tenant_id = i.tenant_id and b.id = i.batch_id)
    else (select jsonb_build_object('kind', 'rule', 'id', r.id, 'active', r.active, 'channel', r.channel, 'language', r.language, 'goal', r.goal, 'questions', r.questions,
             'message_text', r.message_text, 'max_calls_per_day', r.max_calls_per_day, 'max_total_minutes', r.max_total_minutes, 'approved_by', r.approved_by)
            from public.outreach_rules r where r.tenant_id = i.tenant_id and r.id = i.rule_id) end
$$;
revoke all on function app.outreach_owner(public.outreach_items) from public;

create function app.outreach_usage(i public.outreach_items) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'calls_today', (select count(*) from public.outreach_attempts a join public.outreach_items j on j.tenant_id = a.tenant_id and j.id = a.item_id
                     where j.tenant_id = i.tenant_id and j.batch_id is not distinct from i.batch_id and j.rule_id is not distinct from i.rule_id and a.channel = 'call'
                       and (a.at at time zone 'Asia/Kolkata')::date = (app.outbox_now() at time zone 'Asia/Kolkata')::date),
    'minutes_total', (select coalesce(sum(a.minutes), 0) from public.outreach_attempts a join public.outreach_items j on j.tenant_id = a.tenant_id and j.id = a.item_id
                       where j.tenant_id = i.tenant_id and j.batch_id is not distinct from i.batch_id and j.rule_id is not distinct from i.rule_id))
$$;
revoke all on function app.outreach_usage(public.outreach_items) from public;

create function app.outreach_pause(o jsonb, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if o ->> 'kind' = 'batch' then
    update public.outreach_batches set status = 'paused', paused_reason = p_reason, paused_at = app.outbox_now() where id = (o ->> 'id')::uuid and status = 'running';
  else
    update public.outreach_rules set active = false, paused_reason = p_reason, paused_at = app.outbox_now() where id = (o ->> 'id')::uuid and active;
  end if;
end;
$$;
revoke all on function app.outreach_pause(jsonb, text) from public;

create function app.outreach_stop(p_item uuid, p_reason text) returns void
language sql
set search_path = ''
as $$ update public.outreach_items set status = 'stopped', reason = p_reason, next_action = null, next_at = null, then_action = null, then_at = null where id = p_item $$;
revoke all on function app.outreach_stop(uuid, text) from public;

-- new leads of a source that has an approved, active rule -> one waiting item each (only leads that arrived after the approval)
create function public.scheduler_outreach_scan(p_limit integer default 200) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := app.outbox_now();
  r       public.outreach_rules;
  l       public.leads;
  c       public.contacts;
  s       record;
  v_skip  text;
  v_added integer := 0;
  v_last  timestamptz;
begin
  if not app.is_scheduler() then
    perform app.outreach_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    perform app.outreach_error('invalid');
  end if;
  for r in select * from public.outreach_rules x where x.active and not app.billing_read_only(x.tenant_id) order by x.tenant_id, x.id loop
    v_last := r.last_scan_at;
    for l in select * from public.leads x where x.tenant_id = r.tenant_id and x.source = r.source and x.created_at >= r.last_scan_at and x.created_at >= r.approved_at
                and x.archived_at is null and x.contact_id is not null order by x.created_at, x.id limit p_limit loop
      v_last := greatest(v_last, l.created_at);
      if exists (select 1 from public.outreach_items i where i.rule_id = r.id and i.lead_id = l.id) then
        continue;
      end if;
      select * into c from public.contacts x where x.tenant_id = r.tenant_id and x.id = l.contact_id;
      v_skip := app.outreach_skip(c, case when r.channel = 'whatsapp' or r.action in ('whatsapp_first', 'whatsapp_then_call') then 'whatsapp' else r.channel end);
      if v_skip is not null then
        insert into public.outreach_items (tenant_id, rule_id, contact_id, lead_id, status, reason, arrival_at) values (r.tenant_id, r.id, c.id, l.id, 'skipped', v_skip, l.created_at);
        continue;
      end if;
      select * into s from app.outreach_rule_step(r, greatest(l.created_at, v_now));
      insert into public.outreach_items (tenant_id, rule_id, contact_id, lead_id, status, next_action, next_at, then_action, then_at, arrival_at)
      values (r.tenant_id, r.id, c.id, l.id, 'waiting', s.next_action, s.next_at, s.then_action, s.then_at, l.created_at);
      v_added := v_added + 1;
    end loop;
    update public.outreach_rules set last_scan_at = v_last where id = r.id;
  end loop;
  return jsonb_build_object('added', v_added);
end;
$$;
revoke all on function public.scheduler_outreach_scan(integer) from public, anon;
grant execute on function public.scheduler_outreach_scan(integer) to authenticated;

create function app.outreach_attempt_n(p_item uuid) returns smallint
language sql
stable
set search_path = ''
as $$ select (coalesce(max(n), 0) + 1)::smallint from public.outreach_attempts where item_id = p_item $$;
revoke all on function app.outreach_attempt_n(uuid) from public;

-- one pass of the dialer's work: WhatsApp steps are done HERE (through the outbox); calls are handed to the worker's dialer, which answers with outreach_item_result
create function public.scheduler_outreach_run(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := app.outbox_now();
  v_today0  timestamptz := date_trunc('day', app.outbox_now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  i         public.outreach_items;
  c         public.contacts;
  o         jsonb;
  u         jsonb;
  v_skip    text;
  v_work    jsonb := '[]'::jsonb;
  v_sent    integer := 0;
  v_paused  integer := 0;
  v_weekly  integer;
  v_week_cap integer;
  v_msg     text;
  v_res     jsonb;
  v_result  text;
  v_mid     uuid;
begin
  if not app.is_scheduler() then
    perform app.outreach_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.outreach_error('invalid');
  end if;
  -- a day's call cap lifts in the morning; the total-minutes cap stays until the Owner raises it
  update public.outreach_batches set status = 'running', paused_reason = null, paused_at = null where status = 'paused' and paused_reason = 'cap_calls' and paused_at < v_today0;
  update public.outreach_rules set active = true, paused_reason = null, paused_at = null where not active and paused_reason = 'cap_calls' and paused_at < v_today0;
  for i in select * from public.outreach_items x where x.status = 'waiting' and x.next_at <= v_now order by x.next_at, x.id limit p_limit for update skip locked loop
    o := app.outreach_owner(i);
    if o is null or not (o ->> 'active')::boolean or app.billing_read_only(i.tenant_id) then
      continue;
    end if;
    select * into c from public.contacts x where x.tenant_id = i.tenant_id and x.id = i.contact_id;
    v_skip := app.outreach_skip(c, case when i.next_action = 'call' then 'call' else 'whatsapp' end);
    if v_skip is not null then
      perform app.outreach_stop(i.id, v_skip);
      continue;
    end if;
    if i.next_action = 'call' then
      if not app.outreach_in_hours(i.tenant_id, v_now) then
        update public.outreach_items set next_at = app.outreach_slot(i.tenant_id, v_now) where id = i.id;
        continue;
      end if;
      u := app.outreach_usage(i);
      if (o ->> 'max_total_minutes') is not null and (u ->> 'minutes_total')::numeric >= (o ->> 'max_total_minutes')::numeric then
        perform app.outreach_pause(o, 'cap_minutes'); v_paused := v_paused + 1; continue;
      end if;
      if (o ->> 'max_calls_per_day') is not null and (u ->> 'calls_today')::integer >= (o ->> 'max_calls_per_day')::integer then
        perform app.outreach_pause(o, 'cap_calls'); v_paused := v_paused + 1; continue;
      end if;
      v_week_cap := coalesce((select (s.settings ->> 'max_calls_per_customer_per_week')::integer from public.call_settings s where s.tenant_id = i.tenant_id and s.campaign_id is null), 2);
      select count(*) into v_weekly from public.outreach_attempts a join public.outreach_items j on j.tenant_id = a.tenant_id and j.id = a.item_id
       where j.tenant_id = i.tenant_id and j.contact_id = i.contact_id and a.channel = 'call' and a.at > v_now - interval '7 days';
      if v_weekly >= v_week_cap then
        update public.outreach_items set next_at = app.outreach_slot(i.tenant_id, v_now + interval '1 day') where id = i.id;
        continue;
      end if;
      if app.billing_stopped(i.tenant_id, 'call_minutes') then
        update public.outreach_items set next_at = v_now + interval '1 hour' where id = i.id;
        continue;
      end if;
      update public.outreach_items set next_at = v_now + interval '10 minutes' where id = i.id;   -- claimed: a crashed worker does not dial twice at once
      v_work := v_work || jsonb_build_array(jsonb_build_object(
        'item_id', i.id, 'tenant_id', i.tenant_id, 'contact_id', i.contact_id, 'lead_id', i.lead_id, 'name', c.full_name, 'phone', c.phone, 'language', o ->> 'language', 'goal', o ->> 'goal',
        'questions', o -> 'questions', 'attempt', app.outreach_attempt_n(i.id), 'owner_kind', o ->> 'kind', 'owner_id', o ->> 'id'));
    else
      if i.lead_id is null or (o ->> 'message_text') is null then
        perform app.outreach_stop(i.id, 'no_channel');
        continue;
      end if;
      v_msg := replace(o ->> 'message_text', '{name}', left(split_part(btrim(c.full_name), ' ', 1), 30));
      v_mid := md5('outreach:' || i.id::text || ':' || app.outreach_attempt_n(i.id)::text)::uuid;
      v_res := app.campaign_submit((o ->> 'approved_by')::uuid, v_mid, i.tenant_id, i.lead_id, v_msg, o ->> 'language');
      v_result := case when v_res ->> 'status' = 'blocked' then 'blocked' else 'sent' end;
      insert into public.outreach_attempts (tenant_id, item_id, n, channel, at, result, message_id) values (i.tenant_id, i.id, app.outreach_attempt_n(i.id), 'whatsapp', v_now, v_result, v_mid);
      v_sent := v_sent + 1;
      if i.then_action is not null then
        update public.outreach_items set next_action = then_action, next_at = coalesce(then_at, v_now), then_action = null, then_at = null, first_touch_at = coalesce(first_touch_at, v_now), last_result = v_result where id = i.id;
      else
        update public.outreach_items set status = 'done', reason = null, next_action = null, next_at = null, first_touch_at = coalesce(first_touch_at, v_now), last_result = v_result where id = i.id;
      end if;
    end if;
  end loop;
  return jsonb_build_object('calls', v_work, 'whatsapp', v_sent, 'paused', v_paused);
end;
$$;
revoke all on function public.scheduler_outreach_run(integer) from public, anon;
grant execute on function public.scheduler_outreach_run(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. a call's result, the outcome, the hand-off
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outreach_staff_for(p_tenant uuid) returns uuid
language sql
stable
set search_path = ''
as $$
  select m.user_id from public.memberships m
   where m.tenant_id = p_tenant
   order by case m.role when 'sales' then 0 when 'admin' then 1 when 'owner' then 2 else 3 end,
            (select count(*) from public.outreach_handoffs h where h.tenant_id = p_tenant and h.assigned_to = m.user_id and h.acted_at is null), m.created_at, m.user_id
   limit 1
$$;
revoke all on function app.outreach_staff_for(uuid) from public;

create function app.outreach_handoff(p_tenant uuid, p_item public.outreach_items, p_outcome uuid, p_category text, p_captured jsonb, p_goal text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_staff uuid := app.outreach_staff_for(p_tenant);
  c       public.contacts;
  v_words text;
  v_extra text;
  v_id    uuid;
begin
  if v_staff is null then
    return null;
  end if;
  select * into c from public.contacts x where x.tenant_id = p_tenant and x.id = p_item.contact_id;
  v_words := case p_category when 'visit_booked' then 'has booked a visit' when 'order_likely' then 'is likely to order' else 'is interested' end;
  select string_agg(replace(e.key, '_', ' ') || ' ' || (e.value #>> '{}'), ', ' order by e.key) into v_extra from jsonb_each(coalesce(p_captured, '{}'::jsonb)) e;
  insert into public.outreach_handoffs (tenant_id, lead_id, contact_id, outcome_id, assigned_to, summary)
  values (p_tenant, p_item.lead_id, p_item.contact_id, p_outcome, v_staff,
          left(c.full_name || ' ' || v_words || ' (' || replace(p_goal, '_', ' ') || ')' || case when v_extra is not null then ': ' || v_extra else '' end, 300))
  returning id into v_id;
  if p_item.lead_id is not null then
    update public.leads set owner_user_id = v_staff where tenant_id = p_tenant and id = p_item.lead_id and owner_user_id is null;
  end if;
  return v_id;
end;
$$;
revoke all on function app.outreach_handoff(uuid, public.outreach_items, uuid, text, jsonb, text) from public;

create function public.outreach_item_result(p_tenant_id uuid, p_item_id uuid, p_result text, p_outcome jsonb default null, p_minutes numeric default 0, p_stop boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();
  v_ai      boolean := app.is_scheduler();
  i         public.outreach_items;
  o         jsonb;
  v_pol     jsonb;
  v_att     uuid;
  v_n       smallint;
  v_out     uuid;
  v_cat     text;
  v_oc      text;
  v_cb      timestamptz;
  v_capt    jsonb;
  v_reason  text;
  v_next    timestamptz;
  v_wa_done boolean;
begin
  if v_uid is null or p_tenant_id is null or (not v_ai and not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[])) then
    perform app.outreach_error('deny');
  end if;
  if p_result is null or p_result not in ('no_answer', 'busy', 'voicemail', 'connected', 'failed') or p_minutes is null or p_minutes < 0 or p_minutes > 120 or p_stop is null then
    perform app.outreach_error('invalid');
  end if;
  select * into i from public.outreach_items x where x.tenant_id = p_tenant_id and x.id = p_item_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if i.status <> 'waiting' or i.next_action <> 'call' then
    perform app.outreach_error('state');
  end if;
  o := app.outreach_owner(i);
  v_pol := app.outreach_pol(p_tenant_id);
  v_n := app.outreach_attempt_n(i.id);
  insert into public.outreach_attempts (tenant_id, item_id, n, channel, at, result, minutes) values (p_tenant_id, i.id, v_n, 'call', v_now, p_result, case when p_result = 'connected' then p_minutes else 0 end) returning id into v_att;
  update public.outreach_items set attempts = attempts + 1, first_touch_at = coalesce(first_touch_at, v_now), last_result = p_result where id = i.id returning * into i;
  if p_stop then
    perform app.wa_suppress_contact(p_tenant_id, i.contact_id, 'opted_out', 'call:' || replace(v_att::text, '-', ''), v_uid);
    perform app.outreach_stop(i.id, 'stopped');
    return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'stopped');
  end if;
  if p_result = 'connected' and p_outcome is not null then
    v_oc := p_outcome ->> 'outcome'; v_cat := p_outcome ->> 'category'; v_cb := (p_outcome ->> 'callback_at')::timestamptz; v_capt := p_outcome -> 'captured';
    if v_oc is null or v_oc not in ('positive', 'negative', 'unclear')
       or (v_cat is not null and v_cat not in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'already_bought', 'call_back_later'))
       or not app.outreach_captured_ok(v_capt) or (v_cb is not null and (v_cb < v_now - interval '5 minutes' or v_cb > v_now + interval '30 days'))
       or (p_outcome ->> 'reason' is not null and (char_length(btrim(p_outcome ->> 'reason')) not between 2 and 200 or not app.text_is_clean(p_outcome ->> 'reason')))
       or not coalesce((v_oc = 'positive' and v_cat in ('interested', 'visit_booked', 'order_likely'))
                    or (v_oc = 'negative' and v_cat in ('not_interested', 'wrong_number', 'too_costly', 'already_bought'))
                    or (v_oc = 'unclear' and (v_cat is null or v_cat = 'call_back_later')), false) then
      perform app.outreach_error('invalid');
    end if;
    v_reason := app.outcome_reason(p_tenant_id, p_outcome ->> 'reason');
    insert into public.outcomes (tenant_id, contact_id, lead_id, kind, source_id, outcome, category, reason, recorded_by_kind, recorded_by, ai_outcome, ai_category, occurred_at, recorded_at)
    values (p_tenant_id, i.contact_id, i.lead_id, 'call', v_att, v_oc, v_cat, v_reason, case when v_ai then 'ai' else 'person' end, v_uid,
            case when v_ai then v_oc end, case when v_ai then v_cat end, v_now, v_now) returning id into v_out;
    if v_cb is not null or (v_capt is not null and v_capt <> '{}'::jsonb) then
      insert into public.outcome_details (outcome_id, tenant_id, callback_at, captured) values (v_out, p_tenant_id, v_cb, nullif(v_capt, '{}'::jsonb));
    end if;
    if v_cat in ('interested', 'visit_booked', 'order_likely') then
      perform app.outreach_handoff(p_tenant_id, i, v_out, v_cat, v_capt, o ->> 'goal');
      perform app.outreach_stop(i.id, 'interested');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'interested');
    elsif v_cat = 'call_back_later' then
      if i.callbacks >= 3 then
        perform app.outreach_stop(i.id, 'attempts_used');
        return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'attempts_used');
      end if;
      update public.outreach_items set callbacks = callbacks + 1, next_action = 'call', next_at = app.outreach_slot(p_tenant_id, coalesce(v_cb, v_now + interval '1 day')), then_action = null, then_at = null where id = i.id;
      return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', (select next_at from public.outreach_items where id = i.id));
    elsif v_cat in ('not_interested', 'too_costly') then
      perform app.outreach_stop(i.id, 'refused');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'refused');
    elsif v_cat = 'wrong_number' then
      perform app.outreach_stop(i.id, 'wrong_number');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'wrong_number');
    elsif v_cat = 'already_bought' then
      perform app.outreach_stop(i.id, 'already_bought');
      return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'already_bought');
    end if;
  end if;
  -- no answer, busy, voicemail, failed, or connected with nothing decided: the next attempt, or WhatsApp, or stop
  if i.attempts < (v_pol ->> 'max_attempts')::integer then
    v_next := app.outreach_slot(p_tenant_id, v_now + make_interval(hours => (v_pol ->> 'retry_gap_hours')::integer));
    update public.outreach_items set next_action = 'call', next_at = v_next, then_action = null, then_at = null where id = i.id;
    return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_next);
  end if;
  v_wa_done := exists (select 1 from public.outreach_attempts a where a.item_id = i.id and a.channel = 'whatsapp');
  if (v_pol ->> 'then_whatsapp')::boolean and not v_wa_done and (o ->> 'channel') in ('both', 'whatsapp') and (o ->> 'message_text') is not null and i.lead_id is not null then
    update public.outreach_items set next_action = 'whatsapp', next_at = v_now, then_action = null, then_at = null where id = i.id;
    return jsonb_build_object('item_id', i.id, 'status', 'waiting', 'next_at', v_now);
  end if;
  perform app.outreach_stop(i.id, 'attempts_used');
  return jsonb_build_object('item_id', i.id, 'status', 'stopped', 'reason', 'attempts_used');
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
  perform app.outreach_error('invalid');
  return null;
end;
$$;
revoke all on function public.outreach_item_result(uuid, uuid, text, jsonb, numeric, boolean) from public, anon;
grant execute on function public.outreach_item_result(uuid, uuid, text, jsonb, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. hot leads waiting for a person
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outreach_handoff_json(h public.outreach_handoffs) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', h.id, 'lead_id', h.lead_id, 'contact_id', h.contact_id, 'contact_name', (select c.full_name from public.contacts c where c.tenant_id = h.tenant_id and c.id = h.contact_id),
    'summary', h.summary, 'assigned_to', h.assigned_to, 'notified_at', h.notified_at, 'reminder_sent_at', h.reminder_sent_at, 'acted_at', h.acted_at)
$$;
revoke all on function app.outreach_handoff_json(public.outreach_handoffs) from public;

create function public.outreach_handoffs_list(p_tenant_id uuid, p_open boolean default true) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.outreach_handoff_json(h) order by h.notified_at desc, h.id)
                     from (select * from public.outreach_handoffs x where x.tenant_id = p_tenant_id and (not coalesce(p_open, true) or x.acted_at is null)
                              and (x.assigned_to = auth.uid() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]))
                            order by x.notified_at desc, x.id limit 100) h), '[]'::jsonb);
end;
$$;
revoke all on function public.outreach_handoffs_list(uuid, boolean) from public, anon;
grant execute on function public.outreach_handoffs_list(uuid, boolean) to authenticated;

create function public.outreach_handoff_acted(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.outreach_handoffs;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  select * into h from public.outreach_handoffs x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.outreach_error('reference');
  end if;
  if h.assigned_to <> auth.uid() and not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  update public.outreach_handoffs set acted_at = coalesce(acted_at, app.outbox_now()), acted_by = coalesce(acted_by, auth.uid()) where id = h.id returning * into h;
  return app.outreach_handoff_json(h);
end;
$$;
revoke all on function public.outreach_handoff_acted(uuid, uuid) from public, anon;
grant execute on function public.outreach_handoff_acted(uuid, uuid) to authenticated;

-- the worker: remind (once) the staff member who has not acted after the policy's minutes; the reminder itself is a notification (fake sender for now)
create function public.scheduler_outreach_reminders(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  h     public.outreach_handoffs;
  v_out jsonb := '[]'::jsonb;
begin
  if not app.is_scheduler() then
    perform app.outreach_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.outreach_error('invalid');
  end if;
  for h in select x.* from public.outreach_handoffs x
            where x.acted_at is null and x.reminder_sent_at is null
              and x.notified_at <= v_now - make_interval(mins => (app.outreach_pol(x.tenant_id) ->> 'handoff_reminder_minutes')::integer)
            order by x.notified_at, x.id limit p_limit for update skip locked loop
    update public.outreach_handoffs set reminder_sent_at = v_now where id = h.id returning * into h;
    v_out := v_out || jsonb_build_array(jsonb_build_object('handoff_id', h.id, 'tenant_id', h.tenant_id, 'assigned_to', h.assigned_to, 'summary', h.summary));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.scheduler_outreach_reminders(integer) from public, anon;
grant execute on function public.scheduler_outreach_reminders(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. the reports
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.outreach_report(p_tenant_id uuid, p_from date, p_to date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_from  date := coalesce(p_from, v_today - 29);
  v_to    date := coalesce(p_to, v_today);
  v_pol   jsonb;
  v_raw   jsonb;
  v_rows  jsonb;
  v_total jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.outreach_error('deny');
  end if;
  if v_to < v_from or v_to - v_from > 366 then
    perform app.outreach_error('invalid');
  end if;
  v_pol := app.outreach_pol(p_tenant_id);
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_raw from (
    select coalesce(l.source, '(list)') as source,
           count(*) filter (where i.status <> 'skipped') as leads,
           percentile_cont(0.5) within group (order by extract(epoch from (i.first_touch_at - i.arrival_at))) filter (where i.first_touch_at is not null) as ft,
           coalesce(sum((select count(*) from public.outreach_attempts a where a.tenant_id = i.tenant_id and a.item_id = i.id and a.channel = 'call')), 0)::bigint as calls,
           coalesce(sum((select count(*) from public.outreach_attempts a where a.tenant_id = i.tenant_id and a.item_id = i.id and a.channel = 'call' and a.result = 'connected')), 0)::bigint as connected,
           count(*) filter (where i.reason = 'interested')::bigint as interested,
           coalesce(sum((select count(*) from public.outcomes oc join public.outreach_attempts a on a.tenant_id = oc.tenant_id and a.id = oc.source_id
                          where a.tenant_id = i.tenant_id and a.item_id = i.id and oc.category = 'visit_booked')), 0)::bigint as bookings,
           coalesce(sum((select coalesce(sum(a.minutes), 0) from public.outreach_attempts a where a.tenant_id = i.tenant_id and a.item_id = i.id)), 0)::numeric as minutes,
           (coalesce(max(sc.cost_per_lead_paise), 0) * count(*) filter (where i.status <> 'skipped'))::bigint as lead_cost
      from public.outreach_items i
      left join public.leads l on l.tenant_id = i.tenant_id and l.id = i.lead_id
      left join public.lead_source_costs sc on sc.tenant_id = i.tenant_id and sc.source = l.source
     where i.tenant_id = p_tenant_id and (i.arrival_at at time zone 'Asia/Kolkata')::date between v_from and v_to
     group by coalesce(l.source, '(list)')) g;
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', r.source, 'leads', r.leads, 'first_touch_median_seconds', round(r.ft)::bigint, 'calls', r.calls,
           'connected_rate', case when r.calls > 0 then round(r.connected::numeric / r.calls, 3) else 0 end,
           'interested_pct', case when r.connected > 0 then round(100.0 * r.interested / r.connected, 1) else 0 end,
           'bookings', r.bookings, 'call_cost_paise', round(r.minutes * (v_pol ->> 'call_paise_per_minute')::numeric)::bigint, 'lead_cost_paise', r.lead_cost,
           'cost_per_booking_paise', case when r.bookings > 0 then round((r.minutes * (v_pol ->> 'call_paise_per_minute')::numeric + r.lead_cost) / r.bookings)::bigint end) order by r.source), '[]'::jsonb)
    into v_rows from jsonb_to_recordset(v_raw) as r(source text, leads bigint, ft numeric, calls bigint, connected bigint, interested bigint, bookings bigint, minutes numeric, lead_cost bigint);
  select jsonb_build_object(
           'leads', coalesce(sum(r.leads), 0), 'calls', coalesce(sum(r.calls), 0),
           'connected_rate', case when sum(r.calls) > 0 then round(sum(r.connected)::numeric / sum(r.calls), 3) else 0 end,
           'interested_pct', case when sum(r.connected) > 0 then round(100.0 * sum(r.interested) / sum(r.connected), 1) else 0 end,
           'bookings', coalesce(sum(r.bookings), 0), 'call_cost_paise', round(coalesce(sum(r.minutes), 0) * (v_pol ->> 'call_paise_per_minute')::numeric)::bigint, 'lead_cost_paise', coalesce(sum(r.lead_cost), 0),
           'cost_per_booking_paise', case when sum(r.bookings) > 0 then round((coalesce(sum(r.minutes), 0) * (v_pol ->> 'call_paise_per_minute')::numeric + coalesce(sum(r.lead_cost), 0)) / sum(r.bookings))::bigint end)
    into v_total from jsonb_to_recordset(v_raw) as r(source text, leads bigint, ft numeric, calls bigint, connected bigint, interested bigint, bookings bigint, minutes numeric, lead_cost bigint);
  return jsonb_build_object('from_day', v_from, 'to_day', v_to, 'by_source', v_rows, 'total', v_total);
end;
$$;
revoke all on function public.outreach_report(uuid, date, date) from public, anon;
grant execute on function public.outreach_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. Today's "Needs you": a paused batch or rule, and a hot lead nobody has called back (the function of job AY, re-created from its own definition with two more kinds)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_new text;
  v_marker constant text := E'     where v_owner and r.tenant_id = p_tenant_id and r.status = ''requested''\n  ), top as (';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'dr_speed: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, E'     where v_owner and r.tenant_id = p_tenant_id and r.status = ''requested''\n'
    || E'    union all\n'
    || E'    select ''outreach_paused'', b.id, b.name, null::text, ''followup_desk'', b.paused_reason, null::bigint, coalesce(b.paused_at, b.created_at), ''outreach_batch'', b.id\n'
    || E'      from public.outreach_batches b\n'
    || E'     where v_decider and b.tenant_id = p_tenant_id and b.status = ''paused'' and b.paused_reason in (''cap_calls'', ''cap_minutes'')\n'
    || E'    union all\n'
    || E'    select ''hot_lead_waiting'', h.id, c.full_name, null::text, ''followup_desk'', ''hot'', null::bigint, h.notified_at, ''lead'', coalesce(h.lead_id, h.contact_id)\n'
    || E'      from public.outreach_handoffs h\n'
    || E'      join public.contacts c on c.tenant_id = h.tenant_id and c.id = h.contact_id\n'
    || E'     where v_reader and h.tenant_id = p_tenant_id and (v_decider or h.assigned_to = auth.uid()) and h.acted_at is null and h.reminder_sent_at is not null\n'
    || E'  ), top as (');
  execute v_new;
end;
$$;
