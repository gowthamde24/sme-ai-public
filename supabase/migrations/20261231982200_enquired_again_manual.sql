-- "Enquired again" leaves Today only when a PERSON handles it (owner decision, 18 Nov 2026):
--   a typed reply (an outbox message from the owner or staff), a call a person placed, Done, or opening the lead.
-- Automated sends do NOT clear it: the first-message template (lead_ack) and every other standing-rule step go through `campaign_submit` as source 'system', the auto-reply is source 'assistant';
-- only source 'owner' is a person's message. Calls placed by a standing rule carry an outreach item, so they are not a person's call either.
-- Opening the lead and Done are written down on the arrival (`handled_at`, `handled_by`).

alter table public.lead_arrivals add column handled_at timestamptz, add column handled_by uuid;
comment on column public.lead_arrivals.handled_at is 'SAFE: a timestamp. When a person opened the lead or pressed Done on its "Enquired again" item';
comment on column public.lead_arrivals.handled_by is 'SAFE: an internal user id of the person who handled the enquiry';

-- one place that marks the enquiries of a lead handled (not callable from outside)
create function app.arrivals_handled(p_tenant uuid, p_lead uuid, p_uid uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_uid is null or not app.has_tenant_role(p_tenant, array['owner', 'admin', 'sales']::public.app_role[]) then
    return 0;
  end if;
  update public.lead_arrivals a set handled_at = now(), handled_by = p_uid
   where a.tenant_id = p_tenant and a.lead_id = p_lead and a.kind = 'again' and a.handled_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function app.arrivals_handled(uuid, uuid, uuid) from public;

-- Done on the Today item
create function public.today_enquired_again_done(p_tenant_id uuid, p_lead_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id and (app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) or l.owner_user_id = v_uid)) then
    perform app.lead_error('reference');
  end if;
  return app.arrivals_handled(p_tenant_id, p_lead_id, v_uid);
end;
$$;
revoke all on function public.today_enquired_again_done(uuid, uuid) from public, anon;
grant execute on function public.today_enquired_again_done(uuid, uuid) to authenticated;
comment on function public.today_enquired_again_done(uuid, uuid) is 'Enquired again: a person pressed Done. Returns how many enquiries were marked handled.';

-- opening the lead also counts (the web calls this every time a person opens a lead)
do $patch$
declare
  v_def text := pg_get_functiondef('public.lead_profile_open(uuid, uuid)'::regprocedure);
  v_old text := $q$        updated_at = now();
  return true;$q$;
  v_new text := $q$        updated_at = now();
  perform app.arrivals_handled(p_tenant_id, p_lead_id, v_uid);
  return true;$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'lead_profile_open has changed: the handled patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- Today: the item stays until a person handles it (or three days pass)
create or replace function app.today_enquired_again(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'enquired_again', 'id', a.id, 'customer', c.full_name, 'ref', a.source_tag, 'at', a.received_at, 'lead_id', a.lead_id) order by a.received_at desc), '[]'::jsonb)
    from public.lead_arrivals a
    join public.contacts c on c.tenant_id = a.tenant_id and c.id = a.contact_id
    join public.leads l on l.tenant_id = a.tenant_id and l.id = a.lead_id
   where auth.uid() is not null and a.tenant_id = p_tenant and app.has_tenant_role(p_tenant, array['owner', 'admin', 'sales']::public.app_role[])
     and a.kind = 'again' and a.received_at > app.outbox_now() - interval '3 days' and l.archived_at is null
     and (app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) or l.owner_user_id = auth.uid())
     and a.received_at = (select max(x.received_at) from public.lead_arrivals x where x.tenant_id = a.tenant_id and x.lead_id = a.lead_id and x.kind = 'again')
     and a.handled_at is null
     and not exists (select 1 from public.outbox_messages m where m.tenant_id = a.tenant_id and m.lead_id = a.lead_id and m.source = 'owner' and m.created_at >= a.received_at)
     and not exists (select 1 from public.phone_calls p where p.tenant_id = a.tenant_id and p.lead_id = a.lead_id and p.direction = 'outbound' and p.created_by is not null and p.outreach_item_id is null
                       and p.state not in ('refused', 'cancelled') and p.created_at >= a.received_at)
$$;
