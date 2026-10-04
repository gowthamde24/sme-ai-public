-- T004 / milestone 2: public.create_evidence_with_link. SECURITY INVOKER: it gives a caller exactly
-- the power the tables already give them (RLS, column grants, CHECKs, triggers), atomically.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_evidence();

-- ============================================================================ properties
select has_function('public', 'create_evidence_with_link', 'the function exists');
select is((select prosecdef from pg_proc where oid = 'public.create_evidence_with_link(uuid,uuid,uuid,text,uuid,public.evidence_kind,text,text,text,text,timestamptz,timestamptz)'::regprocedure),
  false, 'it is SECURITY INVOKER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where proname = 'create_evidence_with_link'), 'it pins search_path to empty');
select ok(has_function_privilege('authenticated', 'public.create_evidence_with_link(uuid,uuid,uuid,text,uuid,public.evidence_kind,text,text,text,text,timestamptz,timestamptz)', 'execute'), 'authenticated may execute it');
select ok(not has_function_privilege('anon', 'public.create_evidence_with_link(uuid,uuid,uuid,text,uuid,public.evidence_kind,text,text,text,text,timestamptz,timestamptz)', 'execute'), 'anon may not');
select is((select count(*) from pg_proc where proname = 'create_evidence_with_link'), 1::bigint, 'exactly one overload');
select is((select prorettype::regtype::text from pg_proc where proname = 'create_evidence_with_link'), 'uuid', 'it returns the link id');
select ok(not exists (select 1 from pg_proc p where p.proname = 'create_evidence_with_link' and pg_get_functiondef(p.oid) ~* 'security\s+definer'), 'its body never declares SECURITY DEFINER');

create function pg_temp.call(p_user text, p_tenant text, p_kind text, p_target uuid, p_ev uuid, p_link uuid, p_extra text default '') returns text
language sql as $$
  select tests.outcome_as(case when p_user = 'anon' then null else tests.uid(p_user) end, format(
    $q$select public.create_evidence_with_link(%L, %L, %L, %L, %L, 'web_page', 'manual', 'https://example.test/rpc' %s)$q$,
    tests.tid(p_tenant), p_ev, p_link, p_kind, p_target, p_extra))
$$;
create function pg_temp.n(p_table text, p_id uuid) returns bigint
language plpgsql as $$ declare r bigint; begin execute format('select count(*) from public.%I where id = %L', p_table, p_id) into r; return r; end $$;

-- ============================================================================ roles
select is(pg_temp.call('a_owner',  'a', 'company', tests.rid('a_company'), tests.rid('e_owner'), tests.rid('l_owner')), 'rows:1', 'Owner can create (company target)');
select is(pg_temp.call('a_admin',  'a', 'company', tests.rid('a_company'), tests.rid('e_admin'), tests.rid('l_admin')), 'rows:1', 'Admin can create');
select is(pg_temp.call('a_sales',  'a', 'lead',    tests.rid('a_lead'),    tests.rid('e_sales'), tests.rid('l_sales')), 'rows:1', 'Sales can create (lead target)');
select is(pg_temp.call('a_viewer', 'a', 'company', tests.rid('a_company'), tests.rid('e_viewer'), tests.rid('l_viewer')), '42501', 'Viewer cannot');
select is(pg_temp.call('outsider', 'a', 'company', tests.rid('a_company'), tests.rid('e_out'), tests.rid('l_out')), '42501', 'a user with no tenant cannot');
select is(pg_temp.call('anon',     'a', 'company', tests.rid('a_company'), tests.rid('e_anon'), tests.rid('l_anon')), '42501', 'anon cannot (no EXECUTE)');
select is(pg_temp.call('a_owner',  'b', 'company', tests.rid('b_company'), tests.rid('e_x1'), tests.rid('l_x1')), '42501', 'a tenant-A owner cannot write into tenant B');
select is(pg_temp.call('b_sales',  'a', 'company', tests.rid('a_company'), tests.rid('e_x2'), tests.rid('l_x2')), '42501', 'a tenant-B sales user cannot write into tenant A');
select is(pg_temp.call('dual',     'a', 'company', tests.rid('a_company'), tests.rid('e_dual_a'), tests.rid('l_dual_a')), 'rows:1', 'dual: Owner of A can');
select is(pg_temp.call('dual',     'b', 'company', tests.rid('b_company'), tests.rid('e_dual_b'), tests.rid('l_dual_b')), '42501', 'dual: Viewer of B cannot');

-- refused calls leave nothing behind
select is(pg_temp.n('evidence', tests.rid('e_viewer')) + pg_temp.n('evidence', tests.rid('e_out')) + pg_temp.n('evidence', tests.rid('e_anon'))
        + pg_temp.n('evidence', tests.rid('e_x1')) + pg_temp.n('evidence', tests.rid('e_x2')) + pg_temp.n('evidence', tests.rid('e_dual_b')),
  0::bigint, 'no evidence row exists for any refused call');
select is(pg_temp.n('evidence_links', tests.rid('l_viewer')) + pg_temp.n('evidence_links', tests.rid('l_x1')) + pg_temp.n('evidence_links', tests.rid('l_dual_b')),
  0::bigint, 'no link row exists for any refused call');

-- ============================================================================ what a successful call stores
select results_eq(
  format($$select e.created_via::text, e.created_by, e.provider, e.kind::text, e.url, e.archived_at is null, l.company_id, l.lead_id, l.claim_id, l.stance is null, l.created_via::text, l.created_by
             from public.evidence e join public.evidence_links l on l.evidence_id = e.id where e.id = %L$$, tests.rid('e_owner')),
  format($$values ('manual'::text, %L::uuid, 'manual'::text, 'web_page'::text, 'https://example.test/rpc'::text, true, %L::uuid, null::uuid, null::uuid, true, 'manual'::text, %L::uuid)$$,
         tests.uid('a_owner'), tests.rid('a_company'), tests.uid('a_owner')),
  'evidence and link carry created_via = manual and created_by = the caller; the company is the target; no stance');
select results_eq(
  format($$select l.lead_id, l.company_id from public.evidence_links l where l.id = %L$$, tests.rid('l_sales')),
  format($$values (%L::uuid, null::uuid)$$, tests.rid('a_lead')), 'a lead target fills lead_id only');
select ok((select abs(extract(epoch from retrieved_at - now())) < 5 from public.evidence where id = tests.rid('e_owner')), 'retrieved_at defaults to now()');
select is(pg_temp.call('a_sales', 'a', 'company', tests.rid('a_company'), tests.rid('e_dates'), tests.rid('l_dates'),
  $x$, null, null, '2026-03-04T05:06:07Z', '2026-03-01T00:00:00Z'$x$), 'rows:1', 'retrieved_at and published_at can be supplied');
select ok((select retrieved_at = '2026-03-04T05:06:07Z' and published_at = '2026-03-01T00:00:00Z' from public.evidence where id = tests.rid('e_dates')), '... and are kept');

-- audited like any other insert, with the caller as actor and PII by name only
select is((select count(*) from public.audit_events where entity_id in (tests.rid('e_owner'), tests.rid('l_owner')) and actor_user_id = tests.uid('a_owner')), 2::bigint,
  'the evidence and the link are both audited, attributed to the caller');
select is((select (metadata -> 'pii_fields_changed')::text from public.audit_events where entity_id = tests.rid('e_owner') and action = 'evidence.create'), '["url"]', 'only the field NAME of the url is audited');

-- ============================================================================ atomicity
-- a foreign target (tenant B's company named from tenant A) fails the link insert: the evidence
-- insert that came before it is rolled back too
select is(pg_temp.call('a_sales', 'a', 'company', tests.rid('b_company'), tests.rid('e_atomic'), tests.rid('l_atomic')), '23503', 'a foreign target -> 23503');
select is(pg_temp.n('evidence', tests.rid('e_atomic')), 0::bigint, 'atomic: no evidence row was left behind');
select is(pg_temp.n('evidence_links', tests.rid('l_atomic')), 0::bigint, 'atomic: no link row either');
select is(pg_temp.call('a_sales', 'a', 'lead', tests.rid('b_lead'), tests.rid('e_atomic2'), tests.rid('l_atomic2')), '23503', 'a foreign lead target -> 23503');
select is(pg_temp.n('evidence', tests.rid('e_atomic2')), 0::bigint, 'atomic (lead): no evidence row left behind');
select is(tests.error_shape_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, %L, %L, 'company', %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.tid('a'), gen_random_uuid(), gen_random_uuid(), tests.rid('b_company'))),
  tests.error_shape_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, %L, %L, 'company', %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.tid('a'), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())),
  'a foreign target and a nonexistent target fail identically (no existence oracle)');

