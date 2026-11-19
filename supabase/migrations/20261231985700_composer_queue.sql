-- THE CHATS COMPOSER QUEUE (owner, 19 Nov 2026; contract: ~/Desktop/stack19-jobs/contracts/composer-queue-DRAFT.md): when the 24-hour window of a chat is CLOSED and the owner types, the approved `continue_chat` template goes first
-- (when it can) and what he typed is QUEUED on the chat; the customer's reply releases it into the outbox as an owner-typed reply (which goes at once: the night rule), and the assistant does NOT also answer that reply.
--   * one waiting message per chat (partial unique index); `client_id` makes a retry the same message; it EXPIRES after 7 days (marked not sent, shown to the owner with "Call instead");
--   * the customer's reply = any inbound WhatsApp message on the chat (an AFTER INSERT trigger on enquiries); the outbox applies every rule AGAIN at that moment (a STOP in that very message wins: the claim re-checks and blocks);
--   * if continue_chat cannot go (not approved yet: `hello_not_approved`; or Meta treats it as marketing and there is no marketing consent: `marketing_blocked`) the answer says so AT ONCE and NOTHING is queued ("Call instead");
--   * a NEW message may follow at once after one that ended (failed, expired, cancelled, sent): only ONE can WAIT per chat.
-- SQLSTATEs: SM990 window_open, SM991 stopped_by_customer, SM992 consent_required, SM993 daily_limit, SM994 no_whatsapp, SM995 already_queued, SM996 not_waiting, SM997 hello_not_approved, SM998 marketing_blocked, 22023 invalid, 42501 not allowed, 23503 not found.

create function app.composer_error(p_kind text) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_kind
    when 'deny'        then raise exception 'not allowed' using errcode = '42501';
    when 'invalid'     then raise exception 'invalid input' using errcode = '22023';
    when 'reference'   then raise exception 'not found' using errcode = '23503';
    when 'window_open' then raise exception 'the window is open' using errcode = 'SM990';
    when 'stopped'     then raise exception 'stopped by the customer' using errcode = 'SM991';
    when 'consent'     then raise exception 'consent required' using errcode = 'SM992';
    when 'daily_limit' then raise exception 'daily limit' using errcode = 'SM993';
    when 'no_whatsapp' then raise exception 'no whatsapp' using errcode = 'SM994';
    when 'queued'      then raise exception 'already queued' using errcode = 'SM995';
    when 'not_waiting' then raise exception 'not waiting' using errcode = 'SM996';
    when 'hello_not_approved' then raise exception 'the hello template is not approved' using errcode = 'SM997';
    when 'marketing_blocked' then raise exception 'the hello cannot go without marketing consent' using errcode = 'SM998';
    else raise exception 'composer error' using errcode = 'XX000';
  end case;
end;
$$;
revoke all on function app.composer_error(text) from public, anon, authenticated, service_role;

