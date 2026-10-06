-- Order conversion, the database and its proofs (ADR 0021, docs/plans/order-conversion.md, owner decisions of 2026-10-06): an APPROVED quote becomes an order that follows lane C's
-- pure lifecycle (packages/pure/order_lifecycle 1.0.0). NOTHING IS EVER SENT AND NO MONEY MOVES: every event is a PERSON's record of something that happened outside the system
-- ("I sent the quote", "the customer accepted", "we received Rs 40,000"). The ledger is a ledger of claims.
--
--   order_engine_versions     the allow-list of lifecycle versions the database accepts (migration-extended; not tenant data)
--   order_policy_versions     immutable, versioned: advance required, dispatch needs the advance, the cancel window, zero-value orders (Owner, aal2)
--   orders                    one per approved quote; the figures are COPIED BY THE DATABASE from the quote row; only state / closed_at / updated_at ever move
--   order_events              the append-only ledger (the source of truth); orders.state is its cache and a guard trigger keeps them equal
--   order_ledger (view)       paid, refunded, net, balance, lost reason, from the events (security invoker)
--   public.create_order_policy_version, create_order_from_quote, record_order_event
--   public.withdraw_approved_quote, public.approve_quote   REPLACED (SM237 once an order exists for the quote)
--   app.order_stops_followups(lead)   read-only helper for the follow-up functions (T010 part 2): accepted, declined, cancelled orders and a withdrawn quote stop follow-ups
--
-- What the database proves, and what it cannot (the honest limit, ADR 0021 decision 3):
--   The API runs the pinned lifecycle with the caller's token and hands record_order_event the canonical request, the lifecycle's result and the person's inputs. The database
--     1. rebuilds the request from its OWN ledger (app.order_build) and refuses any other one (SM238): the state, the amounts, the ledger, the policy, the dates and the
--        owner_override flag (DERIVED from the caller's role: only an Owner dispatching) are the database's, never the caller's;
--     2. recomputes the decision (app.order_decide: the v1 subset, the same rules and the same order of checks as the pure package; an equivalence property test pins them equal)
--        and refuses a rejected decision (SM232, with the lifecycle's closed code in DETAIL), a closed order (SM235), a result that differs from its own decision (SM238);
--     3. moves the cache and appends the event in one statement; a guard trigger refuses any state change that is not the new state of the latest event.
--   What remains outside the database: it does not run the LIFECYCLE (two implementations, kept equal by the property test); the rule trace is stored as given; an Owner or Admin
--   calling these functions directly is trusted to report a real event and to have run the engine (the T006 option-A limit; option B before an external customer); that the money
--   really arrived, the customer really accepted and the goods really shipped is the person's word.
--
-- Lock order (ADR 0018 decision 9, extended at its tail): ENQUIRY row, REQUIREMENT row, QUOTE row, ORDER row, the order's events. Every writer that creates an order or changes the
-- standing of an approved quote locks the quote row after the enquiry and the requirement rows; record_order_event locks the order row alone (it reads no quote). Any one of the
-- three parent locks is redundant given the others (create_order_from_quote, approve_quote and withdraw_approved_quote of one requirement all meet on the enquiry row first).
--
-- SQLSTATEs (app.order_error): SM230 the quote is not approved, SM231 an order already exists for this quote, SM232 the event is refused by the lifecycle rules (DETAIL: the
-- lifecycle's closed code), SM233 the figures cannot satisfy the policy, SM234 a refund needs the Owner, SM235 the order is closed, SM236 the quote has expired, SM237 the quote has
-- an order (withdrawal or replacement refused), SM238 the request or result is not what the database computes, SM239 no order policy in force. 42501 for every refusal before the
-- role is proven; SM306 second factor; 22023 invalid argument, 23514 value not allowed, 23503 invalid reference, 23505 record id already used.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.order_state as enum ('quote_approved', 'quote_sent', 'accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered',
                                        'closed_paid', 'declined', 'expired', 'cancelled');
-- `created` is the database's own first event; the other eleven are the lifecycle's event names
create type public.order_event_type as enum ('created', 'send_quote', 'customer_accept', 'customer_decline', 'expire', 'request_advance', 'record_payment', 'start_preparation',
                                             'dispatch', 'deliver', 'cancel', 'record_refund');
-- the closed list of lost reasons (plan decision 7): changing it needs a migration
create type public.order_lost_reason as enum ('price', 'timing', 'bought_elsewhere', 'no_response', 'requirement_changed', 'product_unavailable', 'credit_terms', 'other');

-- ---------------------------------------------------------------------------------------------
-- Errors
-- ---------------------------------------------------------------------------------------------
create function app.order_deny() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order action not permitted' using errcode = '42501';
end;
$$;

create function app.order_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'conflict' then 'record id already used'
      when 'value' then 'value not allowed'
      when 'reference' then 'invalid reference'
      when 'SM230' then 'quote is not approved'
      when 'SM231' then 'an order already exists for this quote'
      when 'SM233' then 'order figures cannot satisfy the policy'
      when 'SM234' then 'a refund needs the owner'
      when 'SM235' then 'order is closed'
      when 'SM236' then 'quote has expired'
      when 'SM237' then 'quote has an order'
      when 'SM238' then 'order request does not match its recomputation'
      when 'SM239' then 'no order policy in force'
      else 'invalid argument' end
    using errcode = case when p_code ~ '^SM23[0-9]$' then p_code
                         else case p_code when 'conflict' then '23505' when 'value' then '23514' when 'reference' then '23503' else '22023' end end;
end;
$$;

-- SM232: the lifecycle refuses the event; the DETAIL is the lifecycle's own closed code (never a value)
create function app.order_refuse(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order event refused' using errcode = 'SM232', detail = p_code;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The lifecycle allow-list: NOT tenant data. A new version needs a reviewed migration, never a config flip.
-- ---------------------------------------------------------------------------------------------
create table public.order_engine_versions (
  version  text primary key check (version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  added_at timestamptz not null default now()
);
comment on column public.order_engine_versions.version is 'SAFE: a semantic version. CLEAN-EXEMPT: strict anchored pattern, written only by migrations';
alter table public.order_engine_versions enable row level security;
alter table public.order_engine_versions force row level security;
revoke all on public.order_engine_versions from public, anon, authenticated;
insert into public.order_engine_versions (version) values ('1.0.0');

-- ---------------------------------------------------------------------------------------------
-- order_policy_versions: what the owner decided about advances and cancellation (the advance AMOUNT is the quote's own)
-- ---------------------------------------------------------------------------------------------
create table public.order_policy_versions (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants (id) on delete restrict,
  version_no                 integer not null check (version_no >= 1),
  effective_from             date not null,
  advance_required           boolean not null,
  dispatch_requires_advance  boolean not null,
  cancel_allowed_until_state public.order_state not null
                             check (cancel_allowed_until_state in ('quote_approved', 'quote_sent', 'accepted', 'advance_requested', 'advance_paid', 'in_preparation')),
  allow_zero_value_orders    boolean not null,
  content_sha256             text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by                 uuid,
  created_via                public.record_origin not null default 'manual',
  created_at                 timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_no)
);
create index order_policy_versions_active_idx on public.order_policy_versions (tenant_id, effective_from desc, version_no desc);
create index order_policy_versions_keyset_idx on public.order_policy_versions (tenant_id, created_at, id);
comment on column public.order_policy_versions.content_sha256 is 'SAFE: sha256 of the normalised policy. CLEAN-EXEMPT: strict anchored hex pattern';

-- ---------------------------------------------------------------------------------------------
-- orders: one per approved quote. The figures are the quote's, copied by the database.
-- ---------------------------------------------------------------------------------------------
create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  order_no          integer not null check (order_no >= 1),
  quote_id          uuid not null,
  enquiry_id        uuid not null,
  requirement_id    uuid not null,
  lead_id           uuid not null,
  state             public.order_state not null default 'quote_approved',
  order_total_paise bigint not null check (order_total_paise between 0 and 1000000000),
  advance_paise     bigint not null check (advance_paise >= 0),
  valid_until       date not null,
  policy_version_id uuid not null,
  created_by        uuid,
  created_via       public.record_origin not null default 'manual',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, order_no),
  unique (tenant_id, quote_id),
  foreign key (tenant_id, quote_id)          references public.quotes (tenant_id, id),
  foreign key (tenant_id, enquiry_id)        references public.enquiries (tenant_id, id),
  foreign key (tenant_id, requirement_id)    references public.requirements (tenant_id, id),
  foreign key (tenant_id, lead_id)           references public.leads (tenant_id, id),
  foreign key (tenant_id, policy_version_id) references public.order_policy_versions (tenant_id, id),
  check (advance_paise <= order_total_paise),
  -- an order is closed exactly when its state is terminal
  check ((state in ('closed_paid', 'declined', 'expired', 'cancelled')) = (closed_at is not null))
);
create index orders_keyset_idx         on public.orders (tenant_id, created_at, id);
create index orders_lead_idx           on public.orders (tenant_id, lead_id);
create index orders_enquiry_idx        on public.orders (tenant_id, enquiry_id);
create index orders_requirement_idx    on public.orders (tenant_id, requirement_id);
create index orders_policy_version_idx on public.orders (tenant_id, policy_version_id);

-- ---------------------------------------------------------------------------------------------
-- order_events: the append-only ledger (the source of truth)
-- ---------------------------------------------------------------------------------------------
create table public.order_events (
  id                uuid primary key,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  order_id          uuid not null,
  seq               integer not null check (seq >= 1),
  type              public.order_event_type not null,
  prior_state       public.order_state,
  new_state         public.order_state not null,
  amount_paise      bigint check (amount_paise between 1 and 1000000000),
  ledger_id         uuid,
  occurred_at       timestamptz not null,
  reason_code       public.order_lost_reason,
  owner_approved_by uuid,
  recorded_by       uuid,
  recorded_at       timestamptz not null default now(),
  engine_version    text references public.order_engine_versions (version),
  request_text      text check (char_length(request_text) between 2 and 100000 and app.text_is_clean(request_text)),
  result_text       text check (char_length(result_text) between 2 and 200000 and app.text_is_clean(result_text)),
  canonical_hash    text check (canonical_hash ~ '^[0-9a-f]{64}$'),
  unique (tenant_id, id),
  unique (tenant_id, order_id, seq),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  -- `created` is the first event and the only one the lifecycle did not see; every other event carries the whole run
  check ((type = 'created') = (seq = 1)),
  check ((type = 'created') = (prior_state is null)),
  check ((type = 'created') = (engine_version is null and request_text is null and result_text is null and canonical_hash is null)),
  check ((type in ('record_payment', 'record_refund')) = (amount_paise is not null and ledger_id is not null)),
  check ((type in ('record_payment', 'record_refund')) or (amount_paise is null and ledger_id is null)),
  check ((type = 'customer_decline') = (reason_code is not null)),
  check (owner_approved_by is null or type in ('record_refund', 'dispatch'))
);
-- the lifecycle's own rule: a payment id and a refund id are each unique within their own namespace, per order
create unique index order_events_payment_id_key on public.order_events (order_id, ledger_id) where type = 'record_payment';
create unique index order_events_refund_id_key  on public.order_events (order_id, ledger_id) where type = 'record_refund';
create index order_events_recorded_idx on public.order_events (tenant_id, recorded_at, id);
create index order_events_engine_version_idx on public.order_events (engine_version);
comment on column public.order_events.engine_version is 'SAFE: a semantic version from the order_engine_versions allow-list. CLEAN-EXEMPT: a foreign key to the allow-list (a strict pattern there)';
comment on column public.order_events.request_text   is 'SAFE: the canonical lifecycle request (states, integer paise, UUID ledger ids, timestamps, policy flags); no personal data; text_is_clean-guarded; written only by record_order_event';
comment on column public.order_events.result_text    is 'SAFE: the lifecycle output with its rule trace (states, integers, closed codes); no personal data; text_is_clean-guarded; written only by record_order_event';
comment on column public.order_events.canonical_hash is 'SAFE: sha256 of the canonical request. CLEAN-EXEMPT: strict anchored hex pattern';

-- ---------------------------------------------------------------------------------------------
-- The state machine as DATA (one place; the decision function and the guard triggers read it). The package's structural matrix.
-- ---------------------------------------------------------------------------------------------
create function app.order_matrix() returns jsonb
language sql
immutable
set search_path = ''
as $$ select '{
  "quote_approved":    {"send_quote": "quote_sent", "expire": "expired", "cancel": "cancelled"},
  "quote_sent":        {"customer_accept": "accepted", "customer_decline": "declined", "expire": "expired", "cancel": "cancelled"},
  "accepted":          {"request_advance": "advance_requested", "record_payment": "accepted", "start_preparation": "in_preparation", "cancel": "cancelled", "record_refund": "accepted"},
  "advance_requested": {"record_payment": "advance_requested", "start_preparation": "in_preparation", "cancel": "cancelled", "record_refund": "advance_requested"},
  "advance_paid":      {"record_payment": "advance_paid", "start_preparation": "in_preparation", "cancel": "cancelled", "record_refund": "advance_paid"},
  "in_preparation":    {"record_payment": "in_preparation", "dispatch": "dispatched", "cancel": "cancelled", "record_refund": "in_preparation"},
  "dispatched":        {"record_payment": "dispatched", "deliver": "delivered", "record_refund": "dispatched"},
  "delivered":         {"record_payment": "delivered", "record_refund": "delivered"},
  "closed_paid": {}, "declined": {}, "expired": {}, "cancelled": {}
}'::jsonb $$;

-- may an order's STATE move from one state to another? The matrix targets, plus the three results the money rules add: the advance met (-> advance_paid), a refund below the
-- advance (advance_paid -> advance_requested) and a zero balance on delivery (-> closed_paid)
create function app.order_move_allowed(p_from text, p_to text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from is not null and p_to is not null and p_from <> p_to and (
       exists (select 1 from jsonb_each_text(app.order_matrix() -> p_from) m where m.value = p_to)
    or (p_from, p_to) in (('accepted', 'advance_paid'), ('advance_requested', 'advance_paid'), ('advance_paid', 'advance_requested'),
                          ('dispatched', 'closed_paid'), ('delivered', 'closed_paid')))
$$;

-- ---------------------------------------------------------------------------------------------
-- Guard triggers: tenant fixed, provenance server-owned, no deletes, no truncates, the cache equals the ledger
-- ---------------------------------------------------------------------------------------------
create function app.order_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted: record a new version or a new event', tg_table_name using errcode = '42501';
end;
$$;

create function app.order_forbid_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is never truncated', tg_table_name using errcode = '42501';
end;
$$;

-- an order is born approved-and-unclosed; its content never changes; its state moves only to the new state of its latest event
create function app.order_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state <> 'quote_approved' or new.closed_at is not null then
    raise exception 'an order starts as quote_approved' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function app.order_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  e public.order_events;
begin
  if (to_jsonb(new) - 'state' - 'closed_at' - 'updated_at') is distinct from (to_jsonb(old) - 'state' - 'closed_at' - 'updated_at') then
    raise exception 'orders rows are immutable: record an event' using errcode = '42501';
  end if;
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception 'an order is closed once' using errcode = '42501';
  end if;
  if new.state is distinct from old.state then
    if not app.order_move_allowed(old.state::text, new.state::text) then
      raise exception 'an order cannot move from % to %', old.state, new.state using errcode = '42501';
    end if;
    select * into e from public.order_events x where x.order_id = new.id order by x.seq desc limit 1;
    if not found or e.new_state is distinct from new.state or e.prior_state is distinct from old.state then
      raise exception 'an order moves only to the new state of its latest event' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- a ledger row is the next one (gapless seq), chains from the previous state, and only moves along the state machine
create function app.order_events_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p public.order_events;
begin
  select * into p from public.order_events x where x.order_id = new.order_id order by x.seq desc limit 1;
  if new.seq is distinct from coalesce(p.seq, 0) + 1 then
    raise exception 'the ledger is gapless: the next event is %', coalesce(p.seq, 0) + 1 using errcode = '42501';
  end if;
  if p.id is not null and (new.prior_state is distinct from p.new_state) then
    raise exception 'an event follows the state the ledger ended in' using errcode = '42501';
  end if;
  if new.type = 'created' then
    if new.new_state <> 'quote_approved' then
      raise exception 'an order starts as quote_approved' using errcode = '42501';
    end if;
  elsif new.new_state <> new.prior_state and not app.order_move_allowed(new.prior_state::text, new.new_state::text) then
    raise exception 'an order cannot move from % to %', new.prior_state, new.new_state using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.order_deny(), app.order_error(text), app.order_refuse(text), app.order_matrix(), app.order_move_allowed(text, text), app.order_forbid_delete(),
  app.order_forbid_truncate(), app.order_guard_insert(), app.order_guard_update(), app.order_events_guard_insert() from public;

create trigger order_policy_versions_forbid_tenant_id_change before update on public.order_policy_versions for each row execute function app.forbid_tenant_id_change();
create trigger order_policy_versions_set_created_meta        before insert or update on public.order_policy_versions for each row execute function app.set_created_meta();
create trigger order_policy_versions_guard_immutable         before update on public.order_policy_versions for each row execute function app.guard_immutable_record();
create trigger order_policy_versions_forbid_delete           before delete on public.order_policy_versions for each row execute function app.order_forbid_delete();
create trigger orders_forbid_tenant_id_change                before update on public.orders for each row execute function app.forbid_tenant_id_change();
create trigger orders_set_created_meta                       before insert or update on public.orders for each row execute function app.set_created_meta();
create trigger orders_set_updated_at                         before update on public.orders for each row execute function app.set_updated_at();
create trigger orders_guard_insert                           before insert on public.orders for each row execute function app.order_guard_insert();
create trigger orders_guard_update                           before update on public.orders for each row execute function app.order_guard_update();
create trigger orders_forbid_delete                          before delete on public.orders for each row execute function app.order_forbid_delete();
create trigger order_events_forbid_tenant_id_change          before update on public.order_events for each row execute function app.forbid_tenant_id_change();
create trigger order_events_guard_insert                     before insert on public.order_events for each row execute function app.order_events_guard_insert();
create trigger order_events_append_only                      before update or delete on public.order_events for each row execute function app.append_only();
do $$
declare t text;
begin
  foreach t in array array['order_policy_versions', 'orders', 'order_events'] loop
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$s for each statement execute function app.order_forbid_truncate()', t);
  end loop;
end $$;

create trigger audit_order_policy_versions after insert or update or delete on public.order_policy_versions for each row execute function app.audit_row_change('order_policy_version');
create trigger audit_orders                after insert or update or delete on public.orders                for each row execute function app.audit_row_change('order');
create trigger audit_order_events          after insert or update or delete on public.order_events          for each row execute function app.audit_row_change('order_event');

-- ---------------------------------------------------------------------------------------------
-- RLS: read = Owner / Admin / Sales (a Viewer reads no amount); nobody writes directly
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['order_policy_versions', 'orders', 'order_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- the ledger totals, from the events (security invoker: the caller's RLS applies, so a Viewer reads nothing)
create view public.order_ledger with (security_invoker = true) as
  select o.id as order_id, o.tenant_id, o.order_total_paise,
         coalesce(sum(e.amount_paise) filter (where e.type = 'record_payment'), 0)::bigint as paid_paise,
         coalesce(sum(e.amount_paise) filter (where e.type = 'record_refund'), 0)::bigint as refunded_paise,
         (coalesce(sum(e.amount_paise) filter (where e.type = 'record_payment'), 0) - coalesce(sum(e.amount_paise) filter (where e.type = 'record_refund'), 0))::bigint as net_paise,
         (o.order_total_paise - (coalesce(sum(e.amount_paise) filter (where e.type = 'record_payment'), 0) - coalesce(sum(e.amount_paise) filter (where e.type = 'record_refund'), 0)))::bigint as balance_paise,
         count(e.id)::integer as event_count,
         max(e.reason_code::text) filter (where e.type = 'customer_decline') as lost_reason
    from public.orders o
    left join public.order_events e on e.tenant_id = o.tenant_id and e.order_id = o.id
   group by o.id, o.tenant_id, o.order_total_paise;
revoke all on public.order_ledger from public, anon, authenticated;
grant select on public.order_ledger to authenticated;
comment on view public.order_ledger is 'Order conversion (ADR 0021): paid, refunded, net and balance in paise, the number of events and the lost reason, computed from order_events. security_invoker: the caller''s RLS applies. A ledger of claims, not a bank.';

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
-- "active at a date": the latest version effective on or before it (ties: the higher version number)
create function app.order_active_policy_version(p_tenant uuid, p_on date) returns uuid
language sql
stable
set search_path = ''
as $$
  select v.id from public.order_policy_versions v where v.tenant_id = p_tenant and v.effective_from <= p_on order by v.effective_from desc, v.version_no desc limit 1
$$;

-- a quote is valid through the last second of its valid_until day in India: the lifecycle's UTC timestamp text for it
create function app.order_valid_until_text(p_day date) returns text
language sql
immutable
set search_path = ''
as $$ select to_char((((p_day::timestamp + time '23:59:59') at time zone 'Asia/Kolkata') at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

create function app.order_request_hash(p_engine_version text, p_request_text text) returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to('{"engine_version":"' || p_engine_version || '","inputs":' || p_request_text || '}', 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------------------------------------
-- app.order_build: the database's OWN construction of the lifecycle request from its ledger and ONE event. Same value, key for key, as
-- services/ai-api/app/orders/builder.py (arrays in ledger order; owner_override derived, never supplied).
-- ---------------------------------------------------------------------------------------------
create function app.order_build(p_order uuid, p_type text, p_amount bigint, p_ledger uuid, p_as_of text, p_owner boolean) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  o       public.orders;
  pv      public.order_policy_versions;
  v_event jsonb;
begin
  select * into o from public.orders x where x.id = p_order;
  select * into pv from public.order_policy_versions x where x.tenant_id = o.tenant_id and x.id = o.policy_version_id;
  v_event := case p_type
    when 'record_payment' then jsonb_build_object('type', p_type, 'amount', p_amount, 'payment_id', p_ledger::text)
    when 'record_refund'  then jsonb_build_object('type', p_type, 'amount', p_amount, 'refund_id', p_ledger::text)
    else jsonb_build_object('type', p_type) end;
  return jsonb_build_object(
    'current_state', o.state::text,
    'event', v_event,
    'as_of', p_as_of,
    'valid_until', app.order_valid_until_text(o.valid_until),
    'order_total', o.order_total_paise,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('payment_id', e.ledger_id::text, 'amount', e.amount_paise) order by e.seq), '[]'::jsonb)
                   from public.order_events e where e.order_id = o.id and e.type = 'record_payment'),
    'refunds',  (select coalesce(jsonb_agg(jsonb_build_object('refund_id', e.ledger_id::text, 'amount', e.amount_paise) order by e.seq), '[]'::jsonb)
                   from public.order_events e where e.order_id = o.id and e.type = 'record_refund'),
    'policy', jsonb_build_object('advance_required', pv.advance_required, 'advance_amount', o.advance_paise, 'dispatch_requires_advance', pv.dispatch_requires_advance,
                                 'cancel_allowed_until_state', pv.cancel_allowed_until_state::text),
    'flags', jsonb_build_object('owner_override', coalesce(p_owner, false) and p_type = 'dispatch'));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- app.order_decide: the v1 subset of the pure lifecycle, recomputed over the REQUEST (the lifecycle's own input) in the lifecycle's own order of checks.
--   returns {status: ok, new_state, paid_total, balance_due, flags: [codes, sorted]} or {status: rejected, code}.
-- Not represented, because the database cannot hold them: a historical duplicate ledger id (unique indexes), a malformed timestamp (typed). Pinned equal to the real package by
-- tests/integration/test_order_equivalence.py (generated ledgers, every state x event).
-- ---------------------------------------------------------------------------------------------
create function app.order_decide(p_request jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cap      constant bigint := 1000000000;
  v_max      constant integer := 1000;
  v_pre      constant text[] := array['quote_approved', 'quote_sent', 'accepted', 'advance_requested', 'advance_paid', 'in_preparation'];
  v_state    text := p_request ->> 'current_state';
  v_ev       jsonb := p_request -> 'event';
  v_name     text := v_ev ->> 'type';
  v_pol      jsonb := p_request -> 'policy';
  v_total    bigint := (p_request ->> 'order_total')::bigint;
  v_adv      bigint := (v_pol ->> 'advance_amount')::bigint;
  v_adv_req  boolean := (v_pol ->> 'advance_required')::boolean;
  v_disp_req boolean := (v_pol ->> 'dispatch_requires_advance')::boolean;
  v_window   text := v_pol ->> 'cancel_allowed_until_state';
  v_override boolean := (p_request -> 'flags' ->> 'owner_override')::boolean;
  v_now      timestamptz := (p_request ->> 'as_of')::timestamptz;
  v_until    timestamptz := (p_request ->> 'valid_until')::timestamptz;
  v_np       integer;
  v_nr       integer;
  v_receipts bigint;
  v_returns  bigint;
  v_big      boolean;
  v_amount   bigint := (v_ev ->> 'amount')::bigint;
  v_id       text;
  v_net      bigint;
  v_paid     bigint;
  v_proposed bigint;
  v_new      text;
  v_reasons  text[] := '{}';
begin
  select count(*), coalesce(sum((x ->> 'amount')::bigint), 0), coalesce(bool_or((x ->> 'amount')::bigint > v_cap), false)
    into v_np, v_receipts, v_big from jsonb_array_elements(p_request -> 'payments') x;
  select count(*), coalesce(sum((x ->> 'amount')::bigint), 0) into v_nr, v_returns from jsonb_array_elements(p_request -> 'refunds') x;
  v_big := v_big or exists (select 1 from jsonb_array_elements(p_request -> 'refunds') x where (x ->> 'amount')::bigint > v_cap);

  -- the package's bounds, then its field checks, in its order
  if v_np > v_max or v_nr > v_max or v_big or v_total > v_cap or v_adv > v_cap or v_amount > v_cap then
    return jsonb_build_object('status', 'rejected', 'code', 'OUT_OF_RANGE');
  end if;
  if v_state is null or not (app.order_matrix() ? v_state) then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_STATE');
  end if;
  if v_name is null or v_name <> all (array['send_quote', 'customer_accept', 'customer_decline', 'expire', 'request_advance', 'record_payment', 'start_preparation',
                                            'dispatch', 'deliver', 'cancel', 'record_refund']) then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_EVENT');
  end if;
  if v_name in ('record_payment', 'record_refund') and (v_amount is null or v_amount < 1) then
    return jsonb_build_object('status', 'rejected', 'code', 'OUT_OF_RANGE');
  end if;
  if v_adv > v_total or ((v_adv_req or v_disp_req) and v_adv = 0) then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_ADVANCE');
  end if;
  if v_window is null or v_window <> all (v_pre) then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_CANCEL_WINDOW');
  end if;

  v_net := v_receipts - v_returns;
  if v_net < 0 then
    return jsonb_build_object('status', 'rejected', 'code', 'REFUND_EXCEEDS_PAID');
  end if;
  if v_net > v_total then
    return jsonb_build_object('status', 'rejected', 'code', 'OVERPAYMENT');
  end if;
  v_paid := v_net;
  if v_state = 'closed_paid' and v_total - v_paid <> 0 then
    return jsonb_build_object('status', 'rejected', 'code', 'CLOSED_UNPAID');
  end if;
  v_new := app.order_matrix() -> v_state ->> v_name;
  if v_new is null then
    return jsonb_build_object('status', 'rejected', 'code', 'ILLEGAL_TRANSITION');
  end if;
  -- the guards, in the package's order
  if v_name = 'expire' and v_now <= v_until then
    return jsonb_build_object('status', 'rejected', 'code', 'QUOTE_NOT_EXPIRED');
  end if;
  if v_name in ('send_quote', 'customer_accept') and v_now > v_until then
    return jsonb_build_object('status', 'rejected', 'code', 'QUOTE_EXPIRED');
  end if;
  if v_name = 'cancel' and array_position(v_pre, v_state) > array_position(v_pre, v_window) then
    return jsonb_build_object('status', 'rejected', 'code', 'CANCEL_WINDOW_CLOSED');
  end if;
  if v_name = 'start_preparation' and v_adv_req and v_paid < v_adv then
    return jsonb_build_object('status', 'rejected', 'code', 'ADVANCE_NOT_PAID');
  end if;
  if v_name = 'dispatch' and v_disp_req and v_paid < v_adv and not v_override then
    return jsonb_build_object('status', 'rejected', 'code', 'ADVANCE_NOT_PAID');
  end if;
  v_proposed := v_paid;
  if v_name = 'record_payment' then
    v_id := v_ev ->> 'payment_id';
    if exists (select 1 from jsonb_array_elements(p_request -> 'payments') x where x ->> 'payment_id' = v_id) then
      return jsonb_build_object('status', 'rejected', 'code', 'DUPLICATE_PAYMENT_ID');
    end if;
    if v_np >= v_max then
      return jsonb_build_object('status', 'rejected', 'code', 'OUT_OF_RANGE');
    end if;
    v_proposed := v_paid + v_amount;
    if v_proposed > v_total then
      return jsonb_build_object('status', 'rejected', 'code', 'OVERPAYMENT');
    end if;
  elsif v_name = 'record_refund' then
    v_id := v_ev ->> 'refund_id';
    if exists (select 1 from jsonb_array_elements(p_request -> 'refunds') x where x ->> 'refund_id' = v_id) then
      return jsonb_build_object('status', 'rejected', 'code', 'DUPLICATE_REFUND_ID');
    end if;
    if v_nr >= v_max then
      return jsonb_build_object('status', 'rejected', 'code', 'OUT_OF_RANGE');
    end if;
    if v_amount > v_paid then
      return jsonb_build_object('status', 'rejected', 'code', 'REFUND_EXCEEDS_PAID');
    end if;
    v_proposed := v_paid - v_amount;
    v_reasons := array_append(v_reasons, 'REFUND_REQUIRES_OWNER_APPROVAL'::text);
  end if;
  if v_name = 'dispatch' and v_disp_req and v_paid < v_adv then
    v_reasons := array_append(v_reasons, 'ADVANCE_OVERRIDE'::text);
  end if;
  if v_name = 'cancel' and v_paid > 0 then
    v_reasons := array_append(v_reasons, 'CANCELLATION_WITH_FUNDS'::text);
  end if;
  v_paid := v_proposed;
  if v_name = 'record_payment' and v_state in ('accepted', 'advance_requested') and v_adv_req and v_paid >= v_adv then
    v_new := 'advance_paid';
  end if;
  if v_name = 'record_refund' and v_state = 'advance_paid' and v_adv_req and v_paid < v_adv then
    v_new := 'advance_requested';
  end if;
  if v_new = 'delivered' and v_total - v_paid = 0 then
    v_new := 'closed_paid';
  end if;
  return jsonb_build_object('status', 'ok', 'new_state', v_new, 'paid_total', v_paid, 'balance_due', v_total - v_paid,
                            'flags', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(v_reasons) f));
end;
$$;

-- the codes of a lifecycle result's flags, as a sorted array (the same shape as the quote module's)
create function app.order_result_flags(p_result jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$ select coalesce(array_agg(distinct x ->> 'code' order by x ->> 'code'), '{}') from jsonb_array_elements(p_result -> 'flags' -> 'reasons') x $$;

-- the reason a lead's follow-ups are stopped by an order or a withdrawn quote, or NULL (read-only, no lock; T010 part 2 reads it under the lead's lock):
-- 'accepted' (an order past acceptance), 'declined', 'cancelled', 'withdrawn' (a withdrawn quote and no approved one since)
create function app.order_stops_followups(p_lead uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from public.orders o where o.lead_id = p_lead and o.state in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')) then 'accepted'
    when exists (select 1 from public.orders o where o.lead_id = p_lead and o.state = 'declined') then 'declined'
    when exists (select 1 from public.orders o where o.lead_id = p_lead and o.state = 'cancelled') then 'cancelled'
    when exists (select 1 from public.quotes q where q.lead_id = p_lead and q.withdrawn_at is not null)
         and not exists (select 1 from public.quotes q where q.lead_id = p_lead and q.status = 'approved') then 'withdrawn'
    else null end
$$;

revoke all on function app.order_active_policy_version(uuid, date), app.order_valid_until_text(date), app.order_request_hash(text, text),
  app.order_build(uuid, text, bigint, uuid, text, boolean), app.order_decide(jsonb), app.order_result_flags(jsonb), app.order_stops_followups(uuid) from public;

-- ---------------------------------------------------------------------------------------------
-- public.create_order_policy_version: Owner with a second factor (the role first, so a refusal before it is the same 42501 for everyone)
-- ---------------------------------------------------------------------------------------------
create function public.create_order_policy_version(p_version_id uuid, p_tenant_id uuid, p_effective_from date, p_policy jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adv   boolean;
  v_disp  boolean;
  v_zero  boolean;
  v_win   text;
  v_norm  jsonb;
  v_hash  text;
  v_latest date;
  v_no    integer;
  v_exist public.order_policy_versions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.order_deny();
  end if;
  perform app.require_aal2();
  if p_version_id is null or p_policy is null or jsonb_typeof(p_policy) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_policy) k where k <> all (array['advance_required', 'dispatch_requires_advance', 'cancel_allowed_until_state', 'allow_zero_value_orders']))
     or not (p_policy ?& array['advance_required', 'dispatch_requires_advance', 'cancel_allowed_until_state', 'allow_zero_value_orders'])
     or jsonb_typeof(p_policy -> 'advance_required') <> 'boolean' or jsonb_typeof(p_policy -> 'dispatch_requires_advance') <> 'boolean'
     or jsonb_typeof(p_policy -> 'allow_zero_value_orders') <> 'boolean' or jsonb_typeof(p_policy -> 'cancel_allowed_until_state') <> 'string' then
    perform app.order_error('invalid');
  end if;
  v_adv  := (p_policy ->> 'advance_required')::boolean;
  v_disp := (p_policy ->> 'dispatch_requires_advance')::boolean;
  v_zero := (p_policy ->> 'allow_zero_value_orders')::boolean;
  v_win  := p_policy ->> 'cancel_allowed_until_state';
  if v_win <> all (array['quote_approved', 'quote_sent', 'accepted', 'advance_requested', 'advance_paid', 'in_preparation']) then
    perform app.order_error('value');
  end if;
  v_norm := jsonb_build_object('advance_required', v_adv, 'dispatch_requires_advance', v_disp, 'cancel_allowed_until_state', v_win, 'allow_zero_value_orders', v_zero);
  v_hash := app.quote_content_hash(v_norm);

  perform pg_advisory_xact_lock(hashtextextended('order_ref:policy:' || p_tenant_id::text, 0));
  select * into v_exist from public.order_policy_versions v where v.id = p_version_id;
  if found then
    if v_exist.tenant_id = p_tenant_id and v_exist.content_sha256 = v_hash and v_exist.effective_from = p_effective_from then
      return jsonb_build_object('version_id', v_exist.id, 'version_no', v_exist.version_no, 'effective_from', v_exist.effective_from,
                                'content_sha256', v_exist.content_sha256, 'replayed', true);
    end if;
    perform app.order_error('conflict');
  end if;
  select max(v.effective_from), coalesce(max(v.version_no), 0) + 1 into v_latest, v_no from public.order_policy_versions v where v.tenant_id = p_tenant_id;
  if p_effective_from is null then
    perform app.order_error('invalid');
  end if;
  if p_effective_from < app.quote_today() or p_effective_from < coalesce(v_latest, p_effective_from) then
    perform app.order_error('value');
  end if;
  insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state,
                                            allow_zero_value_orders, content_sha256)
  values (p_version_id, p_tenant_id, v_no, p_effective_from, v_adv, v_disp, v_win::public.order_state, v_zero, v_hash);
  return jsonb_build_object('version_id', p_version_id, 'version_no', v_no, 'effective_from', p_effective_from, 'content_sha256', v_hash, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.create_order_from_quote: Owner / Admin with a second factor. The figures are the approved quote's, copied here under the quote's lock.
-- ---------------------------------------------------------------------------------------------
create function public.create_order_from_quote(p_order_id uuid, p_quote_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  z       public.quotes;
  v_exist public.orders;
  v_pol   public.order_policy_versions;
  v_pver  uuid;
  v_no    integer;
begin
  if v_uid is null or p_order_id is null or p_quote_id is null then
    perform app.order_deny();
  end if;
  select * into z from public.quotes x where x.id = p_quote_id;
  if not found or not app.has_tenant_role(z.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.order_deny();
  end if;
  perform app.require_aal2();
  -- lock order: the enquiry row, the requirement row, the quote row (the same as approve_quote and withdraw_approved_quote)
  perform 1 from public.enquiries e where e.tenant_id = z.tenant_id and e.id = z.enquiry_id for update;
  perform 1 from public.requirements x where x.tenant_id = z.tenant_id and x.id = z.requirement_id for update;
  select * into z from public.quotes x where x.id = p_quote_id for update;

  -- an exact retry replays; another quote under a used id is the constant conflict
  select * into v_exist from public.orders o where o.id = p_order_id;
  if found then
    if v_exist.tenant_id = z.tenant_id and v_exist.quote_id = z.id then
      return jsonb_build_object('order_id', v_exist.id, 'order_no', v_exist.order_no, 'state', v_exist.state, 'replayed', true);
    end if;
    perform app.order_error('conflict');
  end if;
  if exists (select 1 from public.orders o where o.tenant_id = z.tenant_id and o.quote_id = z.id) then
    perform app.order_error('SM231');
  end if;
  if z.status <> 'approved' then
    perform app.order_error('SM230');
  end if;
  if app.quote_today() > z.valid_until then
    perform app.order_error('SM236');
  end if;
  v_pver := app.order_active_policy_version(z.tenant_id, app.quote_today());
  if v_pver is null then
    perform app.order_error('SM239');
  end if;
  select * into v_pol from public.order_policy_versions p where p.id = v_pver;
  -- the figures must satisfy the policy and the lifecycle's own limits, or no event could ever run
  if z.total_paise > 1000000000 or (z.total_paise = 0 and not v_pol.allow_zero_value_orders)
     or ((v_pol.advance_required or v_pol.dispatch_requires_advance) and z.advance_paise = 0) then
    perform app.order_error('SM233');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order_no:' || z.tenant_id::text, 0));
  select coalesce(max(o.order_no), 0) + 1 into v_no from public.orders o where o.tenant_id = z.tenant_id;
  insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, state, order_total_paise, advance_paise, valid_until, policy_version_id)
  values (p_order_id, z.tenant_id, v_no, z.id, z.enquiry_id, z.requirement_id, z.lead_id, 'quote_approved', z.total_paise, z.advance_paise, z.valid_until, v_pver);
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at, recorded_by)
  values (gen_random_uuid(), z.tenant_id, p_order_id, 1, 'created', null, 'quote_approved', now(), v_uid);
  return jsonb_build_object('order_id', p_order_id, 'order_no', v_no, 'state', 'quote_approved', 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.record_order_event: a PERSON reports one event. Role per event type, then the second factor where the event is money, a cancellation or a refund; the order row is
-- locked; an exact retry replays; the request is the one the database builds; the decision is the one the database computes.
-- ---------------------------------------------------------------------------------------------
create function public.record_order_event(
  p_event_id uuid, p_order_id uuid, p_type text, p_occurred_at timestamptz, p_amount_paise bigint, p_ledger_id uuid, p_reason_code text,
  p_engine_version text, p_request_text text, p_result_text text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  o         public.orders;
  v_exist   public.order_events;
  v_owner   boolean;
  v_req     jsonb;
  v_res     jsonb;
  v_dec     jsonb;
  v_built   jsonb;
  v_hash    text;
  v_as_of   text;
  v_as_ts   timestamptz;
  v_money   boolean := p_type in ('record_payment', 'record_refund');
  v_flags   text[];
  v_new     public.order_state;
  v_seq     integer;
  v_approver uuid;
begin
  if v_uid is null or p_event_id is null or p_order_id is null then
    perform app.order_deny();
  end if;
  select * into o from public.orders x where x.id = p_order_id;
  if not found or not app.has_tenant_role(o.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.order_deny();
  end if;
  if p_type is null or p_type <> all (array['send_quote', 'customer_accept', 'customer_decline', 'expire', 'request_advance', 'record_payment', 'start_preparation',
                                            'dispatch', 'deliver', 'cancel', 'record_refund']) then
    perform app.order_error('invalid');
  end if;
  -- money, a cancellation and a refund are the Owner's and the Admin's (a Sales user is refused as a stranger is), and need the second factor
  if p_type in ('record_payment', 'cancel', 'record_refund') then
    if not app.has_tenant_role(o.tenant_id, array['owner', 'admin']::public.app_role[]) then
      perform app.order_deny();
    end if;
    perform app.require_aal2();
  end if;
  v_owner := app.has_tenant_role(o.tenant_id, array['owner']::public.app_role[]);
  if p_type = 'record_refund' and not v_owner then
    perform app.order_error('SM234');
  end if;
  -- the shape of the person's inputs
  if p_occurred_at is null or p_engine_version is null or p_request_text is null or p_result_text is null
     or (v_money and (p_amount_paise is null or p_ledger_id is null)) or (not v_money and (p_amount_paise is not null or p_ledger_id is not null))
     or (p_type = 'customer_decline') is distinct from (p_reason_code is not null)
     or (p_reason_code is not null and p_reason_code <> all (array['price', 'timing', 'bought_elsewhere', 'no_response', 'requirement_changed', 'product_unavailable', 'credit_terms', 'other']))
     or char_length(p_request_text) > 100000 or char_length(p_result_text) > 200000 or not app.text_is_clean(p_request_text) or not app.text_is_clean(p_result_text) then
    perform app.order_error('invalid');
  end if;
  if p_occurred_at > now() + interval '5 minutes' or p_occurred_at < now() - interval '30 days' then
    perform app.order_error('value');
  end if;
  -- lock order: the order row alone (this function reads no quote)
  select * into o from public.orders x where x.id = p_order_id for update;

  -- an exact retry replays; anything else under a used id is the constant conflict
  select * into v_exist from public.order_events e where e.id = p_event_id;
  if found then
    if v_exist.order_id = o.id and v_exist.type::text = p_type and v_exist.amount_paise is not distinct from p_amount_paise and v_exist.ledger_id is not distinct from p_ledger_id
       and v_exist.occurred_at = p_occurred_at and v_exist.reason_code::text is not distinct from p_reason_code then
      return jsonb_build_object('event_id', v_exist.id, 'order_id', o.id, 'seq', v_exist.seq, 'state', o.state, 'prior_state', v_exist.prior_state, 'replayed', true);
    end if;
    perform app.order_error('conflict');
  end if;

  if o.state in ('closed_paid', 'declined', 'expired', 'cancelled') then
    perform app.order_error('SM235');
  end if;
  if not exists (select 1 from public.order_engine_versions v where v.version = p_engine_version) then
    perform app.order_error('value');
  end if;
  begin
    v_req := p_request_text::jsonb;
    v_res := p_result_text::jsonb;
  exception when others then
    perform app.order_error('invalid');
  end;
  if jsonb_typeof(v_req) <> 'object' or jsonb_typeof(v_res) <> 'object' then
    perform app.order_error('invalid');
  end if;

  -- 1. the request is the one the database builds from its own ledger (owner_override derived from the role), as of the database's own clock
  v_as_of := v_req ->> 'as_of';
  if v_as_of is null or v_as_of !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' then
    perform app.order_error('SM238');
  end if;
  begin
    v_as_ts := v_as_of::timestamptz;
  exception when others then
    perform app.order_error('SM238');
  end;
  if v_as_ts < now() - interval '10 minutes' or v_as_ts > now() + interval '2 minutes' then
    perform app.order_error('SM238');
  end if;
  v_built := app.order_build(o.id, p_type, p_amount_paise, p_ledger_id, v_as_of, v_owner);
  if v_req is distinct from v_built then
    perform app.order_error('SM238');
  end if;
  v_hash := app.order_request_hash(p_engine_version, p_request_text);

  -- 2. the decision is the database's own; a refusal carries the lifecycle's closed code
  v_dec := app.order_decide(v_req);
  if v_dec ->> 'status' <> 'ok' then
    perform app.order_refuse(v_dec ->> 'code');
  end if;
  -- an override that is actually used needs the second factor (the role alone decided that it may be used: owner_override is derived)
  v_flags := array(select jsonb_array_elements_text(v_dec -> 'flags'));
  if 'ADVANCE_OVERRIDE' = any (v_flags) then
    perform app.require_aal2();
  end if;
  -- 3. the lifecycle's result is exactly that decision
  if v_res ->> 'status' is distinct from 'ok' or v_res ->> 'engine_version' is distinct from p_engine_version or v_res ->> 'canonical_hash' is distinct from v_hash
     or v_res ->> 'new_state' is distinct from v_dec ->> 'new_state' or (v_res -> 'paid_total') is distinct from (v_dec -> 'paid_total')
     or (v_res -> 'balance_due') is distinct from (v_dec -> 'balance_due') or app.order_result_flags(v_res) is distinct from v_flags
     or (v_res -> 'flags' -> 'needs_owner_approval') is distinct from to_jsonb(cardinality(v_flags) > 0) then
    perform app.order_error('SM238');
  end if;

  v_new := (v_dec ->> 'new_state')::public.order_state;
  v_approver := case when 'REFUND_REQUIRES_OWNER_APPROVAL' = any (v_flags) or 'ADVANCE_OVERRIDE' = any (v_flags) then v_uid end;
  select coalesce(max(e.seq), 0) + 1 into v_seq from public.order_events e where e.order_id = o.id;
  insert into public.order_events
    (id, tenant_id, order_id, seq, type, prior_state, new_state, amount_paise, ledger_id, occurred_at, reason_code, owner_approved_by, recorded_by,
     engine_version, request_text, result_text, canonical_hash)
  values
    (p_event_id, o.tenant_id, o.id, v_seq, p_type::public.order_event_type, o.state, v_new, p_amount_paise, p_ledger_id, p_occurred_at, p_reason_code::public.order_lost_reason,
     v_approver, v_uid, p_engine_version, p_request_text, p_result_text, v_hash);
  update public.orders x set state = v_new,
         closed_at = case when v_new in ('closed_paid', 'declined', 'expired', 'cancelled') then now() else null end
   where x.id = o.id;
  return jsonb_build_object('event_id', p_event_id, 'order_id', o.id, 'seq', v_seq, 'state', v_new, 'prior_state', o.state, 'replayed', false);
end;
$$;

revoke all on function public.create_order_policy_version(uuid, uuid, date, jsonb) from public, anon;
revoke all on function public.create_order_from_quote(uuid, uuid) from public, anon;
revoke all on function public.record_order_event(uuid, uuid, text, timestamptz, bigint, uuid, text, text, text, text) from public, anon;
grant execute on function public.create_order_policy_version(uuid, uuid, date, jsonb) to authenticated;
grant execute on function public.create_order_from_quote(uuid, uuid) to authenticated;
grant execute on function public.record_order_event(uuid, uuid, text, timestamptz, bigint, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- REPLACED: public.approve_quote and public.withdraw_approved_quote (the latest definitions plus the SM237 lines; tests/test_migration_copies.py pins the rest).
-- A new quote cannot replace an approved quote that has an order, and an approved quote that has an order cannot be withdrawn.
-- ---------------------------------------------------------------------------------------------
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

  -- ADR 0021: an older approved quote that has an order is never silently replaced (the order and the quote it records would disagree)
  if exists (select 1 from public.quotes x join public.orders o on o.tenant_id = x.tenant_id and o.quote_id = x.id
              where x.tenant_id = z.tenant_id and x.requirement_id = z.requirement_id and x.status = 'approved' and x.id <> z.id) then
    perform app.order_error('SM237');
  end if;
  update public.quotes x set status = 'superseded' where x.tenant_id = z.tenant_id and x.requirement_id = z.requirement_id and x.status = 'approved' and x.id <> z.id;
  update public.quotes x set status = 'approved', approved_by = v_uid, approved_at = now(), approved_hash = p_recomputed_hash where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'approved', 'approved_by', v_uid, 'replayed', false);
end;
$$;

create or replace function public.withdraw_approved_quote(p_quote_id uuid, p_code text) returns jsonb
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
  -- ADR 0021: once an order exists for this quote the withdrawal is refused (the order row is read under the quote's lock: an order is only ever inserted under it)
  if exists (select 1 from public.orders o where o.tenant_id = z.tenant_id and o.quote_id = z.id) then
    perform app.order_error('SM237');
  end if;
  update public.quotes x set status = 'superseded', withdrawn_by = v_uid, withdrawn_at = now(), withdraw_code = p_code::public.quote_withdraw_code where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'superseded', 'withdrawn', true, 'replayed', false);
end;
$$;

revoke all on function public.approve_quote(uuid, text) from public, anon;
revoke all on function public.withdraw_approved_quote(uuid, text) from public, anon;
grant execute on function public.approve_quote(uuid, text) to authenticated;
grant execute on function public.withdraw_approved_quote(uuid, text) to authenticated;
