-- The shop's STREET ADDRESS (13 Nov 2026, for Settings > About my business): a street line, the area and a six-digit PIN code, next to the town and phone that are already there.
-- Read by any member, saved by the Owner (the same rule as the town and the phone). Each field may be sent as null to clear it.

alter table workspace.profiles
  add column address_line text check (address_line is null or (char_length(btrim(address_line)) between 3 and 160 and app.text_is_clean(address_line))),
  add column area         text check (area is null or (char_length(btrim(area)) between 2 and 80 and app.text_is_clean(area))),
  add column pincode      text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$');
comment on column workspace.profiles.pincode is 'SAFE: a six-digit PIN code of the shop. CLEAN-EXEMPT: strict pattern CHECK';

create or replace function app.workspace_business_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', t.name,
    'type', case when w.pack_code = 'general_business' then 'other' else w.pack_code end,
    'type_name', v.manifest -> 'names' ->> 'en',
    'type_label', case when w.pack_code = 'general_business' then p.type_label end,
    'city', p.town,
    'phone', p.phone,
    'address_line', p.address_line,
    'area', p.area,
    'pincode', p.pincode,
    'languages', to_jsonb(coalesce(p.languages, '{}'::text[])),
    'logo_path', p.logo_path,
    'name_used_in', jsonb_build_array('assistant_greeting', 'voice_preview', 'call_opening', 'whatsapp_opening', 'menu_header'),
    'updated_at', p.updated_at)
  from public.tenants t
  join packs.workspace_pack w on w.tenant_id = t.id
  join packs.pack_versions v on v.code = w.pack_code and v.version = w.pack_version
  left join workspace.profiles p on p.tenant_id = t.id
  where t.id = p_tenant
$$;

