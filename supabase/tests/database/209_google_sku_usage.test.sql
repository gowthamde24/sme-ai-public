-- Google Maps usage per SKU against the free monthly caps: the ledger units, the budget gate, the 80 percent alert (one per SKU per month), the staff views.
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




create function pg_temp.sup(p_user text, p_fmt text, variadic p_args text[] default '{}') returns text language plpgsql as $$ begin return pg_temp.st(p_user, 'aal2', 'sess-' || p_user || '-0001', format(p_fmt, variadic p_args)); end $$;
create function pg_temp.j(p_json text, p_path text[]) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) #>> p_path end $$;
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.rec(p_unit text, p_units numeric, p_ref text) returns text language sql as $$
  select pg_temp.w(format($q$select public.ops_record_usage(%L, 'google', %L, %s, 'search', %L)::text$q$, tests.tid('a'), p_unit, p_units, p_ref)) $$;
create function pg_temp.sku(p_unit text) returns jsonb language sql as $$
  select (select x from jsonb_array_elements(pg_temp.sup('s_finance', $q$select (public.admin_usage_google() -> 'items')::text$q$)::jsonb) x where x ->> 'unit' = p_unit) $$;

-- A. the ledger knows the SKUs
select is(pg_temp.j(pg_temp.rec('details_enterprise', 100, 'sku-test-1'), array['units']), '100.000', 'A1: Place Details Enterprise requests are recorded');
select is(pg_temp.j(pg_temp.rec('search_ids', 5, 'sku-test-2'), array['cost_paise']), '0', 'A2: IDs-only searches cost nothing (they are counted)');
select is(pg_temp.rec('details_gold', 1, 'sku-test-3'), 'ERR:22023', 'A3: an unknown SKU is refused');
select is((select count(*) from ops.google_caps), 5::bigint, 'A4: five SKUs have a cap');
select is((select monthly_free_cap from ops.google_caps where unit = 'details_enterprise'), 7000, 'A5: Enterprise 7,000 (India)');
select is((select monthly_free_cap from ops.google_caps where unit = 'details_pro'), 35000, 'A6: Pro 35,000');
select is((select monthly_free_cap from ops.google_caps where unit = 'search_ids'), 70000, 'A7: Essentials 70,000');

-- B. who may read it
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', $q$select public.admin_usage_google()::text$q$), 'ERR:SM941', 'B1: a shop owner is not staff');
select is(pg_temp.sup('s_support', $q$select public.admin_usage_google()::text$q$), 'ERR:42501', 'B2: support does not see provider usage');
select is(pg_temp.st('s_finance', 'aal1', 'sess-s_finance-0001', $q$select public.admin_usage_google()::text$q$), 'ERR:SM942', 'B3: the second factor is always needed');
select is((pg_temp.sku('details_enterprise') ->> 'used')::int, 100, 'B4: finance sees 100 used of Place Details Enterprise');
select is((pg_temp.sku('details_enterprise') ->> 'state'), 'ok', 'B5: still ok');
select is((pg_temp.sku('details_enterprise') ->> 'percent')::numeric, 1.4, 'B6: 1.4 percent');
select isnt(pg_temp.j(pg_temp.sup('s_owner', $q$select public.admin_usage_google()::text$q$), array['resets_on']), null, 'B7: it says when the month resets');

-- C. the legacy unit counts as Text Search Enterprise; 80 percent warns; 100 percent is over
select pg_temp.rec('search', 5599, 'sku-test-4');
select is((pg_temp.sku('search_enterprise') ->> 'used')::int, 5599, 'C1: the older unit `search` counts as Text Search Enterprise');
select is((pg_temp.sku('search_enterprise') ->> 'state'), 'ok', 'C2: 5,599 of 7,000 is below 80 percent');
select pg_temp.rec('search_enterprise', 1, 'sku-test-5');
select is((pg_temp.sku('search_enterprise') ->> 'state'), 'warn', 'C3: 5,600 of 7,000 is 80 percent: warn');
select pg_temp.rec('search_enterprise', 1400, 'sku-test-6');
select is((pg_temp.sku('search_enterprise') ->> 'state'), 'over', 'C4: 7,000 of 7,000: over');
select cmp_ok((pg_temp.sku('search_enterprise') ->> 'estimated_overage_paise')::int, '=', 0, 'C5: nothing beyond the cap yet');
select pg_temp.rec('search_enterprise', 10, 'sku-test-7');
select is((pg_temp.sku('search_enterprise') ->> 'estimated_overage_paise')::int, 3000, 'C6: ten beyond the cap would cost about Rs 30');

