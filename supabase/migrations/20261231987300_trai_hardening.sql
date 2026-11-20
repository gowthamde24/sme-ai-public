-- TRAI Third Amendment hardening of outbound AI calls (owner via planner, 21 Nov 2026; reports/trai-a2p-gaps.md). NOTHING is switched on: live calls stay off until the owner writes "live".
--   1. the relationship from an enquiry lasts 7 DAYS (the amendment): app.call_back_proof counts a written/digital enquiry for at most 7 days whatever the caller asks for; a PURCHASE keeps its 30 days (the call is about the purchase, phone consent still required).
--   2. phone-only requests no longer count as a proof: a missed call (`missed_calls` source) and a call the person made (`inbound_call`) are not written/digital. The product answers a missed call with a WhatsApp message; the person's written reply is the proof.
--   3. the complaint pause: app.outbound_complaints(tenant, days) counts the customers who asked us to stop on or after our AI call or WhatsApp (or complained) in the last 10 days; at 2 or more the call gate refuses `complaints_pause`
--      (TRAI suspends at 3 with a spam flag, or 5), and the Owner and Admin get a Needs-you item. It lifts by itself when the count falls below 2.

-- the digital proofs only
create or replace function app.call_back_proof(p_tenant uuid, p_contact uuid, p_days integer default 7) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(to_jsonb(x) - 'ord') from (
    select p.lead_id, p.source, p.at, p.ref, 1 as ord from (
      -- an arrival through a live written/digital source (first or again), not a list
      select a.lead_id, a.source_tag as source, a.received_at as at, null::uuid as ref
        from public.lead_arrivals a
       where a.tenant_id = p_tenant and a.contact_id = p_contact and a.kind in ('first', 'again')
         and a.source_tag in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'click_to_whatsapp')
      union all
      -- a lead made before arrivals were kept, from the same sources (never an import, never the owner's own entry, never a prospect)
      select l.id, l.source, l.created_at, null::uuid
        from public.leads l
       where l.tenant_id = p_tenant and l.contact_id = p_contact
         and l.source in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'click_to_whatsapp')
      union all
      -- a WhatsApp message the person sent (written, verifiable)
      select e.lead_id, 'whatsapp', e.received_at, null::uuid
        from public.enquiries e
       where e.tenant_id = p_tenant and e.contact_id = p_contact and e.channel = 'whatsapp' and e.lead_id is not null
      union all
      -- a PURCHASE (owner, 19 Nov 2026): an order of this customer that has reached money or goods; the call is about the purchase, never a pitch; phone consent is checked separately for every call
      select o.lead_id, 'purchase', o.updated_at, o.id
        from public.orders o join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
       where o.tenant_id = p_tenant and l.contact_id = p_contact and o.state in ('advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')
    ) p
    where p.lead_id is not null
      and p.at > app.outbox_now() - make_interval(days => case when p.source = 'purchase' then 30 else least(greatest(coalesce(p_days, 7), 1), 7) end)
    order by p.at desc
    limit 1
  ) x
$$;
revoke all on function app.call_back_proof(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- the customers who asked us to stop on or after our call or WhatsApp (or complained) in the last p_days days
create function app.outbound_complaints(p_tenant uuid, p_days integer default 10) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct e.contact_id)::int
    from public.consent_events e
   where e.tenant_id = p_tenant and e.event_type = 'suppressed'
     and e.created_at > app.outbox_now() - make_interval(days => greatest(coalesce(p_days, 10), 1))
     and (e.suppression_reason::text = 'complained'
          or (e.suppression_reason::text = 'opted_out' and (e.evidence_ref like 'whatsapp:%' or e.evidence_ref like 'call:%' or e.evidence_ref like 'call-list:%')))
$$;
revoke all on function app.outbound_complaints(uuid, integer) from public, anon, authenticated, service_role;

-- the call row may hold the new refusal word
do $patch$
declare
  r record;
begin
  for r in select c.conname, pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.phone_calls'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%no_proof_of_request%' loop
    if position($q$'complaints_pause'$q$ in r.d) = 0 then
      execute format('alter table public.phone_calls drop constraint %I', r.conname);
      execute format('alter table public.phone_calls add constraint %I %s', r.conname, replace(r.d, $q$'no_proof_of_request'$q$, $q$'no_proof_of_request', 'complaints_pause'$q$));
    end if;
  end loop;
