-- Job CP (wave 3, C1, ADR 0086), migration 2 of 3: REMINDER CAMPAIGNS (ADR 0084 part 3). A campaign is a list of people the business already deals with, one approved WhatsApp template, and up to five steps
-- that are OFFSETS from each person's own date (3 days before, on the day, 7 days after), sent inside the business's allowed hours. REMINDERS ONLY: payment due, delivery update, fee due, event, exam, holiday.
-- Not a promotional broadcast.
--
--   public.campaigns            the campaign: kind, language, the approved template, the fixed message text with MERGE FIELDS (name, amount, due_date, reference, business), the steps, the call plan, its state
--   public.campaign_recipients  the list: one row per (campaign, contact, due date) with an amount that comes ONLY from the list or the ledger as a number (never from a model), capped at Rs 10 lakh a message
--   public.campaign_steps       one row per recipient per step: planned, then submitted to the outbox (with its deterministic message id), or skipped with a closed reason
--
-- THE MONEY RULE (owner decision, ACCEPTED pending the lawyer's confirmation; see ADR 0086): ADR 0066 holds a message with money words for a person. For a CAMPAIGN the Owner, with a second factor, approves the
-- WHOLE campaign once after seeing rendered samples (the first, the longest, the highest amount and three at random); the approval binds to a hash of the template, the steps and every row of the list, and to the
-- hash of the samples that were seen. ANY change (a word, a step, a recipient, the template) sends the campaign back to DRAFT and cancels the steps still planned. The amount is a number from the list, in a fixed slot
-- of a fixed template. Every message is an ORDINARY outbox message (category campaign_reminder) with an id derived from (campaign, recipient, step, due date), so a retry or a second worker cannot duplicate it;
-- STOP, consent, the suppression key, quiet hours, the daily limit, the global kill switch and the business's automatic-sending switch are checked PER MESSAGE by the outbox's own rules.
--
-- Who: Owner, Admin and Sales build a draft and read; only the OWNER approves (second factor); Owner and Admin pause, resume and cancel. Nobody writes a table: every write is a SECURITY DEFINER function that proves
-- the role first. Modules: `campaigns` always, and the kind's own module (payment_due: dues, delivery_update: deliveries, fee_due: fees, event/exam/holiday: programmes), so a business that is not on that pack
-- never sees the kind. A model never reads these tables.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM701 module off, SM801 not in a state that allows this, SM802 the samples changed since they were seen (stale),
-- SM803 not ready to approve (DETAIL names the first problem).

create function app.campaign_error(p_kind text, p_detail text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for another record' using errcode = '23505';
    when 'state'     then raise exception 'the campaign is not in a state that allows this' using errcode = 'SM801';
    when 'stale'     then raise exception 'the samples changed since they were seen' using errcode = 'SM802';
    when 'ready'     then raise exception 'the campaign is not ready to approve' using errcode = 'SM803', detail = p_detail;
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.campaign_error(text, text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- pure helpers: money and date words, merge fields, the shape of the steps
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Rs 1,23,456.00 (Indian grouping, always two decimals)
create function app.format_inr(p_paise bigint) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_paise is null then null
              else '₹' || case when p_paise / 100 < 1000 then (p_paise / 100)::text
                               else regexp_replace(left((p_paise / 100)::text, -3), '(\d)(?=(\d\d)+$)', E'\\1,', 'g') || ',' || right((p_paise / 100)::text, 3) end
                   || '.' || lpad((p_paise % 100)::text, 2, '0') end
$$;
revoke all on function app.format_inr(bigint) from public;

create function app.campaign_money_kind(p_kind text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p_kind in ('payment_due', 'fee_due') $$;
revoke all on function app.campaign_money_kind(text) from public;

-- the module a kind needs besides `campaigns` (reminders only; the matrix of the blueprint: construction has payment due and delivery, education has fee due, events, exams and holidays)
create function app.campaign_kind_module(p_kind text) returns text
language sql
immutable
set search_path = ''
as $$ select case p_kind when 'payment_due' then 'dues' when 'delivery_update' then 'deliveries' when 'fee_due' then 'fees' when 'event' then 'programmes' when 'exam' then 'programmes' when 'holiday' then 'programmes' end $$;
revoke all on function app.campaign_kind_module(text) from public;

-- the merge fields a text uses
create function app.campaign_fields(p_text text) returns text[]
language sql
immutable
set search_path = ''
as $$ select coalesce(array(select distinct m[1] from regexp_matches(coalesce(p_text, ''), '\{\{([a-z_]+)\}\}', 'g') m order by 1), '{}'::text[]) $$;
revoke all on function app.campaign_fields(text) from public;

-- One text per campaign, in a fixed shape. null when the text is allowed, else ONE closed word saying why not:
--   bad_field (a brace that is not one of the five merge fields)  amount_not_allowed (a kind that is not about money)  link_not_allowed  line_break  text_words (a money, promise or complaint word
--   beyond what the kind allows: a money kind may hold money words only; the other kinds none)
create function app.campaign_text_check(p_kind text, p_text text) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_fields text[] := app.campaign_fields(p_text);
  v_rest   text;
  v_sample text;
  v_flags  text[];
begin
  if p_text is null or char_length(p_text) not between 8 and 600 or not app.text_is_clean(p_text) then
    return 'text_words';
  end if;
  v_rest := regexp_replace(p_text, '\{\{[a-z_]+\}\}', '', 'g');
  if v_rest ~ '[{}]' or exists (select 1 from unnest(v_fields) f where f not in ('name', 'amount', 'due_date', 'reference', 'business')) then
    return 'bad_field';
  end if;
  if 'amount' = any (v_fields) and not app.campaign_money_kind(p_kind) then
    return 'amount_not_allowed';
  end if;
  if p_text ~* '(https?:|www\.|\.com\M|\.in\M)' then
    return 'link_not_allowed';
  end if;
  if p_text ~ E'[\\n\\r\\t]' then
    return 'line_break';
  end if;
  v_sample := replace(replace(replace(replace(replace(p_text, '{{name}}', 'Asha'), '{{amount}}', '₹1,000.00'), '{{due_date}}', '05 Nov 2026'), '{{reference}}', 'T1'), '{{business}}', 'Shop');
  v_flags := app.outbox_content_flags(v_sample);
  if app.campaign_money_kind(p_kind) then
    v_flags := array_remove(v_flags, 'money');
  end if;
  if cardinality(v_flags) > 0 then
    return 'text_words';
  end if;
  return null;
end;
$$;
revoke all on function app.campaign_text_check(text, text) from public;

-- fills the fixed text from ONE recipient's own values; nothing else is ever substituted
create function app.campaign_render(p_text text, p_name text, p_amount bigint, p_due date, p_ref text, p_business text) returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(p_text,
           '{{name}}', coalesce(p_name, '')),
           '{{amount}}', coalesce(app.format_inr(p_amount), '')),
           '{{due_date}}', coalesce(to_char(p_due, 'DD Mon YYYY'), '')),
           '{{reference}}', coalesce(p_ref, '')),
           '{{business}}', coalesce(p_business, ''))
