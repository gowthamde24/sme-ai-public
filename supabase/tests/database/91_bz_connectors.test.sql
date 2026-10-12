-- Job BZ (ADR 0080, migration 20261120090000): the database side of the connectors.
--   A catalog and privileges   B the IndiaMART window   C payment links (begin, attach, fail, the webhook, record)   D missed calls   E the call bridge   F isolation
-- THE CLOCK. Everything reads app.outbox_now() (the AT seam); this file replaces it for the transaction (rolled back at the end). Default: Monday 2026-10-05 14:00 IST; a later start can be set with
-- PGOPTIONS='-c tests.bz_pin=2026-10-05T23:30:00+05:30' (the calling-hours tests pin their own instants).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();
select tests.open_gate('a');
select tests.open_gate('b');

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
-- the worker: the unaffiliated fixture user "outsider", registered by the operator
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;

create function pg_temp.base() returns timestamptz language sql as $$ select coalesce(nullif(current_setting('tests.bz_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz $$;
select pg_temp.pin(pg_temp.base());
select app.operator_register_scheduler('Outsider@test.local');
update public.platform_flags set enabled = true where key = 'outbox_enabled';

-- a contact with a lead, a number and (optionally) the keys and the WhatsApp consent the outbox needs
create function pg_temp.mk(p_label text, p_phone text, p_consent boolean default true) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid(p_label || '_c'), tests.tid('a'), tests.rid('a_company'), 'Contact ' || p_label, p_phone);
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label || '_c'));
  perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))));
  if p_consent then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:bz')$q$, tests.tid('a'), tests.rid(p_label || '_c')));
  end if;
end $$;

-- ================================================================================ A. catalog and privileges
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'integrations' and c.relname in ('pull_state', 'payment_links', 'webhook_events', 'missed_calls', 'call_bridges') and c.relrowsecurity and c.relforcerowsecurity), 5::bigint,
          'row-level security is on and forced for the five connector tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'integrations' and table_name in ('pull_state', 'payment_links', 'webhook_events', 'missed_calls', 'call_bridges')
            and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'no client role holds any right on them');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('indiamart_pull_begin', 'indiamart_pull_finish', 'payment_link_begin', 'payment_link_attach', 'payment_link_fail', 'payment_link_list', 'payment_link_get',
              'payment_link_mark_recorded', 'scheduler_payment_event', 'scheduler_missed_call', 'missed_call_list', 'missed_call_handle', 'call_bridge_prepare', 'call_bridge_finish', 'scheduler_call_status', 'connectors_status')
              and p.prosecdef and 'search_path=""' = any (p.proconfig)), 16::bigint, 'the sixteen public functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like '%payment\_link%' or p.proname like '%missed\_call%' or p.proname like 'call\_bridge%' or p.proname like 'indiamart%' or p.proname in ('scheduler_call_status', 'connectors_status'))
              and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon can execute none of them');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('connector_error', 'payment_link_json', 'order_balance_paise') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint,
          'the helpers are not callable by a client');
select is(has_schema_privilege('authenticated', 'integrations', 'usage') or has_schema_privilege('service_role', 'integrations', 'usage'), false, 'no client role reaches schema integrations');

