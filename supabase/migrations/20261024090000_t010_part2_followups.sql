-- T010 part 2, migration 1 of 2 (docs/plans/t010-integration.md sections 2.2, 3-5 and 11; ADR 0020 and its part 2 amendments): TOUCHES, CADENCE POLICY, FOLLOW-UP DRAFTS.
-- NOTHING IS EVER SENT. A touch, a draft and an approval are RECORDS that a person reviews and acts on outside the system ("I sent it", "they replied"). No model, no provider.
--
--   followup_engine_versions    the allow-list of cadence engine versions the database accepts (migration-extended; not tenant data)
--   followup_templates          the CLOSED draft wordings (English; migration-extended; not tenant data). The database copies the body into the draft: no caller supplies text.
--   followup_policy_versions    immutable, versioned: gaps, max touches, quiet hours, weekdays, holidays, minimum gap, the recipient's fixed UTC offset (Owner, aal2)
--   lead_touches                append-only: what a person sent to a lead ("out") and what the lead sent back ("in"), recorded BY A PERSON
--   followup_drafts             one ACTIVE (draft or approved) draft per (tenant, lead, touch number); draft -> approved -> recorded_sent, or discarded
--   public.create_followup_policy_version, record_touch, create_followup_draft, approve_followup_draft, discard_followup_draft, record_draft_sent, followup_gate
--   app.followup_gate, followup_stopped, followup_build, followup_blocker, followup_state_hash ... the internals (revoked from every client role)
--   trigger on contacts: a contact that becomes suppressed or erased has its open drafts discarded (a system discard)
--
-- What the database proves, and what it cannot (the honest limit, the T009 / order pattern):
--   The API runs the pinned cadence engine with the caller's token and hands create_followup_draft the canonical request and the engine's result. The database
--     1. DERIVES the contact from the lead (the caller names a lead, never a contact) and runs the GATE under locks: suppressed or erased contact (SM220), no recorded suppression key for the
--        channel (SM221: missing data never means "not suppressed"), a suppressed key (SM220, detail contact | key | erased_key), consent not granted for the channel (SM220 consent);
--     2. refuses when follow-ups are STOPPED for the lead (SM227: an order accepted, declined or cancelled, a withdrawn quote, an archived lead) and when no policy is in force (SM222);
--     3. REBUILDS the engine's request from its own touches, policy and lead flags and refuses any other one (SM226), as of its own clock (-10 min to +2 min);
--     4. decides ITSELF whether the engine would answer draft_followup (app.followup_blocker: the flags, a reply, the touch limit, the minimum gap, the weekday, the holiday, quiet hours)
--        and refuses with SM225 (detail: the closed reason) when it would not; the engine's result must then be exactly that decision (SM226). A due draft is ALWAYS due at as_of itself (the
--        engine moves a candidate only forward and answers draft_followup only when the moved time is not after as_of), so the whole positive decision is checked, not trusted;
--     5. copies the closed template body (the caller supplies no text) and stores the request, the result and the hash as given.
--   The engine's WAIT and STOP answers are not recomputed (nothing is created for them), and the rule trace is stored as given. What stays outside the database: that the HMAC the API recorded is the
--   HMAC of the identifier (option A; option B before an external customer), that "I sent it" is a person's word, that a message is really sent or not.
--
-- Lock order (extends ADR 0018 decision 9 at its head): CONTACT row (for share), LEAD row (for update), the advisory lock of the suppression key (shared), the drafts and touches of the lead.
-- Every writer of a lead's touches or drafts locks the lead row first, so the lead lock alone serialises them. suppress_contact (contact for update, then the key's exclusive advisory lock) takes
-- the same locks in the same order and never takes a lead lock; the contact trigger below only updates draft rows. No function that exists today locks a lead row.
--
-- SQLSTATEs (app.followup_error; DETAIL is always a CLOSED code, never a value): SM220 the contact cannot be contacted (detail contact | key | erased_key | erased | consent), SM221 no suppression
-- key is recorded for the channel, SM222 no follow-up policy in force, SM223 the draft is not in a state that allows this (detail exists | not_draft | not_approved | closed), SM224 stale (the
-- history, the policy, the contact or the suppression state moved since the draft was made), SM225 not a due follow-up (detail: suppressed | replied | closed | max_touches | initial_outreach |
-- future_history | not_yet), SM226 the request or result is not what the database computes, SM227 follow-ups are stopped for this lead (detail: order_accepted | order_declined | order_cancelled |
-- quote_withdrawn | lead_archived), SM228 the draft belongs to someone else (a Sales user discarding another person's draft), SM229 a limit was reached. 42501 for every refusal before the role is
-- proven; SM306 second factor; 22023 invalid argument, 23514 value not allowed, 23503 invalid reference, 23505 record id already used.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.touch_direction as enum ('out', 'in');
create type public.followup_draft_status as enum ('draft', 'approved', 'discarded', 'recorded_sent');
-- why a draft was discarded: a person did, or the system did (a newer touch, a reply, a suppression, an erasure)
create type public.followup_discard_code as enum ('person', 'superseded', 'reply_recorded', 'suppressed', 'erased');

-- ---------------------------------------------------------------------------------------------
-- Errors
-- ---------------------------------------------------------------------------------------------
create function app.followup_deny() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'follow-up action not permitted' using errcode = '42501';
end;
$$;

create function app.followup_error(p_code text, p_detail text default null) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_msg text := case p_code
      when 'conflict' then 'record id already used'
      when 'value' then 'value not allowed'
      when 'reference' then 'invalid reference'
      when 'SM220' then 'this contact cannot be contacted'
      when 'SM221' then 'no suppression key is recorded for this contact and channel'
      when 'SM222' then 'no follow-up policy in force'
      when 'SM223' then 'the draft is not in a state that allows this'
      when 'SM224' then 'the follow-up changed since the draft was made'
      when 'SM225' then 'a follow-up is not due'
      when 'SM226' then 'follow-up request or result does not match its recomputation'
      when 'SM227' then 'follow-ups are stopped for this lead'
      when 'SM228' then 'this draft belongs to someone else'
      when 'SM229' then 'a limit was reached'
      else 'invalid argument' end;
  v_state text := case when p_code ~ '^SM22[0-9]$' then p_code
                       else case p_code when 'conflict' then '23505' when 'value' then '23514' when 'reference' then '23503' else '22023' end end;
begin
  -- a RAISE option cannot be null: the detail (always a closed code, never a value) is only attached when there is one
  if p_detail is null then
    raise exception '%', v_msg using errcode = v_state;
  end if;
  raise exception '%', v_msg using errcode = v_state, detail = p_detail;
end;
$$;

create function app.followup_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted: record a new version or discard', tg_table_name using errcode = '42501';
end;
$$;

create function app.followup_forbid_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is never truncated', tg_table_name using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Pure helpers for table checks (immutable)
-- ---------------------------------------------------------------------------------------------
create function app.int2_array_within(a smallint[], lo integer, hi integer) returns boolean
language sql
immutable
set search_path = ''
as $$ select a is not null and not exists (select 1 from unnest(a) x where x is null or x < lo or x > hi) $$;

create function app.date_array_ok(a date[]) returns boolean
language sql
immutable
set search_path = ''
as $$ select a is not null and not exists (select 1 from unnest(a) x where x is null) and cardinality(a) = (select count(distinct x) from unnest(a) x) $$;

create function app.int2_array_distinct(a smallint[]) returns boolean
language sql
immutable
set search_path = ''
as $$ select a is not null and cardinality(a) = (select count(distinct x) from unnest(a) x) $$;

-- ---------------------------------------------------------------------------------------------
-- The allow-lists and the closed wordings: NOT tenant data. A new version or wording needs a reviewed migration.
-- ---------------------------------------------------------------------------------------------
create table public.followup_engine_versions (
  version  text primary key check (version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  added_at timestamptz not null default now()
);
comment on column public.followup_engine_versions.version is 'SAFE: a semantic version. CLEAN-EXEMPT: strict anchored pattern, written only by migrations';
alter table public.followup_engine_versions enable row level security;
alter table public.followup_engine_versions force row level security;
revoke all on public.followup_engine_versions from public, anon, authenticated;
insert into public.followup_engine_versions (version) values ('1.0.0');

create table public.followup_templates (
  code     text primary key check (code ~ '^[a-z][a-z_]{2,38}$'),
  body     text not null check (char_length(body) between 20 and 1000 and app.text_is_clean(body) and not app.text_has_contact(body)),
  added_at timestamptz not null default now()
);
comment on column public.followup_templates.code is 'SAFE: a template code. CLEAN-EXEMPT: strict anchored pattern, written only by migrations';
comment on column public.followup_templates.body is 'SAFE: closed English wording, no variables, no personal data; text_is_clean-guarded; written only by migrations. The owner reviews the wording (checklist).';
alter table public.followup_templates enable row level security;
alter table public.followup_templates force row level security;
revoke all on public.followup_templates from public, anon, authenticated;
-- clearly SYNTHETIC placeholder wording the family replaces; no name, no price, no date, no product: nothing a customer wrote can reach it (decision 6)
insert into public.followup_templates (code, body) values
  ('followup_gentle',   'Hello, I am following up on my earlier message about your saree requirement. If you would like me to share the details again, or if anything is unclear, please reply here and I will be glad to help.'),
  ('followup_reminder', 'Hello, a gentle reminder about your saree requirement. Please let me know if you would like to go ahead, need any changes, or would like me to send the details once more.'),
  ('followup_last',     'Hello, this is my last follow-up on your saree requirement, so that I do not trouble you. If you are still interested, please reply here and I will take it forward. Thank you for your time.');

-- the wording for a touch number: the last allowed touch, then the second touch, then every other
create function app.followup_template_code(p_touch_number integer, p_max_touches integer) returns text
language sql
immutable
set search_path = ''
as $$ select case when p_touch_number >= p_max_touches then 'followup_last' when p_touch_number = 2 then 'followup_gentle' else 'followup_reminder' end $$;

-- ---------------------------------------------------------------------------------------------
-- followup_policy_versions: what the owner decided about the cadence (synthetic seed values only until the family decides)
-- ---------------------------------------------------------------------------------------------
create table public.followup_policy_versions (
  id                           uuid primary key default gen_random_uuid(),
  tenant_id                    uuid not null references public.tenants (id) on delete restrict,
  version_no                   integer not null check (version_no >= 1),
  effective_from               date not null,
  gap_days                     smallint[] not null,
  max_touches                  smallint not null check (max_touches between 1 and 100),
  quiet_start                  text not null check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end                    text not null check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  allowed_weekdays             smallint[] not null,
  holidays                     date[] not null,
  min_gap_hours                integer not null check (min_gap_hours between 0 and 8760),
  recipient_utc_offset_minutes smallint not null check (recipient_utc_offset_minutes between -840 and 840),
  content_sha256               text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by                   uuid,
  created_via                  public.record_origin not null default 'manual',
  created_at                   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_no),
  -- exactly max(max_touches - 1, 0) gaps, each 0..365 days (the engine's own rule)
  check (cardinality(gap_days) = max_touches - 1 and app.int2_array_within(gap_days, 0, 365)),
  check (quiet_start <> quiet_end),
  check (cardinality(allowed_weekdays) between 1 and 7 and app.int2_array_within(allowed_weekdays, 0, 6) and app.int2_array_distinct(allowed_weekdays)),
  check (cardinality(holidays) <= 366 and app.date_array_ok(holidays))
);
create index followup_policy_versions_active_idx on public.followup_policy_versions (tenant_id, effective_from desc, version_no desc);
create index followup_policy_versions_keyset_idx on public.followup_policy_versions (tenant_id, created_at, id);
comment on column public.followup_policy_versions.gap_days is 'SAFE: structured cadence numbers; no personal data';
comment on column public.followup_policy_versions.quiet_start is 'SAFE: a clock time. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.followup_policy_versions.quiet_end is 'SAFE: a clock time. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.followup_policy_versions.content_sha256 is 'SAFE: sha256 of the normalised policy. CLEAN-EXEMPT: strict anchored hex pattern';

-- ---------------------------------------------------------------------------------------------
-- followup_drafts: a closed-template DRAFT for a person to review, approve, copy and send OUTSIDE the system
-- ---------------------------------------------------------------------------------------------
create table public.followup_drafts (
  id                uuid primary key,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  lead_id           uuid not null,
  contact_id        uuid not null,
  touch_number      smallint not null check (touch_number between 2 and 100),
  status            public.followup_draft_status not null default 'draft',
  channel           public.consent_channel not null check (channel in ('email', 'whatsapp')),
  template_code     text not null references public.followup_templates (code),
  body              text not null check (char_length(body) between 20 and 1000 and app.text_is_clean(body)),
  policy_version_id uuid not null,
  engine_version    text not null references public.followup_engine_versions (version),
  request_text      text not null check (char_length(request_text) between 2 and 100000 and app.text_is_clean(request_text)),
  result_text       text not null check (char_length(result_text) between 2 and 200000 and app.text_is_clean(result_text)),
  canonical_hash    text not null check (canonical_hash ~ '^[0-9a-f]{64}$'),
  state_hash        text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  as_of             timestamptz not null,
  created_by        uuid,
  created_via       public.record_origin not null default 'manual',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  approved_by       uuid,
  approved_at       timestamptz,
  discarded_by      uuid,
  discarded_at      timestamptz,
  discard_code      public.followup_discard_code,
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id)           references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id)        references public.contacts (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references public.followup_policy_versions (tenant_id, id),
  check ((approved_by is null) = (approved_at is null)),
  check (status not in ('approved', 'recorded_sent') or approved_at is not null),
  check (status <> 'draft' or (approved_at is null and discarded_at is null)),
  check ((status = 'discarded') = (discarded_at is not null)),
  check ((status = 'discarded') = (discard_code is not null))
);
-- ONE active draft per (tenant, lead, touch number): the de-duplication lane C asked for (decide() keeps answering draft_followup for the same touch number until an outbound touch is recorded)
create unique index followup_drafts_one_active_key on public.followup_drafts (tenant_id, lead_id, touch_number) where status in ('draft', 'approved');
create index followup_drafts_lead_idx    on public.followup_drafts (tenant_id, lead_id, created_at);
create index followup_drafts_contact_idx on public.followup_drafts (tenant_id, contact_id);
create index followup_drafts_policy_idx  on public.followup_drafts (tenant_id, policy_version_id);
create index followup_drafts_keyset_idx  on public.followup_drafts (tenant_id, created_at, id);
create index followup_drafts_template_idx       on public.followup_drafts (template_code);
create index followup_drafts_engine_version_idx on public.followup_drafts (engine_version);
comment on column public.followup_drafts.body is 'SAFE: copied by the database from followup_templates (closed English wording, no variables); text_is_clean-guarded; never a customer''s words';
comment on column public.followup_drafts.template_code is 'SAFE: a template code. CLEAN-EXEMPT: a foreign key to the closed template list';
comment on column public.followup_drafts.engine_version is 'SAFE: a semantic version from the followup_engine_versions allow-list. CLEAN-EXEMPT: a foreign key to the allow-list';
comment on column public.followup_drafts.request_text is 'SAFE: the canonical cadence request (timestamps, closed channel names, flags, policy numbers); no personal data; text_is_clean-guarded; written only by create_followup_draft';
comment on column public.followup_drafts.result_text is 'SAFE: the cadence engine result with its rule trace (closed codes, numbers, timestamps); no personal data; text_is_clean-guarded; written only by create_followup_draft';
comment on column public.followup_drafts.canonical_hash is 'SAFE: sha256 of the canonical request. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.followup_drafts.state_hash is 'SAFE: sha256 fingerprint of the lead''s follow-up state when the draft was made. CLEAN-EXEMPT: strict anchored hex pattern';

-- ---------------------------------------------------------------------------------------------
-- lead_touches: the append-only record of what a PERSON did ("I sent it", "they replied"). This is the history the cadence reads.
-- ---------------------------------------------------------------------------------------------
create table public.lead_touches (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  lead_id     uuid not null,
  -- the lead's contact when it was recorded (derived by the database); null for a reply on a lead without a contact
  contact_id  uuid,
  direction   public.touch_direction not null,
  channel     public.consent_channel not null,
  occurred_at timestamptz not null,
  draft_id    uuid,
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id)    references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, draft_id)   references public.followup_drafts (tenant_id, id),
  check (draft_id is null or direction = 'out'),
  -- a touch is never more than 5 minutes ahead of the moment it was recorded (the function also bounds it below: the lead's creation and 7 days)
  check (occurred_at <= recorded_at + interval '5 minutes')
);
create unique index lead_touches_draft_key on public.lead_touches (tenant_id, draft_id) where draft_id is not null;
create index lead_touches_lead_idx    on public.lead_touches (tenant_id, lead_id, occurred_at, id);
create index lead_touches_contact_idx on public.lead_touches (tenant_id, contact_id);
create index lead_touches_keyset_idx  on public.lead_touches (tenant_id, recorded_at, id);

