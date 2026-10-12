-- Job CA (ADR 0081, migration 20261121090000): GSTIN.
--   A the validator (format, state code, check character)   B a customer's GSTIN on companies   C the shop's own GSTIN (business_profile)   D erasure and the audit log   E the accounting export
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select tests.er_plant('a');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.out(p_user text, p_sql text) returns text language sql as $$ select tests.outcome_as(tests.uid(p_user), p_sql) $$;

-- ================================================================================ A. the validator
select is(app.gstin_is_valid('27AAPFU0939F1ZV'), true, 'a published example (Maharashtra) is valid');
select is(app.gstin_is_valid('29AAGCB7383J1Z4'), true, 'a second published example (Karnataka)');
select is(app.gstin_is_valid('24AAACC1206D1ZM'), true, 'a third (Gujarat)');
select is(app.gstin_is_valid('27AAPFU0939F1ZW'), false, 'a wrong check character is refused');
select is(app.gstin_is_valid('27AAPFU0939F1Z0'), false, '...whatever it is');
select is(app.gstin_is_valid('27AAPFU0939G1ZV'), false, 'a changed entity letter changes the check character: refused');
select is(app.gstin_is_valid('28AAPFU0939F1ZV'), false, 'another state code with the same rest: refused');
select is(app.gstin_is_valid('00AAPFU0939F1ZV'), false, 'state code 00 does not exist');
select is(app.gstin_is_valid('39AAPFU0939F1ZV'), false, 'state code 39 does not exist');
select is(app.gstin_is_valid('27aapfu0939f1zv'), false, 'lower case is not a GSTIN (the API makes it upper case first)');
select is(app.gstin_is_valid(' 27AAPFU0939F1ZV'), false, 'nor with a space');
select is(app.gstin_is_valid('27AAPFU0939F1ZV1'), false, 'sixteen characters');
select is(app.gstin_is_valid('27AAPFU0939F1Z'), false, 'fourteen characters');
select is(app.gstin_is_valid('27AAPFU0939F1AV'), false, 'the fourteenth character must be Z');
select is(app.gstin_is_valid('27AAPFU09391FZV'), false, 'PAN shape: a digit where the letter belongs');
select is(app.gstin_is_valid('27AAPFU0939F0ZV'), false, 'the entity number is 1 to 9 or a letter, never 0');
select is(app.gstin_is_valid(null), false, 'null is not a GSTIN (a column that may be empty allows null itself)');
select is(app.gstin_is_valid(''), false, 'nor the empty text');
select is((select count(*) from generate_series(1, 500) i where app.gstin_is_valid(upper(substr(md5(i::text), 1, 15)))), 0::bigint, 'five hundred random 15-character strings are all refused');
select is((select provolatile from pg_proc where oid = 'app.gstin_is_valid(text)'::regprocedure), 'i', 'the validator is immutable (a CHECK may call it)');
select is(has_function_privilege('anon', 'app.gstin_is_valid(text)', 'execute'), false, 'anon cannot run it');

-- ================================================================================ B. a customer's GSTIN
create function pg_temp.setg(p_user text, p_company text, p_value text) returns text language sql as $$
  select pg_temp.out(p_user, format('update public.companies set gstin = %L where id = %L', p_value, tests.rid(p_company))) $$;
select is(pg_temp.setg('a_owner', 'a_company', '27AAPFU0939F1ZV'), 'rows:1', 'the Owner sets a customer''s GSTIN');
select is(pg_temp.setg('a_admin', 'a_company', '29AAGCB7383J1Z4'), 'rows:1', 'the Admin changes it');
select is(pg_temp.setg('a_sales', 'a_company', '24AAACC1206D1ZM'), 'rows:1', 'Sales may too (they edit customers)');
select is(pg_temp.setg('a_viewer', 'a_company', '27AAPFU0939F1ZV'), 'rows:0', 'a Viewer may not (no row is theirs to change)');
select is(pg_temp.setg('b_owner', 'a_company', '27AAPFU0939F1ZV'), 'rows:0', 'another business''s Owner cannot touch it (row-level security: no row)');
select is(pg_temp.setg('a_owner', 'a_company', '27AAPFU0939F1ZW'), '23514', 'a GSTIN with a wrong check character is refused by the table (23514)');
select is(pg_temp.setg('a_owner', 'a_company', '27aapfu0939f1zv'), '23514', '...so is lower case');
select is(pg_temp.setg('a_owner', 'a_company', ''), '23514', '...and the empty text (use null to clear)');
select is(pg_temp.out('a_owner', format('update public.companies set gstin = null where id = %L', tests.rid('a_company'))), 'rows:1', 'the Owner clears it');
select is(pg_temp.out('a_owner', format($q$insert into public.companies (id, tenant_id, name, gstin) values (%L, %L, 'New Co', '27AAPFU0939F1ZV')$q$, tests.rid('gnew'), tests.tid('a'))), 'rows:1', 'a company can be made with a GSTIN');
select is(pg_temp.out('a_owner', format($q$insert into public.companies (id, tenant_id, name, gstin) values (%L, %L, 'Bad Co', '27AAPFU0939F1ZX')$q$, tests.rid('gbad'), tests.tid('a'))), '23514', '...but not with a bad one');
select is(pg_temp.out('a_viewer', format('select gstin from public.companies where id = %L', tests.rid('gnew'))), 'rows:1', 'every member reads it');
select is(pg_temp.out('b_owner', format('select gstin from public.companies where id = %L', tests.rid('gnew'))), 'rows:0', 'another business reads nothing');
select is(pg_temp.out('a_owner', format($q$update public.companies set gstin = '29AAGCB7383J1Z4' where id = %L$q$, tests.rid('b_company'))), 'rows:0', 'the same GSTIN can sit on companies of other businesses (and a branch of the same business): there is no uniqueness');

