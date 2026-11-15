-- Track D, slice 1 (owner, 15 Nov 2026): every way of getting enquiries has one card with Connect / Test / status / last lead received / Disconnect (docs/contracts/lead-sources-v2.md). This file holds the database side:
--   * public.leads.is_test: a test lead (made by the Test button through the real intake path) is marked, kept out of the cards' counts and of the Leads badge, and offered for removal. It has a +00 test number, so nothing can
--     ring it or message it.
--   * public.lead_source_test_finish(tenant, phone): the Owner or Admin marks the lead a test just made and gets its id.
--   * lead_sources.status may be 'disconnected' (the secret address is dead, the card is off; the leads already received stay) and public.lead_website_form_clear forgets the shown website address.
--   * the cards' numbers leave test leads out and carry `total` per tag (received_total); the sidebar badge `new_leads` counts OPEN leads only (new or in review), not the Qualified/Lost ones and not test leads
--     (C2, 15 Nov: the badge said 68, the page listed 50).

alter table public.leads add column is_test boolean not null default false;
comment on column public.leads.is_test is 'SAFE: true for a lead made by the Test button of a source card; never counted, never called or messaged. CLEAN-EXEMPT: boolean';

alter table public.lead_sources drop constraint lead_sources_status_check;
alter table public.lead_sources add constraint lead_sources_status_check check (status in ('active', 'paused', 'disconnected'));

do $patch$
declare
  v_def text;
  v_new text;
begin
  -- lead_source_set_status accepts 'disconnected'
  v_def := pg_get_functiondef('public.lead_source_set_status(uuid, uuid, text)'::regprocedure);
  v_new := replace(v_def, $a$p_status not in ('active', 'paused')$a$, $a$p_status not in ('active', 'paused', 'disconnected')$a$);
  if v_new = v_def then raise exception 'lead_source_set_status: status list not found'; end if;
  execute v_new;
end
$patch$;

create function public.lead_source_test_finish(p_tenant_id uuid, p_phone text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_phone is null or p_phone !~ '^\+00 [0-9 ]{6,20}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select l.id into v_lead
    from public.leads l join public.contacts k on k.tenant_id = l.tenant_id and k.id = l.contact_id
   where l.tenant_id = p_tenant_id and app.phone_norm(k.phone) = app.phone_norm(p_phone) and l.created_at > now() - interval '10 minutes'
   order by l.created_at desc limit 1;
  if v_lead is null then
    return jsonb_build_object('lead_id', null);
  end if;
  update public.leads set is_test = true where tenant_id = p_tenant_id and id = v_lead;
  return jsonb_build_object('lead_id', v_lead);
end;
$$;
revoke all on function public.lead_source_test_finish(uuid, text) from public, anon;
grant execute on function public.lead_source_test_finish(uuid, text) to authenticated;

create function public.lead_website_form_clear(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.lead_website_forms where tenant_id = p_tenant_id;
  return jsonb_build_object('cleared', true);
end;
$$;
revoke all on function public.lead_website_form_clear(uuid) from public, anon;
grant execute on function public.lead_website_form_clear(uuid) to authenticated;

do $patch$
declare
  v_def text;
  v_new text;
begin
  -- the cards' numbers: test leads out, a total per tag
  v_def := pg_get_functiondef('public.lead_source_cards_stats(uuid)'::regprocedure);
  v_new := replace(v_def, $a$jsonb_build_object('received_7d', t.n7, 'last_at', t.last_at)$a$, $a$jsonb_build_object('received_7d', t.n7, 'last_at', t.last_at, 'total', t.total)$a$);
  if v_new = v_def then raise exception 'cards_stats: object not found'; end if;
  v_def := v_new;
  v_new := replace(v_def, $a$count(*) filter (where a.received_at > now() - interval '7 days')::int as n7, max(a.received_at) as last_at$a$, $a$count(*) filter (where a.received_at > now() - interval '7 days')::int as n7, max(a.received_at) as last_at, count(*)::int as total$a$);
  if v_new = v_def then raise exception 'cards_stats: counts not found'; end if;
  v_def := v_new;
  v_new := replace(v_def, $a$from public.lead_arrivals a where a.tenant_id = p_tenant_id group by a.source_tag$a$, $a$from public.lead_arrivals a where a.tenant_id = p_tenant_id and not exists (select 1 from public.leads tl where tl.tenant_id = a.tenant_id and tl.id = a.lead_id and tl.is_test) group by a.source_tag$a$);
  if v_new = v_def then raise exception 'cards_stats: arrivals not found'; end if;
  execute v_new;

  -- the Leads badge counts open leads only
  v_def := pg_get_functiondef('public.nav_counts(uuid)'::regprocedure);
  v_new := replace(v_def, $a$l.archived_at is null and l.created_at >= now() - interval '7 days'$a$, $a$l.archived_at is null and not l.is_test and l.status in ('new', 'in_review') and l.created_at >= now() - interval '7 days'$a$);
  if v_new = v_def then raise exception 'nav_counts: new_leads not found'; end if;
  execute v_new;
end
$patch$;
