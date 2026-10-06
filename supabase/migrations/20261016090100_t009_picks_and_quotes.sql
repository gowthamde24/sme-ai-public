-- T009 integration, migration part 2 (docs/plans/t009-quote-integration.md, owner decisions of 2026-10-06): product picks, quotes, quote lines, and
-- the functions that create, approve, reject and supersede a quote. NOTHING IS EVER SENT: a quote here is a DRAFT a person may approve; approving it
-- sends nothing, creates no order and takes no payment.
--
--   requirement_line_picks   a PERSON confirms which catalog product a requirement line means (the mapper, when it lands, only suggests)
--   quotes / quote_lines     versioned quotes with provenance: requirement, price list version, policy version, engine version, canonical hash
--   public.pick_requirement_line_product, create_quote_draft, approve_quote, reject_quote   (Sales+ pick and create; Owner/Admin approve and reject)
--   public.discard_requirement   REPLACED: SM212 while a draft or an approved quote depends on the requirement (owner decision 2)
--
-- What the database proves, and what it cannot (the honest limit):
--   The API runs the engine (packages/quote-engine, lane C) with the caller's token and hands this module the canonical request and the engine's result.
--   For the v1 subset (tax-EXCLUSIVE, NO discounts, no margin floor: the policy table cannot say anything else) the database does not trust either:
--     1. the request must be BYTE-for-byte the one the database builds from its own sources (the confirmed picks, the price list version, the policy
--        version, the customer kind), and its canonical hash (sha256 of {"engine_version","inputs"}) must equal the engine's;
--     2. every figure of the result (lines, totals, advance, balance, due date, valid-until) must equal the database's OWN integer recomputation, and
--        the engine's flags must be exactly the flags the database derives. So a caller who bypasses the API cannot store a figure the engine would not
--        have produced for these inputs, nor hide a flag. The rule trace is explanatory text and is stored as given (it is not verified).
--     3. approval re-runs the same build from the quote's recorded versions and picks: if anything moved, the quote is stale (SM215).
--   What remains outside the database: it does not run the ENGINE (two implementations of the arithmetic exist, kept equal by a property test against
--   the real engine); an Owner calling approve_quote directly is trusted (the T006 option-A limit; option B, a signing service principal, is required
--   before any external customer); and the review flags are derived here, but the delivery state is the person's word.
--   Anything the v1 subset does not cover (a discount, a margin, tax-inclusive mode, a second shipping rate) is REFUSED, not approximated.
--
-- Lock order, as everywhere (ADR 0018 decision 9): the ENQUIRY row first, then the requirement row, then the quote. discard_requirement takes the same
-- order, so a discard racing a create or an approval is one or the other, never half of each.
--
-- SQLSTATEs (app.quote_error): SM212 a quote depends on this requirement, SM213 the requirement is not confirmed, SM214 the quote is not a draft,
-- SM215 the quote is stale (a newer price list / policy, the picks or the requirement changed, or it has expired), SM216 the quote does not match its
-- recomputation, SM217 an input the quote needs is missing, SM218 the quote needs the Owner's approval. 42501 for every refusal before the role is
-- proven; SM306 second factor (approval only); 22023 invalid argument, 23514 value not allowed, 23503 invalid reference, 23505 record id already used.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.quote_status      as enum ('draft', 'approved', 'rejected', 'superseded');
create type public.quote_customer_kind as enum ('new', 'repeat');
-- the engine flags that can occur in v1 (no discounts, no margin floor, an unknown sku is a refusal): any other code is refused
create type public.quote_flag        as enum ('BELOW_MINIMUM_ORDER_QUANTITY', 'CREDIT_LIMIT_EXCEEDED');
-- flags the DATABASE derives (never taken from the payload): the customer stated payment terms; the lines carry more than one GST rate and freight is charged
create type public.quote_review_flag as enum ('TERMS_REQUESTED_BY_CUSTOMER', 'MIXED_GST_RATES_SHIPPING');
create type public.quote_reject_code as enum ('wrong_prices', 'customer_changed', 'duplicate', 'withdrawn', 'other');
create type public.quote_gst_supply  as enum ('intra_state', 'inter_state');
create type public.quote_pick_source as enum ('manual', 'mapper_suggestion');

