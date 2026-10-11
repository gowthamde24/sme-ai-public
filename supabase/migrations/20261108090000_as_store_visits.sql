-- Job AS (ADR 0067): STORE VISITS, the main flow. Most customers do not pay in advance: they book a visit (or call) and come to the shop. A new migration; earlier files are not edited.
--
--   public.store_settings   per business: weekly opening hours, closed dates, slot length, how many visits at once. A business with no row has the defaults (every day 10:00 to 20:30, 30-minute
--                           slots, 2 at once). The Owner and Admins edit them.
--   public.store_visits     a booked visit of a lead / customer: date + slot (India time), party size, purpose, note; status booked -> confirmed -> arrived -> completed | no_show | cancelled
--                           (booked or confirmed may also be cancelled; arrived goes only to completed); an outcome on completion (bought | will_return | not_interested) and an optional link to the order
--                           that "bought" started. An advance is OPTIONAL: a flag and an amount, never required, off by default.
--
-- The rules that live here, not in the API:
--   * All slot logic is India time (Asia/Kolkata), and every function reads the clock through app.visit_now() -> app.outbox_now() (the AT clock seam), so a test pins it. A slot belongs to the
--     India date it STARTS on (a slot 23:30-24:00 is that day's, a slot at 00:30 India time is the next day's even though its UTC date is the day before).
--   * A visit takes one slot. A slot has at most `max_parallel` active visits (booked, confirmed, arrived) overlapping it; the check holds a per-day lock, so two bookings cannot both take the last place.
--   * No booking for a past DATE; an earlier slot of today is allowed (a walk-in being written down).
--   * A confirmation or reminder message goes through the AT outbox under its policy (category 'visit'); anything that mentions money (an advance) is held for approval by that policy.
--   * "Offer a store visit" on a call request (Owner, second factor) declines the call AND queues the visit-offer message, in one transaction.
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 unknown / foreign reference, 23505 id reused for other content, SM501 not in the state this needs, SM502 the customer was erased,
--            SM511 the shop is closed that day, SM512 not a bookable slot, SM513 the slot is full, SM514 the date is in the past, SM515 no approved quote to make the order from.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the clock and the errors
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.visit_now() returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$ select app.outbox_now() $$;
revoke all on function app.visit_now() from public, anon, authenticated, service_role;
comment on function app.visit_now() is 'The visits clock: the outbox clock, which is now(). Tests pin it by replacing app.outbox_now() inside their own transaction.';

create function app.visit_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'deny'      then raise exception 'not allowed' using errcode = '42501';
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for other content' using errcode = '23505';
    when 'state'     then raise exception 'the visit is not in a state that allows this' using errcode = 'SM501';
    when 'stopped'   then raise exception 'the customer record was erased' using errcode = 'SM502';
    when 'closed'    then raise exception 'the shop is closed that day' using errcode = 'SM511';
    when 'slot'      then raise exception 'not a bookable slot' using errcode = 'SM512';
    when 'full'      then raise exception 'the slot is full' using errcode = 'SM513';
    when 'past'      then raise exception 'that date has passed' using errcode = 'SM514';
    when 'no_quote'  then raise exception 'no approved quote to make an order from' using errcode = 'SM515';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.visit_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the opening hours: validation, the defaults, one day's plan
-- ---------------------------------------------------------------------------------------------------------------------------------
-- {"mon": {"open": "10:00", "close": "20:30"}, ..., "sun": null}: all seven keys; a day is null (closed) or open < close, "HH:MM", close up to "24:00"
create function app.visit_hours_ok(p jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 7
     and not exists (
       select 1 from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d
        where not (p ? d)
           or (jsonb_typeof(p -> d) <> 'null' and not coalesce(
                 jsonb_typeof(p -> d) = 'object'
                 and (select count(*) from jsonb_object_keys(p -> d)) = 2
                 and (p -> d ->> 'open') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                 and (p -> d ->> 'close') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
                 and (p -> d ->> 'open') < (p -> d ->> 'close'), false)))
$$;
revoke all on function app.visit_hours_ok(jsonb) from public;

create function app.visit_default_hours() returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'mon', '{"open": "10:00", "close": "20:30"}'::jsonb, 'tue', '{"open": "10:00", "close": "20:30"}'::jsonb,
    'wed', '{"open": "10:00", "close": "20:30"}'::jsonb, 'thu', '{"open": "10:00", "close": "20:30"}'::jsonb,
    'fri', '{"open": "10:00", "close": "20:30"}'::jsonb, 'sat', '{"open": "10:00", "close": "20:30"}'::jsonb,
    'sun', '{"open": "10:00", "close": "20:30"}'::jsonb)
$$;
revoke all on function app.visit_default_hours() from public;

create table public.store_settings (
  tenant_id    uuid primary key references public.tenants (id) on delete restrict,
  weekly_hours jsonb not null,
  closed_dates date[] not null default '{}',
  slot_minutes smallint not null default 30 check (slot_minutes in (15, 20, 30, 45, 60, 90, 120)),
  max_parallel smallint not null default 2 check (max_parallel between 1 and 50),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  check (app.text_is_clean(weekly_hours::text)),
  check (app.visit_hours_ok(weekly_hours)),
  check (cardinality(closed_dates) <= 200)
);
comment on column public.store_settings.weekly_hours is 'SAFE: opening times (HH:MM) per weekday, no personal data. Checked by app.visit_hours_ok.';
comment on column public.store_settings.updated_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';

