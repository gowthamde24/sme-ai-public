-- Night 4 extra, part E1 (ADR 0113): LEAD DESK is the core of Stack19 and is ON for every business: the three deep packs and every template business. The owner's decision (26 Oct 2026).
--
--   * the module `lead_desk` is a CORE module: not listed by any pack version (pack versions are immutable and the three deep packs would need new versions), switched on by the database for every workspace that has
--     a pack. `app.module_enabled(tenant, 'lead_desk')` is therefore the one place where a plan entitlement can join later; today it is true for every workspace with a pack, false for one without (default deny stays).
--   * every module that a pack lists is still default-deny: nothing about pack-specific modules changes (the closed list, the guards, the tests).
--   * `public.workspace_modules` shows lead_desk with the reason `core`; `public.workspace_pack_get` lists it among the modules.
--   * SCHOOLS keep their rules: Lead Desk is for admission enquiries (speed to lead, campus visit booking); still no lead finding (that module is not in the education pack), and no fees, marks or dues in what the assistant says:
--     a school's batch plan or standing rule whose questions or WhatsApp text read as money is refused (SM951, the same refusal as a school's task).
-- SQLSTATE: SM951 not for schools (shared with job DR B1).

-- 1. the core module
create or replace function app.module_enabled(p_tenant uuid, p_module text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_module = 'lead_desk' then exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant)
    else coalesce((
      select true
        from packs.workspace_pack w
        join packs.pack_modules m on m.code = w.pack_code and m.version = w.pack_version
       where w.tenant_id = p_tenant and m.module = p_module
       limit 1), false)
  end
$$;

do $$
declare
  v_def text;
  v_new text;
begin
  -- the reader of a workspace's modules: lead_desk is on because it is core
  v_def := pg_get_functiondef('public.workspace_modules(uuid)'::regprocedure);
  v_new := replace(v_def, '''reason'', ''pack''', '''reason'', case when m.code = ''lead_desk'' then ''core'' else ''pack'' end');
  if v_new = v_def then raise exception 'ds_lead_desk: workspace_modules is not the function this migration expects'; end if;
  execute v_new;
  -- the pack of a workspace lists lead_desk among its modules
  v_def := pg_get_functiondef('public.workspace_pack_get(uuid)'::regprocedure);
  v_new := replace(v_def, '(select coalesce(jsonb_agg(m.module order by m.module), ''[]''::jsonb) from packs.pack_modules m where m.code = v.code and m.version = v.version)',
                          '(select coalesce(jsonb_agg(s.module order by s.module), ''[]''::jsonb) from (select m.module from packs.pack_modules m where m.code = v.code and m.version = v.version union select ''lead_desk'') s)');
  if v_new = v_def then raise exception 'ds_lead_desk: workspace_pack_get is not the function this migration expects'; end if;
  execute v_new;
end;
$$;

-- 2. schools: no fees, marks or dues in what Lead Desk says (the same refusal as a school's task)
do $$
declare
  v_def text;
  v_new text;
  v_check constant text := E'  if app.task_is_school(p_tenant_id) and ''money'' = any (app.outbox_content_flags(coalesce(v_msg, '''') || '' '' || v_q::text)) then\n    perform app.outreach_error(''schools'');\n  end if;\n';
  v_loop constant text := E'  for q in select * from jsonb_array_elements(v_q) loop';
  f text;
begin
  v_def := pg_get_functiondef('app.outreach_error(text)'::regprocedure);
  v_new := replace(v_def, E'    else raise exception ''not allowed'' using errcode = ''42501'';', E'    when ''schools'' then raise exception ''not for schools'' using errcode = ''SM951'';\n    else raise exception ''not allowed'' using errcode = ''42501'';');
  if v_new = v_def then raise exception 'ds_lead_desk: outreach_error is not the function this migration expects'; end if;
  execute v_new;
  foreach f in array array['public.outreach_batch_plan(uuid,jsonb)', 'public.outreach_rule_save(uuid,jsonb)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position(v_loop in v_def) = 0 then raise exception 'ds_lead_desk: % is not the function this migration expects', f; end if;
    v_new := replace(v_def, v_loop, v_check || v_loop);   -- the loop occurs once in each function (checked when this migration was written)
    execute v_new;
  end loop;
end;
$$;
