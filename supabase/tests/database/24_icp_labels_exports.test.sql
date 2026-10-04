-- T005 / milestone 1: BEHAVIOUR of icp_config_versions, lead_labels and data_exports (ADR 0010).
-- SQLSTATE contract: 23514 invalid value / structure, 23503 invalid reference, 23505 duplicate,
-- 22P02 invalid enum label, 42501 forbidden or immutable.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t005();

create function pg_temp.shape(p_sql text) returns text
language plpgsql as $$
declare v_constraint text;
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    get stacked diagnostics v_constraint = constraint_name;
    return sqlstate || ':' || coalesce(v_constraint, '');
  end;
end $$;
create function pg_temp.st(p_sql text) returns text language sql as $$ select split_part(pg_temp.shape(p_sql), ':', 1) $$;

-- ================================================================== icp_config_versions
create function pg_temp.icp(p_config text, p_engine text default 'icp-rules', p_schema int default 1, p_tenant text default 'a') returns text
language sql as $$
  select format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config) values (gen_random_uuid(), %L, %L, %s, %L::jsonb)$q$,
                tests.tid(p_tenant), p_engine, p_schema, p_config)
$$;
create function pg_temp.good_config() returns text language sql as
$$ select '{"factors":[{"id":"fit","max_points":30}],"bands":[{"min":80}]}' $$;

-- version numbers are assigned by the server, per tenant, one after another
select is((select max(version_no) from public.icp_config_versions where tenant_id = tests.tid('a')), 1, 'the fixture version is number 1');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.icp(pg_temp.good_config())), 'rows:1', 'an Owner publishes a version');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.icp(pg_temp.good_config())), 'rows:1', 'an Admin publishes a version');
select is((select array_agg(version_no order by version_no) from public.icp_config_versions where tenant_id = tests.tid('a')), array[1, 2, 3], 'tenant A: 1, 2, 3');
select is((select array_agg(version_no order by version_no) from public.icp_config_versions where tenant_id = tests.tid('b')), array[1], 'tenant B is numbered independently (still 1)');
select is(pg_temp.st(pg_temp.icp('[]')), '23514', 'a failed insert...');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.icp(pg_temp.good_config())), 'rows:1', '...leaves no gap: the next publish succeeds');
select is((select max(version_no) from public.icp_config_versions where tenant_id = tests.tid('a')), 4, 'and is number 4');
select is(tests.outcome_as(tests.uid('b_owner'), pg_temp.icp(pg_temp.good_config(), p_tenant => 'b')), 'rows:1', 'tenant B publishes');
select is((select max(version_no) from public.icp_config_versions where tenant_id = tests.tid('b')), 2, 'tenant B is at 2');

-- the hash is computed by the database from the stored config
select ok((select bool_and(config_sha256 = encode(sha256(convert_to(config::text, 'UTF8')), 'hex')) from public.icp_config_versions), 'config_sha256 = sha256 of the stored config');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config, config_sha256) values (gen_random_uuid(), %L, 'icp-rules', 1, %L::jsonb, repeat('0', 64))$q$, tests.tid('a'), pg_temp.good_config())),
  '42501', 'a client cannot supply the hash');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config, version_no) values (gen_random_uuid(), %L, 'icp-rules', 1, %L::jsonb, 99)$q$, tests.tid('a'), pg_temp.good_config())),
  '42501', 'a client cannot choose the version number');
select is(pg_temp.st(format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config, version_no, config_sha256) values (gen_random_uuid(), %L, 'icp-rules', 1, %L::jsonb, 77, repeat('f', 64))$q$, tests.tid('a'), pg_temp.good_config())), 'ok',
  'even a privileged insert gets its number and hash overwritten...');
select is((select max(version_no) from public.icp_config_versions where tenant_id = tests.tid('a')), 5, '...the number is the next one (5), not the value passed (77)');
select ok((select config_sha256 <> repeat('f', 64) from public.icp_config_versions where tenant_id = tests.tid('a') and version_no = 5), '...and the hash is the real one');

