-- The daily telephony balance check also says how long the wallet will last (owner request via the planner, 26 Nov 2026): "days of cover left" = the balance / the average calls spend of the last 7 days.
-- The worker needs that spend before it writes the "Needs you" item, so the existing ops_plivo_balance_due answer gets ONE more key, calls_7d_paise: what the calls of the last 7 days cost by our own ledger
-- (phone_calls.cost_paise, real calls only: not simulated, not refused). A count of paise, no tenant, no number, no person. Same function, same grants, same system-only guard: nothing else changes.

create or replace function public.ops_plivo_balance_due() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_row   ops.plivo_balance_checks;
  v_spent bigint;
begin
  perform ops.system_only();
  select coalesce(sum(c.cost_paise), 0) into v_spent from public.phone_calls c
   where c.created_at >= now() - interval '7 days' and c.simulated = false and c.state in ('completed', 'no_answer', 'busy', 'voicemail', 'failed');
  select * into v_row from ops.plivo_balance_checks c where c.day = app.agent_utc_today();
  if not found then
    return jsonb_build_object('read_due', true, 'state', null, 'whatsapp_due', false, 'balance_inr', null, 'auto_recharge', null, 'calls_7d_paise', v_spent);
  end if;
  return jsonb_build_object('read_due', v_row.state = 'failed' and v_row.checked_at <= now() - interval '1 hour', 'state', v_row.state,
                            'whatsapp_due', v_row.state = 'low' and v_row.whatsapp_at is null, 'balance_inr', v_row.balance_inr, 'auto_recharge', v_row.auto_recharge, 'calls_7d_paise', v_spent);
end $$;
