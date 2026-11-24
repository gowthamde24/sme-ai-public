-- Outbound webhooks (connectors plan C1 item 2; docs/contracts/webhooks-out.md): a workspace's endpoints (an https address, the events it wants), and one delivery row per event per endpoint with retries.
--   public.webhook_endpoints    the Owner's or Admin's endpoints (at most 5). The SIGNING SECRET is never in the database: it lives in Secret Manager (workspace-secrets store, `sme-ws-<workspace>-whsec-<endpoint>`);
--                               the database keeps only its version and last four characters. Written only by the webhook_endpoint_* functions (Owner or Admin, second factor).
--   public.webhook_deliveries   one row per event per endpoint: the event, WHAT it is about (a call, a lead, an outcome: ids only, no personal data is copied) and where it stands
--                               (pending, retrying, delivered, dead). The body is built when it is sent, from the live rows, so an erased person leaves nothing here.
-- Events are queued by triggers on leads, phone_calls, integrations.missed_calls and outcomes, ONLY when the workspace has an active endpoint that asked for that event. A failure to queue never fails
-- the lead, the call or the outcome. The worker claims due rows (webhook_deliveries_claim), sends them (the API's guarded sender), and tells the database the result (webhook_delivery_record). The
-- retry delays (1 min, 5 min, 30 min, 2 h, 6 h) are the sender's; after the last one a delivery is dead (a dead letter) and the endpoint is "failing" until one delivery succeeds.
-- Nothing is queued or sent unless the API runs with WEBHOOKS_OUT=on (the kill switch: the routes answer 404 and the worker does not send).

create table public.webhook_endpoints (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id),
  url             text not null check (url ~ '^https://[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?(/[!-~]*)?$' and char_length(url) <= 500),
  events          text[] not null check (cardinality(events) between 1 and 5 and events <@ array['call.completed', 'call.missed', 'lead.created', 'lead.updated', 'job.outcome']),
  send_transcript boolean not null default false,
  active          boolean not null default true,
  secret_version  integer not null default 1 check (secret_version >= 1),
  secret_last4    text not null check (secret_last4 ~ '^[A-Za-z0-9]{4}$'),
  failing_since   timestamptz,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  rotated_at      timestamptz,
  unique (tenant_id, id)
);
comment on table public.webhook_endpoints is 'A workspace''s outbound webhook endpoints. Written only by webhook_endpoint_create / _update / _rotate / _delete (Owner or Admin, second factor). The signing secret is NOT stored here (Secret Manager).';
comment on column public.webhook_endpoints.url is 'SAFE: the https address the Owner chose for their own system (it may carry a token they put in it); shown to the Owner and Admin only, never logged. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.webhook_endpoints.events is 'SAFE: the events it wants. CLEAN-EXEMPT: closed CHECK list';
comment on column public.webhook_endpoints.secret_last4 is 'SAFE: the last four characters of the signing secret, to tell secrets apart. CLEAN-EXEMPT: strict anchored pattern';
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_endpoints force row level security;
revoke all on public.webhook_endpoints from public, anon, authenticated, service_role;
create trigger webhook_endpoints_forbid_tenant_id_change before update on public.webhook_endpoints for each row execute function app.forbid_tenant_id_change();
create trigger audit_webhook_endpoints after insert or update or delete on public.webhook_endpoints for each row execute function app.audit_row_change('webhook_endpoint', '');
grant select on public.webhook_endpoints to authenticated;
create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index webhook_endpoints_tenant on public.webhook_endpoints (tenant_id, created_at desc, id desc);

