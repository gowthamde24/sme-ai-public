-- Job BO (migration 20261115090000): phone-first contacts.
--   A app.phone_norm: the comparison form          B a shared number is allowed and indexed for lookup
--   C public.find_contact_by_phone                 D public.import_lead_rows: phone-only contacts, found by the normalised phone, gate closed and open
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.imp(p_user text, p_tenant text, p_rows jsonb, p_batch text default null) returns jsonb language sql as $$
  select pg_temp.sc(p_user, format('select public.import_lead_rows(%L, %L, %L::jsonb, null, false)', tests.tid(p_tenant), coalesce(p_batch, gen_random_uuid()::text), p_rows))::jsonb $$;
create function pg_temp.row1(p jsonb) returns jsonb language sql as $$ select (p -> 'rows' -> 0) $$;

-- ---------------------------------------------------------------------------------------------
-- A. the comparison form (the same table is checked against the Python rule in tests/integration/test_bo_phone_contacts.py)
-- ---------------------------------------------------------------------------------------------
select is(app.phone_norm('+91 98765 43210'), '9876543210', 'A: +91 and spaces');
select is(app.phone_norm('098765-43210'), '9876543210', 'A: a leading 0 and a hyphen');
select is(app.phone_norm('91-9876543210'), '9876543210', 'A: 91 and ten digits');
select is(app.phone_norm('0091 98765 43210'), '9876543210', 'A: 0091');
select is(app.phone_norm('(98765) 43210'), '9876543210', 'A: brackets');
select is(app.phone_norm('９８７６５４３２１０'), '9876543210', 'A: full-width digits');
select is(app.phone_norm('९८७६५ ४३२१०'), '9876543210', 'A: Devanagari digits');
select is(app.phone_norm('౯౮౭౬౫ ౪౩౨౧౦'), '9876543210', 'A: Telugu digits');
select is(app.phone_norm('೯೮೭೬೫೪೩೨೧೦'), '9876543210', 'A: Kannada digits');
select is(app.phone_norm('௯௮௭௬௫௪௩௨௧௦'), '9876543210', 'A: Tamil digits');
select is(app.phone_norm('+00 90000 10001'), '9000010001', 'A: the reserved synthetic numbers compare as ten digits too');
select is(app.phone_norm('+44 7911 123456'), '447911123456', 'A: another country keeps all its digits');
select is(app.phone_norm('040-23456789'), '4023456789', 'A: a landline with an STD code');
select is(app.phone_norm('12'), null, 'A: too short');
select is(app.phone_norm('abc'), null, 'A: no digits');
select is(app.phone_norm(repeat('9', 33)), null, 'A: too long');
select is(app.phone_norm(null), null, 'A: null');
select is((select provolatile::text from pg_proc where proname = 'phone_norm' and pronamespace = 'app'::regnamespace), 'i', 'A: it is immutable (an index uses it)');

-- ---------------------------------------------------------------------------------------------
-- B. a number may be SHARED (two people of one family; the suppression keys are built for it): it is found, not forbidden
-- ---------------------------------------------------------------------------------------------
insert into public.contacts (id, tenant_id, company_id, full_name, phone, created_at) values (tests.rid('a_p1'), tests.tid('a'), tests.rid('a_company'), 'Phone One', '+00 90000 11111', now() - interval '1 day');
select is(pg_temp.priv(format($q$insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (%L, %L, %L, 'Phone Twin', '+00 9000011111')$q$, tests.rid('a_p2'), tests.tid('a'), tests.rid('a_company'))), 'ok',
          'B: a second contact with the same number written another way is allowed (a shared family phone)');
select is((select count(*) from pg_indexes where indexname = 'contacts_tenant_phone_norm_idx' and indexdef not like '%UNIQUE%'), 1::bigint, 'B: the lookup index exists and is not unique');
select is(pg_temp.priv(format($q$insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (%L, %L, %L, 'Same number, other business', '+00 90000 11111')$q$, tests.rid('b_p1'), tests.tid('b'), tests.rid('b_company'))), 'ok',
          'B: another business may hold the same number');
select is(pg_temp.priv(format($q$insert into public.contacts (id, tenant_id, company_id, full_name) values (%L, %L, %L, 'No phone at all')$q$, tests.rid('a_p3'), tests.tid('a'), tests.rid('a_company'))), 'ok', 'B: a contact with no phone is fine');
select is(pg_temp.priv(format($q$insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (%L, %L, %L, 'Short', '+00 1')$q$, tests.rid('a_p4'), tests.tid('a'), tests.rid('a_company'))), 'ok', 'B: a number too short to compare is kept as typed');