$$;
revoke all on function app.campaign_render(text, text, bigint, date, text, text) from public;

-- up to five steps, each {"offset_days": -60..180, "time": "HH:MM"}, in strictly increasing order
create function app.campaign_steps_valid(j jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'array' and jsonb_array_length(j) between 1 and 5
     and not exists (select 1 from jsonb_array_elements(j) e
                      where jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2 or not (e ? 'offset_days') or not (e ? 'time')
                         or jsonb_typeof(e -> 'offset_days') <> 'number' or (e ->> 'offset_days') !~ '^-?[0-9]{1,3}$'
                         or jsonb_typeof(e -> 'time') <> 'string' or (e ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     and not exists (select 1 from (select (e ->> 'offset_days')::int as d, e ->> 'time' as t,
                                           lag((e ->> 'offset_days')::int) over (order by n) as pd, lag(e ->> 'time') over (order by n) as pt
                                      from jsonb_array_elements(j) with ordinality as x(e, n)) y
                      where y.d not between -60 and 180 or (y.pd is not null and (y.d, y.t) <= (y.pd, y.pt)))
$$;
revoke all on function app.campaign_steps_valid(jsonb) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.campaigns (
  id                   uuid primary key,
  tenant_id            uuid not null references public.tenants (id) on delete restrict,
  name                 text not null check (char_length(btrim(name)) between 1 and 100 and app.text_is_clean(name)),
  kind                 text not null check (kind in ('payment_due', 'delivery_update', 'fee_due', 'event', 'exam', 'holiday')),
  status               text not null default 'draft' check (status in ('draft', 'approved', 'running', 'paused', 'done', 'cancelled')),
  language             text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  wa_template_id       uuid,
  message_text         text not null check (char_length(message_text) between 8 and 600 and app.text_is_clean(message_text)),
  steps                jsonb not null check (app.campaign_steps_valid(steps) and app.text_is_clean(steps)),
  call_after_step      smallint check (call_after_step between 1 and 5),
  call_wait_hours      smallint not null default 24 check (call_wait_hours between 1 and 168),
  audience_kind        text not null default 'import' check (audience_kind in ('import', 'filter')),
  audience_filter      jsonb check (audience_filter is null or (jsonb_typeof(audience_filter) = 'object' and app.text_is_clean(audience_filter))),
  content_sha256       text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  samples_sha256       text check (samples_sha256 ~ '^[0-9a-f]{64}$'),
  approved_recipients  integer,
  approved_total_paise bigint,
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  approved_by          uuid,
  approved_at          timestamptz,
  paused_at            timestamptz,
  cancelled_at         timestamptz,
  completed_at         timestamptz,
  unique (tenant_id, id),
  check ((approved_at is null) = (approved_by is null)),
  check (status <> 'draft' or approved_at is null),
  check (status not in ('approved', 'running', 'paused', 'done') or approved_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null)
);
create index campaigns_keyset_idx on public.campaigns (tenant_id, created_at, id);
create index campaigns_active_idx on public.campaigns (tenant_id, status) where status in ('approved', 'running');
comment on column public.campaigns.name is 'PII: the name the owner gave the campaign; it can name a person. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.campaigns.message_text is 'PII: the fixed text with merge fields, written by the owner; it can name a person. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.campaigns.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.campaigns.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.campaigns.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.campaigns.steps is 'SAFE: up to five {offset_days, time} pairs, shape checked by a CHECK function';
comment on column public.campaigns.audience_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.campaigns.audience_filter is 'SAFE: the ledger filter that built the list (dates and amounts)';
comment on column public.campaigns.content_sha256 is 'SAFE: a hash. CLEAN-EXEMPT: hex digits only';
comment on column public.campaigns.samples_sha256 is 'SAFE: a hash. CLEAN-EXEMPT: hex digits only';

create table public.campaign_recipients (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  campaign_id uuid not null,
  contact_id  uuid not null,
  lead_id     uuid not null,
  due_date    date not null check (due_date between date '2020-01-01' and date '2100-12-31'),
  amount_paise bigint check (amount_paise between 1 and 100000000),
  reference   text check (reference ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$'),
  account_id  uuid,
  row_hash    text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  closed_at   timestamptz,
  closed_reason text check (closed_reason in ('paid', 'promised', 'wrong_number', 'stopped')),
  promised_on date,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, campaign_id, contact_id, due_date),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, account_id) references public.ledger_accounts (tenant_id, id),
  check ((closed_at is null) = (closed_reason is null)),
  check (promised_on is null or closed_reason = 'promised')
);
create unique index campaign_recipients_seq_key on public.campaign_recipients (seq);
create index campaign_recipients_campaign_idx on public.campaign_recipients (tenant_id, campaign_id, seq);
create index campaign_recipients_contact_idx on public.campaign_recipients (tenant_id, contact_id);
create index campaign_recipients_lead_idx on public.campaign_recipients (tenant_id, lead_id);
create index campaign_recipients_account_idx on public.campaign_recipients (tenant_id, account_id) where account_id is not null;
comment on column public.campaign_recipients.reference is 'SAFE: a short label such as a fee head or an invoice number (letters, digits, / . _ - and spaces). CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.campaign_recipients.row_hash is 'SAFE: a hash. CLEAN-EXEMPT: hex digits only';
comment on column public.campaign_recipients.closed_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.campaign_steps (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  campaign_id       uuid not null,
  recipient_id      uuid not null,
  step_no           smallint not null check (step_no between 1 and 5),
  scheduled_for     timestamptz not null,
  status            text not null default 'planned' check (status in ('planned', 'submitted', 'skipped')),
  reason            text check (reason in ('past', 'missed', 'changed', 'cancelled', 'recipient_closed', 'promised', 'paid', 'balance_changed', 'template')),
  outbox_message_id uuid,
  materialised_at   timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, recipient_id, step_no),
  unique (tenant_id, outbox_message_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, recipient_id) references public.campaign_recipients (tenant_id, id),
  foreign key (tenant_id, outbox_message_id) references public.outbox_messages (tenant_id, id),
  check ((status = 'submitted') = (outbox_message_id is not null)),
  check ((status = 'skipped') = (reason is not null)),
  check ((status = 'planned') = (materialised_at is null))
);
create index campaign_steps_due_idx on public.campaign_steps (tenant_id, scheduled_for) where status = 'planned';
create index campaign_steps_campaign_idx on public.campaign_steps (tenant_id, campaign_id, scheduled_for, id);
comment on column public.campaign_steps.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.campaign_steps.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- the module now has guarded tables (job CP): the three tables above and the call list (migration 3)
alter table packs.modules disable trigger modules_immutable;
update packs.modules set guard = 'tables', description = 'Reminder campaigns: one approval per campaign, a call list and results (reminders only, no promotions)' where code = 'campaigns';
alter table packs.modules enable trigger modules_immutable;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- guards: a campaign that was approved changes its CONTENT only by going back to draft; the list changes only in a draft; steps move forward only
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.campaigns_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'a campaign is never deleted: cancel it' using errcode = '42501';
  end if;
  if old.status in ('done', 'cancelled') and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'a finished campaign stays as it is' using errcode = '42501';
  end if;
  if new.status <> 'draft'
     and (new.kind, new.language, new.wa_template_id, new.message_text, new.steps, new.call_after_step, new.call_wait_hours, new.audience_kind, new.audience_filter)
         is distinct from (old.kind, old.language, old.wa_template_id, old.message_text, old.steps, old.call_after_step, old.call_wait_hours, old.audience_kind, old.audience_filter) then
    raise exception 'a campaign that was approved changes its content only after going back to draft' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('approved', 'cancelled'))
    or (old.status = 'approved' and new.status in ('running', 'paused', 'draft', 'cancelled', 'done'))
    or (old.status = 'running' and new.status in ('paused', 'draft', 'cancelled', 'done'))
    or (old.status = 'paused' and new.status in ('approved', 'running', 'draft', 'cancelled'))) then
    raise exception 'a campaign cannot move from % to %', old.status, new.status using errcode = '42501';
  end if;
  if new.kind is distinct from old.kind or new.created_by is distinct from old.created_by then
    raise exception 'the kind of a campaign does not change' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.campaigns_guard() from public;