create table public.queued_replies (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  lead_id             uuid not null,
  client_id           uuid not null,
  body                text not null check (char_length(body) between 1 and 1000 and app.text_is_clean(body)),
  language            text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  status              text not null default 'waiting_for_reply' check (status in ('waiting_for_reply', 'released', 'cancelled', 'failed')),
  continue_chat       text not null check (continue_chat in ('sent', 'already')),
  template_message_id uuid,
  outbox_message_id   uuid not null default gen_random_uuid(),
  failure_code        text check (failure_code is null or failure_code ~ '^[a-z_]{2,40}$'),
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '7 days',
  released_at         timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, client_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
create unique index queued_replies_one_waiting_key on public.queued_replies (tenant_id, lead_id) where status = 'waiting_for_reply';
create index queued_replies_lead_idx on public.queued_replies (tenant_id, lead_id, created_at desc, id);
create index queued_replies_keyset_idx on public.queued_replies (tenant_id, created_at, id);
comment on table public.queued_replies is 'The Chats composer queue: what the owner typed while the 24-hour window was closed, released by the customer''s reply. Written only by the composer functions.';
comment on column public.queued_replies.body is 'PII: what the owner typed for the customer. Erased with the workspace. Kept only as the record of what was queued.';
comment on column public.queued_replies.client_id is 'SAFE: the web''s idempotency id. CLEAN-EXEMPT: a uuid';
comment on column public.queued_replies.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.queued_replies.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.queued_replies.continue_chat is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.queued_replies.failure_code is 'SAFE: a closed word of the outbox. CLEAN-EXEMPT: pattern CHECK';
comment on column public.queued_replies.template_message_id is 'SAFE: an id. CLEAN-EXEMPT: an id';
comment on column public.queued_replies.outbox_message_id is 'SAFE: an id. CLEAN-EXEMPT: an id';
comment on column public.queued_replies.created_by is 'SAFE: a user id. CLEAN-EXEMPT: an id';

alter table public.queued_replies enable row level security;
alter table public.queued_replies force row level security;
revoke all on public.queued_replies from public, anon, authenticated, service_role;
grant select on public.queued_replies to authenticated;
create policy queued_replies_select on public.queued_replies for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create trigger queued_replies_forbid_tenant_id_change before update on public.queued_replies for each row execute function app.forbid_tenant_id_change();
create trigger audit_queued_replies after insert or update or delete on public.queued_replies for each row execute function app.audit_row_change('queued_reply', 'body');
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('queued_replies', 'body', 'tenant', 'tombstone', 'erased:1'),
  ('queued_replies', 'body', 'sweep',  'substring', 'erased:1');

-- the answer shape (also what the web reads): the status is DERIVED from the outbox row once the message is released, and from the clock while it waits
create function app.queued_reply_json(q public.queued_replies) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id, 'text', q.body, 'language', q.language, 'queued_at', q.created_at, 'expires_at', q.expires_at, 'continue_chat', q.continue_chat,
    'status', case
        when q.status = 'cancelled' then 'cancelled'
        when q.status = 'failed' then 'failed'
        when q.status = 'waiting_for_reply' and q.expires_at <= app.outbox_now() then 'expired'
        when q.status = 'waiting_for_reply' then 'waiting_for_reply'
        else coalesce((select case when m.status = 'sent' then 'sent'
                                   when m.status = 'blocked' then 'failed'
                                   when m.status = 'needs_approval' then 'failed'
                                   when m.status = 'failed' then 'failed'
                                   when m.scheduled_for > app.outbox_now() then 'replied_waiting_for_morning'
                                   else 'sending' end
                         from public.outbox_messages m where m.tenant_id = q.tenant_id and m.id = q.outbox_message_id), 'sending') end,
    'send_at', case when q.status = 'released' then (select m.scheduled_for from public.outbox_messages m where m.tenant_id = q.tenant_id and m.id = q.outbox_message_id and m.status = 'queued') end,
    'sent_at', case when q.status = 'released' then (select m.sent_at from public.outbox_messages m where m.tenant_id = q.tenant_id and m.id = q.outbox_message_id and m.status = 'sent') end,
    'failure_code', case when q.status = 'failed' then q.failure_code
                         when q.status = 'released' then (select case when m.status in ('blocked', 'needs_approval') then m.reason when m.status = 'failed' then m.failure_code end
                                                           from public.outbox_messages m where m.tenant_id = q.tenant_id and m.id = q.outbox_message_id) end)
$$;
revoke all on function app.queued_reply_json(public.queued_replies) from public, anon, authenticated, service_role;

