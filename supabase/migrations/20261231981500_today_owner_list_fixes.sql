-- The owner's Today list of 17 Nov 2026:
--   1. An "Enquired again" item shows whatever the lead's status is: the enquiry is new information even when the lead is in progress. It leaves Today only when a person writes to the customer after the enquiry
--      (an owner message), or after three days.
--   2. Today's number of things waiting (`cards.waiting`, and so the sidebar's `nav_counts.needs_you`, which is that very number) also counts the OPEN price asks and promises ("Price asked: ..." / "Promised: ..."), one each:
--      the web's Today shows those cards, so the heading and the sidebar badge agree.
--   3. The voice-credits card ("Your balance") is a billing notice: with billing not enforced (staging by default) it is not shown.

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
     and not exists (select 1 from public.outbox_messages m where m.tenant_id = a.tenant_id and m.lead_id = a.lead_id and m.source = 'owner' and m.created_at >= a.received_at)
$$;

-- the open price asks and promises, for the caller's workspace (Today runs as the caller, who may not read them all)
create function app.today_open_asks(p_tenant uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin', 'sales']::public.app_role[])
              then (select count(*)::integer from public.price_asks a where a.tenant_id = p_tenant and a.answered_at is null) else 0 end
$$;
revoke all on function app.today_open_asks(uuid) from public;
grant execute on function app.today_open_asks(uuid) to authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_old text := $q$    v_waiting := v_waiting + v_visits;
  end if;$q$;
  v_new text := $q$    v_waiting := v_waiting + v_visits + app.today_open_asks(p_tenant_id);
  end if;$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'today_summary has changed: the open-asks patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

do $patch$
declare
  v_def text := pg_get_functiondef('app.today_voice_budget_items(uuid)'::regprocedure);
  v_old text := $q$  select * into b from public.voice_budget where engine = 'cartesia' and notice_tenant = p_tenant;$q$;
  v_new text := $q$  if not app.billing_enforced() then
    return '[]'::jsonb;   -- a billing notice: not shown while billing is not enforced (staging)
  end if;
  select * into b from public.voice_budget where engine = 'cartesia' and notice_tenant = p_tenant;$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'today_voice_budget_items has changed: the billing patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
