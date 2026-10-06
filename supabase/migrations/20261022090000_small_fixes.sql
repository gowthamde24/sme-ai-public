-- Small fixes (owner review of rehearsal steps 0-3, 2026-10-06). ONE migration; earlier migrations untouched; create or replace of the LATEST definitions plus the lines named here
-- (tests/test_migration_copies.py pins every copy).
--   A1. public.add_requirement_field   an exact retry of a typed field replays even after the requirement is confirmed (the replay is checked BEFORE the status refusal); any other write
--       to a confirmed requirement is still refused (SM208). Other tenants and other people are unchanged: the retry must be the same person's, same slot, same content.
--   A3. app.operator_seed_quote_reference_data   the synthetic repeat-customer credit limit is Rs 5,00,000 (50,000,000 paise) instead of 0, so an ordinary repeat quote is not over its credit.
--       Only a workspace with NO quote policy yet is seeded: an existing workspace keeps the policy it has.

create or replace function public.add_requirement_field(
  p_enquiry_id  uuid,
  p_line        smallint,
  p_key         text,
  p_value_code  text default null,
  p_value_int   bigint default null,
  p_value_date  date default null,
  p_value_text  text default null,
  p_basis       text default null,
  p_quote       text default null,
  p_start       integer default null,
  p_end         integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  e       public.enquiries;
  v_body  text;
  v_quote text;
  v_req   uuid;
  v_status public.requirement_status;
  f       public.requirement_fields;
  v_field uuid;
begin
  if v_uid is null or p_enquiry_id is null then
    perform app.requirement_deny();
  end if;
  -- the tenant comes from the ENQUIRY: an unknown id and another tenant's id are the same refusal
  select * into e from public.enquiries x where x.id = p_enquiry_id;
  if not found or not app.has_tenant_role(e.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.requirement_deny();
  end if;
  if p_key is null or p_key <> all (array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'])
     or (p_quote is null) <> (p_start is null) or (p_quote is null) <> (p_end is null)
     or char_length(coalesce(p_quote, '')) > 4000 or char_length(coalesce(p_value_text, '')) > 200
     or char_length(coalesce(p_value_code, '')) > 100 or char_length(coalesce(p_basis, '')) > 100 then
    perform app.requirement_error('invalid');
  end if;

  -- serialise with the agent's writes and other humans on this enquiry; an archived enquiry is not worked on
  select x.body into v_body from public.enquiries x where x.tenant_id = e.tenant_id and x.id = e.id and x.archived_at is null for update;
  if not found then
    perform app.requirement_error('reference');
  end if;
  -- the active requirement, locked (enquiry row first, then this row): only a DRAFT takes a field
  select q.id, q.status into v_req, v_status from public.requirements q
   where q.tenant_id = e.tenant_id and q.enquiry_id = e.id and q.status in ('draft', 'confirmed') for update;
  if found and v_status <> 'draft' then
    -- small fix A1: an EXACT retry of a typed field replays even after the requirement is confirmed (checked before the refusal); anything else is still refused
    select * into f from public.requirement_fields x
     where x.tenant_id = e.tenant_id and x.requirement_id = v_req and x.field_key = p_key::public.requirement_field_key and x.line_no is not distinct from p_line;
    if found and f.created_via = 'manual' and f.decided_by = v_uid and f.value_code is not distinct from p_value_code and f.value_int is not distinct from p_value_int
       and f.value_date is not distinct from p_value_date and f.value_text is not distinct from p_value_text and f.basis is not distinct from p_basis
       and f.quote is not distinct from (case when p_quote is null then null else app.requirement_ws(p_quote) end) and f.quote_start is not distinct from p_start
       and f.quote_end is not distinct from p_end then
      return jsonb_build_object('field_id', f.id, 'requirement_id', v_req, 'replayed', true);
    end if;
    perform app.requirement_error('SM208');
  end if;

  -- same shape, vocabulary and caps as the agent's path
  if not app.requirement_value_ok(p_key, p_line, p_value_code, p_value_int, p_value_date, p_value_text, p_basis)
     or not app.text_is_clean(p_value_code) or not app.text_is_clean(p_value_text) or not app.text_is_clean(p_basis) then
    perform app.requirement_error('value');
  end if;
  -- the quote, when given, is verified exactly like the agent's
  if p_quote is not null then
    v_quote := app.requirement_ws(p_quote);
    if char_length(v_quote) not between 1 and 300 or p_start < 0 or p_end <= p_start or p_end > char_length(v_body) or p_end - p_start > 1200
       or app.requirement_ws(substr(v_body, p_start + 1, p_end - p_start)) is distinct from v_quote or not app.text_is_clean(v_quote) then
      perform app.requirement_error('value');
    end if;
  end if;

  -- the draft requirement: the active one, or a new manual draft
  if v_req is null then
    v_req := gen_random_uuid();
    perform set_config('app.created_via', 'manual', true);
    begin
      insert into public.requirements (id, tenant_id, enquiry_id, status) values (v_req, e.tenant_id, e.id, 'draft');
    exception when unique_violation then
      perform app.requirement_error('SM208');
    end;
    perform set_config('app.created_via', '', true);
  end if;

  -- one field per slot: an exact retry by the same person is a replay; anything else is refused (use decide_requirement_field to change a field)
  select * into f from public.requirement_fields x
   where x.tenant_id = e.tenant_id and x.requirement_id = v_req and x.field_key = p_key::public.requirement_field_key and x.line_no is not distinct from p_line;
  if found then
    if f.created_via = 'manual' and f.decided_by = v_uid and f.value_code is not distinct from p_value_code and f.value_int is not distinct from p_value_int
       and f.value_date is not distinct from p_value_date and f.value_text is not distinct from p_value_text and f.basis is not distinct from p_basis
       and f.quote is not distinct from v_quote and f.quote_start is not distinct from p_start and f.quote_end is not distinct from p_end then
      return jsonb_build_object('field_id', f.id, 'requirement_id', v_req, 'replayed', true);
    end if;
    perform app.requirement_error('value');
  end if;
  if (select count(*) from public.requirement_fields x where x.tenant_id = e.tenant_id and x.requirement_id = v_req) >= 40 then
    perform app.requirement_error('value');
  end if;

  v_field := gen_random_uuid();
  perform set_config('app.created_via', 'manual', true);
  insert into public.requirement_fields
    (id, tenant_id, requirement_id, line_no, field_key, value_code, value_int, value_date, value_text, basis, certainty, quote, quote_start, quote_end,
     state, decided_by, decided_at)
  values
    (v_field, e.tenant_id, v_req, p_line, p_key::public.requirement_field_key, p_value_code, p_value_int, p_value_date, p_value_text, p_basis, 'stated',
     v_quote, p_start, p_end, 'corrected', v_uid, now());
  perform set_config('app.created_via', '', true);
  return jsonb_build_object('field_id', v_field, 'requirement_id', v_req, 'replayed', false);
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
      'repeat_advance_bps', 2500, 'net_days', 30, 'tax_mode', 'exclusive', 'rounding_mode', 'half_up', 'repeat_credit_limit_paise', 50000000,
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
