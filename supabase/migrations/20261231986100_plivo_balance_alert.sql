-- Plivo's balance, watched once a day (owner decision, 19 Nov 2026): Plivo is a prepaid account that must never run dry (no Plivo auto-recharge exists for India accounts: top-ups stay manual).
-- The scheduler worker reads the balance from Plivo's Account API once per India day (only when PLIVO_BALANCE_CHECK is on) and tells the database what it found; the database keeps the one record of the day and:
--   * raises ONE "Needs you" item for the platform owner when the balance is low (a staff-console alert, kind plivo_balance: the owner and finance staff read it) and keeps it open until the balance recovers;
--   * says whether the WhatsApp message to the owner's own number is still due today (at most one a day, tried again on the next tick if the send failed);
--   * clears the item (acknowledges it, no staff member) when the balance is back above the limit;
--   * raises one more item when the balance could not be read for six tries in one day (a wrong key or Plivo being down must not hide a low balance).
-- The comparison with Rs 300 is made by the worker (a configurable limit in rupees and a configurable rate when Plivo reports dollars); the database only receives the balance in rupees. No credential, no number and no
-- personal data is stored: a day, a state word, an amount and the time.

alter table admin.alerts drop constraint alerts_kind_check;
alter table admin.alerts add constraint alerts_kind_check check (kind in ('google_cap', 'credential_expiry', 'plivo_balance'));

create table ops.plivo_balance_checks (
  day           date primary key,
  state         text not null check (state in ('ok', 'low', 'failed')),
  balance_inr   numeric(14, 2),
  auto_recharge boolean,
  attempts      integer not null default 0 check (attempts between 0 and 10000),
  checked_at    timestamptz not null default now(),
  whatsapp_at   timestamptz
);
comment on table ops.plivo_balance_checks is 'Platform data (not tenant data): one row per India day for the daily Plivo balance check. Holds a day, a state word, an amount in rupees and times; no credential, no number, no personal data. Written only by the worker through ops_plivo_balance_report.';
comment on column ops.plivo_balance_checks.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table ops.plivo_balance_checks enable row level security;
alter table ops.plivo_balance_checks force row level security;
revoke all on ops.plivo_balance_checks from public, anon, authenticated, service_role;

-- is the read due (nothing read yet today, or an earlier try failed more than an hour ago) and is the owner's WhatsApp still to be sent (a low reading today, not yet told)?
create function public.ops_plivo_balance_due() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_row ops.plivo_balance_checks;
begin
  perform ops.system_only();
  select * into v_row from ops.plivo_balance_checks c where c.day = app.agent_utc_today();
  if not found then
    return jsonb_build_object('read_due', true, 'state', null, 'whatsapp_due', false, 'balance_inr', null, 'auto_recharge', null);
  end if;
  return jsonb_build_object('read_due', v_row.state = 'failed' and v_row.checked_at <= now() - interval '1 hour', 'state', v_row.state,
                            'whatsapp_due', v_row.state = 'low' and v_row.whatsapp_at is null, 'balance_inr', v_row.balance_inr, 'auto_recharge', v_row.auto_recharge);
end $$;

-- the worker's answer from Plivo: 'ok' or 'low' with the balance in rupees (and whether Plivo says auto-recharge is on), or 'failed' (Plivo could not be read). The first reading of the day stands.
create function public.ops_plivo_balance_report(p_state text, p_balance_inr numeric default null, p_detail text default null, p_auto_recharge boolean default null) returns jsonb language plpgsql security definer set search_path = '' as
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
    if p_state = 'failed' and v_row.attempts >= 6 and not exists (select 1 from admin.alerts a where a.kind = 'plivo_balance' and a.acknowledged_at is null) then
      insert into admin.alerts (key, kind, severity, title, detail)
      values ('plivo:unread:' || to_char(v_day, 'YYYYMMDD'), 'plivo_balance', 'warn', 'The Plivo balance could not be read today',
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

-- the WhatsApp message to the owner went: no second one today
create function public.ops_plivo_balance_told() returns void language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  update ops.plivo_balance_checks set whatsapp_at = now() where day = app.agent_utc_today() and state = 'low' and whatsapp_at is null;
end $$;

revoke all on function public.ops_plivo_balance_due(), public.ops_plivo_balance_report(text, numeric, text, boolean), public.ops_plivo_balance_told() from public, anon;
grant execute on function public.ops_plivo_balance_due(), public.ops_plivo_balance_report(text, numeric, text, boolean), public.ops_plivo_balance_told() to authenticated;

-- the staff list: the Plivo balance is money, so the owner and finance see it (support does not)
create or replace function public.admin_alerts_list(p_include_acknowledged boolean default false) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'severity', a.severity, 'title', a.title, 'detail', a.detail, 'created_at', a.created_at,
                                                                                    'acknowledged', a.acknowledged_at is not null) order by a.created_at desc)
                                                 from (select * from admin.alerts x where (p_include_acknowledged or x.acknowledged_at is null)
                                                          and (x.kind <> 'google_cap' or v_staff.role in ('owner', 'finance')) and (x.kind <> 'credential_expiry' or v_staff.role = 'owner')
                                                          and (x.kind <> 'plivo_balance' or v_staff.role in ('owner', 'finance'))
                                                        order by x.created_at desc limit 100) a), '[]'::jsonb));
end $$;
