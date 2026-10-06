-- T010 commit 2 (ADR 0020, docs/plans/t010-integration.md): SUPPRESSION KEYS, the hard gate before any outreach. A new migration; nothing earlier is amended.
--
--   * a PRIVATE schema `suppression` (no client role has USAGE, the pattern of erasure.registry) holds two tables, reachable only through SECURITY DEFINER functions:
--       suppression.contact_keys  the current keyed HMACs of a contact's e-mail and phone (derived; erased with the contact);
--       suppression.key_events    the append-only ledger of `suppressed` / `lifted` events per (tenant, kind, hmac), ordered by an identity sequence, retained after erasure on purpose.
--     The HMACs are computed by the API with a key held OUTSIDE the database; the database stores, compares and refuses, it cannot verify the value (ADR 0020).
--   * triggers on contacts: a contact that becomes suppressed appends its keys as `suppressed` events, a lifted one as `lifted` events; changing an e-mail or phone forgets the
--     stored key of that identifier.
--   * public functions (role first, one generic 42501): record_contact_keys, check_suppression, unkeyed_contact_count, unkeyed_contacts, backfill_contact_keys,
--     allow_erasure_without_key.
--   * REPLACED (copies of the latest definitions plus the lines named here): public.lift_suppression (Owner with aal2 only; it was Owner or Admin), app.erase_contact
--     (writes the `erased` keys BEFORE the identifiers go; SM221 when an identifier has no key unless the Owner allowed it), app.erase_tenant (appends the keys that exist, never refuses).
--   * SQLSTATE SM221: a contact is erased without a recorded suppression key and the Owner did not allow it. 22023 invalid argument, 23503 invalid reference, 42501 generic denial.
--   * lock order: contact row, then the advisory lock of the key (app.suppression_key_add), then the ledger. Every writer of a contact's keys locks the contact row first.

-- ---------------------------------------------------------------------------------------------
-- 1. the private schema
-- ---------------------------------------------------------------------------------------------
create schema suppression;
revoke all on schema suppression from public, anon, authenticated, service_role;

create table suppression.key_events (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint generated always as identity,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  kind              text not null check (kind in ('email', 'phone')),
  key_hmac          text not null check (key_hmac ~ '^[0-9a-f]{64}$'),
  key_version       smallint not null check (key_version between 1 and 32),
  event             text not null check (event in ('suppressed', 'lifted')),
  reason            text check (reason in ('opted_out', 'bounced', 'complained', 'legal', 'manual', 'erased')),
  -- the contact the key came from; NO foreign key: that contact may be erased and the key must outlive it
  source_contact_id uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  check ((event = 'suppressed') = (reason is not null))
);
create index key_events_lookup_idx on suppression.key_events (tenant_id, kind, key_hmac, seq desc);
comment on column suppression.key_events.key_hmac is 'PII: a keyed hash of an e-mail or phone (arguably personal data); retained after erasure on purpose (ADR 0020); recorded by name only in the audit trail';