-- ---------------------------------------------------------------------------------------------
-- Guard triggers: tenant fixed, provenance server-owned, no deletes, no truncates, a draft only moves along its state machine
-- ---------------------------------------------------------------------------------------------
create function app.followup_drafts_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft' or new.approved_at is not null or new.discarded_at is not null then
    raise exception 'a follow-up draft starts as a draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- content never changes; status moves draft -> approved -> recorded_sent, or draft | approved -> discarded; a closed draft stays closed; recorded_sent needs its touch
create function app.followup_drafts_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'discarded_by' - 'discarded_at' - 'discard_code' - 'updated_at')
     is distinct from (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'discarded_by' - 'discarded_at' - 'discard_code' - 'updated_at') then
    raise exception 'follow-up drafts are immutable: approve, discard or record them' using errcode = '42501';
  end if;
  if old.status in ('discarded', 'recorded_sent') and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at
     or new.discarded_at is distinct from old.discarded_at) then
    raise exception 'a closed follow-up draft stays closed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('approved', 'discarded'))
         or (old.status = 'approved' and new.status in ('recorded_sent', 'discarded'))) then
      raise exception 'a follow-up draft cannot move from % to %', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'recorded_sent' and not exists (select 1 from public.lead_touches t where t.tenant_id = new.tenant_id and t.draft_id = new.id and t.direction = 'out') then
      raise exception 'a draft is recorded as sent only with its outbound touch' using errcode = '42501';
    end if;
  elsif new.approved_at is distinct from old.approved_at and old.approved_at is not null then
    raise exception 'a draft is approved once' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.followup_deny(), app.followup_error(text, text), app.followup_forbid_delete(), app.followup_forbid_truncate(), app.followup_drafts_guard_insert(),
  app.followup_drafts_guard_update(), app.int2_array_within(smallint[], integer, integer), app.date_array_ok(date[]), app.int2_array_distinct(smallint[]),
  app.followup_template_code(integer, integer) from public;