-- structure and size of the config
select is(pg_temp.st(pg_temp.icp('[]')), '23514', 'an array is not a config');
select is(pg_temp.st(pg_temp.icp('"text"')), '23514', 'a string is not a config');
select is(pg_temp.st(pg_temp.icp('{}')), '23514', 'an empty object has no factors');
select is(pg_temp.st(pg_temp.icp('{"factors":[]}')), '23514', 'zero factors is refused');
select is(pg_temp.st(pg_temp.icp('{"factors":"x"}')), '23514', 'factors must be an array');
select is(pg_temp.st(pg_temp.icp((select jsonb_build_object('factors', jsonb_agg(jsonb_build_object('id', 'f' || i))) ::text from generate_series(1, 21) i))), '23514', '21 factors is refused');
select is(pg_temp.st(pg_temp.icp((select jsonb_build_object('factors', jsonb_agg(jsonb_build_object('id', 'f' || i))) ::text from generate_series(1, 20) i))), 'ok', '20 factors is accepted');
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'x', 'pad', repeat('p', 32800))))::text)), '23514', 'a config over 32 KB is refused');
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'x', 'pad', repeat('p', 30000))))::text)), 'ok', 'a config just under 32 KB is accepted');
select is(pg_temp.st(pg_temp.icp(pg_temp.good_config(), p_engine => 'Not A Slug')), '23514', 'engine must be a slug');
select is(pg_temp.st(pg_temp.icp(pg_temp.good_config(), p_engine => 'x')), '23514', 'engine: one character is too short');
select is(pg_temp.st(pg_temp.icp(pg_temp.good_config(), p_schema => 0)), '23514', 'schema_version 0 is refused');
select is(pg_temp.st(pg_temp.icp(pg_temp.good_config(), p_schema => 1001)), '23514', 'schema_version 1001 is refused');
select is(pg_temp.st(pg_temp.icp(pg_temp.good_config(), p_engine => '')), '23514', 'an empty engine is refused');

-- hidden Unicode anywhere in the config (values AND keys); legal joiners and Indic text pass
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'a' || chr(8203) || 'b')))::text)), '23514', 'zero-width space in a value');
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'x', 'k' || chr(917536), 'v')))::text)), '23514', 'tag character in a key');
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'x', 'terms', jsonb_build_array('ok', 'bad' || chr(65279)))))::text)), '23514', 'BOM in a nested array');
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'x', 'term', 'a' || chr(1) || 'b')))::text)), '23514', 'a control character (escaped in jsonb text)');
select is(pg_temp.st(pg_temp.icp(jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('id', 'x', 'terms', jsonb_build_array('చీర', 'ಸೀರೆ', 'साड़ी', 'क' || chr(2381) || chr(8205) || 'ष', 'می' || chr(8204) || 'خواهم'))))::text)), 'ok',
  'Telugu, Kannada, Devanagari and Persian with ZWJ / ZWNJ are accepted');

-- append-only
select is(pg_temp.st(format('update public.icp_config_versions set engine = %L where id = %L', 'icp-other', tests.rid('a_icp1'))), '42501', 'a privileged update is refused (trigger)');
select is(pg_temp.st(format('update public.icp_config_versions set config = %L::jsonb where id = %L', pg_temp.good_config(), tests.rid('a_icp1'))), '42501', 'the config cannot be rewritten');
select is(pg_temp.st(format('update public.icp_config_versions set created_by = %L where id = %L', tests.uid('a_owner'), tests.rid('a_icp1'))), '42501', 'created_by cannot be rewritten');
select is(tests.outcome_as(tests.uid('a_owner'), format('update public.icp_config_versions set config = %L::jsonb where id = %L', pg_temp.good_config(), tests.rid('a_icp1'))), '42501', 'an Owner cannot update (no grant)');
select is(tests.outcome_as(tests.uid('a_owner'), format('delete from public.icp_config_versions where id = %L', tests.rid('a_icp1'))), '42501', 'an Owner cannot delete');
select is(tests.outcome_as(tests.uid('a_owner'), 'truncate public.icp_config_versions'), '42501', 'an Owner cannot truncate');

