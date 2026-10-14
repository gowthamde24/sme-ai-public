-- Job CP (wave 3, C1, ADR 0086), migration 3 of 3: THE RUNNER, THE CALL LIST AND THE RESULTS.
--
--   app.campaign_submit          one campaign message into the outbox: the same checks as every message (contact, STOP, suppression key, consent, daily limit, kill switch, first-message disclosure)
--                                with ONE difference, stated by the Owner's decision: the money words of an approved campaign do not hold the message for a person (the Owner approved the whole campaign).
--                                A name that reads as a promise or a complaint still holds it. Category campaign_reminder, reason campaign_approved, source system.
--   app.campaign_step_run        one planned step at its time: still what was approved? person still open? paid since? template still approved? then render and submit, with an id derived from
--                                (campaign, person, step, due date), so a retry or a second worker cannot send twice.
--   public.scheduler_campaign_run   the worker's entry (the scheduler principal; both switches on; module campaigns): runs the due steps, then the call list, then closes finished campaigns.
--   public.call_list_items       the CALL LIST: after step N, a person who did not reply and has not paid becomes a call request (approved WITH the campaign by the Owner who approved it) and an item on this list.
--                                Staff place the call through the existing bridge (Owner/Admin, 09:00 to 21:00, never a stopped or erased contact) and record the outcome: paid, promised (a date), call later, wrong number, stop.
--   public.campaign_results      counts by state, by reason and by day; replied; paid after a reminder; the call list.
--
-- Modules: the runner and the campaigns need `campaigns`; the call list needs `call_list` (so textiles can use a call list without campaigns). SQLSTATEs as in migration 2 (SM801 state).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the call list
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.call_list_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  campaign_id     uuid not null,
  recipient_id    uuid not null,
  call_request_id uuid not null,
  lead_id         uuid not null,
  contact_id      uuid not null,
  step_no         smallint not null check (step_no between 1 and 5),
  status          text not null default 'open' check (status in ('open', 'done')),
  outcome         text check (outcome in ('paid', 'promised', 'call_later', 'wrong_number', 'stop')),
  promised_on     date,
  call_after      timestamptz,
  attempts        smallint not null default 0 check (attempts between 0 and 50),
  created_at      timestamptz not null default now(),
  outcome_at      timestamptz,
  recorded_by     uuid,
  unique (tenant_id, id),
  unique (tenant_id, recipient_id),
  unique (tenant_id, call_request_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, recipient_id) references public.campaign_recipients (tenant_id, id),
  foreign key (tenant_id, call_request_id) references public.call_requests (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check ((status = 'done') = (outcome is not null and outcome <> 'call_later')),
  check ((outcome = 'promised') = (promised_on is not null))
);
create index call_list_items_keyset_idx on public.call_list_items (tenant_id, created_at, id);
create index call_list_items_campaign_idx on public.call_list_items (tenant_id, campaign_id);
create index call_list_items_lead_idx on public.call_list_items (tenant_id, lead_id);
create index call_list_items_contact_idx on public.call_list_items (tenant_id, contact_id);
create index call_list_items_open_idx on public.call_list_items (tenant_id, coalesce(call_after, created_at), id) where status = 'open';
comment on column public.call_list_items.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.call_list_items.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create function app.call_list_items_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'a call list item is never deleted' using errcode = '42501';
  end if;
  if old.status = 'done' or (to_jsonb(new) - 'status' - 'outcome' - 'promised_on' - 'call_after' - 'attempts' - 'outcome_at' - 'recorded_by')
                            is distinct from (to_jsonb(old) - 'status' - 'outcome' - 'promised_on' - 'call_after' - 'attempts' - 'outcome_at' - 'recorded_by') then
    raise exception 'a call list item changes only by recording an outcome, until it is done' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.call_list_items_guard() from public;
