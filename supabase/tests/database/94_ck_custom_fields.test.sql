-- Job CK (ADR 0084 part 2): CUSTOM FIELDS on contacts and catalogue items.
--   A structure, grants, RLS     B definitions: who, what, the limits, immutability     C values: every kind, every refusal, who may write and read
--   D the import's bulk writer   E module default-deny reaches the fields             F erasure: a contact's values go with the contact; the tenant-wide wipe and the sweep
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by)
values (tests.rid('a_item'), tests.tid('a'), 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', tests.uid('a_owner')),
       (tests.rid('b_item'), tests.tid('b'), 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', tests.uid('b_owner'));

-- a statement as a person at a given assurance level -> its SQLSTATE or 'ok'
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.sqlstate_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  return r;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.mk(p_user text, p_entity text, p_code text, p_kind text, p_choices text default 'null') returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.custom_field_def_create(%L, %L, %L, '{"en": "Field"}'::jsonb, %L, %s, false)$q$, tests.tid('a'), p_entity, p_code, p_kind,
         case when p_choices is null or p_choices = 'null' then 'null::jsonb' else quote_literal(p_choices) || '::jsonb' end))
$$;
create function pg_temp.setv(p_user text, p_contact uuid, p_values text) returns text language sql as $$
  select pg_temp.try(p_user, format($q$select public.custom_values_set(%L, 'contact', %L, %L::jsonb)$q$, tests.tid('a'), p_contact, p_values))
$$;
create function pg_temp.getv(p_user text, p_contact uuid, p_code text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (select e ->> 'value' from jsonb_array_elements(public.custom_values_get(%L, 'contact', %L) -> 'values') e where e ->> 'code' = %L)$q$, tests.tid('a'), p_contact, p_code))
$$;

-- ============================================================================ A. structure, grants, RLS
select is((select count(*) from pg_class where relname in ('custom_field_defs', 'custom_field_values') and relkind = 'r' and relrowsecurity and relforcerowsecurity), 2::bigint, 'A1 RLS is enabled and forced on both tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('custom_field_defs', 'custom_field_values') and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'A2 a client can only SELECT them: every write is a function');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('custom_field_defs', 'custom_field_values') and grantee in ('anon', 'public')), 0::bigint, 'A3 anon and PUBLIC hold nothing');
select is((select count(*) from pg_policies where tablename in ('custom_field_defs', 'custom_field_values')), 2::bigint, 'A4 one select policy each');
select is(pg_temp.try('a_owner', format($$insert into public.custom_field_defs (tenant_id, entity, code, label, kind, source) values (%L, 'contact', 'direct', '{"en": "x"}', 'text', 'owner')$$, tests.tid('a'))), '42501', 'A5 DENY: a client cannot insert a definition directly');
select is(pg_temp.try('a_owner', $$update public.custom_field_defs set required = true$$), '42501', 'A6 DENY: nor update one');
select is(pg_temp.try('a_owner', $$delete from public.custom_field_defs$$), '42501', 'A7 DENY: nor delete one');
select is(pg_temp.try('a_owner', $$delete from public.custom_field_values$$), '42501', 'A8 DENY: nor a value');
select is(pg_temp.at('aal2', 'anon', format($$select public.custom_field_defs_list(%L)$$, tests.tid('a'))), '42501', 'A9 DENY: anon');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'custom_field_values' and column_name like 'value\_%' and col_description('public.custom_field_values'::regclass, ordinal_position) like 'PII:%'), 5::bigint, 'A10 every value column is classified PII');
select is((select count(*) from erasure.registry where table_name = 'custom_field_values'), 7::bigint, 'A11 and has its erasure registry rows (five tenant-scope, two sweeps)');

