-- Job CK (wave 1, C1, blueprint section 6): THE SPREADSHEET IMPORT CAP GOES FROM 500 TO 5,000 ROWS. A new migration; job BI's files are not edited.
--
--   * integrations.import_jobs.rows_total may now be 0 to 5000 (the check is replaced).
--   * public.import_job_preview_save is replaced as a FULL COPY of job BI's definition; the ONE changed line is `p_rows not between 0 and 5000` (was 500). services/ai-api/tests/test_migration_copies_ck.py
--     pins that it is the last definition and differs by exactly that line.
--
-- What does NOT change: the lead import function (public.import_lead_rows) still takes at most 500 rows PER CALL, and so does the stock apply; the API cuts a larger file into parts of 500 and runs them one after the
-- other, each part in its own transaction with its own derived batch id, so a 5,000-row file never holds one long transaction (the hosted data API ends a statement after a few seconds) and a retry of the
-- same job repeats no part.

alter table integrations.import_jobs drop constraint import_jobs_rows_total_check;
alter table integrations.import_jobs add constraint import_jobs_rows_total_check check (rows_total between 0 and 5000);

create or replace function public.import_job_preview_save(
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
     or p_mapping is null or p_mapping_sha256 is null or p_mapping_sha256 !~ '^[0-9a-f]{64}$' or p_rows is null or p_rows not between 0 and 5000
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