-- roles
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.icp(pg_temp.good_config())), '42501', 'Sales cannot publish');
select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.icp(pg_temp.good_config())), '42501', 'Viewer cannot publish');
select is(tests.outcome_as(tests.uid('outsider'), pg_temp.icp(pg_temp.good_config())), '42501', 'a user with no tenant cannot publish');
select is(tests.outcome_as(null, pg_temp.icp(pg_temp.good_config())), '42501', 'anon cannot publish');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.icp(pg_temp.good_config(), p_tenant => 'b')), '42501', 'a tenant-A Owner cannot publish into tenant B');
select is(tests.outcome_as(tests.uid('dual'), pg_temp.icp(pg_temp.good_config(), p_tenant => 'b')), '42501', 'dual (Viewer of B) cannot publish into B');
select is(tests.outcome_as(tests.uid('dual'), pg_temp.icp(pg_temp.good_config(), p_tenant => 'a')), 'rows:1', 'dual (Owner of A) can publish into A');
select is(tests.outcome_as(tests.uid('a_viewer'), format('select 1 from public.icp_config_versions where id = %L', tests.rid('a_icp1'))), 'rows:1', 'every member reads the versions');
select is(tests.outcome_as(tests.uid('a_owner'), format('select 1 from public.icp_config_versions where id = %L', tests.rid('b_icp1'))), 'rows:0', 'another tenant''s version is invisible');
select is(tests.outcome_as(tests.uid('outsider'), 'select 1 from public.icp_config_versions'), 'rows:0', 'a user with no tenant reads nothing');
select is(tests.outcome_as(null, 'select 1 from public.icp_config_versions'), '42501', 'anon reads nothing');
select is(tests.error_shape_as(tests.uid('a_owner'), format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config) values (%L, %L, 'icp-rules', 1, %L::jsonb)$q$, tests.rid('b_icp1'), tests.tid('a'), pg_temp.good_config())),
  '23505:icp_config_versions_pkey:icp_config_versions', 'reusing a version id fails on the primary key');
select is(tests.error_shape_as(tests.uid('a_owner'), format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config) values (%L, %L, 'icp-rules', 1, %L::jsonb)$q$, tests.rid('a_icp1'), tests.tid('a'), pg_temp.good_config())),
  tests.error_shape_as(tests.uid('a_owner'), format($q$insert into public.icp_config_versions (id, tenant_id, engine, schema_version, config) values (%L, %L, 'icp-rules', 1, %L::jsonb)$q$, tests.rid('b_icp1'), tests.tid('a'), pg_temp.good_config())),
  'a version id of another tenant fails exactly like one of your own (no existence oracle)');

-- audit: attributed to the publisher, version recorded
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'icp_config_version.create' and actor_user_id = tests.uid('a_owner')), 2::bigint,
  'each publish by the Owner is audited with the actor');
select ok((select new_values ->> 'version_no' is not null and new_values ->> 'engine' = 'icp-rules' from public.audit_events
            where tenant_id = tests.tid('a') and action = 'icp_config_version.create' order by id desc limit 1), 'the audit row names the version and engine');

-- ================================================================== lead_labels
create function pg_temp.label(p_cols text, p_vals text, p_tenant text default 'a') returns text
language sql as $$
  select format('insert into public.lead_labels (id, tenant_id, lead_id, %s) values (gen_random_uuid(), %L, %L, %s)',
                p_cols, tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), p_vals)
$$;

select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label', '''good''')), 'rows:1', 'Sales labels a lead Good');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label', '''maybe''')), 'rows:1', '...and the same reviewer may label it again (a changed mind is a new row)');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.label('label, reason_code', '''good'', ''duplicate''')), 'rows:1', 'a reason is optional for Good (any code is accepted)');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.label('label, reason_code', '''maybe'', ''insufficient_info''')), 'rows:1', 'a reason is optional for Maybe');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label', '''bad''')), '23514', 'Bad REQUIRES a reason');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ''not_our_market''')), 'rows:1', 'Bad with a reason is accepted');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ''because I said so''')), '22P02', 'the reason is a fixed list, not free text');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label', '''great''')), '22P02', 'the label is a fixed list');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label', 'null')), '23502', 'the label is required');

select ok((select bool_and(r) from (select (label = 'bad' and reason_code is not null) or label <> 'bad' as r from public.lead_labels) x), 'no Bad label without a reason is stored');

-- every reason code works
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ' || quote_literal(rc))), 'rows:1', 'reason ' || rc)
from unnest(array['not_our_market', 'wrong_product', 'too_small', 'too_large', 'inactive', 'not_a_business', 'no_contact_route', 'already_customer', 'duplicate', 'insufficient_info', 'payment_risk']) rc;
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''good'', ''payment_risk''')), 'rows:1', 'payment_risk is also accepted on a Good label (a reason is optional there)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ''payment risk''')), '22P02', 'the code is exact: "payment risk" with a space is not a reason');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ''PAYMENT_RISK''')), '22P02', 'and codes are case sensitive');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ''slow_payer''')), '22P02', 'an unlisted code (slow_payer) is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, reason_code', '''bad'', ''''')), '22P02', 'an empty code is refused');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.lead_label_reason'::regtype),
  'not_our_market,wrong_product,too_small,too_large,inactive,not_a_business,no_contact_route,already_customer,duplicate,insufficient_info,payment_risk',
  'the reason list is exactly the approved eleven, in order');

