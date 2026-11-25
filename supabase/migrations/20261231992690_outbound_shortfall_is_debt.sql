-- Planner's decision after the charging proof (26 Nov 2026, reports/charging-proof.md): an OUTBOUND call that runs past the balance leaves its unpaid part as a DEBT, the same rule as an inbound call, so no
-- minute is ever free. Before this, only an inbound call could leave a debt ("an outbound call was checked before it started"), which let a long outbound call go unpaid (at most about Rs 45 with the 300-second
-- cap). The debt counts toward the same floor (Rs 50) and a top-up pays it first; the wallet still never goes below zero. Nothing else about the charge changes.
do $patch$
declare
  v_def text := pg_get_functiondef('public.pricing_charge_call(uuid,uuid,integer,boolean)'::regprocedure);
  v_old text := $q$if v_short > 0 and v_have and v_call.direction = 'inbound' then   -- only a call we were obliged to answer may leave a debt; an outbound call was checked before it started$q$;
  v_new text := $q$if v_short > 0 and v_have then   -- any answered call that ran past the wallet leaves the rest as a debt (inbound or outbound: no free minutes)$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'pricing_charge_call has changed: the outbound-debt patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
