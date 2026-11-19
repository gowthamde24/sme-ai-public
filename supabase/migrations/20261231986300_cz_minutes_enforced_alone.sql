-- Customer Zero's call minutes are enforced ON THEIR OWN (owner and planner decision, 19 Nov 2026): a business with its own call-minutes number (tenants.call_minutes_override, set only by the operator) is stopped at that
-- number even while the platform switch `billing_enforced` is OFF. Nothing is charged and nothing else changes: the switch still decides every other limit (the early access plan's 60 minutes, the read-only lapse, the trial
-- clock) and every business without the number behaves exactly as before. Only the call-minutes check of such a business moves; the meter, the ledger and the wallet are untouched.
create or replace function app.billing_stopped(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_pending(p_tenant)   -- job DM's hold while the plan waits for WhatsApp stays
      or ((app.billing_enforced()
           or (p_kind = 'call_minutes' and exists (select 1 from public.tenants t where t.id = p_tenant and t.call_minutes_override is not null)))
          and app.billing_blocked(p_tenant, p_kind))
$$;
revoke all on function app.billing_stopped(uuid, text) from public, anon, authenticated, service_role;