-- ================================================================================ C. the shop's own GSTIN
create function pg_temp.bp(p_user text, p_value text, p_aal text default 'aal2', p_tenant text default 'a') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), format('select public.business_profile_set(%L, %L)', tests.tid(p_tenant), p_value));
exception when others then return 'ERR:' || sqlstate; end $$;
select is(pg_temp.bp('a_owner', '27AAPFU0939F1ZV'), '{"gstin": "27AAPFU0939F1ZV"}', 'the Owner (second factor) sets the shop''s GSTIN');
select is(pg_temp.bp('a_admin', ' 29aagcb7383j1z4 '), '{"gstin": "29AAGCB7383J1Z4"}', 'the Admin changes it: spaces and lower case are normalised');
select is(pg_temp.bp('a_sales', '27AAPFU0939F1ZV'), 'ERR:42501', 'Sales may not');
select is(pg_temp.bp('a_viewer', '27AAPFU0939F1ZV'), 'ERR:42501', 'a Viewer may not');
select is(pg_temp.bp('b_owner', '27AAPFU0939F1ZV', 'aal2', 'a'), 'ERR:42501', 'another business''s Owner may not');
select is(pg_temp.bp('a_owner', '27AAPFU0939F1ZV', 'aal1'), 'ERR:SM306', 'without a second factor: SM306');
select is(pg_temp.bp('a_owner', '27AAPFU0939F1ZW'), 'ERR:22023', 'a bad GSTIN is invalid (22023)');
select is((select gstin from public.business_profile where tenant_id = tests.tid('a')), '29AAGCB7383J1Z4', 'the failed attempts changed nothing');
select is(pg_temp.out('a_viewer', format('select gstin from public.business_profile where tenant_id = %L', tests.tid('a'))), 'rows:1', 'every member reads it');
select is(pg_temp.out('b_owner', format('select gstin from public.business_profile where tenant_id = %L', tests.tid('a'))), 'rows:0', 'another business reads nothing');
select is(pg_temp.out('a_owner', format($q$insert into public.business_profile (tenant_id, gstin) values (%L, '27AAPFU0939F1ZV') on conflict (tenant_id) do update set gstin = excluded.gstin$q$, tests.tid('a'))), '42501', 'no client writes the table directly');
select is(pg_temp.out('a_owner', format('delete from public.business_profile where tenant_id = %L', tests.tid('a'))), '42501', '...or deletes from it');
select is(pg_temp.bp('a_owner', null), '{"gstin": null}', 'the Owner clears it');
select is(pg_temp.bp('a_owner', '   '), '{"gstin": null}', '...a blank is a clear');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'business_profile'), 3::bigint, 'each change of the shop''s GSTIN is in the audit trail (the first set, the change, the clear; a blank on an empty value changes nothing)');

-- ================================================================================ D. erasure and the audit log
select is(pg_temp.setg('a_owner', 'a_company', '24AAACC1206D1ZM'), 'rows:1', 'the planted company carries a GSTIN');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'company' and (old_values::text like '%24AAACC1206D1ZM%' or new_values::text like '%24AAACC1206D1ZM%')), 0::bigint, 'the audit log never holds a customer''s GSTIN by value');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'company' and (old_values ? 'gstin' or new_values ? 'gstin')), 0::bigint, '...nor the key');
select cmp_ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'company' and metadata -> 'pii_fields_changed' ? 'gstin'), '>=', 1::bigint, '...only the fact that the field changed');
select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''company'', %L)', tests.rid('ek1'), tests.tid('a'), tests.rid('a_company')));
select is(tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('ek1')))::jsonb ->> 'status', 'executed', 'the company is erased');
select is((select gstin from public.companies where id = tests.rid('a_company')), null, 'THE COMPANY-SCOPE ERASURE NULLS ITS GSTIN');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'business_profile' and new_values::text like '%27AAPFU0939F1ZV%'), 1::bigint, 'the shop''s OWN GSTIN is a business identifier: it is audited by value (it is not personal data of a customer)');
select is((select gstin from public.companies where id = tests.rid('gnew')), '27AAPFU0939F1ZV', '...and no other company''s');
select is((select count(*) from erasure.registry where table_name = 'companies' and column_name = 'gstin'), 2::bigint, 'the erasure registry knows the column (company scope and the sweep)');

-- ================================================================================ E. the accounting export
select is(pg_get_functiondef('public.export_accounting_data(uuid, uuid, text, date, date)'::regprocedure) like '%shop_gstin%' and pg_get_functiondef('public.export_accounting_data(uuid, uuid, text, date, date)'::regprocedure) like '%co.gstin%', true, 'the export function carries the GSTINs');
select pg_temp.bp('a_owner', '27AAPFU0939F1ZV');
select is(pg_temp.sc('a_owner', format('select public.export_accounting_data(%L, %L, ''csv'', current_date - 1, current_date)::jsonb ->> ''shop_gstin''', tests.tid('a'), gen_random_uuid())), '27AAPFU0939F1ZV', 'the result names the shop''s GSTIN');
select is(pg_temp.sc('a_owner', format('select public.export_accounting_data(%L, %L, ''csv'', current_date - 1, current_date)::jsonb ->> ''shop_gstin''', tests.tid('b'), gen_random_uuid())), 'ERR:42501', 'not for another business');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'export.create' and metadata::text like '%27AAPFU%' or new_values::text like '%27AAPFU%' and action = 'export.create'), 0::bigint, 'the export''s audit event holds no GSTIN');

select * from finish();
rollback;
