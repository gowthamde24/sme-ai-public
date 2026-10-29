-- Job EB part B (job-context-and-easy-sources): the Sources page. (1) the forwarding address of a workspace can be SHOWN AGAIN (a random routing token kept next to its e-mail source; the source still holds only the
-- token's hash for the door), (2) one read for the cards: what each way of getting leads received in the last 7 days.

create table public.lead_inbound_addresses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null unique references public.tenants (id) on delete restrict,
  source_id  uuid not null,
  token      text not null unique check (token ~ '^[a-z0-9]{24}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id)
);
comment on table public.lead_inbound_addresses is 'Job EB part B: the random routing token of the workspace''s lead e-mail address (leads+TOKEN@domain), kept so the address can be shown again. The door itself checks only the hash held by the source.';
comment on column public.lead_inbound_addresses.id is 'SAFE: a row id. CLEAN-EXEMPT: uuid';
comment on column public.lead_inbound_addresses.token is 'SAFE: a random routing token, not a person''s data. CLEAN-EXEMPT: pattern CHECK';
create index lead_inbound_addresses_source_idx on public.lead_inbound_addresses (tenant_id, source_id);
alter table public.lead_inbound_addresses enable row level security;
alter table public.lead_inbound_addresses force row level security;
revoke all on public.lead_inbound_addresses from public, anon, authenticated, service_role;
grant select on public.lead_inbound_addresses to authenticated;
create policy lead_inbound_addresses_select on public.lead_inbound_addresses for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger lead_inbound_addresses_forbid_tenant_id_change before update on public.lead_inbound_addresses for each row execute function app.forbid_tenant_id_change();
create trigger audit_lead_inbound_addresses after insert or update or delete on public.lead_inbound_addresses for each row execute function app.audit_row_change('lead_inbound_address', '');

create function public.lead_inbound_address_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.lead_inbound_addresses;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into a from public.lead_inbound_addresses x where x.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('token', null, 'source_id', null);
  end if;
  return jsonb_build_object('token', a.token, 'source_id', a.source_id, 'created_at', a.created_at, 'rotated_at', a.rotated_at);
end;
$$;
revoke all on function public.lead_inbound_address_get(uuid) from public, anon;
grant execute on function public.lead_inbound_address_get(uuid) to authenticated;

-- the API generates the token, makes (or rotates) the e-mail source with its hash, then records the token here
create function public.lead_inbound_address_set(p_tenant_id uuid, p_source_id uuid, p_token text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_source_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[a-z0-9]{24}$'
     or not exists (select 1 from public.lead_sources s where s.tenant_id = p_tenant_id and s.id = p_source_id and s.kind = 'email_forward') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  insert into public.lead_inbound_addresses as a (tenant_id, source_id, token) values (p_tenant_id, p_source_id, p_token)
  on conflict (tenant_id) do update set source_id = excluded.source_id, token = excluded.token, rotated_at = now();
  return jsonb_build_object('token', p_token, 'source_id', p_source_id);
end;
$$;
revoke all on function public.lead_inbound_address_set(uuid, uuid, text) from public, anon;
grant execute on function public.lead_inbound_address_set(uuid, uuid, text) to authenticated;

-- the numbers on the cards: arrivals of the last 7 days and the last arrival, by source tag; the WhatsApp connection; the sheets that need attention; the imports of the last 7 days
create function public.lead_source_cards_stats(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'by_tag', coalesce((
      select jsonb_object_agg(t.source_tag, jsonb_build_object('received_7d', t.n7, 'last_at', t.last_at))
        from (select a.source_tag, count(*) filter (where a.received_at > now() - interval '7 days')::int as n7, max(a.received_at) as last_at
                from public.lead_arrivals a where a.tenant_id = p_tenant_id group by a.source_tag) t), '{}'::jsonb),
    'whatsapp', (select jsonb_build_object('status', w.status) from integrations.whatsapp_accounts w where w.tenant_id = p_tenant_id),
    'sheets', jsonb_build_object(
      'total', (select count(*) from public.lead_sheet_links l where l.tenant_id = p_tenant_id)::int,
      'needs_attention', (select count(*) from public.lead_sheet_links l where l.tenant_id = p_tenant_id and l.status = 'needs_attention')::int,
      'last_synced_at', (select max(l.last_synced_at) from public.lead_sheet_links l where l.tenant_id = p_tenant_id)),
    'imports', jsonb_build_object(
      'received_7d', coalesce((select sum(i.rows_read) from public.lead_intakes i where i.tenant_id = p_tenant_id and i.created_at > now() - interval '7 days'), 0)::int,
      'last_at', (select max(i.created_at) from public.lead_intakes i where i.tenant_id = p_tenant_id)));
end;
$$;
revoke all on function public.lead_source_cards_stats(uuid) from public, anon;
grant execute on function public.lead_source_cards_stats(uuid) to authenticated;
