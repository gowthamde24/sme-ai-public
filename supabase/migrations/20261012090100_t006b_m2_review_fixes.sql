-- T006b / M2 review fixes (ADR 0015). New file: the migrations before it may already be shared, so nothing earlier is edited.
--
--   1. The operator's member functions refuse an account that has not accepted its invitation (email_confirmed_at null), was deleted, or is
--      banned. SM403 with a fixed message that carries no value. Order of the workflow: invite -> the person accepts and sets a password ->
--      only then the operator adds the membership.
--   2. The real-data gate FAILS CLOSED. While a workspace is closed, an e-mail that is not well formed or not clean text, and a phone that
--      is not clean text, are refused with SM401 by the trigger itself (they used to be left to the table CHECKs). An open workspace is
--      unchanged: the CHECKs decide.
--   3. service_role (Supabase's key that bypasses RLS) holds no INSERT / UPDATE / DELETE / TRUNCATE on anything in public. Nothing in this
--      repository uses it. SELECT stays. New tables do not get the grants either (default privileges).
--   5. app.erasure_phone_pattern also accepts the international dialling prefix 00 91 / 0091 (separators allowed) in front of the number.
--
-- SQLSTATE: SM403 the person must accept their invitation first.

-- ---------------------------------------------------------------------------------------------
-- 1. the account the operator may add to a workspace
-- ---------------------------------------------------------------------------------------------
create function app.accepted_account_id(p_email text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  u record;
begin
  select a.id, a.email_confirmed_at, a.deleted_at, a.banned_until into u from auth.users a where lower(a.email) = lower(btrim(p_email));
  if not found then
    raise exception 'no such account: invite the person first' using errcode = '23503';
  end if;
  if u.email_confirmed_at is null then
    raise exception 'the person must accept their invitation first' using errcode = 'SM403';
  end if;
  if u.deleted_at is not null then
    raise exception 'the person must accept their invitation first' using errcode = 'SM403';
  end if;
  if u.banned_until is not null and u.banned_until > now() then
    raise exception 'the person must accept their invitation first' using errcode = 'SM403';
  end if;
  return u.id;
end;
$$;
revoke all on function app.accepted_account_id(text) from public, anon, authenticated, service_role;

create or replace function app.operator_add_member(p_tenant_slug text, p_email text, p_role text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user   uuid;
  v_member uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'sales', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'unknown workspace' using errcode = '23503';
  end if;
  v_user := app.accepted_account_id(p_email);
  if exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_user) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, p_role::public.app_role) returning id into v_member;
  perform app.write_audit_event(v_tenant, 'membership.operator_added', 'membership', v_member, null,
                                jsonb_build_object('role', p_role), jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function app.operator_add_owner_exception(p_tenant_slug text, p_email text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user   uuid;
  v_member uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of at least 20 characters is required' using errcode = '22023';
  end if;
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'unknown workspace' using errcode = '23503';
  end if;
  v_user := app.accepted_account_id(p_email);
  if exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_user) then
    raise exception 'already a member: change the role in the dashboard, not here' using errcode = '23505';
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'owner') returning id into v_member;
  perform app.write_audit_event(v_tenant, 'membership.operator_added_owner', 'membership', v_member, null,
                                jsonb_build_object('role', 'owner'), jsonb_build_object('reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. the gate fails closed
-- ---------------------------------------------------------------------------------------------
create or replace function app.guard_real_data() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_reserved constant text[] := array['example.com', 'example.org', 'example.net', 'test', 'invalid', 'example'];
  v_parts   text[];
  v_domain  text;
  v_email   boolean := new.email is not null and (tg_op = 'INSERT' or new.email is distinct from old.email);
  v_phone   boolean := new.phone is not null and (tg_op = 'INSERT' or new.phone is distinct from old.phone);
begin
  -- Only an identifier that is being WRITTEN is checked. An archive, a rename, a job title, the erasure (identifiers become NULL), or a
  -- fix of the e-mail on a row whose phone is already in, is never blocked: data already in can always be corrected or removed.
  if not (v_email or v_phone) then
    return new;
  end if;
  if app.real_data_gate_open(new.tenant_id) then
    return new;
  end if;
  -- Closed: anything that is not clearly a reserved address or a +00 number is refused HERE, malformed or not. The table's CHECKs are a
  -- second line, never the first.
  if v_email then
    if new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or not app.text_is_clean(new.email) then
      raise exception 'real data is not accepted in this workspace yet' using errcode = 'SM401';
    end if;
    v_parts := string_to_array(new.email, '@');
    v_domain := lower(coalesce(v_parts[2], ''));
    if array_length(v_parts, 1) is distinct from 2
       or v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
       or v_domain ~ '\.\.'
       or not exists (select 1 from unnest(c_reserved) r where v_domain = r or right(v_domain, length(r) + 1) = '.' || r) then
      raise exception 'real data is not accepted in this workspace yet' using errcode = 'SM401';
    end if;
  end if;
  if v_phone and (not app.text_is_clean(new.phone) or left(new.phone, 3) <> '+00') then
    raise exception 'real data is not accepted in this workspace yet' using errcode = 'SM401';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. service_role holds no write privilege in public
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') loop
    execute format('revoke insert, update, delete, truncate on public.%I from service_role', r.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate on tables from service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. the phone pattern: the international dialling prefix (00 91 / 0091) is part of the number
-- ---------------------------------------------------------------------------------------------
create or replace function app.erasure_phone_pattern(p_phone text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(d) < 7 then null
              else '(?<![0-9])(?:(?:(?:00[ ._()-]{0,2}|\+)?91|0)[ ._()-]{0,2})?'
                   || array_to_string(regexp_split_to_array(right(d, 10), ''), '[ ._()-]{0,2}')
                   || '(?![0-9])' end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s
$$;
