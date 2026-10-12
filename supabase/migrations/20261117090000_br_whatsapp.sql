-- Job BR (ADR 0076): WHATSAPP, the real channel behind the outbox's adapter port (still switched on only by environment variables the owner sets).
--
--   integrations.channel_principals          the account the API signs in as to hand a webhook to the database (registered by the operator; belongs to no workspace; its only power is the
--                                            functions below). Least privilege: it cannot read a table and cannot use any person's function.
--   integrations.whatsapp_accounts           a business's WhatsApp number: WABA id, phone number id, coexistence flag, the NAME of the secret that holds its token (never the token)
--   integrations.wa_templates                the business's message templates (Meta's approval status kept by hand or by the API), and the guard `app.wa_send_context`
--   integrations.wa_events                   idempotency of webhook events (a retry of the same event does nothing); no text
--   integrations.wa_message_status           the delivery status of each outgoing message (sent, delivered, read, failed + a closed error word)
--   integrations.wa_conversation_state       when each member's inbox last looked at a conversation (the unread mark; one per workspace in v1)
--   public.wa_* (channel principal)          ingest an inbound message (find or make the contact and lead, opt-in, the enquiry), an opt-out (STOP), a delivery status
--   public.whatsapp_account_* / wa_template_* / conversation_*   the Owner's and the team's own calls
--
-- The outbox's claim now also hands the adapter what it needs (attempts, the number to send from, whether the customer's 24-hour window is open, the approved template for the message's kind);
-- the adapters of the outbox accept 'whatsapp'; new closed failure codes and delivery steps are added to the outbox's lists.
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 not found, 23505 already used (a phone number id), SM306 second factor, SM621 not in a state that allows this.

create schema if not exists integrations;

create function app.wa_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'used'      then raise exception 'already used' using errcode = '23505';
    when 'state'     then raise exception 'not in a state that allows this' using errcode = 'SM621';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.wa_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the outbox accepts the real channel
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.outbox_messages drop constraint outbox_messages_adapter_check;
alter table public.outbox_messages add constraint outbox_messages_adapter_check check (adapter in ('fake', 'whatsapp'));
alter table public.outbox_messages drop constraint outbox_messages_failure_code_check;
alter table public.outbox_messages add constraint outbox_messages_failure_code_check
  check (failure_code in ('adapter_error', 'timeout', 'rejected', 'window_closed', 'template_required', 'recipient_unreachable', 'rate_limited', 'not_configured'));
alter table public.outbox_events drop constraint outbox_events_kind_check;
alter table public.outbox_events add constraint outbox_events_kind_check
  check (kind in ('made', 'queued', 'held', 'needs_approval', 'approved', 'rejected', 'edited', 'blocked', 'sent', 'failed', 'delivered', 'read', 'delivery_failed'));

create or replace function app.outbox_mark_core(
  p_tenant_id uuid, p_message_id uuid, p_outcome text, p_adapter text, p_adapter_message_id text default null, p_failure_code text default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m     public.outbox_messages;
begin
  if p_tenant_id is null or p_message_id is null then
    perform app.outbox_error('deny');
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'failed') or p_adapter is null or p_adapter not in ('fake', 'whatsapp')
     or (p_outcome = 'sent' and (p_adapter_message_id is null or char_length(p_adapter_message_id) not between 1 and 100))
     or (p_outcome = 'failed' and (p_failure_code is null or p_failure_code not in ('adapter_error', 'timeout', 'rejected', 'window_closed', 'template_required', 'recipient_unreachable', 'rate_limited', 'not_configured'))) then
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
    if m.keep_record then
      perform app.outbox_record_touch(m);
    end if;
  else
    update public.outbox_messages set status = 'failed', reason = 'send_failed', failure_code = p_failure_code where id = m.id returning * into m;
  end if;
  return app.outbox_row_json(m, false);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the channel principal
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.channel_principals (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  registered_at timestamptz not null default now()
);
alter table integrations.channel_principals enable row level security;
alter table integrations.channel_principals force row level security;
revoke all on integrations.channel_principals from public, anon, authenticated, service_role;

create function app.is_channel_agent() returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select auth.uid() is not null and exists (select 1 from integrations.channel_principals p where p.user_id = auth.uid()) $$;
revoke all on function app.is_channel_agent() from public, anon, authenticated, service_role;

