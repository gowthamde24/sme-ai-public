-- T009 integration, migration part 1 (docs/plans/t009-quote-integration.md, owner decisions of 2026-10-06): the REFERENCE DATA a quote is
-- computed from. Nothing here prices anything: the engine (packages/quote-engine, lane C) does that; these tables hold the versioned inputs.
--
--   price_lists / price_list_versions / price_list_items / price_list_breaks   the priced catalog, one immutable VERSION at a time
--   quote_policy_versions                                                      payment terms, shipping, validity, discount ceiling, seller state
--   mapper_config_versions                                                     the requirement-mapper config + the tenant's default sale unit
--   quote_engine_versions                                                      the allow-list of engine versions the database accepts (migration-extended)
--
-- Rules (the plan's section 2):
--   * A version is created WHOLE by one definer function and never edited or deleted (triggers refuse UPDATE and DELETE for every role, the
--     migration owner included). A correction is a new version. There is no draft state.
--   * Creating a version is an Owner / Admin act and needs a second factor (aal2, ADR 0016): app.require_aal2() runs AFTER the role is proven,
--     so a stranger or a Sales user learns nothing from the answer (an unknown tenant and a foreign tenant are the same 42501).
--   * Clients have NO write grant on any of these tables; reading is Owner / Admin / Sales ONLY. A Viewer sees no price list, no policy and no
--     mapper config (owner decision 1). RLS enabled and forced; every policy TO authenticated; composite foreign keys; audit triggers.
--   * "Active at a date" = the latest version with effective_from <= that date (ties: the higher version_no). A new version may not be effective
--     before today (Asia/Kolkata) or before the latest existing version: no retroactive history.
--   * No personal data: every text column is a code, a snapshot of a business product name or sku, or a bounded tenant vocabulary (SAFE).
--     Nothing is registered for erasure. All amounts are integer paise, all rates integer basis points, bounded as the engine bounds them.
--   * The values in the seed function are SYNTHETIC and say so. No tax advice in code or docs: every rate, slab, advance, validity, net-days,
--     credit-limit and freight value is the owner's and the accountant's to set.
--   * SQLSTATEs: 42501 not permitted (identical for every refusal before the role is proven), SM306 second factor required, 22023 invalid
--     argument, 23514 value not allowed, 23503 invalid reference, 23505 record id already used (constant message). SM212 and later: part 2.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.quote_sale_unit as enum ('piece', 'set');
create type public.quote_tax_mode as enum ('exclusive');          -- v1: tax-exclusive only (owner decision 16); a value added later by migration
create type public.quote_rounding_mode as enum ('half_up', 'half_even', 'down');
create type public.quote_input_key as enum ('delivery_state', 'delivery_city', 'payment_terms', 'deadline');

-- ---------------------------------------------------------------------------------------------
-- The engine-version allow-list: NOT tenant data. A new engine version needs a reviewed migration, never a config flip.
-- ---------------------------------------------------------------------------------------------
create table public.quote_engine_versions (
  version  text primary key check (version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  added_at timestamptz not null default now()
);
comment on column public.quote_engine_versions.version is 'SAFE: a semantic version. CLEAN-EXEMPT: strict anchored pattern, written only by migrations';
alter table public.quote_engine_versions enable row level security;
alter table public.quote_engine_versions force row level security;
revoke all on public.quote_engine_versions from public, anon, authenticated;
insert into public.quote_engine_versions (version) values ('1.1.0');

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function app.quote_deny() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'quote action not permitted' using errcode = '42501';
end;
$$;

create function app.quote_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'conflict' then 'record id already used'
      when 'value' then 'value not allowed'
      when 'reference' then 'invalid reference'
      else 'invalid argument' end
    using errcode = case p_code when 'conflict' then '23505' when 'value' then '23514' when 'reference' then '23503' else '22023' end;
end;
$$;

-- today's calendar date in India (the date a quote is made on, the T008 rule)
create function app.quote_today() returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- an integer field of a JSON object: absent / null -> null when not required; a non-integer or a string is 'invalid'; out of range is 'value'
create function app.quote_int(p_obj jsonb, p_key text, p_min bigint, p_max bigint, p_required boolean default true) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := p_obj -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then
      perform app.quote_error('invalid');
    end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' or (p_obj ->> p_key) !~ '^[0-9]{1,15}$' then
    perform app.quote_error('invalid');
  end if;
  if (p_obj ->> p_key)::bigint not between p_min and p_max then
    perform app.quote_error('value');
  end if;
  return (p_obj ->> p_key)::bigint;
end;
$$;

-- a string field of a JSON object, length-bounded, clean
create function app.quote_text(p_obj jsonb, p_key text, p_min integer, p_max integer, p_required boolean default true) returns text
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := p_obj -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_required then
      perform app.quote_error('invalid');
    end if;
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    perform app.quote_error('invalid');
  end if;
  if char_length(p_obj ->> p_key) not between p_min and p_max or not app.text_is_clean(p_obj ->> p_key) then
    perform app.quote_error('value');
  end if;
  return p_obj ->> p_key;
end;
$$;

-- the identity of a version's content: sha256 of the normalised JSON text (jsonb prints keys in one fixed order)
create function app.quote_content_hash(p_normalised jsonb) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_normalised::text, 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------------------------------------
-- price_lists: v1 creates ONE per tenant (the first version creates it; later versions use the oldest list), the table allows more
-- ---------------------------------------------------------------------------------------------
create table public.price_lists (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 100 and app.text_is_clean(name)),
  currency    text not null default 'INR' check (currency = 'INR' and app.text_is_clean(currency)),
  created_by  uuid,
  created_via public.record_origin not null default 'manual',
  created_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create index price_lists_keyset_idx on public.price_lists (tenant_id, created_at, id);

create table public.price_list_versions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  price_list_id  uuid not null,
  version_no     integer not null check (version_no >= 1),
  effective_from date not null,
  item_count     integer not null check (item_count between 1 and 1000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, price_list_id, version_no),
  foreign key (tenant_id, price_list_id) references public.price_lists (tenant_id, id)
);
create index price_list_versions_active_idx on public.price_list_versions (tenant_id, price_list_id, effective_from desc, version_no desc);
create index price_list_versions_keyset_idx on public.price_list_versions (tenant_id, created_at, id);

create table public.price_list_items (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete restrict,
  version_id             uuid not null,
  product_id             uuid not null,
  -- snapshots: the version stays what it was when the product is renamed later
  sku                    text not null check (char_length(btrim(sku)) between 1 and 64 and app.text_is_clean(sku)),
  name                   text not null check (char_length(btrim(name)) between 1 and 200 and app.text_is_clean(name)),
  sale_unit              public.quote_sale_unit not null default 'piece',
  unit_price_paise       bigint not null check (unit_price_paise between 1 and 100000000),
  minimum_order_quantity integer not null check (minimum_order_quantity between 1 and 10000),
  tax_bps                integer not null check (tax_bps between 0 and 10000),
  created_by             uuid,
  created_via            public.record_origin not null default 'manual',
  created_at             timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_id, sku),
  unique (tenant_id, version_id, product_id),
  foreign key (tenant_id, version_id) references public.price_list_versions (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index price_list_items_product_idx on public.price_list_items (tenant_id, product_id);

create table public.price_list_breaks (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  item_id          uuid not null,
  min_qty          integer not null check (min_qty between 1 and 10000),
  unit_price_paise bigint not null check (unit_price_paise between 1 and 100000000),
  created_by       uuid,
  created_via      public.record_origin not null default 'manual',
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, item_id, min_qty),
  foreign key (tenant_id, item_id) references public.price_list_items (tenant_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- quote_policy_versions: the engine's policy plus the seller state and the inputs a quote requires
-- ---------------------------------------------------------------------------------------------
create table public.quote_policy_versions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants (id) on delete restrict,
  version_no                integer not null check (version_no >= 1),
  effective_from            date not null,
  discount_ceiling_bps      integer not null check (discount_ceiling_bps between 0 and 10000),
  shipping_flat_fee_paise   bigint not null check (shipping_flat_fee_paise between 0 and 100000000),
  shipping_free_above_paise bigint check (shipping_free_above_paise between 0 and 100000000),
  shipping_tax_bps          integer not null check (shipping_tax_bps between 0 and 10000),
  validity_days             integer not null check (validity_days between 1 and 365),
  new_advance_bps           integer not null check (new_advance_bps between 0 and 10000),
  repeat_advance_bps        integer not null check (repeat_advance_bps between 0 and 10000),
  net_days                  integer not null check (net_days between 0 and 180),
  tax_mode                  public.quote_tax_mode not null default 'exclusive',
  rounding_mode             public.quote_rounding_mode not null default 'half_up',
  repeat_credit_limit_paise bigint not null default 0 check (repeat_credit_limit_paise between 0 and 1000000000),
  seller_state              text not null check (seller_state ~ '^[A-Z]{2}$'),
  -- delivery state is always required (owner decision 6); the others are optional requirements the owner may add
  required_inputs           public.quote_input_key[] not null default array['delivery_state']::public.quote_input_key[]
                            check ('delivery_state' = any (required_inputs) and cardinality(required_inputs) <= 4),
  content_sha256            text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by                uuid,
  created_via               public.record_origin not null default 'manual',
  created_at                timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_no)
);
create index quote_policy_versions_active_idx on public.quote_policy_versions (tenant_id, effective_from desc, version_no desc);
create index quote_policy_versions_keyset_idx on public.quote_policy_versions (tenant_id, created_at, id);

-- ---------------------------------------------------------------------------------------------
-- mapper_config_versions: what the requirement mapper reads (lane C's contract: saree_type_to_categories, fabric_to_values, colour_to_values)
-- plus the tenant's default sale unit, which the adapter supplies explicitly where a product has none.
-- The database checks size and shape only; it does NOT understand the vocabulary. A person confirms every product the mapper suggests,
-- so a wrong config can only change what is SUGGESTED, never what is priced.
-- ---------------------------------------------------------------------------------------------
create table public.mapper_config_versions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  version_no        integer not null check (version_no >= 1),
  effective_from    date not null,
  default_sale_unit public.quote_sale_unit not null default 'piece',
  config            jsonb not null check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 16384 and app.text_is_clean(config::text)),
  content_sha256    text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by        uuid,
  created_via       public.record_origin not null default 'manual',
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_no)
);
create index mapper_config_versions_active_idx on public.mapper_config_versions (tenant_id, effective_from desc, version_no desc);
create index mapper_config_versions_keyset_idx on public.mapper_config_versions (tenant_id, created_at, id);

