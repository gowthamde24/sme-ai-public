-- Sign-up in E-MAIL-ONLY mode (25 Nov 2026): until the WhatsApp phone code is live, the batch can open sign-up with a verified e-mail (and the captcha at Auth) and NO phone proof.
--   * signup.settings.phone_required (default true = unchanged behaviour). Set it to false and an identity WITHOUT a verified phone may claim a SMALLER credit (email_only_paise, default Rs 30): at most 3 claims an hour per
--     address and per e-mail, and its own daily cap (email_only_daily_cap, default 50) next to the general one. A verified phone still gets the full free start.
--   * the claim takes an optional hashed address (the API passes a keyed hash of the caller's IP).
-- Replaces signup_status, signup_trial_claim (new signature; the old one is dropped) and ops_signup_set. Rollback = set phone_required back to true (nothing else changes) or restore the 991500 functions.

alter table signup.settings
  add column phone_required boolean not null default true,
  add column email_only_paise integer not null default 3000 check (email_only_paise between 0 and 100000),
  add column email_only_daily_cap integer not null default 50 check (email_only_daily_cap between 0 and 100000);

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
    'phone_required', s.phone_required,
    'email_confirmed', coalesce(v_me.confirmed, false),
    'email_blocked', exists (select 1 from signup.blocked_email_domains b where b.domain = lower(split_part(coalesce(v_me.email, ''), '@', 2))),
    'consent_done', (select count(*) = 3 from signup.consents c where c.user_id = auth.uid() and ((c.kind = 'terms' and c.version = s.terms_version) or (c.kind = 'privacy' and c.version = s.privacy_version) or (c.kind = 'aup' and c.version = s.aup_version))),
    'phone_verified', exists (select 1 from signup.verified_phones p where p.user_id = auth.uid()),
    'trial_claimed', exists (select 1 from signup.trial_identities t where t.user_id = auth.uid()));
end $$;

create function public.signup_trial_claim(p_tenant_id uuid, p_ip_hash text default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  s signup.settings;
  v_me record;
  v_phone text;
  v_key text;
  v_grant jsonb;
  v_amount bigint;
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
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{16,64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select p.phone_hash into v_phone from signup.verified_phones p where p.user_id = v_me.id;
  if v_phone is null and s.phone_required then
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
  if v_phone is null then   -- E-MAIL ONLY mode (until the phone code is live): a smaller credit, and stricter limits per address and per e-mail
    if (select count(*) from pricing.free_starts f where f.phone_hash is null and f.granted_at >= date_trunc('day', now())) >= s.email_only_daily_cap then
      return jsonb_build_object('granted', false, 'reason', 'daily_cap');
    end if;
    if not signup.hit('clm:' || v_key, 3) or (p_ip_hash is not null and not signup.hit('cip:' || p_ip_hash, 3)) then
      return jsonb_build_object('granted', false, 'reason', 'rate');
    end if;
    if exists (select 1 from pricing.free_starts f where f.tenant_id = p_tenant_id) then
      return jsonb_build_object('granted', false, 'reason', 'already_granted', 'balance_paise', pricing.balance_of(p_tenant_id));
    end if;
    v_amount := s.email_only_paise;
    insert into pricing.free_starts (tenant_id, phone_hash) values (p_tenant_id, null);
    perform pricing.credit(p_tenant_id, 'free_start', 'free_start', v_amount);
    perform app.write_audit_event(p_tenant_id, 'billing.free_start_granted', 'workspace', p_tenant_id, null, jsonb_build_object('paise', v_amount, 'mode', 'email_only'));
    v_grant := jsonb_build_object('granted', true, 'reason', null, 'balance_paise', pricing.balance_of(p_tenant_id));
  else
    v_grant := public.pricing_free_start_grant(p_tenant_id, v_phone);
  end if;
  if (v_grant ->> 'granted')::boolean then
    insert into signup.trial_identities (email_key, user_id, tenant_id) values (v_key, v_me.id, p_tenant_id);
  end if;
  return v_grant;
end $$;

drop function public.signup_trial_claim(uuid);
revoke all on function public.signup_trial_claim(uuid, text) from public, anon;
grant execute on function public.signup_trial_claim(uuid, text) to authenticated;

create function public.ops_signup_set(p_open boolean, p_daily_cap integer default null, p_terms_version text default null, p_privacy_version text default null, p_aup_version text default null, p_phone_required boolean default null, p_email_only_paise integer default null, p_email_only_daily_cap integer default null) returns jsonb
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
    phone_required = coalesce(p_phone_required, phone_required),
    email_only_paise = coalesce(p_email_only_paise, email_only_paise),
    email_only_daily_cap = coalesce(p_email_only_daily_cap, email_only_daily_cap),
    updated_at = now();
  return (select jsonb_build_object('open', open, 'trial_daily_cap', trial_daily_cap, 'terms_version', terms_version, 'privacy_version', privacy_version, 'aup_version', aup_version, 'phone_required', phone_required, 'email_only_paise', email_only_paise, 'email_only_daily_cap', email_only_daily_cap) from signup.settings);
end $$;
revoke all on function public.ops_signup_set(boolean, integer, text, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.ops_signup_set(boolean, integer, text, text, text, boolean, integer, integer) to authenticated;
drop function public.ops_signup_set(boolean, integer, text, text, text);
