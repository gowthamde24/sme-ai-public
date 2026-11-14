-- "Call Yashwanth Reddy" when he is not in the contacts yet (owner, 14 Nov 2026): the assistant asks for the number, and the number the Owner says is the instruction to save him.
--   * public.task_person_save(tenant, name, phone): Owner, Admin and Sales save ONE person (a contact and its lead). A number that is already a contact is merged, never doubled (the existing person is returned
--     with `created` false). The consent stays `unknown`: the plan card's own yes records it (an owner who names one person themselves, app/tasks/service.py approve).
create function public.task_person_save(p_tenant_id uuid, p_name text, p_phone text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_norm    text := app.phone_norm(p_phone);
  v_phone   text;
  v_contact uuid;
  v_lead    uuid;
  v_created boolean := false;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if char_length(v_name) not between 2 and 80 or not app.text_is_clean(v_name) or v_norm is null or length(v_norm) not between 7 and 15 then
    perform app.task_error('invalid');
  end if;
  v_phone := '+' || case when length(v_norm) = 10 then '91' else '' end || v_norm;
  select k.id into v_contact from public.contacts k
   where k.tenant_id = p_tenant_id and k.erased_at is null and k.archived_at is null and k.phone is not null and app.phone_norm(k.phone) = v_norm
   order by k.created_at, k.id limit 1;
  if v_contact is null then
    insert into public.contacts (tenant_id, full_name, phone, created_by, created_via) values (p_tenant_id, v_name, v_phone, auth.uid(), 'agent') returning id into v_contact;
    v_created := true;
  end if;
  v_lead := app.contact_lead(p_tenant_id, v_contact, 'assistant');
  if v_lead is null then
    perform app.task_error('reference');
  end if;
  return jsonb_build_object('contact_id', v_contact, 'lead_id', v_lead, 'created', v_created);
end;
$$;
revoke all on function public.task_person_save(uuid, text, text) from public, anon;
grant execute on function public.task_person_save(uuid, text, text) to authenticated;
