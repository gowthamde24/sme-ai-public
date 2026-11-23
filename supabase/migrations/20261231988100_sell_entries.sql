-- "What you sell" for the four styles that are not products (25 Nov 2026; docs/contracts/what-you-sell.md). The web adapter (apps/web/lib/api/what-you-sell.ts, "contract 1.1 part 1") has always called
-- GET /what-you-sell and PUT /what-you-sell/{style}/{id}; the API never had the table behind them. This is that store, kept minimal:
--   public.sell_entries   one row per entry: services, courses, properties or price lists (products stay in the catalogue). `name` is a column; the style's own fields are a closed-key jsonb.
--   public.sell_entry_list / sell_entry_get   any member reads (the table is also readable by members through RLS, like the catalogue)
--   public.sell_entry_put / sell_entry_remove   Owner and Admin write; ONLY the Owner may set or change an amount (a price, a fee, a rate): the same rule as the catalogue's exact price.
--   public.first_run_facts   (replaced) items_count = catalogue items + sell entries not removed.
-- Nothing here holds a person's data: names, places and notes pass app.text_is_clean; amounts are whole paise; removal is soft (removed_at).

create function app.sell_data_keys_ok(p_style text, p_data jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_data is not null
     and jsonb_typeof(p_data) = 'object'
     and pg_column_size(p_data) <= 3000
     and not exists (
       select 1 from jsonb_object_keys(p_data) k
        where k <> all (case p_style
          when 'services'   then array['minutes', 'price_paise', 'price_from', 'booking', 'place']
          when 'courses'    then array['batch', 'starts_on', 'fee_paise', 'seats', 'total', 'description']
          when 'properties' then array['location', 'size', 'size_unit', 'note', 'price_paise', 'status']
          when 'pricelist'  then array['moq', 'unit', 'rates', 'good_until']
          else array[]::text[] end));
$$;
revoke all on function app.sell_data_keys_ok(text, jsonb) from public, anon, authenticated, service_role;

create function app.sell_amounts(p_style text, p_data jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_style
    when 'services'   then jsonb_build_object('a', p_data -> 'price_paise')
    when 'properties' then jsonb_build_object('a', p_data -> 'price_paise')
    when 'courses'    then jsonb_build_object('a', p_data -> 'fee_paise')
    when 'pricelist'  then jsonb_build_object('a', p_data -> 'rates')
    else '{}'::jsonb end;
$$;
revoke all on function app.sell_amounts(text, jsonb) from public, anon, authenticated, service_role;

create table public.sell_entries (
  id         uuid not null,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  style      text not null check (style in ('services', 'courses', 'properties', 'pricelist')),
  name       text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  data       jsonb not null default '{}'::jsonb check (app.sell_data_keys_ok(style, data)),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (tenant_id, id)
);
create index sell_entries_list_idx on public.sell_entries (tenant_id, style, created_at, id) where removed_at is null;
comment on table public.sell_entries is 'What a business sells, for the services, courses, properties and price-list styles of the "What you sell" section. Written only by SECURITY DEFINER functions; every member reads.';
comment on column public.sell_entries.name is 'SAFE: the name of something the business sells; no personal data intended; passes app.text_is_clean';
comment on column public.sell_entries.style is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.sell_entries.data is 'SAFE: the style''s own fields: closed words, whole numbers (paise) and short texts that passed app.text_is_clean in sell_entry_put. CLEAN-EXEMPT: closed key list (app.sell_data_keys_ok)';

create trigger sell_entries_forbid_tenant_id_change before update on public.sell_entries for each row execute function app.forbid_tenant_id_change();
create trigger audit_sell_entries after insert or update or delete on public.sell_entries for each row execute function app.audit_row_change('sell_entry');

alter table public.sell_entries enable row level security;
alter table public.sell_entries force row level security;
revoke all on public.sell_entries from public, anon, authenticated;
grant select on public.sell_entries to authenticated;
create policy sell_entries_select on public.sell_entries for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));

create function app.sell_item(p public.sell_entries) returns jsonb
language sql
immutable
set search_path = ''
as $$ select jsonb_build_object('id', p.id, 'name', p.name) || p.data $$;
revoke all on function app.sell_item(public.sell_entries) from public, anon, authenticated, service_role;

