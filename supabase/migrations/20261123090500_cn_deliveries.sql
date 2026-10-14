-- Job CN (wave 2, C1, ADR 0085), migration 6 of 7: DELIVERIES for the `deliveries` module: an order is delivered in one or more TRIPS; each trip has a date, a vehicle, a driver, a site contact, the quantities it carries, a status,
-- a delivery note (challan) and, when it is delivered, a proof (a photo and the name of the person who received the goods). The site contact is told how the trip is going through the OUTBOX (ADR 0066).
--
--   public.delivery_trips         one row per trip: order, number, challan number, planned date, vehicle number, driver name and phone, site (default: the order's), site contact, status, problem code
--   public.delivery_trip_lines    what the trip carries: a line of the order's approved material quote and a quantity (pieces for a piece or area line; the sold unit for bags, tonnes ...). The quantities of the live trips
--                                 of one quote line never add up to more than the line holds (SM773).
--   public.delivery_trip_events   the append-only list of status changes (who, when, from, to, a CLOSED problem code; no free text)
--   public.delivery_proofs        one per delivered trip: the name of whoever received, and a photo stored in the business's private bucket `pod-<business id>` (resized and stripped of location data by the API before it is stored)
--   public.trip_plan / trip_update / trip_set_status / trip_deliver / trips_list / trip_get / delivery_challan_get / trip_update_submit
--
-- Rules: status moves planned -> loaded -> on_the_way -> delivered; a trip that is not delivered may be marked `problem` (with a closed reason) and goes back to `planned` when it is rescheduled; a trip that is
-- not delivered may be `cancelled`. A truck does not leave before the ORDER is dispatched (the order lifecycle's dispatch, which itself needs the advance under the owner's order policy): on_the_way needs the order in the state
-- dispatched, delivered or closed_paid (SM772). A trip is made only for an order of a material quote that is not closed (SM774). The challan has NO amounts (a GST invoice stays in the owner's accounting system).
-- The update to the site contact has no amounts, goes through the same outbox policy as every message (consent, suppression key, quiet hours, daily limit) and may go by itself when the owner has switched automatic sending on.
--
-- Who: Owner, Admin and Sales plan, change and read trips (a Viewer reads none: a trip names a person and a place). SQLSTATEs: SM771 the trip is not in a state that allows this, SM772 the order is not dispatched,
-- SM773 more than the order line holds, SM774 the order is closed or not a material order, SM775 the trip has no site contact to tell, SM776 the proof is incomplete (a photo in storage and a name), SM701 module off.

create function app.dl_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for another record' using errcode = '23505';
    when 'SM771'     then raise exception 'the trip is not in a state that allows this' using errcode = 'SM771';
    when 'SM772'     then raise exception 'the order is not dispatched' using errcode = 'SM772';
    when 'SM773'     then raise exception 'more than the order line holds' using errcode = 'SM773';
    when 'SM774'     then raise exception 'the order is closed or has no material quote' using errcode = 'SM774';
    when 'SM775'     then raise exception 'the trip has no site contact to tell' using errcode = 'SM775';
    when 'SM776'     then raise exception 'the proof of delivery needs a photo and a name' using errcode = 'SM776';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.dl_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.delivery_trips (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  order_id        uuid not null,
  trip_no         integer not null check (trip_no between 1 and 200),
  challan_no      integer not null check (challan_no >= 1),
  site_id         uuid,
  site_contact_id uuid,
  planned_date    date not null check (planned_date between date '2020-01-01' and date '2100-12-31'),
  vehicle_no      text check (char_length(vehicle_no) between 3 and 20 and app.text_is_clean(vehicle_no)),  -- the SHAPE is checked by the functions: the identifier sweep may replace a part of this text
  driver_name     text check (char_length(driver_name) between 1 and 80 and app.text_is_clean(driver_name) and not app.text_has_contact(driver_name)),
  driver_phone    text check (char_length(driver_phone) between 7 and 20 and app.text_is_clean(driver_phone)),  -- the SHAPE is checked by the functions (see above)
  status          text not null default 'planned' check (status in ('planned', 'loaded', 'on_the_way', 'delivered', 'problem', 'cancelled')),
  problem_code    text check (problem_code in ('truck_breakdown', 'customer_not_ready', 'site_closed', 'wrong_material', 'road_blocked', 'other')),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, order_id, trip_no),
  unique (tenant_id, challan_no),
  foreign key (tenant_id, order_id)        references public.orders (tenant_id, id),
  foreign key (tenant_id, site_id)         references public.customer_sites (tenant_id, id),
  foreign key (tenant_id, site_contact_id) references public.contacts (tenant_id, id),
  check ((status = 'problem') = (problem_code is not null)),
  check ((status = 'delivered') = (delivered_at is not null))
);
create index delivery_trips_order_idx on public.delivery_trips (tenant_id, order_id, trip_no);
create index delivery_trips_keyset_idx on public.delivery_trips (tenant_id, created_at, id);
create index delivery_trips_day_idx   on public.delivery_trips (tenant_id, planned_date, status);
create index delivery_trips_site_idx  on public.delivery_trips (tenant_id, site_id) where site_id is not null;
create index delivery_trips_contact_idx on public.delivery_trips (tenant_id, site_contact_id) where site_contact_id is not null;
comment on column public.delivery_trips.vehicle_no is 'PII: a vehicle registration number, which identifies its owner. Audited by name only; nulled by the erasure scopes';
comment on column public.delivery_trips.driver_name is 'PII: the name of the driver. Audited by name only; nulled by the erasure scopes';
comment on column public.delivery_trips.driver_phone is 'PII: the driver''s phone number. Audited by name only; nulled by the erasure scopes';
comment on column public.delivery_trips.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.delivery_trips.problem_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.delivery_trip_lines (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete restrict,
  trip_id                uuid not null,
  quote_line_id          uuid not null,
  quantity               bigint not null check (quantity between 1 and 10000000),
  unique (tenant_id, id),
  unique (tenant_id, trip_id, quote_line_id),
  foreign key (tenant_id, trip_id)       references public.delivery_trips (tenant_id, id),
  foreign key (tenant_id, quote_line_id) references public.material_quote_lines (tenant_id, id)
);
create index delivery_trip_lines_line_idx on public.delivery_trip_lines (tenant_id, quote_line_id);

create table public.delivery_trip_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  trip_id      uuid not null,
  seq          integer not null check (seq >= 1),
  from_status  text check (from_status in ('planned', 'loaded', 'on_the_way', 'delivered', 'problem', 'cancelled')),
  to_status    text not null check (to_status in ('planned', 'loaded', 'on_the_way', 'delivered', 'problem', 'cancelled')),
  problem_code text check (problem_code in ('truck_breakdown', 'customer_not_ready', 'site_closed', 'wrong_material', 'road_blocked', 'other')),
  recorded_by  uuid,
  recorded_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, trip_id, seq),
  foreign key (tenant_id, trip_id) references public.delivery_trips (tenant_id, id)
);
comment on column public.delivery_trip_events.from_status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.delivery_trip_events.to_status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.delivery_trip_events.problem_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create function app.pod_bucket(p_tenant uuid) returns text
language sql
immutable
set search_path = ''
as $$ select 'pod-' || p_tenant::text $$;
revoke all on function app.pod_bucket(uuid) from public;
create function app.pod_bucket_tenant(p_bucket text) returns uuid
language sql
immutable
set search_path = ''
as $$ select case when p_bucket ~ '^pod-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_bucket, 5)::uuid else null end $$;
revoke all on function app.pod_bucket_tenant(text) from public;
grant execute on function app.pod_bucket_tenant(text) to authenticated;

