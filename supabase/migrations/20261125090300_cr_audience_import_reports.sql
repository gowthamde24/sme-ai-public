-- Job CR (night run C1, ADR 0087), migration 4 of 4: THE AUDIENCE, THE IMPORT AND THE REPORTS.
--
--   * public.campaign_recipients_from_students   an announcement (a campaign of kind event, exam or holiday: service messages only) goes to the guardians of the students of a class or section, a programme or
--                                                the whole institution: ONE message per guardian however many children they have, and never a word about a child (the merge fields are name, date, reference and business).
--   * public.students_import                     up to 500 guardians-and-students per call, matched to the programmes and groups the school has defined; a guardian is found by phone number or made; a row that
--                                                cannot be added is reported with a closed reason. The API runs a 5,000-row file in parts of 500 (the shared spreadsheet import, kind `students`).
--   * integrations.import_jobs / public.import_job_preview_save   gain the kind `students` (a FULL COPY of job CK's function; the one changed line is the list of kinds).
--   * app.operator_open_real_data_gate           a FULL COPY of job T006b's with ONE added rule: a workspace that keeps children's records (module `programmes`) opens only with a review reference that begins
--                                                `dpdp-children:` (ADR 0084 part 5, decision 7). SM816.
--   * public.education_report / public.fee_pending_list   the reports of the education pack in the one shape every pack's reports use: collection by programme and class, today's collection, the pending list
--                                                (the word is "pending", never "defaulter"), and the admissions funnel. All figures are sums of ledger entries; no model computes one.
--
-- Who: Owner, Admin and Sales (money and children); the import is the Owner's or an Admin's. SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM701 module off, SM816 the children's review is not recorded.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the kind `students` for the spreadsheet import
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table integrations.import_jobs drop constraint import_jobs_kind_check;
alter table integrations.import_jobs add constraint import_jobs_kind_check check (kind in ('customers', 'stock', 'students'));

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
  if p_job_id is null or p_kind is null or p_kind not in ('customers', 'stock', 'students') or p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$'
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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the children's review before real data
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.operator_open_real_data_gate(
  p_tenant_slug text, p_erasure_ref text, p_hosting_ref text, p_dpdp_review_ref text, p_restore_drill_ref text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  c_ref constant text := '^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$';
  v_tenant uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'unknown workspace' using errcode = '23503';
  end if;
  if p_erasure_ref is null or p_erasure_ref !~ c_ref
     or p_hosting_ref is null or p_hosting_ref !~ c_ref
     or p_dpdp_review_ref is null or p_dpdp_review_ref !~ c_ref
     or p_restore_drill_ref is null or p_restore_drill_ref !~ c_ref then
    raise exception 'every prerequisite needs a typed reference' using errcode = '22023';
  end if;
  -- job CR: a workspace that keeps children's records (module `programmes`) opens only after the DPDP CHILDREN's review: its review reference must say so (`dpdp-children:<ticket>`)
  if app.module_enabled(v_tenant, 'programmes') and p_dpdp_review_ref !~ '^dpdp-children:' then
    raise exception 'a workspace with student records opens only after the children''s data review' using errcode = 'SM816';
  end if;
  -- the first prerequisite is checked, not only recorded
  if to_regprocedure('public.execute_erasure(uuid, boolean)') is null
     or to_regprocedure('public.request_erasure(uuid, uuid, text, uuid)') is null then
    raise exception 'the erasure workflow is not installed' using errcode = 'SM402';
  end if;
  insert into public.tenant_data_policy as p
    (tenant_id, real_data_allowed, erasure_ref, hosting_ref, dpdp_review_ref, restore_drill_ref, opened_at, closed_at, changed_at)
  values (v_tenant, true, p_erasure_ref, p_hosting_ref, p_dpdp_review_ref, p_restore_drill_ref, now(), null, now())
  on conflict (tenant_id) do update
    set real_data_allowed = true, erasure_ref = excluded.erasure_ref, hosting_ref = excluded.hosting_ref,
        dpdp_review_ref = excluded.dpdp_review_ref, restore_drill_ref = excluded.restore_drill_ref,
        opened_at = now(), closed_at = null, changed_at = now();
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. announcements: the audience from the students
-- ---------------------------------------------------------------------------------------------------------------------------------
-- p_filter = {"scope": "all" | "programme" | "group", "programme_id"?, "group_id"?, "date": "YYYY-MM-DD"}. The date is the day of the event, the exam or the holiday (the steps are offsets from it). One recipient per
-- guardian; a student whose contact has no number, or is erased or stopped, is counted as skipped. Sends a campaign that was approved back to draft.
create function public.campaign_recipients_from_students(p_tenant_id uuid, p_campaign_id uuid, p_filter jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  c         public.campaigns;
  v_scope   text;
  v_prog    uuid;
  v_group   uuid;
  v_date    date;
  v_hash    text;
  x         record;
  v_lead    uuid;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_n       integer := 0;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or p_filter is null or jsonb_typeof(p_filter) <> 'object'
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  perform app.require_module(p_tenant_id, 'programmes');
  begin
    v_scope := p_filter ->> 'scope';
    v_prog := nullif(p_filter ->> 'programme_id', '')::uuid;
    v_group := nullif(p_filter ->> 'group_id', '')::uuid;
    v_date := (p_filter ->> 'date')::date;
  exception when others then
    perform app.campaign_error('invalid');
  end;
  if v_scope is null or v_scope not in ('all', 'programme', 'group') or v_date is null or v_date not between date '2020-01-01' and app.dues_today() + 400
     or (v_scope = 'all' and (v_prog is not null or v_group is not null)) or (v_scope = 'programme' and (v_prog is null or v_group is not null)) or (v_scope = 'group' and (v_group is null or v_prog is not null))
     or exists (select 1 from jsonb_object_keys(p_filter) k where k not in ('scope', 'programme_id', 'group_id', 'date')) then
    perform app.campaign_error('invalid');
  end if;
  if (v_prog is not null and not exists (select 1 from public.programmes pr where pr.id = v_prog and pr.tenant_id = p_tenant_id))
     or (v_group is not null and not exists (select 1 from public.programme_groups g where g.id = v_group and g.tenant_id = p_tenant_id)) then
    perform app.campaign_error('reference');
  end if;
  select * into c from public.campaigns k where k.tenant_id = p_tenant_id and k.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if app.campaign_money_kind(c.kind) then
    perform app.campaign_error('invalid');  -- an announcement is not about money; a fee reminder's list comes from the ledger
  end if;
  perform app.require_module(p_tenant_id, app.campaign_kind_module(c.kind));
  perform app.campaign_reset(p_tenant_id, p_campaign_id, 'list_changed');
  for x in
    select s.contact_id, ct.phone is not null and ct.suppressed_at is null as reachable
      from public.students s join public.contacts ct on ct.tenant_id = s.tenant_id and ct.id = s.contact_id and ct.erased_at is null
     where s.tenant_id = p_tenant_id and s.status = 'active' and s.erased_at is null
       and (v_scope = 'all' or (v_scope = 'programme' and s.programme_id = v_prog) or (v_scope = 'group' and s.group_id = v_group))
     group by s.contact_id, ct.phone, ct.suppressed_at, ct.created_at
     order by ct.created_at, s.contact_id
  loop
    v_n := v_n + 1;
    if not x.reachable then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_contact');
      continue;
    end if;
    v_lead := app.campaign_lead_for(p_tenant_id, x.contact_id);
    if v_lead is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_lead');
      continue;
    end if;
    v_hash := encode(sha256(convert_to(concat_ws('|', x.contact_id, v_date, 'announcement'), 'UTF8')), 'hex');
    begin
      insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, row_hash, created_by) values (p_tenant_id, p_campaign_id, x.contact_id, v_lead, v_date, v_hash, v_uid);
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'duplicate');
    end;
  end loop;
  update public.campaigns set audience_kind = 'filter', audience_filter = p_filter where id = p_campaign_id;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped,
                            'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id));
end;
$$;
revoke all on function public.campaign_recipients_from_students(uuid, uuid, jsonb) from public, anon;
grant execute on function public.campaign_recipients_from_students(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the students import
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Rows: {guardian_name, guardian_phone, programme (the name), group? (the label), child_label?, is_adult?, admission_no?, joined_on?}. A child needs a label; an adult student (is_adult true) is the contact
-- and needs none. The guardian is found by their phone number (the oldest live contact with it) or made; the student's id is derived from the batch id and the row, so a retry adds nothing.
-- Each row is its own sub-transaction: a refused row leaves nothing behind (no contact either). The answer lists, per row, the outcome, the closed reason, and (for a contact made here) its id: the API records
-- the contact's suppression keys with it, as for every import.
create function public.students_import(p_tenant_id uuid, p_batch_id uuid, p_rows jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     jsonb;
  v_i       integer := 0;
  v_out     jsonb := '[]'::jsonb;
  v_created integer := 0;
  v_dup     integer := 0;
  v_rej     integer := 0;
  v_sid     uuid;
  v_prog    uuid;
  v_group   uuid;
  v_contact uuid;
  v_made    boolean;
  v_pnorm   text;
  v_name    text;
  v_phone   text;
  v_adult   boolean;
  v_label   text;
  v_adm     text;
  v_res     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_batch_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    perform app.edu_error('invalid');
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_sid := app.agent_derived_id(p_batch_id, 'student-' || v_i::text, 'student');
    v_contact := null; v_made := false;
    begin
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'row' using errcode = '22023';
      end if;
      if exists (select 1 from public.students x where x.id = v_sid) then
        v_dup := v_dup + 1;
        v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'skipped_duplicate', 'reason', 'replay', 'student_id', v_sid);
        continue;
      end if;
      v_name := btrim(coalesce(v_row ->> 'guardian_name', ''));
      v_phone := btrim(coalesce(v_row ->> 'guardian_phone', ''));
      v_adult := coalesce((v_row ->> 'is_adult')::boolean, false);
      v_label := nullif(btrim(coalesce(v_row ->> 'child_label', '')), '');
      v_adm := nullif(btrim(coalesce(v_row ->> 'admission_no', '')), '');
      v_pnorm := app.phone_norm(v_phone);
      if char_length(v_name) not between 1 and 200 or v_pnorm is null then
        raise exception 'row' using errcode = '22023';
      end if;
      select pr.id into v_prog from public.programmes pr where pr.tenant_id = p_tenant_id and lower(pr.name) = lower(btrim(coalesce(v_row ->> 'programme', ''))) and pr.active;
      if v_prog is null then
        v_rej := v_rej + 1;
        v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'rejected', 'reason', 'programme_not_found');
        continue;
      end if;
      if nullif(btrim(coalesce(v_row ->> 'group', '')), '') is not null then
        select g.id into v_group from public.programme_groups g where g.tenant_id = p_tenant_id and g.programme_id = v_prog and lower(g.label) = lower(btrim(v_row ->> 'group')) and g.active;
        if v_group is null then
          v_rej := v_rej + 1;
          v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'rejected', 'reason', 'group_not_found');
          continue;
        end if;
      else
        v_group := null;
      end if;
      if v_adm is not null and exists (select 1 from public.students x where x.tenant_id = p_tenant_id and lower(x.admission_no) = lower(v_adm)) then
        v_dup := v_dup + 1;
        v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'skipped_duplicate', 'reason', 'admission_no');
        continue;
      end if;
      select k.id into v_contact from public.contacts k where k.tenant_id = p_tenant_id and k.erased_at is null and k.phone is not null and app.phone_norm(k.phone) = v_pnorm order by k.created_at, k.id limit 1;
      if v_contact is null then
        insert into public.contacts (tenant_id, full_name, phone, created_via) values (p_tenant_id, v_name, v_phone, 'import') returning id into v_contact;
        v_made := true;
      end if;
      if not v_adult and exists (select 1 from public.students x where x.tenant_id = p_tenant_id and x.contact_id = v_contact and x.programme_id = v_prog and x.erased_at is null and lower(x.child_label) = lower(v_label)) then
        v_dup := v_dup + 1;
        v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'skipped_duplicate', 'reason', 'same_child');
        continue;
      end if;
      v_res := public.student_save(v_sid, p_tenant_id, v_contact, v_adult, v_label, v_prog, v_group, v_adm, null, nullif(v_row ->> 'joined_on', '')::date);
      v_created := v_created + 1;
      v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'created', 'student_id', v_sid, 'contact_id', v_contact, 'contact_created', v_made);
    exception
      when sqlstate 'SM401' then
        v_rej := v_rej + 1; v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'rejected', 'reason', 'real_data_gate');
      when sqlstate 'SM811' then
        v_dup := v_dup + 1; v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'skipped_duplicate', 'reason', 'admission_no');
      when sqlstate '22023' or check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or not_null_violation or sqlstate '23503' or unique_violation then
        v_rej := v_rej + 1; v_out := v_out || jsonb_build_object('row', v_i, 'outcome', 'rejected', 'reason', 'invalid_row');
    end;
  end loop;
  return jsonb_build_object('batch_id', p_batch_id, 'rows', v_out, 'counts', jsonb_build_object('created', v_created, 'skipped_duplicate', v_dup, 'rejected', v_rej));
