-- T004 hardening: invisible Unicode in free text (ADR 0008). app.text_is_clean is the one shared
-- definition; every free-text column of every tenant-owned table is guarded by it (the catalog
-- guard in 06 proves coverage, this file proves behaviour):
--   A  the function: properties and the exact character set
--   B  real columns, as the privileged session AND as an authenticated client
--   C  catalog-driven: EVERY guarded column rejects a dirty value
--   D  the audit writer drops a dirty X-Request-Id
begin;
select no_plan();
select tests.seed_two_tenants();
-- These tests exercise the table CHECKs themselves. The real-data gate (a trigger on contacts) refuses first while a workspace is closed, so it is
-- switched off here for the transaction; its own behaviour is tested in 45_real_data_gate.test.sql.
alter table public.contacts disable trigger contacts_guard_real_data;
select tests.seed_crm();
select tests.seed_evidence();

-- ============================================================================ A. the function
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname = 'text_is_clean'), 3::bigint,
  'text_is_clean exists for text, text[] and jsonb');
select is((select string_agg(distinct provolatile::text, ',') from pg_proc where pronamespace = 'app'::regnamespace and proname = 'text_is_clean'),
  'i', 'all overloads are IMMUTABLE');
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname = 'text_is_clean'
             and 'search_path=""' = any (proconfig)), 3::bigint, 'all overloads pin search_path to empty');
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname = 'text_is_clean'
             and not prosecdef), 3::bigint, 'all overloads are SECURITY INVOKER (they read nothing)');
select ok(has_function_privilege('authenticated', 'app.text_is_clean(text)', 'execute'), 'authenticated may execute it (CHECKs run as the inserting role)');
select ok(not has_function_privilege('anon', 'app.text_is_clean(text)', 'execute'), 'anon may not');

-- every code point that must be refused (the old set and the new set)
select is(app.text_is_clean('ab' || chr(cp) || 'cd'), false, 'blocked: U+' || to_hex(cp))
from unnest(array[
  1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 27, 31,              -- C0 controls (not tab, LF, CR)
  127, 128, 133, 150, 159,                                    -- DEL and C1
  8203,                                                       -- zero-width space
  8232, 8233,                                                 -- line / paragraph separator
  8234, 8235, 8236, 8237, 8238,                               -- bidi embeddings / overrides
  8288, 8289, 8290, 8291, 8292,                               -- word joiner, invisible operators
  8294, 8295, 8296, 8297,                                     -- bidi isolates
  65279,                                                      -- BOM / zero-width no-break space
  917504, 917505, 917536, 917630, 917631                      -- tag characters (E0000, E0001, E0020, E007E, E007F)
]) cp;

-- every code point that must stay legal
select is(app.text_is_clean('ab' || chr(cp) || 'cd'), true, 'allowed: U+' || to_hex(cp))
from unnest(array[
  9, 10, 13, 32,                                              -- tab, LF, CR, space
  160, 173,                                                   -- NBSP, soft hyphen (not requested)
  8204, 8205,                                                 -- ZWNJ, ZWJ (Indic / Persian scripts)
  8206, 8207,                                                 -- LRM, RLM
  8287, 8293, 8310,                                           -- neighbours of the blocked ranges
  8231, 8234 + 100,                                           -- just outside the separators / embeddings
  917503, 917632,                                             -- one below E0000, one above E007F
  65278, 65280                                                -- one below / above the BOM
]) cp;

