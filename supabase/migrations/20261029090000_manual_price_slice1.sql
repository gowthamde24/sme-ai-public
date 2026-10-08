-- Manual-price quote, slice 1 (policy foundation). Owner-approved scope of 2026-10-08 (docs/plans/manual-price-quote-plan.md, "Settled in slice 1").
-- Nothing here prices a quote: it prepares the policy and the item types so that the manual-price slices can. List-price quotes behave as before.
--
--   1. Net days per customer kind. quote_policy_versions.net_days becomes new_net_days and repeat_net_days (each 0 to 180). The balance falls due on the quote date
--      plus the days of the quote's customer kind (quotes.customer_kind, 'new' or 'repeat', already exists). Every existing version keeps its old value in BOTH fields.
--   2. GST for manual-price quotes (the price list keeps its own rate per item): gst_rate_bps (default 500, 0 to 2800) and gst_effective_from (a real date). The rate used
--      is stored on each quote line (quote_lines.tax_bps, which already exists); a rate change is a NEW policy version, never an edit. shipping_tax_bps is no longer typed
--      separately: it defaults to the goods rate.
--   3. item_types: the tenant's own list of item types with an OPTIONAL price range (min_price_paise, max_price_paise, minor units, min <= max). Owner / Admin only write it,
--      through public.save_item_type (second factor); clients have no write grant. Reading: Owner / Admin / Sales (a Viewer sees no prices, as for the price list).
--      app.price_outside_range / app.item_type_price_outside_range are what a later slice calls to refuse a typed price with the code price_outside_range.
--
-- The immutability trigger (app.guard_immutable_record) refuses ANY change of a policy row, so the backfill of the new columns does NOT use UPDATE and the trigger is not
-- touched: net_days is RENAMED to repeat_net_days, and the two new columns are added as STORED GENERATED copies of existing columns and then turned into plain columns
-- with DROP EXPRESSION (a catalog change that keeps the stored values and fires no row trigger). Append-only: the old migrations are not edited.
-- Replaced whole (a Postgres function is replaced whole; tests/test_migration_copies.py pins each copy): app.quote_build (the net days of the customer kind, 3 lines),
-- app.quote_create_policy_version (the new fields) and app.operator_seed_quote_reference_data (one line).

-- =============================================================================================
-- 1 and 2. quote_policy_versions: net days per customer kind; the GST rate and the date it applies from
-- =============================================================================================
alter table public.quote_policy_versions rename column net_days to repeat_net_days;
alter table public.quote_policy_versions rename constraint quote_policy_versions_net_days_check to quote_policy_versions_repeat_net_days_check;
alter table public.quote_policy_versions add column new_net_days integer generated always as (repeat_net_days) stored;
alter table public.quote_policy_versions alter column new_net_days drop expression;
alter table public.quote_policy_versions alter column new_net_days set not null;
alter table public.quote_policy_versions add constraint quote_policy_versions_new_net_days_check check (new_net_days between 0 and 180);

alter table public.quote_policy_versions add column gst_rate_bps integer not null default 500 check (gst_rate_bps between 0 and 2800);
alter table public.quote_policy_versions add column gst_effective_from date generated always as (effective_from) stored;
alter table public.quote_policy_versions alter column gst_effective_from drop expression;
alter table public.quote_policy_versions alter column gst_effective_from set not null;
alter table public.quote_policy_versions add constraint quote_policy_versions_gst_effective_from_check
  check (gst_effective_from between date '2000-01-01' and date '2100-01-01');

-- the GST rate a manual-price quote made on p_on would use, from ONE policy version: its rate once its date has come, otherwise null (the caller refuses; nothing is guessed)
create function app.quote_gst_bps_on(p_tenant uuid, p_policy_version uuid, p_on date) returns integer
language sql
stable
set search_path = ''
as $$
  select v.gst_rate_bps from public.quote_policy_versions v where v.tenant_id = p_tenant and v.id = p_policy_version and v.gst_effective_from <= p_on
$$;

