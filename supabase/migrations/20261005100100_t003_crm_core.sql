-- T003 / 1b-2: CRM core tables: companies, contacts, products, leads, opportunities.
-- (consent_events and the consent functions are in the next migration.)
--
-- Rules every table follows (all enforced by catalog guards in supabase/tests/database/06):
--   * tenant_id NOT NULL -> tenants(id), unique (tenant_id, id), index led by tenant_id,
--     tenant_id immutable (trigger), ENABLE + FORCE row level security, default deny.
--   * Policies TO authenticated only, written with the once-per-statement helpers
--     (app.my_tenant_ids / app.my_tenant_ids_with_role); never a per-row helper.
--   * Every reference to another tenant-owned row is a COMPOSITE foreign key
--     (tenant_id, parent_id) -> parent (tenant_id, id): a row can never point at another tenant's
--     row, even though the database checks foreign keys without applying RLS. No CASCADE; SET NULL
--     only with an explicit column list (so tenant_id is never nulled).
--   * Clients get no DELETE. "Delete" is archived_at (Admin/Owner only, enforced by trigger).
--     Erasure = anonymise in place (ADR 0005), never a hard delete.
--   * Grants are explicit, per table and per column. created_by / created_via / closed_at / the
--     consent columns are never client-writable.
--   * Prices do not exist here: pricing belongs to the deterministic quote service (CLAUDE.md #4).

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.company_type as enum ('prospect', 'customer', 'supplier', 'other');
create type public.lead_status as enum ('new', 'in_review', 'qualified', 'disqualified');
create type public.opportunity_status as enum ('open', 'won', 'lost');
-- Provenance of a record (CLAUDE.md #5). Clients can only ever produce 'manual'.
create type public.record_origin as enum ('manual', 'import', 'agent');
-- Consent state of a contact for one channel.
create type public.consent_status as enum ('unknown', 'granted', 'withdrawn');
create type public.suppression_reason as enum ('opted_out', 'bounced', 'complained', 'legal', 'manual');

-- ---------------------------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------------------------

-- created_by / created_via are server-owned. On INSERT they are overwritten; on UPDATE they are
-- restored. A signed-in client is always 'manual'. Trusted server code (not the authenticated /
-- anon roles) may declare the origin with `set local app.created_via = 'import' | 'agent'`.
create function app.set_created_meta() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if current_user in ('authenticated', 'anon') then
      new.created_via := 'manual';
    else
      new.created_via := coalesce(nullif(current_setting('app.created_via', true), ''), 'manual')::public.record_origin;
    end if;
  else
    new.created_by := old.created_by;
    new.created_via := old.created_via;
  end if;
  return new;
end;
$$;

-- Archiving (and restoring) is an Admin/Owner action. A trigger, not just a policy, so it holds for
-- every write path. Privileged maintenance (no JWT subject) is not blocked.
create function app.guard_archive() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and not app.has_tenant_role(new.tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'only an owner or admin can archive or restore records' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Opportunity state machine. won / lost are terminal; reopening (back to 'open') is Admin/Owner
-- only; closed_at is server-owned. A lost opportunity must carry a reason (table check).
create function app.guard_opportunity_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.closed_at := case when new.status in ('won', 'lost') then now() end;
    return new;
  end if;

  if new.status = old.status then
    new.closed_at := old.closed_at;
  elsif old.status = 'open' then
    new.closed_at := now();                      -- open -> won | lost
  elsif new.status = 'open' then                   -- reopen
    if auth.uid() is not null
       and not app.has_tenant_role(new.tenant_id, array['owner', 'admin']::public.app_role[]) then
      raise exception 'only an owner or admin can reopen a closed opportunity' using errcode = '42501';
    end if;
    new.closed_at := null;
    new.lost_reason := null;
  else                                             -- won <-> lost
    raise exception 'won and lost are terminal: reopen the opportunity first' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app.set_created_meta() from public;
revoke all on function app.guard_archive() from public;
revoke all on function app.guard_opportunity_status() from public;

-- ---------------------------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  type        public.company_type not null default 'prospect',
  website     text check (char_length(website) <= 200),
  country     text check (char_length(country) <= 100),
  region      text check (char_length(region) <= 100),
  city        text check (char_length(city) <= 100),
  industry    text check (char_length(industry) <= 100),
  tags        text[] not null default '{}'
              check (cardinality(tags) <= 20 and char_length(array_to_string(tags, ',')) <= 800
                     and array_position(tags, '') is null),
  created_by  uuid,
  created_via public.record_origin not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- contacts (personal data lives here; consent + suppression state is server-owned)
-- ---------------------------------------------------------------------------------------------
create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  company_id       uuid,
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 200),
  email            text check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone            text check (char_length(phone) between 3 and 32),
  job_title        text check (char_length(job_title) <= 100),
  -- Current consent per channel + do-not-contact flag. Changed ONLY by the SECURITY DEFINER
  -- consent functions, which also append the consent_events ledger row. Not in any client grant.
  email_consent    public.consent_status not null default 'unknown',
  whatsapp_consent public.consent_status not null default 'unknown',
  phone_consent    public.consent_status not null default 'unknown',
  suppressed_at    timestamptz,
  suppression_reason public.suppression_reason,
  created_by       uuid,
  created_via      public.record_origin not null default 'manual',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  unique (tenant_id, id),
  -- Lets leads/opportunities prove "this contact belongs to this company" with one composite key.
  unique (tenant_id, id, company_id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  check ((suppressed_at is null) = (suppression_reason is null))
);
create unique index contacts_tenant_email_key on public.contacts (tenant_id, lower(email)) where email is not null;

-- ---------------------------------------------------------------------------------------------
-- products (no price columns: see header)
-- ---------------------------------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  sku         text not null check (char_length(btrim(sku)) between 1 and 64),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (char_length(description) <= 2000),
  unit        text check (char_length(unit) <= 32),
  category    text check (char_length(category) <= 64),
  attributes  jsonb not null default '{}'::jsonb
              check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 4096),
  active      boolean not null default true,
  created_by  uuid,
  created_via public.record_origin not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, sku)
);