-- ---------------------------------------------------------------------------------------------
-- Errors: the part 1 helper plus the codes of this module (a redefinition: part 1's text and these lines)
-- ---------------------------------------------------------------------------------------------
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
      else 'invalid argument' end
    using errcode = case when p_code ~ '^SM2[0-9]{2}$' then p_code
                         else case p_code when 'conflict' then '23505' when 'value' then '23514' when 'reference' then '23503' else '22023' end end;
end;
$$;

-- the engine's rounding: integer division, half-up / half-even / down (packages/quote-engine, `rounded`); numerators are never negative
create function app.quote_round(p_num bigint, p_den bigint, p_mode text) returns bigint
language sql
immutable
set search_path = ''
as $$
  select (p_num / p_den) + case
    when p_mode = 'down' then 0
    when 2 * (p_num % p_den) > p_den then 1
    when 2 * (p_num % p_den) = p_den and (p_mode = 'half_up' or (p_num / p_den) % 2 = 1) then 1
    else 0 end
$$;

-- ---------------------------------------------------------------------------------------------
-- requirement_line_picks: the human's product choice for one requirement line (replaced in place by the function; audited; no client write)
-- ---------------------------------------------------------------------------------------------
create table public.requirement_line_picks (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  requirement_id    uuid not null,
  line_no           smallint not null check (line_no between 1 and 5),
  product_id        uuid not null,
  qty               integer not null check (qty between 1 and 10000),
  sale_unit         public.quote_sale_unit not null,
  source            public.quote_pick_source not null default 'manual',
  suggestion_sha256 text check (suggestion_sha256 ~ '^[0-9a-f]{64}$'),
  decided_by        uuid not null,
  decided_at        timestamptz not null default now(),
  created_by        uuid,
  created_via       public.record_origin not null default 'manual',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, requirement_id, line_no),
  foreign key (tenant_id, requirement_id) references public.requirements (tenant_id, id),
  foreign key (tenant_id, product_id)     references public.products (tenant_id, id),
  check ((source = 'mapper_suggestion') = (suggestion_sha256 is not null))
);
create index requirement_line_picks_product_idx on public.requirement_line_picks (tenant_id, product_id);

-- ---------------------------------------------------------------------------------------------
-- quotes and quote_lines: immutable content; only the status (and who decided) moves, only through the functions
-- ---------------------------------------------------------------------------------------------
create table public.quotes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete restrict,
  quote_no              integer not null check (quote_no >= 1),
  requirement_id        uuid not null,
  enquiry_id            uuid not null,
  lead_id               uuid not null,
  status                public.quote_status not null default 'draft',
  -- provenance: what this quote was computed from
  price_list_version_id uuid not null,
  policy_version_id     uuid not null,
  engine_version        text not null references public.quote_engine_versions (version),
  request_text          text not null check (char_length(request_text) between 2 and 50000 and app.text_is_clean(request_text)),
  result_text           text not null check (char_length(result_text) between 2 and 200000 and app.text_is_clean(result_text)),
  canonical_hash        text not null check (canonical_hash ~ '^[0-9a-f]{64}$'),
  -- what a person decided
  customer_kind         public.quote_customer_kind not null,
  delivery_state        text not null check (delivery_state ~ '^[A-Z]{2}$'),
  gst_supply            public.quote_gst_supply not null,
  -- the figures (integer paise), recomputed by the database
  as_of                 date not null,
  valid_until           date not null,
  due_date              date not null,
  merchandise_net_paise bigint not null check (merchandise_net_paise >= 0),
  item_tax_paise        bigint not null check (item_tax_paise >= 0),
  shipping_net_paise    bigint not null check (shipping_net_paise >= 0),
  shipping_tax_paise    bigint not null check (shipping_tax_paise >= 0),
  total_paise           bigint not null check (total_paise >= 0),
  advance_paise         bigint not null check (advance_paise >= 0),
  balance_paise         bigint not null check (balance_paise >= 0),
  engine_flags          public.quote_flag[] not null default '{}',
  review_flags          public.quote_review_flag[] not null default '{}',
  needs_owner_approval  boolean not null,
  created_by            uuid,
  created_via           public.record_origin not null default 'manual',
  created_at            timestamptz not null default now(),
  approved_by           uuid,
  approved_at           timestamptz,
  approved_hash         text check (approved_hash ~ '^[0-9a-f]{64}$'),
  rejected_by           uuid,
  rejected_at           timestamptz,
  reject_code           public.quote_reject_code,
  unique (tenant_id, id),
  unique (tenant_id, quote_no),
  foreign key (tenant_id, requirement_id)        references public.requirements (tenant_id, id),
  foreign key (tenant_id, enquiry_id)            references public.enquiries (tenant_id, id),
  foreign key (tenant_id, lead_id)               references public.leads (tenant_id, id),
  foreign key (tenant_id, price_list_version_id) references public.price_list_versions (tenant_id, id),
  foreign key (tenant_id, policy_version_id)     references public.quote_policy_versions (tenant_id, id),
  check (total_paise = merchandise_net_paise + item_tax_paise + shipping_net_paise + shipping_tax_paise),
  check (advance_paise + balance_paise = total_paise),
  check (valid_until >= as_of and due_date >= as_of),
  check (needs_owner_approval = (cardinality(engine_flags) + cardinality(review_flags) > 0)),
  check ((approved_by is null) = (approved_at is null) and (approved_at is null) = (approved_hash is null)),
  check ((rejected_by is null) = (rejected_at is null) and (rejected_at is null) = (reject_code is null)),
  check (approved_at is null or rejected_at is null),
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'rejected' or rejected_at is not null),
  check (status <> 'draft' or (approved_at is null and rejected_at is null))
);
-- at most one draft and one approved quote per requirement: a new draft supersedes the old one, a new approval supersedes the old one
create unique index quotes_one_draft_key    on public.quotes (tenant_id, requirement_id) where status = 'draft';
create unique index quotes_one_approved_key on public.quotes (tenant_id, requirement_id) where status = 'approved';
create index quotes_keyset_idx              on public.quotes (tenant_id, created_at, id);
create index quotes_requirement_idx         on public.quotes (tenant_id, requirement_id, created_at desc);
create index quotes_enquiry_idx             on public.quotes (tenant_id, enquiry_id);
create index quotes_lead_idx                on public.quotes (tenant_id, lead_id);
create index quotes_price_version_idx       on public.quotes (tenant_id, price_list_version_id);
create index quotes_policy_version_idx      on public.quotes (tenant_id, policy_version_id);
create index quotes_engine_version_idx      on public.quotes (engine_version);

