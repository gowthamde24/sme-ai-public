-- Job CK (wave 1, C1, ADR 0084 part 1, blueprint section 4): BUSINESS-TYPE PACKS AS DATA, with MODULES DEFAULT-DENY IN THE DATABASE. Migration 1 of 3 (structure; the pack rows are generated into the next
-- file from packages/packs/*/pack.json by scripts/pack_migration.py; the third file switches everything on). A new migration: earlier files are not edited.
--
--   packs.modules          the CLOSED list of modules (packages/packs/modules.json): what a pack can switch on. `guard` says how the database refuses a module that is off.
--   packs.units            the CLOSED list of selling units: sq_ft, sq_m, piece, box, bag, tonne, cft, truckload (and the older `set`).
--   packs.pack_versions    one row per pack id and version: status (draft | preview | published), the full manifest as jsonb and its SHA-256. IMMUTABLE once written (a change is a new version).
--   packs.pack_modules     the modules each pack version switches ON. Everything else is OFF.
--   packs.workspace_pack   the pack (and version) each business runs, chosen at sign-up. Written only by SECURITY DEFINER functions.
--   packs.agent_modules    which module an agent run needs (the research agent needs `research`, the requirement agent needs `enquiries`).
--
--   app.module_enabled(tenant, module)   true only when the business's pack version lists the module. A business with no pack, a pack without the module, an unknown module: FALSE (default deny).
--                                         Plan entitlements and operator overrides (ADR 0084 part 6) are NOT built; this is the single place where they will join.
--   app.module_guard()                   a BEFORE INSERT trigger (module code in its argument) on every table a module owns: an off module cannot create rows (SM701). Reads are untouched.
--
-- Nothing here is open to anon. The packs schema has no client grant at all; clients reach it only through the three reader functions at the end (every member may read their own business's pack).
-- SQLSTATEs: SM701 the module is off for this business; SM702 the business type is not available.

create schema packs;
revoke all on schema packs from public, anon, authenticated, service_role;
comment on schema packs is 'Job CK: industry packs as data (ADR 0084 part 1). No client role has usage; the readers are public.workspace_pack_get, public.workspace_modules and public.pack_catalogue.';

create table packs.modules (
  code         text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  exists_today boolean not null,
  guard        text not null check (guard in ('tables', 'agents', 'flag', 'future')),
  description  text not null check (char_length(description) between 1 and 200)
);

create table packs.units (
  code     text primary key check (code ~ '^[a-z][a-z_]{1,15}$'),
  position smallint not null unique,
  label    text not null check (char_length(label) between 1 and 40)
);
insert into packs.units (code, position, label) values
  ('piece', 1, 'piece'), ('set', 2, 'set'), ('sq_ft', 3, 'sq ft'), ('sq_m', 4, 'sq m'), ('box', 5, 'box'),
  ('bag', 6, 'bag'), ('tonne', 7, 'tonne'), ('cft', 8, 'cft'), ('truckload', 9, 'truckload');

-- the quote sale unit grows with the list (a new value cannot be used until this migration commits; nothing here uses it)
alter type public.quote_sale_unit add value if not exists 'sq_ft';
alter type public.quote_sale_unit add value if not exists 'sq_m';
alter type public.quote_sale_unit add value if not exists 'box';
alter type public.quote_sale_unit add value if not exists 'bag';
alter type public.quote_sale_unit add value if not exists 'tonne';
alter type public.quote_sale_unit add value if not exists 'cft';
alter type public.quote_sale_unit add value if not exists 'truckload';

create table packs.pack_versions (
  code            text    not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  version         integer not null check (version >= 1),
  status          text    not null check (status in ('draft', 'preview', 'published')),
  is_default      boolean not null default false,
  reviewed_by     text    check (reviewed_by is null or char_length(reviewed_by) between 3 and 200),
  manifest        jsonb   not null check (jsonb_typeof(manifest) = 'object'),
  manifest_sha256 text    not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  primary key (code, version),
  check (status <> 'published' or reviewed_by is not null),
  check (not is_default or status = 'published')
);
-- exactly one default pack version may exist at a time: the one every workspace without a chosen pack runs (today's behaviour)
create unique index pack_versions_one_default on packs.pack_versions ((true)) where is_default;

create table packs.pack_modules (
  code    text    not null,
  version integer not null,
  module  text    not null references packs.modules (code),
  primary key (code, version, module),
  foreign key (code, version) references packs.pack_versions (code, version)
);

create table packs.workspace_pack (
  tenant_id    uuid primary key references public.tenants (id) on delete restrict,
  pack_code    text not null,
  pack_version integer not null,
  source       text not null check (source in ('signup', 'default', 'legacy', 'operator')),
  chosen_by    uuid,
  chosen_at    timestamptz not null default now(),
  foreign key (pack_code, pack_version) references packs.pack_versions (code, version)
);
create index workspace_pack_pack_idx on packs.workspace_pack (pack_code, pack_version);

create table packs.agent_modules (
  agent_name text primary key check (agent_name ~ '^[a-z][a-z0-9_]{1,29}$'),
  module     text not null references packs.modules (code)
);
-- (the three rows arrive with the activation file, after the modules exist)

do $$
declare t text;
begin
  foreach t in array array['modules', 'units', 'pack_versions', 'pack_modules', 'workspace_pack', 'agent_modules'] loop
    execute format('alter table packs.%I enable row level security', t);
    execute format('alter table packs.%I force row level security', t);
    execute format('revoke all on packs.%I from public, anon, authenticated, service_role', t);
  end loop;
end;
$$;
-- a business reads its own pack row (never reachable by a client role today: no grant, no schema usage; the policy is the stated intent for the day a grant is added)
create policy workspace_pack_member_select on packs.workspace_pack for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));

-- Pack rows never change: a published manifest is a fact other rows point at. Only `is_default` may move (to hand the default to a newer version); nothing is ever deleted.
create function packs.forbid_pack_edit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pack rows are never deleted' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'is_default') is distinct from (to_jsonb(old) - 'is_default') then
    raise exception 'a pack version is never edited: make a new version' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger pack_versions_immutable before update or delete on packs.pack_versions for each row execute function packs.forbid_pack_edit();
create function packs.forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never changed or deleted here', tg_table_name using errcode = '42501';
end;
$$;
create trigger pack_modules_immutable before update or delete on packs.pack_modules for each row execute function packs.forbid_change();
create trigger modules_immutable before update or delete on packs.modules for each row execute function packs.forbid_change();
create trigger units_immutable before update or delete on packs.units for each row execute function packs.forbid_change();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The errors, said once
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.pack_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'     then raise exception 'invalid input' using errcode = '22023';
    when 'reference'   then raise exception 'not found' using errcode = '23503';
    when 'module_off'  then raise exception 'this module is not on for this business' using errcode = 'SM701';
    when 'unavailable' then raise exception 'that business type is not available' using errcode = 'SM702';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.pack_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The one place that says whether a module is on
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.module_enabled(p_tenant uuid, p_module text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select true
      from packs.workspace_pack w
      join packs.pack_modules m on m.code = w.pack_code and m.version = w.pack_version
     where w.tenant_id = p_tenant and m.module = p_module
     limit 1), false)
$$;
revoke all on function app.module_enabled(uuid, text) from public;

create function app.require_module(p_tenant uuid, p_module text) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.module_enabled(p_tenant, p_module) then
    perform app.pack_error('module_off');
  end if;
end;
$$;
revoke all on function app.require_module(uuid, text) from public;

-- BEFORE INSERT on a table a module owns. The module code is the trigger's argument. Runs with the definer's rights so it can read packs.*; changes nothing.
create function app.module_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.module_enabled(new.tenant_id, tg_argv[0]) then
    perform app.pack_error('module_off');
  end if;
  return new;
end;
$$;
revoke all on function app.module_guard() from public;

-- BEFORE INSERT on agent_runs: an agent that is mapped to a module (packs.agent_modules) needs that module on. An unmapped agent (the self-test) is not checked.
create function app.module_guard_agent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module text;
begin
  select a.module into v_module from packs.agent_modules a where a.agent_name = new.agent_name;
  if v_module is not null and not app.module_enabled(new.tenant_id, v_module) then
    perform app.pack_error('module_off');
  end if;
  return new;
end;
$$;
revoke all on function app.module_guard_agent() from public;

-- A product's selling unit, when written or changed: a business on the DEFAULT pack keeps today's behaviour (any short word, as before: the demo sells fabric by the "metre"); a business on any other
-- pack may use only the units ITS pack offers (a pack can only make a business stricter). An older row with another word stays readable and can be saved without touching the unit.
create function app.products_unit_check() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v packs.pack_versions;
begin
  if new.unit is not null and (tg_op = 'INSERT' or new.unit is distinct from old.unit) then
    select pv.* into v from packs.workspace_pack w join packs.pack_versions pv on pv.code = w.pack_code and pv.version = w.pack_version where w.tenant_id = new.tenant_id;
    if found and not v.is_default
       and not exists (select 1 from jsonb_array_elements_text(v.manifest -> 'units') u join packs.units k on k.code = u where u = new.unit) then
      perform app.pack_error('invalid');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.products_unit_check() from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Readers (every member of the business; the catalogue of packs for any signed-in person)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.workspace_pack_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w packs.workspace_pack;
  v packs.pack_versions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.pack_error('deny');
  end if;
  select * into w from packs.workspace_pack x where x.tenant_id = p_tenant_id;
  if not found then
    perform app.pack_error('reference');
  end if;
  select * into v from packs.pack_versions x where x.code = w.pack_code and x.version = w.pack_version;
  return jsonb_build_object(
    'pack_id', v.code, 'version', v.version, 'status', v.status, 'validated', v.status = 'published', 'source', w.source, 'chosen_at', w.chosen_at,
    'manifest', v.manifest - 'example_data',
    'modules', (select coalesce(jsonb_agg(m.module order by m.module), '[]'::jsonb) from packs.pack_modules m where m.code = v.code and m.version = v.version));
end;
$$;
revoke all on function public.workspace_pack_get(uuid) from public, anon;
grant execute on function public.workspace_pack_get(uuid) to authenticated;

create function public.workspace_modules(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.pack_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('module', m.code, 'enabled', app.module_enabled(p_tenant_id, m.code), 'reason', 'pack') order by m.code) from packs.modules m), '[]'::jsonb);
end;
$$;
revoke all on function public.workspace_modules(uuid) from public, anon;
grant execute on function public.workspace_modules(uuid) to authenticated;

create function public.pack_catalogue() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.pack_error('deny');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('pack_id', v.code, 'version', v.version, 'status', v.status, 'validated', v.status = 'published', 'manifest_sha256', v.manifest_sha256,
                                         'names', v.manifest -> 'names', 'summary', v.manifest -> 'summary') order by v.code)
      from packs.pack_versions v
     where v.status in ('preview', 'published')
       and v.version = (select max(x.version) from packs.pack_versions x where x.code = v.code and x.status in ('preview', 'published'))), '[]'::jsonb);
end;
$$;
revoke all on function public.pack_catalogue() from public, anon;
grant execute on function public.pack_catalogue() to authenticated;