-- ---------------------------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------------------------
create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  company_id          uuid,
  contact_id          uuid,
  owner_user_id       uuid,
  status              public.lead_status not null default 'new',
  source              text check (char_length(source) <= 64),
  disqualified_reason text check (char_length(disqualified_reason) <= 500),
  created_by          uuid,
  created_via         public.record_origin not null default 'manual',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  -- The contact must belong to THE SAME company. (A contact needs a company to be linked at all.)
  foreign key (tenant_id, contact_id, company_id) references public.contacts (tenant_id, id, company_id),
  check (contact_id is null or company_id is not null),
  -- The owner must be a member of the same tenant; removing the member un-assigns, nothing else.
  foreign key (tenant_id, owner_user_id) references public.memberships (tenant_id, user_id)
    on delete set null (owner_user_id)
);

-- ---------------------------------------------------------------------------------------------
-- opportunities
-- ---------------------------------------------------------------------------------------------
create table public.opportunities (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  company_id     uuid not null,
  contact_id     uuid,
  lead_id        uuid,
  owner_user_id  uuid,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  status         public.opportunity_status not null default 'open',
  lost_reason    text check (char_length(lost_reason) <= 500),
  closed_at      timestamptz,
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, contact_id, company_id) references public.contacts (tenant_id, id, company_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, owner_user_id) references public.memberships (tenant_id, user_id)
    on delete set null (owner_user_id),
  -- lost needs a reason; a reason only exists while lost; closed_at tracks won/lost.
  check (status <> 'lost' or char_length(btrim(coalesce(lost_reason, ''))) > 0),
  check (status = 'lost' or lost_reason is null)
);

-- ---------------------------------------------------------------------------------------------
-- Indexes: keyset pagination on every table; the child side of every composite foreign key.
-- ---------------------------------------------------------------------------------------------
create index companies_tenant_created_idx     on public.companies     (tenant_id, created_at desc, id);
create index contacts_tenant_created_idx      on public.contacts      (tenant_id, created_at desc, id);
create index products_tenant_created_idx      on public.products      (tenant_id, created_at desc, id);
create index leads_tenant_created_idx         on public.leads         (tenant_id, created_at desc, id);
create index opportunities_tenant_created_idx on public.opportunities (tenant_id, created_at desc, id);

create index contacts_company_idx              on public.contacts      (tenant_id, company_id);
create index leads_company_idx                 on public.leads         (tenant_id, company_id);
create index leads_contact_idx                 on public.leads         (tenant_id, contact_id);
create index leads_contact_company_idx         on public.leads         (tenant_id, contact_id, company_id);
create index leads_owner_idx                   on public.leads         (tenant_id, owner_user_id);
create index opportunities_company_idx         on public.opportunities (tenant_id, company_id);
create index opportunities_contact_idx         on public.opportunities (tenant_id, contact_id);
create index opportunities_contact_company_idx on public.opportunities (tenant_id, contact_id, company_id);
create index opportunities_lead_idx            on public.opportunities (tenant_id, lead_id);
create index opportunities_owner_idx           on public.opportunities (tenant_id, owner_user_id);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['companies', 'contacts', 'products', 'leads', 'opportunities'] loop
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function app.set_updated_at()', t);
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$s for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger %1$s_set_created_meta before insert or update on public.%1$s for each row execute function app.set_created_meta()', t);
    execute format('create trigger %1$s_guard_archive before update on public.%1$s for each row execute function app.guard_archive()', t);
  end loop;
end $$;

create trigger opportunities_guard_status
  before insert or update on public.opportunities
  for each row execute function app.guard_opportunity_status();

