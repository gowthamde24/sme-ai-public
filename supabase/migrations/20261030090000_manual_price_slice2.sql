-- Manual-price quote, slice 2 (the manual kind in the database; GST required). Owner decisions of 2026-10-08 (docs/plans/manual-price-quote-plan.md, sections 22 and 23).
-- List-price quotes behave exactly as before: no list function or list figure is touched except app.quote_error (one new code) and public.approve_quote (the manual branch).
--
--   1. gst_rate_bps is a required choice: the policy create function refuses a policy without it and the column has no default. Existing versions keep their stored rate.
--   2. quotes.pricing_kind ('list' default, 'manual'). For the manual kind ONLY: price_list_version_id, delivery_state and gst_supply may be null (a table CHECK makes all
--      three required for the list kind and the price list version absent for the manual kind); quote_lines.product_id may be null and the line names an item type
--      (item_type_code) and says who priced it (price_source: 'list' or 'typed_by_person'). No UPDATE touches an existing row: the new columns have defaults.
--   3. app.quote_build_manual: the database's own recomputation of a manual quote (typed prices; GST at the policy rate in force on the quote date, per line, half up, in
--      integer paise; no courier; the engine request is built from the lines, one synthetic sku per line). The pinned engine (1.1.0) is used exactly as for a list quote:
--      the API runs it on this request and the database compares the request and every figure, byte for byte.
--   4. public.create_manual_quote_draft: Owner / Admin only, never inside an agent context (SM260), never takes a price from anything but its own argument.
--   5. TYPED_PRICE_OUTSIDE_RANGE: a review flag the database derives when a typed price lies outside its item type's range. A soft warning: it flags the quote for the Owner
--      like the other review flags (the Owner approves; nothing is refused).
--   6. public.approve_quote: the same function plus a manual branch (rebuild from the stored lines; no price-list staleness test for a manual quote).
-- Append-only: no old migration is edited.

-- =============================================================================================
-- 1. GST is a required choice
-- =============================================================================================
alter table public.quote_policy_versions alter column gst_rate_bps drop default;