create table suppression.contact_keys (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  contact_id  uuid not null,
  email_hmac  text check (email_hmac ~ '^[0-9a-f]{64}$'),
  phone_hmac  text check (phone_hmac ~ '^[0-9a-f]{64}$'),
  key_version smallint not null check (key_version between 1 and 32),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, contact_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
create index contact_keys_email_idx on suppression.contact_keys (tenant_id, email_hmac) where email_hmac is not null;
create index contact_keys_phone_idx on suppression.contact_keys (tenant_id, phone_hmac) where phone_hmac is not null;
comment on column suppression.contact_keys.email_hmac is 'PII: a keyed hash of the contact e-mail (derived); erased with the contact';
comment on column suppression.contact_keys.phone_hmac is 'PII: a keyed hash of the contact phone (derived); erased with the contact';

do $$
declare t text;
begin
  foreach t in array array['key_events', 'contact_keys'] loop
    execute format('revoke all on suppression.%I from public, anon, authenticated, service_role', t);
    execute format('alter table suppression.%I enable row level security', t);
    execute format('alter table suppression.%I force row level security', t);
  end loop;
end $$;

-- the ledger is append-only for every role; the stored keys are a cache that only the functions change, and nobody truncates either
create trigger key_events_append_only before update or delete on suppression.key_events for each row execute function app.append_only();
create trigger key_events_no_truncate before truncate on suppression.key_events for each statement execute function app.append_only();
create trigger contact_keys_no_truncate before truncate on suppression.contact_keys for each statement execute function app.append_only();
create trigger contact_keys_forbid_tenant_id_change before update on suppression.contact_keys for each row execute function app.forbid_tenant_id_change();
create trigger audit_key_events after insert or update or delete on suppression.key_events for each row execute function app.audit_row_change('suppression_key_event', 'key_hmac');
create trigger audit_contact_keys after insert or update or delete on suppression.contact_keys for each row execute function app.audit_row_change('contact_key', 'email_hmac,phone_hmac');

-- ---------------------------------------------------------------------------------------------
-- 2. internal functions (nobody but the definer functions calls them)
-- ---------------------------------------------------------------------------------------------
create function app.suppression_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'deny' then 'suppression action not permitted'
      when 'invalid' then 'invalid argument'
      when 'reference' then 'invalid reference'
      when 'SM221' then 'a suppression key must be recorded before this contact is erased'
      else 'suppression error' end
    using errcode = case p_code when 'deny' then '42501' when 'invalid' then '22023' when 'reference' then '23503' else p_code end;
end;
$$;

create function app.is_hex64(p text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p ~ '^[0-9a-f]{64}$' $$;

-- is the key currently suppressed: the LATEST event for it (by the identity sequence, never by time) is a `suppressed`
create function app.key_active(p_tenant uuid, p_kind text, p_hmac text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select e.event = 'suppressed' from suppression.key_events e
                    where e.tenant_id = p_tenant and e.kind = p_kind and e.key_hmac = p_hmac order by e.seq desc limit 1), false)
$$;

-- the contact-level reason of a key's latest suppression ('erased' becomes 'legal': the person exercised a right)
create function app.key_reason(p_tenant uuid, p_kind text, p_hmac text) returns text
language sql
stable
set search_path = ''
as $$
  select case e.reason when 'erased' then 'legal' else e.reason end
    from suppression.key_events e
   where e.tenant_id = p_tenant and e.kind = p_kind and e.key_hmac = p_hmac and e.event = 'suppressed'
   order by e.seq desc limit 1
$$;

-- append a `suppressed` event unless the key is already suppressed (idempotent); one writer at a time per key
create function app.suppression_key_add(p_tenant uuid, p_kind text, p_hmac text, p_version smallint, p_reason text, p_source uuid, p_by uuid) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || p_tenant::text || ':' || p_kind || ':' || p_hmac, 0));
  if app.key_active(p_tenant, p_kind, p_hmac) then
    return false;
  end if;
  insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason, source_contact_id, created_by)
  values (p_tenant, p_kind, p_hmac, p_version, 'suppressed', p_reason, p_source, p_by);
  return true;
end;
$$;

create function app.suppression_key_lift(p_tenant uuid, p_kind text, p_hmac text, p_version smallint, p_source uuid, p_by uuid) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || p_tenant::text || ':' || p_kind || ':' || p_hmac, 0));
  if not app.key_active(p_tenant, p_kind, p_hmac) then
    return false;
  end if;
  insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, source_contact_id, created_by)
  values (p_tenant, p_kind, p_hmac, p_version, 'lifted', p_source, p_by);
  return true;
end;
$$;

