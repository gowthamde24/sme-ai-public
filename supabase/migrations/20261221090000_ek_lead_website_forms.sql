-- Job EK: the website form of a workspace can be SHOWN AGAIN (its snippet and its hosted form link need the secret address): a random routing token kept next to the workspace's website_form source, like the
-- forwarding address of job EB. The door itself still checks only the hash held by the source.

create table public.lead_website_forms (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null unique references public.tenants (id) on delete restrict,
  source_id  uuid not null,
  token      text not null unique check (token ~ '^[a-z0-9]{24}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id)
);
comment on table public.lead_website_forms is 'Job EK: the random token of the workspace''s website form (the address in the snippet and the hosted form link), kept so the snippet can be shown again. The door checks only the hash held by the website_form source.';
comment on column public.lead_website_forms.id is 'SAFE: a row id. CLEAN-EXEMPT: uuid';
comment on column public.lead_website_forms.token is 'SAFE: a random routing token, not a person''s data. CLEAN-EXEMPT: pattern CHECK';
create index lead_website_forms_source_idx on public.lead_website_forms (tenant_id, source_id);
alter table public.lead_website_forms enable row level security;
alter table public.lead_website_forms force row level security;
revoke all on public.lead_website_forms from public, anon, authenticated, service_role;
grant select on public.lead_website_forms to authenticated;
create policy lead_website_forms_select on public.lead_website_forms for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger lead_website_forms_forbid_tenant_id_change before update on public.lead_website_forms for each row execute function app.forbid_tenant_id_change();
create trigger audit_lead_website_forms after insert or update or delete on public.lead_website_forms for each row execute function app.audit_row_change('lead_website_form', '');

create function public.lead_website_form_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.lead_website_forms;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into a from public.lead_website_forms x where x.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('token', null, 'source_id', null);
  end if;
  return jsonb_build_object('token', a.token, 'source_id', a.source_id, 'created_at', a.created_at, 'rotated_at', a.rotated_at);
end;
$$;
revoke all on function public.lead_website_form_get(uuid) from public, anon;
grant execute on function public.lead_website_form_get(uuid) to authenticated;

-- the API generates the token, makes (or rotates) the website_form source with its hash, then records the token here
create function public.lead_website_form_set(p_tenant_id uuid, p_source_id uuid, p_token text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_source_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[a-z0-9]{24}$'
     or not exists (select 1 from public.lead_sources s where s.tenant_id = p_tenant_id and s.id = p_source_id and s.kind = 'website_form') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into public.lead_website_forms as a (tenant_id, source_id, token) values (p_tenant_id, p_source_id, p_token)
  on conflict (tenant_id) do update set source_id = excluded.source_id, token = excluded.token, rotated_at = now();
  return jsonb_build_object('token', p_token, 'source_id', p_source_id);
end;
$$;
revoke all on function public.lead_website_form_set(uuid, uuid, text) from public, anon;
grant execute on function public.lead_website_form_set(uuid, uuid, text) to authenticated;