create trigger call_list_items_guard before update or delete on public.call_list_items for each row execute function app.call_list_items_guard();
create trigger call_list_items_no_truncate before truncate on public.call_list_items for each statement execute function app.call_list_items_guard();
create trigger call_list_items_forbid_tenant_id_change before update on public.call_list_items for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.call_list_items for each row execute function app.module_guard('call_list');
create trigger audit_call_list_items after insert or update or delete on public.call_list_items for each row execute function app.audit_row_change('call_list_item', '');
alter table public.call_list_items enable row level security;
alter table public.call_list_items force row level security;
revoke all on public.call_list_items from public, anon, authenticated, service_role;
grant select on public.call_list_items to authenticated;
create policy call_list_items_select on public.call_list_items for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- one message
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the id of one reminder: the same campaign, person, step and due date make the same id on every worker
create function app.campaign_message_id(p_campaign uuid, p_recipient uuid, p_step integer, p_due date) returns uuid
language sql
immutable
set search_path = ''
as $$ select app.agent_derived_id(p_campaign, 'r:' || p_recipient::text || ':s:' || p_step::text || ':d:' || p_due::text, 'campaign_message') $$;
revoke all on function app.campaign_message_id(uuid, uuid, integer, date) from public;

-- has this lead written to us on WhatsApp after `p_after`?
create function app.campaign_replied(p_tenant uuid, p_lead uuid, p_after timestamptz) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at > p_after)
      or exists (select 1 from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at > p_after)
$$;
revoke all on function app.campaign_replied(uuid, uuid, timestamptz) from public;

-- The campaign's message into the outbox. The caller holds no lock; this takes the contact's (like every message). A hard block (switch, erased, stopped, no number, no key, no opt-in, daily limit) is recorded as a
-- BLOCKED outbox message with its reason, exactly as for any message. A text that reads as a promise or a complaint (a name can) is held for a person; the money words are the Owner's approved campaign.
create function app.campaign_submit(p_actor uuid, p_message_id uuid, p_tenant uuid, p_lead uuid, p_body text, p_language text) returns jsonb
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
  v_body    text;
  v_disc    text;
  v_added   boolean := false;
  v_status  text;
  v_reason  text;
  v_flags   text[];
  v_sched   timestamptz;
  m         public.outbox_messages;
