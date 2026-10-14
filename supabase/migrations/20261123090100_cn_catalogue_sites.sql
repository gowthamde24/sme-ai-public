-- Job CN (wave 2, C1, ADR 0085), migration 2 of 7: the building-materials CATALOGUE and customer SITES. Migration 1 is the generated pack data (module `materials`, construction pack version 2).
--
--   * Module guards: `sites`, `deliveries` and `dues` were `future` modules (CK registered no tables). They now own tables, so their guard kind becomes `tables` (the closed module list is edited here, once, with its
--     immutability trigger off for this one statement; packages/packs/modules.json says the same). Workspaces on construction pack version 1 move to version 2 (a superset: it adds `materials`).
--   * public.catalogue_items grows `item_kind` ('saree' = today's rows, 'material' = a building material), `sell_unit` (one of the closed selling units) and `area_unit` (the unit the item's pieces-per-area refers to).
--     A saree keeps every column it has; the saree-only columns (fabric, colours, price band) become nullable and are REQUIRED by a CHECK for a saree and FORBIDDEN for a material. The specs of a material
--     (product type, size, thickness, pieces per area and per pallet, minimum order, lead days, GST rate and HSN code) are the PACK's custom fields (ADR 0084 part 2), not new columns: the owner enters the GST
--     rate and HSN code, nothing assumes them. A material can only be created where the `materials` module is on (SM701).
--   * public.customer_sites: a customer (a company) has many sites: address, PIN, map pin, distance from the yard, truck access (lane width, night delivery, unloading help, notes) and a site contact (a CONTACT
--     row, so the messaging rules (consent, suppression key, quiet hours) apply to it like to any person).
--   * the requirement field keys the Requirement Analyst uses for a building-materials enquiry are added to the enum (a new enum value cannot be USED until this migration commits: migration 3 uses them).
--
-- Who: every member reads sites and catalogue items; Owner, Admin and Sales write sites; Owner and Admin write catalogue items; the EXACT price of an item is the Owner's alone and needs a second factor
-- (the same rule as a saree's price). Nobody writes a table directly: every write is a SECURITY DEFINER function that proves the role first.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM521 an active item needs a photo, SM701 the module is off, SM751 a site's contact is not in this business.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. modules and the pack version
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table packs.modules disable trigger modules_immutable;
update packs.modules set guard = 'tables', description = 'Customer sites: address, pin, map pin, site contact and truck access notes' where code = 'sites';
update packs.modules set guard = 'tables', description = 'Deliveries: trips, vehicles, delivery notes (challan) and proof of delivery' where code = 'deliveries';
update packs.modules set guard = 'tables', description = 'Receivables: invoices entered, payments recorded, balance, ageing and the credit-limit warning' where code = 'dues';
alter table packs.modules enable trigger modules_immutable;
update packs.workspace_pack set pack_version = 2 where pack_code = 'construction_materials' and pack_version = 1;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the requirement field keys of a building-materials enquiry (used from migration 3)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter type public.requirement_field_key add value if not exists 'application';
alter type public.requirement_field_key add value if not exists 'product_type';
alter type public.requirement_field_key add value if not exists 'thickness';
alter type public.requirement_field_key add value if not exists 'area';
alter type public.requirement_field_key add value if not exists 'length';
alter type public.requirement_field_key add value if not exists 'width';
alter type public.requirement_field_key add value if not exists 'site_location';
alter type public.requirement_field_key add value if not exists 'laying';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the catalogue, generalised
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.catalogue_items add column item_kind text not null default 'saree' check (item_kind in ('saree', 'material'));
alter table public.catalogue_items add column sell_unit text references packs.units (code);
create index catalogue_items_sell_unit_idx on public.catalogue_items (sell_unit) where sell_unit is not null;
alter table public.catalogue_items add column area_unit text check (area_unit in ('sq_ft', 'sq_m'));
alter table public.catalogue_items alter column fabric drop not null;
alter table public.catalogue_items alter column colours drop not null;
alter table public.catalogue_items alter column price_band drop not null;
alter table public.catalogue_items add constraint catalogue_items_saree_shape check (
  item_kind <> 'saree' or (fabric is not null and colours is not null and price_band is not null and sell_unit is null and area_unit is null));
alter table public.catalogue_items add constraint catalogue_items_material_shape check (
  item_kind <> 'material' or (sell_unit is not null and fabric is null and colours is null and price_band is null and zari = 'none' and border is null and cardinality(occasions) = 0));
-- an item sold by the area is priced per the same area unit its coverage is counted in
alter table public.catalogue_items add constraint catalogue_items_area_unit_matches check (sell_unit is null or sell_unit not in ('sq_ft', 'sq_m') or area_unit = sell_unit);
comment on column public.catalogue_items.item_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.catalogue_items.sell_unit is 'SAFE: a closed selling unit (packs.units). CLEAN-EXEMPT: a foreign key to the closed list';
comment on column public.catalogue_items.area_unit is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- the kind of an item never changes; a material can only be made where the module is on
create function app.catalogue_kind_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.item_kind is distinct from old.item_kind then
      raise exception 'the kind of a catalogue item never changes' using errcode = '42501';
    end if;
  elsif new.item_kind = 'material' and not app.module_enabled(new.tenant_id, 'materials') then
    perform app.pack_error('module_off');
  end if;
  return new;
end;
$$;
revoke all on function app.catalogue_kind_guard() from public;
create trigger catalogue_items_kind_insert before insert on public.catalogue_items for each row execute function app.catalogue_kind_guard();
create trigger catalogue_items_kind_update before update on public.catalogue_items for each row execute function app.catalogue_kind_guard();

-- the reader every screen and the agent's catalogue tool use: the same keys as before plus the three new ones
create or replace function app.catalogue_item_json(m public.catalogue_items) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'name', m.name, 'fabric', m.fabric, 'colours', to_jsonb(m.colours), 'zari', m.zari, 'border', m.border, 'occasions', to_jsonb(m.occasions),
    'price_band', m.price_band, 'price_paise', m.price_paise, 'stock_status', m.stock_status, 'active', m.active,
    'item_kind', m.item_kind, 'sell_unit', m.sell_unit, 'area_unit', m.area_unit,
    'created_at', m.created_at, 'updated_at', m.updated_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'bucket', p.bucket, 'path', p.path, 'thumb_path', p.thumb_path,
                                                            'width', p.width, 'height', p.height, 'bytes', p.bytes) order by p.position)
                          from public.catalogue_photos p where p.tenant_id = m.tenant_id and p.item_id = m.id and p.removed_at is null), '[]'::jsonb))
