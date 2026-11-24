-- "What you sell" as named LISTS the business shapes itself (28 Nov 2026; design: reports/what-you-sell-lists-design.md, approved by the planner). Slice 1: the tables, the limits and the functions.
--   public.sell_lists          a named list (kind products | digital | services | bookings | courses | subscriptions | rentals | food | events | other; one is "main")
--   public.sell_list_columns   the columns of a list (text, number, rupees, yes/no, choice, photo, link, date, datetime, duration). A column may carry a ROLE: price (SEVERAL allowed, each labelled with a BILLING PERIOD; exactly one is the default to quote),
--                              availability (in stock / seats / slots), quantity, how_to_buy (a link the assistant may share; it never sends a paid download or access link itself) or description (short text the assistant may read out); one column per role except price
--   public.sell_list_rows      the items: a name and cells keyed by column key
--   public.sell_list_imports   a remembered Excel/CSV heading -> column mapping (used in slice 3)
-- Nothing existing is touched: the catalogue, the four "what you sell" styles and the quote price list stay where they are and are shown as built-in lists by the API (slice 4). Rollback = drop these four tables and the functions below.
-- Written only by SECURITY DEFINER functions (Owner and Admin); every member reads. Only the OWNER sets or changes a rupee amount (the same rule as the catalogue's exact price). Limits: 10 lists (3 while on a trial), 12 columns a list, 1,000 rows a list.

create function app.list_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'list_limit'         then raise exception 'too many lists' using errcode = 'SM841';
    when 'column_limit'       then raise exception 'too many columns' using errcode = 'SM842';
    when 'row_limit'          then raise exception 'too many rows' using errcode = 'SM843';
    when 'name_taken'         then raise exception 'name already used' using errcode = 'SM844';
    when 'one_default_price'  then raise exception 'exactly one price column is the default' using errcode = 'SM845';
    when 'role_taken'         then raise exception 'that role is already used by another column' using errcode = 'SM846';
    when 'column_has_data'    then raise exception 'column holds data' using errcode = 'SM847';
    when 'value_not_allowed'  then raise exception 'value not allowed' using errcode = 'SM848';
    when 'not_a_price'        then raise exception 'not a price' using errcode = 'SM849';
    when 'invalid'            then raise exception 'invalid input' using errcode = '22023';
    when 'reference'          then raise exception 'not found' using errcode = '23503';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.list_error(text) from public;

-- ------------------------------------------------------------------------------------------------------------------------------ tables
create table public.sell_lists (
  id         uuid not null,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  name       text not null check (char_length(name) between 1 and 60 and app.text_is_clean(name)),
  kind       text not null check (kind in ('products', 'digital', 'services', 'bookings', 'courses', 'subscriptions', 'rentals', 'food', 'events', 'other')),
  is_main    boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (tenant_id, id)
);
create unique index sell_lists_name_live on public.sell_lists (tenant_id, lower(name)) where removed_at is null;
create unique index sell_lists_one_main on public.sell_lists (tenant_id) where is_main and removed_at is null;
comment on table public.sell_lists is 'The named lists of what a business sells (products, services, courses, properties, other), each with columns the owner shapes. Written only by SECURITY DEFINER functions; every member reads.';
comment on column public.sell_lists.name is 'SAFE: the name of a list of things the business sells; no personal data intended; passes app.text_is_clean';
comment on column public.sell_lists.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.sell_list_columns (
  id            uuid not null,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  list_id       uuid not null,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,29}$'),
  label         text not null check (char_length(label) between 1 and 40 and app.text_is_clean(label)),
  type          text not null check (type in ('text', 'number', 'rupees', 'yes_no', 'choice', 'photo', 'link', 'date', 'datetime', 'duration')),
  choices       text[] not null default '{}' check (cardinality(choices) <= 20),
  role          text check (role in ('price', 'availability', 'quantity', 'how_to_buy', 'description')),
  billing_period text check (billing_period in ('one_time', 'per_month', 'per_year', 'per_hour', 'per_day', 'per_unit', 'from')),
  quote_default boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, list_id) references public.sell_lists (tenant_id, id) on delete restrict,
  check (role is distinct from 'price' or type = 'rupees'),
  check (role is distinct from 'availability' or type = 'choice'),
  check (role is distinct from 'quantity' or type = 'number'),
  check (role is distinct from 'how_to_buy' or type = 'link'),
  check (role is distinct from 'description' or type = 'text'),
  check (type = 'choice' or cardinality(choices) = 0),
  check ((role = 'price') = (billing_period is not null)),
  check (not quote_default or role = 'price')
);
create unique index sell_list_columns_key on public.sell_list_columns (tenant_id, list_id, key);
create unique index sell_list_columns_label_live on public.sell_list_columns (tenant_id, list_id, lower(label)) where removed_at is null;
create unique index sell_list_columns_one_default on public.sell_list_columns (tenant_id, list_id) where quote_default and removed_at is null;
create unique index sell_list_columns_one_role on public.sell_list_columns (tenant_id, list_id, role) where role in ('availability', 'quantity', 'how_to_buy', 'description') and removed_at is null;
comment on table public.sell_list_columns is 'The columns of a list. A column may carry the role price (several allowed, each with a billing period, one is the default to quote) or one of availability, quantity, how_to_buy, description (one column each). Written only by SECURITY DEFINER functions.';
comment on column public.sell_list_columns.key is 'SAFE: a stable slug made once from the label. CLEAN-EXEMPT: closed pattern';
comment on column public.sell_list_columns.label is 'SAFE: the owner''s name for the column; passes app.text_is_clean';
comment on column public.sell_list_columns.type is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.sell_list_columns.choices is 'SAFE: the allowed words of a choice column (at most 20), each passing app.text_is_clean in the function. CLEAN-EXEMPT: bounded list checked in sell_list_columns_put';
comment on column public.sell_list_columns.role is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.sell_list_columns.billing_period is 'SAFE: a closed word (one_time, per_month, per_year, per_hour, per_day, per_unit, from) on a price column. CLEAN-EXEMPT: closed CHECK list';

