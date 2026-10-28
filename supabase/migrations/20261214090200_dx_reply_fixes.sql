-- Job DX (28 Oct 2026, found in the first real WhatsApp round trip on staging). Two fixes to the send policy, as full copies of the functions in which ONLY the lines named below differ.
--
-- 1. QUIET HOURS DO NOT HOLD A REPLY INSIDE AN ACTIVE CONVERSATION. Quiet hours (21:00 to 09:00 India time by default) are for messages the BUSINESS starts. A message is "inside an active conversation" when the customer's
--    latest WhatsApp message to this lead arrived at most 30 minutes (inclusive) before the moment that counts (inside the 24-hour window by construction) and the message is not a follow-up. Such a reply goes now; a follow-up, a
--    reminder or a campaign still waits for morning. The moment that counts: when the message is made (decide_content), when the Owner approves it (outbox_decide), and, at release, when it was decided or made
--    (claim_due_core), so a worker that is a few minutes late does not turn a reply into a held message. Changed lines: the quiet-hours test of decide_content and claim_due_core, the scheduled_for of outbox_decide.
-- 2. THE "from the business's AI assistant" LINE LABELS ONLY WHAT THE ASSISTANT WROTE. It was added to the first message to a customer whoever wrote it. Now it is added only when the message's source is `assistant` AND the
--    Owner's "mention that I'm an AI assistant" setting is on (the same switch as the opening line; on by default). A reply a person typed (source `owner`) never gets it. Changed lines: the condition in outbox_submit_core.

create function app.outbox_active_conversation(p_tenant uuid, p_lead uuid, p_category text, p_at timestamptz) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_category is distinct from 'followup'
     and coalesce(greatest(
           (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_at),
           (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_at)
         ) >= p_at - interval '30 minutes', false)
$$;
revoke all on function app.outbox_active_conversation(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;

create function app.outbox_mention_ai(p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.mention_ai from workspace.opening_settings s where s.workspace_id = p_tenant and s.campaign_key = '00000000-0000-0000-0000-000000000000'), true)
$$;
revoke all on function app.outbox_mention_ai(uuid) from public, anon, authenticated, service_role;

create or replace function app.outbox_decide_content(
  p_tenant uuid, p_lead uuid, p_body text, p_category text, p_model_flagged boolean, p_uncertain boolean, p_now timestamptz
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_flags   text[] := app.outbox_content_flags(p_body);
  v_inbound timestamptz;
  v_window  boolean;
  v_text_in text;
  v_reason  text;
begin
  select greatest(
           (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now),
           (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_now))
    into v_inbound;
  v_window := v_inbound is not null and v_inbound > p_now - interval '24 hours';
  -- a complaint in the customer's latest message makes the reply a person's call, whatever the reply says
  if v_window then
    select e.body into v_text_in from public.enquiries e
     where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now
     order by e.received_at desc, e.id desc limit 1;
    if 'complaint' = any (app.outbox_content_flags(v_text_in)) and not 'complaint' = any (v_flags) then
      v_flags := v_flags || 'complaint'::text;
    end if;
  end if;

  v_reason := case
    when 'money' = any (v_flags) then 'money'
    when 'commitment' = any (v_flags) then 'commitment'
    when 'complaint' = any (v_flags) then 'complaint'
    when p_model_flagged then 'model_flagged'
    when p_uncertain then 'uncertain'
    when p_category = 'other' then 'category_other'
    when p_category = 'reply_to_inbound' and not v_window then 'no_inbound_window'
    when not coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant), false) then 'auto_off'
    else null
  end;
  if v_reason is not null then
    return jsonb_build_object('status', 'needs_approval', 'reason', v_reason, 'flags', to_jsonb(v_flags), 'scheduled_for', null);
  end if;
  if app.outbox_in_quiet_hours(p_now, p_tenant) and not app.outbox_active_conversation(p_tenant, p_lead, p_category, p_now) then
    return jsonb_build_object('status', 'queued', 'reason', 'quiet_hours', 'flags', to_jsonb(v_flags), 'scheduled_for', app.outbox_next_open(p_now, p_tenant));
  end if;
  return jsonb_build_object('status', 'queued', 'reason', 'auto_allowed', 'flags', to_jsonb(v_flags), 'scheduled_for', p_now);
