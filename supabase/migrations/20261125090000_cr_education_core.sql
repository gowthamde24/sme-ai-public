-- Job CR (night run C1, ADR 0087, blueprint 5.3, ADR 0084 part 5), migration 1 of 4: the EDUCATION CORE. Institution profile, programmes (classes and sections, courses with year, semester or batch), guardians and
-- the MINIMAL student record, the generic enquiry path that works without the companies module, erasure and retention.
--
--   * Modules: `programmes` (profile, programmes, groups, students) and `fees` (migration 3) were `future` modules (CK registered no tables). They own tables now, so their guard kind becomes `tables`
--     (the closed module list is edited here, once, with its immutability trigger off for these statements; packages/packs/modules.json says the same). The education pack already lists both.
--   * The GENERIC ENQUIRY PATH: a lead that holds a contact needs a company (job T003), and a school has no companies module. `app.contact_lead` gets the contact's newest live lead or makes one, and when the
--     contact has no company it makes the same kind of generic placeholder company that WhatsApp ingestion makes ("Enquiry <6 characters>", created_via = 'agent'; job CK's single exemption of the companies
--     guard is widened by exactly this one name). The placeholder holds no personal data. Campaigns (job CP) use the same function, so a guardian CAN be sent a reminder.
--   * public.institution_profiles: the type (school, junior college, degree college, university, coaching, training), the month the academic year starts, up to six terms, the languages parents use, and the
--     retention rule for students who left (months; null = no automatic removal).
--   * public.programmes (a class set or a course) with public.programme_groups (sections, years, semesters or batches with an optional timing), and
--   * public.students: the MINIMAL dependant record of ADR 0084 part 5. The adult we write to (`contact_id`: a guardian, or the student themself for an adult student), `child_label` (a first name or initials,
--     up to 30 characters, never digits, never a phone number or an address), the placement (programme and group), an optional `admission_no`, a status and the day they left. NEVER stored: date of birth, photograph,
--     address, Aadhaar or any identity number, health, religion, caste, income, marks, attendance, behaviour, and there is NO free-text note. A child is never a contact: no phone, e-mail or handle. The two
--     columns that can identify a child are PII columns (audited by name only, wiped by the tenant-wide erasure, swept for identifiers). Erasing a guardian erases their students (a trigger on the contact's erasure
--     mark), and the retention rule removes students who left (public.scheduler_students_retention).
--
-- Who: every member reads the profile, the programmes and the groups; Owner, Admin and Sales read students (a Viewer sees no child at all); Owner and Admin write them. Nobody writes a table directly: every write is a
-- SECURITY DEFINER function that proves the role first. A child's label is never returned by a function a model can reach: no agent tool reads these tables (a test fails if one does).
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM701 the module is off, SM811 that admission number is used, SM815 the student cannot take part (left or erased).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. modules
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table packs.modules disable trigger modules_immutable;
update packs.modules set guard = 'tables', description = 'Institution profile, programmes, classes, sections and minimal student records (education)' where code = 'programmes';
update packs.modules set guard = 'tables', description = 'Fee plans, the fee ledger per student and receipts (education)' where code = 'fees';
alter table packs.modules enable trigger modules_immutable;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the generic enquiry path
-- ---------------------------------------------------------------------------------------------------------------------------------
-- job CK's guard, a FULL COPY with ONE changed line (services/ai-api/tests/test_migration_copies_cr.py pins it): the placeholder company is "WhatsApp customer <6>" (WhatsApp ingestion) or "Enquiry <6>" (job CR)
create or replace function app.module_guard_companies() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_via = 'agent' and new.name ~ '^(WhatsApp customer|Enquiry) [0-9a-f]{6}$' then
    return new;
  end if;
  if not app.module_enabled(new.tenant_id, 'companies') then
    perform app.pack_error('module_off');
  end if;
  return new;
end;
$$;
revoke all on function app.module_guard_companies() from public;

