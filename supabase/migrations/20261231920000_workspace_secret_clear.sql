-- Track D slice 4 (15 Nov 2026): disconnecting the IndiaMART card must delete the owner's key, not only stop using it.
-- Owner only (the same gate as saving it). The row goes; the function hands back the Secret Manager name so the API can delete the secret itself. The database never held the key.
create function public.workspace_secret_clear(p_tenant_id uuid, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform app.aw_gate(p_tenant_id, array['owner']::public.app_role[]);
  if p_kind is null or p_kind not in ('indiamart_key') then
    perform app.aw_error('invalid');
  end if;
  delete from public.workspace_secrets where tenant_id = p_tenant_id and kind = p_kind returning secret_name into v_name;
  return jsonb_build_object('kind', p_kind, 'secret_name', v_name, 'cleared', v_name is not null);
end;
$$;
revoke all on function public.workspace_secret_clear(uuid, text) from public, anon;
grant execute on function public.workspace_secret_clear(uuid, text) to authenticated;
