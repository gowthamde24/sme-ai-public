-- 261: a STOP that came from the customer can never be lifted by anyone (owner, 21 Nov 2026; the second door of the do-not-call list).
-- public.lift_suppression (the CRM's old door) refuses with SM985 when the contact's latest suppression is `opted_out` with a WhatsApp or call reference;
-- an owner-added (manual) or owner-said suppression is still the Owner's to lift. Customer opt-back-in (app.dnc_opt_in) is the only way a customer's stop comes off.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values
  (tests.rid('s1'), tests.tid('a'), tests.rid('a_company'), 'Stop one', 's1@example.test', '+00 90000 00101'),
  (tests.rid('s2'), tests.tid('a'), tests.rid('a_company'), 'Stop two', 's2@example.test', '+00 90000 00102'),
  (tests.rid('s3'), tests.tid('a'), tests.rid('a_company'), 'Stop three', 's3@example.test', '+00 90000 00103'),
  (tests.rid('s4'), tests.tid('a'), tests.rid('a_company'), 'Stop four', 's4@example.test', '+00 90000 00104');

create function pg_temp.sup(p_contact text, p_reason text, p_ref text) returns text
language sql as $$
  select tests.outcome_as(tests.uid('a_sales'), format($q$select public.suppress_contact(%L, %L, %L, 'verbal', %L)$q$, tests.tid('a'), tests.rid(p_contact), p_reason, p_ref))
$$;
create function pg_temp.lift(p_contact text) returns text
language sql as $$
  select tests.outcome_as(tests.uid('a_owner'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:261')$q$, tests.tid('a'), tests.rid(p_contact)))
$$;
create function pg_temp.is_suppressed(p_contact text) returns boolean
language sql as $$ select suppressed_at is not null from public.contacts where id = tests.rid(p_contact) $$;

-- A. a stop the customer sent on WhatsApp
select is(pg_temp.sup('s1', 'opted_out', 'whatsapp:wamid.261'), 'rows:1', 'A1 the customer wrote STOP on WhatsApp (recorded)');
select is(pg_temp.lift('s1'), 'SM985', 'A2 the Owner (with the second factor) cannot lift it: stopped by the customer');
select is(pg_temp.is_suppressed('s1'), true, 'A3 ... the contact is still suppressed');
select is((select count(*)::int from public.consent_events where contact_id = tests.rid('s1') and event_type = 'suppression_lifted'), 0, 'A4 ... and no lift was recorded');

-- B. a stop the customer asked for on a call
select is(pg_temp.sup('s2', 'opted_out', 'call:261'), 'rows:1', 'B1 the customer asked on a call (recorded)');
select is(pg_temp.lift('s2'), 'SM985', 'B2 the Owner cannot lift it');
select is(pg_temp.sup('s3', 'opted_out', 'call-list:261'), 'rows:1', 'B3 the customer asked on a call-list call');
select is(pg_temp.lift('s3'), 'SM985', 'B4 the Owner cannot lift it');

-- C. what the Owner made himself stays his to lift
select is(pg_temp.sup('s4', 'manual', 'owner:added'), 'rows:1', 'C1 the owner added the number (manual)');
select is(pg_temp.lift('s4'), 'rows:1', 'C2 the Owner lifts it, with evidence');
select is(pg_temp.is_suppressed('s4'), false, 'C3 ... and it is off');
select is(pg_temp.sup('s4', 'opted_out', 'owner:said-in-chat'), 'rows:1', 'C4 the owner said "stop messaging" in the chat (not the customer)');
select is(pg_temp.lift('s4'), 'rows:1', 'C5 the Owner can undo that too');

-- D. the customer opting back in is the only way their stop comes off
select is((select app.dnc_opt_in(tests.tid('a'), tests.rid('s1'), 'customer_message', tests.uid('a_owner')) is not null), true, 'D1 the customer writes that they want contact again: the stop comes off');
select is(pg_temp.is_suppressed('s1'), false, 'D2 ... the contact is no longer suppressed');

-- E. the guard changes nothing about who may call it
select is(tests.outcome_as(tests.uid('a_admin'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('s2'))), '42501', 'E1 an Admin is still denied (the Owner only)');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('s2'))), '42501', 'E2 the other business''s owner is still denied');

select * from finish();
rollback;
