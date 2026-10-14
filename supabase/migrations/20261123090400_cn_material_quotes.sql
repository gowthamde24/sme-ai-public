-- Job CN (wave 2, C1, ADR 0085), migration 5 of 7: MATERIAL QUOTES for the `materials` module: the area-to-quantity quote of a building-materials business, with transport, loading, laying, GST per item, advance and
-- credit terms. Money is the engine's, never a model's (non-negotiable 4): packages/quote-engine/src/quote_engine/construction.py (the reference) is run by the API, and THE DATABASE COMPUTES THE SAME QUOTE AGAIN
-- (app.cq_compute) and refuses any quote whose figures differ.
--
--   public.material_engine_versions   the allow-list of calculator versions the database accepts (migration-extended; not tenant data)
--   public.material_quote_policies    immutable, versioned: the owner's rules (wastage, pallets, transport rule, loading, laying, advance, credit days, validity, rounding), in the engine's own `policy` shape
--   public.material_quotes            one row per quote: provenance (requirement, policy version, engine version, canonical hash, the request and the result as the engine wrote them), the figures, the flags, who decided
--   public.material_quote_lines       one row per product line: what was quoted, in what quantity, at what rate, with what GST (the delivery plan and the challan read these)
--   app.cq_compute(request)           the SQL twin of the calculator (integer arithmetic only). app.cq_build(...) builds the request from the database's OWN sources (confirmed requirement, the human's picks,
--                                     the items' specs and the owner's price, the site's distance, the policy version, the customer's dues) so the caller never chooses a figure.
--   public.material_quote_build / _draft / _approve / _reject / _get / _list      the flow. Draft: Owner, Admin, Sales. Approve: Owner or Admin with a second factor; the Owner alone when the quote
--                                     carries a flag (a minimum order not met, a credit limit passed). Reject: Owner, Admin; Sales may withdraw their own draft.
--   public.create_order_from_material_quote   an approved material quote becomes an ORDER of the same lifecycle as a saree order (orders.material_quote_id; orders.quote_id is then null). A credit-limit WARNING is returned.
--
-- What the database proves, and what it cannot (the honest limit, as ADR 0021): the figures, the flags, the request and the hash are the database's own; the rule trace is stored as given; an Owner or Admin
-- calling these functions directly is trusted to have run the engine (the T006 option-A limit; option B before an external customer). The customer's dues are a snapshot taken at the draft: they are part of the stored
-- request, so a payment recorded later does not make the quote stale (the order creation checks the credit again, fresh).
--
-- SQLSTATEs (app.cq_error): SM761 the quote does not match its recomputation, SM762 an input the quote needs is missing (DETAIL names it: pick, measure, product_type, price, gst_rate, pieces_per_area, unit, hsn,
-- policy, requirement, duplicate_item), SM763 the quote is not a draft, SM764 the quote is stale or expired, SM765 the quote needs the Owner's approval, SM766 the figures cannot be computed (DETAIL: the calculator's closed
-- code), SM767 the requirement is not confirmed. For an order: the existing SM230 (not approved), SM231 (an order exists), SM233, SM236 (expired), SM239 (no order policy). 42501, 22023, 23503, 23505, SM306 as everywhere.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. errors, the version allow-list, small helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cq_error(p_code text, p_detail text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_code
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'record id already used' using errcode = '23505';
    when 'SM761'     then raise exception 'quote does not match its recomputation' using errcode = 'SM761', detail = p_detail;
    when 'SM762'     then raise exception 'quote input missing' using errcode = 'SM762', detail = p_detail;
    when 'SM763'     then raise exception 'quote is not a draft' using errcode = 'SM763';
    when 'SM764'     then raise exception 'quote is stale or expired' using errcode = 'SM764';
    when 'SM765'     then raise exception 'quote needs the owner''s approval' using errcode = 'SM765';
    when 'SM766'     then raise exception 'the figures cannot be computed' using errcode = 'SM766', detail = p_detail;
    when 'SM767'     then raise exception 'requirement is not confirmed' using errcode = 'SM767';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.cq_error(text, text) from public;

create table public.material_engine_versions (
  version  text primary key check (version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  added_at timestamptz not null default now()
);
comment on column public.material_engine_versions.version is 'SAFE: a semantic version. CLEAN-EXEMPT: strict anchored pattern, written only by migrations';
alter table public.material_engine_versions enable row level security;
alter table public.material_engine_versions force row level security;
revoke all on public.material_engine_versions from public, anon, authenticated;
insert into public.material_engine_versions (version) values ('1.0.0');

-- a JSON number that is a whole number inside [lo, hi]
create function app.cq_is_int(p jsonb, lo bigint, hi bigint) returns boolean
language sql
immutable
set search_path = ''
as $$ select p is not null and jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,15}$' and (p #>> '{}')::numeric between lo and hi $$;
revoke all on function app.cq_is_int(jsonb, bigint, bigint) from public;

-- ceil(n / d) for non-negative integers
create function app.cq_cdiv(n bigint, d bigint) returns bigint
language sql
immutable
set search_path = ''
as $$ select (n + d - 1) / d $$;
revoke all on function app.cq_cdiv(bigint, bigint) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the policy: the engine's `policy` object, validated with the engine's own rules
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cq_policy_ok(p jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  t    jsonb;
  kind text;
  s    jsonb;
  prev integer := -1;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k <> all (array['default_wastage_bps', 'round_to_pallet', 'bill_wastage', 'transport', 'advance_bps', 'credit_days', 'validity_days', 'rounding_mode', 'handling', 'laying']))
     or not (p ?& array['default_wastage_bps', 'round_to_pallet', 'bill_wastage', 'transport', 'advance_bps', 'credit_days', 'validity_days', 'rounding_mode']) then
    return false;
  end if;
  if not app.cq_is_int(p -> 'default_wastage_bps', 0, 5000) or jsonb_typeof(p -> 'round_to_pallet') <> 'boolean' or jsonb_typeof(p -> 'bill_wastage') <> 'boolean'
     or not app.cq_is_int(p -> 'advance_bps', 0, 10000) or not app.cq_is_int(p -> 'credit_days', 0, 180) or not app.cq_is_int(p -> 'validity_days', 0, 365)
     or jsonb_typeof(p -> 'rounding_mode') <> 'string' or (p ->> 'rounding_mode') <> all (array['half_up', 'half_even', 'down']) then
    return false;
  end if;
  t := p -> 'transport';
  if jsonb_typeof(t) <> 'object' or jsonb_typeof(t -> 'kind') <> 'string' then return false; end if;
  kind := t ->> 'kind';
  if exists (select 1 from jsonb_object_keys(t) k where k <> all (array['kind', 'capacity_basis', 'truck_capacity', 'rate_per_trip_paise', 'slabs', 'free_above_paise', 'gst_bps'])) then return false; end if;
  if kind = 'none' then
    if exists (select 1 from jsonb_object_keys(t) k where k <> all (array['kind', 'capacity_basis', 'truck_capacity'])) or (t ? 'capacity_basis') <> (t ? 'truck_capacity') then return false; end if;
    if t ? 'capacity_basis' and ((t ->> 'capacity_basis') is null or jsonb_typeof(t -> 'capacity_basis') <> 'string' or (t ->> 'capacity_basis') <> all (array['pieces', 'area'])
                                 or not app.cq_is_int(t -> 'truck_capacity', 1, 1000000)) then return false; end if;
  elsif kind in ('per_trip', 'per_km_slab') then
    if not app.cq_is_int(t -> 'gst_bps', 0, 10000) then return false; end if;
    if (t ? 'capacity_basis') <> (t ? 'truck_capacity') then return false; end if;
    if t ? 'capacity_basis' and (jsonb_typeof(t -> 'capacity_basis') <> 'string' or (t ->> 'capacity_basis') <> all (array['pieces', 'area']) or not app.cq_is_int(t -> 'truck_capacity', 1, 1000000)) then return false; end if;
    if t ? 'free_above_paise' and jsonb_typeof(t -> 'free_above_paise') <> 'null' and not app.cq_is_int(t -> 'free_above_paise', 1, 1000000000) then return false; end if;
    if kind = 'per_trip' then
      if not (t ? 'rate_per_trip_paise') or not (t ? 'truck_capacity') or t ? 'slabs' or not app.cq_is_int(t -> 'rate_per_trip_paise', 0, 100000000) then return false; end if;
    else
      if not (t ? 'slabs') or t ? 'rate_per_trip_paise' or jsonb_typeof(t -> 'slabs') <> 'array' or jsonb_array_length(t -> 'slabs') not between 1 and 10 then return false; end if;
      for s in select x from jsonb_array_elements(t -> 'slabs') x loop
        if jsonb_typeof(s) <> 'object' or exists (select 1 from jsonb_object_keys(s) k where k <> all (array['up_to_km', 'charge_paise'])) or not (s ?& array['up_to_km', 'charge_paise'])
           or not app.cq_is_int(s -> 'up_to_km', 0, 5000) or not app.cq_is_int(s -> 'charge_paise', 0, 100000000) or (s ->> 'up_to_km')::integer <= prev then
          return false;
        end if;
        prev := (s ->> 'up_to_km')::integer;
      end loop;
    end if;
  else
    return false;
  end if;
  if p ? 'handling' then
    s := p -> 'handling';
    if jsonb_typeof(s) <> 'object' or exists (select 1 from jsonb_object_keys(s) k where k <> all (array['per', 'amount_paise', 'gst_bps'])) or not (s ?& array['per', 'amount_paise', 'gst_bps'])
       or jsonb_typeof(s -> 'per') <> 'string' or (s ->> 'per') <> all (array['order', 'trip']) or not app.cq_is_int(s -> 'amount_paise', 0, 100000000) or not app.cq_is_int(s -> 'gst_bps', 0, 10000) then return false; end if;
  end if;
  if p ? 'laying' then
    s := p -> 'laying';
    if jsonb_typeof(s) <> 'object' or exists (select 1 from jsonb_object_keys(s) k where k <> all (array['rate_paise_per_area', 'gst_bps'])) or not (s ?& array['rate_paise_per_area', 'gst_bps'])
       or not app.cq_is_int(s -> 'rate_paise_per_area', 0, 100000000) or not app.cq_is_int(s -> 'gst_bps', 0, 10000) then return false; end if;
  end if;
  return true;
end;
$$;
revoke all on function app.cq_policy_ok(jsonb) from public;

create table public.material_quote_policies (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  version_no     integer not null check (version_no >= 1),
  effective_from date not null,
  policy         jsonb not null check (app.cq_policy_ok(policy)),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_no)
);
create index material_quote_policies_active_idx on public.material_quote_policies (tenant_id, effective_from desc, version_no desc);
comment on column public.material_quote_policies.policy is 'SAFE: the owner''s quoting rules (basis points, paise, closed words); no personal data. CLEAN-EXEMPT: every value is checked by app.cq_policy_ok (numbers and closed words only)';
comment on column public.material_quote_policies.content_sha256 is 'SAFE: sha256 of the normalised policy. CLEAN-EXEMPT: strict anchored hex pattern';

