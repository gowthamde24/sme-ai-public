-- VoiceLink needs a FREE CHANNEL of ours for every business client (the real probe of 25 Nov 2026: `client/create` was refused "Channel count cannot exceed available channels (0)"). KYC first therefore needs a channel in the
-- pool before step 1. When there is none, the business is not turned away: it WAITS for its line (telephony.line_waits), the Owner sees "We are setting up your line; this takes a short while", the staff console shows the
-- alert `no_free_channels` (buy a channel at VoiceLink), and the next time the Owner's screen reads the status after a channel is free, the client is made and the KYC can begin. One row per workspace; no personal data.
create table telephony.line_waits (
  tenant_id  uuid primary key references public.tenants (id),
  created_at timestamptz not null default now(),
  last_try_at timestamptz not null default now(),
  tries      integer not null default 1 check (tries between 1 and 100000)
);
comment on table telephony.line_waits is 'A workspace waiting for a free VoiceLink channel before its own client can be made (KYC first). Removed as soon as the client exists. No personal data.';
alter table telephony.line_waits enable row level security;
alter table telephony.line_waits force row level security;
revoke all on telephony.line_waits from public, anon, authenticated, service_role;
create trigger audit_line_waits after insert or update or delete on telephony.line_waits for each row execute function app.audit_row_change('line_wait', '');

create function public.business_line_wait_put(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare r telephony.line_waits;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into telephony.line_waits (tenant_id) values (p_tenant_id)
  on conflict (tenant_id) do update set last_try_at = now(), tries = least(telephony.line_waits.tries + 1, 100000)
  returning * into r;
  return jsonb_build_object('waiting', true, 'since', r.created_at, 'tries', r.tries);
end $$;
revoke all on function public.business_line_wait_put(uuid) from public, anon;
grant execute on function public.business_line_wait_put(uuid) to authenticated;

create function public.business_line_wait_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r telephony.line_waits;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from telephony.line_waits w where w.tenant_id = p_tenant_id;
  return case when r.tenant_id is null then jsonb_build_object('waiting', false) else jsonb_build_object('waiting', true, 'since', r.created_at, 'tries', r.tries) end;
end $$;
revoke all on function public.business_line_wait_get(uuid) from public, anon;
grant execute on function public.business_line_wait_get(uuid) to authenticated;

create function public.business_line_wait_clear(p_tenant_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from telephony.line_waits where tenant_id = p_tenant_id;
end $$;
revoke all on function public.business_line_wait_clear(uuid) from public, anon;
grant execute on function public.business_line_wait_clear(uuid) to authenticated;

-- the staff alert: businesses are waiting for a line
do $patch$
declare
  v_def text := pg_get_functiondef('admin.computed_alerts(text)'::regprocedure);
  v_old text := E'     where p_role in (''owner'', ''support'') and w.n > 0\n  ) x';
  v_new text := E'     where p_role in (''owner'', ''support'') and w.n > 0\n    union all\n'
    || E'    select 8, jsonb_build_object(''id'', md5(''no_free_channels'')::uuid, ''kind'', ''no_free_channels'', ''severity'', ''warn'', ''title'', ''Businesses are waiting for a phone line'',\n'
    || E'             ''detail'', c.n || '' business(es) cannot start their phone verification because VoiceLink has no free channel for them. Buy a channel at VoiceLink (Buy DIDs and Channels > add a channel); they continue by themselves.'',\n'
    || E'             ''created_at'', app.outbox_now(), ''acknowledged'', false)\n'
    || E'      from (select count(*) as n from telephony.line_waits) c\n'
    || E'     where p_role in (''owner'', ''support'') and c.n > 0\n  ) x';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'computed_alerts has changed: the no-free-channels alert no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