-- the score snapshot is all-or-nothing and bounded
create function pg_temp.snap(p_icp text, p_score text, p_max text, p_snapshot text) returns text
language sql as $$
  select pg_temp.label('label, icp_version_id, score, score_max_reachable, snapshot', format('''maybe'', %s, %s, %s, %s', p_icp, p_score, p_max, p_snapshot))
$$;
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '66', '71', '''{"results":[],"features":{"geo":"tier1"}}''::jsonb')), 'rows:1', 'a complete snapshot is accepted');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '0', '0', '''{}''::jsonb')), 'rows:1', 'score 0 / max 0 is accepted');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '100', '100', '''{}''::jsonb')), 'rows:1', 'score 100 / max 100 is accepted');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap('null', 'null', 'null', 'null')), 'rows:1', 'no snapshot at all is accepted (no profile, no score: fail closed)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), 'null', 'null', 'null')), '23514', 'a version without a score is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap('null', '50', '60', '''{}''::jsonb')), '23514', 'a score without a version is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '50', 'null', '''{}''::jsonb')), '23514', 'a score without a maximum is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '50', '60', 'null')), '23514', 'a score without a snapshot is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '71', '70', '''{}''::jsonb')), '23514', 'score above the reachable maximum is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '101', '101', '''{}''::jsonb')), '23514', 'score 101 is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '-1', '5', '''{}''::jsonb')), '23514', 'a negative score is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '50', '60', '''[]''::jsonb')), '23514', 'a snapshot must be an object');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '50', '60', quote_literal(jsonb_build_object('pad', repeat('p', 4200))::text) || '::jsonb')), '23514', 'a snapshot over 4 KB is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '50', '60', quote_literal(jsonb_build_object('reason', 'a' || chr(8203) || 'b')::text) || '::jsonb')), '23514', 'hidden Unicode in a snapshot is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('a_icp1')), '50', '60', quote_literal(jsonb_build_object('reason', 'ok' || chr(8205) || 'ok')::text) || '::jsonb')), 'rows:1', 'a legal joiner in a snapshot is accepted');

-- references are composite: another tenant's lead / version cannot be named, and a foreign id looks like a missing one
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.lead_labels (id, tenant_id, lead_id, label) values (gen_random_uuid(), %L, %L, 'good')$q$, tests.tid('a'), tests.rid('b_lead'))), '23503', 'a label in A on a lead of B -> 23503');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('b_icp1')), '5', '5', '''{}''::jsonb')), '23503', 'a snapshot naming tenant B''s ICP version -> 23503');
select is(
  tests.error_shape_as(tests.uid('a_sales'), format($q$insert into public.lead_labels (id, tenant_id, lead_id, label) values (gen_random_uuid(), %L, %L, 'good')$q$, tests.tid('a'), tests.rid('b_lead'))),
  tests.error_shape_as(tests.uid('a_sales'), format($q$insert into public.lead_labels (id, tenant_id, lead_id, label) values (gen_random_uuid(), %L, %L, 'good')$q$, tests.tid('a'), gen_random_uuid())),
  'a foreign lead id and a nonexistent lead id fail identically');