create function app.operator_register_channel_agent(p_email text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_id is null then
    raise exception 'no such account' using errcode = '23503';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_id) then
    raise exception 'the channel account belongs to no workspace' using errcode = '42501';
  end if;
  insert into integrations.channel_principals (user_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function app.operator_register_channel_agent(text) from public, anon, authenticated, service_role;

create function app.operator_remove_channel_agent(p_email text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  delete from integrations.channel_principals p using auth.users u where u.id = p.user_id and lower(u.email) = lower(btrim(coalesce(p_email, '')));
end;
$$;
revoke all on function app.operator_remove_channel_agent(text) from public, anon, authenticated, service_role;

create function app.memberships_refuse_channel_agent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from integrations.channel_principals p where p.user_id = new.user_id) then
    raise exception 'the channel account cannot join a workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.memberships_refuse_channel_agent() from public;
create trigger memberships_refuse_channel_agent before insert or update of user_id on public.memberships
  for each row execute function app.memberships_refuse_channel_agent();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the business's WhatsApp number (Embedded Signup groundwork: what the signup returns is stored here)
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.whatsapp_accounts (
  tenant_id       uuid primary key references public.tenants (id) on delete restrict,
  waba_id         text not null check (waba_id ~ '^[0-9]{5,30}$'),
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone   text check (char_length(display_phone) between 5 and 24),
  coexistence     boolean not null default false,
  token_ref       text not null check (token_ref ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,59}$'),
  status          text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table integrations.whatsapp_accounts enable row level security;
alter table integrations.whatsapp_accounts force row level security;
revoke all on integrations.whatsapp_accounts from public, anon, authenticated, service_role;
comment on column integrations.whatsapp_accounts.token_ref is 'The NAME of the secret that holds the access token (environment or secret manager). Never the token itself.';

create function app.wa_account_json(a integrations.whatsapp_accounts) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('configured', true, 'waba_id', a.waba_id, 'phone_number_id', a.phone_number_id, 'display_phone', a.display_phone, 'coexistence', a.coexistence,
                            'token_ref', a.token_ref, 'status', a.status, 'updated_at', a.updated_at)
$$;
revoke all on function app.wa_account_json(integrations.whatsapp_accounts) from public;

create function public.whatsapp_account_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  select * into a from integrations.whatsapp_accounts x where x.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('configured', false, 'status', 'none');
  end if;
  return app.wa_account_json(a);
end;
$$;
revoke all on function public.whatsapp_account_get(uuid) from public, anon;
grant execute on function public.whatsapp_account_get(uuid) to authenticated;

create function public.whatsapp_account_save(p_tenant_id uuid, p_waba_id text, p_phone_number_id text, p_display_phone text, p_coexistence boolean, p_token_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  perform app.require_aal2();
  if p_waba_id is null or p_phone_number_id is null or p_token_ref is null or p_coexistence is null then
    perform app.wa_error('invalid');
  end if;
  begin
    insert into integrations.whatsapp_accounts as x (tenant_id, waba_id, phone_number_id, display_phone, coexistence, token_ref, created_by)
    values (p_tenant_id, btrim(p_waba_id), btrim(p_phone_number_id), nullif(btrim(coalesce(p_display_phone, '')), ''), p_coexistence, btrim(p_token_ref), auth.uid())
    on conflict (tenant_id) do update
      set waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id, display_phone = excluded.display_phone, coexistence = excluded.coexistence,
          token_ref = excluded.token_ref, updated_at = now(),
          -- a changed number is not live until the Owner switches it on again
          status = case when x.phone_number_id is distinct from excluded.phone_number_id then 'pending' else x.status end
    returning x.* into a;
  exception
    when unique_violation then perform app.wa_error('used');
    when check_violation then perform app.wa_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'whatsapp.account_saved', 'whatsapp_account', p_tenant_id, null,
    jsonb_build_object('coexistence', a.coexistence, 'status', a.status));
  return app.wa_account_json(a);
end;
$$;
revoke all on function public.whatsapp_account_save(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.whatsapp_account_save(uuid, text, text, text, boolean, text) to authenticated;

create function public.whatsapp_account_set_status(p_tenant_id uuid, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  perform app.require_aal2();
  if p_status is null or p_status not in ('active', 'disabled') then
    perform app.wa_error('invalid');
  end if;
  update integrations.whatsapp_accounts set status = p_status, updated_at = now() where tenant_id = p_tenant_id returning * into a;
  if not found then
    perform app.wa_error('reference');
  end if;
  perform app.write_audit_event(p_tenant_id, 'whatsapp.account_' || p_status, 'whatsapp_account', p_tenant_id, null, jsonb_build_object('status', p_status));
  return app.wa_account_json(a);
end;
$$;
revoke all on function public.whatsapp_account_set_status(uuid, text) from public, anon;
grant execute on function public.whatsapp_account_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. templates and the send guard
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.wa_templates (
  id          uuid primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (name ~ '^[a-z][a-z0-9_]{0,59}$'),
  language    text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  category    text not null check (category in ('utility', 'marketing', 'authentication')),
  -- which outbox kinds may use it: the kind of message (visit, followup, order_status, info)
  purpose     text not null check (purpose in ('visit', 'followup', 'order_status', 'info')),
  body        text not null check (char_length(body) between 10 and 1024 and app.text_is_clean(body)),
  status      text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'paused', 'disabled')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name, language),
  -- one text variable that carries the message; the words around it are the template's own (Meta does not accept a template that is only a variable)
  check (body ~ '\{\{1\}\}' and body !~ '\{\{[2-9]\}\}' and body !~ '^\s*\{\{1\}\}' and body !~ '\{\{1\}\}\s*$')
);
alter table integrations.wa_templates enable row level security;
alter table integrations.wa_templates force row level security;
revoke all on integrations.wa_templates from public, anon, authenticated, service_role;

create function app.wa_template_json(t integrations.wa_templates) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'name', t.name, 'language', t.language, 'category', t.category, 'purpose', t.purpose, 'body', t.body, 'status', t.status, 'updated_at', t.updated_at)
$$;
revoke all on function app.wa_template_json(integrations.wa_templates) from public;

create function public.wa_template_save(p_id uuid, p_tenant_id uuid, p_name text, p_language text, p_category text, p_purpose text, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t integrations.wa_templates;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_id is null or p_name is null or p_language is null or p_category is null or p_purpose is null or p_body is null then
    perform app.wa_error('invalid');
  end if;
  select * into t from integrations.wa_templates x where x.id = p_id;
  if found then
    if t.tenant_id <> p_tenant_id then
      perform app.wa_error('invalid');
    end if;
    if t.status in ('approved', 'submitted') then
      perform app.wa_error('state');   -- a template under review or approved is not edited: make a new one
    end if;
  end if;
  begin
    insert into integrations.wa_templates as x (id, tenant_id, name, language, category, purpose, body, created_by)
    values (p_id, p_tenant_id, btrim(p_name), p_language, p_category, p_purpose, btrim(p_body), auth.uid())
    on conflict (id) do update set name = excluded.name, language = excluded.language, category = excluded.category, purpose = excluded.purpose, body = excluded.body,
                                   status = 'draft', updated_at = now()
    returning x.* into t;
  exception
    when unique_violation then perform app.wa_error('used');
    when check_violation then perform app.wa_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'whatsapp.template_saved', 'wa_template', t.id, null, jsonb_build_object('purpose', t.purpose, 'language', t.language));
  return app.wa_template_json(t);
end;
$$;
revoke all on function public.wa_template_save(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.wa_template_save(uuid, uuid, text, text, text, text, text) to authenticated;

create function public.wa_template_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.wa_template_json(t) order by t.created_at, t.id) from integrations.wa_templates t where t.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.wa_template_list(uuid) from public, anon;
grant execute on function public.wa_template_list(uuid) to authenticated;

-- the status as Meta last told it (kept by the Owner or Admin, or by the API after it asked Meta to review it)
create function public.wa_template_set_status(p_tenant_id uuid, p_id uuid, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t integrations.wa_templates;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_status is null or p_status not in ('submitted', 'approved', 'rejected', 'paused', 'disabled') then
    perform app.wa_error('invalid');
  end if;
  select * into t from integrations.wa_templates x where x.id = p_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.wa_error('reference');
  end if;
  if t.status = 'draft' and p_status <> 'submitted' then
    perform app.wa_error('state');   -- a draft goes to review first
  end if;
  update integrations.wa_templates set status = p_status, updated_at = now() where id = t.id returning * into t;
  perform app.write_audit_event(p_tenant_id, 'whatsapp.template_' || p_status, 'wa_template', t.id, null, jsonb_build_object('status', p_status));
  return app.wa_template_json(t);
end;
$$;
revoke all on function public.wa_template_set_status(uuid, uuid, text) from public, anon;
grant execute on function public.wa_template_set_status(uuid, uuid, text) to authenticated;

-- when did the customer last write on WhatsApp (the same two sources as the outbox policy's window)
create function app.wa_last_inbound(p_tenant uuid, p_lead uuid, p_now timestamptz) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now),
    (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_now))
$$;
revoke all on function app.wa_last_inbound(uuid, uuid, timestamptz) from public;

-- WHAT THE ADAPTER IS TOLD about one claimed message: the number to send from, whether the customer's 24-hour window is open, and the approved template for the message's kind and language.
-- null when the business has no active WhatsApp number. The decision to use a template is the adapter's, but only an APPROVED template is ever named here: the guard.
create function app.wa_send_context(m public.outbox_messages, p_now timestamptz) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
  v_last timestamptz;
  v_open boolean;
  t integrations.wa_templates;
  v_purpose text;
begin
  select * into a from integrations.whatsapp_accounts x where x.tenant_id = m.tenant_id and x.status = 'active';
  if not found then
    return null;
  end if;
  v_last := app.wa_last_inbound(m.tenant_id, m.lead_id, p_now);
  v_open := v_last is not null and v_last > p_now - interval '24 hours';
  v_purpose := case m.category when 'visit' then 'visit' when 'followup' then 'followup' when 'order_status' then 'order_status' when 'info' then 'info' else null end;
  if v_purpose is not null then
    select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = v_purpose and x.language = m.language and x.status = 'approved'
     order by x.created_at, x.id limit 1;
  end if;
  return jsonb_build_object(
    'phone_number_id', a.phone_number_id, 'token_ref', a.token_ref, 'coexistence', a.coexistence,
    'window_open', v_open, 'window_expires_at', case when v_open then v_last + interval '24 hours' end,
    'template', case when t.id is null then null else jsonb_build_object('name', t.name, 'language', t.language, 'body', t.body) end);
end;
$$;
revoke all on function app.wa_send_context(public.outbox_messages, timestamptz) from public;

-- the claim, as before, plus `attempts` and `wa` (the send context). Everything else is unchanged.
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
begin
  if p_limit is null or p_limit not between 1 and 50 or p_approved_only is null then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (not p_approved_only or x.reason = 'owner_approved')
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now, p_tenant_id) then
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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. events, delivery status, conversation state
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.wa_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  kind        text not null check (kind in ('inbound', 'status')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  at          timestamptz not null default now(),
  unique (tenant_id, kind, external_id)
);
alter table integrations.wa_events enable row level security;
alter table integrations.wa_events force row level security;
revoke all on integrations.wa_events from public, anon, authenticated, service_role;

