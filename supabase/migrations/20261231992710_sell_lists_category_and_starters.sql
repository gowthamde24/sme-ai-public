-- "What you sell" lists, round 2 (26 Nov 2026, owner: his own lists and categories; a textile shop sells more than sarees).
-- (1) a column ROLE `category` (type choice, one per list): the item's kind in one word; the phone assistant reads it with the item ("Silk blouse piece (Blouses), Price: Rs 450") and it is in the fact pack's items.
-- (2) the TRIAL list cap goes from 3 to 8 (paid stays 10).
-- (3) STARTER lists per pack: table public.sell_list_starters (data) and public.sell_lists_starters_make(tenant): creates the pack's lists that do not exist yet (by name), as many as the cap allows, through the lists' own functions.
-- Additive: the old role set stays valid; the functions below are the earlier ones with the changes named above.

-- ---- 1. the role
alter table public.sell_list_columns drop constraint if exists sell_list_columns_role_check;
alter table public.sell_list_columns add constraint sell_list_columns_role_check check (role in ('price', 'availability', 'quantity', 'how_to_buy', 'description', 'category'));
alter table public.sell_list_columns add constraint sell_list_columns_category_is_choice check (role is distinct from 'category' or type = 'choice');
drop index if exists public.sell_list_columns_one_role;
create unique index sell_list_columns_one_role on public.sell_list_columns (tenant_id, list_id, role) where role in ('availability', 'quantity', 'how_to_buy', 'description', 'category') and removed_at is null;

create or replace function public.sell_list_columns_put(p_tenant_id uuid, p_list_id uuid, p_columns jsonb, p_confirm boolean default false) returns jsonb
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
  if exists (select 1 from jsonb_array_elements(p_columns) e where e ->> 'role' in ('availability', 'quantity', 'how_to_buy', 'description', 'category') group by e ->> 'role' having count(*) > 1) then
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
       or (v_role is not null and v_role not in ('price', 'availability', 'quantity', 'how_to_buy', 'description', 'category')) then
      perform app.list_error('invalid');
    end if;
    if v_role = 'price' and v_type <> 'rupees' then
      perform app.list_error('not_a_price');
    end if;
    if (v_role = 'availability' and v_type <> 'choice') or (v_role = 'quantity' and v_type <> 'number') or (v_role = 'how_to_buy' and v_type <> 'link') or (v_role = 'description' and v_type <> 'text') or (v_role = 'category' and v_type <> 'choice') then
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

-- ---- 2. the trial cap (3 -> 8)
create or replace function public.sell_list_create(p_tenant_id uuid, p_id uuid, p_name text, p_kind text) returns jsonb
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
  v_cap := case when app.sell_list_paid(p_tenant_id) then 10 else 8 end;
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

