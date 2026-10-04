-- Business rules enforced by the database: server-owned columns, archive, opportunity state
-- machine, uniqueness per tenant, size caps, and "what a client can and cannot write".
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.exec_as(p_uid uuid, p_sql text) returns text
language sql as $$ select tests.outcome_as(p_uid, p_sql) $$;

-- ======================================================== created_by / created_via are server-set
-- Forging either is refused outright (no column privilege) ...
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $$insert into public.companies (tenant_id, name, created_by) values (%L, 'Forge', %L)$$, tests.tid('a'), tests.uid('a_owner'))),
  '42501', 'DENY: client supplies created_by on insert');
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $$insert into public.companies (tenant_id, name, created_via) values (%L, 'Forge', 'agent')$$, tests.tid('a'))),
  '42501', 'DENY: client supplies created_via on insert');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.companies set created_by = %L where id = %L$$, tests.uid('a_owner'), tests.rid('a_company'))),
  '42501', 'DENY: client rewrites created_by');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.companies set created_via = 'agent' where id = %L$$, tests.rid('a_company'))),
  '42501', 'DENY: client rewrites created_via');
-- ... and the values the server writes are the truth.
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $$insert into public.companies (id, tenant_id, name) values (%L, %L, 'Mine')$$, tests.rid('a_mine'), tests.tid('a'))), 'rows:1', 'ALLOW: sales creates a company');
select is((select created_by from public.companies where id = tests.rid('a_mine')), tests.uid('a_sales'), 'created_by is the JWT subject');
select is((select created_via::text from public.companies where id = tests.rid('a_mine')), 'manual', 'created_via is manual');
-- A client that tries to set the session hint still gets 'manual'.
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$do $d$ begin perform set_config('app.created_via', 'agent', true);
     insert into public.companies (id, tenant_id, name) values (%L, %L, 'Sneaky'); end $d$$q$, tests.rid('a_sneaky'), tests.tid('a'))),
  'rows:0', 'client sets app.created_via then inserts (the DO block runs)');
select is((select created_via::text from public.companies where id = tests.rid('a_sneaky')), 'manual', '... and the hint is ignored for signed-in clients');
-- Trusted server code (not authenticated/anon) may declare an origin.
select set_config('app.created_via', 'import', true);
insert into public.companies (id, tenant_id, name) values (tests.rid('a_imported'), tests.tid('a'), 'Imported');
select set_config('app.created_via', '', true);
select is((select created_via::text from public.companies where id = tests.rid('a_imported')), 'import', 'trusted server code can declare created_via = import');
select is((select created_by from public.companies where id = tests.rid('a_imported')), null, '... and created_by is null without a JWT');
-- Even privileged updates cannot rewrite provenance.
update public.companies set created_via = 'agent', created_by = tests.uid('a_owner') where id = tests.rid('a_mine');
select is((select created_via::text from public.companies where id = tests.rid('a_mine')), 'manual', 'created_via is restored on update (immutable)');
select is((select created_by from public.companies where id = tests.rid('a_mine')), tests.uid('a_sales'), 'created_by is restored on update (immutable)');

-- ================================== no DELETE for clients; server-owned columns are not grantable
select ok(not has_table_privilege('authenticated', format('public.%I', t), 'DELETE'), 'authenticated has no DELETE on ' || t)
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities', 'consent_events']) t;
select ok(not has_table_privilege('authenticated', format('public.%I', t), 'TRUNCATE'), 'authenticated has no TRUNCATE on ' || t)
from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities', 'consent_events']) t;
select is(tests.outcome_as(tests.uid('a_owner'), format($$delete from public.companies where id = %L$$, tests.rid('a_mine'))),
  '42501', 'even an Owner cannot delete a company');
select is((select count(*) from public.companies where id = tests.rid('a_mine')), 1::bigint, '... it is still there');

-- Columns no client may ever write, on any CRM table.
select is(
  (select coalesce(string_agg(t || '.' || c || ':' || p, ', '), '')
     from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities']) t,
          unnest(array['created_by', 'created_via', 'created_at', 'updated_at']) c,
          unnest(array['INSERT', 'UPDATE']) p
    where has_column_privilege('authenticated', format('public.%I', t)::regclass, c, p)),
  '', 'created_by / created_via / created_at / updated_at are not writable by clients');
select is(
  (select coalesce(string_agg(t || '.tenant_id', ', '), '')
     from unnest(array['companies', 'contacts', 'products', 'leads', 'opportunities']) t
    where has_column_privilege('authenticated', format('public.%I', t)::regclass, 'tenant_id', 'UPDATE')),
  '', 'tenant_id is never updatable');
select ok(not has_column_privilege('authenticated', 'public.opportunities', 'closed_at', 'INSERT')
      and not has_column_privilege('authenticated', 'public.opportunities', 'closed_at', 'UPDATE'),
  'closed_at is server-owned');