end;
$$;
revoke all on function public.students_import(uuid, uuid, jsonb) from public, anon;
grant execute on function public.students_import(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. reports
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the first day of the academic year that contains `p_day` (the month comes from the profile; April when the school has not set one)
create function app.edu_year_start(p_tenant uuid, p_day date) returns date
language sql
stable
security definer
set search_path = ''
as $$
  select make_date(extract(year from p_day)::int - case when extract(month from p_day)::int >= m then 0 else 1 end, m, 1)
    from (select coalesce((select pf.year_start_month from public.institution_profiles pf where pf.tenant_id = p_tenant), 4)::int as m) y
$$;
revoke all on function app.edu_year_start(uuid, date) from public, anon, authenticated, service_role;

-- per student account: what has fallen due by `p_as_of` and what of it is still open (the allocation rule of the ledger decides which claims are open)
create function app.edu_student_dues(p_tenant uuid, p_as_of date)
returns table (student_id uuid, programme_id uuid, group_id uuid, contact_id uuid, account_id uuid, due_paise bigint, pending_paise bigint, oldest_due date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.programme_id, s.group_id, s.contact_id, a.id,
         coalesce(sum(o.amount_paise) filter (where o.due_date <= p_as_of), 0)::bigint,
         coalesce(sum(o.open_paise) filter (where o.due_date <= p_as_of), 0)::bigint,
         min(o.due_date) filter (where o.due_date <= p_as_of and o.open_paise > 0)
    from public.students s
    join public.ledger_accounts a on a.tenant_id = s.tenant_id and a.student_id = s.id
    cross join lateral app.ledger_open_items(p_tenant, a.id, p_as_of) o
   where s.tenant_id = p_tenant
   group by s.id, s.programme_id, s.group_id, s.contact_id, a.id
$$;
revoke all on function app.edu_student_dues(uuid, date) from public, anon, authenticated, service_role;

create function app.edu_pct(p_part numeric, p_whole numeric) returns numeric
language sql
immutable
set search_path = ''
as $$ select case when coalesce(p_whole, 0) <= 0 then null else round(100.0 * p_part / p_whole, 1) end $$;
revoke all on function app.edu_pct(numeric, numeric) from public;

-- The pending list, the largest first, paged by (pending, student id). Staff only (it names the student the way the fee screen does). "Pending" is money fallen due and not yet paid or conceded.
create function public.fee_pending_list(
  p_tenant_id uuid, p_as_of date default null, p_programme_id uuid default null, p_group_id uuid default null, p_limit integer default 50, p_after_paise bigint default null, p_after_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_paise is null) <> (p_after_id is null)) or v_day > app.dues_today() then
    perform app.dues_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('student_id', z.student_id, 'display_name', app.student_json(z.s) -> 'display_name', 'programme_name', app.student_json(z.s) -> 'programme_name',
                                        'group_label', app.student_json(z.s) -> 'group_label', 'contact_id', z.contact_id, 'contact_name', app.student_json(z.s) -> 'contact_name',
                                        'pending_paise', z.pending_paise, 'due_paise', z.due_paise, 'overdue_days', greatest(0, v_day - z.oldest_due))
                     order by z.pending_paise desc, z.student_id desc)
      from (select d.*, st as s
              from app.edu_student_dues(p_tenant_id, v_day) d join public.students st on st.tenant_id = p_tenant_id and st.id = d.student_id
             where d.pending_paise > 0 and st.erased_at is null
               and (p_programme_id is null or d.programme_id = p_programme_id) and (p_group_id is null or d.group_id = p_group_id)
               and (p_after_paise is null or (d.pending_paise, d.student_id) < (p_after_paise, p_after_id))
             order by d.pending_paise desc, d.student_id desc
             limit p_limit) z), '[]'::jsonb);
