-- The daily telephony balance check, one change (28 Nov 2026): VoiceLink refused our login (401: the stored username was the display name) and nothing showed for six hours, because a failed read only became a
-- "Needs you" item on the sixth try of the day. A failed read that comes WITH a sentence (a known reason: the worker says what to fix) now raises the item at once, with a title that does not name Plivo.
-- The same function, the same grants and the same system-only guard; an unexplained failure behaves exactly as before.

create or replace function public.ops_plivo_balance_report(p_state text, p_balance_inr numeric default null, p_detail text default null, p_auto_recharge boolean default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_day   date := app.agent_utc_today();
  v_row   ops.plivo_balance_checks;
  v_new   boolean := false;
  v_id    uuid;
  v_title text;
  v_sev   text;
begin
  perform ops.system_only();
  if p_state is null or p_state not in ('ok', 'low', 'failed')
     or (p_state <> 'failed' and (p_balance_inr is null or p_balance_inr not between -1000000 and 100000000))
     or (p_detail is not null and char_length(p_detail) not between 1 and 500) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into ops.plivo_balance_checks (day, state, attempts) values (v_day, 'failed', 0) on conflict (day) do nothing;
  select * into v_row from ops.plivo_balance_checks c where c.day = v_day for update;
  if v_row.state = 'failed' then
    update ops.plivo_balance_checks c
       set state = p_state, balance_inr = case when p_state = 'failed' then null else round(p_balance_inr, 2) end, auto_recharge = case when p_state = 'failed' then null else p_auto_recharge end,
           attempts = c.attempts + 1, checked_at = now()
     where c.day = v_day
    returning * into v_row;
    v_new := p_state <> 'failed';
    -- a read that failed for a KNOWN reason (the worker passes a sentence: VoiceLink refused the login) is an item at once; an unexplained failure still waits for the sixth try
    if p_state = 'failed' and (v_row.attempts >= 6 or p_detail is not null) and not exists (select 1 from admin.alerts a where a.kind = 'plivo_balance' and a.acknowledged_at is null) then
      insert into admin.alerts (key, kind, severity, title, detail)
      values ('plivo:unread:' || to_char(v_day, 'YYYYMMDD'), 'plivo_balance', 'warn', case when p_detail is not null then 'The telephony balance could not be read today' else 'The Plivo balance could not be read today' end,
              coalesce(p_detail, 'The daily check asked Plivo six times and got no answer (a wrong key, or Plivo is down). Look at the balance in the Plivo console.'))
      on conflict (key) do nothing;
    end if;
  end if;
  if v_new and v_row.state = 'low' then
    v_sev := case when v_row.balance_inr <= 0 then 'over' else 'warn' end;
    v_title := 'Plivo balance is low: about Rs ' || round(v_row.balance_inr)::bigint::text || ' left';
    select a.id into v_id from admin.alerts a where a.kind = 'plivo_balance' and a.acknowledged_at is null order by a.created_at desc limit 1;
    if found then
      update admin.alerts set severity = v_sev, title = v_title, detail = p_detail where id = v_id;
    else
      insert into admin.alerts (key, kind, severity, title, detail)
      values ('plivo:low:' || to_char(v_day, 'YYYYMMDD'), 'plivo_balance', v_sev, v_title, p_detail)
      on conflict (key) do nothing;
    end if;
  elsif v_new and v_row.state = 'ok' then
    update admin.alerts set acknowledged_at = now() where kind = 'plivo_balance' and acknowledged_at is null;
  end if;
  return jsonb_build_object('state', v_row.state, 'whatsapp_due', v_row.state = 'low' and v_row.whatsapp_at is null, 'balance_inr', v_row.balance_inr, 'auto_recharge', v_row.auto_recharge);
end $$;
