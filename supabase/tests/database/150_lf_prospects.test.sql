-- Lead Finder (migration 20261226090000, ADR 0119): searches, prospects, the Owner's answers, the call result.
--   A catalog and grants   B a search from plan to done (dedupe by place, the daily cap)   C roles   D one workspace only   E the module (a school is refused)   F suppression is for good   G a qualified call makes a lead
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'textiles');
select tests.cp_pack('b', 'textiles');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.plan(p_user text, p_tenant text, p_id uuid) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.prospect_search_plan(%L, %L, 'saree shops', 'Jayanagar Bengaluru', 'retailer', 20, 'fixture', 'fixture', 0, 'Example search ''saree shops Jayanagar'', 2 Nov')::text$q$, tests.tid(p_tenant), p_id))
$$;
create function pg_temp.item(p_place text, p_name text, p_status text, p_fit integer) returns jsonb language sql as $$
  select jsonb_build_object('place_id', p_place, 'name', p_name, 'name_key', lower(p_name), 'category', 'Saree shop', 'area', 'Jayanagar', 'phone', '+00 000 4' || lpad((abs(hashtext(p_place)) % 10000)::text, 4, '0'),
                            'phone_key', '0000004' || lpad((abs(hashtext(p_place)) % 10000)::text, 4, '0'), 'rating', 4.3, 'review_count', 120, 'status', p_status, 'decision_reason', case when p_status = 'call_ready' then 'fit_high' else 'first_calls' end,
                            'fit_score', p_fit, 'fit_reason', 'Saree shop; we have silk sarees in stock', 'stock_match', jsonb_build_object('enough', true))
$$;

-- A
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('lead_finder_settings_get', 'lead_finder_settings_set', 'prospect_search_plan', 'prospect_search_approve', 'prospect_search_cancel', 'prospect_searches_list', 'prospect_search_get', 'prospect_context',
                              'prospect_search_finish', 'prospects_list', 'prospect_get', 'prospect_stats', 'prospect_decisions_apply', 'prospect_act', 'prospect_call_finish', 'prospect_places_expire')
            and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 16::bigint,
          'A1: the sixteen lead finder functions are SECURITY DEFINER, empty search_path, not for anon');
select is((select count(*) from information_schema.table_privileges where table_schema = 'public' and table_name in ('prospects', 'prospect_searches', 'lead_finder_settings') and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'),
          0::bigint, 'A2: nobody writes the tables directly');

-- B: settings, a search, its results
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.lead_finder_settings_get(%L)::text$q$, tests.tid('a'))), 'fit_bar'), '70', 'B1: the bar is 70 until the Owner changes it');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.lead_finder_settings_set(%L, '{"fit_bar": 75, "searches_per_day": 2}')::text$q$, tests.tid('a'))), 'fit_bar'), '75', 'B2: the Owner sets the bar');
select is(pg_temp.sc('a_owner', format($q$select public.lead_finder_settings_set(%L, '{"call_to_hour": 23}')::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: never after 21:00');
select is(pg_temp.sc('a_owner', format($q$select public.lead_finder_settings_set(%L, '{"anything": 1}')::text$q$, tests.tid('a'))), 'ERR:22023', 'B4: an unknown setting is refused');
select is(pg_temp.sc('a_sales', format($q$select public.lead_finder_settings_set(%L, '{"fit_bar": 50}')::text$q$, tests.tid('a'))), 'ERR:42501', 'B5: Sales do not change the settings');

select is(pg_temp.j(pg_temp.plan('a_sales', 'a', tests.rid('s1')), 'state'), 'planned', 'B6: Sales plan a search');
select is(pg_temp.j(pg_temp.plan('a_sales', 'a', tests.rid('s1')), 'id'), tests.rid('s1')::text, 'B7: the same plan again is replayed');
select is(pg_temp.sc('a_sales', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:42501', 'B8: Sales do not approve it');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, '[]', 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s1'))), 'ERR:SM973', 'B9: a search that is not approved does not finish');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'state'), 'approved', 'B10: the Owner approves');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s1'))), 'state'), 'approved', 'B11: the same yes again changes nothing');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 0, '{"found": 3}')::text$q$, tests.tid('a'), tests.rid('s1'),
          jsonb_build_array(pg_temp.item('fx_p1', 'Sri Lakshmi Sarees', 'call_ready', 82), pg_temp.item('fx_p2', 'Kanchi Silk House', 'needs_owner', 64), pg_temp.item('fx_p3', 'Vasavi Textiles', 'needs_owner', 71)))), 'found'), '3',
          'B12: three businesses found');
