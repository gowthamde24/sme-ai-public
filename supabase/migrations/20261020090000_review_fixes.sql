-- Review fixes (owner review of T010 part 1 and the order conversion database, 2026-10-07). ONE migration, create or replace of the LATEST definitions plus the lines named
-- here (tests/test_migration_copies.py pins every copy). The earlier migrations are untouched.
--   1. app.contacts_sync_suppression_keys   lifting a contact lifts a shared key only when no OTHER non-erased contact still holds it while suppressed
--   2. public.record_order_event, app.order_error   a cancellation that carries money is the Owner's (SM234, reworded 'this action needs the owner'); owner_approved_by is set
--      for it, and the order_events check allows it on a `cancel`
--   3. public.approve_quote, public.withdraw_approved_quote   SM237 only while the quote's order is NOT declined, expired or cancelled; app.order_stops_followups: the lead's
--      LATEST order decides, unless the lead has a newer approved quote with no order yet
--   4. app.operator_seed_order_policy   a synthetic order policy for a LOCAL workspace (callable by no application role)

-- ---------------------------------------------------------------------------------------------
-- 1. shared keys
-- ---------------------------------------------------------------------------------------------
create or replace function app.contacts_sync_suppression_keys() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k suppression.contact_keys;
begin
  select * into k from suppression.contact_keys where tenant_id = new.tenant_id and contact_id = new.id;
  if not found then
    return new;
  end if;
  if new.suppressed_at is not null then
    if k.email_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'email', k.email_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
    if k.phone_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
  else
    if k.email_hmac is not null then
      -- review fix (steps 1): a key is lifted only when no OTHER non-erased contact of the tenant still holds it while suppressed. The per-key lock (the one
      -- suppression_key_lift takes) comes first, so two contacts lifted at once see each other's committed lift and the last one lifts the key.
      perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || new.tenant_id::text || ':email:' || k.email_hmac, 0));
      if not exists (select 1 from suppression.contact_keys k2 join public.contacts c2 on c2.tenant_id = k2.tenant_id and c2.id = k2.contact_id
                      where k2.tenant_id = new.tenant_id and k2.contact_id <> new.id and k2.email_hmac = k.email_hmac and c2.erased_at is null and c2.suppressed_at is not null)
         -- ... and a key whose current suppression came from an ERASURE stays suppressed (a person erased by right is never re-contacted through a shared number)
         and not exists (select 1 from (select e.event, e.reason from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'email' and e.key_hmac = k.email_hmac
                                         order by e.seq desc limit 1) l where l.event = 'suppressed' and l.reason = 'erased') then
        perform app.suppression_key_lift(new.tenant_id, 'email', k.email_hmac, k.key_version, new.id, auth.uid());
      end if;
    end if;
    if k.phone_hmac is not null then
      -- review fix (steps 1): a key is lifted only when no OTHER non-erased contact of the tenant still holds it while suppressed. The per-key lock (the one
      -- suppression_key_lift takes) comes first, so two contacts lifted at once see each other's committed lift and the last one lifts the key.
      perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || new.tenant_id::text || ':phone:' || k.phone_hmac, 0));
      if not exists (select 1 from suppression.contact_keys k2 join public.contacts c2 on c2.tenant_id = k2.tenant_id and c2.id = k2.contact_id
                      where k2.tenant_id = new.tenant_id and k2.contact_id <> new.id and k2.phone_hmac = k.phone_hmac and c2.erased_at is null and c2.suppressed_at is not null)
         -- ... and a key whose current suppression came from an ERASURE stays suppressed (a person erased by right is never re-contacted through a shared number)
         and not exists (select 1 from (select e.event, e.reason from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'phone' and e.key_hmac = k.phone_hmac
                                         order by e.seq desc limit 1) l where l.event = 'suppressed' and l.reason = 'erased') then
        perform app.suppression_key_lift(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.id, auth.uid());
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. cancel with funds is the Owner's
-- ---------------------------------------------------------------------------------------------
create or replace function app.order_error(p_code text) returns void
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
      when 'SM234' then 'this action needs the owner'
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

