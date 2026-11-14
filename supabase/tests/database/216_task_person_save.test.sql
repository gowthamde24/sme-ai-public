-- public.task_person_save (migration 20261231820000): "Call Yashwanth Reddy" when he is not in the contacts: the number the Owner gives saves him as a contact and a lead; a known number is merged.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

select is(pg_temp.val('a_owner', format($q$select public.task_person_save(%L, 'Yashwanth Reddy', '98765 43210')::text$q$, tests.tid('a'))), 'ERR:SM401', 'A0: a workspace whose real-data gate is closed takes no real number (the assistant says so plainly)');
select tests.open_gate('a');
select is((pg_temp.val('a_owner', format($q$select public.task_person_save(%L, 'Yashwanth Reddy', '98765 43210')::text$q$, tests.tid('a')))::jsonb ->> 'created'), 'true', 'A1: the Owner saves a new person');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name = 'Yashwanth Reddy' and phone = '+919876543210' and phone_consent = 'unknown'), 1, 'A2: a contact with the +91 number and consent still unknown');
select is((select count(*)::int from public.leads l join public.contacts c on c.id = l.contact_id where l.tenant_id = tests.tid('a') and c.full_name = 'Yashwanth Reddy'), 1, 'A3: and its lead (a person who can be called is a lead)');
select is((pg_temp.val('a_sales', format($q$select public.task_person_save(%L, 'Yash', '+91 98765-43210')::text$q$, tests.tid('a')))::jsonb ->> 'created'), 'false', 'A4: the same number again, spelled differently, is the same person (merged, not doubled)');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and app.phone_norm(phone) = '9876543210'), 1, 'A5: one contact for that number');
select is(pg_temp.val('a_viewer', format($q$select public.task_person_save(%L, 'Ravi', '9876500001')::text$q$, tests.tid('a'))), 'ERR:42501', 'A6: a Viewer cannot');
select is(pg_temp.val('b_owner', format($q$select public.task_person_save(%L, 'Ravi', '9876500001')::text$q$, tests.tid('a'))), 'ERR:42501', 'A7: nor another workspace');
select is(pg_temp.val('a_owner', format($q$select public.task_person_save(%L, 'Ravi', '12')::text$q$, tests.tid('a'))), 'ERR:22023', 'A8: a number that is not a number');
select is(pg_temp.val('a_owner', format($q$select public.task_person_save(%L, 'R', '9876500001')::text$q$, tests.tid('a'))), 'ERR:22023', 'A9: a name that is not a name');
select is(pg_temp.val('anon', format($q$select public.task_person_save(%L, 'Ravi', '9876500001')::text$q$, tests.tid('a'))), 'ERR:42501', 'A10: nor anyone not signed in');
select * from finish();
rollback;