create table public.quote_lines (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id) on delete restrict,
  quote_id                uuid not null,
  line_no                 smallint not null check (line_no between 1 and 5),
  requirement_line_no     smallint not null check (requirement_line_no between 1 and 5),
  product_id              uuid not null,
  sku                     text not null check (char_length(btrim(sku)) between 1 and 64 and app.text_is_clean(sku)),
  name                    text not null check (char_length(btrim(name)) between 1 and 200 and app.text_is_clean(name)),
  sale_unit               public.quote_sale_unit not null,
  qty                     integer not null check (qty between 1 and 10000),
  unit_price_applied_paise bigint not null check (unit_price_applied_paise between 1 and 100000000),
  price_break_min_qty     integer check (price_break_min_qty between 1 and 10000),
  line_subtotal_paise     bigint not null check (line_subtotal_paise >= 0),
  net_paise               bigint not null check (net_paise >= 0),
  tax_paise               bigint not null check (tax_paise >= 0),
  gross_paise             bigint not null check (gross_paise >= 0),
  tax_bps                 integer not null check (tax_bps between 0 and 10000),
  created_by              uuid,
  created_via             public.record_origin not null default 'manual',
  created_at              timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, quote_id, line_no),
  unique (tenant_id, quote_id, product_id),
  foreign key (tenant_id, quote_id)   references public.quotes (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id),
  check (line_subtotal_paise = qty::bigint * unit_price_applied_paise and net_paise = line_subtotal_paise and gross_paise = net_paise + tax_paise)
);
create index quote_lines_product_idx on public.quote_lines (tenant_id, product_id);

