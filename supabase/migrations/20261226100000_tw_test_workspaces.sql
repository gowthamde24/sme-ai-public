-- The owner's test workspaces (job test-workspaces, C2 -> C1 list of 4 Nov 2026).
--
-- (Outreach for a school is NOT changed here: night 4 part E1 lets a school plan admission calls and campus-visit rules (pgTAP 129 D1, D5); the 2 Nov job says no outreach features for a school.
--  The menu hides them (C2); whether the API and the database should refuse them too is the owner's decision.)
-- 2. EXAMPLE DATA REACHES MORE OF A TEST WEEK. The example batch may also hold enquiries, requirements (and their fields), knowledge sources and facts, lead arrivals and lead profiles: tables whose rows
--    may be deleted under their own rules. `app.operator_mark_example` (operator only, a reason in the audit log) registers a row a seed script made through the API into the workspace's live batch, with
--    the same fingerprint the load takes. Business records the database never deletes (quotes, orders, ledger entries, calls, fees, students, outcomes: before-delete guards) are NOT accepted: removing
--    those is a policy decision for the owner, not a side effect of "Remove example data".
-- 3. The removal deletes in passes (a row something else still points at is tried again after its dependants are gone), keeps and counts every row that was changed or is used by a row outside the batch,
--    and reports the new tables under `other`. `example_data_reset` = remove + load in ONE transaction (Owner, Admin).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the example batch holds more kinds of row
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table packs.example_rows drop constraint example_rows_table_name_check;
alter table packs.example_rows add constraint example_rows_table_name_check check (table_name in (
  'companies', 'contacts', 'leads', 'products', 'enquiries', 'requirements', 'requirement_fields', 'knowledge_sources', 'knowledge_facts', 'lead_arrivals', 'lead_profiles'));

-- operator only (a direct database session: no signed-in caller); the row must exist in that workspace
create function app.operator_mark_example(p_tenant uuid, p_table text, p_row uuid, p_reason text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  w       packs.workspace_pack;
  v_batch packs.example_batches;
  v_hash  text;
  v_owner uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of at least 20 characters is required' using errcode = '22023';
  end if;
  if p_tenant is null or p_row is null or p_table is null or p_table not in (
       'companies', 'contacts', 'leads', 'products', 'enquiries', 'requirements', 'requirement_fields', 'knowledge_sources', 'knowledge_facts', 'lead_arrivals', 'lead_profiles') then
    raise exception 'that table cannot hold example data (its rows are never deleted)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('example_data:' || p_tenant::text, 0));
  execute format('select md5((to_jsonb(t) - ''updated_at'')::text) from public.%I t where t.tenant_id = $1 and t.id = $2', p_table) into v_hash using p_tenant, p_row;
  if v_hash is null then
    raise exception 'not found' using errcode = '23503';
  end if;
  select * into v_batch from packs.example_batches b where b.tenant_id = p_tenant and b.removed_at is null;
  if not found then
    select * into w from packs.workspace_pack x where x.tenant_id = p_tenant;
    if not found then
      raise exception 'not found' using errcode = '23503';
    end if;
    select m.user_id into v_owner from public.memberships m where m.tenant_id = p_tenant and m.role = 'owner' order by m.created_at limit 1;
    if v_owner is null then
      raise exception 'not found' using errcode = '23503';
    end if;
    insert into packs.example_batches (tenant_id, pack_code, pack_version, loaded_by) values (p_tenant, w.pack_code, w.pack_version, v_owner) returning * into v_batch;
  end if;
  insert into packs.example_rows (batch_id, tenant_id, table_name, row_id, made_hash) values (v_batch.id, p_tenant, p_table, p_row, v_hash)
  on conflict (batch_id, table_name, row_id) do update set made_hash = excluded.made_hash;
  perform app.write_audit_event(p_tenant, 'example_data.mark', 'example_data', v_batch.id, null, jsonb_build_object('table', p_table, 'reason', left(p_reason, 200)));
  return jsonb_build_object('batch_id', v_batch.id, 'table', p_table, 'row_id', p_row);
end;
$$;
revoke all on function app.operator_mark_example(uuid, text, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. remove in passes; reset = remove + load
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.example_data_remove(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch    packs.example_batches;
  r          record;
  v_removed  jsonb := jsonb_build_object('companies', 0, 'contacts', 0, 'leads', 0, 'products', 0, 'other', 0);
  v_kept     jsonb := jsonb_build_object('companies', 0, 'contacts', 0, 'leads', 0, 'products', 0, 'other', 0);
  v_hash     text;
  v_pass     integer := 0;
  v_progress boolean := true;
  v_key      text;
  v_state    jsonb := '{}'::jsonb;   -- "table|row id" -> {t, r, s}: s = left | kept | gone | removed (no temporary table: this runs as the API's role through PostgREST)
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('example_data:' || p_tenant_id::text, 0));
  select * into v_batch from packs.example_batches b where b.tenant_id = p_tenant_id and b.removed_at is null;
  if not found then
    return jsonb_build_object('removed', v_removed, 'kept', v_kept, 'batch_id', null);
  end if;
  -- changed (or already gone) rows are decided once, before any delete
  for r in select x.table_name, x.row_id, x.made_hash from packs.example_rows x where x.batch_id = v_batch.id loop
    execute format('select md5((to_jsonb(t) - ''updated_at'')::text) from public.%I t where t.tenant_id = $1 and t.id = $2', r.table_name) into v_hash using p_tenant_id, r.row_id;
    v_state := v_state || jsonb_build_object(r.table_name || '|' || r.row_id::text,
                 jsonb_build_object('t', r.table_name, 'r', r.row_id, 's', case when v_hash is null then 'gone' when v_hash <> r.made_hash then 'kept' else 'left' end));
  end loop;
  -- unchanged rows: dependants first by the usual order, then pass again for whatever a sample row still pointed at
  while v_progress and v_pass < 8 loop
    v_progress := false;
    v_pass := v_pass + 1;
    for r in select e.key, e.value ->> 't' as t, (e.value ->> 'r')::uuid as rid from jsonb_each(v_state) e where e.value ->> 's' = 'left'
              order by case e.value ->> 't' when 'lead_profiles' then 1 when 'lead_arrivals' then 1 when 'requirement_fields' then 1 when 'knowledge_facts' then 1 when 'requirements' then 2
                                            when 'enquiries' then 3 when 'knowledge_sources' then 3 when 'leads' then 4 when 'contacts' then 5 when 'companies' then 6 else 7 end, e.key loop
      begin
        execute format('delete from public.%I where tenant_id = $1 and id = $2', r.t) using p_tenant_id, r.rid;
        v_state := jsonb_set(v_state, array[r.key, 's'], '"removed"'::jsonb);
        v_progress := true;
      exception when foreign_key_violation then
        null;   -- something still points at it: maybe a sample row of a later pass, maybe a row of the person's own
      end;
    end loop;
  end loop;
  for r in select e.value ->> 't' as t, e.value ->> 's' as st from jsonb_each(v_state) e where e.value ->> 's' in ('removed', 'left', 'kept') loop
    v_key := case when r.t in ('companies', 'contacts', 'leads', 'products') then r.t else 'other' end;
    if r.st = 'removed' then
      v_removed := jsonb_set(v_removed, array[v_key], to_jsonb((v_removed ->> v_key)::integer + 1));
    else
      v_kept := jsonb_set(v_kept, array[v_key], to_jsonb((v_kept ->> v_key)::integer + 1));   -- changed, or used by a row outside the sample
    end if;
  end loop;
  update packs.example_batches set removed_at = now(), removed_by = auth.uid() where id = v_batch.id;
  perform app.write_audit_event(p_tenant_id, 'example_data.remove', 'example_data', v_batch.id, null, jsonb_build_object('removed', v_removed, 'kept', v_kept));
  return jsonb_build_object('removed', v_removed, 'kept', v_kept, 'batch_id', v_batch.id);
end;
$$;
revoke all on function public.example_data_remove(uuid) from public, anon;
grant execute on function public.example_data_remove(uuid) to authenticated;

create function public.example_data_reset(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed jsonb;
  v_loaded  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_removed := public.example_data_remove(p_tenant_id);
  v_loaded := public.example_data_load(p_tenant_id);
  return jsonb_build_object('removed', v_removed -> 'removed', 'kept', v_removed -> 'kept', 'status', v_loaded);
end;
$$;
revoke all on function public.example_data_reset(uuid) from public, anon;
grant execute on function public.example_data_reset(uuid) to authenticated;
