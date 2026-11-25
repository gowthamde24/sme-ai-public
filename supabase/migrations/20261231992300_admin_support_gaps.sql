-- Launch support gaps (25 Nov 2026): what staff need next to the console that exists (search, business detail with balance and recent calls, goodwill credit, refund, pause/resume, failed payments, alerts, contact requests).
--   1. admin_find_by_email: find a business by its Owner's e-mail (the search matched name, id, GSTIN and phone numbers, not the e-mail).
--   2. admin_statement: a business's wallet statement for staff (the member version is for Owner and Admin only).
--   3. admin_wallet_debit: take credits back (the mirror of the goodwill credit: a reason in words, the amount typed twice, a fresh second factor, an idempotency key, owner and finance only, never below zero, at most Rs 3,000 a time).
--      It is a `usage` row of kind `adjustment`, so the statement shows it ("Taken back by Stack19") and the running balance still adds up.
--   4. admin_webhook_failures: the businesses whose outbound webhook endpoints keep failing (so support can say why a customer's system hears nothing).
--   5. computed alerts: wallet_low (a business with a live number and under four minutes of balance), webhook_failing (an endpoint failing for more than an hour), kyc_pending (a business waiting on verification more than three days).
-- Every read is written to the staff log. Rollback = drop the five functions, restore admin.computed_alerts from 989200, and narrow the usage check.

-- the staff log may say 'debit' (credits taken back)
alter table admin.audit drop constraint audit_action_check;
alter table admin.audit add constraint audit_action_check check (action in ('list', 'access', 'read', 'audit', 'unmask', 'note', 'status', 'credit', 'debit', 'refund', 'resend_invoice', 'pause', 'resume', 'view_as_start', 'view_as_end', 'owner_ok'));

-- the usage ledger may hold a manual adjustment, and the statement says so
alter table pricing.usage drop constraint usage_kind_check;
alter table pricing.usage add constraint usage_kind_check check (kind in ('call', 'search', 'adjustment'));
do $patch$
declare
  v_def text := pg_get_functiondef('public.pricing_statement(uuid,date,date,integer,timestamptz)'::regprocedure);
  v_old text := $q$case u.kind when 'call' then 'Call' else 'Lead Finder search' end$q$;
  v_new text := $q$case u.kind when 'call' then 'Call' when 'adjustment' then 'Taken back by Stack19' else 'Lead Finder search' end$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'pricing_statement has changed: the adjustment label no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- the statement without the member check, for the staff function below
do $patch$
declare
  v_def text := pg_get_functiondef('public.pricing_statement(uuid,date,date,integer,timestamptz)'::regprocedure);
  v_auth text := E'  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array[''owner'', ''admin'']::public.app_role[]) then\n    perform pricing.deny();\n  end if;\n';
begin
  if position(v_auth in v_def) = 0 then
    raise exception 'pricing_statement has changed: the staff copy no longer fits';
  end if;
  v_def := replace(v_def, v_auth, '');
  v_def := replace(v_def, 'CREATE OR REPLACE FUNCTION public.pricing_statement(', 'CREATE OR REPLACE FUNCTION pricing.statement_internal(');
  execute v_def;
  execute 'revoke all on function pricing.statement_internal(uuid, date, date, integer, timestamptz) from public, anon, authenticated, service_role';
end;
$patch$;

create function public.admin_statement(p_tenant_id uuid, p_from date default null, p_to date default null, p_limit integer default 100, p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'not found' using errcode = '23503';
  end if;
  perform admin.log(v_staff.user_id, 'read', p_tenant_id, null, null, null, 'business', p_tenant_id::text, false);
  return pricing.statement_internal(p_tenant_id, p_from, p_to, p_limit, p_before);
end $$;
revoke all on function public.admin_statement(uuid, date, date, integer, timestamptz) from public, anon;
grant execute on function public.admin_statement(uuid, date, date, integer, timestamptz) to authenticated;

create function public.admin_wallet_debit(p_tenant_id uuid, p_amount_paise bigint, p_confirm_paise bigint, p_reason_code text, p_reason_text text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := btrim(coalesce(p_reason_text, ''));
  v_ref   uuid;
  v_bal   bigint;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_tenant_id is null or p_amount_paise is null or p_amount_paise not between 100 and 300000 or p_confirm_paise is distinct from p_amount_paise
     or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other')
     or p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  perform admin.second_confirm();
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  v_ref := md5('debit:' || p_tenant_id::text || ':' || p_key)::uuid;
  if exists (select 1 from pricing.usage u where u.tenant_id = p_tenant_id and u.kind = 'adjustment' and u.ref = v_ref) then
    return jsonb_build_object('debited_paise', p_amount_paise, 'balance_paise', pricing.balance_of(p_tenant_id), 'replayed', true);
  end if;
  v_bal := pricing.balance_of(p_tenant_id);
  if v_bal < p_amount_paise then
    raise exception 'the balance is lower than that' using errcode = '22023';
  end if;
  perform pricing.spend(p_tenant_id, p_amount_paise);
  insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'adjustment', v_ref, 0, 0, p_amount_paise, 0);
  perform admin.log(v_staff.user_id, 'debit', p_tenant_id, null, p_reason_code, v_text, 'business', p_tenant_id::text, true);
  return jsonb_build_object('debited_paise', p_amount_paise, 'balance_paise', pricing.balance_of(p_tenant_id), 'replayed', false);
end $$;
revoke all on function public.admin_wallet_debit(uuid, bigint, bigint, text, text, text) from public, anon;
grant execute on function public.admin_wallet_debit(uuid, bigint, bigint, text, text, text) to authenticated;

create function public.admin_find_by_email(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_q text := lower(btrim(coalesce(p_email, '')));
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  if char_length(v_q) not between 3 and 120 or v_q !~ '^[^@\s]+(@[^@\s]*)?$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('businesses', coalesce((
    select jsonb_agg(admin.business_row(x.id) order by lower(x.name), x.id)
      from (select t.id, t.name from public.tenants t
             where t.archived_at is null and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                                                      where m.tenant_id = t.id and m.role = 'owner' and (lower(u.email) = v_q or (position('@' in v_q) = 0 and char_length(v_q) >= 4 and lower(u.email) like v_q || '%')))
             order by lower(t.name), t.id limit 5) x), '[]'::jsonb));
