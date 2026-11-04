-- The owner's test workspaces (migration 20261226100000): A a school has no outreach   B example data reaches more of a week (operator marks), removal in passes, kept when changed or used   C reset
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cp_pack('a', 'textiles');

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- A: outreach
select lives_ok(format($q$insert into public.outreach_rules (id, tenant_id, source, action, goal, channel, language, approved_by) values (%L, %L, 'gtw1', 'call_within_minutes', 'general', 'call', 'en', %L)$q$,
                       gen_random_uuid(), tests.tid('a'), tests.uid('a_owner')), 'A1: a shop may have a standing rule');
select tests.cp_pack('b', 'education');
select throws_ok(format($q$insert into public.outreach_rules (id, tenant_id, source, action, goal, channel, language, approved_by) values (%L, %L, 'gtw2', 'call_within_minutes', 'general', 'call', 'en', %L)$q$,
                        gen_random_uuid(), tests.tid('b'), tests.uid('b_owner')), 'SM951', null, 'A2: a school may not');
select throws_ok(format($q$insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, plan_sha256, created_by) values (%L, %L, 'x', 'general', 'call', 'en', repeat('a', 64), %L)$q$,
                        gen_random_uuid(), tests.tid('b'), tests.uid('b_owner')), 'SM951', null, 'A3: nor a batch of calls');

select is(pg_temp.at('aal1', 'b_owner', format($$select app.today_is_school(%L)::text$$, tests.tid('b'))), 'true', 'A4: Today knows the school is a school');
select is(pg_temp.at('aal1', 'a_owner', format($$select app.today_is_school(%L)::text$$, tests.tid('b'))), 'false', 'A5: and tells nobody outside it');
select is(pg_temp.at('aal1', 'b_owner', format($$select (public.today_summary(%L) is not null)::text$$, tests.tid('b'))), 'true', 'A6: Today still answers for a school');

-- B: example data
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.example_data_load(%L) ->> 'loaded')$$, tests.tid('a'))), 'true', 'B1: the sample loads');
select throws_ok(format($q$select app.operator_mark_example(%L, 'orders', gen_random_uuid(), 'owner test week: seed script marks')$q$, tests.tid('a')), '22023', null, 'B2: an order is never example data (orders are never deleted)');
select throws_ok(format($q$select app.operator_mark_example(%L, 'contacts', gen_random_uuid(), 'short')$q$, tests.tid('a')), '22023', null, 'B3: the operator gives a reason');
select is(pg_temp.at('aal2', 'a_owner', format($q$select app.operator_mark_example(%L, 'contacts', %L, 'owner test week: seed script marks')::text$q$, tests.tid('a'), tests.rid('a_contact'))), 'ERR:42501',
          'B4: nobody signed in may call it (operator only)');
-- a week's rows made "through the API" (here: directly) and marked
insert into public.contacts (id, tenant_id, full_name) values (tests.rid('tw_c1'), tests.tid('a'), 'Example: Week Customer'), (tests.rid('tw_c2'), tests.tid('a'), 'Example: Changed Customer');
insert into public.knowledge_sources (id, tenant_id, kind, title, filename, content_type, text, chars, status, created_by)
values (tests.rid('tw_ks'), tests.tid('a'), 'file', 'Example: hours', 'example-hours.pdf', 'application/pdf', 'Open all week', 13, 'read', tests.uid('a_owner'));
insert into public.knowledge_facts (id, tenant_id, source_id, kind, text, created_by) values (tests.rid('tw_kf'), tests.tid('a'), tests.rid('tw_ks'), 'hours', 'Example: open all week', tests.uid('a_owner'));
select ok((select app.operator_mark_example(tests.tid('a'), 'contacts', tests.rid('tw_c1'), 'owner test week: seed script marks') ->> 'batch_id') is not null, 'B5: a contact of the week is marked');
select app.operator_mark_example(tests.tid('a'), 'contacts', tests.rid('tw_c2'), 'owner test week: seed script marks');
select app.operator_mark_example(tests.tid('a'), 'knowledge_sources', tests.rid('tw_ks'), 'owner test week: seed script marks');
select app.operator_mark_example(tests.tid('a'), 'knowledge_facts', tests.rid('tw_kf'), 'owner test week: seed script marks');
update public.contacts set full_name = 'Example: Changed by the owner' where id = tests.rid('tw_c2');
create temp table t_rm as select pg_temp.at('aal2', 'a_owner', format($$select public.example_data_remove(%L)::text$$, tests.tid('a'))) as j;
select is((select count(*) from public.contacts where id = tests.rid('tw_c1')), 0::bigint, 'B6: the marked contact is removed');
select is((select count(*) from public.contacts where id = tests.rid('tw_c2')), 1::bigint, 'B7: the one the owner changed is kept');
select is((select count(*) from public.knowledge_sources where id = tests.rid('tw_ks')), 0::bigint, 'B8: a source whose fact was also sample goes in a later pass');
select ok(((select j from t_rm)::jsonb -> 'removed' ->> 'other')::integer >= 2, 'B9: the new tables are reported under other');
select ok(((select j from t_rm)::jsonb -> 'kept' ->> 'contacts')::integer >= 1, 'B10: and the kept contact is counted');

-- C: reset
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.example_data_reset(%L) -> 'status' ->> 'loaded')$$, tests.tid('a'))), 'true', 'C1: reset loads it again');
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.example_data_reset(%L) -> 'status' ->> 'loaded')$$, tests.tid('a'))), 'true', 'C2: and again (remove + load each time)');
select is((select count(*) from packs.example_batches where tenant_id = tests.tid('a') and removed_at is null), 1::bigint, 'C3: one live batch only');
select is(pg_temp.at('aal2', 'a_sales', format($$select public.example_data_reset(%L)::text$$, tests.tid('a'))), 'ERR:42501', 'C4: Sales cannot reset');

select * from finish();
rollback;