-- ============================================================================ B. definitions
-- who: Owner / Admin with a second factor
select is(pg_temp.mk('a_owner', 'contact', 'site_area', 'text'), 'ok', 'B1 ALLOW: the Owner defines a text field');
select is(pg_temp.mk('a_admin', 'contact', 'credit_days', 'number'), 'ok', 'B2 ALLOW: the Admin defines a number field');
select is(pg_temp.mk('a_sales', 'contact', 'by_sales', 'text'), '42501', 'B3 DENY: Sales');
select is(pg_temp.mk('a_viewer', 'contact', 'by_viewer', 'text'), '42501', 'B4 DENY: Viewer');
select is(pg_temp.mk('b_owner', 'contact', 'by_b', 'text'), '42501', 'B5 DENY: another business''s Owner');
select is(pg_temp.mk('outsider', 'contact', 'by_out', 'text'), '42501', 'B6 DENY: an outsider');
select is(pg_temp.at('aal1', 'a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'weak', '{"en": "x"}', 'text', null, false)$$, tests.tid('a'))), 'SM306', 'B7 DENY: no second factor (SM306)');
select is((select count(*) from public.custom_field_defs where tenant_id = tests.tid('a') and code in ('weak', 'by_sales', 'by_viewer', 'by_b', 'by_out')), 0::bigint, 'B8 none of the refusals left a row');
-- what: an owner's field is always class none, source owner, mergeable only for choice / number / date
select is((select pii_class || ':' || source || ':' || mergeable::text from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'site_area'), 'none:owner:false', 'B9 an owner-added text field is class none, source owner, not mergeable');
select is((select mergeable from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'credit_days'), true, 'B10 a number field may be a merge field');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'Bad Code', '{"en": "x"}', 'text', null, false)$$, tests.tid('a'))), '22023', 'B11 a malformed code is refused');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'dependant', 'kid', '{"en": "x"}', 'text', null, false)$$, tests.tid('a'))), '22023', 'B12 an entity outside the list (a child is never a custom-field entity here)');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'nolabel', '{"te": "x"}', 'text', null, false)$$, tests.tid('a'))), '22023', 'B13 English is required');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'badlang', '{"en": "x", "fr": "y"}', 'text', null, false)$$, tests.tid('a'))), '22023', 'B14 only en, te, hi, kn');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'longlabel', jsonb_build_object('en', repeat('x', 81)), 'text', null, false)$$, tests.tid('a'))), '22023', 'B15 a label over 80 characters');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'dirty', jsonb_build_object('en', 'a' || chr(8203) || 'b'), 'text', null, false)$$, tests.tid('a'))), '22023', 'B16 a label with an invisible character');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'kindx', '{"en": "x"}', 'secret', null, false)$$, tests.tid('a'))), '22023', 'B17 a kind outside the list');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'nochoices', '{"en": "x"}', 'choice', null, false)$$, tests.tid('a'))), '22023', 'B18 a choice field needs choices');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'extrachoices', '{"en": "x"}', 'text', '[{"code": "a", "label": {"en": "A"}}]', false)$$, tests.tid('a'))), '22023', 'B19 a text field takes none');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'dupchoice', '{"en": "x"}', 'choice', '[{"code": "a", "label": {"en": "A"}}, {"code": "a", "label": {"en": "B"}}]', false)$$, tests.tid('a'))), '22023', 'B20 choice codes must differ');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_create(%L, 'contact', 'badchoice', '{"en": "x"}', 'choice', '[{"code": "A B", "label": {"en": "A"}}]', false)$$, tests.tid('a'))), '22023', 'B21 a choice code is [a-z0-9_]');
select is(pg_temp.mk('a_owner', 'contact', 'site_area', 'text'), '23505', 'B22 a code is used once per entity');
select is(pg_temp.mk('a_owner', 'catalogue_item', 'site_area', 'text'), 'ok', 'B23 but the same code may exist on the other entity');
select is(pg_temp.mk('a_owner', 'contact', 'kind', 'choice', '[{"code": "builder", "label": {"en": "Builder"}}, {"code": "dealer", "label": {"en": "Dealer"}}]'), 'ok', 'B24 a choice field');
select is(pg_temp.mk('a_owner', 'contact', 'uses', 'multi_choice', '[{"code": "driveway", "label": {"en": "Driveway"}}, {"code": "garden", "label": {"en": "Garden"}}]'), 'ok', 'B25 a multi-choice field');
select is(pg_temp.mk('a_owner', 'contact', 'first_order', 'date'), 'ok', 'B26 a date field');
select is(pg_temp.mk('a_owner', 'contact', 'gst_registered', 'yes_no'), 'ok', 'B27 a yes/no field');
select is((select mergeable from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'gst_registered'), false, 'B28 a yes/no field is never a merge field');
-- the limit: 20 ACTIVE per entity (the contact entity has 6 now), 40 in all
select is((select count(*) from public.custom_field_defs where tenant_id = tests.tid('a') and entity = 'contact'), 6::bigint, 'B29 six contact fields so far');
do $$ begin for i in 7..20 loop perform pg_temp.mk('a_owner', 'contact', 'filler_' || i, 'text'); end loop; end $$;
select is((select count(*) from public.custom_field_defs where tenant_id = tests.tid('a') and entity = 'contact' and active), 20::bigint, 'B30 twenty active contact fields');
select is(pg_temp.mk('a_owner', 'contact', 'one_too_many', 'text'), 'SM712', 'B31 the twenty-first is refused (SM712)');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_update(%L, %L, null, null, false, null, null)$$, tests.tid('a'), (select id from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'filler_20'))), 'ok', 'B32 making one inactive frees a place');
select is(pg_temp.mk('a_owner', 'contact', 'after_free', 'text'), 'ok', 'B33 so a new one is accepted');
select is(pg_temp.try('a_owner', format($$select public.custom_field_def_update(%L, %L, null, null, true, null, null)$$, tests.tid('a'), (select id from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'filler_20'))), 'SM712', 'B34 but switching the old one back on would pass twenty (SM712)');
-- update rules
create temp table kind_def as select id from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'kind';
select is(pg_temp.try('a_admin', format($$select public.custom_field_def_update(%L, %L, '{"en": "Customer type"}', true, null, 5, null)$$, tests.tid('a'), (select id from kind_def))), 'ok', 'B35 label, required and position change');
select is((select label ->> 'en' || ':' || required::text || ':' || position::text from public.custom_field_defs where id = (select id from kind_def)), 'Customer type:true:5', 'B36 and are stored');
select is(pg_temp.try('a_admin', format($$select public.custom_field_def_update(%L, %L, null, null, null, null, '[{"code": "contractor", "label": {"en": "Contractor"}}]')$$, tests.tid('a'), (select id from kind_def))), 'ok', 'B37 choices GROW');
select is((select jsonb_array_length(choices) from public.custom_field_defs where id = (select id from kind_def)), 3, 'B38 three choices now');
select is(pg_temp.try('a_admin', format($$select public.custom_field_def_update(%L, %L, null, null, null, null, '[{"code": "builder", "label": {"en": "Again"}}]')$$, tests.tid('a'), (select id from kind_def))), '22023', 'B39 an existing choice code cannot be added twice');
select is(pg_temp.try('a_sales', format($$select public.custom_field_def_update(%L, %L, null, null, false, null, null)$$, tests.tid('a'), (select id from kind_def))), '42501', 'B40 DENY: Sales cannot change a field');
select is(pg_temp.try('b_owner', format($$select public.custom_field_def_update(%L, %L, null, null, false, null, null)$$, tests.tid('b'), (select id from kind_def))), '23503', 'B41 DENY: another business''s Owner cannot reach it (not found in their business)');
select is(pg_temp.at('aal1', 'a_owner', format($$select public.custom_field_def_update(%L, %L, null, null, false, null, null)$$, tests.tid('a'), (select id from kind_def))), 'SM306', 'B42 DENY: no second factor');
-- immutability, as the database owner (the functions are the only door, but the table itself is also shut)
select is(pg_temp.sc(format($$update public.custom_field_defs set code = 'renamed' where id = %L$$, (select id from kind_def))), '42501', 'B43 a code never changes');
select is(pg_temp.sc(format($$update public.custom_field_defs set kind = 'text', choices = null where id = %L$$, (select id from kind_def))), '42501', 'B44 nor a kind');
select is(pg_temp.sc(format($$update public.custom_field_defs set pii_class = 'personal' where id = %L$$, (select id from kind_def))), '42501', 'B45 nor its personal-data class (only a new migration can)');
select is(pg_temp.sc(format($$update public.custom_field_defs set entity = 'catalogue_item' where id = %L$$, (select id from kind_def))), '42501', 'B46 nor its entity');
select is(pg_temp.sc(format($$update public.custom_field_defs set choices = '[{"code": "builder", "label": {"en": "B"}}]' where id = %L$$, (select id from kind_def))), '42501', 'B47 a choice is never removed');
select is(pg_temp.sc(format($$delete from public.custom_field_defs where id = %L$$, (select id from kind_def))), '42501', 'B48 a definition is never deleted');
select is(pg_temp.sc(format($$update public.custom_field_defs set tenant_id = %L where id = %L$$, tests.tid('b'), (select id from kind_def))), '42501', 'B49 nor moved to another business');
-- reads
select is(pg_temp.val('a_viewer', format($$select jsonb_array_length(public.custom_field_defs_list(%L))::text$$, tests.tid('a'))), (select (count(*))::text from public.custom_field_defs where tenant_id = tests.tid('a')), 'B50 every member lists the definitions, including a Viewer');
select is(pg_temp.val('a_viewer', format($$select jsonb_array_length(public.custom_field_defs_list(%L, 'catalogue_item'))::text$$, tests.tid('a'))), '1', 'B51 filtered by entity');
select is(pg_temp.try('a_owner', format($$select public.custom_field_defs_list(%L, 'dependant')$$, tests.tid('a'))), '22023', 'B52 an unknown entity filter is refused');
select is(pg_temp.try('b_owner', format($$select public.custom_field_defs_list(%L)$$, tests.tid('a'))), '42501', 'B53 DENY: another business reads none of it');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.custom_field_defs'), 0::bigint, 'B54 and a direct select sees none of tenant A''s rows');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.custom_field_defs') > 0, true, 'B55 a Viewer reads the definitions directly');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.custom_field_values'), 0::bigint, 'B56 but not the values table (a Viewer reads values through the function)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'custom_field_def' and action = 'custom_field_def.create'), (select count(*) from public.custom_field_defs where tenant_id = tests.tid('a')), 'B57 every definition creation is audited');