create function app.visit_settings_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('weekly_hours', s.weekly_hours, 'closed_dates', to_jsonb(s.closed_dates), 'slot_minutes', s.slot_minutes, 'max_parallel', s.max_parallel, 'is_default', false)
       from public.store_settings s where s.tenant_id = p_tenant),
    jsonb_build_object('weekly_hours', app.visit_default_hours(), 'closed_dates', '[]'::jsonb, 'slot_minutes', 30, 'max_parallel', 2, 'is_default', true))
$$;
revoke all on function app.visit_settings_json(uuid) from public;

-- one India date: {"open": bool, "reason": null | "closed_day" | "closed_date", "slots": [{"start": "10:00", "starts_at": ..., "ends_at": ...}]}
create function app.visit_day_plan(p_set jsonb, p_date date) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hours jsonb := p_set -> 'weekly_hours' -> (array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[extract(dow from p_date)::int + 1];
  v_slot  integer := (p_set ->> 'slot_minutes')::integer;
  v_open  integer;
  v_close integer;
  v_slots jsonb;
begin
  if exists (select 1 from jsonb_array_elements_text(p_set -> 'closed_dates') x where x::date = p_date) then
    return jsonb_build_object('open', false, 'reason', 'closed_date', 'slots', '[]'::jsonb);
  end if;
  if v_hours is null or jsonb_typeof(v_hours) = 'null' then
    return jsonb_build_object('open', false, 'reason', 'closed_day', 'slots', '[]'::jsonb);
  end if;
  v_open  := substr(v_hours ->> 'open', 1, 2)::integer * 60 + substr(v_hours ->> 'open', 4, 2)::integer;
  v_close := substr(v_hours ->> 'close', 1, 2)::integer * 60 + substr(v_hours ->> 'close', 4, 2)::integer;
  select coalesce(jsonb_agg(jsonb_build_object(
           'start', lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0'),
           'starts_at', ((p_date::timestamp + make_interval(mins => m)) at time zone 'Asia/Kolkata'),
           'ends_at',   ((p_date::timestamp + make_interval(mins => m + v_slot)) at time zone 'Asia/Kolkata')) order by m), '[]'::jsonb)
    into v_slots from generate_series(v_open, v_close - v_slot, v_slot) m;
  return jsonb_build_object('open', jsonb_array_length(v_slots) > 0, 'reason', case when jsonb_array_length(v_slots) = 0 then 'closed_day' end, 'slots', v_slots);
end;
$$;
revoke all on function app.visit_day_plan(jsonb, date) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the visits
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.store_visits (
  id                      uuid primary key,
  tenant_id               uuid not null references public.tenants (id) on delete restrict,
  lead_id                 uuid not null,
  contact_id              uuid,
  company_id              uuid,
  visit_date              date not null,
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null,
  party_size              smallint not null default 1 check (party_size between 1 and 50),
  purpose                 text check (char_length(purpose) between 1 and 200 and app.text_is_clean(purpose)),
  note                    text check (char_length(note) between 1 and 1000 and app.text_is_clean(note)),
  status                  text not null default 'booked' check (status in ('booked', 'confirmed', 'arrived', 'completed', 'no_show', 'cancelled')),
  source                  text not null default 'staff' check (source in ('staff', 'assistant')),
  outcome                 text check (outcome in ('bought', 'will_return', 'not_interested')),
  order_id                uuid,
  -- an advance is optional: off by default; when asked for it carries an amount (paise); nothing ever requires it
  advance_requested       boolean not null default false,
  advance_paise           bigint check (advance_paise between 1 and 100000000),
  confirmation_message_id uuid,
  reminder_message_id     uuid,
  cancel_reason           text check (char_length(cancel_reason) between 1 and 200 and app.text_is_clean(cancel_reason)),
  request_sha256          text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_by              uuid not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_by              uuid,
  confirmed_at            timestamptz,
  arrived_at              timestamptz,
  closed_at               timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  foreign key (tenant_id, confirmation_message_id) references public.outbox_messages (tenant_id, id),
  foreign key (tenant_id, reminder_message_id) references public.outbox_messages (tenant_id, id),
  check (ends_at > starts_at),
  check (visit_date = (starts_at at time zone 'Asia/Kolkata')::date),
  check (advance_requested = (advance_paise is not null)),
  check ((status = 'completed') = (outcome is not null)),
  check (order_id is null or outcome = 'bought'),
  check ((status in ('completed', 'no_show', 'cancelled')) = (closed_at is not null)),
  check (cancel_reason is null or status = 'cancelled'),
  check (status <> 'confirmed' or confirmed_at is not null),
  check (status <> 'arrived' and status <> 'completed' or arrived_at is not null)
);
create index store_visits_day_idx     on public.store_visits (tenant_id, visit_date, starts_at);
create index store_visits_keyset_idx  on public.store_visits (tenant_id, created_at, id);
create index store_visits_lead_idx    on public.store_visits (tenant_id, lead_id, starts_at);
create index store_visits_contact_idx on public.store_visits (tenant_id, contact_id) where contact_id is not null;
create index store_visits_company_idx on public.store_visits (tenant_id, company_id) where company_id is not null;
create index store_visits_order_idx   on public.store_visits (tenant_id, order_id) where order_id is not null;
create index store_visits_conf_idx    on public.store_visits (tenant_id, confirmation_message_id) where confirmation_message_id is not null;
create index store_visits_rem_idx     on public.store_visits (tenant_id, reminder_message_id) where reminder_message_id is not null;
comment on column public.store_visits.purpose is 'PII: what the visit is for; it can name the customer. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.store_visits.note is 'PII: a note about the visit; it can name the customer. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.store_visits.cancel_reason is 'PII: why the visit was cancelled; it can name the customer. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.store_visits.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.store_visits.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.store_visits.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.store_visits.request_sha256 is 'SAFE: a hash. CLEAN-EXEMPT: hex digits only';

create trigger store_settings_forbid_tenant_id_change before update on public.store_settings for each row execute function app.forbid_tenant_id_change();
create trigger store_visits_forbid_tenant_id_change before update on public.store_visits for each row execute function app.forbid_tenant_id_change();
create trigger store_visits_set_updated_at before update on public.store_visits for each row execute function app.set_updated_at();
create trigger audit_store_settings after insert or update or delete on public.store_settings for each row execute function app.audit_row_change('store_settings');
create trigger audit_store_visits after insert or update or delete on public.store_visits for each row execute function app.audit_row_change('store_visit', 'purpose,note,cancel_reason');

-- Row-level security: every member of the business reads (Today shows who is coming to anyone who may read leads); nobody writes directly (only the functions below).
do $$
declare t text;
begin
  foreach t in array array['store_settings', 'store_visits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t);
  end loop;
end $$;

-- Erasure (ADR 0014): the free text, in the tenant scope and in the sweep; the contact and company scopes are in section 8.
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('store_visits', 'purpose',       'tenant', 'tombstone', 'erased:1'),
  ('store_visits', 'note',          'tenant', 'tombstone', 'erased:1'),
  ('store_visits', 'cancel_reason', 'tenant', 'tombstone', 'erased:1'),
  ('store_visits', 'purpose',       'sweep',  'substring', 'erased:1'),
  ('store_visits', 'note',          'sweep',  'substring', 'erased:1'),
  ('store_visits', 'cancel_reason', 'sweep',  'substring', 'erased:1'),
  ('store_visits', 'purpose',       'contact', 'tombstone', 'erased:1'),
  ('store_visits', 'note',          'contact', 'tombstone', 'erased:1'),
  ('store_visits', 'cancel_reason', 'contact', 'tombstone', 'erased:1'),
  ('store_visits', 'purpose',       'company', 'tombstone', 'erased:1'),
  ('store_visits', 'note',          'company', 'tombstone', 'erased:1'),
  ('store_visits', 'cancel_reason', 'company', 'tombstone', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the guards (belt and braces: even the owner of the database cannot make a visit skip a step)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.store_visits_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'booked' or new.outcome is not null or new.order_id is not null or new.confirmed_at is not null or new.arrived_at is not null or new.closed_at is not null then
    raise exception 'a visit starts booked' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.store_visits_guard_insert() from public;
create trigger store_visits_guard_insert before insert on public.store_visits for each row execute function app.store_visits_guard_insert();

create function app.store_visits_guard_update() returns trigger
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
      or new.advance_requested is distinct from old.advance_requested or new.advance_paise is distinct from old.advance_paise)
     and old.status not in ('booked', 'confirmed') then
    raise exception 'only a visit that has not happened can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.store_visits_guard_update() from public;
create trigger store_visits_guard_update before update on public.store_visits for each row execute function app.store_visits_guard_update();

-- no row is ever deleted (a cancelled visit stays, with its reason)
create function app.store_visits_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'visits are never deleted' using errcode = '42501';
end;
$$;
revoke all on function app.store_visits_forbid_delete() from public;
create trigger store_visits_forbid_delete before delete on public.store_visits for each row execute function app.store_visits_forbid_delete();
create trigger store_visits_forbid_truncate before truncate on public.store_visits for each statement execute function app.store_visits_forbid_delete();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. settings (Owner or Admin) and the slots of a day (every member)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.visit_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.visit_error('deny');
  end if;
  return app.visit_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.visit_settings_get(uuid) from public, anon;
grant execute on function public.visit_settings_get(uuid) to authenticated;

create function public.visit_settings_set(p_tenant_id uuid, p_weekly_hours jsonb, p_closed_dates date[], p_slot_minutes integer, p_max_parallel integer) returns jsonb
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
     or p_closed_dates is null or cardinality(p_closed_dates) > 200 or exists (select 1 from unnest(p_closed_dates) d where d is null) then
    perform app.visit_error('invalid');
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_dates from unnest(p_closed_dates) d;
  insert into public.store_settings (tenant_id, weekly_hours, closed_dates, slot_minutes, max_parallel, updated_by)
  values (p_tenant_id, p_weekly_hours, v_dates, p_slot_minutes, p_max_parallel, v_uid)
  on conflict (tenant_id) do update
     set weekly_hours = excluded.weekly_hours, closed_dates = excluded.closed_dates, slot_minutes = excluded.slot_minutes, max_parallel = excluded.max_parallel,
         updated_by = v_uid, updated_at = now();
  return app.visit_settings_json(p_tenant_id);
end;
$$;
revoke all on function public.visit_settings_set(uuid, jsonb, date[], integer, integer) from public, anon;
grant execute on function public.visit_settings_set(uuid, jsonb, date[], integer, integer) to authenticated;

-- the slots of one India date with how many places are free. A date in the past has no slots (reason "past"); an earlier slot of TODAY is listed with past = true.
create function public.visit_slots(p_tenant_id uuid, p_date date) returns jsonb
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
  if p_date < v_today then
    return jsonb_build_object('date', p_date, 'open', false, 'reason', 'past', 'slot_minutes', v_set -> 'slot_minutes', 'max_parallel', v_set -> 'max_parallel', 'slots', '[]'::jsonb);
  end if;
  v_plan := app.visit_day_plan(v_set, p_date);
  select coalesce(jsonb_agg(jsonb_build_object(
           'start', s ->> 'start', 'starts_at', s -> 'starts_at', 'ends_at', s -> 'ends_at',
           'capacity', (v_set ->> 'max_parallel')::integer,
           'free', greatest(0, (v_set ->> 'max_parallel')::integer - (
                select count(*) from public.store_visits v
                 where v.tenant_id = p_tenant_id and v.visit_date = p_date and v.status in ('booked', 'confirmed', 'arrived')
                   and v.starts_at < (s ->> 'ends_at')::timestamptz and v.ends_at > (s ->> 'starts_at')::timestamptz)),
           'past', (s ->> 'ends_at')::timestamptz <= v_now) order by (s ->> 'starts_at')::timestamptz), '[]'::jsonb)
    into v_out from jsonb_array_elements(v_plan -> 'slots') s;
  return jsonb_build_object('date', p_date, 'open', v_plan -> 'open', 'reason', v_plan -> 'reason', 'slot_minutes', v_set -> 'slot_minutes', 'max_parallel', v_set -> 'max_parallel', 'slots', v_out);
end;
$$;
revoke all on function public.visit_slots(uuid, date) from public, anon;
grant execute on function public.visit_slots(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. booking, changing, the status steps, completing (Owner, Admin, Sales)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the instant of a slot, or the refusal: the date must not have passed, the shop must be open, the start must be one of the day's slots; the day is locked and the slot must have a free place.
create function app.visit_claim_slot(p_tenant uuid, p_date date, p_start text, p_exclude uuid, out o_starts timestamptz, out o_ends timestamptz, out o_set jsonb) returns record
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_plan  jsonb;
  s       jsonb;
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
  perform pg_advisory_xact_lock(hashtextextended('visit_day:' || p_tenant::text || ':' || p_date::text, 0));
  if (select count(*) from public.store_visits v
       where v.tenant_id = p_tenant and v.status in ('booked', 'confirmed', 'arrived') and v.id is distinct from p_exclude
         and v.starts_at < o_ends and v.ends_at > o_starts) >= (o_set ->> 'max_parallel')::integer then
    perform app.visit_error('full');
  end if;
end;
$$;
revoke all on function app.visit_claim_slot(uuid, date, text, uuid) from public;

create function public.visit_book(
  p_visit_id uuid, p_tenant_id uuid, p_lead_id uuid, p_date date, p_slot_start text, p_party_size integer, p_purpose text, p_note text,
  p_advance_paise bigint, p_source text
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
  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_date, p_slot_start, p_party_size, coalesce(v_purpose, ''), coalesce(v_note, ''), coalesce(p_advance_paise::text, ''), p_source), 'UTF8')), 'hex');

  -- a retry: the same request under the same id replays; other content conflicts
  select * into v_old from public.store_visits x where x.id = p_visit_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then
      perform app.visit_error('conflict');
    end if;
    return jsonb_build_object('id', v_old.id, 'status', v_old.status, 'replayed', true);
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

  select * into v_slot from app.visit_claim_slot(p_tenant_id, p_date, p_slot_start, null);
  -- the same customer cannot hold two live visits that start at the same moment
  if exists (select 1 from public.store_visits x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id and x.starts_at = v_slot.o_starts and x.status in ('booked', 'confirmed', 'arrived')) then
    perform app.visit_error('state');
  end if;

  insert into public.store_visits
    (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, party_size, purpose, note, source, advance_requested, advance_paise, request_sha256, created_by, created_at, updated_by)
  values
    (p_visit_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_date, v_slot.o_starts, v_slot.o_ends, p_party_size, v_purpose, v_note, p_source,
     p_advance_paise is not null, p_advance_paise, v_sha, v_uid, app.visit_now(), v_uid)
  returning * into m;
  return jsonb_build_object('id', m.id, 'status', m.status, 'replayed', false);