-- ---------------------------------------------------------------------------------------------
-- Column classification (read by the audit and hygiene guards)
-- ---------------------------------------------------------------------------------------------
comment on column public.price_lists.name               is 'SAFE: the name of the tenant''s price list; written only by the definer function';
comment on column public.price_lists.currency           is 'SAFE: always INR';
comment on column public.price_list_versions.content_sha256 is 'SAFE: sha256 of the normalised content of the version. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.price_list_items.sku           is 'SAFE: snapshot of the product sku (a business identifier, never a person)';
comment on column public.price_list_items.name          is 'SAFE: snapshot of the product name (a business product, never a person)';
comment on column public.quote_policy_versions.seller_state    is 'SAFE: a two-letter state code. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.quote_policy_versions.content_sha256  is 'SAFE: sha256 of the normalised policy. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.mapper_config_versions.config         is 'SAFE: tenant vocabulary (category, fabric and colour words that map to codes); no personal data; text_is_clean-guarded; written only by the definer function';
comment on column public.mapper_config_versions.content_sha256 is 'SAFE: sha256 of the normalised config. CLEAN-EXEMPT: strict anchored hex pattern';

-- ---------------------------------------------------------------------------------------------
-- Triggers: tenant id fixed, provenance server-owned, rows immutable (UPDATE) and undeletable (DELETE), audited
-- ---------------------------------------------------------------------------------------------
create function app.quote_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted: record a new version', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.quote_forbid_delete() from public;

