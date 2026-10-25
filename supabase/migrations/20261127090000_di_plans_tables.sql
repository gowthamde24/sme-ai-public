-- Job DI (night run C1, ADR 0092), migration 1 of 3: the PLANS CATALOGUE as data. packages/plans/plans.json is the source; `make plans-migration` writes the next migration (20261127090100) from it, the way packs are
-- synced (ADR 0084 part 1). A synced catalogue VERSION is never edited: a change is a new version and a new migration.
--
--   billing.plans              the plan ids that exist (a plan id is data; tenants.plan and the allowance tables refer to it)
--   billing.catalogue_versions one row per synced version of plans.json: the trial rules, the manifest as it was and its SHA-256
--   billing.plan_versions      one row per plan per version: kind, price (paise, null until the owner sets it), the allowances (call minutes, WhatsApp messages), the limits (users, workspaces)
--
-- No client role can read or write any of it: the reader is public.billing_plans() (migration 3). Prices are null for now: the owner decides them from the usage tests.

create schema billing;
revoke all on schema billing from public, anon, authenticated, service_role;
comment on schema billing is 'Job DI: plans and billing groundwork (ADR 0092). No client role has usage; the readers and writers are public.billing_* functions.';

create table billing.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$')
);
comment on table billing.plans is 'Operator data: the plan ids. SAFE: not personal data.';

create table billing.catalogue_versions (
  version                  integer primary key check (version >= 1),
  status                   text not null check (status in ('draft', 'published')),
  trial_plan               text not null references billing.plans (id),
  trial_days               integer not null check (trial_days between 1 and 90),
  payment_method_at_start  boolean not null,
  grace_days               integer not null check (grace_days between 0 and 30),
  manifest                 jsonb not null,
  manifest_sha256          text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  synced_at                timestamptz not null default now()
);

create table billing.plan_versions (
  catalogue_version      integer not null references billing.catalogue_versions (version),
  plan_id                text not null references billing.plans (id),
  kind                   text not null check (kind in ('trial', 'main', 'calls')),
  sort                   integer not null check (sort between 0 and 1000),
  name                   jsonb not null,
  price_paise_monthly    integer check (price_paise_monthly between 0 and 100000000),
  price_paise_per_minute integer check (price_paise_per_minute between 0 and 100000),
  price_paise_per_message integer check (price_paise_per_message between 0 and 100000),
  call_minutes           integer check (call_minutes between 0 and 100000),   -- null = pay as you go: no included minutes, no ceiling
  whatsapp_messages      integer check (whatsapp_messages between 0 and 1000000),   -- null = pay as you go: nothing included, no ceiling, billed per message
  users                  integer not null check (users between 1 and 1000),
  workspaces             integer not null check (workspaces between 1 and 100),
  primary key (catalogue_version, plan_id),
  unique (catalogue_version, sort),
  check (call_minutes is not null or kind = 'calls'),
  check ((call_minutes is null) = (whatsapp_messages is null))   -- pay as you go is minutes AND messages billed by use, or neither
);

-- a synced version is never changed or removed
create function billing.catalogue_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a synced plans catalogue is never edited: raise the version in packages/plans/plans.json' using errcode = '42501';
end;
$$;
revoke all on function billing.catalogue_immutable() from public, anon, authenticated, service_role;
create trigger catalogue_versions_immutable before update or delete on billing.catalogue_versions for each row execute function billing.catalogue_immutable();
create trigger plan_versions_immutable before update or delete on billing.plan_versions for each row execute function billing.catalogue_immutable();
create trigger catalogue_versions_no_truncate before truncate on billing.catalogue_versions for each statement execute function billing.catalogue_immutable();
create trigger plan_versions_no_truncate before truncate on billing.plan_versions for each statement execute function billing.catalogue_immutable();

do $$
declare t text;
begin
  foreach t in array array['plans', 'catalogue_versions', 'plan_versions'] loop
    execute format('alter table billing.%I enable row level security', t);
    execute format('alter table billing.%I force row level security', t);
    execute format('revoke all on billing.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
