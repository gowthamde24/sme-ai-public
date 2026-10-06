-- T009 step 3: the LOCAL operator seed named the seller state 'TS', which is the vehicle-registration abbreviation, not the ISO 3166-2:IN code (Telangana is TG).
-- The API validates a delivery state against the real ISO list (app/quotes/states.py), so a quote from the seeded policy would compare a real delivery state
-- with a code that is on nobody's address. This replaces the seed function with a copy that differs in that ONE value; part 1 stays untouched (migrations are
-- append-only). It changes nothing in an existing workspace: the seed only creates what is missing and never touches a version that exists. The database
-- itself still accepts any two capital letters (docs/pre-pilot-checklist.md, "Quotes"). Every value here is invented, not a statement of any real business.

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

  if not exists (select 1 from public.price_list_versions v where v.tenant_id = v_tenant) then
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
      'repeat_advance_bps', 2500, 'net_days', 30, 'tax_mode', 'exclusive', 'rounding_mode', 'half_up', 'repeat_credit_limit_paise', 0,
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
revoke all on function app.operator_seed_quote_reference_data(text) from public, anon, authenticated, service_role;