-- the owner typed while the window is closed
create function public.queued_reply_create(p_tenant_id uuid, p_lead_id uuid, p_text text, p_client_id uuid, p_language text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();
  v_text    text := btrim(coalesce(p_text, ''));
  v_lead    public.leads;
  v_contact public.contacts;
  v_lang    text;
  v_hard    text;
  v_inbound timestamptz;
  v_tpl     integrations.wa_templates;
  v_cc      text;
  v_tmsg    uuid;
  q         public.queued_replies;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.composer_error('deny');
  end if;
  if p_lead_id is null or p_client_id is null or char_length(v_text) not between 1 and 1000 or not app.text_is_clean(v_text) or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta')) then
    perform app.composer_error('invalid');
  end if;
  -- the same client id again is the same message
  select * into q from public.queued_replies x where x.tenant_id = p_tenant_id and x.client_id = p_client_id;
  if found then
    return app.queued_reply_json(q);
  end if;
  select * into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.composer_error('reference');
  end if;
  select * into v_contact from public.contacts c where c.tenant_id = p_tenant_id and c.id = v_lead.contact_id;
  if not found then
    perform app.composer_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('composer:' || p_lead_id::text, 0));
  if exists (select 1 from public.queued_replies x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id and x.status = 'waiting_for_reply' and x.expires_at > v_now) then
    perform app.composer_error('queued');
  end if;
  -- an old waiting one that has run out makes room
  update public.queued_replies x set status = 'failed', failure_code = 'expired', updated_at = v_now
   where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id and x.status = 'waiting_for_reply' and x.expires_at <= v_now;
  if not exists (select 1 from integrations.whatsapp_accounts a where a.tenant_id = p_tenant_id and a.status = 'active') then
    perform app.composer_error('no_whatsapp');
  end if;
  v_hard := app.outbox_hard_block(p_tenant_id, v_contact, null, v_now);
  if v_hard = 'stopped' then
    perform app.composer_error('stopped');
  elsif v_hard = 'no_opt_in' then
    perform app.composer_error('consent');
  elsif v_hard = 'daily_limit' then
    perform app.composer_error('daily_limit');
  elsif v_hard is not null then
    perform app.composer_error('invalid');
  end if;
  select greatest(
           (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant_id and e.lead_id = p_lead_id and e.channel = 'whatsapp' and e.received_at <= v_now),
           (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant_id and t.lead_id = p_lead_id and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= v_now))
    into v_inbound;
  if v_inbound is not null and v_inbound > v_now - interval '24 hours' then
    perform app.composer_error('window_open');
  end if;
  v_lang := coalesce(p_language, (select p.language from public.lead_profiles p where p.tenant_id = p_tenant_id and p.lead_id = p_lead_id), 'en');
  if v_lang not in ('en', 'te', 'hi', 'kn', 'ta') then
    v_lang := 'en';
  end if;
  -- continue_chat: once in 24 hours; only an APPROVED template; marketing without consent is blocked by the send itself
  select t.* into v_tpl from integrations.wa_templates t where t.tenant_id = p_tenant_id and t.name = 'continue_chat' and t.status = 'approved' and t.language in (v_lang, 'en') order by (t.language = v_lang) desc limit 1;
  if exists (select 1 from public.queued_replies x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id and x.template_message_id is not null and x.created_at > v_now - interval '24 hours') then
    v_cc := 'already';
  elsif v_tpl.id is null then
    perform app.composer_error('hello_not_approved');
  else
    v_tmsg := gen_random_uuid();
    begin
      perform public.conversation_template_send(v_tmsg, p_tenant_id, p_lead_id, v_tpl.id);
      v_cc := 'sent';
    exception when others then
      perform app.composer_error('marketing_blocked');
    end;
  end if;
  insert into public.queued_replies (tenant_id, lead_id, client_id, body, language, continue_chat, template_message_id, created_by, created_at, expires_at, updated_at)
  values (p_tenant_id, p_lead_id, p_client_id, v_text, v_lang, v_cc, v_tmsg, v_uid, v_now, v_now + interval '7 days', v_now) returning * into q;
  return app.queued_reply_json(q);
