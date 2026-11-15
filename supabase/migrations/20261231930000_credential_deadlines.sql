-- Credential deadlines (owner, 15 Nov 2026): a provider key or token that stops working on a known day (the Meta Page token's data access, about mid-February 2027) must be a warning in the
-- staff console BEFORE it stops: one alert per deadline, from `warn_days` before (default 14), and one "over" alert on the day. The worker already e-mails the owner for every unsent staff alert.
-- A deadline is DATA of an environment (staging and production differ), so the migration seeds nothing: an operator inserts the row.
alter table admin.alerts drop constraint alerts_kind_check;
alter table admin.alerts add constraint alerts_kind_check check (kind in ('google_cap', 'credential_expiry'));

create table ops.credential_deadlines (
  key        text primary key check (key ~ '^[a-z0-9_.-]{3,60}$'),
  label      text not null check (char_length(label) between 3 and 120),
  expires_at timestamptz not null,
  warn_days  integer not null default 14 check (warn_days between 1 and 90),
  what_to_do text not null check (char_length(what_to_do) between 3 and 300),
  created_at timestamptz not null default now()
);
comment on table ops.credential_deadlines is 'A known day on which a provider credential stops working. Platform data (not tenant data); written by the operator; read by ops_credential_alerts_run. Holds no credential.';
comment on column ops.credential_deadlines.key is 'SAFE: an opaque key. CLEAN-EXEMPT: strict pattern CHECK';
comment on column ops.credential_deadlines.label is 'SAFE: a sentence written by the operator naming a provider credential, never its value';
comment on column ops.credential_deadlines.what_to_do is 'SAFE: a sentence written by the operator, never a credential value';
alter table ops.credential_deadlines enable row level security;
alter table ops.credential_deadlines force row level security;
revoke all on ops.credential_deadlines from public, anon, authenticated, service_role;

-- the worker (system account) runs this every tick: ONE alert per deadline from warn_days before, ONE more ("over") once the day has passed; returns the ones not yet e-mailed
create function public.ops_credential_alerts_run() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  c     ops.credential_deadlines;
  v_new jsonb;
begin
  perform ops.system_only();
  for c in select * from ops.credential_deadlines order by expires_at loop
    continue when now() < c.expires_at - make_interval(days => c.warn_days);
    insert into admin.alerts (key, kind, severity, title, detail)
    values ('cred:' || c.key || ':' || to_char(c.expires_at at time zone 'UTC', 'YYYYMMDD') || case when now() >= c.expires_at then ':over' else ':warn' end, 'credential_expiry',
            case when now() >= c.expires_at then 'over' else 'warn' end,
            case when now() >= c.expires_at then c.label || ' has expired' else c.label || ' expires on ' || to_char(c.expires_at at time zone 'UTC', 'DD Mon YYYY') end,
            c.what_to_do)
    on conflict (key) do nothing;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'severity', a.severity, 'title', a.title, 'detail', a.detail) order by a.created_at), '[]'::jsonb) into v_new
    from admin.alerts a where a.kind = 'credential_expiry' and a.emailed_at is null;
  return jsonb_build_object('new', v_new);
end $$;
revoke all on function public.ops_credential_alerts_run() from public, anon;
grant execute on function public.ops_credential_alerts_run() to authenticated;

-- the staff list: a credential deadline is the OWNER's to see (Google caps stay owner and finance)
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
                                                        order by x.created_at desc limit 100) a), '[]'::jsonb));
end $$;