$$;

-- Create or change a MATERIAL item (Owner or Admin; the module must be on). `p_change_price` says the exact price per selling unit in `p_price_paise` (null clears it) is to be applied: the Owner's alone, with
-- a second factor. The details (size, thickness, pieces per sq ft, GST rate, HSN code ...) are the pack's custom fields, set through the custom-field functions.
create function public.catalogue_material_save(
  p_item_id uuid, p_tenant_id uuid, p_name text, p_sell_unit text, p_area_unit text, p_stock_status text, p_active boolean,
  p_price_paise bigint default null, p_change_price boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_area    text := p_area_unit;
  v_old     public.catalogue_items;
  m         public.catalogue_items;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_item_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'materials');
  if p_change_price then
    if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
      perform app.catalogue_error('deny');
    end if;
    perform app.require_aal2();
  end if;
  if char_length(v_name) not between 1 and 120 or not app.text_is_clean(v_name) or p_sell_unit is null or p_stock_status is null or p_active is null or p_change_price is null
     or (p_price_paise is not null and p_price_paise not between 100 and 100000000)
     or not exists (select 1 from packs.units u where u.code = p_sell_unit) or p_sell_unit = 'set'
     or (v_area is not null and v_area not in ('sq_ft', 'sq_m')) then
    perform app.catalogue_error('invalid');
  end if;
  if p_sell_unit in ('sq_ft', 'sq_m') then
    if v_area is not null and v_area <> p_sell_unit then
      perform app.catalogue_error('invalid');
    end if;
    v_area := p_sell_unit;
  end if;
  select * into v_old from public.catalogue_items x where x.id = p_item_id for update;
  if found and (v_old.tenant_id <> p_tenant_id or v_old.item_kind <> 'material') then
    perform app.catalogue_error('conflict');
  end if;
  if not found then
    v_created := true;
    begin
      insert into public.catalogue_items (id, tenant_id, name, item_kind, sell_unit, area_unit, stock_status, active, created_by, price_paise)
      values (p_item_id, p_tenant_id, v_name, 'material', p_sell_unit, v_area, p_stock_status, false, v_uid, case when p_change_price then p_price_paise else null end)
      returning * into m;
    exception when check_violation then
      perform app.catalogue_error('invalid');
    end;
    if p_active then
      perform app.catalogue_error('needs_photo');
    end if;
  else
    if p_active and not exists (select 1 from public.catalogue_photos p where p.tenant_id = p_tenant_id and p.item_id = p_item_id and p.removed_at is null) then
      perform app.catalogue_error('needs_photo');
    end if;
    begin
      update public.catalogue_items
         set name = v_name, sell_unit = p_sell_unit, area_unit = v_area, stock_status = p_stock_status, active = p_active, updated_by = v_uid, updated_at = now(),
             price_paise = case when p_change_price then p_price_paise else price_paise end
       where id = p_item_id returning * into m;
    exception when check_violation then
      perform app.catalogue_error('invalid');
    end;
  end if;
  return jsonb_build_object('id', m.id, 'active', m.active, 'created', v_created);
