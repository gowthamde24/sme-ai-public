-- T006b / M1 (1 of 2): erasure and anonymisation of personal data, the FOUNDATION (ADR 0014).
--
--   * erased_at on contacts and companies, and a guard that keeps an erased row erased
--   * public.erasure_requests: the request log (ids, counts, who, when; never a value), readable by Owner / Admin, written by nobody
--     except the three SECURITY DEFINER functions of the next migration
--   * erasure.registry: per scope, which columns are anonymised and how. It is what makes "a PII column nobody handled" a
--     failing build (supabase/tests/database/39) and what drives the tenant-wide wipe and the free-text sweep
--   * the narrow exception to immutability. Evidence, claims, the consent ledger and the audit log stay immutable for EVERYONE
--     except while an erasure is running, and then only under THREE conditions, each tested (supabase/tests/database/43):
--       (a) the caller is the trusted role: current_user = 'postgres', the owner of the definer functions (the same predicate
--           as the provenance triggers, ADR 0013). Inside a SECURITY INVOKER trigger function current_user is the role that
--           runs the statement, so a client (authenticated) can never pass it;
--       (b) the transaction-local setting app.erasure_request names an erasure_requests row of THE SAME TENANT with status
--           'executing'. Only execute_erasure sets that status, inside its own transaction, and the transaction ends with
--           'executed': a committed 'executing' row does not exist, so no other session can ever see one;
--       (c) only the columns registered for erasure on that table change (plus archived_at, as always).
--     DELETE and TRUNCATE stay forbidden everywhere.
--   * companies.name / website / city / region are reclassified PII (a sole proprietor's business name IS their name). The audit
--     trigger now records them by NAME only, and the company-scope erasure scrubs the four keys from existing audit rows.

-- ---------------------------------------------------------------------------------------------
-- Types and the marker columns
-- ---------------------------------------------------------------------------------------------
create type public.erasure_scope  as enum ('contact', 'company', 'tenant');
create type public.erasure_status as enum ('pending', 'executing', 'executed', 'cancelled');

alter table public.contacts  add column erased_at timestamptz;
alter table public.companies add column erased_at timestamptz;
comment on column public.contacts.erased_at  is 'when the personal data of this contact was anonymised (ADR 0014); only the erasure function can set or clear it';
comment on column public.companies.erased_at is 'when the identity of this company was anonymised (ADR 0014); only the erasure function can set or clear it';

-- ---------------------------------------------------------------------------------------------
-- The request log
-- ---------------------------------------------------------------------------------------------
create table public.erasure_requests (
  -- chosen by the caller: a retry with the same id and payload is a replay, never a second request
  id            uuid primary key,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  scope         public.erasure_scope not null,
  -- the contact or the company; NULL for the whole workspace. Validated by request_erasure (it can name either table).
  subject_id    uuid,
  status        public.erasure_status not null default 'pending',
  requested_by  uuid not null,
  created_at    timestamptz not null default now(),
  -- one contact / one company: now. The whole workspace: 24 hours after the request (a cancel window).
  execute_after timestamptz not null,
  executed_by   uuid,
  executed_at   timestamptz,
  cancelled_by  uuid,
  cancelled_at  timestamptz,
  -- counts per column and the "needs manual review" list (table, column, row id). Never a value, a name or a hash.
  result        jsonb,
  unique (tenant_id, id),
  check ((scope = 'tenant') = (subject_id is null)),
  check (result is null or jsonb_typeof(result) = 'object')
);
comment on column public.erasure_requests.result is
  'SAFE: counts per column and row ids for manual review, written only by the SECURITY DEFINER erasure functions; never a value. CLEAN-EXEMPT: not client-writable (clients hold SELECT only)';

create index erasure_requests_tenant_created_idx on public.erasure_requests (tenant_id, created_at desc, id);

create trigger erasure_requests_forbid_tenant_id_change
  before update on public.erasure_requests
  for each row execute function app.forbid_tenant_id_change();
create trigger audit_erasure_requests after insert or update or delete on public.erasure_requests
  for each row execute function app.audit_row_change('erasure_request');

alter table public.erasure_requests enable row level security;
alter table public.erasure_requests force row level security;
revoke all on public.erasure_requests from public, anon, authenticated;
grant select on public.erasure_requests to authenticated;
create policy erasure_requests_select on public.erasure_requests for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- The registry (its own private schema: no client role can reach it, and schema app stays functions only)
-- ---------------------------------------------------------------------------------------------
--   scope      tenant   the column is wiped, in every row of the workspace, by the tenant-wide erasure
--              sweep    the column is searched for the exact identifiers (e-mail, phone, website host) of a contact / company,
--                       and a field that EQUALS a name is tombstoned (a field that merely contains it is listed for review)
--              contact  the column is anonymised for the rows linked to one contact (static handler; the row here is the record)
--              company  the same for one company
--   strategy   null            set NULL (only a nullable column)
--              tombstone       set the replacement (a text column)
--              empty_array     set '{}'
--              substring       text: replace identifiers inside; whole-field equality with a name = tombstone
--              substring_array the same for text[], element by element
--   replacement  the tombstone. 'erased:1' satisfies every typed-reference shape; a few columns need another (import label).
--   with_set     extra assignments that must accompany the update to keep a CHECK true (evidence needs a url or a reference)
--   extra        a column that a scope handles on purpose although it is not PII-commented
--   tenant_exempt  a PII column that the tenant-wide erasure deliberately leaves alone (a company's identity: decision 4)
create schema erasure;
revoke all on schema erasure from public, anon, authenticated, service_role;
create table erasure.registry (
  table_name    text not null,
  column_name   text not null,
  scope         text not null check (scope in ('tenant', 'sweep', 'contact', 'company')),
  strategy      text not null check (strategy in ('null', 'tombstone', 'empty_array', 'substring', 'substring_array')),
  replacement   text not null default 'erased:1',
  with_set      text,
  extra         boolean not null default false,
  tenant_exempt boolean not null default false,
  primary key (table_name, column_name, scope)
);
revoke all on erasure.registry from public, anon, authenticated, service_role;
alter table erasure.registry enable row level security;
alter table erasure.registry force row level security;

-- tenant scope: every PII column except a company's identity
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('contacts',       'full_name',           'tenant', 'tombstone',   'erased:1',  null),
  ('contacts',       'email',               'tenant', 'null',        'erased:1',  null),
  ('contacts',       'phone',               'tenant', 'null',        'erased:1',  null),
  ('contacts',       'job_title',           'tenant', 'null',        'erased:1',  null),
  ('companies',      'tags',                'tenant', 'empty_array', 'erased:1',  null),
  ('consent_events', 'evidence_ref',        'tenant', 'tombstone',   'erased:1',  null),
  ('claims',         'value',               'tenant', 'tombstone',   'erased:1',  null),
  ('evidence',       'url',                 'tenant', 'null',        'erased:1',  'reference = coalesce(t.reference, ''erased:1'')'),
  ('evidence',       'reference',           'tenant', 'tombstone',   'erased:1',  null),
  ('evidence',       'snippet',             'tenant', 'tombstone',   'erased:1',  null),
  ('import_batches', 'label',               'tenant', 'tombstone',   'erased-1',  null),
  ('leads',          'source',              'tenant', 'tombstone',   'erased:1',  null),
  ('leads',          'disqualified_reason', 'tenant', 'tombstone',   'erased:1',  null),
  ('opportunities',  'title',               'tenant', 'tombstone',   'erased:1',  null),
  ('opportunities',  'lost_reason',         'tenant', 'tombstone',   'erased:1',  null),
  ('products',       'description',         'tenant', 'null',        'erased:1',  null);

-- sweep: every free-text PII column (a contact's own e-mail / phone / name columns are not searched: they ARE the identifiers)
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('contacts',       'job_title',           'sweep', 'substring',       'erased:1'),
  ('companies',      'name',                'sweep', 'substring',       'erased:1'),
  ('companies',      'website',             'sweep', 'substring',       'erased:1'),
  ('companies',      'city',                'sweep', 'substring',       'erased:1'),
  ('companies',      'region',              'sweep', 'substring',       'erased:1'),
  ('companies',      'tags',                'sweep', 'substring_array', 'erased-1'),
  ('consent_events', 'evidence_ref',        'sweep', 'substring',       'erased:1'),
  ('claims',         'value',               'sweep', 'substring',       'erased:1'),
  ('evidence',       'url',                 'sweep', 'substring',       'erased:1'),
  ('evidence',       'reference',           'sweep', 'substring',       'erased:1'),
  ('evidence',       'snippet',             'sweep', 'substring',       'erased:1'),
  ('import_batches', 'label',               'sweep', 'substring',       'erased-1'),
  ('leads',          'source',              'sweep', 'substring',       'erased:1'),
  ('leads',          'disqualified_reason', 'sweep', 'substring',       'erased:1'),
  ('opportunities',  'title',               'sweep', 'substring',       'erased:1'),
  ('opportunities',  'lost_reason',         'sweep', 'substring',       'erased:1'),
  ('products',       'description',         'sweep', 'substring',       'erased:1');

-- contact scope: the contact, its ledger reference, the free text of the leads / opportunities linked to it
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('contacts',       'full_name',           'contact', 'tombstone', 'erased:1', null),
  ('contacts',       'email',               'contact', 'null',      'erased:1', null),
  ('contacts',       'phone',               'contact', 'null',      'erased:1', null),
  ('contacts',       'job_title',           'contact', 'null',      'erased:1', null),
  ('consent_events', 'evidence_ref',        'contact', 'tombstone', 'erased:1', null),
  ('leads',          'source',              'contact', 'tombstone', 'erased:1', null),
  ('leads',          'disqualified_reason', 'contact', 'tombstone', 'erased:1', null),
  ('opportunities',  'title',               'contact', 'tombstone', 'erased:1', null),
  ('opportunities',  'lost_reason',         'contact', 'tombstone', 'erased:1', null);

-- company scope: the company's identity, and what is attached to it
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set, tenant_exempt) values
  ('companies',      'name',                'company', 'tombstone',   'erased:1', null, true),
  ('companies',      'website',             'company', 'null',        'erased:1', null, true),
  ('companies',      'city',                'company', 'null',        'erased:1', null, true),
  ('companies',      'region',              'company', 'null',        'erased:1', null, true),
  ('companies',      'tags',                'company', 'empty_array', 'erased:1', null, false),
  ('claims',         'value',               'company', 'tombstone',   'erased:1', null, false),
  ('evidence',       'url',                 'company', 'null',        'erased:1', 'reference = coalesce(t.reference, ''erased:1'')', false),
  ('evidence',       'reference',           'company', 'tombstone',   'erased:1', null, false),
  ('evidence',       'snippet',             'company', 'tombstone',   'erased:1', null, false),
  ('leads',          'source',              'company', 'tombstone',   'erased:1', null, false),
  ('leads',          'disqualified_reason', 'company', 'tombstone',   'erased:1', null, false),
  ('opportunities',  'title',               'company', 'tombstone',   'erased:1', null, false),
  ('opportunities',  'lost_reason',         'company', 'tombstone',   'erased:1', null, false);

-- ---------------------------------------------------------------------------------------------
-- Company identity is personal data (a sole proprietor's business name is their name)
-- ---------------------------------------------------------------------------------------------
comment on column public.companies.name    is 'PII: business name; for a sole proprietor it is the person''s name. Audited by name only; anonymised by the company-scope erasure';
comment on column public.companies.website is 'PII: business web address; it can name a person. Audited by name only; anonymised by the company-scope erasure';
comment on column public.companies.city    is 'PII: location of a business; for a sole proprietor, of a person. Audited by name only; anonymised by the company-scope erasure';
comment on column public.companies.region  is 'PII: location of a business; for a sole proprietor, of a person. Audited by name only; anonymised by the company-scope erasure';
drop trigger audit_companies on public.companies;
create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function app.audit_row_change('company', 'name,website,city,region,tags');

-- ---------------------------------------------------------------------------------------------
-- The door
-- ---------------------------------------------------------------------------------------------
-- (b): is an erasure of THIS tenant running in this transaction? Callers test (a) first, in plain code, before calling this:
-- it is executable by its owner only.
create function app.erasure_running(p_tenant_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.erasure_requests r
     where r.id::text = nullif(current_setting('app.erasure_request', true), '')
       and r.tenant_id = p_tenant_id
       and r.status = 'executing'
  )
$$;
revoke all on function app.erasure_running(uuid) from public;

-- (c): the columns that may change on a table while the door is open
create function app.erasure_columns(p_table text) returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct r.column_name), '{}'::text[]) || array['archived_at']
    from erasure.registry r where r.table_name = p_table
$$;
revoke all on function app.erasure_columns(text) from public;

-- The columns whose value differs between two rows
create function app.changed_columns(p_old jsonb, p_new jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k), '{}'::text[])
    from (select key as k from (select key, value from jsonb_each(p_new) except select key, value from jsonb_each(p_old)) d) c
