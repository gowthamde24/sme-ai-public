-- Proof of request, source 7: a purchase in the last 30 days (migration 20261231984600; owner, 19 Nov 2026). The call is about the purchase; phone consent is checked separately for every call.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();
select tests.open_gate('a');

-- A. no purchase yet (the fixture order is only an approved quote): no proof
select is(app.call_back_proof(tests.tid('a'), tests.rid('a_contact'), 30), null, 'A1 an approved quote is not a purchase: no proof');
-- B. a purchase: advance paid
alter table public.orders disable trigger user;
update public.orders set state = 'advance_paid', updated_at = now() - interval '3 days' where id = tests.rid('a_order');
alter table public.orders enable trigger user;
select is(app.call_back_proof(tests.tid('a'), tests.rid('a_contact'), 30) ->> 'source', 'purchase', 'B1 an order that has money in is a purchase');
select is(app.call_back_proof(tests.tid('a'), tests.rid('a_contact'), 30) ->> 'ref', tests.rid('a_order')::text, 'B2 the order id is the proof');
select is(app.call_back_proof(tests.tid('a'), tests.rid('a_contact'), 30) ->> 'lead_id', tests.rid('a_lead')::text, 'B3 and the lead it belongs to');
select is(app.call_back_proof(tests.tid('b'), tests.rid('a_contact'), 30), null, 'B4 another workspace sees nothing of it');
-- C. consent is checked separately: without it the contact cannot be called, with it they can
update public.contacts set phone = '+91 98765 43210', phone_consent = 'unknown' where id = tests.rid('a_contact');
select is(app.can_contact(tests.rid('a_contact'), 'phone'), false, 'C1 a purchase without phone consent: the call is refused (no_consent)');
update public.contacts set phone_consent = 'granted' where id = tests.rid('a_contact');
select is(app.can_contact(tests.rid('a_contact'), 'phone'), true, 'C2 with phone consent (a tick or a recorded yes) it is allowed');
-- D. too old
alter table public.orders disable trigger user;
update public.orders set updated_at = now() - interval '31 days' where id = tests.rid('a_order');
alter table public.orders enable trigger user;
select is(app.call_back_proof(tests.tid('a'), tests.rid('a_contact'), 30), null, 'D1 a purchase older than 30 days is no proof (no_proof_of_request)');
-- E. the call row keeps the order id
alter table public.orders disable trigger user;
update public.orders set updated_at = now() - interval '2 days' where id = tests.rid('a_order');
alter table public.orders enable trigger user;
select app.operator_register_scheduler('Outsider@test.local');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'phone_calls' and column_name = 'request_ref'), 1, 'E1 the call row has a place for the purchase id');
select * from finish();
rollback;
