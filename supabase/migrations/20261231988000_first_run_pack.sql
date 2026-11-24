-- First run by business type (25 Nov 2026; docs/contracts/first-run.md, reports/first-run-by-business-type.md gaps 5 and 6).
--   public.workspace_pack_set(tenant, pack)   the OWNER changes the business type of an existing workspace (the in-app "Create workspace" never asked it). Adds the new pack's custom fields, never removes or
--                                             changes a field, a record or example data. New source word 'owner'. The same pack again is a no-op (no audit line). Audited as workspace_pack.choose.
--   public.first_run_facts(tenant)            any member: the pack code, who chose it, whether anybody did, and how many catalogue items the workspace has so far (any kind, no names, no prices).
-- Nothing here stores a person's data.

alter table packs.workspace_pack drop constraint workspace_pack_source_check;
alter table packs.workspace_pack add constraint workspace_pack_source_check check (source in ('signup', 'default', 'legacy', 'operator', 'owner'));

create function public.workspace_pack_set(p_tenant_id uuid, p_pack text) returns jsonb
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
  if w.pack_code = v.code and w.pack_version = v.version then
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

create function public.first_run_facts(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w packs.workspace_pack;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.pack_error('deny');
  end if;
  select * into w from packs.workspace_pack x where x.tenant_id = p_tenant_id;
  if not found then
    perform app.pack_error('reference');
  end if;
  return jsonb_build_object(
    'pack_code', w.pack_code,
    'source', w.source,
    'typed', w.source not in ('default', 'legacy'),
    'items_count', (select count(*) from public.catalogue_items c where c.tenant_id = p_tenant_id));
end;
$$;
revoke all on function public.first_run_facts(uuid) from public, anon;
grant execute on function public.first_run_facts(uuid) to authenticated;
