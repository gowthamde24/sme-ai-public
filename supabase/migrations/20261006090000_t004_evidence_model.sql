-- T004 / milestone 1: the evidence model (ADR 0008).
--
--   evidence        one observed source: where it was (url / reference), who supplied it (provider),
--                   when it was retrieved / published, and a short quoted snippet.
--   evidence_links  attaches ONE evidence row to exactly ONE target: a company, a lead or a claim.
--                   Every target is its own composite foreign key (no polymorphic id).
--   claims          a small researched fact about a company or a lead: predicate + value + an
--                   explicit confidence. Supporting / contradicting evidence hangs off it through
--                   evidence_links. PROVISIONAL shape: the first consumer is the research agent.
--
-- Nothing here fetches, renders or interprets a URL or a snippet. Those columns are UNTRUSTED DATA
-- (CLAUDE.md #6): bounded, scheme-restricted, control-character-free text that is stored verbatim
-- and shown as plain text.
--
-- Same rules as T003 (all enforced by the catalog guards in supabase/tests/database/06):
--   * composite (tenant_id, x_id) foreign keys, no cascade, child side indexed, keyset index;
--   * RLS enabled + forced; pattern-B policies (read: any member, write: Owner / Admin / Sales);
--   * no DELETE grant; archive (archived_at) is Admin / Owner only, enforced by trigger;
--   * created_by / created_via / created_at are server-owned (app.set_created_meta);
--   * column-level grants: UPDATE is granted on archived_at ONLY, and a trigger enforces the same
--     for every other write path: these rows are append-only, a correction is a new row;
--   * audit via app.audit_row_change with the PII column list (values never reach audit_events).
--
-- SQLSTATE contract (the API classifies by SQLSTATE only, never by message text):
--   23514 invalid value / structure   23503 invalid reference   23505 duplicate
--   23502 missing required value      22P02 invalid enum label  42501 forbidden or immutable

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.evidence_kind as enum ('web_page', 'document', 'email', 'listing', 'registry', 'note');
-- How a piece of evidence bears on a CLAIM. NULL on links to companies / leads (no claim, no stance).
create type public.evidence_stance as enum ('supports', 'contradicts', 'context');
-- Uncertainty is stated, never implied. Four levels, deliberately not a numeric score.
create type public.claim_confidence as enum ('unverified', 'low', 'medium', 'high');

-- ---------------------------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------------------------

-- Evidence, links and claims are append-only: the only column that may ever change is archived_at
-- (and who may change THAT is app.guard_archive). A correction is a new row, so a claim can never
-- silently change under the evidence that was recorded for it. Applies to every role, including
-- the table owner. (A future, explicit, audited anonymise-in-place path for erasure replaces this
-- function in its own migration; see docs/pre-pilot-checklist.md.)
create function app.guard_immutable_record() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
    raise exception '% rows are immutable: archive the row and record a new one', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- retrieved_at is declared by the writer (an agent records when IT fetched the page), so it is
-- bounds-checked: not in the future beyond 5 minutes of clock skew. A trigger, not a CHECK, because
-- now() is not immutable. The CHECK on the table covers the lower bound.
create function app.guard_evidence_retrieved_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.retrieved_at > now() + interval '5 minutes' then
    raise exception 'retrieved_at must not be in the future'
      using errcode = '23514', constraint = 'evidence_retrieved_at_not_future', table = 'evidence', schema = 'public';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_immutable_record() from public;
revoke all on function app.guard_evidence_retrieved_at() from public;

-- ---------------------------------------------------------------------------------------------
-- evidence
-- ---------------------------------------------------------------------------------------------
create table public.evidence (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  kind         public.evidence_kind not null,
  -- Who supplied it: a slug such as 'manual', 'import.csv', 'serper'. Never a person.
  provider     text not null check (provider ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  -- http(s) only; no userinfo; no whitespace, control, bidi or quote/angle characters. Never fetched.
  url          text check (
                 char_length(url) between 8 and 2048
                 and url ~* '^https?://[^/?#@[:space:][:cntrl:]<>"''\\]+([/?#][^[:space:][:cntrl:]<>"''\\]*)?$'
                 and url !~ '[\u0080-\u009f\u202a-\u202e\u2066-\u2069]'),
  -- Typed opaque reference to the source kept elsewhere ("doc:...", "run:<uuid>"): same shape as
  -- consent_events.evidence_ref.
  reference    text check (reference ~ '^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$'),
  -- A short quotation. Plain text, 1000 characters at most; only tab / newline / carriage return
  -- are allowed control characters; no bidi overrides.
  snippet      text check (
                 char_length(snippet) between 1 and 1000
                 and btrim(snippet, E' \t\r\n') <> ''
                 and snippet !~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]'),
  -- When the source was observed (declared by the writer; bounded, see the trigger) vs when this
  -- row was created (created_at, server clock).
  retrieved_at timestamptz not null default now()
               check (retrieved_at >= timestamptz '2000-01-01 00:00:00+00'),
  published_at timestamptz check (published_at >= timestamptz '1970-01-01 00:00:00+00'),
  created_by   uuid,
  created_via  public.record_origin not null default 'manual',
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (tenant_id, id),
  check (url is not null or reference is not null),
  check (published_at is null or published_at <= retrieved_at)
);

-- ---------------------------------------------------------------------------------------------
-- claims (provisional)
-- ---------------------------------------------------------------------------------------------
create table public.claims (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  -- The subject: exactly one of company / lead (contacts are deliberately not claim subjects).
  company_id  uuid,
  lead_id     uuid,
  -- A typed key such as 'exports_to' (not an enum: a new fact type must not need a migration).
  predicate   text not null check (predicate ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value       text not null check (
                char_length(value) between 1 and 500
                and btrim(value, E' \t\r\n') <> ''
                and value !~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]'),
  -- No default, NOT NULL: whoever writes a claim states how sure it is.
  confidence  public.claim_confidence not null,
  created_by  uuid,
  created_via public.record_origin not null default 'manual',
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  check (num_nonnulls(company_id, lead_id) = 1)
);

-- ---------------------------------------------------------------------------------------------
-- evidence_links
-- ---------------------------------------------------------------------------------------------
create table public.evidence_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  evidence_id uuid not null,
  -- Exactly one target. A new target kind later is one ADD COLUMN + FK + CHECK rewrite in a new
  -- migration; there is never a free-form (type, id) pair.
  company_id  uuid,
  lead_id     uuid,
  claim_id    uuid,
  -- How the evidence bears on a claim. Only meaningful (and then required) for claim links.
  stance      public.evidence_stance,
  created_by  uuid,
  created_via public.record_origin not null default 'manual',
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, evidence_id) references public.evidence (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, claim_id) references public.claims (tenant_id, id),
  check (num_nonnulls(company_id, lead_id, claim_id) = 1),
  check ((claim_id is null) = (stance is null))
);

-- ---------------------------------------------------------------------------------------------
-- Indexes. Keyset pagination on every table. The partial UNIQUE index per link target is both the
-- "a (target, evidence) pair exists once" rule and the child-side index of that target's FK.
-- ---------------------------------------------------------------------------------------------
create index evidence_tenant_created_idx       on public.evidence       (tenant_id, created_at desc, id);
create index evidence_links_tenant_created_idx on public.evidence_links (tenant_id, created_at desc, id);
create index claims_tenant_created_idx         on public.claims         (tenant_id, created_at desc, id);

create index evidence_links_evidence_idx on public.evidence_links (tenant_id, evidence_id);
create unique index evidence_links_company_evidence_key on public.evidence_links (tenant_id, company_id, evidence_id) where company_id is not null;
create unique index evidence_links_lead_evidence_key    on public.evidence_links (tenant_id, lead_id, evidence_id)    where lead_id is not null;
create unique index evidence_links_claim_evidence_key   on public.evidence_links (tenant_id, claim_id, evidence_id)   where claim_id is not null;

create index claims_company_idx on public.claims (tenant_id, company_id) where company_id is not null;
create index claims_lead_idx    on public.claims (tenant_id, lead_id)    where lead_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['evidence', 'evidence_links', 'claims'] loop
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$s for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger %1$s_set_created_meta before insert or update on public.%1$s for each row execute function app.set_created_meta()', t);
    execute format('create trigger %1$s_guard_archive before update on public.%1$s for each row execute function app.guard_archive()', t);
    execute format('create trigger %1$s_guard_immutable before update on public.%1$s for each row execute function app.guard_immutable_record()', t);
  end loop;
end $$;

create trigger evidence_guard_retrieved_at
  before insert on public.evidence
  for each row execute function app.guard_evidence_retrieved_at();

-- ---------------------------------------------------------------------------------------------
-- Column classification (read by the audit guards). PII = audited by NAME only. Everything that
-- carries text from outside the application is also UNTRUSTED: data, never instructions.
-- ---------------------------------------------------------------------------------------------
comment on column public.evidence.provider is 'SAFE: slug of the system or channel that supplied the evidence (regex-constrained, never a person)';
comment on column public.evidence.url       is 'PII: UNTRUSTED data, never fetched or followed by the application. A URL can name a person (profile paths, e-mail in the query string), so it is audited by name only';
comment on column public.evidence.reference is 'PII: UNTRUSTED opaque reference to the source kept elsewhere; shaped like consent_events.evidence_ref and audited by name only';
comment on column public.evidence.snippet  is 'PII: UNTRUSTED quoted text from the source, plain text only; it can describe people, so it is audited by name only';
comment on column public.claims.predicate  is 'SAFE: typed fact key such as exports_to (regex-constrained slug)';
comment on column public.claims.value      is 'PII: UNTRUSTED text of the researched fact; it can describe a person, so it is audited by name only';

create trigger audit_evidence       after insert or update or delete on public.evidence
  for each row execute function app.audit_row_change('evidence', 'url,snippet,reference');
create trigger audit_evidence_links after insert or update or delete on public.evidence_links
  for each row execute function app.audit_row_change('evidence_link');
create trigger audit_claims         after insert or update or delete on public.claims
  for each row execute function app.audit_row_change('claim', 'value');

-- ---------------------------------------------------------------------------------------------
-- RLS: enabled and forced; default deny; policies TO authenticated; pattern-B helpers only.
--   read   : any member of the tenant
--   write  : Owner / Admin / Sales
--   delete : nobody (no DELETE grant, no policy)
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['evidence', 'evidence_links', 'claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);

    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated with check (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[])) with check (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);

    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Column grants. Absent on purpose: created_by, created_via, created_at (server-owned) and every
-- content column on UPDATE. archived_at is the only updatable column; the archive trigger limits it
-- to Owner / Admin.
grant insert (id, tenant_id, kind, provider, url, reference, snippet, retrieved_at, published_at)
  on public.evidence to authenticated;
grant update (archived_at) on public.evidence to authenticated;

grant insert (id, tenant_id, evidence_id, company_id, lead_id, claim_id, stance)
  on public.evidence_links to authenticated;
grant update (archived_at) on public.evidence_links to authenticated;

grant insert (id, tenant_id, company_id, lead_id, predicate, value, confidence)
  on public.claims to authenticated;
grant update (archived_at) on public.claims to authenticated;