create trigger campaigns_guard before update or delete on public.campaigns for each row execute function app.campaigns_guard();
create trigger campaigns_no_truncate before truncate on public.campaigns for each statement execute function app.campaigns_guard();

create function app.campaign_recipients_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_tenant uuid;
  v_campaign uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'recipients are never truncated' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'closed_at' - 'closed_reason' - 'promised_on') is not distinct from (to_jsonb(old) - 'closed_at' - 'closed_reason' - 'promised_on') then
      if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
        raise exception 'a closed recipient stays closed' using errcode = '42501';
      end if;
      return new;  -- closing a recipient (a call outcome, a payment) is the one change a running campaign allows
    end if;
  end if;
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id; v_campaign := old.campaign_id;
  else
    v_tenant := new.tenant_id; v_campaign := new.campaign_id;
  end if;
  select c.status into v_status from public.campaigns c where c.tenant_id = v_tenant and c.id = v_campaign;
  if v_status is not null and v_status <> 'draft' then  -- (no campaign row yet visible: the foreign key decides)
    raise exception 'the list of a campaign changes only while it is a draft' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function app.campaign_recipients_guard() from public;
create trigger campaign_recipients_guard before insert or update or delete on public.campaign_recipients for each row execute function app.campaign_recipients_guard();
create trigger campaign_recipients_no_truncate before truncate on public.campaign_recipients for each statement execute function app.campaign_recipients_guard();

create function app.campaign_steps_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'steps are never truncated' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'submitted' then
      raise exception 'a step that was sent to the outbox stays on record' using errcode = '42501';
    end if;
    return old;
  end if;
  if to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;
  if old.status <> 'planned' or new.status = 'planned'
     or (to_jsonb(new) - 'status' - 'reason' - 'outbox_message_id' - 'materialised_at') is distinct from (to_jsonb(old) - 'status' - 'reason' - 'outbox_message_id' - 'materialised_at') then
    raise exception 'a step moves forward once, from planned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.campaign_steps_guard() from public;
create trigger campaign_steps_guard before update or delete on public.campaign_steps for each row execute function app.campaign_steps_guard();
create trigger campaign_steps_no_truncate before truncate on public.campaign_steps for each statement execute function app.campaign_steps_guard();

create trigger campaigns_forbid_tenant_id_change before update on public.campaigns for each row execute function app.forbid_tenant_id_change();
create trigger campaign_recipients_forbid_tenant_id_change before update on public.campaign_recipients for each row execute function app.forbid_tenant_id_change();
create trigger campaign_steps_forbid_tenant_id_change before update on public.campaign_steps for each row execute function app.forbid_tenant_id_change();
create trigger campaigns_set_updated_at before update on public.campaigns for each row execute function app.set_updated_at();
create trigger module_guard before insert on public.campaigns for each row execute function app.module_guard('campaigns');
create trigger module_guard before insert on public.campaign_recipients for each row execute function app.module_guard('campaigns');
create trigger module_guard before insert on public.campaign_steps for each row execute function app.module_guard('campaigns');
create trigger audit_campaigns after insert or update or delete on public.campaigns for each row execute function app.audit_row_change('campaign', 'name,message_text');
create trigger audit_campaign_recipients after insert or update or delete on public.campaign_recipients for each row execute function app.audit_row_change('campaign_recipient', '');
create trigger audit_campaign_steps after insert or update or delete on public.campaign_steps for each row execute function app.audit_row_change('campaign_step', '');