-- ============ consent / suppression state is NOT writable by clients (functions only)
select is(
  (select coalesce(string_agg(c || ':' || p, ', '), '')
     from unnest(array['email_consent', 'whatsapp_consent', 'phone_consent', 'suppressed_at', 'suppression_reason']) c,
          unnest(array['INSERT', 'UPDATE']) p
    where has_column_privilege('authenticated', 'public.contacts'::regclass, c, p)),
  '', 'no consent / suppression column has an INSERT or UPDATE grant for authenticated');
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.contacts set email_consent = 'granted' where id = %L$$, tests.rid('a_contact'))),
  '42501', 'DENY: an Owner updates email_consent directly');
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.contacts set suppressed_at = null, suppression_reason = null where id = %L$$, tests.rid('a_contact'))),
  '42501', 'DENY: an Owner clears a suppression directly');
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $$insert into public.contacts (tenant_id, full_name, phone_consent) values (%L, 'Pre-consented', 'granted')$$, tests.tid('a'))),
  '42501', 'DENY: creating a contact that already carries consent');

-- ================================================================ archive = Admin / Owner
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.companies set archived_at = now() where id = %L$$, tests.rid('a_company'))),
  '42501', 'DENY (trigger): sales archives a company');
select is(tests.outcome_as(tests.uid('a_admin'), format($$update public.companies set archived_at = now() where id = %L$$, tests.rid('a_company'))),
  'rows:1', 'ALLOW: admin archives a company');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.companies set archived_at = null where id = %L$$, tests.rid('a_company'))),
  '42501', 'DENY (trigger): sales restores an archived company');
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.companies set archived_at = null where id = %L$$, tests.rid('a_company'))),
  'rows:1', 'ALLOW: owner restores it');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.companies set name = 'Renamed' where id = %L$$, tests.rid('a_company'))),
  'rows:1', 'ALLOW: sales edits other columns of the same row');
select is(tests.outcome_as(tests.uid('a_viewer'), format($$update public.companies set archived_at = now() where id = %L$$, tests.rid('a_company'))),
  'rows:0', 'DENY: viewer cannot update at all');
-- the same Admin+ rule on every table that can be written by sales
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.contacts set archived_at = now() where id = %L$$, tests.rid('a_contact'))), '42501', 'DENY: sales archives a contact');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.leads set archived_at = now() where id = %L$$, tests.rid('a_lead'))), '42501', 'DENY: sales archives a lead');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set archived_at = now() where id = %L$$, tests.rid('a_opp'))), '42501', 'DENY: sales archives an opportunity');
select is(tests.outcome_as(tests.uid('a_admin'), format($$update public.products set archived_at = now() where id = %L$$, tests.rid('a_product'))), 'rows:1', 'ALLOW: admin archives a product');
select is(tests.outcome_as(tests.uid('a_admin'), format($$update public.leads set archived_at = now() where id = %L$$, tests.rid('a_lead'))), 'rows:1', 'ALLOW: admin archives a lead');
-- the trigger holds even when RLS and grants would allow it: another tenant's admin cannot, and
-- an owner of B cannot touch A's rows (cross-tenant is 0 rows)
select is(tests.outcome_as(tests.uid('b_owner'), format($$update public.leads set archived_at = null where id = %L$$, tests.rid('a_lead'))), 'rows:0', 'DENY: B owner restoring A''s lead (0 rows)');

-- ====================================================== opportunities: state machine
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost' where id = %L$$, tests.rid('a_opp'))),
  '23514', 'lost without a reason is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost', lost_reason = '   ' where id = %L$$, tests.rid('a_opp'))),
  '23514', 'lost with a blank reason is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set closed_at = now() where id = %L$$, tests.rid('a_opp'))),
  '42501', 'closed_at is not writable');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set lost_reason = 'stray' where id = %L$$, tests.rid('a_opp'))),
  '23514', 'a lost_reason on an open opportunity is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost', lost_reason = 'price too high' where id = %L$$, tests.rid('a_opp'))),
  'rows:1', 'ALLOW: sales closes as lost with a reason');
select ok((select closed_at is not null from public.opportunities where id = tests.rid('a_opp')), 'closed_at was set by the server');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'won', lost_reason = null where id = %L$$, tests.rid('a_opp'))),
  'SM001', 'lost -> won is refused (terminal, SM001)');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'open', lost_reason = null where id = %L$$, tests.rid('a_opp'))),
  '42501', 'sales cannot reopen');
select is(tests.outcome_as(tests.uid('a_admin'), format($$update public.opportunities set status = 'open' where id = %L$$, tests.rid('a_opp'))),
  'rows:1', 'ALLOW: admin reopens');
