-- File import v2 (owner, 14 Nov 2026; docs/contracts/file-import.md): the editable preview keeps its rows between taps.
--   * public.assistant_file_replace(tenant, file, data): the owner of a private file replaces its bytes (the import's state is a small JSON file in the same private store: same 24 hour rule, same erasure,
--     same per-person owner check). The row is never visible to anyone else; a file that is gone or someone else's is "not found".
--   * public.lead_phones_known(tenant, phones): of up to 5,000 phone numbers, those already a live contact of the workspace, as [{phone (comparison form), lead_id, name}]: the preview marks them as duplicates.
create function public.assistant_file_replace(p_tenant_id uuid, p_file_id uuid, p_data_base64 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data bytea;
  v_row  public.assistant_files;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  begin
    v_data := decode(coalesce(p_data_base64, ''), 'base64');
  exception when others then
    perform app.aw_error('invalid');
  end;
  if octet_length(v_data) = 0 or octet_length(v_data) > 20000000 then
    perform app.aw_error('invalid');
  end if;
  update public.assistant_files f set data = v_data, size_bytes = octet_length(v_data), sha256 = encode(sha256(v_data), 'hex')
   where f.tenant_id = p_tenant_id and f.id = p_file_id and f.created_by = auth.uid() and f.expires_at > now() and f.data is not null
  returning * into v_row;
  if not found then
    perform app.aw_error('reference');
  end if;
  return jsonb_build_object('file_id', v_row.id, 'size_bytes', v_row.size_bytes, 'expires_at', v_row.expires_at);
end;
$$;
revoke all on function public.assistant_file_replace(uuid, uuid, text) from public, anon;
grant execute on function public.assistant_file_replace(uuid, uuid, text) to authenticated;

create function public.lead_phones_known(p_tenant_id uuid, p_phones text[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_phones is null or cardinality(p_phones) > 5000 then
    perform app.aw_error('invalid');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('phone', n.norm, 'lead_id', n.lead_id, 'name', n.full_name) order by n.norm)
                     from (select distinct on (app.phone_norm(k.phone)) app.phone_norm(k.phone) as norm, k.full_name,
                                  (select l.id from public.leads l where l.tenant_id = k.tenant_id and l.contact_id = k.id and l.archived_at is null order by l.created_at desc, l.id limit 1) as lead_id
                             from public.contacts k
                            where k.tenant_id = p_tenant_id and k.erased_at is null and k.archived_at is null and k.phone is not null
                              and app.phone_norm(k.phone) = any (array(select app.phone_norm(x) from unnest(p_phones) x where app.phone_norm(x) is not null))
                            order by app.phone_norm(k.phone), k.created_at, k.id) n), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_phones_known(uuid, text[]) from public, anon;
grant execute on function public.lead_phones_known(uuid, text[]) to authenticated;
