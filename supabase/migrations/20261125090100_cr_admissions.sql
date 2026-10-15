-- Job CR (night run C1, ADR 0087), migration 2 of 4: ADMISSIONS. The main revenue driver of a college or a coaching centre is the enquiry from a parent or an adult student. It works WITHOUT the companies module:
-- a guardian is a contact, the enquiry is a lead made by app.contact_lead (migration 1), and a visit to the campus is the existing visit (job AS), reused.
--
--   public.admissions         one enquiry, from the first contact to the end: stage enquiry -> campus_visit -> application -> admitted | lost; where it came from (WhatsApp, walk-in, website form, ad, referral,
--                             other); the programme asked about; why it was lost (a closed reason); the student it became (set by admission_admit, migration 3). It holds NO child data: a child who has not been
--                             admitted is not stored at all.
--   public.admission_events   every stage an enquiry reached, with the time: never changed (the funnel counts "reached", so a lost enquiry still counts as having been an enquiry).
--   a trigger on public.store_visits: booking a visit for a guardian whose enquiry is still at `enquiry` moves it to `campus_visit` (forward only).
--
-- Stage rules (the function, not the screen): enquiry -> campus_visit -> application are forward steps (one may skip a step); any open stage may become `lost` with a closed reason; `admitted` happens ONLY through
-- admission_admit (it makes the student); a lost enquiry may be re-opened (back to `enquiry`) by the Owner or an Admin. Owner, Admin and Sales work the pipeline.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM701 module off, SM812 the stage change is not allowed.

create table public.admissions (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  lead_id      uuid not null,
  contact_id   uuid not null,
  programme_id uuid,
  source       text not null check (source in ('whatsapp', 'walk_in', 'website', 'ad', 'referral', 'other')),
  stage        text not null default 'enquiry' check (stage in ('enquiry', 'campus_visit', 'application', 'admitted', 'lost')),
  lost_reason  text check (lost_reason in ('fees', 'distance', 'other_school', 'not_interested', 'no_response', 'other')),
  student_id   uuid,
  stage_at     timestamptz not null default now(),
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, programme_id) references public.programmes (tenant_id, id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  check ((stage = 'lost') = (lost_reason is not null)),
  check ((stage = 'admitted') = (student_id is not null))
);
create index admissions_stage_idx on public.admissions (tenant_id, stage, created_at desc, id);
create index admissions_lead_idx on public.admissions (tenant_id, lead_id);
create index admissions_contact_idx on public.admissions (tenant_id, contact_id);
create index admissions_programme_idx on public.admissions (tenant_id, programme_id) where programme_id is not null;
create index admissions_student_idx on public.admissions (tenant_id, student_id) where student_id is not null;
create index admissions_keyset_idx on public.admissions (tenant_id, created_at desc, id);
comment on column public.admissions.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.admissions.stage is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.admissions.lost_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.admission_events (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  admission_id uuid not null,
  stage        text not null check (stage in ('enquiry', 'campus_visit', 'application', 'admitted', 'lost')),
  lost_reason  text check (lost_reason in ('fees', 'distance', 'other_school', 'not_interested', 'no_response', 'other')),
  at           timestamptz not null default now(),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, admission_id) references public.admissions (tenant_id, id),
  check ((stage = 'lost') = (lost_reason is not null))
);
create index admission_events_admission_idx on public.admission_events (tenant_id, admission_id, seq);
create index admission_events_keyset_idx on public.admission_events (tenant_id, created_at desc, id);
comment on column public.admission_events.stage is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.admission_events.lost_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create trigger admissions_forbid_tenant_id_change before update on public.admissions for each row execute function app.forbid_tenant_id_change();
create trigger admissions_set_updated_at before update on public.admissions for each row execute function app.set_updated_at();
create trigger admission_events_forbid_tenant_id_change before update on public.admission_events for each row execute function app.forbid_tenant_id_change();
create trigger module_guard before insert on public.admissions for each row execute function app.module_guard('programmes');
create trigger module_guard before insert on public.admission_events for each row execute function app.module_guard('programmes');
create trigger audit_admissions after insert or update or delete on public.admissions for each row execute function app.audit_row_change('admission', '');
create trigger audit_admission_events after insert or update or delete on public.admission_events for each row execute function app.audit_row_change('admission_event', '');