end
$patch$;

-- the facts of a call: the same function, with the 7-day proof and the complaint count
create or replace function public.call_facts(p_tenant_id uuid, p_lead_id uuid, p_number text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_lead public.leads;
  v_proof jsonb;
  v_settings jsonb;
  v_today timestamptz := date_trunc('day', app.outbox_now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if auth.uid() is null or p_tenant_id is null or not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  select l.* into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if found then
    select c.* into v_contact from public.contacts c where c.tenant_id = p_tenant_id and c.id = v_lead.contact_id;
  end if;
  select s.settings into v_settings from public.call_settings s where s.tenant_id = p_tenant_id and s.campaign_id is null;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_proof := case when v_contact.id is null then null else app.call_back_proof(p_tenant_id, v_contact.id, 7) end;
  return jsonb_build_object(
    'contact_found', v_contact.id is not null,
    'can_contact', coalesce(v_contact.id is not null and app.phone_tail(v_contact.phone) <> '' and app.phone_tail(v_contact.phone) = app.phone_tail(p_number)
                            and v_contact.phone_consent = 'granted' and v_contact.suppressed_at is null and v_contact.archived_at is null and v_lead.archived_at is null, false),
    'suppressed', coalesce(v_contact.suppressed_at is not null, false),
    'erased_or_archived', coalesce(v_contact.archived_at is not null or v_lead.archived_at is not null, false),
    'proof', v_proof is not null,
    'proof_source', v_proof ->> 'source',
    'complaints_10d', app.outbound_complaints(p_tenant_id, 10),
    'prospect', app.prospect_number_blocked(p_tenant_id, p_number),
    'weekly_calls', case when v_contact.id is null then 0 else (select count(*)::int from public.phone_calls c where c.tenant_id = p_tenant_id and c.contact_id = v_contact.id and c.direction = 'outbound'
                                                                    and c.state <> 'refused' and not c.simulated and c.created_at > app.outbox_now() - interval '7 days') end,
    'weekly_limit', case when jsonb_typeof(v_settings -> 'max_calls_per_customer_per_week') = 'number' then (v_settings ->> 'max_calls_per_customer_per_week')::int else 1 end,
    'calls_today', (select count(*)::int from public.phone_calls c where c.tenant_id = p_tenant_id and c.direction = 'outbound' and c.state <> 'refused' and not c.simulated and c.created_at >= v_today),
    'minutes_today', (select coalesce(sum(coalesce(c.duration_s, 0)), 0)::numeric / 60 from public.phone_calls c where c.tenant_id = p_tenant_id and c.direction = 'outbound' and not c.simulated and c.created_at >= v_today),
    'hours', case when jsonb_typeof(v_settings -> 'hours') = 'object' then v_settings -> 'hours' else null end,
    'holidays', case when jsonb_typeof(v_settings -> 'holidays') = 'array' then v_settings -> 'holidays' else '[]'::jsonb end,
    'active_to_number', (select count(*)::int from public.phone_calls c where c.tenant_id = p_tenant_id and c.state in ('queued', 'ringing', 'in_progress') and c.direction = 'outbound'
                           and v_contact.id is not null and c.contact_id = v_contact.id));
end;
$$;

-- for Today: the pause, for the Owner and Admin of the workspace asking
create function app.today_calls_paused(p_tenant uuid) returns table (id uuid, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('complaints:' || p_tenant::text)::uuid, app.outbox_now()
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) and app.outbound_complaints(p_tenant, 10) >= 2
$$;
revoke all on function app.today_calls_paused(uuid) from public;
grant execute on function app.today_calls_paused(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'      from app.today_templates_needing_change(p_tenant_id) tn\n     where v_decider\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''outreach_paused'', cp.id, ''Calls''::text, null::text, ''followup_desk'', ''complaints'', null::bigint, cp.at, ''calls'', p_tenant_id\n'
    || E'      from app.today_calls_paused(p_tenant_id) cp\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
