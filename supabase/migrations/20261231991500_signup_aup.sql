-- Sign-up consents grow by one: the Acceptable Use Policy (24 Nov 2026; the Outpero-style purchase flow: the person accepts the terms, the privacy notice AND the acceptable-use policy, each with its version).
-- The trial credit now needs all three. Replaces three functions of 20261231990700 and adds the policy's version to the settings. Rollback = restore those three functions and drop the column.

alter table signup.settings add column aup_version text not null default '2026-11' check (aup_version ~ '^[A-Za-z0-9._-]{1,20}$');
alter table signup.consents drop constraint if exists consents_kind_check;
alter table signup.consents add constraint consents_kind_check check (kind in ('terms', 'privacy', 'aup'));

create or replace function public.signup_status() returns jsonb language plpgsql stable security definer set search_path = '' as
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
    'aup_version', s.aup_version,
    'email_confirmed', coalesce(v_me.confirmed, false),
    'email_blocked', exists (select 1 from signup.blocked_email_domains b where b.domain = lower(split_part(coalesce(v_me.email, ''), '@', 2))),
    'consent_done', (select count(*) = 3 from signup.consents c where c.user_id = auth.uid() and ((c.kind = 'terms' and c.version = s.terms_version) or (c.kind = 'privacy' and c.version = s.privacy_version) or (c.kind = 'aup' and c.version = s.aup_version))),
    'phone_verified', exists (select 1 from signup.verified_phones p where p.user_id = auth.uid()),
    'trial_claimed', exists (select 1 from signup.trial_identities t where t.user_id = auth.uid()));
end $$;

create or replace function public.signup_consent_record(p_kind text, p_version text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  s signup.settings;
  v_me record;
  v_current text;
begin
  select * into v_me from signup.me();
  select * into s from signup.settings;
  if p_kind is null or p_kind not in ('terms', 'privacy', 'aup') or p_version is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_current := (select case p_kind when 'terms' then s.terms_version when 'privacy' then s.privacy_version else s.aup_version end);
  if p_version <> v_current then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into signup.consents (user_id, kind, version) values (v_me.id, p_kind, p_version) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.signup_trial_claim(p_tenant_id uuid) returns jsonb language plpgsql security definer set search_path = '' as
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
  if (select count(*) from signup.consents c where c.user_id = v_me.id and ((c.kind = 'terms' and c.version = s.terms_version) or (c.kind = 'privacy' and c.version = s.privacy_version) or (c.kind = 'aup' and c.version = s.aup_version))) <> 3 then
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

create or replace function public.ops_signup_set(p_open boolean, p_daily_cap integer default null, p_terms_version text default null, p_privacy_version text default null, p_aup_version text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  update signup.settings set
    open = coalesce(p_open, open),
    trial_daily_cap = coalesce(p_daily_cap, trial_daily_cap),
    terms_version = coalesce(p_terms_version, terms_version),
    privacy_version = coalesce(p_privacy_version, privacy_version),
    aup_version = coalesce(p_aup_version, aup_version),
    updated_at = now();
  return (select jsonb_build_object('open', open, 'trial_daily_cap', trial_daily_cap, 'terms_version', terms_version, 'privacy_version', privacy_version, 'aup_version', aup_version) from signup.settings);
end $$;
revoke all on function public.ops_signup_set(boolean, integer, text, text, text) from public, anon;
grant execute on function public.ops_signup_set(boolean, integer, text, text, text) to authenticated;
drop function public.ops_signup_set(boolean, integer, text, text);
