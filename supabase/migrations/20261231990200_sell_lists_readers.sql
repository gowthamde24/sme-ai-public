-- "What you sell" lists, slice 4 (28 Nov 2026): the READERS. (1) The phone assistant's prices also come from the owner's lists: every active item's cell in a PRICE column that is not a from-price and holds an exact amount, named with the column's label and period; the
-- column flagged "quote this one by default" is marked. (2) The pack also carries each list item's availability word and short description (nothing else of a row). (3) The lists screen sees what already exists as read-only BUILT-IN lists (the catalogue, services,
-- courses, properties, price lists and the quote price list), only the ones that have rows. Rollback = restore the earlier function bodies (989300, 990000); nothing is copied or moved.

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
      select 4, r.name, 'piece', (r.cells ->> c.key)::bigint, 1, null, false, r.id::text || ':' || c.key, c.label, c.billing_period, c.quote_default
        from public.sell_list_rows r
        join public.sell_lists l on l.tenant_id = r.tenant_id and l.id = r.list_id and l.removed_at is null
        join public.sell_list_columns c on c.tenant_id = r.tenant_id and c.list_id = r.list_id and c.removed_at is null and c.role = 'price' and c.billing_period <> 'from'
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
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'availability', x.av, 'description', x.dsc) order by x.name, x.id), '[]'::jsonb) into v_items from (
    select r.id, r.name, r.cells ->> av.key as av, left(r.cells ->> d.key, 200) as dsc
      from public.sell_list_rows r
      join public.sell_lists l on l.tenant_id = r.tenant_id and l.id = r.list_id and l.removed_at is null
      left join public.sell_list_columns av on av.tenant_id = r.tenant_id and av.list_id = r.list_id and av.removed_at is null and av.role = 'availability'
      left join public.sell_list_columns d on d.tenant_id = r.tenant_id and d.list_id = r.list_id and d.removed_at is null and d.role = 'description'
     where r.tenant_id = p_tenant_id and r.removed_at is null and r.active and (r.cells ->> av.key is not null or r.cells ->> d.key is not null)
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

-- ------------------------------------------------------------------------------------------------------------------------------ built-in lists: what already exists, shown beside the owner's own lists (read only here)
create function app.sell_builtin_lists(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(b.item order by b.n), '[]'::jsonb) from (
    select 1 as n, jsonb_build_object('id', md5('builtin:' || p_tenant::text || ':catalogue')::uuid, 'name', 'Sarees (catalogue)', 'kind', 'products', 'is_main', false, 'builtin', 'catalogue', 'edit_in', 'catalogue',
             'row_count', (select count(*) from public.catalogue_items c where c.tenant_id = p_tenant),
             'columns', jsonb_build_array(
               jsonb_build_object('key', 'price_paise', 'label', 'Exact price', 'type', 'rupees', 'role', 'price', 'billing_period', 'one_time', 'quote_default', true, 'choices', '[]'::jsonb),
               jsonb_build_object('key', 'stock_status', 'label', 'Stock', 'type', 'choice', 'role', 'availability', 'billing_period', null, 'quote_default', false, 'choices', jsonb_build_array('in_stock', 'few_left', 'made_to_order')),
               jsonb_build_object('key', 'price_band', 'label', 'Price range', 'type', 'choice', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', jsonb_build_array('under_5k', '5k_10k', '10k_25k', '25k_50k', 'above_50k')),
               jsonb_build_object('key', 'fabric', 'label', 'Fabric', 'type', 'text', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb))) as item
     where exists (select 1 from public.catalogue_items c where c.tenant_id = p_tenant)
    union all
    select 2 + s.o, jsonb_build_object('id', md5('builtin:' || p_tenant::text || ':' || s.style)::uuid, 'name', s.label, 'kind', s.kind, 'is_main', false, 'builtin', s.style, 'edit_in', 'what_you_sell',
             'row_count', (select count(*) from public.sell_entries e where e.tenant_id = p_tenant and e.style = s.style and e.removed_at is null),
             'columns', s.cols)
      from (values
        (1, 'services', 'Services', 'services', jsonb_build_array(jsonb_build_object('key', 'price_paise', 'label', 'Price', 'type', 'rupees', 'role', 'price', 'billing_period', 'one_time', 'quote_default', true, 'choices', '[]'::jsonb), jsonb_build_object('key', 'minutes', 'label', 'Time', 'type', 'duration', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb))),
        (2, 'courses', 'Courses', 'courses', jsonb_build_array(jsonb_build_object('key', 'fee_paise', 'label', 'Fee', 'type', 'rupees', 'role', 'price', 'billing_period', 'one_time', 'quote_default', true, 'choices', '[]'::jsonb), jsonb_build_object('key', 'starts_on', 'label', 'Starts', 'type', 'date', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb))),
        (3, 'properties', 'Properties', 'rentals', jsonb_build_array(jsonb_build_object('key', 'price_paise', 'label', 'Price', 'type', 'rupees', 'role', 'price', 'billing_period', 'one_time', 'quote_default', true, 'choices', '[]'::jsonb), jsonb_build_object('key', 'location', 'label', 'Location', 'type', 'text', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb))),
        (4, 'pricelist', 'Price lists (rates by quantity)', 'products', jsonb_build_array(jsonb_build_object('key', 'rates', 'label', 'Rates', 'type', 'text', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb), jsonb_build_object('key', 'moq', 'label', 'Smallest order', 'type', 'number', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb)))
      ) as s(o, style, label, kind, cols)
     where exists (select 1 from public.sell_entries e where e.tenant_id = p_tenant and e.style = s.style and e.removed_at is null)
    union all
    select 7, jsonb_build_object('id', md5('builtin:' || p_tenant::text || ':quote')::uuid, 'name', 'Quote price list', 'kind', 'products', 'is_main', false, 'builtin', 'quote', 'edit_in', 'price_list',
             'row_count', (select count(*) from public.price_list_items i where i.tenant_id = p_tenant and i.version_id = (select v.id from public.price_list_versions v where v.tenant_id = p_tenant and v.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by v.effective_from desc, v.version_no desc, v.created_at desc limit 1)),
             'columns', jsonb_build_array(jsonb_build_object('key', 'unit_price', 'label', 'Price', 'type', 'rupees', 'role', 'price', 'billing_period', 'per_unit', 'quote_default', true, 'choices', '[]'::jsonb), jsonb_build_object('key', 'moq', 'label', 'Smallest order', 'type', 'number', 'role', null, 'billing_period', null, 'quote_default', false, 'choices', '[]'::jsonb)))
     where exists (select 1 from public.price_list_versions v where v.tenant_id = p_tenant)
  ) b
$$;
revoke all on function app.sell_builtin_lists(uuid) from public, anon, authenticated, service_role;

create or replace function public.sell_lists_list(p_tenant_id uuid) returns jsonb
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
                                                from public.sell_lists l where l.tenant_id = p_tenant_id and l.removed_at is null), '[]'::jsonb)
                                     || app.sell_builtin_lists(p_tenant_id));
end;
$$;
