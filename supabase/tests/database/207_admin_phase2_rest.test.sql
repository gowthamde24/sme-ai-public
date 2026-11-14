-- Admin console, the rest of phase 2: canned replies, notes on a business, plan changes, Money (owner and finance), search by GSTIN, held_by_support, the staff role on a ticket message.
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

-- the world: A pays Sales Assistant monthly, has a top-up invoice and a subscription invoice; B is on pay as you go yearly and is past due
insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, period_start, period_end) values (tests.tid('a'), 'sales_assistant', 'monthly', 'active', 'fake', now() - interval '3 days', now() + interval '27 days');
insert into pricing.subscriptions (tenant_id, plan_id, interval, status, provider, period_start, period_end) values (tests.tid('b'), 'payg', 'yearly', 'past_due', 'fake', now() - interval '3 days', now() + interval '27 days');
select pricing.invoice(tests.tid('a'), 'topup', 'pay_p2_1', 100000);
select pricing.invoice(tests.tid('a'), 'subscription', 'pay_p2_2', 199900);
insert into pricing.events (tenant_id, event_id, kind) values (tests.tid('b'), 'evt_fail_1', 'charge_failed'), (tests.tid('b'), 'evt_halt_1', 'halted');
insert into public.business_profile (tenant_id, gstin) values (tests.tid('a'), '27AAPFU0939F1ZV') on conflict (tenant_id) do update set gstin = excluded.gstin;

-- A. who may
select is(pg_temp.st('a_owner', 'aal2', 'sess-shop-0001', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), 'ERR:SM941', 'A1: a shop owner is not staff');
select is(pg_temp.sup('s_support', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), 'ERR:42501', 'A2: support does not see the money');
select is(pg_temp.sup('s_support', $q$select public.admin_money_invoices(current_date - 30, current_date)::text$q$), 'ERR:42501', 'A3: nor the invoices');
select is(pg_temp.sup('s_support', $q$select public.admin_money_export(current_date - 30, current_date)::text$q$), 'ERR:42501', 'A4: nor the export');
select is(pg_temp.sup('s_support', $q$select public.admin_money_failed()::text$q$), 'ERR:42501', 'A5: nor the failed payments');
select is(pg_temp.sup('s_finance', $q$select public.admin_canned_list()::text$q$), 'ERR:42501', 'A6: finance has no canned replies');
select is(pg_temp.sup('s_finance', $q$select public.admin_note_add(%L, 'hello')::text$q$, tests.tid('a')::text), 'ERR:42501', 'A7: finance writes no notes on a business');
select is(pg_temp.sup('s_finance', $q$select public.admin_notes_list(%L)::text$q$, tests.tid('a')::text), 'ERR:42501', 'A8: and reads none');
select is(pg_temp.st('s_owner', 'aal1', 'sess-s_owner-0001', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), 'ERR:SM942', 'A9: the second factor is always needed');

-- B. the money
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), array['mrr_paise']), (199900 + (499000 + 6) / 12)::text, 'B1: MRR = A monthly + B yearly / 12');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), array['topups', 'count']), '1', 'B2: one top-up in the period');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), array['topups', 'subtotal_paise']), '100000', 'B3: with its amount');
select is(pg_temp.j(pg_temp.sup('s_owner', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), array['subscription_invoices', 'count']), '1', 'B4: and one subscription invoice (the owner reads it too)');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), array['failed_payments', 'charges_failed']), '1', 'B5: one failed charge');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 30, current_date)::text$q$), array['failed_payments', 'past_due_now']), '1', 'B6: one subscription past due now');
select is((select (x ->> 'count')::int from jsonb_array_elements(pg_temp.sup('s_finance', $q$select (public.admin_money_summary(current_date - 30, current_date) -> 'active_by_plan')::text$q$)::jsonb) x where x ->> 'plan_id' = 'sales_assistant'), 1, 'B7: active subscriptions per plan');
select is(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date, current_date - 1)::text$q$), 'ERR:22023', 'B8: a period must run forwards');
select is(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 400, current_date)::text$q$), 'ERR:22023', 'B9: at most a year');

-- C. plan changes are recorded from now on
select is((select count(*) from admin.plan_changes where tenant_id = tests.tid('a') and kind = 'new'), 1::bigint, 'C1: a new subscription is recorded');
update pricing.subscriptions set plan_id = 'sales_lead_finder' where tenant_id = tests.tid('a');
update pricing.subscriptions set plan_id = 'payg' where tenant_id = tests.tid('a');
update pricing.subscriptions set status = 'cancelled' where tenant_id = tests.tid('a');
select is((select string_agg(kind, ',' order by id) from admin.plan_changes where tenant_id = tests.tid('a')), 'new,upgrade,downgrade,cancelled', 'C2: an upgrade, a downgrade and a cancellation are told apart');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 1, current_date)::text$q$), array['movement', 'upgrades']), '1', 'C3: and counted');
select isnt(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_summary(current_date - 1, current_date)::text$q$), array['movement', 'recorded_since']), null, 'C4: with the date from which they were recorded (no back-fill)');
update pricing.subscriptions set status = 'active', plan_id = 'sales_assistant' where tenant_id = tests.tid('a');