-- D. the gate before a request
select is(pg_temp.j(pg_temp.w($q$select public.ops_google_budget('details_enterprise')::text$q$), array['allowed']), 'true', 'D1: details have room');
select is(pg_temp.j(pg_temp.w($q$select public.ops_google_budget('search_enterprise')::text$q$), array['allowed']), 'false', 'D2: Text Search Enterprise is over its cap: no more requests');
select pg_temp.rec('details_enterprise', 5900, 'sku-test-8');
select is(pg_temp.j(pg_temp.w($q$select public.ops_google_budget('details_enterprise', 1000)::text$q$), array['allowed']), 'true', 'D3: exactly up to the cap is allowed (6,000 + 1,000 = 7,000)');
select pg_temp.rec('details_enterprise', 1, 'sku-test-9');
select is(pg_temp.j(pg_temp.w($q$select public.ops_google_budget('details_enterprise', 1000)::text$q$), array['allowed']), 'false', 'D4: one more request beyond that is not');
select is(pg_temp.j(pg_temp.w($q$select public.ops_google_budget('details_enterprise', 1001)::text$q$), array['allowed']), 'ERR:22023', 'D4b: a batch of more than 1,000 is refused');
select is(pg_temp.w($q$select public.ops_google_budget('gold')::text$q$), 'ERR:22023', 'D5: an unknown SKU is refused');
select is(pg_temp.w($q$select public.ops_google_budget('details_pro')::text$q$, 'a_owner'), 'ERR:42501', 'D6: only the system asks');

-- E. the alerts: one per SKU per month per state (warn at 80 percent, over at 100), e-mailed once
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_google_alerts_run() -> 'new')::text$q$)::jsonb), 2, 'E1: Text Search Enterprise is over and Place Details Enterprise is past 80 percent: two alerts');
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_google_alerts_run() -> 'new')::text$q$)::jsonb), 2, 'E2: a second run lists the same two (not e-mailed yet) and makes no new rows');
select is((select count(*) from admin.alerts), 2::bigint, 'E2b: still two alert rows');
select is((select count(*) from admin.alerts where kind = 'google_cap'), 2::bigint, 'E3: two alerts are stored');
select is(jsonb_array_length(pg_temp.w($q$select (public.ops_alert_recipients() -> 'emails')::text$q$)::jsonb), 1, 'E4: the owner is the recipient');
select pg_temp.w(format($q$select public.ops_alert_mark_emailed(array[%L]::uuid[])::text$q$, (select id from admin.alerts order by created_at limit 1)));
select is((select count(*) from admin.alerts where emailed_at is not null), 1::bigint, 'E5: one is marked sent');
select is(jsonb_array_length(pg_temp.sup('s_finance', $q$select (public.admin_alerts_list() -> 'items')::text$q$)::jsonb), 2, 'E6: finance sees both');
select is(jsonb_array_length(pg_temp.sup('s_support', $q$select (public.admin_alerts_list() -> 'items')::text$q$)::jsonb), 0, 'E7: support does not see provider alerts');
select is(pg_temp.j(pg_temp.sup('s_finance', format($q$select public.admin_alert_ack(%L)::text$q$, (select id from admin.alerts order by created_at limit 1))), array['acknowledged']), 'true', 'E8: finance acknowledges one');
select is(jsonb_array_length(pg_temp.sup('s_finance', $q$select (public.admin_alerts_list() -> 'items')::text$q$)::jsonb), 1, 'E9: it leaves the list');
select is(pg_temp.sup('s_support', format($q$select public.admin_alert_ack(%L)::text$q$, (select id from admin.alerts order by created_at limit 1))), 'ERR:42501', 'E10: support cannot');

-- F. Usage & cost
select pg_temp.w(format($q$select public.ops_record_usage(%L, 'cartesia', 'character', 2000, 'assistant_turn', 'sku-turn-1')::text$q$, tests.tid('a')));
select pg_temp.sup('s_finance', $q$select public.admin_usage_summary(current_date - 1, current_date)::text$q$);
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_usage_summary(current_date - 1, current_date)::text$q$), array['providers', '0', 'provider']), 'google', 'F1: the provider that cost most is first (Google Text Search beyond the cap)');
select is(pg_temp.sup('s_support', $q$select public.admin_usage_summary(current_date - 1, current_date)::text$q$), 'ERR:42501', 'F2: support does not see costs');
select is(pg_temp.j(pg_temp.sup('s_owner', $q$select public.admin_usage_summary(current_date - 1, current_date)::text$q$), array['businesses', '0', 'negative_margin']), 'true', 'F3: a business that cost more than it paid is flagged');
select is(pg_temp.sup('s_owner', $q$select public.admin_usage_summary(current_date, current_date - 5)::text$q$), 'ERR:22023', 'F4: a period runs forwards');
select isnt(pg_temp.j(pg_temp.sup('s_owner', $q$select public.admin_usage_summary(current_date - 1, current_date)::text$q$), array['costs_recorded_since']), null, 'F5: it says since when costs are recorded');

select * from finish();
rollback;