do $$
declare t text;
begin
  foreach t in array array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions'] loop
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$s for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger %1$s_set_created_meta before insert or update on public.%1$s for each row execute function app.set_created_meta()', t);
    execute format('create trigger %1$s_guard_immutable before update on public.%1$s for each row execute function app.guard_immutable_record()', t);
    execute format('create trigger %1$s_forbid_delete before delete on public.%1$s for each row execute function app.quote_forbid_delete()', t);
  end loop;
end $$;

create trigger audit_price_lists          after insert or update or delete on public.price_lists          for each row execute function app.audit_row_change('price_list');
create trigger audit_price_list_versions  after insert or update or delete on public.price_list_versions  for each row execute function app.audit_row_change('price_list_version');
create trigger audit_price_list_items     after insert or update or delete on public.price_list_items     for each row execute function app.audit_row_change('price_list_item');
create trigger audit_price_list_breaks    after insert or update or delete on public.price_list_breaks    for each row execute function app.audit_row_change('price_list_break');
create trigger audit_quote_policy_versions after insert or update or delete on public.quote_policy_versions for each row execute function app.audit_row_change('quote_policy_version');
create trigger audit_mapper_config_versions after insert or update or delete on public.mapper_config_versions for each row execute function app.audit_row_change('mapper_config_version');