do $$
declare t text;
begin
  foreach t in array array['campaigns', 'campaign_recipients', 'campaign_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;

-- erasure (ADR 0014): the owner's words in the name and the text, in the tenant scope and the sweep
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('campaigns', 'name',         'tenant', 'tombstone', 'erased:1'),
  ('campaigns', 'message_text', 'tenant', 'tombstone', 'erased:1'),
  ('campaigns', 'name',         'sweep',  'substring', 'erased:1'),
  ('campaigns', 'message_text', 'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the outbox and the templates learn the reminder (nothing else about them changes)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.outbox_messages drop constraint outbox_messages_category_check;
alter table public.outbox_messages add constraint outbox_messages_category_check check (category in ('reply_to_inbound', 'info', 'visit', 'followup', 'order_status', 'other', 'campaign_reminder'));
alter table public.outbox_messages drop constraint outbox_messages_reason_check;
alter table public.outbox_messages add constraint outbox_messages_reason_check check (reason in ('auto_allowed', 'quiet_hours', 'owner_approved', 'money', 'commitment', 'complaint', 'model_flagged', 'uncertain',
                                                   'category_other', 'no_inbound_window', 'auto_off', 'switch_off', 'no_contact', 'no_phone', 'stopped', 'erased',
                                                   'no_opt_in', 'no_key', 'daily_limit', 'owner_rejected', 'send_failed', 'campaign_approved'));
alter table integrations.wa_templates drop constraint wa_templates_purpose_check;
alter table integrations.wa_templates add constraint wa_templates_purpose_check check (purpose in ('visit', 'followup', 'order_status', 'info', 'reminder'));

-- what the adapter is told about one claimed message (job BR), with ONE addition: a campaign reminder uses the template its campaign names (and only if it is approved)
create or replace function app.wa_send_context(m public.outbox_messages, p_now timestamptz) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
  v_last timestamptz;
  v_open boolean;
  t integrations.wa_templates;
  v_purpose text;
begin
  select * into a from integrations.whatsapp_accounts x where x.tenant_id = m.tenant_id and x.status = 'active';
  if not found then
    return null;
  end if;
  v_last := app.wa_last_inbound(m.tenant_id, m.lead_id, p_now);
  v_open := v_last is not null and v_last > p_now - interval '24 hours';
  if m.category = 'campaign_reminder' then
    select w.* into t from public.campaign_steps s join public.campaigns c on c.tenant_id = s.tenant_id and c.id = s.campaign_id
      join integrations.wa_templates w on w.tenant_id = c.tenant_id and w.id = c.wa_template_id
     where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id and w.status = 'approved' and w.language = m.language;
  else
    v_purpose := case m.category when 'visit' then 'visit' when 'followup' then 'followup' when 'order_status' then 'order_status' when 'info' then 'info' else null end;
    if v_purpose is not null then
      select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = v_purpose and x.language = m.language and x.status = 'approved'
       order by x.created_at, x.id limit 1;
    end if;
  end if;
  return jsonb_build_object(
    'phone_number_id', a.phone_number_id, 'token_ref', a.token_ref, 'coexistence', a.coexistence,
    'window_open', v_open, 'window_expires_at', case when v_open then v_last + interval '24 hours' end,
    'template', case when t.id is null then null else jsonb_build_object('name', t.name, 'language', t.language, 'body', t.body) end);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- internals: the lead a message hangs on, the hashes the approval binds to, the samples, what is still wrong, going back to draft
-- ---------------------------------------------------------------------------------------------------------------------------------
-- an outbox message hangs on a lead: the contact's newest open lead, or (for a contact that belongs to a company) a new one marked as made for a campaign. null when there is neither.
create function app.campaign_lead_for(p_tenant uuid, p_contact uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lead uuid;
  v_company uuid;
begin
  select l.id into v_lead from public.leads l where l.tenant_id = p_tenant and l.contact_id = p_contact and l.archived_at is null order by l.created_at desc, l.id desc limit 1;
  if v_lead is not null then
    return v_lead;
  end if;
  select c.company_id into v_company from public.contacts c where c.tenant_id = p_tenant and c.id = p_contact;
  if v_company is null then
    return null;
  end if;
  insert into public.leads (tenant_id, company_id, contact_id, source) values (p_tenant, v_company, p_contact, 'campaign') returning id into v_lead;
  return v_lead;
end;
$$;
revoke all on function app.campaign_lead_for(uuid, uuid) from public, anon, authenticated, service_role;

-- the hash the approval binds to: every word that can reach a person, the steps, the call plan, the template, and every row of the list
create function app.campaign_content_sha(p_tenant uuid, p_campaign uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(
           concat_ws('|', c.kind, c.language, coalesce(c.wa_template_id::text, ''), coalesce((select w.body from integrations.wa_templates w where w.tenant_id = c.tenant_id and w.id = c.wa_template_id), ''),
                     c.message_text, c.steps::text, coalesce(c.call_after_step::text, ''), c.call_wait_hours::text)
           || '#' || coalesce((select string_agg(r.row_hash, ',' order by r.contact_id, r.due_date) from public.campaign_recipients r where r.tenant_id = c.tenant_id and r.campaign_id = c.id), ''), 'UTF8')), 'hex')
    from public.campaigns c where c.tenant_id = p_tenant and c.id = p_campaign
$$;
revoke all on function app.campaign_content_sha(uuid, uuid) from public, anon, authenticated, service_role;

-- the rendered samples the Owner sees before approving: the FIRST recipient, the one with the LONGEST message, the one with the HIGHEST amount, and three AT RANDOM (chosen from the content hash, so the same
-- list shows the same three; a different list shows others). A recipient that is two of these appears once with both labels.
create function app.campaign_samples(p_tenant uuid, p_campaign uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from public.campaigns x where x.tenant_id = p_tenant and x.id = p_campaign),
       sha as (select app.campaign_content_sha(p_tenant, p_campaign) as v),
       rr as (select r.id, r.seq, r.amount_paise, r.due_date,
                     app.campaign_render(c.message_text, ct.full_name, r.amount_paise, r.due_date, r.reference, (select t.name from public.tenants t where t.id = p_tenant)) as body
                from public.campaign_recipients r join public.contacts ct on ct.tenant_id = r.tenant_id and ct.id = r.contact_id cross join c
               where r.tenant_id = p_tenant and r.campaign_id = p_campaign),
       f as (select id from rr order by seq limit 1),
       l as (select id from rr order by char_length(body) desc, seq limit 1),
       h as (select id from rr order by coalesce(amount_paise, 0) desc, seq limit 1),
       rd as (select id from rr where id not in (select id from f union select id from l union select id from h) order by md5((select v from sha) || id::text), seq limit 3)
  select coalesce(jsonb_agg(jsonb_build_object('recipient_id', z.id, 'labels', z.labels, 'body', z.body, 'amount_paise', z.amount_paise, 'due_date', z.due_date) order by z.ord, z.seq), '[]'::jsonb)
    from (select r.id, r.seq, r.body, r.amount_paise, r.due_date,
                 array_remove(array[case when r.id in (select id from f) then 'first' end, case when r.id in (select id from l) then 'longest' end,
                                    case when r.id in (select id from h) then 'highest_amount' end, case when r.id in (select id from rd) then 'random' end], null) as labels,
                 least(case when r.id in (select id from f) then 1 end, case when r.id in (select id from l) then 2 end, case when r.id in (select id from h) then 3 end,
                       case when r.id in (select id from rd) then 4 end) as ord
            from rr r
           where r.id in (select id from f) or r.id in (select id from l) or r.id in (select id from h) or r.id in (select id from rd)) z
$$;
revoke all on function app.campaign_samples(uuid, uuid) from public, anon, authenticated, service_role;

create function app.campaign_samples_sha(p_samples jsonb) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(coalesce((select string_agg((e ->> 'recipient_id') || ':' || (e ->> 'body'), '|' order by ord) from jsonb_array_elements(p_samples) with ordinality x(e, ord)), ''), 'UTF8')), 'hex') $$;
revoke all on function app.campaign_samples_sha(jsonb) from public;

-- what still stands between a draft and its approval, as closed words (empty = ready)
create function app.campaign_issues(p_tenant uuid, p_campaign uuid) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.campaigns;
  t        integrations.wa_templates;
  v_out    text[] := '{}';
  v_fields text[];
  v_word   text;
  v_n      integer;
