-- Live call-backs: the facts the call gate needs about ONE planned call, read from the database in one place (planner, 19 Nov 2026). The sandbox and the live path ask the SAME question; only the dialer differs.
-- public.call_facts(tenant, lead, number) answers about the lead's contact and the number about to be dialled:
--   * can_contact   phone consent granted (a form tick or a recorded yes with how it was given) AND the dialled number is the contact's own number (app.can_contact)
--   * suppressed    the contact said STOP (or was suppressed): never again
--   * erased_or_archived   the contact or the lead is archived
--   * proof         a request of the person's own within 30 days (app.call_back_proof: a form, a lead ad, a portal e-mail, a message or a call they made, or a purchase) and the source of it
--   * prospect      the number is a Lead Finder prospect who never asked
--   * weekly_calls, weekly_limit   real outbound calls to this contact in the last 7 days, and the workspace's limit (call_settings, default 1)
--   * calls_today, minutes_today   the workspace's real outbound calls and minutes today (India day)
--   * hours, holidays              the workspace's calling hours and holidays (call_settings), else null
--   * active_to_number             a call to this number that is still queued, ringing or in progress

create function public.call_facts(p_tenant_id uuid, p_lead_id uuid, p_number text) returns jsonb
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
  v_proof := case when v_contact.id is null then null else app.call_back_proof(p_tenant_id, v_contact.id, 30) end;
  return jsonb_build_object(
    'contact_found', v_contact.id is not null,
    'can_contact', coalesce(v_contact.id is not null and app.phone_tail(v_contact.phone) <> '' and app.phone_tail(v_contact.phone) = app.phone_tail(p_number)
                            and v_contact.phone_consent = 'granted' and v_contact.suppressed_at is null and v_contact.archived_at is null and v_lead.archived_at is null, false),
    'suppressed', coalesce(v_contact.suppressed_at is not null, false),
    'erased_or_archived', coalesce(v_contact.archived_at is not null or v_lead.archived_at is not null, false),
    'proof', v_proof is not null,
    'proof_source', v_proof ->> 'source',
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
revoke all on function public.call_facts(uuid, uuid, text) from public, anon;
grant execute on function public.call_facts(uuid, uuid, text) to authenticated;
comment on function public.call_facts(uuid, uuid, text) is 'The facts the call gate needs about one planned call (consent, STOP, archive, proof of request, prospect, weekly and daily counts, hours, holidays, active calls), read in one place for the sandbox and the live path. Owner, Admin, the phone server.';
