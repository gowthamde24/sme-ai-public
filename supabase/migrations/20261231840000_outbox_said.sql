-- "Act, do not rehearse" (owner, 14 Nov 2026): when the Owner clearly tells the assistant to send a message to ONE person they named, that instruction IS the approval.
--   * public.outbox_approve_said(tenant, message, hold_seconds): the Owner or an Admin approves a message of source `assistant` that waits for approval, WITHOUT the second factor (the owner's own
--     words in the chat are the approval, owner decision 14 Nov 2026; every other approval keeps require_aal2). The hard blocks are checked as for any approval (no consent, stopped, erased ...).
--     The message is queued for `hold_seconds` from now (default 30: the grace window of "Undo"), not for the next opening hour: the owner said send it.
--   * public.outbox_unsend_said(tenant, message): within that window, and only while nobody has taken the message to send, the Owner or an Admin cancels it (status blocked, reason owner_rejected).
create function public.outbox_approve_said(p_tenant_id uuid, p_message_id uuid, p_hold_seconds integer default 30) returns jsonb
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
  if p_hold_seconds is null or p_hold_seconds not between 0 and 120 then
    perform app.outbox_error('invalid');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.source <> 'assistant' or m.status <> 'needs_approval' then
    perform app.outbox_error('state');
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
     set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = v_now + make_interval(secs => p_hold_seconds)
   where id = m.id returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_approve_said(uuid, uuid, integer) from public, anon;
grant execute on function public.outbox_approve_said(uuid, uuid, integer) to authenticated;

create function public.outbox_unsend_said(p_tenant_id uuid, p_message_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := app.outbox_now();
  m     public.outbox_messages;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status <> 'queued' or m.reason <> 'owner_approved' or m.claimed_at is not null or m.scheduled_for is null or m.scheduled_for <= v_now then
    perform app.outbox_error('state');   -- sent already, being sent, or past its grace window
  end if;
  update public.outbox_messages set status = 'blocked', reason = 'owner_rejected', decided_by = v_uid, decided_at = v_now, scheduled_for = null
   where id = m.id returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_unsend_said(uuid, uuid) from public, anon;
grant execute on function public.outbox_unsend_said(uuid, uuid) to authenticated;
