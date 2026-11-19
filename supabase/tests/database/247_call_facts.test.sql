-- The facts a call needs (migration 20261231985000): consent, STOP, archive, proof of request, prospect, counts: the same for the sandbox and the live path.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.facts(p_who text default 'a_owner') returns jsonb language plpgsql as $$
begin return pg_temp.val(p_who, format($q$select public.call_facts(%L, %L, '+91 98765 43210')::text$q$, tests.tid('a'), tests.rid('a_lead')))::jsonb; end $$;

update public.contacts set phone = '+91 98765 43210', phone_consent = 'unknown' where id = tests.rid('a_contact');
-- A. consent and the number
select is(pg_temp.facts() ->> 'can_contact', 'false', 'A1 no phone consent: cannot be contacted');
update public.contacts set phone_consent = 'granted' where id = tests.rid('a_contact');
select is(pg_temp.facts() ->> 'can_contact', 'true', 'A2 with consent and the contact''s own number: can be contacted');
select is(pg_temp.val('a_owner', format($q$select (public.call_facts(%L, %L, '+91 90000 11111')) ->> 'can_contact'$q$, tests.tid('a'), tests.rid('a_lead'))), 'false', 'A3 the same contact but ANOTHER number: no');
-- B. no proof of request yet
select is(pg_temp.facts() ->> 'proof', 'false', 'B1 no request of their own: no proof');
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'website_form', 'first', now());
select is(pg_temp.facts() ->> 'proof', 'true', 'B2 a form of their own within 30 days: proof') ;
select is(pg_temp.facts() ->> 'proof_source', 'website_form', 'B3 and its source');
-- C. STOP and archive
update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out' where id = tests.rid('a_contact');
select is(pg_temp.facts() ->> 'suppressed', 'true', 'C1 STOP: suppressed') ;
select is(pg_temp.facts() ->> 'can_contact', 'false', 'C2 and cannot be contacted');
update public.contacts set suppressed_at = null, suppression_reason = null where id = tests.rid('a_contact');
update public.leads set archived_at = now() where id = tests.rid('a_lead');
select is(pg_temp.facts() ->> 'erased_or_archived', 'true', 'C3 an archived lead: erased_or_archived');
update public.leads set archived_at = null where id = tests.rid('a_lead');
-- D. counts
select is((pg_temp.facts() ->> 'weekly_limit')::int, 1, 'D1 the weekly limit defaults to 1');
select is((pg_temp.facts() ->> 'weekly_calls')::int, 0, 'D2 no call yet this week');
insert into public.phone_calls (tenant_id, direction, state, contact_id, lead_id, provider, ended_at, duration_s, purpose) values (tests.tid('a'), 'outbound', 'completed', tests.rid('a_contact'), tests.rid('a_lead'), 'sandbox', now(), 90, 'sales_followup');
select is((pg_temp.facts() ->> 'weekly_calls')::int, 1, 'D3 one real call this week counts') ;
select is((pg_temp.facts() ->> 'calls_today')::int, 1, 'D4 and today''s count');
select is((pg_temp.facts() ->> 'minutes_today')::numeric, 1.5, 'D5 and the minutes (90 s)');
insert into public.phone_calls (tenant_id, direction, state, contact_id, provider, refuse_reason, ended_at) values (tests.tid('a'), 'outbound', 'refused', tests.rid('a_contact'), 'sandbox', 'no_consent', now());
select is((pg_temp.facts() ->> 'weekly_calls')::int, 1, 'D6 a refused row is not a call');
-- E. who may ask
select is(pg_temp.val('a_viewer', format($q$select public.call_facts(%L, %L, '+91 98765 43210')::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'E1 a Viewer may not');
select is(pg_temp.val('b_owner', format($q$select public.call_facts(%L, %L, '+91 98765 43210')::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'E2 another workspace may not');
select is(pg_temp.val('anon', format($q$select public.call_facts(%L, %L, '+91 98765 43210')::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'E3 nor anyone signed out');
select * from finish();
rollback;