begin
  select * into c from public.campaigns x where x.tenant_id = p_tenant and x.id = p_campaign;
  select count(*) into v_n from public.campaign_recipients r where r.tenant_id = p_tenant and r.campaign_id = p_campaign;
  if v_n = 0 then
    v_out := array_append(v_out, 'no_recipients');
  elsif v_n > 5000 then
    v_out := array_append(v_out, 'too_many_recipients');
  end if;
  if c.wa_template_id is null then
    v_out := array_append(v_out, 'no_template');
  else
    select * into t from integrations.wa_templates w where w.tenant_id = p_tenant and w.id = c.wa_template_id;
    if not found then
      v_out := array_append(v_out, 'no_template');
    elsif t.status <> 'approved' then
      v_out := array_append(v_out, 'template_not_approved');
    elsif t.language <> c.language then
      v_out := array_append(v_out, 'template_language');
    elsif t.purpose <> 'reminder' then
      v_out := array_append(v_out, 'template_purpose');
    end if;
  end if;
  v_word := app.campaign_text_check(c.kind, c.message_text);
  if v_word is not null then
    v_out := v_out || v_word;
  end if;
  v_fields := app.campaign_fields(c.message_text);
  if 'amount' = any (v_fields) and exists (select 1 from public.campaign_recipients r where r.tenant_id = p_tenant and r.campaign_id = p_campaign and r.amount_paise is null) then
    v_out := array_append(v_out, 'recipient_missing_amount');
  end if;
  if 'reference' = any (v_fields) and exists (select 1 from public.campaign_recipients r where r.tenant_id = p_tenant and r.campaign_id = p_campaign and r.reference is null) then
    v_out := array_append(v_out, 'recipient_missing_reference');
  end if;
  if not app.campaign_money_kind(c.kind) and exists (select 1 from public.campaign_recipients r where r.tenant_id = p_tenant and r.campaign_id = p_campaign and r.amount_paise is not null) then
    v_out := array_append(v_out, 'amount_not_allowed');
  end if;
  if exists (select 1 from jsonb_array_elements(c.steps) e where app.outbox_in_quiet_hours(((date '2026-01-05' + (e ->> 'time')::time) at time zone 'Asia/Kolkata'), p_tenant)) then
    v_out := array_append(v_out, 'step_in_quiet_hours');
  end if;
  if c.call_after_step is not null and (not app.campaign_money_kind(c.kind) or c.call_after_step > jsonb_array_length(c.steps)) then
    v_out := array_append(v_out, 'call_plan_invalid');
  end if;
  if v_n > 0 and not exists (select 1 from public.campaign_recipients r cross join jsonb_array_elements(c.steps) e
                              where r.tenant_id = p_tenant and r.campaign_id = p_campaign and r.closed_at is null
                                and (((r.due_date + (e ->> 'offset_days')::int) + (e ->> 'time')::time) at time zone 'Asia/Kolkata') > app.outbox_now()) then
    v_out := array_append(v_out, 'no_future_step');
  end if;
  return v_out;
end;
$$;
revoke all on function app.campaign_issues(uuid, uuid) from public, anon, authenticated, service_role;

-- ANY change after approval sends the campaign back to draft: the steps still planned or skipped are removed (the ones already handed to the outbox stay on record)
create function app.campaign_reset(p_tenant uuid, p_campaign uuid, p_reason text) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  select * into c from public.campaigns x where x.tenant_id = p_tenant and x.id = p_campaign for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if c.status in ('done', 'cancelled') then
    perform app.campaign_error('state');
  end if;
  if c.status = 'draft' then
    return false;
  end if;
  delete from public.campaign_steps s where s.tenant_id = p_tenant and s.campaign_id = p_campaign and s.status in ('planned', 'skipped');
  update public.campaigns set status = 'draft', approved_by = null, approved_at = null, content_sha256 = null, samples_sha256 = null, approved_recipients = null, approved_total_paise = null, paused_at = null
   where id = c.id;
  perform app.write_audit_event(p_tenant, 'campaign.back_to_draft', 'campaign', p_campaign, null, jsonb_build_object('because', p_reason, 'was', c.status));
  return true;
end;
$$;
revoke all on function app.campaign_reset(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the campaign itself
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.campaign_json(c public.campaigns) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'kind', c.kind, 'status', c.status, 'language', c.language, 'wa_template_id', c.wa_template_id, 'message_text', c.message_text, 'steps', c.steps,
    'call_after_step', c.call_after_step, 'call_wait_hours', c.call_wait_hours, 'audience_kind', c.audience_kind, 'audience_filter', c.audience_filter,
    'approved_by', c.approved_by, 'approved_at', c.approved_at, 'approved_recipients', c.approved_recipients, 'approved_total_paise', c.approved_total_paise,
    'created_at', c.created_at, 'updated_at', c.updated_at, 'paused_at', c.paused_at, 'cancelled_at', c.cancelled_at, 'completed_at', c.completed_at,
    'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = c.tenant_id and r.campaign_id = c.id),
    'total_amount_paise', (select coalesce(sum(r.amount_paise), 0) from public.campaign_recipients r where r.tenant_id = c.tenant_id and r.campaign_id = c.id))
$$;
revoke all on function app.campaign_json(public.campaigns) from public, anon, authenticated, service_role;