create or replace function app.quote_create_policy_version(p_version_id uuid, p_tenant uuid, p_effective date, p_policy jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ceiling bigint; v_fee bigint; v_free bigint; v_shiptax bigint; v_valid bigint; v_new bigint; v_rep bigint; v_netnew bigint; v_netrep bigint; v_credit bigint;
  v_gst bigint; v_gstfrom date; v_gsttxt text;
  v_tax text; v_round text; v_state text; v_inputs public.quote_input_key[] := '{}';
  x jsonb;
  v_norm jsonb; v_hash text; v_latest date; v_no integer; v_exist public.quote_policy_versions;
begin
  if p_version_id is null or p_tenant is null or p_policy is null or jsonb_typeof(p_policy) <> 'object' or exists (select 1 from jsonb_object_keys(p_policy) k
       where k <> all (array['discount_ceiling_bps', 'shipping_flat_fee_paise', 'shipping_free_above_paise', 'shipping_tax_bps', 'validity_days',
                             'new_advance_bps', 'repeat_advance_bps', 'new_net_days', 'repeat_net_days', 'gst_rate_bps', 'gst_effective_from',
                             'tax_mode', 'rounding_mode', 'repeat_credit_limit_paise',
                             'seller_state', 'required_inputs'])) then
    perform app.quote_error('invalid');
  end if;
  v_ceiling := app.quote_int(p_policy, 'discount_ceiling_bps', 0, 10000);
  v_fee     := app.quote_int(p_policy, 'shipping_flat_fee_paise', 0, 100000000);
  v_free    := app.quote_int(p_policy, 'shipping_free_above_paise', 0, 100000000, false);
  v_shiptax := app.quote_int(p_policy, 'shipping_tax_bps', 0, 10000, false);
  v_valid   := app.quote_int(p_policy, 'validity_days', 1, 365);
  v_new     := app.quote_int(p_policy, 'new_advance_bps', 0, 10000);
  v_rep     := app.quote_int(p_policy, 'repeat_advance_bps', 0, 10000);
  v_netnew  := app.quote_int(p_policy, 'new_net_days', 0, 180);
  v_netrep  := app.quote_int(p_policy, 'repeat_net_days', 0, 180);
  -- GST for manual-price quotes (the price list keeps its own rate per item): the rate (required) and the date it applies from (not given: the version's own date).
  -- The shipping tax is not typed separately: it follows the goods rate unless a caller still sends it (list-price quotes)
  v_gst     := app.quote_int(p_policy, 'gst_rate_bps', 0, 2800);   -- a required choice: no default (slice 2)
  v_shiptax := coalesce(v_shiptax, v_gst);
  v_gsttxt  := app.quote_text(p_policy, 'gst_effective_from', 10, 10, false);
  if v_gsttxt is null then
    v_gstfrom := p_effective;
  else
    if v_gsttxt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      perform app.quote_error('value');
    end if;
    begin
      v_gstfrom := v_gsttxt::date;
    exception when others then
      v_gstfrom := null;
    end;
    if v_gstfrom is null or to_char(v_gstfrom, 'YYYY-MM-DD') <> v_gsttxt or v_gstfrom not between date '2000-01-01' and date '2100-01-01' then
      perform app.quote_error('value');
    end if;
  end if;
  v_credit  := coalesce(app.quote_int(p_policy, 'repeat_credit_limit_paise', 0, 1000000000, false), 0);
  v_tax     := coalesce(app.quote_text(p_policy, 'tax_mode', 1, 20, false), 'exclusive');
  v_round   := coalesce(app.quote_text(p_policy, 'rounding_mode', 1, 20, false), 'half_up');
  v_state   := app.quote_text(p_policy, 'seller_state', 2, 2);
  if v_tax <> 'exclusive' or v_round <> all (array['half_up', 'half_even', 'down']) or v_state !~ '^[A-Z]{2}$' then
    perform app.quote_error('value');
  end if;
  if p_policy ? 'required_inputs' then
    if jsonb_typeof(p_policy -> 'required_inputs') <> 'array' or jsonb_array_length(p_policy -> 'required_inputs') > 4 then
      perform app.quote_error('invalid');
    end if;
    for x in select y from jsonb_array_elements(p_policy -> 'required_inputs') y loop
      if jsonb_typeof(x) <> 'string' or (x #>> '{}') <> all (array['delivery_state', 'delivery_city', 'payment_terms', 'deadline'])
         or (x #>> '{}')::public.quote_input_key = any (v_inputs) then
        perform app.quote_error('value');
      end if;
      v_inputs := v_inputs || (x #>> '{}')::public.quote_input_key;
    end loop;
  else
    v_inputs := array['delivery_state']::public.quote_input_key[];
  end if;
  if not ('delivery_state' = any (v_inputs)) then
    perform app.quote_error('value');
  end if;
  v_norm := jsonb_build_object(
    'discount_ceiling_bps', v_ceiling, 'shipping_flat_fee_paise', v_fee, 'shipping_free_above_paise', v_free, 'shipping_tax_bps', v_shiptax,
    'validity_days', v_valid, 'new_advance_bps', v_new, 'repeat_advance_bps', v_rep, 'new_net_days', v_netnew, 'repeat_net_days', v_netrep,
    'gst_rate_bps', v_gst, 'gst_effective_from', to_char(v_gstfrom, 'YYYY-MM-DD'), 'tax_mode', v_tax, 'rounding_mode', v_round,
    'repeat_credit_limit_paise', v_credit, 'seller_state', v_state,
    'required_inputs', (select jsonb_agg(i order by i) from unnest(v_inputs::text[]) i));
  v_hash := app.quote_content_hash(v_norm);

  perform pg_advisory_xact_lock(hashtextextended('quote_ref:policy:' || p_tenant::text, 0));
  select * into v_exist from public.quote_policy_versions v where v.id = p_version_id;
  if found then
    if v_exist.tenant_id = p_tenant and v_exist.content_sha256 = v_hash and v_exist.effective_from = p_effective then
      return jsonb_build_object('version_id', v_exist.id, 'version_no', v_exist.version_no, 'effective_from', v_exist.effective_from,
                                'content_sha256', v_exist.content_sha256, 'replayed', true);
    end if;
    perform app.quote_error('conflict');
  end if;
  select max(v.effective_from), coalesce(max(v.version_no), 0) + 1 into v_latest, v_no from public.quote_policy_versions v where v.tenant_id = p_tenant;
  perform app.quote_check_effective(p_effective, v_latest);
  insert into public.quote_policy_versions
    (id, tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_free_above_paise, shipping_tax_bps, validity_days,
     new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, tax_mode, rounding_mode, repeat_credit_limit_paise, seller_state,
     required_inputs, content_sha256)
  values
    (p_version_id, p_tenant, v_no, p_effective, v_ceiling, v_fee, v_free, v_shiptax, v_valid, v_new, v_rep, v_netnew, v_netrep, v_gst, v_gstfrom, v_tax::public.quote_tax_mode,
     v_round::public.quote_rounding_mode, v_credit, v_state, v_inputs, v_hash);
  return jsonb_build_object('version_id', p_version_id, 'version_no', v_no, 'effective_from', p_effective, 'content_sha256', v_hash, 'replayed', false);
end;
$$;

create or replace function app.operator_seed_quote_reference_data(p_tenant_slug text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_items  jsonb;
  v_made   text[] := '{}';
  v_today  date := app.quote_today();
begin
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  insert into public.products (tenant_id, sku, name, description, unit, category, attributes) values
    (v_tenant, 'SYN-KJ-RED-01',  'SYNTHETIC Kanjivaram silk saree, red',   'Synthetic demo product', 'piece', 'kanjivaram', '{"fabric": "silk", "colour": "red"}'),
    (v_tenant, 'SYN-KJ-BLUE-01', 'SYNTHETIC Kanjivaram silk saree, blue',  'Synthetic demo product', 'piece', 'kanjivaram', '{"fabric": "silk", "colour": "blue"}'),
    (v_tenant, 'SYN-BN-RED-01',  'SYNTHETIC Banarasi silk saree, red',     'Synthetic demo product', 'piece', 'banarasi',   '{"fabric": "silk", "colour": "red"}'),
    (v_tenant, 'SYN-BN-GOLD-01', 'SYNTHETIC Banarasi silk saree, gold',    'Synthetic demo product', 'piece', 'banarasi',   '{"fabric": "silk", "colour": "gold"}'),
    (v_tenant, 'SYN-PT-GREEN-01', 'SYNTHETIC Paithani silk saree, green',  'Synthetic demo product', 'piece', 'paithani',   '{"fabric": "silk", "colour": "green"}'),
    (v_tenant, 'SYN-PT-SET-01',  'SYNTHETIC Paithani silk saree, set of 3', 'Synthetic demo product', 'set',   'paithani',   '{"fabric": "silk", "colour": "green"}')
  on conflict (tenant_id, sku) do nothing;

  if not exists (select 1 from public.price_list_versions v where v.tenant_id = v_tenant) and coalesce(current_setting('app.seed_skip_price_list', true), '') <> 'on' then
    select jsonb_agg(jsonb_build_object(
             'product_id', p.id, 'sale_unit', case when p.sku = 'SYN-PT-SET-01' then 'set' else 'piece' end,
             -- SYNTHETIC numbers: a price in paise, a minimum quantity, a rate in basis points and one break per item
             'unit_price_paise', case p.category when 'kanjivaram' then 420000 when 'banarasi' then 310000 else 280000 end,
             'minimum_order_quantity', 4, 'tax_bps', 500,
             'breaks', jsonb_build_array(jsonb_build_object('min_qty', 10, 'unit_price_paise',
                         case p.category when 'kanjivaram' then 400000 when 'banarasi' then 295000 else 265000 end))))
      into v_items from public.products p where p.tenant_id = v_tenant and p.sku like 'SYN-%';
    perform app.quote_create_price_version(gen_random_uuid(), v_tenant, v_today, v_items);
    v_made := array_append(v_made, 'price_list_version');
  end if;
  if not exists (select 1 from public.quote_policy_versions v where v.tenant_id = v_tenant) then
    perform app.quote_create_policy_version(gen_random_uuid(), v_tenant, v_today, jsonb_build_object(
      'discount_ceiling_bps', 0, 'shipping_flat_fee_paise', 0, 'shipping_tax_bps', 0, 'validity_days', 15, 'new_advance_bps', 5000,
      'repeat_advance_bps', 2500, 'new_net_days', 30, 'repeat_net_days', 30, 'gst_rate_bps', 500, 'tax_mode', 'exclusive', 'rounding_mode', 'half_up', 'repeat_credit_limit_paise', 50000000,
      'seller_state', 'TG', 'required_inputs', jsonb_build_array('delivery_state')));
    v_made := array_append(v_made, 'quote_policy_version');
  end if;
  if not exists (select 1 from public.mapper_config_versions v where v.tenant_id = v_tenant) then
    perform app.quote_create_mapper_version(gen_random_uuid(), v_tenant, v_today, 'piece', jsonb_build_object(
      'saree_type_to_categories', jsonb_build_object('kanjivaram', jsonb_build_array('kanjivaram'), 'banarasi', jsonb_build_array('banarasi'),
                                                     'paithani', jsonb_build_array('paithani')),
      'fabric_to_values', jsonb_build_object('silk', jsonb_build_array('silk')),
      'colour_to_values', jsonb_build_object('red', jsonb_build_array('red'), 'blue', jsonb_build_array('blue'), 'gold', jsonb_build_array('gold'),
                                             'green', jsonb_build_array('green'))));
    v_made := array_append(v_made, 'mapper_config_version');
  end if;
  return jsonb_build_object('tenant_id', v_tenant, 'created', to_jsonb(v_made),
                            'products', (select count(*) from public.products p where p.tenant_id = v_tenant and p.sku like 'SYN-%'));
end;
$$;

-- =============================================================================================
-- 2. The manual kind: columns and checks
-- =============================================================================================
create type public.quote_pricing_kind as enum ('list', 'manual');
alter type public.quote_review_flag add value if not exists 'TYPED_PRICE_OUTSIDE_RANGE';

alter table public.quotes add column pricing_kind public.quote_pricing_kind not null default 'list';
alter table public.quotes alter column price_list_version_id drop not null;
alter table public.quotes alter column delivery_state drop not null;
alter table public.quotes alter column gst_supply drop not null;
alter table public.quotes add constraint quotes_pricing_kind_check check (
  (pricing_kind = 'list' and price_list_version_id is not null and delivery_state is not null and gst_supply is not null)
  or (pricing_kind = 'manual' and price_list_version_id is null and (delivery_state is null) = (gst_supply is null)));
-- a manual quote is written only by the person-only function: a row stamped by an agent context (created_via, set from the same setting by the existing trigger) cannot be manual
alter table public.quotes add constraint quotes_manual_origin_check check (pricing_kind <> 'manual' or created_via = 'manual');

alter table public.quote_lines alter column product_id drop not null;
alter table public.quote_lines add column price_source text not null default 'list' check (price_source in ('list', 'typed_by_person'));
alter table public.quote_lines add column item_type_code text;
alter table public.quote_lines add constraint quote_lines_item_type_fk foreign key (tenant_id, item_type_code) references public.item_types (tenant_id, code);
alter table public.quote_lines add constraint quote_lines_price_source_kind_check check (
  (price_source = 'list' and product_id is not null and item_type_code is null)
  or (price_source = 'typed_by_person' and product_id is null and item_type_code is not null));
create index quote_lines_item_type_idx on public.quote_lines (tenant_id, item_type_code);
comment on column public.quote_lines.price_source is 'SAFE: who set the price, list or typed_by_person (written only by the quote functions). CLEAN-EXEMPT: a closed list enforced by a CHECK';
comment on column public.quote_lines.item_type_code is 'SAFE: the code of the item type of a manual line. CLEAN-EXEMPT: a foreign key to item_types.code, whose strict pattern applies';

-- the one new refusal code of this module: a typed price from an agent context
create or replace function app.quote_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'conflict' then 'record id already used'
      when 'value' then 'value not allowed'
      when 'reference' then 'invalid reference'
      when 'SM212' then 'a quote depends on this requirement'
      when 'SM213' then 'requirement is not confirmed'
      when 'SM214' then 'quote is not a draft'
      when 'SM215' then 'quote is stale'
      when 'SM216' then 'quote does not match its recomputation'
      when 'SM217' then 'quote input missing'
      when 'SM218' then 'quote needs owner approval'
      when 'SM260' then 'a price can only be typed by a person'
      else 'invalid argument' end
    using errcode = case when p_code ~ '^SM2[0-9]{2}$' then p_code
                         else case p_code when 'conflict' then '23505' when 'value' then '23514' when 'reference' then '23503' else '22023' end end;
end;
$$;

-- =============================================================================================
-- 3. app.quote_build_manual: the database's recomputation of a manual quote
--    p_lines: [{item_type_code, name, qty, unit_price_paise}] in line order (the name is the item type's name when the quote is made, the stored line's name when it is approved)
-- =============================================================================================
create function app.quote_build_manual(p_tenant uuid, p_as_of date, p_kind text, p_policy_version uuid, p_lines jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  pol       public.quote_policy_versions;
  x         jsonb;
  v_rate    integer;
  v_idx     smallint := 0;
  v_code    text;
  v_name    text;
  v_qty     integer;
  v_price   bigint;
  v_sku     text;
  v_sub     bigint;
  v_tax     bigint;
  v_net     bigint := 0;
  v_itax    bigint := 0;
  v_total   bigint;
  v_adv     bigint;
  v_bal     bigint;
  v_adv_bps integer;
  v_lines   jsonb := '[]'::jsonb;
  v_rows    jsonb := '[]'::jsonb;
  v_olines  jsonb := '[]'::jsonb;
  v_pl      jsonb := '[]'::jsonb;
  v_flags   text[] := '{}';
  v_review  text[] := '{}';
  v_outside boolean := false;
  v_customer jsonb;
  v_policy  jsonb;
begin
  select * into pol from public.quote_policy_versions v where v.tenant_id = p_tenant and v.id = p_policy_version;
  if pol.id is null or p_kind is null or p_kind <> all (array['new', 'repeat']) or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 5 then
    perform app.quote_error('SM217');
  end if;
  -- GST applies to every manual quote: no rate in force on the quote date, no quote (nothing is guessed)
  v_rate := app.quote_gst_bps_on(p_tenant, p_policy_version, p_as_of);
  if v_rate is null then
    perform app.quote_error('SM217');
  end if;

  for x in select e from jsonb_array_elements(p_lines) e loop
    v_idx := v_idx + 1;
    if jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'item_type_code') <> 'string' or jsonb_typeof(x -> 'name') <> 'string'
       or jsonb_typeof(x -> 'qty') <> 'number' or jsonb_typeof(x -> 'unit_price_paise') <> 'number'
       or (x ->> 'qty') !~ '^[0-9]{1,5}$' or (x ->> 'unit_price_paise') !~ '^[0-9]{1,9}$' then
      perform app.quote_error('SM217');
    end if;
    v_code  := x ->> 'item_type_code';
    v_name  := x ->> 'name';
    v_qty   := (x ->> 'qty')::integer;
    v_price := (x ->> 'unit_price_paise')::bigint;
    if v_qty not between 1 and 10000 or v_price not between 1 and 100000000 or char_length(btrim(v_name)) not between 1 and 200 or not app.text_is_clean(v_name) then
      perform app.quote_error('SM217');
    end if;
    v_sku := 'LINE-' || v_idx;
    v_sub := v_price * v_qty;
    v_tax := app.quote_gst_paise(v_sub, v_rate);          -- per line, half up, integer paise
    v_net := v_net + v_sub;
    v_itax := v_itax + v_tax;
    if app.item_type_price_outside_range(p_tenant, v_code, v_price) then
      v_outside := true;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('sku', v_sku, 'name', v_name, 'quantity', v_qty, 'unit_price_applied', v_price,
      'price_break_applied', 'null'::jsonb, 'line_subtotal', v_sub, 'discount', 0, 'net', v_sub, 'tax', v_tax, 'gross', v_sub + v_tax));
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('line_no', v_idx, 'requirement_line_no', v_idx, 'product_id', null, 'sku', v_sku,
      'name', v_name, 'sale_unit', 'piece', 'qty', v_qty, 'unit_price', v_price, 'break_min_qty', null, 'subtotal', v_sub, 'tax', v_tax, 'tax_bps', v_rate,
      'item_type_code', v_code));
    v_olines := v_olines || jsonb_build_array(jsonb_build_object('sku', v_sku, 'qty', v_qty));
    v_pl := v_pl || jsonb_build_array(jsonb_build_object('sku', v_sku, 'name', v_name, 'unit_price', v_price, 'minimum_order_quantity', 1,
      'price_breaks', '[]'::jsonb, 'tax_bps', v_rate));
  end loop;
  select jsonb_agg(e order by (e ->> 'sku') collate "C") into v_pl from jsonb_array_elements(v_pl) e;

  -- no courier: the shipping rule is fixed at a zero fee; its tax follows the GST rate (never shipping_tax_bps). The manual kind rounds half up everywhere (the engine has one mode per request).
  v_total := v_net + v_itax;
  v_adv_bps := case p_kind when 'new' then pol.new_advance_bps else pol.repeat_advance_bps end;
  v_adv := app.quote_round(v_total * v_adv_bps, 10000, 'half_up');
  v_bal := v_total - v_adv;
  if p_kind = 'repeat' and v_bal > pol.repeat_credit_limit_paise then
    v_flags := array_append(v_flags, 'CREDIT_LIMIT_EXCEEDED');
  end if;
  if p_kind = 'repeat' then
    v_review := array_append(v_review, 'REPEAT_CUSTOMER_CLAIMED');
  end if;
  if v_outside then
    v_review := array_append(v_review, 'TYPED_PRICE_OUTSIDE_RANGE');
  end if;

  v_customer := case p_kind when 'new' then jsonb_build_object('kind', 'new')
                            else jsonb_build_object('kind', 'repeat', 'credit_limit', pol.repeat_credit_limit_paise) end;
  v_policy := jsonb_build_object(
    'discount_ceiling_bps', pol.discount_ceiling_bps,
    'shipping', jsonb_build_object('flat_fee', 0, 'tax_bps', v_rate),
    'validity_days', pol.validity_days,
    'payment_terms', jsonb_build_object('new_advance_bps', pol.new_advance_bps, 'repeat_advance_bps', pol.repeat_advance_bps,
                                        'net_days', (case p_kind when 'new' then pol.new_net_days else pol.repeat_net_days end)),
    'tax_mode', pol.tax_mode::text, 'rounding_mode', 'half_up');
  return jsonb_build_object(
    'request', jsonb_build_object('as_of', p_as_of::text, 'price_list', v_pl, 'customer', v_customer, 'order_lines', v_olines, 'policy', v_policy),
    'core', jsonb_build_object(
      'lines', v_lines,
      'totals', jsonb_build_object('subtotal', v_net, 'discount', 0, 'net', v_net, 'tax', v_itax, 'item_tax', v_itax, 'shipping_tax', 0,
                                   'shipping', 0, 'shipping_gross', 0, 'total', v_total),
      'payment_terms', jsonb_build_object('advance_amount', v_adv, 'balance', v_bal,
                                          'due_date', (p_as_of + (case p_kind when 'new' then pol.new_net_days else pol.repeat_net_days end))::text),
      'valid_until', (p_as_of + pol.validity_days)::text),
    'flags', (select coalesce(jsonb_agg(f order by f collate "C"), '[]'::jsonb) from unnest(v_flags) f),
    'review', (select coalesce(jsonb_agg(f order by f collate "C"), '[]'::jsonb) from unnest(v_review) f),
    'rows', v_rows,
    'merchandise_net', v_net, 'item_tax', v_itax, 'shipping_net', 0, 'shipping_tax', 0, 'total', v_total, 'advance', v_adv, 'balance', v_bal,
    'due_date', p_as_of + (case p_kind when 'new' then pol.new_net_days else pol.repeat_net_days end), 'valid_until', p_as_of + pol.validity_days,
    'seller_state', pol.seller_state);
end;
$$;
revoke all on function app.quote_build_manual(uuid, date, text, uuid, jsonb) from public;

-- =============================================================================================
-- 4. public.create_manual_quote_draft
--    p_lines: [{"item_type_code": "01", "qty": 12, "unit_price_paise": 250000}, ...] (1 to 5 lines; these three keys and no other). The prices are typed by the person and
--    arrive only here. The API runs the pinned engine on the request this function expects and hands over request and result; the database compares both with its own recomputation.
--    A manual quote hangs on an enquiry's requirement like a list quote. A requirement with no fields, confirmed by this function, stands for "the typed lines"; an enquiry that
--    already has any other active requirement (an agent draft or a confirmed list requirement) is refused with SM208 until that is discarded.
-- =============================================================================================
create function public.create_manual_quote_draft(
  p_quote_id uuid, p_enquiry_id uuid, p_customer_kind text, p_delivery_state text, p_engine_version text, p_request_text text, p_result_text text, p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  e         public.enquiries;
  q         public.requirements;
  t         public.item_types;
  v_exist   public.quotes;
  v_today   date := app.quote_today();
  v_as_of   date;
  v_polver  uuid;
  v_build   jsonb;
  v_req     jsonb;
  v_res     jsonb;
  v_hash    text;
  v_flags   text[];
  v_review  text[];
  v_needs   boolean;
  v_supply  public.quote_gst_supply;
  v_in      jsonb := '[]'::jsonb;
  v_same    boolean;
  v_no      integer;
  l         jsonb;
  x         jsonb;
begin
  if v_uid is null or p_quote_id is null or p_enquiry_id is null then
    perform app.quote_deny();
  end if;
  select * into e from public.enquiries z where z.id = p_enquiry_id;
  if not found or not app.has_tenant_role(e.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  -- a price is typed by a person: never inside an agent context (the agent functions set these two settings for one call)
  if coalesce(current_setting('app.agent_run_id', true), '') <> '' or coalesce(current_setting('app.created_via', true), '') = 'agent' then
    perform app.quote_error('SM260');
  end if;
  -- lock order: the enquiry row, then the requirement row, then (below) the tenant's quote numbers
  select * into e from public.enquiries z where z.tenant_id = e.tenant_id and z.id = e.id for update;

  if p_customer_kind is null or p_customer_kind <> all (array['new', 'repeat'])
     or (p_delivery_state is not null and p_delivery_state !~ '^[A-Z]{2}$')
     or p_engine_version is null or p_request_text is null or p_result_text is null
     or char_length(p_request_text) > 50000 or char_length(p_result_text) > 200000 or not app.text_is_clean(p_request_text) or not app.text_is_clean(p_result_text)
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 5 then
    perform app.quote_error('invalid');
  end if;
  -- the typed lines: exactly these three keys, nothing else (a price_source or a name of the caller's is refused)
  for x in select z from jsonb_array_elements(p_lines) z loop
    if jsonb_typeof(x) <> 'object' or exists (select 1 from jsonb_object_keys(x) k where k <> all (array['item_type_code', 'qty', 'unit_price_paise'])) then
      perform app.quote_error('invalid');
    end if;
    perform app.quote_int(x, 'qty', 1, 10000);
    perform app.quote_int(x, 'unit_price_paise', 1, 100000000);
    if app.quote_text(x, 'item_type_code', 1, 20) !~ '^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$' then
      perform app.quote_error('invalid');
    end if;
    -- the item type of THIS workspace, and still sold; its name becomes the line's label
    select * into t from public.item_types i where i.tenant_id = e.tenant_id and i.code = x ->> 'item_type_code';
    if not found then
      perform app.quote_error('reference');
    end if;
    if not t.active then
      perform app.quote_error('value');
    end if;
    v_in := v_in || jsonb_build_array(jsonb_build_object('item_type_code', t.code, 'name', t.name, 'qty', (x ->> 'qty')::integer, 'unit_price_paise', (x ->> 'unit_price_paise')::bigint));
  end loop;
  begin
    v_req := p_request_text::jsonb;
    v_res := p_result_text::jsonb;
  exception when others then
    perform app.quote_error('invalid');
  end;
  if jsonb_typeof(v_req) <> 'object' or jsonb_typeof(v_res) <> 'object' then
    perform app.quote_error('invalid');
  end if;
  v_hash := app.quote_request_hash(p_engine_version, p_request_text);

  -- an exact retry (same id, same enquiry, same hash, same typed lines and choices) replays; anything else under a used id is the constant conflict
  select * into v_exist from public.quotes z where z.id = p_quote_id;
  if found then
    select count(*) = jsonb_array_length(v_in)
           and (select count(*) from public.quote_lines a where a.tenant_id = v_exist.tenant_id and a.quote_id = v_exist.id) = jsonb_array_length(v_in) into v_same
      from public.quote_lines ql, jsonb_array_elements(v_in) with ordinality as w(j, n)
     where ql.tenant_id = v_exist.tenant_id and ql.quote_id = v_exist.id and ql.line_no = w.n and ql.item_type_code = w.j ->> 'item_type_code'
       and ql.qty = (w.j ->> 'qty')::integer and ql.unit_price_applied_paise = (w.j ->> 'unit_price_paise')::bigint;
    if v_exist.pricing_kind = 'manual' and v_exist.tenant_id = e.tenant_id and v_exist.enquiry_id = e.id and v_exist.canonical_hash = v_hash
       and v_exist.customer_kind::text = p_customer_kind and v_exist.delivery_state is not distinct from p_delivery_state and v_exist.engine_version = p_engine_version
       and v_same then
      return jsonb_build_object('quote_id', v_exist.id, 'quote_no', v_exist.quote_no, 'status', v_exist.status, 'needs_owner_approval', v_exist.needs_owner_approval,
                                'canonical_hash', v_exist.canonical_hash, 'replayed', true);
    end if;
    perform app.quote_error('conflict');
  end if;

  if e.archived_at is not null then
    perform app.quote_error('reference');
  end if;
  if not exists (select 1 from public.quote_engine_versions v where v.version = p_engine_version) then
    perform app.quote_error('value');
  end if;

  -- the date is today in India (one day of slack for clocks and midnight); the policy is the one active on it
  begin
    v_as_of := (v_req ->> 'as_of')::date;
  exception when others then
    perform app.quote_error('invalid');
  end;
  if v_as_of is null or v_as_of not between v_today - 1 and v_today then
    perform app.quote_error('SM215');
  end if;
  v_polver := app.quote_active_policy_version(e.tenant_id, v_as_of);
  if v_polver is null then
    perform app.quote_error('SM217');
  end if;

  v_build := app.quote_build_manual(e.tenant_id, v_as_of, p_customer_kind, v_polver, v_in);

  -- 1. the request is the one the database builds, and its hash is the engine's
  if v_req is distinct from (v_build -> 'request') then
    perform app.quote_error('SM216');
  end if;
  if v_res ->> 'status' is distinct from 'draft' or v_res ->> 'engine_version' is distinct from p_engine_version or v_res ->> 'canonical_hash' is distinct from v_hash
     or exists (select 1 from jsonb_object_keys(v_res) k where k <> all (array['status', 'engine_version', 'canonical_hash', 'lines', 'totals', 'payment_terms', 'valid_until', 'flags', 'trace'])) then
    perform app.quote_error('SM216');
  end if;
  -- 2. every figure of the result is the database's own recomputation; the flags are exactly the derived ones
  if (v_res - 'status' - 'engine_version' - 'canonical_hash' - 'flags' - 'trace') is distinct from (v_build -> 'core') then
    perform app.quote_error('SM216');
  end if;
  v_flags := array(select jsonb_array_elements_text(v_build -> 'flags'));
  v_review := array(select jsonb_array_elements_text(v_build -> 'review'));
  if app.quote_result_flags(v_res) is distinct from v_flags
     or (v_res -> 'flags' -> 'needs_owner_approval') is distinct from to_jsonb(cardinality(v_flags) > 0) then
    perform app.quote_error('SM216');
  end if;
  v_needs := cardinality(v_flags) + cardinality(v_review) > 0;
  -- the delivery state is optional for the manual kind; the label (own state or another) exists only when it was given
  v_supply := case when p_delivery_state is null then null when p_delivery_state = (v_build ->> 'seller_state') then 'intra_state' else 'inter_state' end;

  -- the requirement: the enquiry's one active requirement must be this function's own (confirmed, no fields) or absent
  select * into q from public.requirements r where r.tenant_id = e.tenant_id and r.enquiry_id = e.id and r.status in ('draft', 'confirmed') for update;
  if found then
    if q.status <> 'confirmed' or exists (select 1 from public.requirement_fields f where f.tenant_id = q.tenant_id and f.requirement_id = q.id) then
      perform app.requirement_error('SM208');
    end if;
  else
    insert into public.requirements (tenant_id, enquiry_id, status, confirmed_by, confirmed_at) values (e.tenant_id, e.id, 'confirmed', v_uid, now()) returning * into q;
  end if;

  -- one draft at a time: a new draft supersedes the old one; the quote number is the tenant's next
  perform pg_advisory_xact_lock(hashtextextended('quote_no:' || e.tenant_id::text, 0));
  update public.quotes z set status = 'superseded' where z.tenant_id = e.tenant_id and z.requirement_id = q.id and z.status = 'draft';
  select coalesce(max(z.quote_no), 0) + 1 into v_no from public.quotes z where z.tenant_id = e.tenant_id;
  insert into public.quotes
    (id, tenant_id, quote_no, pricing_kind, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text,
     canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise,
     shipping_tax_paise, total_paise, advance_paise, balance_paise, engine_flags, review_flags, needs_owner_approval)
  values
    (p_quote_id, e.tenant_id, v_no, 'manual', q.id, e.id, e.lead_id, 'draft', null, v_polver, p_engine_version, p_request_text, p_result_text,
     v_hash, p_customer_kind::public.quote_customer_kind, p_delivery_state, v_supply, v_as_of, (v_build ->> 'valid_until')::date, (v_build ->> 'due_date')::date,
     (v_build ->> 'merchandise_net')::bigint, (v_build ->> 'item_tax')::bigint, (v_build ->> 'shipping_net')::bigint, (v_build ->> 'shipping_tax')::bigint,
     (v_build ->> 'total')::bigint, (v_build ->> 'advance')::bigint, (v_build ->> 'balance')::bigint,
     v_flags::public.quote_flag[], v_review::public.quote_review_flag[], v_needs);
  for l in select z from jsonb_array_elements(v_build -> 'rows') z loop
    insert into public.quote_lines
      (tenant_id, quote_id, line_no, requirement_line_no, product_id, price_source, item_type_code, sku, name, sale_unit, qty, unit_price_applied_paise, price_break_min_qty,
       line_subtotal_paise, net_paise, tax_paise, gross_paise, tax_bps)
    values
      (e.tenant_id, p_quote_id, (l ->> 'line_no')::smallint, (l ->> 'requirement_line_no')::smallint, null, 'typed_by_person', l ->> 'item_type_code', l ->> 'sku', l ->> 'name',
       'piece', (l ->> 'qty')::int, (l ->> 'unit_price')::bigint, null,
       (l ->> 'subtotal')::bigint, (l ->> 'subtotal')::bigint, (l ->> 'tax')::bigint, (l ->> 'subtotal')::bigint + (l ->> 'tax')::bigint, (l ->> 'tax_bps')::int);
  end loop;
  return jsonb_build_object('quote_id', p_quote_id, 'quote_no', v_no, 'status', 'draft', 'needs_owner_approval', v_needs, 'canonical_hash', v_hash, 'replayed', false);
end;
$$;
revoke all on function public.create_manual_quote_draft(uuid, uuid, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_manual_quote_draft(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;

-- =============================================================================================
-- 6. public.approve_quote: the same function plus a manual branch
-- =============================================================================================
create or replace function public.approve_quote(p_quote_id uuid, p_recomputed_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  z       public.quotes;
  q       public.requirements;
  v_build jsonb;
  v_res   jsonb;
  v_today date := app.quote_today();
  v_lines jsonb;
begin
  if v_uid is null or p_quote_id is null then
    perform app.quote_deny();
  end if;
  select * into z from public.quotes x where x.id = p_quote_id;
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  perform app.require_aal2();
  if p_recomputed_hash is null or p_recomputed_hash !~ '^[0-9a-f]{64}$' then
    perform app.quote_error('invalid');
  end if;
  -- lock order: the enquiry row, the requirement row, the quote
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  select * into q from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.quotes x where x.id = p_quote_id for update;
  if z.status = 'approved' and z.approved_by = v_uid and z.approved_hash = p_recomputed_hash then
    return jsonb_build_object('quote_id', z.id, 'status', z.status, 'approved_by', z.approved_by, 'replayed', true);
  end if;
  if z.status <> 'draft' then
    perform app.quote_error('SM214');
  end if;
  if q.status <> 'confirmed' then
    perform app.quote_error('SM213');
  end if;
  -- the Owner alone approves a quote that needs it (a Admin is told so, with its own code)
  if z.needs_owner_approval and not app.has_tenant_role(z.tenant_id, array['owner']::public.app_role[]) then
    perform app.quote_error('SM218');
  end if;
  -- stale: expired, or a newer price list / policy is active than the ones the quote used
  if v_today > z.valid_until
     or (z.pricing_kind = 'list' and app.quote_active_price_version(z.tenant_id, v_today) is distinct from z.price_list_version_id)
     or app.quote_active_policy_version(z.tenant_id, v_today) is distinct from z.policy_version_id then
    perform app.quote_error('SM215');
  end if;
  -- the approver's recomputation (made by the API from the same sources) must be the quote's hash
  if p_recomputed_hash <> z.canonical_hash then
    perform app.quote_error('SM216');
  end if;
  -- re-build from the recorded versions and the CURRENT picks: anything that moved since the draft makes it stale
  begin
    if z.pricing_kind = 'manual' then
      -- a manual quote is rebuilt from its own stored lines (the typed prices); there is no price list and no pick
      select jsonb_agg(jsonb_build_object('item_type_code', l.item_type_code, 'name', l.name, 'qty', l.qty, 'unit_price_paise', l.unit_price_applied_paise) order by l.line_no)
        into v_lines from public.quote_lines l where l.tenant_id = z.tenant_id and l.quote_id = z.id;
      v_build := app.quote_build_manual(z.tenant_id, z.as_of, z.customer_kind::text, z.policy_version_id, v_lines);
    else
      v_build := app.quote_build(z.tenant_id, z.requirement_id, z.as_of, z.customer_kind::text, z.price_list_version_id, z.policy_version_id);
    end if;
  exception when sqlstate 'SM217' then
    perform app.quote_error('SM215');
  end;
  v_res := z.result_text::jsonb;
  if z.request_text::jsonb is distinct from (v_build -> 'request') or (v_res - 'status' - 'engine_version' - 'canonical_hash' - 'flags' - 'trace') is distinct from (v_build -> 'core') then
    perform app.quote_error('SM215');
  end if;

  -- ADR 0021: an older approved quote that has an order is never silently replaced (the order and the quote it records would disagree)
  if exists (select 1 from public.quotes x join public.orders o on o.tenant_id = x.tenant_id and o.quote_id = x.id and o.state not in ('declined', 'expired', 'cancelled')
              where x.tenant_id = z.tenant_id and x.requirement_id = z.requirement_id and x.status = 'approved' and x.id <> z.id) then
    perform app.order_error('SM237');
  end if;
  update public.quotes x set status = 'superseded' where x.tenant_id = z.tenant_id and x.requirement_id = z.requirement_id and x.status = 'approved' and x.id <> z.id;
  update public.quotes x set status = 'approved', approved_by = v_uid, approved_at = now(), approved_hash = p_recomputed_hash where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'approved', 'approved_by', v_uid, 'replayed', false);
end;
$$;
