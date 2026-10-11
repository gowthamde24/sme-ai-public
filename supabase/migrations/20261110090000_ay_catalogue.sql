-- Job AY (ADR 0069): the saree CATALOGUE: items with 1 to 8 photos, a deterministic search, and private per-business photo storage in the LOCAL Supabase Storage. A new migration; earlier files are not edited.
--
--   public.catalogue_items    a saree (or a lot): name, fabric, colours, zari, border, occasions, a PRICE BAND (an exact price only when the Owner sets one), stock status, active flag.
--   public.catalogue_photos   1 to 8 live photos per item. A row is a REFERENCE (bucket, path, thumbnail path, size); the bytes are in Storage, never in a row. A removed photo stays as a row (a sent message may
--                             point at it); it just no longer counts or shows.
--   storage bucket cat-<business id>   private, 5 MB, jpeg/png/webp. Created on first use by catalogue_ensure_bucket. The API resizes every upload (WhatsApp-friendly size + a thumbnail) and strips EXIF / location
--                             data BEFORE it is stored; the paths are derived by the database from the ids (a client never names a path); signed URLs are short-lived.
--   public.catalogue_search   the deterministic matching the agent's find_catalogue_items tool calls (fabric, colour, occasion, price band, in stock). No model, no vision.
--
-- Who: every member of the business reads (the catalogue is what the shop shows a customer); Owner and Admin edit; the EXACT price is the Owner's alone and needs a second factor (the agent never sets or
-- changes a price). Nobody writes a table directly; every write is a SECURITY DEFINER function that proves the role first.
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 unknown / foreign reference, 23505 id reused for another item, SM521 an item needs a photo before it can be active (or: its last photo cannot be removed while active),
--            SM522 an item has 8 photos already, SM523 the photo's files are not in storage (upload first).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. errors, the bucket name, and the storage rules
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.catalogue_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'    then raise exception 'invalid input' using errcode = '22023';
    when 'reference'  then raise exception 'not found' using errcode = '23503';
    when 'conflict'   then raise exception 'id already used for another item' using errcode = '23505';
    when 'needs_photo' then raise exception 'an active item needs a photo' using errcode = 'SM521';
    when 'too_many'   then raise exception 'an item has at most 8 photos' using errcode = 'SM522';
    when 'no_file'    then raise exception 'the photo is not in storage' using errcode = 'SM523';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.catalogue_error(text) from public;

-- the private bucket of one business, and the way back from a bucket name to the business (null for any other bucket)
create function app.catalogue_bucket(p_tenant uuid) returns text
language sql
immutable
set search_path = ''
as $$ select 'cat-' || p_tenant::text $$;
revoke all on function app.catalogue_bucket(uuid) from public;

create function app.catalogue_bucket_tenant(p_bucket text) returns uuid
language sql
immutable
set search_path = ''
as $$ select case when p_bucket ~ '^cat-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_bucket, 5)::uuid else null end $$;
revoke all on function app.catalogue_bucket_tenant(text) from public;
-- the storage rules below are evaluated as the signed-in caller, who must be able to run this one
grant execute on function app.catalogue_bucket_tenant(text) to authenticated;

-- Storage rules (row-level security on storage.objects): a member of the business reads its bucket (that is what lets the API sign a URL in the caller's name); Owner and Admin add and remove
-- objects there. Nothing else exists: no public read, no other bucket is touched.
create policy catalogue_objects_select on storage.objects for select to authenticated
  using (app.catalogue_bucket_tenant(bucket_id) is not null and app.is_tenant_member(app.catalogue_bucket_tenant(bucket_id)));
create policy catalogue_objects_insert on storage.objects for insert to authenticated
  with check (app.catalogue_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.catalogue_bucket_tenant(bucket_id), array['owner', 'admin']::public.app_role[]));