-- D. invoices and the CA export
select is(jsonb_array_length(pg_temp.sup('s_finance', $q$select (public.admin_money_invoices(current_date - 30, current_date) -> 'items')::text$q$)::jsonb), 2, 'D1: the two invoices are listed');
select ok((select (pg_temp.sup('s_finance', $q$select (public.admin_money_invoices(current_date - 30, current_date) -> 'items' -> 0 ->> 'issued_at')::text$q$))::timestamptz >= (pg_temp.sup('s_finance', $q$select (public.admin_money_invoices(current_date - 30, current_date) -> 'items' -> 1 ->> 'issued_at')::text$q$))::timestamptz), 'D2: newest first (the two invoices of one transaction share a time: only the order of the times is checked)');
select isnt(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_invoices(current_date - 30, current_date, 1)::text$q$), array['next', 'after_id']), null, 'D3: with a next page marker');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_export(current_date - 30, current_date)::text$q$), array['items', '0', 'shop_gstin']), '27AAPFU0939F1ZV', 'D4: the export carries the shop''s GSTIN for the CA');
select is(pg_temp.j(pg_temp.sup('s_finance', $q$select public.admin_money_export(current_date - 30, current_date)::text$q$), array['test_mode']), 'true', 'D5: and says it is test mode');
select is(pg_temp.j(pg_temp.sup('s_owner', $q$select public.admin_money_failed()::text$q$), array['items', '0', 'status']), 'past_due', 'D6: the failed payments list the past-due subscription');
select cmp_ok((select count(*)::int from admin.audit where target_kind = 'invoice'), '>=', 6, 'D7: every look at the money is in the audit trail');

-- E. canned replies and notes
select is(pg_temp.j(pg_temp.sup('s_support', $q$select public.admin_canned_save(%L, 'We are looking', 'We are looking at it and will write back today.')::text$q$, tests.rid('cn1')::text), array['title']), 'We are looking', 'E1: support saves a canned reply');
select is(pg_temp.sup('s_support', $q$select public.admin_canned_save(%L, 'x', 'y')::text$q$, tests.rid('cn2')::text), 'ERR:22023', 'E2: a title of 3 or more characters');
select is(jsonb_array_length(pg_temp.sup('s_owner', $q$select (public.admin_canned_list() -> 'items')::text$q$)::jsonb), 1, 'E3: the owner sees it');
select is(pg_temp.j(pg_temp.sup('s_support', $q$select public.admin_canned_save(%L, 'We are looking', 'We are looking at it.', true)::text$q$, tests.rid('cn1')::text), array['archived']), 'true', 'E4: archived, never deleted');
select is(jsonb_array_length(pg_temp.sup('s_owner', $q$select (public.admin_canned_list() -> 'items')::text$q$)::jsonb), 0, 'E5: an archived one is not listed');
select is(jsonb_array_length(pg_temp.sup('s_owner', $q$select (public.admin_canned_list(true) -> 'items')::text$q$)::jsonb), 1, 'E6: unless asked');
select is(pg_temp.j(pg_temp.sup('s_support', $q$select public.admin_note_add(%L, 'Owner prefers calls after 5 pm')::text$q$, tests.tid('a')::text), array['staff', 'role']), 'support', 'E7: a note names who wrote it');
select is(pg_temp.sup('s_support', $q$select public.admin_note_add(%L, '  ')::text$q$, tests.tid('a')::text), 'ERR:22023', 'E8: an empty note is refused');
select is(pg_temp.sup('s_support', $q$select public.admin_note_add(%L, 'x')::text$q$, gen_random_uuid()::text), 'ERR:23503', 'E9: the business must exist');
select is(jsonb_array_length(pg_temp.sup('s_owner', $q$select (public.admin_notes_list(%L) -> 'items')::text$q$, tests.tid('a')::text)::jsonb), 1, 'E10: the notes are listed');
select throws_ok($q$update admin.business_notes set body = 'changed'$q$, '42501', null, 'E11: a note cannot be edited');
select throws_ok($q$delete from admin.business_notes$q$, '42501', null, 'E12: or deleted');
select is((select count(*) from admin.audit where target_kind = 'business' and action = 'note' and customer_visible), 0::bigint, 'E13: notes are never shown to the shop');

-- F. search by GSTIN, held_by_support, the role on a ticket message
select is(jsonb_array_length(pg_temp.sup('s_finance', $q$select (public.admin_search('27AAPFU0939F1ZV') -> 'businesses')::text$q$)::jsonb), 1, 'F1: a business is found by its GSTIN');
select is(jsonb_array_length(pg_temp.sup('s_support', $q$select (public.admin_search('0939F1') -> 'businesses')::text$q$)::jsonb), 1, 'F2: or by part of it');
select is(pg_temp.j(pg_temp.sup('s_support', $q$select (public.admin_search('27AAPFU0939F1ZV') -> 'businesses' -> 0)::text$q$), array['held_by_support']), 'false', 'F3: held_by_support is on a business row (not held)');
select pg_temp.sup('s_support', $q$select public.admin_assistant_pause(%L, 'incident')::text$q$, tests.tid('a')::text);
select is(pg_temp.j(pg_temp.sup('s_support', $q$select (public.admin_search('27AAPFU0939F1ZV') -> 'businesses' -> 0)::text$q$), array['held_by_support']), 'true', 'F4: and true after support paused it');
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to public;
insert into t_ids select 'tk', (pg_temp.sup('s_support', $q$select public.admin_ticket_create(%L, 'Calls not reaching', 'phone', 'normal')::jsonb ->> 'id'$q$, tests.tid('a')::text))::uuid;
select is(pg_temp.j(pg_temp.sup('s_support', $q$select public.admin_ticket_reply(%L, 'On it')::text$q$, (select v::text from t_ids where k = 'tk')), array['messages', '0', 'staff', 'role']), 'support', 'F5: a ticket message carries the staff role');

select * from finish();
rollback;
