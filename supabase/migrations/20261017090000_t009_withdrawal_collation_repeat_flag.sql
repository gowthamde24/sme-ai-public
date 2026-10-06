-- T009 / migration part 3 (owner review of parts 1 and 2, 2026-10-06): a new migration; nothing earlier is amended.
--
--   1. COLLATION. Every sort by sku now uses COLLATE "C" (code point): the engine and the API sort by code point, and the database's default collation orders
--      'A-1', 'A1', 'a-2', 'B 1' differently, which would make a request the API builds differ from the database's (SM216) and the normalised content hash
--      depend on the server's locale. Changed: app.quote_build, app.quote_price_version_normalised, app.quote_create_price_version, app.quote_result_flags (copies of
--      the latest definitions plus the COLLATE lines). Versions published before this migration were hashed in the default collation; the stored hash is an identity,
--      never an input of a decision, and nothing real exists yet.
--   2. WITHDRAWING AN APPROVED QUOTE (public.withdraw_approved_quote). STATUS DESIGN CHOSEN: no new status. A withdrawn quote is an approved quote that moved to
--      `superseded` with withdrawn_by / withdrawn_at / withdraw_code recorded once. Why: a new enum value cannot be used by a CHECK in the migration that adds it
--      (the transaction), and every guard already knows approved -> superseded; the table checks say a withdrawal exists only on a superseded quote that WAS approved,
--      and the guard trigger says it is recorded once and only by that transition. A quote replaced by a newer approval is also superseded but carries no withdrawal:
--      the two are told apart by withdrawn_at. Owner / Admin, role first, then aal2; approved quotes only (SM214 otherwise); locks enquiry, requirement, quote; an exact
--      retry replays; audited; sends nothing. After it discard_requirement and a new draft work again (the approved partial unique index is free).
--      HOOK: when order conversion exists it must refuse a withdrawal once an order exists (docs/plans/order-conversion.md, a pre-pilot checklist row).
--   3. REPEAT_CUSTOMER_CLAIMED: a review flag the DATABASE derives whenever customer_kind = 'repeat' (the kind is a person's claim until there is order history);
--      like the other review flags it makes needs_owner_approval true.
--   4. TRUNCATE guards on the nine quote tables, the same guard the append-only ledgers (audit_events, consent_events) have: a statement trigger that refuses for every role.

-- ---------------------------------------------------------------------------------------------
-- 3. the new review flag (the value is used at run time by app.quote_build, never inside this migration)
-- ---------------------------------------------------------------------------------------------
alter type public.quote_review_flag add value if not exists 'REPEAT_CUSTOMER_CLAIMED';

-- ---------------------------------------------------------------------------------------------
-- 2. the withdrawal record
-- ---------------------------------------------------------------------------------------------
create type public.quote_withdraw_code as enum ('price_changed', 'customer_cancelled', 'entered_in_error', 'other');
alter table public.quotes add column withdrawn_by uuid;
alter table public.quotes add column withdrawn_at timestamptz;
alter table public.quotes add column withdraw_code public.quote_withdraw_code;
alter table public.quotes add constraint quotes_withdrawn_all_or_none
  check ((withdrawn_by is null) = (withdrawn_at is null) and (withdrawn_at is null) = (withdraw_code is null));
alter table public.quotes add constraint quotes_withdrawn_only_when_superseded
  check (withdrawn_at is null or (status = 'superseded' and approved_at is not null));

-- ---------------------------------------------------------------------------------------------
-- 1 and 3 and 2. copies of the latest definitions plus the lines named in the header
-- ---------------------------------------------------------------------------------------------
create or replace function app.quote_price_version_normalised(p_tenant uuid, p_version uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by (item ->> 'sku') collate "C"), '[]'::jsonb) from (
    select jsonb_build_object(
             'product_id', i.product_id, 'sku', i.sku, 'sale_unit', i.sale_unit, 'unit_price_paise', i.unit_price_paise,
             'minimum_order_quantity', i.minimum_order_quantity, 'tax_bps', i.tax_bps,
             'breaks', coalesce((select jsonb_agg(jsonb_build_object('min_qty', b.min_qty, 'unit_price_paise', b.unit_price_paise) order by b.min_qty)
                                   from public.price_list_breaks b where b.tenant_id = i.tenant_id and b.item_id = i.id), '[]'::jsonb)) as item
      from public.price_list_items i where i.tenant_id = p_tenant and i.version_id = p_version) x