end $$;
revoke all on function public.admin_find_by_email(text) from public, anon;
grant execute on function public.admin_find_by_email(text) to authenticated;

create function public.admin_webhook_failures(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'business_name', x.name, 'endpoint_id', x.id, 'failing_since', x.failing_since, 'events', x.events,
                                        'dead_7d', x.dead, 'last_error', x.last_error, 'last_status_code', x.last_status_code) order by x.failing_since)
      from (select e.id, e.tenant_id, t.name, e.failing_since, e.events,
                   (select count(*) from public.webhook_deliveries d where d.endpoint_id = e.id and d.status = 'dead' and d.created_at > now() - interval '7 days') as dead,
                   (select d.last_error from public.webhook_deliveries d where d.endpoint_id = e.id and d.last_error is not null order by d.created_at desc limit 1) as last_error,
                   (select d.last_status_code from public.webhook_deliveries d where d.endpoint_id = e.id and d.last_status_code is not null order by d.created_at desc limit 1) as last_status_code
              from public.webhook_endpoints e join public.tenants t on t.id = e.tenant_id
             where e.active and e.failing_since is not null order by e.failing_since limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb));
end $$;
revoke all on function public.admin_webhook_failures(integer) from public, anon;
grant execute on function public.admin_webhook_failures(integer) to authenticated;