-- ================================================================================ B. the IndiaMART window
select is(pg_temp.sc('a_sales', format('select public.indiamart_pull_begin(%L)', tests.tid('a'))), 'ERR:42501', 'Sales may not pull');
select is(pg_temp.sc('a_viewer', format('select public.indiamart_pull_begin(%L)', tests.tid('a'))), 'ERR:42501', 'a Viewer may not');
select is(pg_temp.sc('b_owner', format('select public.indiamart_pull_begin(%L)', tests.tid('a'))), 'ERR:42501', 'another business''s Owner may not');
select is(pg_temp.sc('a_owner', format('select (public.indiamart_pull_begin(%L) ->> ''start'')::timestamptz = %L::timestamptz', tests.tid('a'), app.outbox_now() - interval '24 hours')), 'true', 'THE FIRST TIME: the last 24 hours');
select is(pg_temp.sc('a_owner', format('select public.indiamart_pull_begin(%L)', tests.tid('a'))), 'ERR:SM611', 'a second call within five minutes is refused (SM611)');
select is(pg_temp.sc('a_admin', format('select public.indiamart_pull_begin(%L)', tests.tid('a'))), 'ERR:SM611', '...whoever asks');
select pg_temp.pin(pg_temp.base() + interval '6 minutes');
select is(pg_temp.sc('a_owner', format('select (public.indiamart_pull_begin(%L) ->> ''start'')::timestamptz = %L::timestamptz', tests.tid('a'), app.outbox_now() - interval '24 hours')), 'true', 'six minutes later it may ask again; with no good pull yet the window is still the last 24 hours');
select is(pg_temp.sc('a_owner', format('select public.indiamart_pull_finish(%L, %L, 3)', tests.tid('a'), pg_temp.base() + interval '6 minutes')) like '%"last_count": 3%', true, 'a good pull is recorded');
select is(pg_temp.sc('a_owner', format('select public.indiamart_pull_finish(%L, %L, 3)', tests.tid('a'), pg_temp.base() + interval '1 day')), 'ERR:22023', 'the end of a pull cannot be in the future');
select is(pg_temp.sc('a_owner', format('select public.indiamart_pull_finish(%L, %L, -1)', tests.tid('a'), pg_temp.base() + interval '6 minutes')), 'ERR:22023', 'a negative count is invalid');
select pg_temp.pin(pg_temp.base() + interval '20 minutes');
select is(pg_temp.sc('a_owner', format('select (public.indiamart_pull_begin(%L) ->> ''start'')::timestamptz = (%L::timestamptz - interval ''5 minutes'')', tests.tid('a'), pg_temp.base() + interval '6 minutes')), 'true', 'THE NEXT WINDOW starts five minutes before the last good pull (the provider''s own advice: overlap, then drop what was seen)');
select pg_temp.pin(pg_temp.base() + interval '15 days');
select is(pg_temp.sc('a_owner', format('select (public.indiamart_pull_begin(%L) ->> ''start'')::timestamptz = %L::timestamptz', tests.tid('a'), app.outbox_now() - interval '7 days')), 'true', 'after a long silence the window is never more than 7 days (the provider''s limit)');
select pg_temp.pin(pg_temp.base());

