-- Shopify and WooCommerce (docs/contracts/commerce-notify.md section B): a workspace connects its own store, orders and abandoned checkouts arrive by the store's webhooks, and the phone assistant can answer
-- "where is my order" for the caller's own orders.
--   public.commerce_connections   one per workspace and store kind (Shopify, WooCommerce). The store's KEYS are never here: they live in Secret Manager (workspace-secrets store, `sme-ws-<workspace>-conn-<kind>`);
--                                 the database keeps the store's public name, the last four characters of its key, the sha256 of the secret part of OUR webhook address, the owner's choices (a closed set of keys) and a state.
--   public.commerce_orders        one row per store order: the display number, a closed status, how it is paid, the total in paise, the item names (business data), the tracking text and the customer's number (PII, only
--                                 so the assistant can find the caller's own orders). No address, no e-mail, no name.
--   public.commerce_checkouts     a checkout that was started and not finished, until its call-back is due (then the number and name are wiped). Kept at most 7 days.
-- Written only by the functions below: the Owner's or Admin's (connect, choices, state, disconnect) and the scheduler account's (the webhook receiver, the worker, the phone's read). Nothing is received or sent unless
-- the API runs with COMMERCE=on (the kill switch: the routes answer 404 and the worker does nothing).

create table public.commerce_connections (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id),
  kind                text not null check (kind in ('shopify', 'woocommerce')),
  store_label         text not null check (store_label ~ '^[A-Za-z0-9][A-Za-z0-9.-]{1,118}[A-Za-z0-9]$'),
  token_hash          text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  secret_last4        text not null default '' check (secret_last4 ~ '^[A-Za-z0-9]{0,4}$'),
  lead_source_id      uuid,
  settings            jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  state               text not null default 'connected' check (state in ('connected', 'problem', 'disconnected')),
  problem             text check (problem in ('bad_credentials', 'unreachable', 'webhooks_not_registered', 'no_permission', 'signature_wrong')),
  webhooks_registered boolean not null default false,
  last_event_at       timestamptz,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, kind),
  unique (tenant_id, id),
  unique (token_hash)
);
comment on table public.commerce_connections is 'A workspace''s Shopify or WooCommerce store. Written only by the commerce_* functions. The store''s keys are NOT stored here (Secret Manager).';
comment on column public.commerce_connections.kind is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.commerce_connections.store_label is 'SAFE: the store''s public host name (my-shop.myshopify.com, shop.example.com). CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_connections.token_hash is 'SAFE: sha256 of the secret part of our webhook address for this store (never the address). CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_connections.secret_last4 is 'SAFE: the last four characters of the store key, to tell keys apart. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_connections.settings is 'SAFE: the owner''s choices, a closed set of keys written by commerce_settings_set (no personal data). CLEAN-EXEMPT: not client-writable, keys and values validated by the function';
comment on column public.commerce_connections.state is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.commerce_connections.problem is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
alter table public.commerce_connections enable row level security;
alter table public.commerce_connections force row level security;
revoke all on public.commerce_connections from public, anon, authenticated, service_role;
create trigger commerce_connections_forbid_tenant_id_change before update on public.commerce_connections for each row execute function app.forbid_tenant_id_change();
create trigger audit_commerce_connections after insert or update or delete on public.commerce_connections for each row execute function app.audit_row_change('commerce_connection', '');
grant select (id, tenant_id, kind, store_label, secret_last4, state, problem, webhooks_registered, last_event_at, created_at, updated_at, settings) on public.commerce_connections to authenticated;
create policy commerce_connections_select on public.commerce_connections for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index commerce_connections_tenant on public.commerce_connections (tenant_id, created_at desc, id desc);

