-- Job BI (ADR 0073), part 2 of 4: SPREADSHEET IMPORT JOBS. The API turns a CSV/XLSX into rows and a mapping (it never stores the file or the rows); the database keeps ONE small record per import:
-- which file (its sha256), which mapping (column NUMBERS per field, no header text), how many rows, what the preview and the result counted, and the first issues (a line number, a closed code and a
-- field name; never a cell value). No personal data is in it, so it needs no erasure entry.
--
--   integrations.import_jobs                       private schema: no client role can read or write it directly
--   public.import_job_preview_save(...)            Owner/Admin: record (or refresh) the preview of a job
--   public.import_job_get / import_job_list        Owner/Admin: read
--   public.import_job_begin(...)                   Owner/Admin + second factor: the job may run only with the SAME file and mapping as its preview; a completed job replays (no second run)
--   public.import_job_finish(...)                  Owner/Admin + second factor: close the job with its counts; audit event
--   public.catalogue_stock_list / catalogue_stock_apply   the stock import: list the items by name; set stock_status on listed items (never creates, never deletes, never changes anything else)
--
-- SQLSTATEs as part 1: 42501 deny, 22023 invalid, 23503 not found, SM306 second factor, SM602 the job is not in a state that allows this, SM603 not the same file or mapping as the preview.

create table integrations.import_jobs (
  id             uuid primary key,
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  kind           text not null check (kind in ('customers', 'stock')),
  status         text not null default 'previewed' check (status in ('previewed', 'completed', 'failed')),
  file_sha256    text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  mapping        jsonb not null check (jsonb_typeof(mapping) = 'object' and char_length(mapping::text) <= 2000 and app.text_is_clean(mapping::text)),
  mapping_sha256 text not null check (mapping_sha256 ~ '^[0-9a-f]{64}$'),
  rows_total     integer not null check (rows_total between 0 and 500),
  counts         jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object' and char_length(counts::text) <= 2000),
  issues         jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) <= 200 and char_length(issues::text) <= 20000 and app.text_is_clean(issues::text)),
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_by   uuid,
  completed_at   timestamptz,
  unique (tenant_id, id),
  check ((status = 'completed') = (completed_at is not null))
);
create index import_jobs_tenant_idx on integrations.import_jobs (tenant_id, created_at desc, id);
alter table integrations.import_jobs enable row level security;
alter table integrations.import_jobs force row level security;
revoke all on integrations.import_jobs from public, anon, authenticated, service_role;
comment on table integrations.import_jobs is 'Job BI: one record per spreadsheet import. No personal data: hashes, column numbers, counts, line numbers and closed codes only.';

create function app.import_job_json(j integrations.import_jobs) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.status, 'file_sha256', j.file_sha256, 'mapping', j.mapping, 'mapping_sha256', j.mapping_sha256,
                            'rows_total', j.rows_total, 'counts', j.counts, 'issues', j.issues, 'created_at', j.created_at, 'updated_at', j.updated_at, 'completed_at', j.completed_at)
$$;
revoke all on function app.import_job_json(integrations.import_jobs) from public;