select is((select source || '|' || source_label from public.prospects where tenant_id = tests.tid('a') and place_id = 'fx_p1'), 'fixture|Example search ''saree shops Jayanagar'', 2 Nov', 'B13: each keeps where it came from');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_search_finish(%L, %L, '[]', 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s1'))), 'found'), '3', 'B14: finishing again is replayed');
-- a second search that finds one of the same places: it is not stored twice
select pg_temp.plan('a_owner', 'a', tests.rid('s2'));
select pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s2')));
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s2'),
          jsonb_build_array(pg_temp.item('fx_p1', 'Sri Lakshmi Sarees', 'call_ready', 82), pg_temp.item('fx_p4', 'Mysore Silk Point', 'call_ready', 77)))), 'found'), '1', 'B15: a place already held is not stored again');
select is((select count(*) from public.prospects where tenant_id = tests.tid('a') and place_id = 'fx_p1'), 1::bigint, 'B16: one row per place');
select pg_temp.plan('a_owner', 'a', tests.rid('s3'));
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s3'))), 'ERR:SM972', 'B17: the third search of the day is over the cap of two');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.prospect_search_cancel(%L, %L)::text$q$, tests.tid('a'), tests.rid('s3'))), 'state'), 'cancelled', 'B18: it can be cancelled');
select is(jsonb_array_length(pg_temp.sc('a_sales', format($q$select public.prospects_list(%L, 'needs_owner')::text$q$, tests.tid('a')))::jsonb), 2, 'B19: two need the Owner');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_context(%L)::text$q$, tests.tid('a'))), 'searches_today'), '2', 'B20: the context counts the searches of today');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s3'), jsonb_build_array(pg_temp.item('fx_p9', 'X', 'new', 1)))), 'ERR:SM973', 'B21: a cancelled search takes no results');

-- the real-data gate: a closed workspace takes no real number and no Google result
select pg_temp.plan('a_owner', 'a', tests.rid('s5'));
update public.lead_finder_settings set searches_per_day = 9 where tenant_id = tests.tid('a');
select pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s5')));
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s5'),
          jsonb_build_array(pg_temp.item('fx_p8', 'Y', 'new', 1) || '{"phone": "+91 98450 12345"}'::jsonb))), 'ERR:22023', 'B23: with the gate closed a real number is refused');
update public.prospect_searches set provider = 'places' where id = tests.rid('s5');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, '[]', 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s5'))), 'ERR:42501', 'B24: and no Google Places result at all');
update public.prospect_searches set state = 'cancelled' where id = tests.rid('s5');