-- ---------------------------------------------------------------------------------------------
-- Column classification (no personal data in any of these tables)
-- ---------------------------------------------------------------------------------------------
comment on column public.requirement_line_picks.suggestion_sha256 is 'SAFE: sha256 of the mapper output a person accepted a suggestion from (null for a manual pick). CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.quotes.engine_version  is 'SAFE: a semantic version from the quote_engine_versions allow-list. CLEAN-EXEMPT: a foreign key to the allow-list (a strict pattern there)';
comment on column public.quotes.request_text    is 'SAFE: the canonical engine request (skus, integer quantities and paise, rates in basis points, dates, policy numbers); no personal data; text_is_clean-guarded; written only by create_quote_draft';
comment on column public.quotes.result_text     is 'SAFE: the engine output with its rule trace (skus and integers only); no personal data; text_is_clean-guarded; written only by create_quote_draft';
comment on column public.quotes.canonical_hash  is 'SAFE: sha256 of the canonical request. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.quotes.delivery_state  is 'SAFE: a two-letter state code (not a person). CLEAN-EXEMPT: strict anchored pattern';
comment on column public.quotes.approved_hash   is 'SAFE: the canonical hash the approver''s recomputation produced. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.quote_lines.sku        is 'SAFE: snapshot of the product sku (a business identifier, never a person)';
comment on column public.quote_lines.name       is 'SAFE: snapshot of the product name (a business product, never a person)';

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
create trigger requirement_line_picks_set_updated_at        before update on public.requirement_line_picks for each row execute function app.set_updated_at();
create trigger requirement_line_picks_forbid_tenant_id_change before update on public.requirement_line_picks for each row execute function app.forbid_tenant_id_change();
create trigger requirement_line_picks_set_created_meta      before insert or update on public.requirement_line_picks for each row execute function app.set_created_meta();
create trigger quotes_forbid_tenant_id_change               before update on public.quotes for each row execute function app.forbid_tenant_id_change();
create trigger quotes_set_created_meta                      before insert or update on public.quotes for each row execute function app.set_created_meta();
create trigger quote_lines_forbid_tenant_id_change          before update on public.quote_lines for each row execute function app.forbid_tenant_id_change();
create trigger quote_lines_set_created_meta                 before insert or update on public.quote_lines for each row execute function app.set_created_meta();
create trigger quote_lines_guard_immutable                  before update on public.quote_lines for each row execute function app.guard_immutable_record();
create trigger quote_lines_forbid_delete                    before delete on public.quote_lines for each row execute function app.quote_forbid_delete();
create trigger quotes_forbid_delete                         before delete on public.quotes for each row execute function app.quote_forbid_delete();
create trigger requirement_line_picks_forbid_delete         before delete on public.requirement_line_picks for each row execute function app.quote_forbid_delete();

-- a quote's CONTENT never changes; only the status moves, and only along draft -> approved | rejected | superseded, approved -> superseded
create function app.quote_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code')
     is distinct from (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'approved_hash' - 'rejected_by' - 'rejected_at' - 'reject_code') then
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
  return new;
end;
$$;
revoke all on function app.quote_guard_update() from public;
create trigger quotes_guard_update before update on public.quotes for each row execute function app.quote_guard_update();

create trigger audit_requirement_line_picks after insert or update or delete on public.requirement_line_picks for each row execute function app.audit_row_change('requirement_line_pick');
create trigger audit_quotes                 after insert or update or delete on public.quotes                 for each row execute function app.audit_row_change('quote');
create trigger audit_quote_lines            after insert or update or delete on public.quote_lines            for each row execute function app.audit_row_change('quote_line');

-- ---------------------------------------------------------------------------------------------
-- RLS: read = Owner / Admin / Sales (a Viewer reads no price and no total: owner decision 1); nobody writes directly
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['requirement_line_picks', 'quotes', 'quote_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- app.quote_build: the database's OWN computation of a quote from its sources. Returns the request the API must have sent (canonical key order is not
-- needed: jsonb equality ignores it; the HASH ties the stored TEXT to the engine), the result core the engine must have produced, the flags, and
-- the rows to store. Raises SM217 when an input is missing.
--   request.price_list  = the items of the ordered skus only, sorted by sku;  request.order_lines = one {sku, qty} per requirement line, in line order
--   request.customer    = {kind} (new) or {kind, credit_limit} (repeat; the policy's limit)
--   request.policy      = {discount_ceiling_bps, shipping{flat_fee, tax_bps[, free_above]}, validity_days, payment_terms{...}, tax_mode, rounding_mode}
-- ---------------------------------------------------------------------------------------------
create function app.quote_build(p_tenant uuid, p_requirement uuid, p_as_of date, p_kind text, p_price_version uuid, p_policy_version uuid) returns jsonb
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
  select jsonb_agg(x order by x ->> 'sku') into v_pl from jsonb_array_elements(v_pl) x;

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
    'flags', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(v_flags) f),
    'review', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(v_review) f),
    'rows', v_rows,
    'merchandise_net', v_net, 'item_tax', v_itax, 'shipping_net', v_ship, 'shipping_tax', v_stax, 'total', v_total, 'advance', v_adv, 'balance', v_bal,
    'due_date', p_as_of + pol.net_days, 'valid_until', p_as_of + pol.validity_days, 'seller_state', pol.seller_state, 'required_inputs', to_jsonb(pol.required_inputs::text[]));
end;
$$;
revoke all on function app.quote_build(uuid, uuid, date, text, uuid, uuid) from public;
revoke all on function app.quote_round(bigint, bigint, text) from public;

