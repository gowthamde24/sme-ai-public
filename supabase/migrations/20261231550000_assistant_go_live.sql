-- "My assistant": Not live / In training / Live, and the Go live / Pause button (owner decision 13 Nov 2026: only a business name plus a connected phone number are needed to go live; training is
-- optional and every new assistant starts with working defaults).
--   workspace.assistant_live            one row per workspace that ever went live or paused: whether it is live now, who and when
--   public.assistant_status_get         any member: the facts the status is made from (the API turns them into a state and a "missing" list)
--   public.assistant_go_live / _pause   the Owner; go live is refused (SM991) while the business has no name of its own or no connected phone number; every change is in the audit log
-- A "connected phone number" is a number the platform answers on for the workspace (public.phone_numbers) or an ACTIVE WhatsApp account (integrations.whatsapp_accounts).

create table workspace.assistant_live (
  workspace_id uuid primary key references public.tenants (id) on delete restrict,
  live         boolean not null,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
alter table workspace.assistant_live enable row level security;
alter table workspace.assistant_live force row level security;
revoke all on workspace.assistant_live from public, anon, authenticated, service_role;

create function app.assistant_facts(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'live', coalesce((select l.live from workspace.assistant_live l where l.workspace_id = p_tenant), false),
    'ever_changed', exists (select 1 from workspace.assistant_live l where l.workspace_id = p_tenant),
    'business_name_ok', exists (select 1 from public.tenants t where t.id = p_tenant and char_length(btrim(t.name)) >= 2 and lower(btrim(t.name)) <> 'my business'),
    'phone_number_ok', exists (select 1 from public.phone_numbers n where n.tenant_id = p_tenant)
                       or exists (select 1 from integrations.whatsapp_accounts a where a.tenant_id = p_tenant and a.status = 'active'),
    'voice_saved', exists (select 1 from public.assistant_settings s where s.tenant_id = p_tenant),
    'rules_saved', exists (select 1 from public.talk_training t where t.tenant_id = p_tenant))
$$;
revoke all on function app.assistant_facts(uuid) from public, anon, authenticated, service_role;

create function public.assistant_status_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.assistant_facts(p_tenant_id);
end;
$$;
revoke all on function public.assistant_status_get(uuid) from public, anon;
grant execute on function public.assistant_status_get(uuid) to authenticated;

create function app.assistant_set_live(p_tenant uuid, p_live boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb;
begin
  if auth.uid() is null or p_tenant is null or not app.has_tenant_role(p_tenant, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  f := app.assistant_facts(p_tenant);
  if p_live and not ((f ->> 'business_name_ok')::boolean and (f ->> 'phone_number_ok')::boolean) then
    raise exception 'the assistant needs a business name and a connected phone number' using errcode = 'SM991';
  end if;
  insert into workspace.assistant_live as l (workspace_id, live, changed_by, changed_at) values (p_tenant, p_live, auth.uid(), now())
  on conflict (workspace_id) do update set live = excluded.live, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  perform app.write_audit_event(p_tenant, case when p_live then 'assistant.went_live' else 'assistant.paused' end, 'workspace', p_tenant, null, jsonb_build_object('live', p_live));
  return app.assistant_facts(p_tenant);
end;
$$;
revoke all on function app.assistant_set_live(uuid, boolean) from public, anon, authenticated, service_role;

create function public.assistant_go_live(p_tenant_id uuid) returns jsonb language sql security definer set search_path = '' as $$ select app.assistant_set_live(p_tenant_id, true) $$;
create function public.assistant_pause(p_tenant_id uuid) returns jsonb language sql security definer set search_path = '' as $$ select app.assistant_set_live(p_tenant_id, false) $$;
revoke all on function public.assistant_go_live(uuid), public.assistant_pause(uuid) from public, anon;
grant execute on function public.assistant_go_live(uuid), public.assistant_pause(uuid) to authenticated;
