-- Opening sign-up (24 Nov 2026; plan: reports/signup-opening-design.md, public-launch plan item 2). Everything here is OFF until the operator opens it: `signup.settings.open = false`.
-- The trial credit (Rs 100 is set by the operator at launch: pricing.settings.free_start_paise) is granted only to ONE verified identity: a confirmed e-mail that is not a throwaway domain and not already used
-- (Gmail dots and +tags ignored), a phone that this person proved with a code, the current terms and privacy versions accepted, and while the day's cap is not used up.
-- Tables live in schema `signup`, no client role has any privilege on them; the public.signup_* functions are the only door. Not tenant data (a person, before any workspace).
-- Every outcome that should keep a count (a wrong code, a rate-limit hit) is RETURNED, never raised, so the count is not rolled back with an error.
-- Rollback = drop schema signup cascade and the public.signup_* / ops_signup_* functions.

create schema signup;
revoke all on schema signup from public, anon, authenticated, service_role;
comment on schema signup is 'Opening sign-up: the kill switch, the trial identity checks and the phone codes. No client role has usage; the functions are public.signup_*.';

create table signup.settings (
  id               boolean primary key default true check (id),
  open             boolean not null default false,
  trial_daily_cap  integer not null default 100 check (trial_daily_cap between 0 and 100000),
  terms_version    text not null default '2026-11' check (terms_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  privacy_version  text not null default '2026-11' check (privacy_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  updated_at       timestamptz not null default now()
);
insert into signup.settings (id) values (true);
comment on table signup.settings is 'SAFE: one row, the kill switch and the limits of the trial credit. Changed only by public.ops_signup_set.';
alter table signup.settings enable row level security;
alter table signup.settings force row level security;
revoke all on signup.settings from public, anon, authenticated, service_role;

create table signup.blocked_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9][a-z0-9.-]{1,60}[a-z0-9]$')
);
comment on table signup.blocked_email_domains is 'SAFE: throwaway e-mail domains that cannot claim the trial credit (data; the operator may add or remove).';
alter table signup.blocked_email_domains enable row level security;
alter table signup.blocked_email_domains force row level security;
revoke all on signup.blocked_email_domains from public, anon, authenticated, service_role;
insert into signup.blocked_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamailblock.com'), ('sharklasers.com'), ('grr.la'), ('10minutemail.com'), ('10minutemail.net'),
  ('temp-mail.org'), ('tempmail.com'), ('tempmail.net'), ('temp-mail.io'), ('tempmailo.com'), ('tempail.com'), ('throwawaymail.com'), ('yopmail.com'), ('yopmail.net'), ('yopmail.fr'),
  ('trashmail.com'), ('trashmail.net'), ('trashmail.de'), ('dispostable.com'), ('getnada.com'), ('nada.email'), ('maildrop.cc'), ('mailnesia.com'), ('mintemail.com'), ('mohmal.com'),
  ('emailondeck.com'), ('fakeinbox.com'), ('fakemail.net'), ('spamgourmet.com'), ('spambox.us'), ('mytemp.email'), ('tmail.ws'), ('tmpmail.org'), ('tmpmail.net'), ('burnermail.io'),
  ('discard.email'), ('discardmail.com'), ('mailcatch.com'), ('mail-temporaire.fr'), ('jetable.org'), ('33mail.com'), ('anonbox.net'), ('getairmail.com'), ('inboxkitten.com'),
  ('moakt.com'), ('mailsac.com'), ('emailfake.com'), ('crazymailing.com'), ('luxusmail.org'), ('tempinbox.com'), ('owlymail.com'), ('mailforspam.com'), ('byom.de'), ('fexpost.com'),
  ('harakirimail.com'), ('spam4.me'), ('dropmail.me'), ('1secmail.com'), ('1secmail.net'), ('1secmail.org');