-- ============================================================================ C. values
create temp table c as select tests.rid('a_contact') as k;
select is(pg_temp.setv('a_sales', (select k from c), '{"site_area": "Hitech City", "credit_days": 30, "kind": "builder", "uses": ["driveway", "garden"], "first_order": "2026-10-14", "gst_registered": true}'), 'ok', 'C1 ALLOW: Sales fills in every kind of value at once');
select is(pg_temp.getv('a_owner', (select k from c), 'site_area'), 'Hitech City', 'C2 a text value');
select is(pg_temp.getv('a_owner', (select k from c), 'credit_days'), '30', 'C3 a number');
select is(pg_temp.getv('a_owner', (select k from c), 'kind'), 'builder', 'C4 a choice');
select is(pg_temp.getv('a_owner', (select k from c), 'uses'), '["driveway", "garden"]', 'C5 a multi-choice');
select is(pg_temp.getv('a_owner', (select k from c), 'first_order'), '2026-10-14', 'C6 a date');
select is(pg_temp.getv('a_owner', (select k from c), 'gst_registered'), 'true', 'C7 a yes/no');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = (select k from c)), 6::bigint, 'C8 six value rows');
select is(pg_temp.setv('a_sales', (select k from c), '{"credit_days": 45}'), 'ok', 'C9 a change replaces the value');
select is(pg_temp.getv('a_owner', (select k from c), 'credit_days'), '45', 'C10 (not a second row)');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = (select k from c)), 6::bigint, 'C11 still six rows');
select is(pg_temp.setv('a_sales', (select k from c), '{"credit_days": null}'), 'ok', 'C12 null clears a value');
select is(pg_temp.getv('a_owner', (select k from c), 'credit_days'), null, 'C13 and it reads as unset');
-- who
select is(pg_temp.setv('a_viewer', (select k from c), '{"site_area": "x"}'), '42501', 'C14 DENY: a Viewer cannot write');
select is(pg_temp.setv('b_owner', (select k from c), '{"site_area": "x"}'), '42501', 'C15 DENY: another business''s Owner');
select is(pg_temp.setv('outsider', (select k from c), '{"site_area": "x"}'), '42501', 'C16 DENY: an outsider');
select is(pg_temp.at('aal2', 'anon', format($$select public.custom_values_set(%L, 'contact', %L, '{"site_area": "x"}')$$, tests.tid('a'), (select k from c))), '42501', 'C17 DENY: no identity');
select is(pg_temp.at('aal1', 'a_sales', format($$select public.custom_values_set(%L, 'contact', %L, '{"site_area": "y"}')$$, tests.tid('a'), (select k from c))), 'ok', 'C18 no second factor is asked to fill in a value');
select is(pg_temp.setv('a_owner', tests.rid('b_contact'), '{"site_area": "x"}'), '23503', 'C19 a contact of another business is not found');
select is(pg_temp.setv('a_owner', gen_random_uuid(), '{"site_area": "x"}'), '23503', 'C20 nor an unknown one');
-- what: every refusal is SM711 and changes nothing
select is(pg_temp.setv('a_owner', (select k from c), '{"site_area": "' || repeat('x', 101) || '"}'), 'SM711', 'C21 a text over 100 characters');
select is(pg_temp.setv('a_owner', (select k from c), '{"site_area": "call 9876543210 now"}'), 'SM711', 'C22 a phone number in a class-none text');
select is(pg_temp.setv('a_owner', (select k from c), '{"site_area": "a@b.co"}'), 'SM711', 'C23 an e-mail address in a class-none text');
select is(pg_temp.setv('a_owner', (select k from c), jsonb_build_object('site_area', 'a' || chr(8203) || 'b')::text), 'SM711', 'C24 an invisible character');
select is(pg_temp.setv('a_owner', (select k from c), '{"site_area": 5}'), 'SM711', 'C25 a number in a text field');
select is(pg_temp.setv('a_owner', (select k from c), '{"credit_days": "thirty"}'), 'SM711', 'C26 text in a number field');
select is(pg_temp.setv('a_owner', (select k from c), '{"credit_days": 1000000000000}'), 'SM711', 'C27 a number that is too large');
select is(pg_temp.setv('a_owner', (select k from c), '{"first_order": "14/10/2026"}'), 'SM711', 'C28 a date that is not ISO');
select is(pg_temp.setv('a_owner', (select k from c), '{"first_order": "2026-02-31"}'), 'SM711', 'C29 a date that does not exist');
select is(pg_temp.setv('a_owner', (select k from c), '{"first_order": "1800-01-01"}'), 'SM711', 'C30 a date before 1900');
select is(pg_temp.setv('a_owner', (select k from c), '{"gst_registered": "yes"}'), 'SM711', 'C31 text in a yes/no field');
select is(pg_temp.setv('a_owner', (select k from c), '{"kind": "architect"}'), 'SM711', 'C32 a choice that is not offered');
select is(pg_temp.setv('a_owner', (select k from c), '{"kind": ["builder"]}'), 'SM711', 'C33 a list in a single-choice field');
select is(pg_temp.setv('a_owner', (select k from c), '{"uses": ["driveway", "roof"]}'), 'SM711', 'C34 a multi-choice with one that is not offered');
select is(pg_temp.setv('a_owner', (select k from c), '{"uses": ["driveway", "driveway"]}'), 'SM711', 'C35 a choice twice');
select is(pg_temp.setv('a_owner', (select k from c), '{"uses": []}'), 'SM711', 'C36 an empty choice list (clear with null instead)');
select is(pg_temp.setv('a_owner', (select k from c), '{"not_a_field": "x"}'), 'SM711', 'C37 a code the business does not have');
select is(pg_temp.setv('a_owner', (select k from c), '[1]'), '22023', 'C38 values must be an object');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'contact', %L, null)$$, tests.tid('a'), (select k from c))), '22023', 'C39 null values are refused');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set(%L, 'dependant', %L, '{}')$$, tests.tid('a'), (select k from c))), '22023', 'C40 an unknown entity');
-- all or nothing
select is(pg_temp.setv('a_owner', (select k from c), '{"site_area": "Changed", "credit_days": "bad"}'), 'SM711', 'C41 one bad value refuses the whole call');
select is(pg_temp.getv('a_owner', (select k from c), 'site_area'), 'y', 'C42 and the good one in it was not kept');
-- an inactive field takes no new value but can be cleared
do $$ begin perform pg_temp.try('a_owner', format($q$select public.custom_field_def_update(%L, %L, null, null, false, null, null)$q$, tests.tid('a'), (select id from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'gst_registered'))); end $$;
select is(pg_temp.setv('a_owner', (select k from c), '{"gst_registered": false}'), 'SM711', 'C43 an inactive field takes no new value');
select is(pg_temp.getv('a_owner', (select k from c), 'gst_registered'), 'true', 'C44 its old value still reads (an inactive field that holds a value is listed)');
select is(pg_temp.setv('a_owner', (select k from c), '{"gst_registered": null}'), 'ok', 'C45 and can be cleared');
-- personal class: a pack or operator field may hold what a class-none field may not, and a Viewer never sees it
insert into public.custom_field_defs (tenant_id, entity, code, label, kind, pii_class, source) values (tests.tid('a'), 'contact', 'private_note', '{"en": "Private note"}', 'text', 'personal', 'pack');
select is(pg_temp.setv('a_sales', (select k from c), '{"private_note": "ask on 9876543210"}'), 'ok', 'C46 a personal-class text field may hold a phone number (the business marked it personal)');
select is(pg_temp.getv('a_sales', (select k from c), 'private_note'), 'ask on 9876543210', 'C47 Sales reads it');
select is(pg_temp.getv('a_viewer', (select k from c), 'private_note'), null, 'C48 a Viewer does NOT see a personal value');
select is(pg_temp.getv('a_viewer', (select k from c), 'site_area'), 'y', 'C49 but sees the others');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.custom_field_values') > 0, true, 'C50 Sales reads the values table directly');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.custom_field_values'), 0::bigint, 'C51 another business reads none of it');
select is(tests.rows_as(tests.uid('b_owner'), format($$select 1 from public.custom_field_values where contact_id = %L$$, (select k from c))), 0::bigint, 'C52 not even by naming the contact');
-- the table's own checks, as the database owner
insert into public.custom_field_defs (id, tenant_id, entity, code, label, kind, source) values (tests.rid('b_def'), tests.tid('b'), 'contact', 'b_field', '{"en": "B field"}', 'text', 'owner');
select is(pg_temp.sc(format($$insert into public.custom_field_values (tenant_id, field_id, entity, contact_id, value_text, value_number) values (%L, %L, 'contact', %L, 'x', 1)$$, tests.tid('a'), (select id from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'filler_8'), tests.rid('a_contact'))), '23514', 'C53 two value columns in one row are refused');
select is(pg_temp.sc(format($$insert into public.custom_field_values (tenant_id, field_id, entity, contact_id, catalogue_item_id, value_text) values (%L, %L, 'contact', %L, %L, 'x')$$, tests.tid('a'), (select id from public.custom_field_defs where tenant_id = tests.tid('a') and code = 'filler_8'), tests.rid('a_contact'), tests.rid('a_item'))), '23514', 'C54 a value belongs to ONE entity');
select is(pg_temp.sc(format($$insert into public.custom_field_values (tenant_id, field_id, entity, contact_id, value_text) values (%L, %L, 'contact', %L, 'x')$$, tests.tid('a'), tests.rid('b_def'), tests.rid('a_contact'))), '23503', 'C55 a value cannot use another business''s definition (composite key)');
-- catalogue items: Owner and Admin only
select is(pg_temp.try('a_admin', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"site_area": "Warehouse"}')$$, tests.tid('a'), tests.rid('a_item'))), 'ok', 'C56 ALLOW: the Admin fills in an item''s field');
select is(pg_temp.try('a_sales', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"site_area": "x"}')$$, tests.tid('a'), tests.rid('a_item'))), '42501', 'C57 DENY: Sales cannot (an item is the Owner''s and Admin''s)');
select is(pg_temp.try('a_admin', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"site_area": "Again"}')$$, tests.tid('a'), tests.rid('a_item'))), 'ok', 'C58 an item value is replaced, not duplicated');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and catalogue_item_id = tests.rid('a_item')), 1::bigint, 'C59 one row');
select is(pg_temp.try('a_admin', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"site_area": "x"}')$$, tests.tid('a'), tests.rid('b_item'))), '23503', 'C60 an item of another business is not found');
select is(pg_temp.try('a_admin', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"credit_days": 5}')$$, tests.tid('a'), tests.rid('a_item'))), 'SM711', 'C61 a contact field is not an item field');
select is(pg_temp.val('a_viewer', format($$select (public.custom_values_get(%L, 'catalogue_item', %L) -> 'values' -> 0 ->> 'value')$$, tests.tid('a'), tests.rid('a_item'))), 'Again', 'C62 a Viewer reads an item''s values');
select is(pg_temp.try('a_viewer', format($$select public.custom_values_get(%L, 'contact', %L)$$, tests.tid('b'), (select k from c))), '42501', 'C63 DENY: a Viewer of A reads nothing of B');
-- audit: a value is audited by NAME only (no value in the trail)
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'custom_field_value'), (select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'custom_field_value' and not (coalesce(new_values::text, '') like '%Hitech City%' or coalesce(old_values::text, '') like '%Hitech City%' or coalesce(new_values::text, '') like '%9876543210%')), 'C64 no value appears in the audit trail');

-- ============================================================================ D. the import's bulk writer
create temp table d as select tests.rid('a_d1') as c1, tests.rid('a_d2') as c2, tests.rid('a_d3') as c3;
insert into public.contacts (id, tenant_id, company_id, full_name) select c1, tests.tid('a'), tests.rid('a_company'), 'Bulk 1' from d union all select c2, tests.tid('a'), tests.rid('a_company'), 'Bulk 2' from d union all select c3, tests.tid('a'), tests.rid('a_company'), 'Bulk 3' from d;
select is(pg_temp.val('a_owner', format($$select public.custom_values_set_many(%L, jsonb_build_array(jsonb_build_object('id', %L, 'values', jsonb_build_object('site_area', 'One')), jsonb_build_object('id', %L, 'values', jsonb_build_object('credit_days', 'bad')), jsonb_build_object('id', %L, 'values', jsonb_build_object('kind', 'dealer'))))::text$$, tests.tid('a'), (select c1 from d), (select c2 from d), (select c3 from d))),
  format('{"set": 2, "failed": [{"id": "%s", "code": "SM711"}]}', (select c2 from d)), 'D1 a row that does not fit is reported and skipped; the others are kept');
select is(pg_temp.getv('a_owner', (select c1 from d), 'site_area'), 'One', 'D2 the first row was written');
select is(pg_temp.getv('a_owner', (select c3 from d), 'kind'), 'dealer', 'D3 and the third');
select is(pg_temp.getv('a_owner', (select c2 from d), 'credit_days'), null, 'D4 and the bad one left nothing');
select is(pg_temp.try('a_sales', format($$select public.custom_values_set_many(%L, '[{"id": "%s", "values": {}}]')$$, tests.tid('a'), (select c1 from d))), '42501', 'D5 DENY: Sales (the import is Owner / Admin)');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set_many(%L, '[]')$$, tests.tid('a'))), '22023', 'D6 an empty list is refused');
select is(pg_temp.try('a_owner', format($$select public.custom_values_set_many(%L, (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'values', '{}'::jsonb)) from generate_series(1, 501)))$$, tests.tid('a'))), '22023', 'D7 more than 500 at once is refused');
select is(pg_temp.val('a_owner', format($$select (public.custom_values_set_many(%L, jsonb_build_array(jsonb_build_object('id', %L, 'values', jsonb_build_object('site_area', 'x')))) -> 'failed' -> 0 ->> 'code')$$, tests.tid('a'), tests.rid('b_contact'))), '23503', 'D8 a contact of another business is reported as not found');