create table public.webhook_deliveries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id),
  endpoint_id    uuid not null,
  event_id       uuid not null,
  event          text not null check (event in ('call.completed', 'call.missed', 'lead.created', 'lead.updated', 'job.outcome', 'test.ping')),
  subject_kind   text not null check (subject_kind in ('phone_call', 'missed_call', 'lead', 'outcome', 'test')),
  subject_id     uuid,
  status         text not null default 'pending' check (status in ('pending', 'retrying', 'delivered', 'dead')),
  attempts       integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default app.outbox_now(),
  claimed_until  timestamptz,
  last_status_code integer check (last_status_code between 100 and 599),
  last_error     text check (last_error in ('timeout', 'refused', 'tls', 'status', 'redirect', 'blocked', 'dns', 'too_large', 'no_secret')),
  created_at     timestamptz not null default now(),
  delivered_at   timestamptz,
  foreign key (tenant_id, endpoint_id) references public.webhook_endpoints (tenant_id, id),
  unique (endpoint_id, event_id),
  check ((subject_kind = 'test') = (event = 'test.ping')),
  check ((status = 'delivered') = (delivered_at is not null))
);
comment on table public.webhook_deliveries is 'One outbound webhook delivery: which event, about which row (an id), and where it stands. No body and no personal data: the body is built when it is sent. Kept 30 days.';
comment on column public.webhook_deliveries.event is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.webhook_deliveries.subject_kind is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.webhook_deliveries.status is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.webhook_deliveries.last_error is 'SAFE: a closed word for what went wrong (never the other side''s text). CLEAN-EXEMPT: closed CHECK list';
alter table public.webhook_deliveries enable row level security;
alter table public.webhook_deliveries force row level security;
revoke all on public.webhook_deliveries from public, anon, authenticated, service_role;
create trigger webhook_deliveries_forbid_tenant_id_change before update on public.webhook_deliveries for each row execute function app.forbid_tenant_id_change();
create trigger audit_webhook_deliveries after insert or update or delete on public.webhook_deliveries for each row execute function app.audit_row_change('webhook_delivery', '');
grant select on public.webhook_deliveries to authenticated;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index webhook_deliveries_log on public.webhook_deliveries (tenant_id, endpoint_id, created_at desc, id desc);
create index webhook_deliveries_due on public.webhook_deliveries (tenant_id, next_attempt_at) where status in ('pending', 'retrying');

-- ---------------------------------------------------------------------------------------------------------------- queueing (triggers)
-- One delivery per active endpoint that asked for the event. Cheap when the workspace has none; never fails the row that caused it.
create function app.webhook_enqueue(p_tenant uuid, p_event text, p_kind text, p_subject uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = p_tenant and e.active and p_event = any (e.events)) then
    return;
  end if;
  begin
    insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, event, subject_kind, subject_id, next_attempt_at)
    select e.tenant_id, e.id, v_event_id, p_event, p_kind, p_subject, app.outbox_now()
      from public.webhook_endpoints e where e.tenant_id = p_tenant and e.active and p_event = any (e.events);
  exception when others then
    raise warning 'webhook enqueue skipped (%)', sqlstate;
  end;
end;
$$;
revoke all on function app.webhook_enqueue(uuid, text, text, uuid) from public;

create function app.webhook_trg_lead() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.webhook_enqueue(new.tenant_id, case tg_op when 'INSERT' then 'lead.created' else 'lead.updated' end, 'lead', new.id);
  return new;
end;
$$;
revoke all on function app.webhook_trg_lead() from public;
create trigger webhook_lead_created after insert on public.leads for each row execute function app.webhook_trg_lead();
create trigger webhook_lead_updated after update on public.leads for each row
  when (old.status is distinct from new.status or old.source is distinct from new.source or old.owner_user_id is distinct from new.owner_user_id
        or old.contact_id is distinct from new.contact_id or old.archived_at is distinct from new.archived_at or old.disqualified_reason is distinct from new.disqualified_reason)
  execute function app.webhook_trg_lead();

create function app.webhook_trg_call() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.state is not distinct from new.state then
    return new;
  end if;
  if new.state = 'completed' then
    perform app.webhook_enqueue(new.tenant_id, 'call.completed', 'phone_call', new.id);
  elsif new.state in ('no_answer', 'busy', 'voicemail') then
    perform app.webhook_enqueue(new.tenant_id, 'call.missed', 'phone_call', new.id);
  end if;
  return new;
end;
$$;
revoke all on function app.webhook_trg_call() from public;
create trigger webhook_call_state after insert or update on public.phone_calls for each row execute function app.webhook_trg_call();

