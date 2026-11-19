-- THE NIGHT RULE, as the owner wants it (19 Nov 2026; it replaces the 18 Nov "the night thank-you waits" for fresh enquiries and widens the old 30-minute reply rule):
-- quiet hours (21:00 to 09:00 India time) hold only the messages WE start (follow-ups, reminders, nudges, offers, a late import's thank-you) and the CALLS. A message that ANSWERS a customer who wrote first goes AT ONCE, at any hour:
--   (a) the thank-you after a form or lead-ad enquiry goes at once when the enquiry is FRESH (arrived within the last 15 minutes); an older one (a sheet import, a late sync, a retry) waits for 09:00;
--   (b) a reply to the customer's own WhatsApp message goes at once, inside the 24-hour window: the message the owner types in a chat, and the composer's queued message released by the customer's reply.
-- The reply rule used to be "the customer's last message at most 30 minutes ago": that stays for every other kind of message; a reply (category reply_to_inbound) now uses the whole window. Calls keep the calling hours.
-- app.outbox_active_conversation is the ONE place that decides it (make, approve and release all ask it), and campaign_submit and the rule step ask it too.

create or replace function app.outbox_active_conversation(p_tenant uuid, p_lead uuid, p_category text, p_at timestamptz) returns boolean
language sql
stable
set search_path = ''
as $$
  with last_in as (
    select greatest(
             (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_at),
             (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_at)) as at
  )
  select p_category is distinct from 'followup' and (
           -- a conversation under way: the customer's latest WhatsApp message at most 30 minutes ago
           coalesce((select l.at from last_in l) >= p_at - interval '30 minutes', false)
           -- a reply to the customer's own message, inside the 24-hour window (owner, 19 Nov 2026)
        or (p_category = 'reply_to_inbound' and coalesce((select l.at from last_in l) >= p_at - interval '24 hours', false))
           -- the thank-you to an enquiry that is FRESH: a form or a lead ad that arrived at most 15 minutes ago (owner, 19 Nov 2026)
        or (p_category = 'campaign_reminder' and exists (
              select 1 from public.lead_arrivals a
               where a.tenant_id = p_tenant and a.lead_id = p_lead and a.kind in ('first', 'again') and a.received_at <= p_at and a.received_at >= p_at - interval '15 minutes'
                 and a.source_tag in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'missed_calls', 'click_to_whatsapp'))))
$$;

-- a rule or campaign message is held to the morning unless it is the thank-you to a fresh enquiry (patched in place: the function has been changed by later migrations)
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_submit(uuid, uuid, uuid, uuid, text, text, boolean)'::regprocedure);
  v_old text := 'v_sched := case when app.outbox_in_quiet_hours(v_now, p_tenant) then app.outbox_next_open(v_now, p_tenant) else v_now end;';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'campaign_submit has changed: the night rule patch no longer fits';
  end if;
  execute replace(v_def, v_old, 'v_sched := case when app.outbox_in_quiet_hours(v_now, p_tenant) and not app.outbox_active_conversation(p_tenant, p_lead, ''campaign_reminder'', v_now) then app.outbox_next_open(v_now, p_tenant) else v_now end;');
end;
$patch$;

-- the rule engine: the WhatsApp thank-you of a lead that arrives after calling hours is due AT ONCE when the enquiry is fresh (a step run within 15 minutes of the arrival), else at 09:00; the call keeps its morning time
do $patch$
declare
  v_def text := pg_get_functiondef('app.outreach_rule_step(public.outreach_rules, timestamptz)'::regprocedure);
  v_old text := 'next_at := app.outbox_next_open(p_t0, r.tenant_id);   -- the morning, never the night';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'outreach_rule_step has changed: the night rule patch no longer fits';
  end if;
  execute replace(v_def, v_old, 'next_at := case when app.outbox_now() - p_t0 <= interval ''15 minutes'' then p_t0 else app.outbox_next_open(p_t0, r.tenant_id) end;   -- at once for a fresh enquiry (owner, 19 Nov 2026), else the morning');
end;
$patch$;
