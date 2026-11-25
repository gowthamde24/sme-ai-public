-- Today "Needs you" (25 Nov 2026): the worker's scheduled IndiaMART pull found the workspace's own key refused (keys last 7 days) or gone (migration 20261231992400). One item per workspace, Owner and Admin only, kind
-- `indiamart_key_expired`, target {type: "lead_sources", id: the workspace}. It leaves by itself when a new key is saved (workspace_secrets.set_at is newer than the state) or the source is turned off.
-- It can only appear once INDIAMART_PULL is switched on in the worker, so nothing shows before the web knows the kind (the web's Today list and its target types must add it first).

create function app.today_indiamart_key_expired(p_tenant uuid) returns table (id uuid, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('indiamart_key_expired:' || p_tenant::text)::uuid, s.key_state_at
    from integrations.pull_state s
    join public.workspace_secrets w on w.tenant_id = s.tenant_id and w.kind = 'indiamart_key'
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and s.tenant_id = p_tenant and s.source = 'indiamart' and s.key_state = 'expired' and w.set_at <= s.key_state_at
     and exists (select 1 from public.lead_sources x where x.tenant_id = p_tenant and x.kind = 'indiamart' and x.status = 'active')
$$;
revoke all on function app.today_indiamart_key_expired(uuid) from public;
grant execute on function app.today_indiamart_key_expired(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'      from app.today_credits_low(p_tenant_id) cl\n     where v_decider\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''indiamart_key_expired'', ik.id, ''IndiaMART''::text, null::text, ''followup_desk'', ''key'', null::bigint, ik.at, ''lead_sources'', p_tenant_id\n'
    || E'      from app.today_indiamart_key_expired(p_tenant_id) ik\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