create trigger followup_policy_versions_forbid_tenant_id_change before update on public.followup_policy_versions for each row execute function app.forbid_tenant_id_change();
create trigger followup_policy_versions_set_created_meta        before insert or update on public.followup_policy_versions for each row execute function app.set_created_meta();
create trigger followup_policy_versions_guard_immutable         before update on public.followup_policy_versions for each row execute function app.guard_immutable_record();
create trigger followup_policy_versions_forbid_delete           before delete on public.followup_policy_versions for each row execute function app.followup_forbid_delete();
create trigger followup_drafts_forbid_tenant_id_change          before update on public.followup_drafts for each row execute function app.forbid_tenant_id_change();
create trigger followup_drafts_set_created_meta                 before insert or update on public.followup_drafts for each row execute function app.set_created_meta();
create trigger followup_drafts_set_updated_at                   before update on public.followup_drafts for each row execute function app.set_updated_at();
create trigger followup_drafts_guard_insert                     before insert on public.followup_drafts for each row execute function app.followup_drafts_guard_insert();
create trigger followup_drafts_guard_update                     before update on public.followup_drafts for each row execute function app.followup_drafts_guard_update();
create trigger followup_drafts_forbid_delete                    before delete on public.followup_drafts for each row execute function app.followup_forbid_delete();
create trigger lead_touches_forbid_tenant_id_change             before update on public.lead_touches for each row execute function app.forbid_tenant_id_change();
create trigger lead_touches_append_only                         before update or delete on public.lead_touches for each row execute function app.append_only();
do $$
declare t text;
begin
  foreach t in array array['followup_policy_versions', 'followup_drafts', 'lead_touches'] loop
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$s for each statement execute function app.followup_forbid_truncate()', t);
  end loop;
end $$;

create trigger audit_followup_policy_versions after insert or update or delete on public.followup_policy_versions for each row execute function app.audit_row_change('followup_policy_version');
create trigger audit_followup_drafts          after insert or update or delete on public.followup_drafts          for each row execute function app.audit_row_change('followup_draft');
create trigger audit_lead_touches             after insert or update or delete on public.lead_touches             for each row execute function app.audit_row_change('lead_touch');

-- ---------------------------------------------------------------------------------------------
-- RLS: read = Owner / Admin / Sales (a Viewer reads none of it); nobody writes directly
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['followup_policy_versions', 'followup_drafts', 'lead_touches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Helpers (internal: nobody but the definer functions calls them)
-- ---------------------------------------------------------------------------------------------
-- "active at a date": the latest version effective on or before it (ties: the higher version number)
create function app.followup_active_policy_version(p_tenant uuid, p_on date) returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id from public.followup_policy_versions v where v.tenant_id = p_tenant and v.effective_from <= p_on order by v.effective_from desc, v.version_no desc limit 1
$$;

create function app.followup_request_hash(p_engine_version text, p_request_text text) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to('{"engine_version":"' || p_engine_version || '","inputs":' || p_request_text || '}', 'UTF8')), 'hex') $$;

-- the engine's `policy` object (and its offset) for a policy version; arrays are stored sorted, so the list order is the API builder's
create function app.followup_policy_json(pv public.followup_policy_versions) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'gap_days', to_jsonb(pv.gap_days),
    'max_touches', pv.max_touches,
    'quiet_hours', jsonb_build_object('start', pv.quiet_start, 'end', pv.quiet_end),
    'allowed_weekdays', to_jsonb(pv.allowed_weekdays),
    'holidays', to_jsonb(pv.holidays),
    'min_gap_hours', pv.min_gap_hours)
$$;

