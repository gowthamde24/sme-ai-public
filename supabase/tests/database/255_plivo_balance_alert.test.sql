-- The daily Plivo balance check (migration 20261231986100; owner decision, 19 Nov 2026): one record a day, one "Needs you" item while the balance is low (the owner and finance see it, support does not), at most one
-- WhatsApp message a day, a recovery clears the item, six failed reads raise an item of their own, only the system account runs it, no client role touches the table.
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
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
-- the owner's list as a number of items
create function pg_temp.items(p_user text, p_ack boolean default false) returns text language sql as $$
  select pg_temp.sup(p_user, 'select jsonb_array_length(public.admin_alerts_list(%L) -> ''items'')::text', p_ack::text)
$$;
-- "the next India day": the day's record goes (the open item stays), as the clock would do it
create function pg_temp.next_day() returns void language sql as $$ delete from ops.plivo_balance_checks $$;

-- A. nothing read yet: a read is due, nothing to tell; only the system account may ask
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'read_due')$q$), 'true', 'A1: no record today: a read is due');
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'whatsapp_due')$q$), 'false', 'A2: and no message');
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'read_due')$q$, 'a_owner'), 'ERR:42501', 'A3: a workspace owner cannot run it');
select is(pg_temp.sup('s_owner', $q$select (public.ops_plivo_balance_due() ->> 'read_due')$q$), 'ERR:42501', 'A4: nor a staff member');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('ok', 450))::text$q$, 'a_owner'), 'ERR:42501', 'A5: nor can they report');
select is(pg_temp.w($q$select public.ops_plivo_balance_told()::text$q$, 'a_owner'), 'ERR:42501', 'A6: nor mark the message told');
select is(has_function_privilege('anon', 'public.ops_plivo_balance_report(text, numeric, text, boolean)', 'execute'), false, 'A7: anon cannot execute the report');
select is(pg_temp.w($q$select count(*)::text from ops.plivo_balance_checks$q$, 'a_owner'), 'ERR:42501', 'A8: no client role reads the table');
select is(pg_temp.w($q$select count(*)::text from ops.plivo_balance_checks$q$), 'ERR:42501', 'A9: not even the system account reads it directly (it writes through the function)');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.plivo_balance_checks'::regclass), true, 'A10: row-level security is on and forced');

-- B. a healthy balance: recorded, no item, no message, no second read today
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('ok', 450, null, false) ->> 'state')$q$), 'ok', 'B1: reported ok');
select is((select balance_inr::text || '/' || auto_recharge::text from ops.plivo_balance_checks), '450.00/false', 'B2: the day''s record keeps the rupees and what Plivo said about auto-recharge');
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 0::bigint, 'B3: no item');
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'read_due')$q$), 'false', 'B4: one read a day');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('low', 10, 'a second reading') ->> 'state')$q$), 'ok', 'B5: the first reading of the day stands');
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 0::bigint, 'B6: and a second reading makes no item');

-- C. a low balance: ONE item, the message is due, the owner and finance see it, support does not
select pg_temp.next_day();
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('low', 211.5, 'Plivo reports 2.35 USD, about Rs 212. The limit is Rs 300.', false) ->> 'whatsapp_due')$q$), 'true', 'C1: low: the WhatsApp message to the owner is due');
select is((select count(*) from admin.alerts where kind = 'plivo_balance' and acknowledged_at is null), 1::bigint, 'C2: one open item');
select is((select title from admin.alerts where kind = 'plivo_balance'), 'Plivo balance is low: about Rs 212 left', 'C3: its words');
select is((select severity from admin.alerts where kind = 'plivo_balance'), 'warn', 'C4: a warning while there is still credit');
select is((select detail from admin.alerts where kind = 'plivo_balance'), 'Plivo reports 2.35 USD, about Rs 212. The limit is Rs 300.', 'C5: the sentence the worker made');
select is(pg_temp.items('s_owner'), '1', 'C6: the owner sees the item');
select is(pg_temp.items('s_finance'), '1', 'C7: finance sees it');
select is(pg_temp.items('s_support'), '0', 'C8: support does not');
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'whatsapp_due')$q$), 'true', 'C9: the next tick still sees the message as due (a failed send is tried again)');
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'balance_inr')$q$), '211.50', 'C10: and the amount to say comes from the record');
do $$ begin perform pg_temp.w($q$select public.ops_plivo_balance_told()::text$q$); end $$;
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'whatsapp_due')$q$), 'false', 'C11: once told, no second message today');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('low', 100, 'again') ->> 'whatsapp_due')$q$), 'false', 'C12: a repeat report the same day does not make it due again');
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 1::bigint, 'C13: and makes no second item');
select is((select whatsapp_at is not null from ops.plivo_balance_checks), true, 'C14: the record says when it was told');

-- D. the next day, still low: still ONE open item (its words refreshed), and one more message is due
select pg_temp.next_day();
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('low', 150, 'Plivo reports 1.67 USD, about Rs 150. The limit is Rs 300.', null) ->> 'whatsapp_due')$q$), 'true', 'D1: one message a day while it stays low');
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 1::bigint, 'D2: still one item');
select is((select title from admin.alerts where kind = 'plivo_balance'), 'Plivo balance is low: about Rs 150 left', 'D3: with today''s amount');
select is((select auto_recharge is null from ops.plivo_balance_checks), true, 'D4: a Plivo that did not say about auto-recharge is stored as unknown, not as off');