-- ---- the readers: the category word travels with the item
create or replace function app.phone_exact_prices(p_tenant_id uuid, p_limit integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'unit', r.unit, 'paise', r.paise, 'moq', r.moq, 'tax_bps', r.tax_bps, 'tier', r.tier, 'label', r.label, 'period', r.period, 'default', r.is_default) order by r.rank, r.name, r.k), '[]'::jsonb)
    from (
      select 1 as rank, i.name, i.sale_unit::text as unit, i.unit_price_paise as paise, i.minimum_order_quantity as moq, i.tax_bps as tax_bps, false as tier, i.id::text as k, null::text as label, null::text as period, false as is_default
        from public.price_list_items i
       where i.tenant_id = p_tenant_id
         and i.version_id = (select v.id from public.price_list_versions v where v.tenant_id = p_tenant_id and v.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by v.effective_from desc, v.version_no desc, v.created_at desc limit 1)
      union all
      select 2, c.name, coalesce(c.sell_unit::text, 'piece'), c.price_paise, 1, null, false, c.id::text, null, null, false
        from public.catalogue_items c
       where c.tenant_id = p_tenant_id and c.active and c.price_paise is not null
      union all
      select 3, e.name, case e.style when 'services' then 'service' when 'courses' then 'course' else 'listing' end,
             (case e.style when 'courses' then e.data ->> 'fee_paise' else e.data ->> 'price_paise' end)::bigint, 1, null, false, e.id::text, null, null, false
        from public.sell_entries e
       where e.tenant_id = p_tenant_id and e.removed_at is null and e.style in ('services', 'courses', 'properties')
         and (case e.style when 'courses' then e.data ->> 'fee_paise' else e.data ->> 'price_paise' end) ~ '^[0-9]+$'
         and not (e.style = 'services' and coalesce((e.data ->> 'price_from')::boolean, false))
      union all
      select 3, e.name, coalesce(e.data ->> 'unit', 'piece'), (rt ->> 'rate_paise')::bigint, coalesce((rt ->> 'from_qty')::integer, 1), null, true, e.id::text || ':' || (rt ->> 'from_qty'), null, null, false
        from public.sell_entries e, jsonb_array_elements(case when jsonb_typeof(e.data -> 'rates') = 'array' then e.data -> 'rates' else '[]'::jsonb end) rt
       where e.tenant_id = p_tenant_id and e.removed_at is null and e.style = 'pricelist'
         and (e.data ->> 'good_until' is null or (e.data ->> 'good_until')::date >= (now() at time zone 'Asia/Kolkata')::date)
         and (rt ->> 'rate_paise') ~ '^[0-9]+$' and (rt ->> 'rate_paise')::bigint > 0
      union all
      select 4, r.name || coalesce(' (' || (r.cells ->> cat.key) || ')', ''), 'piece', (r.cells ->> c.key)::bigint, 1, null, false, r.id::text || ':' || c.key, c.label, c.billing_period, c.quote_default
        from public.sell_list_rows r
        join public.sell_lists l on l.tenant_id = r.tenant_id and l.id = r.list_id and l.removed_at is null
        join public.sell_list_columns c on c.tenant_id = r.tenant_id and c.list_id = r.list_id and c.removed_at is null and c.role = 'price' and c.billing_period <> 'from'
        left join public.sell_list_columns cat on cat.tenant_id = r.tenant_id and cat.list_id = r.list_id and cat.removed_at is null and cat.role = 'category'
       where r.tenant_id = p_tenant_id and r.removed_at is null and r.active and (r.cells ->> c.key) ~ '^[0-9]+$'
    ) r
   where r.paise is not null and r.paise > 0
   limit greatest(1, least(p_limit, 1000))
$$;
revoke all on function app.phone_exact_prices(uuid, integer) from public, anon, authenticated, service_role;