create function app.material_policy_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a quote policy version is never changed or deleted: make a new version' using errcode = '42501';
end;
$$;
revoke all on function app.material_policy_immutable() from public;
create trigger material_quote_policies_immutable before update or delete on public.material_quote_policies for each row execute function app.material_policy_immutable();
create trigger material_quote_policies_no_truncate before truncate on public.material_quote_policies for each statement execute function app.material_policy_immutable();
create trigger material_quote_policies_forbid_tenant_id_change before update on public.material_quote_policies for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.material_quote_policies for each row execute function app.module_guard('materials');
create trigger audit_material_quote_policies after insert or update or delete on public.material_quote_policies for each row execute function app.audit_row_change('material_quote_policy', '');

create function app.material_active_policy(p_tenant uuid, p_on date) returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select v.id from public.material_quote_policies v where v.tenant_id = p_tenant and v.effective_from <= p_on order by v.effective_from desc, v.version_no desc limit 1 $$;
revoke all on function app.material_active_policy(uuid, date) from public;

-- The Owner, with a second factor, saves the rules (a new version; the effective date is today or later and never before an earlier version's).
create function public.material_policy_create(p_version_id uuid, p_tenant_id uuid, p_effective_from date, p_policy jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_hash   text;
  v_exist  public.material_quote_policies;
  v_no     integer;
  v_latest date;
begin
  if v_uid is null or p_tenant_id is null or p_version_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.cq_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'materials');
  perform app.require_aal2();
  if p_effective_from is null or not app.cq_policy_ok(p_policy) then
    perform app.cq_error('invalid');
  end if;
  -- the hash of the policy as the database holds it (jsonb text is normalised: keys ordered, one spacing)
  v_hash := encode(sha256(convert_to(p_policy::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('material_policy:' || p_tenant_id::text, 0));
  select * into v_exist from public.material_quote_policies v where v.id = p_version_id;
  if found then
    if v_exist.tenant_id = p_tenant_id and v_exist.content_sha256 = v_hash and v_exist.effective_from = p_effective_from then
      return jsonb_build_object('version_id', v_exist.id, 'version_no', v_exist.version_no, 'effective_from', v_exist.effective_from, 'replayed', true);
    end if;
    perform app.cq_error('conflict');
  end if;
  select max(v.effective_from), coalesce(max(v.version_no), 0) + 1 into v_latest, v_no from public.material_quote_policies v where v.tenant_id = p_tenant_id;
  if p_effective_from < app.quote_today() or p_effective_from < coalesce(v_latest, p_effective_from) then
    perform app.cq_error('invalid');
  end if;
  insert into public.material_quote_policies (id, tenant_id, version_no, effective_from, policy, content_sha256, created_by)
  values (p_version_id, p_tenant_id, v_no, p_effective_from, p_policy, v_hash, v_uid);
  return jsonb_build_object('version_id', p_version_id, 'version_no', v_no, 'effective_from', p_effective_from, 'replayed', false);
end;
$$;
revoke all on function public.material_policy_create(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.material_policy_create(uuid, uuid, date, jsonb) to authenticated;

-- The rules in force today (and the history): every member who may quote reads them.
create function public.material_policy_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.material_quote_policies;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.cq_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'materials');
  select * into v from public.material_quote_policies x where x.id = app.material_active_policy(p_tenant_id, app.quote_today());
  if not found then
    return jsonb_build_object('current', null, 'versions', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'current', jsonb_build_object('version_id', v.id, 'version_no', v.version_no, 'effective_from', v.effective_from, 'policy', v.policy),
    'versions', (select jsonb_agg(jsonb_build_object('version_id', x.id, 'version_no', x.version_no, 'effective_from', x.effective_from, 'created_at', x.created_at) order by x.version_no desc)
                   from public.material_quote_policies x where x.tenant_id = p_tenant_id));
end;
$$;
revoke all on function public.material_policy_get(uuid) from public, anon;
grant execute on function public.material_policy_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the SQL twin of the calculator (packages/quote-engine/src/quote_engine/construction.py, version 1.0.0). It assumes a VALID request (app.cq_build builds only valid ones) and raises SM766 with the
--    calculator's own code where the calculator would REJECT (a distance beyond the slabs, laying without a rate, a total over the limit). Key by key it returns what the calculator returns.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cq_compute(r jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  p          jsonb := r -> 'policy';
  t          jsonb := p -> 'transport';
  c          jsonb := r -> 'customer';
  v_mode     text := p ->> 'rounding_mode';
  v_kind     text := t ->> 'kind';
  v_basis    text := t ->> 'capacity_basis';
  src        jsonb;
  v_lines    jsonb := '[]'::jsonb;
  v_flags    jsonb := '[]'::jsonb;
  v_uncount  text[] := '{}';
  a          bigint;
  ppa        bigint;
  w          integer;
  base_p     bigint;
  pieces     bigint;
  pallets    bigint;
  ppp        bigint;
  use_pal    boolean;
  delivered  bigint;
  billed     bigint;
  material   bigint;
  mincheck   bigint;
  lload      bigint;
  tax        bigint;
  price      bigint;
  q          bigint;
  v_sold     text;
  load_p     bigint := 0;
  load_a     bigint := 0;
  ord_area   bigint := 0;
  has_area   boolean := false;
  mat_total  bigint := 0;
  item_tax   bigint := 0;
  v_capacity bigint;
  v_load     bigint;
  v_trips    bigint := 1;
  v_transport bigint := 0;
  v_ttax     bigint := 0;
  v_handling bigint := 0;
  v_htax     bigint := 0;
  v_laying   bigint := 0;
  v_ltax     bigint := 0;
  v_dist     integer;
  v_slab     jsonb;
  v_subtotal bigint;
  v_tax      bigint;
  v_total    bigint;
  v_adv      bigint;
  v_bal      bigint;
  v_days     integer := (p ->> 'credit_days')::integer;
  v_as_of    date := (r ->> 'as_of')::date;
  v_limit    bigint;
  v_expo     bigint;
begin
  for src in select x from jsonb_array_elements(r -> 'lines') x loop
    price := (src ->> 'unit_price_paise')::bigint;
    v_sold := src ->> 'sold_per';
    if src ->> 'mode' = 'area' then
      a := (src ->> 'area_x100')::bigint;
      ppa := (src ->> 'pieces_per_area_x1000')::bigint;
      w := coalesce((src ->> 'wastage_bps')::integer, (p ->> 'default_wastage_bps')::integer);
      ord_area := ord_area + a;
      has_area := true;
      base_p := app.cq_cdiv(a * ppa, 100000);
      pieces := app.cq_cdiv(a * ppa * (10000 + w), 100000::bigint * 10000);
      pallets := null;
      ppp := (src ->> 'pieces_per_pallet')::bigint;
      use_pal := coalesce((src ->> 'round_to_pallet')::boolean, (p ->> 'round_to_pallet')::boolean);
      if ppp is not null then
        pallets := app.cq_cdiv(pieces, ppp);
        if use_pal then pieces := pallets * ppp; end if;
      end if;
      if pieces > 10000000 then perform app.cq_error('SM766', 'OUT_OF_RANGE'); end if;
      delivered := app.cq_cdiv(pieces * 100000, ppa);
      if v_sold = 'piece' then
        billed := pieces;
        material := pieces * price;
        mincheck := pieces;
      else
        billed := case when (p ->> 'bill_wastage')::boolean then delivered else a end;
        material := app.quote_round(billed * price, 100, v_mode);
        mincheck := app.cq_cdiv(billed, 100);
      end if;
      lload := pieces;
      load_p := load_p + pieces;
      load_a := load_a + delivered;
    else
      q := (src ->> 'quantity')::bigint;
      w := coalesce((src ->> 'wastage_bps')::integer, 0);
      billed := app.cq_cdiv(q * (10000 + w), 10000);
      material := billed * price;
      mincheck := billed;
      base_p := null;
      delivered := null;
      pallets := null;
      if v_sold = 'piece' then
        lload := billed;
        load_p := load_p + billed;
        pieces := billed;
      else
        lload := 0;
        v_uncount := v_uncount || (src ->> 'sku');
        pieces := null;
      end if;
    end if;
    if src ? 'min_order_qty' and mincheck < (src ->> 'min_order_qty')::bigint then
      v_flags := v_flags || jsonb_build_object('code', 'BELOW_MINIMUM_ORDER_QUANTITY', 'sku', src ->> 'sku');
    end if;
    tax := app.quote_round(material * (src ->> 'gst_bps')::bigint, 10000, v_mode);
    mat_total := mat_total + material;
    item_tax := item_tax + tax;
    v_lines := v_lines || jsonb_build_object(
      'sku', src ->> 'sku', 'name', src ->> 'name', 'hsn', src -> 'hsn', 'mode', src ->> 'mode', 'unit_price_paise', price, 'gst_bps', (src ->> 'gst_bps')::integer,
      'pieces', pieces, 'pieces_without_wastage', base_p, 'pallets', pallets, 'delivered_area_x100', delivered, 'billed_quantity', billed, 'billed_per', v_sold,
      'load', lload, 'material', material, 'tax', tax, 'gross', material + tax);
  end loop;
  -- (a `hsn` absent from the request is an absent key in `src`; `src -> 'hsn'` is then SQL null, which jsonb_build_object writes as JSON null, as the calculator's `src.get("hsn")` does)

  -- trips
  if t ? 'truck_capacity' then
    v_capacity := case when v_basis = 'pieces' then (t ->> 'truck_capacity')::bigint else (t ->> 'truck_capacity')::bigint * 100 end;
    v_load := case when v_basis = 'pieces' then load_p else load_a end;
    v_trips := greatest(1, app.cq_cdiv(v_load, v_capacity));
    for i in 1 .. coalesce(cardinality(v_uncount), 0) loop
      v_flags := v_flags || jsonb_build_object('code', 'LINE_NOT_COUNTED_IN_TRIPS', 'sku', v_uncount[i]);
    end loop;
  end if;
  if v_kind = 'per_trip' then
    v_transport := v_trips * (t ->> 'rate_per_trip_paise')::bigint;
  elsif v_kind = 'per_km_slab' then
    if not (r ? 'distance_km') then perform app.cq_error('SM766', 'DISTANCE_MISSING'); end if;
    v_dist := (r ->> 'distance_km')::integer;
    select x into v_slab from jsonb_array_elements(t -> 'slabs') x where v_dist <= (x ->> 'up_to_km')::integer order by (x ->> 'up_to_km')::integer limit 1;
    if v_slab is null then perform app.cq_error('SM766', 'DISTANCE_BEYOND_SLABS'); end if;
    v_transport := v_trips * (v_slab ->> 'charge_paise')::bigint;
  end if;
  if v_kind <> 'none' and t ? 'free_above_paise' and jsonb_typeof(t -> 'free_above_paise') = 'number' then
    if mat_total > (t ->> 'free_above_paise')::bigint then v_transport := 0; end if;
  end if;
  if v_kind <> 'none' then
    v_ttax := app.quote_round(v_transport * (t ->> 'gst_bps')::bigint, 10000, v_mode);
  end if;
  if p ? 'handling' then
    v_handling := (p #>> '{handling,amount_paise}')::bigint * case when p #>> '{handling,per}' = 'trip' then v_trips else 1 end;
    v_htax := app.quote_round(v_handling * (p #>> '{handling,gst_bps}')::bigint, 10000, v_mode);
  end if;
  if coalesce((r ->> 'laying')::boolean, false) then
    if not (p ? 'laying') or not has_area then perform app.cq_error('SM766', 'LAYING_RATE_MISSING'); end if;
    v_laying := app.quote_round(ord_area * (p #>> '{laying,rate_paise_per_area}')::bigint, 100, v_mode);
    v_ltax := app.quote_round(v_laying * (p #>> '{laying,gst_bps}')::bigint, 10000, v_mode);
  end if;
  v_tax := item_tax + v_ttax + v_htax + v_ltax;
  v_subtotal := mat_total + v_transport + v_handling + v_laying;
  v_total := v_subtotal + v_tax;
  if v_total > 1000000000 then perform app.cq_error('SM766', 'TOTAL_TOO_LARGE'); end if;
  v_adv := app.quote_round(v_total * (p ->> 'advance_bps')::bigint, 10000, v_mode);
  v_bal := v_total - v_adv;
  if c ? 'credit_limit_paise' and jsonb_typeof(c -> 'credit_limit_paise') = 'number' then
    v_limit := (c ->> 'credit_limit_paise')::bigint;
    v_expo := (c ->> 'outstanding_paise')::bigint + v_bal;
    if v_expo > v_limit then
      v_flags := v_flags || jsonb_build_object('code', 'CREDIT_LIMIT_EXCEEDED', 'exposure', v_expo, 'credit_limit_paise', v_limit);
    end if;
  end if;
  return jsonb_build_object(
    'lines', v_lines,
    'trips', v_trips,
    'totals', jsonb_build_object('material', mat_total, 'transport', v_transport, 'handling', v_handling, 'laying', v_laying, 'subtotal', v_subtotal, 'item_tax', item_tax,
                                 'transport_tax', v_ttax, 'handling_tax', v_htax, 'laying_tax', v_ltax, 'tax', v_tax, 'total', v_total),
    'payment_terms', jsonb_build_object('advance_amount', v_adv, 'balance', v_bal, 'credit_days', v_days,
                                        'due_date', case when v_days > 0 then to_jsonb((v_as_of + v_days)::text) else 'null'::jsonb end,
                                        'balance_on', case when v_days > 0 then 'credit_days' else 'delivery' end),
    'valid_until', (v_as_of + (p ->> 'validity_days')::integer)::text,
    'flag_list', v_flags);
end;
$$;
revoke all on function app.cq_compute(jsonb) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.material_quotes (
  id                 uuid primary key,
  tenant_id          uuid not null references public.tenants (id) on delete restrict,
  quote_no           integer not null check (quote_no >= 1),
  requirement_id     uuid not null,
  enquiry_id         uuid not null,
  lead_id            uuid not null,
  site_id            uuid,
  status             public.quote_status not null default 'draft',
  policy_version_id  uuid not null,
  engine_version     text not null references public.material_engine_versions (version),
  request_text       text not null check (char_length(request_text) between 2 and 50000 and app.text_is_clean(request_text)),
  result_text        text not null check (char_length(result_text) between 2 and 200000 and app.text_is_clean(result_text)),
  canonical_hash     text not null check (canonical_hash ~ '^[0-9a-f]{64}$'),
  as_of              date not null,
  valid_until        date not null,
  due_date           date,
  trips              integer not null check (trips between 1 and 100000),
  material_paise     bigint not null check (material_paise >= 0),
  transport_paise    bigint not null check (transport_paise >= 0),
  handling_paise     bigint not null check (handling_paise >= 0),
  laying_paise       bigint not null check (laying_paise >= 0),
  tax_paise          bigint not null check (tax_paise >= 0),
  total_paise        bigint not null check (total_paise between 0 and 1000000000),
  advance_paise      bigint not null check (advance_paise >= 0),
  balance_paise      bigint not null check (balance_paise >= 0),
  engine_flags       text[] not null default '{}' check (engine_flags <@ array['BELOW_MINIMUM_ORDER_QUANTITY', 'CREDIT_LIMIT_EXCEEDED', 'LINE_NOT_COUNTED_IN_TRIPS']::text[]),
  needs_owner_approval boolean not null,
  created_by         uuid,
  created_via        public.record_origin not null default 'manual',
  created_at         timestamptz not null default now(),
  approved_by        uuid,
  approved_at        timestamptz,
  approved_hash      text check (approved_hash ~ '^[0-9a-f]{64}$'),
  rejected_by        uuid,
  rejected_at        timestamptz,
  reject_code        public.quote_reject_code,
  unique (tenant_id, id),
  unique (tenant_id, quote_no),
  foreign key (tenant_id, requirement_id)   references public.requirements (tenant_id, id),
  foreign key (tenant_id, enquiry_id)       references public.enquiries (tenant_id, id),
  foreign key (tenant_id, lead_id)          references public.leads (tenant_id, id),
  foreign key (tenant_id, site_id)          references public.customer_sites (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references public.material_quote_policies (tenant_id, id),
  check (total_paise = material_paise + transport_paise + handling_paise + laying_paise + tax_paise),
  check (advance_paise + balance_paise = total_paise),
  check (valid_until >= as_of),
  check (needs_owner_approval = (cardinality(engine_flags) > 0)),
  check ((approved_by is null) = (approved_at is null) and (approved_at is null) = (approved_hash is null)),
  check ((rejected_by is null) = (rejected_at is null) and (rejected_at is null) = (reject_code is null)),
  check (approved_at is null or rejected_at is null),
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'rejected' or rejected_at is not null),
  check (status <> 'draft' or (approved_at is null and rejected_at is null))
);
create unique index material_quotes_one_draft_key    on public.material_quotes (tenant_id, requirement_id) where status = 'draft';
create unique index material_quotes_one_approved_key on public.material_quotes (tenant_id, requirement_id) where status = 'approved';
create index material_quotes_keyset_idx      on public.material_quotes (tenant_id, created_at, id);
create index material_quotes_requirement_idx on public.material_quotes (tenant_id, requirement_id, created_at desc);
create index material_quotes_lead_idx        on public.material_quotes (tenant_id, lead_id);
create index material_quotes_site_idx        on public.material_quotes (tenant_id, site_id) where site_id is not null;
create index material_quotes_policy_idx      on public.material_quotes (tenant_id, policy_version_id);
create index material_quotes_enquiry_idx     on public.material_quotes (tenant_id, enquiry_id);
create index material_quotes_engine_idx      on public.material_quotes (engine_version);
comment on column public.material_quotes.request_text is 'SAFE: the canonical calculator request (item ids and names, integer quantities and paise, rates in basis points, dates, policy numbers); no personal data; text_is_clean-guarded; written only by material_quote_draft';
comment on column public.material_quotes.result_text is 'SAFE: the calculator result with its rule trace (integers, closed codes, item names); no personal data; text_is_clean-guarded; written only by material_quote_draft';
comment on column public.material_quotes.canonical_hash is 'SAFE: sha256 of the canonical request. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.material_quotes.approved_hash is 'SAFE: the canonical hash the approver''s recomputation produced. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.material_quotes.engine_version is 'SAFE: a semantic version from the material_engine_versions allow-list. CLEAN-EXEMPT: a foreign key to the allow-list (a strict pattern there)';
comment on column public.material_quotes.engine_flags is 'SAFE: closed flag codes. CLEAN-EXEMPT: subset of a closed list';

create table public.material_quote_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  quote_id            uuid not null,
  line_no             smallint not null check (line_no between 1 and 5),
  catalogue_item_id   uuid not null,
  name                text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  mode                text not null check (mode in ('area', 'direct')),
  sold_per            text not null references packs.units (code),
  unit_price_paise    bigint not null check (unit_price_paise >= 0),
  gst_bps             integer not null check (gst_bps between 0 and 10000),
  hsn                 text check (hsn ~ '^[0-9]{4,8}$'),
  area_x100           bigint check (area_x100 > 0),
  area_unit           text check (area_unit in ('sq_ft', 'sq_m')),
  pieces              bigint check (pieces >= 0),
  pallets             bigint check (pallets >= 0),
  delivered_area_x100 bigint check (delivered_area_x100 >= 0),
  billed_quantity     bigint not null check (billed_quantity >= 0),
  material_paise      bigint not null check (material_paise >= 0),
  tax_paise           bigint not null check (tax_paise >= 0),
  unique (tenant_id, id),
  unique (tenant_id, quote_id, line_no),
  foreign key (tenant_id, quote_id) references public.material_quotes (tenant_id, id),
  foreign key (tenant_id, catalogue_item_id) references public.catalogue_items (tenant_id, id)
);
create index material_quote_lines_item_idx on public.material_quote_lines (tenant_id, catalogue_item_id);
create index material_quote_lines_unit_idx on public.material_quote_lines (sold_per);
comment on column public.material_quote_lines.name is 'SAFE: the name of an item in the business''s own catalogue at the time of the quote; no personal data';
comment on column public.material_quote_lines.mode is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.material_quote_lines.sold_per is 'SAFE: a closed selling unit (packs.units). CLEAN-EXEMPT: a foreign key to the closed list';
comment on column public.material_quote_lines.area_unit is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.material_quote_lines.hsn is 'SAFE: an HSN code (digits). CLEAN-EXEMPT: strict pattern in a CHECK';

-- content never changes; only the status (and who decided) moves, only through the functions
create function app.material_quotes_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'quotes are never deleted' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code')
     is distinct from (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code') then
    raise exception 'the content of a quote never changes' using errcode = '42501';
  end if;
  if old.status <> 'draft' and new.status is distinct from old.status and not (old.status = 'approved' and new.status = 'superseded') then
    raise exception 'a decided quote does not change state' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.material_quotes_guard() from public;
create trigger material_quotes_guard before update or delete on public.material_quotes for each row execute function app.material_quotes_guard();
create trigger material_quotes_no_truncate before truncate on public.material_quotes for each statement execute function app.material_quotes_guard();
create function app.material_quote_lines_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'quote lines are never changed or deleted' using errcode = '42501';
end;
$$;
revoke all on function app.material_quote_lines_guard() from public;
create trigger material_quote_lines_guard before update or delete on public.material_quote_lines for each row execute function app.material_quote_lines_guard();
create trigger material_quote_lines_no_truncate before truncate on public.material_quote_lines for each statement execute function app.material_quote_lines_guard();
create trigger material_quotes_forbid_tenant_id_change before update on public.material_quotes for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.material_quotes for each row execute function app.module_guard('materials');
create trigger module_guard before insert on public.material_quote_lines for each row execute function app.module_guard('materials');
create trigger audit_material_quotes after insert or update or delete on public.material_quotes for each row execute function app.audit_row_change('material_quote', '');
create trigger audit_material_quote_lines after insert or update or delete on public.material_quote_lines for each row execute function app.audit_row_change('material_quote_line', '');
create trigger material_quote_lines_forbid_tenant_id_change before update on public.material_quote_lines for each row execute function app.forbid_tenant_id_change();

do $$
declare t text;
begin
  foreach t in array array['material_quote_policies', 'material_quotes', 'material_quote_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;

-- a requirement that a material quote (a draft or an approved one) depends on is not discarded (the same rule as for a saree quote, SM212)
create function app.requirement_discard_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'discarded' and old.status is distinct from 'discarded'
     and exists (select 1 from public.material_quotes z where z.tenant_id = new.tenant_id and z.requirement_id = new.id and z.status in ('draft', 'approved')) then
    raise exception 'a quote depends on this requirement' using errcode = 'SM212';
  end if;
  return new;
end;
$$;
revoke all on function app.requirement_discard_guard() from public;
create trigger requirements_discard_guard before update of status on public.requirements for each row execute function app.requirement_discard_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. building the request from the database's own sources
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cq_spec(p_tenant uuid, p_item uuid, p_code text) returns public.custom_field_values
language sql
stable
security definer
set search_path = ''
as $$
  select v.* from public.custom_field_values v join public.custom_field_defs d on d.tenant_id = v.tenant_id and d.id = v.field_id
   where v.tenant_id = p_tenant and v.catalogue_item_id = p_item and d.entity = 'catalogue_item' and d.code = p_code limit 1
$$;
revoke all on function app.cq_spec(uuid, uuid, text) from public;

-- an owner-entered number that must be a whole number of `scale` units: 4.5 with scale 1000 = 4500; null when absent; SM762 when it does not fit
create function app.cq_spec_int(p_tenant uuid, p_item uuid, p_code text, p_scale integer, p_lo bigint, p_hi bigint, p_missing text) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v numeric := (app.cq_spec(p_tenant, p_item, p_code)).value_number;
begin
  if v is null then
    if p_missing is not null then perform app.cq_error('SM762', p_missing); end if;
    return null;
  end if;
  v := v * p_scale;
  if v <> trunc(v) or v < p_lo or v > p_hi then
    perform app.cq_error('SM762', coalesce(p_missing, p_code));
  end if;
  return v::bigint;
end;
$$;
revoke all on function app.cq_spec_int(uuid, uuid, text, integer, bigint, bigint, text) from public;

-- the request the calculator is given for one requirement, the human's picks ([{"line_no":1,"item_id":"..."}]) and an optional site; `p_customer` is the stored snapshot when a quote is re-checked.
-- Returns {request, core, as_of, valid_until, due_date, lines, flags, lead_id, enquiry_id, company_id, site_id, policy_version_id}.
create function app.cq_build(p_tenant uuid, p_requirement uuid, p_as_of date, p_policy_version uuid, p_picks jsonb, p_site uuid, p_customer jsonb default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pol      public.material_quote_policies;
  q        public.requirements;
  e        public.enquiries;
  lead     public.leads;
  site     public.customer_sites;
  v_line   record;
  v_item   public.catalogue_items;
  v_pick   jsonb;
  v_lines  jsonb := '[]'::jsonb;
  v_rows   jsonb := '[]'::jsonb;
  v_items  uuid[] := '{}';
  v_area   bigint;
  v_unit   text;
  v_qty    bigint;
  v_qbasis text;
  v_len    public.requirement_fields;
  v_wid    public.requirement_fields;
  v_gst    bigint;
  v_ppa    bigint;
  v_ppp    bigint;
  v_min    bigint;
  v_hsn    text;
  v_one    jsonb;
  v_laying boolean;
  v_req    jsonb;
  v_core   jsonb;
  v_cust   jsonb;
  v_limit  bigint;
  v_sku    text;
  v_nums   smallint[];
begin
  select * into pol from public.material_quote_policies v where v.tenant_id = p_tenant and v.id = p_policy_version;
  if pol.id is null then perform app.cq_error('SM762', 'policy'); end if;
  select * into q from public.requirements x where x.tenant_id = p_tenant and x.id = p_requirement;
  if q.id is null then perform app.cq_error('reference'); end if;
  select * into e from public.enquiries x where x.tenant_id = p_tenant and x.id = q.enquiry_id;
  select * into lead from public.leads x where x.tenant_id = p_tenant and x.id = e.lead_id;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) not between 1 and 5 then perform app.cq_error('SM762', 'pick'); end if;
  if p_site is not null then
    select * into site from public.customer_sites s where s.tenant_id = p_tenant and s.id = p_site;
    if site.id is null then perform app.cq_error('reference'); end if;
  end if;

  -- the lines of the requirement: every line that has anything a person settled, and each needs a product type AND a measure
  select array_agg(distinct f.line_no order by f.line_no) into v_nums from public.requirement_fields f
   where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no is not null and f.state in ('confirmed', 'corrected')
     and f.field_key in ('product_type', 'area', 'length', 'width', 'quantity', 'thickness');
  if v_nums is null then perform app.cq_error('SM762', 'product_type'); end if;
  for v_line in select n as line_no from unnest(v_nums) n order by n loop
    if not exists (select 1 from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = v_line.line_no
                      and f.field_key = 'product_type' and f.state in ('confirmed', 'corrected')) then
      perform app.cq_error('SM762', 'product_type');
    end if;
    select x into v_pick from jsonb_array_elements(p_picks) x where (x ->> 'line_no') = v_line.line_no::text limit 1;
    if v_pick is null or (v_pick ->> 'item_id') !~ '^[0-9a-f-]{36}$' then perform app.cq_error('SM762', 'pick'); end if;
    select * into v_item from public.catalogue_items i where i.tenant_id = p_tenant and i.id = (v_pick ->> 'item_id')::uuid and i.item_kind = 'material';
    if v_item.id is null then perform app.cq_error('SM762', 'pick'); end if;
    if v_item.id = any (v_items) then perform app.cq_error('SM762', 'duplicate_item'); end if;
    v_items := v_items || v_item.id;
    if v_item.price_paise is null then perform app.cq_error('SM762', 'price'); end if;
    v_gst := app.cq_spec_int(p_tenant, v_item.id, 'gst_rate_percent', 100, 0, 10000, 'gst_rate');
    v_hsn := (app.cq_spec(p_tenant, v_item.id, 'hsn_code')).value_text;
    if v_hsn is not null and v_hsn !~ '^[0-9]{4,8}$' then perform app.cq_error('SM762', 'hsn'); end if;
    v_ppp := app.cq_spec_int(p_tenant, v_item.id, 'pieces_per_pallet', 1, 1, 10000000, null);
    v_min := app.cq_spec_int(p_tenant, v_item.id, 'minimum_order', 1, 1, 10000000, null);
    v_sku := v_item.id::text;

    -- the measure: an area, else length x width, else a quantity
    v_area := null; v_unit := null; v_qty := null;
    select f.value_int, f.basis into v_area, v_unit from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = v_line.line_no
       and f.field_key = 'area' and f.state in ('confirmed', 'corrected');
    if v_area is null then
      select * into v_len from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = v_line.line_no and f.field_key = 'length' and f.state in ('confirmed', 'corrected');
      select * into v_wid from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = v_line.line_no and f.field_key = 'width' and f.state in ('confirmed', 'corrected');
      if v_len.id is not null and v_wid.id is not null then
        if v_len.basis is distinct from v_wid.basis then perform app.cq_error('SM762', 'measure'); end if;
        v_area := app.quote_round(v_len.value_int * v_wid.value_int, 100, pol.policy ->> 'rounding_mode');
        v_unit := case v_len.basis when 'ft' then 'sq_ft' else 'sq_m' end;
        if v_area < 1 then perform app.cq_error('SM762', 'measure'); end if;
      end if;
    end if;
    if v_area is not null then
      -- by area: the item must count its pieces in this area unit and be sold by the piece or by this area unit
      if v_item.area_unit is distinct from v_unit or v_item.sell_unit not in ('piece', v_unit) then perform app.cq_error('SM762', 'unit'); end if;
      v_ppa := app.cq_spec_int(p_tenant, v_item.id, 'pieces_per_area', 1000, 1, 1000000, 'pieces_per_area');
      v_one := jsonb_build_object('sku', v_sku, 'name', v_item.name, 'mode', 'area', 'sold_per', v_item.sell_unit, 'unit_price_paise', v_item.price_paise, 'gst_bps', v_gst,
                                  'area_unit', v_unit, 'area_x100', v_area, 'pieces_per_area_x1000', v_ppa);
      if v_ppp is not null then v_one := v_one || jsonb_build_object('pieces_per_pallet', v_ppp); end if;
    else
      select f.value_int, f.basis into v_qty, v_qbasis from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.line_no = v_line.line_no
         and f.field_key = 'quantity' and f.state in ('confirmed', 'corrected');
      if v_qty is null then perform app.cq_error('SM762', 'measure'); end if;
      if v_item.sell_unit in ('sq_ft', 'sq_m') or v_qbasis is distinct from v_item.sell_unit then perform app.cq_error('SM762', 'unit'); end if;
      v_one := jsonb_build_object('sku', v_sku, 'name', v_item.name, 'mode', 'direct', 'sold_per', v_item.sell_unit, 'unit_price_paise', v_item.price_paise, 'gst_bps', v_gst, 'quantity', v_qty);
    end if;
    if v_hsn is not null then v_one := v_one || jsonb_build_object('hsn', v_hsn); end if;
    if v_min is not null then v_one := v_one || jsonb_build_object('min_order_qty', v_min); end if;
    v_lines := v_lines || v_one;
    v_rows := v_rows || (jsonb_build_object('line_no', v_line.line_no, 'item_id', v_item.id) || jsonb_build_object('area_x100', v_area, 'area_unit', v_unit));
  end loop;
  -- a pick for a line the requirement does not have is refused
  if exists (select 1 from jsonb_array_elements(p_picks) x where case when (x ->> 'line_no') ~ '^[1-5]$' then not ((x ->> 'line_no')::smallint = any (v_nums)) else true end) then
    perform app.cq_error('SM762', 'pick');
  end if;

  select exists (select 1 from public.requirement_fields f where f.tenant_id = p_tenant and f.requirement_id = p_requirement and f.field_key = 'laying' and f.value_code = 'yes'
                    and f.state in ('confirmed', 'corrected')) into v_laying;
  if p_customer is not null then
    v_cust := p_customer;
  else
    v_cust := jsonb_build_object('outstanding_paise', case when lead.company_id is not null and app.module_enabled(p_tenant, 'dues') then app.dues_outstanding(p_tenant, lead.company_id, p_as_of) else 0 end);
    if lead.company_id is not null and app.module_enabled(p_tenant, 'dues') then
      select l.limit_paise into v_limit from public.customer_credit_limits l where l.tenant_id = p_tenant and l.company_id = lead.company_id;
      if v_limit is not null then v_cust := v_cust || jsonb_build_object('credit_limit_paise', v_limit); end if;
    end if;
  end if;
  v_req := jsonb_build_object('as_of', p_as_of::text, 'lines', v_lines, 'policy', pol.policy, 'customer', v_cust);
  if v_laying then v_req := v_req || jsonb_build_object('laying', true); end if;
  if site.distance_km is not null then v_req := v_req || jsonb_build_object('distance_km', site.distance_km); end if;
  v_core := app.cq_compute(v_req);
  return jsonb_build_object('request', v_req, 'core', v_core - 'flag_list', 'flag_list', v_core -> 'flag_list', 'as_of', p_as_of, 'valid_until', v_core ->> 'valid_until',
                            'due_date', v_core #>> '{payment_terms,due_date}', 'picks', v_rows, 'lead_id', lead.id, 'enquiry_id', e.id, 'company_id', lead.company_id,
                            'site_id', site.id, 'policy_version_id', pol.id);
end;
$$;
revoke all on function app.cq_build(uuid, uuid, date, uuid, jsonb, uuid, jsonb) from public;

create function app.cq_flag_codes(p_flags jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$ select coalesce(array_agg(f ->> 'code'), '{}') from jsonb_array_elements(p_flags) f $$;
revoke all on function app.cq_flag_codes(jsonb) from public;

-- sha256 of {"engine_version":"<v>","inputs":<request text>}: the hash the calculator reports
create function app.cq_request_hash(p_engine_version text, p_request_text text) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to('{"engine_version":"' || p_engine_version || '","inputs":' || p_request_text || '}', 'UTF8')), 'hex') $$;
revoke all on function app.cq_request_hash(text, text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the flow
-- ---------------------------------------------------------------------------------------------------------------------------------
-- What the calculator must be given for this requirement and these picks, and what the database computes from it. Read-only; the API runs the engine on `request` and compares.
create function public.material_quote_build(p_tenant_id uuid, p_requirement_id uuid, p_picks jsonb, p_site_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.quote_today();
  v_pol   uuid;
  q       public.requirements;
begin
  if auth.uid() is null or p_tenant_id is null or p_requirement_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.cq_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'materials');
  select * into q from public.requirements x where x.tenant_id = p_tenant_id and x.id = p_requirement_id;
  if not found then perform app.cq_error('reference'); end if;
  if q.status <> 'confirmed' then perform app.cq_error('SM767'); end if;
  v_pol := app.material_active_policy(p_tenant_id, v_today);
  if v_pol is null then perform app.cq_error('SM762', 'policy'); end if;
  return app.cq_build(p_tenant_id, p_requirement_id, v_today, v_pol, p_picks, p_site_id);
end;
$$;
revoke all on function public.material_quote_build(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.material_quote_build(uuid, uuid, jsonb, uuid) to authenticated;

create function public.material_quote_draft(
  p_quote_id uuid, p_tenant_id uuid, p_requirement_id uuid, p_picks jsonb, p_site_id uuid, p_engine_version text, p_request_text text, p_result_text text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  q         public.requirements;
  e         public.enquiries;
  v_exist   public.material_quotes;
  v_today   date := app.quote_today();
  v_as_of   date;
  v_pol     uuid;
  v_build   jsonb;
  v_req     jsonb;
  v_res     jsonb;
  v_hash    text;
  v_flags   text[];
  v_needs   boolean;
  v_no      integer;
  l         jsonb;
  v_row     jsonb;
  t         jsonb;
begin
  if v_uid is null or p_quote_id is null or p_tenant_id is null or p_requirement_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.cq_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'materials');
  select * into q from public.requirements x where x.tenant_id = p_tenant_id and x.id = p_requirement_id;
  if not found then perform app.cq_error('deny'); end if;
  -- lock order: the enquiry row, then the requirement row, then the tenant's quote numbers
  select * into e from public.enquiries x where x.tenant_id = q.tenant_id and x.id = q.enquiry_id for update;
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if p_engine_version is null or p_request_text is null or p_result_text is null or char_length(p_request_text) > 50000 or char_length(p_result_text) > 200000
     or not app.text_is_clean(p_request_text) or not app.text_is_clean(p_result_text) then
    perform app.cq_error('invalid');
  end if;
  begin
    v_req := p_request_text::jsonb;
    v_res := p_result_text::jsonb;
  exception when others then
    perform app.cq_error('invalid');
  end;
  if jsonb_typeof(v_req) <> 'object' or jsonb_typeof(v_res) <> 'object' then perform app.cq_error('invalid'); end if;
  v_hash := app.cq_request_hash(p_engine_version, p_request_text);

  -- an exact retry replays; anything else under a used id is the constant conflict
  select * into v_exist from public.material_quotes z where z.id = p_quote_id;
  if found then
    if v_exist.tenant_id = q.tenant_id and v_exist.requirement_id = q.id and v_exist.canonical_hash = v_hash and v_exist.engine_version = p_engine_version then
      return jsonb_build_object('quote_id', v_exist.id, 'quote_no', v_exist.quote_no, 'status', v_exist.status, 'needs_owner_approval', v_exist.needs_owner_approval,
                                'canonical_hash', v_exist.canonical_hash, 'replayed', true);
    end if;
    perform app.cq_error('conflict');
  end if;
  if e.archived_at is not null then perform app.cq_error('reference'); end if;
  if q.status <> 'confirmed' then perform app.cq_error('SM767'); end if;
  if not exists (select 1 from public.material_engine_versions v where v.version = p_engine_version) then perform app.cq_error('invalid'); end if;

  begin
    v_as_of := (v_req ->> 'as_of')::date;
  exception when others then
    perform app.cq_error('invalid');
  end;
  if v_as_of is null or v_as_of not between v_today - 1 and v_today then perform app.cq_error('SM764'); end if;
  v_pol := app.material_active_policy(q.tenant_id, v_as_of);
  if v_pol is null then perform app.cq_error('SM762', 'policy'); end if;

  v_build := app.cq_build(q.tenant_id, q.id, v_as_of, v_pol, p_picks, p_site_id, v_req -> 'customer');
  -- 1. the request is the one the database builds, and its hash is the engine's
  if v_req is distinct from (v_build -> 'request') then perform app.cq_error('SM761', 'request'); end if;
  if v_res ->> 'status' is distinct from 'draft' or v_res ->> 'engine_version' is distinct from p_engine_version or v_res ->> 'canonical_hash' is distinct from v_hash
     or exists (select 1 from jsonb_object_keys(v_res) k where k <> all (array['status', 'engine_version', 'canonical_hash', 'lines', 'trips', 'totals', 'payment_terms', 'valid_until', 'flags', 'trace', 'range'])) then
    perform app.cq_error('SM761', 'result');
  end if;
  -- 2. every figure of the result is the database's own recomputation; the flags are exactly the derived ones
  if (v_res - 'status' - 'engine_version' - 'canonical_hash' - 'flags' - 'trace' - 'range') is distinct from (v_build -> 'core') then
    perform app.cq_error('SM761', 'figures');
  end if;
  v_flags := app.cq_flag_codes(v_build -> 'flag_list');
  if (v_res -> 'flags' -> 'reasons') is distinct from (v_build -> 'flag_list') or (v_res -> 'flags' -> 'needs_owner_approval') is distinct from 'true'::jsonb then
    perform app.cq_error('SM761', 'flags');
  end if;
  v_needs := cardinality(v_flags) > 0;

  perform pg_advisory_xact_lock(hashtextextended('material_quote_no:' || q.tenant_id::text, 0));
  update public.material_quotes z set status = 'superseded' where z.tenant_id = q.tenant_id and z.requirement_id = q.id and z.status = 'draft';
  select coalesce(max(z.quote_no), 0) + 1 into v_no from public.material_quotes z where z.tenant_id = q.tenant_id;
  t := v_build -> 'core' -> 'totals';
  insert into public.material_quotes
    (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, site_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, due_date,
     trips, material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, engine_flags, needs_owner_approval, created_by)
  values
    (p_quote_id, q.tenant_id, v_no, q.id, e.id, e.lead_id, nullif(v_build ->> 'site_id', '')::uuid, 'draft', v_pol, p_engine_version, p_request_text, p_result_text, v_hash, v_as_of,
     (v_build ->> 'valid_until')::date, nullif(v_build ->> 'due_date', '')::date, (v_build #>> '{core,trips}')::integer,
     (t ->> 'material')::bigint, (t ->> 'transport')::bigint, (t ->> 'handling')::bigint, (t ->> 'laying')::bigint, (t ->> 'tax')::bigint, (t ->> 'total')::bigint,
     (v_build #>> '{core,payment_terms,advance_amount}')::bigint, (v_build #>> '{core,payment_terms,balance}')::bigint, v_flags, v_needs, v_uid);
  for l in select x from jsonb_array_elements(v_build -> 'picks') x loop
    select x into v_row from jsonb_array_elements(v_build #> '{core,lines}') x where x ->> 'sku' = (l ->> 'item_id') limit 1;
    insert into public.material_quote_lines
      (tenant_id, quote_id, line_no, catalogue_item_id, name, mode, sold_per, unit_price_paise, gst_bps, hsn, area_x100, area_unit, pieces, pallets, delivered_area_x100, billed_quantity, material_paise, tax_paise)
    values
      (q.tenant_id, p_quote_id, (l ->> 'line_no')::smallint, (l ->> 'item_id')::uuid, v_row ->> 'name', v_row ->> 'mode', v_row ->> 'billed_per', (v_row ->> 'unit_price_paise')::bigint,
       (v_row ->> 'gst_bps')::integer, v_row ->> 'hsn', nullif(l ->> 'area_x100', '')::bigint, nullif(l ->> 'area_unit', ''), nullif(v_row ->> 'pieces', '')::bigint, nullif(v_row ->> 'pallets', '')::bigint,
       nullif(v_row ->> 'delivered_area_x100', '')::bigint, (v_row ->> 'billed_quantity')::bigint, (v_row ->> 'material')::bigint, (v_row ->> 'tax')::bigint);
  end loop;
  return jsonb_build_object('quote_id', p_quote_id, 'quote_no', v_no, 'status', 'draft', 'needs_owner_approval', v_needs, 'canonical_hash', v_hash, 'replayed', false);
end;
$$;
revoke all on function public.material_quote_draft(uuid, uuid, uuid, jsonb, uuid, text, text, text) from public, anon;
grant execute on function public.material_quote_draft(uuid, uuid, uuid, jsonb, uuid, text, text, text) to authenticated;

-- Approve: Owner or Admin with a second factor; the Owner alone when the quote carries a flag. Re-builds from the quote's recorded versions and the CURRENT picks, items, prices and policy: anything that moved is stale.
create function public.material_quote_approve(p_quote_id uuid, p_recomputed_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  z       public.material_quotes;
  q       public.requirements;
  v_build jsonb;
  v_picks jsonb;
  v_req   jsonb;
  v_today date := app.quote_today();
begin
  if v_uid is null or p_quote_id is null then perform app.cq_error('deny'); end if;
  select * into z from public.material_quotes x where x.id = p_quote_id;
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) then perform app.cq_error('deny'); end if;
  perform app.require_module(z.tenant_id, 'materials');
  perform app.require_aal2();
  if p_recomputed_hash is null or p_recomputed_hash !~ '^[0-9a-f]{64}$' then perform app.cq_error('invalid'); end if;
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  select * into q from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.material_quotes x where x.id = p_quote_id for update;
  if z.status = 'approved' and z.approved_by = v_uid and z.approved_hash = p_recomputed_hash then
    return jsonb_build_object('quote_id', z.id, 'status', z.status, 'approved_by', z.approved_by, 'replayed', true);
  end if;
  if z.status <> 'draft' then perform app.cq_error('SM763'); end if;
  if q.status <> 'confirmed' then perform app.cq_error('SM767'); end if;
  if z.needs_owner_approval and not app.has_tenant_role(z.tenant_id, array['owner']::public.app_role[]) then perform app.cq_error('SM765'); end if;
  if v_today > z.valid_until or app.material_active_policy(z.tenant_id, v_today) is distinct from z.policy_version_id then perform app.cq_error('SM764'); end if;
  if p_recomputed_hash <> z.canonical_hash then perform app.cq_error('SM761', 'hash'); end if;
  -- re-build from the recorded policy and as-of date, the current items and prices, and the customer snapshot stored with the quote
  select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_id', l.catalogue_item_id) order by l.line_no) into v_picks from public.material_quote_lines l where l.tenant_id = z.tenant_id and l.quote_id = z.id;
  v_req := z.request_text::jsonb;
  begin
    v_build := app.cq_build(z.tenant_id, z.requirement_id, z.as_of, z.policy_version_id, v_picks, z.site_id, v_req -> 'customer');
  exception when sqlstate 'SM762' or sqlstate 'SM766' then
    perform app.cq_error('SM764');
  end;
  if v_req is distinct from (v_build -> 'request')
     or ((z.result_text::jsonb) - 'status' - 'engine_version' - 'canonical_hash' - 'flags' - 'trace' - 'range') is distinct from (v_build -> 'core') then
    perform app.cq_error('SM764');
  end if;
  update public.material_quotes x set status = 'superseded' where x.tenant_id = z.tenant_id and x.requirement_id = z.requirement_id and x.status = 'approved' and x.id <> z.id;
  update public.material_quotes x set status = 'approved', approved_by = v_uid, approved_at = now(), approved_hash = p_recomputed_hash where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'approved', 'approved_by', v_uid, 'replayed', false);
end;
$$;
revoke all on function public.material_quote_approve(uuid, text) from public, anon;
grant execute on function public.material_quote_approve(uuid, text) to authenticated;

create function public.material_quote_reject(p_quote_id uuid, p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  z     public.material_quotes;
begin
  if v_uid is null or p_quote_id is null then perform app.cq_error('deny'); end if;
  select * into z from public.material_quotes x where x.id = p_quote_id;
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.cq_error('deny'); end if;
  if p_code is null or p_code <> all (array['wrong_prices', 'customer_changed', 'duplicate', 'withdrawn', 'other']) then perform app.cq_error('invalid'); end if;
  if not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) and (p_code <> 'withdrawn' or z.created_by is distinct from v_uid) then perform app.cq_error('deny'); end if;
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  perform 1 from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.material_quotes x where x.id = p_quote_id for update;
  if z.status = 'rejected' and z.rejected_by = v_uid and z.reject_code::text = p_code then
    return jsonb_build_object('quote_id', z.id, 'status', z.status, 'replayed', true);
  end if;
  if z.status <> 'draft' then perform app.cq_error('SM763'); end if;
  update public.material_quotes x set status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_code = p_code::public.quote_reject_code where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'rejected', 'replayed', false);
end;
$$;
revoke all on function public.material_quote_reject(uuid, text) from public, anon;
grant execute on function public.material_quote_reject(uuid, text) to authenticated;

-- reads (Owner, Admin, Sales: a quote is money)
create function app.material_quote_json(z public.material_quotes) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', z.id, 'quote_no', z.quote_no, 'requirement_id', z.requirement_id, 'enquiry_id', z.enquiry_id, 'lead_id', z.lead_id, 'site_id', z.site_id, 'status', z.status,
    'policy_version_id', z.policy_version_id, 'engine_version', z.engine_version, 'canonical_hash', z.canonical_hash, 'as_of', z.as_of, 'valid_until', z.valid_until, 'due_date', z.due_date,
    'trips', z.trips, 'material_paise', z.material_paise, 'transport_paise', z.transport_paise, 'handling_paise', z.handling_paise, 'laying_paise', z.laying_paise, 'tax_paise', z.tax_paise,
    'total_paise', z.total_paise, 'advance_paise', z.advance_paise, 'balance_paise', z.balance_paise, 'flags', to_jsonb(z.engine_flags), 'needs_owner_approval', z.needs_owner_approval,
    'created_at', z.created_at, 'approved_at', z.approved_at, 'rejected_at', z.rejected_at, 'reject_code', z.reject_code,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'catalogue_item_id', l.catalogue_item_id, 'name', l.name, 'mode', l.mode, 'sold_per', l.sold_per,
                                                          'unit_price_paise', l.unit_price_paise, 'gst_bps', l.gst_bps, 'hsn', l.hsn, 'area_x100', l.area_x100, 'area_unit', l.area_unit,
                                                          'pieces', l.pieces, 'pallets', l.pallets, 'delivered_area_x100', l.delivered_area_x100, 'billed_quantity', l.billed_quantity,
                                                          'material_paise', l.material_paise, 'tax_paise', l.tax_paise) order by l.line_no)
                         from public.material_quote_lines l where l.tenant_id = z.tenant_id and l.quote_id = z.id), '[]'::jsonb))
$$;
revoke all on function app.material_quote_json(public.material_quotes) from public;

create function public.material_quote_get(p_tenant_id uuid, p_quote_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  z public.material_quotes;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.cq_error('deny'); end if;
  select * into z from public.material_quotes x where x.tenant_id = p_tenant_id and x.id = p_quote_id;
  if not found then perform app.cq_error('reference'); end if;
  return app.material_quote_json(z) || jsonb_build_object('result_text', z.result_text);
end;
$$;
revoke all on function public.material_quote_get(uuid, uuid) from public, anon;
grant execute on function public.material_quote_get(uuid, uuid) to authenticated;

create function public.material_quotes_list(p_tenant_id uuid, p_requirement_id uuid default null, p_limit integer default 50, p_after_created timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.cq_error('deny'); end if;
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_created is null) <> (p_after_id is null)) then perform app.cq_error('invalid'); end if;
  select coalesce(jsonb_agg(app.material_quote_json(x.z) order by x.created_at desc, x.id desc), '[]'::jsonb) into v_out
    from (select z, z.created_at, z.id from public.material_quotes z
           where z.tenant_id = p_tenant_id and (p_requirement_id is null or z.requirement_id = p_requirement_id)
             and (p_after_created is null or (z.created_at, z.id) < (p_after_created, p_after_id))
           order by z.created_at desc, z.id desc limit p_limit) x;
  return v_out;
end;
$$;
revoke all on function public.material_quotes_list(uuid, uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.material_quotes_list(uuid, uuid, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. orders: an order can come from a material quote
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.orders alter column quote_id drop not null;
alter table public.orders add column material_quote_id uuid;
alter table public.orders add constraint orders_material_quote_fk foreign key (tenant_id, material_quote_id) references public.material_quotes (tenant_id, id);
alter table public.orders add constraint orders_one_quote check (num_nonnulls(quote_id, material_quote_id) = 1);
create unique index orders_material_quote_key on public.orders (tenant_id, material_quote_id) where material_quote_id is not null;
alter table public.orders add column site_id uuid;
alter table public.orders add constraint orders_site_fk foreign key (tenant_id, site_id) references public.customer_sites (tenant_id, id);
create index orders_site_idx on public.orders (tenant_id, site_id) where site_id is not null;

-- Owner or Admin, with a second factor. The figures are the approved quote's, copied here under the quote's lock. The answer carries the credit WARNING (never a block).
create function public.create_order_from_material_quote(p_order_id uuid, p_quote_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  z       public.material_quotes;
  v_exist public.orders;
  v_pol   public.order_policy_versions;
  v_pver  uuid;
  v_no    integer;
  v_comp  uuid;
  v_check jsonb := null;
begin
  if v_uid is null or p_order_id is null or p_quote_id is null then perform app.order_deny(); end if;
  select * into z from public.material_quotes x where x.id = p_quote_id;
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) then perform app.order_deny(); end if;
  perform app.require_module(z.tenant_id, 'materials');
  perform app.require_aal2();
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  perform 1 from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.material_quotes x where x.id = p_quote_id for update;
  select * into v_exist from public.orders o where o.id = p_order_id;
  if found then
    if v_exist.tenant_id = z.tenant_id and v_exist.material_quote_id = z.id then
      return jsonb_build_object('order_id', v_exist.id, 'order_no', v_exist.order_no, 'state', v_exist.state, 'replayed', true);
    end if;
    perform app.order_error('conflict');
  end if;
  if exists (select 1 from public.orders o where o.tenant_id = z.tenant_id and o.material_quote_id = z.id) then perform app.order_error('SM231'); end if;
  if z.status <> 'approved' then perform app.order_error('SM230'); end if;
  if app.quote_today() > z.valid_until then perform app.order_error('SM236'); end if;
  v_pver := app.order_active_policy_version(z.tenant_id, app.quote_today());
  if v_pver is null then perform app.order_error('SM239'); end if;
  select * into v_pol from public.order_policy_versions p where p.id = v_pver;
  if z.total_paise > 1000000000 or (z.total_paise = 0 and not v_pol.allow_zero_value_orders) or ((v_pol.advance_required or v_pol.dispatch_requires_advance) and z.advance_paise = 0) then
    perform app.order_error('SM233');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('order_no:' || z.tenant_id::text, 0));
  select coalesce(max(o.order_no), 0) + 1 into v_no from public.orders o where o.tenant_id = z.tenant_id;
  insert into public.orders (id, tenant_id, order_no, quote_id, material_quote_id, site_id, enquiry_id, requirement_id, lead_id, state, order_total_paise, advance_paise, valid_until, policy_version_id)
  values (p_order_id, z.tenant_id, v_no, null, z.id, z.site_id, z.enquiry_id, z.requirement_id, z.lead_id, 'quote_approved', z.total_paise, z.advance_paise, z.valid_until, v_pver);
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at, recorded_by)
  values (gen_random_uuid(), z.tenant_id, p_order_id, 1, 'created', null, 'quote_approved', now(), v_uid);
  select l.company_id into v_comp from public.leads l where l.tenant_id = z.tenant_id and l.id = z.lead_id;
  if v_comp is not null and app.module_enabled(z.tenant_id, 'dues') then
    v_check := jsonb_build_object('credit_limit_paise', (select l.limit_paise from public.customer_credit_limits l where l.tenant_id = z.tenant_id and l.company_id = v_comp),
                                  'outstanding_paise', app.dues_outstanding(z.tenant_id, v_comp, app.dues_today()));
    v_check := v_check || jsonb_build_object('would_be_paise', (v_check ->> 'outstanding_paise')::bigint + z.balance_paise,
                                             'exceeded', (v_check ->> 'credit_limit_paise') is not null and (v_check ->> 'outstanding_paise')::bigint + z.balance_paise > (v_check ->> 'credit_limit_paise')::bigint);
  end if;
  return jsonb_build_object('order_id', p_order_id, 'order_no', v_no, 'state', 'quote_approved', 'replayed', false, 'credit', v_check);
end;
$$;
revoke all on function public.create_order_from_material_quote(uuid, uuid) from public, anon;
grant execute on function public.create_order_from_material_quote(uuid, uuid) to authenticated;

-- an order stops the follow-ups of its lead as before; the lead's latest order may now come from either kind of quote
create or replace function app.order_stops_followups(p_lead uuid) returns text
language sql
stable
set search_path = ''
as $$
  with latest as (
    select o.state, coalesce(z.approved_at, m.approved_at) as approved_at, coalesce(z.quote_no, m.quote_no) as quote_no, o.material_quote_id is not null as is_material
      from public.orders o
      left join public.quotes z on z.tenant_id = o.tenant_id and z.id = o.quote_id
      left join public.material_quotes m on m.tenant_id = o.tenant_id and m.id = o.material_quote_id
     where o.lead_id = p_lead order by o.order_no desc, o.id desc limit 1),
  newer as (
    -- a quote of the lead APPROVED AFTER the latest order's quote (by approval time, then number: the number follows the draft, not the approval) that has no order yet:
    -- a new deal is being made, nothing stops
    select 1 from latest l join public.quotes q on q.lead_id = p_lead and q.status = 'approved' and (q.approved_at, q.quote_no) > (l.approved_at, l.quote_no)
     where not l.is_material and not exists (select 1 from public.orders o2 where o2.tenant_id = q.tenant_id and o2.quote_id = q.id)
    union all
    select 1 from latest l join public.material_quotes q on q.lead_id = p_lead and q.status = 'approved' and (q.approved_at, q.quote_no) > (l.approved_at, l.quote_no)
     where l.is_material and not exists (select 1 from public.orders o2 where o2.tenant_id = q.tenant_id and o2.material_quote_id = q.id))
  select case
    when exists (select 1 from newer) then null
    when (select state from latest) in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid') then 'accepted'
    when (select state from latest) = 'declined' then 'declined'
    when (select state from latest) = 'cancelled' then 'cancelled'
    when exists (select 1 from public.quotes q where q.lead_id = p_lead and q.withdrawn_at is not null)
         and not exists (select 1 from public.quotes q where q.lead_id = p_lead and q.status = 'approved') then 'withdrawn'
    else null end
$$;