-- ============================================================================ the table rules apply inside
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'note', 'manual', null, null, 'only a snippet')$q$, tests.tid('a'), tests.rid('a_company'))), '23514', 'neither url nor reference -> 23514');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'javascript:alert(1)')$q$, tests.tid('a'), tests.rid('a_company'))), '23514', 'a javascript: url -> 23514');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x', null, %L)$q$, tests.tid('a'), tests.rid('a_company'), 'a' || chr(8203) || 'b')), '23514', 'a zero-width space in the snippet -> 23514');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x', null, %L)$q$, tests.tid('a'), tests.rid('a_company'), 'a' || chr(917536) || 'b')), '23514', 'a tag character in the snippet -> 23514');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x', null, null, now() + interval '1 day')$q$, tests.tid('a'), tests.rid('a_company'))), '23514', 'retrieved_at in the future -> 23514 (the INSERT trigger)');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'Not A Slug', 'https://example.test/x')$q$, tests.tid('a'), tests.rid('a_company'))), '23514', 'a provider that is not a slug -> 23514');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'carrier_pigeon', 'manual', 'https://example.test/x')$q$, tests.tid('a'), tests.rid('a_company'))), '22P02', 'an unknown kind -> 22P02');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x', 'doc:x y')$q$, tests.tid('a'), tests.rid('a_company'))), '23514', 'a malformed reference -> 23514');

