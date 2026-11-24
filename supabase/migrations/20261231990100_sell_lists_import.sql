-- "What you sell" lists, slice 3 (28 Nov 2026): importing the rows of a file and remembering the heading -> column mapping.
--   public.sell_rows_import   up to 1,000 rows in ONE transaction: a row whose name already exists in the list UPDATES that item (only the cells the file carries; the others stay), a new name is added; all or nothing.
--                             Every row goes through sell_row_put, so every rule holds (cells fit their columns, only the Owner sets an amount, the 1,000-item limit, the clean-text rule). Optionally saves the mapping.
--   public.sell_list_mappings the remembered mappings of a list (any member reads).
-- Nothing existing is touched; rollback = drop these two functions (the table is slice 1's).

create function public.sell_rows_import(p_tenant_id uuid, p_list_id uuid, p_rows jsonb, p_label text default null, p_mapping jsonb default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  e         jsonb;
  v_name    text;
  v_cells   jsonb;
  v_old     public.sell_list_rows;
  v_created integer := 0;
  v_updated integer := 0;
  v_label   text := btrim(coalesce(p_label, ''));
begin
  if v_uid is null or p_tenant_id is null or p_list_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.list_error('deny');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    perform app.list_error('invalid');
  end if;
  if not exists (select 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_list_id and x.removed_at is null) then
    perform app.list_error('reference');
  end if;
  for e in select x from jsonb_array_elements(p_rows) x loop
    v_name := btrim(coalesce(e ->> 'name', ''));
    v_cells := coalesce(e -> 'cells', '{}'::jsonb);
    if jsonb_typeof(v_cells) <> 'object' then
      perform app.list_error('invalid');
    end if;
    select * into v_old from public.sell_list_rows r where r.tenant_id = p_tenant_id and r.list_id = p_list_id and r.removed_at is null and lower(r.name) = lower(v_name);
    if found then
      perform public.sell_row_put(p_tenant_id, p_list_id, v_old.id, v_old.name, v_old.cells || v_cells, v_old.active);
      v_updated := v_updated + 1;
    else
      perform public.sell_row_put(p_tenant_id, p_list_id, gen_random_uuid(), v_name, v_cells, true);
      v_created := v_created + 1;
    end if;
  end loop;
  if v_label <> '' and p_mapping is not null then
    if char_length(v_label) > 80 or not app.text_is_clean(v_label) or jsonb_typeof(p_mapping) <> 'object' or pg_column_size(p_mapping) > 4000
       or exists (select 1 from jsonb_each(p_mapping) m where char_length(m.key) not between 1 and 80 or not app.text_is_clean(m.key) or jsonb_typeof(m.value) not in ('string', 'null')) then
      perform app.list_error('invalid');
    end if;
    delete from public.sell_list_imports i where i.tenant_id = p_tenant_id and i.list_id = p_list_id and lower(i.label) = lower(v_label);
    insert into public.sell_list_imports (id, tenant_id, list_id, label, mapping, created_by) values (gen_random_uuid(), p_tenant_id, p_list_id, v_label, p_mapping, v_uid);
    -- at most 10 remembered mappings a list: the oldest go
    delete from public.sell_list_imports i where i.tenant_id = p_tenant_id and i.list_id = p_list_id
       and i.id not in (select j.id from public.sell_list_imports j where j.tenant_id = p_tenant_id and j.list_id = p_list_id order by j.created_at desc, j.id limit 10);
  end if;
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;
revoke all on function public.sell_rows_import(uuid, uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.sell_rows_import(uuid, uuid, jsonb, text, jsonb) to authenticated;

create function public.sell_list_mappings(p_tenant_id uuid, p_list_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.list_error('deny');
  end if;
  if not exists (select 1 from public.sell_lists x where x.tenant_id = p_tenant_id and x.id = p_list_id and x.removed_at is null) then
    perform app.list_error('reference');
  end if;
  return jsonb_build_object('mappings', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'mapping', i.mapping) order by i.created_at desc, i.id)
                                                    from public.sell_list_imports i where i.tenant_id = p_tenant_id and i.list_id = p_list_id), '[]'::jsonb));
end;
$$;
revoke all on function public.sell_list_mappings(uuid, uuid) from public, anon;
grant execute on function public.sell_list_mappings(uuid, uuid) to authenticated;