-- GST on one line: integer minor units, rounded to the paisa, half up. No floats anywhere.
create function app.quote_gst_paise(p_net_paise bigint, p_bps integer) returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_net_paise is null or p_bps is null or p_net_paise < 0 or p_bps not between 0 and 2800 then
    perform app.quote_error('invalid');
  end if;
  return app.quote_round(p_net_paise * p_bps, 10000, 'half_up');
end;
$$;
revoke all on function app.quote_gst_bps_on(uuid, uuid, date) from public;
revoke all on function app.quote_gst_paise(bigint, integer) from public;

-- =============================================================================================
-- Replaced whole: the net days of the quote's customer kind
-- =============================================================================================
create or replace function app.quote_build(p_tenant uuid, p_requirement uuid, p_as_of date, p_kind text, p_price_version uuid, p_policy_version uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  pol      public.quote_policy_versions;
  pv       public.price_list_versions;
  r        record;
  it       public.price_list_items;
  pk       public.requirement_line_picks;
  v_mode   text;
  v_idx    smallint := 0;
  v_lines  jsonb := '[]'::jsonb;
  v_rows   jsonb := '[]'::jsonb;
  v_olines jsonb := '[]'::jsonb;
  v_pl     jsonb := '[]'::jsonb;
  v_skus   text[] := '{}';
  v_rates  integer[] := '{}';
  v_flags  text[] := '{}';
  v_review text[] := '{}';
  v_bq     integer;
  v_bp     bigint;
  v_price  bigint;
  v_applied jsonb;
  v_sub    bigint;
  v_tax    bigint;
  v_net    bigint := 0;
  v_subtotal bigint := 0;
  v_itax   bigint := 0;
  v_ship   bigint;
  v_stax   bigint;
  v_total  bigint;
  v_adv    bigint;
  v_bal    bigint;
  v_adv_bps integer;
  v_customer jsonb;
  v_policy jsonb;
  v_breaks jsonb;
begin
  select * into pol from public.quote_policy_versions v where v.tenant_id = p_tenant and v.id = p_policy_version;
  select * into pv  from public.price_list_versions v where v.tenant_id = p_tenant and v.id = p_price_version;
  if pol.id is null or pv.id is null or p_kind is null or p_kind <> all (array['new', 'repeat']) then
    perform app.quote_error('SM217');
  end if;
  v_mode := pol.rounding_mode::text;

  -- every requirement line that has a confirmed saree type or quantity must have BOTH, and a person's pick of a priced product in the same unit
  for r in select distinct f.line_no from public.requirement_fields f
            where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no is not null and f.field_key in ('saree_type', 'quantity')
              and f.state in ('confirmed', 'corrected') order by f.line_no loop
    if not exists (select 1 from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = r.line_no
                     and f.field_key = 'saree_type' and f.state in ('confirmed', 'corrected'))
       or not exists (select 1 from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = r.line_no
                        and f.field_key = 'quantity' and f.state in ('confirmed', 'corrected')) then
      perform app.quote_error('SM217');
    end if;
    select * into pk from public.requirement_line_picks p where p.tenant_id = p_tenant and p.requirement_id = p_requirement and p.line_no = r.line_no;
    if pk.id is null then
      perform app.quote_error('SM217');
    end if;
    select * into it from public.price_list_items i where i.tenant_id = p_tenant and i.version_id = p_price_version and i.product_id = pk.product_id;
    if it.id is null or it.sale_unit <> pk.sale_unit or it.sku = any (v_skus) then
      perform app.quote_error('SM217');
    end if;
    v_skus := array_append(v_skus, it.sku);
    v_rates := array_append(v_rates, it.tax_bps);
    v_idx := v_idx + 1;

    v_price := it.unit_price_paise;
    v_applied := 'null'::jsonb;
    v_bq := null;
    select b.min_qty, b.unit_price_paise into v_bq, v_bp from public.price_list_breaks b where b.tenant_id = p_tenant and b.item_id = it.id and b.min_qty <= pk.qty
     order by b.min_qty desc limit 1;
    if v_bq is not null then
      v_price := v_bp;
      v_applied := jsonb_build_object('min_qty', v_bq, 'unit_price', v_bp);
    end if;
    v_sub := v_price * pk.qty;
    v_tax := app.quote_round(v_sub * it.tax_bps, 10000, v_mode);
    v_net := v_net + v_sub;
    v_itax := v_itax + v_tax;
    v_subtotal := v_subtotal + v_sub;
    if pk.qty < it.minimum_order_quantity and not ('BELOW_MINIMUM_ORDER_QUANTITY' = any (v_flags)) then
      v_flags := array_append(v_flags, 'BELOW_MINIMUM_ORDER_QUANTITY');
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('sku', it.sku, 'name', it.name, 'quantity', pk.qty, 'unit_price_applied', v_price,
      'price_break_applied', v_applied, 'line_subtotal', v_sub, 'discount', 0, 'net', v_sub, 'tax', v_tax, 'gross', v_sub + v_tax));
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('line_no', v_idx, 'requirement_line_no', r.line_no, 'product_id', it.product_id, 'sku', it.sku,
      'name', it.name, 'sale_unit', it.sale_unit, 'qty', pk.qty, 'unit_price', v_price, 'break_min_qty', v_bq, 'subtotal', v_sub, 'tax', v_tax, 'tax_bps', it.tax_bps));
    v_olines := v_olines || jsonb_build_array(jsonb_build_object('sku', it.sku, 'qty', pk.qty));
    select coalesce(jsonb_agg(jsonb_build_object('min_qty', b.min_qty, 'unit_price', b.unit_price_paise) order by b.min_qty), '[]'::jsonb) into v_breaks
      from public.price_list_breaks b where b.tenant_id = p_tenant and b.item_id = it.id;
    v_pl := v_pl || jsonb_build_array(jsonb_build_object('sku', it.sku, 'name', it.name, 'unit_price', it.unit_price_paise,
      'minimum_order_quantity', it.minimum_order_quantity, 'price_breaks', v_breaks, 'tax_bps', it.tax_bps));
  end loop;
  if v_idx = 0 then
    perform app.quote_error('SM217');
  end if;
  -- the sort is by CODE POINT (the engine and the API sort that way): COLLATE "C", never the database's default collation
  select jsonb_agg(x order by (x ->> 'sku') collate "C") into v_pl from jsonb_array_elements(v_pl) x;

  -- shipping: the flat fee is NET, free only when the merchandise net is strictly above the threshold; its tax uses the policy's one rate
  v_ship := pol.shipping_flat_fee_paise;
  if pol.shipping_free_above_paise is not null and v_net > pol.shipping_free_above_paise then
    v_ship := 0;
  end if;
  v_stax  := app.quote_round(v_ship * pol.shipping_tax_bps, 10000, v_mode);
  v_total := v_net + v_itax + v_stax + v_ship;
  v_adv_bps := case p_kind when 'new' then pol.new_advance_bps else pol.repeat_advance_bps end;
  v_adv   := app.quote_round(v_total * v_adv_bps, 10000, v_mode);
  v_bal   := v_total - v_adv;
  if p_kind = 'repeat' and v_bal > pol.repeat_credit_limit_paise then
    v_flags := array_append(v_flags, 'CREDIT_LIMIT_EXCEEDED');
  end if;
  -- the flags the database derives itself
  if exists (select 1 from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.field_key = 'payment_terms'
               and f.state in ('confirmed', 'corrected')) then
    v_review := array_append(v_review, 'TERMS_REQUESTED_BY_CUSTOMER');
  end if;
  if (select count(distinct x) from unnest(v_rates) x) > 1 and v_ship > 0 then
    v_review := array_append(v_review, 'MIXED_GST_RATES_SHIPPING');
  end if;
  -- the customer kind is a person's CLAIM (there is no order history yet): the Owner decides a quote for a "repeat" customer
  if p_kind = 'repeat' then
    v_review := array_append(v_review, 'REPEAT_CUSTOMER_CLAIMED');
  end if;

  v_customer := case p_kind when 'new' then jsonb_build_object('kind', 'new')
                            else jsonb_build_object('kind', 'repeat', 'credit_limit', pol.repeat_credit_limit_paise) end;
  v_policy := jsonb_build_object(
    'discount_ceiling_bps', pol.discount_ceiling_bps,
    'shipping', jsonb_build_object('flat_fee', pol.shipping_flat_fee_paise, 'tax_bps', pol.shipping_tax_bps)
                || case when pol.shipping_free_above_paise is null then '{}'::jsonb else jsonb_build_object('free_above', pol.shipping_free_above_paise) end,
    'validity_days', pol.validity_days,
    'payment_terms', jsonb_build_object('new_advance_bps', pol.new_advance_bps, 'repeat_advance_bps', pol.repeat_advance_bps, 'net_days', (case p_kind when 'new' then pol.new_net_days else pol.repeat_net_days end)),
    'tax_mode', pol.tax_mode::text, 'rounding_mode', v_mode);
  return jsonb_build_object(
    'request', jsonb_build_object('as_of', p_as_of::text, 'price_list', v_pl, 'customer', v_customer, 'order_lines', v_olines, 'policy', v_policy),
    'core', jsonb_build_object(
      'lines', v_lines,
      'totals', jsonb_build_object('subtotal', v_subtotal, 'discount', 0, 'net', v_net, 'tax', v_itax + v_stax, 'item_tax', v_itax, 'shipping_tax', v_stax,
                                   'shipping', v_ship, 'shipping_gross', v_ship + v_stax, 'total', v_total),
      'payment_terms', jsonb_build_object('advance_amount', v_adv, 'balance', v_bal, 'due_date', (p_as_of + (case p_kind when 'new' then pol.new_net_days else pol.repeat_net_days end))::text),
      'valid_until', (p_as_of + pol.validity_days)::text),
    'flags', (select coalesce(jsonb_agg(f order by f collate "C"), '[]'::jsonb) from unnest(v_flags) f),
    'review', (select coalesce(jsonb_agg(f order by f collate "C"), '[]'::jsonb) from unnest(v_review) f),
    'rows', v_rows,
    'merchandise_net', v_net, 'item_tax', v_itax, 'shipping_net', v_ship, 'shipping_tax', v_stax, 'total', v_total, 'advance', v_adv, 'balance', v_bal,
    'due_date', p_as_of + (case p_kind when 'new' then pol.new_net_days else pol.repeat_net_days end), 'valid_until', p_as_of + pol.validity_days, 'seller_state', pol.seller_state, 'required_inputs', to_jsonb(pol.required_inputs::text[]));
