-- Extra lines (migration 20261231992500): a workspace's calls at once = 2 for each number + the extra lines it bought. Bought from the wallet, once a month; a channel that was not bought gives the money back;
-- cancelling works at the end of the paid month; an unpaid renewal has days of grace and then pauses; nothing writes the table directly; members read their own workspace only.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.buy(p_user text, p_tenant text, p_key text) returns text language plpgsql as $$
begin return pg_temp.sc(p_user, format('select public.extra_line_buy(%L, %L)::text', tests.tid(p_tenant), p_key)); end $$;
create function pg_temp.chan(p_user text, p_id text, p_ok boolean) returns text language plpgsql as $$
begin return pg_temp.sc(p_user, format('select public.extra_line_channel_result(%L, %L, %L)::text', p_id, p_ok, 'order_1')); end $$;
create function pg_temp.get(p_user text, p_tenant text, p_key text) returns text language plpgsql as $$
begin return pg_temp.j(pg_temp.sc(p_user, format('select public.extra_lines_get(%L)::text', tests.tid(p_tenant))), p_key); end $$;
create function pg_temp.renew() returns jsonb language plpgsql as $$
begin return pg_temp.sc('outsider', 'select public.extra_lines_renew(50)::text')::jsonb; end $$;

insert into public.phone_numbers (tenant_id, number) values (tests.tid('a'), '+918044440101'), (tests.tid('b'), '+918044440102');

-- A. the switch is off until Stack19 turns it on
select is(pg_temp.get('a_owner', 'a', 'enabled'), 'false', 'A1: the platform switch is off at the start');
select is(pg_temp.buy('a_owner', 'a', 'key_a_00001'), 'ERR:SM954', 'A2: no line can be bought while it is off');
select is((select count(*) from pricing.extra_lines), 0::bigint, 'A3: and nothing was written');

select app.operator_set_extra_lines(true);
select is(pg_temp.get('a_owner', 'a', 'total'), '2', 'B1: one number includes two lines');
select is(pg_temp.get('a_owner', 'a', 'price_paise'), '14900', 'B2: an extra line is Rs 149');
select is(pg_temp.get('a_owner', 'a', 'cap'), '20', 'B3: and a workspace may have 20 lines');
select is(pg_temp.get('a_owner', 'a', 'can_add'), 'true', 'B4: the Owner can add one');

-- B. buying
select is(pg_temp.buy('a_owner', 'a', 'key_a_00001'), 'ERR:SM957', 'B5: with no credits it is refused, in plain words (not enough credits)');
select is((select count(*) from pricing.extra_lines) + (select count(*) from pricing.usage where kind = 'line'), 0::bigint, 'B6: and nothing was taken or recorded');
select pricing.credit(tests.tid('a'), 'topup', 'pay_xl_1', 50000);
select is(pg_temp.buy('a_admin', 'a', 'key_a_00001'), 'ERR:42501', 'B7: an Admin cannot add a line (Owner only)');
select is(pg_temp.buy('a_viewer', 'a', 'key_a_00001'), 'ERR:42501', 'B8: nor can a viewer');
select is(pg_temp.buy('b_owner', 'a', 'key_a_00001'), 'ERR:42501', 'B9: nor the Owner of another workspace');
create temp table got as select pg_temp.buy('a_owner', 'a', 'key_a_00001') as j;
select is((select j::jsonb ->> 'working' from got), 'false', 'B10: bought: not working yet, the channel is still to be bought');
select is((select j::jsonb ->> 'price_paise' from got), '14900', 'B11: the line keeps the price it was bought at');
select is(pricing.balance_of(tests.tid('a')), 35100::bigint, 'B12: Rs 149 left the wallet');
select is((select charged_paise from pricing.usage where tenant_id = tests.tid('a') and kind = 'line'), 14900::bigint, 'B13: the statement has the charge');
select is(pg_temp.get('a_owner', 'a', 'total'), '2', 'B14: the line does not count before its channel is bought');
select is(pg_temp.j(pg_temp.buy('a_owner', 'a', 'key_a_00001'), 'replayed'), 'true', 'B15: the same key again is the same line');
select is((select count(*) from pricing.extra_lines where tenant_id = tests.tid('a')), 1::bigint, 'B16: not a second one');
select is(pricing.balance_of(tests.tid('a')), 35100::bigint, 'B17: and not charged twice');
select is(pg_temp.j(pg_temp.chan('a_owner', (select j::jsonb ->> 'id' from got), true), 'working'), 'true', 'B18: the channel is bought: the line works');
select is(pg_temp.get('a_owner', 'a', 'total'), '3', 'B19: three lines');
select is(pg_temp.get('a_viewer', 'a', 'total'), '3', 'B20: any member reads them');
select is(pg_temp.get('b_owner', 'a', 'total'), 'ERR:42501', 'B21: another workspace cannot');
select is(pg_temp.get('b_owner', 'b', 'total'), '2', 'B22: and its own lines are its own');
select is(pg_temp.j(pg_temp.chan('a_owner', (select j::jsonb ->> 'id' from got), false), 'replayed'), 'true', 'B23: a result that came twice changes nothing');

