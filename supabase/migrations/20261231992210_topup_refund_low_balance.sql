-- RAZORPAY TOP-UP, part 2 (docs/contracts/credits-topup.md): the refund of a top-up and the low-balance item on Today.
--
-- REFUND (Stack19 staff, owner and finance only, never the shop): a paid top-up is refunded for the part of it that is still UNUSED. In two steps, so the money never moves twice and the wallet is never wrong:
--   1. public.admin_topup_refund_begin   checks the staff member (second factor, a fresh code, a reason in words), takes the unused credits OUT of the wallet at once (nobody can spend what is being refunded),
--                                        records a `pending` refund and answers what to send to the payment provider (the unused credits plus their share of the GST)
--   2. the API asks Razorpay for the refund, then public.admin_topup_refund_finish records the provider's refund id and issues the credit note (a `done` refund), or, when the provider refused,
--      gives the credits back (`failed`: nothing was refunded, the order can be tried again)
-- One live refund per order; the idempotency key makes a retry of step 1 harmless; step 2 is safe to repeat. Everything is audited (the staff audit and the workspace's audit trail).
-- Codes: SM936 nothing unused to refund, SM937 this order already has a refund, SM938 not a paid top-up of that workspace.
--
-- LOW BALANCE: Today's "Needs you" shows `credits_low` to the Owner and Admin when the workspace has had credits, no included call minutes are left in the period and the balance covers fewer than
-- pricing.settings.low_balance_minutes (4) minutes of calls at the plan's rate. It goes by itself when the balance is topped up.

create function public.admin_topup_refund_begin(p_tenant_id uuid, p_order_id text, p_reason_code text, p_reason_text text, p_key text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := btrim(coalesce(p_reason_text, ''));
  o       pricing.orders;
  l       pricing.wallet_lots;
  r       pricing.refunds;
  v_total bigint;
  v_new   uuid;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_tenant_id is null or p_order_id is null or p_order_id !~ '^[A-Za-z0-9_.:-]{3,100}$'
     or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other')
     or p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  perform admin.second_confirm();
  -- a retry of the same key answers the same refund
  select * into r from pricing.refunds x where x.idem_key = p_key;
  if found then
    if r.tenant_id <> p_tenant_id or r.order_id <> p_order_id then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    return jsonb_build_object('refund_id', r.id, 'status', r.status, 'payment_ref', r.payment_ref, 'refund_paise', r.refund_paise, 'credits_reversed_paise', r.credits_reversed_paise,
                              'gst_refund_paise', r.gst_refund_paise, 'replayed', true);
  end if;
  select * into o from pricing.orders x where x.order_id = p_order_id and x.tenant_id = p_tenant_id and x.purpose = 'topup' and x.status = 'paid' for update;
  if not found then
    raise exception 'not a paid top-up of this workspace' using errcode = 'SM938';
  end if;
  if exists (select 1 from pricing.refunds x where x.order_id = o.order_id and x.status in ('pending', 'done')) then
    raise exception 'already refunded' using errcode = 'SM937';
  end if;
  select * into l from pricing.wallet_lots x where x.tenant_id = o.tenant_id and x.source = 'topup' and x.ref = o.payment_ref for update;
  if not found or l.remaining_paise <= 0 then
    raise exception 'nothing unused to refund' using errcode = 'SM936';
  end if;
  -- the unused credits plus their share of the GST, to the paisa (half up); unused = everything gives exactly what was paid
  v_total := (o.total_paise * l.remaining_paise + l.amount_paise / 2) / l.amount_paise;
  update pricing.wallet_lots set remaining_paise = 0 where id = l.id;
  insert into pricing.refunds (tenant_id, order_id, payment_ref, status, refund_paise, credits_reversed_paise, gst_refund_paise, reason_code, reason_text, staff_id, idem_key)
  values (o.tenant_id, o.order_id, o.payment_ref, 'pending', v_total, l.remaining_paise, v_total - l.remaining_paise, p_reason_code, v_text, v_staff.user_id, p_key)
  returning id into v_new;
  perform admin.log(v_staff.user_id, 'refund', o.tenant_id, null, p_reason_code, v_text, 'invoice', v_new::text, false);
  perform app.write_audit_event(o.tenant_id, 'billing.topup_refund_started', 'workspace', o.tenant_id, null, jsonb_build_object('credits_reversed_paise', l.remaining_paise, 'refund_paise', v_total));
  return jsonb_build_object('refund_id', v_new, 'status', 'pending', 'payment_ref', o.payment_ref, 'refund_paise', v_total, 'credits_reversed_paise', l.remaining_paise,
                            'gst_refund_paise', v_total - l.remaining_paise, 'replayed', false);
end $$;
revoke all on function public.admin_topup_refund_begin(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_topup_refund_begin(uuid, text, text, text, text) to authenticated;

create function public.admin_topup_refund_finish(p_refund_id uuid, p_ok boolean, p_provider_ref text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  r       pricing.refunds;
  v_inv   jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_refund_id is null or p_ok is null or (p_ok and (p_provider_ref is null or p_provider_ref !~ '^[A-Za-z0-9_.:-]{3,100}$')) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into r from pricing.refunds x where x.id = p_refund_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('refund_id', r.id, 'status', r.status, 'credit_note_number', r.credit_note_number, 'replayed', true);
  end if;
  if p_ok then
    v_inv := pricing.invoice(r.tenant_id, 'credit_note', r.id::text, r.credits_reversed_paise, r.gst_refund_paise,
                             (select i.number from pricing.invoices i where i.tenant_id = r.tenant_id and i.kind = 'topup' and i.ref = r.payment_ref));
    update pricing.refunds set status = 'done', provider_ref = p_provider_ref, credit_note_number = v_inv ->> 'number', finished_at = now() where id = r.id;
    perform app.write_audit_event(r.tenant_id, 'billing.topup_refunded', 'workspace', r.tenant_id, null, jsonb_build_object('refund_paise', r.refund_paise));
    return jsonb_build_object('refund_id', r.id, 'status', 'done', 'credit_note_number', v_inv ->> 'number', 'replayed', false);
  end if;
  -- the provider refused: nothing went back to the customer, so the credits go back to the wallet
  update pricing.wallet_lots set remaining_paise = least(amount_paise, remaining_paise + r.credits_reversed_paise)
   where tenant_id = r.tenant_id and source = 'topup' and ref = r.payment_ref;
  update pricing.refunds set status = 'failed', finished_at = now() where id = r.id;
  perform app.write_audit_event(r.tenant_id, 'billing.topup_refund_failed', 'workspace', r.tenant_id, null, jsonb_build_object('refund_paise', r.refund_paise));
  return jsonb_build_object('refund_id', r.id, 'status', 'failed', 'credit_note_number', null, 'replayed', false);
end $$;
revoke all on function public.admin_topup_refund_finish(uuid, boolean, text) from public, anon;
grant execute on function public.admin_topup_refund_finish(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ low balance
-- true when no included call minutes are left in the period and the balance covers fewer than `low_balance_minutes` minutes at the plan's rate
create function pricing.is_low(p_tenant uuid) returns boolean language plpgsql stable set search_path = '' as
$$
declare
  v_plan pricing.plans;
  v_sub  pricing.subscriptions;
  v_used integer;
begin
  v_plan := pricing.plan_of(p_tenant);
  if v_plan.rate_paise_per_minute <= 0 then
    return false;
  end if;
  select * into v_sub from pricing.subscriptions s where s.tenant_id = p_tenant and s.status <> 'cancelled';
  select coalesce(sum(u.included_half), 0) into v_used from pricing.usage u where u.tenant_id = p_tenant and u.kind = 'call' and u.at >= coalesce(v_sub.period_start, date_trunc('month', now()));
  if v_plan.included_minutes * 2 - v_used > 0 then
    return false;
  end if;
  return pricing.balance_of(p_tenant) < (select s.low_balance_minutes from pricing.settings s)::bigint * v_plan.rate_paise_per_minute;
end $$;
revoke all on function pricing.is_low(uuid) from public, anon, authenticated, service_role;

create function app.today_credits_low(p_tenant uuid) returns table (id uuid, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('credits_low:' || p_tenant::text)::uuid, app.outbox_now()
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and exists (select 1 from pricing.wallet_lots l where l.tenant_id = p_tenant)
     and pricing.is_low(p_tenant)
$$;
revoke all on function app.today_credits_low(uuid) from public;
grant execute on function app.today_credits_low(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'      from app.today_phone_needs_prices(p_tenant_id) pp\n     where v_decider\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''credits_low'', cl.id, ''Balance''::text, null::text, ''followup_desk'', ''balance'', null::bigint, cl.at, ''billing'', p_tenant_id\n'
    || E'      from app.today_credits_low(p_tenant_id) cl\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