-- The lead of a contact: their newest live one, or a new one (under their company; a contact without a company gets a generic placeholder company first). Null when the contact is not in this business or was erased.
create function app.contact_lead(p_tenant uuid, p_contact uuid, p_source text default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead    uuid;
  v_company uuid;
  v_new     uuid := gen_random_uuid();
begin
  select l.id into v_lead from public.leads l where l.tenant_id = p_tenant and l.contact_id = p_contact and l.archived_at is null order by l.created_at desc, l.id desc limit 1;
  if v_lead is not null then
    return v_lead;
  end if;
  select c.company_id into v_company from public.contacts c where c.tenant_id = p_tenant and c.id = p_contact and c.erased_at is null;
  if not found then
    return null;
  end if;
  if v_company is null then
    insert into public.companies (id, tenant_id, name, created_via) values (v_new, p_tenant, 'Enquiry ' || substr(replace(v_new::text, '-', ''), 1, 6), 'agent');
    update public.contacts set company_id = v_new where id = p_contact and tenant_id = p_tenant;
    v_company := v_new;
  end if;
  insert into public.leads (tenant_id, company_id, contact_id, source) values (p_tenant, v_company, p_contact, p_source) returning id into v_lead;
  return v_lead;
end;
$$;
revoke all on function app.contact_lead(uuid, uuid, text) from public, anon, authenticated, service_role;

-- job CP's helper now uses it (a guardian has no company; before this a campaign could not reach them: `no_lead`)
create or replace function app.campaign_lead_for(p_tenant uuid, p_contact uuid) returns uuid
language sql
security definer
set search_path = ''
as $$ select app.contact_lead(p_tenant, p_contact, 'campaign') $$;
revoke all on function app.campaign_lead_for(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. errors and shared checks
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.edu_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for another record' using errcode = '23505';
    when 'admission_no' then raise exception 'that admission number is already used' using errcode = 'SM811';
    when 'ineligible' then raise exception 'the student left or was erased' using errcode = 'SM815';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.edu_error(text) from public;

-- the terms of a year: up to six {label, start_month, end_month}; nothing else in them
create function app.edu_terms_valid(j jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'array' and jsonb_array_length(j) <= 6
     and not exists (
       select 1 from jsonb_array_elements(j) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('label', 'start_month', 'end_month'))
           or jsonb_typeof(e -> 'label') is distinct from 'string' or char_length(e ->> 'label') not between 1 and 40
           or jsonb_typeof(e -> 'start_month') is distinct from 'number' or jsonb_typeof(e -> 'end_month') is distinct from 'number'
           or (e ->> 'start_month') !~ '^([1-9]|1[0-2])$' or (e ->> 'end_month') !~ '^([1-9]|1[0-2])$')
$$;
revoke all on function app.edu_terms_valid(jsonb) from public;
grant execute on function app.edu_terms_valid(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.institution_profiles (
  tenant_id                uuid primary key references public.tenants (id) on delete restrict,
  institution_type         text not null check (institution_type in ('school', 'junior_college', 'degree_college', 'university', 'coaching', 'training')),
  year_start_month         smallint not null check (year_start_month between 1 and 12),
  terms                    jsonb not null default '[]'::jsonb check (app.edu_terms_valid(terms) and app.text_is_clean(terms)),
  parent_languages         text[] not null check (cardinality(parent_languages) between 1 and 5 and parent_languages <@ array['en', 'te', 'hi', 'kn', 'ta']::text[]),
  student_retention_months smallint check (student_retention_months between 1 and 120),
  created_by               uuid not null,
  created_at               timestamptz not null default now(),
  updated_by               uuid,
  updated_at               timestamptz not null default now()
);
comment on column public.institution_profiles.institution_type is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.institution_profiles.terms is 'SAFE: the institution''s own words for its terms (Term 1 ...), up to six; no person. Hygiene-checked';
comment on column public.institution_profiles.parent_languages is 'SAFE: closed language codes. CLEAN-EXEMPT: closed CHECK list';

create table public.programmes (
  id         uuid primary key,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  name       text not null check (char_length(name) between 1 and 80 and app.text_is_clean(name) and not app.text_has_contact(name)),
  kind       text not null check (kind in ('class', 'course')),
  group_kind text not null check (group_kind in ('section', 'year', 'semester', 'batch', 'none')),
  active     boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index programmes_name_key on public.programmes (tenant_id, lower(name));
create index programmes_keyset_idx on public.programmes (tenant_id, created_at desc, id);
comment on column public.programmes.name is 'SAFE: the institution''s name for a class or a course (Class 5, B.Com); no person. Hygiene-checked, no phone or e-mail';
comment on column public.programmes.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.programmes.group_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.programme_groups (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  programme_id uuid not null,
  label        text not null check (char_length(label) between 1 and 30 and app.text_is_clean(label) and not app.text_has_contact(label)),
  timing       text check (char_length(timing) between 1 and 40 and app.text_is_clean(timing) and not app.text_has_contact(timing)),
  active       boolean not null default true,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, programme_id, id),
  foreign key (tenant_id, programme_id) references public.programmes (tenant_id, id)
);
create unique index programme_groups_label_key on public.programme_groups (tenant_id, programme_id, lower(label));
create index programme_groups_keyset_idx on public.programme_groups (tenant_id, created_at desc, id);
comment on column public.programme_groups.label is 'SAFE: a section, year, semester or batch name (A, Year 2, Batch 6 am); no person. Hygiene-checked, no phone or e-mail';
comment on column public.programme_groups.timing is 'SAFE: the time of a batch (6 to 8 am); no person. Hygiene-checked, no phone or e-mail';

create table public.students (
  id                  uuid primary key,
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  contact_id          uuid not null,
  is_adult            boolean not null default false,
  child_label         text check (char_length(child_label) between 1 and 30 and app.text_is_clean(child_label) and not app.text_has_contact(child_label) and (child_label = 'erased:1' or child_label !~ '[0-9@]')),
  guardian_contact_id uuid,
  programme_id        uuid not null,
  group_id            uuid,
  admission_no        text check (admission_no ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$'),
  status              text not null default 'active' check (status in ('active', 'left')),
  joined_on           date check (joined_on between date '2000-01-01' and date '2100-12-31'),
  left_on             date check (left_on between date '2000-01-01' and date '2100-12-31'),
  erased_at           timestamptz,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, guardian_contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, programme_id) references public.programmes (tenant_id, id),
  foreign key (tenant_id, programme_id, group_id) references public.programme_groups (tenant_id, programme_id, id),
  -- a child has a label (until it is erased); an adult student IS the contact and has none; only an adult student can have a separate guardian
  check (is_adult = (child_label is null) or erased_at is not null),
  check (not is_adult or child_label is null),
  check (guardian_contact_id is null or is_adult),
  check ((status = 'left') = (left_on is not null))
);
create unique index students_admission_no_key on public.students (tenant_id, lower(admission_no)) where admission_no is not null;
create index students_contact_idx on public.students (tenant_id, contact_id);
create index students_guardian_idx on public.students (tenant_id, guardian_contact_id) where guardian_contact_id is not null;
create index students_placement_idx on public.students (tenant_id, programme_id, group_id, status);
create index students_keyset_idx on public.students (tenant_id, created_at desc, id);
create index students_left_idx on public.students (tenant_id, left_on) where status = 'left' and erased_at is null;
comment on column public.students.child_label is 'PII: a child''s first name or initials (up to 30 characters, no digits, no phone number or e-mail). Audited by name only; tombstoned by the erasure scopes; NEVER read by a model, a log, a metric, an error message, a search index or a default export';
comment on column public.students.admission_no is 'PII: the school''s own admission number for reconciliation, which can identify a child inside the school. Audited by name only; nulled by the erasure scopes; never read by a model, a log or a default export. CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.students.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. triggers: ids, tenant, timestamps, modules, audit, guards
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['institution_profiles', 'programmes', 'programme_groups', 'students'] loop
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$I for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$I for each row execute function app.set_updated_at()', t);
    execute format('create trigger module_guard before insert on public.%I for each row execute function app.module_guard(%L)', t, 'programmes');
  end loop;
end $$;
create trigger audit_institution_profiles after insert or update or delete on public.institution_profiles for each row execute function app.audit_row_change('institution_profile', '');
create trigger audit_programmes after insert or update or delete on public.programmes for each row execute function app.audit_row_change('programme', '');
create trigger audit_programme_groups after insert or update or delete on public.programme_groups for each row execute function app.audit_row_change('programme_group', '');
create trigger audit_students after insert or update or delete on public.students for each row execute function app.audit_row_change('student', 'child_label,admission_no');

-- The door of the education tables: a row changes only inside one of this pack's own functions (they open it around their UPDATE and close it again), so nobody else can edit one, not even a privileged session.
create function app.edu_edit(p_open boolean) returns void
language sql
set search_path = ''
as $$ select set_config('app.edu_edit', case when p_open then 'on' else '' end, true) $$;
revoke all on function app.edu_edit(boolean) from public, anon, authenticated, service_role;

-- nothing here is ever deleted; a student's identity does not move between businesses or contacts; during an erasure (or the retention clean-up) only the registered columns and the erasure mark change
create function app.edu_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'education records are never deleted: make them inactive or mark the student as left' using errcode = '42501';
  end if;
  if tg_table_name = 'students' then
    if tg_op = 'UPDATE' and current_user = 'postgres' and app.erasure_running(new.tenant_id)
       and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ (app.erasure_columns('students') || array['erased_at']) then
      return new;
    end if;
    if old.erased_at is not null then
      raise exception 'an erased student never changes again' using errcode = '42501';
    end if;
  end if;
  if coalesce(current_setting('app.edu_edit', true), '') <> 'on' then
    raise exception 'education records change only through their functions' using errcode = '42501';
  end if;
  if tg_table_name = 'students' then
    if new.contact_id <> old.contact_id or new.is_adult <> old.is_adult or new.created_by <> old.created_by or new.created_at <> old.created_at or new.id <> old.id then
      raise exception 'a student keeps their contact, their kind, their id and their author' using errcode = '42501';
    end if;
  elsif new.created_by <> old.created_by or new.created_at <> old.created_at or new.id <> old.id then
    raise exception 'a record keeps its id, its author and its creation time' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.edu_rows_guard() from public;
do $$
declare t text;
begin
  foreach t in array array['programmes', 'programme_groups', 'students'] loop
    execute format('create trigger %1$s_guard before update or delete on public.%1$I for each row execute function app.edu_rows_guard()', t);
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$I for each statement execute function app.edu_rows_guard()', t);
  end loop;
end $$;
create trigger institution_profiles_no_delete before delete on public.institution_profiles for each row execute function app.edu_rows_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. row-level security: reads only. Config is visible to every member; students only to Owner, Admin and Sales.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['institution_profiles', 'programmes', 'programme_groups', 'students'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy institution_profiles_select on public.institution_profiles for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create policy programmes_select on public.programmes for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create policy programme_groups_select on public.programme_groups for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create policy students_select on public.students for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. the profile
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.institution_profile_json(p public.institution_profiles) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('institution_type', p.institution_type, 'year_start_month', p.year_start_month, 'terms', p.terms, 'parent_languages', to_jsonb(p.parent_languages),
                            'student_retention_months', p.student_retention_months, 'updated_at', p.updated_at)
$$;
revoke all on function app.institution_profile_json(public.institution_profiles) from public;

create function public.institution_profile_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.institution_profiles;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  select * into p from public.institution_profiles x where x.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return app.institution_profile_json(p) || jsonb_build_object('configured', true);
end;
$$;
revoke all on function public.institution_profile_get(uuid) from public, anon;
grant execute on function public.institution_profile_get(uuid) to authenticated;

-- Make or change the profile (Owner, Admin). The retention months are a legal choice: they change only with a second factor (Owner).
create function public.institution_profile_set(
  p_tenant_id uuid, p_institution_type text, p_year_start_month integer, p_terms jsonb, p_parent_languages text[], p_student_retention_months integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.institution_profiles;
  p     public.institution_profiles;
  v_exists boolean;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_institution_type is null or p_year_start_month is null or p_terms is null or p_parent_languages is null then
    perform app.edu_error('invalid');
  end if;
  select * into v_old from public.institution_profiles x where x.tenant_id = p_tenant_id for update;
  v_exists := found;
  if (v_exists and p_student_retention_months is distinct from v_old.student_retention_months) or (not v_exists and p_student_retention_months is not null) then
    perform app.require_aal2();
    if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
      perform app.edu_error('deny');
    end if;
  end if;
  begin
    if not v_exists then
      insert into public.institution_profiles (tenant_id, institution_type, year_start_month, terms, parent_languages, student_retention_months, created_by)
      values (p_tenant_id, p_institution_type, p_year_start_month, p_terms, p_parent_languages, p_student_retention_months, v_uid) returning * into p;
    else
      update public.institution_profiles
         set institution_type = p_institution_type, year_start_month = p_year_start_month, terms = p_terms, parent_languages = p_parent_languages,
             student_retention_months = p_student_retention_months, updated_by = v_uid
       where tenant_id = p_tenant_id returning * into p;
    end if;
  exception when check_violation then
    perform app.edu_error('invalid');
  end;
  return app.institution_profile_json(p) || jsonb_build_object('configured', true);
end;
$$;
revoke all on function public.institution_profile_set(uuid, text, integer, jsonb, text[], integer) from public, anon;
grant execute on function public.institution_profile_set(uuid, text, integer, jsonb, text[], integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. programmes and groups
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.programme_save(p_programme_id uuid, p_tenant_id uuid, p_name text, p_kind text, p_group_kind text, p_active boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_old     public.programmes;
  p         public.programmes;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_programme_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if char_length(v_name) not between 1 and 80 or p_kind is null or p_group_kind is null or p_active is null then
    perform app.edu_error('invalid');
  end if;
  select * into v_old from public.programmes x where x.id = p_programme_id for update;
  if found and (v_old.tenant_id <> p_tenant_id or v_old.kind <> p_kind) then
    perform app.edu_error('conflict');
  end if;
  begin
    if not found then
      v_created := true;
      insert into public.programmes (id, tenant_id, name, kind, group_kind, active, created_by) values (p_programme_id, p_tenant_id, v_name, p_kind, p_group_kind, p_active, v_uid) returning * into p;
    else
      perform app.edu_edit(true);
      update public.programmes set name = v_name, group_kind = p_group_kind, active = p_active, updated_by = v_uid where id = p_programme_id returning * into p;
      perform app.edu_edit(false);
    end if;
  exception
    when check_violation then perform app.edu_error('invalid');
    when unique_violation then perform app.edu_error('conflict');
  end;
  return jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'group_kind', p.group_kind, 'active', p.active, 'created', v_created);
end;
$$;
revoke all on function public.programme_save(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.programme_save(uuid, uuid, text, text, text, boolean) to authenticated;

create function public.programme_group_save(p_group_id uuid, p_tenant_id uuid, p_programme_id uuid, p_label text, p_timing text, p_active boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_label   text := btrim(coalesce(p_label, ''));
  v_timing  text := nullif(btrim(coalesce(p_timing, '')), '');
  v_kind    text;
  v_old     public.programme_groups;
  g         public.programme_groups;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_group_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_programme_id is null or char_length(v_label) not between 1 and 30 or p_active is null then
    perform app.edu_error('invalid');
  end if;
  select pr.group_kind into v_kind from public.programmes pr where pr.id = p_programme_id and pr.tenant_id = p_tenant_id;
  if not found then
    perform app.edu_error('reference');
  end if;
  if v_kind = 'none' or (v_timing is not null and v_kind <> 'batch') then
    perform app.edu_error('invalid');  -- a programme without groups has none; only a batch has a timing
  end if;
  select * into v_old from public.programme_groups x where x.id = p_group_id for update;
  if found and (v_old.tenant_id <> p_tenant_id or v_old.programme_id <> p_programme_id) then
    perform app.edu_error('conflict');
  end if;
  begin
    if not found then
      v_created := true;
      insert into public.programme_groups (id, tenant_id, programme_id, label, timing, active, created_by) values (p_group_id, p_tenant_id, p_programme_id, v_label, v_timing, p_active, v_uid) returning * into g;
    else
      perform app.edu_edit(true);
      update public.programme_groups set label = v_label, timing = v_timing, active = p_active, updated_by = v_uid where id = p_group_id returning * into g;
      perform app.edu_edit(false);
    end if;
  exception
    when check_violation then perform app.edu_error('invalid');
    when unique_violation then perform app.edu_error('conflict');
  end;
  return jsonb_build_object('id', g.id, 'programme_id', g.programme_id, 'label', g.label, 'timing', g.timing, 'active', g.active, 'created', v_created);
end;
$$;
revoke all on function public.programme_group_save(uuid, uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.programme_group_save(uuid, uuid, uuid, text, text, boolean) to authenticated;

-- The programmes with their groups and how many students are in each (a count only: no child is named). Inactive ones only when asked.
create function public.programmes_list(p_tenant_id uuid, p_include_inactive boolean default false) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) or p_include_inactive is null then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pr.id, 'name', pr.name, 'kind', pr.kind, 'group_kind', pr.group_kind, 'active', pr.active,
             'students', (select count(*) from public.students s where s.tenant_id = pr.tenant_id and s.programme_id = pr.id and s.status = 'active' and s.erased_at is null),
             'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'label', g.label, 'timing', g.timing, 'active', g.active,
                                                                    'students', (select count(*) from public.students s where s.tenant_id = g.tenant_id and s.group_id = g.id and s.status = 'active' and s.erased_at is null))
                                                  order by g.label, g.id)
                                   from public.programme_groups g where g.tenant_id = pr.tenant_id and g.programme_id = pr.id and (p_include_inactive or g.active)), '[]'::jsonb))
           order by pr.name, pr.id)
      from public.programmes pr where pr.tenant_id = p_tenant_id and (p_include_inactive or pr.active)), '[]'::jsonb);