-- the shape of a key set: {version 1..32, email: hex64 | null, phone: hex64 | null} (at least one key) and, for matching only, {email: [hex64 x up to 4], phone: [...]}
create function app.suppression_keys_ok(p_keys jsonb, p_also jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  x jsonb;
  n integer;
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'object' or p_also is null or jsonb_typeof(p_also) <> 'object' then
    return false;
  end if;
  for k in select jsonb_object_keys(p_keys) loop
    if k not in ('version', 'email', 'phone') then
      return false;
    end if;
  end loop;
  x := p_keys -> 'version';
  if x is null or jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[0-9]{1,2}$' or (x #>> '{}')::integer not between 1 and 32 then
    return false;
  end if;
  foreach k in array array['email', 'phone'] loop
    x := p_keys -> k;
    if x is not null and x <> 'null'::jsonb and (jsonb_typeof(x) <> 'string' or not app.is_hex64(x #>> '{}')) then
      return false;
    end if;
  end loop;
  if (p_keys ->> 'email') is null and (p_keys ->> 'phone') is null then
    return false;
  end if;
  for k in select jsonb_object_keys(p_also) loop
    if k not in ('email', 'phone') then
      return false;
    end if;
  end loop;
  foreach k in array array['email', 'phone'] loop
    x := p_also -> k;
    if x is not null then
      if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) > 4 then
        return false;
      end if;
      for n in 0 .. jsonb_array_length(x) - 1 loop
        if jsonb_typeof(x -> n) <> 'string' or not app.is_hex64(x ->> n) then
          return false;
        end if;
      end loop;
    end if;
  end loop;
  return true;
end;
$$;

-- store a contact's keys and flag the contact when any of them (or of `also`, the previous key versions, for matching only) is suppressed.
-- p_strict: a refusal raises; otherwise (the backfill) it is reported as skipped. The contact row is locked first.
create function app.contact_keys_record(p_contact_id uuid, p_keys jsonb, p_also jsonb, p_uid uuid, p_strict boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c         public.contacts;
  v_email   text := nullif(p_keys ->> 'email', '');
  v_phone   text := nullif(p_keys ->> 'phone', '');
  v_ver     smallint := (p_keys ->> 'version')::smallint;
  v_hit     text;
  v_matched boolean := false;
  v_flagged boolean := false;
  m         record;
begin
  select * into c from public.contacts where id = p_contact_id for update;
  if not found or c.erased_at is not null then
    if p_strict then
      perform app.suppression_error('reference');
    end if;
    return jsonb_build_object('recorded', false, 'skipped', 'unavailable');
  end if;
  if (v_email is not null and c.email is null) or (v_phone is not null and c.phone is null) then
    if p_strict then
      perform app.suppression_error('invalid');
    end if;
    return jsonb_build_object('recorded', false, 'skipped', 'identifier_missing');
  end if;

  insert into suppression.contact_keys as k (tenant_id, contact_id, email_hmac, phone_hmac, key_version, recorded_by)
  values (c.tenant_id, c.id, v_email, v_phone, v_ver, p_uid)
  on conflict (tenant_id, contact_id) do update
     set email_hmac  = case when k.key_version = excluded.key_version then coalesce(excluded.email_hmac, k.email_hmac) else excluded.email_hmac end,
         phone_hmac  = case when k.key_version = excluded.key_version then coalesce(excluded.phone_hmac, k.phone_hmac) else excluded.phone_hmac end,
         key_version = excluded.key_version, recorded_by = excluded.recorded_by, recorded_at = now()
   where (k.email_hmac, k.phone_hmac, k.key_version) is distinct from
         (case when k.key_version = excluded.key_version then coalesce(excluded.email_hmac, k.email_hmac) else excluded.email_hmac end,
          case when k.key_version = excluded.key_version then coalesce(excluded.phone_hmac, k.phone_hmac) else excluded.phone_hmac end, excluded.key_version);

  for m in
    select 'email'::text as kind, h from (select v_email as h union all select jsonb_array_elements_text(coalesce(p_also -> 'email', '[]'::jsonb))) e where h is not null
    union all
    select 'phone'::text, h from (select v_phone as h union all select jsonb_array_elements_text(coalesce(p_also -> 'phone', '[]'::jsonb))) p where h is not null
  loop
    if app.key_active(c.tenant_id, m.kind, m.h) then
      v_matched := true;
      v_hit := coalesce(v_hit, app.key_reason(c.tenant_id, m.kind, m.h));
    end if;
  end loop;
  -- a contact that is ALREADY suppressed (an opt-out recorded before it was keyed: the backfill of existing contacts) has its stored keys suppressed now,
  -- and so does a new identifier of a suppressed contact: the suppression follows the person to every identifier they hold
  if c.suppressed_at is not null then
    for m in select 'email'::text as kind, k2.email_hmac as h from suppression.contact_keys k2 where k2.tenant_id = c.tenant_id and k2.contact_id = c.id and k2.email_hmac is not null
             union all
             select 'phone'::text, k2.phone_hmac from suppression.contact_keys k2 where k2.tenant_id = c.tenant_id and k2.contact_id = c.id and k2.phone_hmac is not null
    loop
      perform app.suppression_key_add(c.tenant_id, m.kind, m.h, v_ver, c.suppression_reason::text, c.id, p_uid);
    end loop;
  end if;
  -- a contact that arrives with a suppressed key is created FLAGGED: suppressed, consent withdrawn (the existing rules), never contactable
  if v_matched and c.suppressed_at is null then
    perform public.suppress_contact(c.tenant_id, c.id, v_hit::public.suppression_reason, 'other', 'system:suppression-key');
    v_flagged := true;
  end if;
  return jsonb_build_object('recorded', true, 'email_key', v_email is not null, 'phone_key', v_phone is not null, 'matched', v_matched, 'flagged', v_flagged);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. the contact triggers
-- ---------------------------------------------------------------------------------------------
-- a changed identifier forgets its stored key (a stale key is never trusted); the API records the new one
create function app.contacts_forget_changed_keys() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update suppression.contact_keys k
     set email_hmac = case when new.email is distinct from old.email then null else k.email_hmac end,
         phone_hmac = case when new.phone is distinct from old.phone then null else k.phone_hmac end
   where k.tenant_id = new.tenant_id and k.contact_id = new.id;
  return new;
end;
$$;
create trigger contacts_forget_changed_keys after update of email, phone on public.contacts
  for each row when (old.email is distinct from new.email or old.phone is distinct from new.phone) execute function app.contacts_forget_changed_keys();

-- the keys follow the contact's suppression: suppressed -> their keys are suppressed (with the contact's reason), lifted -> lifted
create function app.contacts_sync_suppression_keys() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k suppression.contact_keys;
begin
  select * into k from suppression.contact_keys where tenant_id = new.tenant_id and contact_id = new.id;
  if not found then
    return new;
  end if;
  if new.suppressed_at is not null then
    if k.email_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'email', k.email_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
    if k.phone_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
  else
    if k.email_hmac is not null then
      perform app.suppression_key_lift(new.tenant_id, 'email', k.email_hmac, k.key_version, new.id, auth.uid());
    end if;
    if k.phone_hmac is not null then
      perform app.suppression_key_lift(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.id, auth.uid());
    end if;
  end if;
  return new;
end;
$$;
create trigger contacts_sync_suppression_keys after update of suppressed_at on public.contacts
  for each row when (old.suppressed_at is distinct from new.suppressed_at) execute function app.contacts_sync_suppression_keys();

-- ---------------------------------------------------------------------------------------------
-- 4. erasure: the "without a key" step of the Owner (the columns, then the function)
-- ---------------------------------------------------------------------------------------------
alter table public.erasure_requests add column without_key_by uuid;
alter table public.erasure_requests add column without_key_at timestamptz;
alter table public.erasure_requests add constraint erasure_requests_without_key_both
  check ((without_key_by is null) = (without_key_at is null));
comment on column public.erasure_requests.without_key_at is 'SAFE: when an Owner (aal2) allowed this contact erasure to run WITHOUT a recorded suppression key (ADR 0020); written only by allow_erasure_without_key';

create function public.allow_erasure_without_key(p_request_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.erasure_requests;
begin
  select * into r from public.erasure_requests where id = p_request_id;
  if auth.uid() is null or p_request_id is null or not found or not app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[]) then
    perform app.suppression_error('deny');
  end if;
  perform app.require_aal2();
  select * into r from public.erasure_requests where id = p_request_id for update;
  if r.without_key_at is not null then
    return jsonb_build_object('request_id', r.id, 'without_key', true, 'replayed', true);
  end if;
  if r.scope <> 'contact' or r.status <> 'pending' then
    perform app.suppression_error('invalid');
  end if;
  update public.erasure_requests set without_key_by = auth.uid(), without_key_at = now() where id = r.id;
  return jsonb_build_object('request_id', r.id, 'without_key', true, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. the public functions
-- ---------------------------------------------------------------------------------------------
create function public.record_contact_keys(p_contact_id uuid, p_keys jsonb, p_also jsonb default '{}'::jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
begin
  if v_uid is null or p_contact_id is null then
    perform app.suppression_error('deny');
  end if;
  select c.tenant_id into v_tenant from public.contacts c where c.id = p_contact_id;
  if v_tenant is null or not app.has_tenant_role(v_tenant, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.suppression_error('deny');
  end if;
  if not app.suppression_keys_ok(p_keys, coalesce(p_also, '{}'::jsonb)) then
    perform app.suppression_error('invalid');
  end if;
  return app.contact_keys_record(p_contact_id, p_keys, coalesce(p_also, '{}'::jsonb), v_uid, true);
end;
$$;

create function public.check_suppression(p_tenant_id uuid, p_keys jsonb) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  k text;
  x jsonb;
  n integer;
  v_hit boolean;
  v_res jsonb := jsonb_build_object('email', false, 'phone', false);
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.suppression_error('deny');
  end if;
  if p_keys is null or jsonb_typeof(p_keys) <> 'object' then
    perform app.suppression_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_keys) loop
    if k not in ('email', 'phone') then
      perform app.suppression_error('invalid');
    end if;
  end loop;
  foreach k in array array['email', 'phone'] loop
    x := p_keys -> k;
    if x is null then
      continue;
    end if;
    if jsonb_typeof(x) <> 'array' or jsonb_array_length(x) > 8 then
      perform app.suppression_error('invalid');
    end if;
    v_hit := false;
    for n in 0 .. jsonb_array_length(x) - 1 loop
      if jsonb_typeof(x -> n) <> 'string' or not app.is_hex64(x ->> n) then
        perform app.suppression_error('invalid');
      end if;
      v_hit := v_hit or app.key_active(p_tenant_id, k, x ->> n);
    end loop;
    v_res := v_res || jsonb_build_object(k, v_hit);
  end loop;
  return v_res || jsonb_build_object('suppressed', (v_res ->> 'email')::boolean or (v_res ->> 'phone')::boolean);
end;
$$;

create function public.unkeyed_contact_count(p_tenant_id uuid) returns integer
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.suppression_error('deny');
  end if;
  return (select count(*)::integer from public.contacts c
           where c.tenant_id = p_tenant_id and c.erased_at is null
             and ((c.email is not null and not exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.email_hmac is not null))
               or (c.phone is not null and not exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.phone_hmac is not null))));
end;
$$;

-- the contacts that still need keys, with the identifiers the API must key (Owner, aal2: it hands out contact details, like the backfill itself)
create function public.unkeyed_contacts(p_tenant_id uuid, p_limit integer default 100) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.suppression_error('deny');
  end if;
  perform app.require_aal2();
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.suppression_error('invalid');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'email', x.email, 'phone', x.phone) order by x.id), '[]'::jsonb) from (
            select c.id, c.email, c.phone from public.contacts c
             where c.tenant_id = p_tenant_id and c.erased_at is null
               and ((c.email is not null and not exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.email_hmac is not null))
                 or (c.phone is not null and not exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.phone_hmac is not null)))
             order by c.id limit p_limit) x);