create or replace function public.workspace_business_set(p_tenant_id uuid, p_patch jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_city    text;
  v_phone   text;
  v_addr    text;
  v_area    text;
  v_pin     text;
  v_label   text;
  v_langs   text[];
  v_type    text;
  v_code    text;
  v_version integer;
  v_cur     packs.workspace_pack;
  v_changed text[] := '{}';
  v_old     text;
  v_table   text;
  v_has     boolean;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('name', 'type', 'type_label', 'city', 'phone', 'address_line', 'area', 'pincode', 'languages')) then
    perform app.workspace_error('invalid');
  end if;
  insert into workspace.profiles (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  select * into v_cur from packs.workspace_pack where tenant_id = p_tenant_id for update;

  -- the name (the workspace's own)
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if jsonb_typeof(p_patch -> 'name') <> 'string' or char_length(v_name) not between 1 and 120 or not app.text_is_clean(v_name) then
      perform app.workspace_error('invalid');
    end if;
    update public.tenants set name = v_name where id = p_tenant_id;
    v_changed := array_append(v_changed, 'name');
  end if;

  -- the type: a pack code, or "other" (the generic Lead Desk type) with the Owner's own words
  if p_patch ? 'type' or p_patch ? 'type_label' then
    v_type := coalesce(p_patch ->> 'type', case when v_cur.pack_code = 'general_business' then 'other' else v_cur.pack_code end);
    if jsonb_typeof(coalesce(p_patch -> 'type', '"x"'::jsonb)) <> 'string' or v_type !~ '^[a-z][a-z0-9_]{1,30}$' then
      perform app.workspace_error('invalid');
    end if;
    v_code := case when v_type = 'other' then 'general_business' else v_type end;
    if v_code <> v_cur.pack_code then
      select max(v.version) into v_version from packs.pack_versions v where v.code = v_code and v.status in ('preview', 'published');
      if v_version is null then
        perform app.workspace_conflict('unknown_type');
      end if;
      -- out of a deep pack only when it holds none of its records; into one only when the business has no leads yet (a deep pack's screens would not show them)
      if app.pack_is_deep(v_cur.pack_code, v_cur.pack_version) and not app.pack_is_deep(v_code, v_version) then
        foreach v_table in array array['public.catalogue_items', 'public.orders', 'public.quotes', 'public.students', 'public.fee_plans'] loop
          if to_regclass(v_table) is not null then
            execute format('select exists (select 1 from %s where tenant_id = $1)', v_table) into v_has using p_tenant_id;
            if v_has then
              perform app.workspace_conflict('pack_data_present');
            end if;
          end if;
        end loop;
      end if;
      if app.pack_is_deep(v_code, v_version) and not app.pack_is_deep(v_cur.pack_code, v_cur.pack_version)
         and exists (select 1 from public.leads l where l.tenant_id = p_tenant_id) then
        perform app.workspace_conflict('lead_data_present');
      end if;
      v_old := v_cur.pack_code;
      update packs.workspace_pack set pack_code = v_code, pack_version = v_version, source = 'owner', chosen_by = v_uid, chosen_at = now() where tenant_id = p_tenant_id;
      perform app.apply_pack_fields(p_tenant_id, v_code, v_version, v_uid);
      perform app.write_audit_event(p_tenant_id, 'workspace_pack.choose', 'workspace_pack', p_tenant_id, null,
                                    jsonb_build_object('pack', v_code, 'from', v_old, 'version', v_version, 'source', 'owner'));
      v_changed := array_append(v_changed, 'type');
    end if;
    -- the words of "other": required for it, kept for no other type
    if v_code = 'general_business' then
      v_label := btrim(coalesce(case when p_patch ? 'type_label' then p_patch ->> 'type_label' else (select p.type_label from workspace.profiles p where p.tenant_id = p_tenant_id) end, ''));
      if char_length(v_label) not between 2 and 60 or not app.text_is_clean(v_label) then
        perform app.workspace_error('invalid');
      end if;
      update workspace.profiles set type_label = v_label where tenant_id = p_tenant_id;
      if p_patch ? 'type_label' then
        v_changed := array_append(v_changed, 'type_label');
      end if;
    else
      update workspace.profiles set type_label = null where tenant_id = p_tenant_id;
    end if;
  end if;

  if p_patch ? 'city' then
    v_city := nullif(btrim(coalesce(p_patch ->> 'city', '')), '');
    if p_patch -> 'city' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'city') <> 'string' or v_city is null or char_length(v_city) not between 2 and 80 or not app.text_is_clean(v_city)) then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set town = v_city where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'city');
  end if;
  if p_patch ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_patch ->> 'phone', '')), '');
    if p_patch -> 'phone' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'phone') <> 'string' or v_phone is null or v_phone !~ '^\+?[0-9 ()-]{6,20}$') then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set phone = v_phone where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'phone');
  end if;
  -- the shop's street address (13 Nov 2026): a street line, the area and a six-digit PIN code, each may be sent as null to clear it
  if p_patch ? 'address_line' then
    v_addr := nullif(btrim(coalesce(p_patch ->> 'address_line', '')), '');
    if p_patch -> 'address_line' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'address_line') <> 'string' or v_addr is null or char_length(v_addr) not between 3 and 160 or not app.text_is_clean(v_addr)) then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set address_line = v_addr where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'address_line');
  end if;
  if p_patch ? 'area' then
    v_area := nullif(btrim(coalesce(p_patch ->> 'area', '')), '');
    if p_patch -> 'area' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'area') <> 'string' or v_area is null or char_length(v_area) not between 2 and 80 or not app.text_is_clean(v_area)) then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set area = v_area where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'area');
  end if;
  if p_patch ? 'pincode' then
    v_pin := nullif(btrim(coalesce(p_patch ->> 'pincode', '')), '');
    if p_patch -> 'pincode' <> 'null'::jsonb and (jsonb_typeof(p_patch -> 'pincode') <> 'string' or v_pin is null or v_pin !~ '^[1-9][0-9]{5}$') then
      perform app.workspace_error('invalid');
    end if;
    update workspace.profiles set pincode = v_pin where tenant_id = p_tenant_id;
    v_changed := array_append(v_changed, 'pincode');
  end if;
  if p_patch ? 'languages' then
    if jsonb_typeof(p_patch -> 'languages') <> 'array' then
      perform app.workspace_error('invalid');
    end if;
    select coalesce(array_agg(distinct l order by l), '{}') into v_langs from jsonb_array_elements_text(p_patch -> 'languages') l;
    if cardinality(v_langs) not between 1 and 5 then
      perform app.workspace_error('invalid');
    end if;
    begin
      update workspace.profiles set languages = v_langs where tenant_id = p_tenant_id;
    exception when check_violation then
      perform app.workspace_error('invalid');
    end;
    v_changed := array_append(v_changed, 'languages');
  end if;

  update workspace.profiles set updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
  perform app.write_audit_event(p_tenant_id, 'workspace.business_saved', 'workspace', p_tenant_id, null, jsonb_build_object('changed', to_jsonb(v_changed)));
  return app.workspace_business_json(p_tenant_id);
end;
$$;
