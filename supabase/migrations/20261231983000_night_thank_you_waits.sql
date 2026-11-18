-- The night thank-you waits for the morning (owner, 18 Nov 2026): the WhatsApp a standing rule sends when a lead arrives after calling hours (lead_ack, "thank you for contacting us") no longer goes at any hour.
-- It is due when the business's quiet hours end (09:00 India time by default), like every other message; outside quiet hours (say 19:30 with the calling window closed but the evening open) it is due at once.
-- Before, the step was due at the arrival and only the outbox held the message; the rule's summary and the item said "now" and the attempt was written down as sent hours before anything left. Now the item says
-- when it will really go. The morning CALL behind it keeps its own time (the night-call minute, 09:30 by default). `testing_open_hours` (staging, owner's test flag) still makes every hour open.
create or replace function app.outreach_rule_step(r public.outreach_rules, p_t0 timestamptz, out next_action text, out next_at timestamptz, out then_action text, out then_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pol jsonb := app.outreach_pol(r.tenant_id);
  v_t   timestamptz := p_t0 + make_interval(mins => r.within_minutes);
begin
  if app.outreach_in_hours(r.tenant_id, v_t) then
    next_action := 'call'; next_at := v_t;
  elsif r.channel in ('both', 'whatsapp') and (v_pol ->> 'whatsapp_after_hours')::boolean then
    next_action := 'whatsapp'; next_at := app.outbox_next_open(p_t0, r.tenant_id);   -- the morning, never the night
    then_action := 'call'; then_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  else
    next_action := 'call'; next_at := app.outreach_slot(r.tenant_id, app.outreach_next_clock(p_t0, (v_pol ->> 'night_call_minute')::integer));
  end if;
end;
$$;
