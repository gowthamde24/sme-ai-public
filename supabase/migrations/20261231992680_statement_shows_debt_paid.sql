-- Charging proof (26 Nov 2026, reports/charging-proof.md): a top-up that pays an open call debt first (migration 991700) added the WHOLE top-up to the statement as a credit but did not show the part that went to the
-- debt, so the statement's closing balance was higher than the real balance (Rs 100 top-up, Rs 60 of debt: statement closing Rs 100, balance Rs 40). The lot now remembers what it paid of the debt, and the statement
-- shows it as its own negative line ("Calls taken while your balance was empty"), so the lines add up to the balance again. Nothing else changes; lots made before this migration paid no recorded debt (0).

alter table pricing.wallet_lots add column debt_paid_paise bigint not null default 0 check (debt_paid_paise >= 0);
comment on column pricing.wallet_lots.debt_paid_paise is 'SAFE: how much of this credit went to an open call debt when it arrived (paise). CLEAN-EXEMPT: an amount';

do $patch$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('pricing.credit(uuid,text,text,bigint)'::regprocedure);
  v_old := $q$update pricing.wallet_lots set remaining_paise = remaining_paise - v_pay where tenant_id = p_tenant and source = p_source and ref = p_ref;$q$;
  v_new := $q$update pricing.wallet_lots set remaining_paise = remaining_paise - v_pay, debt_paid_paise = v_pay where tenant_id = p_tenant and source = p_source and ref = p_ref;$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'pricing.credit has changed: the debt-paid patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('public.pricing_statement(uuid,date,date,integer,timestamptz)'::regprocedure);
  v_old := $q$      union all
      select r.created_at, 'refund', 'Refund of a top-up', -r.credits_reversed_paise$q$;
  v_new := $q$      union all
      select l.created_at, 'usage', 'Calls taken while your balance was empty', -l.debt_paid_paise, l.ref || ':debt', null
        from pricing.wallet_lots l where l.tenant_id = p_tenant_id and l.debt_paid_paise > 0
      union all
      select r.created_at, 'refund', 'Refund of a top-up', -r.credits_reversed_paise$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'pricing_statement has changed: the debt-paid patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
