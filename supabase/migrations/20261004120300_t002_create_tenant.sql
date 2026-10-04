-- T002 / 4 of 4: public.create_tenant(name, slug), the only way a client creates a tenant.
--
-- SECURITY DEFINER because the caller has no INSERT privilege on tenants and cannot make the first
-- membership under the memberships policy (they are not a member yet). Exposed through the API
-- schema, so it validates everything itself and derives the subject from auth.uid(); there is no
-- user parameter, so nobody can create a tenant "on behalf of" someone else.
--
-- Idempotent: a retry by the tenant's Owner (same slug) returns the existing tenant unchanged, with
-- no duplicate tenant, membership or audit event. Any other caller gets 23505 and no side effects.

create function public.create_tenant(p_name text, p_slug text) returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := btrim(p_name);
  v_slug   text := btrim(p_slug);
  v_tenant public.tenants;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 120 then
    raise exception 'name must be 1-120 characters' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'slug must be 3-40 characters: lowercase letters, digits and hyphens'
      using errcode = '22023';
  end if;

  select * into v_tenant from public.tenants where slug = v_slug;

  if not found then
    begin
      insert into public.tenants (name, slug) values (v_name, v_slug) returning * into v_tenant;
      insert into public.memberships (tenant_id, user_id, role) values (v_tenant.id, v_uid, 'owner');
      return v_tenant;
    exception when unique_violation then
      -- Lost a race with a concurrent create of the same slug (the block's writes are rolled
      -- back): fall through to the ownership check below.
      select * into v_tenant from public.tenants where slug = v_slug;
    end;
  end if;

  -- Slug already exists: only that tenant's Owner may "retry" into it.
  if exists (
    select 1 from public.memberships
    where tenant_id = v_tenant.id and user_id = v_uid and role = 'owner'
  ) then
    return v_tenant;
  end if;

  raise exception 'slug unavailable' using errcode = '23505';
end;
$$;

revoke all on function public.create_tenant(text, text) from public, anon;
grant execute on function public.create_tenant(text, text) to authenticated;
