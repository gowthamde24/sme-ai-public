-- The Owner's approval of EACH call (planner, 18 Nov 2026): the outbound gate no longer takes a constant "approved". The call path asks the database whether THIS call belongs to something the owner approved:
--   owner_test     the person pressing the button is the Owner or an Admin (their own token)
--   task           a task the Owner approved and that is still approved or running
--   standing_rule  an outreach item of a standing rule that is still on (active and not paused)
--   plan           an outreach item of a batch plan the Owner approved and that is running
-- The approval is for THIS call: for a task, a rule's item or a batch's item the number dialled must be the phone of the person it is about (digits compared); the Owner's own press has no person.
-- Read only. The same callers as phone_call_begin (the Owner or Admin, or the phone server).
create function public.call_approved(p_tenant_id uuid, p_kind text, p_ref uuid, p_number text default null) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not (app.is_scheduler() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])) then
    perform app.phone_error('deny');
  end if;
  if p_kind = 'owner_test' then
    return app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  elsif p_kind = 'task' and p_ref is not null and p_number is not null then
    return exists (select 1 from public.tasks t join public.task_contacts tc on tc.tenant_id = t.tenant_id and tc.task_id = t.id join public.contacts c on c.tenant_id = tc.tenant_id and c.id = tc.contact_id
                    where t.tenant_id = p_tenant_id and t.id = p_ref and t.status in ('approved', 'running') and t.approved_at is not null
                      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace(p_number, '[^0-9]', '', 'g') and regexp_replace(p_number, '[^0-9]', '', 'g') <> '');
  elsif p_kind = 'standing_rule' and p_ref is not null and p_number is not null then
    return exists (select 1 from public.outreach_items i join public.outreach_rules r on r.tenant_id = i.tenant_id and r.id = i.rule_id join public.contacts c on c.tenant_id = i.tenant_id and c.id = i.contact_id
                    where i.tenant_id = p_tenant_id and i.id = p_ref and i.status in ('waiting', 'waiting_for_minutes') and r.active and r.paused_reason is null and r.approved_at is not null
                      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace(p_number, '[^0-9]', '', 'g') and regexp_replace(p_number, '[^0-9]', '', 'g') <> '');
  elsif p_kind = 'plan' and p_ref is not null and p_number is not null then
    return exists (select 1 from public.outreach_items i join public.outreach_batches b on b.tenant_id = i.tenant_id and b.id = i.batch_id join public.contacts c on c.tenant_id = i.tenant_id and c.id = i.contact_id
                    where i.tenant_id = p_tenant_id and i.id = p_ref and i.status in ('waiting', 'waiting_for_minutes') and b.status = 'running' and b.approved_at is not null
                      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace(p_number, '[^0-9]', '', 'g') and regexp_replace(p_number, '[^0-9]', '', 'g') <> '');
  end if;
  return false;
end;
$$;
revoke all on function public.call_approved(uuid, text, uuid, text) from public, anon;
grant execute on function public.call_approved(uuid, text, uuid, text) to authenticated;
comment on function public.call_approved(uuid, text, uuid, text) is 'Is THIS call covered by something the Owner approved (their own press, an approved task, a standing rule that is on, an approved batch)? Owner, Admin, the phone server.';
