-- T006b M1 (ADR 0014): the erasure registry is the guard that makes "a PII column nobody handled" a failing build.
--   * every column commented 'PII:' has a registry row (and, for text, a sweep row; for the tenant scope, a row or an explicit exemption)
--   * every registry row names a real column that is 'PII:' (or marked extra)
--   * a null strategy only on a nullable column; a tombstone strategy only on text
--   * the fixture planter (tests.er_plant) really plants something in EVERY registered column, so the canary tests cannot pass vacuously
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

select ok(to_regclass('erasure.registry') is not null, 'erasure.registry exists');
select ok(to_regclass('public.erasure_requests') is not null, 'public.erasure_requests exists');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.erasure_requests'::regclass), true, 'erasure_requests: RLS enabled and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'erasure_requests' and grantee in ('anon', 'public')), 0::bigint, 'erasure_requests: anon and PUBLIC hold nothing');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'erasure_requests' and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0::bigint, 'erasure_requests: clients can only SELECT');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'erasure' and table_name = 'registry' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'the registry is not reachable by any client role');
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'erasure', 'usage')), 0::bigint, 'no client role has USAGE on schema erasure');

-- the set of PII-commented columns of the public tables
create temp table pii as
  select c.relname::text as t, a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as notnull
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_description d on d.objoid = c.oid and d.objsubid = a.attnum
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and d.description like 'PII:%';

select ok((select count(*) from pii) >= 19, 'the guard sees the PII columns (at least the 15 of T003-T005 plus the 4 company identity columns)');
select is((select coalesce(string_agg(p.t || '.' || p.col, ', ' order by p.t, p.col), '') from pii p
            where not exists (select 1 from erasure.registry r where r.table_name = p.t and r.column_name = p.col)),
          '', 'every PII column has at least one registry row');
select is((select coalesce(string_agg(p.t || '.' || p.col, ', ' order by p.t, p.col), '') from pii p
            where not exists (select 1 from erasure.registry r where r.table_name = p.t and r.column_name = p.col and r.scope = 'tenant')
              and not exists (select 1 from erasure.registry r where r.table_name = p.t and r.column_name = p.col and r.scope = 'company' and r.tenant_exempt)),
          '', 'every PII column is wiped by the tenant scope, or is a company identity column exempt from it (decision 4)');
select is((select coalesce(string_agg(p.t || '.' || p.col, ', ' order by p.t, p.col), '') from pii p
            where p.typ in ('text', 'text[]') and p.t <> 'contacts'
              and not exists (select 1 from erasure.registry r where r.table_name = p.t and r.column_name = p.col and r.scope = 'sweep')),
          '', 'every free-text PII column outside contacts is covered by the identifier sweep');
select is((select coalesce(string_agg(r.table_name || '.' || r.column_name || '/' || r.scope, ', ' order by 1), '') from erasure.registry r
            where not exists (select 1 from pii p where p.t = r.table_name and p.col = r.column_name) and not r.extra),
          '', 'no registry row names a column that is not PII-commented, unless marked extra');
select is((select coalesce(string_agg(r.table_name || '.' || r.column_name, ', ' order by 1), '') from erasure.registry r
            where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name)),
          '', 'no registry row names a column that does not exist');
select is((select coalesce(string_agg(r.table_name || '.' || r.column_name, ', ' order by 1), '') from erasure.registry r
            join information_schema.columns c on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name
           where r.strategy = 'null' and c.is_nullable = 'NO'), '', 'strategy null only on nullable columns');
select is((select coalesce(string_agg(r.table_name || '.' || r.column_name, ', ' order by 1), '') from erasure.registry r
            join information_schema.columns c on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name
           where r.strategy = 'empty_array' and c.data_type <> 'ARRAY'), '', 'empty_array only on arrays');
select is((select coalesce(string_agg(r.table_name || '.' || r.column_name, ', ' order by 1), '') from erasure.registry r
            join information_schema.columns c on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name
           where r.strategy in ('tombstone', 'substring') and c.data_type <> 'text'), '', 'tombstone and substring only on text');
select is((select count(*) from erasure.registry where scope not in ('tenant', 'sweep', 'contact', 'company')), 0::bigint, 'only the four scopes exist');

-- the planter really plants in every registered column (so a canary test cannot pass because nothing was planted)
select tests.er_plant('a');
create function pg_temp.planted(p_table text, p_col text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where tenant_id = $1 and %I is not null and %I::text <> '''' and %I::text <> ''{}'' and %I::text not like ''erased%%''', p_table, p_col, p_col, p_col, p_col) into n using tests.tid('a');
  return n;
end $$;
select is((select coalesce(string_agg(r.table_name || '.' || r.column_name, ', ' order by 1), '') from (select distinct table_name, column_name from erasure.registry) r
            where pg_temp.planted(r.table_name, r.column_name) = 0),
          '', 'tests.er_plant plants a value in EVERY registered column (a new registry row needs a canary)');

select * from finish();
rollback;