end;
$$;

-- =============================================================================================
-- Replaced whole: the policy create function takes the new fields (net_days is gone; a caller that still sends it gets "invalid argument")
-- =============================================================================================
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
  -- GST for manual-price quotes (the price list keeps its own rate per item): a default rate and the date it applies from. Not given: 5 % from the version's own date.
  -- The shipping tax is not typed separately: it follows the goods rate unless a caller still sends it (list-price quotes)
  v_gst     := coalesce(app.quote_int(p_policy, 'gst_rate_bps', 0, 2800, false), 500);
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
      'repeat_advance_bps', 2500, 'new_net_days', 30, 'repeat_net_days', 30, 'tax_mode', 'exclusive', 'rounding_mode', 'half_up', 'repeat_credit_limit_paise', 50000000,
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
-- 3. item_types
-- =============================================================================================
create table public.item_types (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  code            text not null check (code ~ '^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$'),
  name            text not null check (char_length(btrim(name)) between 1 and 200 and app.text_is_clean(name)),
  position        integer not null default 0 check (position between 0 and 10000),
  active          boolean not null default true,
  min_price_paise bigint check (min_price_paise between 1 and 100000000),
  max_price_paise bigint check (max_price_paise between 1 and 100000000),
  created_by      uuid,
  created_via     public.record_origin not null default 'manual',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  check (min_price_paise is null or max_price_paise is null or min_price_paise <= max_price_paise)
);
create index item_types_keyset_idx on public.item_types (tenant_id, created_at, id);