create function app.webhook_trg_missed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.webhook_enqueue(new.tenant_id, 'call.missed', 'missed_call', new.id);
  return new;
end;
$$;
revoke all on function app.webhook_trg_missed() from public;
create trigger webhook_missed_call after insert on integrations.missed_calls for each row execute function app.webhook_trg_missed();

create function app.webhook_trg_outcome() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.corrected_at is not distinct from new.corrected_at then
    return new;
  end if;
  perform app.webhook_enqueue(new.tenant_id, 'job.outcome', 'outcome', new.id);
  return new;
end;
$$;
revoke all on function app.webhook_trg_outcome() from public;
create trigger webhook_outcome after insert or update on public.outcomes for each row execute function app.webhook_trg_outcome();

-- ---------------------------------------------------------------------------------------------------------------- what an event says (built when it is sent)
-- The lead's OWN contact: name, number, e-mail. Never another person's number.
create function app.webhook_person(p_tenant uuid, p_lead uuid, p_contact uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when l.id is null and c.id is null then null else jsonb_build_object('lead_id', l.id, 'contact_id', c.id, 'name', c.full_name, 'phone', c.phone, 'email', c.email) end
    from (select 1) one
    left join public.leads l on l.tenant_id = p_tenant and l.id = p_lead
    left join public.contacts c on c.tenant_id = p_tenant and c.id = coalesce(l.contact_id, p_contact)
$$;
revoke all on function app.webhook_person(uuid, uuid, uuid) from public;

create function app.webhook_data(p_event text, p_kind text, p_subject uuid, p_tenant uuid, p_transcript boolean) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  l public.leads;
  m integrations.missed_calls;
  o public.outcomes;
begin
  if p_kind = 'test' then
    return jsonb_build_object('message', 'This is a test event from Stack19.');
  elsif p_kind = 'phone_call' then
    select * into c from public.phone_calls x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    return jsonb_build_object('call', jsonb_build_object('id', c.id, 'direction', c.direction, 'state', c.state, 'outcome', c.outcome, 'category', c.category, 'summary', c.summary,
                                'language', c.language, 'purpose', c.purpose, 'duration_seconds', c.duration_s, 'cost_paise', c.cost_paise, 'captured', c.captured, 'callback_at', c.callback_at,
                                'answered_at', c.answered_at, 'ended_at', c.ended_at, 'simulated', c.simulated, 'sandbox', c.sandbox,
                                'transcript', case when p_transcript then c.transcript end),
                              'lead', app.webhook_person(p_tenant, c.lead_id, c.contact_id));
  elsif p_kind = 'missed_call' then
    select * into m from integrations.missed_calls x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    -- a caller who is a contact is the lead's own person; anyone else is only the last four digits
    return jsonb_build_object('call', jsonb_build_object('id', m.id, 'direction', 'inbound', 'state', 'missed', 'received_at', m.received_at, 'caller_last4', m.caller_last4, 'replied', m.outcome = 'replied'),
                              'lead', app.webhook_person(p_tenant, m.lead_id, m.contact_id));
  elsif p_kind = 'lead' then
    select * into l from public.leads x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    return jsonb_build_object('lead', jsonb_build_object('id', l.id, 'status', l.status, 'source', l.source, 'created_at', l.created_at, 'updated_at', l.updated_at, 'archived', l.archived_at is not null,
                                'is_test', l.is_test, 'contact', app.webhook_person(p_tenant, l.id, null)));
  elsif p_kind = 'outcome' then
    select * into o from public.outcomes x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    return jsonb_build_object('outcome', jsonb_build_object('id', o.id, 'kind', o.kind, 'source_id', o.source_id, 'outcome', o.outcome, 'category', o.category, 'reason', o.reason,
                                'occurred_at', o.occurred_at, 'corrected', o.corrected_at is not null),
                              'lead', app.webhook_person(p_tenant, o.lead_id, o.contact_id));
  end if;
  return jsonb_build_object('gone', true);
end;
$$;
revoke all on function app.webhook_data(text, text, uuid, uuid, boolean) from public;

-- ---------------------------------------------------------------------------------------------------------------- the endpoint as shown (no secret: its version and last four only)
create function app.webhook_endpoint_json(e public.webhook_endpoints) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', e.id, 'url', e.url, 'events', to_jsonb(e.events), 'send_transcript', e.send_transcript, 'active', e.active, 'secret_last4', e.secret_last4,
                            'secret_version', e.secret_version, 'created_at', e.created_at, 'created_by', e.created_by, 'rotated_at', e.rotated_at,
                            'health', jsonb_build_object('status', case when e.failing_since is not null then 'failing' else 'ok' end, 'failing_since', e.failing_since,
                                'dead_letters_7d', (select count(*) from public.webhook_deliveries d where d.tenant_id = e.tenant_id and d.endpoint_id = e.id and d.status = 'dead' and d.event <> 'test.ping' and d.created_at > now() - interval '7 days'),
                                'last_delivered_at', (select max(d.delivered_at) from public.webhook_deliveries d where d.tenant_id = e.tenant_id and d.endpoint_id = e.id and d.event <> 'test.ping')))