-- computed alerts: the two of 989200 plus three more
create or replace function admin.computed_alerts(p_role text) returns jsonb language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_agg(x.item order by x.n), '[]'::jsonb) from (
    select 1 as n, jsonb_build_object('id', md5('worker_stale')::uuid, 'kind', 'worker_stale', 'severity', 'warn', 'title', 'The background worker has stopped',
             'detail', 'The worker last reported ' || (extract(epoch from (app.outbox_now() - h.last_tick_at)) / 60)::int || ' minutes ago (it reports every ' || h.interval_seconds || ' seconds). Messages, follow-ups and reminders wait until it runs again.',
             'created_at', app.outbox_now(), 'acknowledged', false) as item
      from scheduler.heartbeat h
     where p_role in ('owner', 'support', 'finance')
       and h.id = 1 and h.last_tick_at < app.outbox_now() - greatest(interval '10 minutes', h.interval_seconds * 5 * interval '1 second')
    union all
    select 2, jsonb_build_object('id', md5('quiet_line')::uuid, 'kind', 'quiet_line', 'severity', 'warn', 'title', 'A live phone number got no calls today',
             'detail', 'A number that was getting calls (' || before.n || ' in the 14 days before) has had none in the last 24 hours. Place one test call from a phone, and if it does not connect check the number in the carrier''s portal.',
             'created_at', app.outbox_now(), 'acknowledged', false)
      from (select count(*) as n from public.phone_calls c where c.direction = 'inbound' and not c.simulated and c.created_at >= app.outbox_now() - interval '14 days' and c.created_at < app.outbox_now() - interval '24 hours') before
     where p_role in ('owner', 'finance')
       and before.n > 0
       and exists (select 1 from public.phone_numbers n where n.inbound_on and n.provider = 'voicelink')
       and not exists (select 1 from public.phone_calls c where c.direction = 'inbound' and not c.simulated and c.created_at >= app.outbox_now() - interval '24 hours')
    union all
    select 3, jsonb_build_object('id', md5('wallet_low')::uuid, 'kind', 'wallet_low', 'severity', 'warn', 'title', 'Businesses are running out of credits',
             'detail', w.n || ' business(es) with a live phone number have less than four minutes of balance left. Their assistant will stop calling when it runs out.',
             'created_at', app.outbox_now(), 'acknowledged', false)
      from (select count(*) as n from public.tenants t
             where t.archived_at is null and not t.billing_exempt
               and exists (select 1 from public.phone_numbers n where n.tenant_id = t.id and n.inbound_on)
               and pricing.balance_of(t.id) < 4 * (select p.rate_paise_per_minute from pricing.plans p where p.id = 'payg')) w
     where p_role in ('owner', 'support', 'finance') and w.n > 0
    union all
    select 4, jsonb_build_object('id', md5('webhook_failing')::uuid, 'kind', 'webhook_failing', 'severity', 'warn', 'title', 'A customer''s webhook keeps failing',
             'detail', f.n || ' outbound webhook endpoint(s) have been failing for more than an hour. See the list of failing webhooks.',
             'created_at', app.outbox_now(), 'acknowledged', false)
      from (select count(*) as n from public.webhook_endpoints e where e.active and e.failing_since is not null and e.failing_since < app.outbox_now() - interval '1 hour') f
     where p_role in ('owner', 'support') and f.n > 0
    union all
    select 5, jsonb_build_object('id', md5('kyc_pending')::uuid, 'kind', 'kyc_pending', 'severity', 'warn', 'title', 'Businesses are waiting for phone verification',
             'detail', k.n || ' business(es) have been waiting more than three days for their business verification to finish. A call or a message may help them.',
             'created_at', app.outbox_now(), 'acknowledged', false)
      from (select count(*) as n from telephony.business_clients b where b.state in ('created', 'in_progress', 'submitted', 'stuck') and b.created_at < app.outbox_now() - interval '3 days') k
     where p_role in ('owner', 'support') and k.n > 0
  ) x
$$;
revoke all on function admin.computed_alerts(text) from public, anon, authenticated;