create table public.sell_list_rows (
  id         uuid not null,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  list_id    uuid not null,
  name       text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  cells      jsonb not null default '{}'::jsonb check (jsonb_typeof(cells) = 'object' and pg_column_size(cells) <= 6000),
  active     boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, list_id) references public.sell_lists (tenant_id, id) on delete restrict
);
create unique index sell_list_rows_name_live on public.sell_list_rows (tenant_id, list_id, lower(name)) where removed_at is null;
create index sell_list_rows_list_idx on public.sell_list_rows (tenant_id, list_id, created_at, id) where removed_at is null;
comment on table public.sell_list_rows is 'The items of a list: a name and cells keyed by column key. Written only by SECURITY DEFINER functions; every member reads.';
comment on column public.sell_list_rows.name is 'SAFE: the name of something the business sells; no personal data intended; passes app.text_is_clean';
comment on column public.sell_list_rows.cells is 'SAFE: the cells of the row: text that passed app.text_is_clean, numbers, whole paise, true/false, a word from the column''s choices, an https link or a photo path, each checked against its column in sell_row_put. CLEAN-EXEMPT: checked per column type in the function';

create table public.sell_list_imports (
  id         uuid not null,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  list_id    uuid not null,
  label      text not null check (char_length(label) between 1 and 80 and app.text_is_clean(label)),
  mapping    jsonb not null check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) <= 4000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, list_id) references public.sell_lists (tenant_id, id) on delete restrict
);
create index sell_list_imports_list_idx on public.sell_list_imports (tenant_id, list_id, created_at);
comment on table public.sell_list_imports is 'A remembered mapping from the headings of an Excel or CSV file to the columns of a list. Written only by SECURITY DEFINER functions.';
comment on column public.sell_list_imports.label is 'SAFE: a short name for the mapping, for example the file''s name without the extension; passes app.text_is_clean';
comment on column public.sell_list_imports.mapping is 'SAFE: file heading -> column key pairs; headings are the shop''s own column words (no personal data) and pass app.text_is_clean in the function. CLEAN-EXEMPT: checked in the function';

do $$
declare
  t text;
begin
  foreach t in array array['sell_lists', 'sell_list_columns', 'sell_list_rows', 'sell_list_imports'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t || '_select', t);
  end loop;
