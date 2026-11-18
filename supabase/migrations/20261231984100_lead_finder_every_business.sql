-- The Lead Finder is visible to EVERY business (owner decision, 18 Nov 2026): the module is on for every workspace that has a pack, like lead_desk (which is core), not only for the three business types
-- whose pack carried it. What it looks for comes from the business type's own packages/packs/<id>/lead_finder.json (every pack has one: a test fails if one is missing).
-- Nothing changes for a pack that already has the module. A school still finds organisations only (the education file says audience: organisations).
do $$
declare
  v_def text;
  v_new text;
begin
  -- the one reader of "is this module on for this workspace"
  v_def := pg_get_functiondef('app.module_enabled(uuid, text)'::regprocedure);
  v_new := replace(v_def, 'WHEN p_module = ''lead_desk'' THEN', 'WHEN p_module IN (''lead_desk'', ''lead_finder'') THEN');
  if v_new = v_def then raise exception 'module_enabled is not the function this migration expects'; end if;
  execute v_new;
  -- the list of a workspace's modules says why: core, like lead_desk
  v_def := pg_get_functiondef('public.workspace_modules(uuid)'::regprocedure);
  v_new := replace(v_def, 'WHEN m.code = ''lead_desk'' THEN', 'WHEN m.code IN (''lead_desk'', ''lead_finder'') THEN');
  if v_new = v_def then raise exception 'workspace_modules is not the function this migration expects'; end if;
  execute v_new;
  -- the pack of a workspace lists lead_finder among its modules
  v_def := pg_get_functiondef('public.workspace_pack_get(uuid)'::regprocedure);
  v_new := replace(v_def, 'select ''lead_desk'') s)', 'select ''lead_desk'' union select ''lead_finder'') s)');
  if v_new = v_def then raise exception 'workspace_pack_get is not the function this migration expects'; end if;
  execute v_new;
end;
$$;
