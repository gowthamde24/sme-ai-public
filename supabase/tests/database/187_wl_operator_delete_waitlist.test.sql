-- Waitlist removal on request (migration 20261231480000): only the operator, by e-mail or phone, nothing personal is kept about the removal.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

select pg_temp.val('anon', $q$select public.waitlist_join('Sita Devi', 'textiles', 'Guntur', '+91 98765 43210', null, 'te', false, '2026-10-25') ->> 'status'$q$);
select pg_temp.val('anon', $q$select public.waitlist_join('Ravi Kumar', 'other', 'Vijayawada', null, 'Ravi.Kumar@Example.test', 'en', true, '2026-10-25') ->> 'status'$q$);
select pg_temp.val('anon', $q$select public.waitlist_join('Latha', 'education', 'Tenali', '9123456789', null, 'te', false, '2026-10-25') ->> 'status'$q$);
select is((select count(*)::int from privacy.waitlist_entries), 3, 'W1 three people joined');

-- nobody but the operator
select is(pg_temp.val('anon', $q$select app.operator_delete_waitlist_entry('ravi.kumar@example.test')::text$q$), 'ERR:42501', 'W2 the public key cannot run it');
select is(pg_temp.val('a_owner', $q$select app.operator_delete_waitlist_entry('ravi.kumar@example.test')::text$q$), 'ERR:42501', 'W3 a workspace Owner cannot run it');
select is((select count(*)::int from privacy.waitlist_entries), 3, 'W4 ... and nothing was removed');
select ok(not has_function_privilege('anon', 'app.operator_delete_waitlist_entry(text)', 'execute') and not has_function_privilege('authenticated', 'app.operator_delete_waitlist_entry(text)', 'execute')
          and not has_function_privilege('service_role', 'app.operator_delete_waitlist_entry(text)', 'execute'), 'W5 no client role holds execute');

-- the operator (this session has no request identity)
select is(app.operator_delete_waitlist_entry('RAVI.KUMAR@example.test '), 1, 'W6 an e-mail, in any case, removes that entry');
select is((select count(*)::int from privacy.waitlist_entries where email is not null), 0, 'W7 ... it is gone');
select is(app.operator_delete_waitlist_entry('+91-98765-43210'), 1, 'W8 a phone number with any punctuation removes that entry');
select is(app.operator_delete_waitlist_entry('9123456789'), 1, 'W9 a phone given without a plus is found the same way');
select is((select count(*)::int from privacy.waitlist_entries), 0, 'W10 all three are gone');
select is(app.operator_delete_waitlist_entry('nobody@example.test'), 0, 'W11 an unknown contact removes nothing and says 0');
select throws_ok($q$select app.operator_delete_waitlist_entry('   ')$q$, '22023', null, 'W12 an empty contact is refused');

-- the removals log holds counts and times only
select is((select sum(entries)::int from privacy.waitlist_removals), 3, 'W13 the log counts the removals');
select is((select count(*)::int from privacy.waitlist_removals), 4, 'W14 ... one line per call, including the one that found nobody');
select is((select count(*)::int from information_schema.columns where table_schema = 'privacy' and table_name = 'waitlist_removals'), 3, 'W15 the log has three columns: id, time, count (nothing about who)');
select is(pg_temp.val('a_owner', $q$select count(*)::text from privacy.waitlist_removals$q$), 'ERR:42501', 'W16 no client role reads the log');

select * from finish();
rollback;
