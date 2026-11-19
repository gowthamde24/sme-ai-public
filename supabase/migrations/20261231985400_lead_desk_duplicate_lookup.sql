-- The Lead Desk's "same number" lookup (planner, 19 Nov 2026, Server-Timing): duplicate_of took 570 ms of the 700 ms of lead_desk_page for 50 leads. Same answer, contacts first through the indexed expression (migration 20261231985200).

create or replace function app.lead_desk_json(l public.leads, p public.lead_profiles, c public.contacts, v_uid uuid, v_full boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'created_by', l.created_by, 'created_via', l.created_via, 'created_at', l.created_at, 'updated_at', l.updated_at, 'archived_at', l.archived_at,
    'company_id', l.company_id, 'contact_id', l.contact_id, 'owner_user_id', l.owner_user_id, 'status', l.status, 'source', l.source, 'disqualified_reason', l.disqualified_reason,
    'is_new', not (v_uid = any (coalesce(p.opened_by, '{}'::uuid[]))),
    'needs_profile', p.normalised_at is null,
    'profile', jsonb_build_object(
      'name', c.full_name, 'phone_e164', c.phone, 'email', c.email,
      'city', p.city, 'area', p.area, 'need', p.need, 'quantity', p.quantity, 'budget', p.budget, 'timeline', p.timeline, 'urgency', p.urgency, 'language', p.language,
      'source', l.source, 'campaign', p.campaign,
      'original_text', case when v_full then app.lead_words(l.tenant_id, l.id) end,
      'confidence', coalesce(p.confidence, '{}'::jsonb),
      'duplicate_of', case when c.phone is not null and app.phone_norm(c.phone) is not null then
          -- contacts FIRST, through the indexed normalised number (contacts_phone_norm_idx; `phone is not null` lets the planner use the partial index; OFFSET 0 keeps it a separate step): the other way round, the planner
          -- walked every older lead of the workspace and normalised each contact's number (570 ms for 50 leads, now about 3 ms)
          (select l2.id from public.leads l2
            where l2.tenant_id = l.tenant_id
              and l2.contact_id in (select c2.id from public.contacts c2 where c2.tenant_id = l.tenant_id and c2.phone is not null and app.phone_norm(c2.phone) = (select app.phone_norm(c.phone)) offset 0)
              and l2.id <> l.id and l2.archived_at is null and (l2.created_at, l2.id) < (l.created_at, l.id) order by l2.created_at, l2.id limit 1) end,
      'merged_count', case when v_full then (select count(*) from public.lead_arrivals a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.kind = 'repeat') else 0 end,
      'junk', case when p.junk_reason is null then to_jsonb(false) else jsonb_build_object('reason', p.junk_reason) end,
      'fixed_by_you', to_jsonb(coalesce(p.fixed, '{}'::text[]))))
$$;