end;
$$;
revoke all on function public.catalogue_material_save(uuid, uuid, text, text, text, text, boolean, bigint, boolean) from public, anon;
grant execute on function public.catalogue_material_save(uuid, uuid, text, text, text, text, boolean, bigint, boolean) to authenticated;

-- The deterministic search, now with a kind filter (null = both kinds, as before). The saree filters are ignored for a material (it has none of those columns).
drop function public.catalogue_search(uuid, text, text[], text[], text[], boolean, boolean, integer, integer, text, uuid);
create function public.catalogue_search(
  p_tenant_id uuid, p_fabric text default null, p_colours text[] default null, p_occasions text[] default null, p_price_bands text[] default null,
  p_in_stock_only boolean default false, p_include_inactive boolean default false, p_limit integer default 20,
  p_after_rank integer default null, p_after_name text default null, p_after_id uuid default null, p_item_kind text default null
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_inactive boolean;
  v_out      jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.catalogue_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 50 or p_in_stock_only is null or p_include_inactive is null
     or (p_fabric is not null and p_fabric not in ('kanchi_pattu', 'dharmavaram_silk', 'soft_silk', 'cotton_silk', 'banarasi', 'mysore_silk', 'uppada', 'pure_cotton', 'georgette', 'other'))
     or (p_colours is not null and cardinality(p_colours) > 17) or (p_occasions is not null and cardinality(p_occasions) > 4) or (p_price_bands is not null and cardinality(p_price_bands) > 5)
     or (p_item_kind is not null and p_item_kind not in ('saree', 'material'))
     or ((p_after_rank is null) <> (p_after_name is null)) or ((p_after_rank is null) <> (p_after_id is null)) then
    perform app.catalogue_error('invalid');
  end if;
  v_inactive := p_include_inactive and app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  select coalesce(jsonb_agg(app.catalogue_item_json(z.m) || jsonb_build_object('rank', z.rank) order by z.rank, z.name, z.id), '[]'::jsonb) into v_out
    from (
      select x as m, x.name, x.id,
             case x.stock_status when 'in_stock' then 0 when 'few_left' then 1 else 2 end as rank
        from public.catalogue_items x
       where x.tenant_id = p_tenant_id
         and (v_inactive or (x.active and exists (select 1 from public.catalogue_photos p where p.tenant_id = x.tenant_id and p.item_id = x.id and p.removed_at is null)))
         and (p_item_kind is null or x.item_kind = p_item_kind)
         and (p_fabric is null or x.fabric = p_fabric)
         and (p_colours is null or cardinality(p_colours) = 0 or x.colours && p_colours)
         and (p_occasions is null or cardinality(p_occasions) = 0 or x.occasions && p_occasions)
         and (p_price_bands is null or cardinality(p_price_bands) = 0 or x.price_band = any (p_price_bands))
         and (not p_in_stock_only or x.stock_status in ('in_stock', 'few_left'))
         and (p_after_rank is null or (case x.stock_status when 'in_stock' then 0 when 'few_left' then 1 else 2 end, x.name, x.id) > (p_after_rank, p_after_name, p_after_id))
       order by case x.stock_status when 'in_stock' then 0 when 'few_left' then 1 else 2 end, x.name, x.id
       limit p_limit
    ) z;
  return v_out;
end;
$$;
revoke all on function public.catalogue_search(uuid, text, text[], text[], text[], boolean, boolean, integer, integer, text, uuid, text) from public, anon;
grant execute on function public.catalogue_search(uuid, text, text[], text[], text[], boolean, boolean, integer, integer, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. customer sites
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.site_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for another site' using errcode = '23505';
    when 'contact'   then raise exception 'the site contact is not in this business' using errcode = 'SM751';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.site_error(text) from public;

create table public.customer_sites (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  company_id      uuid not null,
  name            text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name) and not app.text_has_contact(name)),
  address_line    text check (char_length(address_line) between 1 and 300 and app.text_is_clean(address_line) and not app.text_has_contact(address_line)),
  city            text check (char_length(city) between 1 and 80 and app.text_is_clean(city)),
  pin             text check (pin ~ '^[1-9][0-9]{5}$'),
  map_lat         numeric(9, 6) check (map_lat between -90 and 90),
  map_lng         numeric(9, 6) check (map_lng between -180 and 180),
  distance_km     integer check (distance_km between 0 and 5000),
  lane_width_ft   smallint check (lane_width_ft between 1 and 100),
  night_delivery  boolean not null default false,
  unloading_help  boolean not null default false,
  access_notes    text check (char_length(access_notes) between 1 and 500 and app.text_is_clean(access_notes) and not app.text_has_contact(access_notes)),
  site_contact_id uuid,
  active          boolean not null default true,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, site_contact_id) references public.contacts (tenant_id, id)
);
-- (a map pin is both numbers or neither: site_save checks it; the table does not, because an erasure nulls the two columns one after the other)
create index customer_sites_company_idx on public.customer_sites (tenant_id, company_id, active, name);
create index customer_sites_contact_idx on public.customer_sites (tenant_id, site_contact_id) where site_contact_id is not null;
create index customer_sites_keyset_idx  on public.customer_sites (tenant_id, created_at desc, id);
comment on column public.customer_sites.name is 'PII: what the business calls the site; it can name a person ("Ravi''s house"). Audited by name only; anonymised by the erasure scopes';
comment on column public.customer_sites.address_line is 'PII: the street address of a site, which can be a person''s home; phone numbers and e-mail addresses are refused. Audited by name only; anonymised by the erasure scopes';
comment on column public.customer_sites.city is 'PII: the city of a site (a location can identify a person). Audited by name only; nulled by the erasure scopes';
comment on column public.customer_sites.pin is 'SAFE: a six-digit postal area code (thousands of addresses share one). CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.customer_sites.map_lat is 'PII: the latitude of a map pin, precise enough to find a house. Audited by name only; nulled by the erasure scopes';
comment on column public.customer_sites.map_lng is 'PII: the longitude of a map pin, precise enough to find a house. Audited by name only; nulled by the erasure scopes';
comment on column public.customer_sites.access_notes is 'PII: how a truck gets in (lane, gate, unloading help); free text that can describe a home; phone numbers are refused. Audited by name only; anonymised by the erasure scopes';

