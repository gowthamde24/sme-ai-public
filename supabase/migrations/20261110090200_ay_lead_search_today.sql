-- Job AY (ADR 0069), small gaps found by the web (job AV report): (c) a lead search by customer, contact and phone ending, (d) the Today "waiting" count includes the visits Agent OWL proposed.
-- A new migration; earlier files are not edited. public.today_summary is replaced as a full copy of the job AT definition plus the lines marked below (test_migration_copies.py pins that).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- (c) lead search (SECURITY INVOKER: row-level security decides what the caller may see; a lead is read by every member)
--   q with at least 4 digits and nothing else (spaces, +, - allowed) = the END of a phone number (the last digits); anything else = part of the company name or the contact's name (a letter in any script).
--   At least 2 characters. Archived leads are not found. Newest first, paged by (created_at, id). The phone number itself is never returned: only its last four digits.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_search(p_tenant_id uuid, p_q text, p_limit integer default 20, p_after_created_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_q      text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(btrim(coalesce(p_q, '')), '[^0-9]', '', 'g');
  v_phone  boolean;
  v_like   text;
  v_out    jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_phone := v_q ~ '^[0-9 +().-]+$' and char_length(v_digits) >= 4;
  if char_length(v_q) < 2 or char_length(v_q) > 60 or p_limit is null or p_limit not between 1 and 50 or not app.text_is_clean(v_q) or (v_digits <> '' and not v_phone and v_q ~ '^[0-9 +().-]+$')
     or ((p_after_created_at is null) <> (p_after_id is null)) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(r.j order by r.created_at desc, r.id desc), '[]'::jsonb) into v_out
    from (
      select l.id, l.created_at,
             jsonb_build_object('lead_id', l.id, 'company', c.name, 'city', c.city, 'contact_name', k.full_name,
                                'phone_last4', case when k.phone is null then null else right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 4) end,
                                'created_at', l.created_at) as j
        from public.leads l
        left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
        left join public.contacts k on k.tenant_id = l.tenant_id and k.id = l.contact_id
       where l.tenant_id = p_tenant_id and l.archived_at is null
         and (case when v_phone then k.phone is not null and right(regexp_replace(k.phone, '[^0-9]', '', 'g'), char_length(v_digits)) = v_digits
                   else c.name ilike v_like escape '\' or k.full_name ilike v_like escape '\' end)
         and (p_after_created_at is null or (l.created_at, l.id) < (p_after_created_at, p_after_id))
       order by l.created_at desc, l.id desc
       limit p_limit
    ) r;
  return v_out;
end;
$$;
revoke all on function public.lead_search(uuid, text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.lead_search(uuid, text, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- (d) Today: the waiting count includes the visits Agent OWL proposed (a full copy of the job AT function plus the declared variable and one block)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.today_summary(p_tenant_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_decider boolean;
  v_owner   boolean;
  v_reader  boolean;
  v_needs   jsonb;
  v_waiting integer;
  v_visits  integer := 0;
  v_held    bigint := 0;
  v_open    integer := 0;
  v_recent  jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not (select app.is_tenant_member(p_tenant_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_decider := (select app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]));
  v_owner   := (select app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]));
  v_reader  := (select app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]));

  with items as (
    select 'quote_approval'::text as kind, qt.id, c.name as customer, c.city, 'quote_writer'::text as agent,
           qt.quote_no::text as ref, qt.total_paise as amount_paise, qt.created_at as at, 'quote'::text as target_type, qt.id as target_id
      from public.quotes qt
      left join public.leads l on l.tenant_id = qt.tenant_id and l.id = qt.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and qt.tenant_id = p_tenant_id and qt.status = 'draft'
    union all
    select 'followup_due', d.id, c.name, c.city, 'followup_desk', d.touch_number::text, null::bigint, d.created_at, 'lead', d.lead_id
      from public.followup_drafts d
      left join public.leads l on l.tenant_id = d.tenant_id and l.id = d.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and d.tenant_id = p_tenant_id and d.status = 'draft'
    union all
    select 'order_money_held', o.id, c.name, c.city, 'order_desk', o.order_no::text, g.net_paise, coalesce(o.closed_at, o.updated_at), 'order', o.id
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
      left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and o.tenant_id = p_tenant_id and o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0
    union all
    select 'outbox_approval', m.id, c.name, c.city, 'followup_desk', m.category, null::bigint, m.created_at, 'outbox_message', m.id
      from public.outbox_messages m
      left join public.leads l on l.tenant_id = m.tenant_id and l.id = m.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and m.tenant_id = p_tenant_id and m.status = 'needs_approval'
    union all
    select 'call_approval', r.id, c.name, c.city, 'followup_desk', 'call', null::bigint, r.created_at, 'call_request', r.id
      from public.call_requests r
      left join public.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and r.tenant_id = p_tenant_id and r.status = 'requested'
  ), top as (
    select * from items order by at desc, id limit 20
  )
  select (select count(*) from items)::integer,
         coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'id', t.id, 'customer', t.customer, 'city', t.city, 'agent', t.agent,
                                                       'ref', t.ref, 'amount_paise', t.amount_paise, 'at', t.at,
                                                       'target', jsonb_build_object('type', t.target_type, 'id', t.target_id)) order by t.at desc, t.id) from top t), '[]'::jsonb)
    into v_waiting, v_needs;

  -- a visit Agent OWL PROPOSED (booked, source assistant, still to come within about two months, by the database clock) waits for a person to confirm it: Owner, Admin and Sales decide it. It is counted here so the menu's
  -- badge equals the cards on the page; it is not (yet) an item of the list below.
  if v_reader then
    select count(*)::integer into v_visits
      from public.store_visits v
     where v.tenant_id = p_tenant_id and v.status = 'booked' and v.source = 'assistant'
       and v.starts_at >= now() and v.starts_at < now() + interval '61 days';
    v_waiting := v_waiting + v_visits;
  end if;

  if v_reader then
    select coalesce(sum(g.net_paise) filter (where o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0), 0)::bigint,
           count(*) filter (where o.closed_at is null)::integer
      into v_held, v_open
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
     where o.tenant_id = p_tenant_id;

    select coalesce(jsonb_agg(r.j order by r.at desc, r.id desc), '[]'::jsonb)
      into v_recent
      from (select e.recorded_at as at, e.id,
                   jsonb_build_object('order_no', o.order_no, 'order_id', o.id, 'customer', c.name, 'type', e.type, 'new_state', e.new_state,
                                      'amount_paise', e.amount_paise, 'at', e.recorded_at) as j
              from public.order_events e
              join public.orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
              left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
              left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
             where e.tenant_id = p_tenant_id
             order by e.recorded_at desc, e.id desc
             limit 5) r;
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_object('waiting', v_waiting, 'money_held_paise', v_held, 'orders_open', v_open),
    'needs_you', v_needs,
    'recent', v_recent);
end;
$$;