begin
  if p_actor is null or p_message_id is null or p_tenant is null or p_lead is null or char_length(v_text) not between 2 and 3000 or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta')
     or not app.text_is_clean(v_text) then
    perform app.campaign_error('invalid');
  end if;
  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead, 'whatsapp', 'campaign_reminder', p_language, 'system', false, false, v_text), 'UTF8')), 'hex');
  select * into v_old from public.outbox_messages x where x.id = p_message_id;
  if found then
    if v_old.tenant_id <> p_tenant or v_old.request_sha256 <> v_sha then
      perform app.campaign_error('conflict');
    end if;
    return app.outbox_row_json(v_old, true);
  end if;
  select * into v_lead from public.leads l where l.id = p_lead and l.tenant_id = p_tenant;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if v_lead.contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || v_lead.contact_id::text, 0));
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant;
  end if;
  v_body := v_text;
  if v_contact.id is not null then
    v_disc := app.outbox_disclosure(p_language);
    if not exists (select 1 from public.outbox_messages x where x.tenant_id = p_tenant and x.contact_id = v_contact.id and x.disclosure_added and x.status in ('queued', 'needs_approval', 'sent'))
       and position(v_disc in v_body) = 0 then
      v_body := v_body || E'\n\n' || v_disc;
      v_added := true;
    end if;
  end if;
  v_hard := case when v_contact.id is null then (case when app.outbox_switch_on() then 'no_contact' else 'switch_off' end)
                 else app.outbox_hard_block(p_tenant, v_contact, null, v_now) end;
  v_flags := app.outbox_content_flags(v_text);
  if v_hard is not null then
    v_status := 'blocked'; v_reason := v_hard; v_sched := null;
  elsif 'commitment' = any (v_flags) or 'complaint' = any (v_flags) then
    v_status := 'needs_approval'; v_reason := case when 'commitment' = any (v_flags) then 'commitment' else 'complaint' end; v_sched := null;
  else
    v_status := 'queued'; v_reason := 'campaign_approved';
    v_sched := case when app.outbox_in_quiet_hours(v_now, p_tenant) then app.outbox_next_open(v_now, p_tenant) else v_now end;
  end if;
  insert into public.outbox_messages
    (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, flags, model_flagged, uncertain,
     disclosure_added, request_sha256, scheduled_for, created_by, created_at)
  values
    (p_message_id, p_tenant, p_lead, v_contact.id, v_lead.company_id, 'whatsapp', v_body, p_language, 'campaign_reminder', 'system', v_status, v_reason, v_flags,
     false, false, v_added, v_sha, v_sched, p_actor, v_now)
  returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function app.campaign_submit(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- skip a step with a closed reason (a step moves forward once)
create function app.campaign_step_skip(p_step uuid, p_reason text) returns void
language sql
set search_path = ''
as $$ update public.campaign_steps set status = 'skipped', reason = p_reason, materialised_at = app.outbox_now() where id = p_step and status = 'planned' $$;
revoke all on function app.campaign_step_skip(uuid, text) from public, anon, authenticated, service_role;

-- ONE planned step at its time. Returns what happened: queued | held | blocked | skipped | reset.
create function app.campaign_step_run(p_actor uuid, s public.campaign_steps) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_now  timestamptz := app.outbox_now();
  c      public.campaigns;
  r      public.campaign_recipients;
  ct     public.contacts;
  v_tpl  text;
  v_out  bigint;
  v_biz  text;
  v_id   uuid;
  v_res  jsonb;
begin
  select * into c from public.campaigns x where x.tenant_id = s.tenant_id and x.id = s.campaign_id for update;
  if c.status not in ('approved', 'running') then
    return 'skipped';  -- paused, cancelled or finished since the list was read
  end if;
  -- the campaign is still exactly what the Owner approved, or nothing is sent and it goes back to draft
  if app.campaign_content_sha(s.tenant_id, s.campaign_id) is distinct from c.content_sha256 then
    perform app.campaign_reset(s.tenant_id, s.campaign_id, 'content_changed');
    return 'reset';
  end if;
  select * into r from public.campaign_recipients x where x.tenant_id = s.tenant_id and x.id = s.recipient_id;
  -- a person who was closed (paid, wrong number, stopped) gets nothing more; a PROMISE silences only the reminders before its date (those were skipped when it was recorded), later ones still go
  if r.closed_at is not null and r.closed_reason <> 'promised' then
    perform app.campaign_step_skip(s.id, 'recipient_closed'); return 'skipped';
  end if;
  if s.scheduled_for < v_now - interval '24 hours' then
    perform app.campaign_step_skip(s.id, 'missed'); return 'skipped';
  end if;
  select w.status into v_tpl from integrations.wa_templates w where w.tenant_id = s.tenant_id and w.id = c.wa_template_id;
  if v_tpl is distinct from 'approved' then
    perform app.campaign_step_skip(s.id, 'template'); return 'skipped';
  end if;
  -- a list made from the LEDGER is checked against it again: paid since, or paid in part, is not reminded of the old amount
  if r.account_id is not null and r.amount_paise is not null then
    v_out := app.ledger_outstanding(s.tenant_id, r.account_id, app.dues_today());
    if v_out = 0 then
      perform app.campaign_step_skip(s.id, 'paid'); return 'skipped';
    elsif v_out < r.amount_paise then
      perform app.campaign_step_skip(s.id, 'balance_changed'); return 'skipped';
    end if;
  end if;
  select * into ct from public.contacts x where x.tenant_id = s.tenant_id and x.id = r.contact_id;
  select t.name into v_biz from public.tenants t where t.id = s.tenant_id;
  v_id := app.campaign_message_id(s.campaign_id, s.recipient_id, s.step_no, r.due_date);
  v_res := app.campaign_submit(p_actor, v_id, s.tenant_id, r.lead_id,
                               app.campaign_render(c.message_text, case when ct.erased_at is null then ct.full_name else '' end, r.amount_paise, r.due_date, r.reference, v_biz), c.language);
  update public.campaign_steps set status = 'submitted', outbox_message_id = v_id, materialised_at = v_now where id = s.id;
  if c.status = 'approved' then
    update public.campaigns set status = 'running' where id = c.id;
  end if;
  return case v_res ->> 'status' when 'queued' then 'queued' when 'needs_approval' then 'held' else 'blocked' end;
end;
$$;
revoke all on function app.campaign_step_run(uuid, public.campaign_steps) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the call step
-- ---------------------------------------------------------------------------------------------------------------------------------
-- For each person whose step N (the campaign's call plan) was handed on `call_wait_hours` ago, who has not replied since, has not paid (a ledger list is checked) and can still be called: a call request (approved
-- WITH the campaign by the Owner who approved it; the bridge still checks the hours and the contact each time) and an item on the call list.
create function app.campaign_calls_run(p_actor uuid, p_tenant uuid, p_limit integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_now    timestamptz := app.outbox_now();
  v_made   integer := 0;
  x        record;
  v_req    uuid;
  v_sha    text;
  v_script text;
  v_biz    text;
  v_out    bigint;
begin
  select t.name into v_biz from public.tenants t where t.id = p_tenant;
  for x in
    select r.id as recipient_id, r.campaign_id, r.lead_id, r.contact_id, r.due_date, r.amount_paise, r.reference, r.account_id, c.call_after_step, c.message_text, c.language, c.approved_by, ct.full_name
      from public.campaign_recipients r
      join public.campaigns c on c.tenant_id = r.tenant_id and c.id = r.campaign_id
      join public.campaign_steps s on s.tenant_id = r.tenant_id and s.recipient_id = r.id and s.step_no = c.call_after_step
      join public.outbox_messages m on m.tenant_id = s.tenant_id and m.id = s.outbox_message_id
      join public.contacts ct on ct.tenant_id = r.tenant_id and ct.id = r.contact_id
     where r.tenant_id = p_tenant and r.closed_at is null and c.status in ('approved', 'running') and c.call_after_step is not null and s.status = 'submitted'
       and m.status in ('sent', 'failed') and coalesce(m.sent_at, m.updated_at) + make_interval(hours => c.call_wait_hours) <= v_now
       and ct.erased_at is null and ct.suppressed_at is null and ct.phone is not null and ct.phone_consent <> 'withdrawn'
       and not exists (select 1 from public.call_list_items i where i.tenant_id = r.tenant_id and i.recipient_id = r.id)
       and not app.campaign_replied(r.tenant_id, r.lead_id, coalesce(m.sent_at, m.created_at))
     order by coalesce(m.sent_at, m.updated_at), r.id
     limit p_limit
       for update of r skip locked
  loop
    if x.account_id is not null then
      v_out := app.ledger_outstanding(p_tenant, x.account_id, app.dues_today());
      if v_out = 0 then
        update public.campaign_recipients set closed_at = v_now, closed_reason = 'paid' where id = x.recipient_id;
        update public.campaign_steps set status = 'skipped', reason = 'paid', materialised_at = v_now where tenant_id = p_tenant and recipient_id = x.recipient_id and status = 'planned';
        continue;
      end if;
    end if;
    v_req := gen_random_uuid();
    v_script := app.campaign_render(x.message_text, x.full_name, x.amount_paise, x.due_date, x.reference, v_biz);
    v_sha := encode(sha256(convert_to(concat_ws('|', x.lead_id, x.language, 'campaign', x.recipient_id, v_script), 'UTF8')), 'hex');
    insert into public.call_requests (id, tenant_id, lead_id, contact_id, company_id, reason, script_draft, language, status, request_sha256, requested_by, decided_by, decided_at, decision_note)
    select v_req, p_tenant, x.lead_id, x.contact_id, l.company_id, 'Reminder campaign: no reply, and not marked as paid, after step ' || x.call_after_step::text,
           v_script, x.language, 'approved', v_sha, p_actor, x.approved_by, v_now, 'approved with the campaign'
      from public.leads l where l.tenant_id = p_tenant and l.id = x.lead_id;
    insert into public.call_list_items (tenant_id, campaign_id, recipient_id, call_request_id, lead_id, contact_id, step_no)
    values (p_tenant, x.campaign_id, x.recipient_id, v_req, x.lead_id, x.contact_id, x.call_after_step);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;
revoke all on function app.campaign_calls_run(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the worker's entry
-- ---------------------------------------------------------------------------------------------------------------------------------
-- One pass for one business: the steps that are due (oldest first, at most p_limit, each in its own sub-transaction so one odd step cannot hold back the others), then the call step, then the campaigns that
-- have nothing left to do. [] counts when either switch is off or the module is off. Counts only; no words, no names.
create function public.scheduler_campaign_run(p_tenant_id uuid, p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();
  s         public.campaign_steps;
  v_what    text;
  v_queued  integer := 0;
  v_held    integer := 0;
  v_blocked integer := 0;
  v_skipped integer := 0;
  v_errors  integer := 0;
  v_calls   integer := 0;
  v_done    integer;
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.campaign_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.campaign_error('invalid');
  end if;
  if not app.scheduler_tenant_on(p_tenant_id) or not app.module_enabled(p_tenant_id, 'campaigns') then
    return jsonb_build_object('queued', 0, 'held', 0, 'blocked', 0, 'skipped', 0, 'errors', 0, 'calls', 0, 'done', 0);
  end if;
  for s in
    select x.* from public.campaign_steps x join public.campaigns c on c.tenant_id = x.tenant_id and c.id = x.campaign_id
     where x.tenant_id = p_tenant_id and x.status = 'planned' and x.scheduled_for <= v_now and c.status in ('approved', 'running')
     order by x.scheduled_for, x.id
     limit p_limit
       for update of x skip locked
  loop
    begin
      v_what := app.campaign_step_run(v_uid, s);
      case v_what when 'queued' then v_queued := v_queued + 1; when 'held' then v_held := v_held + 1; when 'blocked' then v_blocked := v_blocked + 1; else v_skipped := v_skipped + 1; end case;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;
  begin
    v_calls := app.campaign_calls_run(v_uid, p_tenant_id, p_limit);
  exception when others then
    v_errors := v_errors + 1;
  end;
  -- a campaign is done when nothing is planned any more and no call is still to be made (a call plan waits its hours, and two days of grace)
  update public.campaigns c set status = 'done', completed_at = v_now
   where c.tenant_id = p_tenant_id and c.status in ('approved', 'running')
     and not exists (select 1 from public.campaign_steps x where x.tenant_id = c.tenant_id and x.campaign_id = c.id and x.status = 'planned')
     and not exists (select 1 from public.call_list_items i where i.tenant_id = c.tenant_id and i.campaign_id = c.id and i.status = 'open')
     and (c.call_after_step is null
          or not exists (select 1 from public.campaign_steps x where x.tenant_id = c.tenant_id and x.campaign_id = c.id and x.step_no = c.call_after_step and x.status = 'submitted'
                            and x.materialised_at + make_interval(hours => c.call_wait_hours) + interval '2 days' > v_now));
  get diagnostics v_done = row_count;
  return jsonb_build_object('queued', v_queued, 'held', v_held, 'blocked', v_blocked, 'skipped', v_skipped, 'errors', v_errors, 'calls', v_calls, 'done', v_done);
end;
$$;
revoke all on function public.scheduler_campaign_run(uuid, integer) from public, anon;
grant execute on function public.scheduler_campaign_run(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the call list for people
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The items, the ones to call first at the top (an item put off with `call later` waits for its time). The number to call is never shown: the call goes through the bridge.
create function public.call_list(p_tenant_id uuid, p_status text default 'open', p_limit integer default 50, p_after_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'call_list');
  if p_status is null or p_status not in ('open', 'done') or p_limit is null or p_limit not between 1 and 100 or ((p_after_at is null) <> (p_after_id is null)) then
    perform app.campaign_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', z.id, 'campaign_id', z.campaign_id, 'campaign_name', z.campaign_name, 'recipient_id', z.recipient_id, 'contact_id', z.contact_id, 'contact_name', z.full_name,
             'amount_paise', z.amount_paise, 'due_date', z.due_date, 'reference', z.reference, 'step_no', z.step_no, 'status', z.status, 'outcome', z.outcome, 'promised_on', z.promised_on,
             'call_after', z.call_after, 'attempts', z.attempts, 'call_request_id', z.call_request_id, 'created_at', z.created_at, 'sort_at', z.sort_at) order by z.sort_at, z.id)
      from (select i.*, coalesce(i.call_after, i.created_at) as sort_at, c.name as campaign_name, r.amount_paise, r.due_date, r.reference, ct.full_name
              from public.call_list_items i
              join public.campaigns c on c.tenant_id = i.tenant_id and c.id = i.campaign_id
              join public.campaign_recipients r on r.tenant_id = i.tenant_id and r.id = i.recipient_id
              join public.contacts ct on ct.tenant_id = i.tenant_id and ct.id = i.contact_id
             where i.tenant_id = p_tenant_id and i.status = p_status
               and (p_after_at is null or (coalesce(i.call_after, i.created_at), i.id) > (p_after_at, p_after_id))
             order by coalesce(i.call_after, i.created_at), i.id limit p_limit) z), '[]'::jsonb);
end;
$$;
revoke all on function public.call_list(uuid, text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.call_list(uuid, text, integer, timestamptz, uuid) to authenticated;

-- Record what happened on the call. paid / promised (a date from today to 60 days) / call later (a time within 30 days) / wrong number / stop. The rest of the reminders follow the outcome:
--   paid, wrong number, stop: the rest of the person's steps are skipped (stop also puts the person on the do-not-contact list, for every campaign and every message)
--   promised: the steps due before the day after the promised date are skipped; later ones still go
-- The same outcome recorded again replays; a different one on a finished item is refused (SM801).
create function public.call_list_outcome(p_tenant_id uuid, p_item_id uuid, p_outcome text, p_promised_on date default null, p_call_after timestamptz default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := app.outbox_now();
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  i       public.call_list_items;
begin
  if v_uid is null or p_tenant_id is null or p_item_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'call_list');
  if p_outcome is null or p_outcome not in ('paid', 'promised', 'call_later', 'wrong_number', 'stop')
     or (p_outcome = 'promised' and (p_promised_on is null or p_promised_on < v_today or p_promised_on > v_today + 60))
     or (p_outcome <> 'promised' and p_promised_on is not null)
     or (p_outcome = 'call_later' and (p_call_after is null or p_call_after <= v_now or p_call_after > v_now + interval '30 days'))
     or (p_outcome <> 'call_later' and p_call_after is not null) then
    perform app.campaign_error('invalid');
  end if;
  select * into i from public.call_list_items x where x.tenant_id = p_tenant_id and x.id = p_item_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if i.status = 'done' then
    if i.outcome = p_outcome and i.promised_on is not distinct from p_promised_on then
      return jsonb_build_object('id', i.id, 'status', i.status, 'outcome', i.outcome, 'replayed', true);
    end if;
    perform app.campaign_error('state');
  end if;
  if p_outcome = 'call_later' then
    update public.call_list_items set outcome = 'call_later', call_after = p_call_after, attempts = attempts + 1, outcome_at = v_now, recorded_by = v_uid where id = i.id returning * into i;
    return jsonb_build_object('id', i.id, 'status', i.status, 'outcome', i.outcome, 'replayed', false);
  end if;
  if p_outcome = 'stop' then
    perform public.suppress_contact(p_tenant_id, i.contact_id, 'opted_out'::public.suppression_reason, 'verbal'::public.evidence_type, 'call-list:outcome');
  end if;
  update public.campaign_recipients
     set closed_at = v_now, closed_reason = case p_outcome when 'paid' then 'paid' when 'promised' then 'promised' when 'wrong_number' then 'wrong_number' else 'stopped' end,
         promised_on = p_promised_on
   where tenant_id = p_tenant_id and id = i.recipient_id and closed_at is null;
  update public.campaign_steps set status = 'skipped', materialised_at = v_now,
         reason = case p_outcome when 'paid' then 'paid' when 'promised' then 'promised' else 'recipient_closed' end
   where tenant_id = p_tenant_id and recipient_id = i.recipient_id and status = 'planned'
     and (p_outcome <> 'promised' or scheduled_for < ((p_promised_on + 1)::timestamp at time zone 'Asia/Kolkata'));
  update public.call_list_items set status = 'done', outcome = p_outcome, promised_on = p_promised_on, call_after = null, attempts = attempts + 1, outcome_at = v_now, recorded_by = v_uid
   where id = i.id returning * into i;
  return jsonb_build_object('id', i.id, 'status', i.status, 'outcome', i.outcome, 'replayed', false);
end;
$$;
revoke all on function public.call_list_outcome(uuid, uuid, text, date, timestamptz) from public, anon;
grant execute on function public.call_list_outcome(uuid, uuid, text, date, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- results (derived; nothing stored)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The state of every step, read from the outbox and the WhatsApp status table:
--   planned | skipped (reason) | held (waiting for a person) | waiting (queued) | sent | delivered | read | failed | blocked (reason)
create function public.campaign_results(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.campaigns;
  v_out    jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id;
  if not found then
    perform app.campaign_error('reference');
  end if;
  with st as (
    select s.recipient_id, s.scheduled_for,
           case when s.status = 'planned' then 'planned' when s.status = 'skipped' then 'skipped'
                when m.status = 'needs_approval' then 'held' when m.status = 'queued' then 'waiting'
                when m.status = 'sent' then case when w.status in ('delivered', 'read') then w.status else 'sent' end
                when m.status = 'failed' then 'failed' else 'blocked' end as state,
           case when s.status = 'skipped' then s.reason when m.status in ('blocked', 'needs_approval') then m.reason end as why,
           m.sent_at
      from public.campaign_steps s
      left join public.outbox_messages m on m.tenant_id = s.tenant_id and m.id = s.outbox_message_id
      left join integrations.wa_message_status w on w.tenant_id = s.tenant_id and w.message_id = s.outbox_message_id
     where s.tenant_id = p_tenant_id and s.campaign_id = p_campaign_id),
  states as (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) as j from (select state, count(*) as n from st group by state) x),
  reasons as (select coalesce(jsonb_object_agg(why, n), '{}'::jsonb) as j from (select why, count(*) as n from st where why is not null group by why) x),
  days as (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'states', stt) order by d), '[]'::jsonb) as j
             from (select y.d, jsonb_object_agg(y.state, y.n) as stt
                     from (select (scheduled_for at time zone 'Asia/Kolkata')::date as d, state, count(*) as n from st group by 1, 2) y group by y.d) z),
  first_sent as (select r.id, r.lead_id, r.account_id, r.amount_paise, r.closed_reason, min(st.sent_at) as at
                   from public.campaign_recipients r join st on st.recipient_id = r.id and st.sent_at is not null
                  where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id group by r.id),
  settled as (select f.*, (f.closed_reason = 'paid' or (f.account_id is not null and app.ledger_outstanding(p_tenant_id, f.account_id, app.dues_today()) = 0
                                                         and app.ledger_outstanding(p_tenant_id, f.account_id, (f.at at time zone 'Asia/Kolkata')::date) > 0)) as paid
                from first_sent f),
  closed as (select coalesce(jsonb_object_agg(closed_reason, n), '{}'::jsonb) as j
               from (select r.closed_reason, count(*) as n from public.campaign_recipients r
                      where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id and r.closed_reason is not null group by 1) x),
  calls as (select jsonb_build_object(
                     'open', count(*) filter (where i.status = 'open'), 'done', count(*) filter (where i.status = 'done'),
                     'outcomes', coalesce((select jsonb_object_agg(o.outcome, o.n) from (select i2.outcome, count(*) as n from public.call_list_items i2
                                            where i2.tenant_id = p_tenant_id and i2.campaign_id = p_campaign_id and i2.outcome is not null group by 1) o), '{}'::jsonb)) as j
              from public.call_list_items i where i.tenant_id = p_tenant_id and i.campaign_id = p_campaign_id)
  select jsonb_build_object(
           'campaign_id', c.id, 'status', c.status,
           'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id),
           'by_state', (select j from states), 'by_reason', (select j from reasons), 'by_day', (select j from days),
           'delivered_total', coalesce(((select j from states) ->> 'delivered')::int, 0) + coalesce(((select j from states) ->> 'read')::int, 0),
           'replied', (select count(*) from settled f where app.campaign_replied(p_tenant_id, f.lead_id, f.at)),
           'paid_after_reminder', jsonb_build_object('recipients', (select count(*) from settled where paid), 'amount_paise', (select coalesce(sum(amount_paise), 0) from settled where paid)),
           'closed', (select j from closed), 'calls', (select j from calls))
    into v_out;
  return v_out;
end;
$$;
revoke all on function public.campaign_results(uuid, uuid) from public, anon;
grant execute on function public.campaign_results(uuid, uuid) to authenticated;