end $$;
create trigger audit_sell_lists after insert or update or delete on public.sell_lists for each row execute function app.audit_row_change('sell_list');
create trigger audit_sell_list_columns after insert or update or delete on public.sell_list_columns for each row execute function app.audit_row_change('sell_list_column');
create trigger audit_sell_list_rows after insert or update or delete on public.sell_list_rows for each row execute function app.audit_row_change('sell_list_row');
create trigger audit_sell_list_imports after insert or update or delete on public.sell_list_imports for each row execute function app.audit_row_change('sell_list_import');

-- ------------------------------------------------------------------------------------------------------------------------------ helpers
create function app.sell_list_slug(p_tenant uuid, p_list uuid, p_label text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := regexp_replace(lower(coalesce(p_label, '')), '[^a-z0-9]+', '_', 'g');
  v_key  text;
  n      integer := 1;
begin
  v_base := btrim(v_base, '_');
  if v_base = '' then
    v_base := 'column';
  end if;
  if v_base !~ '^[a-z]' then
    v_base := 'c_' || v_base;
  end if;
  v_base := left(v_base, 26);
  v_key := v_base;
  while exists (select 1 from public.sell_list_columns c where c.tenant_id = p_tenant and c.list_id = p_list and c.key = v_key) loop
    n := n + 1;
    v_key := v_base || '_' || n;
  end loop;
  return v_key;
end;
$$;
revoke all on function app.sell_list_slug(uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.sell_list_json(p_tenant uuid, p_list uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind, 'is_main', l.is_main,
           'row_count', (select count(*) from public.sell_list_rows r where r.tenant_id = l.tenant_id and r.list_id = l.id and r.removed_at is null),
           'columns', coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'type', c.type, 'choices', to_jsonb(c.choices), 'role', c.role, 'billing_period', c.billing_period, 'quote_default', c.quote_default)
                                  order by c.sort_order, c.created_at, c.key)
                                 from public.sell_list_columns c where c.tenant_id = l.tenant_id and c.list_id = l.id and c.removed_at is null), '[]'::jsonb))
    from public.sell_lists l where l.tenant_id = p_tenant and l.id = p_list and l.removed_at is null
$$;
revoke all on function app.sell_list_json(uuid, uuid) from public, anon, authenticated, service_role;

