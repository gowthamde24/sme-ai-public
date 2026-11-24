-- A telephony setting that is not as we promise (28 Nov 2026): VoiceLink records calls on its network when "call recording" is on for a number, and it was ON for ours while the privacy text says calls are not
-- recorded. The daily telephony check now reads the numbers' recording flag and tells the database: ONE "Needs you" item for the owner and finance while any number records, cleared (acknowledged) when none does.
-- A new alert kind and one system-only function; no table, no personal data (a sentence the worker wrote: a count and what to do).

alter table admin.alerts drop constraint alerts_kind_check;
alter table admin.alerts add constraint alerts_kind_check check (kind in ('google_cap', 'credential_expiry', 'plivo_balance', 'telephony_setting'));

create function public.ops_telephony_setting_report(p_ok boolean, p_detail text default null) returns void language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  if p_ok is null or (not p_ok and (p_detail is null or char_length(p_detail) not between 1 and 500)) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_ok then
    update admin.alerts set acknowledged_at = now() where kind = 'telephony_setting' and acknowledged_at is null;
  elsif not exists (select 1 from admin.alerts a where a.kind = 'telephony_setting' and a.acknowledged_at is null) then
    insert into admin.alerts (key, kind, severity, title, detail)
    values ('telephony:setting:' || to_char(app.agent_utc_today(), 'YYYYMMDD'), 'telephony_setting', 'warn', 'A telephony setting is not as promised', p_detail)
    on conflict (key) do nothing;
  end if;
end $$;
revoke all on function public.ops_telephony_setting_report(boolean, text) from public, anon;
grant execute on function public.ops_telephony_setting_report(boolean, text) to authenticated;

-- the staff list: the owner and finance see it (support does not), like the balance item
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
                                                          and (x.kind not in ('plivo_balance', 'telephony_setting') or v_staff.role in ('owner', 'finance'))
                                                        order by x.created_at desc limit 100) a), '[]'::jsonb));
end $$;
