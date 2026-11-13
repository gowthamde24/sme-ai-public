-- Admin console: everything the Overview screen needs (approved-mocks/admin-overview.html, 13 Nov 2026), in ONE call, plus the support queue and the search box.
--   KPIs (MRR, active businesses, calls today + connected %, gross margin), the support queue, health per component, the businesses table, our cost per provider and the margin, the sidebar counts.
-- Money (MRR, margin, costs) is for the owner and finance roles; support gets those parts as null. Provider names and costs appear ONLY here (and in the later usage screens).
-- Same rules as the foundation: every function proves the staff row, the role, the second factor and the live session FIRST; the schema `admin` has no client privilege.

create table admin.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  subject         text not null check (char_length(subject) between 3 and 140 and app.text_is_clean(subject)),
  channel         text not null check (channel in ('phone', 'whatsapp', 'chat', 'email')),
  priority        text not null default 'normal' check (priority in ('urgent', 'high', 'normal')),
  status          text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  assignee_id     uuid references admin.staff (user_id) on delete restrict,
  created_by      uuid references admin.staff (user_id) on delete restrict,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at       timestamptz,
  check ((status = 'closed') = (closed_at is not null))
);
comment on column admin.support_tickets.channel is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.support_tickets.priority is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.support_tickets.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column admin.support_tickets.subject is 'SAFE: a short title typed by Stack19 staff (not a customer''s words)';
create index admin_support_tickets_queue on admin.support_tickets (status, priority, last_message_at);
create index admin_support_tickets_by_tenant on admin.support_tickets (tenant_id, created_at desc);
alter table admin.support_tickets enable row level security;
alter table admin.support_tickets force row level security;
revoke all on admin.support_tickets from public, anon, authenticated, service_role;

-- the queue: urgent first, then high, then normal; the longest-waiting first inside a priority
create function admin.ticket_row(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('id', k.id, 'tenant_id', k.tenant_id, 'business_name', t.name, 'subject', k.subject, 'channel', k.channel, 'priority', k.priority, 'status', k.status,
                            'created_at', k.created_at, 'last_message_at', k.last_message_at, 'waiting_minutes', greatest(0, floor(extract(epoch from (now() - k.last_message_at)) / 60))::int,
                            'assignee', case when k.assignee_id is null then null else jsonb_build_object('id', k.assignee_id, 'name', (select s.name from admin.staff s where s.user_id = k.assignee_id)) end)
    from admin.support_tickets k join public.tenants t on t.id = k.tenant_id where k.id = p_id
$$;
revoke all on function admin.ticket_row(uuid) from public, anon, authenticated, service_role;

create function admin.tickets_page(p_status text, p_limit integer) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_items jsonb;
  v_total integer;
begin
  -- 'active' = open or waiting (what is still on the queue)
  select count(*) into v_total from admin.support_tickets k where case when p_status = 'active' then k.status in ('open', 'waiting') else k.status = p_status end;
  select coalesce(jsonb_agg(admin.ticket_row(x.id) order by x.rank, x.last_message_at, x.id), '[]'::jsonb) into v_items
    from (select k.id, k.last_message_at, case k.priority when 'urgent' then 1 when 'high' then 2 else 3 end as rank
            from admin.support_tickets k
           where case when p_status = 'active' then k.status in ('open', 'waiting') else k.status = p_status end
           order by 3, k.last_message_at, k.id limit p_limit) x;
  return jsonb_build_object('items', v_items, 'total', v_total);
end $$;
revoke all on function admin.tickets_page(text, integer) from public, anon, authenticated, service_role;

create function public.admin_tickets_list(p_status text default 'open', p_limit integer default 30) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_limit is null or p_limit not between 1 and 100 or p_status is null or p_status not in ('open', 'waiting', 'closed', 'active') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'ticket', null, false);
  return admin.tickets_page(p_status, p_limit);
end $$;