-- ---------------------------------------------------------------------------------------------
-- C. who holds this number? (every holder, the first at the top)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.fbp(p_user text, p_tenant text, p_phone text) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.find_contact_by_phone(%L, %L)', tests.tid(p_tenant), p_phone)) $$;
select is(pg_temp.fbp('a_sales', 'a', '90000 11111')::jsonb ->> 'contact_id', tests.rid('a_p1')::text, 'C: Sales finds the oldest holder by any spelling, at the top');
select is(jsonb_array_length(pg_temp.fbp('a_sales', 'a', '90000 11111')::jsonb -> 'holders'), 2, 'C: and both holders of the shared number are listed');
select is(pg_temp.fbp('a_owner', 'a', '+00 9000011111')::jsonb ->> 'company_name', 'Company a', 'C: with its company');
select is(pg_temp.fbp('a_admin', 'a', '0090000 11111')::jsonb ->> 'found', 'true', 'C: Admin may');
select is(pg_temp.fbp('a_owner', 'a', '90000 99999')::jsonb ->> 'found', 'false', 'C: a number nobody holds');
select is(jsonb_array_length(pg_temp.fbp('b_owner', 'b', '90000 11111')::jsonb -> 'holders'), 1, 'C: business b sees only its own holder');
select is(pg_temp.fbp('a_viewer', 'a', '90000 11111'), 'ERR:42501', 'C: a Viewer may not');
select is(pg_temp.fbp('b_owner', 'a', '90000 11111'), 'ERR:42501', 'C: another business may not');
select is(pg_temp.fbp('anon', 'a', '90000 11111'), 'ERR:42501', 'C: anon may not');
select is(pg_temp.fbp('a_owner', 'a', 'abc'), 'ERR:22023', 'C: not a number');
select is(pg_temp.fbp('b_owner', 'b', '90000 11111')::jsonb ->> 'contact_id', tests.rid('b_p1')::text, 'C: business b finds its own holder of the same number, never a');

-- ---------------------------------------------------------------------------------------------
-- D. the lead import
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Phone Shop One", "contact_name": "Ravi", "contact_phone": "+00 90000 70001", "city": "Hyderabad"}]'))->> 'outcome', 'created',
          'D: a phone-only contact is created (gate closed: the reserved +00 number)');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and phone = '+00 90000 70001' and email is null), 1::bigint, 'D: it has a phone and no e-mail');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Phone Shop One", "contact_name": "Ravi again", "contact_phone": "+0090000 70001"}]'))->> 'reason', 'existing_open_lead',
          'D: the same company and the same number written another way: a duplicate lead, found by the normalised phone');
select is((select count(*) from public.contacts where tenant_id = tests.tid('a') and full_name like 'Ravi%'), 1::bigint, 'D: and no second contact was made');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Another Shop", "contact_name": "Somebody", "contact_phone": "+00 9000070001"}]'))->> 'reason', 'contact_belongs_to_other_company',
          'D: the number of a contact of another company is refused by the import, not shared');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Real Phone Shop", "contact_name": "Real", "contact_phone": "+91 98765 22222"}]'))->> 'reason', 'contact_phone_not_reserved',
          'D: gate closed: a real number is refused with its code (it needs no e-mail to be refused)');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Nameless", "contact_phone": "+00 90000 70002"}]'))->> 'reason', 'contact_name_missing', 'D: a contact needs a name');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Role Only", "contact_name": "Boss", "contact_job_title": "Owner"}]'))->> 'reason', 'contact_requires_email', 'D: a contact with neither phone nor e-mail is refused');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Bad Phone", "contact_name": "X", "contact_phone": "12"}]'))->> 'reason', 'invalid_row', 'D: a phone that cannot be compared is an invalid row');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Mail Shop", "contact_name": "Mala", "contact_email": "mala@example.test", "contact_phone": "+00 90000 70003"}]'))->> 'outcome', 'created', 'D: e-mail and phone together still work');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Mail Shop Lead Two", "contact_name": "Mala", "contact_email": "MALA@example.test"}]'))->> 'reason', 'contact_belongs_to_other_company', 'D: e-mail matching is unchanged (case-insensitive)');
select is(pg_temp.sc('a_viewer', format($q$select public.import_lead_rows(%L, gen_random_uuid(), '[{"company_name": "X"}]'::jsonb, null, false)$q$, tests.tid('a'))), 'ERR:42501', 'D: a Viewer cannot import');
select tests.open_gate('a');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Real Phone Shop", "contact_name": "Real", "contact_phone": "98765 22222"}]'))->> 'outcome', 'created', 'D: gate OPEN: a real phone-only contact is accepted');
select is((select phone from public.contacts where tenant_id = tests.tid('a') and full_name = 'Real'), '98765 22222', 'D: stored as given (the API makes it +919876522222 before it gets here)');
select is(pg_temp.row1(pg_temp.imp('a_sales', 'a', '[{"company_name": "Real Phone Shop", "contact_name": "Real", "contact_phone": "+91-98765-22222"}]'))->> 'reason', 'existing_open_lead', 'D: and the same number again is found');
select is(pg_temp.row1(pg_temp.imp('b_sales', 'b', '[{"company_name": "B Shop", "contact_name": "B", "contact_phone": "+00 90000 70001"}]'))->> 'outcome', 'created', 'D: another business may import the same number');
select is(pg_temp.imp('a_sales', 'a', '[{"company_name": "Dry", "contact_name": "D", "contact_phone": "98765 33333"}]', '99999999-9999-4999-8999-999999999999') ->> 'replayed', 'false', 'D: (a normal batch)');

select * from finish();
rollback;