$$;
revoke all on function app.webhook_endpoint_json(public.webhook_endpoints) from public;

-- ---------------------------------------------------------------------------------------------------------------- Settings -> Developers -> Webhooks (Owner, Admin)
create function public.webhook_endpoints_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app.webhook_endpoint_json(e) order by e.created_at desc, e.id desc) from public.webhook_endpoints e where e.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;

-- null: 5 endpoints already (the API says 409 too_many_webhooks). The id is made by the API (the secret is stored under it first).
create function public.webhook_endpoint_create(p_tenant_id uuid, p_id uuid, p_url text, p_events text[], p_send_transcript boolean, p_last4 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.webhook_endpoints;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  perform 1 from public.tenants t where t.id = p_tenant_id for update;   -- one create at a time per workspace, so the count holds
  if (select count(*) from public.webhook_endpoints e where e.tenant_id = p_tenant_id) >= 5 then
    return null;
  end if;
  begin
    insert into public.webhook_endpoints (id, tenant_id, url, events, send_transcript, secret_last4, created_by)
    values (p_id, p_tenant_id, p_url, (select array_agg(distinct s order by s) from unnest(p_events) s), coalesce(p_send_transcript, false), p_last4, auth.uid())
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return app.webhook_endpoint_json(v);
end;
$$;

-- null: no such endpoint in this workspace
create function public.webhook_endpoint_update(p_tenant_id uuid, p_id uuid, p_url text default null, p_events text[] default null, p_active boolean default null, p_send_transcript boolean default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.webhook_endpoints;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  begin
    update public.webhook_endpoints e set
           url = coalesce(p_url, e.url),
           events = coalesce((select array_agg(distinct s order by s) from unnest(p_events) s), e.events),
           active = coalesce(p_active, e.active),
           send_transcript = coalesce(p_send_transcript, e.send_transcript),
           failing_since = case when p_active is true and not e.active then null else e.failing_since end,
           updated_at = now()
     where e.tenant_id = p_tenant_id and e.id = p_id
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return case when v.id is null then null else app.webhook_endpoint_json(v) end;
end;
$$;

-- a new secret (the API stored it under the next version); the old one stops at once. null: no such endpoint
create function public.webhook_endpoint_rotate(p_tenant_id uuid, p_id uuid, p_last4 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.webhook_endpoints;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  begin
    update public.webhook_endpoints e set secret_version = e.secret_version + 1, secret_last4 = p_last4, rotated_at = now(), updated_at = now()
     where e.tenant_id = p_tenant_id and e.id = p_id
    returning * into v;
  exception when check_violation or not_null_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return case when v.id is null then null else app.webhook_endpoint_json(v) end;
end;
$$;

-- the endpoint and its log go (the API then removes the secret). false: no such endpoint
create function public.webhook_endpoint_delete(p_tenant_id uuid, p_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = p_tenant_id and e.id = p_id) then
    return false;
  end if;
  delete from public.webhook_deliveries d where d.tenant_id = p_tenant_id and d.endpoint_id = p_id;
  delete from public.webhook_endpoints e where e.tenant_id = p_tenant_id and e.id = p_id;
  return true;
end;
$$;

-- a test.ping delivery, sent by the worker within its next tick (never retried). null: no such endpoint
create function public.webhook_endpoint_test(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = p_tenant_id and e.id = p_id) then
    return null;
  end if;
  insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, event, subject_kind, next_attempt_at)
  values (p_tenant_id, p_id, gen_random_uuid(), 'test.ping', 'test', app.outbox_now()) returning id into v_id;
  return jsonb_build_object('delivery_id', v_id);
end;
$$;

-- the log, newest first, 30 days, keyset on (created_at, id). p_endpoint_id null: every endpoint of the workspace
create function public.webhook_deliveries_list(p_tenant_id uuid, p_endpoint_id uuid, p_before timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'endpoint_id', x.endpoint_id, 'event', x.event, 'event_id', x.event_id, 'status', x.status, 'attempts', x.attempts,
                                        'last_status_code', x.last_status_code, 'last_error', x.last_error,
                                        'next_attempt_at', case when x.status in ('pending', 'retrying') then x.next_attempt_at end, 'created_at', x.created_at, 'delivered_at', x.delivered_at)
                     order by x.created_at desc, x.id desc)
      from (select d.* from public.webhook_deliveries d
             where d.tenant_id = p_tenant_id and (p_endpoint_id is null or d.endpoint_id = p_endpoint_id) and d.created_at > now() - interval '30 days'
               and (p_before is null or (d.created_at, d.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
             order by d.created_at desc, d.id desc limit p_limit) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the worker (the registered scheduler account)
-- Due deliveries of ACTIVE endpoints, leased for 3 minutes (a crashed worker's rows come back), each with its body's `data` built from the live rows. A row about something that is gone is closed here.
create function public.webhook_deliveries_claim(p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_out jsonb;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    perform app.scheduler_error('invalid');
  end if;
  with due as (
    select d.id from public.webhook_deliveries d
      join public.webhook_endpoints e on e.tenant_id = d.tenant_id and e.id = d.endpoint_id and e.active
     where d.status in ('pending', 'retrying') and d.next_attempt_at <= v_now and (d.claimed_until is null or d.claimed_until < v_now)
     order by d.next_attempt_at, d.id
     limit p_limit
       for update of d skip locked),
  upd as (
    update public.webhook_deliveries d set claimed_until = v_now + interval '3 minutes' from due where d.id = due.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'tenant_id', u.tenant_id, 'endpoint_id', u.endpoint_id, 'event', u.event, 'event_id', u.event_id, 'attempts', u.attempts,
                                               'created_at', u.created_at, 'url', e.url, 'secret_version', e.secret_version,
                                               'data', app.webhook_data(u.event, u.subject_kind, u.subject_id, u.tenant_id, e.send_transcript)) order by u.created_at, u.id), '[]'::jsonb)
    into v_out
    from upd u join public.webhook_endpoints e on e.tenant_id = u.tenant_id and e.id = u.endpoint_id;
  return v_out;
end;
$$;

-- The result of one attempt. ok: delivered. Not ok with p_retry_in_s: retry then (1 s to 24 h). Not ok without it: dead (a dead letter; the endpoint is "failing" until one delivery succeeds; a test event never
-- marks it). Answers {state}. A row that is not waiting any more (already recorded, or deleted) answers gone.
create function public.webhook_delivery_record(p_id uuid, p_ok boolean, p_status integer, p_error text, p_retry_in_s integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.webhook_deliveries;
  v_now timestamptz := app.outbox_now();
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_ok is null or (p_retry_in_s is not null and p_retry_in_s not between 1 and 86400) or (p_status is not null and p_status not between 100 and 599)
     or (p_error is not null and p_error not in ('timeout', 'refused', 'tls', 'status', 'redirect', 'blocked', 'dns', 'too_large', 'no_secret')) then
    perform app.scheduler_error('invalid');
  end if;
  select * into d from public.webhook_deliveries x where x.id = p_id for update;
  if not found or d.status not in ('pending', 'retrying') then
    return jsonb_build_object('state', 'gone');
  end if;
  if p_ok then
    update public.webhook_deliveries set status = 'delivered', attempts = d.attempts + 1, delivered_at = v_now, claimed_until = null, last_status_code = p_status, last_error = null where id = d.id;
    if d.event <> 'test.ping' then
      update public.webhook_endpoints set failing_since = null where tenant_id = d.tenant_id and id = d.endpoint_id and failing_since is not null;
    end if;
    return jsonb_build_object('state', 'delivered');
  end if;
  if p_retry_in_s is not null then
    update public.webhook_deliveries set status = 'retrying', attempts = d.attempts + 1, next_attempt_at = v_now + make_interval(secs => p_retry_in_s), claimed_until = null,
           last_status_code = p_status, last_error = coalesce(p_error, 'status') where id = d.id;
    return jsonb_build_object('state', 'retrying');
  end if;
  update public.webhook_deliveries set status = 'dead', attempts = d.attempts + 1, claimed_until = null, last_status_code = p_status, last_error = coalesce(p_error, 'status') where id = d.id;
  if d.event <> 'test.ping' then
    update public.webhook_endpoints set failing_since = coalesce(failing_since, v_now) where tenant_id = d.tenant_id and id = d.endpoint_id;
  end if;
  return jsonb_build_object('state', 'dead');
end;
$$;

-- the log is kept 30 days
create function public.webhook_purge() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  delete from public.webhook_deliveries d where d.created_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('deliveries', v_n);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.webhook_endpoints_list(uuid)', 'public.webhook_endpoint_create(uuid, uuid, text, text[], boolean, text)', 'public.webhook_endpoint_update(uuid, uuid, text, text[], boolean, boolean)',
                           'public.webhook_endpoint_rotate(uuid, uuid, text)', 'public.webhook_endpoint_delete(uuid, uuid)', 'public.webhook_endpoint_test(uuid, uuid)',
                           'public.webhook_deliveries_list(uuid, uuid, timestamptz, uuid, integer)', 'public.webhook_deliveries_claim(integer)',
                           'public.webhook_delivery_record(uuid, boolean, integer, text, integer)', 'public.webhook_purge()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- the staff's alert: an endpoint has dead letters and has not recovered
-- Computed when the staff open the alerts list (nothing stored): a count, never an address or a name. The Owner of a workspace sees the same fact on the endpoint itself (health.status = failing).
create function admin.webhook_alerts(p_role text) returns jsonb language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(x.item), '[]'::jsonb) from (
    select jsonb_build_object('id', md5('webhooks_failing')::uuid, 'kind', 'webhooks_failing', 'severity', 'warn', 'title', 'Customers'' webhooks are failing',
             'detail', f.n || ' webhook endpoint(s) have deliveries that gave up after every retry and have not worked since. The customer sees it as "failing" on their Developers page; nothing is wrong with our worker unless the count keeps growing.',
             'created_at', app.outbox_now(), 'acknowledged', false) as item
      from (select count(*) as n from public.webhook_endpoints e where e.failing_since is not null and e.active) f
     where p_role in ('owner', 'support') and f.n > 0
  ) x
$$;
revoke all on function admin.webhook_alerts(text) from public, anon, authenticated;

do $patch$
declare
  v_def    text := pg_get_functiondef('public.admin_alerts_list(boolean)'::regprocedure);
  v_marker constant text := E'admin.computed_alerts(v_staff.role));';
begin
  if position(v_marker in v_def) = 0 or position('admin.webhook_alerts' in v_def) > 0 then
    raise notice 'webhook alerts: the staff alerts list was left as it is';
    return;
  end if;
  execute replace(v_def, v_marker, E'admin.computed_alerts(v_staff.role) || admin.webhook_alerts(v_staff.role));');
end
$patch$;