-- logging a ticket by hand (a call-in, a message seen elsewhere); the shop-facing "Help" form comes later
create function public.admin_ticket_create(p_tenant_id uuid, p_subject text, p_channel text, p_priority text default 'normal', p_assignee_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_id    uuid;
  v_text  text := btrim(coalesce(p_subject, ''));
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  if p_tenant_id is null or char_length(v_text) not between 3 and 140 or not app.text_is_clean(v_text) or p_channel is null or p_channel not in ('phone', 'whatsapp', 'chat', 'email')
     or p_priority is null or p_priority not in ('urgent', 'high', 'normal') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  if p_assignee_id is not null and not exists (select 1 from admin.staff s where s.user_id = p_assignee_id and s.active) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into admin.support_tickets (tenant_id, subject, channel, priority, assignee_id, created_by) values (p_tenant_id, v_text, p_channel, p_priority, p_assignee_id, v_staff.user_id) returning id into v_id;
  perform admin.log(v_staff.user_id, 'note', p_tenant_id, null, null, null, 'ticket', v_id::text, false);
  return admin.ticket_row(v_id);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the Overview
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.admin_overview() returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_staff     admin.staff;
  v_money     boolean;
  v_today     timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_month     timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_total     integer;
  v_active    integer;
  v_new_week  integer;
  v_free_only integer;
  v_mrr       bigint;
  v_calls     integer;
  v_conn      integer;
  v_rev       bigint;
  v_cost      bigint;
  v_cost_from timestamptz;
  v_open      integer;
  v_calls_h   integer;
  v_failed_h  integer;
  v_wa_failed integer;
  v_stuck     integer;
  v_comp      jsonb := '[]'::jsonb;
  v_issues    integer := 0;
  v_state     text;
  v_compliance integer;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  v_money := v_staff.role in ('owner', 'finance');

  select count(*) into v_total from public.tenants t where t.archived_at is null;
  select count(*) into v_active from pricing.subscriptions s join public.tenants t on t.id = s.tenant_id where s.status = 'active' and t.archived_at is null;
  select count(*) into v_new_week from public.tenants t where t.archived_at is null and t.created_at > now() - interval '7 days';
  select count(*) into v_free_only from pricing.free_starts f join public.tenants t on t.id = f.tenant_id
   where t.archived_at is null and not exists (select 1 from pricing.subscriptions s where s.tenant_id = f.tenant_id and s.status <> 'cancelled');
  select coalesce(sum(case s.interval when 'monthly' then p.monthly_paise else (p.yearly_paise + 6) / 12 end), 0) into v_mrr
    from pricing.subscriptions s join pricing.plans p on p.id = s.plan_id where s.status <> 'cancelled';
  select count(*), count(*) filter (where c.answered_at is not null) into v_calls, v_conn
    from public.phone_calls c where c.created_at >= v_today and not coalesce(c.simulated, false);
  select coalesce(sum(i.subtotal_paise), 0) into v_rev from pricing.invoices i where i.issued_at >= v_month;
  select coalesce(sum(u.cost_paise), 0), min(u.occurred_at) into v_cost, v_cost_from from ops.provider_usage u where u.occurred_at >= v_month;
  select count(*) into v_open from admin.support_tickets k where k.status in ('open', 'waiting');

  -- health: what the database itself can measure; the rest says `unknown` instead of pretending
  select count(*), count(*) filter (where c.state = 'failed') into v_calls_h, v_failed_h from public.phone_calls c where c.created_at > now() - interval '1 hour' and not coalesce(c.simulated, false);
  select count(*) into v_wa_failed from public.outbox_messages m where m.status = 'failed' and m.updated_at > now() - interval '1 hour';
  select count(*) into v_stuck from integrations.webhook_events w where w.provider in ('razorpay', 'fake') and w.outcome = 'received' and w.received_at < now() - interval '5 minutes' and w.received_at > now() - interval '1 day';
  v_comp := jsonb_build_array(
    jsonb_build_object('key', 'api', 'label', 'API', 'state', 'healthy', 'note', null),
    jsonb_build_object('key', 'phone_calls', 'label', 'Phone calls',
                       'state', case when v_calls_h > 0 and v_failed_h::numeric / v_calls_h >= 0.5 then 'down' when v_calls_h > 0 and v_failed_h::numeric / v_calls_h >= 0.2 then 'degraded' else 'healthy' end,
                       'note', case when v_calls_h = 0 then 'No calls in the last hour' else v_failed_h || ' of ' || v_calls_h || ' calls failed in the last hour' end),
    jsonb_build_object('key', 'whatsapp', 'label', 'WhatsApp sending', 'state', case when v_wa_failed >= 10 then 'down' when v_wa_failed >= 1 then 'degraded' else 'healthy' end,
                       'note', case when v_wa_failed = 0 then null else v_wa_failed || ' send errors / 1h' end),
    jsonb_build_object('key', 'voice', 'label', 'Voice', 'state', 'unknown', 'note', 'Latency is not measured yet'),
    jsonb_build_object('key', 'database', 'label', 'Database', 'state', 'healthy', 'note', null),
    jsonb_build_object('key', 'payments', 'label', 'Payments', 'state', case when v_stuck >= 1 then 'degraded' else 'healthy' end,
                       'note', case when v_stuck = 0 then null else v_stuck || ' payment events not processed' end));
  select count(*) into v_issues from jsonb_array_elements(v_comp) c where c ->> 'state' in ('degraded', 'down');

  select (select count(*) from privacy.deletion_requests d where d.status in ('scheduled', 'blocked'))
       + (select count(*) from privacy.data_exports e where e.status in ('queued', 'running'))
       + (select count(*) from public.erasure_requests r where r.status in ('pending', 'executing')) into v_compliance;

  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object(
    'generated_at', now(),
    'role', v_staff.role,
    'badges', jsonb_build_object('businesses', v_total, 'support_open', v_open, 'health_issues', v_issues, 'compliance_open', v_compliance),
    'kpis', jsonb_build_object(
      -- change_percent stays null until there is a month of history to compare with (no guessing)
      'mrr', case when v_money then jsonb_build_object('paise', v_mrr, 'change_percent', null) end,
      'active_businesses', jsonb_build_object('count', v_active, 'added_this_week', v_new_week, 'on_free_start', v_free_only),
      'calls_today', jsonb_build_object('count', v_calls, 'connected_percent', case when v_calls > 0 then round(100.0 * v_conn / v_calls, 1) end),
      'gross_margin', case when v_money then jsonb_build_object('percent', case when v_rev > 0 then round(100.0 * (v_rev - v_cost) / v_rev, 1) end, 'revenue_paise', v_rev, 'cost_paise', v_cost, 'costs_recorded_since', v_cost_from) end),
    -- customer tickets are for owner and support (finance sees only the number in `badges`)
    'support_queue', case when v_staff.role in ('owner', 'support') then (select jsonb_build_object('total_open', v_open, 'items', t.j -> 'items') from (select admin.tickets_page('active', 5) as j) t) end,
    'health', jsonb_build_object('components', v_comp, 'issues', v_issues),
    'businesses', (select coalesce(jsonb_agg(admin.business_row(x.id) order by x.la desc nulls last, lower(x.name), x.id), '[]'::jsonb)
                     from (select t.id, t.name, greatest((select max(c.created_at) from public.phone_calls c where c.tenant_id = t.id), (select max(m.created_at) from public.outbox_messages m where m.tenant_id = t.id),
                                                          (select max(e.received_at) from public.enquiries e where e.tenant_id = t.id)) as la
                             from public.tenants t where t.archived_at is null order by la desc nulls last, lower(t.name), t.id limit 6) x),
    'costs_this_month', case when v_money then jsonb_build_object(
      'period_start', v_month, 'revenue_paise', v_rev, 'cost_paise', v_cost, 'margin_paise', v_rev - v_cost,
      'providers', (select jsonb_agg(jsonb_build_object('provider', pv.provider, 'role', pv.role, 'cost_paise', coalesce(c.cost, 0)) order by pv.ord)
                      from (values ('cartesia', 'voice', 1), ('sarvam', 'speech_to_text', 2), ('plivo', 'calls_and_numbers', 3), ('anthropic', 'ai_model', 4), ('meta', 'whatsapp', 5), ('google', 'lead_search', 6)) pv(provider, role, ord)
                      left join (select u.provider, sum(u.cost_paise) as cost from ops.provider_usage u where u.occurred_at >= v_month group by u.provider) c on c.provider = pv.provider)) end);
end $$;

-- the search box (⌘K): businesses by name or id, a business's OWN phone number, invoices (owner / finance), tickets (owner / support). End-customer phone numbers are not searched here.
create function public.admin_search(p_q text) returns jsonb language plpgsql security definer set search_path = '' as
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
  -- the words searched for are NOT stored (they may be a phone number); only that a search happened
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('businesses', v_biz, 'invoices', v_inv, 'tickets', v_tix);
end $$;

revoke all on function public.admin_tickets_list(text, integer), public.admin_ticket_create(uuid, text, text, text, uuid), public.admin_overview(), public.admin_search(text) from public, anon;
grant execute on function public.admin_tickets_list(text, integer), public.admin_ticket_create(uuid, text, text, text, uuid), public.admin_overview(), public.admin_search(text) to authenticated;
