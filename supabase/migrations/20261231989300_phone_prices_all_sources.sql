-- Where the phone assistant's prices come from (28 Nov 2026). A business's prices live in THREE places, depending on its kind: the quote engine's price list (rows with a product and a SKU), the catalogue's exact price (`catalogue_items.price_paise`,
-- what a saree shop fills in when it adds a saree) and "what you sell" entries (a service's, a course's or a property's price, and a price list's rates). The pack, the readiness counts and the Today item used only the first, so a shop that did
-- the natural thing (add sarees with prices) was still told "add your price list" and the assistant refused every price. One helper now answers for all three, and ONLY EXACT amounts count: a service price marked "from", a price band
-- and an expired price list are never offered as an amount (the spoken-amount guard allows exactly the amounts the pack carries).

create function app.phone_exact_prices(p_tenant_id uuid, p_limit integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'unit', r.unit, 'paise', r.paise, 'moq', r.moq, 'tax_bps', r.tax_bps, 'tier', r.tier) order by r.rank, r.name, r.k), '[]'::jsonb)
    from (
      select 1 as rank, i.name, i.sale_unit::text as unit, i.unit_price_paise as paise, i.minimum_order_quantity as moq, i.tax_bps as tax_bps, false as tier, i.id::text as k
        from public.price_list_items i
       where i.tenant_id = p_tenant_id
         and i.version_id = (select v.id from public.price_list_versions v where v.tenant_id = p_tenant_id and v.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by v.effective_from desc, v.version_no desc, v.created_at desc limit 1)
      union all
      select 2, c.name, coalesce(c.sell_unit::text, 'piece'), c.price_paise, 1, null, false, c.id::text
        from public.catalogue_items c
       where c.tenant_id = p_tenant_id and c.active and c.price_paise is not null
      union all
      select 3, e.name, case e.style when 'services' then 'service' when 'courses' then 'course' else 'listing' end,
             (case e.style when 'courses' then e.data ->> 'fee_paise' else e.data ->> 'price_paise' end)::bigint, 1, null, false, e.id::text
        from public.sell_entries e
       where e.tenant_id = p_tenant_id and e.removed_at is null and e.style in ('services', 'courses', 'properties')
         and (case e.style when 'courses' then e.data ->> 'fee_paise' else e.data ->> 'price_paise' end) ~ '^[0-9]+$'
         and not (e.style = 'services' and coalesce((e.data ->> 'price_from')::boolean, false))
      union all
      select 3, e.name, coalesce(e.data ->> 'unit', 'piece'), (rt ->> 'rate_paise')::bigint, coalesce((rt ->> 'from_qty')::integer, 1), null, true, e.id::text || ':' || (rt ->> 'from_qty')
        from public.sell_entries e, jsonb_array_elements(case when jsonb_typeof(e.data -> 'rates') = 'array' then e.data -> 'rates' else '[]'::jsonb end) rt
       where e.tenant_id = p_tenant_id and e.removed_at is null and e.style = 'pricelist'
         and (e.data ->> 'good_until' is null or (e.data ->> 'good_until')::date >= (now() at time zone 'Asia/Kolkata')::date)
         and (rt ->> 'rate_paise') ~ '^[0-9]+$' and (rt ->> 'rate_paise')::bigint > 0
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
  -- the days the business is closed (the follow-up policy's holidays, the same list the call gate uses): today and the next 60 days
  select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into v_holidays from (
    select distinct d::text as h from public.followup_policy_versions p, unnest(p.holidays) d
     where p.tenant_id = p_tenant_id
       and p.version_no = (select max(q.version_no) from public.followup_policy_versions q where q.tenant_id = p_tenant_id and q.effective_from <= (now() at time zone 'Asia/Kolkata')::date)
       and d between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 60) x;
  return jsonb_build_object('notes', v_notes, 'faqs', v_faqs, 'hours', v_hours, 'catalogue', v_cat, 'prices', v_prices, 'holidays', v_holidays);
end;
$$;


revoke all on function public.phone_fact_pack(uuid) from public, anon;
grant execute on function public.phone_fact_pack(uuid) to authenticated;

create or replace function public.phone_assistant_knows(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_notes text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  select a.notes into v_notes from public.assistant_context_versions a where a.tenant_id = p_tenant_id order by a.version desc limit 1;
  return jsonb_build_object(
    'price_rows', jsonb_array_length(app.phone_exact_prices(p_tenant_id, 1000)),
    'catalogue_items', (select count(*) from public.catalogue_items c where c.tenant_id = p_tenant_id and c.active),
    'faq_answers', (select count(*) from public.job_faqs f where f.tenant_id = p_tenant_id),
    'notes_lines', (select count(*) from unnest(string_to_array(coalesce(v_notes, ''), E'\n')) l where btrim(l) <> ''),
    'has_hours', exists (select 1 from public.assistant_settings s where s.tenant_id = p_tenant_id));
end $$;
revoke all on function public.phone_assistant_knows(uuid) from public, anon;
grant execute on function public.phone_assistant_knows(uuid) to authenticated;

-- the Today item "add your price list": gone as soon as ANY of the three sources has an exact price
create or replace function app.today_phone_needs_prices(p_tenant uuid) returns table (id uuid, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('prices:' || p_tenant::text)::uuid, app.outbox_now()
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and exists (select 1 from public.phone_numbers n where n.tenant_id = p_tenant)
     and jsonb_array_length(app.phone_exact_prices(p_tenant, 1)) = 0
$$;
