-- Appointment booking, slice 1 (owner decision 14 Nov 2026, docs/plans/appointment-booking.md): the booking ENGINE grows from the store-visits module (job AS). One engine, the word "appointment" is the app's.
--   * buffer_minutes (store_settings): a gap after every booking, for its staff member and for the capacity count (0 to 60, default 0 = today's behaviour).
--   * public.store_staff: optional staff members with their own weekly hours (null = the business's hours). A business WITHOUT staff keeps `max_parallel` places a slot, exactly as before. A business WITH
--     active staff has one place per staff member who works at that time; a booking names a staff member or "any" (the first free one is assigned).
--   * store_visits.staff_id, store_visits.buffer_minutes (the buffer that applied when it was booked), store_visits.occupies (generated: [starts_at, ends_at + buffer)) and a DATABASE CONSTRAINT: one staff
--     member's active bookings can never overlap (exclusion constraint). Capacity without staff cannot be a constraint ("at most N"), so it stays the per-day lock + count that every booking path takes.
--   * calendar busy time (Google, slice 4) blocks a slot: app.calendar_busy_overlaps (a stub that says "not busy" until the Google migration replaces it).
--   * every slot answer says how many places are free and WHO (staff) is free; visit_list says who has each visit.
-- SQLSTATEs as in job AS (SM513 slot full, SM512 not a slot, SM511 closed, SM514 past, 22023 invalid).

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. busy time from a connected calendar: a stub the Google migration replaces (CREATE OR REPLACE there)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('app.calendar_busy_overlaps(uuid,timestamptz,timestamptz)') is null then
    execute $f$
      create function app.calendar_busy_overlaps(p_tenant uuid, p_from timestamptz, p_to timestamptz) returns boolean
      language sql stable security definer set search_path = '' as $b$ select false $b$
    $f$;
    execute 'revoke all on function app.calendar_busy_overlaps(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. settings: the buffer
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.store_settings add column buffer_minutes smallint not null default 0 check (buffer_minutes between 0 and 60);

drop function public.visit_settings_set(uuid, jsonb, date[], integer, integer);
create function public.visit_settings_set(p_tenant_id uuid, p_weekly_hours jsonb, p_closed_dates date[], p_slot_minutes integer, p_max_parallel integer, p_buffer_minutes integer default 0) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_dates date[];
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if p_weekly_hours is null or not app.visit_hours_ok(p_weekly_hours) or not app.text_is_clean(p_weekly_hours::text)
     or p_slot_minutes is null or p_slot_minutes not in (15, 20, 30, 45, 60, 90, 120)
     or p_max_parallel is null or p_max_parallel not between 1 and 50
     or p_buffer_minutes is null or p_buffer_minutes not between 0 and 60
     or p_closed_dates is null or cardinality(p_closed_dates) > 200 or exists (select 1 from unnest(p_closed_dates) d where d is null) then
    perform app.visit_error('invalid');
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_dates from unnest(p_closed_dates) d;
  insert into public.store_settings (tenant_id, weekly_hours, closed_dates, slot_minutes, max_parallel, buffer_minutes, updated_by)
  values (p_tenant_id, p_weekly_hours, v_dates, p_slot_minutes, p_max_parallel, p_buffer_minutes, v_uid)
  on conflict (tenant_id) do update
     set weekly_hours = excluded.weekly_hours, closed_dates = excluded.closed_dates, slot_minutes = excluded.slot_minutes, max_parallel = excluded.max_parallel,
         buffer_minutes = excluded.buffer_minutes, updated_by = v_uid, updated_at = now();
  return app.visit_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.visit_settings_set(uuid, jsonb, date[], integer, integer, integer) from public, anon;
grant execute on function public.visit_settings_set(uuid, jsonb, date[], integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. staff
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.store_staff (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  name         text not null check (char_length(name) between 1 and 60 and app.text_is_clean(name)),
  weekly_hours jsonb check (weekly_hours is null or (app.visit_hours_ok(weekly_hours) and app.text_is_clean(weekly_hours::text))),
  active       boolean not null default true,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on column public.store_staff.name is 'SAFE: a staff member''s name as the owner typed it: it belongs to the business, not to a customer (no end-customer data); it goes with the workspace.';
comment on column public.store_staff.weekly_hours is 'SAFE: working times (HH:MM) per weekday, no personal data. Checked by app.visit_hours_ok; null = the business''s opening hours.';
comment on column public.store_staff.created_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';
create index store_staff_tenant_idx on public.store_staff (tenant_id, active, name);
create trigger store_staff_forbid_tenant_id_change before update on public.store_staff for each row execute function app.forbid_tenant_id_change();
create trigger store_staff_set_updated_at before update on public.store_staff for each row execute function app.set_updated_at();
create trigger audit_store_staff after insert or update or delete on public.store_staff for each row execute function app.audit_row_change('store_staff');
alter table public.store_staff enable row level security;
alter table public.store_staff force row level security;
revoke all on public.store_staff from public, anon, authenticated;
grant select on public.store_staff to authenticated;
create policy store_staff_select on public.store_staff for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));

-- the settings as one json (with the buffer and how many staff are active)
create or replace function app.visit_settings_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('weekly_hours', s.weekly_hours, 'closed_dates', to_jsonb(s.closed_dates), 'slot_minutes', s.slot_minutes, 'max_parallel', s.max_parallel, 'buffer_minutes', s.buffer_minutes, 'is_default', false)
       from public.store_settings s where s.tenant_id = p_tenant),
    jsonb_build_object('weekly_hours', app.visit_default_hours(), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2, 'buffer_minutes', 0, 'is_default', true))
  || jsonb_build_object('staff_count', (select count(*) from public.store_staff t where t.tenant_id = p_tenant and t.active))