create trigger customer_sites_forbid_tenant_id_change before update on public.customer_sites for each row execute function app.forbid_tenant_id_change();
create trigger customer_sites_set_updated_at before update on public.customer_sites for each row execute function app.set_updated_at();
create trigger module_guard before insert on public.customer_sites for each row execute function app.module_guard('sites');
create trigger audit_customer_sites after insert or update or delete on public.customer_sites
  for each row execute function app.audit_row_change('customer_site', 'name,address_line,city,map_lat,map_lng,access_notes');

-- a site is never deleted (a delivery may point at it): it is made inactive
create function app.customer_sites_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'sites are never deleted: make them inactive' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at or new.id is distinct from old.id then
    raise exception 'a site keeps its id, its author and its creation time' using errcode = '42501';  -- (the customer never changes: site_save refuses it)
  end if;
  return new;
end;
$$;
revoke all on function app.customer_sites_guard() from public;
create trigger customer_sites_guard before update or delete on public.customer_sites for each row execute function app.customer_sites_guard();
create trigger customer_sites_no_truncate before truncate on public.customer_sites for each statement execute function app.customer_sites_guard();

alter table public.customer_sites enable row level security;
alter table public.customer_sites force row level security;
revoke all on public.customer_sites from public, anon, authenticated, service_role;
grant select on public.customer_sites to authenticated;
create policy customer_sites_select on public.customer_sites for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));

