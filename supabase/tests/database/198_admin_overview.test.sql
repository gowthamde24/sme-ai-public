-- Admin console: the Overview in one call (KPIs, support queue, health, businesses, our costs and margin), the ticket list/create, and the search. Roles see only their parts.
begin;
select no_plan();
select tests.seed_two_tenants();

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select tests.uid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@staff.test', now(), jsonb_build_object('display_name', n), now(), now()
  from unnest(array['s_owner', 's_support', 's_finance']) n;
select app.operator_register_staff('s_owner@staff.test', 'Gowtham R', 'owner');
select app.operator_register_staff('s_support@staff.test', 'Anu Support', 'support');
select app.operator_register_staff('s_finance@staff.test', 'Fay Finance', 'finance');

create function pg_temp.st(p_user text, p_aal text, p_sid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_user), 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid(p_user)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return 'ERR:' || sqlstate;
end $$;
create function pg_temp.ov(p_user text) returns jsonb language sql as $$ select pg_temp.st(p_user, 'aal2', 'sess-' || p_user || '-0001', 'select public.admin_overview()::text')::jsonb $$;

-- the world: business A pays Sales Assistant monthly (Rs 1,999), has one top-up invoice of Rs 1,000, 3 calls today (2 answered, 1 failed), usage costs; business B is on the free start only
insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, period_start, period_end) values (tests.tid('a'), 'sales_assistant', 'monthly', 'active', 'fake', now() - interval '3 days', now() + interval '27 days');
insert into pricing.free_starts (tenant_id) values (tests.tid('b'));
select pricing.invoice(tests.tid('a'), 'topup', 'pay_overview_1', 100000);
insert into workspace.profiles (tenant_id, town) values (tests.tid('a'), 'Dharmavaram') on conflict (tenant_id) do update set town = excluded.town;
insert into public.phone_calls (tenant_id, direction, provider, state, answered_at, ended_at, created_at) values
  (tests.tid('a'), 'inbound', 'plivo', 'completed', now(), now(), now() - interval '10 minutes'),
  (tests.tid('a'), 'outbound', 'plivo', 'completed', now(), now(), now() - interval '20 minutes'),
  (tests.tid('a'), 'outbound', 'plivo', 'failed', null, now(), now() - interval '30 minutes');
insert into ops.provider_usage (tenant_id, provider, unit, units, cost_paise, rate_id, ref_kind, ref_id, occurred_at)
select tests.tid('a'), p, u, 10, c, (select r.id from ops.provider_rates r where r.provider = p and r.unit = u order by r.valid_from desc limit 1), 'call', 'ovr-' || p, now()
  from (values ('cartesia', 'character', 12000), ('plivo', 'second', 5000), ('meta', 'message_service', 3000)) v(p, u, c);

-- A. who may call it, and the shape
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', 'select public.admin_overview()::text'), 'ERR:SM941', 'A1: a shop owner is not staff');
select is(pg_temp.st('s_owner', 'aal1', 'sess-s_owner-0001', 'select public.admin_overview()::text'), 'ERR:SM942', 'A2: the second factor is always needed');
select is(pg_temp.ov('s_owner') ?& array['generated_at', 'role', 'badges', 'kpis', 'support_queue', 'health', 'businesses', 'costs_this_month'], true, 'A4: everything the Overview screen draws is in the one answer');