-- Create or change a campaign (PUT: the caller's id, so a retry is safe). A change to a campaign that was approved sends it back to draft.
create function public.campaign_save(
  p_campaign_id uuid, p_tenant_id uuid, p_name text, p_kind text, p_language text, p_wa_template_id uuid, p_message_text text, p_steps jsonb,
  p_call_after_step integer default null, p_call_wait_hours integer default 24
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_text text := btrim(coalesce(p_message_text, ''));
  c      public.campaigns;
  v_new  boolean := false;
  v_back boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_kind is null or app.campaign_kind_module(p_kind) is null or p_language is null or p_steps is null or p_call_wait_hours is null
     or p_call_wait_hours not between 1 and 168 or (p_call_after_step is not null and p_call_after_step not between 1 and 5) then
    perform app.campaign_error('invalid');
  end if;
  perform app.require_module(p_tenant_id, app.campaign_kind_module(p_kind));
  if p_wa_template_id is not null and not exists (select 1 from integrations.wa_templates w where w.tenant_id = p_tenant_id and w.id = p_wa_template_id) then
    perform app.campaign_error('reference');
  end if;
  select * into c from public.campaigns x where x.id = p_campaign_id;
  if found then
    if c.tenant_id <> p_tenant_id or c.kind <> p_kind then
      perform app.campaign_error('conflict');
    end if;
    if c.status in ('done', 'cancelled') then
      perform app.campaign_error('state');
    end if;
    if (c.language, c.wa_template_id, c.message_text, c.steps, c.call_after_step, c.call_wait_hours) is distinct from (p_language, p_wa_template_id, v_text, p_steps, p_call_after_step, p_call_wait_hours) then
      v_back := app.campaign_reset(p_tenant_id, p_campaign_id, 'changed');
    end if;
    begin
      update public.campaigns set name = v_name, language = p_language, wa_template_id = p_wa_template_id, message_text = v_text, steps = p_steps, call_after_step = p_call_after_step, call_wait_hours = p_call_wait_hours
       where id = p_campaign_id returning * into c;
    exception when check_violation then perform app.campaign_error('invalid');
    end;
  else
    v_new := true;
    begin
      insert into public.campaigns (id, tenant_id, name, kind, language, wa_template_id, message_text, steps, call_after_step, call_wait_hours, created_by)
      values (p_campaign_id, p_tenant_id, v_name, p_kind, p_language, p_wa_template_id, v_text, p_steps, p_call_after_step, p_call_wait_hours, v_uid) returning * into c;
    exception when check_violation then perform app.campaign_error('invalid');
    end;
  end if;
  return jsonb_build_object('campaign', app.campaign_json(c), 'created', v_new, 'back_to_draft', v_back);
end;
$$;
revoke all on function public.campaign_save(uuid, uuid, text, text, text, uuid, text, jsonb, integer, integer) from public, anon;
grant execute on function public.campaign_save(uuid, uuid, text, text, text, uuid, text, jsonb, integer, integer) to authenticated;

create function public.campaign_get(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id;
  if not found then
    perform app.campaign_error('reference');
  end if;
  return app.campaign_json(c) || jsonb_build_object('issues', to_jsonb(case when c.status = 'draft' then app.campaign_issues(p_tenant_id, c.id) else '{}'::text[] end),
                                                    'sending_on', app.scheduler_tenant_on(p_tenant_id));
end;
$$;
revoke all on function public.campaign_get(uuid, uuid) from public, anon;
grant execute on function public.campaign_get(uuid, uuid) to authenticated;

create function public.campaigns_list(p_tenant_id uuid, p_status text default null, p_limit integer default 50, p_after_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_at is null) <> (p_after_id is null)) or (p_status is not null and p_status not in ('draft', 'approved', 'running', 'paused', 'done', 'cancelled')) then
    perform app.campaign_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(app.campaign_json(c) order by c.created_at desc, c.id desc)
      from public.campaigns c
     where c.tenant_id = p_tenant_id
       and c.id in (select k.id from public.campaigns k
                     where k.tenant_id = p_tenant_id and (p_status is null or k.status = p_status) and (p_after_at is null or (k.created_at, k.id) < (p_after_at, p_after_id))
                     order by k.created_at desc, k.id desc limit p_limit)), '[]'::jsonb);