end;
$$;
revoke all on function public.visit_book(uuid, uuid, uuid, date, text, integer, text, text, bigint, text) from public, anon;
grant execute on function public.visit_book(uuid, uuid, uuid, date, text, integer, text, text, bigint, text) to authenticated;

-- move a visit that has not happened to another slot (it must be confirmed again) and/or change its details. Every argument but the id may be null = unchanged.
create function public.visit_change(
  p_tenant_id uuid, p_visit_id uuid, p_date date, p_slot_start text, p_party_size integer, p_purpose text, p_note text, p_advance_paise bigint, p_clear_advance boolean default false
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
  v_moved   boolean := false;
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
  if p_date is not null then
    select c.o_starts, c.o_ends into v_starts, v_ends from app.visit_claim_slot(p_tenant_id, p_date, p_slot_start, m.id) c;
    v_moved := v_starts is distinct from m.starts_at;
    if v_moved and exists (select 1 from public.store_visits x where x.tenant_id = p_tenant_id and x.lead_id = m.lead_id and x.id <> m.id and x.starts_at = v_starts and x.status in ('booked', 'confirmed', 'arrived')) then
      perform app.visit_error('state');
    end if;
  end if;
  update public.store_visits
     set visit_date = case when v_moved then p_date else visit_date end,
         starts_at = case when v_moved then v_starts else starts_at end,
         ends_at = case when v_moved then v_ends else ends_at end,
         status = case when v_moved then 'booked' else status end,
         confirmed_at = case when v_moved then null else confirmed_at end,
         party_size = coalesce(p_party_size, party_size),
         purpose = coalesce(v_purpose, purpose),
         note = coalesce(v_note, note),
         advance_requested = case when p_clear_advance then false when p_advance_paise is not null then true else advance_requested end,
         advance_paise = case when p_clear_advance then null when p_advance_paise is not null then p_advance_paise else advance_paise end,
         updated_by = v_uid
   where id = m.id returning * into m;
  return jsonb_build_object('id', m.id, 'status', m.status, 'moved', v_moved);
end;
$$;
revoke all on function public.visit_change(uuid, uuid, date, text, integer, text, text, bigint, boolean) from public, anon;
grant execute on function public.visit_change(uuid, uuid, date, text, integer, text, text, bigint, boolean) to authenticated;

-- confirm | arrive | no_show | cancel. The same step twice replays; any other state is SM501.
create function public.visit_step(p_tenant_id uuid, p_visit_id uuid, p_action text, p_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamptz := app.visit_now();
  v_today  date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  m        public.store_visits;
  v_target text;
begin
  if v_uid is null or p_tenant_id is null or p_visit_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if p_action is null or p_action not in ('confirm', 'arrive', 'no_show', 'cancel')
     or (v_reason is not null and (p_action <> 'cancel' or char_length(v_reason) > 200 or not app.text_is_clean(v_reason))) then
    perform app.visit_error('invalid');
  end if;
  select * into m from public.store_visits x where x.id = p_visit_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.visit_error('reference');
  end if;
  v_target := case p_action when 'confirm' then 'confirmed' when 'arrive' then 'arrived' when 'no_show' then 'no_show' else 'cancelled' end;
  if m.status = v_target then
    return jsonb_build_object('id', m.id, 'status', m.status, 'replayed', true);
  end if;
  if p_action = 'confirm' and m.status <> 'booked'
     or p_action = 'arrive' and (m.status not in ('booked', 'confirmed') or m.visit_date <> v_today)
     or p_action = 'no_show' and (m.status not in ('booked', 'confirmed') or m.starts_at > v_now)
     or p_action = 'cancel' and m.status not in ('booked', 'confirmed') then
    perform app.visit_error('state');
  end if;
  update public.store_visits
     set status = v_target,
         confirmed_at = case when p_action = 'confirm' then v_now else confirmed_at end,
         arrived_at = case when p_action = 'arrive' then v_now else arrived_at end,
         closed_at = case when p_action in ('no_show', 'cancel') then v_now else closed_at end,
         cancel_reason = case when p_action = 'cancel' then v_reason else cancel_reason end,
         updated_by = v_uid
   where id = m.id returning * into m;
  return jsonb_build_object('id', m.id, 'status', m.status, 'replayed', false);
end;
$$;
revoke all on function public.visit_step(uuid, uuid, text, text) from public, anon;
grant execute on function public.visit_step(uuid, uuid, text, text) to authenticated;

-- arrived -> completed with the outcome. "bought" may start the order: p_order_id (the caller's id) is made from an APPROVED quote of this customer (p_quote_id, or the newest approved quote
-- that has no order yet). That is the existing order flow (create_order_from_quote): Owner or Admin with a second factor, and it refuses what it refuses. All or nothing.
create function public.visit_complete(p_tenant_id uuid, p_visit_id uuid, p_outcome text, p_order_id uuid default null, p_quote_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_now   timestamptz := app.visit_now();
  m       public.store_visits;
  v_quote uuid := p_quote_id;
  v_done  jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_visit_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if p_outcome is null or p_outcome not in ('bought', 'will_return', 'not_interested') or (p_order_id is not null and p_outcome <> 'bought') or (p_quote_id is not null and p_order_id is null) then
    perform app.visit_error('invalid');
  end if;
  select * into m from public.store_visits x where x.id = p_visit_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.visit_error('reference');
  end if;
  if m.status = 'completed' then
    if m.outcome = p_outcome and m.order_id is not distinct from p_order_id then
      return jsonb_build_object('id', m.id, 'status', m.status, 'outcome', m.outcome, 'order_id', m.order_id, 'replayed', true);
    end if;
    perform app.visit_error('state');
  end if;
  if m.status <> 'arrived' then
    perform app.visit_error('state');
  end if;
  if p_order_id is not null then
    if v_quote is null then
      select q.id into v_quote from public.quotes q
       where q.tenant_id = p_tenant_id and q.lead_id = m.lead_id and q.status = 'approved' and q.valid_until >= app.quote_today()
         and not exists (select 1 from public.orders o where o.tenant_id = q.tenant_id and o.quote_id = q.id)
       order by q.created_at desc, q.id desc limit 1;
      if v_quote is null then
        perform app.visit_error('no_quote');
      end if;
    elsif not exists (select 1 from public.quotes q where q.id = v_quote and q.tenant_id = p_tenant_id and q.lead_id = m.lead_id) then
      perform app.visit_error('reference');
    end if;
    v_done := public.create_order_from_quote(p_order_id, v_quote);
  end if;
  update public.store_visits
     set status = 'completed', outcome = p_outcome, order_id = p_order_id, closed_at = v_now, updated_by = v_uid
   where id = m.id returning * into m;
  return jsonb_build_object('id', m.id, 'status', m.status, 'outcome', m.outcome, 'order_id', m.order_id, 'replayed', false);
end;
$$;
revoke all on function public.visit_complete(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.visit_complete(uuid, uuid, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. messages through the outbox: a confirmation or a reminder of a visit, and "offer a store visit" on a call request
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The words are made by the API (fixed templates per language); the AT policy decides what happens to them (an amount makes it wait for approval; p_uncertain, set for a language whose
-- template no native reader has checked yet, makes it wait for a person too). A retry with the same message id replays.
create function public.visit_send_message(p_tenant_id uuid, p_visit_id uuid, p_kind text, p_message_id uuid, p_body text, p_language text, p_uncertain boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m     public.store_visits;
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_visit_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  if p_kind is null or p_kind not in ('confirmation', 'reminder') or p_message_id is null then
    perform app.visit_error('invalid');
  end if;
  select * into m from public.store_visits x where x.id = p_visit_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.visit_error('reference');
  end if;
  -- a confirmation is for a confirmed visit; a reminder for a confirmed visit that has not started
  if m.status <> 'confirmed' or (p_kind = 'reminder' and m.starts_at <= app.visit_now()) then
    perform app.visit_error('state');
  end if;
  r := public.outbox_submit(p_message_id, p_tenant_id, m.lead_id, 'whatsapp', p_body, p_language, 'visit', 'system', false, coalesce(p_uncertain, false));
  update public.store_visits
     set confirmation_message_id = case when p_kind = 'confirmation' then p_message_id else confirmation_message_id end,
         reminder_message_id = case when p_kind = 'reminder' then p_message_id else reminder_message_id end,
         updated_by = v_uid
   where id = m.id;
  return r;
end;
$$;
revoke all on function public.visit_send_message(uuid, uuid, text, uuid, text, text, boolean) from public, anon;
grant execute on function public.visit_send_message(uuid, uuid, text, uuid, text, text, boolean) to authenticated;

-- "Offer a store visit": the Owner (second factor) declines the call request with the fixed note offer_store_visit AND the offer message is made in the outbox, in one transaction.
-- If the request was already declined this way AND that message exists, the same call replays; anything else on a decided request is SM501 (no second offer).
create function public.call_request_offer_visit(p_tenant_id uuid, p_request_id uuid, p_message_id uuid, p_body text, p_language text, p_uncertain boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     public.call_requests;
  v_msg jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_request_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.visit_error('deny');
  end if;
  perform app.require_aal2();
  select * into r from public.call_requests x where x.id = p_request_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.visit_error('reference');
  end if;
  if r.status = 'requested' then
    perform public.call_request_decide(p_tenant_id, p_request_id, 'reject', 'offer_store_visit');
  elsif not (r.status = 'rejected' and r.decision_note = 'offer_store_visit'
             and exists (select 1 from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id and x.lead_id = r.lead_id)) then
    perform app.visit_error('state');
  end if;
  v_msg := public.outbox_submit(p_message_id, p_tenant_id, r.lead_id, 'whatsapp', p_body, p_language, 'visit', 'owner', false, coalesce(p_uncertain, false));
  return jsonb_build_object('request_id', r.id, 'status', 'rejected', 'message', v_msg);
end;
$$;
revoke all on function public.call_request_offer_visit(uuid, uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.call_request_offer_visit(uuid, uuid, uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7b. the list (a day, a range, one lead, one visit): every member reads
-- ---------------------------------------------------------------------------------------------------------------------------------
-- p_from / p_to null = today (India date) to today. Open only = booked, confirmed, arrived (what Today shows). At most 62 days and 300 rows, in time order.
create function public.visit_list(p_tenant_id uuid, p_from date default null, p_to date default null, p_open_only boolean default false, p_status text default null, p_lead_id uuid default null, p_visit_id uuid default null) returns jsonb
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
           c.full_name as contact_name, co.name as company_name, co.city as city,
           exists (select 1 from public.outbox_messages m where m.id = v.confirmation_message_id and m.status = 'sent') as confirmation_sent,
           exists (select 1 from public.outbox_messages m where m.id = v.reminder_message_id and m.status = 'sent') as reminder_sent
      from public.store_visits v
      left join public.contacts c on c.tenant_id = v.tenant_id and c.id = v.contact_id
      left join public.companies co on co.tenant_id = v.tenant_id and co.id = v.company_id
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
revoke all on function public.visit_list(uuid, date, date, boolean, text, uuid, uuid) from public, anon;
grant execute on function public.visit_list(uuid, date, date, boolean, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. erasure (ADR 0014): the contact scope and the company scope reach the visits too. Whole copies of the two erase functions of job AT with the visits' three text columns added;
--    test_migration_copies.py pins that nothing else was dropped.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.erase_contact(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
  v_counts jsonb := '{}'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_patterns text[];
  v_name text;
  v_phone_digits text;
  v_enq text;
  k suppression.contact_keys;
  v_keys_n bigint := 0;
  v_markers bigint := 0;
  v_unkeyed boolean;
  v_fields text;
  sw record;
  d record;
  n bigint;
begin
  select * into c from public.contacts where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if c.erased_at is not null then
    -- nothing identifying is left to search for
    return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', false);
  end if;

  -- The last Owner cannot erase their own record: ownership is transferred first. An exception goes through the operator, after the
  -- person's identity was verified out of band, with a recorded reason (app.operator_add_owner_exception; docs/runbooks/sole-owner-erasure.md).
  -- The Owner's identity is their sign-in address; the comparison ignores case.
  if c.email is not null
     and (select count(*) from public.memberships m where m.tenant_id = r.tenant_id and m.role = 'owner') = 1
     and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                  where m.tenant_id = r.tenant_id and m.role = 'owner' and lower(u.email) = lower(c.email)) then
    perform app.erasure_state_error('SM305');
  end if;

  -- T010 / ADR 0020: the suppression keys are written BEFORE any identifier is removed, so a later import of the same address is recognised.
  -- A contact that holds an e-mail or a phone number with no recorded key is refused (SM221), UNLESS an Owner with aal2 marked this request
  -- "without a key" (allow_erasure_without_key): erasure itself is never blocked for good, and that step is audited and counted.
  select * into k from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id for update;
  v_unkeyed := (c.email is not null and k.email_hmac is null) or (c.phone is not null and k.phone_hmac is null);
  if v_unkeyed then
    if r.without_key_at is null then
      perform app.suppression_error('SM221');
    end if;
    v_counts := app.erasure_add(v_counts, 'suppression.erased_without_key', 1);
  end if;
  if c.email is not null and k.email_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'email', k.email_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  if c.phone is not null and k.phone_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'phone', k.phone_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  delete from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
  v_counts := app.erasure_add(v_counts, 'suppression.erased_markers', v_markers);
  v_counts := app.erasure_add(v_counts, 'suppression.contact_keys', n);

  -- what identifies the person, taken BEFORE the row is anonymised
  v_patterns := array_remove(array[app.erasure_email_pattern(c.email), app.erasure_phone_pattern(c.phone)], null);
  v_name := app.erasure_name(c.full_name);
  v_phone_digits := nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '');

  v_counts := app.erasure_add(v_counts, 'contacts.full_name', app.erase_column(r.tenant_id, 'contact', 'contacts', 'full_name', format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.email',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'email',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.phone',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'phone',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.job_title', app.erase_column(r.tenant_id, 'contact', 'contacts', 'job_title', format('t.id = %L', c.id)));
  update public.contacts set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = c.id;

  -- the consent ledger is KEPT (event, channel, basis, type, time); only its reference is anonymised
  v_counts := app.erasure_add(v_counts, 'consent_events.evidence_ref', app.erase_column(r.tenant_id, 'contact', 'consent_events', 'evidence_ref', format('t.contact_id = %L', c.id)));
  -- what was written about this person in the leads and opportunities linked to them
  v_counts := app.erasure_add(v_counts, 'leads.source',               app.erase_column(r.tenant_id, 'contact', 'leads', 'source',               format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason',  app.erase_column(r.tenant_id, 'contact', 'leads', 'disqualified_reason',  format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',        app.erase_column(r.tenant_id, 'contact', 'opportunities', 'title',        format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason',  app.erase_column(r.tenant_id, 'contact', 'opportunities', 'lost_reason',  format('t.contact_id = %L', c.id)));

  -- T008: the enquiries captured on this person's leads (or from them), and what was extracted from them
  v_enq := format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 't', c.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 'e', c.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'contact', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'contact', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'value_text', v_fields));

  -- job AT: the messages written to this person (and the call requests about them) are tombstoned outright, not left to the name review
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'contact', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'contact', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'contact', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'contact', 'call_requests', 'decision_note', v_enq));

  -- job AS: the store visits of this person's leads (what the visit was for, the note, why it was cancelled)
  v_counts := app.erasure_add(v_counts, 'store_visits.purpose', app.erase_column(r.tenant_id, 'contact', 'store_visits', 'purpose', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.note', app.erase_column(r.tenant_id, 'contact', 'store_visits', 'note', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.cancel_reason', app.erase_column(r.tenant_id, 'contact', 'store_visits', 'cancel_reason', v_enq));

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  v_review := sw.o_review;
  v_truncated := sw.o_truncated;

  -- another contact that carries the same e-mail or number is the same person in a structured column: listed for the Owner
  for d in
    select o.id, (lower(o.email) = lower(c.email)) as same_email
      from public.contacts o
     where o.tenant_id = r.tenant_id and o.id <> c.id and o.erased_at is null
       and ((c.email is not null and lower(o.email) = lower(c.email))
         or (v_phone_digits is not null and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') = v_phone_digits))
     order by o.id
  loop
    v_review := v_review || jsonb_build_array(jsonb_build_object('table', 'contacts', 'column', case when d.same_email then 'email' else 'phone' end, 'id', d.id));
  end loop;

  return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', v_truncated);
end;
$$;

create or replace function app.erase_company(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  co public.companies;
  v_counts jsonb := '{}'::jsonb;
  v_patterns text[];
  v_name text;
  v_leads text;
  v_claims text;
  v_evidence text;
  v_enq text;
  v_fields text;
  v_keys constant text[] := array['name', 'website', 'city', 'region'];
  sw record;
  d record;
  n bigint;
begin
  select * into co from public.companies where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if co.erased_at is not null then
    return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
  end if;

  v_patterns := array_remove(array[app.erasure_host_pattern(co.website)], null);
  v_name := app.erasure_name(co.name);

  -- row selectors, over the alias t of the table being changed
  v_leads := format('t.company_id = %L', co.id);
  v_claims := format('(t.company_id = %1$L or t.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L))', co.id);
  v_evidence := format($f$t.id in (select k.evidence_id from public.evidence_links k where k.tenant_id = t.tenant_id and (
      k.company_id = %1$L
      or k.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)
      or k.claim_id in (select c.id from public.claims c where c.tenant_id = t.tenant_id and (
           c.company_id = %1$L or c.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)))))$f$, co.id);

  v_counts := app.erasure_add(v_counts, 'evidence.url',       app.erase_column(r.tenant_id, 'company', 'evidence', 'url',       v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.reference', app.erase_column(r.tenant_id, 'company', 'evidence', 'reference', v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.snippet',   app.erase_column(r.tenant_id, 'company', 'evidence', 'snippet',   v_evidence));
  v_counts := app.erasure_add(v_counts, 'claims.value',       app.erase_column(r.tenant_id, 'company', 'claims', 'value',       v_claims));
  v_counts := app.erasure_add(v_counts, 'leads.source',              app.erase_column(r.tenant_id, 'company', 'leads', 'source',              v_leads));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason', app.erase_column(r.tenant_id, 'company', 'leads', 'disqualified_reason', v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',       app.erase_column(r.tenant_id, 'company', 'opportunities', 'title',       v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason', app.erase_column(r.tenant_id, 'company', 'opportunities', 'lost_reason', v_leads));

  -- T008: the enquiries of this company's leads, and what was extracted from them
  v_enq := format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 't', co.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 'e', co.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'company', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'company', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'value_text', v_fields));

  -- job AT: the messages written to this company's leads, and the call requests about them
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'company', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'company', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'company', 'call_requests', 'decision_note', v_enq));

  -- job AS: the store visits of this person's leads (what the visit was for, the note, why it was cancelled)
  v_counts := app.erasure_add(v_counts, 'store_visits.purpose', app.erase_column(r.tenant_id, 'company', 'store_visits', 'purpose', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.note', app.erase_column(r.tenant_id, 'company', 'store_visits', 'note', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.cancel_reason', app.erase_column(r.tenant_id, 'company', 'store_visits', 'cancel_reason', v_enq));

  v_counts := app.erasure_add(v_counts, 'companies.name',    app.erase_column(r.tenant_id, 'company', 'companies', 'name',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.website', app.erase_column(r.tenant_id, 'company', 'companies', 'website', format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.city',    app.erase_column(r.tenant_id, 'company', 'companies', 'city',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.region',  app.erase_column(r.tenant_id, 'company', 'companies', 'region',  format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.tags',    app.erase_column(r.tenant_id, 'company', 'companies', 'tags',    format('t.id = %L', co.id)));
  update public.companies set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = co.id;

  -- audit rows written before the four identity columns were classified PII carry their values: remove those KEYS (nothing else)
  update public.audit_events a
     set old_values = a.old_values - v_keys, new_values = a.new_values - v_keys
   where a.tenant_id = r.tenant_id and a.entity_type = 'company' and a.entity_id = co.id
     and (a.old_values ?| v_keys or a.new_values ?| v_keys);
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'audit_events.values', n);

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  return jsonb_build_object('counts', v_counts, 'review', sw.o_review, 'review_truncated', sw.o_truncated);
end;
$$;


-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. Agent OWL can propose a visit (a booked visit that a person confirms) and cite one: 'store_visit' is a source and a draft type the Main agent may save
--    (a full copy of the job AT function; the only change is the word in the two lists)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.assistant_save_reply(
  p_run_id uuid, p_message_id uuid, p_body text, p_language text, p_sources jsonb, p_drafts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.agent_runs;
  m      public.assistant_messages;
  v_seq  integer;
  v_body text := btrim(coalesce(p_body, ''));
begin
  r := app.agent_open_run(p_run_id);
  if r.conversation_id is null or p_message_id is null or char_length(v_body) not between 1 and 12000
     or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta'))
     or not app.assistant_pairs_ok(coalesce(p_sources, '[]'::jsonb), array['quote', 'lead', 'enquiry', 'order', 'company', 'customer', 'price_item', 'followup_draft', 'reply_draft', 'outbox_message', 'call_request', 'store_visit'])
     or not app.assistant_pairs_ok(coalesce(p_drafts, '[]'::jsonb), array['quote', 'followup_draft', 'reply_draft', 'enquiry', 'store_visit']) then
    perform app.agent_state_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant:' || r.conversation_id::text, 0));
  select * into m from public.assistant_messages x where x.id = p_message_id;
  if found then
    if m.tenant_id <> r.tenant_id or m.run_id is distinct from r.id or m.role <> 'assistant' then
      raise exception 'message id already used' using errcode = '23505', constraint = 'assistant_messages_pkey', table = 'assistant_messages', schema = 'public';
    end if;
    return jsonb_build_object('replayed', true, 'message_id', m.id, 'seq', m.seq);
  end if;
  select coalesce(max(x.seq), 0) + 1 into v_seq from public.assistant_messages x where x.tenant_id = r.tenant_id and x.conversation_id = r.conversation_id;
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, sources, drafts, run_id, created_by)
  values (p_message_id, r.tenant_id, r.conversation_id, v_seq, 'assistant', v_body, p_language, coalesce(p_sources, '[]'::jsonb), coalesce(p_drafts, '[]'::jsonb), r.id, r.started_by);
  update public.assistant_conversations set updated_at = now() where tenant_id = r.tenant_id and id = r.conversation_id;
  return jsonb_build_object('replayed', false, 'message_id', p_message_id, 'seq', v_seq);
end;
$$;
revoke all on function public.assistant_save_reply(uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.assistant_save_reply(uuid, uuid, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. a weekly AI figure, as a percentage only (never a count). It is an even share of the month's allowance (monthly x 7 / the days of the billing month) against what was spent from
--     Monday (India) to today. A separate read, so the answer of public.ai_usage keeps its shape. Owner and Admin.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.ai_usage_week(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.agent_utc_today();
  v_start date := app.agent_utc_today() - (extract(isodow from app.agent_utc_today())::integer - 1);
  v_month numeric;
  v_win   record;
  v_week  numeric;
  v_spent numeric;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  select * into v_win from app.ai_month_window(p_tenant_id);
  v_month := app.ai_monthly_allowance(p_tenant_id);
  v_week := v_month * 7 / greatest(1, v_win.win_end - v_win.win_start);
  select coalesce(sum(coalesce(x.settled_micros, x.reserved_micros)), 0) into v_spent
    from public.agent_cost_reservations x where x.tenant_id = p_tenant_id and x.cost_day >= v_start and x.cost_day <= v_today;
  return jsonb_build_object(
    'week_percent', case when v_month is null then 0 when v_week <= 0 then 100 else least(100, floor(v_spent * 100 / v_week))::integer end,
    'resets_at_week', ((v_start + 7)::timestamp at time zone 'Asia/Kolkata'));
end;
$$;
revoke all on function public.ai_usage_week(uuid) from public, anon;
grant execute on function public.ai_usage_week(uuid) to authenticated;