end;
$$;
revoke all on function public.queued_reply_create(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.queued_reply_create(uuid, uuid, text, uuid, text) to authenticated;

-- the chat's queued message: the open one, or the latest that ended in the last 7 days
create function public.queued_reply_get(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.queued_replies;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.composer_error('deny');
  end if;
  select * into q from public.queued_replies x
   where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id and (x.status = 'waiting_for_reply' or x.created_at > app.outbox_now() - interval '7 days')
   order by (x.status = 'waiting_for_reply') desc, x.created_at desc, x.id desc limit 1;
  if not found then
    return jsonb_build_object('queued', null);
  end if;
  return jsonb_build_object('queued', app.queued_reply_json(q));
end;
$$;
revoke all on function public.queued_reply_get(uuid, uuid) from public, anon;
grant execute on function public.queued_reply_get(uuid, uuid) to authenticated;

create function public.queued_reply_cancel(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queued_replies;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.composer_error('deny');
  end if;
  select * into q from public.queued_replies x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.composer_error('reference');
  end if;
  if q.status <> 'waiting_for_reply' or q.expires_at <= app.outbox_now() then
    perform app.composer_error('not_waiting');
  end if;
  update public.queued_replies set status = 'cancelled', cancelled_at = app.outbox_now(), updated_at = app.outbox_now() where id = q.id returning * into q;
  return jsonb_build_object('id', q.id, 'status', 'cancelled');
end;
$$;
revoke all on function public.queued_reply_cancel(uuid, uuid) from public, anon;
grant execute on function public.queued_reply_cancel(uuid, uuid) to authenticated;

-- what needs the owner (Needs you, "Call instead"): a message that expired or failed in the last 7 days
create function public.queued_reply_attention(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.composer_error('deny');
  end if;
  return coalesce((select jsonb_agg(j order by (j ->> 'queued_at') desc) from (
           select app.queued_reply_json(q) || jsonb_build_object('lead_id', q.lead_id) as j
             from public.queued_replies q
            where q.tenant_id = p_tenant_id and (case when q.status = 'waiting_for_reply' then q.expires_at else q.updated_at end) > app.outbox_now() - interval '7 days'
              and (q.status = 'failed' or (q.status = 'waiting_for_reply' and q.expires_at <= app.outbox_now())
                   or (q.status = 'released' and exists (select 1 from public.outbox_messages m where m.tenant_id = q.tenant_id and m.id = q.outbox_message_id and m.status in ('blocked', 'needs_approval', 'failed'))))
            limit 50) s), '[]'::jsonb);
end;
$$;
revoke all on function public.queued_reply_attention(uuid) from public, anon;
grant execute on function public.queued_reply_attention(uuid) to authenticated;

-- the customer's reply releases it: any inbound WhatsApp message on the chat. It goes into the outbox as an owner-typed REPLY (the night rule: at once); every outbox rule applies at that moment (a STOP in this very
-- message wins: the claim re-checks the contact). The assistant's own automatic reply skips a chat whose owner message was just released (see the auto-reply list below).
create function app.queued_reply_release() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queued_replies;
  v_res jsonb;
begin
  if new.channel <> 'whatsapp' or new.lead_id is null then
    return new;
  end if;
  select * into q from public.queued_replies x where x.tenant_id = new.tenant_id and x.lead_id = new.lead_id and x.status = 'waiting_for_reply' for update skip locked;
  if not found then
    return new;
  end if;
  if q.expires_at <= app.outbox_now() then
    update public.queued_replies set status = 'failed', failure_code = 'expired', updated_at = app.outbox_now() where id = q.id;
    return new;
  end if;
  begin
    v_res := app.outbox_submit_core(q.created_by, q.outbox_message_id, q.tenant_id, q.lead_id, 'whatsapp', q.body, q.language, 'reply_to_inbound', 'owner', false, false, '{}'::uuid[], false, null);
    update public.queued_replies set status = 'released', released_at = app.outbox_now(), updated_at = app.outbox_now() where id = q.id;
  exception when others then
    update public.queued_replies set status = 'failed', failure_code = 'not_sent', updated_at = app.outbox_now() where id = q.id;
  end;
  return new;
end;
$$;
revoke all on function app.queued_reply_release() from public, anon, authenticated, service_role;
create trigger enquiries_release_queued_reply after insert on public.enquiries for each row when (new.channel = 'whatsapp') execute function app.queued_reply_release();