create function public.import_job_preview_save(
  p_tenant_id uuid, p_job_id uuid, p_kind text, p_file_sha256 text, p_mapping jsonb, p_mapping_sha256 text, p_rows integer, p_counts jsonb, p_issues jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j integrations.import_jobs;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  if p_job_id is null or p_kind is null or p_kind not in ('customers', 'stock') or p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$'
     or p_mapping is null or p_mapping_sha256 is null or p_mapping_sha256 !~ '^[0-9a-f]{64}$' or p_rows is null or p_rows not between 0 and 500
     or p_counts is null or p_issues is null then
    perform app.integration_error('invalid');
  end if;
  select * into j from integrations.import_jobs x where x.id = p_job_id for update;
  if found then
    if j.tenant_id <> p_tenant_id or j.kind <> p_kind then
      perform app.integration_error('invalid');
    end if;
    if j.status = 'completed' then
      return app.import_job_json(j);   -- a completed job never changes
    end if;
    update integrations.import_jobs
       set file_sha256 = p_file_sha256, mapping = p_mapping, mapping_sha256 = p_mapping_sha256, rows_total = p_rows, counts = p_counts, issues = p_issues, status = 'previewed', updated_at = now()
     where id = p_job_id returning * into j;
  else
    begin
      insert into integrations.import_jobs (id, tenant_id, kind, file_sha256, mapping, mapping_sha256, rows_total, counts, issues, created_by)
      values (p_job_id, p_tenant_id, p_kind, p_file_sha256, p_mapping, p_mapping_sha256, p_rows, p_counts, p_issues, auth.uid())
      returning * into j;
    exception when check_violation then
      perform app.integration_error('invalid');
    end;
  end if;
  return app.import_job_json(j);
end;
$$;
revoke all on function public.import_job_preview_save(uuid, uuid, text, text, jsonb, text, integer, jsonb, jsonb) from public, anon;
grant execute on function public.import_job_preview_save(uuid, uuid, text, text, jsonb, text, integer, jsonb, jsonb) to authenticated;

create function public.import_job_get(p_tenant_id uuid, p_job_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j integrations.import_jobs;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  select * into j from integrations.import_jobs x where x.tenant_id = p_tenant_id and x.id = p_job_id;
  if not found then
    perform app.integration_error('reference');
  end if;
  return app.import_job_json(j);
end;
$$;
revoke all on function public.import_job_get(uuid, uuid) from public, anon;
grant execute on function public.import_job_get(uuid, uuid) to authenticated;

create function public.import_job_list(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.integration_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.import_job_json(x) order by x.created_at desc, x.id)
                     from (select * from integrations.import_jobs j where j.tenant_id = p_tenant_id order by j.created_at desc, j.id limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.import_job_list(uuid, integer) from public, anon;
grant execute on function public.import_job_list(uuid, integer) to authenticated;

-- The job may run only with the file and the mapping it was previewed with. A completed job answers with its stored result and `replay: true` (nothing runs twice); a failed or previewed job may run.
create function public.import_job_begin(p_tenant_id uuid, p_job_id uuid, p_file_sha256 text, p_mapping_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j integrations.import_jobs;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  perform app.require_aal2();
  select * into j from integrations.import_jobs x where x.tenant_id = p_tenant_id and x.id = p_job_id for update;
  if not found then
    perform app.integration_error('reference');
  end if;
  if j.file_sha256 is distinct from p_file_sha256 or j.mapping_sha256 is distinct from p_mapping_sha256 then
    perform app.integration_error('mismatch');
  end if;
  if j.status <> 'completed' then
    perform app.write_audit_event(p_tenant_id, 'import.start', 'data_import', p_job_id, null, jsonb_build_object('kind', j.kind, 'rows', j.rows_total));
  end if;
  return app.import_job_json(j) || jsonb_build_object('replay', j.status = 'completed');
end;
$$;
revoke all on function public.import_job_begin(uuid, uuid, text, text) from public, anon;
grant execute on function public.import_job_begin(uuid, uuid, text, text) to authenticated;

create function public.import_job_finish(p_tenant_id uuid, p_job_id uuid, p_status text, p_counts jsonb, p_issues jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j integrations.import_jobs;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  perform app.require_aal2();
  if p_status is null or p_status not in ('completed', 'failed') or p_counts is null or p_issues is null then
    perform app.integration_error('invalid');
  end if;
  select * into j from integrations.import_jobs x where x.tenant_id = p_tenant_id and x.id = p_job_id for update;
  if not found then
    perform app.integration_error('reference');
  end if;
  if j.status = 'completed' then
    return app.import_job_json(j);   -- already closed: the first result stands
  end if;
  begin
    update integrations.import_jobs
       set status = p_status, counts = p_counts, issues = p_issues, updated_at = now(),
           completed_by = case when p_status = 'completed' then auth.uid() end, completed_at = case when p_status = 'completed' then now() end
     where id = p_job_id returning * into j;
  exception when check_violation then
    perform app.integration_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'import.' || p_status, 'data_import', p_job_id, null, jsonb_build_object('kind', j.kind, 'rows', j.rows_total, 'counts', p_counts));
  return app.import_job_json(j);
end;
$$;
revoke all on function public.import_job_finish(uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.import_job_finish(uuid, uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the stock import: the items by name, and the status change
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.catalogue_stock_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'stock_status', i.stock_status, 'active', i.active) order by i.name, i.id)
                     from (select * from public.catalogue_items c where c.tenant_id = p_tenant_id order by c.name, c.id limit 3000) i), '[]'::jsonb);
end;
$$;
revoke all on function public.catalogue_stock_list(uuid) from public, anon;
grant execute on function public.catalogue_stock_list(uuid) to authenticated;

-- Set stock_status on listed items of THIS business: [{"id": uuid, "stock_status": "in_stock" | "few_left" | "made_to_order"}], at most 500. Nothing else changes; an item that is not this business's is
-- counted as missing and left alone. The job must be a previewed or failed stock job (the begin call has checked the file and the mapping).
create function public.catalogue_stock_apply(p_tenant_id uuid, p_job_id uuid, p_changes jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
  v_same    integer := 0;
  v_missing integer := 0;
  c         jsonb;
  v_id      uuid;
  v_status  text;
  v_old     text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  perform app.require_aal2();
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    perform app.integration_error('invalid');
  end if;
  if not exists (select 1 from integrations.import_jobs j where j.tenant_id = p_tenant_id and j.id = p_job_id and j.kind = 'stock' and j.status in ('previewed', 'failed')) then
    perform app.integration_error('state');
  end if;
  for c in select * from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(c) <> 'object' or (c ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (c ->> 'stock_status') not in ('in_stock', 'few_left', 'made_to_order') then
      perform app.integration_error('invalid');
    end if;
    v_id := (c ->> 'id')::uuid;
    v_status := c ->> 'stock_status';
    select i.stock_status into v_old from public.catalogue_items i where i.tenant_id = p_tenant_id and i.id = v_id for update;
    if not found then
      v_missing := v_missing + 1;
    elsif v_old = v_status then
      v_same := v_same + 1;
    else
      update public.catalogue_items set stock_status = v_status, updated_by = auth.uid(), updated_at = now() where tenant_id = p_tenant_id and id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('updated', v_updated, 'unchanged', v_same, 'missing', v_missing);
end;
$$;
revoke all on function public.catalogue_stock_apply(uuid, uuid, jsonb) from public, anon;
grant execute on function public.catalogue_stock_apply(uuid, uuid, jsonb) to authenticated;
