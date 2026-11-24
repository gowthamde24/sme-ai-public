-- A price change can be put back (28 Nov 2026; the phone price screens): (1) every catalogue item shows WHO changed it last (`updated_by_name`, the display name, only of a member of the same business), and (2) the Owner can undo the last price
-- change of an item within 30 days. The undo is not a blind "set the old price": it reads the last price-affecting audit row of that item, refuses when the latest thing that happened to the price was an undo (so it cannot be pressed twice
-- or turn into a redo), and writes its own audit row (action catalogue_item.price_undo: who, the price before, the price after). Same rule as a price change: the Owner only, a second factor only if the Owner turned one on.
-- Rollback = drop public.catalogue_price_undo and app.member_display_name and put the two lines of app.catalogue_item_json back.

create function app.member_display_name(p_tenant uuid, p_user uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.display_name from public.users u
   where u.id = p_user and exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = p_user)
$$;
revoke all on function app.member_display_name(uuid, uuid) from public, anon;
grant execute on function app.member_display_name(uuid, uuid) to authenticated;   -- the item reader runs as the caller; it answers a display name only for a member of the item's own business

do $patch$
declare
  v_def    text := pg_get_functiondef('app.catalogue_item_json(public.catalogue_items)'::regprocedure);
  v_marker constant text := E'''created_at'', m.created_at, ''updated_at'', m.updated_at,';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'price undo: catalogue_item_json is not the one this migration expects';
  end if;
  execute replace(v_def, v_marker, E'''created_at'', m.created_at, ''updated_at'', m.updated_at, ''updated_by_name'', app.member_display_name(m.tenant_id, m.updated_by),');
end
$patch$;

create function public.catalogue_price_undo(p_tenant_id uuid, p_item_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  e         public.audit_events;
  v_cur     public.catalogue_items;
  v_back    bigint;
begin
  if v_uid is null or p_tenant_id is null or p_item_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.catalogue_error('deny');
  end if;
  perform app.require_aal2();
  select * into v_cur from public.catalogue_items i where i.tenant_id = p_tenant_id and i.id = p_item_id for update;
  if not found then
    perform app.catalogue_error('reference');
  end if;
  select * into e from public.audit_events a
   where a.tenant_id = p_tenant_id and a.entity_type = 'catalogue_item' and a.entity_id = p_item_id
     and (a.action = 'catalogue_item.price_undo'
          or (a.action = 'catalogue_item.update' and (a.old_values ->> 'price_paise') is distinct from (a.new_values ->> 'price_paise')))
   order by a.id desc limit 1;
  if not found or e.action = 'catalogue_item.price_undo' or e.created_at < now() - interval '30 days' then
    raise exception 'nothing to undo' using errcode = 'SM851';
  end if;
  v_back := nullif(e.old_values ->> 'price_paise', '')::bigint;
  update public.catalogue_items i set price_paise = v_back, updated_by = v_uid, updated_at = now() where i.tenant_id = p_tenant_id and i.id = p_item_id returning * into v_cur;
  perform app.write_audit_event(p_tenant_id, 'catalogue_item.price_undo', 'catalogue_item', p_item_id,
                                jsonb_build_object('price_paise', e.new_values -> 'price_paise'), jsonb_build_object('price_paise', to_jsonb(v_back)));
  return app.catalogue_item_json(v_cur);
end;
$$;
revoke all on function public.catalogue_price_undo(uuid, uuid) from public, anon;
grant execute on function public.catalogue_price_undo(uuid, uuid) to authenticated;