select is((select closed_at from public.opportunities where id = tests.rid('a_opp')), null, '... closed_at is cleared');
select is((select lost_reason from public.opportunities where id = tests.rid('a_opp')), null, '... and the old reason is cleared');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'won' where id = %L$$, tests.rid('a_opp'))),
  'rows:1', 'ALLOW: sales closes as won');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost', lost_reason = 'changed mind' where id = %L$$, tests.rid('a_opp'))),
  'SM001', 'won -> lost is refused (terminal, SM001)');
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.opportunities set status = 'open' where id = %L$$, tests.rid('a_opp'))),
  'rows:1', 'ALLOW: owner reopens a won opportunity');
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $$insert into public.opportunities (tenant_id, company_id, title, status) values (%L, %L, 'Born won', 'won')$$, tests.tid('a'), tests.rid('a_company'))),
  '42501', 'status cannot be chosen at insert (always open)');

-- ================================================================ uniqueness per tenant
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.contacts (tenant_id, full_name, email) values (%L, 'Dup', 'A.CONTACT@example.test')$$, tests.tid('a'))),
  '23505', 'duplicate email in one tenant is refused (case-insensitive)');
select is(tests.outcome_as(tests.uid('b_sales'), format($$insert into public.contacts (tenant_id, full_name, email) values (%L, 'Same address', 'a.contact@example.test')$$, tests.tid('b'))),
  'rows:1', 'ALLOW: the same email in another tenant');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.contacts (tenant_id, full_name) values (%L, 'No email 1')$$, tests.tid('a'))), 'rows:1', 'contacts without an email do not collide (1)');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.contacts (tenant_id, full_name) values (%L, 'No email 2')$$, tests.tid('a'))), 'rows:1', 'contacts without an email do not collide (2)');
select is(tests.outcome_as(tests.uid('a_admin'), format($$insert into public.products (tenant_id, sku, name) values (%L, 'SKU-1', 'Dup')$$, tests.tid('a'))),
  '23505', 'duplicate SKU in one tenant is refused');
select is(tests.outcome_as(tests.uid('b_admin'), format($$insert into public.products (tenant_id, sku, name) values (%L, 'sku-2', 'Other')$$, tests.tid('b'))),
  'rows:1', 'ALLOW: distinct SKU');
select is(tests.outcome_as(tests.uid('a_admin'), format($$insert into public.products (tenant_id, sku, name) values (%L, 'SKU-1', 'Same sku, other tenant')$$, tests.tid('b'))),
  '42501', 'the SKU check does not leak across tenants: A cannot even try in B (42501)');
select is((select count(*) from public.products where sku = 'SKU-1' and tenant_id in (tests.tid('a'), tests.tid('b'))), 2::bigint,
  'ALLOW: the same SKU (SKU-1) exists in both fixture tenants');

-- ================================================================== caps and shape
select is(tests.outcome_as(tests.uid('a_admin'), format($$insert into public.products (tenant_id, sku, name, attributes) values (%L, 'big', 'Big', jsonb_build_object('k', repeat('x', 5000)))$$, tests.tid('a'))),
  '23514', 'products.attributes over 4 KB is refused');
select is(tests.outcome_as(tests.uid('a_admin'), format($$insert into public.products (tenant_id, sku, name, attributes) values (%L, 'arr', 'Arr', '[1,2]'::jsonb)$$, tests.tid('a'))),
  '23514', 'products.attributes must be an object');
select is(tests.outcome_as(tests.uid('a_admin'), format($$insert into public.products (tenant_id, sku, name, attributes) values (%L, 'ok-attr', 'Ok', '{"size": "XL", "color": "red"}'::jsonb)$$, tests.tid('a'))),
  'rows:1', 'ALLOW: small structured attributes');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.companies (tenant_id, name, tags) values (%L, 'Tagged', array_fill('t'::text, array[21]))$$, tests.tid('a'))),
  '23514', 'more than 20 tags is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.companies (tenant_id, name, type, tags) values (%L, 'Supplier Co', 'supplier', array['wholesale','silk'])$$, tests.tid('a'))),
  'rows:1', 'ALLOW: company type and tags');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.companies (tenant_id, name, type) values (%L, 'Bad', 'investor')$$, tests.tid('a'))),
  '22P02', 'unknown company type is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.contacts (tenant_id, full_name, email) values (%L, 'Bad Mail', 'not-an-email')$$, tests.tid('a'))),
  '23514', 'malformed email is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.companies (id, tenant_id, name) values ('not-a-uuid', %L, 'x')$$, tests.tid('a'))),
  '22P02', 'a malformed client-supplied id is refused');
-- client-supplied ids make create idempotent: the same id twice is a primary-key conflict
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.companies (id, tenant_id, name) values (%L, %L, 'Mine')$$, tests.rid('a_mine'), tests.tid('a'))),
  '23505', 'repeating a create with the same id is a unique violation (the API turns this into an idempotent retry or 409)');
select is(tests.outcome_as(tests.uid('b_sales'), format($$insert into public.companies (id, tenant_id, name) values (%L, %L, 'Collide')$$, tests.rid('a_mine'), tests.tid('b'))),
  '23505', 'an id used by ANOTHER tenant collides the same way (indistinguishable from the retry case)');

select * from finish();
rollback;
