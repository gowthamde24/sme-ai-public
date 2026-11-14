-- Admin console, the rest of phase 2 (owner brief 14 Nov 2026): canned replies, notes on a business, plan-change history, the Money screens (owner and finance), search by GSTIN, and two fields the screens asked for
-- (`held_by_support` on a business, the staff role on a ticket message). Same rules as the foundation: every function proves the staff row, the role, the second factor and the live session FIRST; the schema
-- `admin` has no client privilege; every read of money or of a business is in the append-only trail.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. two small fields
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function admin.business_row(p_tenant uuid) returns jsonb language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'tenant_id', t.id, 'name', t.name, 'demo', t.demo, 'signup_at', t.created_at,
    'business_type', (select a.business_type from public.account_setups a where a.created_tenant_id = t.id limit 1),
    'plan', coalesce((select s.plan_id from pricing.subscriptions s where s.tenant_id = t.id and s.status <> 'cancelled'), 'none'),
    'plan_name', coalesce((select p.name from pricing.subscriptions s join pricing.plans p on p.id = s.plan_id where s.tenant_id = t.id and s.status <> 'cancelled'), 'No plan'),
    'town', (select w.town from workspace.profiles w where w.tenant_id = t.id),
    'balance_paise', pricing.balance_of(t.id),
    'status', case when f.live then 'live' when f.ever_changed then 'paused' when f.voice_saved or f.rules_saved then 'in_training' else 'not_live' end,
    'held_by_support', f.held,
    'last_activity_at', greatest((select max(c.created_at) from public.phone_calls c where c.tenant_id = t.id),
                                 (select max(m.created_at) from public.outbox_messages m where m.tenant_id = t.id),
                                 (select max(e.received_at) from public.enquiries e where e.tenant_id = t.id)))
    from public.tenants t
   cross join lateral (select (a ->> 'live')::boolean as live, (a ->> 'ever_changed')::boolean as ever_changed, (a ->> 'voice_saved')::boolean as voice_saved, (a ->> 'rules_saved')::boolean as rules_saved,
                              coalesce((a ->> 'staff_hold')::boolean, false) as held
                         from (select app.assistant_facts(t.id) as a) z) f
   where t.id = p_tenant
$$;

create or replace function admin.ticket_thread(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as
$$
  select admin.ticket_row(p_id) || jsonb_build_object('messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'at', m.created_at, 'staff', jsonb_build_object('id', m.staff_id, 'name', s.name, 'role', s.role), 'body', m.body,
                                        'delivered', false) order by m.created_at, m.id)
      from admin.ticket_messages m join admin.staff s on s.user_id = m.staff_id where m.ticket_id = p_id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. canned replies (owner and support): short texts typed by staff, used when answering a ticket
-- ---------------------------------------------------------------------------------------------------------------------------------
create table admin.canned_replies (
  id          uuid primary key,
  title       text not null check (char_length(title) between 3 and 60 and app.text_is_clean(title)),
  body        text not null check (char_length(body) between 1 and 2000 and app.text_is_clean(body)),
  archived    boolean not null default false,
  created_by  uuid not null references admin.staff (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column admin.canned_replies.title is 'SAFE: a short title typed by Stack19 staff';
comment on column admin.canned_replies.body is 'SAFE: words typed by Stack19 staff, a reply template; holds no customer data';
alter table admin.canned_replies enable row level security;
alter table admin.canned_replies force row level security;
revoke all on admin.canned_replies from public, anon, authenticated, service_role;

create function public.admin_canned_list(p_include_archived boolean default false) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'ticket', null, false);
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'body', c.body, 'archived', c.archived) order by c.archived, lower(c.title), c.id)
                                                 from admin.canned_replies c where p_include_archived or not c.archived), '[]'::jsonb));
end $$;