$$;


create function public.store_staff_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.visit_error('deny');
  end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'weekly_hours', s.weekly_hours, 'active', s.active) order by s.active desc, s.name, s.id)
                                                 from public.store_staff s where s.tenant_id = p_tenant_id), '[]'::jsonb));
end;
$$;
revoke all on function public.store_staff_list(uuid) from public, anon;
grant execute on function public.store_staff_list(uuid) to authenticated;

-- create or change a staff member (the id is the caller's, so a retry changes nothing twice); never deleted: a person who left is made inactive (their past visits keep their name)
create function public.store_staff_save(p_tenant_id uuid, p_staff_id uuid, p_name text, p_weekly_hours jsonb, p_active boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  s      public.store_staff;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if p_staff_id is null or char_length(v_name) not between 1 and 60 or not app.text_is_clean(v_name) or p_active is null
     or (p_weekly_hours is not null and (not app.visit_hours_ok(p_weekly_hours) or not app.text_is_clean(p_weekly_hours::text))) then
    perform app.visit_error('invalid');
  end if;
  if exists (select 1 from public.store_staff x where x.id = p_staff_id and x.tenant_id <> p_tenant_id) then
    perform app.visit_error('conflict');
  end if;
  if not exists (select 1 from public.store_staff x where x.id = p_staff_id) and (select count(*) from public.store_staff x where x.tenant_id = p_tenant_id) >= 50 then
    perform app.visit_error('invalid');
  end if;
  insert into public.store_staff as t (id, tenant_id, name, weekly_hours, active, created_by) values (p_staff_id, p_tenant_id, v_name, p_weekly_hours, p_active, v_uid)
  on conflict (id) do update set name = excluded.name, weekly_hours = excluded.weekly_hours, active = excluded.active
  returning * into s;
  return jsonb_build_object('id', s.id, 'name', s.name, 'weekly_hours', s.weekly_hours, 'active', s.active);
end;
$$;
revoke all on function public.store_staff_save(uuid, uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.store_staff_save(uuid, uuid, text, jsonb, boolean) to authenticated;

-- does a staff member work during [starts, ends)? (their own weekly hours; null = the business's, which the slot already respects)
create function app.visit_staff_works(p_hours jsonb, p_starts timestamptz, p_ends timestamptz) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local timestamp := p_starts at time zone 'Asia/Kolkata';
  v_day   jsonb;
  v_from  integer;
  v_to    integer;
  v_m     integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_len   integer := greatest(1, (extract(epoch from (p_ends - p_starts)) / 60)::integer);
begin
  if p_hours is null then
    return true;
  end if;
  v_day := p_hours -> (array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[extract(dow from v_local)::int + 1];
  if v_day is null or jsonb_typeof(v_day) = 'null' then
    return false;
  end if;
  v_from := substr(v_day ->> 'open', 1, 2)::integer * 60 + substr(v_day ->> 'open', 4, 2)::integer;
  v_to := substr(v_day ->> 'close', 1, 2)::integer * 60 + substr(v_day ->> 'close', 4, 2)::integer;
  return v_m >= v_from and v_m + v_len <= v_to;
end;
$$;
revoke all on function app.visit_staff_works(jsonb, timestamptz, timestamptz) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the visits: who has it, the buffer that applied, what it occupies, and the constraint
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.store_visits add column staff_id uuid;
alter table public.store_visits add column buffer_minutes smallint not null default 0 check (buffer_minutes between 0 and 60);
-- (epoch seconds, because a timestamptz range cannot be a generated column: extract(epoch from a timestamptz) is not immutable, from an interval it is)
alter table public.store_visits add column occupies int8range generated always as (int8range(extract(epoch from (starts_at - timestamptz 'epoch'))::bigint, extract(epoch from (ends_at - timestamptz 'epoch'))::bigint + buffer_minutes * 60, '[)')) stored;
alter table public.store_visits add constraint store_visits_staff_fk foreign key (tenant_id, staff_id) references public.store_staff (tenant_id, id);
-- THE no-double-booking rule for staff: the same person cannot hold two live visits that overlap (buffer included). Cancelled, completed and no-show visits no longer occupy anyone.
alter table public.store_visits add constraint store_visits_no_staff_overlap exclude using gist (staff_id with =, occupies with &&) where (staff_id is not null and status in ('booked', 'confirmed', 'arrived'));
create index store_visits_staff_idx on public.store_visits (tenant_id, staff_id) where staff_id is not null;
create index store_visits_occupies_idx on public.store_visits using gist (tenant_id, occupies) where status in ('booked', 'confirmed', 'arrived');
comment on column public.store_visits.staff_id is 'SAFE: a staff member id. CLEAN-EXEMPT: uuid';
comment on column public.store_visits.occupies is 'SAFE: a range of epoch seconds, generated from starts_at, ends_at and the buffer. CLEAN-EXEMPT: generated range';

-- a staff member can be changed while the visit has not happened (the same rule as its time and details)
create or replace function app.store_visits_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed text[] := array['id', 'tenant_id', 'lead_id', 'contact_id', 'company_id', 'source', 'request_sha256', 'created_by', 'created_at'];
  k text;
begin
  if current_user = 'postgres' and app.erasure_running(new.tenant_id)
     and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
    return new;
  end if;
  foreach k in array v_fixed loop
    if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k then
      raise exception 'visits are immutable except for their state, time and details' using errcode = '42501';
    end if;
  end loop;
  if new.status is distinct from old.status then
    if not ((old.status = 'booked' and new.status in ('confirmed', 'arrived', 'cancelled', 'no_show'))
         or (old.status = 'confirmed' and new.status in ('booked', 'arrived', 'cancelled', 'no_show'))
         or (old.status = 'arrived' and new.status = 'completed')) then
      raise exception 'a visit cannot move from % to %', old.status, new.status using errcode = '42501';
    end if;
  elsif old.status in ('completed', 'no_show', 'cancelled') and (to_jsonb(new) - 'updated_at' - 'updated_by') is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    raise exception 'a closed visit stays closed' using errcode = '42501';
  end if;
  -- the order is linked only by the step that completes the visit; a message is linked only to a confirmed visit
  if new.order_id is distinct from old.order_id and not (old.order_id is null and old.status = 'arrived' and new.status = 'completed') then
    raise exception 'the order of a visit is linked when the visit is completed' using errcode = '42501';
  end if;
  if (new.confirmation_message_id is distinct from old.confirmation_message_id or new.reminder_message_id is distinct from old.reminder_message_id) and old.status <> 'confirmed' then
    raise exception 'a message is linked to a confirmed visit only' using errcode = '42501';
  end if;
  if (new.starts_at is distinct from old.starts_at or new.party_size is distinct from old.party_size or new.purpose is distinct from old.purpose or new.note is distinct from old.note
      or new.advance_requested is distinct from old.advance_requested or new.advance_paise is distinct from old.advance_paise or new.staff_id is distinct from old.staff_id)
     and old.status not in ('booked', 'confirmed') then
    raise exception 'only a visit that has not happened can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. the places of one slot: the ONE function every path asks (slots, booking, moving, the phone's offers)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- {capacity, free, blocked, staff: [{id, name}] (the staff members free for it; [] when the business has no staff)}. A booking would occupy [starts, ends + buffer).
create function app.visit_places(p_tenant uuid, p_set jsonb, p_starts timestamptz, p_ends timestamptz, p_exclude uuid, p_only_staff uuid default null) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_range  int8range := int8range(extract(epoch from (p_starts - timestamptz 'epoch'))::bigint, extract(epoch from (p_ends - timestamptz 'epoch'))::bigint + coalesce((p_set ->> 'buffer_minutes')::integer, 0) * 60, '[)');
  v_blocked boolean := app.calendar_busy_overlaps(p_tenant, p_starts, p_ends);
  v_staff  boolean := coalesce((p_set ->> 'staff_count')::integer, 0) > 0;
  v_taken  integer;
  v_cap    integer;
  v_free   jsonb;
  v_n      integer;
  v_unassigned integer;
begin
  if not v_staff then
    select count(*) into v_taken from public.store_visits v
     where v.tenant_id = p_tenant and v.status in ('booked', 'confirmed', 'arrived') and v.id is distinct from p_exclude and v.occupies && v_range;
    v_cap := (p_set ->> 'max_parallel')::integer;
    return jsonb_build_object('capacity', v_cap, 'free', case when v_blocked then 0 else greatest(0, v_cap - v_taken) end, 'blocked', v_blocked, 'staff', '[]'::jsonb);
  end if;
  select count(*) into v_unassigned from public.store_visits v
   where v.tenant_id = p_tenant and v.staff_id is null and v.status in ('booked', 'confirmed', 'arrived') and v.id is distinct from p_exclude and v.occupies && v_range;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name, c.id) filter (where not c.taken), '[]'::jsonb), count(*) filter (where not c.taken)
    into v_cap, v_free, v_n
    from (select s.id, s.name,
                 exists (select 1 from public.store_visits v where v.tenant_id = p_tenant and v.staff_id = s.id and v.status in ('booked', 'confirmed', 'arrived') and v.id is distinct from p_exclude and v.occupies && v_range) as taken
            from public.store_staff s
           where s.tenant_id = p_tenant and s.active and app.visit_staff_works(s.weekly_hours, p_starts, p_ends) and (p_only_staff is null or s.id = p_only_staff)) c;
  -- visits nobody was assigned to (older ones) still take a place
  v_n := greatest(0, v_n - v_unassigned);
  return jsonb_build_object('capacity', v_cap, 'free', case when v_blocked then 0 else v_n end, 'blocked', v_blocked,
                            'staff', case when v_blocked or v_n = 0 then '[]'::jsonb else (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_free) x limit v_n) q) end);