end;
$$;
revoke all on function public.campaigns_list(uuid, text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.campaigns_list(uuid, text, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the list
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Add people by IMPORT: up to 500 rows [{contact_id | phone, due_date, amount_paise?, reference?}]. A phone number only finds an existing contact of this business (it is not stored); a row that cannot be added is
-- skipped and reported. A repeat adds nothing (one row per contact and due date). Adding to a campaign that was approved sends it back to draft.
create function public.campaign_recipients_add(p_tenant_id uuid, p_campaign_id uuid, p_rows jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  c         public.campaigns;
  v_row     jsonb;
  v_i       integer := 0;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_contact uuid;
  v_n       integer;
  v_digits  text;
  v_due     date;
  v_amount  bigint;
  v_ref     text;
  v_lead    uuid;
  v_fields  text[];
  v_reason  text;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    perform app.campaign_error('invalid');
  end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  perform app.require_module(p_tenant_id, app.campaign_kind_module(c.kind));
  perform app.campaign_reset(p_tenant_id, p_campaign_id, 'list_changed');
  v_fields := app.campaign_fields(c.message_text);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_reason := null;
    begin
      v_contact := null;
      if jsonb_typeof(v_row) <> 'object' then
        v_reason := 'invalid_row';
      elsif nullif(v_row ->> 'contact_id', '') is not null then
        select ct.id into v_contact from public.contacts ct where ct.tenant_id = p_tenant_id and ct.id = (v_row ->> 'contact_id')::uuid and ct.erased_at is null;
        if v_contact is null then v_reason := 'contact_not_found'; end if;
      elsif nullif(v_row ->> 'phone', '') is not null then
        v_digits := right(regexp_replace(v_row ->> 'phone', '[^0-9]', '', 'g'), 10);
        if char_length(v_digits) < 10 then
          v_reason := 'invalid_row';
        else
          select count(*), min(ct.id::text)::uuid into v_n, v_contact from public.contacts ct
           where ct.tenant_id = p_tenant_id and ct.erased_at is null and ct.phone is not null and right(regexp_replace(ct.phone, '[^0-9]', '', 'g'), 10) = v_digits;
          if v_n = 0 then v_reason := 'contact_not_found'; v_contact := null;
          elsif v_n > 1 then v_reason := 'ambiguous_contact'; v_contact := null; end if;
        end if;
      else
        v_reason := 'invalid_row';
      end if;
      if v_reason is null then
        v_due := (v_row ->> 'due_date')::date;
        v_amount := nullif(v_row ->> 'amount_paise', '')::bigint;
        v_ref := nullif(btrim(coalesce(v_row ->> 'reference', '')), '');
        if v_due is null then
          v_reason := 'invalid_row';
        elsif v_amount is not null and not app.campaign_money_kind(c.kind) then
          v_reason := 'amount_not_allowed';
        elsif 'amount' = any (v_fields) and v_amount is null then
          v_reason := 'amount_required';
        elsif 'reference' = any (v_fields) and v_ref is null then
          v_reason := 'reference_required';
        end if;
      end if;
      if v_reason is null then
        v_lead := app.campaign_lead_for(p_tenant_id, v_contact);
        if v_lead is null then
          v_reason := 'no_lead';
        elsif (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id) >= 5000 then
          v_reason := 'list_full';
        else
          insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, reference, row_hash, created_by)
          values (p_tenant_id, p_campaign_id, v_contact, v_lead, v_due, v_amount, v_ref,
                  encode(sha256(convert_to(concat_ws('|', v_contact, v_due, coalesce(v_amount::text, ''), coalesce(v_ref, ''), ''), 'UTF8')), 'hex'), v_uid);
          v_added := v_added + 1;
        end if;
      end if;
    exception
      when unique_violation then v_reason := 'duplicate';
      when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or null_value_not_allowed then v_reason := 'invalid_row';
    end;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', v_reason);
    end if;
  end loop;
  update public.campaigns set audience_kind = 'import', audience_filter = null where id = p_campaign_id and (audience_kind <> 'import' or audience_filter is not null);
  return jsonb_build_object('added', v_added, 'skipped', v_skipped,
                            'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id));
end;
$$;
revoke all on function public.campaign_recipients_add(uuid, uuid, jsonb) from public, anon;
grant execute on function public.campaign_recipients_add(uuid, uuid, jsonb) to authenticated;

-- Build the list from the LEDGER: every party with money open on claims due in a date range (`due_from` .. `due_to`, at most 400 days), optionally only `party` company|contact and only at least `min_open_paise`.
-- One recipient per account: the amount is the open total of the claims in the range (a number from the ledger, never a model's), the date is the earliest due date, the reference is the claim's own when there is
-- exactly one. A company's reminder goes to its first contact that has a number and is not stopped; a party with no such contact is skipped and reported.
create function public.campaign_recipients_from_ledger(p_tenant_id uuid, p_campaign_id uuid, p_filter jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  c         public.campaigns;
  v_from    date;
  v_to      date;
  v_min     bigint;
  v_party   text;
  v_today   date := app.dues_today();
  a         record;
  v_contact uuid;
  v_lead    uuid;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_n       integer := 0;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or p_filter is null or jsonb_typeof(p_filter) <> 'object'
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  perform app.require_module(p_tenant_id, 'dues');
  begin
    v_from := (p_filter ->> 'due_from')::date;
    v_to := (p_filter ->> 'due_to')::date;
    v_min := coalesce(nullif(p_filter ->> 'min_open_paise', '')::bigint, 1);
  exception when others then
    perform app.campaign_error('invalid');
  end;
  v_party := p_filter ->> 'party';
  if v_from is null or v_to is null or v_to < v_from or v_to - v_from > 400 or v_min < 1 or (v_party is not null and v_party not in ('company', 'contact'))
     or exists (select 1 from jsonb_object_keys(p_filter) k where k not in ('due_from', 'due_to', 'min_open_paise', 'party')) then
    perform app.campaign_error('invalid');
  end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if not app.campaign_money_kind(c.kind) then
    perform app.campaign_error('invalid');  -- a ledger list is for the kinds that are about money
  end if;
  perform app.require_module(p_tenant_id, app.campaign_kind_module(c.kind));
  perform app.campaign_reset(p_tenant_id, p_campaign_id, 'list_changed');
  for a in
    select acc.id as account_id, acc.company_id, acc.contact_id,
           sum(o.open_paise)::bigint as open_paise, min(o.due_date) as due_date,
           case when count(*) = 1 then max(coalesce(o.invoice_no, o.reference)) end as ref
      from public.ledger_accounts acc
      cross join lateral app.ledger_open_items(p_tenant_id, acc.id, v_today) o
     where acc.tenant_id = p_tenant_id and o.open_paise > 0 and o.due_date between v_from and v_to
       and (v_party is null or (v_party = 'company' and acc.company_id is not null) or (v_party = 'contact' and acc.contact_id is not null))
     group by acc.id, acc.company_id, acc.contact_id
    having sum(o.open_paise) >= v_min
     order by min(o.due_date), acc.id
  loop
    v_n := v_n + 1;
    v_contact := null;
    if a.contact_id is not null then
      select ct.id into v_contact from public.contacts ct where ct.tenant_id = p_tenant_id and ct.id = a.contact_id and ct.erased_at is null and ct.suppressed_at is null and ct.phone is not null;
    else
      select ct.id into v_contact from public.contacts ct where ct.tenant_id = p_tenant_id and ct.company_id = a.company_id and ct.erased_at is null and ct.suppressed_at is null and ct.phone is not null
       order by ct.created_at, ct.id limit 1;
    end if;
    if v_contact is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_contact');
      continue;
    end if;
    if a.open_paise > 100000000 then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'amount_over_cap');
      continue;
    end if;
    v_lead := app.campaign_lead_for(p_tenant_id, v_contact);
    if v_lead is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_lead');
      continue;
    end if;
    begin
      insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, reference, account_id, row_hash, created_by)
      values (p_tenant_id, p_campaign_id, v_contact, v_lead, a.due_date, a.open_paise, case when a.ref ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$' then a.ref end, a.account_id,
              encode(sha256(convert_to(concat_ws('|', v_contact, a.due_date, a.open_paise::text, coalesce(a.ref, ''), a.account_id::text), 'UTF8')), 'hex'), v_uid);
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'duplicate');
    end;
  end loop;
  update public.campaigns set audience_kind = 'filter', audience_filter = p_filter where id = p_campaign_id;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped,
                            'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id));
end;
$$;
revoke all on function public.campaign_recipients_from_ledger(uuid, uuid, jsonb) from public, anon;
grant execute on function public.campaign_recipients_from_ledger(uuid, uuid, jsonb) to authenticated;

-- Remove one person (or, with no recipient, the whole list). Sends an approved campaign back to draft.
create function public.campaign_recipient_remove(p_tenant_id uuid, p_campaign_id uuid, p_recipient_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  perform app.campaign_reset(p_tenant_id, p_campaign_id, 'list_changed');
  if p_recipient_id is not null and not exists (select 1 from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id and r.id = p_recipient_id) then
    perform app.campaign_error('reference');
  end if;
  begin
    delete from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id and (p_recipient_id is null or r.id = p_recipient_id);
    get diagnostics v_n = row_count;
  exception when foreign_key_violation then
    perform app.campaign_error('state');  -- a person who already has a step on record is not removed
  end;
  return jsonb_build_object('removed', v_n);
end;
$$;
revoke all on function public.campaign_recipient_remove(uuid, uuid, uuid) from public, anon;
grant execute on function public.campaign_recipient_remove(uuid, uuid, uuid) to authenticated;

-- The list, in the order it was made, with each person's own steps. Paged by (seq).
create function public.campaign_recipients_list(p_tenant_id uuid, p_campaign_id uuid, p_limit integer default 50, p_after_seq bigint default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.campaign_error('invalid');
  end if;
  if not exists (select 1 from public.campaigns c where c.tenant_id = p_tenant_id and c.id = p_campaign_id) then
    perform app.campaign_error('reference');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', z.id, 'seq', z.seq, 'contact_id', z.contact_id, 'contact_name', z.full_name, 'due_date', z.due_date, 'amount_paise', z.amount_paise,
                                        'reference', z.reference, 'closed_reason', z.closed_reason, 'promised_on', z.promised_on,
                                        'steps', coalesce((select jsonb_agg(jsonb_build_object('step_no', s.step_no, 'scheduled_for', s.scheduled_for, 'status', s.status, 'reason', s.reason) order by s.step_no)
                                                             from public.campaign_steps s where s.tenant_id = z.tenant_id and s.recipient_id = z.id), '[]'::jsonb)) order by z.seq)
      from (select r.*, ct.full_name from public.campaign_recipients r join public.contacts ct on ct.tenant_id = r.tenant_id and ct.id = r.contact_id
             where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id and (p_after_seq is null or r.seq > p_after_seq) order by r.seq limit p_limit) z), '[]'::jsonb);