-- the reason follow-ups are stopped for a lead, or NULL: an archived lead, or an order / withdrawn quote (app.order_stops_followups: the lead's latest order decides)
create function app.followup_stopped(p_lead uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from public.leads l where l.id = p_lead and l.archived_at is not null) then 'lead_archived'
    else (select case app.order_stops_followups(p_lead)
                    when 'accepted' then 'order_accepted' when 'declined' then 'order_declined' when 'cancelled' then 'order_cancelled' when 'withdrawn' then 'quote_withdrawn' end)
  end
$$;

-- THE GATE. May this lead's contact be contacted on this channel? Returns {code: null} or {code: SM220 | SM221, detail}. Missing data never means "not suppressed".
-- With p_lock the suppression key's advisory lock is taken in SHARED mode (a suppression of any contact that holds the same key waits for this transaction, or has already committed).
-- Order of the checks (the safety-critical ones first): no contact, erased, suppressed, no identifier for the channel, no stored key (SM221), a suppressed key, consent.
create function app.followup_gate(p_lead uuid, p_channel public.consent_channel, p_lock boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  l       public.leads;
  c       public.contacts;
  k       suppression.contact_keys;
  v_kind  text := case p_channel when 'email' then 'email' else 'phone' end;
  v_hmac  text;
begin
  select * into l from public.leads x where x.id = p_lead;
  if not found or l.contact_id is null then
    return jsonb_build_object('code', 'SM220', 'detail', 'consent');
  end if;
  select * into c from public.contacts x where x.tenant_id = l.tenant_id and x.id = l.contact_id;
  if not found then
    return jsonb_build_object('code', 'SM220', 'detail', 'consent');
  end if;
  if c.erased_at is not null then
    return jsonb_build_object('code', 'SM220', 'detail', 'erased');
  end if;
  if c.suppressed_at is not null then
    return jsonb_build_object('code', 'SM220', 'detail', 'contact');
  end if;
  if (v_kind = 'email' and c.email is null) or (v_kind = 'phone' and c.phone is null) then
    return jsonb_build_object('code', 'SM220', 'detail', 'consent');
  end if;
  select * into k from suppression.contact_keys x where x.tenant_id = c.tenant_id and x.contact_id = c.id;
  v_hmac := case when not found then null when v_kind = 'email' then k.email_hmac else k.phone_hmac end;
  if v_hmac is null then
    return jsonb_build_object('code', 'SM221');
  end if;
  if p_lock then
    perform pg_advisory_xact_lock_shared(hashtextextended('suppression_key:' || c.tenant_id::text || ':' || v_kind || ':' || v_hmac, 0));
  end if;
  if app.key_active(c.tenant_id, v_kind, v_hmac) then
    -- an ERASED marker since the key's last lift: a person erased by right shares this identifier
    if exists (select 1 from suppression.key_events e
                where e.tenant_id = c.tenant_id and e.kind = v_kind and e.key_hmac = v_hmac and e.event = 'suppressed' and e.reason = 'erased'
                  and e.seq > coalesce((select max(x.seq) from suppression.key_events x where x.tenant_id = e.tenant_id and x.kind = e.kind and x.key_hmac = e.key_hmac and x.event = 'lifted'), 0)) then
      return jsonb_build_object('code', 'SM220', 'detail', 'erased_key');
    end if;
    return jsonb_build_object('code', 'SM220', 'detail', 'key');
  end if;
  if not app.can_contact(c.id, p_channel) then
    return jsonb_build_object('code', 'SM220', 'detail', 'consent');
  end if;
  return jsonb_build_object('code', null);
end;
$$;

-- the cadence engine's REQUEST, built from the database's own rows (same value, key for key, as services/ai-api/app/followups/builder.py; arrays in (second, id) order).
-- The lead flags come from columns the caller can read: the contact's suppression reason, the lead's status, a won opportunity, an inbound touch. A key suppressed through
-- ANOTHER contact is the gate's business (SM220), not a flag.
create function app.followup_build(p_lead uuid, p_as_of text, p_policy uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  l  public.leads;
  c  public.contacts;
  pv public.followup_policy_versions;
begin
  select * into l from public.leads x where x.id = p_lead;
  select * into c from public.contacts x where x.tenant_id = l.tenant_id and x.id = l.contact_id;
  select * into pv from public.followup_policy_versions x where x.tenant_id = l.tenant_id and x.id = p_policy;
  return jsonb_build_object(
    'as_of', p_as_of,
    'recipient_utc_offset_minutes', pv.recipient_utc_offset_minutes,
    'lead', jsonb_build_object(
      'do_not_contact', coalesce(c.suppression_reason in ('complained', 'legal', 'manual'), false),
      'opted_out', coalesce(c.suppression_reason = 'opted_out', false),
      'replied', exists (select 1 from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.direction = 'in'),
      'bounced', coalesce(c.suppression_reason = 'bounced', false),
      'won', exists (select 1 from public.opportunities o where o.tenant_id = l.tenant_id and o.lead_id = l.id and o.status = 'won' and o.archived_at is null),
      'lost', l.status = 'disqualified'),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                          'timestamp', to_char(t.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'channel', t.channel::text, 'direction', t.direction::text,
                          'outcome', case t.direction when 'out' then 'recorded_sent' else 'recorded_reply' end)
                        order by date_trunc('second', t.occurred_at), t.id), '[]'::jsonb)
                  from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id),
    'policy', app.followup_policy_json(pv));
end;
$$;

-- a fingerprint of the follow-up state a draft was made in: the request WITHOUT its as_of, the contact and the channel. The approval refuses a draft whose state moved (SM224).
create function app.followup_state_hash(p_lead uuid, p_contact uuid, p_channel text, p_policy uuid) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object('request', app.followup_build(p_lead, '1970-01-01T00:00:00Z', p_policy) - 'as_of', 'contact', p_contact, 'channel', p_channel)::text, 'UTF8')), 'hex')
$$;

