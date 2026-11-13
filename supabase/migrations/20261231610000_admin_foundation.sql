-- Admin console, phase 1 (owner approved 13 Nov 2026; plan: docs/plans/admin-console.md): Stack19 STAFF only.
-- Staff accounts (owner / support / finance) are registered by the operator, belong to no workspace, and EVERY admin call proves in the database, first:
--   signed in + an active staff row + the role + a second factor (JWT aal = aal2) + a live session (30 minutes without activity ends it).
-- Everything is audit-logged in an append-only table. Looking at one business needs an access with a REASON (15 minutes, one business, one scope); the shop owner sees every such
-- access in their own activity log; end-customer names and numbers are masked; a business can ask to be asked first (support_access_set).
-- Schema `admin`: no client role has any privilege on it. Only the public.admin_* / public.support_access_* functions are callable (security definer, search_path fixed, role proven first).

create schema admin;
revoke all on schema admin from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table admin.staff (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  name       text not null check (char_length(name) between 2 and 80 and app.text_is_clean(name)),
  role       text not null check (role in ('owner', 'support', 'finance')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on column admin.staff.name is 'PII: a Stack19 staff member''s own name (never a customer''s)';
comment on column admin.staff.role is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
-- exactly one owner (the owner of the company)
create unique index admin_staff_one_owner on admin.staff (role) where role = 'owner' and active;
alter table admin.staff enable row level security;
alter table admin.staff force row level security;
revoke all on admin.staff from public, anon, authenticated, service_role;

create table admin.sessions (
  session_id   text primary key check (session_id ~ '^[A-Za-z0-9_.:-]{8,100}$'),
  staff_id     uuid not null references admin.staff (user_id) on delete restrict,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
comment on column admin.sessions.session_id is 'SAFE: the sign-in session id of the access token (an opaque token). CLEAN-EXEMPT: strict pattern CHECK';
alter table admin.sessions enable row level security;
alter table admin.sessions force row level security;
revoke all on admin.sessions from public, anon, authenticated, service_role;

create table admin.audit (
  id               uuid primary key default gen_random_uuid(),
  at               timestamptz not null default clock_timestamp(),
  staff_id         uuid not null references admin.staff (user_id) on delete restrict,
  action           text not null check (action in ('list', 'access', 'read', 'audit', 'unmask', 'note', 'status', 'credit', 'refund', 'resend_invoice', 'pause', 'resume', 'view_as_start', 'view_as_end', 'owner_ok')),
  tenant_id        uuid references public.tenants (id) on delete restrict,
  scope            text check (scope in ('profile', 'billing', 'unmask', 'view_as')),
  reason_code      text check (reason_code in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other')),
  reason_text      text check (reason_text is null or (char_length(reason_text) between 3 and 300 and app.text_is_clean(reason_text))),
  target_kind      text check (target_kind in ('business', 'call', 'chat', 'invoice', 'ticket', 'audit', 'staff')),
  target_id        text check (target_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  customer_visible boolean not null default false
);
comment on column admin.audit.action is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.audit.scope is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.audit.reason_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.audit.target_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.audit.target_id is 'SAFE: an opaque id. CLEAN-EXEMPT: strict pattern CHECK';
comment on column admin.audit.reason_text is 'SAFE: the staff member''s own reason, typed before the data is shown; shown to the shop owner when customer_visible';
create index admin_audit_by_time on admin.audit (at desc, id desc);
create index admin_audit_by_tenant on admin.audit (tenant_id, at desc) where tenant_id is not null;
alter table admin.audit enable row level security;
alter table admin.audit force row level security;
revoke all on admin.audit from public, anon, authenticated, service_role;

create function admin.audit_append_only() returns trigger language plpgsql set search_path = '' as
$$ begin raise exception 'the audit trail is append-only' using errcode = '42501'; end $$;
create trigger audit_no_change before update or delete on admin.audit for each row execute function admin.audit_append_only();
create trigger audit_no_truncate before truncate on admin.audit for each statement execute function admin.audit_append_only();
revoke all on function admin.audit_append_only() from public, anon, authenticated, service_role;

create table admin.access_grants (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references admin.staff (user_id) on delete restrict,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  scope      text not null check (scope in ('profile', 'billing', 'unmask', 'view_as')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at)
);
comment on column admin.access_grants.scope is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create index admin_access_grants_lookup on admin.access_grants (tenant_id, staff_id, expires_at desc);
alter table admin.access_grants enable row level security;
alter table admin.access_grants force row level security;
revoke all on admin.access_grants from public, anon, authenticated, service_role;

-- "Require my OK before support views my account": default OFF; the shop owner switches it (support_access_set) and approves a visit (support_access_approve)
create table admin.tenant_support_settings (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  require_ok boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table admin.tenant_support_settings enable row level security;
alter table admin.tenant_support_settings force row level security;
revoke all on admin.tenant_support_settings from public, anon, authenticated, service_role;

create table admin.access_approvals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  expires_at  timestamptz not null check (expires_at > approved_at)
);
create index admin_access_approvals_lookup on admin.access_approvals (tenant_id, expires_at desc);
alter table admin.access_approvals enable row level security;
alter table admin.access_approvals force row level security;
revoke all on admin.access_approvals from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the staff check: every admin function calls this FIRST
--   SM941 not staff (also: an inactive staff account) | SM942 second factor needed | 42501 the role may not | SM943 the session ended (30 minutes without activity, or no session id)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function admin.staff_check(p_roles text[]) returns admin.staff language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_sid   text;
  v_s     admin.sessions;
begin
  if auth.uid() is null then
    raise exception 'not staff' using errcode = 'SM941';
  end if;
  select * into v_staff from admin.staff s where s.user_id = auth.uid() and s.active;
  if not found then
    raise exception 'not staff' using errcode = 'SM941';
  end if;
  -- ALWAYS a second factor (aal2), even where an ordinary account without one would pass
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'a second factor is required' using errcode = 'SM942';
  end if;
  if p_roles is null or not (v_staff.role = any (p_roles)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_sid := nullif(auth.jwt() ->> 'session_id', '');
  if v_sid is null then
    raise exception 'session ended' using errcode = 'SM943';
  end if;
  select * into v_s from admin.sessions x where x.session_id = v_sid for update;
  if not found then
    insert into admin.sessions (session_id, staff_id) values (v_sid, v_staff.user_id);
  elsif v_s.staff_id <> v_staff.user_id or v_s.last_seen_at < now() - interval '30 minutes' then
    raise exception 'session ended' using errcode = 'SM943';
  else
    update admin.sessions set last_seen_at = now() where session_id = v_sid;
  end if;
  return v_staff;
end $$;
revoke all on function admin.staff_check(text[]) from public, anon, authenticated, service_role;

create function admin.log(p_staff uuid, p_action text, p_tenant uuid, p_scope text, p_reason_code text, p_reason_text text, p_target_kind text, p_target_id text, p_customer_visible boolean default false)
returns uuid language plpgsql security definer set search_path = '' as
$$
declare v_id uuid;
begin
  insert into admin.audit (staff_id, action, tenant_id, scope, reason_code, reason_text, target_kind, target_id, customer_visible)
  values (p_staff, p_action, p_tenant, p_scope, p_reason_code, p_reason_text, p_target_kind, p_target_id, coalesce(p_customer_visible, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function admin.log(uuid, text, uuid, text, text, text, text, text, boolean) from public, anon, authenticated, service_role;

-- masking of END-CUSTOMER personal data in support views (a name keeps each word's first letter; a number keeps its last three digits)
create function admin.mask_name(p_name text) returns text language sql immutable set search_path = '' as
$$ select case when p_name is null or btrim(p_name) = '' then null
               else (select string_agg(left(w, 1) || repeat('•', least(greatest(char_length(w) - 1, 1), 6)), ' ' order by o) from unnest(regexp_split_to_array(btrim(p_name), '\s+')) with ordinality as x(w, o)) end $$;
create function admin.mask_phone(p_phone text) returns text language sql immutable set search_path = '' as
$$ select case when p_phone is null or btrim(p_phone) = '' then null else regexp_replace(p_phone, '\d(?=(?:\D*\d){3})', '•', 'g') end $$;
revoke all on function admin.mask_name(text), admin.mask_phone(text) from public, anon, authenticated, service_role;

-- how a reason reads to the shop owner
create function admin.reason_label(p_code text, p_text text) returns text language sql immutable set search_path = '' as
$$ select coalesce(nullif(btrim(p_text), ''), case p_code when 'support_ticket' then 'your support request' when 'customer_asked' then 'you asked us to' when 'privacy_request' then 'a privacy request'
                                                       when 'incident' then 'a technical problem' when 'billing_dispute' then 'a billing question' else 'support' end) $$;
revoke all on function admin.reason_label(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- staff accounts: registered by the OPERATOR only (no sign-up). A staff account belongs to no workspace. Exactly one owner.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.operator_register_staff(p_email text, p_name text, p_role text) returns uuid language plpgsql set search_path = '' as
$$
declare v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'support', 'finance') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_id is null then
    raise exception 'no such account' using errcode = '23503';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_id) then
    raise exception 'a staff account belongs to no workspace' using errcode = '42501';
  end if;
  if p_role = 'owner' and exists (select 1 from admin.staff s where s.role = 'owner' and s.active and s.user_id <> v_id) then
    raise exception 'there is already an owner' using errcode = '42501';
  end if;
  insert into admin.staff (user_id, name, role) values (v_id, p_name, p_role)
  on conflict (user_id) do update set name = excluded.name, role = excluded.role, active = true;
  return v_id;
end $$;
revoke all on function app.operator_register_staff(text, text, text) from public, anon, authenticated, service_role;

create function app.operator_remove_staff(p_email text) returns void language plpgsql set search_path = '' as
$$
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  update admin.staff s set active = false where s.user_id = (select u.id from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))));
end $$;
revoke all on function app.operator_remove_staff(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- one business, as a row of the list (no end-customer data at all)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function admin.business_row(p_tenant uuid) returns jsonb language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'tenant_id', t.id, 'name', t.name, 'demo', t.demo, 'signup_at', t.created_at,
    'business_type', (select a.business_type from public.account_setups a where a.created_tenant_id = t.id limit 1),
    'plan', coalesce((select s.plan_id from pricing.subscriptions s where s.tenant_id = t.id and s.status <> 'cancelled'), 'none'),
    'balance_paise', pricing.balance_of(t.id),
    'status', case when f.live then 'live' when f.ever_changed then 'paused' when f.voice_saved or f.rules_saved then 'in_training' else 'not_live' end,
    'last_activity_at', greatest((select max(c.created_at) from public.phone_calls c where c.tenant_id = t.id),
                                 (select max(m.created_at) from public.outbox_messages m where m.tenant_id = t.id),
                                 (select max(e.received_at) from public.enquiries e where e.tenant_id = t.id)))
    from public.tenants t
   cross join lateral (select (a ->> 'live')::boolean as live, (a ->> 'ever_changed')::boolean as ever_changed, (a ->> 'voice_saved')::boolean as voice_saved, (a ->> 'rules_saved')::boolean as rules_saved
                         from (select app.assistant_facts(t.id) as a) z) f
   where t.id = p_tenant
$$;
revoke all on function admin.business_row(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the admin functions
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.admin_me() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  return jsonb_build_object('staff_id', v_staff.user_id, 'name', v_staff.name, 'role', v_staff.role, 'second_factor', true, 'session_idle_limit_minutes', 30);
end $$;

-- the list needs no reason: it holds business facts only (name, plan, balance, status, dates), no end-customer data
create function public.admin_businesses_list(p_q text default null, p_limit integer default 30, p_after_name text default null, p_after_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_q     text := nullif(btrim(coalesce(p_q, '')), '');
  v_items jsonb;
  v_next  jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  if p_limit is null or p_limit not between 1 and 100 or (v_q is not null and (char_length(v_q) > 80 or not app.text_is_clean(v_q)))
     or ((p_after_name is null) <> (p_after_id is null)) or (p_after_name is not null and not app.text_is_clean(p_after_name)) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  with base as (
    select t.id, t.name from public.tenants t
     where t.archived_at is null
       and (v_q is null or position(lower(v_q) in lower(t.name)) > 0 or t.id::text = lower(v_q))
       and (p_after_name is null or (lower(t.name), t.id) > (lower(p_after_name), p_after_id))
     order by lower(t.name), t.id
     limit p_limit + 1),
  page as (select b.id, b.name, row_number() over (order by lower(b.name), b.id) as rn from base b)
  select coalesce(jsonb_agg(admin.business_row(p.id) order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('after_name', q.name, 'after_id', q.id) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('items', v_items, 'next', v_next);
end $$;

-- look at ONE business: ask first, with a reason. The access lasts 15 minutes, covers one business and one scope. The shop owner sees it in their own activity log.
create function public.admin_access_open(p_tenant_id uuid, p_scope text, p_reason_code text, p_reason_text text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := nullif(btrim(coalesce(p_reason_text, '')), '');
  v_id    uuid;
  v_exp   timestamptz := now() + interval '15 minutes';
begin
  v_staff := admin.staff_check(case when p_scope = 'billing' then array['owner', 'finance'] else array['owner', 'support'] end);
  if p_tenant_id is null or p_scope is null or p_scope not in ('profile', 'billing') or p_reason_code is null
     or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  -- no reason, no data
  if (p_reason_code = 'other' and v_text is null) or (v_text is not null and (char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text))) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  -- the business asked to be asked first: it needs the shop owner's OK within the last 30 minutes
  if coalesce((select s.require_ok from admin.tenant_support_settings s where s.tenant_id = p_tenant_id), false)
     and not exists (select 1 from admin.access_approvals a where a.tenant_id = p_tenant_id and a.expires_at > now()) then
    raise exception 'the shop owner must approve first' using errcode = 'SM945';
  end if;
  insert into admin.access_grants (staff_id, tenant_id, scope, expires_at) values (v_staff.user_id, p_tenant_id, p_scope, v_exp) returning id into v_id;
  perform admin.log(v_staff.user_id, 'access', p_tenant_id, p_scope, p_reason_code, v_text, 'business', p_tenant_id::text, true);
  return jsonb_build_object('access_id', v_id, 'tenant_id', p_tenant_id, 'scope', p_scope, 'expires_at', v_exp);
end $$;

-- the support view of one business (read-only; end-customer names and numbers MASKED)
create function public.admin_business_get(p_tenant_id uuid, p_access_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_facts jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or p_access_id is null
     or not exists (select 1 from admin.access_grants g where g.id = p_access_id and g.staff_id = v_staff.user_id and g.tenant_id = p_tenant_id and g.scope = 'profile' and g.expires_at > now()) then
    raise exception 'an access with a reason is required' using errcode = 'SM944';
  end if;
  v_facts := app.assistant_facts(p_tenant_id);
  perform admin.log(v_staff.user_id, 'read', p_tenant_id, 'profile', null, null, 'business', p_tenant_id::text, false);
  return jsonb_build_object(
    'business', admin.business_row(p_tenant_id),
    'setup', jsonb_build_object('business_name', v_facts -> 'business_name_ok', 'phone_number', v_facts -> 'phone_number_ok', 'voice_saved', v_facts -> 'voice_saved', 'rules_saved', v_facts -> 'rules_saved'),
    'phone_numbers', coalesce((select jsonb_agg(jsonb_build_object('number', n.number, 'label', n.label, 'inbound_on', n.inbound_on) order by n.created_at) from public.phone_numbers n where n.tenant_id = p_tenant_id), '[]'::jsonb),
    'whatsapp', coalesce((select jsonb_build_object('connected', a.status = 'active', 'status', a.status, 'display_phone', a.display_phone, 'connected_at', a.connected_at)
                            from integrations.whatsapp_accounts a where a.tenant_id = p_tenant_id), jsonb_build_object('connected', false, 'status', null, 'display_phone', null, 'connected_at', null)),
    'numbers_30d', jsonb_build_object(
      'calls', (select count(*) from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at > now() - interval '30 days'),
      'call_minutes', coalesce((select round(sum(c.duration_s) / 60.0, 1) from public.phone_calls c where c.tenant_id = p_tenant_id and c.created_at > now() - interval '30 days' and c.answered_at is not null), 0),
      'messages_sent', (select count(*) from public.outbox_messages m where m.tenant_id = p_tenant_id and m.status = 'sent' and m.created_at > now() - interval '30 days'),
      'leads', (select count(*) from public.leads l where l.tenant_id = p_tenant_id and l.archived_at is null),
      'quotes', (select count(*) from public.quotes q where q.tenant_id = p_tenant_id and q.created_at > now() - interval '30 days'),
      'visits', (select count(*) from public.store_visits v where v.tenant_id = p_tenant_id and v.created_at > now() - interval '30 days')),
    'recent_calls', coalesce((select jsonb_agg(x.j order by x.at desc) from (
        select c.created_at as at, jsonb_build_object('id', c.id, 'at', c.created_at, 'direction', c.direction, 'state', c.state, 'duration_s', c.duration_s, 'outcome', c.outcome,
                                                      'customer', admin.mask_name(k.full_name), 'customer_phone', admin.mask_phone(k.phone)) as j
          from public.phone_calls c left join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
         where c.tenant_id = p_tenant_id order by c.created_at desc limit 10) x), '[]'::jsonb),
    'recent_chats', coalesce((select jsonb_agg(y.j order by y.at desc) from (
        select z.last_at as at, jsonb_build_object('lead_id', z.lead_id, 'last_at', z.last_at, 'customer', admin.mask_name(k.full_name), 'customer_phone', admin.mask_phone(k.phone)) as j
          from (select e.lead_id, max(e.received_at) as last_at from public.enquiries e where e.tenant_id = p_tenant_id and e.channel = 'whatsapp' and e.lead_id is not null group by e.lead_id order by 2 desc limit 10) z
          join public.leads l on l.tenant_id = p_tenant_id and l.id = z.lead_id
          left join public.contacts k on k.tenant_id = p_tenant_id and k.id = l.contact_id) y), '[]'::jsonb));
end $$;

-- the audit trail (owner only)
create function public.admin_audit_list(p_tenant_id uuid default null, p_staff_id uuid default null, p_limit integer default 50, p_before_at timestamptz default null, p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_items jsonb;
  v_next  jsonb;
begin
  v_staff := admin.staff_check(array['owner']);
  if p_limit is null or p_limit not between 1 and 100 or ((p_before_at is null) <> (p_before_id is null)) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  with page as (
    select a.*, row_number() over (order by a.at desc, a.id desc) as rn
      from admin.audit a
     where (p_tenant_id is null or a.tenant_id = p_tenant_id) and (p_staff_id is null or a.staff_id = p_staff_id)
       and (p_before_at is null or (a.at, a.id) < (p_before_at, p_before_id))
     order by a.at desc, a.id desc limit p_limit + 1)
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'at', p.at, 'staff', jsonb_build_object('id', p.staff_id, 'name', (select s.name from admin.staff s where s.user_id = p.staff_id)),
                                               'action', p.action, 'tenant_id', p.tenant_id, 'scope', p.scope, 'reason_code', p.reason_code, 'reason_text', p.reason_text,
                                               'target_kind', p.target_kind, 'target_id', p.target_id, 'customer_visible', p.customer_visible) order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('before_at', q.at, 'before_id', q.id) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  perform admin.log(v_staff.user_id, 'audit', p_tenant_id, null, null, null, 'audit', null, false);
  return jsonb_build_object('items', v_items, 'next', v_next);
end $$;

revoke all on function public.admin_me(), public.admin_businesses_list(text, integer, text, uuid), public.admin_access_open(uuid, text, text, text),
                       public.admin_business_get(uuid, uuid), public.admin_audit_list(uuid, uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.admin_me(), public.admin_businesses_list(text, integer, text, uuid), public.admin_access_open(uuid, text, text, text),
                          public.admin_business_get(uuid, uuid), public.admin_audit_list(uuid, uuid, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the SHOP OWNER's side: "Require my OK before support views my account" (default OFF) and the approval of one visit
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.support_access_get(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  return jsonb_build_object(
    'require_ok', coalesce((select s.require_ok from admin.tenant_support_settings s where s.tenant_id = p_tenant_id), false),
    'approved_until', (select max(a.expires_at) from admin.access_approvals a where a.tenant_id = p_tenant_id and a.expires_at > now()));
end $$;

create function public.support_access_set(p_tenant_id uuid, p_require_ok boolean) returns jsonb language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or p_require_ok is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  insert into admin.tenant_support_settings as s (tenant_id, require_ok, updated_by) values (p_tenant_id, p_require_ok, auth.uid())
  on conflict (tenant_id) do update set require_ok = excluded.require_ok, updated_by = excluded.updated_by, updated_at = now();
  perform app.write_audit_event(p_tenant_id, 'support_access.changed', 'workspace', p_tenant_id, null, jsonb_build_object('require_ok', p_require_ok));
  return public.support_access_get(p_tenant_id);
end $$;

create function public.support_access_approve(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  insert into admin.access_approvals (tenant_id, approved_by, expires_at) values (p_tenant_id, auth.uid(), now() + interval '30 minutes');
  perform app.write_audit_event(p_tenant_id, 'support_access.approved', 'workspace', p_tenant_id, null, null);
  return public.support_access_get(p_tenant_id);
end $$;

revoke all on function public.support_access_get(uuid), public.support_access_set(uuid, boolean), public.support_access_approve(uuid) from public, anon;
grant execute on function public.support_access_get(uuid), public.support_access_set(uuid, boolean), public.support_access_approve(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the shop owner's activity log gets a fourth kind, `support` (kind filter and cursor accept it)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.activity_log(p_tenant_id uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_key text default null, p_kind text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_next  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('call', 'message', 'action', 'support'))
     or ((p_before_at is null) <> (p_before_key is null)) or (p_before_key is not null and p_before_key !~ '^(call|message|action|support):[0-9a-f-]{36}$') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  with src as (
    (select c.created_at as at, 'call:' || c.id::text as key,
            jsonb_build_object('key', 'call:' || c.id::text, 'kind', 'call', 'id', c.id, 'at', c.created_at, 'who', 'assistant', 'direction', c.direction, 'state', c.state,
                               'live', app.phone_call_is_live(c), 'outcome', c.outcome, 'duration_s', c.duration_s, 'summary', c.summary,
                               'contact_id', c.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
                               'lead_id', c.lead_id, 'sandbox', c.sandbox, 'simulated', c.simulated,
                               'waiting', (c.end_reason = 'handover' and c.handled_at is null), 'undo', jsonb_build_object('state', 'none', 'until', null)) as j
       from public.phone_calls c
      where c.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'call')
        and (p_before_at is null or (c.created_at, 'call:' || c.id::text) < (p_before_at, p_before_key))
      order by c.created_at desc, c.id desc limit p_limit + 1)
    union all
    (select m.created_at, 'message:' || m.id::text,
            jsonb_build_object('key', 'message:' || m.id::text, 'kind', 'message', 'id', m.id, 'at', m.created_at, 'who', m.source, 'channel', m.channel, 'category', m.category,
                               'status', m.status, 'reason', m.reason, 'flags', m.flags,
                               'contact_id', m.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = m.tenant_id and x.id = m.contact_id),
                               'lead_id', m.lead_id, 'scheduled_for', m.scheduled_for,
                               'waiting', (m.status = 'needs_approval'), 'undo', jsonb_build_object('state', 'none', 'until', null))
       from public.outbox_messages m
      where m.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'message')
        and (p_before_at is null or (m.created_at, 'message:' || m.id::text) < (p_before_at, p_before_key))
      order by m.created_at desc, m.id desc limit p_limit + 1)
    union all
    (select w.created_at, 'action:' || w.id::text,
            jsonb_build_object('key', 'action:' || w.id::text, 'kind', 'action', 'id', w.id, 'at', w.created_at, 'who', 'assistant', 'tool', w.tool, 'summary', w.summary,
                               'status', w.status, 'requested_by', w.requested_by, 'decided_by', w.decided_by, 'plan_id', w.plan_id,
                               'waiting', false,
                               'undo', jsonb_build_object('state', case when w.status = 'undone' then 'done'
                                                                       when w.undo is null or w.status <> 'done' then 'none'
                                                                       when w.undo_until is not null and w.undo_until < now() then 'expired'
                                                                       else 'available' end,
                                                         'until', case when w.undo is not null and w.status = 'done' then w.undo_until end))
       from public.assistant_work_actions w
      where w.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'action')
        and (p_before_at is null or (w.created_at, 'action:' || w.id::text) < (p_before_at, p_before_key))
      order by w.created_at desc, w.id desc limit p_limit + 1)
    union all
    -- every time Stack19 support looked at this business (admin_access_open writes it as customer_visible): the shop owner sees who-what-why, never a staff name
    (select a.at, 'support:' || a.id::text,
            jsonb_build_object('key', 'support:' || a.id::text, 'kind', 'support', 'id', a.id, 'at', a.at, 'who', 'support', 'summary', 'Stack19 support viewed your account',
                               'reason', admin.reason_label(a.reason_code, a.reason_text), 'waiting', false, 'undo', jsonb_build_object('state', 'none', 'until', null))
       from admin.audit a
      where a.tenant_id = p_tenant_id and a.customer_visible and (p_kind is null or p_kind = 'support')
        and (p_before_at is null or (a.at, 'support:' || a.id::text) < (p_before_at, p_before_key))
      order by a.at desc, a.id desc limit p_limit + 1)),
  page as (select s.at, s.key, s.j, row_number() over (order by s.at desc, s.key desc) as rn from src s order by s.at desc, s.key desc limit p_limit + 1)
  select coalesce(jsonb_agg(p.j order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('before_at', q.at, 'before_key', q.key) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;
