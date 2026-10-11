-- Job AT, CI fix: the outbox reads its clock through ONE seam, app.outbox_now(), so a test can pin the time (quiet hours 21:00-09:00 India time make the
-- same message "queued for 09:00" at night and "ready now" by day; a test that leaned on the real clock passed at night and failed in the daytime).
--
-- In production the seam is exactly now() (a STABLE function, so it is the transaction's start, as before). There is NO setting, header or argument that
-- changes it: a test replaces the function for its own transaction (rolled back at the end), the same way pgTAP 73 replaces app.agent_utc_today().
-- The four functions below are whole copies of the ones in 20261106090000_at_outbox.sql with the clock read changed (and the new row's created_at set from the
-- same instant, so the per-customer daily count and the decision use one clock). test_migration_copies.py pins that nothing else was dropped.
-- Their grants (revoke/grant) are kept by "create or replace".

create function app.outbox_now() returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$ select now() $$;
revoke all on function app.outbox_now() from public, anon, authenticated, service_role;
comment on function app.outbox_now() is 'The outbox clock: now(). Tests replace it inside their own transaction to pin quiet hours; nothing at run time can.';

create or replace function public.outbox_submit(
  p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
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
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_message_id is null or p_lead_id is null or p_channel is distinct from 'whatsapp' or char_length(v_text) not between 2 and 3000
     or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta')
     or p_category is null or p_category not in ('reply_to_inbound', 'info', 'visit', 'followup', 'order_status', 'other')
     or p_source is null or p_source not in ('assistant', 'owner', 'system')
     or p_model_flagged is null or p_uncertain is null or not app.text_is_clean(v_text) then
    perform app.outbox_error('invalid');
  end if;

  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text), 'UTF8')), 'hex');

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
  if v_lead.contact_id is not null then
    -- serialise the messages of one customer: the daily count and "the first message" must not race
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || v_lead.contact_id::text, 0));
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant_id;
  end if;

  v_body := v_text;
  if v_contact.id is not null then
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
     disclosure_added, request_sha256, scheduled_for, created_by, created_at)
  values
    (p_message_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_channel, v_body, p_language, p_category, p_source, v_status, v_reason, v_flags,
     p_model_flagged, p_uncertain, v_added, v_sha, v_sched, v_uid, v_now)
  returning * into m;
  return app.outbox_row_json(m, false);
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
     set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = app.outbox_next_open(v_now)
   where id = m.id returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;

create or replace function public.outbox_claim_due(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := app.outbox_now();
  v_out  jsonb := '[]'::jsonb;
  r      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now) then
      update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now) where id = r.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || coalesce(r.contact_id::text, r.id::text), 0));
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, r.id, v_now) end;
    if v_hard is not null then
      update public.outbox_messages set status = 'blocked', reason = v_hard, scheduled_for = null where id = r.id;
      continue;
    end if;
    update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language));
  end loop;
  return v_out;
end;
$$;

create or replace function public.outbox_mark(
  p_tenant_id uuid, p_message_id uuid, p_outcome text, p_adapter text, p_adapter_message_id text default null, p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m     public.outbox_messages;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'failed') or p_adapter is distinct from 'fake'
     or (p_outcome = 'sent' and (p_adapter_message_id is null or char_length(p_adapter_message_id) not between 1 and 100))
     or (p_outcome = 'failed' and (p_failure_code is null or p_failure_code not in ('adapter_error', 'timeout', 'rejected'))) then
    perform app.outbox_error('invalid');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status = p_outcome then
    return app.outbox_row_json(m, true);
  end if;
  if m.status <> 'queued' or m.claimed_at is null then
    perform app.outbox_error('state');
  end if;
  if p_outcome = 'sent' then
    update public.outbox_messages set status = 'sent', sent_at = app.outbox_now(), adapter = p_adapter, adapter_message_id = p_adapter_message_id where id = m.id returning * into m;
  else
    update public.outbox_messages set status = 'failed', reason = 'send_failed', failure_code = p_failure_code where id = m.id returning * into m;
  end if;
  return app.outbox_row_json(m, false);
end;
$$;