end;
$$;

create function public.backfill_contact_keys(p_tenant_id uuid, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_item    jsonb;
  v_contact uuid;
  v_res     jsonb;
  v_recorded integer := 0;
  v_skipped  integer := 0;
  v_flagged  integer := 0;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.suppression_error('deny');
  end if;
  perform app.require_aal2();
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    perform app.suppression_error('invalid');
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or (v_item ->> 'contact_id') is null or (v_item ->> 'contact_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not app.suppression_keys_ok(coalesce(v_item -> 'keys', 'null'::jsonb), coalesce(v_item -> 'also', '{}'::jsonb)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_contact := (v_item ->> 'contact_id')::uuid;
    if not exists (select 1 from public.contacts c where c.id = v_contact and c.tenant_id = p_tenant_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_res := app.contact_keys_record(v_contact, v_item -> 'keys', coalesce(v_item -> 'also', '{}'::jsonb), v_uid, false);
    if (v_res ->> 'recorded')::boolean then
      v_recorded := v_recorded + 1;
      if (v_res ->> 'flagged')::boolean then
        v_flagged := v_flagged + 1;
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  return jsonb_build_object('recorded', v_recorded, 'skipped', v_skipped, 'flagged', v_flagged,
                            'remaining', (select count(*) from public.contacts c
                                           where c.tenant_id = p_tenant_id and c.erased_at is null
                                             and ((c.email is not null and not exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.email_hmac is not null))
                                               or (c.phone is not null and not exists (select 1 from suppression.contact_keys k where k.tenant_id = c.tenant_id and k.contact_id = c.id and k.phone_hmac is not null)))));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. REPLACED: the latest definitions plus the lines named in the header
-- ---------------------------------------------------------------------------------------------
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
  if c.email is not null and k.email_hmac is not null
     and app.suppression_key_add(r.tenant_id, 'email', k.email_hmac, k.key_version, 'erased', c.id, auth.uid()) then
    v_keys_n := v_keys_n + 1;
  end if;
  if c.phone is not null and k.phone_hmac is not null
     and app.suppression_key_add(r.tenant_id, 'phone', k.phone_hmac, k.key_version, 'erased', c.id, auth.uid()) then
    v_keys_n := v_keys_n + 1;
  end if;
  delete from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
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

create or replace function app.erase_tenant(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  g record;
  v_counts jsonb := '{}'::jsonb;
  n bigint;
  k suppression.contact_keys;
  v_keys_n bigint := 0;
begin
  -- T010 / ADR 0020: the whole workspace is erased, never refused for a missing key: the keys that exist become suppression events FIRST (the registry
  -- loop below nulls every e-mail and phone, and a changed identifier forgets its stored key)
  for k in select * from suppression.contact_keys where tenant_id = r.tenant_id order by id loop
    if k.email_hmac is not null and app.suppression_key_add(r.tenant_id, 'email', k.email_hmac, k.key_version, 'erased', k.contact_id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
    if k.phone_hmac is not null and app.suppression_key_add(r.tenant_id, 'phone', k.phone_hmac, k.key_version, 'erased', k.contact_id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end loop;
  delete from suppression.contact_keys where tenant_id = r.tenant_id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
  v_counts := app.erasure_add(v_counts, 'suppression.contact_keys', n);
  for g in
    select x.table_name, x.column_name from erasure.registry x where x.scope = 'tenant' order by x.table_name, x.column_name
  loop
    v_counts := app.erasure_add(v_counts, g.table_name || '.' || g.column_name,
                                app.erase_column(r.tenant_id, 'tenant', g.table_name, g.column_name, 'true'));
  end loop;
  update public.contacts set erased_at = now(), archived_at = coalesce(archived_at, now())
   where tenant_id = r.tenant_id and erased_at is null;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'contacts.erased', n);
  return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
end;
$$;

create or replace function public.lift_suppression(
  p_tenant_id     uuid,
  p_contact_id    uuid,
  p_evidence_type public.evidence_type,
  p_evidence_ref  text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_contact public.contacts;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_contact_id is null then
    raise exception 'tenant and contact are required' using errcode = '22023';
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'only an owner can lift a suppression' using errcode = '42501';
  end if;
  -- T010 / ADR 0020 (owner decision 4): the Owner, with a second factor
  perform app.require_aal2();
  if p_evidence_type is null or p_evidence_ref is null then
    raise exception 'lifting a suppression requires evidence' using errcode = '22023';
  end if;

  select * into v_contact from public.contacts
   where id = p_contact_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_contact.suppressed_at is null then
    return null;
  end if;

  -- Only the suppression flags change. Consent columns are deliberately untouched: if the
  -- suppression withdrew consent, it stays withdrawn until a fresh record_consent grant.
  update public.contacts set suppressed_at = null, suppression_reason = null
   where id = p_contact_id;

  insert into public.consent_events
    (tenant_id, contact_id, event_type, evidence_type, evidence_ref, recorded_by)
  values
    (p_tenant_id, p_contact_id, 'suppression_lifted', p_evidence_type, p_evidence_ref, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. privileges: the internal functions are nobody's; the public ones are the signed-in people's
-- ---------------------------------------------------------------------------------------------
revoke all on function app.suppression_error(text), app.is_hex64(text), app.key_active(uuid, text, text), app.key_reason(uuid, text, text),
  app.suppression_key_add(uuid, text, text, smallint, text, uuid, uuid), app.suppression_key_lift(uuid, text, text, smallint, uuid, uuid),
  app.suppression_keys_ok(jsonb, jsonb), app.contact_keys_record(uuid, jsonb, jsonb, uuid, boolean),
  app.contacts_forget_changed_keys(), app.contacts_sync_suppression_keys() from public, anon, authenticated;
revoke all on function app.erase_contact(public.erasure_requests), app.erase_tenant(public.erasure_requests) from public;
revoke all on function public.record_contact_keys(uuid, jsonb, jsonb), public.check_suppression(uuid, jsonb), public.unkeyed_contact_count(uuid),
  public.unkeyed_contacts(uuid, integer), public.backfill_contact_keys(uuid, jsonb), public.allow_erasure_without_key(uuid) from public, anon;
grant execute on function public.record_contact_keys(uuid, jsonb, jsonb), public.check_suppression(uuid, jsonb), public.unkeyed_contact_count(uuid),
  public.unkeyed_contacts(uuid, integer), public.backfill_contact_keys(uuid, jsonb), public.allow_erasure_without_key(uuid) to authenticated;