-- the id is the caller's (a retry changes nothing twice); a template that is no longer wanted is archived, never deleted
create function public.admin_canned_save(p_id uuid, p_title text, p_body text, p_archived boolean default false) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  c       admin.canned_replies;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_id is null or char_length(v_title) not between 3 and 60 or char_length(v_body) not between 1 and 2000 or not app.text_is_clean(v_title) or not app.text_is_clean(v_body) or p_archived is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if (select count(*) from admin.canned_replies) >= 200 and not exists (select 1 from admin.canned_replies x where x.id = p_id) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into admin.canned_replies as t (id, title, body, archived, created_by) values (p_id, v_title, v_body, p_archived, v_staff.user_id)
  on conflict (id) do update set title = excluded.title, body = excluded.body, archived = excluded.archived, updated_at = now()
  returning * into c;
  perform admin.log(v_staff.user_id, 'note', null, null, null, null, 'ticket', null, false);
  return jsonb_build_object('id', c.id, 'title', c.title, 'body', c.body, 'archived', c.archived);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. notes on a business (owner and support): internal, append-only, never shown to the shop
-- ---------------------------------------------------------------------------------------------------------------------------------
create table admin.business_notes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  staff_id   uuid not null references admin.staff (user_id) on delete restrict,
  body       text not null check (char_length(body) between 1 and 1000 and app.text_is_clean(body)),
  created_at timestamptz not null default clock_timestamp()
);
comment on column admin.business_notes.body is 'SAFE: words typed by Stack19 staff about a business; internal, never shown to the shop; staff are told not to put customer data in a note';
create index admin_business_notes_by_tenant on admin.business_notes (tenant_id, created_at desc);
alter table admin.business_notes enable row level security;
alter table admin.business_notes force row level security;
revoke all on admin.business_notes from public, anon, authenticated, service_role;
create function admin.business_notes_append_only() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'business notes are append-only' using errcode = '42501'; end $$;
create trigger business_notes_append_only before update or delete on admin.business_notes for each row execute function admin.business_notes_append_only();

create function public.admin_note_add(p_tenant_id uuid, p_body text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := btrim(coalesce(p_body, ''));
  v_id    uuid;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or char_length(v_text) not between 1 and 1000 or not app.text_is_clean(v_text) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  insert into admin.business_notes (tenant_id, staff_id, body) values (p_tenant_id, v_staff.user_id, v_text) returning id into v_id;
  perform admin.log(v_staff.user_id, 'note', p_tenant_id, null, null, null, 'business', p_tenant_id::text, false);
  return jsonb_build_object('id', v_id, 'at', (select created_at from admin.business_notes where id = v_id), 'staff', jsonb_build_object('id', v_staff.user_id, 'name', v_staff.name, 'role', v_staff.role), 'body', v_text);
end $$;

create function public.admin_notes_list(p_tenant_id uuid, p_limit integer default 50) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform admin.log(v_staff.user_id, 'read', p_tenant_id, null, null, null, 'business', p_tenant_id::text, false);
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'at', n.created_at, 'staff', jsonb_build_object('id', n.staff_id, 'name', s.name, 'role', s.role), 'body', n.body) order by n.created_at desc, n.id)
                                                 from (select * from admin.business_notes x where x.tenant_id = p_tenant_id order by x.created_at desc, x.id limit p_limit) n join admin.staff s on s.user_id = n.staff_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. plan changes, recorded from now on (the subscription row only knows today's plan): new, upgrade, downgrade, interval change, cancelled
-- ---------------------------------------------------------------------------------------------------------------------------------
create table admin.plan_changes (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('new', 'upgrade', 'downgrade', 'interval', 'cancelled')),
  from_plan   text,
  to_plan     text,
  mrr_delta_paise bigint not null
);
comment on column admin.plan_changes.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.plan_changes.from_plan is 'SAFE: a plan id. CLEAN-EXEMPT: foreign key to a closed list';
comment on column admin.plan_changes.to_plan is 'SAFE: a plan id. CLEAN-EXEMPT: foreign key to a closed list';
create index admin_plan_changes_at on admin.plan_changes (at desc);
alter table admin.plan_changes enable row level security;
alter table admin.plan_changes force row level security;
revoke all on admin.plan_changes from public, anon, authenticated, service_role;