end;
$$;
revoke all on function public.programmes_list(uuid, boolean) from public, anon;
grant execute on function public.programmes_list(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. students
-- ---------------------------------------------------------------------------------------------------------------------------------
-- A student as the staff screen needs them: the label (a child) or the contact's own name (an adult), the placement, the guardian's name. Only Owner, Admin and Sales reach it.
create function app.student_json(s public.students) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'contact_id', s.contact_id, 'is_adult', s.is_adult,
    'display_name', case when s.erased_at is not null then null when s.is_adult then (select c.full_name from public.contacts c where c.tenant_id = s.tenant_id and c.id = s.contact_id) else s.child_label end,
    'contact_name', (select case when c.erased_at is null then c.full_name end from public.contacts c where c.tenant_id = s.tenant_id and c.id = s.contact_id),
    'guardian_contact_id', s.guardian_contact_id, 'programme_id', s.programme_id, 'group_id', s.group_id,
    'programme_name', (select p.name from public.programmes p where p.tenant_id = s.tenant_id and p.id = s.programme_id),
    'group_label', (select g.label from public.programme_groups g where g.tenant_id = s.tenant_id and g.id = s.group_id),
    'admission_no', s.admission_no, 'status', s.status, 'joined_on', s.joined_on, 'left_on', s.left_on, 'erased', s.erased_at is not null, 'created_at', s.created_at, 'updated_at', s.updated_at)