create table public.commerce_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  connection_id uuid not null,
  external_id   text not null check (external_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  number        text not null check (number ~ '^[#A-Za-z0-9 _-]{1,30}$'),
  status        text not null default 'placed' check (status in ('placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned')),
  payment       text not null default 'unknown' check (payment in ('cod', 'prepaid', 'unknown')),
  total_paise   bigint not null default 0 check (total_paise between 0 and 100000000000),
  items_text    text not null default '' check (char_length(items_text) <= 200 and app.text_is_clean(items_text)),
  tracking      text not null default '' check (tracking ~ '^[A-Za-z0-9 ./:_-]{0,80}$'),
  phone         text check (phone ~ '^\+[0-9]{8,15}$'),
  lead_sent_at  timestamptz,
  placed_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.commerce_connections (tenant_id, id),
  unique (connection_id, external_id)
);
comment on table public.commerce_orders is 'A store order, as much as the assistant needs to answer "where is my order" and to count: no address, e-mail or name. Written only by commerce_order_upsert (scheduler). Kept 180 days.';
comment on column public.commerce_orders.external_id is 'SAFE: the store''s own order id. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_orders.number is 'SAFE: the order''s display number (#1001). CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_orders.status is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.commerce_orders.payment is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.commerce_orders.items_text is 'SAFE: the item names of the order (the business''s own product names), at most 200 characters, one line';
comment on column public.commerce_orders.tracking is 'SAFE: the carrier''s tracking text (no personal data). CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_orders.phone is 'PII: the customer''s number in the stored form, only to find the caller''s own orders. CLEAN-EXEMPT: strict anchored pattern';
alter table public.commerce_orders enable row level security;
alter table public.commerce_orders force row level security;
revoke all on public.commerce_orders from public, anon, authenticated, service_role;
create trigger commerce_orders_forbid_tenant_id_change before update on public.commerce_orders for each row execute function app.forbid_tenant_id_change();
create trigger audit_commerce_orders after insert or update or delete on public.commerce_orders for each row execute function app.audit_row_change('commerce_order', 'phone');
grant select (id, tenant_id, connection_id, external_id, number, status, payment, total_paise, items_text, tracking, lead_sent_at, placed_at, created_at, updated_at) on public.commerce_orders to authenticated;
create policy commerce_orders_select on public.commerce_orders for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create index commerce_orders_by_phone on public.commerce_orders (tenant_id, phone, placed_at desc) where phone is not null;
create index commerce_orders_recent on public.commerce_orders (tenant_id, connection_id, placed_at desc);

create table public.commerce_checkouts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  connection_id uuid not null,
  external_id   text not null check (external_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  status        text not null default 'pending' check (status in ('pending', 'recovered', 'done', 'skipped')),
  due_at        timestamptz not null,
  claimed_until timestamptz,
  total_paise   bigint not null default 0 check (total_paise between 0 and 100000000000),
  items_text    text not null default '' check (char_length(items_text) <= 200 and app.text_is_clean(items_text)),
  phone         text check (phone ~ '^\+[0-9]{8,15}$'),
  name          text check (name is null or (char_length(name) <= 100 and app.text_is_clean(name))),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (tenant_id, connection_id) references public.commerce_connections (tenant_id, id),
  unique (connection_id, external_id),
  check (status = 'pending' or (phone is null and name is null))
);
comment on table public.commerce_checkouts is 'A checkout that was started and not finished, until its call-back is due; the number and name are wiped when it is done, skipped or recovered. Written only by the commerce_checkout_* functions (scheduler). Kept 7 days.';
comment on column public.commerce_checkouts.external_id is 'SAFE: the store''s checkout token or id. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_checkouts.status is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.commerce_checkouts.items_text is 'SAFE: the item names in the cart (the business''s own product names), at most 200 characters';
comment on column public.commerce_checkouts.phone is 'PII: the shopper''s number until the call-back is made. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.commerce_checkouts.name is 'PII: the shopper''s name until the call-back is made';
alter table public.commerce_checkouts enable row level security;
alter table public.commerce_checkouts force row level security;
revoke all on public.commerce_checkouts from public, anon, authenticated, service_role;
create trigger commerce_checkouts_forbid_tenant_id_change before update on public.commerce_checkouts for each row execute function app.forbid_tenant_id_change();
create trigger audit_commerce_checkouts after insert or update or delete on public.commerce_checkouts for each row execute function app.audit_row_change('commerce_checkout', 'phone,name');
grant select (id, tenant_id, connection_id, external_id, status, due_at, total_paise, items_text, created_at, updated_at) on public.commerce_checkouts to authenticated;
create policy commerce_checkouts_select on public.commerce_checkouts for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index commerce_checkouts_due on public.commerce_checkouts (due_at) where status = 'pending';

-- ---------------------------------------------------------------------------------------------------------------- what a connection looks like to the app (never a key, never the address token)
create function app.commerce_connection_json(c public.commerce_connections) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'store_label', c.store_label, 'state', c.state, 'problem', c.problem, 'secret_last4', c.secret_last4,
    'webhooks_registered', c.webhooks_registered, 'last_event_at', c.last_event_at, 'settings', c.settings, 'created_at', c.created_at,
    'counts', jsonb_build_object(
      'orders_30d', (select count(*) from public.commerce_orders o where o.tenant_id = c.tenant_id and o.connection_id = c.id and o.placed_at > now() - interval '30 days'),
      'cod_30d', (select count(*) from public.commerce_orders o where o.tenant_id = c.tenant_id and o.connection_id = c.id and o.payment = 'cod' and o.placed_at > now() - interval '30 days'),
      'carts_waiting', (select count(*) from public.commerce_checkouts k where k.tenant_id = c.tenant_id and k.connection_id = c.id and k.status = 'pending')))