-- ---------------------------------------------------------------------------------------------
-- RLS: read = Owner / Admin / Sales (a Viewer sees nothing); no client write grant anywhere
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- "Active at a date": the latest version effective on or before it (ties: the higher version number). Used by part 2.
-- ---------------------------------------------------------------------------------------------
create function app.quote_active_price_version(p_tenant uuid, p_on date) returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id from public.price_list_versions v where v.tenant_id = p_tenant and v.effective_from <= p_on order by v.effective_from desc, v.version_no desc limit 1
$$;
create function app.quote_active_policy_version(p_tenant uuid, p_on date) returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id from public.quote_policy_versions v where v.tenant_id = p_tenant and v.effective_from <= p_on order by v.effective_from desc, v.version_no desc limit 1
$$;
create function app.quote_active_mapper_version(p_tenant uuid, p_on date) returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id from public.mapper_config_versions v where v.tenant_id = p_tenant and v.effective_from <= p_on order by v.effective_from desc, v.version_no desc limit 1
$$;

-- the normalised content of a stored price list version, in the SAME shape the creation hashes (a test proves stored hash = hash of rows)
create function app.quote_price_version_normalised(p_tenant uuid, p_version uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by item ->> 'sku'), '[]'::jsonb) from (
    select jsonb_build_object(
             'product_id', i.product_id, 'sku', i.sku, 'sale_unit', i.sale_unit, 'unit_price_paise', i.unit_price_paise,
             'minimum_order_quantity', i.minimum_order_quantity, 'tax_bps', i.tax_bps,
             'breaks', coalesce((select jsonb_agg(jsonb_build_object('min_qty', b.min_qty, 'unit_price_paise', b.unit_price_paise) order by b.min_qty)
                                   from public.price_list_breaks b where b.tenant_id = i.tenant_id and b.item_id = i.id), '[]'::jsonb)) as item
      from public.price_list_items i where i.tenant_id = p_tenant and i.version_id = p_version) x
$$;

-- ---------------------------------------------------------------------------------------------
-- The shared effective-date rule and the "latest" bookkeeping
-- ---------------------------------------------------------------------------------------------
create function app.quote_check_effective(p_effective date, p_latest date) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_effective is null then
    perform app.quote_error('invalid');
  end if;
  if p_effective < app.quote_today() or p_effective < coalesce(p_latest, p_effective) then
    perform app.quote_error('value');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Internal creators (no role, no aal2: called by the public wrappers below and by the operator seed; granted to nobody)
-- ---------------------------------------------------------------------------------------------
create function app.quote_create_price_version(p_version_id uuid, p_tenant uuid, p_effective date, p_items jsonb) returns jsonb
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
  select jsonb_agg(x order by x ->> 'sku') into v_norm from jsonb_array_elements(v_norm) x;
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

