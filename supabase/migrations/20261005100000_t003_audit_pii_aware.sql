-- T003 / 1b-1: PII-aware audit (ADR 0005, option "A-hybrid").
--
-- audit_events is permanent and append-only, so it must never hold personal data. Each table's
-- audit trigger now takes a list of PII columns:
--     execute function app.audit_row_change('<entity>', '<col1>,<col2>,...')
-- PII columns are recorded BY NAME ONLY: they are removed from old_values / new_values, and the
-- names of the ones that changed go into metadata.pii_fields_changed. Every other column keeps its
-- before/after values exactly as in T002. The list is the table's contract with the privacy policy;
-- a catalog guard compares it with the `PII:` column comments.
--
-- Backwards compatible: the T002 triggers on tenants and memberships pass no list, so nothing is
-- removed and metadata stays '{}'. Existing audit rows are untouched.

-- Writer with metadata. The 6-argument writer from T002 stays (same signature) and delegates here.
create function app.write_audit_event(
  p_tenant_id   uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_old         jsonb,
  p_new         jsonb,
  p_metadata    jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_request_id text;
begin
  begin
    -- Client-supplied header: cap its length so it cannot bloat the audit table.
    v_request_id := left(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id', 100);
  exception when others then
    v_request_id := null;
  end;

  insert into public.audit_events (
    tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
    old_values, new_values, metadata, request_id
  ) values (
    p_tenant_id,
    v_uid,
    case when v_uid is null then 'system' else 'user' end,
    p_action,
    p_entity_type,
    p_entity_id,
    p_old,
    p_new,
    coalesce(p_metadata, '{}'::jsonb),
    v_request_id
  );
end;
$$;

revoke all on function app.write_audit_event(uuid, text, text, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function app.write_audit_event(
  p_tenant_id   uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_old         jsonb,
  p_new         jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  select app.write_audit_event(p_tenant_id, p_action, p_entity_type, p_entity_id, p_old, p_new, '{}'::jsonb)
$$;

create or replace function app.audit_row_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row    jsonb := coalesce(v_new, v_old);
  v_entity text  := tg_argv[0];
  -- tg_argv[1]: comma-separated PII column names (optional)
  v_pii    text[] := case
                       when coalesce(tg_argv[1], '') = '' then '{}'::text[]
                       else string_to_array(replace(tg_argv[1], ' ', ''), ',')
                     end;
  v_touched text[];
begin
  -- Updates that only touched updated_at are noise. PII-only changes are NOT noise: they are
  -- recorded (by field name), so this comparison deliberately uses the full rows.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  select coalesce(array_agg(k order by k), '{}'::text[]) into v_touched
  from unnest(v_pii) as k
  where case tg_op
          when 'INSERT' then (v_new ->> k) is not null
          when 'DELETE' then (v_old ->> k) is not null
          else (v_old -> k) is distinct from (v_new -> k)
        end;

  perform app.write_audit_event(
    -- a tenant row is its own tenant; every other audited table carries tenant_id
    (case when tg_table_name = 'tenants' then v_row ->> 'id' else v_row ->> 'tenant_id' end)::uuid,
    v_entity || '.' || case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    v_entity,
    (v_row ->> 'id')::uuid,
    v_old - v_pii,   -- values of PII columns never leave this function
    v_new - v_pii,
    case when cardinality(v_pii) > 0 then jsonb_build_object('pii_fields_changed', to_jsonb(v_touched)) else '{}'::jsonb end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Classification registry convention (read by the catalog guards):
--   comment on column <table>.<col> is 'PII: <why>'   -> audited by name only; must be on the trigger list
--   comment on column <table>.<col> is 'SAFE: <why>'  -> audited with values
-- Every text / text[] / jsonb column of an audited table must carry one of the two. Free text is
-- PII unless someone argues otherwise in the comment.
comment on column public.tenants.name is 'SAFE: workspace display name chosen by the owner; not personal data';
comment on column public.tenants.slug is 'SAFE: URL identifier; not personal data';