end;
$$;

create or replace function public.outbox_decide(p_tenant_id uuid, p_message_id uuid, p_decision text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := app.outbox_now();
  m      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    perform app.outbox_error('invalid');
  end if;
  if p_decision = 'approve' then
    perform app.require_aal2();
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status <> 'needs_approval' then
    perform app.outbox_error('state');
  end if;
  if p_decision = 'reject' then
    update public.outbox_messages set status = 'blocked', reason = 'owner_rejected', decided_by = v_uid, decided_at = v_now, scheduled_for = null
     where id = m.id returning * into m;
    return app.outbox_row_json(m, false);
  end if;
  if m.contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || m.contact_id::text, 0));
    select * into c from public.contacts x where x.id = m.contact_id and x.tenant_id = p_tenant_id;
  end if;
  v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, m.id, v_now) end;
  if v_hard is not null then
    update public.outbox_messages set status = 'blocked', reason = v_hard, decided_by = v_uid, decided_at = v_now, scheduled_for = null
     where id = m.id returning * into m;
    return app.outbox_row_json(m, false);
  end if;
  update public.outbox_messages
     set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = case when app.outbox_active_conversation(p_tenant_id, m.lead_id, m.category, v_now) then v_now else app.outbox_next_open(v_now, p_tenant_id) end
   where id = m.id returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;

create or replace function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer, p_approved_only boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now  timestamptz := app.outbox_now();
  v_out  jsonb := '[]'::jsonb;
  r      public.outbox_messages;
  c      public.contacts;
  v_hard text;
  v_held boolean;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_approved_only is null then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  if app.billing_read_only(p_tenant_id) then
    return v_out;   -- job DI: the trial ended unpaid; read-only: nothing is sent, nothing is lost
  end if;
  v_held := app.billing_stopped(p_tenant_id, 'whatsapp_messages');   -- job DI: 100 percent of the period's business-initiated messages (or none included)
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (not p_approved_only or x.reason = 'owner_approved')
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
       and (not v_held or x.category = 'reply_to_inbound')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now, p_tenant_id) and not app.outbox_active_conversation(p_tenant_id, r.lead_id, r.category, coalesce(r.decided_at, r.created_at)) then
      update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now, p_tenant_id) where id = r.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || coalesce(r.contact_id::text, r.id::text), 0));
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, r.id, v_now) end;
    if v_hard is not null then
      update public.outbox_messages set status = 'blocked', reason = v_hard, scheduled_for = null where id = r.id;
      continue;
    end if;
    update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id returning * into r;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language,
      'attempts', r.attempts, 'wa', app.wa_send_context(r, v_now),
      'media', coalesce((select jsonb_agg(jsonb_build_object('photo_id', ph.id, 'bucket', ph.bucket, 'path', ph.path, 'content_type', ph.content_type) order by md.position)
                           from public.outbox_message_media md join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id and ph.removed_at is null
                          where md.tenant_id = r.tenant_id and md.message_id = r.id), '[]'::jsonb)));
  end loop;
  return v_out;
end;
$$;