create policy catalogue_objects_delete on storage.objects for delete to authenticated
  using (app.catalogue_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.catalogue_bucket_tenant(bucket_id), array['owner', 'admin']::public.app_role[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.catalogue_items (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  name         text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  fabric       text not null check (fabric in ('kanchi_pattu', 'dharmavaram_silk', 'soft_silk', 'cotton_silk', 'banarasi', 'mysore_silk', 'uppada', 'pure_cotton', 'georgette', 'other')),
  colours      text[] not null check (cardinality(colours) between 1 and 4
                 and colours <@ array['red', 'maroon', 'pink', 'orange', 'yellow', 'green', 'blue', 'navy', 'purple', 'black', 'white', 'cream', 'gold', 'silver', 'brown', 'grey', 'multi']::text[]),
  zari         text not null default 'none' check (zari in ('none', 'light', 'rich')),
  border       text check (char_length(border) between 1 and 120 and app.text_is_clean(border)),
  occasions    text[] not null default '{}' check (cardinality(occasions) <= 4 and occasions <@ array['wedding', 'festival', 'daily', 'party']::text[]),
  price_band   text not null check (price_band in ('under_5k', '5k_10k', '10k_25k', '25k_50k', 'above_50k')),
  -- set by the Owner only (second factor); null = "ask us": the band is all a customer is shown
  price_paise  bigint check (price_paise between 100 and 100000000),
  stock_status text not null default 'in_stock' check (stock_status in ('in_stock', 'few_left', 'made_to_order')),
  active       boolean not null default false,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create index catalogue_items_tenant_idx on public.catalogue_items (tenant_id, active, fabric);
comment on column public.catalogue_items.name is 'SAFE: the name of a saree in the business''s own catalogue; no personal data.';
comment on column public.catalogue_items.border is 'SAFE: a short description of a saree''s border; no personal data.';
comment on column public.catalogue_items.fabric is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.catalogue_items.colours is 'SAFE: closed words. CLEAN-EXEMPT: subset of a closed list';
comment on column public.catalogue_items.zari is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.catalogue_items.occasions is 'SAFE: closed words. CLEAN-EXEMPT: subset of a closed list';
comment on column public.catalogue_items.price_band is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.catalogue_items.stock_status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.catalogue_photos (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  item_id      uuid not null,
  -- 1 to 8 while live; reordering passes through 9 to 16 for a moment
  position     smallint not null check (position between 1 and 16),
  bucket       text not null check (bucket = app.catalogue_bucket(tenant_id)),
  path         text not null check (path = item_id::text || '/' || id::text || '.jpg'),
  thumb_path   text not null check (thumb_path = item_id::text || '/' || id::text || '_t.jpg'),
  content_type text not null default 'image/jpeg' check (content_type = 'image/jpeg'),
  width        integer not null check (width between 16 and 4096),
  height       integer not null check (height between 16 and 4096),
  bytes        integer not null check (bytes between 1 and 5242880),
  thumb_bytes  integer not null check (thumb_bytes between 1 and 5242880),
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  removed_at   timestamptz,
  removed_by   uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references public.catalogue_items (tenant_id, id),
  check ((removed_at is null) = (removed_by is null))
);
create unique index catalogue_photos_position_key on public.catalogue_photos (tenant_id, item_id, position) where removed_at is null;
create index catalogue_photos_item_idx on public.catalogue_photos (tenant_id, item_id, position);
comment on column public.catalogue_photos.bucket is 'SAFE: the storage bucket name of the business. CLEAN-EXEMPT: pinned by CHECK to the business id';
comment on column public.catalogue_photos.path is 'SAFE: a storage path made of two ids. CLEAN-EXEMPT: pinned by CHECK to the item and photo ids';
comment on column public.catalogue_photos.thumb_path is 'SAFE: a storage path made of two ids. CLEAN-EXEMPT: pinned by CHECK to the item and photo ids';
comment on column public.catalogue_photos.content_type is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create trigger catalogue_items_forbid_tenant_id_change before update on public.catalogue_items for each row execute function app.forbid_tenant_id_change();
create trigger catalogue_items_set_updated_at before update on public.catalogue_items for each row execute function app.set_updated_at();
create trigger catalogue_photos_forbid_tenant_id_change before update on public.catalogue_photos for each row execute function app.forbid_tenant_id_change();
create trigger audit_catalogue_items after insert or update or delete on public.catalogue_items for each row execute function app.audit_row_change('catalogue_item');
create trigger audit_catalogue_photos after insert or update or delete on public.catalogue_photos for each row execute function app.audit_row_change('catalogue_photo');

-- nothing is ever deleted; a photo changes only its position and its removal mark
create function app.catalogue_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'catalogue rows are never deleted' using errcode = '42501';
end;
$$;
revoke all on function app.catalogue_forbid_delete() from public;
create trigger catalogue_items_no_delete before delete on public.catalogue_items for each row execute function app.catalogue_forbid_delete();
create trigger catalogue_items_no_truncate before truncate on public.catalogue_items for each statement execute function app.catalogue_forbid_delete();
create trigger catalogue_photos_no_delete before delete on public.catalogue_photos for each row execute function app.catalogue_forbid_delete();
create trigger catalogue_photos_no_truncate before truncate on public.catalogue_photos for each statement execute function app.catalogue_forbid_delete();

create function app.catalogue_photos_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'position' - 'removed_at' - 'removed_by') is distinct from (to_jsonb(old) - 'position' - 'removed_at' - 'removed_by') then
    raise exception 'a photo record changes only its place and its removal' using errcode = '42501';
  end if;
  if old.removed_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a removed photo stays removed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.catalogue_photos_guard_update() from public;
create trigger catalogue_photos_guard_update before update on public.catalogue_photos for each row execute function app.catalogue_photos_guard_update();

create function app.catalogue_items_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'catalogue items are immutable except for their details' using errcode = '42501';
  end if;
  -- an item is active only with a live photo (the rule is also held by the functions; this is the belt)
  if new.active and not exists (select 1 from public.catalogue_photos p where p.tenant_id = new.tenant_id and p.item_id = new.id and p.removed_at is null) then
    raise exception 'an active item needs a photo' using errcode = 'SM521';
  end if;
  return new;
end;
$$;
revoke all on function app.catalogue_items_guard_update() from public;
create trigger catalogue_items_guard_update before update on public.catalogue_items for each row execute function app.catalogue_items_guard_update();

create function app.catalogue_items_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active then
    raise exception 'a new item starts inactive: it needs a photo first' using errcode = 'SM521';
  end if;
  return new;
end;
$$;
revoke all on function app.catalogue_items_guard_insert() from public;
create trigger catalogue_items_guard_insert before insert on public.catalogue_items for each row execute function app.catalogue_items_guard_insert();

-- Row-level security: every member reads; nobody writes directly
do $$
declare t text;
begin
  foreach t in array array['catalogue_items', 'catalogue_photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the functions
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the private bucket of the business (Owner, Admin). Idempotent. 5 MB, the three image types the product accepts.
create function public.catalogue_ensure_bucket(p_tenant_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text := app.catalogue_bucket(p_tenant_id);
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (v_bucket, v_bucket, false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
  return v_bucket;
end;
$$;
revoke all on function public.catalogue_ensure_bucket(uuid) from public, anon;
grant execute on function public.catalogue_ensure_bucket(uuid) to authenticated;

-- Create or change an item (the caller's id makes a retry safe). Owner or Admin. `p_change_price` says the exact price in `p_price_paise` (null clears it) is to be applied: that is the Owner's alone and
-- needs a second factor. An item can be made active only while it has a live photo.
create function public.catalogue_item_save(
  p_item_id uuid, p_tenant_id uuid, p_name text, p_fabric text, p_colours text[], p_zari text, p_border text, p_occasions text[], p_price_band text,
  p_stock_status text, p_active boolean, p_price_paise bigint default null, p_change_price boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_border  text := nullif(btrim(coalesce(p_border, '')), '');
  v_colours text[];
  v_occ     text[];
  v_old     public.catalogue_items;
  m         public.catalogue_items;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_item_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  if p_change_price then
    if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
      perform app.catalogue_error('deny');
    end if;
    perform app.require_aal2();
  end if;
  if char_length(v_name) not between 1 and 120 or not app.text_is_clean(v_name)
     or (v_border is not null and (char_length(v_border) > 120 or not app.text_is_clean(v_border)))
     or p_fabric is null or p_zari is null or p_price_band is null or p_stock_status is null or p_active is null or p_colours is null or p_occasions is null
     or p_change_price is null or (p_price_paise is not null and p_price_paise not between 100 and 100000000) then
    perform app.catalogue_error('invalid');
  end if;
  select coalesce(array_agg(distinct c order by c), '{}') into v_colours from unnest(p_colours) c;
  select coalesce(array_agg(distinct o order by o), '{}') into v_occ from unnest(p_occasions) o;
  select * into v_old from public.catalogue_items x where x.id = p_item_id for update;
  if found and v_old.tenant_id <> p_tenant_id then
    perform app.catalogue_error('conflict');
  end if;
  if not found then
    v_created := true;
    -- fabric, colours, zari, band, stock and occasions are checked by the table (22023 / 23514 are classified as invalid by the API)
    begin
      insert into public.catalogue_items (id, tenant_id, name, fabric, colours, zari, border, occasions, price_band, stock_status, active, created_by, price_paise)
      values (p_item_id, p_tenant_id, v_name, p_fabric, v_colours, p_zari, v_border, v_occ, p_price_band, p_stock_status, false, v_uid, case when p_change_price then p_price_paise else null end)
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
         set name = v_name, fabric = p_fabric, colours = v_colours, zari = p_zari, border = v_border, occasions = v_occ, price_band = p_price_band,
             stock_status = p_stock_status, active = p_active, updated_by = v_uid, updated_at = now(),
             price_paise = case when p_change_price then p_price_paise else price_paise end
       where id = p_item_id returning * into m;
    exception when check_violation then
      perform app.catalogue_error('invalid');
    end;
  end if;
  return jsonb_build_object('id', m.id, 'active', m.active, 'created', v_created);
end;
$$;
revoke all on function public.catalogue_item_save(uuid, uuid, text, text, text[], text, text, text[], text, text, boolean, bigint, boolean) from public, anon;
grant execute on function public.catalogue_item_save(uuid, uuid, text, text, text[], text, text, text[], text, text, boolean, bigint, boolean) to authenticated;

-- Register a photo whose two files (the resized photo and its thumbnail) the API has already put in storage. The paths are derived here from the ids; the files must exist in this business's bucket as
-- jpeg. At most 8 live photos per item (the item row is locked, so two uploads cannot both take the eighth place). An exact retry replays.
create function public.catalogue_photo_add(
  p_photo_id uuid, p_tenant_id uuid, p_item_id uuid, p_width integer, p_height integer, p_bytes integer, p_thumb_bytes integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_bucket text := app.catalogue_bucket(p_tenant_id);
  v_path   text;
  v_thumb  text;
  v_item   public.catalogue_items;
  v_old    public.catalogue_photos;
  v_pos    smallint;
  p        public.catalogue_photos;
begin
  if v_uid is null or p_tenant_id is null or p_photo_id is null or p_item_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  if p_width is null or p_height is null or p_bytes is null or p_thumb_bytes is null then
    perform app.catalogue_error('invalid');
  end if;
  select * into v_item from public.catalogue_items x where x.id = p_item_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.catalogue_error('reference');
  end if;
  select * into v_old from public.catalogue_photos x where x.id = p_photo_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.item_id <> p_item_id then
      perform app.catalogue_error('conflict');
    end if;
    return jsonb_build_object('id', v_old.id, 'position', v_old.position, 'replayed', true);
  end if;
  v_path := p_item_id::text || '/' || p_photo_id::text || '.jpg';
  v_thumb := p_item_id::text || '/' || p_photo_id::text || '_t.jpg';
  if (select count(*) from storage.objects o where o.bucket_id = v_bucket and o.name in (v_path, v_thumb) and o.metadata ->> 'mimetype' = 'image/jpeg') <> 2 then
    perform app.catalogue_error('no_file');
  end if;
  select coalesce(max(x.position), 0) + 1 into v_pos from public.catalogue_photos x where x.tenant_id = p_tenant_id and x.item_id = p_item_id and x.removed_at is null;
  if (select count(*) from public.catalogue_photos x where x.tenant_id = p_tenant_id and x.item_id = p_item_id and x.removed_at is null) >= 8 then
    perform app.catalogue_error('too_many');
  end if;
  begin
    insert into public.catalogue_photos (id, tenant_id, item_id, position, bucket, path, thumb_path, width, height, bytes, thumb_bytes, created_by)
    values (p_photo_id, p_tenant_id, p_item_id, v_pos, v_bucket, v_path, v_thumb, p_width, p_height, p_bytes, p_thumb_bytes, v_uid)
    returning * into p;
  exception when check_violation then
    perform app.catalogue_error('invalid');
  end;
  return jsonb_build_object('id', p.id, 'position', p.position, 'replayed', false);
end;
$$;
revoke all on function public.catalogue_photo_add(uuid, uuid, uuid, integer, integer, integer, integer) from public, anon;
grant execute on function public.catalogue_photo_add(uuid, uuid, uuid, integer, integer, integer, integer) to authenticated;

-- Remove a photo from its item (Owner, Admin). The record stays (a sent message may refer to it). An ACTIVE item keeps at least one photo: remove the last only after making the item inactive.
create function public.catalogue_photo_remove(p_tenant_id uuid, p_photo_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  p      public.catalogue_photos;
  v_item public.catalogue_items;
begin
  if v_uid is null or p_tenant_id is null or p_photo_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  select * into p from public.catalogue_photos x where x.id = p_photo_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.catalogue_error('reference');
  end if;
  select * into v_item from public.catalogue_items x where x.id = p.item_id and x.tenant_id = p_tenant_id for update;
  select * into p from public.catalogue_photos x where x.id = p_photo_id for update;
  if p.removed_at is not null then
    return jsonb_build_object('id', p.id, 'item_id', p.item_id, 'replayed', true);
  end if;
  if v_item.active and (select count(*) from public.catalogue_photos x where x.tenant_id = p_tenant_id and x.item_id = p.item_id and x.removed_at is null) <= 1 then
    perform app.catalogue_error('needs_photo');
  end if;
  update public.catalogue_photos set removed_at = now(), removed_by = v_uid where id = p.id;
  -- close the gap so the places stay 1..n
  update public.catalogue_photos x set position = y.n
    from (select id, row_number() over (order by position)::smallint as n from public.catalogue_photos
           where tenant_id = p_tenant_id and item_id = p.item_id and removed_at is null) y
   where x.id = y.id and x.position <> y.n;
  return jsonb_build_object('id', p.id, 'item_id', p.item_id, 'replayed', false);
end;
$$;
revoke all on function public.catalogue_photo_remove(uuid, uuid) from public, anon;
grant execute on function public.catalogue_photo_remove(uuid, uuid) to authenticated;

-- Put an item's live photos in the order given (every live photo exactly once). Position 1 is the cover.
create function public.catalogue_photos_reorder(p_tenant_id uuid, p_item_id uuid, p_photo_ids uuid[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_item_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  if p_photo_ids is null or cardinality(p_photo_ids) not between 1 and 8 then
    perform app.catalogue_error('invalid');
  end if;
  perform 1 from public.catalogue_items x where x.id = p_item_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.catalogue_error('reference');
  end if;
  if (select array_agg(id order by id) from public.catalogue_photos where tenant_id = p_tenant_id and item_id = p_item_id and removed_at is null)
     is distinct from (select array_agg(i order by i) from unnest(p_photo_ids) i) then
    perform app.catalogue_error('invalid');
  end if;
  -- two steps, because a place is unique among the live photos
  update public.catalogue_photos set position = position + 8 where tenant_id = p_tenant_id and item_id = p_item_id and removed_at is null;
  update public.catalogue_photos x set position = o.n::smallint
    from unnest(p_photo_ids) with ordinality as o(id, n)
   where x.id = o.id and x.tenant_id = p_tenant_id;
  return jsonb_build_object('item_id', p_item_id, 'photo_ids', to_jsonb(p_photo_ids));
end;
$$;
revoke all on function public.catalogue_photos_reorder(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.catalogue_photos_reorder(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. reads (SECURITY INVOKER: row-level security shows every member this business's items)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.catalogue_item_json(m public.catalogue_items) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'name', m.name, 'fabric', m.fabric, 'colours', to_jsonb(m.colours), 'zari', m.zari, 'border', m.border, 'occasions', to_jsonb(m.occasions),
    'price_band', m.price_band, 'price_paise', m.price_paise, 'stock_status', m.stock_status, 'active', m.active,
    'created_at', m.created_at, 'updated_at', m.updated_at,
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'bucket', p.bucket, 'path', p.path, 'thumb_path', p.thumb_path,
                                                            'width', p.width, 'height', p.height, 'bytes', p.bytes) order by p.position)
                          from public.catalogue_photos p where p.tenant_id = m.tenant_id and p.item_id = m.id and p.removed_at is null), '[]'::jsonb))
$$;
revoke all on function app.catalogue_item_json(public.catalogue_items) from public;
-- the reads below are SECURITY INVOKER (the caller's own rights), so the caller must be able to run the two helpers they use: one formats a row, the other only raises
grant execute on function app.catalogue_item_json(public.catalogue_items) to authenticated;
grant execute on function app.catalogue_error(text) to authenticated;

create function public.catalogue_get(p_tenant_id uuid, p_item_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.catalogue_items;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.catalogue_error('deny');
  end if;
  select * into m from public.catalogue_items x where x.tenant_id = p_tenant_id and x.id = p_item_id;
  if not found then
    perform app.catalogue_error('reference');
  end if;
  return app.catalogue_item_json(m);
end;
$$;
revoke all on function public.catalogue_get(uuid, uuid) from public, anon;
grant execute on function public.catalogue_get(uuid, uuid) to authenticated;

-- The deterministic search. Every filter is optional; an item matches when it has the fabric, ANY of the given colours, ANY of the given occasions, one of the given price bands, and (if asked) is in
-- stock or has few left (made to order is not "in stock"). Only active items with a live photo are shown, except that an Owner or Admin can ask for the inactive ones too. The order is fixed:
-- in stock, few left, made to order; then name, then id. Paged by an opaque position (rank, name, id).
create function public.catalogue_search(
  p_tenant_id uuid, p_fabric text default null, p_colours text[] default null, p_occasions text[] default null, p_price_bands text[] default null,
  p_in_stock_only boolean default false, p_include_inactive boolean default false, p_limit integer default 20,
  p_after_rank integer default null, p_after_name text default null, p_after_id uuid default null
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
revoke all on function public.catalogue_search(uuid, text, text[], text[], text[], boolean, boolean, integer, integer, text, uuid) from public, anon;
grant execute on function public.catalogue_search(uuid, text, text[], text[], text[], boolean, boolean, integer, integer, text, uuid) to authenticated;