comment on column public.item_types.code is 'SAFE: the stable code of an item type, never reused. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.item_types.name is 'SAFE: the tenant''s own label of an item type (a business catalogue label, never a person); text_is_clean-guarded';

-- the code never changes and a row is never deleted or truncated (quote lines will refer to the code): an item type that is no longer sold is made inactive
create function app.item_types_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'the code of an item type never changes' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.item_types_guard() from public;

create trigger item_types_set_updated_at before update on public.item_types for each row execute function app.set_updated_at();
create trigger item_types_forbid_tenant_id_change before update on public.item_types for each row execute function app.forbid_tenant_id_change();
create trigger item_types_set_created_meta before insert or update on public.item_types for each row execute function app.set_created_meta();
create trigger item_types_guard_update before update on public.item_types for each row execute function app.item_types_guard();
create trigger item_types_forbid_delete before delete on public.item_types for each row execute function app.quote_forbid_delete();
create trigger item_types_no_truncate before truncate on public.item_types for each statement execute function app.quote_forbid_truncate();
create trigger audit_item_types after insert or update or delete on public.item_types for each row execute function app.audit_row_change('item_type');

alter table public.item_types enable row level security;
alter table public.item_types force row level security;
revoke all on public.item_types from public, anon, authenticated;
create policy item_types_select on public.item_types for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
grant select on public.item_types to authenticated;

