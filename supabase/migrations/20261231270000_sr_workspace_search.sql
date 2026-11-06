-- Search for the ⌘K palette (docs/contracts/search.md). SECURITY INVOKER: the caller's own row-level security decides every row, so a person finds only what they may already see; a group their
-- role cannot read at all comes back empty (its block catches the refusal). Case, spaces and Unicode form do not matter; the phone matches on its end only; at most 5 per kind, newest first.

create function app.search_key(p text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select regexp_replace(lower(normalize(coalesce(p, ''), NFC)), '\s+', '', 'g') $$;
revoke all on function app.search_key(text) from public;
grant execute on function app.search_key(text) to authenticated;

-- does this workspace run the school pack? (the module check itself is not for clients; this answers only for a member of the workspace)
create function app.search_is_school(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.is_tenant_member(p_tenant) and app.module_enabled(p_tenant, 'programmes') $$;
revoke all on function app.search_is_school(uuid) from public;
grant execute on function app.search_is_school(uuid) to authenticated;

create function public.workspace_search(p_tenant_id uuid, p_q text) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_q      text := btrim(coalesce(p_q, ''));
  v_key    text;
  v_like   text;
  v_digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  v_phone  boolean;
  v_number integer;
  v_groups jsonb := '[]'::jsonb;
  v_items  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 80 or not app.text_is_clean(v_q) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_key := app.search_key(v_q);
  v_like := '%' || replace(replace(replace(v_key, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_phone := v_q ~ '^[0-9 +().-]+$' and char_length(v_digits) >= 4;
  v_number := case when v_q ~* '^\s*(q|o|#|no\.?|quote|order)?\s*#?\s*[0-9]{1,9}\s*$' then nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '')::integer end;

  -- leads
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'title', z.title, 'sub', z.sub, 'at', z.created_at) order by z.created_at desc, z.id desc), '[]'::jsonb) into v_items
      from (select l.id, l.created_at, coalesce(k.full_name, c.name, 'Lead') as title,
                   concat_ws(' · ', case when k.full_name is not null then c.name end, c.city,
                             case when k.phone is not null then '…' || right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 4) end) as sub
              from public.leads l
              left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
              left join public.contacts k on k.tenant_id = l.tenant_id and k.id = l.contact_id
             where l.tenant_id = p_tenant_id and l.archived_at is null
               and case when v_phone then k.phone is not null and right(regexp_replace(k.phone, '[^0-9]', '', 'g'), char_length(v_digits)) = v_digits
                        else app.search_key(k.full_name) like v_like escape '\' or app.search_key(c.name) like v_like escape '\' end
             order by l.created_at desc, l.id desc limit 5) z;
    if jsonb_array_length(v_items) > 0 then v_groups := v_groups || jsonb_build_object('kind', 'lead', 'items', v_items); end if;
  exception when insufficient_privilege then null;
  end;

  -- customers (companies)
  if not v_phone then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'title', z.name, 'sub', z.city) order by z.created_at desc, z.id desc), '[]'::jsonb) into v_items
        from (select c.id, c.name, c.city, c.created_at from public.companies c
               where c.tenant_id = p_tenant_id and app.search_key(c.name) like v_like escape '\'
               order by c.created_at desc, c.id desc limit 5) z;
      if jsonb_array_length(v_items) > 0 then v_groups := v_groups || jsonb_build_object('kind', 'customer', 'items', v_items); end if;
    exception when insufficient_privilege then null;
    end;
  end if;

  -- quotes (by number or by the customer's name)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'title', 'Quote ' || z.quote_no, 'sub', concat_ws(' · ', z.name, z.status), 'at', z.created_at) order by z.created_at desc, z.id desc), '[]'::jsonb)
      into v_items
      from (select q.id, q.quote_no, q.status::text as status, q.created_at, c.name from public.quotes q
              left join public.leads l on l.tenant_id = q.tenant_id and l.id = q.lead_id
              left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
             where q.tenant_id = p_tenant_id and ((v_number is not null and q.quote_no = v_number) or (not v_phone and app.search_key(c.name) like v_like escape '\'))
             order by q.created_at desc, q.id desc limit 5) z;
    if jsonb_array_length(v_items) > 0 then v_groups := v_groups || jsonb_build_object('kind', 'quote', 'items', v_items); end if;
  exception when insufficient_privilege then null;
  end;

  -- orders (by number or by the customer's name)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'title', 'Order ' || z.order_no, 'sub', concat_ws(' · ', z.name, z.state), 'at', z.created_at) order by z.created_at desc, z.id desc), '[]'::jsonb)
      into v_items
      from (select o.id, o.order_no, o.state::text as state, o.created_at, c.name from public.orders o
              left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
              left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
             where o.tenant_id = p_tenant_id and ((v_number is not null and o.order_no = v_number) or (not v_phone and app.search_key(c.name) like v_like escape '\'))
             order by o.created_at desc, o.id desc limit 5) z;
    if jsonb_array_length(v_items) > 0 then v_groups := v_groups || jsonb_build_object('kind', 'order', 'items', v_items); end if;
  exception when insufficient_privilege then null;
  end;

  -- students (school pack only)
  if app.search_is_school(p_tenant_id) then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'title', z.title, 'sub', z.sub, 'at', z.created_at) order by z.created_at desc, z.id desc), '[]'::jsonb) into v_items
        from (select s.id, s.created_at, coalesce(s.child_label, k.full_name, 'Student') as title, case when s.admission_no is not null then 'Adm. ' || s.admission_no end as sub
                from public.students s
                left join public.contacts k on k.tenant_id = s.tenant_id and k.id = s.contact_id
               where s.tenant_id = p_tenant_id and s.erased_at is null
                 and (app.search_key(coalesce(s.child_label, k.full_name)) like v_like escape '\' or lower(s.admission_no) = lower(v_q))
               order by s.created_at desc, s.id desc limit 5) z;
      if jsonb_array_length(v_items) > 0 then v_groups := v_groups || jsonb_build_object('kind', 'student', 'items', v_items); end if;
    exception when insufficient_privilege then null;
    end;
  end if;

  return jsonb_build_object('q', v_q, 'groups', v_groups);
end;
$$;
revoke all on function public.workspace_search(uuid, text) from public, anon;
grant execute on function public.workspace_search(uuid, text) to authenticated;