-- B. KPIs
select is(pg_temp.ov('s_owner') #>> '{kpis,mrr,paise}', '199900', 'B1: MRR = the monthly price of the active plan (Rs 1,999)');
select is(pg_temp.ov('s_owner') #>> '{kpis,mrr,change_percent}', null, 'B2: no change % until there is history to compare (no guessing)');
select is(pg_temp.ov('s_owner') #>> '{kpis,active_businesses,count}', '1', 'B3: active businesses = those with a paying plan');
select is(pg_temp.ov('s_owner') #>> '{kpis,active_businesses,on_free_start}', '1', 'B4: and the ones still on the free start only');
select cmp_ok((pg_temp.ov('s_owner') #>> '{kpis,active_businesses,added_this_week}')::int, '>=', 2, 'B5: new this week');
select is(pg_temp.ov('s_owner') #>> '{kpis,calls_today,count}', '3', 'B6: calls today');
select is(pg_temp.ov('s_owner') #>> '{kpis,calls_today,connected_percent}', '66.7', 'B7: and how many connected (2 of 3)');
select is(pg_temp.ov('s_owner') #>> '{kpis,gross_margin,revenue_paise}', '100000', 'B8: revenue this month = invoiced amounts without GST');
select is(pg_temp.ov('s_owner') #>> '{kpis,gross_margin,cost_paise}', '20000', 'B9: costs = what the providers cost us (Rs 200)');
select is(pg_temp.ov('s_owner') #>> '{kpis,gross_margin,percent}', '80.0', 'B10: margin 80 %');
select isnt(pg_temp.ov('s_owner') #>> '{kpis,gross_margin,costs_recorded_since}', null, 'B11: it says since when costs have been recorded');

-- C. money parts: owner and finance only
select is(pg_temp.ov('s_finance') #>> '{kpis,mrr,paise}', '199900', 'C1: finance sees MRR');
select is(jsonb_typeof(pg_temp.ov('s_support') #> '{kpis,mrr}'), 'null', 'C2: support gets null for MRR (the key is there, the value is not)');
select is(jsonb_typeof(pg_temp.ov('s_support') #> '{kpis,gross_margin}'), 'null', 'C3: nor the margin');
select is(jsonb_typeof(pg_temp.ov('s_support') -> 'costs_this_month'), 'null', 'C4: nor our costs per provider');
select is(pg_temp.ov('s_support') #>> '{kpis,calls_today,count}', '3', 'C5: but support sees the calls');

-- D. our costs per provider: all six, with the roles the screen labels
select is(jsonb_array_length(pg_temp.ov('s_owner') #> '{costs_this_month,providers}'), 6, 'D1: six providers');
select is((select jsonb_agg(p ->> 'provider' order by p ->> 'provider') from jsonb_array_elements(pg_temp.ov('s_owner') #> '{costs_this_month,providers}') p), '["anthropic", "cartesia", "google", "meta", "plivo", "sarvam"]'::jsonb, 'D2: Cartesia, Sarvam, Plivo, Claude, Meta and Google');
select is((select (p ->> 'cost_paise') from jsonb_array_elements(pg_temp.ov('s_owner') #> '{costs_this_month,providers}') p where p ->> 'provider' = 'cartesia'), '12000', 'D3: the cost of each');
select is((select (p ->> 'cost_paise') from jsonb_array_elements(pg_temp.ov('s_owner') #> '{costs_this_month,providers}') p where p ->> 'provider' = 'sarvam'), '0', 'D4: a provider with no usage shows 0, not a gap');
select is(pg_temp.ov('s_owner') #>> '{costs_this_month,margin_paise}', '80000', 'D5: revenue minus costs');

-- E. the support queue
select is(pg_temp.st('s_finance', 'aal2', 'sess-s_finance-0001', format($q$select public.admin_ticket_create(%L, 'x', 'phone')::text$q$, tests.tid('a'))), 'ERR:42501', 'E1: finance does not log tickets');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', format($q$select public.admin_ticket_create(%L, 'Calls not reaching assistant since 10:15', 'phone', 'urgent', %L)::text$q$, tests.tid('a'), tests.uid('s_support'))) like '%"priority": "urgent"%', true, 'E2: support logs an urgent ticket and assigns it');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', format($q$select public.admin_ticket_create(%L, 'Quote amount wrong on WhatsApp', 'whatsapp', 'high')::text$q$, tests.tid('b'))) like '%"channel": "whatsapp"%', true, 'E4: a second ticket, no assignee');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', format($q$select public.admin_ticket_create(%L, 'How to add a second number?', 'chat')::text$q$, tests.tid('b'))) like '%"priority": "normal"%', true, 'E5: normal is the default');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', format($q$select public.admin_ticket_create(%L, 'Bad channel', 'carrier pigeon')::text$q$, tests.tid('a'))), 'ERR:22023', 'E6: the channel is from a closed list');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', format($q$select public.admin_ticket_create(%L, 'No such business', 'chat')::text$q$, gen_random_uuid())), 'ERR:23503', 'E7: the business must exist');
update admin.support_tickets set last_message_at = now() - interval '12 minutes' where subject like 'Calls not reaching%';
select is(jsonb_array_length(pg_temp.ov('s_support') #> '{support_queue,items}'), 3, 'E8: the queue lists the open tickets');
select is(pg_temp.ov('s_support') #>> '{support_queue,items,0,priority}', 'urgent', 'E9: urgent first');
select is(pg_temp.ov('s_support') #>> '{support_queue,items,1,priority}', 'high', 'E10: then high, then normal');
select is(pg_temp.ov('s_support') #>> '{support_queue,items,0,waiting_minutes}', '12', 'E11: with how long it has waited');
select is(pg_temp.ov('s_support') #>> '{support_queue,items,0,assignee,name}', 'Anu Support', 'E12: and who has it');
select is(pg_temp.ov('s_support') #>> '{support_queue,items,0,business_name}', 'Tenant A', 'E13: and which business');
select is(pg_temp.ov('s_support') #>> '{support_queue,total_open}', '3', 'E14: the total open');
select is(jsonb_typeof(pg_temp.ov('s_finance') -> 'support_queue'), 'null', 'E15: finance does not see customer tickets');
select is(pg_temp.ov('s_finance') #>> '{badges,support_open}', '3', 'E16: but the sidebar number is the same for everyone');

-- F. health
select is(pg_temp.ov('s_owner') #>> '{health,components,1,key}', 'phone_calls', 'F1: phone calls is a component');
select is(pg_temp.ov('s_owner') #>> '{health,components,1,state}', 'degraded', 'F2: 1 failed of 3 calls in the last hour = degraded');
select is(pg_temp.ov('s_owner') #>> '{health,components,1,note}', '1 of 3 calls failed in the last hour', 'F3: with the words for it');
select is((select p ->> 'state' from jsonb_array_elements(pg_temp.ov('s_owner') #> '{health,components}') p where p ->> 'key' = 'voice'), 'unknown', 'F4: what is not measured yet says unknown');
select is(pg_temp.ov('s_owner') #>> '{health,issues}', '1', 'F5: the sidebar issue count');
select is(pg_temp.ov('s_owner') #>> '{badges,health_issues}', '1', 'F6: same number in the badges');
select is(jsonb_array_length(pg_temp.ov('s_owner') #> '{health,components}'), 6, 'F7: API, phone calls, WhatsApp, voice, database, payments');

-- G. the businesses table and the sidebar
select is(pg_temp.ov('s_owner') #>> '{businesses,0,name}', 'Tenant A', 'G1: the most recently active business first');
select is(pg_temp.ov('s_owner') #>> '{businesses,0,plan_name}', 'Sales Assistant', 'G2: its plan');
select is(pg_temp.ov('s_owner') #>> '{businesses,0,town}', 'Dharmavaram', 'G3: its town');
select is(pg_temp.ov('s_owner') #>> '{businesses,0,status}', 'not_live', 'G4: its status');
select is(pg_temp.ov('s_owner') #>> '{businesses,1,plan_name}', 'No plan', 'G5: a business without a plan');
select is(pg_temp.ov('s_owner') #>> '{badges,businesses}', '2', 'G6: the sidebar count of businesses');
select is(pg_temp.ov('s_owner') #>> '{badges,compliance_open}', '0', 'G7: and of open compliance items');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select (public.admin_businesses_list(null, 5, null, null, ''last_activity'') -> ''items'' -> 0 ->> ''name'')'), 'Tenant A', 'G8: the list can be sorted by last activity');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select public.admin_businesses_list(null, 5, null, null, ''random'')::text'), 'ERR:22023', 'G9: only the sorts that exist');

-- H. search
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select (public.admin_search(''tenant a'') -> ''businesses'' -> 0 ->> ''name'')'), 'Tenant A', 'H1: by business name');
insert into public.phone_numbers (tenant_id, number, label, inbound_on) values (tests.tid('b'), '+918000011223', 'Main', true) on conflict do nothing;
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select (public.admin_search(''11223'') -> ''businesses'' -> 0 ->> ''name'')'), 'Tenant B', 'H2: by the business''s own phone number');
select is(pg_temp.st('s_finance', 'aal2', 'sess-s_finance-0001', 'select (public.admin_search(''S19-'') -> ''invoices'' -> 0 ->> ''number'')') like 'S19-%', true, 'H3: finance finds an invoice by its number');
select is(jsonb_array_length(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select (public.admin_search(''S19-'') -> ''invoices'')::text')::jsonb), 0, 'H4: support does not search invoices');
select is(jsonb_array_length(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select (public.admin_search(''second number'') -> ''tickets'')::text')::jsonb), 1, 'H5: support finds a ticket by its title');
select is(jsonb_array_length(pg_temp.st('s_finance', 'aal2', 'sess-s_finance-0001', 'select (public.admin_search(''second number'') -> ''tickets'')::text')::jsonb), 0, 'H6: finance does not search tickets');
select is(pg_temp.st('s_support', 'aal2', 'sess-s_support-0001', 'select public.admin_search(''x'')::text'), 'ERR:22023', 'H7: at least two characters');
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', 'select public.admin_search(''tenant'')::text'), 'ERR:SM941', 'H8: a shop owner cannot search other businesses');

-- I. audit and privileges
select cmp_ok((select count(*) from admin.audit where action = 'list' and target_kind = 'business'), '>=', 4::bigint, 'I1: overview and search calls are logged');
select is((select count(*) from admin.audit where action = 'note' and target_kind = 'ticket'), 3::bigint, 'I2: each ticket created is logged');
select is((select count(*) from admin.audit where reason_text is not null and action = 'list'), 0::bigint, 'I3: what was searched for is NOT stored');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_overview', 'admin_search', 'admin_tickets_list', 'admin_ticket_create') and p.prosecdef and p.proconfig @> array['search_path=""']), 4::bigint, 'I4: security definer with a fixed, empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_overview', 'admin_search', 'admin_tickets_list', 'admin_ticket_create') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'I5: anon can execute none of them');
select is((select count(*) from information_schema.table_privileges where table_schema = 'admin' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'I6: still no client privilege on any admin table');

select * from finish();
rollback;