create function app.quote_create_policy_version(p_version_id uuid, p_tenant uuid, p_effective date, p_policy jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ceiling bigint; v_fee bigint; v_free bigint; v_shiptax bigint; v_valid bigint; v_new bigint; v_rep bigint; v_net bigint; v_credit bigint;
  v_tax text; v_round text; v_state text; v_inputs public.quote_input_key[] := '{}';
  x jsonb;
  v_norm jsonb; v_hash text; v_latest date; v_no integer; v_exist public.quote_policy_versions;
begin
  if p_version_id is null or p_tenant is null or p_policy is null or jsonb_typeof(p_policy) <> 'object' or exists (select 1 from jsonb_object_keys(p_policy) k
       where k <> all (array['discount_ceiling_bps', 'shipping_flat_fee_paise', 'shipping_free_above_paise', 'shipping_tax_bps', 'validity_days',
                             'new_advance_bps', 'repeat_advance_bps', 'net_days', 'tax_mode', 'rounding_mode', 'repeat_credit_limit_paise',
                             'seller_state', 'required_inputs'])) then
    perform app.quote_error('invalid');
  end if;
  v_ceiling := app.quote_int(p_policy, 'discount_ceiling_bps', 0, 10000);
  v_fee     := app.quote_int(p_policy, 'shipping_flat_fee_paise', 0, 100000000);
  v_free    := app.quote_int(p_policy, 'shipping_free_above_paise', 0, 100000000, false);
  v_shiptax := app.quote_int(p_policy, 'shipping_tax_bps', 0, 10000);
  v_valid   := app.quote_int(p_policy, 'validity_days', 1, 365);
  v_new     := app.quote_int(p_policy, 'new_advance_bps', 0, 10000);
  v_rep     := app.quote_int(p_policy, 'repeat_advance_bps', 0, 10000);
  v_net     := app.quote_int(p_policy, 'net_days', 0, 180);
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
    'validity_days', v_valid, 'new_advance_bps', v_new, 'repeat_advance_bps', v_rep, 'net_days', v_net, 'tax_mode', v_tax, 'rounding_mode', v_round,
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
     new_advance_bps, repeat_advance_bps, net_days, tax_mode, rounding_mode, repeat_credit_limit_paise, seller_state, required_inputs, content_sha256)
  values
    (p_version_id, p_tenant, v_no, p_effective, v_ceiling, v_fee, v_free, v_shiptax, v_valid, v_new, v_rep, v_net, v_tax::public.quote_tax_mode,
     v_round::public.quote_rounding_mode, v_credit, v_state, v_inputs, v_hash);
  return jsonb_build_object('version_id', p_version_id, 'version_no', v_no, 'effective_from', p_effective, 'content_sha256', v_hash, 'replayed', false);
end;
$$;