create function admin.mrr_of(p_plan text, p_interval text) returns bigint language sql stable set search_path = '' as
$$ select coalesce((select case p_interval when 'monthly' then p.monthly_paise else (p.yearly_paise + 6) / 12 end from pricing.plans p where p.id = p_plan), 0)::bigint $$;
revoke all on function admin.mrr_of(text, text) from public, anon, authenticated, service_role;

create function admin.record_plan_change() returns trigger language plpgsql security definer set search_path = '' as
$$
declare
  v_old bigint;
  v_new bigint;
begin
  if tg_op = 'INSERT' then
    insert into admin.plan_changes (tenant_id, kind, from_plan, to_plan, mrr_delta_paise) values (new.tenant_id, 'new', null, new.plan_id, admin.mrr_of(new.plan_id, new.interval));
    return new;
  end if;
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    insert into admin.plan_changes (tenant_id, kind, from_plan, to_plan, mrr_delta_paise) values (new.tenant_id, 'cancelled', old.plan_id, null, -admin.mrr_of(old.plan_id, old.interval));
  elsif old.plan_id is distinct from new.plan_id or old.interval is distinct from new.interval then
    v_old := admin.mrr_of(old.plan_id, old.interval);
    v_new := admin.mrr_of(new.plan_id, new.interval);
    insert into admin.plan_changes (tenant_id, kind, from_plan, to_plan, mrr_delta_paise)
    values (new.tenant_id, case when old.plan_id = new.plan_id then 'interval' when v_new >= v_old then 'upgrade' else 'downgrade' end, old.plan_id, new.plan_id, v_new - v_old);
  end if;
  return new;
end $$;
revoke all on function admin.record_plan_change() from public, anon, authenticated, service_role;
create trigger admin_record_plan_change after insert or update on pricing.subscriptions for each row execute function admin.record_plan_change();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Money (owner and finance): the numbers of a period, the invoices, the failed payments
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.admin_money_summary(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_from  timestamptz;
  v_to    timestamptz;
  v_first timestamptz;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_from := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  select min(c.at) into v_first from admin.plan_changes c;
  perform admin.log(v_staff.user_id, 'read', null, null, null, null, 'invoice', null, false);
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'mrr_paise', (select coalesce(sum(admin.mrr_of(s.plan_id, s.interval)), 0) from pricing.subscriptions s where s.status <> 'cancelled'),
    'active_by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan_id', x.plan_id, 'plan_name', x.name, 'count', x.n, 'mrr_paise', x.mrr) order by x.sort)
                                  from (select p.id as plan_id, p.name, p.sort, count(s.*) as n, coalesce(sum(admin.mrr_of(s.plan_id, s.interval)), 0) as mrr
                                          from pricing.plans p left join pricing.subscriptions s on s.plan_id = p.id and s.status <> 'cancelled' group by p.id, p.name, p.sort) x), '[]'::jsonb),
    'movement', jsonb_build_object(
      'recorded_since', v_first,
      'new', (select count(*) from admin.plan_changes c where c.kind = 'new' and c.at >= v_from and c.at < v_to),
      'upgrades', (select count(*) from admin.plan_changes c where c.kind = 'upgrade' and c.at >= v_from and c.at < v_to),
      'downgrades', (select count(*) from admin.plan_changes c where c.kind = 'downgrade' and c.at >= v_from and c.at < v_to),
      'cancellations', (select count(*) from admin.plan_changes c where c.kind = 'cancelled' and c.at >= v_from and c.at < v_to),
      'mrr_delta_paise', (select coalesce(sum(c.mrr_delta_paise), 0) from admin.plan_changes c where c.at >= v_from and c.at < v_to)),
    'topups', (select jsonb_build_object('count', count(*), 'subtotal_paise', coalesce(sum(i.subtotal_paise), 0), 'gst_paise', coalesce(sum(i.gst_paise), 0), 'total_paise', coalesce(sum(i.total_paise), 0))
                 from pricing.invoices i where i.kind = 'topup' and i.issued_at >= v_from and i.issued_at < v_to),
    'subscription_invoices', (select jsonb_build_object('count', count(*), 'subtotal_paise', coalesce(sum(i.subtotal_paise), 0), 'gst_paise', coalesce(sum(i.gst_paise), 0), 'total_paise', coalesce(sum(i.total_paise), 0))
                 from pricing.invoices i where i.kind <> 'topup' and i.issued_at >= v_from and i.issued_at < v_to),
    'refunds', (select jsonb_build_object('count', count(*), 'total_paise', coalesce(sum(l.amount_paise), 0)) from pricing.wallet_lots l where l.source = 'refund' and l.created_at >= v_from and l.created_at < v_to),
    'goodwill', (select jsonb_build_object('count', count(*), 'total_paise', coalesce(sum(l.amount_paise), 0)) from pricing.wallet_lots l where l.source = 'adjustment' and l.ref like 'goodwill:%' and l.created_at >= v_from and l.created_at < v_to),
    'failed_payments', jsonb_build_object(
      'charges_failed', (select count(*) from pricing.events e where e.kind = 'charge_failed' and e.at >= v_from and e.at < v_to),
      'halted', (select count(*) from pricing.events e where e.kind = 'halted' and e.at >= v_from and e.at < v_to),
      'past_due_now', (select count(*) from pricing.subscriptions s where s.status = 'past_due')));