create function app.admissions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'admissions are never deleted' using errcode = '42501';
  end if;
  if tg_table_name = 'admission_events' then
    raise exception 'admission events are never changed' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.edu_edit', true), '') <> 'on' then
    raise exception 'admissions change only through their functions' using errcode = '42501';
  end if;
  if new.id <> old.id or new.lead_id <> old.lead_id or new.contact_id <> old.contact_id or new.created_by <> old.created_by or new.created_at <> old.created_at or new.source <> old.source then
    raise exception 'an admission keeps its enquiry, its guardian, its source and its author' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.admissions_guard() from public;
create trigger admissions_guard before update or delete on public.admissions for each row execute function app.admissions_guard();
create trigger admissions_no_truncate before truncate on public.admissions for each statement execute function app.admissions_guard();
create trigger admission_events_guard before update or delete on public.admission_events for each row execute function app.admissions_guard();
create trigger admission_events_no_truncate before truncate on public.admission_events for each statement execute function app.admissions_guard();

do $$
declare t text;
begin
  foreach t in array array['admissions', 'admission_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;

create function app.admission_json(a public.admissions) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'lead_id', a.lead_id, 'contact_id', a.contact_id,
    'contact_name', (select case when c.erased_at is null then c.full_name end from public.contacts c where c.tenant_id = a.tenant_id and c.id = a.contact_id),
    'programme_id', a.programme_id, 'programme_name', (select p.name from public.programmes p where p.tenant_id = a.tenant_id and p.id = a.programme_id),
    'source', a.source, 'stage', a.stage, 'lost_reason', a.lost_reason, 'student_id', a.student_id, 'stage_at', a.stage_at, 'created_at', a.created_at,
    'visits', (select count(*) from public.store_visits v where v.tenant_id = a.tenant_id and v.lead_id = a.lead_id),
    'next_visit', (select min(v.starts_at) from public.store_visits v where v.tenant_id = a.tenant_id and v.lead_id = a.lead_id and v.status in ('booked', 'confirmed') and v.starts_at >= app.outbox_now()))
$$;
revoke all on function app.admission_json(public.admissions) from public, anon, authenticated, service_role;

create function app.admission_stage_error() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'that stage change is not allowed' using errcode = 'SM812';
end;
$$;
revoke all on function app.admission_stage_error() from public;

-- Start an enquiry for a guardian (a contact): their lead is found or made (a placeholder company stands in where there is none), and the enquiry begins at `enquiry`. The caller's id makes a retry safe.
create function public.admission_create(p_admission_id uuid, p_tenant_id uuid, p_contact_id uuid, p_programme_id uuid, p_source text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_old     public.admissions;
  v_lead    uuid;
  a         public.admissions;
begin
  if v_uid is null or p_tenant_id is null or p_admission_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_contact_id is null or p_source is null or p_source not in ('whatsapp', 'walk_in', 'website', 'ad', 'referral', 'other') then
    perform app.edu_error('invalid');
  end if;
  select * into v_old from public.admissions x where x.id = p_admission_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.contact_id <> p_contact_id or v_old.programme_id is distinct from p_programme_id or v_old.source <> p_source then
      perform app.edu_error('conflict');
    end if;
    return app.admission_json(v_old) || jsonb_build_object('created', false);
  end if;
  if not exists (select 1 from public.contacts c where c.id = p_contact_id and c.tenant_id = p_tenant_id and c.erased_at is null)
     or (p_programme_id is not null and not exists (select 1 from public.programmes pr where pr.id = p_programme_id and pr.tenant_id = p_tenant_id and pr.active)) then
    perform app.edu_error('reference');
  end if;
  v_lead := app.contact_lead(p_tenant_id, p_contact_id, 'admission');
  insert into public.admissions (id, tenant_id, lead_id, contact_id, programme_id, source, created_by) values (p_admission_id, p_tenant_id, v_lead, p_contact_id, p_programme_id, p_source, v_uid) returning * into a;
  insert into public.admission_events (tenant_id, admission_id, stage, created_by) values (p_tenant_id, p_admission_id, 'enquiry', v_uid);
  return app.admission_json(a) || jsonb_build_object('created', true);
end;
$$;
revoke all on function public.admission_create(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.admission_create(uuid, uuid, uuid, uuid, text) to authenticated;

-- Move an enquiry. Forward: enquiry -> campus_visit -> application. To `lost` from any open stage with a closed reason. Back to `enquiry` from `lost` (Owner or Admin). `admitted` only through admission_admit.
create function public.admission_stage_set(p_tenant_id uuid, p_admission_id uuid, p_stage text, p_lost_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a     public.admissions;
  v_ord jsonb := '{"enquiry": 1, "campus_visit": 2, "application": 3}'::jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_admission_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_stage is null or p_stage not in ('enquiry', 'campus_visit', 'application', 'lost') or (p_stage = 'lost') <> (p_lost_reason is not null)
     or (p_lost_reason is not null and p_lost_reason not in ('fees', 'distance', 'other_school', 'not_interested', 'no_response', 'other')) then
    perform app.edu_error('invalid');
  end if;
  select * into a from public.admissions x where x.id = p_admission_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.edu_error('reference');
  end if;
  if a.stage = p_stage and a.lost_reason is not distinct from p_lost_reason then
    return app.admission_json(a) || jsonb_build_object('replayed', true);
  end if;
  if a.stage = 'admitted' then
    perform app.admission_stage_error();
  elsif a.stage = 'lost' then
    if p_stage <> 'enquiry' or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
      perform app.admission_stage_error();
    end if;
  elsif p_stage <> 'lost' and (v_ord ->> p_stage)::int <= (v_ord ->> a.stage)::int then
    perform app.admission_stage_error();
  end if;
  perform app.edu_edit(true);
  update public.admissions set stage = p_stage, lost_reason = p_lost_reason, stage_at = now(), updated_by = v_uid where id = a.id returning * into a;
  perform app.edu_edit(false);
  insert into public.admission_events (tenant_id, admission_id, stage, lost_reason, created_by) values (p_tenant_id, a.id, p_stage, p_lost_reason, v_uid);
  return app.admission_json(a) || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.admission_stage_set(uuid, uuid, text, text) from public, anon;
grant execute on function public.admission_stage_set(uuid, uuid, text, text) to authenticated;

create function public.admission_get(p_tenant_id uuid, p_admission_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.admissions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  select * into a from public.admissions x where x.id = p_admission_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.edu_error('reference');
  end if;
  return app.admission_json(a) || jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('stage', e.stage, 'lost_reason', e.lost_reason, 'at', e.at) order by e.seq)
                                                                           from public.admission_events e where e.tenant_id = p_tenant_id and e.admission_id = a.id), '[]'::jsonb));