end;
$$;
revoke all on function public.fee_pending_list(uuid, date, uuid, uuid, integer, bigint, uuid) from public, anon;
grant execute on function public.fee_pending_list(uuid, date, uuid, uuid, integer, bigint, uuid) to authenticated;

-- The reports of an education business, in the one shape of every pack's reports:
--   {report, as_of, from, to, kpis: [{key, value, unit}], tables: [{key, columns: [{key, type}], rows: [[...]]}], series: [{key, points: [{day, value}]}]}
-- codes: education.collection (by programme and by class), education.today, education.pending, education.funnel. Dates are India days.
create function public.education_report(p_tenant_id uuid, p_code text, p_from date default null, p_to date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.dues_today();
  v_to    date := coalesce(p_to, v_today);
  v_from  date;
  v_kpis  jsonb;
  v_tabs  jsonb;
  v_ser   jsonb := '[]'::jsonb;
  v_due   bigint;
  v_pend  bigint;
begin
  if auth.uid() is null or p_tenant_id is null or p_code is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'reports');
  perform app.require_module(p_tenant_id, 'programmes');
  if p_code not in ('education.collection', 'education.today', 'education.pending', 'education.funnel') or v_to > v_today or (p_from is not null and p_from > v_to) then
    perform app.edu_error('invalid');
  end if;

  if p_code = 'education.collection' then
    perform app.require_module(p_tenant_id, 'fees');
    v_from := coalesce(p_from, app.edu_year_start(p_tenant_id, v_to));
    select coalesce(sum(due_paise), 0), coalesce(sum(pending_paise), 0) into v_due, v_pend from app.edu_student_dues(p_tenant_id, v_to);
    v_kpis := jsonb_build_array(
      jsonb_build_object('key', 'due_paise', 'value', v_due, 'unit', 'paise'),
      jsonb_build_object('key', 'pending_paise', 'value', v_pend, 'unit', 'paise'),
      jsonb_build_object('key', 'collected_paise', 'value', (select coalesce(sum(e.amount_paise), 0) from public.ledger_entries e join public.ledger_accounts a on a.tenant_id = e.tenant_id and a.id = e.account_id
                                                               where e.tenant_id = p_tenant_id and a.student_id is not null and e.kind = 'payment' and e.voided_at is null and e.entry_date between v_from and v_to), 'unit', 'paise'),
      jsonb_build_object('key', 'concessions_paise', 'value', (select coalesce(sum(e.amount_paise), 0) from public.ledger_entries e join public.ledger_accounts a on a.tenant_id = e.tenant_id and a.id = e.account_id
                                                                 where e.tenant_id = p_tenant_id and a.student_id is not null and e.kind = 'concession' and e.voided_at is null and e.entry_date between v_from and v_to), 'unit', 'paise'),
      jsonb_build_object('key', 'collection_pct', 'value', app.edu_pct(v_due - v_pend, v_due), 'unit', 'percent'),
      jsonb_build_object('key', 'students_pending', 'value', (select count(*) from app.edu_student_dues(p_tenant_id, v_to) where pending_paise > 0), 'unit', 'count'));
    v_tabs := jsonb_build_array(
      jsonb_build_object('key', 'by_programme',
        'columns', jsonb_build_array(jsonb_build_object('key', 'programme', 'type', 'text'), jsonb_build_object('key', 'students', 'type', 'count'), jsonb_build_object('key', 'due_paise', 'type', 'paise'),
                                     jsonb_build_object('key', 'pending_paise', 'type', 'paise'), jsonb_build_object('key', 'collection_pct', 'type', 'percent')),
        'rows', coalesce((select jsonb_agg(jsonb_build_array(pr.name, x.n, x.due, x.pend, app.edu_pct(x.due - x.pend, x.due)) order by pr.name, pr.id)
                            from public.programmes pr
                            join (select d.programme_id, count(*) as n, sum(d.due_paise) as due, sum(d.pending_paise) as pend from app.edu_student_dues(p_tenant_id, v_to) d group by d.programme_id) x on x.programme_id = pr.id
                           where pr.tenant_id = p_tenant_id), '[]'::jsonb)),
      jsonb_build_object('key', 'by_group',
        'columns', jsonb_build_array(jsonb_build_object('key', 'programme', 'type', 'text'), jsonb_build_object('key', 'group', 'type', 'text'), jsonb_build_object('key', 'students', 'type', 'count'),
                                     jsonb_build_object('key', 'due_paise', 'type', 'paise'), jsonb_build_object('key', 'pending_paise', 'type', 'paise'), jsonb_build_object('key', 'collection_pct', 'type', 'percent')),
        'rows', coalesce((select jsonb_agg(jsonb_build_array(pr.name, coalesce(g.label, ''), x.n, x.due, x.pend, app.edu_pct(x.due - x.pend, x.due)) order by pr.name, g.label nulls first, pr.id)
                            from (select d.programme_id, d.group_id, count(*) as n, sum(d.due_paise) as due, sum(d.pending_paise) as pend from app.edu_student_dues(p_tenant_id, v_to) d group by d.programme_id, d.group_id) x
                            join public.programmes pr on pr.tenant_id = p_tenant_id and pr.id = x.programme_id
                            left join public.programme_groups g on g.tenant_id = p_tenant_id and g.id = x.group_id), '[]'::jsonb)));
    v_ser := jsonb_build_array(jsonb_build_object('key', 'collection_by_day', 'points', coalesce((
      select jsonb_agg(jsonb_build_object('day', y.d, 'value', y.total) order by y.d)
        from (select e.entry_date as d, sum(e.amount_paise) as total from public.ledger_entries e join public.ledger_accounts a on a.tenant_id = e.tenant_id and a.id = e.account_id
               where e.tenant_id = p_tenant_id and a.student_id is not null and e.kind = 'payment' and e.voided_at is null and e.entry_date between v_from and v_to group by e.entry_date) y), '[]'::jsonb)));

  elsif p_code = 'education.today' then
    perform app.require_module(p_tenant_id, 'fees');
    v_from := v_to;
    v_kpis := jsonb_build_array(
      jsonb_build_object('key', 'collected_paise', 'value', (select coalesce(sum(e.amount_paise), 0) from public.ledger_entries e join public.ledger_accounts a on a.tenant_id = e.tenant_id and a.id = e.account_id
                                                               where e.tenant_id = p_tenant_id and a.student_id is not null and e.kind = 'payment' and e.voided_at is null and e.entry_date = v_to), 'unit', 'paise'),
      jsonb_build_object('key', 'receipts', 'value', (select count(*) from public.ledger_entries e join public.ledger_accounts a on a.tenant_id = e.tenant_id and a.id = e.account_id
                                                       where e.tenant_id = p_tenant_id and a.student_id is not null and e.kind = 'payment' and e.voided_at is null and e.entry_date = v_to), 'unit', 'count'));
    v_tabs := jsonb_build_array(jsonb_build_object('key', 'by_method',
      'columns', jsonb_build_array(jsonb_build_object('key', 'method', 'type', 'text'), jsonb_build_object('key', 'receipts', 'type', 'count'), jsonb_build_object('key', 'amount_paise', 'type', 'paise')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(z.method, z.n, z.total) order by z.method)
                          from (select e.method, count(*) as n, sum(e.amount_paise) as total from public.ledger_entries e join public.ledger_accounts a on a.tenant_id = e.tenant_id and a.id = e.account_id
                                 where e.tenant_id = p_tenant_id and a.student_id is not null and e.kind = 'payment' and e.voided_at is null and e.entry_date = v_to group by e.method) z), '[]'::jsonb)));

  elsif p_code = 'education.pending' then
    perform app.require_module(p_tenant_id, 'fees');
    v_from := v_to;
    select coalesce(sum(pending_paise), 0) into v_pend from app.edu_student_dues(p_tenant_id, v_to);
    v_kpis := jsonb_build_array(
      jsonb_build_object('key', 'pending_paise', 'value', v_pend, 'unit', 'paise'),
      jsonb_build_object('key', 'students_pending', 'value', (select count(*) from app.edu_student_dues(p_tenant_id, v_to) where pending_paise > 0), 'unit', 'count'));
    v_tabs := jsonb_build_array(jsonb_build_object('key', 'by_programme',
      'columns', jsonb_build_array(jsonb_build_object('key', 'programme', 'type', 'text'), jsonb_build_object('key', 'students_pending', 'type', 'count'), jsonb_build_object('key', 'pending_paise', 'type', 'paise')),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(pr.name, x.n, x.pend) order by x.pend desc, pr.name)
                          from public.programmes pr
                          join (select d.programme_id, count(*) as n, sum(d.pending_paise) as pend from app.edu_student_dues(p_tenant_id, v_to) d where d.pending_paise > 0 group by d.programme_id) x on x.programme_id = pr.id
                         where pr.tenant_id = p_tenant_id), '[]'::jsonb)));

  else  -- education.funnel
    v_from := coalesce(p_from, v_to - 89);
    with adm as (select a.* from public.admissions a where a.tenant_id = p_tenant_id and (a.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to),
         reached as (select e.stage, count(distinct e.admission_id) as n from public.admission_events e join adm on adm.id = e.admission_id where e.tenant_id = p_tenant_id group by e.stage)
    select jsonb_build_array(
             jsonb_build_object('key', 'enquiries', 'value', (select count(*) from adm), 'unit', 'count'),
             jsonb_build_object('key', 'campus_visits', 'value', coalesce((select n from reached where stage = 'campus_visit'), 0), 'unit', 'count'),
             jsonb_build_object('key', 'applications', 'value', coalesce((select n from reached where stage = 'application'), 0), 'unit', 'count'),
             jsonb_build_object('key', 'admitted', 'value', coalesce((select n from reached where stage = 'admitted'), 0), 'unit', 'count'),
             jsonb_build_object('key', 'lost', 'value', coalesce((select n from reached where stage = 'lost'), 0), 'unit', 'count'),
             jsonb_build_object('key', 'conversion_pct', 'value', app.edu_pct(coalesce((select n from reached where stage = 'admitted'), 0), (select count(*) from adm)), 'unit', 'percent'))
      into v_kpis;
    v_tabs := jsonb_build_array(
      jsonb_build_object('key', 'by_source',
        'columns', jsonb_build_array(jsonb_build_object('key', 'source', 'type', 'text'), jsonb_build_object('key', 'enquiries', 'type', 'count'), jsonb_build_object('key', 'admitted', 'type', 'count')),
        'rows', coalesce((select jsonb_agg(jsonb_build_array(z.source, z.n, z.adm) order by z.n desc, z.source)
                            from (select a.source, count(*) as n, count(*) filter (where a.stage = 'admitted') as adm from public.admissions a
                                   where a.tenant_id = p_tenant_id and (a.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to group by a.source) z), '[]'::jsonb)),
      jsonb_build_object('key', 'by_programme',
        'columns', jsonb_build_array(jsonb_build_object('key', 'programme', 'type', 'text'), jsonb_build_object('key', 'enquiries', 'type', 'count'), jsonb_build_object('key', 'admitted', 'type', 'count')),
        'rows', coalesce((select jsonb_agg(jsonb_build_array(coalesce(z.name, ''), z.n, z.adm) order by z.n desc, z.name nulls first)
                            from (select pr.name, count(*) as n, count(*) filter (where a.stage = 'admitted') as adm from public.admissions a left join public.programmes pr on pr.tenant_id = a.tenant_id and pr.id = a.programme_id
                                   where a.tenant_id = p_tenant_id and (a.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to group by pr.name) z), '[]'::jsonb)),
      jsonb_build_object('key', 'by_lost_reason',
        'columns', jsonb_build_array(jsonb_build_object('key', 'reason', 'type', 'text'), jsonb_build_object('key', 'count', 'type', 'count')),
        'rows', coalesce((select jsonb_agg(jsonb_build_array(z.lost_reason, z.n) order by z.n desc, z.lost_reason)
                            from (select a.lost_reason, count(*) as n from public.admissions a where a.tenant_id = p_tenant_id and a.stage = 'lost'
                                     and (a.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to group by a.lost_reason) z), '[]'::jsonb)));
  end if;
  return jsonb_build_object('report', p_code, 'as_of', v_to, 'from', v_from, 'to', v_to, 'kpis', v_kpis, 'tables', v_tabs, 'series', v_ser);
end;
$$;
revoke all on function public.education_report(uuid, text, date, date) from public, anon;
grant execute on function public.education_report(uuid, text, date, date) to authenticated;
