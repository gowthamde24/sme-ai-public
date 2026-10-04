-- T002 / 1 of 4: tenancy schema.
-- Tables: tenants, users (profile), memberships. Role enum. Integrity triggers.
-- RLS policies and grants come in migration 3; audit in migration 2. Until migration 3 runs,
-- every table here is locked down (RLS forced, no grants), so a partial apply is safe.

-- ---------------------------------------------------------------------------------------------
-- Privilege baseline. Supabase's default ACLs auto-grant every new object in `public` to anon and
-- authenticated; revoke that so exposure is always an explicit, reviewed GRANT. This changes the
-- defaults for objects the migration role (postgres) creates from now on.
-- ---------------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- Postgres grants EXECUTE on new functions to PUBLIC unless told otherwise.
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Private schema for RLS helpers and trigger functions. It is NOT in supabase/config.toml
-- [api].schemas, so PostgREST never exposes it. anon gets no access at all.
-- ---------------------------------------------------------------------------------------------
create schema app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

create type public.app_role as enum ('owner', 'admin', 'sales', 'viewer');

-- ---------------------------------------------------------------------------------------------
-- Generic trigger functions (SECURITY INVOKER; they only touch the row being written)
-- ---------------------------------------------------------------------------------------------
create function app.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Reusable guard for EVERY tenant-owned table: a row can never move to another tenant. Enforced
-- below the privilege layer, so it also holds for the table owner and for future code paths.
create function app.forbid_tenant_id_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.set_updated_at() from public;
revoke all on function app.forbid_tenant_id_change() from public;

-- ---------------------------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------------------------
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  -- 3-40 chars, lowercase alphanumerics and hyphens, no leading/trailing hyphen
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- users: minimal profile for auth.users. PII minimisation: email stays in auth.users only.
-- ---------------------------------------------------------------------------------------------
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function app.set_updated_at();

-- Profile row on signup. SECURITY DEFINER because it runs inside GoTrue's insert on auth.users,
-- as a role that has no rights on public.users.
create function app.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 100), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- memberships: the single source of authorization (user x tenant -> role).
-- Roles are deliberately NOT stored in JWT claims: revocation is immediate because the database
-- is consulted on every request.
-- ---------------------------------------------------------------------------------------------
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  user_id    uuid not null references public.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function app.set_updated_at();

create trigger memberships_forbid_tenant_id_change
  before update on public.memberships
  for each row execute function app.forbid_tenant_id_change();

-- A tenant must always keep at least one Owner. Runs for every writer (owner, admin, cascades,
-- the table owner). SECURITY DEFINER so RLS cannot hide other owners from the check; the tenant
-- row lock serialises concurrent demotions so two owners cannot both step down at once.
create function app.protect_last_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_losing_owner boolean;
begin
  -- NEW is not assigned for DELETE, so decide in two steps instead of one boolean expression.
  if tg_op = 'DELETE' then
    v_losing_owner := old.role = 'owner';
  else
    v_losing_owner := old.role = 'owner' and new.role <> 'owner';
  end if;

  if v_losing_owner then
    perform 1 from public.tenants where id = old.tenant_id for update;
    if not exists (
      select 1 from public.memberships
      where tenant_id = old.tenant_id and role = 'owner' and id <> old.id
    ) then
      raise exception 'cannot remove or demote the last owner of a tenant' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app.protect_last_owner() from public;

create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function app.protect_last_owner();

-- ---------------------------------------------------------------------------------------------
-- Lock down. RLS is ENABLED and FORCED (applies to the table owner too). No policy exists yet and
-- nothing is granted, so the tables are closed until migration 3.
-- ---------------------------------------------------------------------------------------------
alter table public.tenants     enable row level security;
alter table public.tenants     force  row level security;
alter table public.users       enable row level security;
alter table public.users       force  row level security;
alter table public.memberships enable row level security;
alter table public.memberships force  row level security;

revoke all on public.tenants, public.users, public.memberships from public, anon, authenticated;