select is(app.text_is_clean(null::text), true, 'NULL is clean (CHECK semantics: NULL passes)');
select is(app.text_is_clean(''), true, 'empty is clean');
select is(app.text_is_clean('Plain ASCII, digits 123 and punctuation !?'), true, 'plain text is clean');
select is(app.text_is_clean(E'line one\r\n\tline two'), true, 'tab / LF / CR are clean');
select is(app.text_is_clean('क' || chr(2381) || chr(8205) || 'ष'), true, 'Devanagari conjunct with ZWJ is clean');
select is(app.text_is_clean('नमस्ते, यह रेशमी साड़ी है'), true, 'Devanagari text is clean');
select is(app.text_is_clean('తెలుగు పట్టు చీర'), true, 'Telugu text is clean');
select is(app.text_is_clean('مرحبا بكم في متجرنا'), true, 'Arabic text is clean');
select is(app.text_is_clean('می' || chr(8204) || 'خواهم'), true, 'Persian text with ZWNJ is clean');
select is(app.text_is_clean('தமிழ் பட்டுப் புடவை'), true, 'Tamil text is clean');
select is(app.text_is_clean('abc' || chr(8206) || chr(8207) || 'def'), true, 'LRM / RLM are clean');
select is(app.text_is_clean('Köln ✓ 日本語 😀'), true, 'other scripts and emoji are clean');

select is(app.text_is_clean(array['ok', 'also ok']), true, 'text[]: clean elements');
select is(app.text_is_clean(array['ok', 'bad' || chr(8203)]), false, 'text[]: one dirty element fails the array');
select is(app.text_is_clean(array['ok', 'bad' || chr(917536)]), false, 'text[]: tag character in an element');
select is(app.text_is_clean(array[]::text[]), true, 'text[]: empty array is clean');
select is(app.text_is_clean(jsonb_build_object('k', 'v', 'n', 'क' || chr(8205) || 'ष')), true, 'jsonb: clean values');
select is(app.text_is_clean(jsonb_build_object('k', 'bad' || chr(8203))), false, 'jsonb: dirty value');
select is(app.text_is_clean(jsonb_build_object('bad' || chr(917536), 'v')), false, 'jsonb: dirty KEY');
select is(app.text_is_clean(jsonb_build_object('k', jsonb_build_array('x', 'y' || chr(65279)))), false, 'jsonb: dirty value nested in an array');
select is(app.text_is_clean(jsonb_build_object('k', 'a' || chr(cp) || 'b')), false, 'jsonb: C0 control U+' || to_hex(cp) || ' (appears escaped in the text form)')
from unnest(array[1, 2, 7, 8, 11, 12, 14, 27, 31]) cp;
select is(app.text_is_clean(jsonb_build_object('a' || chr(1), 'v')), false, 'jsonb: C0 control in a KEY');
select is(app.text_is_clean(jsonb_build_object('k', E'tab\there\nnew\rline')), true, 'jsonb: tab / LF / CR are clean');
select is(app.text_is_clean(jsonb_build_object('k', 'C:\bin\fonts')), true, 'jsonb: a literal backslash followed by b or f is clean');
select is(app.text_is_clean(jsonb_build_object('k', '\u0001 typed as text')), true, 'jsonb: the six characters backslash-u-0-0-0-1 typed as text are clean');
select is(app.text_is_clean(jsonb_build_object('k', E'\\' || chr(8))), false, 'jsonb: an escaped backslash followed by a REAL backspace is still caught');