create or replace function app.outbox_submit_core(
  p_actor uuid, p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false,
  p_media uuid[] default '{}', p_keep_record boolean default false, p_gloss_en text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now     timestamptz := app.outbox_now();
  v_text    text := btrim(coalesce(p_body, ''));
  v_lead    public.leads;
  v_contact public.contacts;
  v_sha     text;
  v_old     public.outbox_messages;
  v_hard    text;
  v_dec     jsonb;
  v_body    text;
  v_disc    text;
  v_added   boolean := false;
  v_status  text;
  v_reason  text;
  v_flags   text[];
  v_sched   timestamptz;
  m         public.outbox_messages;
  v_media   uuid[] := coalesce(p_media, '{}');
  v_n       integer;
  v_gloss   text := nullif(btrim(coalesce(p_gloss_en, '')), '');
begin
  if p_actor is null or p_tenant_id is null then
    perform app.outbox_error('deny');
  end if;
  if p_message_id is null or p_lead_id is null or p_channel is distinct from 'whatsapp' or char_length(v_text) not between 2 and 3000
     or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')
     or p_category is null or p_category not in ('reply_to_inbound', 'info', 'visit', 'followup', 'order_status', 'other')
     or p_source is null or p_source not in ('assistant', 'owner', 'system')
     or p_model_flagged is null or p_uncertain is null or not app.text_is_clean(v_text) then
    perform app.outbox_error('invalid');
  end if;
  if v_gloss is not null and (char_length(v_gloss) not between 2 and 3000 or not app.text_is_clean(v_gloss)) then
    perform app.outbox_error('invalid');
  end if;
  if p_keep_record is null or cardinality(v_media) > 4 or (select count(distinct x) from unnest(v_media) x) <> cardinality(v_media) or exists (select 1 from unnest(v_media) x where x is null) then
    perform app.outbox_error('invalid');
  end if;

  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text)
                                    || case when cardinality(v_media) > 0 then '|media:' || array_to_string(v_media, ',') else '' end
                                    || case when p_keep_record then '|keep' else '' end
                                    || case when v_gloss is not null then '|gloss:' || v_gloss else '' end, 'UTF8')), 'hex');

  -- a retry: the same words under the same id replay; other words conflict
  select * into v_old from public.outbox_messages x where x.id = p_message_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then
      perform app.outbox_error('conflict');
    end if;
    return app.outbox_row_json(v_old, true);
  end if;

  select * into v_lead from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if v_lead.archived_at is not null then
    perform app.outbox_error('invalid');
  end if;
  if cardinality(v_media) > 0 then
    select count(*) into v_n from public.catalogue_photos ph join public.catalogue_items it on it.tenant_id = ph.tenant_id and it.id = ph.item_id
     where ph.tenant_id = p_tenant_id and ph.id = any (v_media) and ph.removed_at is null and it.active;
    if v_n <> cardinality(v_media) then
      perform app.outbox_error('reference');
    end if;
  end if;
  if v_lead.contact_id is not null then
    -- serialise the messages of one customer: the daily count and "the first message" must not race
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || v_lead.contact_id::text, 0));
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant_id;
  end if;

  v_body := v_text;
  if v_contact.id is not null and p_source = 'assistant' and app.outbox_mention_ai(p_tenant_id) then
    v_disc := app.outbox_disclosure(p_language);
    if not exists (select 1 from public.outbox_messages x where x.tenant_id = p_tenant_id and x.contact_id = v_contact.id and x.disclosure_added and x.status in ('queued', 'needs_approval', 'sent'))
       and position(v_disc in v_body) = 0 then
      v_body := v_body || E'\n\n' || v_disc;
      v_added := true;
    end if;
  end if;

  v_hard := case when v_contact.id is null then (case when app.outbox_switch_on() then 'no_contact' else 'switch_off' end)
                 else app.outbox_hard_block(p_tenant_id, v_contact, null, v_now) end;
  v_flags := app.outbox_content_flags(v_text);
  if v_hard is not null then
    v_status := 'blocked'; v_reason := v_hard; v_sched := null;
  else
    v_dec := app.outbox_decide_content(p_tenant_id, p_lead_id, v_text, p_category, p_model_flagged, p_uncertain, v_now);
    v_status := v_dec ->> 'status';
    v_reason := v_dec ->> 'reason';
    v_flags := array(select jsonb_array_elements_text(v_dec -> 'flags'));
    v_sched := nullif(v_dec ->> 'scheduled_for', '')::timestamptz;
  end if;

  insert into public.outbox_messages
    (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, flags, model_flagged, uncertain,
     disclosure_added, request_sha256, scheduled_for, created_by, created_at, keep_record, gloss_en)
  values
    (p_message_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_channel, v_body, p_language, p_category, p_source, v_status, v_reason, v_flags,
     p_model_flagged, p_uncertain, v_added, v_sha, v_sched, p_actor, v_now, p_keep_record, v_gloss)
  returning * into m;
  insert into public.outbox_message_media (tenant_id, message_id, photo_id, position)
  select p_tenant_id, p_message_id, x.photo_id, x.n::smallint from unnest(v_media) with ordinality as x(photo_id, n);
  return app.outbox_row_json(m, false);
end;
$$;