-- C. the channel could not be bought: the money goes back and the line is gone
create temp table got2 as select pg_temp.buy('a_owner', 'a', 'key_a_00002') as j;
select is(pricing.balance_of(tests.tid('a')), 20200::bigint, 'C1: a second line was paid');
select is(pg_temp.j(pg_temp.chan('a_owner', (select j::jsonb ->> 'id' from got2), false), 'status'), 'ended', 'C2: the purchase at the phone company failed: the line ended');
select is(pricing.balance_of(tests.tid('a')), 35100::bigint, 'C3: the Rs 149 is back in the wallet');
select is(pg_temp.get('a_owner', 'a', 'total'), '3', 'C4: still three lines');

-- D. the limit
select app.operator_set_line_cap(tests.tid('a'), 3);
select is(pg_temp.buy('a_owner', 'a', 'key_a_00003'), 'ERR:SM955', 'D1: at the limit (2 included + 1 bought = 3) no more');
select is(pg_temp.get('a_owner', 'a', 'can_add'), 'false', 'D2: the screen knows');
select app.operator_set_line_cap(tests.tid('a'), 20);
select is(pg_temp.get('a_owner', 'a', 'can_add'), 'true', 'D3: Stack19 raises it for one workspace and the Owner can add again');

-- E. cancel and keep
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.extra_line_cancel(%L, %L)::text', tests.tid('a'), (select j::jsonb ->> 'id' from got))), 'cancel_at_period_end'), 'true', 'E1: cancelled: it ends with the paid month');
select is(pg_temp.get('a_owner', 'a', 'total'), '3', 'E2: it still works until then');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.extra_line_cancel(%L, %L, false)::text', tests.tid('a'), (select j::jsonb ->> 'id' from got))), 'cancel_at_period_end'), 'false', 'E3: kept again');
select is(pg_temp.sc('a_admin', format('select public.extra_line_cancel(%L, %L)::text', tests.tid('a'), (select j::jsonb ->> 'id' from got))), 'ERR:42501', 'E4: only the Owner cancels');
select is(pg_temp.sc('a_owner', format('select public.extra_line_cancel(%L, %L)::text', tests.tid('a'), gen_random_uuid())), 'ERR:SM958', 'E5: a line that is not there');
select pg_temp.sc('a_owner', format('select public.extra_line_cancel(%L, %L)::text', tests.tid('a'), (select j::jsonb ->> 'id' from got)));
update pricing.extra_lines set paid_until = now() - interval '1 hour' where id = (select (j::jsonb ->> 'id')::uuid from got);
select is(pg_temp.renew() ->> 'ended', '1', 'E6: at the end of the month the cancelled line ends (and is not charged)');
select is(pricing.balance_of(tests.tid('a')), 35100::bigint, 'E7: no charge for the next month');
select is(pg_temp.get('a_owner', 'a', 'total'), '2', 'E8: back to the two included lines, never below');
select is(pg_temp.renew() -> 'release' -> 0 ->> 'id', (select j::jsonb ->> 'id' from got), 'E9: its channel is to be given back');
select pg_temp.sc('outsider', format('select public.extra_line_released(%L)::text', (select j::jsonb ->> 'id' from got)));
select is(pg_temp.renew() -> 'release', '[]'::jsonb, 'E10: given back once');

