-- pricing.credit has two rules that were each written in a different migration: 991700 (a top-up, refund or adjustment pays an open inbound debt first) and 992200 (a top-up lot never expires).
-- The later one replaced the earlier function, so on a fresh database the debt was never paid. This migration states both rules in one function (25 Nov 2026). Rollback = restore either earlier text.
create or replace function pricing.credit(p_tenant uuid, p_source text, p_ref text, p_amount bigint) returns boolean language plpgsql set search_path = '' as
$$
declare
  v_new boolean;
  v_owed bigint;
  v_pay bigint;
begin
  insert into pricing.wallet_lots (tenant_id, source, ref, amount_paise, remaining_paise, expires_at)
  values (p_tenant, p_source, p_ref, p_amount, p_amount,
          now() + case when p_source = 'topup' then interval '36500 days' else make_interval(days => (select s.lot_days from pricing.settings s)) end)
  on conflict (tenant_id, source, ref) do nothing;
  v_new := found;
  if v_new and p_source in ('topup', 'refund', 'adjustment') then
    select d.owed_paise into v_owed from pricing.debts d where d.tenant_id = p_tenant for update;
    if coalesce(v_owed, 0) > 0 then
      v_pay := least(v_owed, p_amount);
      update pricing.wallet_lots set remaining_paise = remaining_paise - v_pay where tenant_id = p_tenant and source = p_source and ref = p_ref;
      update pricing.debts set owed_paise = owed_paise - v_pay, updated_at = now() where tenant_id = p_tenant;
    end if;
  end if;
  return v_new;
end $$;
revoke all on function pricing.credit(uuid, text, text, bigint) from public, anon, authenticated, service_role;