create function public.sell_entry_list(p_tenant_id uuid, p_style text, p_limit integer default 50, p_after text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_at     timestamptz;
  v_id     uuid;
  v_rows   public.sell_entries[];
  v_more   boolean;
  v_next   text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.pack_error('deny');
  end if;
  if p_style is null or p_style not in ('services', 'courses', 'properties', 'pricelist') then
    perform app.pack_error('invalid');
  end if;
  if p_after is not null then
    begin
      v_at := split_part(p_after, '|', 1)::timestamptz;
      v_id := split_part(p_after, '|', 2)::uuid;
    exception when others then
      perform app.pack_error('invalid');
    end;
  end if;
  select coalesce(array_agg(e), array[]::public.sell_entries[]) into v_rows
    from (select * from public.sell_entries x
           where x.tenant_id = p_tenant_id and x.style = p_style and x.removed_at is null
             and (v_at is null or (x.created_at, x.id) > (v_at, v_id))
           order by x.created_at, x.id
           limit v_limit + 1) e;
  v_more := coalesce(array_length(v_rows, 1), 0) > v_limit;
  if v_more then
    v_rows := v_rows[1:v_limit];
    v_next := to_char(v_rows[v_limit].created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || v_rows[v_limit].id::text;
  end if;
  return jsonb_build_object(
    'style', p_style,
    'items', (select coalesce(jsonb_agg(app.sell_item(r) order by r.created_at, r.id), '[]'::jsonb) from unnest(v_rows) r),
    'next_cursor', v_next);
end;
$$;
revoke all on function public.sell_entry_list(uuid, text, integer, text) from public, anon;
grant execute on function public.sell_entry_list(uuid, text, integer, text) to authenticated;

create function public.sell_entry_get(p_tenant_id uuid, p_style text, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.sell_entries;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.pack_error('deny');
  end if;
  select * into e from public.sell_entries x where x.tenant_id = p_tenant_id and x.id = p_id and x.style = p_style and x.removed_at is null;
  if not found then
    perform app.pack_error('reference');
  end if;
  return app.sell_item(e);
end;
$$;
revoke all on function public.sell_entry_get(uuid, text, uuid) from public, anon;
grant execute on function public.sell_entry_get(uuid, text, uuid) to authenticated;

create function public.sell_entry_put(p_tenant_id uuid, p_style text, p_id uuid, p_name text, p_data jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_old     public.sell_entries;
  e         public.sell_entries;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.pack_error('deny');
  end if;
  if p_style is null or p_style not in ('services', 'courses', 'properties', 'pricelist')
     or char_length(v_name) not between 1 and 120 or not app.text_is_clean(v_name)
     or not app.sell_data_keys_ok(p_style, p_data)
     or exists (select 1 from jsonb_each(p_data) j where jsonb_typeof(j.value) = 'string' and not app.text_is_clean(j.value #>> '{}')) then
    perform app.pack_error('invalid');
  end if;
  select * into v_old from public.sell_entries x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if found and (v_old.style <> p_style or v_old.removed_at is not null) then
    perform app.pack_error(case when v_old.style <> p_style then 'invalid' else 'reference' end);
  end if;
  -- an amount (price, fee, rate) is set or changed by the Owner only; every other field by Owner and Admin
  if app.sell_amounts(p_style, p_data) is distinct from (case when found then app.sell_amounts(p_style, v_old.data) else '{"a": null}'::jsonb end)
     and not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.pack_error('deny');
  end if;
  if found then
    update public.sell_entries x set name = v_name, data = p_data, updated_by = v_uid, updated_at = now()
     where x.tenant_id = p_tenant_id and x.id = p_id returning * into e;
  else
    insert into public.sell_entries (id, tenant_id, style, name, data, created_by) values (p_id, p_tenant_id, p_style, v_name, p_data, v_uid) returning * into e;
    v_created := true;
  end if;
  return jsonb_build_object('item', app.sell_item(e), 'created', v_created);
end;
$$;
revoke all on function public.sell_entry_put(uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function public.sell_entry_put(uuid, text, uuid, text, jsonb) to authenticated;

create function public.sell_entry_remove(p_tenant_id uuid, p_style text, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.sell_entries;
begin
  if auth.uid() is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.pack_error('deny');
  end if;
  select * into e from public.sell_entries x where x.tenant_id = p_tenant_id and x.id = p_id and x.style = p_style for update;
  if not found then
    perform app.pack_error('reference');
  end if;
  if e.removed_at is null then
    update public.sell_entries x set removed_at = now(), updated_by = auth.uid(), updated_at = now() where x.tenant_id = p_tenant_id and x.id = p_id;
  end if;
  return jsonb_build_object('removed', true);
end;
$$;
revoke all on function public.sell_entry_remove(uuid, text, uuid) from public, anon;
grant execute on function public.sell_entry_remove(uuid, text, uuid) to authenticated;

-- the first-run count now includes these entries (docs/contracts/first-run.md)
create or replace function public.first_run_facts(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w packs.workspace_pack;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.pack_error('deny');
  end if;
  select * into w from packs.workspace_pack x where x.tenant_id = p_tenant_id;
  if not found then
    perform app.pack_error('reference');
  end if;
  return jsonb_build_object(
    'pack_code', w.pack_code,
    'source', w.source,
    'typed', w.source not in ('default', 'legacy'),
    'items_count', (select count(*) from public.catalogue_items c where c.tenant_id = p_tenant_id)
                 + (select count(*) from public.sell_entries s where s.tenant_id = p_tenant_id and s.removed_at is null));
end;
$$;