end;
$$;
revoke all on function public.admission_get(uuid, uuid) from public, anon;
grant execute on function public.admission_get(uuid, uuid) to authenticated;

-- The enquiries, newest first, paged by (created_at, id), filtered by stage, programme or source.
create function public.admissions_list(
  p_tenant_id uuid, p_stage text default null, p_programme_id uuid default null, p_source text default null, p_limit integer default 50, p_after_created timestamptz default null, p_after_id uuid default null
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
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_created is null) <> (p_after_id is null))
     or (p_stage is not null and p_stage not in ('enquiry', 'campus_visit', 'application', 'admitted', 'lost'))
     or (p_source is not null and p_source not in ('whatsapp', 'walk_in', 'website', 'ad', 'referral', 'other')) then
    perform app.edu_error('invalid');
  end if;
  return coalesce((
    select jsonb_agg(app.admission_json(z.a) order by z.created_at desc, z.id desc)
      from (select x as a, x.created_at, x.id
              from public.admissions x
             where x.tenant_id = p_tenant_id
               and (p_stage is null or x.stage = p_stage)
               and (p_programme_id is null or x.programme_id = p_programme_id)
               and (p_source is null or x.source = p_source)
               and (p_after_created is null or (x.created_at, x.id) < (p_after_created, p_after_id))
             order by x.created_at desc, x.id desc
             limit p_limit) z), '[]'::jsonb);
end;
$$;
revoke all on function public.admissions_list(uuid, text, uuid, text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.admissions_list(uuid, text, uuid, text, integer, timestamptz, uuid) to authenticated;

-- A visit booked for a guardian whose enquiry is still at `enquiry` moves it to `campus_visit` (the existing visit, reused). Forward only; nothing else about the visit changes.
create function app.admission_on_visit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select a.id from public.admissions a where a.tenant_id = new.tenant_id and a.lead_id = new.lead_id and a.stage = 'enquiry' loop
    perform app.edu_edit(true);
    update public.admissions set stage = 'campus_visit', stage_at = now() where id = r.id;
    perform app.edu_edit(false);
    insert into public.admission_events (tenant_id, admission_id, stage, created_by) values (new.tenant_id, r.id, 'campus_visit', new.created_by);
  end loop;
  return new;
end;
$$;
revoke all on function app.admission_on_visit() from public;
create trigger store_visits_admission after insert on public.store_visits for each row execute function app.admission_on_visit();