-- ============================================================================ the function's own refusals (22023)
select is(pg_temp.call('a_sales', 'a', 'claim', tests.rid('a_claim'), gen_random_uuid(), gen_random_uuid()), '22023', 'claims cannot be reached through the function');
select is(pg_temp.call('a_sales', 'a', 'contact', tests.rid('a_contact'), gen_random_uuid(), gen_random_uuid()), '22023', 'contacts are not link targets');
select is(pg_temp.call('a_sales', 'a', 'opportunity', tests.rid('a_opp'), gen_random_uuid(), gen_random_uuid()), '22023', 'opportunities are not link targets');
select is(pg_temp.call('a_sales', 'a', 'Company', tests.rid('a_company'), gen_random_uuid(), gen_random_uuid()), '22023', 'the target kind is exact');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, null, gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.tid('a'), tests.rid('a_company'))), '22023', 'a NULL evidence id -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(null, gen_random_uuid(), gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.rid('a_company'))), '22023', 'a NULL tenant -> 22023');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, gen_random_uuid(), gen_random_uuid(), null, %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.tid('a'), tests.rid('a_company'))), '22023', 'a NULL target kind -> 22023');

-- ============================================================================ duplicates and idempotency building blocks
select is(tests.error_shape_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, %L, gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.tid('a'), tests.rid('e_owner'), tests.rid('a_company'))),
  '23505:evidence_pkey:evidence', 'the same evidence id again -> 23505 on evidence_pkey');
select is(tests.error_shape_as(tests.uid('a_sales'), format($q$select public.create_evidence_with_link(%L, %L, gen_random_uuid(), 'company', %L, 'web_page', 'manual', 'https://example.test/x')$q$, tests.tid('a'), tests.rid('b_evidence'), tests.rid('a_company'))),
  '23505:evidence_pkey:evidence', 'an evidence id owned by ANOTHER tenant fails the same way');
select is(pg_temp.n('evidence', tests.rid('b_evidence')), 1::bigint, '... and tenant B''s row is untouched');

-- ============================================================================ no extra power, by catalog
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname = 'create_evidence_with_link'), 0::bigint, 'never SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.create_evidence_with_link(uuid,uuid,uuid,text,uuid,public.evidence_kind,text,text,text,text,timestamptz,timestamptz)', 'execute'), 'anon cannot execute (re-checked)');
-- archived targets are not special to the function: the table rules decide (API refuses earlier)
select is(tests.outcome_as(tests.uid('a_admin'), format('update public.companies set archived_at = now() where id = %L', tests.rid('a_company'))), 'rows:1', 'setup: archive the company');
select is(pg_temp.call('a_sales', 'a', 'company', tests.rid('a_company'), tests.rid('e_arch'), tests.rid('l_arch')), 'rows:1', 'the database does not forbid evidence on an archived company (the API does)');

select * from finish();
rollback;