-- ================================================================================ C. payment links
-- an order that lacks Rs 5,000
alter table public.orders disable trigger user;
update public.orders set order_total_paise = 500000, advance_paise = 100000 where id = tests.rid('a_order');
alter table public.orders enable trigger user;
create function pg_temp.begin(p_link text, p_amount bigint, p_user text default 'a_owner', p_provider text default 'fake', p_hours int default 72) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.payment_link_begin(%L, %L, %L, %L, %s, %L)', tests.tid('a'), tests.rid(p_link), tests.rid('a_order'), p_provider, p_amount, app.outbox_now() + make_interval(hours => p_hours))) $$;
create function pg_temp.lst(p_link text) returns text language sql as $$ select status from integrations.payment_links where id = tests.rid(p_link) $$;
select is(pg_temp.begin('l1', 200000, 'a_sales'), 'ERR:42501', 'Sales may not make a payment link');
select is(pg_temp.begin('l1', 200000, 'b_owner'), 'ERR:42501', 'another business''s Owner may not');
select is(pg_temp.begin('l1', 99), 'ERR:22023', 'under Rs 1 is invalid');
select is(pg_temp.begin('l1', 500001), 'ERR:22023', 'more than the order still lacks is invalid');
select is(pg_temp.begin('l1', 200000, 'a_owner', 'paypal'), 'ERR:22023', 'a provider that is not supported is invalid');
select is(pg_temp.begin('l1', 200000, 'a_owner', 'fake', 0), 'ERR:22023', 'a link that expires in under 15 minutes is invalid');
select is(pg_temp.sc('a_owner', format('select public.payment_link_begin(%L, %L, %L, ''fake'', 200000, %L)', tests.tid('a'), tests.rid('l1'), tests.rid('no_order'), app.outbox_now() + interval '1 day')), 'ERR:23503', 'an unknown order is not found');
select is(pg_temp.j(pg_temp.begin('l1', 200000), 'replayed'), 'false', 'THE FIRST LINK is made');
select is(pg_temp.lst('l1'), 'pending', '...pending: the provider has not been asked yet');
select is((select reference from integrations.payment_links where id = tests.rid('l1')), 'pl_' || replace(tests.rid('l1')::text, '-', ''), '...with our reference (pl_ and 32 digits)');
select is(pg_temp.j(pg_temp.begin('l1', 200000), 'replayed'), 'true', 'asking again with the same link id replays');
select is(pg_temp.begin('l1', 300000), 'ERR:22023', '...but not with another amount');
select is(pg_temp.begin('l2', 100000), 'ERR:SM613', 'a second OPEN link for the order is refused (SM613)');
select is(pg_temp.sc('a_owner', format('select public.payment_link_attach(%L, %L, ''plink_Abc123'', ''http://pay.example.test/x'')', tests.tid('a'), tests.rid('l1'))), 'ERR:22023', 'the address must be https');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.payment_link_attach(%L, %L, ''plink_Abc123'', ''https://pay.example.test/x'')', tests.tid('a'), tests.rid('l1'))), 'status'), 'created', 'the provider''s answer is kept: created');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.payment_link_attach(%L, %L, ''plink_Abc123'', ''https://pay.example.test/x'')', tests.tid('a'), tests.rid('l1'))), 'status'), 'created', '...and a replay of the same answer is fine');
select is(pg_temp.sc('a_owner', format('select public.payment_link_attach(%L, %L, ''plink_Other'', ''https://pay.example.test/y'')', tests.tid('a'), tests.rid('l1'))), 'ERR:SM612', '...a different answer for a link already created is refused (SM612)');
select is(pg_temp.sc('a_owner', format('select public.payment_link_fail(%L, %L)', tests.tid('a'), tests.rid('l1'))), 'ERR:SM612', 'a link that exists at the provider cannot be marked failed');
select is(jsonb_array_length(pg_temp.sc('a_sales', format('select public.payment_link_list(%L, %L)', tests.tid('a'), tests.rid('a_order')))::jsonb), 1, 'Sales may read the links of an order');
select is(pg_temp.sc('a_viewer', format('select public.payment_link_list(%L, %L)', tests.tid('a'), tests.rid('a_order'))), 'ERR:42501', 'a Viewer may not');
select is(pg_temp.sc('b_owner', format('select public.payment_link_list(%L, %L)', tests.tid('a'), tests.rid('a_order'))), 'ERR:42501', 'another business may not');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.payment_link_get(%L, %L)', tests.tid('a'), tests.rid('l1'))), 'url'), 'https://pay.example.test/x', 'one link, with its address');
select is(pg_temp.sc('a_sales', format('select public.payment_link_get(%L, %L)', tests.tid('b'), tests.rid('l1'))), 'ERR:42501', 'a link of A asked for under business B is refused');
select is(pg_temp.sc('a_owner', format('select public.payment_link_mark_recorded(%L, %L, %L)', tests.tid('a'), tests.rid('l1'), tests.rid('ev1'))), 'ERR:SM612', 'a link that is not PAID cannot be recorded');

-- the webhook: the worker only
create function pg_temp.ev(p_event text, p_status text, p_amount bigint, p_link text default 'plink_Abc123', p_ref text default null) returns text language sql as $$
  select pg_temp.w(format('select public.scheduler_payment_event(%L, %L, %L, %L, %L, %s, %L)', 'fake', p_event, p_link, coalesce(p_ref, 'pl_' || replace(tests.rid('l1')::text, '-', '')), p_status, coalesce(p_amount::text, 'null'), 'pay_Xyz789')) $$;
select is(pg_temp.sc('a_owner', format('select public.scheduler_payment_event(%L, %L, %L, null, %L, 200000, null)', 'fake', 'evt-00000001', 'plink_Abc123', 'paid')), 'ERR:42501', 'an Owner is not the worker: the webhook function is refused');
select is(pg_temp.ev('evt-00000001', 'paid', 200000, 'plink_Abc123', 'pl_00000000000000000000000000000000'), '{"outcome": "unknown"}', 'a message whose reference is not ours is ignored (unknown)');
select is(pg_temp.ev('evt-00000002', 'paid', 200000, 'plink_Nobody'), '{"outcome": "unknown"}', 'a link the database does not know is ignored');
select is(pg_temp.j(pg_temp.ev('evt-00000003', 'partially_paid', 100000), 'outcome'), 'ignored', 'a partial payment is ignored (UPI links take none)');
select is(pg_temp.j(pg_temp.ev('evt-00000003', 'partially_paid', 100000), 'outcome'), 'duplicate', '...and a repeat of that message is a duplicate');
select is(pg_temp.lst('l1'), 'created', '...and the link is still open');
select is(pg_temp.ev('x', 'paid', 200000), 'ERR:22023', 'a short event id is invalid');
select is(pg_temp.ev('evt-00000005', 'paid', null), 'ERR:22023', 'paid without an amount is invalid');
select is(pg_temp.ev('evt-00000005', 'refunded', 200000), 'ERR:22023', 'an unknown status is invalid');
select is(pg_temp.j(pg_temp.ev('evt-00000006', 'paid', 200000), 'outcome'), 'paid', 'PAID for exactly the link''s amount marks it paid');
select is(pg_temp.j(pg_temp.ev('evt-00000006', 'paid', 200000), 'outcome'), 'duplicate', '...and the same message again changes nothing (duplicate)');
select is((select paid_amount_paise || '/' || provider_payment_ref from integrations.payment_links where id = tests.rid('l1')), '200000/pay_Xyz789', '...the amount and the provider''s payment reference are kept (nothing else about the payment)');
select is(pg_temp.j(pg_temp.ev('evt-00000007', 'paid', 200000), 'outcome'), 'ignored', 'a second "paid" message (a new event) for a paid link is ignored');
select is(pg_temp.j(pg_temp.ev('evt-00000008', 'expired', null), 'outcome'), 'ignored', 'expired cannot undo paid');
select is(pg_temp.sc('a_owner', format('select count(*) from public.order_events where order_id = %L and type = ''record_payment''', tests.rid('a_order'))), '0', 'THE WEBHOOK RECORDED NO MONEY on the order');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'payment_link.paid'), 1::bigint, 'the paid link is in the audit trail');
select is(pg_temp.sc('a_viewer', format('select public.payment_link_mark_recorded(%L, %L, %L)', tests.tid('a'), tests.rid('l1'), tests.rid('ev1'))), 'ERR:42501', 'a Viewer cannot record');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.payment_link_mark_recorded(%L, %L, %L)', tests.tid('a'), tests.rid('l1'), tests.rid('ev1'))), 'status'), 'recorded', 'a person marks the link recorded (the API does it after the order lifecycle took the payment)');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.payment_link_mark_recorded(%L, %L, %L)', tests.tid('a'), tests.rid('l1'), tests.rid('ev1'))), 'status'), 'recorded', '...the same event again is a replay');
select is(pg_temp.sc('a_sales', format('select public.payment_link_mark_recorded(%L, %L, %L)', tests.tid('a'), tests.rid('l1'), tests.rid('ev2'))), 'ERR:SM612', '...another event is refused (SM612)');
-- a second link: mismatch, expiry, failure
select is(pg_temp.j(pg_temp.begin('l2', 100000), 'replayed'), 'false', 'after the first link is done the order may get another');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.payment_link_attach(%L, %L, ''plink_Two'', ''https://pay.example.test/2'')', tests.tid('a'), tests.rid('l2'))), 'status'), 'created', 'attach l2');
select is(pg_temp.j(pg_temp.w(format('select public.scheduler_payment_event(''fake'', ''evt-00000009'', ''plink_Two'', %L, ''paid'', 99999, ''pay_Short'')', 'pl_' || replace(tests.rid('l2')::text, '-', ''))), 'outcome'), 'mismatch', 'PAID for another amount: mismatch (a person decides)');
select is(pg_temp.sc('a_sales', format('select public.payment_link_mark_recorded(%L, %L, %L)', tests.tid('a'), tests.rid('l2'), tests.rid('ev3'))), 'ERR:SM612', 'a mismatch cannot be recorded as if it were right');
select is(pg_temp.j(pg_temp.begin('l3', 100000), 'replayed'), 'false', 'a mismatch does not block a new link');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.payment_link_attach(%L, %L, ''plink_Three'', ''https://pay.example.test/3'')', tests.tid('a'), tests.rid('l3'))), 'status'), 'created', 'attach l3');
select is(pg_temp.j(pg_temp.w(format('select public.scheduler_payment_event(''fake'', ''evt-00000010'', ''plink_Three'', %L, ''expired'', null, null)', 'pl_' || replace(tests.rid('l3')::text, '-', ''))), 'outcome'), 'expired', 'an open link can expire');
select is(pg_temp.j(pg_temp.begin('l4', 100000), 'replayed'), 'false', 'then another is possible');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.payment_link_fail(%L, %L)', tests.tid('a'), tests.rid('l4'))), 'status'), 'failed', 'a link the provider refused is marked failed');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.payment_link_fail(%L, %L)', tests.tid('a'), tests.rid('l4'))), 'status'), 'failed', '...twice is fine');
select pg_temp.pin(pg_temp.base());
-- a closed order takes no link
alter table public.orders disable trigger user;
update public.orders set state = 'declined', closed_at = now() where id = tests.rid('b_order');
alter table public.orders enable trigger user;
select is(pg_temp.sc('b_owner', format('select public.payment_link_begin(%L, %L, %L, ''fake'', 100, %L)', tests.tid('b'), tests.rid('lb'), tests.rid('b_order'), app.outbox_now() + interval '1 day')), 'ERR:SM612', 'a closed order takes no link (SM612)');
select is(pg_temp.sc('a_owner', format('select public.payment_link_begin(%L, %L, %L, ''fake'', 100000, %L)', tests.tid('a'), tests.rid('lx'), tests.rid('b_order'), app.outbox_now() + interval '1 day')), 'ERR:23503', 'another business''s order is not found');