-- Would the pinned engine answer draft_followup / eligible_now for this REQUEST? NULL when it would; otherwise the closed reason it would not (the order of the engine's own rules).
-- The engine moves a candidate time only FORWARD and answers draft_followup only when the moved time is not after as_of, so a due draft is due at as_of itself: as_of must be an allowed
-- local moment (weekday, holiday, quiet hours) and not before either floor (the gap in days, the minimum gap in hours) after the last outbound touch. Pinned equal to the real engine by
-- tests/integration/test_followup_equivalence.py.
create function app.followup_blocker(p_request jsonb) returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  -- fails CLOSED: a request the rules cannot read (a missing key, a value of the wrong shape) is 'invalid', never due
  begin
    return app.followup_blocker_inner(p_request);
  exception when others then
    return 'invalid';
  end;
end;
$$;

create function app.followup_blocker_inner(p_request jsonb) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lead    jsonb := p_request -> 'lead';
  v_pol     jsonb := p_request -> 'policy';
  v_as      timestamp := ((p_request ->> 'as_of')::timestamptz at time zone 'UTC');
  v_outs    timestamp[];
  v_n       integer;
  v_last    timestamp;
  v_gap     integer;
  v_off     integer := (p_request ->> 'recipient_utc_offset_minutes')::integer;
  v_local   timestamp;
  v_wd      integer;
  v_min     integer;
  v_qs      integer;
  v_qe      integer;
  v_quiet   boolean;
begin
  -- every input the rules read must be present; a missing value would make a comparison NULL (read as false), which must never mean "due"
  if p_request is null or v_lead is null or v_pol is null or v_as is null or v_off is null
     or (v_lead ->> 'do_not_contact') is null or (v_lead ->> 'opted_out') is null or (v_lead ->> 'replied') is null or (v_lead ->> 'bounced') is null
     or (v_lead ->> 'won') is null or (v_lead ->> 'lost') is null
     or (v_pol ->> 'max_touches') is null or (v_pol ->> 'min_gap_hours') is null or (v_pol -> 'quiet_hours' ->> 'start') is null or (v_pol -> 'quiet_hours' ->> 'end') is null
     or jsonb_typeof(p_request -> 'history') <> 'array' or jsonb_typeof(v_pol -> 'gap_days') <> 'array' or jsonb_typeof(v_pol -> 'allowed_weekdays') <> 'array'
     or jsonb_typeof(v_pol -> 'holidays') <> 'array' then
    return 'invalid';
  end if;
  if (v_lead ->> 'do_not_contact')::boolean or (v_lead ->> 'opted_out')::boolean or (v_lead ->> 'bounced')::boolean then
    return 'suppressed';
  end if;
  if (v_lead ->> 'replied')::boolean or exists (select 1 from jsonb_array_elements(p_request -> 'history') h where h ->> 'direction' = 'in') then
    return 'replied';
  end if;
  if (v_lead ->> 'won')::boolean or (v_lead ->> 'lost')::boolean then
    return 'closed';
  end if;
  if exists (select 1 from jsonb_array_elements(p_request -> 'history') h where ((h ->> 'timestamp')::timestamptz at time zone 'UTC') > v_as) then
    return 'future_history';
  end if;
  select coalesce(array_agg((h ->> 'timestamp')::timestamptz at time zone 'UTC'), '{}') into v_outs
    from jsonb_array_elements(p_request -> 'history') h where h ->> 'direction' = 'out';
  v_n := cardinality(v_outs);
  if v_n >= (v_pol ->> 'max_touches')::integer then
    return 'max_touches';
  end if;
  if v_n = 0 then
    return 'initial_outreach';
  end if;
  select max(x) into v_last from unnest(v_outs) x;
  v_gap := (v_pol -> 'gap_days' ->> (v_n - 1))::integer;
  if v_gap is null then
    return 'invalid';
  end if;
  if v_as < v_last + v_gap * interval '1 day' or v_as < v_last + (v_pol ->> 'min_gap_hours')::integer * interval '1 hour' then
    return 'not_yet';
  end if;
  -- the recipient's local clock at as_of
  v_local := v_as + v_off * interval '1 minute';
  v_wd := extract(isodow from v_local)::integer - 1;
  if not exists (select 1 from jsonb_array_elements_text(v_pol -> 'allowed_weekdays') w where w::integer = v_wd)
     or (v_pol -> 'holidays') ? to_char(v_local, 'YYYY-MM-DD') then
    return 'not_yet';
  end if;
  v_min := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_qs := split_part(v_pol -> 'quiet_hours' ->> 'start', ':', 1)::integer * 60 + split_part(v_pol -> 'quiet_hours' ->> 'start', ':', 2)::integer;
  v_qe := split_part(v_pol -> 'quiet_hours' ->> 'end', ':', 1)::integer * 60 + split_part(v_pol -> 'quiet_hours' ->> 'end', ':', 2)::integer;
  v_quiet := case when v_qs < v_qe then v_min >= v_qs and v_min < v_qe else v_min >= v_qs or v_min < v_qe end;
  if v_quiet then
    return 'not_yet';
  end if;
  return null;
end;
$$;

-- the engine's result for a DRAFT: exactly the nine documented keys, the draft answer, due at as_of, this touch number, this version and this hash
create function app.followup_result_ok(p_request jsonb, p_result jsonb, p_version text, p_hash text, p_touch integer) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_result is not null and jsonb_typeof(p_result) = 'object'
     and (select array_agg(k order by k collate "C") from jsonb_object_keys(p_result) k)
         = array['action', 'canonical_hash', 'engine_version', 'next_eligible_at', 'reason_code', 'terminal', 'touch_number', 'trace']
     and p_result ->> 'action' = 'draft_followup' and p_result ->> 'reason_code' = 'eligible_now'
     and p_result -> 'terminal' = 'false'::jsonb
     and jsonb_typeof(p_result -> 'touch_number') = 'number' and (p_result ->> 'touch_number') = p_touch::text
     and p_result ->> 'next_eligible_at' = p_request ->> 'as_of'
     and p_result ->> 'engine_version' = p_version and p_result ->> 'canonical_hash' = p_hash
     and jsonb_typeof(p_result -> 'trace') = 'array';
end;
$$;

revoke all on function app.followup_active_policy_version(uuid, date), app.followup_request_hash(text, text), app.followup_policy_json(public.followup_policy_versions),
  app.followup_stopped(uuid), app.followup_gate(uuid, public.consent_channel, boolean), app.followup_build(uuid, text, uuid), app.followup_state_hash(uuid, uuid, text, uuid),
  app.followup_blocker(jsonb), app.followup_blocker_inner(jsonb), app.followup_result_ok(jsonb, jsonb, text, text, integer) from public;

-- ---------------------------------------------------------------------------------------------
-- A contact that becomes suppressed or erased has its OPEN drafts discarded (a system discard, with the reason). Runs inside the contact's own update, so the contact row is
-- already locked; it only touches draft rows. The gate re-checks at every step too: this removes the draft from the screen, it is not the only line of defence.
-- ---------------------------------------------------------------------------------------------
create function app.contacts_discard_followup_drafts() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.followup_drafts d
     set status = 'discarded', discarded_at = now(), discarded_by = auth.uid(),
         discard_code = case when new.erased_at is not null then 'erased'::public.followup_discard_code else 'suppressed'::public.followup_discard_code end
   where d.tenant_id = new.tenant_id and d.contact_id = new.id and d.status in ('draft', 'approved');
  return new;
end;
$$;
revoke all on function app.contacts_discard_followup_drafts() from public;
create trigger contacts_discard_followup_drafts after update of suppressed_at, erased_at on public.contacts
  for each row when ((old.suppressed_at is null and new.suppressed_at is not null) or (old.erased_at is null and new.erased_at is not null))
  execute function app.contacts_discard_followup_drafts();

-- ---------------------------------------------------------------------------------------------
-- public.create_followup_policy_version: Owner with a second factor (the role first, so a refusal before it is the same 42501 for everyone)
-- ---------------------------------------------------------------------------------------------
-- an integer-shaped JSON number (up to five digits), or NULL
create function app.followup_json_int(p jsonb) returns integer
language sql
immutable
set search_path = ''
as $$ select case when p is not null and jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,5}$' then (p #>> '{}')::integer end $$;
revoke all on function app.followup_json_int(jsonb) from public;