create table public.delivery_proofs (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  received_by  text not null check (char_length(received_by) between 1 and 80 and app.text_is_clean(received_by) and not app.text_has_contact(received_by)),
  photo_id     uuid not null,
  bucket       text not null check (bucket = app.pod_bucket(tenant_id)),
  path         text not null check (path = trip_id::text || '/' || photo_id::text || '.jpg'),
  width        integer not null check (width between 16 and 4096),
  height       integer not null check (height between 16 and 4096),
  bytes        integer not null check (bytes between 1 and 5242880),
  recorded_by  uuid not null,
  recorded_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, trip_id),
  foreign key (tenant_id, trip_id) references public.delivery_trips (tenant_id, id)
);
comment on column public.delivery_proofs.received_by is 'PII: the name of the person who received the goods at the site. Audited by name only; anonymised by the erasure scopes';
comment on column public.delivery_proofs.bucket is 'SAFE: the storage bucket name of the business. CLEAN-EXEMPT: pinned by CHECK to the business id';
comment on column public.delivery_proofs.path is 'SAFE: a storage path made of two ids. CLEAN-EXEMPT: pinned by CHECK to the trip and photo ids';

-- Storage rules for the proof photos (evaluated as the signed-in caller): a member who may see trips reads the bucket; Owner, Admin and Sales add files. Nothing else exists.
create policy pod_objects_select on storage.objects for select to authenticated
  using (app.pod_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.pod_bucket_tenant(bucket_id), array['owner', 'admin', 'sales']::public.app_role[]));
create policy pod_objects_insert on storage.objects for insert to authenticated
  with check (app.pod_bucket_tenant(bucket_id) is not null and app.has_tenant_role(app.pod_bucket_tenant(bucket_id), array['owner', 'admin', 'sales']::public.app_role[]));

-- nothing is deleted; a trip changes only through the functions
create function app.delivery_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'delivery rows are never deleted' using errcode = '42501';
end;
$$;
revoke all on function app.delivery_rows_guard() from public;
create function app.delivery_trips_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trip_no is distinct from old.trip_no or new.challan_no is distinct from old.challan_no or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.id is distinct from old.id then
    raise exception 'a trip keeps its number, its challan and its author' using errcode = '42501';  -- (the order never changes: no function writes it)
  end if;
  return new;