-- ================================================================================ D. missed calls
insert into public.outbox_settings (tenant_id, auto_send_enabled) values (tests.tid('a'), false) on conflict (tenant_id) do update set auto_send_enabled = false;
select pg_temp.mk('mc1', '+91 98765 43210');
select pg_temp.mk('mc2', '+91 98765 43211', false);
select pg_temp.mk('mc3', '+91 98765 43212');
select pg_temp.mk('mc4', '098765 43213');
create function pg_temp.mcall(p_call text, p_phone text, p_msg text default null, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.w(format('select public.scheduler_missed_call(%L, ''fake'', %L, %L, %L, %L, ''Thank you for calling. We will get back to you shortly.'', ''en'')', tests.tid(p_tenant), p_call, p_phone, app.outbox_now(), coalesce(p_msg, gen_random_uuid()::text))) $$;
select is(pg_temp.sc('a_owner', format('select public.scheduler_missed_call(%L, ''fake'', ''call-0001'', ''09876543210'', now(), null, null, null)', tests.tid('a'))), 'ERR:42501', 'an Owner is not the worker');
select is(pg_temp.mcall('call-0001', '12345'), 'ERR:22023', 'a number that is too short is invalid');
select is(pg_temp.mcall('x', '09876543210'), 'ERR:22023', 'a call id that is too short is invalid');
select is(pg_temp.mcall('call-0001', '09876543210', null, 'b') like '%"outcome": "needs_owner"%', true, 'a stranger''s call (to business B, where nobody has this number) waits for a person');
select is(pg_temp.j(pg_temp.mcall('call-0002', '09876543210'), 'outcome'), 'needs_owner', 'AUTOMATIC SENDING OFF: a known contact''s call waits for a person');
select is((select count(*) from public.outbox_messages where tenant_id = tests.tid('a')), 0::bigint, '...and no message was made');
select is((select (contact_id is not null)::text || '/' || coalesce(caller_phone, 'none') from integrations.missed_calls where provider_call_id = 'call-0002'), 'true/none', '...the contact is found by the last ten digits, and the number is not stored (it lives in the contact)');
select is(pg_temp.j(pg_temp.mcall('call-0002', '09876543210'), 'outcome'), 'duplicate', 'the same call id again is a duplicate');
select is((select count(*) from integrations.missed_calls where provider_call_id = 'call-0002'), 1::bigint, '...one row');
select is(pg_temp.j(pg_temp.mcall('call-0003', '+1 202 555 0101'), 'matched'), 'false', 'an unknown caller is stored with the number (for 14 days)');
select is((select caller_phone from integrations.missed_calls where provider_call_id = 'call-0003'), '12025550101', '...as digits');
-- automatic sending on
insert into public.outbox_settings (tenant_id, auto_send_enabled) values (tests.tid('a'), true) on conflict (tenant_id) do update set auto_send_enabled = true;
select is(pg_temp.j(pg_temp.mcall('call-0004', '+91 98765 43210', tests.rid('mmsg1')::text), 'outcome'), 'replied', 'AUTOMATIC SENDING ON and WhatsApp consent granted: a short fixed reply is queued');
select is((select m.source || '/' || m.category || '/' || m.channel from public.outbox_messages m where m.id = tests.rid('mmsg1')), 'system/reply_to_inbound/whatsapp', '...through the outbox, as the system, to the contact''s lead');
select is((select m.status from public.outbox_messages m where m.id = tests.rid('mmsg1')) in ('queued', 'needs_approval'), true, '...under the same policy as any message (it is queued or held, never skipped)');
select is(pg_temp.j(pg_temp.mcall('call-0005', '+91 98765 43211', tests.rid('mmsg2')::text), 'outcome'), 'needs_owner', 'a contact WITHOUT consent gets no reply: the call waits for a person');
select is((select count(*) from public.outbox_messages where id = tests.rid('mmsg2')), 0::bigint, '...and no message exists');
update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out' where id = tests.rid('mc3_c');
select is(pg_temp.j(pg_temp.mcall('call-0006', '+91 98765 43212', tests.rid('mmsg3')::text), 'outcome'), 'needs_owner', 'a STOPPED contact gets no reply');
update public.contacts set phone = '+91 98765 43299' where id = tests.rid('mc4_c');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('dup_c'), tests.tid('a'), tests.rid('a_company'), 'Twin', '+91 98765 43299');
select is(pg_temp.j(pg_temp.mcall('call-0007', '+91 98765 43299', tests.rid('mmsg4')::text), 'matched'), 'false', 'two contacts with one number are ambiguous: nobody is guessed');
select is(pg_temp.j(pg_temp.mcall('call-0008', '09876543210', tests.rid('mmsg1')::text), 'outcome') in ('replied', 'needs_owner'), true, 'a reused message id does not break the call (it replays the message)');
-- who may read
select is(jsonb_array_length(pg_temp.sc('a_sales', format('select public.missed_call_list(%L)', tests.tid('a')))::jsonb) > 0, true, 'Sales reads the missed calls that wait');
select is(pg_temp.sc('a_viewer', format('select public.missed_call_list(%L)', tests.tid('a'))), 'ERR:42501', 'a Viewer may not');
select is(pg_temp.sc('b_owner', format('select public.missed_call_list(%L)', tests.tid('a'))), 'ERR:42501', 'another business may not');
select is((select e ->> 'phone' from jsonb_array_elements(pg_temp.sc('a_owner', format('select public.missed_call_list(%L)', tests.tid('a')))::jsonb) e where e ->> 'caller_last4' = '0101'), '12025550101', 'a stranger is listed with the number so a person can call back');
select is((select e ->> 'phone' from jsonb_array_elements(pg_temp.sc('a_owner', format('select public.missed_call_list(%L)', tests.tid('a')))::jsonb) e where e ->> 'caller_last4' = '3210' limit 1), null, 'a contact is listed WITHOUT a number (name and last four digits only)');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.missed_call_handle(%L, %L)', tests.tid('a'), (select id from integrations.missed_calls where provider_call_id = 'call-0003'))), 'handled'), 'true', 'a person marks a call dealt with');
select is((select caller_phone from integrations.missed_calls where provider_call_id = 'call-0003'), null, '...and the stranger''s number is dropped');
select is(pg_temp.sc('b_owner', format('select public.missed_call_handle(%L, %L)', tests.tid('b'), (select id from integrations.missed_calls where provider_call_id = 'call-0002'))), 'ERR:23503', 'a call of A cannot be handled under B');
-- retention and erasure
update integrations.missed_calls set created_at = app.outbox_now() - interval '15 days' where provider_call_id = 'call-0007';
select pg_temp.mcall('call-0009', '+1 202 555 0188');
select is((select count(*) from integrations.missed_calls where provider_call_id = 'call-0007'), 0::bigint, 'RETENTION: a call older than 14 days is purged by the next call');
alter table public.contacts disable trigger user;
update public.contacts set erased_at = now(), phone = null, full_name = 'erased' where id = tests.rid('mc1_c');
alter table public.contacts enable trigger user;
select pg_temp.mcall('call-0010', '+1 202 555 0199');
select is((select count(*) from integrations.missed_calls where contact_id = tests.rid('mc1_c')), 0::bigint, 'ERASURE: the calls of an erased contact are purged');

