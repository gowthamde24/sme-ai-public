-- Job CW (night run C1, hardening): the DEFAULT-DENY MATRIX of the modules, swept over EVERY public function that names a module, not only the ones a job remembered.
--   A a workspace with no pack row has nothing on: every function that requires a module is refused with SM701 (a pinned list of exceptions, each refused for another stated reason, never ok)
--   B the functions of the modules built in the night run are pinned by name (a new function of these modules fails this file until it is listed here and proved above)
--   C every one of those functions is SECURITY DEFINER with an empty search_path and can be executed by signed-in users only (never anon, never public)
--   D the tables of the night run's modules are guarded by their module, forced under row-level security and writable by no client role
--   E the scheduler's voice functions fail closed for a business without the module
begin;
select no_plan();
select tests.seed_two_tenants();
-- business B has no pack row at all: NOTHING is on (job CK, fail closed)
delete from packs.workspace_pack where tenant_id = tests.tid('b');
select is(app.module_enabled(tests.tid('b'), 'programmes'), false, 'A0 a business with no pack row has no module on');

create function pg_temp.dummy(p_type oid, p_name text) returns text language plpgsql as $$
declare t text := pg_catalog.format_type(p_type, null); e text;
begin
  if p_name = 'p_tenant_id' then return quote_literal(tests.tid('b')) || '::uuid'; end if;
  -- a report code that exists: the module check follows the lookup of the definition
  if p_name = 'p_code' then return '''construction.quotes'''; end if;
  if t = 'uuid' then return quote_literal(gen_random_uuid()) || '::uuid'; end if;
  if t in ('text', 'character varying') then return '''x'''; end if;
  if t in ('integer', 'smallint', 'bigint', 'numeric') then return '1::' || t; end if;
  if t = 'boolean' then return 'false'; end if;
  if t = 'date' then return 'current_date'; end if;
  if t like 'timestamp%' then return 'now()'; end if;
  if t = 'jsonb' then return '''{}''::jsonb'; end if;
  if t = 'text[]' then return 'array[''x'']::text[]'; end if;
  if t = 'uuid[]' then return 'array[gen_random_uuid()]::uuid[]'; end if;
  select quote_literal(enumlabel) || '::' || t into e from pg_enum where enumtypid = p_type order by enumsortorder limit 1;
  return coalesce(e, 'null::' || t);
end $$;

-- every public function whose body requires a module, called as business B's owner with plausible arguments (the business id is B's)
create temp table res (fn text, modules text, st text);
do $$
declare r record; v_args text;
begin
  for r in
    select p.oid, p.proname, p.proargtypes::oid[] as types, p.proargnames,
           (select string_agg(distinct m[1], ',' order by m[1]) from regexp_matches(p.prosrc, 'require_module\([^,]+,\s*''([a-z_]+)''\)', 'g') m) as modules
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ~ 'require_module\(' order by p.proname, p.oid
  loop
    select string_agg(pg_temp.dummy(r.types[i], r.proargnames[i + 1]), ', ' order by i) into v_args from generate_subscripts(r.types, 1) i;
    insert into res values (r.proname, r.modules, tests.sqlstate_as(tests.uid('b_owner'), format('select public.%I(%s)', r.proname, coalesce(v_args, ''))));
  end loop;
end $$;

-- ============================================================================ A. default deny, swept
select cmp_ok((select count(*) from res), '>=', 90::bigint, 'A1 the sweep is not vacuous: ninety or more functions name a module');
-- the exceptions: each is refused for a reason that comes BEFORE its module check (custom fields check the entity first; the two ledger readers and the two material writers need an object that exists)
select is((select coalesce(string_agg(fn, ',' order by fn), '') from res where st <> 'SM701'),
  'create_order_from_material_quote,custom_field_def_create,custom_field_def_update,custom_values_set_many,ledger_entries_list,ledger_statement,material_quote_approve',
  'A2 every other function that names a module answers SM701 to a business with nothing on');
select is((select count(*) from res where st = 'ok'), 0::bigint, 'A3 and no function, exception or not, does the work');
select is((select count(*) from res where st <> 'SM701' and st not in ('22023', '23503', '42501')), 0::bigint, 'A4 an exception is a plain refusal (invalid, not found or not allowed)');
select is((select st from res where fn = 'report_run'), 'SM701', 'A5 a report of a pack that is not on is SM701, whatever the caller');
select is((select st from res where fn = 'construction_report'), 'SM701', 'A6 and the construction report too');
select is((select st from res where fn = 'education_report'), 'SM701', 'A7 and the education report');

-- ============================================================================ B. the night run's modules, pinned by name
select is((select string_agg(distinct fn, ',' order by fn) from res where modules ~ 'programmes'),
  'admission_admit,admission_create,admission_get,admission_stage_set,admissions_list,campaign_recipients_from_students,education_report,institution_profile_get,institution_profile_set,programme_group_save,programme_save,programmes_list,student_erase,student_get,student_save,student_set_status,students_import,students_list',
  'B1 the functions of `programmes` (the institution, the students, the admissions)');
select is((select string_agg(distinct fn, ',' order by fn) from res where modules ~ 'fees'),
  'education_report,fee_adjustment_record,fee_assign,fee_assignment_void,fee_concession_apply,fee_entries_list,fee_guardian_statement,fee_late_fees_post,fee_late_fees_preview,fee_payment_record,fee_pending_list,fee_plan_get,fee_plan_save,fee_plans_list,fee_receipt_get,fee_statement',
  'B2 the functions of `fees`');
select is((select string_agg(distinct fn, ',' order by fn) from res where modules ~ 'voice_notes'),
  'campaign_voice_get,campaign_voice_set,voice_choice_set,voice_disclosure_get,voice_preview_plan,voice_preview_record,voice_settings_get,voice_settings_set,voice_usage_get,voice_voices_list',
  'B3 the functions of `voice_notes` (the worker''s two are not here: they fail closed instead, see E)');
select is((select string_agg(distinct fn, ',' order by fn) from res where modules ~ 'reports'), 'construction_report,education_report', 'B4 the functions that name `reports` themselves (report_run reads its definition''s modules; report_catalogue lists only what is on)');

-- ============================================================================ C. grants and definer settings of every function in the sweep
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc ~ 'require_module\(' and not p.prosecdef), 0::bigint, 'C1 every such function is SECURITY DEFINER');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc ~ 'require_module\(' and not coalesce(p.proconfig::text like '%search_path=%', false)), 0::bigint, 'C2 and has its search_path fixed');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc ~ 'require_module\(' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0::bigint, 'C3 and no anonymous caller and no PUBLIC grant can execute it');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc ~ 'require_module\(' and not has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint, 'C4 signed-in users can (the function proves the role itself)');
-- and the anonymous caller is refused by the grant, not by luck
select is(tests.sqlstate_as(null, format('select public.voice_usage_get(%L)', tests.tid('b'))), '42501', 'C5 an anonymous call is refused before the function runs');

-- ============================================================================ D. the tables of the night run's modules
create temp table guards as
select n.nspname || '.' || c.relname as tbl, (regexp_split_to_array(encode(t.tgargs, 'escape'), '\\000'))[1] as module
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where t.tgfoid = 'app.module_guard()'::regprocedure and not t.tgisinternal;
select is((select string_agg(tbl || ':' || module, ',' order by tbl) from guards where module in ('programmes', 'fees', 'voice_notes')),
  'public.admission_events:programmes,public.admissions:programmes,public.campaign_voice:voice_notes,public.fee_assignments:fees,public.fee_plan_lines:fees,public.fee_plans:fees,public.institution_profiles:programmes,public.programme_groups:programmes,public.programmes:programmes,public.students:programmes,public.voice_choices:voice_notes,public.voice_note_usage:voice_notes,public.voice_settings:voice_notes',
  'D1 each table is guarded by the module that owns it (an insert for a business without the module is SM701)');
select is((select count(*) from guards g join pg_class c on c.oid = g.tbl::regclass where g.module in ('programmes', 'fees', 'voice_notes') and not (c.relrowsecurity and c.relforcerowsecurity)), 0::bigint, 'D2 row-level security is enabled and forced on each');
select is((select count(*) from guards g where g.module in ('programmes', 'fees', 'voice_notes')
             and (has_table_privilege('authenticated', g.tbl, 'insert') or has_table_privilege('authenticated', g.tbl, 'update') or has_table_privilege('authenticated', g.tbl, 'delete')
                  or has_table_privilege('anon', g.tbl, 'select') or has_table_privilege('anon', g.tbl, 'insert'))), 0::bigint, 'D3 no client role can write any of them directly and the anonymous role cannot even read');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'voice' and grantee in ('anon', 'authenticated', 'service_role', 'public')), 0::bigint, 'D4 the operator''s voice catalogues are closed to every client role');

-- ============================================================================ E. the worker's voice functions fail closed
select app.operator_register_scheduler('outsider@test.local');
select is(tests.scalar_as(tests.uid('outsider'), format('select public.scheduler_voice_plan(%L, gen_random_uuid())::text', tests.tid('b'))), '{"voice": false, "reason": "module_off"}', 'E1 the worker is told "module_off" for a business that does not have voice notes');
select is(tests.sqlstate_as(tests.uid('b_owner'), format('select public.scheduler_voice_plan(%L, gen_random_uuid())', tests.tid('b'))), '42501', 'E2 only the registered scheduler account may ask');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.scheduler_voice_record(%L, gen_random_uuid(), 'en', 'fake-en', 3, 40)$$, tests.tid('b'))), '42501', 'E3 nor record');

select * from finish();
rollback;