create function app.site_json(s public.customer_sites) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'company_id', s.company_id, 'name', s.name, 'address_line', s.address_line, 'city', s.city, 'pin', s.pin, 'map_lat', s.map_lat, 'map_lng', s.map_lng,
    'distance_km', s.distance_km, 'lane_width_ft', s.lane_width_ft, 'night_delivery', s.night_delivery, 'unloading_help', s.unloading_help, 'access_notes', s.access_notes,
    'site_contact_id', s.site_contact_id, 'active', s.active, 'created_at', s.created_at, 'updated_at', s.updated_at)
$$;
revoke all on function app.site_json(public.customer_sites) from public;

-- Create or change a site (Owner, Admin, Sales; the sites module must be on). The caller's id makes a retry safe; the customer never changes. An exact repeat replays.
create function public.site_save(
  p_site_id uuid, p_tenant_id uuid, p_company_id uuid, p_name text, p_address_line text, p_city text, p_pin text, p_map_lat numeric, p_map_lng numeric,
  p_distance_km integer, p_lane_width_ft integer, p_night_delivery boolean, p_unloading_help boolean, p_access_notes text, p_site_contact_id uuid, p_active boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_addr    text := nullif(btrim(coalesce(p_address_line, '')), '');
  v_city    text := nullif(btrim(coalesce(p_city, '')), '');
  v_pin     text := nullif(btrim(coalesce(p_pin, '')), '');
  v_notes   text := nullif(btrim(coalesce(p_access_notes, '')), '');
  v_old     public.customer_sites;
  s         public.customer_sites;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_site_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.site_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'sites');
  if p_company_id is null or p_night_delivery is null or p_unloading_help is null or p_active is null or char_length(v_name) not between 1 and 120 or (p_map_lat is null) <> (p_map_lng is null) then
    perform app.site_error('invalid');
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company_id and c.tenant_id = p_tenant_id and c.erased_at is null) then
    perform app.site_error('reference');
  end if;
  if p_site_contact_id is not null and not exists (select 1 from public.contacts k where k.id = p_site_contact_id and k.tenant_id = p_tenant_id and k.erased_at is null) then
    perform app.site_error('contact');
  end if;
  select * into v_old from public.customer_sites x where x.id = p_site_id for update;
  if found and (v_old.tenant_id <> p_tenant_id or v_old.company_id <> p_company_id) then
    perform app.site_error('conflict');
  end if;
  begin
    if not found then
      v_created := true;
      insert into public.customer_sites (id, tenant_id, company_id, name, address_line, city, pin, map_lat, map_lng, distance_km, lane_width_ft, night_delivery, unloading_help, access_notes,
                                         site_contact_id, active, created_by)
      values (p_site_id, p_tenant_id, p_company_id, v_name, v_addr, v_city, v_pin, p_map_lat, p_map_lng, p_distance_km, p_lane_width_ft, p_night_delivery, p_unloading_help, v_notes,
              p_site_contact_id, p_active, v_uid)
      returning * into s;
    else
      update public.customer_sites
         set name = v_name, address_line = v_addr, city = v_city, pin = v_pin, map_lat = p_map_lat, map_lng = p_map_lng, distance_km = p_distance_km, lane_width_ft = p_lane_width_ft,
             night_delivery = p_night_delivery, unloading_help = p_unloading_help, access_notes = v_notes, site_contact_id = p_site_contact_id, active = p_active, updated_by = v_uid
       where id = p_site_id returning * into s;
    end if;
  exception when check_violation then
    perform app.site_error('invalid');
  end;
  return app.site_json(s) || jsonb_build_object('created', v_created);