end;
$$;
revoke all on function app.delivery_trips_guard() from public;
create function app.delivery_events_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'trip events are never changed or deleted' using errcode = '42501';
end;
$$;
revoke all on function app.delivery_events_guard() from public;
create function app.delivery_proofs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- the one change allowed: an erasure of this business anonymises the receiver's name (the same rule as the outbox's message bodies)
  if tg_op = 'UPDATE' and current_user = 'postgres' and app.erasure_running(new.tenant_id)
     and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
    return new;
  end if;
  raise exception 'a proof of delivery is never changed or deleted' using errcode = '42501';
end;
$$;
revoke all on function app.delivery_proofs_guard() from public;

create trigger delivery_trips_no_delete before delete on public.delivery_trips for each row execute function app.delivery_rows_guard();
create trigger delivery_trips_no_truncate before truncate on public.delivery_trips for each statement execute function app.delivery_rows_guard();
create trigger delivery_trips_guard before update on public.delivery_trips for each row execute function app.delivery_trips_guard();
create trigger delivery_trip_lines_no_delete before delete on public.delivery_trip_lines for each row execute function app.delivery_rows_guard();
create trigger delivery_trip_lines_no_truncate before truncate on public.delivery_trip_lines for each statement execute function app.delivery_rows_guard();
create trigger delivery_trip_events_guard before update or delete on public.delivery_trip_events for each row execute function app.delivery_events_guard();
create trigger delivery_trip_events_no_truncate before truncate on public.delivery_trip_events for each statement execute function app.delivery_events_guard();
create trigger delivery_proofs_guard before update or delete on public.delivery_proofs for each row execute function app.delivery_proofs_guard();
create trigger delivery_proofs_no_truncate before truncate on public.delivery_proofs for each statement execute function app.delivery_proofs_guard();
create trigger delivery_trips_forbid_tenant_id_change before update on public.delivery_trips for each row execute function app.forbid_tenant_id_change();
create trigger delivery_trip_lines_forbid_tenant_id_change before update on public.delivery_trip_lines for each row execute function app.forbid_tenant_id_change();
create trigger delivery_trip_events_forbid_tenant_id_change before update on public.delivery_trip_events for each row execute function app.forbid_tenant_id_change();
create trigger delivery_proofs_forbid_tenant_id_change before update on public.delivery_proofs for each row execute function app.forbid_tenant_id_change();
create trigger audit_delivery_trip_lines after insert or update or delete on public.delivery_trip_lines for each row execute function app.audit_row_change('delivery_trip_line', '');
create trigger audit_delivery_trip_events after insert or update or delete on public.delivery_trip_events for each row execute function app.audit_row_change('delivery_trip_event', '');
create trigger delivery_trips_set_updated_at before update on public.delivery_trips for each row execute function app.set_updated_at();
create trigger module_guard before insert on public.delivery_trips for each row execute function app.module_guard('deliveries');
create trigger module_guard before insert on public.delivery_trip_lines for each row execute function app.module_guard('deliveries');
create trigger module_guard before insert on public.delivery_trip_events for each row execute function app.module_guard('deliveries');
create trigger module_guard before insert on public.delivery_proofs for each row execute function app.module_guard('deliveries');
create trigger audit_delivery_trips after insert or update or delete on public.delivery_trips for each row execute function app.audit_row_change('delivery_trip', 'vehicle_no,driver_name,driver_phone');
create trigger audit_delivery_proofs after insert or update or delete on public.delivery_proofs for each row execute function app.audit_row_change('delivery_proof', 'received_by');

do $$
declare t text;
begin
  foreach t in array array['delivery_trips', 'delivery_trip_lines', 'delivery_trip_events', 'delivery_proofs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the most a quote line can have on trips: the pieces (a piece or area line) or the quantity in its own unit (bags, tonnes)
create function app.dl_line_total(l public.material_quote_lines) returns bigint
language sql
immutable
set search_path = ''
as $$ select coalesce(l.pieces, l.billed_quantity) $$;
revoke all on function app.dl_line_total(public.material_quote_lines) from public;

-- the live (not cancelled) quantity already on trips for a quote line, optionally without one trip
create function app.dl_line_planned(p_tenant uuid, p_line uuid, p_except uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(tl.quantity), 0)::bigint from public.delivery_trip_lines tl join public.delivery_trips t on t.tenant_id = tl.tenant_id and t.id = tl.trip_id
   where tl.tenant_id = p_tenant and tl.quote_line_id = p_line and t.status <> 'cancelled' and t.id is distinct from p_except
$$;
revoke all on function app.dl_line_planned(uuid, uuid, uuid) from public;

create function app.trip_json(t public.delivery_trips) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'order_id', t.order_id, 'order_no', (select o.order_no from public.orders o where o.tenant_id = t.tenant_id and o.id = t.order_id), 'trip_no', t.trip_no, 'challan_no', t.challan_no,
    'site_id', t.site_id, 'site_contact_id', t.site_contact_id, 'planned_date', t.planned_date, 'vehicle_no', t.vehicle_no, 'driver_name', t.driver_name, 'driver_phone', t.driver_phone,
    'status', t.status, 'problem_code', t.problem_code, 'created_at', t.created_at, 'updated_at', t.updated_at, 'delivered_at', t.delivered_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('quote_line_id', tl.quote_line_id, 'line_no', l.line_no, 'name', l.name, 'quantity', tl.quantity,
                                                           'unit', case when l.pieces is not null then 'piece' else l.sold_per end) order by l.line_no)
                         from public.delivery_trip_lines tl join public.material_quote_lines l on l.tenant_id = tl.tenant_id and l.id = tl.quote_line_id
                        where tl.tenant_id = t.tenant_id and tl.trip_id = t.id), '[]'::jsonb),
    'proof', (select jsonb_build_object('received_by', p.received_by, 'recorded_at', p.recorded_at, 'bucket', p.bucket, 'path', p.path, 'width', p.width, 'height', p.height, 'bytes', p.bytes)
                from public.delivery_proofs p where p.tenant_id = t.tenant_id and p.trip_id = t.id))