$$;
revoke all on function app.changed_columns(jsonb, jsonb) from public;

-- Evidence, links, claims, labels, exports, import records, agent steps, claim reviews: immutable except archived_at, and
-- except the registered columns while an erasure of the same tenant runs under the trusted role.
create or replace function app.guard_immutable_record() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
    if current_user = 'postgres' then
      if app.erasure_running(new.tenant_id)
         and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
        return new;
      end if;
    end if;
    raise exception '% rows are immutable: archive the row and record a new one', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The consent ledger: append-only, except that an erasure may tombstone the registered reference.
create function app.guard_consent_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'postgres' then
    if app.erasure_running(new.tenant_id)
       and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
      return new;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.guard_consent_update() from public;
drop trigger consent_events_no_update on public.consent_events;
create trigger consent_events_no_update before update on public.consent_events
  for each row execute function app.guard_consent_update();

-- The audit log: append-only, except that a company-scope erasure removes the four company identity KEYS from the
-- old_values / new_values of that tenant's company rows (written before those columns were classified PII). Nothing else.
create function app.guard_audit_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_keys constant text[] := array['name', 'website', 'city', 'region'];
begin
  if current_user = 'postgres' then
    if app.erasure_running(new.tenant_id)
       and new.entity_type = 'company'
       and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ array['old_values', 'new_values']
       and new.old_values is not distinct from (old.old_values - c_keys)
       and new.new_values is not distinct from (old.new_values - c_keys) then
      return new;
    end if;
  end if;
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.guard_audit_update() from public;
drop trigger audit_events_no_update on public.audit_events;
create trigger audit_events_no_update before update on public.audit_events
  for each row execute function app.guard_audit_update();

-- An erased contact / company stays erased: its marker cannot be set or cleared by anyone but the erasure, and its personal
-- columns cannot be written back (archive state is still an ordinary admin action).
create function app.guard_erased_row() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_open boolean := false;
begin
  if current_user = 'postgres' then
    v_open := app.erasure_running(new.tenant_id);
  end if;
  if tg_op = 'INSERT' then
    if new.erased_at is not null and not v_open then
      raise exception '% cannot be created already erased', tg_table_name using errcode = '42501';
    end if;
    return new;
  end if;
  if new.erased_at is distinct from old.erased_at and not v_open then
    raise exception 'only an erasure can mark a % erased', tg_table_name using errcode = '42501';
  end if;
  if old.erased_at is not null and not v_open
     and (to_jsonb(new) - 'archived_at' - 'updated_at') is distinct from (to_jsonb(old) - 'archived_at' - 'updated_at') then
    raise exception 'an erased % cannot be changed', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_erased_row() from public;
create trigger contacts_guard_erased  before insert or update on public.contacts
  for each row execute function app.guard_erased_row();
create trigger companies_guard_erased before insert or update on public.companies
  for each row execute function app.guard_erased_row();