-- Owner / Admin create or change an item type (the role is proven first, then the second factor). The call REPLACES the record: a null price bound means "no bound".
create function public.save_item_type(
  p_tenant_id uuid, p_code text, p_name text, p_position integer, p_active boolean, p_min_price_paise bigint, p_max_price_paise bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.item_types;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  perform app.require_aal2();
  if p_code is null or p_code !~ '^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$' or p_name is null or char_length(btrim(p_name)) not between 1 and 200
     or not app.text_is_clean(p_name) or p_position is null or p_position not between 0 and 10000 or p_active is null then
    perform app.quote_error('invalid');
  end if;
  if p_min_price_paise is not null and p_min_price_paise not between 1 and 100000000
     or p_max_price_paise is not null and p_max_price_paise not between 1 and 100000000
     or p_min_price_paise > p_max_price_paise then
    perform app.quote_error('value');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('item_type:' || p_tenant_id::text || ':' || p_code, 0));
  select * into v_row from public.item_types t where t.tenant_id = p_tenant_id and t.code = p_code;
  if found then
    update public.item_types t
       set name = btrim(p_name), position = p_position, active = p_active, min_price_paise = p_min_price_paise, max_price_paise = p_max_price_paise
     where t.id = v_row.id;
    return jsonb_build_object('id', v_row.id, 'code', p_code, 'created', false);
  end if;
  insert into public.item_types (tenant_id, code, name, position, active, min_price_paise, max_price_paise)
  values (p_tenant_id, p_code, btrim(p_name), p_position, p_active, p_min_price_paise, p_max_price_paise)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', p_code, 'created', true);
end;
$$;
revoke all on function public.save_item_type(uuid, text, text, integer, boolean, bigint, bigint) from public, anon;
grant execute on function public.save_item_type(uuid, text, text, integer, boolean, bigint, bigint) to authenticated;

-- The check a later slice calls when a person types a price: true when the price lies outside the type's range. A missing bound is no bound; a type with no range never
-- refuses. An unknown code is "invalid reference" (nothing is guessed). There is NO override: whether the owners may override is a later decision of theirs.
create function app.price_outside_range(p_price_paise bigint, p_min_paise bigint, p_max_paise bigint) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_price_paise is null or p_price_paise < 1 then
    perform app.quote_error('invalid');
  end if;
  return (p_min_paise is not null and p_price_paise < p_min_paise) or (p_max_paise is not null and p_price_paise > p_max_paise);
end;
$$;
create function app.item_type_price_outside_range(p_tenant uuid, p_code text, p_price_paise bigint) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  t public.item_types;
begin
  select * into t from public.item_types x where x.tenant_id = p_tenant and x.code = p_code;
  if not found then
    perform app.quote_error('reference');
  end if;
  return app.price_outside_range(p_price_paise, t.min_price_paise, t.max_price_paise);
end;
$$;
revoke all on function app.price_outside_range(bigint, bigint, bigint) from public;
revoke all on function app.item_type_price_outside_range(uuid, text, bigint) from public;
