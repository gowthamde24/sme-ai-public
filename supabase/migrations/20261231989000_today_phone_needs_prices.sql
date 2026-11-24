-- Today "Needs you" (28 Nov 2026): a workspace that has a phone line but NO price list. The phone assistant says a price only if it is a price-list row, so with an empty list it can only say the team will call back; the owner sees this
-- BEFORE the first real call. Kind `phone_needs_prices`, for the Owner and Admin, one per workspace; it leaves by itself as soon as the first price row exists.

create function app.today_phone_needs_prices(p_tenant uuid) returns table (id uuid, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('prices:' || p_tenant::text)::uuid, app.outbox_now()
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and exists (select 1 from public.phone_numbers n where n.tenant_id = p_tenant)
     and not exists (select 1 from public.price_list_items i
                      where i.tenant_id = p_tenant
                        and i.version_id = (select v.id from public.price_list_versions v where v.tenant_id = p_tenant and v.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by v.effective_from desc, v.version_no desc, v.created_at desc limit 1))
$$;
revoke all on function app.today_phone_needs_prices(uuid) from public;
grant execute on function app.today_phone_needs_prices(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'      from app.today_calls_paused(p_tenant_id) cp\n     where v_decider\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''phone_needs_prices'', pp.id, ''Phone assistant''::text, null::text, ''followup_desk'', ''price_list'', null::bigint, pp.at, ''price_list'', p_tenant_id\n'
    || E'      from app.today_phone_needs_prices(p_tenant_id) pp\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