end;
$$;
revoke all on function public.site_save(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, integer, boolean, boolean, text, uuid, boolean) from public, anon;
grant execute on function public.site_save(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, integer, boolean, boolean, text, uuid, boolean) to authenticated;

create function public.site_get(p_tenant_id uuid, p_site_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.customer_sites;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.site_error('deny');
  end if;
  select * into s from public.customer_sites x where x.tenant_id = p_tenant_id and x.id = p_site_id;
  if not found then
    perform app.site_error('reference');
  end if;
  return app.site_json(s);
end;
$$;
revoke all on function public.site_get(uuid, uuid) from public, anon;
grant execute on function public.site_get(uuid, uuid) to authenticated;

-- The sites of a business, or of one customer; newest first, paged by the opaque position (created_at, id). Inactive sites only when asked.
create function public.sites_list(
  p_tenant_id uuid, p_company_id uuid default null, p_include_inactive boolean default false, p_limit integer default 50, p_after_created timestamptz default null, p_after_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.site_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_include_inactive is null or ((p_after_created is null) <> (p_after_id is null)) then
    perform app.site_error('invalid');
  end if;
  select coalesce(jsonb_agg(app.site_json(z.s) order by z.created_at desc, z.id desc), '[]'::jsonb) into v_out
    from (select x as s, x.created_at, x.id
            from public.customer_sites x
           where x.tenant_id = p_tenant_id
             and (p_company_id is null or x.company_id = p_company_id)
             and (p_include_inactive or x.active)
             and (p_after_created is null or (x.created_at, x.id) < (p_after_created, p_after_id))
           order by x.created_at desc, x.id desc
           limit p_limit) z;
  return v_out;
end;
$$;
revoke all on function public.sites_list(uuid, uuid, boolean, integer, timestamptz, uuid) from public, anon;
grant execute on function public.sites_list(uuid, uuid, boolean, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. erasure: the PII columns of a site (the registry is what makes "a PII column nobody handled" a failing build)
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('customer_sites', 'name',         'tenant', 'tombstone', 'erased:1', null),
  ('customer_sites', 'address_line', 'tenant', 'null',      'erased:1', null),
  ('customer_sites', 'city',         'tenant', 'null',      'erased:1', null),
  ('customer_sites', 'map_lat',      'tenant', 'null',      'erased:1', null),
  ('customer_sites', 'map_lng',      'tenant', 'null',      'erased:1', null),
  ('customer_sites', 'access_notes', 'tenant', 'null',      'erased:1', null),
  ('customer_sites', 'name',         'sweep',  'substring', 'erased:1', null),
  ('customer_sites', 'address_line', 'sweep',  'substring', 'erased:1', null),
  ('customer_sites', 'city',         'sweep',  'substring', 'erased:1', null),
  ('customer_sites', 'access_notes', 'sweep',  'substring', 'erased:1', null),
  ('customer_sites', 'name',         'company', 'tombstone', 'erased:1', null),
  ('customer_sites', 'address_line', 'company', 'null',      'erased:1', null),
  ('customer_sites', 'city',         'company', 'null',      'erased:1', null),
  ('customer_sites', 'map_lat',      'company', 'null',      'erased:1', null),
  ('customer_sites', 'map_lng',      'company', 'null',      'erased:1', null),
  ('customer_sites', 'access_notes', 'company', 'null',      'erased:1', null);