-- E. a recovery clears the item (the system acknowledges it; no staff member)
select pg_temp.next_day();
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('ok', 800, null, false) ->> 'whatsapp_due')$q$), 'false', 'E1: recovered: no message');
select is(pg_temp.items('s_owner'), '0', 'E2: the item is gone from the list');
select is(pg_temp.items('s_owner', true), '1', 'E3: and is still there as history');
select is((select acknowledged_by is null and acknowledged_at is not null from admin.alerts where kind = 'plivo_balance'), true, 'E4: acknowledged by the system, not by a person');

-- F. an empty balance is "over"; a later low starts a new item (the old key is from an earlier day)
delete from admin.alerts where kind = 'plivo_balance';
select pg_temp.next_day();
do $$ begin perform pg_temp.w($q$select (public.ops_plivo_balance_report('low', 0, 'Plivo reports 0 USD.') ->> 'state')$q$); end $$;
select is((select severity || '/' || title from admin.alerts where kind = 'plivo_balance'), 'over/Plivo balance is low: about Rs 0 left', 'F1: nothing left: over');

-- G. a failed read: tried again an hour later; the sixth failure of a day raises its own item; a later good reading clears it
delete from admin.alerts where kind = 'plivo_balance';
select pg_temp.next_day();
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('failed') ->> 'state')$q$), 'failed', 'G1: a failed read is recorded');
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'read_due')$q$), 'false', 'G2: not tried again at once');
update ops.plivo_balance_checks set checked_at = now() - interval '2 hours';
select is(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'read_due')$q$), 'true', 'G3: an hour later it is');
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 0::bigint, 'G4: one failure is not an item');
do $$ begin for i in 1..4 loop perform pg_temp.w($q$select (public.ops_plivo_balance_report('failed') ->> 'state')$q$); end loop; end $$;
select is((select attempts from ops.plivo_balance_checks), 5, 'G5: five tries');
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 0::bigint, 'G6: still no item');
do $$ begin perform pg_temp.w($q$select (public.ops_plivo_balance_report('failed') ->> 'state')$q$); end $$;
select is((select title from admin.alerts where kind = 'plivo_balance'), 'The Plivo balance could not be read today', 'G7: the sixth failure raises an item of its own');
do $$ begin perform pg_temp.w($q$select (public.ops_plivo_balance_report('failed') ->> 'state')$q$); end $$;
select is((select count(*) from admin.alerts where kind = 'plivo_balance'), 1::bigint, 'G8: and only one');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('ok', 500) ->> 'state')$q$), 'ok', 'G9: a later good reading the same day replaces the failed record');
select is((select count(*) from admin.alerts where kind = 'plivo_balance' and acknowledged_at is null), 0::bigint, 'G10: and clears the item');

-- H. input is checked
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('bogus', 1))::text$q$), 'ERR:22023', 'H1: an unknown state');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('low'))::text$q$), 'ERR:22023', 'H2: a reading without an amount');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('low', 1, repeat('x', 501)))::text$q$), 'ERR:22023', 'H3: a sentence over 500 characters');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report(null))::text$q$), 'ERR:22023', 'H4: no state');
select is(pg_temp.w($q$select (public.ops_plivo_balance_report('ok', 1e12))::text$q$), 'ERR:22023', 'H5: an absurd amount');

-- J. a failed read with a known reason is an item at once, with its own title and sentence (28 Nov 2026)
delete from admin.alerts where kind = 'plivo_balance';
select pg_temp.next_day();
do $$ begin perform pg_temp.w($q$select (public.ops_plivo_balance_report('failed', null, 'VoiceLink refused the login (401). Use the registered username, not the display name.') ->> 'state')$q$); end $$;
select is((select title from admin.alerts where kind = 'plivo_balance'), 'The telephony balance could not be read today', 'J1: a known reason is an item on the first failed read');
select is((select detail from admin.alerts where kind = 'plivo_balance'), 'VoiceLink refused the login (401). Use the registered username, not the display name.', 'J2: with the sentence the worker made');
-- K. a telephony setting that is not as promised (28 Nov 2026, migration 988500): one item while it lasts, cleared when it is right again, only the system account reports it
delete from admin.alerts where kind in ('plivo_balance', 'telephony_setting');
select is(pg_temp.w($q$select public.ops_telephony_setting_report(false, 'VoiceLink call recording is ON for 1 of our numbers.')::text$q$), '', 'K1: the system account reports a wrong setting');
select is((select title from admin.alerts where kind = 'telephony_setting' and acknowledged_at is null), 'A telephony setting is not as promised', 'K2: one open item with its title');
do $$ begin perform pg_temp.w($q$select public.ops_telephony_setting_report(false, 'again')::text$q$); end $$;
select is((select count(*) from admin.alerts where kind = 'telephony_setting' and acknowledged_at is null), 1::bigint, 'K3: a second report the same day is still ONE item');
select is(pg_temp.w($q$select public.ops_telephony_setting_report(false)::text$q$), 'ERR:22023', 'K4: a wrong setting needs its sentence');
select is(pg_temp.w($q$select public.ops_telephony_setting_report(false, 'x')::text$q$, 'a_owner'), 'ERR:42501', 'K5: a workspace owner cannot report it');
do $$ begin perform pg_temp.w($q$select public.ops_telephony_setting_report(true)::text$q$); end $$;
select is((select count(*) from admin.alerts where kind = 'telephony_setting' and acknowledged_at is null), 0::bigint, 'K6: when the setting is right again the item is cleared');
select ok(pg_temp.w($q$select (public.ops_plivo_balance_due() ->> 'calls_7d_paise')$q$, 'outsider') ~ '^[0-9]+$', 'I1: the answer also carries the last 7 days of call cost in paise (a whole number)');

select * from finish();
rollback;