-- the hash the engine reports: sha256 of {"engine_version":"<v>","inputs":<canonical request>} (sorted keys, compact, ASCII)
create function app.quote_request_hash(p_engine_version text, p_request_text text) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to('{"engine_version":"' || p_engine_version || '","inputs":' || p_request_text || '}', 'UTF8')), 'hex') $$;
revoke all on function app.quote_request_hash(text, text) from public;

-- the engine flag codes of a result, as a sorted array
create function app.quote_result_flags(p_result jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$ select coalesce(array_agg(distinct x ->> 'code' order by x ->> 'code'), '{}') from jsonb_array_elements(p_result -> 'flags' -> 'reasons') x $$;
revoke all on function app.quote_result_flags(jsonb) from public;

-- ---------------------------------------------------------------------------------------------
-- public.pick_requirement_line_product: a PERSON says which catalog product a requirement line means
-- ---------------------------------------------------------------------------------------------
create function public.pick_requirement_line_product(
  p_requirement_id uuid, p_line smallint, p_product_id uuid, p_qty integer, p_sale_unit text,
  p_source text default 'manual', p_suggestion_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  q      public.requirements;
  v_item public.price_list_items;
  v_ver  uuid;
  v_req_qty bigint;
  v_req_basis text;
  v_pick public.requirement_line_picks;
  v_id   uuid;
begin
  if v_uid is null or p_requirement_id is null then
    perform app.quote_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id;
  if not found or not app.has_tenant_role(q.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  -- lock order: the enquiry row, then the requirement row
  perform 1 from public.enquiries e where e.tenant_id = q.tenant_id and e.id = q.enquiry_id for update;
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if not found then
    perform app.quote_deny();
  end if;
  if q.status <> 'confirmed' then
    perform app.quote_error('SM213');
  end if;
  if p_line is null or p_line not between 1 and 5 or p_product_id is null or p_qty is null or p_qty not between 1 and 10000
     or p_sale_unit is null or p_sale_unit <> all (array['piece', 'set']) or p_source is null or p_source <> all (array['manual', 'mapper_suggestion'])
     or (p_source = 'manual') <> (p_suggestion_sha256 is null) or (p_suggestion_sha256 is not null and p_suggestion_sha256 !~ '^[0-9a-f]{64}$') then
    perform app.quote_error('invalid');
  end if;
  -- the line must exist and be fully confirmed (a person settled its saree type and quantity)
  select f.value_int, f.basis into v_req_qty, v_req_basis from public.requirement_fields f
   where f.tenant_id = q.tenant_id and f.requirement_id = q.id and f.line_no = p_line and f.field_key = 'quantity' and f.state in ('confirmed', 'corrected');
  if not found or not exists (select 1 from public.requirement_fields f where f.tenant_id = q.tenant_id and f.requirement_id = q.id and f.line_no = p_line
                                and f.field_key = 'saree_type' and f.state in ('confirmed', 'corrected')) then
    perform app.quote_error('reference');
  end if;
  -- the product must be on the price list that is active today, in the unit the person says
  v_ver := app.quote_active_price_version(q.tenant_id, app.quote_today());
  select * into v_item from public.price_list_items i where i.tenant_id = q.tenant_id and i.version_id = v_ver and i.product_id = p_product_id;
  if v_item.id is null then
    perform app.quote_error('reference');
  end if;
  if v_item.sale_unit::text <> p_sale_unit then
    perform app.quote_error('value');
  end if;
  -- nothing silently changes the customer's quantity: in the SAME unit the quantity is the requirement's; in another unit a person enters the converted count
  if v_req_basis = p_sale_unit and p_qty <> v_req_qty then
    perform app.quote_error('value');
  end if;
  -- one product per line: two lines of the same product cannot be quoted in v1 (the engine takes one quantity per sku)
  if exists (select 1 from public.requirement_line_picks p where p.tenant_id = q.tenant_id and p.requirement_id = q.id and p.line_no <> p_line and p.product_id = p_product_id) then
    perform app.quote_error('value');
  end if;

  select * into v_pick from public.requirement_line_picks p where p.tenant_id = q.tenant_id and p.requirement_id = q.id and p.line_no = p_line;
  if found then
    if v_pick.product_id = p_product_id and v_pick.qty = p_qty and v_pick.sale_unit::text = p_sale_unit and v_pick.source::text = p_source
       and v_pick.suggestion_sha256 is not distinct from p_suggestion_sha256 and v_pick.decided_by = v_uid then
      return jsonb_build_object('pick_id', v_pick.id, 'requirement_id', q.id, 'line', p_line, 'product_id', p_product_id, 'qty', p_qty, 'sale_unit', p_sale_unit, 'replayed', true);
    end if;
    update public.requirement_line_picks x set product_id = p_product_id, qty = p_qty, sale_unit = p_sale_unit::public.quote_sale_unit,
           source = p_source::public.quote_pick_source, suggestion_sha256 = p_suggestion_sha256, decided_by = v_uid, decided_at = now()
     where x.id = v_pick.id;
    v_id := v_pick.id;
  else
    v_id := gen_random_uuid();
    insert into public.requirement_line_picks (id, tenant_id, requirement_id, line_no, product_id, qty, sale_unit, source, suggestion_sha256, decided_by)
    values (v_id, q.tenant_id, q.id, p_line, p_product_id, p_qty, p_sale_unit::public.quote_sale_unit, p_source::public.quote_pick_source, p_suggestion_sha256, v_uid);
  end if;
  return jsonb_build_object('pick_id', v_id, 'requirement_id', q.id, 'line', p_line, 'product_id', p_product_id, 'qty', p_qty, 'sale_unit', p_sale_unit, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.create_quote_draft: the API computed (the engine, the caller's token); the database verifies against its own build
-- ---------------------------------------------------------------------------------------------
create function public.create_quote_draft(
  p_quote_id uuid, p_requirement_id uuid, p_customer_kind text, p_delivery_state text, p_engine_version text, p_request_text text, p_result_text text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  q         public.requirements;
  e         public.enquiries;
  v_exist   public.quotes;
  v_today   date := app.quote_today();
  v_as_of   date;
  v_pver    uuid;
  v_polver  uuid;
  v_build   jsonb;
  v_req     jsonb;
  v_res     jsonb;
  v_hash    text;
  v_flags   text[];
  v_review  text[];
  v_needs   boolean;
  v_supply  public.quote_gst_supply;
  v_inputs  jsonb;
  v_no      integer;
  v_quote   uuid;
  l         jsonb;
begin
  if v_uid is null or p_quote_id is null or p_requirement_id is null then
    perform app.quote_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id;
  if not found or not app.has_tenant_role(q.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  -- lock order: the enquiry row, then the requirement row, then (below) the tenant's quote numbers
  select * into e from public.enquiries x where x.tenant_id = q.tenant_id and x.id = q.enquiry_id for update;
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if not found or e.id is null then
    perform app.quote_deny();
  end if;

  if p_customer_kind is null or p_customer_kind <> all (array['new', 'repeat']) or p_delivery_state is null or p_delivery_state !~ '^[A-Z]{2}$'
     or p_engine_version is null or p_request_text is null or p_result_text is null
     or char_length(p_request_text) > 50000 or char_length(p_result_text) > 200000 or not app.text_is_clean(p_request_text) or not app.text_is_clean(p_result_text) then
    perform app.quote_error('invalid');
  end if;
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

  -- an exact retry (same id, same requirement, same hash, same person's choices) replays; anything else under a used id is the constant conflict
  select * into v_exist from public.quotes z where z.id = p_quote_id;
  if found then
    if v_exist.tenant_id = q.tenant_id and v_exist.requirement_id = q.id and v_exist.canonical_hash = v_hash and v_exist.customer_kind::text = p_customer_kind
       and v_exist.delivery_state = p_delivery_state and v_exist.engine_version = p_engine_version then
      return jsonb_build_object('quote_id', v_exist.id, 'quote_no', v_exist.quote_no, 'status', v_exist.status, 'needs_owner_approval', v_exist.needs_owner_approval,
                                'canonical_hash', v_exist.canonical_hash, 'replayed', true);
    end if;
    perform app.quote_error('conflict');
  end if;

  if e.archived_at is not null then
    perform app.quote_error('reference');
  end if;
  if q.status <> 'confirmed' then
    perform app.quote_error('SM213');
  end if;
  if not exists (select 1 from public.quote_engine_versions v where v.version = p_engine_version) then
    perform app.quote_error('value');
  end if;

  -- the date is today in India (one day of slack for clocks and midnight); the versions are the ones active on it
  begin
    v_as_of := (v_req ->> 'as_of')::date;
  exception when others then
    perform app.quote_error('invalid');
  end;
  if v_as_of is null or v_as_of not between v_today - 1 and v_today then
    perform app.quote_error('SM215');
  end if;
  v_pver := app.quote_active_price_version(q.tenant_id, v_as_of);
  v_polver := app.quote_active_policy_version(q.tenant_id, v_as_of);
  if v_pver is null or v_polver is null then
    perform app.quote_error('SM217');
  end if;

  v_build := app.quote_build(q.tenant_id, q.id, v_as_of, p_customer_kind, v_pver, v_polver);

  -- the policy decides which optional inputs a quote needs (the delivery state is always one)
  v_inputs := v_build -> 'required_inputs';
  if v_inputs ? 'delivery_city' and not exists (select 1 from public.requirement_fields f where f.tenant_id = q.tenant_id and f.requirement_id = q.id
       and f.field_key = 'delivery_city' and f.state in ('confirmed', 'corrected'))
     or v_inputs ? 'payment_terms' and not exists (select 1 from public.requirement_fields f where f.tenant_id = q.tenant_id and f.requirement_id = q.id
       and f.field_key = 'payment_terms' and f.state in ('confirmed', 'corrected'))
     or v_inputs ? 'deadline' and not exists (select 1 from public.requirement_fields f where f.tenant_id = q.tenant_id and f.requirement_id = q.id
       and f.field_key = 'deadline' and f.state in ('confirmed', 'corrected')) then
    perform app.quote_error('SM217');
  end if;

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
  v_supply := case when p_delivery_state = (v_build ->> 'seller_state') then 'intra_state' else 'inter_state' end;

  -- one draft at a time: a new draft supersedes the old one; the quote number is the tenant's next
  perform pg_advisory_xact_lock(hashtextextended('quote_no:' || q.tenant_id::text, 0));
  update public.quotes z set status = 'superseded' where z.tenant_id = q.tenant_id and z.requirement_id = q.id and z.status = 'draft';
  select coalesce(max(z.quote_no), 0) + 1 into v_no from public.quotes z where z.tenant_id = q.tenant_id;
  v_quote := p_quote_id;
  insert into public.quotes
    (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text,
     canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise,
     shipping_tax_paise, total_paise, advance_paise, balance_paise, engine_flags, review_flags, needs_owner_approval)
  values
    (v_quote, q.tenant_id, v_no, q.id, e.id, e.lead_id, 'draft', v_pver, v_polver, p_engine_version, p_request_text, p_result_text,
     v_hash, p_customer_kind::public.quote_customer_kind, p_delivery_state, v_supply, v_as_of, (v_build ->> 'valid_until')::date, (v_build ->> 'due_date')::date,
     (v_build ->> 'merchandise_net')::bigint, (v_build ->> 'item_tax')::bigint, (v_build ->> 'shipping_net')::bigint, (v_build ->> 'shipping_tax')::bigint,
     (v_build ->> 'total')::bigint, (v_build ->> 'advance')::bigint, (v_build ->> 'balance')::bigint,
     v_flags::public.quote_flag[], v_review::public.quote_review_flag[], v_needs);
  for l in select x from jsonb_array_elements(v_build -> 'rows') x loop
    insert into public.quote_lines
      (tenant_id, quote_id, line_no, requirement_line_no, product_id, sku, name, sale_unit, qty, unit_price_applied_paise, price_break_min_qty,
       line_subtotal_paise, net_paise, tax_paise, gross_paise, tax_bps)
    values
      (q.tenant_id, v_quote, (l ->> 'line_no')::smallint, (l ->> 'requirement_line_no')::smallint, (l ->> 'product_id')::uuid, l ->> 'sku', l ->> 'name',
       (l ->> 'sale_unit')::public.quote_sale_unit, (l ->> 'qty')::int, (l ->> 'unit_price')::bigint, (l ->> 'break_min_qty')::int,
       (l ->> 'subtotal')::bigint, (l ->> 'subtotal')::bigint, (l ->> 'tax')::bigint, (l ->> 'subtotal')::bigint + (l ->> 'tax')::bigint, (l ->> 'tax_bps')::int);
  end loop;
  return jsonb_build_object('quote_id', v_quote, 'quote_no', v_no, 'status', 'draft', 'needs_owner_approval', v_needs, 'canonical_hash', v_hash, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.approve_quote: Owner / Admin, aal2; re-builds from the quote's recorded versions and picks; the Owner alone for a flagged quote
-- ---------------------------------------------------------------------------------------------
create function public.approve_quote(p_quote_id uuid, p_recomputed_hash text) returns jsonb
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
     or app.quote_active_price_version(z.tenant_id, v_today) is distinct from z.price_list_version_id
     or app.quote_active_policy_version(z.tenant_id, v_today) is distinct from z.policy_version_id then
    perform app.quote_error('SM215');
  end if;
  -- the approver's recomputation (made by the API from the same sources) must be the quote's hash
  if p_recomputed_hash <> z.canonical_hash then
    perform app.quote_error('SM216');
  end if;
  -- re-build from the recorded versions and the CURRENT picks: anything that moved since the draft makes it stale
  begin
    v_build := app.quote_build(z.tenant_id, z.requirement_id, z.as_of, z.customer_kind::text, z.price_list_version_id, z.policy_version_id);
  exception when sqlstate 'SM217' then
    perform app.quote_error('SM215');
  end;
  v_res := z.result_text::jsonb;
  if z.request_text::jsonb is distinct from (v_build -> 'request') or (v_res - 'status' - 'engine_version' - 'canonical_hash' - 'flags' - 'trace') is distinct from (v_build -> 'core') then
    perform app.quote_error('SM215');
  end if;

  update public.quotes x set status = 'superseded' where x.tenant_id = z.tenant_id and x.requirement_id = z.requirement_id and x.status = 'approved' and x.id <> z.id;
  update public.quotes x set status = 'approved', approved_by = v_uid, approved_at = now(), approved_hash = p_recomputed_hash where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'approved', 'approved_by', v_uid, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.reject_quote: Owner / Admin reject any draft; Sales may only WITHDRAW their own draft
-- ---------------------------------------------------------------------------------------------
create function public.reject_quote(p_quote_id uuid, p_code text) returns jsonb
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
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  if p_code is null or p_code <> all (array['wrong_prices', 'customer_changed', 'duplicate', 'withdrawn', 'other']) then
    perform app.quote_error('invalid');
  end if;
  -- Sales may withdraw a draft they created, and nothing else (the same refusal as any other Sales request)
  if not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) and (p_code <> 'withdrawn' or z.created_by is distinct from v_uid) then
    perform app.quote_deny();
  end if;
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  perform 1 from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.quotes x where x.id = p_quote_id for update;
  if z.status = 'rejected' and z.rejected_by = v_uid and z.reject_code::text = p_code then
    return jsonb_build_object('quote_id', z.id, 'status', z.status, 'replayed', true);
  end if;
  if z.status <> 'draft' then
    perform app.quote_error('SM214');
  end if;
  update public.quotes x set status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_code = p_code::public.quote_reject_code where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'rejected', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.discard_requirement: the 3c definition plus the SM212 block (owner decision 2: a draft AND an approved quote block it)
-- ---------------------------------------------------------------------------------------------
create or replace function public.discard_requirement(p_requirement_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  q     public.requirements;
begin
  if v_uid is null or p_requirement_id is null then
    perform app.requirement_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id;
  if not found or not app.has_tenant_role(q.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.requirement_deny();
  end if;
  -- lock order everywhere: the enquiry row, then the requirement row (decide_requirement_field never takes the enquiry lock, so no cycle)
  perform 1 from public.enquiries e where e.tenant_id = q.tenant_id and e.id = q.enquiry_id for update;
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if not found then
    perform app.requirement_deny();
  end if;
  if q.status = 'discarded' then
    return jsonb_build_object('requirement_id', q.id, 'status', q.status, 'replayed', true);
  end if;
  if q.status not in ('draft', 'confirmed') then
    perform app.requirement_error('SM209');
  end if;
  -- T009: a quote that depends on this requirement (a draft or an approved one) blocks it; a person rejects or withdraws the draft first
  if exists (select 1 from public.quotes z where z.tenant_id = q.tenant_id and z.requirement_id = q.id and z.status in ('draft', 'approved')) then
    perform app.quote_error('SM212');
  end if;
  update public.requirements x set status = 'discarded', confirmed_by = null, confirmed_at = null where x.id = q.id;
  return jsonb_build_object('requirement_id', q.id, 'status', 'discarded', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: authenticated may call the four public functions (the role, and for approval the second factor, are proven inside); nobody else
-- ---------------------------------------------------------------------------------------------
revoke all on function public.pick_requirement_line_product(uuid, smallint, uuid, integer, text, text, text) from public, anon;
revoke all on function public.create_quote_draft(uuid, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.approve_quote(uuid, text) from public, anon;
revoke all on function public.reject_quote(uuid, text) from public, anon;
grant execute on function public.pick_requirement_line_product(uuid, smallint, uuid, integer, text, text, text) to authenticated;
grant execute on function public.create_quote_draft(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.approve_quote(uuid, text) to authenticated;
grant execute on function public.reject_quote(uuid, text) to authenticated;
revoke all on function public.discard_requirement(uuid) from public, anon;
grant execute on function public.discard_requirement(uuid) to authenticated;