create table integrations.wa_message_status (
  message_id   uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  wamid        text not null,
  status       text not null check (status in ('sent', 'delivered', 'read', 'failed')),
  sent_at      timestamptz,
  delivered_at timestamptz,
  read_at      timestamptz,
  failed_at    timestamptz,
  error_code   integer,
  error_word   text check (error_word ~ '^[a-z_]{2,30}$'),
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, message_id) references public.outbox_messages (tenant_id, id)
);
alter table integrations.wa_message_status enable row level security;
alter table integrations.wa_message_status force row level security;
revoke all on integrations.wa_message_status from public, anon, authenticated, service_role;

create table integrations.wa_conversation_state (
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  lead_id      uuid not null,
  last_read_at timestamptz not null,
  primary key (tenant_id, lead_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
alter table integrations.wa_conversation_state enable row level security;
alter table integrations.wa_conversation_state force row level security;
revoke all on integrations.wa_conversation_state from public, anon, authenticated, service_role;

create function app.wa_error_word(p_code integer) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 131047 then 'window_closed' when 131026 then 'unreachable' when 131049 then 'not_delivered_health' when 131056 then 'rate_limited'
    when 130429 then 'throughput' when 131048 then 'spam_limited' when 131050 then 'opted_out_marketing' when 131051 then 'unsupported_type'
    when 131053 then 'media_error' when 132000 then 'template_params' when 132001 then 'template_missing' when 132015 then 'template_paused' when 132016 then 'template_disabled'
    when 190 then 'token_expired' when 100 then 'bad_request'
    else 'other_error' end
$$;
revoke all on function app.wa_error_word(integer) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. what the channel principal may do
-- ---------------------------------------------------------------------------------------------------------------------------------
-- a message that said STOP (or an equivalent), applied like the existing suppression: the contact is suppressed, every granted consent is withdrawn (one ledger row each), and the number's key
-- is suppressed by the existing triggers, so the person stays stopped if they are created again
create function app.wa_suppress_contact(p_tenant uuid, p_contact uuid, p_reason public.suppression_reason, p_ref text, p_uid uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
  v_ch public.consent_channel;
begin
  select * into c from public.contacts where id = p_contact and tenant_id = p_tenant for update;
  if not found or c.erased_at is not null then
    return;
  end if;
  if c.suppressed_at is not null and c.suppression_reason in ('opted_out', 'complained', 'legal') then
    return;
  end if;
  update public.contacts set
    suppressed_at = coalesce(suppressed_at, now()), suppression_reason = p_reason,
    email_consent = case when email_consent = 'granted' then 'withdrawn' else email_consent end,
    whatsapp_consent = case when whatsapp_consent = 'granted' then 'withdrawn' else whatsapp_consent end,
    phone_consent = case when phone_consent = 'granted' then 'withdrawn' else phone_consent end
   where id = c.id;
  insert into public.consent_events (tenant_id, contact_id, event_type, suppression_reason, evidence_type, evidence_ref, recorded_by)
  values (p_tenant, c.id, 'suppressed', p_reason, 'other', p_ref, p_uid);
  foreach v_ch in array enum_range(null::public.consent_channel) loop
    if (case v_ch when 'email' then c.email_consent when 'whatsapp' then c.whatsapp_consent else c.phone_consent end) = 'granted' then
      insert into public.consent_events (tenant_id, contact_id, event_type, channel, evidence_type, evidence_ref, recorded_by)
      values (p_tenant, c.id, 'withdrawn', v_ch, 'other', p_ref, p_uid);
    end if;
  end loop;
end;
$$;
revoke all on function app.wa_suppress_contact(uuid, uuid, public.suppression_reason, text, uuid) from public;

-- Which workspace owns this number? (the webhook carries only the number's id)
create function public.wa_account_for(p_phone_number_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
begin
  if not app.is_channel_agent() then
    perform app.wa_error('deny');
  end if;
  select * into a from integrations.whatsapp_accounts x where x.phone_number_id = coalesce(p_phone_number_id, '') and x.status = 'active';
  if not found then
    return null;
  end if;
  return jsonb_build_object('tenant_id', a.tenant_id, 'coexistence', a.coexistence);
end;
$$;
revoke all on function public.wa_account_for(text) from public, anon;
grant execute on function public.wa_account_for(text) to authenticated;

-- An inbound message. Idempotent on the message id. The contact is found by the number (the oldest live holder) or made (a name from the WhatsApp profile, the number, a generic company), with the lead;
-- the customer's first message is their opt-in; a person on the suppression list is created FLAGGED (never contactable) and their message is still kept; an opt-out message (p_optout) suppresses
-- the contact. p_phone_hmac/p_hmac_version are the suppression key of the number, made by the API (the key never reaches the database). A closed real-data gate keeps a real number out: the answer
-- says so and nothing is stored.
create function public.wa_ingest_inbound(
  p_phone_number_id text, p_wamid text, p_from text, p_profile_name text, p_kind text, p_text text, p_sent_at timestamptz, p_phone_hmac text, p_hmac_version integer, p_optout boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  a         integrations.whatsapp_accounts;
  v_phone   text;
  v_norm    text;
  c         public.contacts;
  v_lead    uuid;
  v_enq     uuid := gen_random_uuid();
  v_new     boolean := false;
  v_body    text;
  v_name    text;
  v_ref     text;
  v_flagged boolean := false;
  v_has_key boolean;
  v_at      timestamptz;
  v_co      uuid := gen_random_uuid();
begin
  if not app.is_channel_agent() then
    perform app.wa_error('deny');
  end if;
  if p_wamid is null or char_length(p_wamid) not between 1 and 200 or p_from is null or p_from !~ '^[0-9]{6,15}$' or p_kind is null or p_kind !~ '^[a-z_]{2,30}$'
     or p_optout is null or p_phone_hmac is null or not app.is_hex64(p_phone_hmac) or p_hmac_version is null or p_hmac_version not between 1 and 32
     or char_length(coalesce(p_text, '')) > 4096 or char_length(coalesce(p_profile_name, '')) > 200 then
    perform app.wa_error('invalid');
  end if;
  select * into a from integrations.whatsapp_accounts x where x.phone_number_id = coalesce(p_phone_number_id, '') and x.status = 'active';
  if not found then
    return jsonb_build_object('outcome', 'unknown_account');
  end if;
  if exists (select 1 from integrations.wa_events e where e.tenant_id = a.tenant_id and e.kind = 'inbound' and e.external_id = p_wamid) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  v_phone := case when p_from ~ '^91[6-9][0-9]{9}$' then '+' || p_from else '+' || p_from end;
  v_norm := app.phone_norm(v_phone);
  v_ref := 'whatsapp:in#' || substr(encode(sha256(convert_to(p_wamid, 'UTF8')), 'hex'), 1, 24);
  v_at := least(coalesce(p_sent_at, app.outbox_now()), app.outbox_now());
  v_body := case when p_text is not null and btrim(p_text) <> '' and app.text_is_clean(p_text) then btrim(p_text)
                 when p_kind = 'text' then '[message not shown]'
                 else '[' || replace(p_kind, '_', ' ') || ']' end;

  begin
    select * into c from public.contacts x
     where x.tenant_id = a.tenant_id and x.erased_at is null and x.archived_at is null and x.phone is not null and v_norm is not null and app.phone_norm(x.phone) = v_norm
     order by x.created_at, x.id limit 1;
    if not found then
      v_new := true;
      v_name := nullif(btrim(coalesce(p_profile_name, '')), '');
      if v_name is null or not app.text_is_clean(v_name) then
        v_name := 'WhatsApp ' || right(v_phone, 4);
      end if;
      -- a lead with a contact needs a company: a generic one, named after nothing personal (the profile name belongs to the CONTACT, which an erasure removes; a company is never touched by it)
      insert into public.companies (id, tenant_id, name, created_via) values (v_co, a.tenant_id, 'WhatsApp customer ' || substr(replace(v_co::text, '-', ''), 1, 6), 'agent');
      insert into public.contacts (id, tenant_id, company_id, full_name, phone, created_via)
      values (gen_random_uuid(), a.tenant_id, v_co, left(v_name, 200), v_phone, 'agent') returning * into c;
      -- on the list already (a number that asked to stop, or was erased)? it is created flagged, before anything can be sent
      if app.key_active(a.tenant_id, 'phone', p_phone_hmac) then
        perform app.wa_suppress_contact(a.tenant_id, c.id, app.key_reason(a.tenant_id, 'phone', p_phone_hmac)::public.suppression_reason, v_ref, v_uid);
        v_flagged := true;
        select * into c from public.contacts x where x.id = c.id;   -- the suppression changed the row: the consent rule below must see it
      end if;
      perform app.contact_keys_record(c.id, jsonb_build_object('version', p_hmac_version, 'phone', p_phone_hmac), '{}'::jsonb, v_uid, true);
    else
      select exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.phone_hmac is not null) into v_has_key;
      if not v_has_key then
        perform app.contact_keys_record(c.id, jsonb_build_object('version', p_hmac_version, 'phone', p_phone_hmac), '{}'::jsonb, v_uid, false);
      end if;
      v_flagged := c.suppressed_at is not null;
    end if;

    -- the lead: the contact's newest live one, or a new one
    select l.id into v_lead from public.leads l where l.tenant_id = a.tenant_id and l.contact_id = c.id and l.archived_at is null order by l.created_at desc, l.id desc limit 1;
    if v_lead is null then
      if c.company_id is null then
        -- an older phone-only contact: it gets a generic company so that it can have a lead
        insert into public.companies (id, tenant_id, name, created_via) values (v_co, a.tenant_id, 'WhatsApp customer ' || substr(replace(v_co::text, '-', ''), 1, 6), 'agent');
        update public.contacts set company_id = v_co where id = c.id returning * into c;
      end if;
      v_lead := gen_random_uuid();
      insert into public.leads (id, tenant_id, company_id, contact_id, source, created_via) values (v_lead, a.tenant_id, c.company_id, c.id, 'whatsapp', 'agent');
    end if;

    -- the customer wrote to us: that is their opt-in for WhatsApp (never over a suppression)
    if c.suppressed_at is null and c.whatsapp_consent <> 'granted' then
      update public.contacts set whatsapp_consent = 'granted' where id = c.id;
      insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
      values (a.tenant_id, c.id, 'granted', 'whatsapp', 'other', 'other', v_ref, v_uid);
    end if;

    insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, created_via) values (v_enq, a.tenant_id, v_lead, 'whatsapp', v_at, left(v_body, 4096), 'agent');

    if p_optout then
      perform app.wa_suppress_contact(a.tenant_id, c.id, 'opted_out', v_ref, v_uid);
      v_flagged := true;
    end if;
  exception when sqlstate 'SM401' then
    return jsonb_build_object('outcome', 'gate_closed');
  end;

  insert into integrations.wa_events (tenant_id, kind, external_id) values (a.tenant_id, 'inbound', p_wamid);
  perform app.write_audit_event(a.tenant_id, 'whatsapp.inbound', 'enquiry', v_enq, null,
    jsonb_build_object('new_contact', v_new, 'optout', p_optout, 'kind', p_kind, 'flagged', v_flagged));
  return jsonb_build_object('outcome', 'stored', 'tenant_id', a.tenant_id, 'contact_id', c.id, 'lead_id', v_lead, 'enquiry_id', v_enq, 'new_contact', v_new, 'optout', p_optout, 'flagged', v_flagged);
end;
$$;
revoke all on function public.wa_ingest_inbound(text, text, text, text, text, text, timestamptz, text, integer, boolean) from public, anon;
grant execute on function public.wa_ingest_inbound(text, text, text, text, text, text, timestamptz, text, integer, boolean) to authenticated;

-- A delivery status of an outgoing message (sent, delivered, read, failed). Idempotent on (message id, status). The message is found by its WhatsApp id, or, if the send's own answer was lost,
-- by the outbox id the API put in the send as `biz_opaque_callback_data`: a message still waiting as "claimed" is then recorded as SENT with that WhatsApp id, so a lapsed claim does not send it twice.
create function public.wa_ingest_status(p_phone_number_id text, p_wamid text, p_status text, p_at timestamptz, p_error_code integer, p_callback text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a integrations.whatsapp_accounts;
  m public.outbox_messages;
  v_mid uuid;
  v_at timestamptz := least(coalesce(p_at, app.outbox_now()), app.outbox_now());
  v_word text;
  v_kind text;
begin
  if not app.is_channel_agent() then
    perform app.wa_error('deny');
  end if;
  if p_wamid is null or char_length(p_wamid) not between 1 and 100 or p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    perform app.wa_error('invalid');
  end if;
  select * into a from integrations.whatsapp_accounts x where x.phone_number_id = coalesce(p_phone_number_id, '') and x.status = 'active';
  if not found then
    return jsonb_build_object('outcome', 'unknown_account');
  end if;
  if exists (select 1 from integrations.wa_events e where e.tenant_id = a.tenant_id and e.kind = 'status' and e.external_id = p_wamid || ':' || p_status) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  select * into m from public.outbox_messages x where x.tenant_id = a.tenant_id and x.adapter_message_id = p_wamid for update;
  if not found and p_callback is not null and p_callback ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
    v_mid := substr(p_callback, 1, 36)::uuid;
    select * into m from public.outbox_messages x where x.tenant_id = a.tenant_id and x.id = v_mid for update;
    if found and m.status = 'queued' and m.claimed_at is not null then
      perform app.outbox_mark_core(a.tenant_id, m.id, 'sent', 'whatsapp', left(p_wamid, 100), null);
      select * into m from public.outbox_messages x where x.id = m.id;
    elsif found and m.adapter_message_id is distinct from p_wamid then
      m := null;   -- a message that was sent as something else: not ours to update
    end if;
  end if;
  if m.id is null then
    insert into integrations.wa_events (tenant_id, kind, external_id) values (a.tenant_id, 'status', p_wamid || ':' || p_status);
    return jsonb_build_object('outcome', 'unknown_message');
  end if;
  v_word := case when p_status = 'failed' then app.wa_error_word(p_error_code) end;
  insert into integrations.wa_message_status as s (message_id, tenant_id, wamid, status, sent_at, delivered_at, read_at, failed_at, error_code, error_word)
  values (m.id, m.tenant_id, p_wamid, p_status,
          case when p_status = 'sent' then v_at end, case when p_status = 'delivered' then v_at end, case when p_status = 'read' then v_at end, case when p_status = 'failed' then v_at end,
          case when p_status = 'failed' then p_error_code end, v_word)
  on conflict (message_id) do update set
    -- the furthest step wins (messages can arrive out of order), the times of every step seen are kept
    status = case when s.status = 'failed' then 'failed'
                  when excluded.status = 'failed' then 'failed'
                  when array_position(array['sent', 'delivered', 'read'], excluded.status) > array_position(array['sent', 'delivered', 'read'], s.status) then excluded.status
                  else s.status end,
    sent_at = coalesce(s.sent_at, excluded.sent_at), delivered_at = coalesce(s.delivered_at, excluded.delivered_at), read_at = coalesce(s.read_at, excluded.read_at),
    failed_at = coalesce(s.failed_at, excluded.failed_at), error_code = coalesce(excluded.error_code, s.error_code), error_word = coalesce(excluded.error_word, s.error_word),
    updated_at = now();
  v_kind := case p_status when 'delivered' then 'delivered' when 'read' then 'read' when 'failed' then 'delivery_failed' else null end;
  if v_kind is not null then
    perform app.outbox_event(m, v_kind, v_word, v_at, 'system', null);
  end if;
  insert into integrations.wa_events (tenant_id, kind, external_id) values (a.tenant_id, 'status', p_wamid || ':' || p_status);
  return jsonb_build_object('outcome', 'recorded', 'message_id', m.id, 'status', p_status);
end;
$$;
revoke all on function public.wa_ingest_status(text, text, text, timestamptz, integer, text) from public, anon;
grant execute on function public.wa_ingest_status(text, text, text, timestamptz, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. the conversations (the team's chat inbox)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.conversation_list(p_tenant_id uuid, p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.wa_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.last_at desc, x.lead_id) from (
      select z.lead_id, z.last_at,
             jsonb_build_object(
               'lead_id', z.lead_id, 'contact_id', z.contact_id, 'name', z.name, 'company', z.company, 'phone', z.phone, 'last_at', z.last_at, 'last_direction', z.last_dir,
               'preview', left(z.preview, 120), 'last_inbound_at', z.last_in, 'window_open', coalesce(z.last_in > v_now - interval '24 hours', false),
               'window_expires_at', case when z.last_in > v_now - interval '24 hours' then z.last_in + interval '24 hours' end,
               'unread', z.last_in is not null and z.last_in > coalesce(z.read_at, '-infinity'::timestamptz), 'stopped', z.suppressed) as j
        from (
          select l.id as lead_id, c.id as contact_id, c.full_name as name, co.name as company, c.phone, c.suppressed_at is not null as suppressed,
                 li.last_in, lo.last_out, st.last_read_at as read_at,
                 greatest(li.last_in, lo.last_out) as last_at,
                 case when li.last_in is not null and (lo.last_out is null or li.last_in > lo.last_out) then 'in' else 'out' end as last_dir,
                 case when li.last_in is not null and (lo.last_out is null or li.last_in > lo.last_out) then li.body else lo.body end as preview
            from public.leads l
            join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
            left join public.companies co on co.tenant_id = l.tenant_id and co.id = l.company_id
            left join integrations.wa_conversation_state st on st.tenant_id = l.tenant_id and st.lead_id = l.id
            left join lateral (select e.received_at as last_in, e.body from public.enquiries e where e.tenant_id = l.tenant_id and e.lead_id = l.id and e.channel = 'whatsapp'
                                order by e.received_at desc, e.id desc limit 1) li on true
            left join lateral (select coalesce(m.sent_at, m.created_at) as last_out, m.body from public.outbox_messages m where m.tenant_id = l.tenant_id and m.lead_id = l.id
                                and m.status in ('sent', 'queued', 'needs_approval') order by coalesce(m.sent_at, m.created_at) desc, m.id desc limit 1) lo on true
           where l.tenant_id = p_tenant_id and l.archived_at is null and c.erased_at is null and (li.last_in is not null or lo.last_out is not null)
        ) z
       where p_before is null or z.last_at < p_before
       order by z.last_at desc, z.lead_id
       limit p_limit
    ) x), '[]'::jsonb);
end;
$$;
revoke all on function public.conversation_list(uuid, integer, timestamptz) from public, anon;
grant execute on function public.conversation_list(uuid, integer, timestamptz) to authenticated;

-- one conversation: what the customer wrote and what we sent (newest first, a page of up to 100), with each outgoing message's state and delivery
create function public.conversation_thread(p_tenant_id uuid, p_lead_id uuid, p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_last timestamptz;
  c public.contacts;
  v_items jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.wa_error('invalid');
  end if;
  select c2.* into c from public.leads l join public.contacts c2 on c2.tenant_id = l.tenant_id and c2.id = l.contact_id where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.wa_error('reference');
  end if;
  v_last := app.wa_last_inbound(p_tenant_id, p_lead_id, v_now);
  select coalesce(jsonb_agg(y.j order by y.at desc, y.dir desc, y.id), '[]'::jsonb) into v_items from (
    select z.at, z.id, z.dir, z.j from (
      select e.received_at as at, e.id, 0 as dir,
             jsonb_build_object('direction', 'in', 'id', e.id, 'at', e.received_at, 'text', e.body) as j
        from public.enquiries e where e.tenant_id = p_tenant_id and e.lead_id = p_lead_id and e.channel = 'whatsapp'
      union all
      select coalesce(m.sent_at, m.created_at), m.id, 1,
             jsonb_build_object('direction', 'out', 'id', m.id, 'at', coalesce(m.sent_at, m.created_at), 'text', m.body, 'status', m.status, 'reason', m.reason, 'source', m.source,
                                'delivery', (select s.status from integrations.wa_message_status s where s.message_id = m.id),
                                'delivered_at', (select s.delivered_at from integrations.wa_message_status s where s.message_id = m.id),
                                'read_at', (select s.read_at from integrations.wa_message_status s where s.message_id = m.id),
                                'delivery_error', (select s.error_word from integrations.wa_message_status s where s.message_id = m.id),
                                'failure_code', m.failure_code,
                                'photos', (select count(*) from public.outbox_message_media md where md.tenant_id = m.tenant_id and md.message_id = m.id))
        from public.outbox_messages m where m.tenant_id = p_tenant_id and m.lead_id = p_lead_id
    ) z
    where p_before is null or z.at < p_before
    order by z.at desc, z.dir desc, z.id   -- at the same instant our message came after theirs
    limit p_limit
  ) y;
  return jsonb_build_object(
    'lead_id', p_lead_id, 'contact_id', c.id, 'name', c.full_name, 'phone', c.phone, 'stopped', c.suppressed_at is not null, 'whatsapp_consent', c.whatsapp_consent,
    'window_open', coalesce(v_last > v_now - interval '24 hours', false), 'window_expires_at', case when v_last > v_now - interval '24 hours' then v_last + interval '24 hours' end,
    'items', v_items);
end;
$$;
revoke all on function public.conversation_thread(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.conversation_thread(uuid, uuid, integer, timestamptz) to authenticated;

create function public.conversation_mark_read(p_tenant_id uuid, p_lead_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id) then
    perform app.wa_error('reference');
  end if;
  insert into integrations.wa_conversation_state (tenant_id, lead_id, last_read_at) values (p_tenant_id, p_lead_id, app.outbox_now())
  on conflict (tenant_id, lead_id) do update set last_read_at = excluded.last_read_at;
end;
$$;
revoke all on function public.conversation_mark_read(uuid, uuid) from public, anon;
grant execute on function public.conversation_mark_read(uuid, uuid) to authenticated;