end;
$$;
revoke all on function public.campaign_recipients_list(uuid, uuid, integer, bigint) from public, anon;
grant execute on function public.campaign_recipients_list(uuid, uuid, integer, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- preview and approval
-- ---------------------------------------------------------------------------------------------------------------------------------
-- What the Owner sees before approving: the count, the total, the date range, the rendered samples (with the hash of what was shown), the hash of the whole, the first step's time for the first person, and what is still
-- wrong. The first message to a person also carries the outbox's AI-disclosure line (shown separately, in the campaign's language).
create function public.campaign_preview(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c         public.campaigns;
  v_samples jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id;
  if not found then
    perform app.campaign_error('reference');
  end if;
  v_samples := app.campaign_samples(p_tenant_id, p_campaign_id);
  return jsonb_build_object(
    'campaign', app.campaign_json(c), 'samples', v_samples, 'samples_sha256', app.campaign_samples_sha(v_samples), 'content_sha256', app.campaign_content_sha(p_tenant_id, p_campaign_id),
    'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id),
    'total_amount_paise', (select coalesce(sum(r.amount_paise), 0) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id),
    'first_due', (select min(r.due_date) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id),
    'last_due', (select max(r.due_date) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id),
    'disclosure', app.outbox_disclosure(c.language),
    'issues', to_jsonb(app.campaign_issues(p_tenant_id, p_campaign_id)),
    'sending_on', app.scheduler_tenant_on(p_tenant_id));
end;
$$;
revoke all on function public.campaign_preview(uuid, uuid) from public, anon;
grant execute on function public.campaign_preview(uuid, uuid) to authenticated;

-- THE APPROVAL. Only the Owner, with a second factor, of a campaign that is a draft and has nothing wrong, and only for the samples they SAW (their hash is passed back; any change since returns SM802). It plans
-- every step of every person: a step whose time is already past is recorded as skipped (`past`), never sent in a burst. Nothing is sent here; the scheduler sends each step at its time.
create function public.campaign_approve(p_tenant_id uuid, p_campaign_id uuid, p_samples_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  c         public.campaigns;
  v_issues  text[];
  v_sha     text;
  v_samples jsonb;
  v_ssha    text;
  v_n       integer;
  v_total   bigint;
  v_planned integer;
  v_skipped integer;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  perform app.require_aal2();
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if c.status <> 'draft' then
    perform app.campaign_error('state');
  end if;
  perform app.require_module(p_tenant_id, app.campaign_kind_module(c.kind));
  v_issues := app.campaign_issues(p_tenant_id, p_campaign_id);
  if cardinality(v_issues) > 0 then
    perform app.campaign_error('ready', v_issues[1]);
  end if;
  v_samples := app.campaign_samples(p_tenant_id, p_campaign_id);
  v_ssha := app.campaign_samples_sha(v_samples);
  if p_samples_sha256 is null or p_samples_sha256 <> v_ssha then
    perform app.campaign_error('stale');
  end if;
  v_sha := app.campaign_content_sha(p_tenant_id, p_campaign_id);
  insert into public.campaign_steps (tenant_id, campaign_id, recipient_id, step_no, scheduled_for, status, reason, materialised_at)
  select p_tenant_id, p_campaign_id, r.id, x.n::smallint, x.at, case when x.at <= app.outbox_now() then 'skipped' else 'planned' end, case when x.at <= app.outbox_now() then 'past' end, case when x.at <= app.outbox_now() then app.outbox_now() end
    from public.campaign_recipients r
    cross join lateral (select e.ord as n, (((r.due_date + (e.v ->> 'offset_days')::int) + (e.v ->> 'time')::time) at time zone 'Asia/Kolkata') as at
                          from jsonb_array_elements(c.steps) with ordinality as e(v, ord)) x
   where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id and r.closed_at is null
  on conflict (tenant_id, recipient_id, step_no) do nothing;
  select count(*), coalesce(sum(r.amount_paise), 0) into v_n, v_total from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id;
  select count(*) filter (where s.status = 'planned'), count(*) filter (where s.status = 'skipped') into v_planned, v_skipped from public.campaign_steps s where s.tenant_id = p_tenant_id and s.campaign_id = p_campaign_id;
  update public.campaigns set status = 'approved', approved_by = v_uid, approved_at = now(), content_sha256 = v_sha, samples_sha256 = v_ssha, approved_recipients = v_n, approved_total_paise = v_total
   where id = c.id returning * into c;
  perform app.write_audit_event(p_tenant_id, 'campaign.approved', 'campaign', c.id, null,
                                jsonb_build_object('recipients', v_n, 'total_paise', v_total, 'planned_steps', v_planned, 'past_steps', v_skipped, 'content_sha256', v_sha, 'samples_sha256', v_ssha));
  return jsonb_build_object('campaign', app.campaign_json(c), 'planned_steps', v_planned, 'past_steps', v_skipped, 'sending_on', app.scheduler_tenant_on(p_tenant_id));
end;
$$;
revoke all on function public.campaign_approve(uuid, uuid, text) from public, anon;
grant execute on function public.campaign_approve(uuid, uuid, text) to authenticated;

-- pause, resume or cancel. Owner or Admin. A campaign that is resumed after a long pause skips the steps that are more than a day late (`missed`) instead of sending stale reminders in a burst.
create function public.campaign_set_state(p_tenant_id uuid, p_campaign_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_action is null or p_action not in ('pause', 'resume', 'cancel') then
    perform app.campaign_error('invalid');
  end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if p_action = 'pause' then
    if c.status not in ('approved', 'running') then perform app.campaign_error('state'); end if;
    update public.campaigns set status = 'paused', paused_at = now() where id = c.id returning * into c;
  elsif p_action = 'resume' then
    if c.status <> 'paused' then perform app.campaign_error('state'); end if;
    update public.campaign_steps set status = 'skipped', reason = 'missed', materialised_at = app.outbox_now()
     where tenant_id = p_tenant_id and campaign_id = c.id and status = 'planned' and scheduled_for < app.outbox_now() - interval '24 hours';
    update public.campaigns set status = case when exists (select 1 from public.campaign_steps s where s.tenant_id = p_tenant_id and s.campaign_id = c.id and s.status = 'submitted') then 'running' else 'approved' end,
                                paused_at = null
     where id = c.id returning * into c;
  else
    if c.status in ('done', 'cancelled') then perform app.campaign_error('state'); end if;
    update public.campaign_steps set status = 'skipped', reason = 'cancelled', materialised_at = app.outbox_now() where tenant_id = p_tenant_id and campaign_id = c.id and status = 'planned';
    update public.campaigns set status = 'cancelled', cancelled_at = now() where id = c.id returning * into c;
  end if;
  perform app.write_audit_event(p_tenant_id, 'campaign.' || p_action, 'campaign', c.id, null, jsonb_build_object('status', c.status));
  return app.campaign_json(c);
end;
$$;
revoke all on function public.campaign_set_state(uuid, uuid, text) from public, anon;
grant execute on function public.campaign_set_state(uuid, uuid, text) to authenticated;
