-- The Lead Desk's "same number" lookup (planner, 19 Nov 2026, Server-Timing): duplicate_of took 570 ms of the 700 ms of lead_desk_page for 50 leads: for each lead the planner walked every older lead of the
-- workspace and normalised each contact's number (14,025 calls). Same answer, contacts FIRST through the indexed expression (migration 20261231985200: `phone is not null` lets the planner use the partial
-- index, OFFSET 0 keeps it a separate step): about 3 ms. Patched IN PLACE (the function was changed by later migrations: notes, promises), never replaced as a whole.
do $patch$
declare
  v_def text;
  v_old text := $q$          (select l2.id from public.leads l2 join public.contacts c2 on c2.tenant_id = l2.tenant_id and c2.id = l2.contact_id
            where l2.tenant_id = l.tenant_id and l2.id <> l.id and l2.archived_at is null and app.phone_norm(c2.phone) = app.phone_norm(c.phone)
              and (l2.created_at, l2.id) < (l.created_at, l.id) order by l2.created_at, l2.id limit 1) end,$q$;
  v_new text := $q$          (select l2.id from public.leads l2
            where l2.tenant_id = l.tenant_id
              and l2.contact_id in (select c2.id from public.contacts c2 where c2.tenant_id = l.tenant_id and c2.phone is not null and app.phone_norm(c2.phone) = (select app.phone_norm(c.phone)) offset 0)
              and l2.id <> l.id and l2.archived_at is null and (l2.created_at, l2.id) < (l.created_at, l.id) order by l2.created_at, l2.id limit 1) end,$q$;
begin
  v_def := pg_get_functiondef('app.lead_desk_json(public.leads, public.lead_profiles, public.contacts, uuid, boolean)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception 'lead_desk_json has changed: the duplicate lookup patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
