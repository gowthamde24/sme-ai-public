-- Admin console phase 2, slice 1: the support thread. Staff open a ticket, read its thread, reply, leave an internal note, change its status and assign it.
-- Same rules as the foundation: every function proves the staff row, the role (owner or support), the second factor and the live session FIRST; the schema `admin` has no client privilege.
-- A reply is stored on the thread and moves the ticket to "waiting" (waiting for the shop). It is NOT sent anywhere yet: the shop-facing "Help" form and the e-mail / in-app delivery are a later item (E15), so
-- every message says `delivered: false`. An internal note is never shown to a shop.

create table admin.ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references admin.support_tickets (id) on delete restrict,
  kind       text not null check (kind in ('reply', 'note')),
  staff_id   uuid not null references admin.staff (user_id) on delete restrict,
  body       text not null check (char_length(body) between 1 and 4000 and app.text_is_clean(body)),
  created_at timestamptz not null default clock_timestamp()
);
comment on column admin.ticket_messages.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.ticket_messages.body is 'SAFE: words typed by Stack19 staff (a reply to a shop, or an internal note); no end-customer data is copied in by the system';
create index admin_ticket_messages_by_ticket on admin.ticket_messages (ticket_id, created_at, id);
alter table admin.ticket_messages enable row level security;
alter table admin.ticket_messages force row level security;
revoke all on admin.ticket_messages from public, anon, authenticated, service_role;

-- a message never changes or disappears (like the audit trail)
create function admin.ticket_messages_append_only() returns trigger language plpgsql set search_path = '' as
$$ begin raise exception 'ticket messages are append-only' using errcode = '42501'; end $$;
create trigger ticket_messages_append_only before update or delete on admin.ticket_messages for each row execute function admin.ticket_messages_append_only();

create function admin.ticket_thread(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as
$$
  select admin.ticket_row(p_id) || jsonb_build_object('messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'at', m.created_at, 'staff', jsonb_build_object('id', m.staff_id, 'name', s.name), 'body', m.body,
                                        'delivered', false) order by m.created_at, m.id)
      from admin.ticket_messages m join admin.staff s on s.user_id = m.staff_id where m.ticket_id = p_id), '[]'::jsonb))
$$;
revoke all on function admin.ticket_thread(uuid) from public, anon, authenticated, service_role;

create function public.admin_ticket_get(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_t     admin.support_tickets;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  select * into v_t from admin.support_tickets k where k.id = p_id;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  perform admin.log(v_staff.user_id, 'read', v_t.tenant_id, null, null, null, 'ticket', v_t.id::text, false);
  return admin.ticket_thread(v_t.id);
end $$;

-- a reply to the shop (kind 'reply': the ticket waits for the shop) or an internal note (kind 'note': for staff only, nothing else changes). A closed ticket takes neither: reopen it first (SM947).
create function public.admin_ticket_reply(p_id uuid, p_body text, p_kind text default 'reply') returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_t     admin.support_tickets;
  v_text  text := btrim(coalesce(p_body, ''));
  v_msg   uuid;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if char_length(v_text) not between 1 and 4000 or not app.text_is_clean(v_text) or p_kind is null or p_kind not in ('reply', 'note') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v_t from admin.support_tickets k where k.id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if v_t.status = 'closed' then
    raise exception 'ticket closed' using errcode = 'SM947';
  end if;
  insert into admin.ticket_messages (ticket_id, kind, staff_id, body) values (v_t.id, p_kind, v_staff.user_id, v_text) returning id into v_msg;
  if p_kind = 'reply' then
    update admin.support_tickets set status = 'waiting', last_message_at = now() where id = v_t.id;
  end if;
  perform admin.log(v_staff.user_id, 'note', v_t.tenant_id, null, null, null, 'ticket', v_t.id::text, false);
  return admin.ticket_thread(v_t.id);
end $$;

create function public.admin_ticket_status(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_t     admin.support_tickets;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_status is null or p_status not in ('open', 'waiting', 'closed') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v_t from admin.support_tickets k where k.id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if v_t.status <> p_status then
    update admin.support_tickets set status = p_status, closed_at = case when p_status = 'closed' then now() end, last_message_at = case when p_status = 'closed' then last_message_at else now() end where id = v_t.id;
    perform admin.log(v_staff.user_id, 'status', v_t.tenant_id, null, null, null, 'ticket', v_t.id::text, false);
  end if;
  return admin.ticket_thread(v_t.id);
end $$;

-- p_staff null = unassign
create function public.admin_ticket_assign(p_id uuid, p_staff uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_t     admin.support_tickets;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  select * into v_t from admin.support_tickets k where k.id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if p_staff is not null and not exists (select 1 from admin.staff s where s.user_id = p_staff and s.active and s.role in ('owner', 'support')) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  update admin.support_tickets set assignee_id = p_staff where id = v_t.id;
  perform admin.log(v_staff.user_id, 'status', v_t.tenant_id, null, null, null, 'ticket', v_t.id::text, false);
  return admin.ticket_thread(v_t.id);
end $$;

revoke all on function public.admin_ticket_get(uuid), public.admin_ticket_reply(uuid, text, text), public.admin_ticket_status(uuid, text), public.admin_ticket_assign(uuid, uuid) from public, anon;
grant execute on function public.admin_ticket_get(uuid), public.admin_ticket_reply(uuid, text, text), public.admin_ticket_status(uuid, text), public.admin_ticket_assign(uuid, uuid) to authenticated;