create or replace function public.record_order_event(
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
  -- review fix (step 2): a cancellation that carries money is the Owner's (an Admin may cancel an order with no money in it)
  if 'CANCELLATION_WITH_FUNDS' = any (v_flags) and not v_owner then
    perform app.order_error('SM234');
  end if;
  -- 3. the lifecycle's result is exactly that decision
  if v_res ->> 'status' is distinct from 'ok' or v_res ->> 'engine_version' is distinct from p_engine_version or v_res ->> 'canonical_hash' is distinct from v_hash
     or v_res ->> 'new_state' is distinct from v_dec ->> 'new_state' or (v_res -> 'paid_total') is distinct from (v_dec -> 'paid_total')
     or (v_res -> 'balance_due') is distinct from (v_dec -> 'balance_due') or app.order_result_flags(v_res) is distinct from v_flags
     or (v_res -> 'flags' -> 'needs_owner_approval') is distinct from to_jsonb(cardinality(v_flags) > 0) then
    perform app.order_error('SM238');
  end if;

  v_new := (v_dec ->> 'new_state')::public.order_state;
  v_approver := case when 'REFUND_REQUIRES_OWNER_APPROVAL' = any (v_flags) or 'ADVANCE_OVERRIDE' = any (v_flags) or 'CANCELLATION_WITH_FUNDS' = any (v_flags) then v_uid end;
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

alter table public.order_events drop constraint order_events_check6;
alter table public.order_events add constraint order_events_check6
  check (owner_approved_by is null or type in ('record_refund', 'dispatch', 'cancel'));

-- ---------------------------------------------------------------------------------------------
-- 3. terminal orders do not block a new quote; the lead's latest order decides
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
  if exists (select 1 from public.quotes x join public.orders o on o.tenant_id = x.tenant_id and o.quote_id = x.id and o.state not in ('declined', 'expired', 'cancelled')
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
  if exists (select 1 from public.orders o where o.tenant_id = z.tenant_id and o.quote_id = z.id and o.state not in ('declined', 'expired', 'cancelled')) then
    perform app.order_error('SM237');
  end if;
  update public.quotes x set status = 'superseded', withdrawn_by = v_uid, withdrawn_at = now(), withdraw_code = p_code::public.quote_withdraw_code where x.id = z.id;
  return jsonb_build_object('quote_id', z.id, 'status', 'superseded', 'withdrawn', true, 'replayed', false);
end;
$$;

create or replace function app.order_stops_followups(p_lead uuid) returns text
language sql
stable
set search_path = ''
as $$
  with latest as (
    select o.state, z.quote_no from public.orders o join public.quotes z on z.tenant_id = o.tenant_id and z.id = o.quote_id
     where o.lead_id = p_lead order by o.order_no desc, o.id desc limit 1),
  newer as (
    -- a newer approved quote of the lead that has no order yet: a new deal is being made, nothing stops
    select 1 from latest l join public.quotes q on q.lead_id = p_lead and q.status = 'approved' and q.quote_no > l.quote_no
     where not exists (select 1 from public.orders o2 where o2.tenant_id = q.tenant_id and o2.quote_id = q.id))
  select case
    when exists (select 1 from newer) then null
    when (select state from latest) in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid') then 'accepted'
    when (select state from latest) = 'declined' then 'declined'
    when (select state from latest) = 'cancelled' then 'cancelled'
    when exists (select 1 from public.quotes q where q.lead_id = p_lead and q.withdrawn_at is not null)
         and not exists (select 1 from public.quotes q where q.lead_id = p_lead and q.status = 'approved') then 'withdrawn'
    else null end
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. app.operator_seed_order_policy: SYNTHETIC, for a LOCAL workspace. Creates the policy only when the workspace has none (a second run changes nothing). Callable by no
-- application role. The values are invented defaults (advance required for preparation and dispatch, cancellation until preparation, no zero-value orders): the real ones are
-- the owner's (docs/pre-pilot-checklist.md, "Orders"). The content hash is the one create_order_policy_version would compute, so a later replay of the same policy is recognised.
-- ---------------------------------------------------------------------------------------------
create function app.operator_seed_order_policy(p_tenant_slug text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id     uuid := gen_random_uuid();
begin
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.order_policy_versions v where v.tenant_id = v_tenant) then
    return jsonb_build_object('order_policy_version', null, 'created', false);
  end if;
  insert into public.order_policy_versions (id, tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256)
  values (v_id, v_tenant, 1, app.quote_today(), true, true, 'in_preparation', false,
          app.quote_content_hash(jsonb_build_object('advance_required', true, 'dispatch_requires_advance', true, 'cancel_allowed_until_state', 'in_preparation', 'allow_zero_value_orders', false)));
  return jsonb_build_object('order_policy_version', v_id, 'created', true);
end;
$$;
revoke all on function app.operator_seed_order_policy(text) from public, anon, authenticated, service_role;