create function app.sell_list_paid(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((app.billing_plan_row(p_tenant)).kind, 'trial') in ('main', 'calls') $$;
revoke all on function app.sell_list_paid(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ lists
create function public.sell_list_create(p_tenant_id uuid, p_id uuid, p_name text, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_old  public.sell_lists;
  v_n    integer;
  v_cap  integer;
  v_first boolean;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  if char_length(v_name) not between 1 and 60 or not app.text_is_clean(v_name) or p_kind is null or p_kind not in ('products', 'digital', 'services', 'bookings', 'courses', 'subscriptions', 'rentals', 'food', 'events', 'other') then
    perform app.list_error('invalid');
  end if;
  select * into v_old from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if found then   -- the same id again is a retry of the same list
    if v_old.removed_at is not null or v_old.kind <> p_kind or lower(v_old.name) <> lower(v_name) then
      perform app.list_error('invalid');
    end if;
    return app.sell_list_json(p_tenant_id, p_id);
  end if;
  select count(*) into v_n from public.sell_lists x where x.tenant_id = p_tenant_id and x.removed_at is null;
  v_cap := case when app.sell_list_paid(p_tenant_id) then 10 else 3 end;
  if v_n >= v_cap then
    perform app.list_error('list_limit');
  end if;
  if exists (select 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.removed_at is null and lower(x.name) = lower(v_name)) then
    perform app.list_error('name_taken');
  end if;
  v_first := v_n = 0;
  insert into public.sell_lists (id, tenant_id, name, kind, is_main, sort_order, created_by) values (p_id, p_tenant_id, v_name, p_kind, v_first, v_n, v_uid);
  -- the sensible columns of the kind (the name of an item is the row's own name, not a column)
  insert into public.sell_list_columns (id, tenant_id, list_id, key, label, type, choices, role, billing_period, quote_default, sort_order)
  select gen_random_uuid(), p_tenant_id, p_id, d.key, d.label, d.type, d.choices, d.role, d.period, d.quote_default, d.ord
    from (values
      ('products', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('products', 'availability', 'Availability', 'choice', array['In stock', 'Few left', 'Made to order', 'Out of stock'], 'availability', null, false, 2),
      ('products', 'quantity', 'Quantity', 'number', '{}'::text[], 'quantity', null, false, 3),
      ('products', 'photo', 'Photo', 'photo', '{}'::text[], null, null, false, 4),
      ('digital', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('digital', 'availability', 'Availability', 'choice', array['Always available', 'Sold out'], 'availability', null, false, 2),
      ('digital', 'how_to_buy', 'How to buy', 'link', '{}'::text[], 'how_to_buy', null, false, 3),
      ('digital', 'description', 'Description', 'text', '{}'::text[], 'description', null, false, 4),
      ('digital', 'delivery', 'Delivery', 'choice', array['Instant link', 'By post', 'Collect in shop', 'On a call', 'None'], null, null, false, 5),
      ('services', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('services', 'time', 'Time', 'duration', '{}'::text[], null, null, false, 2),
      ('services', 'description', 'Description', 'text', '{}'::text[], 'description', null, false, 3),
      ('bookings', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('bookings', 'duration', 'Duration', 'duration', '{}'::text[], null, null, false, 2),
      ('bookings', 'availability', 'Availability', 'choice', array['Open slots', 'Booked'], 'availability', null, false, 3),
      ('bookings', 'how_to_buy', 'Booking link', 'link', '{}'::text[], 'how_to_buy', null, false, 4),
      ('courses', 'fee', 'Fee', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('courses', 'starts', 'Starts', 'date', '{}'::text[], null, null, false, 2),
      ('courses', 'duration', 'Duration', 'duration', '{}'::text[], null, null, false, 3),
      ('courses', 'availability', 'Availability', 'choice', array['Seats open', 'Limited seats', 'Sold out'], 'availability', null, false, 4),
      ('subscriptions', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'per_month', true, 1),
      ('subscriptions', 'availability', 'Availability', 'choice', array['Always available', 'Sold out'], 'availability', null, false, 2),
      ('subscriptions', 'how_to_buy', 'How to buy', 'link', '{}'::text[], 'how_to_buy', null, false, 3),
      ('subscriptions', 'description', 'Description', 'text', '{}'::text[], 'description', null, false, 4),
      ('rentals', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'per_month', true, 1),
      ('rentals', 'size', 'Size', 'number', '{}'::text[], null, null, false, 2),
      ('rentals', 'location', 'Location', 'text', '{}'::text[], null, null, false, 3),
      ('rentals', 'availability', 'Availability', 'choice', array['Available', 'Booked', 'Sold'], 'availability', null, false, 4),
      ('food', 'price', 'Price', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('food', 'availability', 'Availability', 'choice', array['Available', 'Sold out'], 'availability', null, false, 2),
      ('food', 'description', 'Description', 'text', '{}'::text[], 'description', null, false, 3),
      ('food', 'photo', 'Photo', 'photo', '{}'::text[], null, null, false, 4),
      ('events', 'price', 'Ticket price', 'rupees', '{}'::text[], 'price', 'one_time', true, 1),
      ('events', 'when', 'When', 'datetime', '{}'::text[], null, null, false, 2),
      ('events', 'availability', 'Availability', 'choice', array['Seats open', 'Limited seats', 'Sold out'], 'availability', null, false, 3),
      ('events', 'how_to_buy', 'How to buy', 'link', '{}'::text[], 'how_to_buy', null, false, 4)
    ) as d(kind, key, label, type, choices, role, period, quote_default, ord)
   where d.kind = p_kind;
  return app.sell_list_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.sell_list_create(uuid, uuid, text, text) from public, anon;
grant execute on function public.sell_list_create(uuid, uuid, text, text) to authenticated;

create function public.sell_lists_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.list_error('deny');
  end if;
  return jsonb_build_object('lists', coalesce((select jsonb_agg(app.sell_list_json(l.tenant_id, l.id) order by l.sort_order, l.created_at, l.id)
                                                from public.sell_lists l where l.tenant_id = p_tenant_id and l.removed_at is null), '[]'::jsonb));
end;
$$;
revoke all on function public.sell_lists_list(uuid) from public, anon;
grant execute on function public.sell_lists_list(uuid) to authenticated;

create function public.sell_list_get(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.list_error('deny');
  end if;
  v := app.sell_list_json(p_tenant_id, p_id);
  if v is null then
    perform app.list_error('reference');
  end if;
  return v;
end;
$$;
revoke all on function public.sell_list_get(uuid, uuid) from public, anon;
grant execute on function public.sell_list_get(uuid, uuid) to authenticated;

-- rename and/or make main
create function public.sell_list_update(p_tenant_id uuid, p_id uuid, p_name text, p_make_main boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  if char_length(v_name) not between 1 and 60 or not app.text_is_clean(v_name) then
    perform app.list_error('invalid');
  end if;
  perform 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_id and x.removed_at is null for update;
  if not found then
    perform app.list_error('reference');
  end if;
  if exists (select 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.removed_at is null and x.id <> p_id and lower(x.name) = lower(v_name)) then
    perform app.list_error('name_taken');
  end if;
  if coalesce(p_make_main, false) then
    update public.sell_lists x set is_main = false, updated_by = v_uid, updated_at = now() where x.tenant_id = p_tenant_id and x.is_main and x.removed_at is null and x.id <> p_id;
  end if;
  update public.sell_lists x set name = v_name, is_main = x.is_main or coalesce(p_make_main, false), updated_by = v_uid, updated_at = now() where x.tenant_id = p_tenant_id and x.id = p_id;
  return app.sell_list_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.sell_list_update(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.sell_list_update(uuid, uuid, text, boolean) to authenticated;

create function public.sell_list_remove(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  l     public.sell_lists;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  select * into l from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.list_error('reference');
  end if;
  if l.removed_at is null then
    update public.sell_lists x set removed_at = now(), is_main = false, updated_by = v_uid, updated_at = now() where x.tenant_id = p_tenant_id and x.id = p_id;
    update public.sell_list_rows x set removed_at = now(), updated_by = v_uid, updated_at = now() where x.tenant_id = p_tenant_id and x.list_id = p_id and x.removed_at is null;
    -- the oldest remaining list becomes main when the main one goes
    if l.is_main then
      update public.sell_lists x set is_main = true where x.tenant_id = p_tenant_id and x.id = (select y.id from public.sell_lists y where y.tenant_id = p_tenant_id and y.removed_at is null order by y.sort_order, y.created_at, y.id limit 1);
    end if;
  end if;
  return jsonb_build_object('removed', true);
end;
$$;
revoke all on function public.sell_list_remove(uuid, uuid) from public, anon;
grant execute on function public.sell_list_remove(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ columns: the whole ordered set in one call
-- p_columns: [{key?, label, type, choices?, role?, billing_period? (price columns: one_time by default), quote_default?}]. A column with a key is an existing one (renamed, reordered, its role or choices changed); without a key it is new. An existing column missing from the set is REMOVED:
-- when cells hold data for it that needs p_confirm (the cells are kept, the column is hidden). A column's TYPE changes only while no cell holds data.
create function public.sell_list_columns_put(p_tenant_id uuid, p_list_id uuid, p_columns jsonb, p_confirm boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  c         jsonb;
  v_i       integer := 0;
  v_key     text;
  v_label   text;
  v_type    text;
  v_role    text;
  v_period  text;
  v_choices text[];
  v_old     public.sell_list_columns;
  v_kept    text[];
  v_defaults integer;
begin
  if v_uid is null or p_tenant_id is null or p_list_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  perform 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_list_id and x.removed_at is null for update;
  if not found then
    perform app.list_error('reference');
  end if;
  if p_columns is null or jsonb_typeof(p_columns) <> 'array' then
    perform app.list_error('invalid');
  end if;
  if jsonb_array_length(p_columns) > 12 then
    perform app.list_error('column_limit');
  end if;
  -- the set's own rules first (nothing is written until they hold)
  if exists (select 1 from jsonb_array_elements(p_columns) e where e ->> 'role' in ('availability', 'quantity', 'how_to_buy', 'description') group by e ->> 'role' having count(*) > 1) then
    perform app.list_error('role_taken');
  end if;
  v_defaults := (select count(*) from jsonb_array_elements(p_columns) e where coalesce((e ->> 'quote_default')::boolean, false));
  if v_defaults > 1 then
    perform app.list_error('one_default_price');
  end if;
  if (select count(distinct lower(btrim(e ->> 'label'))) from jsonb_array_elements(p_columns) e) <> jsonb_array_length(p_columns) then
    perform app.list_error('name_taken');
  end if;
  -- 1. the columns the set no longer names are removed first (hidden; their cells stay): that needs a yes when cells hold data
  v_kept := array(select e ->> 'key' from jsonb_array_elements(p_columns) e where nullif(e ->> 'key', '') is not null);
  if exists (select 1 from unnest(v_kept) k where not exists (select 1 from public.sell_list_columns x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.key = k and x.removed_at is null)) then
    perform app.list_error('reference');
  end if;
  for v_old in select * from public.sell_list_columns x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null and not (x.key = any (v_kept)) loop
    if not coalesce(p_confirm, false) and exists (select 1 from public.sell_list_rows r where r.tenant_id = p_tenant_id and r.list_id = p_list_id and r.removed_at is null and r.cells ? v_old.key and jsonb_typeof(r.cells -> v_old.key) <> 'null') then
      perform app.list_error('column_has_data');
    end if;
    update public.sell_list_columns x set removed_at = now(), quote_default = false, role = null, billing_period = null, label = '~' || x.id::text where x.tenant_id = p_tenant_id and x.id = v_old.id;
  end loop;
  -- 2. the columns that stay are parked (no label, role or default) so a swap or a moved role never trips a unique index midway; the set then writes them back
  update public.sell_list_columns x set label = '~' || x.id::text, role = null, billing_period = null, quote_default = false where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null;
  for c in select e from jsonb_array_elements(p_columns) e loop
    v_i := v_i + 1;
    v_label := btrim(coalesce(c ->> 'label', ''));
    v_type := c ->> 'type';
    v_role := nullif(c ->> 'role', '');
    if char_length(v_label) not between 1 and 40 or not app.text_is_clean(v_label) or v_type is null or v_type not in ('text', 'number', 'rupees', 'yes_no', 'choice', 'photo', 'link', 'date', 'datetime', 'duration')
       or (v_role is not null and v_role not in ('price', 'availability', 'quantity', 'how_to_buy', 'description')) then
      perform app.list_error('invalid');
    end if;
    if v_role = 'price' and v_type <> 'rupees' then
      perform app.list_error('not_a_price');
    end if;
    if (v_role = 'availability' and v_type <> 'choice') or (v_role = 'quantity' and v_type <> 'number') or (v_role = 'how_to_buy' and v_type <> 'link') or (v_role = 'description' and v_type <> 'text') then
      perform app.list_error('invalid');
    end if;
    v_period := case when v_role = 'price' then coalesce(nullif(c ->> 'billing_period', ''), 'one_time') end;
    if v_period is not null and v_period not in ('one_time', 'per_month', 'per_year', 'per_hour', 'per_day', 'per_unit', 'from') then
      perform app.list_error('invalid');
    end if;
    v_choices := case when jsonb_typeof(c -> 'choices') = 'array' then array(select jsonb_array_elements_text(c -> 'choices')) else '{}'::text[] end;
    if v_type <> 'choice' then
      v_choices := '{}';
    elsif cardinality(v_choices) not between 1 and 20 or exists (select 1 from unnest(v_choices) w where char_length(btrim(w)) not between 1 and 40 or not app.text_is_clean(w)) then
      perform app.list_error('invalid');
    end if;
    v_key := nullif(c ->> 'key', '');
    if v_key is not null then
      select * into v_old from public.sell_list_columns x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.key = v_key and x.removed_at is null;
      if not found then
        perform app.list_error('reference');
      end if;
      if v_old.type <> v_type and exists (select 1 from public.sell_list_rows r where r.tenant_id = p_tenant_id and r.list_id = p_list_id and r.removed_at is null and r.cells ? v_key and jsonb_typeof(r.cells -> v_key) <> 'null') then
        perform app.list_error('column_has_data');
      end if;
      update public.sell_list_columns x set label = v_label, type = v_type, choices = v_choices, role = v_role, billing_period = v_period,
             quote_default = (v_role = 'price' and coalesce((c ->> 'quote_default')::boolean, false)), sort_order = v_i
       where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.key = v_key;
    else
      v_key := app.sell_list_slug(p_tenant_id, p_list_id, v_label);
      insert into public.sell_list_columns (id, tenant_id, list_id, key, label, type, choices, role, billing_period, quote_default, sort_order)
      values (gen_random_uuid(), p_tenant_id, p_list_id, v_key, v_label, v_type, v_choices, v_role, v_period, v_role = 'price' and coalesce((c ->> 'quote_default')::boolean, false), v_i);
    end if;
  end loop;
  -- a list with price columns always has exactly one default: the first when none was named
  if exists (select 1 from public.sell_list_columns x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null and x.role = 'price')
     and not exists (select 1 from public.sell_list_columns x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null and x.quote_default) then
    update public.sell_list_columns x set quote_default = true
     where x.tenant_id = p_tenant_id and x.id = (select y.id from public.sell_list_columns y where y.tenant_id = p_tenant_id and y.list_id = p_list_id and y.removed_at is null and y.role = 'price' order by y.sort_order, y.created_at limit 1);
  end if;
  return app.sell_list_json(p_tenant_id, p_list_id);
end;
$$;
revoke all on function public.sell_list_columns_put(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.sell_list_columns_put(uuid, uuid, jsonb, boolean) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ rows
create function app.sell_cells_check(p_tenant uuid, p_list uuid, p_cells jsonb, p_old jsonb, p_owner boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k   text;
  v   jsonb;
  c   public.sell_list_columns;
  txt text;
begin
  if p_cells is null or jsonb_typeof(p_cells) <> 'object' then
    perform app.list_error('invalid');
  end if;
  for k, v in select * from jsonb_each(p_cells) loop
    select * into c from public.sell_list_columns x where x.tenant_id = p_tenant and x.list_id = p_list and x.key = k and x.removed_at is null;
    if not found then
      perform app.list_error('invalid');   -- a cell for a column the list does not have
    end if;
    if jsonb_typeof(v) = 'null' then
      continue;
    end if;
    case c.type
      when 'text' then
        txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
        if txt is null or char_length(txt) > 200 or not app.text_is_clean(txt) then perform app.list_error('value_not_allowed'); end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' or abs((v #>> '{}')::numeric) > 1000000000 then perform app.list_error('value_not_allowed'); end if;
      when 'rupees' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$' or (v #>> '{}')::bigint not between 100 and 1000000000 then perform app.list_error('not_a_price'); end if;
      when 'yes_no' then
        if jsonb_typeof(v) <> 'boolean' then perform app.list_error('value_not_allowed'); end if;
      when 'choice' then
        if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (c.choices)) then perform app.list_error('value_not_allowed'); end if;
      when 'link' then
        txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
        if txt is null or txt !~ '^https://[^[:space:]]{3,255}$' then perform app.list_error('value_not_allowed'); end if;
      when 'date' then
        txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
        if txt is null or txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform app.list_error('value_not_allowed'); end if;
        begin perform txt::date; exception when others then perform app.list_error('value_not_allowed'); end;
      when 'datetime' then
        txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
        if txt is null or txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' then perform app.list_error('value_not_allowed'); end if;
        begin perform txt::timestamptz; exception when others then perform app.list_error('value_not_allowed'); end;
      when 'duration' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$' or (v #>> '{}')::bigint not between 1 and 525600 then perform app.list_error('value_not_allowed'); end if;
      when 'photo' then
        txt := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
        if txt is null or txt !~ '^[A-Za-z0-9/_.-]{1,200}$' then perform app.list_error('value_not_allowed'); end if;
    end case;
    -- only the Owner sets or changes an amount
    if c.type = 'rupees' and not p_owner and (p_old -> k) is distinct from v then
      perform app.list_error('deny');
    end if;
  end loop;
  -- an amount removed by an Admin is also a change of an amount
  if not p_owner then
    for k in select x.key from public.sell_list_columns x where x.tenant_id = p_tenant and x.list_id = p_list and x.removed_at is null and x.type = 'rupees' loop
      if coalesce(p_old -> k, 'null'::jsonb) is distinct from coalesce(p_cells -> k, 'null'::jsonb) then
        perform app.list_error('deny');
      end if;
    end loop;
  end if;
end;
$$;
revoke all on function app.sell_cells_check(uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;

create function public.sell_row_put(p_tenant_id uuid, p_list_id uuid, p_id uuid, p_name text, p_cells jsonb, p_active boolean default true) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_old     public.sell_list_rows;
  v_created boolean := false;
  r         public.sell_list_rows;
begin
  if v_uid is null or p_tenant_id is null or p_list_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  if char_length(v_name) not between 1 and 120 or not app.text_is_clean(v_name) then
    perform app.list_error('invalid');
  end if;
  perform 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_list_id and x.removed_at is null for update;
  if not found then
    perform app.list_error('reference');
  end if;
  select * into v_old from public.sell_list_rows x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if found and (v_old.list_id <> p_list_id or v_old.removed_at is not null) then
    perform app.list_error('reference');
  end if;
  perform app.sell_cells_check(p_tenant_id, p_list_id, coalesce(p_cells, '{}'::jsonb), case when found then v_old.cells else '{}'::jsonb end, app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]));
  if exists (select 1 from public.sell_list_rows x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null and x.id <> p_id and lower(x.name) = lower(v_name)) then
    perform app.list_error('name_taken');
  end if;
  if v_old.id is not null then
    update public.sell_list_rows x set name = v_name, cells = coalesce(p_cells, '{}'::jsonb), active = coalesce(p_active, true), updated_by = v_uid, updated_at = now()
     where x.tenant_id = p_tenant_id and x.id = p_id returning * into r;
  else
    if (select count(*) from public.sell_list_rows x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null) >= 1000 then
      perform app.list_error('row_limit');
    end if;
    insert into public.sell_list_rows (id, tenant_id, list_id, name, cells, active, created_by) values (p_id, p_tenant_id, p_list_id, v_name, coalesce(p_cells, '{}'::jsonb), coalesce(p_active, true), v_uid) returning * into r;
    v_created := true;
  end if;
  return jsonb_build_object('item', jsonb_build_object('id', r.id, 'name', r.name, 'cells', r.cells, 'active', r.active), 'created', v_created);
end;
$$;
revoke all on function public.sell_row_put(uuid, uuid, uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.sell_row_put(uuid, uuid, uuid, text, jsonb, boolean) to authenticated;

create function public.sell_row_list(p_tenant_id uuid, p_list_id uuid, p_limit integer default 50, p_after text default null, p_q text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_at    timestamptz;
  v_id    uuid;
  v_q     text := nullif(btrim(coalesce(p_q, '')), '');
  v_items jsonb;
  v_next  text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.list_error('deny');
  end if;
  if not exists (select 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_list_id and x.removed_at is null) then
    perform app.list_error('reference');
  end if;
  if p_after is not null then
    begin
      v_at := split_part(p_after, '|', 1)::timestamptz;
      v_id := split_part(p_after, '|', 2)::uuid;
    exception when others then
      perform app.list_error('invalid');
    end;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'cells', p.cells, 'active', p.active) order by p.created_at, p.id), '[]'::jsonb) into v_items
    from (select x.id, x.name, x.cells, x.active, x.created_at from public.sell_list_rows x
           where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null
             and (v_q is null or x.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
             and (v_at is null or (x.created_at, x.id) > (v_at, v_id))
           order by x.created_at, x.id limit v_limit) p;
  if (select count(*) from (select 1 from public.sell_list_rows x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null
             and (v_q is null or x.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
             and (v_at is null or (x.created_at, x.id) > (v_at, v_id)) limit v_limit + 1) c) > v_limit then
    select to_char(l.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || l.id::text into v_next
      from (select x.id, x.created_at from public.sell_list_rows x where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.removed_at is null
               and (v_q is null or x.name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
               and (v_at is null or (x.created_at, x.id) > (v_at, v_id))
             order by x.created_at, x.id limit 1 offset v_limit - 1) l;
  end if;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end;
$$;
revoke all on function public.sell_row_list(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.sell_row_list(uuid, uuid, integer, text, text) to authenticated;

create function public.sell_row_remove(p_tenant_id uuid, p_list_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  update public.sell_list_rows x set removed_at = coalesce(x.removed_at, now()), updated_by = v_uid, updated_at = now() where x.tenant_id = p_tenant_id and x.list_id = p_list_id and x.id = p_id;
  if not found then
    perform app.list_error('reference');
  end if;
  return jsonb_build_object('removed', true);
end;
$$;
revoke all on function public.sell_row_remove(uuid, uuid, uuid) from public, anon;
grant execute on function public.sell_row_remove(uuid, uuid, uuid) to authenticated;