-- C: roles
select is(pg_temp.sc('a_viewer', format($q$select public.prospects_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C1: a Viewer does not see prospects');
select is(pg_temp.sc('a_viewer', format($q$select count(*)::text from public.prospects where tenant_id = %L$q$, tests.tid('a'))), '0', 'C2: nor the table');
select is(pg_temp.sc('anon', format($q$select public.prospects_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C3: nor anyone signed out');
select is(pg_temp.sc('a_owner', $q$select public.prospect_places_expire(30)::text$q$), 'ERR:42501', 'C4: only the scheduler expires Google data');

-- D: one workspace only
select is(pg_temp.sc('b_owner', format($q$select public.prospects_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'D1: another workspace''s Owner is refused');
select is(pg_temp.sc('b_owner', format($q$select count(*)::text from public.prospects where tenant_id = %L$q$, tests.tid('a'))), '0', 'D2: and sees no row');
select is(pg_temp.sc('b_owner', format($q$select public.prospect_act(%L, (select id from public.prospects where place_id = 'fx_p1' and tenant_id = %L), 'call')::text$q$, tests.tid('b'), tests.tid('a'))), 'ERR:23503', 'D3: a prospect of another workspace is not found');

-- E: the module (a school has no Lead Finder)
select tests.cp_pack('b', 'education');
select is(pg_temp.sc('b_owner', format($q$select public.prospect_search_plan(%L, %L, 'schools', null, null, 5, 'fixture', 'fixture', 0, 'x')::text$q$, tests.tid('b'), tests.rid('sb'))), 'ERR:SM971', 'E1: a school cannot search');
select is(pg_temp.sc('b_owner', format($q$select public.lead_finder_settings_get(%L)::text$q$, tests.tid('b'))), 'ERR:SM971', 'E2: nor read the settings');

-- F: the Owner's answers; suppression is for good
create temp table pids as select place_id, id from public.prospects where tenant_id = tests.tid('a');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.prospect_act(%L, %L, 'call')::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p2'))), 'status'), 'call_ready', 'F1: the Owner says call');
select is((select owner_approved from public.prospects where place_id = 'fx_p2' and tenant_id = tests.tid('a')), true, 'F2: and it is marked as approved by a person');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_act(%L, %L, 'later')::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p3'))), 'decision_reason'), 'asked_later', 'F3: ask me later');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.prospect_act(%L, %L, 'do_not_call')::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p3'))), 'suppressed'), 'true', 'F4: do not call suppresses');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_act(%L, %L, 'call')::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p3'))), 'ERR:SM973', 'F5: a suppressed business is never called again');
select is(pg_temp.sc('a_owner', format($q$select public.prospect_decisions_apply(%L, %L)::text$q$, tests.tid('a'),
          jsonb_build_array(jsonb_build_object('id', (select id from pids where place_id = 'fx_p3'), 'status', 'call_ready', 'decision_reason', 'fit_high', 'fit_score', 99)))), '0', 'F6: and no re-decision revives it');
select throws_ok(format($q$update public.prospects set suppressed = false where place_id = 'fx_p3' and tenant_id = %L$q$, tests.tid('a')), 'SM973', null, 'F7: even the owner of the database cannot lift it');
select pg_temp.plan('a_owner', 'a', tests.rid('s4'));
update public.lead_finder_settings set searches_per_day = 5 where tenant_id = tests.tid('a');
select pg_temp.sc('a_owner', format($q$select public.prospect_search_approve(%L, %L)::text$q$, tests.tid('a'), tests.rid('s4')));
select pg_temp.sc('a_owner', format($q$select public.prospect_search_finish(%L, %L, %L, 'done', 0, null)::text$q$, tests.tid('a'), tests.rid('s4'), jsonb_build_array(pg_temp.item('fx_p3', 'Vasavi Textiles', 'call_ready', 90))));
select is((select status || '|' || suppressed from public.prospects where place_id = 'fx_p3' and tenant_id = tests.tid('a')), 'not_interested|true', 'F8: a new search that finds it again does not revive it');

-- G: the call result
select is(pg_temp.sc('a_owner', format($q$select public.prospect_call_finish(%L, %L, null, 'qualified', '{}')::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p3'))), 'ERR:SM973', 'G0: a suppressed business has no call result');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_call_finish(%L, %L, %L, 'qualified', '{"summary": "Sells silk sarees, wants 40 a month for the wedding season"}')::text$q$, tests.tid('a'),
          (select id from pids where place_id = 'fx_p1'), tests.rid('c1'))), 'status'), 'qualified', 'G1: a qualified call');
select ok((select lead_id is not null from public.prospects where place_id = 'fx_p1' and tenant_id = tests.tid('a')), 'G2: made a lead');
select is((select l.source from public.leads l join public.prospects p on p.lead_id = l.id where p.place_id = 'fx_p1' and p.tenant_id = tests.tid('a')), 'lead_finder', 'G3: whose source is the Lead Finder');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_call_finish(%L, %L, %L, 'qualified', '{}')::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p1'), tests.rid('c1'))), 'status'), 'qualified',
          'G4: the same result again is replayed');
select is((select count(*) from integrations.lead_items where tenant_id = tests.tid('a') and source_tag = 'lead_finder'), 1::bigint, 'G5: one lead only');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_call_finish(%L, %L, %L, 'not_interested', null)::text$q$, tests.tid('a'), (select id from pids where place_id = 'fx_p4'), tests.rid('c2'))), 'suppressed'), 'true',
          'G6: "not interested" on the call suppresses for good');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.prospect_stats(%L)::text$q$, tests.tid('a'))), 'total'), '4', 'G7: the stats count the four businesses');

select * from finish();
rollback;