-- F. the monthly renewal: paid, then not enough credits (grace), then paused, then paid again
create temp table got3 as select pg_temp.buy('a_owner', 'a', 'key_a_00004') as j;
select pg_temp.chan('a_owner', (select j::jsonb ->> 'id' from got3), true);
select is(pg_temp.get('a_owner', 'a', 'total'), '3', 'F1: a new line works');
select is(pg_temp.sc('a_owner', 'select public.extra_lines_renew(50)::text'), 'ERR:42501', 'F2: a member cannot run the monthly pass');
update pricing.extra_lines set paid_until = now() - interval '1 hour' where id = (select (j::jsonb ->> 'id')::uuid from got3);
select is(pg_temp.renew() ->> 'renewed', '1', 'F3: due and paid: renewed');
select is((select count(*) from pricing.usage where tenant_id = tests.tid('a') and kind = 'line'), 4::bigint, 'F4: one charge per line per month on the statement (three first months, one renewal)');
select is(pg_temp.renew() ->> 'renewed', '0', 'F5: running the pass again charges nothing more');
select ok((select paid_until > now() + interval '27 days' from pricing.extra_lines where id = (select (j::jsonb ->> 'id')::uuid from got3)), 'F6: paid for another month');
update pricing.wallet_lots set remaining_paise = 0 where tenant_id = tests.tid('a');
update pricing.extra_lines set paid_until = now() - interval '1 hour' where id = (select (j::jsonb ->> 'id')::uuid from got3);
select is(pg_temp.renew() ->> 'grace', '1', 'F7: not enough credits: grace');
select is((select status from pricing.extra_lines where id = (select (j::jsonb ->> 'id')::uuid from got3)), 'grace', 'F8: the line is in its grace days');
select ok((select grace_until between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour' from pricing.extra_lines where id = (select (j::jsonb ->> 'id')::uuid from got3)), 'F9: three days');
select is(pg_temp.get('a_owner', 'a', 'total'), '3', 'F10: it still works in its grace days');
select is((select count(*) from app.today_line_renewal(tests.tid('a'))), 0::bigint, 'F11: a request that is not signed in sees no Needs-you item');
select is(pg_temp.sc('a_owner', format('select count(*)::text from app.today_line_renewal(%L)', tests.tid('a'))), '1', 'F12: the Owner has a Needs-you item');
select is(pg_temp.sc('a_viewer', format('select count(*)::text from app.today_line_renewal(%L)', tests.tid('a'))), '0', 'F13: a viewer has none');
select is(pg_temp.renew() ->> 'paused', '0', 'F14: no pause inside the grace days');
update pricing.extra_lines set grace_until = now() - interval '1 minute' where id = (select (j::jsonb ->> 'id')::uuid from got3);
select is(pg_temp.renew() ->> 'paused', '1', 'F15: after the grace days the line pauses');
select is(pg_temp.get('a_owner', 'a', 'total'), '2', 'F16: and no longer counts');
select is(pg_temp.sc('a_owner', format('select count(*)::text from app.today_line_renewal(%L)', tests.tid('a'))), '1', 'F17: the Needs-you item stays');
select pricing.credit(tests.tid('a'), 'topup', 'pay_xl_2', 20000);
select is(pg_temp.renew() ->> 'renewed', '1', 'F18: credits added: the next pass renews it');
select is(pg_temp.get('a_owner', 'a', 'total'), '3', 'F19: and it works again');
select is(pg_temp.sc('a_owner', format('select count(*)::text from app.today_line_renewal(%L)', tests.tid('a'))), '0', 'F20: the Needs-you item is gone');
select is(pricing.balance_of(tests.tid('a')), 5100::bigint, 'F21: Rs 149 for the month came out of the credits added');
update pricing.wallet_lots set remaining_paise = 0 where tenant_id = tests.tid('a');
update pricing.extra_lines set status = 'paused', paused_at = now() - interval '31 days', paid_until = now() - interval '40 days' where id = (select (j::jsonb ->> 'id')::uuid from got3);
select is(pg_temp.renew() ->> 'ended', '1', 'F22: paused for 30 days: the line ends');

-- G. a workspace that is not billed (Customer Zero, demos) pays nothing
update public.tenants set billing_exempt = true where id = tests.tid('b');
create temp table got4 as select pg_temp.buy('b_owner', 'b', 'key_b_00001') as j;
select is((select j::jsonb ->> 'price_paise' from got4), '0', 'G1: an exempt workspace is not charged');
select is((select count(*) from pricing.usage where tenant_id = tests.tid('b') and kind = 'line'), 0::bigint, 'G2: and has no charge on its statement');

-- H. the phone server asks for the lines; nobody else does
select is(pg_temp.sc('outsider', format('select public.phone_workspace_lines(%L)::text', tests.tid('a'))), '2', 'H1: the phone server reads a workspace''s lines');
select is(pg_temp.sc('a_owner', format('select public.phone_workspace_lines(%L)::text', tests.tid('a'))), 'ERR:42501', 'H2: a member does not');
select is(pg_temp.sc('outsider', 'select public.phone_live_by_tenant()::text'), '{}', 'H3: live calls by workspace (none now)');
select is(pg_temp.sc('a_owner', 'select public.phone_live_by_tenant()::text'), 'ERR:42501', 'H4: only the phone server');

-- I. nobody writes the table directly
select is(has_table_privilege('authenticated', 'pricing.extra_lines', 'insert') or has_table_privilege('authenticated', 'pricing.extra_lines', 'update') or has_table_privilege('authenticated', 'pricing.extra_lines', 'delete'), false, 'I1: no direct write');
select is(pg_temp.sc('a_owner', format($q$insert into pricing.extra_lines (tenant_id, price_paise, paid_until, buy_key, created_by) values (%L, 0, now(), 'key_direct_1', %L)$q$, tests.tid('a'), tests.uid('a_owner'))), 'ERR:42501', 'I2: a member cannot insert one');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'pricing.extra_lines'::regclass), 'I3: row level security is on and forced');
select ok(exists (select 1 from pg_policy where polrelid = 'pricing.extra_lines'::regclass and polcmd = 'r'), 'I4: members have a rule for reading');
select * from finish();