$$;
revoke all on function app.commerce_connection_json(public.commerce_connections) from public;

-- ---------------------------------------------------------------------------------------------------------------- the Owner's and Admin's functions
create function public.commerce_connections_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app.commerce_connection_json(c) order by c.created_at, c.id) from public.commerce_connections c where c.tenant_id = p_tenant_id and c.state <> 'disconnected'), '[]'::jsonb);
end;
$$;

-- Connect (or reconnect) a store. One connection per kind: a new call for the same kind replaces the store, the address token and the key hint, and keeps the owner's choices.
create function public.commerce_connect(p_tenant_id uuid, p_id uuid, p_kind text, p_store_label text, p_token_hash text, p_last4 text, p_lead_source_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commerce_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  begin
    insert into public.commerce_connections (id, tenant_id, kind, store_label, token_hash, secret_last4, lead_source_id, created_by)
    values (p_id, p_tenant_id, p_kind, p_store_label, p_token_hash, coalesce(p_last4, ''), p_lead_source_id, auth.uid())
    on conflict (tenant_id, kind) do update
      set store_label = excluded.store_label, token_hash = excluded.token_hash, secret_last4 = excluded.secret_last4, lead_source_id = excluded.lead_source_id,
          state = 'connected', problem = null, webhooks_registered = false, updated_at = now()
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return app.commerce_connection_json(v);
end;
$$;

-- The owner's choices: only these keys, only these values; anything else is refused whole (22023). A key left out keeps its value.
--   confirm_orders        'cod' (default) | 'all' | 'off'   which new orders get the order-confirmation first touch
--   abandoned             boolean (default false)            a call-back for a checkout that was not finished
--   abandoned_after_min   15 .. 1440 (default 60)            how long to wait before a checkout counts as left
--   checkout_consent      boolean (default false)            the OWNER says their checkout tells customers they may be called or messaged about their order (who and when are kept here)
--   share_status          boolean (default true)             the phone assistant answers order-status questions for the caller's own orders
--   cod_words             up to 5 short words that mark a payment method as cash on delivery, besides the built-in ones
create function public.commerce_settings_set(p_tenant_id uuid, p_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commerce_connections;
  k text;
  cur jsonb;
  nxt jsonb;
  w jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v from public.commerce_connections c where c.tenant_id = p_tenant_id and c.id = p_id for update;
  if not found then
    return null;
  end if;
  nxt := v.settings;
  for k in select jsonb_object_keys(p_settings) loop
    if k = 'confirm_orders' then
      if p_settings ->> k not in ('cod', 'all', 'off') then raise exception 'invalid input' using errcode = '22023'; end if;
      nxt := nxt || jsonb_build_object(k, p_settings -> k);
    elsif k in ('abandoned', 'share_status') then
      if jsonb_typeof(p_settings -> k) <> 'boolean' then raise exception 'invalid input' using errcode = '22023'; end if;
      nxt := nxt || jsonb_build_object(k, p_settings -> k);
    elsif k = 'abandoned_after_min' then
      if jsonb_typeof(p_settings -> k) <> 'number' or (p_settings ->> k) !~ '^[0-9]{2,4}$' or (p_settings ->> k)::int not between 15 and 1440 then raise exception 'invalid input' using errcode = '22023'; end if;
      nxt := nxt || jsonb_build_object(k, p_settings -> k);
    elsif k = 'checkout_consent' then
      if jsonb_typeof(p_settings -> k) <> 'boolean' then raise exception 'invalid input' using errcode = '22023'; end if;
      if (p_settings ->> k)::boolean then
        if coalesce((v.settings ->> 'checkout_consent')::boolean, false) is not true then
          nxt := nxt || jsonb_build_object('checkout_consent', true, 'checkout_consent_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'checkout_consent_by', auth.uid());
        end if;
      else
        nxt := (nxt - 'checkout_consent_at' - 'checkout_consent_by') || jsonb_build_object('checkout_consent', false);
      end if;
    elsif k = 'cod_words' then
      if jsonb_typeof(p_settings -> k) <> 'array' or jsonb_array_length(p_settings -> k) > 5 then raise exception 'invalid input' using errcode = '22023'; end if;
      for w in select * from jsonb_array_elements(p_settings -> k) loop
        if jsonb_typeof(w) <> 'string' or (w #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9 ]{1,28}[A-Za-z0-9]$' then raise exception 'invalid input' using errcode = '22023'; end if;
      end loop;
      nxt := nxt || jsonb_build_object(k, p_settings -> k);
    else
      raise exception 'invalid input' using errcode = '22023';
    end if;
  end loop;
  update public.commerce_connections c set settings = nxt, updated_at = now() where c.id = v.id returning * into v;
  return app.commerce_connection_json(v);
end;
$$;

-- The API's own check result (after Test, or after registering the store's webhooks): the state, a closed problem word, and whether the webhooks are in place.
create function public.commerce_mark(p_tenant_id uuid, p_id uuid, p_state text, p_problem text, p_webhooks boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commerce_connections;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  begin
    update public.commerce_connections c set state = p_state, problem = case when p_state = 'connected' then null else p_problem end,
           webhooks_registered = coalesce(p_webhooks, c.webhooks_registered), updated_at = now()
     where c.tenant_id = p_tenant_id and c.id = p_id and c.state <> 'disconnected'
    returning * into v;
  exception when check_violation or not_null_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return case when v.id is null then null else app.commerce_connection_json(v) end;
end;
$$;

-- Disconnect: the API has already removed the keys from the secret store. Orders stay (the assistant can still answer for them); no new event is accepted.
create function public.commerce_disconnect(p_tenant_id uuid, p_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.commerce_connections c set state = 'disconnected', problem = null, webhooks_registered = false, token_hash = encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), updated_at = now()
   where c.tenant_id = p_tenant_id and c.id = p_id and c.state <> 'disconnected';
  get diagnostics v_n = row_count;
  update public.commerce_checkouts k set status = 'skipped', phone = null, name = null, updated_at = now() where k.tenant_id = p_tenant_id and k.connection_id = p_id and k.status = 'pending';
  return v_n > 0;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the scheduler account's functions (the webhook receiver, the worker, the phone)
-- The connection behind the secret part of a webhook address (its hash). null: unknown or disconnected.
create function public.commerce_connection_by_token(p_token_hash text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.commerce_connections;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  select * into v from public.commerce_connections c where c.token_hash = p_token_hash and c.state <> 'disconnected';
  if not found then
    return null;
  end if;
  return jsonb_build_object('id', v.id, 'tenant_id', v.tenant_id, 'kind', v.kind, 'state', v.state, 'store_label', v.store_label, 'lead_source_id', v.lead_source_id, 'settings', v.settings);
end;
$$;

-- One order, from a store event. The same external id again updates the status, the tracking and the items; the number and the payment are kept. Answers whether it is new and whether its first-touch lead was already sent.
create function public.commerce_order_upsert(p_tenant_id uuid, p_connection_id uuid, p_external_id text, p_number text, p_status text, p_payment text, p_total_paise bigint, p_items text, p_tracking text, p_phone text, p_placed_at timestamptz, p_checkout_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commerce_orders;
  v_new boolean;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  perform 1 from public.commerce_connections c where c.tenant_id = p_tenant_id and c.id = p_connection_id and c.state <> 'disconnected';
  if not found then
    perform app.scheduler_error('reference');
  end if;
  v_new := not exists (select 1 from public.commerce_orders o where o.connection_id = p_connection_id and o.external_id = p_external_id);
  begin
    insert into public.commerce_orders (tenant_id, connection_id, external_id, number, status, payment, total_paise, items_text, tracking, phone, placed_at)
    values (p_tenant_id, p_connection_id, p_external_id, p_number, p_status, coalesce(p_payment, 'unknown'), coalesce(p_total_paise, 0), coalesce(p_items, ''), coalesce(p_tracking, ''), p_phone, coalesce(p_placed_at, now()))
    on conflict (connection_id, external_id) do update
      set status = case when public.commerce_orders.status in ('cancelled', 'returned') and excluded.status not in ('cancelled', 'returned') then public.commerce_orders.status else excluded.status end,
          tracking = case when excluded.tracking <> '' then excluded.tracking else public.commerce_orders.tracking end,
          items_text = case when excluded.items_text <> '' then excluded.items_text else public.commerce_orders.items_text end,
          total_paise = case when excluded.total_paise > 0 then excluded.total_paise else public.commerce_orders.total_paise end,
          phone = coalesce(public.commerce_orders.phone, excluded.phone), updated_at = now()
    returning * into v;
  exception when check_violation or not_null_violation or invalid_text_representation then
    perform app.scheduler_error('invalid');
  end;
  update public.commerce_connections c set last_event_at = now() where c.id = p_connection_id;
  update public.commerce_checkouts k set status = 'recovered', phone = null, name = null, updated_at = now()
   where k.tenant_id = p_tenant_id and k.connection_id = p_connection_id and k.status = 'pending' and p_checkout_ref is not null and k.external_id = p_checkout_ref;
  return jsonb_build_object('order_id', v.id, 'status', v.status, 'created', v_new, 'lead_sent', v.lead_sent_at is not null);
end;
$$;

create function public.commerce_order_lead_sent(p_tenant_id uuid, p_connection_id uuid, p_external_id text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  update public.commerce_orders o set lead_sent_at = now() where o.tenant_id = p_tenant_id and o.connection_id = p_connection_id and o.external_id = p_external_id and o.lead_sent_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- A started checkout: kept until its call-back is due (now plus the owner's wait). Seen again it only moves the due time; one that was finished (the order's checkout token, or the store says completed) is `recovered`.
create function public.commerce_checkout_upsert(p_tenant_id uuid, p_connection_id uuid, p_external_id text, p_phone text, p_name text, p_total_paise bigint, p_items text, p_completed boolean, p_wait_min integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.commerce_checkouts;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  perform 1 from public.commerce_connections c where c.tenant_id = p_tenant_id and c.id = p_connection_id and c.state <> 'disconnected';
  if not found or p_wait_min is null or p_wait_min not between 15 and 1440 then
    perform app.scheduler_error('invalid');
  end if;
  begin
    if p_completed then
      update public.commerce_checkouts k set status = 'recovered', phone = null, name = null, updated_at = now()
       where k.tenant_id = p_tenant_id and k.connection_id = p_connection_id and k.external_id = p_external_id and k.status = 'pending';
      return jsonb_build_object('status', 'recovered');
    end if;
    insert into public.commerce_checkouts (tenant_id, connection_id, external_id, due_at, total_paise, items_text, phone, name)
    values (p_tenant_id, p_connection_id, p_external_id, now() + make_interval(mins => p_wait_min), coalesce(p_total_paise, 0), coalesce(p_items, ''), p_phone, p_name)
    on conflict (connection_id, external_id) do update
      set due_at = case when public.commerce_checkouts.status = 'pending' then now() + make_interval(mins => p_wait_min) else public.commerce_checkouts.due_at end,
          total_paise = case when excluded.total_paise > 0 then excluded.total_paise else public.commerce_checkouts.total_paise end,
          items_text = case when excluded.items_text <> '' then excluded.items_text else public.commerce_checkouts.items_text end,
          phone = case when public.commerce_checkouts.status = 'pending' then coalesce(excluded.phone, public.commerce_checkouts.phone) else null end,
          name = case when public.commerce_checkouts.status = 'pending' then coalesce(excluded.name, public.commerce_checkouts.name) else null end,
          updated_at = now()
    returning * into v;
  exception when check_violation or not_null_violation or invalid_text_representation then
    perform app.scheduler_error('invalid');
  end;
  update public.commerce_connections c set last_event_at = now() where c.id = p_connection_id;
  return jsonb_build_object('status', v.status);
end;
$$;

-- The worker's claim: checkouts whose wait is over, on a connected store whose owner turned the call-back on. Leased for 3 minutes.
create function public.commerce_checkouts_claim(p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_out jsonb;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    perform app.scheduler_error('invalid');
  end if;
  with due as (
    select k.id from public.commerce_checkouts k
      join public.commerce_connections c on c.tenant_id = k.tenant_id and c.id = k.connection_id
     where k.status = 'pending' and k.due_at <= v_now and (k.claimed_until is null or k.claimed_until < v_now) and c.state <> 'disconnected'
     order by k.due_at, k.id
     limit p_limit
       for update of k skip locked),
  upd as (
    update public.commerce_checkouts k set claimed_until = v_now + interval '3 minutes' from due where k.id = due.id returning k.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'tenant_id', u.tenant_id, 'connection_id', u.connection_id, 'external_id', u.external_id, 'phone', u.phone, 'name', u.name,
                                               'total_paise', u.total_paise, 'items', u.items_text, 'created_at', u.created_at, 'kind', c.kind, 'lead_source_id', c.lead_source_id,
                                               'abandoned', coalesce((c.settings ->> 'abandoned')::boolean, false), 'settings', c.settings)), '[]'::jsonb)
    into v_out
    from upd u join public.commerce_connections c on c.tenant_id = u.tenant_id and c.id = u.connection_id;
  return v_out;
end;
$$;

-- The worker's result for one claimed checkout: done (a first touch was made), skipped (no number, the owner turned it off, the lead was refused), or still pending (try again in 5 minutes: a lead that was rate limited).
create function public.commerce_checkout_finish(p_id uuid, p_result text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_result not in ('done', 'skipped', 'retry') then
    perform app.scheduler_error('invalid');
  end if;
  if p_result = 'retry' then
    update public.commerce_checkouts k set claimed_until = null, due_at = now() + interval '5 minutes', updated_at = now() where k.id = p_id and k.status = 'pending';
  else
    update public.commerce_checkouts k set status = p_result, phone = null, name = null, claimed_until = null, updated_at = now() where k.id = p_id and k.status = 'pending';
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- What the phone assistant may say about THIS caller's own orders (their number, at most three, newest first), only from a connected store whose owner left "answer order questions" on.
create function public.commerce_order_facts(p_tenant_id uuid, p_phone text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_phone is null or p_phone !~ '^\+[0-9]{8,15}$' then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(x.j order by x.placed_at desc) from (
      select o.placed_at, jsonb_build_object('number', o.number, 'status', o.status, 'payment', o.payment, 'paise', o.total_paise, 'items', o.items_text, 'tracking', o.tracking, 'placed_at', o.placed_at, 'updated_at', o.updated_at) as j
        from public.commerce_orders o join public.commerce_connections c on c.tenant_id = o.tenant_id and c.id = o.connection_id
       where o.tenant_id = p_tenant_id and o.phone = p_phone and c.state = 'connected' and coalesce((c.settings ->> 'share_status')::boolean, true)
       order by o.placed_at desc limit 3) x), '[]'::jsonb);
end;
$$;

-- Kept: orders 180 days, a started checkout 7 days.
create function public.commerce_purge() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o integer;
  v_k integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  delete from public.commerce_orders o where o.created_at < now() - interval '180 days';
  get diagnostics v_o = row_count;
  delete from public.commerce_checkouts k where k.created_at < now() - interval '7 days';
  get diagnostics v_k = row_count;
  return jsonb_build_object('orders', v_o, 'checkouts', v_k);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.commerce_connections_list(uuid)', 'public.commerce_connect(uuid, uuid, text, text, text, text, uuid)', 'public.commerce_settings_set(uuid, uuid, jsonb)',
                           'public.commerce_mark(uuid, uuid, text, text, boolean)', 'public.commerce_disconnect(uuid, uuid)', 'public.commerce_connection_by_token(text)',
                           'public.commerce_order_upsert(uuid, uuid, text, text, text, text, bigint, text, text, text, timestamptz, text)', 'public.commerce_order_lead_sent(uuid, uuid, text)',
                           'public.commerce_checkout_upsert(uuid, uuid, text, text, text, bigint, text, boolean, integer)', 'public.commerce_checkouts_claim(integer)',
                           'public.commerce_checkout_finish(uuid, text)', 'public.commerce_order_facts(uuid, text)', 'public.commerce_purge()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
