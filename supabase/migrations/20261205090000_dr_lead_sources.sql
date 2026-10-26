-- Job DR / A2 (night run 27 Oct 2026): LEAD SOURCES AND IMPORTS. Leads arrive in bulk (a file, a Google Sheet, a pasted list, a vCard) or by themselves (a website form, a webhook, e-mail
-- forwarded by a portal, Meta Lead Ads, IndiaMART). Every arrival goes through ONE function (app.lead_intake_core): de-duplicate by phone, flag a number that cannot be called, mark Do-Not-Disturb,
-- record the owner's consent, add a "touch" to the lead's history, keep the source tag in leads.source.
--
--   public.lead_consents        the owner's consent confirmation (who, when, which list, purpose, how it was collected); append-only
--   public.lead_sources         a live source: its kind, the source tag, a HASH of its secret address, counters
--   public.lead_intakes         one row per call of lead_intake_apply (a part of a bulk import): the counts and the first 50 problems; no personal data
--   public.lead_flags           per contact: dnd | invalid_number
--   public.lead_arrivals         the history of a lead: the first arrival and every time the same person came again, with what they wrote (contact details removed)
--   public.lead_source_costs    cost per lead per source tag (A3 sets it too: PUT /outreach/source-costs; created HERE, the columns are agreed with A3)
--   public.lead_sheet_links     a Google Sheet that is kept in sync (the worker pulls it)
--   public.lead_unparsed        mail from a forwarding address that no parser could read (so nothing is lost)
--   integrations.lead_items     idempotency ledger (tenant, tag, the sender's id): no personal data, not an audited tenant table (volume)
--   integrations.lead_source_hits  per source and minute: the cap on public calls
--
-- Who writes: only these SECURITY DEFINER functions. A person acts with their own token (Owner, Admin and Sales import; Owner and Admin manage sources). The public doors (a website form,
-- a portal's mail, Meta) are reached through the API's registered worker account, which may call only the scheduler_* functions; they re-check the secret address (its hash).
-- SQLSTATEs: 22023 invalid input, 42501 not allowed, 23503 not found, 23505 id used for other content, 53400 limit.

create function app.lead_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for other content' using errcode = '23505';
    when 'limit'     then raise exception 'too many' using errcode = '53400';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.lead_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the phone in its stored form: +91 and ten digits for an Indian mobile, "+" and 8 to 15 digits for another country, the reserved synthetic "+00 ..." as typed. Null when it cannot be called.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lead_e164(p text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := btrim(coalesce(p, ''));
  n text;
  d text;
begin
  if t = '' then
    return null;
  end if;
  if t ~ '^\+\s*00' then
    return case when char_length(t) between 8 and 24 and t ~ '^\+[0-9 ()-]+$' then t end;   -- the synthetic numbers of demo data
  end if;
  n := app.phone_norm(t);
  if n is null then
    return null;
  end if;
  if char_length(n) = 10 and n ~ '^[6-9]' then
    return '+91' || n;
  end if;
  if t ~ '^\+' and t !~ '^\+\s*91' then
    d := regexp_replace(t, '[^0-9]', '', 'g');
    if char_length(d) between 8 and 15 and d !~ '^0' then
      return '+' || d;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.lead_e164(text) from public;

-- text from a sender: control characters out, contact details out (a phone number or an address inside the words is replaced), at most p_max characters
create function app.lead_clean_text(p text, p_max integer) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := coalesce(p, '');
begin
  t := regexp_replace(t, '[[:cntrl:]]', ' ', 'g');
  t := regexp_replace(t, '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+', '[removed]', 'g');
  t := regexp_replace(t, '(\+?[0-9][0-9 ().-]{6,}[0-9])', '[removed]', 'g');
  t := regexp_replace(btrim(t), '\s+', ' ', 'g');
  t := left(t, p_max);
  if t = '' or not app.text_is_clean(t) or app.text_has_contact(t) then
    return null;
  end if;
  return t;
end;
$$;
revoke all on function app.lead_clean_text(text, integer) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the source tags (leads.source): one closed list, shared with the cost table and the reports
create function app.lead_tag_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p = any (array['indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'meta_lead_ads', 'website_form', 'webhook', 'excel_upload', 'google_sheet', 'pasted_list', 'vcard']) $$;
revoke all on function app.lead_tag_ok(text) from public;

create table public.lead_sources (
  id               uuid primary key,
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  kind             text not null check (kind in ('website_form', 'webhook', 'email_forward', 'meta_lead_ads', 'indiamart')),
  tag              text not null check (app.lead_tag_ok(tag)),
  label            text not null check (char_length(label) between 1 and 80 and app.text_is_clean(label)),
  status           text not null default 'active' check (status in ('active', 'paused')),
  token_hash       text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_hint       text check (token_hint is null or token_hint ~ '^[A-Za-z0-9_-]{4}$'),
  created_by       uuid not null,
  created_at       timestamptz not null default app.outbox_now(),
  updated_at       timestamptz not null default app.outbox_now(),
  last_received_at timestamptz,
  received_count   integer not null default 0 check (received_count >= 0),
  unique (tenant_id, id),
  check ((kind = 'indiamart') = (token_hash is null))
);
create index lead_sources_tenant_idx on public.lead_sources (tenant_id, created_at desc, id);
comment on table public.lead_sources is 'Job DR / A2: a live source of leads. The secret address is shown once; only its sha-256 is kept. Written only by lead_source_create / _rotate / _set_status and the scheduler''s intake functions (counters).';
comment on column public.lead_sources.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_sources.tag is 'SAFE: a closed source tag. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_sources.label is 'SAFE: the owner''s name for the source (for example "Website contact form").';
comment on column public.lead_sources.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_sources.token_hash is 'SAFE: sha-256 of the secret address; the address itself is never stored. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_sources.token_hint is 'SAFE: the last four characters of the secret address. CLEAN-EXEMPT: pattern CHECK';

create table public.lead_consents (
  id                uuid primary key,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  source_id         uuid,
  list_name         text not null check (char_length(list_name) between 1 and 120 and app.text_is_clean(list_name)),
  purpose           text not null check (char_length(purpose) between 1 and 300 and app.text_is_clean(purpose)),
  basis             public.consent_basis not null check (basis in ('explicit_consent', 'legitimate_use', 'contractual')),
  how_collected     text not null check (char_length(how_collected) between 1 and 300 and app.text_is_clean(how_collected)),
  statement_version text not null check (statement_version ~ '^[a-z0-9._-]{1,32}$'),
  confirmed_by      uuid not null,
  confirmed_at      timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id)
);
create index lead_consents_tenant_idx on public.lead_consents (tenant_id, confirmed_at desc, id);
create index lead_consents_source_idx on public.lead_consents (tenant_id, source_id);
comment on table public.lead_consents is 'Job DR / A2: the owner''s confirmation that the people on a list may be contacted (who, when, which list, purpose, how it was collected, the wording version). Append-only evidence; every contact consent it leads to points at it (consent_events.evidence_ref = lcn:<id>).';
comment on column public.lead_consents.basis is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_consents.list_name is 'SAFE: the owner''s name for the list.';
comment on column public.lead_consents.purpose is 'SAFE: what the owner will contact them about.';
comment on column public.lead_consents.how_collected is 'SAFE: how the owner got the numbers (a sentence).';
comment on column public.lead_consents.statement_version is 'SAFE: the version of the wording the owner confirmed. CLEAN-EXEMPT: pattern CHECK';

create table public.lead_intakes (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  import_id   uuid not null,
  part        smallint not null default 1 check (part between 1 and 20),
  kind        text not null check (kind in ('file', 'paste', 'vcard', 'sheet', 'indiamart')),
  source_tag  text not null check (app.lead_tag_ok(source_tag)),
  consent_id  uuid,
  content_sha text not null check (content_sha ~ '^[0-9a-f]{64}$'),
  rows_read   integer not null check (rows_read between 0 and 5000),
  counts      jsonb not null check (jsonb_typeof(counts) = 'object'),
  problems    jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array' and jsonb_array_length(problems) <= 50),
  created_by  uuid not null,
  created_at  timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  unique (tenant_id, import_id, part),
  foreign key (tenant_id, consent_id) references public.lead_consents (tenant_id, id)
);
create index lead_intakes_tenant_idx on public.lead_intakes (tenant_id, created_at desc, id);
create index lead_intakes_consent_idx on public.lead_intakes (tenant_id, consent_id);
comment on table public.lead_intakes is 'Job DR / A2: the ledger of imports (one row per part of at most 500 rows): counts and the first 50 problems by row number. No personal data. Written only by lead_intake_apply.';
comment on column public.lead_intakes.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_intakes.source_tag is 'SAFE: a closed source tag. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_intakes.content_sha is 'SAFE: sha-256 of the rows. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_intakes.counts is 'SAFE: numbers only.';
comment on column public.lead_intakes.problems is 'SAFE: row numbers and closed reasons only.';

create table public.lead_flags (
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  contact_id uuid not null,
  flag       text not null check (flag in ('dnd', 'invalid_number')),
  set_by     text not null check (set_by in ('provider', 'import')),
  set_at     timestamptz not null default app.outbox_now(),
  primary key (tenant_id, contact_id, flag),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
comment on table public.lead_flags is 'Job DR / A2: dnd (the number is on the Do-Not-Disturb register: WhatsApp only, no promotional calls) and invalid_number (a number was given but cannot be called). Written only by the intake functions.';
comment on column public.lead_flags.flag is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_flags.set_by is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.lead_arrivals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  lead_id     uuid not null,
  contact_id  uuid not null,
  source_tag  text not null check (app.lead_tag_ok(source_tag)),
  kind        text not null check (kind in ('first', 'repeat')),
  message     text check (message is null or (char_length(message) between 1 and 1000 and app.text_is_clean(message) and not app.text_has_contact(message))),
  received_at timestamptz not null default app.outbox_now(),
  created_at  timestamptz not null default app.outbox_now(),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
create index lead_arrivals_lead_idx on public.lead_arrivals (tenant_id, lead_id, received_at desc, id);
create index lead_arrivals_contact_idx on public.lead_arrivals (tenant_id, contact_id);
create index lead_arrivals_tenant_idx on public.lead_arrivals (tenant_id, created_at desc, id);
comment on table public.lead_arrivals is 'Job DR / A2: the history of a lead: the first arrival and every time the same person arrived again (another file, another portal), with what they wrote. Written only by the intake functions.';
comment on column public.lead_arrivals.source_tag is 'SAFE: a closed source tag. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_arrivals.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_arrivals.message is 'PII: what the person wrote (a phone number or an address inside it is removed before it is stored, but a name can remain). Erased with the workspace.';

create table if not exists public.lead_source_costs (
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  source              text not null check (char_length(source) between 1 and 64 and app.text_is_clean(source)),
  cost_per_lead_paise bigint not null check (cost_per_lead_paise between 0 and 10000000),
  updated_by          uuid not null,
  created_at          timestamptz not null default app.outbox_now(),
  updated_at          timestamptz not null default app.outbox_now(),
  primary key (tenant_id, source)
);
comment on table public.lead_source_costs is 'Job DR / A2 (columns agreed with A3): what a lead from a source costs the business, in paise. Written by lead_intake_apply (an import that states a cost) and by A3''s PUT /outreach/source-costs.';
comment on column public.lead_source_costs.source is 'SAFE: a source tag (leads.source). CLEAN-EXEMPT: checked by app.text_is_clean in the table';

create table public.lead_sheet_links (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  sheet_id        text not null check (sheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  gid             text check (gid is null or gid ~ '^[0-9]{1,20}$'),
  source_tag      text not null default 'google_sheet' check (source_tag = 'google_sheet'),
  mapping         jsonb not null check (jsonb_typeof(mapping) = 'object' and octet_length(mapping::text) <= 1000),
  header_sha      text not null check (header_sha ~ '^[0-9a-f]{64}$'),
  consent_id      uuid,
  status          text not null default 'active' check (status in ('active', 'paused', 'needs_attention')),
  last_synced_at  timestamptz,
  last_row_count  integer check (last_row_count is null or last_row_count >= 0),
  last_result     jsonb check (last_result is null or jsonb_typeof(last_result) = 'object'),
  last_error      text check (last_error is null or last_error in ('sheet_not_public', 'columns_changed', 'unreachable', 'too_large')),
  created_by      uuid not null,
  created_at      timestamptz not null default app.outbox_now(),
  updated_at      timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  unique (tenant_id, sheet_id, gid),
  foreign key (tenant_id, consent_id) references public.lead_consents (tenant_id, id)
);
create index lead_sheet_links_tenant_idx on public.lead_sheet_links (tenant_id, created_at desc, id);
create index lead_sheet_links_consent_idx on public.lead_sheet_links (tenant_id, consent_id);
create index lead_sheet_links_due_idx on public.lead_sheet_links (last_synced_at nulls first) where status = 'active';
comment on table public.lead_sheet_links is 'Job DR / A2: a Google Sheet kept in sync. The sheet must be readable without a sign-in (anyone with the link, or published to the web); a private sheet needs a service account (not set up yet). The worker pulls active links every 15 minutes.';
comment on column public.lead_sheet_links.sheet_id is 'SAFE: the sheet''s id in its address (not a secret that grants anything: the sheet is public). CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_sheet_links.gid is 'SAFE: the tab number. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_sheet_links.source_tag is 'SAFE: a closed source tag. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_sheet_links.mapping is 'SAFE: field name to column number; no cell values.';
comment on column public.lead_sheet_links.header_sha is 'SAFE: sha-256 of the header row. CLEAN-EXEMPT: pattern CHECK';
comment on column public.lead_sheet_links.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_sheet_links.last_result is 'SAFE: numbers only.';
comment on column public.lead_sheet_links.last_error is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.lead_unparsed (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  source_id    uuid not null,
  subject      text check (subject is null or (char_length(subject) <= 200 and app.text_is_clean(subject))),
  body         text not null check (char_length(body) between 1 and 4000 and app.text_is_clean(body)),
  received_at  timestamptz not null default app.outbox_now(),
  discarded_at timestamptz,
  foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id)
);
create index lead_unparsed_source_idx on public.lead_unparsed (tenant_id, source_id);
create index lead_unparsed_tenant_idx on public.lead_unparsed (tenant_id, received_at desc, id);
comment on table public.lead_unparsed is 'Job DR / A2: mail that came to a forwarding address but no parser could read. The owner copies the lead by hand or discards it.';
comment on column public.lead_unparsed.subject is 'PII: the mail''s subject; may hold a name. Erased with the workspace.';
comment on column public.lead_unparsed.body is 'PII: the mail''s text; holds the sender''s name and contact details. Erased with the workspace.';

create table integrations.lead_items (
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  source_tag  text not null check (app.lead_tag_ok(source_tag)),
  external_id text not null check (char_length(external_id) between 1 and 100),
  lead_id     uuid,
  created_at  timestamptz not null default app.outbox_now(),
  primary key (tenant_id, source_tag, external_id)
);
alter table integrations.lead_items enable row level security;
alter table integrations.lead_items force row level security;
revoke all on integrations.lead_items from public, anon, authenticated, service_role;
comment on column integrations.lead_items.external_id is 'SAFE: the sender''s own id (or a hash of phone, message and day); never a name or a number.';

create table integrations.lead_source_hits (
  source_id uuid not null,
  bucket    timestamptz not null,
  n         integer not null default 0,
  primary key (source_id, bucket)
);
alter table integrations.lead_source_hits enable row level security;
alter table integrations.lead_source_hits force row level security;
revoke all on integrations.lead_source_hits from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['lead_sources', 'lead_consents', 'lead_intakes', 'lead_source_costs', 'lead_sheet_links', 'lead_unparsed'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]))$p$, t || '_select', t);
    execute format('drop trigger if exists %I on public.%I', t || '_forbid_tenant_id_change', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
  foreach t in array array['lead_flags', 'lead_arrivals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]))$p$, t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;

-- the consent confirmation is evidence: nothing but an erasure of its (non-personal) text may change it, and it is never deleted
create trigger lead_consents_no_update before update on public.lead_consents for each row execute function app.guard_consent_update();
create trigger lead_consents_no_delete before delete on public.lead_consents for each row execute function app.append_only();
create trigger lead_consents_no_truncate before truncate on public.lead_consents for each statement execute function app.append_only();

create trigger audit_lead_sources after insert or update or delete on public.lead_sources for each row execute function app.audit_row_change('lead_source', '');
create trigger audit_lead_consents after insert or update or delete on public.lead_consents for each row execute function app.audit_row_change('lead_consent', '');
create trigger audit_lead_intakes after insert or update or delete on public.lead_intakes for each row execute function app.audit_row_change('lead_intake', '');
create trigger audit_lead_flags after insert or update or delete on public.lead_flags for each row execute function app.audit_row_change('lead_flag', '');
create trigger audit_lead_arrivals after insert or update or delete on public.lead_arrivals for each row execute function app.audit_row_change('lead_arrival', 'message');
drop trigger if exists audit_lead_source_costs on public.lead_source_costs;
create trigger audit_lead_source_costs after insert or update or delete on public.lead_source_costs for each row execute function app.audit_row_change('lead_source_cost', '');
create trigger audit_lead_sheet_links after insert or update or delete on public.lead_sheet_links for each row execute function app.audit_row_change('lead_sheet_link', '');
create trigger audit_lead_unparsed after insert or update or delete on public.lead_unparsed for each row execute function app.audit_row_change('lead_unparsed', 'subject,body');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('lead_arrivals',  'message', 'tenant', 'tombstone', 'erased:1'),
  ('lead_unparsed', 'subject', 'tenant', 'null',      'erased:1'),
  ('lead_unparsed', 'body',    'tenant', 'tombstone', 'erased:1'),
  ('lead_arrivals',  'message', 'sweep',  'substring', 'erased:1'),
  ('lead_unparsed', 'subject', 'sweep',  'substring', 'erased:1'),
  ('lead_unparsed', 'body',    'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the consent confirmation
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lead_consent_json(c public.lead_consents) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'source_id', c.source_id, 'list_name', c.list_name, 'purpose', c.purpose, 'basis', c.basis, 'how_collected', c.how_collected,
                            'statement_version', c.statement_version, 'confirmed_by', c.confirmed_by, 'confirmed_at', c.confirmed_at)
$$;
revoke all on function app.lead_consent_json(public.lead_consents) from public;

-- Idempotent on the id: the same words under the same id return the stored record; other words under it are a conflict.
create function app.lead_consent_store(p_tenant uuid, p_id uuid, p_source uuid, p_list text, p_purpose text, p_basis text, p_how text, p_actor uuid) returns public.lead_consents
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.lead_consents;
begin
  if p_id is null or p_list is null or p_purpose is null or p_basis is null or p_how is null
     or p_basis not in ('explicit_consent', 'legitimate_use', 'contractual')
     or char_length(btrim(p_list)) not between 1 and 120 or char_length(btrim(p_purpose)) not between 1 and 300 or char_length(btrim(p_how)) not between 1 and 300
     or not app.text_is_clean(p_list) or not app.text_is_clean(p_purpose) or not app.text_is_clean(p_how) then
    perform app.lead_error('invalid');
  end if;
  select * into c from public.lead_consents x where x.tenant_id = p_tenant and x.id = p_id;
  if found then
    if c.list_name <> btrim(p_list) or c.purpose <> btrim(p_purpose) or c.basis::text <> p_basis or c.how_collected <> btrim(p_how) or c.source_id is distinct from p_source then
      perform app.lead_error('conflict');
    end if;
    return c;
  end if;
  insert into public.lead_consents (id, tenant_id, source_id, list_name, purpose, basis, how_collected, statement_version, confirmed_by)
  values (p_id, p_tenant, p_source, btrim(p_list), btrim(p_purpose), p_basis::public.consent_basis, btrim(p_how), 'dr-2026-10-27', p_actor)
  returning * into c;
  return c;
end;
$$;
revoke all on function app.lead_consent_store(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

create function public.lead_consent_confirm(p_tenant_id uuid, p_id uuid, p_list_name text, p_purpose text, p_basis text, p_how_collected text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.lead_consents;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  c := app.lead_consent_store(p_tenant_id, p_id, null, p_list_name, p_purpose, p_basis, p_how_collected, auth.uid());
  return app.lead_consent_json(c);
end;
$$;
revoke all on function public.lead_consent_confirm(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.lead_consent_confirm(uuid, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the core: one list of rows for one workspace and one source tag
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Consent for one channel of one contact: granted only from `unknown` (a withdrawal is never undone by an import) and never for a suppressed contact.
create function app.lead_consent_grant(p_tenant uuid, p_contact uuid, p_channel public.consent_channel, p_basis public.consent_basis, p_ref text, p_actor uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.contacts;
  v_cur public.consent_status;
begin
  select * into k from public.contacts x where x.tenant_id = p_tenant and x.id = p_contact for update;
  if not found or k.suppressed_at is not null or k.erased_at is not null then
    return;
  end if;
  v_cur := case p_channel when 'email' then k.email_consent when 'whatsapp' then k.whatsapp_consent else k.phone_consent end;
  if v_cur <> 'unknown' then
    return;
  end if;
  if p_channel = 'email' then
    update public.contacts set email_consent = 'granted' where id = p_contact;
  elsif p_channel = 'whatsapp' then
    update public.contacts set whatsapp_consent = 'granted' where id = p_contact;
  else
    update public.contacts set phone_consent = 'granted' where id = p_contact;
  end if;
  insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
  values (p_tenant, p_contact, 'granted', p_channel, p_basis, 'imported', p_ref, p_actor);
end;
$$;
revoke all on function app.lead_consent_grant(uuid, uuid, public.consent_channel, public.consent_basis, text, uuid) from public, anon, authenticated;

-- Do-Not-Disturb: promotional calls stop (the phone channel is withdrawn); WhatsApp is untouched.
create function app.lead_mark_dnd(p_tenant uuid, p_contact uuid, p_actor uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.contacts;
begin
  insert into public.lead_flags (tenant_id, contact_id, flag, set_by) values (p_tenant, p_contact, 'dnd', 'provider') on conflict do nothing;
  select * into k from public.contacts x where x.tenant_id = p_tenant and x.id = p_contact for update;
  if found and k.phone_consent <> 'withdrawn' then
    update public.contacts set phone_consent = 'withdrawn' where id = p_contact;
    insert into public.consent_events (tenant_id, contact_id, event_type, channel, evidence_type, evidence_ref, recorded_by)
    values (p_tenant, p_contact, 'withdrawn', 'phone', 'imported', 'dnd:register', p_actor);
  end if;
end;
$$;
revoke all on function app.lead_mark_dnd(uuid, uuid, uuid) from public, anon, authenticated;

-- Did this person (any of their identifiers, in the current or the previous key version) opt out before? p_keys / p_also are the HMACs the API computed (the key never reaches the database).
create function app.lead_keys_blocked(p_tenant uuid, p_keys jsonb, p_also jsonb) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from (
      select 'email'::text as k, p_keys ->> 'email' as h
      union all select 'phone', p_keys ->> 'phone'
      union all select 'email', jsonb_array_elements_text(coalesce(p_also -> 'email', '[]'::jsonb))
      union all select 'phone', jsonb_array_elements_text(coalesce(p_also -> 'phone', '[]'::jsonb))) x
     where x.h is not null and app.key_active(p_tenant, x.k, x.h))
$$;
revoke all on function app.lead_keys_blocked(uuid, jsonb, jsonb) from public, anon, authenticated;

-- p_rows: up to 500 objects {name, phone, email, city, message, external_id, received_at, dnd, keys, also} (keys / also: the suppression HMACs, computed by the API). p_live: a public door (an id is derived when the sender gave none).
-- Returns {counts: {...}, problems: [{row, reason}] (first 50), outcomes: [outcome per row]}. Work per row is atomic (a savepoint); a refusal of one row never stops the others.
create function app.lead_intake_core(p_tenant uuid, p_actor uuid, p_tag text, p_consent uuid, p_rows jsonb, p_live boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis    public.consent_basis;
  v_ref      text;
  v_n        integer := jsonb_array_length(p_rows);
  v_i        integer;
  v_row      jsonb;
  v_name     text;
  v_phone_in text;
  v_phone    text;
  v_email    text;
  v_msg      text;
  v_ext      text;
  v_when     timestamptz;
  v_dnd      boolean;
  v_contact  public.contacts;
  v_lead     uuid;
  v_found    boolean;
  v_outcome  text;
  v_reason   text;
  v_problems jsonb := '[]'::jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_flag_dnd boolean; v_flag_noc boolean;
  v_keys     jsonb;
  v_also     jsonb;
  v_ready    integer := 0; v_merged integer := 0; v_dup_item integer := 0; v_invalid integer := 0; v_dnd_n integer := 0; v_no_consent integer := 0; v_blocked integer := 0; v_refused integer := 0;
begin
  if p_consent is not null then
    select c.basis, 'lcn:' || c.id::text into v_basis, v_ref from public.lead_consents c where c.tenant_id = p_tenant and c.id = p_consent;
    if not found then
      perform app.lead_error('reference');
    end if;
  end if;
  perform set_config('app.created_via', 'import', true);
  for v_i in 1..v_n loop
    v_row := p_rows -> (v_i - 1);
    v_outcome := null; v_reason := null; v_lead := null; v_contact := null; v_found := false; v_flag_dnd := false; v_flag_noc := false;
    begin
      if jsonb_typeof(v_row) is distinct from 'object' then
        v_outcome := 'invalid'; v_reason := 'row_refused';
        raise exception 'row refused' using errcode = 'SM101';
      end if;
      v_phone_in := nullif(btrim(coalesce(v_row ->> 'phone', '')), '');
      v_phone := app.lead_e164(v_phone_in);
      v_email := nullif(lower(btrim(coalesce(v_row ->> 'email', ''))), '');
      if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or not app.text_is_clean(v_email)) then
        v_email := null;
      end if;
      if v_phone is null and v_email is null then
        v_outcome := 'invalid'; v_reason := case when v_phone_in is null then 'no_contact_way' else 'invalid_number' end;
        raise exception 'row refused' using errcode = 'SM101';
      end if;
      v_name := nullif(left(regexp_replace(regexp_replace(btrim(coalesce(v_row ->> 'name', '')), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'), 200), '');
      if v_name is not null and not app.text_is_clean(v_name) then
        v_name := null;
      end if;
      v_name := coalesce(v_name, 'Lead ' || right(coalesce(regexp_replace(v_phone, '[^0-9]', '', 'g'), 'new'), 4));
      v_msg := app.lead_clean_text(v_row ->> 'message', 1000);
      v_dnd := coalesce(v_row ->> 'dnd', '') = 'true';
      v_when := least(coalesce((nullif(v_row ->> 'received_at', ''))::timestamptz, app.outbox_now()), app.outbox_now());
      v_ext := nullif(left(btrim(coalesce(v_row ->> 'external_id', '')), 100), '');
      if v_ext is null and p_live then
        v_ext := 'h:' || left(encode(sha256(convert_to(coalesce(app.phone_norm(v_phone), v_email, '') || '|' || coalesce(v_msg, '') || '|' || to_char(app.outbox_now(), 'YYYY-MM-DD'), 'UTF8')), 'hex'), 24);
      end if;
      if v_ext is not null and exists (select 1 from integrations.lead_items i where i.tenant_id = p_tenant and i.source_tag = p_tag and i.external_id = v_ext) then
        v_outcome := 'duplicate_item';
        raise exception 'row refused' using errcode = 'SM101';
      end if;
      v_keys := case when jsonb_typeof(v_row -> 'keys') = 'object' and app.suppression_keys_ok(v_row -> 'keys', case when jsonb_typeof(v_row -> 'also') = 'object' then v_row -> 'also' else '{}'::jsonb end) then v_row -> 'keys' end;
      v_also := case when v_keys is not null and jsonb_typeof(v_row -> 'also') = 'object' then v_row -> 'also' else '{}'::jsonb end;
      if v_keys is not null and app.lead_keys_blocked(p_tenant, v_keys, v_also) then
        v_outcome := 'blocked'; v_reason := 'opted_out';   -- this person asked not to be contacted: nothing is stored
        raise exception 'row refused' using errcode = 'SM101';
      end if;
      -- who is this person already? the same phone first, then the same e-mail
      if v_phone is not null then
        select * into v_contact from public.contacts k
         where k.tenant_id = p_tenant and k.erased_at is null and k.archived_at is null and k.phone is not null and app.phone_norm(k.phone) = app.phone_norm(v_phone)
         order by k.created_at, k.id limit 1;
        v_found := found;
      end if;
      if not v_found and v_email is not null then
        select * into v_contact from public.contacts k
         where k.tenant_id = p_tenant and k.erased_at is null and k.archived_at is null and lower(k.email) = v_email
         order by k.created_at, k.id limit 1;
        v_found := found;
      end if;
      if v_found then
        v_lead := app.contact_lead(p_tenant, v_contact.id, p_tag);
        v_outcome := 'merged';
      else
        insert into public.contacts (tenant_id, full_name, email, phone) values (p_tenant, v_name, v_email, v_phone) returning * into v_contact;
        v_lead := app.contact_lead(p_tenant, v_contact.id, p_tag);
        v_outcome := 'created';
      end if;
      if v_keys is not null then
        perform app.contact_keys_record(v_contact.id, v_keys, v_also, p_actor, false);
      end if;
      insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, message, received_at)
      values (p_tenant, v_lead, v_contact.id, p_tag, case when v_outcome = 'created' then 'first' else 'repeat' end, v_msg, v_when);
      if v_dnd and v_phone is not null then
        perform app.lead_mark_dnd(p_tenant, v_contact.id, p_actor);
        v_flag_dnd := true;
      end if;
      if v_phone_in is not null and v_phone is null then
        insert into public.lead_flags (tenant_id, contact_id, flag, set_by) values (p_tenant, v_contact.id, 'invalid_number', 'import') on conflict do nothing;
      end if;
      if p_consent is not null then
        perform app.lead_consent_grant(p_tenant, v_contact.id, 'whatsapp', v_basis, v_ref, p_actor);
        if not v_dnd then
          perform app.lead_consent_grant(p_tenant, v_contact.id, 'phone', v_basis, v_ref, p_actor);
        end if;
        if v_email is not null then
          perform app.lead_consent_grant(p_tenant, v_contact.id, 'email', v_basis, v_ref, p_actor);
        end if;
      end if;
      v_flag_noc := not exists (select 1 from public.contacts k where k.id = v_contact.id and k.whatsapp_consent = 'granted');
      if v_ext is not null then
        insert into integrations.lead_items (tenant_id, source_tag, external_id, lead_id) values (p_tenant, p_tag, v_ext, v_lead) on conflict do nothing;
      end if;
    exception
      when sqlstate 'SM101' then
        null;   -- a business-rule refusal: everything this row wrote is rolled back; the reason is in v_outcome / v_reason
      when sqlstate 'SM401' then
        v_outcome := 'blocked'; v_reason := 'real_data_gate';
      when others then
        v_outcome := 'invalid'; v_reason := 'row_refused';
    end;
    if v_outcome = 'created' then v_ready := v_ready + 1;
    elsif v_outcome = 'merged' then v_merged := v_merged + 1;
    end if;
    if v_outcome in ('created', 'merged') then
      v_dnd_n := v_dnd_n + case when v_flag_dnd then 1 else 0 end;
      v_no_consent := v_no_consent + case when v_flag_noc then 1 else 0 end;
    end if;
    if v_outcome = 'invalid' then v_invalid := v_invalid + 1;
    elsif v_outcome = 'duplicate_item' then v_dup_item := v_dup_item + 1; v_reason := 'already_imported';
    elsif v_outcome = 'blocked' then v_blocked := v_blocked + 1;
    end if;
    if v_outcome in ('invalid', 'blocked', 'duplicate_item') and jsonb_array_length(v_problems) < 50 then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('row', v_i, 'reason', v_reason));
    end if;
    v_out := v_out || jsonb_build_array(v_outcome);
  end loop;
  return jsonb_build_object(
    'counts', jsonb_build_object('ready', v_ready, 'duplicates_merged', v_merged, 'already_imported', v_dup_item, 'invalid', v_invalid, 'dnd', v_dnd_n, 'no_consent', v_no_consent, 'blocked', v_blocked),
    'problems', v_problems, 'outcomes', v_out);
end;
$$;
revoke all on function app.lead_intake_core(uuid, uuid, text, uuid, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. a person's import (a part of at most 500 rows); p_dry_run does everything and rolls it back
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_intake_apply(
  p_tenant_id uuid, p_intake_id uuid, p_import_id uuid, p_part integer, p_kind text, p_tag text, p_consent_id uuid, p_rows jsonb, p_cost_paise bigint, p_dry_run boolean,
  p_assume_consent boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_sha     text;
  v_result  jsonb;
  v_existing public.lead_intakes;
  v_n       integer;
  v_tmp     uuid;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_intake_id is null or p_import_id is null or p_part is null or p_part not between 1 and 20 or p_kind is null or p_kind not in ('file', 'paste', 'vcard', 'sheet', 'indiamart')
     or not app.lead_tag_ok(p_tag) or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text) > 1048576
     or (p_cost_paise is not null and p_cost_paise not between 0 and 10000000) or p_dry_run is null then
    perform app.lead_error('invalid');
  end if;
  if p_consent_id is not null and not exists (select 1 from public.lead_consents c where c.tenant_id = p_tenant_id and c.id = p_consent_id) then
    perform app.lead_error('reference');
  end if;
  v_n := jsonb_array_length(p_rows);
  v_sha := encode(sha256(convert_to(p_rows::text || coalesce(p_tag, '') || coalesce(p_consent_id::text, ''), 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('lead_intake:' || p_tenant_id::text, 0));
  if not p_dry_run then
    select * into v_existing from public.lead_intakes x where x.tenant_id = p_tenant_id and x.id = p_intake_id;
    if found then
      if v_existing.content_sha <> v_sha then
        perform app.lead_error('conflict');
      end if;
      return jsonb_build_object('replayed', true, 'counts', v_existing.counts, 'problems', v_existing.problems, 'rows_read', v_existing.rows_read);
    end if;
  end if;
  begin
    -- a preview of an import whose consent will be confirmed: a stand-in confirmation inside the rolled-back part, so the counts show what the confirmation will do
    if p_dry_run and p_consent_id is null and coalesce(p_assume_consent, false) then
      v_tmp := gen_random_uuid();
      perform app.lead_consent_store(p_tenant_id, v_tmp, null, 'preview', 'preview', 'explicit_consent', 'preview', v_uid);
    end if;
    v_result := app.lead_intake_core(p_tenant_id, v_uid, p_tag, coalesce(p_consent_id, v_tmp), p_rows, false);
    if p_dry_run then
      raise exception 'dry run' using errcode = 'SM100';
    end if;
  exception when sqlstate 'SM100' then
    null;
  end;
  if not p_dry_run then
    insert into public.lead_intakes (id, tenant_id, import_id, part, kind, source_tag, consent_id, content_sha, rows_read, counts, problems, created_by)
    values (p_intake_id, p_tenant_id, p_import_id, p_part, p_kind, p_tag, p_consent_id, v_sha, v_n, v_result -> 'counts', v_result -> 'problems', v_uid);
    if p_cost_paise is not null then
      insert into public.lead_source_costs (tenant_id, source, cost_per_lead_paise, updated_by) values (p_tenant_id, p_tag, p_cost_paise, v_uid)
      on conflict (tenant_id, source) do update set cost_per_lead_paise = excluded.cost_per_lead_paise, updated_by = excluded.updated_by, updated_at = app.outbox_now();
    end if;
  end if;
  return jsonb_build_object('replayed', false, 'counts', v_result -> 'counts', 'problems', v_result -> 'problems', 'rows_read', v_n);
end;
$$;
revoke all on function public.lead_intake_apply(uuid, uuid, uuid, integer, text, text, uuid, jsonb, bigint, boolean, boolean) from public, anon;
grant execute on function public.lead_intake_apply(uuid, uuid, uuid, integer, text, text, uuid, jsonb, bigint, boolean, boolean) to authenticated;

-- the history of imports, one entry per import (its parts summed)
create function public.lead_intakes_list(p_tenant_id uuid, p_limit integer default 25, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) or p_limit is null or p_limit not between 1 and 100 then
    perform app.lead_error('deny');
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.at desc, x.import_id) from (
      select g.import_id, g.at, jsonb_build_object(
        'import_id', g.import_id, 'kind', g.kind, 'source', g.source_tag, 'consent_id', g.consent_id, 'rows_read', g.rows_read, 'created_at', g.at,
        'by', (select coalesce(u.display_name, '') from public.users u where u.id = g.by),
        'counts', g.counts, 'problems', g.problems) as j
        from (
          select i.import_id, min(i.created_at) as at, min(i.kind) as kind, min(i.source_tag) as source_tag, (array_agg(i.consent_id order by i.part))[1] as consent_id, sum(i.rows_read)::int as rows_read,
                 (array_agg(i.created_by order by i.part))[1] as by,
                 jsonb_build_object(
                   'ready', sum((i.counts ->> 'ready')::int), 'duplicates_merged', sum((i.counts ->> 'duplicates_merged')::int), 'already_imported', sum(coalesce((i.counts ->> 'already_imported')::int, 0)),
                   'invalid', sum((i.counts ->> 'invalid')::int), 'dnd', sum((i.counts ->> 'dnd')::int), 'no_consent', sum((i.counts ->> 'no_consent')::int), 'blocked', sum((i.counts ->> 'blocked')::int)) as counts,
                 (select coalesce(jsonb_agg(pr.e), '[]'::jsonb) from (select e from jsonb_array_elements((array_agg(i.problems order by i.part))[1]) e limit 50) pr) as problems
            from public.lead_intakes i
           where i.tenant_id = p_tenant_id and (p_before is null or i.created_at < p_before)
           group by i.import_id
           order by min(i.created_at) desc
           limit p_limit) g) x), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_intakes_list(uuid, integer, timestamptz) from public, anon;
grant execute on function public.lead_intakes_list(uuid, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. live sources
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lead_source_json(s public.lead_sources) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'tag', s.tag, 'label', s.label, 'status', s.status, 'created_at', s.created_at, 'last_received_at', s.last_received_at,
    'received_count', s.received_count, 'token_hint', s.token_hint,
    'cost_per_lead_paise', (select c.cost_per_lead_paise from public.lead_source_costs c where c.tenant_id = s.tenant_id and c.source = s.tag),
    'consent_confirmed', exists (select 1 from public.lead_consents k where k.tenant_id = s.tenant_id and k.source_id = s.id),
    'consent_id', (select k.id from public.lead_consents k where k.tenant_id = s.tenant_id and k.source_id = s.id order by k.confirmed_at desc, k.id limit 1))
$$;
revoke all on function app.lead_source_json(public.lead_sources) from public;

-- p_consent: null or {list_name, purpose, basis, how_collected} (stored with the source). A repeat of the same id returns the stored source with created:false.
create function public.lead_source_create(
  p_tenant_id uuid, p_id uuid, p_kind text, p_tag text, p_label text, p_token_hash text, p_token_hint text, p_consent_id uuid, p_consent jsonb, p_cost_paise bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_id is null or p_kind is null or p_kind not in ('website_form', 'webhook', 'email_forward', 'meta_lead_ads', 'indiamart') or not app.lead_tag_ok(p_tag)
     or p_label is null or char_length(btrim(p_label)) not between 1 and 80 or not app.text_is_clean(p_label)
     or ((p_kind = 'indiamart') <> (p_token_hash is null)) or (p_token_hash is not null and (p_token_hash !~ '^[0-9a-f]{64}$' or p_token_hint is null or p_token_hint !~ '^[A-Za-z0-9_-]{4}$'))
     or (p_cost_paise is not null and p_cost_paise not between 0 and 10000000)
     or (p_consent is not null and (jsonb_typeof(p_consent) <> 'object' or p_consent_id is null)) then
    perform app.lead_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_source:' || p_tenant_id::text, 0));
  select * into s from public.lead_sources x where x.tenant_id = p_tenant_id and x.id = p_id;
  if found then
    if s.kind <> p_kind or s.tag <> p_tag then
      perform app.lead_error('conflict');
    end if;
    return jsonb_build_object('created', false, 'source', app.lead_source_json(s));
  end if;
  if (select count(*) from public.lead_sources x where x.tenant_id = p_tenant_id) >= 50 then
    perform app.lead_error('limit');
  end if;
  insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by) values (p_id, p_tenant_id, p_kind, p_tag, btrim(p_label), p_token_hash, p_token_hint, auth.uid())
  returning * into s;
  if p_consent is not null then
    perform app.lead_consent_store(p_tenant_id, p_consent_id, p_id, p_consent ->> 'list_name', p_consent ->> 'purpose', p_consent ->> 'basis', p_consent ->> 'how_collected', auth.uid());
  end if;
  if p_cost_paise is not null then
    insert into public.lead_source_costs (tenant_id, source, cost_per_lead_paise, updated_by) values (p_tenant_id, p_tag, p_cost_paise, auth.uid())
    on conflict (tenant_id, source) do update set cost_per_lead_paise = excluded.cost_per_lead_paise, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  end if;
  return jsonb_build_object('created', true, 'source', app.lead_source_json(s));
end;
$$;
revoke all on function public.lead_source_create(uuid, uuid, text, text, text, text, text, uuid, jsonb, bigint) from public, anon;
grant execute on function public.lead_source_create(uuid, uuid, text, text, text, text, text, uuid, jsonb, bigint) to authenticated;

create function public.lead_sources_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.lead_source_json(s) order by s.created_at desc, s.id) from public.lead_sources s where s.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_sources_list(uuid) from public, anon;
grant execute on function public.lead_sources_list(uuid) to authenticated;

create function public.lead_source_rotate(p_tenant_id uuid, p_id uuid, p_token_hash text, p_token_hint text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_hint is null or p_token_hint !~ '^[A-Za-z0-9_-]{4}$' then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found or s.kind = 'indiamart' then
    perform app.lead_error('reference');
  end if;
  update public.lead_sources set token_hash = p_token_hash, token_hint = p_token_hint, updated_at = app.outbox_now() where id = p_id returning * into s;
  return app.lead_source_json(s);
end;
$$;
revoke all on function public.lead_source_rotate(uuid, uuid, text, text) from public, anon;
grant execute on function public.lead_source_rotate(uuid, uuid, text, text) to authenticated;

create function public.lead_source_set_status(p_tenant_id uuid, p_id uuid, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_status is null or p_status not in ('active', 'paused') then
    perform app.lead_error('invalid');
  end if;
  update public.lead_sources set status = p_status, updated_at = app.outbox_now() where tenant_id = p_tenant_id and id = p_id returning * into s;
  if not found then
    perform app.lead_error('reference');
  end if;
  return app.lead_source_json(s);
end;
$$;
revoke all on function public.lead_source_set_status(uuid, uuid, text) from public, anon;
grant execute on function public.lead_source_set_status(uuid, uuid, text) to authenticated;

-- The registered worker account's door for a live arrival. The secret address is checked here (its hash); an unknown or paused address answers 'unknown' and nothing else.
-- Caps (the door is open to the internet): 20 rows a call, 60 calls a minute and 2,000 leads a day per source. A cap answers 'rate' and writes nothing.
create function public.scheduler_lead_intake_live(p_token_hash text, p_rows jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
  v_bucket timestamptz := date_trunc('minute', app.outbox_now());
  v_hits integer;
  v_result jsonb;
  v_consent uuid;
  v_day integer;
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 20 or octet_length(p_rows::text) > 65536 then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.token_hash = p_token_hash and x.status = 'active' for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  insert into integrations.lead_source_hits (source_id, bucket, n) values (s.id, v_bucket, 1)
  on conflict (source_id, bucket) do update set n = integrations.lead_source_hits.n + 1 returning n into v_hits;
  delete from integrations.lead_source_hits where bucket < v_bucket - interval '1 day';
  select coalesce(sum(h.n), 0)::int into v_day from integrations.lead_source_hits h where h.source_id = s.id and h.bucket > v_bucket - interval '1 day';
  if v_hits > 60 or v_day > 2000 then
    return jsonb_build_object('status', 'rate');
  end if;
  select c.id into v_consent from public.lead_consents c where c.tenant_id = s.tenant_id and c.source_id = s.id order by c.confirmed_at desc, c.id limit 1;
  perform pg_advisory_xact_lock(hashtextextended('lead_intake:' || s.tenant_id::text, 0));
  v_result := app.lead_intake_core(s.tenant_id, null, s.tag, v_consent, p_rows, true);
  update public.lead_sources set last_received_at = app.outbox_now(), received_count = received_count + coalesce((v_result -> 'counts' ->> 'ready')::int, 0) + coalesce((v_result -> 'counts' ->> 'duplicates_merged')::int, 0)
   where id = s.id;
  return jsonb_build_object('status', 'received', 'counts', v_result -> 'counts');
end;
$$;
revoke all on function public.scheduler_lead_intake_live(text, jsonb) from public, anon;
grant execute on function public.scheduler_lead_intake_live(text, jsonb) to authenticated;

-- mail no parser could read (a cap of 200 waiting per source)
create function public.scheduler_lead_unparsed_add(p_token_hash text, p_subject text, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
  v_body text := left(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g'), 4000);
  v_subject text := nullif(left(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:]]', ' ', 'g'), 200), '');
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or btrim(v_body) = '' then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.token_hash = p_token_hash and x.status = 'active' and x.kind = 'email_forward';
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if not app.text_is_clean(v_body) or (v_subject is not null and not app.text_is_clean(v_subject)) then
    return jsonb_build_object('status', 'ignored');
  end if;
  if (select count(*) from public.lead_unparsed u where u.tenant_id = s.tenant_id and u.source_id = s.id and u.discarded_at is null) >= 200 then
    return jsonb_build_object('status', 'rate');
  end if;
  insert into public.lead_unparsed (tenant_id, source_id, subject, body) values (s.tenant_id, s.id, v_subject, v_body);
  return jsonb_build_object('status', 'kept');
end;
$$;
revoke all on function public.scheduler_lead_unparsed_add(text, text, text) from public, anon;
grant execute on function public.scheduler_lead_unparsed_add(text, text, text) to authenticated;

create function public.lead_unparsed_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'source_id', u.source_id, 'received_at', u.received_at, 'subject', u.subject, 'preview', left(u.body, 300)) order by u.received_at desc, u.id)
      from (select * from public.lead_unparsed x where x.tenant_id = p_tenant_id and x.discarded_at is null order by x.received_at desc, x.id limit 100) u), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_unparsed_list(uuid) from public, anon;
grant execute on function public.lead_unparsed_list(uuid) to authenticated;

create function public.lead_unparsed_discard(p_tenant_id uuid, p_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  update public.lead_unparsed set discarded_at = app.outbox_now(), subject = null, body = 'discarded' where tenant_id = p_tenant_id and id = p_id and discarded_at is null;
  if not found then
    perform app.lead_error('reference');
  end if;
  return true;
end;
$$;
revoke all on function public.lead_unparsed_discard(uuid, uuid) from public, anon;
grant execute on function public.lead_unparsed_discard(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. the history of a lead
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_arrivals_list(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.lead_error('reference');
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('at', t.received_at, 'kind', t.kind, 'source', t.source_tag, 'message', t.message) order by t.received_at desc, t.id)
                         from (select * from public.lead_arrivals x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id order by x.received_at desc, x.id limit 100) t), '[]'::jsonb),
    'flags', coalesce((select jsonb_agg(f.flag order by f.flag) from public.lead_flags f where f.tenant_id = p_tenant_id and f.contact_id = v_contact), '[]'::jsonb));
end;
$$;
revoke all on function public.lead_arrivals_list(uuid, uuid) from public, anon;
grant execute on function public.lead_arrivals_list(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Google Sheets kept in sync
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lead_sheet_link_json(l public.lead_sheet_links) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'status', l.status, 'source', l.source_tag, 'last_synced_at', l.last_synced_at, 'last_row_count', l.last_row_count, 'last_result', l.last_result, 'last_error', l.last_error,
    'created_at', l.created_at, 'next_sync_at', case when l.status = 'active' then coalesce(l.last_synced_at, l.created_at) + interval '15 minutes' end,
    'consent_id', l.consent_id, 'mapping', l.mapping)
$$;
revoke all on function app.lead_sheet_link_json(public.lead_sheet_links) from public;

create function public.lead_sheet_link_create(
  p_tenant_id uuid, p_id uuid, p_sheet_id text, p_gid text, p_mapping jsonb, p_header_sha text, p_consent_id uuid, p_consent jsonb, p_cost_paise bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lead_sheet_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_id is null or p_sheet_id is null or p_sheet_id !~ '^[A-Za-z0-9_-]{20,100}$' or (p_gid is not null and p_gid !~ '^[0-9]{1,20}$') or p_mapping is null or jsonb_typeof(p_mapping) <> 'object'
     or p_header_sha is null or p_header_sha !~ '^[0-9a-f]{64}$' or (p_consent is not null and (jsonb_typeof(p_consent) <> 'object' or p_consent_id is null))
     or (p_cost_paise is not null and p_cost_paise not between 0 and 10000000) then
    perform app.lead_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_sheet:' || p_tenant_id::text, 0));
  select * into l from public.lead_sheet_links x where x.tenant_id = p_tenant_id and x.id = p_id;
  if found then
    if l.sheet_id <> p_sheet_id or l.gid is distinct from p_gid then
      perform app.lead_error('conflict');
    end if;
    return app.lead_sheet_link_json(l);
  end if;
  if exists (select 1 from public.lead_sheet_links x where x.tenant_id = p_tenant_id and x.sheet_id = p_sheet_id and x.gid is not distinct from p_gid) then
    perform app.lead_error('conflict');
  end if;
  if (select count(*) from public.lead_sheet_links x where x.tenant_id = p_tenant_id) >= 20 then
    perform app.lead_error('limit');
  end if;
  if p_consent is not null then
    perform app.lead_consent_store(p_tenant_id, p_consent_id, null, p_consent ->> 'list_name', p_consent ->> 'purpose', p_consent ->> 'basis', p_consent ->> 'how_collected', auth.uid());
  elsif p_consent_id is not null and not exists (select 1 from public.lead_consents c where c.tenant_id = p_tenant_id and c.id = p_consent_id) then
    perform app.lead_error('reference');
  end if;
  insert into public.lead_sheet_links (id, tenant_id, sheet_id, gid, mapping, header_sha, consent_id, created_by)
  values (p_id, p_tenant_id, p_sheet_id, p_gid, p_mapping, p_header_sha, p_consent_id, auth.uid()) returning * into l;
  if p_cost_paise is not null then
    insert into public.lead_source_costs (tenant_id, source, cost_per_lead_paise, updated_by) values (p_tenant_id, 'google_sheet', p_cost_paise, auth.uid())
    on conflict (tenant_id, source) do update set cost_per_lead_paise = excluded.cost_per_lead_paise, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  end if;
  return app.lead_sheet_link_json(l);
end;
$$;
revoke all on function public.lead_sheet_link_create(uuid, uuid, text, text, jsonb, text, uuid, jsonb, bigint) from public, anon;
grant execute on function public.lead_sheet_link_create(uuid, uuid, text, text, jsonb, text, uuid, jsonb, bigint) to authenticated;

create function public.lead_sheet_links_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.lead_sheet_link_json(l) order by l.created_at desc, l.id) from public.lead_sheet_links l where l.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_sheet_links_list(uuid) from public, anon;
grant execute on function public.lead_sheet_links_list(uuid) to authenticated;

-- pause | resume | sync_now (sync_now makes the link due at once: the worker pulls it within a minute)
create function public.lead_sheet_link_action(p_tenant_id uuid, p_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lead_sheet_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_action is null or p_action not in ('pause', 'resume', 'sync_now') then
    perform app.lead_error('invalid');
  end if;
  select * into l from public.lead_sheet_links x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.lead_error('reference');
  end if;
  if p_action = 'pause' then
    update public.lead_sheet_links set status = 'paused', updated_at = app.outbox_now() where id = p_id returning * into l;
  elsif p_action = 'resume' then
    update public.lead_sheet_links set status = 'active', last_error = null, updated_at = app.outbox_now() where id = p_id returning * into l;
  else
    if l.status = 'paused' then
      perform app.lead_error('invalid');
    end if;
    update public.lead_sheet_links set last_synced_at = null, status = 'active', updated_at = app.outbox_now() where id = p_id returning * into l;
  end if;
  return app.lead_sheet_link_json(l);
end;
$$;
revoke all on function public.lead_sheet_link_action(uuid, uuid, text) from public, anon;
grant execute on function public.lead_sheet_link_action(uuid, uuid, text) to authenticated;

-- the worker: the links that are due (never synced, or last synced over 15 minutes ago)
create function public.scheduler_sheet_links_due(p_limit integer default 10) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.lead_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'sheet_id', d.sheet_id, 'gid', d.gid, 'mapping', d.mapping, 'header_sha', d.header_sha) order by d.last_synced_at nulls first, d.id)
      from (select * from public.lead_sheet_links l
             where l.status = 'active' and (l.last_synced_at is null or l.last_synced_at < app.outbox_now() - interval '15 minutes')
             order by l.last_synced_at nulls first, l.id limit p_limit) d), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_sheet_links_due(integer) from public, anon;
grant execute on function public.scheduler_sheet_links_due(integer) to authenticated;

-- the worker: the rows of one link (already read and mapped by the API; at most 500). p_header_sha: the header row now; a different one stops the link (`columns_changed`).
create function public.scheduler_lead_sheet_apply(p_link_id uuid, p_rows jsonb, p_header_sha text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lead_sheet_links;
  v_result jsonb;
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_link_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 or p_header_sha is null or p_header_sha !~ '^[0-9a-f]{64}$' then
    perform app.lead_error('invalid');
  end if;
  select * into l from public.lead_sheet_links x where x.id = p_link_id and x.status = 'active' for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if l.header_sha <> p_header_sha then
    update public.lead_sheet_links set status = 'needs_attention', last_error = 'columns_changed', last_synced_at = app.outbox_now(), updated_at = app.outbox_now() where id = l.id;
    return jsonb_build_object('status', 'columns_changed');
  end if;
  if jsonb_array_length(p_rows) = 0 then
    update public.lead_sheet_links set last_synced_at = app.outbox_now(), last_row_count = 0, last_error = null, updated_at = app.outbox_now() where id = l.id;
    return jsonb_build_object('status', 'done', 'counts', '{}'::jsonb);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_intake:' || l.tenant_id::text, 0));
  v_result := app.lead_intake_core(l.tenant_id, null, l.source_tag, l.consent_id, p_rows, false);
  update public.lead_sheet_links set last_synced_at = app.outbox_now(), last_row_count = jsonb_array_length(p_rows), last_result = v_result -> 'counts', last_error = null, updated_at = app.outbox_now() where id = l.id;
  return jsonb_build_object('status', 'done', 'counts', v_result -> 'counts');
end;
$$;
revoke all on function public.scheduler_lead_sheet_apply(uuid, jsonb, text) from public, anon;
grant execute on function public.scheduler_lead_sheet_apply(uuid, jsonb, text) to authenticated;

-- the worker: a sheet that could not be read
create function public.scheduler_lead_sheet_failed(p_link_id uuid, p_error text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_error is null or p_error not in ('sheet_not_public', 'unreachable', 'too_large') then
    perform app.lead_error('invalid');
  end if;
  update public.lead_sheet_links
     set last_synced_at = app.outbox_now(), last_error = p_error, updated_at = app.outbox_now(),
         status = case when p_error in ('sheet_not_public', 'too_large') then 'needs_attention' else status end
   where id = p_link_id and status = 'active';
  return found;
end;
$$;
revoke all on function public.scheduler_lead_sheet_failed(uuid, text) from public, anon;
grant execute on function public.scheduler_lead_sheet_failed(uuid, text) to authenticated;
