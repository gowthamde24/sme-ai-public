-- 26 Nov 2026 (planner's go): choosing the pack the workspace ALREADY holds is still a choice.
-- Textiles is the default pack, so "Add a workspace" with Textiles chosen (and the first-run picker's Textiles tile) found the same pack, returned early and left the source 'default': the first-run
-- picker kept showing, and a second click landed on another type (Customer Zero, 25 Nov: textiles -> agri_nursery). Now, for an Owner call with the SAME pack:
--   source 'default' or 'legacy'  -> source 'owner', chosen_by, chosen_at are set and one audit line (workspace_pack.choose, from = the same pack) is written; no field is added (they exist already);
--   source 'owner', 'signup' or 'operator' -> still a no-op: no write, no audit line.
-- POST /v1/tenants with `pack` calls this function, so the Add a workspace path records its choice the same way. Everything else of the function is unchanged (988000).

create or replace function public.workspace_pack_set(p_tenant_id uuid, p_pack text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w packs.workspace_pack;
  v packs.pack_versions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.pack_error('deny');
  end if;
  if p_pack is null or p_pack !~ '^[a-z][a-z0-9_]{1,30}$' then
    perform app.pack_error('invalid');
  end if;
  select * into v from packs.pack_versions x where x.code = p_pack and x.status in ('preview', 'published') order by x.version desc limit 1;
  if not found then
    perform app.pack_error('unavailable');
  end if;
  select * into w from packs.workspace_pack x where x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.pack_error('reference');
  end if;
  if w.pack_code = v.code and w.pack_version = v.version and w.source not in ('default', 'legacy') then
    return public.workspace_pack_get(p_tenant_id);
  end if;
  update packs.workspace_pack x
     set pack_code = v.code, pack_version = v.version, source = 'owner', chosen_by = auth.uid(), chosen_at = now()
   where x.tenant_id = p_tenant_id;
  perform app.apply_pack_fields(p_tenant_id, v.code, v.version, auth.uid());
  perform app.write_audit_event(p_tenant_id, 'workspace_pack.choose', 'workspace_pack', p_tenant_id, null,
                                jsonb_build_object('pack', v.code, 'version', v.version, 'source', 'owner', 'from', w.pack_code));
  return public.workspace_pack_get(p_tenant_id);
end;
$$;
revoke all on function public.workspace_pack_set(uuid, text) from public, anon;
grant execute on function public.workspace_pack_set(uuid, text) to authenticated;
