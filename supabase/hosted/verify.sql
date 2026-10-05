-- READ-ONLY verification of a HOSTED project (T006b M2, ADR 0015). Paste into the Supabase SQL editor, or let scripts/verify_hosted.py run it with
-- psql (that run is forced read-only). Every row is (check, ok, detail); an INFO row has ok = NULL. It changes nothing: SELECTs only.
--
-- What it proves: the trusted role owns the definer functions (the provenance triggers, the erasure exception and the gate all trust
-- current_user = 'postgres'); every definer function pins its search_path; RLS is enabled AND forced on every tenant table; no client
-- role holds more than it should; the real-data gate is closed unless you opened it; the erasure workflow and the guards are installed.
with
checks(check_name, ok, detail) as (
  select 'connected as the trusted role', current_user = 'postgres', 'current_user = ' || current_user
  union all
  select 'definer functions owned by postgres',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'app') and p.prosecdef and p.proowner::regrole::text <> 'postgres'),
         coalesce((select string_agg(n.nspname || '.' || p.proname || ' owned by ' || p.proowner::regrole::text, ', ')
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'app') and p.prosecdef and p.proowner::regrole::text <> 'postgres'), 'all of them')
  union all
  select 'every definer function pins search_path',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'app') and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false)),
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosecdef) || ' definer functions'
  union all
  select 'the provenance predicate is intact (set_created_meta, set_agent_run_id)',
         (select count(*) from pg_proc p where p.proname in ('set_created_meta', 'set_agent_run_id') and p.pronamespace = 'app'::regnamespace
             and p.prosrc like '%current_user = ''postgres''%') = 2,
         'both trigger functions trust exactly current_user = ''postgres'''
  union all
  select 'RLS enabled and forced on every table with a tenant_id',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r'
                        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
                        and not (c.relrowsecurity and c.relforcerowsecurity)),
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
             and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)) || ' tenant tables'
  union all
  select 'anon holds no privilege on any public table',
         not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee in ('anon', 'PUBLIC')),
         'role_table_grants for anon / PUBLIC in public'
  union all
  select 'clients cannot write the immutable and operator tables',
         not exists (select 1 from information_schema.role_table_grants g
                      where g.table_schema = 'public' and g.grantee = 'authenticated' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
                        and g.table_name in ('audit_events', 'consent_events', 'erasure_requests', 'tenant_data_policy', 'agent_runs', 'agent_run_steps',
                                             'claim_reviews', 'tenant_agent_settings', 'import_batches', 'import_rows', 'lead_labels', 'data_exports')),
         'INSERT / UPDATE / DELETE / TRUNCATE by authenticated on those tables'
  union all
  select 'private schemas are closed to client roles',
         not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['erasure']) s where has_schema_privilege(r, s, 'usage')),
         'no USAGE on schema erasure for anon / authenticated'
  union all
  select 'operator functions are not executable by any client role',
         not exists (select 1 from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'operator\_%'
                       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                            or has_function_privilege('service_role', p.oid, 'execute'))),
         (select count(*)::text from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'operator\_%') || ' operator functions'
  union all
  select 'the erasure workflow is installed',
         to_regprocedure('public.request_erasure(uuid, uuid, text, uuid)') is not null
         and to_regprocedure('public.execute_erasure(uuid, boolean)') is not null
         and to_regprocedure('public.cancel_erasure(uuid)') is not null
         and to_regclass('erasure.registry') is not null,
         'request_erasure, execute_erasure, cancel_erasure, erasure.registry'
  union all
  select 'execute_erasure carries its own statement timeout',
         exists (select 1 from pg_proc where proname = 'execute_erasure' and pronamespace = 'public'::regnamespace and proconfig::text like '%statement_timeout%'),
         'a large workspace needs longer than the client roles'' 8 s'
  union all
  select 'the contacts guards are in place (gate and erased-row)',
         (select count(*) from pg_trigger where tgrelid = 'public.contacts'::regclass and not tgisinternal
             and tgname in ('contacts_guard_real_data', 'contacts_guard_erased')) = 2,
         'contacts_guard_real_data, contacts_guard_erased'
  union all
  select 'the immutable-record guard knows the erasure exception',
         exists (select 1 from pg_proc where proname = 'guard_immutable_record' and pronamespace = 'app'::regnamespace and prosrc like '%erasure_running%'),
         'app.guard_immutable_record calls app.erasure_running'
  union all
  select 'no operator-only table is readable by anon',
         not has_table_privilege('anon', 'public.tenant_data_policy', 'select') and not has_table_privilege('anon', 'public.erasure_requests', 'select'),
         'tenant_data_policy, erasure_requests'
),
infos(check_name, ok, detail) as (
  select 'INFO workspaces with the real-data gate OPEN', null::boolean,
         coalesce((select string_agg(t.slug, ', ' order by t.slug) from public.tenant_data_policy p join public.tenants t on t.id = p.tenant_id where p.real_data_allowed),
                  'none (every workspace is closed)')
  union all
  select 'INFO workspaces', null::boolean, (select count(*)::text from public.tenants)
  union all
  select 'INFO agents platform switch', null::boolean, coalesce((select 'enabled=' || enabled::text from public.platform_flags limit 1), 'no row')
  union all
  select 'INFO accounts', null::boolean, (select count(*)::text from auth.users)
)
select check_name, ok, detail from (
  select check_name, ok, detail from checks
  union all
  select check_name, ok, detail from infos
) all_rows
order by (ok is null), (ok is not distinct from true), check_name;