create or replace function public.phone_fact_pack(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_notes   text;
  v_faqs    jsonb;
  v_hours   jsonb;
  v_cat     jsonb;
  v_prices  jsonb;
  v_holidays jsonb;
  v_items   jsonb;
begin
  if auth.uid() is null or not app.is_scheduler() or p_tenant_id is null then
    perform app.phone_error('deny');
  end if;
  select a.notes into v_notes from public.assistant_context_versions a where a.tenant_id = p_tenant_id order by a.version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('q', f.question, 'a', f.answer) order by f.created_at, f.id), '[]'::jsonb)
    into v_faqs from (select x.question, x.answer, x.created_at, x.id from public.job_faqs x where x.tenant_id = p_tenant_id order by x.created_at, x.id limit 30) f;
  select jsonb_build_object('days', to_jsonb(s.call_days), 'from_minute', s.call_from_minute, 'to_minute', s.call_to_minute)
    into v_hours from public.assistant_settings s where s.tenant_id = p_tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'fabric', c.fabric, 'colours', to_jsonb(c.colours), 'occasions', to_jsonb(c.occasions), 'stock', c.stock_status) order by c.updated_at desc, c.id), '[]'::jsonb)
    into v_cat from (select x.name, x.fabric, x.colours, x.occasions, x.stock_status, x.updated_at, x.id from public.catalogue_items x where x.tenant_id = p_tenant_id and x.active order by x.updated_at desc, x.id limit 20) c;
  v_prices := app.phone_exact_prices(p_tenant_id, 40);
  -- the items of the owner's lists that say whether they are available, or say a short description (nothing else of a row is read)
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'category', x.cat, 'availability', x.av, 'description', x.dsc) order by x.name, x.id), '[]'::jsonb) into v_items from (
    select r.id, r.name, left(r.cells ->> ct.key, 40) as cat, r.cells ->> av.key as av, left(r.cells ->> d.key, 200) as dsc
      from public.sell_list_rows r
      join public.sell_lists l on l.tenant_id = r.tenant_id and l.id = r.list_id and l.removed_at is null
      left join public.sell_list_columns av on av.tenant_id = r.tenant_id and av.list_id = r.list_id and av.removed_at is null and av.role = 'availability'
      left join public.sell_list_columns d on d.tenant_id = r.tenant_id and d.list_id = r.list_id and d.removed_at is null and d.role = 'description'
      left join public.sell_list_columns ct on ct.tenant_id = r.tenant_id and ct.list_id = r.list_id and ct.removed_at is null and ct.role = 'category'
     where r.tenant_id = p_tenant_id and r.removed_at is null and r.active and (r.cells ->> av.key is not null or r.cells ->> d.key is not null or r.cells ->> ct.key is not null)
     order by r.name, r.id limit 30) x;
  -- the days the business is closed (the follow-up policy's holidays, the same list the call gate uses): today and the next 60 days
  select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into v_holidays from (
    select distinct d::text as h from public.followup_policy_versions p, unnest(p.holidays) d
     where p.tenant_id = p_tenant_id
       and p.version_no = (select max(q.version_no) from public.followup_policy_versions q where q.tenant_id = p_tenant_id and q.effective_from <= (now() at time zone 'Asia/Kolkata')::date)
       and d between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 60) x;
  return jsonb_build_object('notes', v_notes, 'faqs', v_faqs, 'hours', v_hours, 'catalogue', v_cat, 'prices', v_prices, 'holidays', v_holidays, 'items', v_items);
end;
$$;
revoke all on function public.phone_fact_pack(uuid) from public, anon;
grant execute on function public.phone_fact_pack(uuid) to authenticated;

-- ---- 3. starter lists
create table public.sell_list_starters (
  pack_code text not null,
  ord       integer not null check (ord between 1 and 10),
  name      text not null check (char_length(name) between 1 and 60 and app.text_is_clean(name)),
  kind      text not null check (kind in ('products', 'digital', 'services', 'bookings', 'courses', 'subscriptions', 'rentals', 'food', 'events', 'other')),
  columns   jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) <= 12),
  primary key (pack_code, ord)
);
alter table public.sell_list_starters enable row level security;
revoke all on public.sell_list_starters from public, anon, authenticated;
comment on table public.sell_list_starters is 'The starter lists of an industry pack (data written by migrations only). Read by public.sell_lists_starters_make.';
comment on column public.sell_list_starters.pack_code is 'SAFE: a pack code from packs.pack_versions';
comment on column public.sell_list_starters.ord is 'SAFE: the order the starters are made in';
comment on column public.sell_list_starters.name is 'SAFE: the list name, written by a migration. CLEAN-EXEMPT: fixed text';
comment on column public.sell_list_starters.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.sell_list_starters.columns is 'SAFE: the ordered column set (same shape as sell_list_columns_put takes), written by a migration. CLEAN-EXEMPT: fixed data';