end $$;

create function public.admin_money_invoices(p_from date, p_to date, p_limit integer default 50, p_after_at timestamptz default null, p_after_id uuid default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_from  timestamptz;
  v_to    timestamptz;
  v_items jsonb;
  v_next  jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 or p_limit is null or p_limit not between 1 and 200 or ((p_after_at is null) <> (p_after_id is null)) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_from := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  perform admin.log(v_staff.user_id, 'read', null, null, null, null, 'invoice', null, false);
  with page as (
    select i.*, t.name as business_name, bp.gstin as shop_gstin, row_number() over (order by i.issued_at desc, i.id desc) as rn
      from pricing.invoices i join public.tenants t on t.id = i.tenant_id left join public.business_profile bp on bp.tenant_id = i.tenant_id
     where i.issued_at >= v_from and i.issued_at < v_to and (p_after_at is null or (i.issued_at, i.id) < (p_after_at, p_after_id))
     order by i.issued_at desc, i.id desc limit p_limit + 1)
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'kind', p.kind, 'tenant_id', p.tenant_id, 'business_name', p.business_name, 'shop_gstin', p.shop_gstin,
                                               'subtotal_paise', p.subtotal_paise, 'gst_paise', p.gst_paise, 'total_paise', p.total_paise, 'issued_at', p.issued_at) order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('after_at', q.issued_at, 'after_id', q.id) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next from page p;
  return jsonb_build_object('items', v_items, 'next', v_next);
end $$;

-- everything for the CA in one call (at most 5,000 invoices of a period); the web turns it into a CSV file
create function public.admin_money_export(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_from  timestamptz;
  v_to    timestamptz;
  v_items jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_from := (p_from::timestamp at time zone 'Asia/Kolkata');
  v_to := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  perform admin.log(v_staff.user_id, 'read', null, null, null, null, 'invoice', 'export', false);
  select coalesce(jsonb_agg(jsonb_build_object('number', i.number, 'kind', i.kind, 'business_name', t.name, 'shop_gstin', bp.gstin, 'subtotal_paise', i.subtotal_paise, 'gst_paise', i.gst_paise,
                                               'total_paise', i.total_paise, 'issued_at', i.issued_at) order by i.issued_at, i.id), '[]'::jsonb) into v_items
    from (select * from pricing.invoices x where x.issued_at >= v_from and x.issued_at < v_to order by x.issued_at, x.id limit 5000) i
    join public.tenants t on t.id = i.tenant_id left join public.business_profile bp on bp.tenant_id = i.tenant_id;
  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'items', v_items, 'test_mode', true);
end $$;