-- ---------------------------------------------------------------------------------------------
-- Column classification (read by the audit guards). PII = audited by NAME only.
-- Free text is PII unless justified as SAFE.
-- ---------------------------------------------------------------------------------------------
comment on column public.companies.name        is 'SAFE: business name (company names stay audited)';
comment on column public.companies.website     is 'SAFE: business web address';
comment on column public.companies.country     is 'SAFE: geography of a business';
comment on column public.companies.region      is 'SAFE: geography of a business';
comment on column public.companies.city        is 'SAFE: geography of a business';
comment on column public.companies.industry    is 'SAFE: business category';
comment on column public.companies.tags        is 'PII: free-form labels can contain names (free text defaults to PII)';

comment on column public.contacts.full_name    is 'PII: a person''s name';
comment on column public.contacts.email        is 'PII: contact detail';
comment on column public.contacts.phone        is 'PII: contact detail';
comment on column public.contacts.job_title    is 'PII: free text about a person (titles default to PII)';

comment on column public.products.sku          is 'SAFE: catalogue code';
comment on column public.products.name         is 'SAFE: catalogue name';
comment on column public.products.description  is 'PII: free text (descriptions default to PII)';
comment on column public.products.unit         is 'SAFE: unit of measure';
comment on column public.products.category     is 'SAFE: catalogue category';
comment on column public.products.attributes   is 'SAFE: structured product specifications, capped at 4 KB; must never hold personal data';

comment on column public.leads.source               is 'PII: free text (defaults to PII)';
comment on column public.leads.disqualified_reason  is 'PII: free text (reasons default to PII)';

comment on column public.opportunities.title        is 'PII: free text (titles default to PII)';
comment on column public.opportunities.lost_reason  is 'PII: free text (reasons default to PII)';

-- Audit: one trigger per table; the second argument lists the PII columns (kept in sync with the
-- comments above by a guard test).
create trigger audit_companies     after insert or update or delete on public.companies
  for each row execute function app.audit_row_change('company', 'tags');
create trigger audit_contacts      after insert or update or delete on public.contacts
  for each row execute function app.audit_row_change('contact', 'full_name,email,phone,job_title');
create trigger audit_products      after insert or update or delete on public.products
  for each row execute function app.audit_row_change('product', 'description');
create trigger audit_leads         after insert or update or delete on public.leads
  for each row execute function app.audit_row_change('lead', 'source,disqualified_reason');
create trigger audit_opportunities after insert or update or delete on public.opportunities
  for each row execute function app.audit_row_change('opportunity', 'title,lost_reason');

-- ---------------------------------------------------------------------------------------------
-- RLS: enabled and forced; default deny; policies TO authenticated; pattern-B helpers only.
--   read   : any member of the tenant
--   write  : Owner / Admin / Sales  (products: Owner / Admin only)
--   delete : nobody (no DELETE grant, no policy)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
  writers text;
begin
  foreach t in array array['companies', 'contacts', 'products', 'leads', 'opportunities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);

    writers := case t when 'products' then '''owner'', ''admin''' else '''owner'', ''admin'', ''sales''' end;

    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated with check (tenant_id = any (((select app.my_tenant_ids_with_role(array[%2$s]::public.app_role[])))::uuid[]))', t, writers);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[%2$s]::public.app_role[])))::uuid[])) with check (tenant_id = any (((select app.my_tenant_ids_with_role(array[%2$s]::public.app_role[])))::uuid[]))', t, writers);

    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Column grants. Absent on purpose: created_by, created_via, created_at, updated_at, closed_at,
-- tenant_id on UPDATE, and every consent / suppression column.
grant insert (id, tenant_id, name, type, website, country, region, city, industry, tags)
  on public.companies to authenticated;
grant update (name, type, website, country, region, city, industry, tags, archived_at)
  on public.companies to authenticated;

grant insert (id, tenant_id, company_id, full_name, email, phone, job_title)
  on public.contacts to authenticated;
grant update (company_id, full_name, email, phone, job_title, archived_at)
  on public.contacts to authenticated;

grant insert (id, tenant_id, sku, name, description, unit, category, attributes, active)
  on public.products to authenticated;
grant update (sku, name, description, unit, category, attributes, active, archived_at)
  on public.products to authenticated;

grant insert (id, tenant_id, company_id, contact_id, owner_user_id, status, source, disqualified_reason)
  on public.leads to authenticated;
grant update (company_id, contact_id, owner_user_id, status, source, disqualified_reason, archived_at)
  on public.leads to authenticated;

grant insert (id, tenant_id, company_id, contact_id, lead_id, owner_user_id, title)
  on public.opportunities to authenticated;
grant update (company_id, contact_id, lead_id, owner_user_id, title, status, lost_reason, archived_at)
  on public.opportunities to authenticated;