-- ============================================================================ B. real columns
-- Each case: a builder that puts the value into one column; run as the privileged session AND as a
-- tenant-A Sales user (CHECKs run as the inserting role, which needs EXECUTE on the function).
create function pg_temp.b_company_name(v text) returns text language sql as $$
  select format($q$insert into public.companies (id, tenant_id, name) values (gen_random_uuid(), %L, %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_company_tags(v text) returns text language sql as $$
  select format($q$insert into public.companies (id, tenant_id, name, tags) values (gen_random_uuid(), %L, 'Tagged', array[%L, 'second'])$q$, tests.tid('a'), v) $$;
create function pg_temp.b_company_website(v text) returns text language sql as $$
  select format($q$insert into public.companies (id, tenant_id, name, website) values (gen_random_uuid(), %L, 'Site', %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_contact_name(v text) returns text language sql as $$
  select format($q$insert into public.contacts (id, tenant_id, full_name) values (gen_random_uuid(), %L, %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_contact_job(v text) returns text language sql as $$
  select format($q$insert into public.contacts (id, tenant_id, full_name, job_title) values (gen_random_uuid(), %L, 'Person', %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_product_desc(v text) returns text language sql as $$
  select format($q$insert into public.products (id, tenant_id, sku, name, description) values (gen_random_uuid(), %L, 'D-' || left(md5(random()::text), 10), 'P', %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_product_attr(v text) returns text language sql as $$
  select format($q$insert into public.products (id, tenant_id, sku, name, attributes) values (gen_random_uuid(), %L, 'A-' || left(md5(random()::text), 10), 'P', jsonb_build_object('colour', %L::text))$q$, tests.tid('a'), v) $$;
create function pg_temp.b_lead_source(v text) returns text language sql as $$
  select format($q$insert into public.leads (id, tenant_id, source) values (gen_random_uuid(), %L, %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_opp_title(v text) returns text language sql as $$
  select format($q$insert into public.opportunities (id, tenant_id, company_id, title) values (gen_random_uuid(), %L, %L, %L)$q$, tests.tid('a'), tests.rid('a_company'), v) $$;
create function pg_temp.b_snippet(v text) returns text language sql as $$
  select format($q$insert into public.evidence (id, tenant_id, kind, provider, url, snippet) values (gen_random_uuid(), %L, 'web_page', 'manual', 'https://example.test/h', %L)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_url(v text) returns text language sql as $$
  select format($q$insert into public.evidence (id, tenant_id, kind, provider, url) values (gen_random_uuid(), %L, 'web_page', 'manual', 'https://example.test/' || %L::text)$q$, tests.tid('a'), v) $$;
create function pg_temp.b_claim_value(v text) returns text language sql as $$
  select format($q$insert into public.claims (id, tenant_id, company_id, predicate, value, confidence) values (gen_random_uuid(), %L, %L, 'exports_to', %L, 'low')$q$, tests.tid('a'), tests.rid('a_company'), v) $$;

create function pg_temp.hygiene_cases(p_builder text, p_client text default 'a_sales') returns setof text
language plpgsql as $$
declare
  c record;
  v_sql text;
  v_priv text;
  v_client text;
begin
  for c in
    select * from (values
      ('tag character U+E0020',         'x' || chr(917536) || 'y',                         '23514'),
      ('tag character U+E0001 (language tag)', 'x' || chr(917505),                        '23514'),
      ('zero-width space',              'x' || chr(8203) || 'y',                           '23514'),
      ('BOM / ZWNBSP',                  chr(65279) || 'x',                                 '23514'),
      ('line separator U+2028',         'x' || chr(8232) || 'y',                           '23514'),
      ('paragraph separator U+2029',    'x' || chr(8233) || 'y',                           '23514'),
      ('word joiner U+2060',            'x' || chr(8288) || 'y',                           '23514'),
      ('invisible times U+2062',        'x' || chr(8290) || 'y',                           '23514'),
      ('bidi override U+202E',          'x' || chr(8238) || 'y',                           '23514'),
      ('control U+0001',                'x' || chr(1) || 'y',                              '23514'),
      ('ZWJ (Devanagari conjunct)',     'क' || chr(2381) || chr(8205) || 'ष',               'ok'),
      ('ZWNJ (Persian)',                'می' || chr(8204) || 'خواهم',                      'ok'),
      ('Devanagari',                    'रेशमी साड़ी',                                     'ok'),
      ('Telugu',                        'పట్టు చీర',                                       'ok'),
      ('Arabic',                        'حرير هندي',                                       'ok'),
      ('LRM / RLM',                     'x' || chr(8206) || 'y' || chr(8207),              'ok'),
      ('plain ascii',                   'plain text',                                      'ok')
    ) as t(label, value, expect)
  loop
    execute format('select pg_temp.%I(%L)', p_builder, c.value) into v_sql;
    v_priv := split_part((select pg_temp.shape(v_sql)), ':', 1);
    v_client := tests.outcome_as(tests.uid(p_client), v_sql);
    return next is(v_priv, c.expect, p_builder || ' [privileged] ' || c.label);
    return next is(case when v_client = 'rows:1' then 'ok' else v_client end, c.expect, p_builder || ' [' || p_client || '] ' || c.label);
  end loop;
end $$;

create function pg_temp.shape(p_sql text) returns text
language plpgsql as $$
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate;
  end;
end $$;

select pg_temp.hygiene_cases(b) from unnest(array[
  'b_company_name', 'b_company_tags', 'b_company_website', 'b_contact_name', 'b_contact_job',
  'b_lead_source', 'b_opp_title', 'b_snippet', 'b_claim_value']) b;
-- products are an Owner / Admin table
select pg_temp.hygiene_cases(b, 'a_admin') from unnest(array['b_product_desc', 'b_product_attr']) b;

-- url and the e-mail / phone columns keep their own format rules and add the hygiene rule
select is(pg_temp.shape(pg_temp.b_url('x' || chr(8203))), '23514', 'url: zero-width space in the path is refused');
select is(pg_temp.shape(pg_temp.b_url('x' || chr(917536))), '23514', 'url: tag character in the path is refused');
select is(pg_temp.shape(pg_temp.b_url('x' || chr(65279))), '23514', 'url: BOM in the path is refused');
select is(pg_temp.shape(pg_temp.b_url('page-क' || chr(8205) || 'ष')), 'ok', 'url: ZWJ in an IRI path is accepted');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.b_url('x' || chr(8232))), '23514', 'url: line separator refused for a client');
select is(pg_temp.shape(format($q$insert into public.contacts (tenant_id, full_name, email) values (%L, 'E', %L)$q$, tests.tid('a'), 'a' || chr(8203) || 'b@example.test')),
  '23514', 'contact e-mail: zero-width space refused');
select is(pg_temp.shape(format($q$insert into public.contacts (tenant_id, full_name, phone) values (%L, 'P', %L)$q$, tests.tid('a'), '+9' || chr(8203) || '1234')),
  '23514', 'contact phone: zero-width space refused');

-- ======================================================================= C. catalog-driven
-- EVERY column guarded by text_is_clean, enumerated from the catalog, rejects a dirty value, and
-- the error names a text_is_clean constraint of that column. (Updates on a fixture row, with the
-- append-only trigger of the evidence tables switched off inside this rolled-back transaction.)
alter table public.evidence disable trigger user;
alter table public.claims disable trigger user;

create function pg_temp.catalog_checks() returns setof text
language plpgsql as $$
declare
  r record;
  v_dirty text := 'ab' || chr(8203) || 'cd';
  v_val text;
  v_constraint text;
  v_state text;
  n int := 0;
begin
  for r in
    select c.oid as relid, c.relname, a.attnum, a.attname, a.atttypid::regtype::text as typ,
           (select array_agg(k.conname::text) from pg_constraint k
             where k.conrelid = c.oid and k.contype = 'c' and a.attnum = any (k.conkey)
               and pg_get_constraintdef(k.oid) like '%text_is_clean(%') as names
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' and c.relkind = 'r'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where exists (select 1 from pg_attribute t where t.attrelid = c.oid and t.attname = 'tenant_id' and not t.attisdropped)
       and c.relname in ('companies', 'contacts', 'products', 'leads', 'opportunities', 'evidence', 'claims')
     order by c.relname, a.attnum
  loop
    continue when r.names is null;
    n := n + 1;
    v_val := case
      when r.attname = 'email' then 'ab' || chr(8203) || '@example.test'
      when r.attname = 'phone' then '+9' || chr(8203) || '1234'
      when r.attname = 'url'   then 'https://example.test/' || chr(8203)
      else v_dirty end;
    begin
      if r.relname = 'opportunities' and r.attname = 'lost_reason' then
        -- a reason only exists while the opportunity is lost (a table CHECK)
        execute format('update public.opportunities set status = ''lost'', lost_reason = %L where ctid = (select ctid from public.opportunities where tenant_id = %L limit 1)', v_val, tests.tid('a'));
      elsif r.typ = 'text[]' then
        execute format('update public.%I set %I = array[%L, %L]::text[] where ctid = (select ctid from public.%I where tenant_id = %L limit 1)',
                       r.relname, r.attname, 'x', v_val, r.relname, tests.tid('a'));
      elsif r.typ = 'jsonb' then
        execute format('update public.%I set %I = jsonb_build_object(%L, %L::text) where ctid = (select ctid from public.%I where tenant_id = %L limit 1)',
                       r.relname, r.attname, 'k', v_val, r.relname, tests.tid('a'));
      else
        execute format('update public.%I set %I = %L where ctid = (select ctid from public.%I where tenant_id = %L limit 1)',
                       r.relname, r.attname, v_val, r.relname, tests.tid('a'));
      end if;
      v_state := 'accepted'; v_constraint := '';
    exception when others then
      get stacked diagnostics v_constraint = constraint_name;
      v_state := sqlstate;
    end;
    return next ok(v_state = '23514' and v_constraint = any (r.names),
      r.relname || '.' || r.attname || ': a dirty value is refused by ' || array_to_string(r.names, '/') || ' (got ' || v_state || ' ' || coalesce(v_constraint, '') || ')');
  end loop;
  return next cmp_ok(n, '>=', 24, 'the catalog loop found 24+ guarded columns (not vacuous)');
end $$;

select * from pg_temp.catalog_checks();

alter table public.evidence enable trigger user;
alter table public.claims enable trigger user;

-- the constraint set is exactly: every non-exempt column, nothing else carries a stale name
select is(
  (select count(*) from pg_constraint k join pg_class c on c.oid = k.conrelid and c.relnamespace = 'public'::regnamespace
    where k.contype = 'c' and k.conname like '%\_clean' and pg_get_constraintdef(k.oid) not like '%text_is_clean(%'),
  0::bigint, 'every *_clean constraint really calls text_is_clean');

-- ================================================================== D. audit request_id
select set_config('request.headers', json_build_object('x-request-id', 'req-abc-123')::text, true);
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.companies (id, tenant_id, name) values (%L, %L, 'Audited One')$q$, tests.rid('h1'), tests.tid('a'))), 'rows:1', 'setup: audited insert with a clean request id');
select is((select request_id from public.audit_events where entity_id = tests.rid('h1') and action = 'company.create'), 'req-abc-123', 'a clean X-Request-Id is stored');

select set_config('request.headers', json_build_object('x-request-id', 'req-' || chr(8203) || 'evil')::text, true);
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.companies (id, tenant_id, name) values (%L, %L, 'Audited Two')$q$, tests.rid('h2'), tests.tid('a'))), 'rows:1', 'setup: audited insert with a dirty request id');
select is((select request_id from public.audit_events where entity_id = tests.rid('h2') and action = 'company.create'), null, 'a dirty X-Request-Id is dropped, not stored');

select set_config('request.headers', json_build_object('x-request-id', 'tag' || chr(917536) || 'x')::text, true);
select is(tests.outcome_as(tests.uid('a_sales'), format($q$insert into public.companies (id, tenant_id, name) values (%L, %L, 'Audited Three')$q$, tests.rid('h3'), tests.tid('a'))), 'rows:1', 'setup: a request id with a tag character');
select is((select request_id from public.audit_events where entity_id = tests.rid('h3') and action = 'company.create'), null, '... is dropped too');
select is((select count(*) from public.audit_events where request_id is not null and not app.text_is_clean(request_id)), 0::bigint, 'no stored request_id contains invisible characters');

select * from finish();
rollback;