-- ============================================================================ E. a module that is off refuses its entity's fields
update packs.workspace_pack set pack_code = 'education', pack_version = 1 where tenant_id = tests.tid('b');
select is(pg_temp.try('b_owner', format($$select public.custom_field_def_create(%L, 'catalogue_item', 'size', '{"en": "Size"}', 'text', null, false)$$, tests.tid('b'))), 'SM701', 'E1 education has no catalogue: a catalogue-item field is refused (SM701)');
select is(pg_temp.try('b_owner', format($$select public.custom_field_def_create(%L, 'contact', 'relation', '{"en": "Relation"}', 'text', null, false)$$, tests.tid('b'))), 'ok', 'E2 but a contact field is fine');
select is(pg_temp.try('b_owner', format($$select public.custom_values_set(%L, 'catalogue_item', %L, '{"size": "x"}')$$, tests.tid('b'), tests.rid('b_item'))), 'SM701', 'E3 and an item''s values are refused too');
update packs.workspace_pack set pack_code = 'textiles', pack_version = 1 where tenant_id = tests.tid('b');

-- ============================================================================ F. erasure
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = tests.rid('a_d1')), 1::bigint, 'F1 sanity: the contact has a value');
select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('f1'), tests.tid('a'), tests.rid('a_d1')));
select is((tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('f1')))::jsonb ->> 'status'), 'executed', 'F2 the Owner erased the contact');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = tests.rid('a_d1')), 0::bigint, 'F3 ITS values are deleted with it');
select is((select count(*) from public.custom_field_values where tenant_id = tests.tid('a') and contact_id = tests.rid('a_d3')), 1::bigint, 'F4 another contact''s values stay');
select is(pg_temp.setv('a_owner', tests.rid('a_d1'), '{"site_area": "x"}'), '23503', 'F5 an erased contact takes no new value');
select is((select count(*) from public.custom_field_defs where tenant_id = tests.tid('a')), (select count(*) from public.custom_field_defs where tenant_id = tests.tid('a') and active or not active), 'F6 the definitions stay (they are the business''s columns, not a person''s data)');

select * from finish();
rollback;
