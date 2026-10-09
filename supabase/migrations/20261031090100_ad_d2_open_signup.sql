-- Job AD / D2: open sign-up. A person signs up with an e-mail and a password (Supabase Auth, e-mail confirmation on), and on their first
-- CONFIRMED login a setup step makes exactly one business for them, with them as its Owner.
--
--   public.terms_acceptances   when (database time) and which version of the terms an account accepted at sign-up. Written by a trigger
--                              on auth.users from the sign-up's metadata; a client can read its own row and write nothing.
--   public.account_setups      one row per account that has done the setup: the business it made, the business type and the language.
--                              The primary key on user_id is the "one business per new account" guard against a double click or a second tab.
--   public.get_account_setup() what this account still has to do: none | needed | done.
--   public.complete_setup(business_type, language)
--                              makes the business (name from the sign-up) and the Owner membership, once. A repeat returns the same business.
--
-- Nothing here is open to anon. Tables are user-owned, not tenant-owned (no tenant_id column), with row-level security forced.
-- The workspace limit of D1 still applies underneath: an account that already owns a workspace cannot also be set up.
--
-- SQLSTATEs: SM307 (D1) workspace limit; SM308 the terms were not accepted at sign-up; SM309 the e-mail address is not confirmed.

create table public.terms_acceptances (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  terms_version text        not null check (terms_version ~ '^[a-z0-9][a-z0-9.-]{0,29}$'),
  accepted_at   timestamptz not null default now()
);
alter table public.terms_acceptances enable row level security;
alter table public.terms_acceptances force row level security;
grant select on public.terms_acceptances to authenticated;
create policy terms_acceptances_select on public.terms_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

create table public.account_setups (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  created_tenant_id uuid        not null references public.tenants (id) on delete restrict,
  business_type     text        not null check (business_type in ('textiles', 'construction', 'other')),
  language          text        not null check (language in ('en', 'te', 'hi', 'kn')),
  created_at        timestamptz not null default now(),
  unique (created_tenant_id)
);
alter table public.account_setups enable row level security;
alter table public.account_setups force row level security;
grant select on public.account_setups to authenticated;
create policy account_setups_select on public.account_setups
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Terms: recorded when the account is made, from the sign-up's own metadata. The time is the database's, never the browser's. A sign-up
-- without the metadata (an invited person, a test account) records nothing and is not blocked. A malformed version records nothing.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.record_terms_acceptance() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := btrim(coalesce(new.raw_user_meta_data ->> 'terms_version', ''));
begin
  if v_version ~ '^[a-z0-9][a-z0-9.-]{0,29}$' then
    insert into public.terms_acceptances (user_id, terms_version) values (new.id, v_version) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function app.record_terms_acceptance() from public;

create trigger on_auth_user_created_terms
  after insert on auth.users
  for each row execute function app.record_terms_acceptance();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- What does this account still have to do?
--   done    : the setup was done; tenant_id says which business.
--   needed  : the account accepted the terms at sign-up and has not done the setup; business_name is what they typed at sign-up.
--   none    : nothing to do here (an invited person, or an account that signed up another way).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.get_account_setup() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_setup public.account_setups;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_setup from public.account_setups where user_id = v_uid;
  if found then
    return jsonb_build_object('state', 'done', 'tenant_id', v_setup.created_tenant_id, 'business_name', null);
  end if;
  if not exists (select 1 from public.terms_acceptances where user_id = v_uid) then
    return jsonb_build_object('state', 'none', 'tenant_id', null, 'business_name', null);
  end if;
  select nullif(btrim(u.raw_user_meta_data ->> 'business_name'), '') into v_name from auth.users u where u.id = v_uid;
  return jsonb_build_object('state', 'needed', 'tenant_id', null, 'business_name', v_name);
end;
$$;
revoke all on function public.get_account_setup() from public, anon;
grant execute on function public.get_account_setup() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The setup. Idempotent and safe against a double click or a second tab: the work is serialised per account, and a repeat returns the
-- business that was made (the first call's business type and language stand; a later call cannot change them).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.complete_setup(p_business_type text, p_language text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_user      auth.users;
  v_setup     public.account_setups;
  v_name      text;
  v_base      text;
  v_slug      text;
  v_tenant    public.tenants;
  v_attempts  integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_business_type is null or p_business_type not in ('textiles', 'construction', 'other') then
    raise exception 'business type must be textiles, construction or other' using errcode = '22023';
  end if;
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn') then
    raise exception 'language must be en, te, hi or kn' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complete_setup:' || v_uid::text, 0));

  -- a repeat (double click, second tab, a retry) returns the same business and changes nothing
  select * into v_setup from public.account_setups where user_id = v_uid;
  if found then
    return jsonb_build_object('tenant_id', v_setup.created_tenant_id, 'created', false);
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found or v_user.deleted_at is not null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'confirm your e-mail address first' using errcode = 'SM309';
  end if;
  if not exists (select 1 from public.terms_acceptances where user_id = v_uid) then
    raise exception 'the terms were not accepted at sign-up' using errcode = 'SM308';
  end if;

  v_name := btrim(coalesce(v_user.raw_user_meta_data ->> 'business_name', ''));
  if char_length(v_name) not between 1 and 120 then
    raise exception 'the business name from sign-up is missing or too long' using errcode = '22023';
  end if;

  -- a readable web address from the name, plus a random tail so two businesses with the same name never collide
  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 28));
  if char_length(v_base) < 2 then
    v_base := 'business';
  end if;
  loop
    v_attempts := v_attempts + 1;
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text || v_uid::text), 1, 8);
    begin
      insert into public.tenants (name, slug) values (v_name, v_slug) returning * into v_tenant;
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then
        raise;
      end if;
    end;
  end loop;

  -- the workspace limit (SM307) is checked by the trigger on this insert; a refusal rolls the whole call back
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant.id, v_uid, 'owner');
  insert into public.account_setups (user_id, created_tenant_id, business_type, language)
  values (v_uid, v_tenant.id, p_business_type, p_language);

  return jsonb_build_object('tenant_id', v_tenant.id, 'created', true);
end;
$$;
revoke all on function public.complete_setup(text, text) from public, anon;
grant execute on function public.complete_setup(text, text) to authenticated;