create function public.admin_money_failed() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  perform admin.log(v_staff.user_id, 'read', null, null, null, null, 'invoice', null, false);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'business_name', x.name, 'plan_name', x.plan_name, 'status', x.status, 'failures_30d', x.failures, 'last_failed_at', x.last_failed, 'period_end', x.period_end) order by x.last_failed desc nulls last)
      from (select s.tenant_id, t.name, p.name as plan_name, s.status, s.period_end,
                   (select count(*) from pricing.events e where e.tenant_id = s.tenant_id and e.kind in ('charge_failed', 'halted') and e.at > now() - interval '30 days') as failures,
                   (select max(e.at) from pricing.events e where e.tenant_id = s.tenant_id and e.kind in ('charge_failed', 'halted')) as last_failed
              from pricing.subscriptions s join public.tenants t on t.id = s.tenant_id join pricing.plans p on p.id = s.plan_id
             where s.status = 'past_due' or exists (select 1 from pricing.events e where e.tenant_id = s.tenant_id and e.kind in ('charge_failed', 'halted') and e.at > now() - interval '30 days')) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. search: a business's GSTIN too (owner, support, finance see businesses; the shop's own GSTIN is on its profile)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_search(p_q text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_q     text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_biz   jsonb;
  v_inv   jsonb := '[]'::jsonb;
  v_tix   jsonb := '[]'::jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  if char_length(v_q) not between 2 and 80 or not app.text_is_clean(v_q) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(admin.business_row(x.id) order by lower(x.name), x.id), '[]'::jsonb) into v_biz
    from (select t.id, t.name from public.tenants t
           where t.archived_at is null
             and (position(lower(v_q) in lower(t.name)) > 0 or t.id::text = lower(v_q)
                  or (char_length(v_q) >= 6 and exists (select 1 from public.business_profile bp where bp.tenant_id = t.id and upper(bp.gstin) like '%' || upper(replace(replace(v_q, '%', ''), '_', '')) || '%'))
                  or (char_length(v_digits) >= 4 and (exists (select 1 from public.phone_numbers n where n.tenant_id = t.id and regexp_replace(n.number, '\D', '', 'g') like '%' || v_digits || '%')
                                                      or exists (select 1 from integrations.whatsapp_accounts a where a.tenant_id = t.id and regexp_replace(coalesce(a.display_phone, ''), '\D', '', 'g') like '%' || v_digits || '%'))))
           order by lower(t.name), t.id limit 5) x;
  if v_staff.role in ('owner', 'finance') then
    select coalesce(jsonb_agg(jsonb_build_object('number', i.number, 'kind', i.kind, 'tenant_id', i.tenant_id, 'business_name', t.name, 'total_paise', i.total_paise, 'issued_at', i.issued_at) order by i.issued_at desc), '[]'::jsonb) into v_inv
      from (select * from pricing.invoices x where upper(x.number) like '%' || upper(replace(replace(v_q, '%', ''), '_', '')) || '%' order by x.issued_at desc limit 5) i join public.tenants t on t.id = i.tenant_id;
  end if;
  if v_staff.role in ('owner', 'support') then
    select coalesce(jsonb_agg(admin.ticket_row(k.id) order by k.last_message_at desc), '[]'::jsonb) into v_tix
      from (select x.id, x.last_message_at from admin.support_tickets x where position(lower(v_q) in lower(x.subject)) > 0 or x.id::text = lower(v_q) order by x.last_message_at desc limit 5) k;
  end if;
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('businesses', v_biz, 'invoices', v_inv, 'tickets', v_tix);
end $$;

revoke all on function public.admin_canned_list(boolean), public.admin_canned_save(uuid, text, text, boolean), public.admin_note_add(uuid, text), public.admin_notes_list(uuid, integer),
  public.admin_money_summary(date, date), public.admin_money_invoices(date, date, integer, timestamptz, uuid), public.admin_money_export(date, date), public.admin_money_failed() from public, anon;
grant execute on function public.admin_canned_list(boolean), public.admin_canned_save(uuid, text, text, boolean), public.admin_note_add(uuid, text), public.admin_notes_list(uuid, integer),
  public.admin_money_summary(date, date), public.admin_money_invoices(date, date, integer, timestamptz, uuid), public.admin_money_export(date, date), public.admin_money_failed() to authenticated;