$$;
revoke all on function app.student_json(public.students) from public, anon, authenticated, service_role;

-- Make or change a student (Owner, Admin; the programmes module must be on). A child has a label and a guardian contact; an adult student IS the contact (no label). The contact, the kind and the id never change;
-- the placement, the label, the admission number and (for an adult student) a separate guardian can. An exact repeat replays.
create function public.student_save(
  p_student_id uuid, p_tenant_id uuid, p_contact_id uuid, p_is_adult boolean, p_child_label text, p_programme_id uuid, p_group_id uuid, p_admission_no text,
  p_guardian_contact_id uuid default null, p_joined_on date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_label   text := nullif(btrim(coalesce(p_child_label, '')), '');
  v_adm     text := nullif(btrim(coalesce(p_admission_no, '')), '');
  v_old     public.students;
  s         public.students;
  v_created boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_student_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_contact_id is null or p_is_adult is null or p_programme_id is null or (p_is_adult and v_label is not null) or (not p_is_adult and v_label is null) or (not p_is_adult and p_guardian_contact_id is not null) then
    perform app.edu_error('invalid');
  end if;
  if not exists (select 1 from public.contacts c where c.id = p_contact_id and c.tenant_id = p_tenant_id and c.erased_at is null)
     or (p_guardian_contact_id is not null and not exists (select 1 from public.contacts c where c.id = p_guardian_contact_id and c.tenant_id = p_tenant_id and c.erased_at is null))
     or not exists (select 1 from public.programmes pr where pr.id = p_programme_id and pr.tenant_id = p_tenant_id and pr.active)
     or (p_group_id is not null and not exists (select 1 from public.programme_groups g where g.id = p_group_id and g.tenant_id = p_tenant_id and g.programme_id = p_programme_id and g.active)) then
    perform app.edu_error('reference');
  end if;
  select * into v_old from public.students x where x.id = p_student_id for update;
  if found and (v_old.tenant_id <> p_tenant_id or v_old.contact_id <> p_contact_id or v_old.is_adult <> p_is_adult) then
    perform app.edu_error('conflict');
  end if;
  if found and v_old.erased_at is not null then
    perform app.edu_error('ineligible');
  end if;
  begin
    if not found then
      v_created := true;
      insert into public.students (id, tenant_id, contact_id, is_adult, child_label, guardian_contact_id, programme_id, group_id, admission_no, joined_on, created_by)
      values (p_student_id, p_tenant_id, p_contact_id, p_is_adult, v_label, p_guardian_contact_id, p_programme_id, p_group_id, v_adm, p_joined_on, v_uid)
      returning * into s;
    else
      perform app.edu_edit(true);
      update public.students
         set child_label = v_label, guardian_contact_id = p_guardian_contact_id, programme_id = p_programme_id, group_id = p_group_id, admission_no = v_adm, joined_on = p_joined_on, updated_by = v_uid
       where id = p_student_id returning * into s;
      perform app.edu_edit(false);
    end if;
  exception
    when check_violation then perform app.edu_error('invalid');
    when unique_violation then perform app.edu_error('admission_no');
  end;
  return app.student_json(s) || jsonb_build_object('created', v_created);
end;
$$;
revoke all on function public.student_save(uuid, uuid, uuid, boolean, text, uuid, uuid, text, uuid, date) from public, anon;
grant execute on function public.student_save(uuid, uuid, uuid, boolean, text, uuid, uuid, text, uuid, date) to authenticated;

-- A student leaves (or comes back). The day they left starts the retention clock (the institution's rule in the profile).
create function public.student_set_status(p_tenant_id uuid, p_student_id uuid, p_status text, p_left_on date default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s     public.students;
begin
  if v_uid is null or p_tenant_id is null or p_student_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_status is null or p_status not in ('active', 'left') or (p_status = 'left') <> (p_left_on is not null) or (p_left_on is not null and p_left_on > app.dues_today() + 1) then
    perform app.edu_error('invalid');
  end if;
  select * into s from public.students x where x.id = p_student_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.edu_error('reference');
  end if;
  if s.erased_at is not null then
    perform app.edu_error('ineligible');
  end if;
  perform app.edu_edit(true);
  update public.students set status = p_status, left_on = p_left_on, updated_by = v_uid where id = p_student_id returning * into s;
  perform app.edu_edit(false);
  return app.student_json(s);
end;
$$;
revoke all on function public.student_set_status(uuid, uuid, text, date) from public, anon;
grant execute on function public.student_set_status(uuid, uuid, text, date) to authenticated;

create function public.student_get(p_tenant_id uuid, p_student_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.students;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  select * into s from public.students x where x.id = p_student_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.edu_error('reference');
  end if;
  return app.student_json(s);
end;
$$;
revoke all on function public.student_get(uuid, uuid) from public, anon;
grant execute on function public.student_get(uuid, uuid) to authenticated;

-- The students of a business, newest first, paged by (created_at, id). Filters: programme, group, status, or one guardian's. Erased ones are never listed.
create function public.students_list(
  p_tenant_id uuid, p_programme_id uuid default null, p_group_id uuid default null, p_status text default null, p_contact_id uuid default null,
  p_limit integer default 50, p_after_created timestamptz default null, p_after_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_created is null) <> (p_after_id is null)) or (p_status is not null and p_status not in ('active', 'left')) then
    perform app.edu_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(app.student_json(z.s) order by z.created_at desc, z.id desc)
      from (select x as s, x.created_at, x.id
              from public.students x
             where x.tenant_id = p_tenant_id and x.erased_at is null
               and (p_programme_id is null or x.programme_id = p_programme_id)
               and (p_group_id is null or x.group_id = p_group_id)
               and (p_status is null or x.status = p_status)
               and (p_contact_id is null or x.contact_id = p_contact_id or x.guardian_contact_id = p_contact_id)
               and (p_after_created is null or (x.created_at, x.id) < (p_after_created, p_after_id))
             order by x.created_at desc, x.id desc
             limit p_limit) z), '[]'::jsonb);
end;
$$;
revoke all on function public.students_list(uuid, uuid, uuid, text, uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.students_list(uuid, uuid, uuid, text, uuid, integer, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. erasure and retention
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The registry: the two columns that can identify a child. Tenant scope wipes them with the workspace; the sweep replaces identifiers inside them.
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('students', 'child_label',  'tenant', 'tombstone', 'erased:1', null),
  ('students', 'admission_no', 'tenant', 'null',      'erased:1', null),
  ('students', 'child_label',  'sweep',  'substring', 'erased:1', null),
  ('students', 'admission_no', 'sweep',  'substring', 'erased:1', null),
  ('students', 'child_label',  'contact', 'tombstone', 'erased:1', null),
  ('students', 'admission_no', 'contact', 'null',      'erased:1', null);

-- Erase the students selected by `p_where` (a fragment over the alias t, written by the callers below): the label and the admission number go, the row stays (money records point at it) and is marked erased.
-- The caller has opened the erasure door (app.erasure_request or app.retention_tenant).
create function app.students_erase(p_tenant uuid, p_scope text, p_where text) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  n bigint;
begin
  perform app.erase_column(p_tenant, p_scope, 'students', 'child_label', p_where);
  perform app.erase_column(p_tenant, p_scope, 'students', 'admission_no', p_where);
  execute format('update public.students t set erased_at = now() where t.tenant_id = $1 and (%s) and t.erased_at is null', p_where) using p_tenant;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function app.students_erase(uuid, text, text) from public, anon, authenticated, service_role;

-- Erasing a guardian erases their students: the erasure of a contact marks it (erased_at); that mark erases the children (the same transaction, so the erasure is whole or not at all). An adult student's row is
-- erased with the contact who IS the student. A student whose separate guardian is erased keeps the row (the adult student is still a person with their own contact).
create function app.students_on_contact_erased() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.erased_at is null and new.erased_at is not null then
    perform app.students_erase(new.tenant_id, 'contact', format('t.contact_id = %L', new.id));
  end if;
  return new;
end;
$$;
revoke all on function app.students_on_contact_erased() from public;
create trigger contacts_erase_students after update of erased_at on public.contacts for each row execute function app.students_on_contact_erased();

-- One student on request (a guardian asks for their child alone to be erased): the Owner, with a second factor. The audit says who and when, never what.
create function public.student_erase(p_tenant_id uuid, p_student_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s     public.students;
  n     bigint;
begin
  if v_uid is null or p_tenant_id is null or p_student_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  perform app.require_aal2();
  select * into s from public.students x where x.id = p_student_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.edu_error('reference');
  end if;
  if s.erased_at is not null then
    return jsonb_build_object('student_id', s.id, 'erased', true, 'replayed', true);
  end if;
  perform set_config('app.retention_tenant', p_tenant_id::text, true);
  begin
    n := app.students_erase(p_tenant_id, 'tenant', format('t.id = %L', p_student_id));
  exception when others then
    perform set_config('app.retention_tenant', '', true);
    raise;
  end;
  perform set_config('app.retention_tenant', '', true);
  perform app.write_audit_event(p_tenant_id, 'student.erase', 'student', p_student_id, null, jsonb_build_object('by', 'owner'));
  return jsonb_build_object('student_id', p_student_id, 'erased', true, 'replayed', false);
end;
$$;
revoke all on function public.student_erase(uuid, uuid) from public, anon;
grant execute on function public.student_erase(uuid, uuid) to authenticated;

-- The retention rule (ADR 0084 part 5, decision 8): a student who LEFT more than `student_retention_months` ago is erased. Only the scheduler may call it; each business at most once an hour; at most p_limit businesses.
create function public.scheduler_students_retention(p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr      public.institution_profiles;
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_n     bigint;
  v_total bigint := 0;
  v_done  integer := 0;
begin
  if not app.is_scheduler() then
    perform app.edu_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.edu_error('invalid');
  end if;
  for pr in select * from public.institution_profiles x where x.student_retention_months is not null order by x.tenant_id limit p_limit loop
    begin
      perform set_config('app.retention_tenant', pr.tenant_id::text, true);
      v_n := app.students_erase(pr.tenant_id, 'tenant',
               format('t.status = ''left'' and t.erased_at is null and t.left_on < (%L::date - make_interval(months => %s))', v_today, pr.student_retention_months));
      perform set_config('app.retention_tenant', '', true);
      if v_n > 0 then
        perform app.write_audit_event(pr.tenant_id, 'students.retention', 'institution_profile', pr.tenant_id, null, jsonb_build_object('erased', v_n));
      end if;
      v_total := v_total + v_n;
      v_done := v_done + 1;
    exception when others then
      perform set_config('app.retention_tenant', '', true);
    end;
  end loop;
  return jsonb_build_object('businesses', v_done, 'erased', v_total);
end;
$$;
revoke all on function public.scheduler_students_retention(integer) from public, anon;
grant execute on function public.scheduler_students_retention(integer) to authenticated;
