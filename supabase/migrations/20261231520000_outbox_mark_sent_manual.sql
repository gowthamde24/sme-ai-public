-- C10 (owner yes, 13 Nov 2026): "I sent it". An approved message the owner sent BY HAND from their own WhatsApp (the web opens the chat with the words filled in; this system sends nothing)
-- is marked sent, so the dispatcher never sends it a second time and the log, the daily count and the lead's touch tell the truth.
--   * adapter 'manual' (closed word); adapter_message_id 'manual:<message id>' (no customer data)
--   * Owner and Admin only, NO second factor (the approval already had one; this records a fact, it sends nothing)
--   * only a QUEUED (approved, not sent) message that no dispatch is handing over right now; the same call again answers replayed = true
--   * a customer who asked us to stop, or whose record was erased, is refused (SM502), like every other send
--   * the usual 'sent' step is written by the existing trigger (the person who pressed the button is its actor); a lead touch is kept when the message was made with keep_record

alter table public.outbox_messages drop constraint outbox_messages_adapter_check;
alter table public.outbox_messages add constraint outbox_messages_adapter_check check (adapter in ('fake', 'whatsapp', 'manual'));

create function public.outbox_mark_sent(p_tenant_id uuid, p_message_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := app.outbox_now();
  m     public.outbox_messages;
  c     public.contacts;
  v_key text;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status = 'sent' and m.adapter = 'manual' then
    return app.outbox_row_json(m, true);
  end if;
  if m.status <> 'queued' then
    perform app.outbox_error('state');
  end if;
  -- a dispatch holds it for two minutes while it hands it over: wait for its answer
  if m.claimed_at is not null and m.claimed_at > v_now - interval '2 minutes' then
    perform app.outbox_error('state');
  end if;
  if m.contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || m.contact_id::text, 0));
    select * into c from public.contacts x where x.id = m.contact_id and x.tenant_id = p_tenant_id;
    select k.phone_hmac into v_key from suppression.contact_keys k where k.tenant_id = p_tenant_id and k.contact_id = c.id;
    if c.erased_at is not null or c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn'
       or (v_key is not null and app.key_active(p_tenant_id, 'phone', v_key)) then
      perform app.outbox_error('stopped');
    end if;
  end if;
  update public.outbox_messages
     set status = 'sent', sent_at = v_now, adapter = 'manual', adapter_message_id = 'manual:' || m.id::text
   where id = m.id returning * into m;
  if m.keep_record then
    perform app.outbox_record_touch(m);
  end if;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_mark_sent(uuid, uuid) from public, anon;
grant execute on function public.outbox_mark_sent(uuid, uuid) to authenticated;
