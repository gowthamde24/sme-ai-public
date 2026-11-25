-- Buy first, verify after (25 Nov 2026; the planner's decision: the Outpero order). A workspace may buy its number from credits BEFORE its business KYC is approved; until then the number is `kyc_pending`: calls stay OFF
-- and we ourselves refuse real calls in and out (whatever VoiceLink allows). Additive; used only with the API switch KYC_PER_CLIENT.
--   * `app.kyc_pending(tenant)`: the workspace has a VoiceLink client of its own whose KYC is not yet verified; a workspace without one (the shared client, everything today) is never pending.
--   * the phone line lookups carry it as `kyc_pending` (the same guarded patch as the wallet's).
--   * `business_client_pending` / `business_client_mark_verified`: the worker asks VoiceLink about the clients still waiting and marks the approved ones, so a number goes live without the owner opening a page.
-- Rollback = the API switch off; drop the two functions and the helper.

create function app.kyc_pending(p_tenant uuid) returns boolean language sql stable set search_path = '' as
$$ select exists (select 1 from telephony.business_clients b where b.tenant_id = p_tenant and b.state <> 'verified') $$;
revoke all on function app.kyc_pending(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_find(text)'::regprocedure);
  v_old text := $q$'wallet', app.wallet_gate(n.tenant_id));$q$;
  v_new text := $q$'wallet', app.wallet_gate(n.tenant_id), 'kyc_pending', app.kyc_pending(n.tenant_id));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_find has changed: the kyc patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
do $patch$
declare
  v_def text := pg_get_functiondef('public.phone_line_for_tenant(uuid,text)'::regprocedure);
  v_old text := $q$'wallet', app.wallet_gate(n.tenant_id));$q$;
  v_new text := $q$'wallet', app.wallet_gate(n.tenant_id), 'kyc_pending', app.kyc_pending(n.tenant_id));$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'phone_line_for_tenant has changed: the kyc patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

create function public.business_client_pending(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  return coalesce((select jsonb_agg(jsonb_build_object('tenant_id', b.tenant_id, 'client_id', b.client_id) order by b.updated_at)
                     from (select * from telephony.business_clients x where x.state in ('created', 'in_progress', 'submitted') and x.updated_at > now() - interval '60 days'
                            order by x.updated_at limit least(greatest(coalesce(p_limit, 50), 1), 200)) b), '[]'::jsonb);
end $$;
revoke all on function public.business_client_pending(integer) from public, anon;
grant execute on function public.business_client_pending(integer) to authenticated;

create function public.business_client_mark_verified(p_tenant_id uuid) returns void language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  update telephony.business_clients set state = 'verified', reason = null, updated_at = now() where tenant_id = p_tenant_id and state <> 'verified';
  if found then
    perform app.write_audit_event(p_tenant_id, 'phone.business_kyc_verified', 'workspace', p_tenant_id, null, jsonb_build_object('by', 'worker'));
  end if;
end $$;
revoke all on function public.business_client_mark_verified(uuid) from public, anon;
grant execute on function public.business_client_mark_verified(uuid) to authenticated;