-- ================================================================================ E. the call bridge
insert into public.call_requests (id, tenant_id, lead_id, contact_id, company_id, reason, script_draft, language, status, request_sha256, requested_by)
values (tests.rid('cr1'), tests.tid('a'), tests.rid('mc3'), tests.rid('mc3_c'), tests.rid('a_company'), 'Ask about the order', 'Hello, this is the shop.', 'en', 'requested', repeat('1', 64), tests.uid('a_sales')),
       (tests.rid('cr2'), tests.tid('a'), tests.rid('mc2'), tests.rid('mc2_c'), tests.rid('a_company'), 'Ask about the order', 'Hello, this is the shop.', 'en', 'requested', repeat('2', 64), tests.uid('a_sales')),
       (tests.rid('cr3'), tests.tid('a'), tests.rid('mc4'), tests.rid('mc4_c'), tests.rid('a_company'), 'Ask about the order', 'Hello, this is the shop.', 'en', 'requested', repeat('3', 64), tests.uid('a_sales'));
update public.call_requests set status = 'approved', decided_by = tests.uid('a_owner'), decided_at = now() where id in (tests.rid('cr1'), tests.rid('cr2'));
update public.call_requests set status = 'rejected', decided_by = tests.uid('a_owner'), decided_at = now() where id = tests.rid('cr3');
create function pg_temp.prep(p_req text, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.call_bridge_prepare(%L, %L, ''fake'')', tests.tid('a'), tests.rid(p_req))) $$;
select is(pg_temp.prep('cr2', 'a_sales'), 'ERR:42501', 'Sales may not place a call');
select is(pg_temp.prep('cr2', 'b_owner'), 'ERR:42501', 'another business''s Owner may not');
select is(pg_temp.sc('a_owner', format('select public.call_bridge_prepare(%L, %L, ''skype'')', tests.tid('a'), tests.rid('cr2'))), 'ERR:22023', 'a provider that is not supported is invalid');
select is(pg_temp.prep('nope'), 'ERR:23503', 'an unknown request is not found');
select is(pg_temp.prep('cr1'), 'ERR:SM612', 'a STOPPED contact (suppressed above) cannot be called (SM612)');
select is(pg_temp.prep('cr3'), 'ERR:SM612', 'a request that was not approved cannot be placed (SM612)');
select pg_temp.pin('2026-10-05T21:00:00+05:30');
select is(pg_temp.prep('cr2'), 'ERR:SM614', 'AT 21:00 India time: outside the calling hours (SM614)');
select pg_temp.pin('2026-10-05T08:59:00+05:30');
select is(pg_temp.prep('cr2'), 'ERR:SM614', 'AT 08:59: outside the calling hours');
select pg_temp.pin('2026-10-05T09:00:00+05:30');
select is(pg_temp.j(pg_temp.prep('cr2'), 'replayed'), 'false', 'AT 09:00: allowed');
select is(pg_temp.j(pg_temp.prep('cr2'), 'to_number'), null, 'a repeat is a replay and gives no number again (one call per request)');
select is((select status from integrations.call_bridges where call_request_id = tests.rid('cr2')), 'starting', 'the bridge row exists, starting');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.call_bridge_finish(%L, %L, ''CA12345678'', ''queued'')', tests.tid('a'), (select id from integrations.call_bridges where call_request_id = tests.rid('cr2')))), 'status'), 'queued', 'the provider accepted the call');
select is(pg_temp.sc('a_owner', format('select public.call_bridge_finish(%L, %L, ''CA12345678'', ''ringing'')', tests.tid('a'), (select id from integrations.call_bridges where call_request_id = tests.rid('cr2')))), 'ERR:22023', 'an unknown status is invalid');
select is(pg_temp.sc('outsider', 'select 1') is not null, true, 'worker session works');
select is(pg_temp.j(pg_temp.w('select public.scheduler_call_status(''fake'', ''CA12345678'', ''in-progress'')'), 'outcome'), 'updated', 'the provider''s callback moves the status');
select is(pg_temp.j(pg_temp.w('select public.scheduler_call_status(''fake'', ''CA12345678'', ''completed'')'), 'outcome'), 'updated', '...to a final one');
select is(pg_temp.j(pg_temp.w('select public.scheduler_call_status(''fake'', ''CA12345678'', ''queued'')'), 'outcome'), 'final', 'a final status is never changed again');
select is(pg_temp.j(pg_temp.w('select public.scheduler_call_status(''fake'', ''CA00000000'', ''completed'')'), 'outcome'), 'unknown', 'a call the database does not know is ignored');
select is(pg_temp.sc('a_owner', 'select public.scheduler_call_status(''fake'', ''CA12345678'', ''completed'')'), 'ERR:42501', 'an Owner is not the worker');
select is(pg_temp.w('select public.scheduler_call_status(''fake'', ''CA12345678'', ''ringing'')'), 'ERR:22023', 'an unknown status is invalid');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'call_bridge.started'), 1::bigint, 'the call is in the audit trail');

-- ================================================================================ F. the status line and isolation
select is(pg_temp.sc('a_sales', format('select public.connectors_status(%L)', tests.tid('a'))), 'ERR:42501', 'Sales may not read the status');
select is((pg_temp.sc('a_owner', format('select public.connectors_status(%L)', tests.tid('a')))::jsonb ->> 'paid_to_record'), '1', 'the status counts the mismatch that waits for a person');
select is((pg_temp.sc('b_owner', format('select public.connectors_status(%L)', tests.tid('b')))::jsonb ->> 'open_links'), '0', 'business B sees only its own');
select is((select count(*) from integrations.payment_links where tenant_id = tests.tid('b')), 0::bigint, 'nothing leaked into B');

select * from finish();
rollback;