create table signup.phone_challenges (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  phone_hash   text not null check (phone_hash ~ '^[0-9a-f]{64}$'),
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts     integer not null default 0 check (attempts between 0 and 20),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
comment on column signup.phone_challenges.phone_hash is 'PII: the keyed hash of the phone number (never the number). CLEAN-EXEMPT: strict anchored hex pattern';
comment on column signup.phone_challenges.code_hash is 'SAFE: the keyed hash of the 6-digit code (never the code). CLEAN-EXEMPT: strict anchored hex pattern';
alter table signup.phone_challenges enable row level security;
alter table signup.phone_challenges force row level security;
revoke all on signup.phone_challenges from public, anon, authenticated, service_role;

create table signup.verified_phones (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  phone_hash   text not null unique check (phone_hash ~ '^[0-9a-f]{64}$'),
  verified_at  timestamptz not null default now()
);
comment on column signup.verified_phones.phone_hash is 'PII: the keyed hash of the verified phone number (never the number): one phone belongs to one person. CLEAN-EXEMPT: strict anchored hex pattern';
alter table signup.verified_phones enable row level security;
alter table signup.verified_phones force row level security;
revoke all on signup.verified_phones from public, anon, authenticated, service_role;

create table signup.consents (
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('terms', 'privacy')),
  version      text not null check (version ~ '^[A-Za-z0-9._-]{1,20}$'),
  accepted_at  timestamptz not null default now(),
  primary key (user_id, kind, version)
);
comment on table signup.consents is 'SAFE: which version of the terms and the privacy notice a person accepted, and when. No address or device is stored.';
alter table signup.consents enable row level security;
alter table signup.consents force row level security;
revoke all on signup.consents from public, anon, authenticated, service_role;

