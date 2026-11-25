-- The balance answer tells how much a workspace owes when an inbound call ran past an empty wallet (25 Nov 2026; the Credits page says "Your balance is below zero by Rs N. Your next top-up pays this first").
-- `owed_paise`: whole paise, 0 unless the wallet ran past zero (pricing.debts, migration 991700). Additive: one more key in the answer. Rollback = restore the earlier function text.
do $patch$
declare
  v_def text := pg_get_functiondef('public.pricing_balance(uuid)'::regprocedure);
  v_old text := $q$'free_start_granted', exists$q$;
  v_new text := $q$'owed_paise', coalesce((select d.owed_paise from pricing.debts d where d.tenant_id = p_tenant_id), 0), 'free_start_granted', exists$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'pricing_balance has changed: the owed patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
