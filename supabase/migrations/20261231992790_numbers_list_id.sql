-- The numbers list also carries the id of each phone line (the web picks the line an AI employee answers by it): `id` is the phone_numbers row; a number that is still getting ready has none yet.
create or replace function public.numbers_list(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  return coalesce((select jsonb_agg(row_to_json(t)::jsonb order by t.created_at) from (
    select n.id, n.number, coalesce(x.kind, 'mobile') as kind, case when n.inbound_on then 'calls_on' else 'calls_off' end as state, n.label, n.created_at
      from public.phone_numbers n left join ops.number_purchases x on x.number = n.number and x.state = 'attached'
     where n.tenant_id = p_tenant_id and n.provider = 'voicelink'
    union all
    select null::uuid, x.number, x.kind, 'getting_ready', 'VoiceLink', x.created_at
      from ops.number_purchases x where x.tenant_id = p_tenant_id and x.state in ('started', 'bought', 'mapped', 'routed')) t), '[]'::jsonb);
end $$;