end;
$$;
revoke all on function app.visit_places(uuid, jsonb, timestamptz, timestamptz, uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the slots of a day (every member)
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function public.visit_slots(uuid, date);
create function public.visit_slots(p_tenant_id uuid, p_date date, p_staff_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set   jsonb;
  v_now   timestamptz := app.visit_now();
  v_today date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_plan  jsonb;
  v_out   jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_date is null or not app.is_tenant_member(p_tenant_id) then
    perform app.visit_error('deny');
  end if;
  if p_date < v_today - 366 or p_date > v_today + 366 then
    perform app.visit_error('invalid');
  end if;
  v_set := app.visit_settings_json(p_tenant_id);
  if p_staff_id is not null and not exists (select 1 from public.store_staff s where s.id = p_staff_id and s.tenant_id = p_tenant_id and s.active) then
    perform app.visit_error('invalid');
  end if;
  if p_date < v_today then
    return jsonb_build_object('date', p_date, 'open', false, 'reason', 'past', 'slot_minutes', v_set -> 'slot_minutes', 'max_parallel', v_set -> 'max_parallel', 'buffer_minutes', v_set -> 'buffer_minutes', 'slots', '[]'::jsonb);
  end if;
  v_plan := app.visit_day_plan(v_set, p_date);
  select coalesce(jsonb_agg(jsonb_build_object(
           'start', s ->> 'start', 'starts_at', s -> 'starts_at', 'ends_at', s -> 'ends_at',
           'capacity', pl -> 'capacity', 'free', pl -> 'free', 'blocked', pl -> 'blocked', 'staff', pl -> 'staff',
           'past', (s ->> 'ends_at')::timestamptz <= v_now) order by (s ->> 'starts_at')::timestamptz), '[]'::jsonb)
    into v_out
    from jsonb_array_elements(v_plan -> 'slots') s
    cross join lateral (select app.visit_places(p_tenant_id, v_set, (s ->> 'starts_at')::timestamptz, (s ->> 'ends_at')::timestamptz, null, p_staff_id) as pl) z;
  return jsonb_build_object('date', p_date, 'open', v_plan -> 'open', 'reason', v_plan -> 'reason', 'slot_minutes', v_set -> 'slot_minutes', 'max_parallel', v_set -> 'max_parallel',
                            'buffer_minutes', v_set -> 'buffer_minutes', 'staff_count', v_set -> 'staff_count', 'slots', v_out);
end;
$$;
revoke all on function public.visit_slots(uuid, date, uuid) from public, anon;
grant execute on function public.visit_slots(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. claiming a slot, booking, moving
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function app.visit_claim_slot(uuid, date, text, uuid);
create function app.visit_claim_slot(p_tenant uuid, p_date date, p_start text, p_exclude uuid, p_staff uuid default null, p_prefer uuid default null,
                                     out o_starts timestamptz, out o_ends timestamptz, out o_set jsonb, out o_staff uuid) returns record
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_plan  jsonb;
  s       jsonb;
  v_pl    jsonb;
begin
  if p_date is null or p_start is null or p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    perform app.visit_error('invalid');
  end if;
  if p_date < v_today then
    perform app.visit_error('past');
  end if;
  if p_date > v_today + 120 then
    perform app.visit_error('invalid');
  end if;
  o_set := app.visit_settings_json(p_tenant);
  v_plan := app.visit_day_plan(o_set, p_date);
  if not (v_plan ->> 'open')::boolean then
    perform app.visit_error('closed');
  end if;
  select x into s from jsonb_array_elements(v_plan -> 'slots') x where x ->> 'start' = p_start;
  if s is null then
    perform app.visit_error('slot');
  end if;
  o_starts := (s ->> 'starts_at')::timestamptz;
  o_ends := (s ->> 'ends_at')::timestamptz;
  if p_staff is not null and not exists (select 1 from public.store_staff t where t.id = p_staff and t.tenant_id = p_tenant and t.active) then
    perform app.visit_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('visit_day:' || p_tenant::text || ':' || p_date::text, 0));
  v_pl := app.visit_places(p_tenant, o_set, o_starts, o_ends, p_exclude, p_staff);
  if (v_pl ->> 'free')::integer <= 0 then
    perform app.visit_error('full');
  end if;
  if coalesce((o_set ->> 'staff_count')::integer, 0) > 0 then
    -- the named staff member (the places were computed for them alone), else the preferred one when free, else the first free
    o_staff := coalesce(p_staff, (select (x ->> 'id')::uuid from jsonb_array_elements(v_pl -> 'staff') x where p_prefer is not null and (x ->> 'id')::uuid = p_prefer limit 1),
                        (select (x ->> 'id')::uuid from jsonb_array_elements(v_pl -> 'staff') x limit 1));
  elsif p_staff is not null then
    perform app.visit_error('invalid');
  end if;
end;
$$;
revoke all on function app.visit_claim_slot(uuid, date, text, uuid, uuid, uuid) from public;

drop function public.visit_book(uuid, uuid, uuid, date, text, integer, text, text, bigint, text);
create function public.visit_book(
  p_visit_id uuid, p_tenant_id uuid, p_lead_id uuid, p_date date, p_slot_start text, p_party_size integer, p_purpose text, p_note text,
  p_advance_paise bigint, p_source text, p_staff_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_sha     text;
  v_old     public.store_visits;
  v_lead    public.leads;
  v_contact public.contacts;
  v_slot    record;
  m         public.store_visits;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if p_visit_id is null or p_lead_id is null or p_party_size is null or p_party_size not between 1 and 50
     or p_source is null or p_source not in ('staff', 'assistant')
     or (v_purpose is not null and (char_length(v_purpose) > 200 or not app.text_is_clean(v_purpose)))
     or (v_note is not null and (char_length(v_note) > 1000 or not app.text_is_clean(v_note)))
     or (p_advance_paise is not null and p_advance_paise not between 1 and 100000000) then
    perform app.visit_error('invalid');
  end if;
  -- (a null staff id adds nothing to the hash: a request made before staff existed has the same hash)
  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_date, p_slot_start, p_party_size, coalesce(v_purpose, ''), coalesce(v_note, ''), coalesce(p_advance_paise::text, ''), p_source, p_staff_id), 'UTF8')), 'hex');

  select * into v_old from public.store_visits x where x.id = p_visit_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then
      perform app.visit_error('conflict');
    end if;
    return jsonb_build_object('id', v_old.id, 'status', v_old.status, 'replayed', true, 'staff_id', v_old.staff_id);
  end if;

  select * into v_lead from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then
    perform app.visit_error('reference');
  end if;
  if v_lead.archived_at is not null then
    perform app.visit_error('invalid');
  end if;
  if v_lead.contact_id is not null then
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant_id;
    if v_contact.erased_at is not null then
      perform app.visit_error('stopped');
    end if;
  end if;

  select * into v_slot from app.visit_claim_slot(p_tenant_id, p_date, p_slot_start, null, p_staff_id);
  if exists (select 1 from public.store_visits x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id and x.starts_at = v_slot.o_starts and x.status in ('booked', 'confirmed', 'arrived')) then
    perform app.visit_error('state');
  end if;

  begin
    insert into public.store_visits
      (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, party_size, purpose, note, source, advance_requested, advance_paise, request_sha256, created_by, created_at, updated_by,
       staff_id, buffer_minutes)
    values
      (p_visit_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_date, v_slot.o_starts, v_slot.o_ends, p_party_size, v_purpose, v_note, p_source,
       p_advance_paise is not null, p_advance_paise, v_sha, v_uid, app.visit_now(), v_uid,
       v_slot.o_staff, coalesce((v_slot.o_set ->> 'buffer_minutes')::smallint, 0))
    returning * into m;
  exception when exclusion_violation then
    perform app.visit_error('full');   -- the database constraint says no: that person is taken
  end;
  return jsonb_build_object('id', m.id, 'status', m.status, 'replayed', false, 'staff_id', m.staff_id);