$$;

create or replace function app.quote_create_price_version(p_version_id uuid, p_tenant uuid, p_effective date, p_items jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_norm    jsonb := '[]'::jsonb;
  e         jsonb;
  b         jsonb;
  v_prod    public.products;
  v_seen    uuid[] := '{}';
  v_pid     uuid;
  v_moq     bigint;
  v_price   bigint;
  v_prev_q  bigint;
  v_prev_p  bigint;
  v_q       bigint;
  v_p       bigint;
  v_breaks  jsonb;
  v_unit    text;
  v_list    uuid;
  v_latest  date;
  v_no      integer;
  v_hash    text;
  v_exist   public.price_list_versions;
  v_version uuid;
  v_item    uuid;
begin
  if p_version_id is null or p_tenant is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 1000 then
    perform app.quote_error('invalid');
  end if;

  for e in select x from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(e) <> 'object' or exists (select 1 from jsonb_object_keys(e) k
         where k <> all (array['product_id', 'sale_unit', 'unit_price_paise', 'minimum_order_quantity', 'tax_bps', 'breaks'])) then
      perform app.quote_error('invalid');
    end if;
    if jsonb_typeof(e -> 'product_id') <> 'string' or (e ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.quote_error('invalid');
    end if;
    v_pid := (e ->> 'product_id')::uuid;
    if v_pid = any (v_seen) then
      perform app.quote_error('value');
    end if;
    v_seen := v_seen || v_pid;
    select * into v_prod from public.products p where p.tenant_id = p_tenant and p.id = v_pid and p.active and p.archived_at is null;
    if not found then
      perform app.quote_error('reference');
    end if;
    v_price := app.quote_int(e, 'unit_price_paise', 1, 100000000);
    v_moq   := app.quote_int(e, 'minimum_order_quantity', 1, 10000);
    perform app.quote_int(e, 'tax_bps', 0, 10000);
    v_unit := coalesce(app.quote_text(e, 'sale_unit', 1, 10, false), 'piece');
    if v_unit <> all (array['piece', 'set']) then
      perform app.quote_error('value');
    end if;

    -- breaks: at most 20, quantity strictly increasing and not below the minimum order quantity, price not increasing and not above the base price
    v_breaks := '[]'::jsonb;
    if e ? 'breaks' and jsonb_typeof(e -> 'breaks') <> 'null' then
      if jsonb_typeof(e -> 'breaks') <> 'array' or jsonb_array_length(e -> 'breaks') > 20 then
        perform app.quote_error('invalid');
      end if;
      v_prev_q := v_moq - 1;
      v_prev_p := v_price;
      for b in select x from jsonb_array_elements(e -> 'breaks') x loop
        if jsonb_typeof(b) <> 'object' or exists (select 1 from jsonb_object_keys(b) k where k <> all (array['min_qty', 'unit_price_paise'])) then
          perform app.quote_error('invalid');
        end if;
        v_q := app.quote_int(b, 'min_qty', 1, 10000);
        v_p := app.quote_int(b, 'unit_price_paise', 1, 100000000);
        if v_q <= v_prev_q or v_p > v_prev_p then
          perform app.quote_error('value');
        end if;
        v_prev_q := v_q;
        v_prev_p := v_p;
        v_breaks := v_breaks || jsonb_build_array(jsonb_build_object('min_qty', v_q, 'unit_price_paise', v_p));
      end loop;
    end if;

    v_norm := v_norm || jsonb_build_array(jsonb_build_object(
      'product_id', v_pid, 'sku', v_prod.sku, 'sale_unit', v_unit, 'unit_price_paise', v_price, 'minimum_order_quantity', v_moq,
      'tax_bps', (e ->> 'tax_bps')::int, 'breaks', v_breaks));
  end loop;
  select jsonb_agg(x order by (x ->> 'sku') collate "C") into v_norm from jsonb_array_elements(v_norm) x;
  v_hash := app.quote_content_hash(v_norm);

  -- one writer at a time per tenant and kind: version numbers and "not earlier than the latest" are race-free
  perform pg_advisory_xact_lock(hashtextextended('quote_ref:price:' || p_tenant::text, 0));

  select * into v_exist from public.price_list_versions v where v.id = p_version_id;
  if found then
    if v_exist.tenant_id = p_tenant and v_exist.content_sha256 = v_hash and v_exist.effective_from = p_effective then
      return jsonb_build_object('version_id', v_exist.id, 'version_no', v_exist.version_no, 'effective_from', v_exist.effective_from,
                                'content_sha256', v_exist.content_sha256, 'item_count', v_exist.item_count, 'replayed', true);
    end if;
    perform app.quote_error('conflict');   -- the same answer for another tenant's id and for other content under this tenant's own id
  end if;

  select pl.id into v_list from public.price_lists pl where pl.tenant_id = p_tenant order by pl.created_at, pl.id limit 1;
  if v_list is null then
    v_list := gen_random_uuid();
    insert into public.price_lists (id, tenant_id, name) values (v_list, p_tenant, 'Price list');
  end if;
  select max(v.effective_from), coalesce(max(v.version_no), 0) + 1 into v_latest, v_no from public.price_list_versions v where v.tenant_id = p_tenant and v.price_list_id = v_list;
  perform app.quote_check_effective(p_effective, v_latest);

  insert into public.price_list_versions (id, tenant_id, price_list_id, version_no, effective_from, item_count, content_sha256)
  values (p_version_id, p_tenant, v_list, v_no, p_effective, jsonb_array_length(v_norm), v_hash);
  v_version := p_version_id;
  for e in select x from jsonb_array_elements(v_norm) x loop
    v_item := gen_random_uuid();
    insert into public.price_list_items (id, tenant_id, version_id, product_id, sku, name, sale_unit, unit_price_paise, minimum_order_quantity, tax_bps)
    select v_item, p_tenant, v_version, (e ->> 'product_id')::uuid, e ->> 'sku', p.name, (e ->> 'sale_unit')::public.quote_sale_unit,
           (e ->> 'unit_price_paise')::bigint, (e ->> 'minimum_order_quantity')::int, (e ->> 'tax_bps')::int
      from public.products p where p.tenant_id = p_tenant and p.id = (e ->> 'product_id')::uuid;
    insert into public.price_list_breaks (tenant_id, item_id, min_qty, unit_price_paise)
    select p_tenant, v_item, (x ->> 'min_qty')::int, (x ->> 'unit_price_paise')::bigint from jsonb_array_elements(e -> 'breaks') x;
  end loop;
  return jsonb_build_object('version_id', v_version, 'version_no', v_no, 'effective_from', p_effective, 'content_sha256', v_hash,
                            'item_count', jsonb_array_length(v_norm), 'replayed', false);
end;
$$;

create or replace function app.quote_result_flags(p_result jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$ select coalesce(array_agg(distinct (x ->> 'code') collate "C" order by (x ->> 'code') collate "C"), '{}') from jsonb_array_elements(p_result -> 'flags' -> 'reasons') x $$;

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
    'payment_terms', jsonb_build_object('new_advance_bps', pol.new_advance_bps, 'repeat_advance_bps', pol.repeat_advance_bps, 'net_days', pol.net_days),
    'tax_mode', pol.tax_mode::text, 'rounding_mode', v_mode);
  return jsonb_build_object(
    'request', jsonb_build_object('as_of', p_as_of::text, 'price_list', v_pl, 'customer', v_customer, 'order_lines', v_olines, 'policy', v_policy),
    'core', jsonb_build_object(
      'lines', v_lines,
      'totals', jsonb_build_object('subtotal', v_subtotal, 'discount', 0, 'net', v_net, 'tax', v_itax + v_stax, 'item_tax', v_itax, 'shipping_tax', v_stax,
                                   'shipping', v_ship, 'shipping_gross', v_ship + v_stax, 'total', v_total),
      'payment_terms', jsonb_build_object('advance_amount', v_adv, 'balance', v_bal, 'due_date', (p_as_of + pol.net_days)::text),
      'valid_until', (p_as_of + pol.validity_days)::text),
    'flags', (select coalesce(jsonb_agg(f order by f collate "C"), '[]'::jsonb) from unnest(v_flags) f),
    'review', (select coalesce(jsonb_agg(f order by f collate "C"), '[]'::jsonb) from unnest(v_review) f),
    'rows', v_rows,
    'merchandise_net', v_net, 'item_tax', v_itax, 'shipping_net', v_ship, 'shipping_tax', v_stax, 'total', v_total, 'advance', v_adv, 'balance', v_bal,
    'due_date', p_as_of + pol.net_days, 'valid_until', p_as_of + pol.validity_days, 'seller_state', pol.seller_state, 'required_inputs', to_jsonb(pol.required_inputs::text[]));
end;
$$;

create or replace function app.quote_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code' - 'withdrawn_by' - 'withdrawn_at' - 'withdraw_code')
     is distinct from (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code' - 'withdrawn_by' - 'withdrawn_at' - 'withdraw_code') then
    raise exception 'quotes rows are immutable: record a new quote' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('approved', 'rejected', 'superseded')) or (old.status = 'approved' and new.status = 'superseded')) then
    raise exception 'a quote cannot move from % to %', old.status, new.status using errcode = '42501';
  end if;
  if new.status = old.status and (new.approved_at is distinct from old.approved_at or new.rejected_at is distinct from old.rejected_at) then
    raise exception 'a quote decision is recorded once' using errcode = '42501';
  end if;
  if old.approved_at is not null and (new.approved_by is distinct from old.approved_by or new.approved_hash is distinct from old.approved_hash) then
    raise exception 'a quote decision is recorded once' using errcode = '42501';
  end if;
  if old.rejected_at is not null and (new.rejected_by is distinct from old.rejected_by or new.reject_code is distinct from old.reject_code) then
    raise exception 'a quote decision is recorded once' using errcode = '42501';
  end if;
  -- a withdrawal is recorded ONCE, and only by moving an APPROVED quote to superseded (a quote replaced by a newer approval carries no withdrawal)
  if (new.withdrawn_by is distinct from old.withdrawn_by or new.withdrawn_at is distinct from old.withdrawn_at or new.withdraw_code is distinct from old.withdraw_code)
     and (old.withdrawn_at is not null or not (old.status = 'approved' and new.status = 'superseded' and new.withdrawn_at is not null)) then
    raise exception 'a quote decision is recorded once' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.withdraw_approved_quote(p_quote_id uuid, p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  z     public.quotes;
begin
  if v_uid is null or p_quote_id is null then
    perform app.quote_deny();
  end if;
  select * into z from public.quotes x where x.id = p_quote_id;
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  perform app.require_aal2();
  if p_code is null or p_code <> all (array['price_changed', 'customer_cancelled', 'entered_in_error', 'other']) then
    perform app.quote_error('invalid');
  end if;
  -- lock order: the enquiry row, the requirement row, the quote
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  perform 1 from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.quotes x where x.id = p_quote_id for update;
  if z.status = 'superseded' and z.withdrawn_by = v_uid and z.withdraw_code::text = p_code then
    return jsonb_build_object('quote_id', z.id, 'status', z.status, 'withdrawn', true, 'replayed', true);
  end if;
  if z.status <> 'approved' then
    perform app.quote_error('SM214');
  end if;
  -- HOOK (order conversion, docs/plans/order-conversion.md): once an order exists for this quote the withdrawal is refused here
  update public.quotes x set status = 'superseded', withdrawn_by = v_uid, withdrawn_at = now(), withdraw_code = p_code::public.quote_withdraw_code where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'superseded', 'withdrawn', true, 'replayed', false);
end;
$$;
revoke all on function public.withdraw_approved_quote(uuid, text) from public, anon;
grant execute on function public.withdraw_approved_quote(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. TRUNCATE guards (a statement trigger, refused for every role)
-- ---------------------------------------------------------------------------------------------
create function app.quote_forbid_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is never truncated: record a new version', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.quote_forbid_truncate() from public;
do $$
declare t text;
begin
  foreach t in array array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions',
                           'requirement_line_picks', 'quotes', 'quote_lines'] loop
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$s for each statement execute function app.quote_forbid_truncate()', t);
  end loop;
end $$;