select is(
  tests.error_shape_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(tests.rid('b_icp1')), '5', '5', '''{}''::jsonb')),
  tests.error_shape_as(tests.uid('a_sales'), pg_temp.snap(quote_literal(gen_random_uuid()), '5', '5', '''{}''::jsonb')),
  'a foreign ICP version id and a nonexistent one fail identically');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.lead_labels (id, tenant_id, lead_id, label) values (gen_random_uuid(), %L, %L, 'good')$q$, tests.tid('b'), tests.rid('b_lead'))), '42501', 'a tenant-A Owner cannot label inside tenant B');

-- provenance is server-owned
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, created_by', format('''good'', %L', tests.uid('a_owner')))), '42501', 'a client cannot name the reviewer');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, created_via', '''good'', ''agent''')), '42501', 'a client cannot declare created_via');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.label('label, created_at', '''good'', now() - interval ''3 days''')), '42501', 'a client cannot declare created_at');
select tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.lead_labels (id, tenant_id, lead_id, label) values (%L, %L, %L, 'good')$q$, tests.rid('l_prov'), tests.tid('a'), tests.rid('a_lead')));
select is((select created_by from public.lead_labels where id = tests.rid('l_prov')), tests.uid('a_sales'), 'the reviewer is the signed-in user');
select is((select created_via::text from public.lead_labels where id = tests.rid('l_prov')), 'manual', 'created_via is manual');
select set_config('app.created_via', 'import', true);
select tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.lead_labels (id, tenant_id, lead_id, label) values (%L, %L, %L, 'good')$q$, tests.rid('l_guc'), tests.tid('a'), tests.rid('a_lead')));
select is((select created_via::text from public.lead_labels where id = tests.rid('l_guc')), 'manual', 'the app.created_via setting is ignored for a signed-in client');
select set_config('app.created_via', '', true);

-- append-only
select is(pg_temp.st(format('update public.lead_labels set label = ''bad'', reason_code = ''duplicate'' where id = %L', tests.rid('a_label'))), '42501', 'a privileged update is refused (trigger)');
select is(pg_temp.st(format('update public.lead_labels set score = 1 where id = %L', tests.rid('a_label'))), '42501', 'the snapshot cannot be rewritten either');
select is(tests.outcome_as(tests.uid('a_sales'), format('update public.lead_labels set label = ''bad'' where id = %L', tests.rid('l_prov'))), '42501', 'a reviewer cannot change their own label (no grant)');
select is(tests.outcome_as(tests.uid('a_owner'), format('delete from public.lead_labels where id = %L', tests.rid('l_prov'))), '42501', 'nobody deletes a label');
select is(tests.outcome_as(tests.uid('a_owner'), 'truncate public.lead_labels'), '42501', 'nobody truncates labels');

-- roles and isolation
select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.label('label', '''good''')), '42501', 'Viewer cannot label');
select is(tests.outcome_as(tests.uid('outsider'), pg_temp.label('label', '''good''')), '42501', 'a user with no tenant cannot label');
select is(tests.outcome_as(null, pg_temp.label('label', '''good''')), '42501', 'anon cannot label');
select is(tests.outcome_as(tests.uid('dual'), pg_temp.label('label', '''good''', 'b')), '42501', 'dual (Viewer of B) cannot label in B');
select is(tests.outcome_as(tests.uid('dual'), pg_temp.label('label', '''good''', 'a')), 'rows:1', 'dual (Owner of A) can label in A');
select is(tests.outcome_as(tests.uid('a_viewer'), format('select 1 from public.lead_labels where id = %L', tests.rid('a_label'))), 'rows:1', 'every member reads labels');
select is(tests.outcome_as(tests.uid('a_sales'), format('select 1 from public.lead_labels where id = %L', tests.rid('b_label'))), 'rows:0', 'another tenant''s label is invisible');
select is(tests.outcome_as(tests.uid('outsider'), 'select 1 from public.lead_labels'), 'rows:0', 'a user with no tenant reads no labels');

-- audit: enums and numbers are not personal data, so they are audited with their values
select ok((select new_values ->> 'label' = 'bad' and new_values ->> 'reason_code' = 'duplicate' and actor_user_id = tests.uid('a_sales')
             from public.audit_events where entity_id = (select id from public.lead_labels where label = 'bad' and reason_code = 'duplicate' and created_by = tests.uid('a_sales') limit 1)
              and action = 'lead_label.create'),
  'a label is audited with its label, reason and reviewer');