end;
$$;
revoke all on function public.visit_book(uuid, uuid, uuid, date, text, integer, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.visit_book(uuid, uuid, uuid, date, text, integer, text, text, bigint, text, uuid) to authenticated;

drop function public.visit_change(uuid, uuid, date, text, integer, text, text, bigint, boolean);
create function public.visit_change(
  p_tenant_id uuid, p_visit_id uuid, p_date date, p_slot_start text, p_party_size integer, p_purpose text, p_note text, p_advance_paise bigint, p_clear_advance boolean default false,
  p_staff_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  m         public.store_visits;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_staff   uuid;
  v_buf     smallint;
  v_moved   boolean := false;
  v_date    date := p_date;
  v_start   text := p_slot_start;
  v_claim   record;
begin
  if v_uid is null or p_tenant_id is null or p_visit_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if (p_date is null) <> (p_slot_start is null)
     or (p_party_size is not null and p_party_size not between 1 and 50)
     or (v_purpose is not null and (char_length(v_purpose) > 200 or not app.text_is_clean(v_purpose)))
     or (v_note is not null and (char_length(v_note) > 1000 or not app.text_is_clean(v_note)))
     or (p_advance_paise is not null and p_advance_paise not between 1 and 100000000)
     or (p_clear_advance and p_advance_paise is not null) then
    perform app.visit_error('invalid');
  end if;
  select * into m from public.store_visits x where x.id = p_visit_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.visit_error('reference');
  end if;
  if m.status not in ('booked', 'confirmed') then
    perform app.visit_error('state');
  end if;
  v_staff := m.staff_id;
  v_buf := m.buffer_minutes;
  -- only the staff member changes: claim the SAME slot again for them
  if v_date is null and p_staff_id is not null and p_staff_id is distinct from m.staff_id then
    v_date := m.visit_date;
    v_start := to_char(m.starts_at at time zone 'Asia/Kolkata', 'HH24:MI');
  end if;
  if v_date is not null then
    select * into v_claim from app.visit_claim_slot(p_tenant_id, v_date, v_start, m.id, p_staff_id, m.staff_id);
    v_starts := v_claim.o_starts;
    v_ends := v_claim.o_ends;
    v_moved := v_starts is distinct from m.starts_at;
    if coalesce((v_claim.o_set ->> 'staff_count')::integer, 0) > 0 or p_staff_id is not null then
      v_staff := v_claim.o_staff;
    end if;
    if v_moved then
      v_buf := coalesce((v_claim.o_set ->> 'buffer_minutes')::smallint, 0);
    end if;
    if v_moved and exists (select 1 from public.store_visits x where x.tenant_id = p_tenant_id and x.lead_id = m.lead_id and x.id <> m.id and x.starts_at = v_starts and x.status in ('booked', 'confirmed', 'arrived')) then
      perform app.visit_error('state');
    end if;
  end if;
  begin
    update public.store_visits
       set visit_date = case when v_moved then v_date else visit_date end,
           starts_at = case when v_moved then v_starts else starts_at end,
           ends_at = case when v_moved then v_ends else ends_at end,
           staff_id = v_staff,
           buffer_minutes = v_buf,
           status = case when v_moved then 'booked' else status end,
           confirmed_at = case when v_moved then null else confirmed_at end,
           party_size = coalesce(p_party_size, party_size),
           purpose = coalesce(v_purpose, purpose),
           note = coalesce(v_note, note),
           advance_requested = case when p_clear_advance then false when p_advance_paise is not null then true else advance_requested end,
           advance_paise = case when p_clear_advance then null when p_advance_paise is not null then p_advance_paise else advance_paise end,
           updated_by = v_uid
     where id = m.id returning * into m;
  exception when exclusion_violation then
    perform app.visit_error('full');
  end;
  return jsonb_build_object('id', m.id, 'status', m.status, 'moved', v_moved, 'staff_id', m.staff_id);
end;
$$;
revoke all on function public.visit_change(uuid, uuid, date, text, integer, text, text, bigint, boolean, uuid) from public, anon;
grant execute on function public.visit_change(uuid, uuid, date, text, integer, text, text, bigint, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. the phone's offers: only free places (staff, buffer and Google busy time included)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.visit_slots_for_call(p_tenant_id uuid, p_days integer default 3, p_limit integer default 6) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set   jsonb;
  v_now   timestamptz := app.visit_now();
  v_today date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_out   jsonb := '[]'::jsonb;
  v_day   date;
  v_plan  jsonb;
  s       jsonb;
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_days is null or p_days not between 1 and 7 or p_limit is null or p_limit not between 1 and 12 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not app.module_enabled(p_tenant_id, 'visits') then
    return '[]'::jsonb;
  end if;
  v_set := app.visit_settings_json(p_tenant_id);
  for i in 0 .. p_days - 1 loop
    v_day := v_today + i;
    v_plan := app.visit_day_plan(v_set, v_day);
    for s in select x from jsonb_array_elements(v_plan -> 'slots') x order by (x ->> 'starts_at')::timestamptz loop
      continue when (s ->> 'starts_at')::timestamptz < v_now + interval '30 minutes';
      continue when (app.visit_places(p_tenant_id, v_set, (s ->> 'starts_at')::timestamptz, (s ->> 'ends_at')::timestamptz, null) ->> 'free')::integer <= 0;
      v_out := v_out || jsonb_build_array(jsonb_build_object('date', v_day, 'start', s ->> 'start', 'starts_at', s -> 'starts_at'));
      exit when jsonb_array_length(v_out) >= p_limit;
    end loop;
    exit when jsonb_array_length(v_out) >= p_limit;
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. who has each visit
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.visit_list(p_tenant_id uuid, p_from date default null, p_to date default null, p_open_only boolean default false, p_status text default null, p_lead_id uuid default null, p_visit_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_from  date;
  v_to    date;
  v_items jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.visit_error('deny');
  end if;
  if p_status is not null and p_status not in ('booked', 'confirmed', 'arrived', 'completed', 'no_show', 'cancelled') then
    perform app.visit_error('invalid');
  end if;
  v_from := coalesce(p_from, v_today);
  v_to := coalesce(p_to, case when p_from is null then v_today else p_from end);
  if v_to < v_from or v_to - v_from > 61 then
    perform app.visit_error('invalid');
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.starts_at, x.id), '[]'::jsonb) into v_items from (
    select v.id, v.lead_id, v.contact_id, v.visit_date, v.starts_at, v.ends_at, v.party_size, v.purpose, v.note, v.status, v.source, v.outcome, v.order_id,
           v.advance_requested, v.advance_paise, v.confirmation_message_id, v.reminder_message_id, v.cancel_reason,
           v.created_at, v.confirmed_at, v.arrived_at, v.closed_at,
           v.staff_id, st.name as staff_name,
           c.full_name as contact_name, co.name as company_name, co.city as city,
           exists (select 1 from public.outbox_messages m where m.id = v.confirmation_message_id and m.status = 'sent') as confirmation_sent,
           exists (select 1 from public.outbox_messages m where m.id = v.reminder_message_id and m.status = 'sent') as reminder_sent
      from public.store_visits v
      left join public.contacts c on c.tenant_id = v.tenant_id and c.id = v.contact_id
      left join public.companies co on co.tenant_id = v.tenant_id and co.id = v.company_id
      left join public.store_staff st on st.tenant_id = v.tenant_id and st.id = v.staff_id
     where v.tenant_id = p_tenant_id
       and (p_visit_id is not null and v.id = p_visit_id
            or p_visit_id is null and v.visit_date between v_from and v_to)
       and (not p_open_only or v.status in ('booked', 'confirmed', 'arrived'))
       and (p_status is null or v.status = p_status)
       and (p_lead_id is null or v.lead_id = p_lead_id)
     order by v.starts_at, v.id
     limit 300) x;
  return jsonb_build_object('from', v_from, 'to', v_to, 'items', v_items);
end;
$$;