create function app.quote_create_mapper_version(p_version_id uuid, p_tenant uuid, p_effective date, p_default_sale_unit text, p_config jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_map text;
  k text;
  c record;
  v_val jsonb;
  v_norm jsonb;
  v_hash text;
  v_latest date;
  v_no integer;
  v_exist public.mapper_config_versions;
begin
  if p_version_id is null or p_tenant is null or p_config is null or jsonb_typeof(p_config) <> 'object' or p_default_sale_unit is null then
    perform app.quote_error('invalid');
  end if;
  if p_default_sale_unit <> all (array['piece', 'set']) then
    perform app.quote_error('value');
  end if;
  if exists (select 1 from jsonb_object_keys(p_config) x where x <> all (array['saree_type_to_categories', 'fabric_to_values', 'colour_to_values'])) then
    perform app.quote_error('invalid');
  end if;
  -- each map: at most 500 codes (a code is a lower-case word), each with 1..100 non-blank comparison strings of 1..200 characters
  foreach v_map in array array['saree_type_to_categories', 'fabric_to_values', 'colour_to_values'] loop
    if p_config ? v_map then
      if jsonb_typeof(p_config -> v_map) <> 'object' or (select count(*) from jsonb_object_keys(p_config -> v_map)) > 500 then
        perform app.quote_error('invalid');
      end if;
      for c in select key, value from jsonb_each(p_config -> v_map) loop
        if c.key !~ '^[a-z][a-z0-9_]{0,40}$' or jsonb_typeof(c.value) <> 'array' or jsonb_array_length(c.value) not between 1 and 100 then
          perform app.quote_error('invalid');
        end if;
        for v_val in select y from jsonb_array_elements(c.value) y loop
          if jsonb_typeof(v_val) <> 'string' or char_length(btrim(v_val #>> '{}')) not between 1 and 200 then
            perform app.quote_error('value');
          end if;
        end loop;
      end loop;
    end if;
  end loop;
  if octet_length(p_config::text) > 16384 or not app.text_is_clean(p_config::text) then
    perform app.quote_error('value');
  end if;
  v_norm := jsonb_build_object('default_sale_unit', p_default_sale_unit, 'config', p_config);
  v_hash := app.quote_content_hash(v_norm);

  perform pg_advisory_xact_lock(hashtextextended('quote_ref:mapper:' || p_tenant::text, 0));
  select * into v_exist from public.mapper_config_versions v where v.id = p_version_id;
  if found then
    if v_exist.tenant_id = p_tenant and v_exist.content_sha256 = v_hash and v_exist.effective_from = p_effective then
      return jsonb_build_object('version_id', v_exist.id, 'version_no', v_exist.version_no, 'effective_from', v_exist.effective_from,
                                'content_sha256', v_exist.content_sha256, 'replayed', true);
    end if;
    perform app.quote_error('conflict');
  end if;
  select max(v.effective_from), coalesce(max(v.version_no), 0) + 1 into v_latest, v_no from public.mapper_config_versions v where v.tenant_id = p_tenant;
  perform app.quote_check_effective(p_effective, v_latest);
  insert into public.mapper_config_versions (id, tenant_id, version_no, effective_from, default_sale_unit, config, content_sha256)
  values (p_version_id, p_tenant, v_no, p_effective, p_default_sale_unit::public.quote_sale_unit, p_config, v_hash);
  return jsonb_build_object('version_id', p_version_id, 'version_no', v_no, 'effective_from', p_effective, 'content_sha256', v_hash, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public functions: Owner / Admin, then aal2 (the role first, so a refusal before it is the same 42501 for everyone)
-- ---------------------------------------------------------------------------------------------
create function public.create_price_list_version(p_version_id uuid, p_tenant_id uuid, p_effective_from date, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  perform app.require_aal2();
  return app.quote_create_price_version(p_version_id, p_tenant_id, p_effective_from, p_items);
end;
$$;

create function public.create_quote_policy_version(p_version_id uuid, p_tenant_id uuid, p_effective_from date, p_policy jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  perform app.require_aal2();
  return app.quote_create_policy_version(p_version_id, p_tenant_id, p_effective_from, p_policy);
end;
$$;

create function public.create_mapper_config_version(p_version_id uuid, p_tenant_id uuid, p_effective_from date, p_default_sale_unit text, p_config jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.quote_deny();
  end if;
  perform app.require_aal2();
  return app.quote_create_mapper_version(p_version_id, p_tenant_id, p_effective_from, p_default_sale_unit, p_config);
end;
$$;

revoke all on function app.quote_deny(), app.quote_error(text), app.quote_today(), app.quote_int(jsonb, text, bigint, bigint, boolean),
  app.quote_text(jsonb, text, integer, integer, boolean), app.quote_content_hash(jsonb), app.quote_active_price_version(uuid, date),
  app.quote_active_policy_version(uuid, date), app.quote_active_mapper_version(uuid, date), app.quote_price_version_normalised(uuid, uuid),
  app.quote_check_effective(date, date), app.quote_create_price_version(uuid, uuid, date, jsonb), app.quote_create_policy_version(uuid, uuid, date, jsonb),
  app.quote_create_mapper_version(uuid, uuid, date, text, jsonb) from public;
revoke all on function public.create_price_list_version(uuid, uuid, date, jsonb) from public, anon;
revoke all on function public.create_quote_policy_version(uuid, uuid, date, jsonb) from public, anon;
revoke all on function public.create_mapper_config_version(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_price_list_version(uuid, uuid, date, jsonb) to authenticated;
grant execute on function public.create_quote_policy_version(uuid, uuid, date, jsonb) to authenticated;
grant execute on function public.create_mapper_config_version(uuid, uuid, date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The LOCAL operator seed: SYNTHETIC reference data for a workspace (callable by no application role). Idempotent: it creates what is missing and
-- never touches a version that exists. Every value below is invented for tests and demos: NOT a statement of any tax rate, price, advance or
-- freight, and never to be used for a real quote (docs/pre-pilot-checklist.md, "Quotes").
-- ---------------------------------------------------------------------------------------------
create function app.operator_seed_quote_reference_data(p_tenant_slug text) returns jsonb
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
      'seller_state', 'TS', 'required_inputs', jsonb_build_array('delivery_state')));
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
