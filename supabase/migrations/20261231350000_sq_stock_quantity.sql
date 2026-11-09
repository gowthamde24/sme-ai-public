-- sq: an optional stock COUNT per catalogue item (owner, 6 Nov 2026: "Add an optional quantity per catalogue item. Low stock uses the quantity when set ("2 left"), otherwise the 'few left'
-- status. Let the owner update it from the assistant, always with a confirm card." The assistant's write tools always show the plan card first: PUT /catalogue/items/{id}/quantity is one).
-- Low means 3 or fewer when a count is set.

alter table public.catalogue_items add column quantity integer check (quantity is null or quantity between 0 and 1000000);
comment on column public.catalogue_items.quantity is 'SAFE: how many are in stock (optional; null = not counted, the stock status says it). CLEAN-EXEMPT: range CHECK';

create or replace function app.catalogue_item_json(m public.catalogue_items) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'name', m.name, 'fabric', m.fabric, 'colours', to_jsonb(m.colours), 'zari', m.zari, 'border', m.border, 'occasions', to_jsonb(m.occasions),
    'price_band', m.price_band, 'price_paise', m.price_paise, 'stock_status', m.stock_status, 'quantity', m.quantity, 'active', m.active,
    'item_kind', m.item_kind, 'sell_unit', m.sell_unit, 'area_unit', m.area_unit,
    'created_at', m.created_at, 'updated_at', m.updated_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'bucket', p.bucket, 'path', p.path, 'thumb_path', p.thumb_path,
                                                            'width', p.width, 'height', p.height, 'bytes', p.bytes) order by p.position)
                          from public.catalogue_photos p where p.tenant_id = m.tenant_id and p.item_id = m.id and p.removed_at is null), '[]'::jsonb))
$$;

-- the count (Owner, Admin): a number, or null to stop counting
create function public.catalogue_quantity_set(p_tenant_id uuid, p_item_id uuid, p_quantity integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.catalogue_items;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_quantity is not null and p_quantity not between 0 and 1000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  update public.catalogue_items x set quantity = p_quantity, updated_by = auth.uid() where x.tenant_id = p_tenant_id and x.id = p_item_id returning * into m;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return app.catalogue_item_json(m);
end;
$$;
revoke all on function public.catalogue_quantity_set(uuid, uuid, integer) from public, anon;
grant execute on function public.catalogue_quantity_set(uuid, uuid, integer) to authenticated;

create or replace function public.catalogue_low_stock(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'stock_status', i.stock_status, 'quantity', i.quantity, 'asked_this_week', (
             select count(distinct p.lead_id) from public.lead_profiles p
              where p.tenant_id = i.tenant_id and greatest(p.created_at, p.updated_at) >= now() - interval '7 days' and p.need is not null
                and exists (select 1 from regexp_split_to_table(lower(i.name), '[^[:alnum:]]+') w where char_length(w) >= 4 and position(w in lower(p.need)) > 0)),
             'asked_is_approximate', true) order by i.quantity nulls last, i.name)
      from public.catalogue_items i
     where i.tenant_id = p_tenant_id and i.active
       and ((i.quantity is not null and i.quantity <= 3) or (i.quantity is null and i.stock_status = 'few_left'))), '[]'::jsonb);
end;
$$;