insert into public.sell_list_starters (pack_code, ord, name, kind, columns) values
  ('textiles', 1, 'Sarees', 'products', '[{"label": "Price", "type": "rupees", "role": "price", "billing_period": "one_time", "quote_default": true}, {"label": "Category", "type": "choice", "role": "category", "choices": ["Silk", "Cotton", "Fancy", "Bridal", "Daily wear", "Other"]}, {"label": "Availability", "type": "choice", "role": "availability", "choices": ["In stock", "Few left", "Made to order", "Out of stock"]}, {"label": "Quantity", "type": "number", "role": "quantity"}, {"label": "Photo", "type": "photo"}]'::jsonb),
  ('textiles', 2, 'Dress materials', 'products', '[{"label": "Price", "type": "rupees", "role": "price", "billing_period": "one_time", "quote_default": true}, {"label": "Category", "type": "choice", "role": "category", "choices": ["Cotton", "Silk", "Georgette", "Cambric", "Other"]}, {"label": "Availability", "type": "choice", "role": "availability", "choices": ["In stock", "Few left", "Made to order", "Out of stock"]}, {"label": "Quantity", "type": "number", "role": "quantity"}, {"label": "Photo", "type": "photo"}]'::jsonb),
  ('textiles', 3, 'Blouses', 'products', '[{"label": "Price", "type": "rupees", "role": "price", "billing_period": "one_time", "quote_default": true}, {"label": "Category", "type": "choice", "role": "category", "choices": ["Ready-made", "Blouse piece", "Designer", "Other"]}, {"label": "Availability", "type": "choice", "role": "availability", "choices": ["In stock", "Few left", "Made to order", "Out of stock"]}, {"label": "Quantity", "type": "number", "role": "quantity"}, {"label": "Photo", "type": "photo"}]'::jsonb),
  ('textiles', 4, 'Dupattas', 'products', '[{"label": "Price", "type": "rupees", "role": "price", "billing_period": "one_time", "quote_default": true}, {"label": "Category", "type": "choice", "role": "category", "choices": ["Cotton", "Silk", "Net", "Other"]}, {"label": "Availability", "type": "choice", "role": "availability", "choices": ["In stock", "Few left", "Made to order", "Out of stock"]}, {"label": "Quantity", "type": "number", "role": "quantity"}, {"label": "Photo", "type": "photo"}]'::jsonb),
  ('textiles', 5, 'Fabric by the metre', 'products', '[{"label": "Price per metre", "type": "rupees", "role": "price", "billing_period": "per_unit", "quote_default": true}, {"label": "Category", "type": "choice", "role": "category", "choices": ["Cotton", "Silk", "Linen", "Lining", "Other"]}, {"label": "Availability", "type": "choice", "role": "availability", "choices": ["In stock", "Few left", "Made to order", "Out of stock"]}, {"label": "Quantity", "type": "number", "role": "quantity"}, {"label": "Photo", "type": "photo"}]'::jsonb),
  ('textiles', 6, 'Stitching and alterations', 'services', '[{"label": "Price", "type": "rupees", "role": "price", "billing_period": "one_time", "quote_default": true}, {"label": "Category", "type": "choice", "role": "category", "choices": ["Stitching", "Alteration", "Embroidery", "Other"]}, {"label": "Time", "type": "duration"}, {"label": "Description", "type": "text", "role": "description"}]'::jsonb);

create function public.sell_lists_starters_make(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_pack    text;
  s         public.sell_list_starters;
  v_id      uuid;
  v_n       integer;
  v_cap     integer;
  v_created text[] := '{}';
  v_have    text[] := '{}';
  v_skipped text[] := '{}';
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  select w.pack_code into v_pack from packs.workspace_pack w where w.tenant_id = p_tenant_id;
  v_cap := case when app.sell_list_paid(p_tenant_id) then 10 else 8 end;
  for s in select * from public.sell_list_starters x where x.pack_code = v_pack order by x.ord loop
    select count(*) into v_n from public.sell_lists x where x.tenant_id = p_tenant_id and x.removed_at is null;
    if exists (select 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.removed_at is null and lower(x.name) = lower(s.name)) then
      v_have := v_have || s.name;
    elsif v_n >= v_cap then
      v_skipped := v_skipped || s.name;
    else
      v_id := gen_random_uuid();
      perform public.sell_list_create(p_tenant_id, v_id, s.name, s.kind);
      perform public.sell_list_columns_put(p_tenant_id, v_id, s.columns, true);
      v_created := v_created || s.name;
    end if;
  end loop;
  return jsonb_build_object('created', to_jsonb(v_created), 'already_there', to_jsonb(v_have), 'skipped_cap', to_jsonb(v_skipped)) || public.sell_lists_list(p_tenant_id);
end;
$$;
revoke all on function public.sell_lists_starters_make(uuid) from public, anon;
grant execute on function public.sell_lists_starters_make(uuid) to authenticated;