select is((select count(*) from public.audit_events where entity_type = 'lead_label' and to_jsonb(audit_events)::text ~* 'pii_fields_changed.*\[\"'), 0::bigint, 'a label has no PII columns to name');

-- ================================================================== data_exports
create function pg_temp.exp(p_cols text, p_vals text, p_tenant text default 'a') returns text
language sql as $$
  select format('insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256 %s) values (gen_random_uuid(), %L, ''lead_labels'', ''csv'', 5, repeat(''a'', 64) %s)',
                p_cols, tests.tid(p_tenant), p_vals)
$$;
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.exp('', '')), 'rows:1', 'an Owner records an export');
select is(tests.outcome_as(tests.uid('a_admin'), pg_temp.exp('', '')), 'rows:1', 'an Admin records an export');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.exp('', '')), '42501', 'Sales cannot export');
select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.exp('', '')), '42501', 'Viewer cannot export');
select is(tests.outcome_as(null, pg_temp.exp('', '')), '42501', 'anon cannot');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.exp('', '', 'b')), '42501', 'a tenant-A Owner cannot record an export in B');
select is(tests.outcome_as(tests.uid('a_owner'), 'select 1 from public.data_exports'), 'rows:2', 'an Owner reads the export log (2 rows)');
select is(tests.outcome_as(tests.uid('a_sales'), 'select 1 from public.data_exports'), 'rows:0', 'Sales does not see who exported what');
select is(tests.outcome_as(tests.uid('a_viewer'), 'select 1 from public.data_exports'), 'rows:0', 'Viewer does not either');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'lead_labels', 'csv', 10000, repeat('b', 64))$q$, tests.tid('a'))), 'ok', 'the cap itself (10000 rows) is accepted');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'lead_labels', 'csv', 10001, repeat('b', 64))$q$, tests.tid('a'))), '23514', '10001 rows is refused');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'lead_labels', 'csv', -1, repeat('b', 64))$q$, tests.tid('a'))), '23514', 'a negative count is refused');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'lead_labels', 'csv', 1, 'xyz')$q$, tests.tid('a'))), '23514', 'the hash must be 64 hex characters');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'everything', 'csv', 1, repeat('b', 64))$q$, tests.tid('a'))), '22P02', 'the kind is a fixed list');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'lead_labels', 'xlsx', 1, repeat('b', 64))$q$, tests.tid('a'))), '22P02', 'the format is a fixed list');
select is(pg_temp.st(format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256) values (gen_random_uuid(), %L, 'lead_labels', 'json', 1, repeat('b', 64))$q$, tests.tid('a'))), 'ok', 'json is a format');
select is(tests.outcome_as(tests.uid('a_owner'), format('update public.data_exports set row_count = 1 where tenant_id = %L', tests.tid('a'))), '42501', 'an export record cannot be edited');
select is(pg_temp.st(format('update public.data_exports set row_count = 1 where tenant_id = %L', tests.tid('a'))), '42501', 'not even by a privileged update');
select is(tests.outcome_as(tests.uid('a_owner'), format('delete from public.data_exports where tenant_id = %L', tests.tid('a'))), '42501', 'nor deleted');
select ok(exists (select 1 from public.data_exports where tenant_id = tests.tid('a') and created_by = tests.uid('a_owner') and created_via = 'manual')
      and exists (select 1 from public.data_exports where tenant_id = tests.tid('a') and created_by = tests.uid('a_admin') and created_via = 'manual'), 'who exported is recorded by the server');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$insert into public.data_exports (id, tenant_id, kind, format, row_count, content_sha256, created_by) values (gen_random_uuid(), %L, 'lead_labels', 'csv', 1, repeat('c', 64), %L)$q$, tests.tid('a'), tests.uid('a_admin'))), '42501', 'a client cannot name the exporter');
select ok(exists (select 1 from public.audit_events where tenant_id = tests.tid('a') and action = 'data_export.create' and actor_user_id = tests.uid('a_owner')), 'an export record is audited');

select * from finish();
rollback;