create table signup.trial_identities (
  email_key    text primary key check (email_key ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references auth.users (id) on delete cascade,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  claimed_at   timestamptz not null default now()
);
create index trial_identities_tenant_idx on signup.trial_identities (tenant_id);
create index trial_identities_user_idx on signup.trial_identities (user_id);
comment on column signup.trial_identities.email_key is 'PII: sha-256 of the NORMALISED e-mail (lower case, no +tag, no Gmail dots), never the address: one identity claims the trial once. CLEAN-EXEMPT: strict anchored hex pattern';
alter table signup.trial_identities enable row level security;
alter table signup.trial_identities force row level security;
revoke all on signup.trial_identities from public, anon, authenticated, service_role;

create table signup.hits (
  key_hash text not null check (key_hash ~ '^[a-z]{2,6}:[0-9a-f]{16,64}$'),
  bucket   timestamptz not null,
  n        integer not null default 0,
  primary key (key_hash, bucket)
);
comment on column signup.hits.key_hash is 'PII: a kind and a keyed hash of an address, e-mail or phone, for hourly limits that hold across API instances. CLEAN-EXEMPT: strict anchored pattern';
alter table signup.hits enable row level security;
alter table signup.hits force row level security;
revoke all on signup.hits from public, anon, authenticated, service_role;

-- 1. helpers (not callable by clients)
create function signup.email_key(p_email text) returns text language sql immutable set search_path = '' as
$$
  select encode(sha256(convert_to(
    case when d in ('gmail.com', 'googlemail.com') then replace(split_part(l, '+', 1), '.', '') || '@gmail.com' else split_part(l, '+', 1) || '@' || d end, 'UTF8')), 'hex')
    from (select split_part(lower(btrim(coalesce(p_email, ''))), '@', 1) as l, split_part(lower(btrim(coalesce(p_email, ''))), '@', 2) as d) x
$$;
revoke all on function signup.email_key(text) from public, anon, authenticated, service_role;

-- true when the key is still under its limit this hour (and counts this try); false = refused. The count is kept because the caller RETURNS instead of raising.
create function signup.hit(p_key text, p_limit integer) returns boolean language plpgsql set search_path = '' as
$$
declare
  v_bucket timestamptz := date_trunc('hour', now());
  v_n integer;
begin
  insert into signup.hits (key_hash, bucket, n) values (p_key, v_bucket, 1)
  on conflict (key_hash, bucket) do update set n = signup.hits.n + 1 returning n into v_n;
  delete from signup.hits where bucket < v_bucket - interval '2 days';
  return v_n <= p_limit;
end $$;
revoke all on function signup.hit(text, integer) from public, anon, authenticated, service_role;

create function signup.me() returns table (id uuid, email text, confirmed boolean) language plpgsql set search_path = '' as
$$
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select u.id, u.email::text, u.email_confirmed_at is not null from auth.users u where u.id = auth.uid();
end $$;
revoke all on function signup.me() from public, anon, authenticated, service_role;

-- 2. what the sign-up screen needs
create function public.signup_status() returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  s signup.settings;
  v_me record;
begin
  select * into v_me from signup.me();
  select * into s from signup.settings;
  return jsonb_build_object(
    'open', s.open,
    'terms_version', s.terms_version,
    'privacy_version', s.privacy_version,
    'email_confirmed', coalesce(v_me.confirmed, false),
    'email_blocked', exists (select 1 from signup.blocked_email_domains b where b.domain = lower(split_part(coalesce(v_me.email, ''), '@', 2))),
    'consent_done', (select count(*) = 2 from signup.consents c where c.user_id = auth.uid() and ((c.kind = 'terms' and c.version = s.terms_version) or (c.kind = 'privacy' and c.version = s.privacy_version))),
    'phone_verified', exists (select 1 from signup.verified_phones p where p.user_id = auth.uid()),
    'trial_claimed', exists (select 1 from signup.trial_identities t where t.user_id = auth.uid()));
end $$;
revoke all on function public.signup_status() from public, anon;
grant execute on function public.signup_status() to authenticated;

-- 3. consent with its version (the version must be the current one: an old tick does not count)
create function public.signup_consent_record(p_kind text, p_version text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  s signup.settings;
  v_me record;
  v_current text;
begin
  select * into v_me from signup.me();
  select * into s from signup.settings;
  if p_kind is null or p_kind not in ('terms', 'privacy') or p_version is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_current := (select case p_kind when 'terms' then s.terms_version else s.privacy_version end);
  if p_version <> v_current then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into signup.consents (user_id, kind, version) values (v_me.id, p_kind, p_version) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.signup_consent_record(text, text) from public, anon;
grant execute on function public.signup_consent_record(text, text) to authenticated;

-- 4. the phone code: start (the API makes the code, sends it, and passes only the keyed hashes) and verify
create function public.signup_phone_start(p_phone_hash text, p_code_hash text, p_ip_hash text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  s signup.settings;
  v_me record;
  v_email_key text;
begin
  select * into v_me from signup.me();
  select * into s from signup.settings;
  if p_phone_hash !~ '^[0-9a-f]{64}$' or p_code_hash !~ '^[0-9a-f]{64}$' or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{16,64}$') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not s.open then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if not v_me.confirmed then
    return jsonb_build_object('ok', false, 'reason', 'email_unconfirmed');
  end if;
  if exists (select 1 from signup.blocked_email_domains b where b.domain = lower(split_part(coalesce(v_me.email, ''), '@', 2))) then
    return jsonb_build_object('ok', false, 'reason', 'email_blocked');
  end if;
  v_email_key := signup.email_key(v_me.email);
  if not signup.hit('user:' || replace(v_me.id::text, '-', ''), 5)
     or not signup.hit('mail:' || v_email_key, 5)
     or not signup.hit('ph:' || p_phone_hash, 3)
     or (p_ip_hash is not null and not signup.hit('ip:' || p_ip_hash, 20)) then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  if exists (select 1 from signup.verified_phones p where p.phone_hash = p_phone_hash and p.user_id <> v_me.id) then
    return jsonb_build_object('ok', false, 'reason', 'phone_taken');
  end if;
  insert into signup.phone_challenges (user_id, phone_hash, code_hash, attempts, created_at, expires_at)
  values (v_me.id, p_phone_hash, p_code_hash, 0, now(), now() + interval '10 minutes')
  on conflict (user_id) do update set phone_hash = excluded.phone_hash, code_hash = excluded.code_hash, attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'expires_in_s', 600);
end $$;
revoke all on function public.signup_phone_start(text, text, text) from public, anon;
grant execute on function public.signup_phone_start(text, text, text) to authenticated;

create function public.signup_phone_verify(p_code_hash text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_me record;
  c signup.phone_challenges;
begin
  select * into v_me from signup.me();
  if p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into c from signup.phone_challenges x where x.user_id = v_me.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;
  if c.expires_at < now() then
    delete from signup.phone_challenges where user_id = v_me.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_tries');
  end if;
  if c.code_hash <> p_code_hash then
    update signup.phone_challenges set attempts = attempts + 1 where user_id = v_me.id;
    return jsonb_build_object('ok', false, 'reason', 'wrong_code', 'tries_left', greatest(4 - c.attempts, 0));
  end if;
  if exists (select 1 from signup.verified_phones p where p.phone_hash = c.phone_hash and p.user_id <> v_me.id) then
    delete from signup.phone_challenges where user_id = v_me.id;
    return jsonb_build_object('ok', false, 'reason', 'phone_taken');
  end if;
  insert into signup.verified_phones (user_id, phone_hash) values (v_me.id, c.phone_hash)
  on conflict (user_id) do update set phone_hash = excluded.phone_hash, verified_at = now();
  delete from signup.phone_challenges where user_id = v_me.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.signup_phone_verify(text) from public, anon;
grant execute on function public.signup_phone_verify(text) to authenticated;

-- 5. the trial credit: every check, then the existing free-start grant (once per workspace and once per phone)
create function public.signup_trial_claim(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  s signup.settings;
  v_me record;
  v_phone text;
  v_key text;
  v_grant jsonb;
begin
  select * into v_me from signup.me();
  select * into s from signup.settings;
  if p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not s.open then
    return jsonb_build_object('granted', false, 'reason', 'closed');
  end if;
  if not v_me.confirmed then
    return jsonb_build_object('granted', false, 'reason', 'email_unconfirmed');
  end if;
  if exists (select 1 from signup.blocked_email_domains b where b.domain = lower(split_part(coalesce(v_me.email, ''), '@', 2))) then
    return jsonb_build_object('granted', false, 'reason', 'email_blocked');
  end if;
  select p.phone_hash into v_phone from signup.verified_phones p where p.user_id = v_me.id;
  if v_phone is null then
    return jsonb_build_object('granted', false, 'reason', 'phone_not_verified');
  end if;
  if (select count(*) from signup.consents c where c.user_id = v_me.id and ((c.kind = 'terms' and c.version = s.terms_version) or (c.kind = 'privacy' and c.version = s.privacy_version))) <> 2 then
    return jsonb_build_object('granted', false, 'reason', 'consent_missing');
  end if;
  v_key := signup.email_key(v_me.email);
  if exists (select 1 from signup.trial_identities t where t.email_key = v_key) then
    return jsonb_build_object('granted', false, 'reason', 'email_used');
  end if;
  if (select count(*) from pricing.free_starts f where f.granted_at >= date_trunc('day', now())) >= s.trial_daily_cap then
    return jsonb_build_object('granted', false, 'reason', 'daily_cap');
  end if;
  v_grant := public.pricing_free_start_grant(p_tenant_id, v_phone);
  if (v_grant ->> 'granted')::boolean then
    insert into signup.trial_identities (email_key, user_id, tenant_id) values (v_key, v_me.id, p_tenant_id);
  end if;
  return v_grant;
end $$;
revoke all on function public.signup_trial_claim(uuid) from public, anon;
grant execute on function public.signup_trial_claim(uuid) to authenticated;

-- 6. the operator's switch (system accounts only): open or close at once, the day's cap, the versions of the texts people accept
create function public.ops_signup_set(p_open boolean, p_daily_cap integer default null, p_terms_version text default null, p_privacy_version text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  update signup.settings set
    open = coalesce(p_open, open),
    trial_daily_cap = coalesce(p_daily_cap, trial_daily_cap),
    terms_version = coalesce(p_terms_version, terms_version),
    privacy_version = coalesce(p_privacy_version, privacy_version),
    updated_at = now();
  return (select jsonb_build_object('open', open, 'trial_daily_cap', trial_daily_cap, 'terms_version', terms_version, 'privacy_version', privacy_version) from signup.settings);
end $$;
revoke all on function public.ops_signup_set(boolean, integer, text, text) from public, anon;
grant execute on function public.ops_signup_set(boolean, integer, text, text) to authenticated;