$$;
revoke all on function app.trip_json(public.delivery_trips) from public;

-- replace the lines of a trip (only while it is planned or in problem), checking each against what the quote line holds
create function app.dl_set_lines(p_tenant uuid, p_trip uuid, p_order uuid, p_lines jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   jsonb;
  v_line  public.material_quote_lines;
  v_q     bigint;
  v_n     integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 5 then
    perform app.dl_error('invalid');
  end if;
  -- the lines of a trip are a fresh list each time; the old rows are replaced (the trip is not yet loaded, so nothing depends on them)
  perform set_config('app.dl_replace', 'on', true);
  delete from public.delivery_trip_lines where tenant_id = p_tenant and trip_id = p_trip;
  perform set_config('app.dl_replace', '', true);
  for v_row in select x from jsonb_array_elements(p_lines) x loop
    v_n := v_n + 1;
    if jsonb_typeof(v_row) <> 'object' or not app.cq_is_int(v_row -> 'quantity', 1, 10000000) or (v_row ->> 'line_no') is null or (v_row ->> 'line_no') !~ '^[1-5]$' then
      perform app.dl_error('invalid');
    end if;
    v_q := (v_row ->> 'quantity')::bigint;
    select l.* into v_line from public.material_quote_lines l join public.orders o on o.tenant_id = l.tenant_id and o.material_quote_id = l.quote_id
     where l.tenant_id = p_tenant and o.id = p_order and l.line_no = (v_row ->> 'line_no')::smallint;
    if v_line.id is null then perform app.dl_error('reference'); end if;
    if app.dl_line_planned(p_tenant, v_line.id, p_trip) + v_q > app.dl_line_total(v_line) then
      perform app.dl_error('SM773');
    end if;
    begin
      insert into public.delivery_trip_lines (tenant_id, trip_id, quote_line_id, quantity) values (p_tenant, p_trip, v_line.id, v_q);
    exception when unique_violation then
      perform app.dl_error('invalid');
    end;
  end loop;
end;
$$;
revoke all on function app.dl_set_lines(uuid, uuid, uuid, jsonb) from public;
-- the lines are replaced only through app.dl_set_lines (which sets the flag); any other delete is refused
drop trigger delivery_trip_lines_no_delete on public.delivery_trip_lines;
create function app.delivery_lines_delete_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.dl_replace', true) is distinct from 'on' then
    raise exception 'trip lines change only through the trip functions' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function app.delivery_lines_delete_guard() from public;
create trigger delivery_trip_lines_delete_guard before delete on public.delivery_trip_lines for each row execute function app.delivery_lines_delete_guard();

-- the order must be a material order that is not closed
create function app.dl_open_order(p_tenant uuid, p_order uuid) returns public.orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders x where x.tenant_id = p_tenant and x.id = p_order;
  if o.id is null then perform app.dl_error('reference'); end if;
  if o.material_quote_id is null or o.closed_at is not null or o.state in ('quote_approved', 'quote_sent', 'declined', 'expired', 'cancelled') then
    perform app.dl_error('SM774');
  end if;
  return o;
end;
$$;
revoke all on function app.dl_open_order(uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- plan and change a trip
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.trip_plan(
  p_trip_id uuid, p_tenant_id uuid, p_order_id uuid, p_planned_date date, p_vehicle_no text, p_driver_name text, p_driver_phone text, p_site_id uuid, p_site_contact_id uuid, p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  o       public.orders;
  v_exist public.delivery_trips;
  v_no    integer;
  v_ch    integer;
  v_site  uuid;
  t       public.delivery_trips;
begin
  if v_uid is null or p_tenant_id is null or p_trip_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dl_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  if p_order_id is null or p_planned_date is null then perform app.dl_error('invalid'); end if;
  if (nullif(btrim(coalesce(p_vehicle_no, '')), '') is not null and btrim(p_vehicle_no) !~ '^[A-Za-z0-9][A-Za-z0-9 -]{2,19}$')
     or (nullif(btrim(coalesce(p_driver_phone, '')), '') is not null and btrim(p_driver_phone) !~ '^[+]?[0-9][0-9 -]{6,18}$') then
    perform app.dl_error('invalid');
  end if;
  select * into v_exist from public.delivery_trips x where x.id = p_trip_id;
  if found then
    if v_exist.tenant_id = p_tenant_id and v_exist.order_id = p_order_id then
      return app.trip_json(v_exist) || jsonb_build_object('replayed', true);
    end if;
    perform app.dl_error('conflict');
  end if;
  perform 1 from public.orders x where x.tenant_id = p_tenant_id and x.id = p_order_id for update;
  o := app.dl_open_order(p_tenant_id, p_order_id);
  v_site := coalesce(p_site_id, o.site_id);
  if v_site is not null and not exists (select 1 from public.customer_sites s where s.tenant_id = p_tenant_id and s.id = v_site) then perform app.dl_error('reference'); end if;
  if p_site_contact_id is not null and not exists (select 1 from public.contacts k where k.tenant_id = p_tenant_id and k.id = p_site_contact_id and k.erased_at is null) then perform app.dl_error('reference'); end if;
  perform pg_advisory_xact_lock(hashtextextended('challan_no:' || p_tenant_id::text, 0));
  select coalesce(max(x.trip_no), 0) + 1 into v_no from public.delivery_trips x where x.tenant_id = p_tenant_id and x.order_id = p_order_id;
  select coalesce(max(x.challan_no), 0) + 1 into v_ch from public.delivery_trips x where x.tenant_id = p_tenant_id;
  begin
    insert into public.delivery_trips (id, tenant_id, order_id, trip_no, challan_no, site_id, site_contact_id, planned_date, vehicle_no, driver_name, driver_phone, created_by)
    values (p_trip_id, p_tenant_id, p_order_id, v_no, v_ch, v_site, p_site_contact_id, p_planned_date, nullif(btrim(coalesce(p_vehicle_no, '')), ''), nullif(btrim(coalesce(p_driver_name, '')), ''),
            nullif(btrim(coalesce(p_driver_phone, '')), ''), v_uid)
    returning * into t;
  exception when check_violation then
    perform app.dl_error('invalid');
  end;
  perform app.dl_set_lines(p_tenant_id, p_trip_id, p_order_id, p_lines);
  insert into public.delivery_trip_events (tenant_id, trip_id, seq, from_status, to_status, recorded_by) values (p_tenant_id, p_trip_id, 1, null, 'planned', v_uid);
  return app.trip_json(t) || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.trip_plan(uuid, uuid, uuid, date, text, text, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.trip_plan(uuid, uuid, uuid, date, text, text, text, uuid, uuid, jsonb) to authenticated;

-- change the details of a trip that is planned or in problem (a loaded truck is not re-planned)
create function public.trip_update(
  p_tenant_id uuid, p_trip_id uuid, p_planned_date date, p_vehicle_no text, p_driver_name text, p_driver_phone text, p_site_id uuid, p_site_contact_id uuid, p_lines jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  t     public.delivery_trips;
begin
  if v_uid is null or p_tenant_id is null or p_trip_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  select * into t from public.delivery_trips x where x.tenant_id = p_tenant_id and x.id = p_trip_id for update;
  if not found then perform app.dl_error('reference'); end if;
  if t.status not in ('planned', 'problem') then perform app.dl_error('SM771'); end if;
  if p_planned_date is null then perform app.dl_error('invalid'); end if;
  if (nullif(btrim(coalesce(p_vehicle_no, '')), '') is not null and btrim(p_vehicle_no) !~ '^[A-Za-z0-9][A-Za-z0-9 -]{2,19}$')
     or (nullif(btrim(coalesce(p_driver_phone, '')), '') is not null and btrim(p_driver_phone) !~ '^[+]?[0-9][0-9 -]{6,18}$') then
    perform app.dl_error('invalid');
  end if;
  if p_site_id is not null and not exists (select 1 from public.customer_sites s where s.tenant_id = p_tenant_id and s.id = p_site_id) then perform app.dl_error('reference'); end if;
  if p_site_contact_id is not null and not exists (select 1 from public.contacts k where k.tenant_id = p_tenant_id and k.id = p_site_contact_id and k.erased_at is null) then perform app.dl_error('reference'); end if;
  begin
    update public.delivery_trips set planned_date = p_planned_date, vehicle_no = nullif(btrim(coalesce(p_vehicle_no, '')), ''), driver_name = nullif(btrim(coalesce(p_driver_name, '')), ''),
           driver_phone = nullif(btrim(coalesce(p_driver_phone, '')), ''), site_id = p_site_id, site_contact_id = p_site_contact_id, updated_by = v_uid
     where id = t.id returning * into t;
  exception when check_violation then
    perform app.dl_error('invalid');
  end;
  if p_lines is not null then perform app.dl_set_lines(p_tenant_id, t.id, t.order_id, p_lines); end if;
  return app.trip_json(t);
end;
$$;
revoke all on function public.trip_update(uuid, uuid, date, text, text, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.trip_update(uuid, uuid, date, text, text, text, uuid, uuid, jsonb) to authenticated;

-- planned -> loaded -> on_the_way (delivered has its own function: it needs the proof); problem and cancelled from any trip that is not yet delivered; problem -> planned when rescheduled
create function public.trip_set_status(p_tenant_id uuid, p_trip_id uuid, p_status text, p_problem_code text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  t      public.delivery_trips;
  o      public.orders;
  v_seq  integer;
  v_ok   boolean;
begin
  if v_uid is null or p_tenant_id is null or p_trip_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  if p_status is null or p_status <> all (array['planned', 'loaded', 'on_the_way', 'problem', 'cancelled'])
     or (p_status = 'problem') <> (p_problem_code is not null) or (p_problem_code is not null and p_problem_code <> all (array['truck_breakdown', 'customer_not_ready', 'site_closed', 'wrong_material', 'road_blocked', 'other'])) then
    perform app.dl_error('invalid');
  end if;
  select * into t from public.delivery_trips x where x.tenant_id = p_tenant_id and x.id = p_trip_id for update;
  if not found then perform app.dl_error('reference'); end if;
  if t.status = p_status and p_status <> 'problem' then
    return app.trip_json(t) || jsonb_build_object('replayed', true);
  end if;
  v_ok := case t.status
            when 'planned'    then p_status in ('loaded', 'problem', 'cancelled')
            when 'loaded'     then p_status in ('on_the_way', 'problem', 'cancelled')
            when 'on_the_way' then p_status in ('problem', 'cancelled')
            when 'problem'    then p_status in ('planned', 'cancelled')
            else false end;
  if not v_ok then perform app.dl_error('SM771'); end if;
  if p_status = 'on_the_way' then
    select * into o from public.orders x where x.tenant_id = p_tenant_id and x.id = t.order_id;
    if o.state not in ('dispatched', 'delivered', 'closed_paid') then perform app.dl_error('SM772'); end if;
  end if;
  update public.delivery_trips set status = p_status, problem_code = p_problem_code, updated_by = v_uid where id = t.id returning * into t;
  select coalesce(max(e.seq), 0) + 1 into v_seq from public.delivery_trip_events e where e.tenant_id = p_tenant_id and e.trip_id = t.id;
  insert into public.delivery_trip_events (tenant_id, trip_id, seq, from_status, to_status, problem_code, recorded_by)
  values (p_tenant_id, t.id, v_seq, (select e.to_status from public.delivery_trip_events e where e.tenant_id = p_tenant_id and e.trip_id = t.id and e.seq = v_seq - 1), p_status, p_problem_code, v_uid);
  return app.trip_json(t) || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.trip_set_status(uuid, uuid, text, text) from public, anon;
grant execute on function public.trip_set_status(uuid, uuid, text, text) to authenticated;

-- delivered: only from on_the_way, with the proof: the name of the person who received the goods and a photo the API has already put in storage (the two files are checked here, as for a catalogue photo)
create function public.trip_deliver(p_tenant_id uuid, p_trip_id uuid, p_received_by text, p_photo_id uuid, p_width integer, p_height integer, p_bytes integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  t        public.delivery_trips;
  v_name   text := btrim(coalesce(p_received_by, ''));
  v_bucket text := app.pod_bucket(p_tenant_id);
  v_path   text;
  v_seq    integer;
begin
  if v_uid is null or p_tenant_id is null or p_trip_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  select * into t from public.delivery_trips x where x.tenant_id = p_tenant_id and x.id = p_trip_id for update;
  if not found then perform app.dl_error('reference'); end if;
  if t.status = 'delivered' and exists (select 1 from public.delivery_proofs p where p.tenant_id = p_tenant_id and p.trip_id = t.id and p.photo_id = p_photo_id and p.received_by = v_name) then
    return app.trip_json(t) || jsonb_build_object('replayed', true);
  end if;
  if t.status <> 'on_the_way' then perform app.dl_error('SM771'); end if;
  if char_length(v_name) not between 1 and 80 or p_photo_id is null or p_width is null or p_height is null or p_bytes is null then perform app.dl_error('SM776'); end if;
  v_path := t.id::text || '/' || p_photo_id::text || '.jpg';
  if not exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = v_path and o.metadata ->> 'mimetype' = 'image/jpeg') then perform app.dl_error('SM776'); end if;
  begin
    insert into public.delivery_proofs (trip_id, tenant_id, received_by, photo_id, bucket, path, width, height, bytes, recorded_by)
    values (t.id, p_tenant_id, v_name, p_photo_id, v_bucket, v_path, p_width, p_height, p_bytes, v_uid);
  exception when check_violation or unique_violation then
    perform app.dl_error('SM776');
  end;
  update public.delivery_trips set status = 'delivered', delivered_at = now(), updated_by = v_uid where id = t.id returning * into t;
  select coalesce(max(e.seq), 0) + 1 into v_seq from public.delivery_trip_events e where e.tenant_id = p_tenant_id and e.trip_id = t.id;
  insert into public.delivery_trip_events (tenant_id, trip_id, seq, from_status, to_status, recorded_by) values (p_tenant_id, t.id, v_seq, 'on_the_way', 'delivered', v_uid);
  return app.trip_json(t) || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.trip_deliver(uuid, uuid, text, uuid, integer, integer, integer) from public, anon;
grant execute on function public.trip_deliver(uuid, uuid, text, uuid, integer, integer, integer) to authenticated;

-- the private bucket for proof photos (Owner, Admin, Sales). Idempotent. 5 MB, jpeg only: the API converts every upload.
create function public.pod_ensure_bucket(p_tenant_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket text := app.pod_bucket(p_tenant_id);
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (v_bucket, v_bucket, false, 5242880, array['image/jpeg']) on conflict (id) do nothing;
  return v_bucket;
end;
$$;
revoke all on function public.pod_ensure_bucket(uuid) from public, anon;
grant execute on function public.pod_ensure_bucket(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reads
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.trip_get(p_tenant_id uuid, p_trip_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.delivery_trips;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  select * into t from public.delivery_trips x where x.tenant_id = p_tenant_id and x.id = p_trip_id;
  if not found then perform app.dl_error('reference'); end if;
  return app.trip_json(t) || jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('seq', e.seq, 'from', e.from_status, 'to', e.to_status, 'problem_code', e.problem_code, 'recorded_at', e.recorded_at) order by e.seq)
                                                                   from public.delivery_trip_events e where e.tenant_id = p_tenant_id and e.trip_id = t.id), '[]'::jsonb));
end;
$$;
revoke all on function public.trip_get(uuid, uuid) from public, anon;
grant execute on function public.trip_get(uuid, uuid) to authenticated;

-- trips of one order, or of one day, or of one status; the day board is `p_date` with no order
create function public.trips_list(p_tenant_id uuid, p_order_id uuid default null, p_date date default null, p_status text default null, p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  if p_limit is null or p_limit not between 1 and 200 or (p_status is not null and p_status <> all (array['planned', 'loaded', 'on_the_way', 'delivered', 'problem', 'cancelled'])) then perform app.dl_error('invalid'); end if;
  select coalesce(jsonb_agg(app.trip_json(z.t) order by z.planned_date, z.challan_no), '[]'::jsonb) into v_out
    from (select t, t.planned_date, t.challan_no from public.delivery_trips t
           where t.tenant_id = p_tenant_id and (p_order_id is null or t.order_id = p_order_id) and (p_date is null or t.planned_date = p_date) and (p_status is null or t.status = p_status)
           order by case when p_order_id is null then 0 else 1 end, t.planned_date desc, t.challan_no desc limit p_limit) z;
  return v_out;
end;
$$;
revoke all on function public.trips_list(uuid, uuid, date, text, integer) from public, anon;
grant execute on function public.trips_list(uuid, uuid, date, text, integer) to authenticated;

-- The delivery note (challan) of a trip: who, what, where, how. NO AMOUNTS: a GST invoice stays in the owner's accounting system.
create function public.delivery_challan_get(p_tenant_id uuid, p_trip_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t   public.delivery_trips;
  o   public.orders;
  s   public.customer_sites;
  k   public.contacts;
  v_company text;
  v_business text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  select * into t from public.delivery_trips x where x.tenant_id = p_tenant_id and x.id = p_trip_id;
  if not found then perform app.dl_error('reference'); end if;
  select * into o from public.orders x where x.tenant_id = p_tenant_id and x.id = t.order_id;
  select c.name into v_company from public.leads l join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id where l.tenant_id = p_tenant_id and l.id = o.lead_id;
  select n.name into v_business from public.tenants n where n.id = p_tenant_id;
  if t.site_id is not null then select * into s from public.customer_sites x where x.tenant_id = p_tenant_id and x.id = t.site_id; end if;
  if t.site_contact_id is not null then select * into k from public.contacts x where x.tenant_id = p_tenant_id and x.id = t.site_contact_id; end if;
  return jsonb_build_object(
    'challan_no', t.challan_no, 'trip_no', t.trip_no, 'order_no', o.order_no, 'date', t.planned_date, 'business', v_business, 'customer', v_company,
    'site', case when s.id is null then null else jsonb_build_object('name', s.name, 'address_line', s.address_line, 'city', s.city, 'pin', s.pin, 'access_notes', s.access_notes) end,
    'site_contact', case when k.id is null then null else jsonb_build_object('name', k.full_name, 'phone', k.phone) end,
    'vehicle_no', t.vehicle_no, 'driver_name', t.driver_name, 'driver_phone', t.driver_phone, 'status', t.status,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.name, 'quantity', tl.quantity, 'unit', case when l.pieces is not null then 'piece' else l.sold_per end,
                                                           'hsn', l.hsn) order by l.line_no)
                         from public.delivery_trip_lines tl join public.material_quote_lines l on l.tenant_id = tl.tenant_id and l.id = tl.quote_line_id
                        where tl.tenant_id = p_tenant_id and tl.trip_id = t.id), '[]'::jsonb),
    'received_by', (select p.received_by from public.delivery_proofs p where p.tenant_id = p_tenant_id and p.trip_id = t.id),
    'received_at', (select p.recorded_at from public.delivery_proofs p where p.tenant_id = p_tenant_id and p.trip_id = t.id));
end;
$$;
revoke all on function public.delivery_challan_get(uuid, uuid) from public, anon;
grant execute on function public.delivery_challan_get(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the update to the site contact, through the outbox: the same policy as every message (ADR 0066), for the trip's site contact instead of the lead's contact. The text is the API's fixed template
-- for the trip's status (no amounts, no model); a text that does hold money words is held for approval like any other. Only an `order_status` message, only to the site contact of a trip of this lead's order.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.trip_update_submit(p_message_id uuid, p_tenant_id uuid, p_trip_id uuid, p_body text, p_language text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := app.outbox_now();  -- the outbox's own clock seam (the policy depends on the hour in India)
  v_text    text := btrim(coalesce(p_body, ''));
  t         public.delivery_trips;
  o         public.orders;
  v_lead    public.leads;
  v_contact public.contacts;
  v_sha     text;
  v_old     public.outbox_messages;
  v_hard    text;
  v_dec     jsonb;
  v_body    text;
  v_disc    text;
  v_added   boolean := false;
  v_status  text;
  v_reason  text;
  v_flags   text[];
  v_sched   timestamptz;
  m         public.outbox_messages;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or p_trip_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.dl_error('deny'); end if;
  perform app.require_module(p_tenant_id, 'deliveries');
  if char_length(v_text) not between 2 and 3000 or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta') or not app.text_is_clean(v_text) then perform app.dl_error('invalid'); end if;
  select * into t from public.delivery_trips x where x.tenant_id = p_tenant_id and x.id = p_trip_id;
  if not found then perform app.dl_error('reference'); end if;
  if t.site_contact_id is null then perform app.dl_error('SM775'); end if;
  select * into o from public.orders x where x.tenant_id = p_tenant_id and x.id = t.order_id;
  select * into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.id = o.lead_id;
  v_sha := encode(sha256(convert_to(concat_ws('|', v_lead.id, t.site_contact_id, 'whatsapp', 'order_status', p_language, 'system', v_text), 'UTF8')), 'hex');
  select * into v_old from public.outbox_messages x where x.id = p_message_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then perform app.dl_error('conflict'); end if;
    return app.outbox_row_json(v_old, true);
  end if;
  select * into v_contact from public.contacts c where c.id = t.site_contact_id and c.tenant_id = p_tenant_id;
  perform pg_advisory_xact_lock(hashtextextended('outbox:' || v_contact.id::text, 0));
  v_body := v_text;
  v_disc := app.outbox_disclosure(p_language);
  if not exists (select 1 from public.outbox_messages x where x.tenant_id = p_tenant_id and x.contact_id = v_contact.id and x.disclosure_added and x.status in ('queued', 'needs_approval', 'sent'))
     and position(v_disc in v_body) = 0 then
    v_body := v_body || E'\n\n' || v_disc;
    v_added := true;
  end if;
  v_hard := app.outbox_hard_block(p_tenant_id, v_contact, null, v_now);
  v_flags := app.outbox_content_flags(v_text);
  if v_hard is not null then
    v_status := 'blocked'; v_reason := v_hard; v_sched := null;
  else
    v_dec := app.outbox_decide_content(p_tenant_id, v_lead.id, v_text, 'order_status', false, false, v_now);
    v_status := v_dec ->> 'status';
    v_reason := v_dec ->> 'reason';
    v_flags := array(select jsonb_array_elements_text(v_dec -> 'flags'));
    v_sched := nullif(v_dec ->> 'scheduled_for', '')::timestamptz;
  end if;
  insert into public.outbox_messages
    (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, flags, model_flagged, uncertain, disclosure_added, request_sha256, scheduled_for, created_by)
  values
    (p_message_id, p_tenant_id, v_lead.id, v_contact.id, v_lead.company_id, 'whatsapp', v_body, p_language, 'order_status', 'system', v_status, v_reason, v_flags, false, false, v_added, v_sha, v_sched, v_uid)
  returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.trip_update_submit(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.trip_update_submit(uuid, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- erasure: the driver's and the receiver's names, plates and phones (tenant scope and the identifier sweep; the receiver's name also with the customer, in the company scope)
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('delivery_trips',  'vehicle_no',   'tenant', 'null',      'erased:1', null),
  ('delivery_trips',  'driver_name',  'tenant', 'null',      'erased:1', null),
  ('delivery_trips',  'driver_phone', 'tenant', 'null',      'erased:1', null),
  ('delivery_proofs', 'received_by',  'tenant', 'tombstone', 'erased:1', null),
  ('delivery_trips',  'vehicle_no',   'sweep',  'substring', 'erased:1', null),
  ('delivery_trips',  'driver_name',  'sweep',  'substring', 'erased:1', null),
  ('delivery_trips',  'driver_phone', 'sweep',  'substring', 'erased:1', null),
  ('delivery_proofs', 'received_by',  'sweep',  'substring', 'erased:1', null),
  ('delivery_proofs', 'received_by',  'company', 'tombstone', 'erased:1', null);