create function public.create_followup_policy_version(p_version_id uuid, p_tenant_id uuid, p_effective_from date, p_policy jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys    text[] := array['gap_days', 'max_touches', 'quiet_hours', 'allowed_weekdays', 'holidays', 'min_gap_hours', 'recipient_utc_offset_minutes'];
  v_max     integer;
  v_gaps    smallint[];
  v_wd      smallint[];
  v_hol     date[];
  v_min     integer;
  v_off     integer;
  v_qs      text;
  v_qe      text;
  v_x       jsonb;
  v_norm    jsonb;
  v_hash    text;
  v_latest  date;
  v_no      integer;
  v_exist   public.followup_policy_versions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  perform app.require_aal2();
  if p_version_id is null or p_effective_from is null or p_policy is null or jsonb_typeof(p_policy) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_policy) k where k <> all (v_keys)) or not (p_policy ?& v_keys)
     or jsonb_typeof(p_policy -> 'gap_days') <> 'array' or jsonb_typeof(p_policy -> 'allowed_weekdays') <> 'array' or jsonb_typeof(p_policy -> 'holidays') <> 'array'
     or jsonb_typeof(p_policy -> 'quiet_hours') <> 'object' then
    perform app.followup_error('invalid');
  end if;
  v_max := app.followup_json_int(p_policy -> 'max_touches');
  v_min := app.followup_json_int(p_policy -> 'min_gap_hours');
  v_off := app.followup_json_int(p_policy -> 'recipient_utc_offset_minutes');
  if v_max is null or v_min is null or v_off is null then
    perform app.followup_error('invalid');
  end if;
  if v_max not between 1 and 100 or v_min not between 0 and 8760 or v_off not between -840 and 840
     or jsonb_array_length(p_policy -> 'gap_days') > 99 or jsonb_array_length(p_policy -> 'allowed_weekdays') > 7 or jsonb_array_length(p_policy -> 'holidays') > 366
     or jsonb_array_length(p_policy -> 'gap_days') <> v_max - 1 then
    perform app.followup_error('value');
  end if;
  -- the arrays: every element the right shape, in range
  v_gaps := '{}'; v_wd := '{}'; v_hol := '{}';
  for v_x in select value from jsonb_array_elements(p_policy -> 'gap_days') loop
    if app.followup_json_int(v_x) is null then perform app.followup_error('invalid'); end if;
    if app.followup_json_int(v_x) not between 0 and 365 then perform app.followup_error('value'); end if;
    v_gaps := array_append(v_gaps, app.followup_json_int(v_x)::smallint);
  end loop;
  for v_x in select value from jsonb_array_elements(p_policy -> 'allowed_weekdays') loop
    if app.followup_json_int(v_x) is null then perform app.followup_error('invalid'); end if;
    if app.followup_json_int(v_x) not between 0 and 6 or app.followup_json_int(v_x)::smallint = any (v_wd) then perform app.followup_error('value'); end if;
    v_wd := array_append(v_wd, app.followup_json_int(v_x)::smallint);
  end loop;
  if cardinality(v_wd) = 0 then
    perform app.followup_error('value');
  end if;
  for v_x in select value from jsonb_array_elements(p_policy -> 'holidays') loop
    if jsonb_typeof(v_x) <> 'string' or (v_x #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform app.followup_error('invalid'); end if;
    begin
      if to_char((v_x #>> '{}')::date, 'YYYY-MM-DD') <> (v_x #>> '{}') then perform app.followup_error('invalid'); end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      perform app.followup_error('invalid');
    end;
    if (v_x #>> '{}')::date = any (v_hol) then perform app.followup_error('value'); end if;
    v_hol := array_append(v_hol, (v_x #>> '{}')::date);
  end loop;
  if exists (select 1 from jsonb_object_keys(p_policy -> 'quiet_hours') k where k <> all (array['start', 'end'])) or not ((p_policy -> 'quiet_hours') ?& array['start', 'end'])
     or jsonb_typeof(p_policy -> 'quiet_hours' -> 'start') <> 'string' or jsonb_typeof(p_policy -> 'quiet_hours' -> 'end') <> 'string' then
    perform app.followup_error('invalid');
  end if;
  v_qs := p_policy -> 'quiet_hours' ->> 'start';
  v_qe := p_policy -> 'quiet_hours' ->> 'end';
  if v_qs !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_qe !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_qs = v_qe then
    perform app.followup_error('value');
  end if;
  -- normalised: weekdays and holidays sorted (the order the engine request carries)
  select array_agg(x order by x) into v_wd from unnest(v_wd) x;
  select coalesce(array_agg(x order by x), '{}') into v_hol from unnest(v_hol) x;
  v_norm := jsonb_build_object('gap_days', to_jsonb(v_gaps), 'max_touches', v_max, 'quiet_hours', jsonb_build_object('start', v_qs, 'end', v_qe), 'allowed_weekdays', to_jsonb(v_wd),
                               'holidays', to_jsonb(v_hol), 'min_gap_hours', v_min, 'recipient_utc_offset_minutes', v_off);
  v_hash := app.quote_content_hash(v_norm);

  perform pg_advisory_xact_lock(hashtextextended('followup_ref:policy:' || p_tenant_id::text, 0));
  select * into v_exist from public.followup_policy_versions v where v.id = p_version_id;
  if found then
    if v_exist.tenant_id = p_tenant_id and v_exist.content_sha256 = v_hash and v_exist.effective_from = p_effective_from then
      return jsonb_build_object('version_id', v_exist.id, 'version_no', v_exist.version_no, 'effective_from', v_exist.effective_from, 'content_sha256', v_exist.content_sha256, 'replayed', true);
    end if;
    perform app.followup_error('conflict');
  end if;
  select max(v.effective_from), coalesce(max(v.version_no), 0) + 1 into v_latest, v_no from public.followup_policy_versions v where v.tenant_id = p_tenant_id;
  if p_effective_from < app.quote_today() or p_effective_from < coalesce(v_latest, p_effective_from) then
    perform app.followup_error('value');
  end if;
  insert into public.followup_policy_versions (id, tenant_id, version_no, effective_from, gap_days, max_touches, quiet_start, quiet_end, allowed_weekdays, holidays, min_gap_hours,
                                               recipient_utc_offset_minutes, content_sha256)
  values (p_version_id, p_tenant_id, v_no, p_effective_from, v_gaps, v_max, v_qs, v_qe, v_wd, v_hol, v_min, v_off, v_hash);
  return jsonb_build_object('version_id', p_version_id, 'version_no', v_no, 'effective_from', p_effective_from, 'content_sha256', v_hash, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.followup_gate: a READ for the screens. Why a lead's follow-up is blocked or stopped, in closed words; never a key, never an identifier. Owner / Admin / Sales.
-- ---------------------------------------------------------------------------------------------
create function public.followup_gate(p_lead_id uuid, p_channel text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.leads;
  g jsonb;
begin
  if auth.uid() is null or p_lead_id is null then
    perform app.followup_deny();
  end if;
  select * into l from public.leads x where x.id = p_lead_id;
  if not found or not app.has_tenant_role(l.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_channel is null or p_channel not in ('email', 'whatsapp', 'phone') then
    perform app.followup_error('invalid');
  end if;
  g := app.followup_gate(l.id, p_channel::public.consent_channel, false);
  return jsonb_build_object(
    'blocked', case when g ->> 'code' = 'SM221' then 'unkeyed' else g ->> 'detail' end,
    'stopped', app.followup_stopped(l.id),
    'policy_in_force', app.followup_active_policy_version(l.tenant_id, app.quote_today()) is not null);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Locks shared by the writers: the lead's contact (for share), then the lead (for update). A lead whose contact changed while we waited is stale (SM224).
-- ---------------------------------------------------------------------------------------------
create function app.followup_lock(p_lead uuid) returns public.leads
language plpgsql
set search_path = ''
as $$
declare
  l public.leads;
  v_contact uuid;
begin
  select x.contact_id into v_contact from public.leads x where x.id = p_lead;
  if v_contact is not null then
    perform 1 from public.contacts c where c.id = v_contact for share;
  end if;
  select * into l from public.leads x where x.id = p_lead for update;
  if l.contact_id is distinct from v_contact then
    perform app.followup_error('SM224');
  end if;
  return l;
end;
$$;
revoke all on function app.followup_lock(uuid) from public;

-- ---------------------------------------------------------------------------------------------
-- public.record_touch: a PERSON records a fact: "I sent it" (out) or "they replied" (in). Owner / Admin / Sales, any assurance level.
--   An OUTBOUND touch obeys the gate (suppressed, erased, no key, suppressed key, no consent): nobody can record contacting a person the system may not contact.
--   An INBOUND touch is ALWAYS recordable (it can only stop outreach: the engine answers human_takeover), and discards the lead's open drafts.
-- ---------------------------------------------------------------------------------------------
create function public.record_touch(p_touch_id uuid, p_lead_id uuid, p_direction text, p_channel text, p_occurred_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  l       public.leads;
  v_exist public.lead_touches;
  v_at    timestamptz;
  v_out   integer;
  g       jsonb;
begin
  if v_uid is null or p_touch_id is null or p_lead_id is null then
    perform app.followup_deny();
  end if;
  select * into l from public.leads x where x.id = p_lead_id;
  if not found or not app.has_tenant_role(l.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_direction is null or p_direction not in ('out', 'in') or p_channel is null or p_channel not in ('email', 'whatsapp', 'phone') then
    perform app.followup_error('invalid');
  end if;
  -- null = now (the database clock). A stated time: at most 5 minutes ahead (clock slack), at most 7 days back, and never before the lead existed
  if p_occurred_at is not null and (p_occurred_at > now() + interval '5 minutes' or p_occurred_at < now() - interval '7 days' or p_occurred_at < l.created_at) then
    perform app.followup_error('value');
  end if;
  l := app.followup_lock(p_lead_id);

  -- an exact retry replays (a null time matches any stored time); anything else under a used id is the constant conflict
  select * into v_exist from public.lead_touches t where t.id = p_touch_id;
  if found then
    if v_exist.tenant_id = l.tenant_id and v_exist.lead_id = l.id and v_exist.direction::text = p_direction and v_exist.channel::text = p_channel
       and v_exist.draft_id is null and (p_occurred_at is null or v_exist.occurred_at = p_occurred_at) then
      return jsonb_build_object('touch_id', v_exist.id, 'lead_id', l.id, 'direction', v_exist.direction, 'replayed', true);
    end if;
    perform app.followup_error('conflict');
  end if;

  if p_direction = 'out' then
    g := app.followup_gate(l.id, p_channel::public.consent_channel, true);
    if g ->> 'code' is not null then
      perform app.followup_error(g ->> 'code', g ->> 'detail');
    end if;
  elsif exists (select 1 from public.contacts c where c.tenant_id = l.tenant_id and c.id = l.contact_id and c.erased_at is not null) then
    -- an inbound touch bypasses the outbound gate (it can only stop outreach) but NEVER for an erased contact: erasure wins, no new record about an erased person
    perform app.followup_error('SM220', 'erased');
  end if;
  if (select count(*) from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id) >= 500 then
    perform app.followup_error('SM229');
  end if;
  v_at := coalesce(p_occurred_at, now());
  insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_by)
  values (p_touch_id, l.tenant_id, l.id, l.contact_id, p_direction::public.touch_direction, p_channel::public.consent_channel, v_at, v_uid);

  if p_direction = 'in' then
    -- a reply: no draft stays open (the engine now answers human_takeover)
    update public.followup_drafts d set status = 'discarded', discarded_at = now(), discarded_by = v_uid, discard_code = 'reply_recorded'
     where d.tenant_id = l.tenant_id and d.lead_id = l.id and d.status in ('draft', 'approved');
  else
    -- a newer outbound touch: a draft for this touch number or an earlier one is out of date
    select count(*) into v_out from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.direction = 'out';
    update public.followup_drafts d set status = 'discarded', discarded_at = now(), discarded_by = v_uid, discard_code = 'superseded'
     where d.tenant_id = l.tenant_id and d.lead_id = l.id and d.status in ('draft', 'approved') and d.touch_number <= v_out;
  end if;
  return jsonb_build_object('touch_id', p_touch_id, 'lead_id', l.id, 'direction', p_direction, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.create_followup_draft: Owner / Admin / Sales. The caller names a LEAD; the contact is the lead's. See the header for what is proven.
-- ---------------------------------------------------------------------------------------------
create function public.create_followup_draft(p_draft_id uuid, p_lead_id uuid, p_channel text, p_engine_version text, p_request_text text, p_result_text text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  l        public.leads;
  v_exist  public.followup_drafts;
  g        jsonb;
  v_stop   text;
  v_pver   uuid;
  pv       public.followup_policy_versions;
  v_req    jsonb;
  v_res    jsonb;
  v_built  jsonb;
  v_as     text;
  v_as_ts  timestamptz;
  v_hash   text;
  v_block  text;
  v_n      integer;
  v_code   text;
  v_body   text;
begin
  if v_uid is null or p_draft_id is null or p_lead_id is null then
    perform app.followup_deny();
  end if;
  select * into l from public.leads x where x.id = p_lead_id;
  if not found or not app.has_tenant_role(l.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_channel is null or p_channel not in ('email', 'whatsapp') or p_engine_version is null or p_request_text is null or p_result_text is null
     or char_length(p_request_text) > 100000 or char_length(p_result_text) > 200000 or not app.text_is_clean(p_request_text) or not app.text_is_clean(p_result_text) then
    perform app.followup_error('invalid');
  end if;
  l := app.followup_lock(p_lead_id);

  -- an exact retry replays (whatever state the draft has reached since); anything else under a used id is the constant conflict
  select * into v_exist from public.followup_drafts d where d.id = p_draft_id;
  if found then
    if v_exist.tenant_id = l.tenant_id and v_exist.lead_id = l.id and v_exist.channel::text = p_channel and v_exist.engine_version = p_engine_version
       and v_exist.request_text = p_request_text and v_exist.result_text = p_result_text then
      return jsonb_build_object('draft_id', v_exist.id, 'lead_id', l.id, 'touch_number', v_exist.touch_number, 'status', v_exist.status, 'replayed', true);
    end if;
    perform app.followup_error('conflict');
  end if;

  -- 1. the gate (suppression, erasure, keys, consent), then the stop (orders, a withdrawn quote, an archived lead), then the policy
  g := app.followup_gate(l.id, p_channel::public.consent_channel, true);
  if g ->> 'code' is not null then
    perform app.followup_error(g ->> 'code', g ->> 'detail');
  end if;
  v_stop := app.followup_stopped(l.id);
  if v_stop is not null then
    perform app.followup_error('SM227', v_stop);
  end if;
  v_pver := app.followup_active_policy_version(l.tenant_id, app.quote_today());
  if v_pver is null then
    perform app.followup_error('SM222');
  end if;
  select * into pv from public.followup_policy_versions x where x.id = v_pver;
  if not exists (select 1 from public.followup_engine_versions v where v.version = p_engine_version) then
    perform app.followup_error('value');
  end if;
  begin
    v_req := p_request_text::jsonb;
    v_res := p_result_text::jsonb;
  exception when others then
    perform app.followup_error('invalid');
  end;
  if jsonb_typeof(v_req) <> 'object' or jsonb_typeof(v_res) <> 'object' then
    perform app.followup_error('invalid');
  end if;

  -- 2. the request is the one the database builds from its own rows, as of the database's own clock
  v_as := v_req ->> 'as_of';
  if v_as is null or v_as !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' then
    perform app.followup_error('SM226');
  end if;
  begin
    v_as_ts := v_as::timestamptz;
  exception when others then
    perform app.followup_error('SM226');
  end;
  if v_as_ts < now() - interval '10 minutes' or v_as_ts > now() + interval '2 minutes' then
    perform app.followup_error('SM226');
  end if;
  v_built := app.followup_build(l.id, v_as, v_pver);
  if v_req is distinct from v_built then
    perform app.followup_error('SM226');
  end if;
  v_hash := app.followup_request_hash(p_engine_version, p_request_text);

  -- 3. the decision is the database's own: nothing is created unless the engine would answer draft_followup
  v_block := app.followup_blocker(v_req);
  if v_block is not null then
    perform app.followup_error('SM225', v_block);
  end if;
  select count(*) into v_n from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.direction = 'out';
  -- 4. the engine's result is exactly that decision
  if not app.followup_result_ok(v_req, v_res, p_engine_version, v_hash, v_n + 1) then
    perform app.followup_error('SM226');
  end if;
  if exists (select 1 from public.followup_drafts d where d.tenant_id = l.tenant_id and d.lead_id = l.id and d.touch_number = v_n + 1 and d.status in ('draft', 'approved')) then
    perform app.followup_error('SM223', 'exists');
  end if;

  v_code := app.followup_template_code(v_n + 1, pv.max_touches);
  select t.body into v_body from public.followup_templates t where t.code = v_code;
  insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text,
                                      canonical_hash, state_hash, as_of)
  values (p_draft_id, l.tenant_id, l.id, l.contact_id, v_n + 1, p_channel::public.consent_channel, v_code, v_body, v_pver, p_engine_version, p_request_text, p_result_text,
          v_hash, app.followup_state_hash(l.id, l.contact_id, p_channel, v_pver), v_as_ts);
  return jsonb_build_object('draft_id', p_draft_id, 'lead_id', l.id, 'touch_number', v_n + 1, 'status', 'draft', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.approve_followup_draft: Owner / Admin with a second factor. Re-checks the gate, the stop and the state under the locks; p_state_hash is the fingerprint the person reviewed.
-- ---------------------------------------------------------------------------------------------
create function public.approve_followup_draft(p_draft_id uuid, p_state_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  d      public.followup_drafts;
  l      public.leads;
  g      jsonb;
  v_stop text;
begin
  if v_uid is null or p_draft_id is null then
    perform app.followup_deny();
  end if;
  select * into d from public.followup_drafts x where x.id = p_draft_id;
  if not found or not app.has_tenant_role(d.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  perform app.require_aal2();
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    perform app.followup_error('invalid');
  end if;
  l := app.followup_lock(d.lead_id);
  select * into d from public.followup_drafts x where x.id = p_draft_id for update;

  if d.status = 'approved' and d.state_hash = p_state_hash then
    return jsonb_build_object('draft_id', d.id, 'status', d.status, 'replayed', true);
  end if;
  if d.status <> 'draft' then
    perform app.followup_error('SM223', 'not_draft');
  end if;
  if l.contact_id is distinct from d.contact_id then
    perform app.followup_error('SM224');
  end if;
  g := app.followup_gate(l.id, d.channel, true);
  if g ->> 'code' is not null then
    perform app.followup_error(g ->> 'code', g ->> 'detail');
  end if;
  v_stop := app.followup_stopped(l.id);
  if v_stop is not null then
    perform app.followup_error('SM227', v_stop);
  end if;
  -- stale: the person reviewed another version, or the history, the policy or the flags moved since the draft was made
  if d.state_hash <> p_state_hash or d.state_hash <> app.followup_state_hash(l.id, d.contact_id, d.channel::text, d.policy_version_id)
     or app.followup_active_policy_version(l.tenant_id, app.quote_today()) is distinct from d.policy_version_id then
    perform app.followup_error('SM224');
  end if;
  update public.followup_drafts x set status = 'approved', approved_by = v_uid, approved_at = now() where x.id = d.id;
  return jsonb_build_object('draft_id', d.id, 'status', 'approved', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.discard_followup_draft: Owner / Admin on any draft, Sales on their own. Needs no gate: discarding is always safe.
-- ---------------------------------------------------------------------------------------------
create function public.discard_followup_draft(p_draft_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  d     public.followup_drafts;
begin
  if v_uid is null or p_draft_id is null then
    perform app.followup_deny();
  end if;
  select * into d from public.followup_drafts x where x.id = p_draft_id;
  if not found or not app.has_tenant_role(d.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if not app.has_tenant_role(d.tenant_id, array['owner', 'admin']::public.app_role[]) and d.created_by is distinct from v_uid then
    perform app.followup_error('SM228');
  end if;
  perform app.followup_lock(d.lead_id);
  select * into d from public.followup_drafts x where x.id = p_draft_id for update;
  if d.status = 'discarded' then
    return jsonb_build_object('draft_id', d.id, 'status', d.status, 'replayed', true);
  end if;
  if d.status = 'recorded_sent' then
    perform app.followup_error('SM223', 'closed');
  end if;
  update public.followup_drafts x set status = 'discarded', discarded_at = now(), discarded_by = v_uid, discard_code = 'person' where x.id = d.id;
  return jsonb_build_object('draft_id', d.id, 'status', 'discarded', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.record_draft_sent: "I sent it". Only for an APPROVED draft; inserts the outbound touch and closes the draft. Owner / Admin / Sales.
-- Repeats the gate and the stop at THIS step: an approval that was valid when given is not enough later (plan section 11, requirements 1 and 2).
-- ---------------------------------------------------------------------------------------------
create function public.record_draft_sent(p_draft_id uuid, p_touch_id uuid, p_occurred_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  d       public.followup_drafts;
  l       public.leads;
  v_exist public.lead_touches;
  g       jsonb;
  v_stop  text;
  v_out   integer;
begin
  if v_uid is null or p_draft_id is null or p_touch_id is null then
    perform app.followup_deny();
  end if;
  select * into d from public.followup_drafts x where x.id = p_draft_id;
  if not found or not app.has_tenant_role(d.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  l := app.followup_lock(d.lead_id);
  select * into d from public.followup_drafts x where x.id = p_draft_id for update;

  -- an exact retry replays; a draft already recorded under another touch id is closed
  select * into v_exist from public.lead_touches t where t.id = p_touch_id;
  if found then
    if v_exist.draft_id = d.id and d.status = 'recorded_sent' and (p_occurred_at is null or v_exist.occurred_at = p_occurred_at) then
      return jsonb_build_object('draft_id', d.id, 'touch_id', v_exist.id, 'status', d.status, 'replayed', true);
    end if;
    perform app.followup_error('conflict');
  end if;
  if d.status = 'recorded_sent' then
    perform app.followup_error('SM223', 'closed');
  end if;
  if d.status <> 'approved' then
    perform app.followup_error('SM223', 'not_approved');
  end if;
  -- the sent time: never before the approval, never more than 5 minutes ahead (null = the database clock)
  if p_occurred_at is not null and (p_occurred_at > now() + interval '5 minutes' or p_occurred_at < d.approved_at) then
    perform app.followup_error('value');
  end if;
  if l.contact_id is distinct from d.contact_id then
    perform app.followup_error('SM224');
  end if;
  g := app.followup_gate(l.id, d.channel, true);
  if g ->> 'code' is not null then
    perform app.followup_error(g ->> 'code', g ->> 'detail');
  end if;
  v_stop := app.followup_stopped(l.id);
  if v_stop is not null then
    perform app.followup_error('SM227', v_stop);
  end if;
  -- the history must still be the one the draft was made for: this touch is outbound number touch_number - 1 + 1
  select count(*) into v_out from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.direction = 'out';
  if v_out <> d.touch_number - 1 or exists (select 1 from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.direction = 'in') then
    perform app.followup_error('SM224');
  end if;
  if (select count(*) from public.lead_touches t where t.tenant_id = l.tenant_id and t.lead_id = l.id) >= 500 then
    perform app.followup_error('SM229');
  end if;
  insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, draft_id, recorded_by)
  values (p_touch_id, l.tenant_id, l.id, d.contact_id, 'out', d.channel, coalesce(p_occurred_at, now()), d.id, v_uid);
  update public.followup_drafts x set status = 'recorded_sent' where x.id = d.id;
  -- an earlier open draft of this lead is out of date now
  update public.followup_drafts x set status = 'discarded', discarded_at = now(), discarded_by = v_uid, discard_code = 'superseded'
   where x.tenant_id = l.tenant_id and x.lead_id = l.id and x.status in ('draft', 'approved') and x.touch_number <= d.touch_number;
  return jsonb_build_object('draft_id', d.id, 'touch_id', p_touch_id, 'status', 'recorded_sent', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: the internal functions are nobody's; the public ones are the signed-in people's
-- ---------------------------------------------------------------------------------------------
revoke all on function public.create_followup_policy_version(uuid, uuid, date, jsonb), public.followup_gate(uuid, text), public.record_touch(uuid, uuid, text, text, timestamptz),
  public.create_followup_draft(uuid, uuid, text, text, text, text), public.approve_followup_draft(uuid, text), public.discard_followup_draft(uuid),
  public.record_draft_sent(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.create_followup_policy_version(uuid, uuid, date, jsonb), public.followup_gate(uuid, text), public.record_touch(uuid, uuid, text, text, timestamptz),
  public.create_followup_draft(uuid, uuid, text, text, text, text), public.approve_followup_draft(uuid, text), public.discard_followup_draft(uuid),
  public.record_draft_sent(uuid, uuid, timestamptz) to authenticated;
