-- Job DQ part 4: DPDP from day one (the Digital Personal Data Protection Act, 2023). What this migration adds, on top of the privacy-rights work of job BN (exports, deletion, retention, grievances of a workspace):
--
--   1. privacy.consent_events           WHO consented to WHAT, WHEN, under WHICH notice version and HOW. Two purposes: `service` (needed for the account; recorded at sign-up; it cannot be withdrawn without ending the account) and
--                                        `marketing` (separate, OFF by default, given and withdrawn with the same one call). An append-only ledger: the state is the latest row.
--   2. public.consents_mine / consent_set_marketing / profile_get / profile_set        the person's own side (correct my profile, see and change my consent)
--   3. public.policy_accept             a full copy of job BI's function that also records the `service` consent (via signup | google | prompt)
--   4. privacy.public_grievances        a grievance from ANYONE (not a customer of ours, no sign-in): stored, a reference given back, answer due in 30 days. public.public_grievance_submit
--   5. privacy.waitlist_entries         the public site's "join the waitlist / book a demo", stored WITH its consent record. public.waitlist_join
--   6. app.deletion_cooling_off         7 days (was 14): the cancel window of "delete my account" and of a workspace deletion
--   7. privacy.lapse_erasures           a lapsed workspace: 90 days read-only (job DI), a warning e-mail 48 hours before, then the erasure (the existing tenant erasure, app.erase_tenant). Behind its OWN platform switch
--                                        (`lapse_erasure`, OFF) so that switching billing on never erases anything the first minute. public.scheduler_lapse_*
--   8. public.privacy_worker_purge_logs   audit/security rows older than 395 days (one year plus a month's grace), resolved public grievances a year after they closed, waitlist rows after 12 months
--   9. the e-mail side of 4 and 5 is the worker's (public.scheduler_public_intake_*): the API stores, the worker sends through the Resend sender, a failed send is tried again
--
-- The two public doors (4 and 5) are callable with the public (anon) key because the public site has no account; so the DATABASE holds the caps (per contact per day and a global per hour), not only the API. Both validate every
-- field and write nothing outside their own table. No tenant data is readable through them.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. the cancel window
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.deletion_cooling_off() returns interval language sql immutable set search_path = '' as $$ select interval '7 days' $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. consent
-- ---------------------------------------------------------------------------------------------------------------------------------
create table privacy.consent_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  purpose        text not null check (purpose in ('service', 'marketing')),
  action         text not null check (action in ('given', 'withdrawn')),
  notice_version text not null check (notice_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  via            text not null check (via in ('signup', 'google', 'settings', 'prompt')),
  created_at     timestamptz not null default app.outbox_now(),
  check (purpose <> 'service' or action = 'given')   -- the service consent is the account itself; it ends only with the account
);
create index consent_events_user_idx on privacy.consent_events (user_id, purpose, id desc);
alter table privacy.consent_events enable row level security;
alter table privacy.consent_events force row level security;
revoke all on privacy.consent_events from public, anon, authenticated, service_role;
comment on table privacy.consent_events is 'Job DQ (DPDP): the ledger of consent. Written only by the consent functions for the caller themself; read only through public.consents_mine. Goes with the account (on delete cascade).';
comment on column privacy.consent_events.purpose is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column privacy.consent_events.action is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column privacy.consent_events.notice_version is 'SAFE: a version label. CLEAN-EXEMPT: pattern CHECK';
comment on column privacy.consent_events.via is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- accounts that exist today: the service consent they gave when they accepted the notice (or, if the record is older than the ledger, when the account was made)
insert into privacy.consent_events (user_id, purpose, action, notice_version, via, created_at)
select u.id, 'service', 'given',
       coalesce((select a.version from integrations.policy_acceptances a where a.user_id = u.id and a.kind = 'privacy' order by a.accepted_at limit 1), 'pre-ledger'),
       case when coalesce(u.raw_app_meta_data ->> 'provider', '') = 'google' then 'google' else 'signup' end,
       coalesce((select min(a.accepted_at) from integrations.policy_acceptances a where a.user_id = u.id), u.created_at)
  from auth.users u;

create function app.consents_json(p_user uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  s privacy.consent_events;
  m privacy.consent_events;
  v_since timestamptz;
begin
  select * into s from privacy.consent_events e where e.user_id = p_user and e.purpose = 'service' order by e.id desc limit 1;
  select min(e.created_at) into v_since from privacy.consent_events e where e.user_id = p_user and e.purpose = 'service';
  select * into m from privacy.consent_events e where e.user_id = p_user and e.purpose = 'marketing' order by e.id desc limit 1;
  return jsonb_build_object(
    'consents', jsonb_build_array(
      jsonb_build_object('purpose', 'service', 'state', 'given', 'since', coalesce(v_since, (select u.created_at from auth.users u where u.id = p_user)),
                         'notice_version', s.notice_version, 'via', coalesce(s.via, 'signup')),
      jsonb_build_object('purpose', 'marketing', 'state', case when m.id is null then 'not_given' when m.action = 'given' then 'given' else 'withdrawn' end,
                         'since', m.created_at, 'notice_version', m.notice_version, 'via', m.via)),
    'history', coalesce((select jsonb_agg(jsonb_build_object('purpose', h.purpose, 'action', h.action, 'at', h.created_at, 'notice_version', h.notice_version, 'via', h.via) order by h.id desc)
                           from (select * from privacy.consent_events e where e.user_id = p_user order by e.id desc limit 50) h), '[]'::jsonb));
end;
$$;
revoke all on function app.consents_json(uuid) from public, anon, authenticated, service_role;

create function public.consents_mine() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  return app.consents_json(auth.uid());
end;
$$;
revoke all on function public.consents_mine() from public, anon;
grant execute on function public.consents_mine() to authenticated;

-- give and withdraw are the same one call; saying the state it already is changes nothing (no new row)
create function public.consent_set_marketing(p_given boolean, p_via text, p_notice_version text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_last privacy.consent_events;
begin
  if v_uid is null then
    perform app.privacy_error('deny');
  end if;
  if p_given is null or p_via is null or p_via not in ('signup', 'google', 'settings') or p_notice_version is null or p_notice_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$' then
    perform app.privacy_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('consent:' || v_uid::text, 0));
  select * into v_last from privacy.consent_events e where e.user_id = v_uid and e.purpose = 'marketing' order by e.id desc limit 1;
  if (v_last.id is not null and (v_last.action = 'given') = p_given) or (v_last.id is null and not p_given) then
    return app.consents_json(v_uid);   -- already so
  end if;
  insert into privacy.consent_events (user_id, purpose, action, notice_version, via)
  values (v_uid, 'marketing', case when p_given then 'given' else 'withdrawn' end, p_notice_version, p_via);
  perform app.write_audit_event(m.tenant_id, 'consent.changed', 'user', v_uid, null, jsonb_build_object('purpose', 'marketing', 'action', case when p_given then 'given' else 'withdrawn' end))
     from public.memberships m where m.user_id = v_uid;
  return app.consents_json(v_uid);
end;
$$;
revoke all on function public.consent_set_marketing(boolean, text, text) from public, anon;
grant execute on function public.consent_set_marketing(boolean, text, text) to authenticated;

-- a full copy of job BI's function (policy_accept) with ONE addition: the `service` consent row (via google when the account came from Google, signup at sign-up, prompt when a new version is accepted later)
create or replace function public.policy_accept(p_terms_version text, p_privacy_version text, p_via text default 'prompt') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform app.integration_error('deny');
  end if;
  if (p_terms_version is null and p_privacy_version is null) or p_via is null or p_via not in ('signup', 'setup', 'prompt')
     or (p_terms_version is not null and p_terms_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$')
     or (p_privacy_version is not null and p_privacy_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$') then
    perform app.integration_error('invalid');
  end if;
  if p_terms_version is not null then
    insert into integrations.policy_acceptances (user_id, kind, version, via) values (v_uid, 'terms', p_terms_version, p_via) on conflict do nothing;
  end if;
  if p_privacy_version is not null then
    insert into integrations.policy_acceptances (user_id, kind, version, via) values (v_uid, 'privacy', p_privacy_version, p_via) on conflict do nothing;
    insert into privacy.consent_events (user_id, purpose, action, notice_version, via)
    select v_uid, 'service', 'given', p_privacy_version,
           case when p_via = 'prompt' then 'prompt'
                when coalesce((select u.raw_app_meta_data ->> 'provider' from auth.users u where u.id = v_uid), '') = 'google' then 'google'
                else 'signup' end
     where not exists (select 1 from privacy.consent_events e where e.user_id = v_uid and e.purpose = 'service' and e.notice_version = p_privacy_version);
  end if;
  return public.policy_acceptances_mine();
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the person's profile (correct my data)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.profile_get() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.privacy_error('deny');
  end if;
  return (select jsonb_build_object('display_name', p.display_name, 'email', a.email, 'created_at', a.created_at)
            from auth.users a left join public.users p on p.id = a.id where a.id = auth.uid());
end;
$$;
revoke all on function public.profile_get() from public, anon;
grant execute on function public.profile_get() to authenticated;

create function public.profile_set(p_display_name text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then
    perform app.privacy_error('deny');
  end if;
  if char_length(v_name) not between 1 and 100 or not app.text_is_clean(v_name) or v_name !~ '^[^<>{}\\|]+$' then
    perform app.privacy_error('invalid');
  end if;
  update public.users set display_name = v_name where id = v_uid;
  -- logged for every workspace the person belongs to: that a correction was made and which field, never the value
  perform app.write_audit_event(m.tenant_id, 'profile.corrected', 'user', v_uid, null, jsonb_build_object('field', 'display_name'))
     from public.memberships m where m.user_id = v_uid;
  return public.profile_get();
end;
$$;
revoke all on function public.profile_set(text) from public, anon;
grant execute on function public.profile_set(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. a grievance from anyone
-- ---------------------------------------------------------------------------------------------------------------------------------
create sequence privacy.public_grievance_seq;
revoke all on sequence privacy.public_grievance_seq from public, anon, authenticated, service_role;

create table privacy.public_grievances (
  id              uuid primary key,
  reference       text not null unique,
  name            text not null check (char_length(name) between 1 and 120),
  contact         text not null check (char_length(contact) between 3 and 200),
  kind            text not null check (kind in ('access', 'correction', 'erasure', 'withdraw_consent', 'complaint', 'other')),
  details         text not null default '' check (char_length(details) <= 4000),
  language        text check (language in ('en', 'te', 'hi', 'kn')),
  status          text not null default 'received' check (status in ('received', 'acknowledged', 'in_progress', 'resolved', 'rejected')),
  received_at     timestamptz not null default app.outbox_now(),
  due_at          timestamptz not null,
  inbox_sent_at   timestamptz,
  ack_sent_at     timestamptz,
  closed_at       timestamptz,
  resolution_note text check (char_length(resolution_note) <= 2000),
  check (due_at > received_at),
  check ((status in ('resolved', 'rejected')) = (closed_at is not null))
);
create index public_grievances_received_idx on privacy.public_grievances (received_at);
alter table privacy.public_grievances enable row level security;
alter table privacy.public_grievances force row level security;
revoke all on privacy.public_grievances from public, anon, authenticated, service_role;
comment on table privacy.public_grievances is 'Job DQ (DPDP): a grievance from a person who is not signed in. PII: name, contact, details. Read only by the worker (to e-mail the privacy inbox) and the operator. Resolved ones are purged a year after they close.';
comment on column privacy.public_grievances.name is 'PII: the person''s name, as they typed it.';
comment on column privacy.public_grievances.contact is 'PII: their e-mail or phone number.';
comment on column privacy.public_grievances.details is 'PII: free text they wrote. CLEAN-EXEMPT: read by people only, never by a model, never sent to a customer';
comment on column privacy.public_grievances.reference is 'SAFE: a generated reference (GR-year-number). CLEAN-EXEMPT: generated';
comment on column privacy.public_grievances.resolution_note is 'SAFE: written by the operator. CLEAN-EXEMPT: operator text';

create function public.public_grievance_submit(p_id uuid, p_name text, p_contact text, p_kind text, p_details text default '', p_language text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g privacy.public_grievances;
  v_now timestamptz := app.outbox_now();
  v_name text := btrim(coalesce(p_name, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_details text := coalesce(p_details, '');
begin
  if p_id is null or char_length(v_name) not between 1 and 120 or char_length(v_contact) not between 3 and 200
     or p_kind is null or p_kind not in ('access', 'correction', 'erasure', 'withdraw_consent', 'complaint', 'other')
     or char_length(v_details) > 4000 or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn'))
     or not app.text_is_clean(v_name) or not app.text_is_clean(v_contact) then
    perform app.privacy_error('invalid');
  end if;
  select * into g from privacy.public_grievances x where x.id = p_id;
  if found then
    if lower(g.contact) <> lower(v_contact) then
      perform app.privacy_error('invalid');
    end if;
    return jsonb_build_object('reference', g.reference, 'status', 'received', 'received_at', g.received_at, 'answer_due_on', (g.due_at at time zone 'Asia/Kolkata')::date, 'answer_within_days', 30, 'replayed', true);
  end if;
  -- the caps live HERE (the door is open to the public key): five per contact per day, three hundred an hour in all
  if (select count(*) from privacy.public_grievances x where lower(x.contact) = lower(v_contact) and x.received_at > v_now - interval '24 hours') >= 5
     or (select count(*) from privacy.public_grievances x where x.received_at > v_now - interval '1 hour') >= 300 then
    perform app.privacy_error('rate');
  end if;
  insert into privacy.public_grievances (id, reference, name, contact, kind, details, language, received_at, due_at)
  values (p_id, 'GR-' || to_char(v_now at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('privacy.public_grievance_seq')::text, 6, '0'),
          v_name, v_contact, p_kind, v_details, p_language, v_now, v_now + interval '30 days')
  returning * into g;
  return jsonb_build_object('reference', g.reference, 'status', 'received', 'received_at', g.received_at, 'answer_due_on', (g.due_at at time zone 'Asia/Kolkata')::date, 'answer_within_days', 30, 'replayed', false);
end;
$$;
revoke all on function public.public_grievance_submit(uuid, text, text, text, text, text) from public;
grant execute on function public.public_grievance_submit(uuid, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the waitlist
-- ---------------------------------------------------------------------------------------------------------------------------------
create table privacy.waitlist_entries (
  id               uuid primary key default gen_random_uuid(),
  contact_key      text not null unique,
  name             text not null check (char_length(name) between 1 and 120),
  business_type    text not null check (business_type in ('textiles', 'construction', 'education', 'other')),
  city             text not null check (char_length(city) between 1 and 80),
  phone            text check (char_length(phone) between 7 and 20),
  email            text check (char_length(email) between 5 and 200),
  language         text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  marketing_opt_in boolean not null,
  notice_version   text not null check (notice_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  consented_at     timestamptz not null default app.outbox_now(),
  created_at       timestamptz not null default app.outbox_now(),
  inbox_sent_at    timestamptz,
  check (phone is not null or email is not null)
);
create index waitlist_created_idx on privacy.waitlist_entries (created_at);
alter table privacy.waitlist_entries enable row level security;
alter table privacy.waitlist_entries force row level security;
revoke all on privacy.waitlist_entries from public, anon, authenticated, service_role;
comment on table privacy.waitlist_entries is 'Job DQ (DPDP): a person who joined the waitlist or asked for a demo on the public site, with the consent record (marketing_opt_in, notice_version, consented_at). PII: name, city, phone, email. Purged 12 months after they joined.';
comment on column privacy.waitlist_entries.name is 'PII: the person''s name.';
comment on column privacy.waitlist_entries.phone is 'PII: phone number.';
comment on column privacy.waitlist_entries.email is 'PII: e-mail address.';
comment on column privacy.waitlist_entries.city is 'PII: the town they gave.';
comment on column privacy.waitlist_entries.contact_key is 'PII: the e-mail (lower case) or the phone digits, to recognise a repeat.';
comment on column privacy.waitlist_entries.business_type is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column privacy.waitlist_entries.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column privacy.waitlist_entries.notice_version is 'SAFE: a version label. CLEAN-EXEMPT: pattern CHECK';

create function public.waitlist_join(p_name text, p_business_type text, p_city text, p_phone text, p_email text, p_language text, p_marketing_opt_in boolean, p_notice_version text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_name text := btrim(coalesce(p_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone text := case when v_digits = '' then null else (case when btrim(p_phone) like '+%' then '+' else '' end) || v_digits end;
  v_key text;
  w privacy.waitlist_entries;
begin
  if char_length(v_name) not between 1 and 120 or char_length(v_city) not between 1 and 80
     or p_business_type is null or p_business_type not in ('textiles', 'construction', 'education', 'other')
     or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml')
     or p_marketing_opt_in is null or p_notice_version is null or p_notice_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'
     or (v_email is null and v_phone is null)
     or (v_email is not null and (char_length(v_email) not between 5 and 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
     or (v_phone is not null and char_length(v_phone) not between 7 and 20)
     or not app.text_is_clean(v_name) or not app.text_is_clean(v_city) then
    perform app.privacy_error('invalid');
  end if;
  v_key := coalesce(v_email, v_phone);
  select * into w from privacy.waitlist_entries x where x.contact_key = v_key;
  if found then
    -- a repeat never says it is a repeat to the caller; it only keeps the person's latest word on marketing
    if w.marketing_opt_in is distinct from p_marketing_opt_in then
      update privacy.waitlist_entries set marketing_opt_in = p_marketing_opt_in, notice_version = p_notice_version, consented_at = v_now where id = w.id;
    end if;
    return jsonb_build_object('status', 'already_joined', 'marketing_opt_in', p_marketing_opt_in);
  end if;
  if (select count(*) from privacy.waitlist_entries x where x.created_at > v_now - interval '1 hour') >= 300 then
    perform app.privacy_error('rate');   -- the cap is HERE because the door is open to the public key
  end if;
  insert into privacy.waitlist_entries (contact_key, name, business_type, city, phone, email, language, marketing_opt_in, notice_version, consented_at, created_at)
  values (v_key, v_name, p_business_type, v_city, v_phone, v_email, p_language, p_marketing_opt_in, p_notice_version, v_now, v_now);
  return jsonb_build_object('status', 'joined', 'marketing_opt_in', p_marketing_opt_in);
end;
$$;
revoke all on function public.waitlist_join(text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.waitlist_join(text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- the worker e-mails what was stored (the privacy inbox for a grievance, the person for the acknowledgement, the hello inbox for the waitlist) and marks each one sent; a failed send is offered again
create function public.scheduler_public_intake_due(p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.privacy_error('invalid');
  end if;
  return jsonb_build_object(
    'grievances', coalesce((select jsonb_agg(to_jsonb(g) order by g.received_at) from (
        select x.id, x.reference, x.name, x.contact, x.kind, x.details, x.language, x.received_at, (x.due_at at time zone 'Asia/Kolkata')::date::text as due_on, (x.inbox_sent_at is null) as need_inbox,
               (x.ack_sent_at is null and x.contact like '%@%') as need_ack
          from privacy.public_grievances x where x.inbox_sent_at is null or (x.ack_sent_at is null and x.contact like '%@%')
         order by x.received_at limit p_limit) g), '[]'::jsonb),
    'waitlist', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from (
        select x.id, x.name, x.business_type, x.city, x.phone, x.email, x.language, x.marketing_opt_in, x.created_at
          from privacy.waitlist_entries x where x.inbox_sent_at is null order by x.created_at limit p_limit) w), '[]'::jsonb));
end;
$$;
revoke all on function public.scheduler_public_intake_due(integer) from public, anon;
grant execute on function public.scheduler_public_intake_due(integer) to authenticated;

create function public.scheduler_public_intake_mark(p_kind text, p_id uuid, p_what text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_kind is null or p_id is null or p_what is null or (p_kind, p_what) not in (('grievance', 'inbox'), ('grievance', 'ack'), ('waitlist', 'inbox')) then
    perform app.privacy_error('invalid');
  end if;
  if p_kind = 'grievance' and p_what = 'inbox' then
    update privacy.public_grievances set inbox_sent_at = app.outbox_now() where id = p_id and inbox_sent_at is null;
  elsif p_kind = 'grievance' then
    update privacy.public_grievances set ack_sent_at = app.outbox_now() where id = p_id and ack_sent_at is null;
  else
    update privacy.waitlist_entries set inbox_sent_at = app.outbox_now() where id = p_id and inbox_sent_at is null;
  end if;
end;
$$;
revoke all on function public.scheduler_public_intake_mark(text, uuid, text) from public, anon;
grant execute on function public.scheduler_public_intake_mark(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. a lapsed workspace: warned 48 hours before, then erased (behind its own switch)
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled', 'requirement_enabled', 'assistant_enabled', 'outbox_enabled', 'billing_enforced', 'lapse_erasure'));
insert into public.platform_flags (key, enabled) values ('lapse_erasure', false);

create function app.lapse_erasure_enabled() returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((select f.enabled from public.platform_flags f where f.key = 'lapse_erasure'), false) and app.billing_enforced() $$;
revoke all on function app.lapse_erasure_enabled() from public, anon, authenticated, service_role;

create function app.operator_set_lapse_erasure(p_enabled boolean) returns void
language sql
set search_path = ''
as $$ update public.platform_flags set enabled = p_enabled where key = 'lapse_erasure' $$;
revoke all on function app.operator_set_lapse_erasure(boolean) from public, anon, authenticated, service_role;

create table privacy.lapse_erasures (
  -- named workspace_id on purpose: this is bookkeeping no client reads (no grant, no policy), not a tenant table with a role matrix
  workspace_id       uuid primary key references public.tenants (id) on delete restrict,
  erase_at           timestamptz not null,
  warned_at          timestamptz,
  erased_at          timestamptz,
  erasure_request_id uuid,
  check ((erased_at is null) = (erasure_request_id is null))
);
alter table privacy.lapse_erasures enable row level security;
alter table privacy.lapse_erasures force row level security;
revoke all on privacy.lapse_erasures from public, anon, authenticated, service_role;
comment on table privacy.lapse_erasures is 'Job DQ (DPDP): which lapsed workspace was warned for which erasure moment, and whether it was erased. No personal data.';

-- the moment a lapsed workspace is erased: 90 days after the access it had ended (null while it is not lapsed, exempt, or billing is not enforced)
create function app.lapse_erase_at(p_tenant uuid) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if not app.billing_enforced() or exists (select 1 from public.tenants t where t.id = p_tenant and t.billing_exempt)
     or exists (select 1 from public.erasure_requests e where e.tenant_id = p_tenant and e.scope = 'tenant' and e.status = 'executed') then
    return null;
  end if;
  v_until := app.billing_access_until(p_tenant);
  if v_until is null or app.outbox_now() < v_until then
    return null;
  end if;
  return v_until + interval '90 days';
end;
$$;
revoke all on function app.lapse_erase_at(uuid) from public, anon, authenticated, service_role;

create function public.scheduler_lapse_due(p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.privacy_error('invalid');
  end if;
  if not app.lapse_erasure_enabled() then
    return jsonb_build_object('warn', '[]'::jsonb, 'erase', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'warn', coalesce((select jsonb_agg(to_jsonb(w)) from (
        select t.id as tenant_id, t.name as tenant_name, x.erase_at, (x.erase_at at time zone 'Asia/Kolkata')::date::text as erase_on,
               coalesce((select a.main_language from public.assistant_settings a where a.tenant_id = t.id and a.main_language in ('en', 'te', 'hi')), 'en') as language,
               coalesce((select jsonb_agg(u.email order by u.email) from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = t.id and m.role = 'owner' and u.email is not null), '[]'::jsonb) as emails
          from public.tenants t
          cross join lateral (select app.lapse_erase_at(t.id) as erase_at) x
         where x.erase_at is not null and v_now >= x.erase_at - interval '48 hours'
           and not exists (select 1 from privacy.lapse_erasures l where l.workspace_id = t.id and l.erase_at = x.erase_at and l.warned_at is not null)
         order by t.id limit p_limit) w), '[]'::jsonb),
    'erase', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', l.workspace_id)) from (
        select l0.workspace_id from privacy.lapse_erasures l0
         where l0.erased_at is null and l0.warned_at is not null and l0.warned_at <= v_now - interval '48 hours' and l0.erase_at <= v_now
           and l0.erase_at is not distinct from app.lapse_erase_at(l0.workspace_id)
         order by l0.erase_at, l0.workspace_id limit p_limit) l), '[]'::jsonb));
end;
$$;
revoke all on function public.scheduler_lapse_due(integer) from public, anon;
grant execute on function public.scheduler_lapse_due(integer) to authenticated;

create function public.scheduler_lapse_warned(p_tenant_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  v_at := case when p_tenant_id is null then null else app.lapse_erase_at(p_tenant_id) end;
  if v_at is null or not app.lapse_erasure_enabled() then
    perform app.privacy_error('invalid');
  end if;
  insert into privacy.lapse_erasures (workspace_id, erase_at, warned_at) values (p_tenant_id, v_at, app.outbox_now())
  on conflict (workspace_id) do update set erase_at = excluded.erase_at, warned_at = excluded.warned_at where privacy.lapse_erasures.erased_at is null;
  perform app.write_audit_event(p_tenant_id, 'retention.lapse_warned', 'tenant', p_tenant_id, null, jsonb_build_object('erase_at', v_at));
end;
$$;
revoke all on function public.scheduler_lapse_warned(uuid) from public, anon;
grant execute on function public.scheduler_lapse_warned(uuid) to authenticated;

-- the erasure itself: the database re-checks everything (the switch, the 90 days, a warning that is at least 48 hours old for THIS erasure moment) and runs the existing tenant erasure
create function public.scheduler_lapse_erase(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '300s'
as $$
declare
  l privacy.lapse_erasures;
  r public.erasure_requests;
  v_id uuid := gen_random_uuid();
  v_now timestamptz := app.outbox_now();
  v_body jsonb;
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  if p_tenant_id is null or not app.lapse_erasure_enabled() then
    perform app.privacy_error('state');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || p_tenant_id::text, 0));
  select * into l from privacy.lapse_erasures x where x.workspace_id = p_tenant_id for update;
  if not found or l.erased_at is not null or l.warned_at is null or l.warned_at > v_now - interval '48 hours' or l.erase_at > v_now
     or l.erase_at is distinct from app.lapse_erase_at(p_tenant_id) then
    perform app.privacy_error('state');
  end if;
  insert into public.erasure_requests (id, tenant_id, scope, requested_by, execute_after) values (v_id, p_tenant_id, 'tenant', auth.uid(), v_now) returning * into r;
  perform set_config('app.erasure_request', v_id::text, true);
  update public.erasure_requests set status = 'executing' where id = v_id returning * into r;
  v_body := app.erase_tenant(r);
  update public.erasure_requests set status = 'executed', executed_by = auth.uid(), executed_at = v_now,
         result = v_body || jsonb_build_object('request_id', v_id, 'scope', 'tenant', 'status', 'executed', 'dry_run', false, 'reason', 'lapsed_90_days')
   where id = v_id;
  perform set_config('app.erasure_request', '', true);
  update privacy.lapse_erasures set erased_at = v_now, erasure_request_id = v_id where workspace_id = p_tenant_id;
  perform app.write_audit_event(p_tenant_id, 'retention.lapse_erased', 'tenant', p_tenant_id, null, jsonb_build_object('request_id', v_id));
  return jsonb_build_object('tenant_id', p_tenant_id, 'request_id', v_id);
end;
$$;
revoke all on function public.scheduler_lapse_erase(uuid) from public, anon;
grant execute on function public.scheduler_lapse_erase(uuid) to authenticated;

-- what the Owner's screen needs: has the warning gone, and for which day
create function public.lapse_erasure_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.privacy_error('deny');
  end if;
  return jsonb_build_object('erasure_warning_sent_at',
    (select l.warned_at from privacy.lapse_erasures l where l.workspace_id = p_tenant_id and l.erased_at is null and l.erase_at is not distinct from app.lapse_erase_at(p_tenant_id)));
end;
$$;
revoke all on function public.lapse_erasure_status(uuid) from public, anon;
grant execute on function public.lapse_erasure_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. old security/audit rows and the public intakes
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.privacy_worker_purge_logs() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  n_audit bigint;
  n_grievances bigint;
  n_waitlist bigint;
begin
  if not app.is_scheduler() then
    perform app.privacy_error('deny');
  end if;
  perform set_config('app.retention_purge', 'on', true);
  delete from public.audit_events a where a.created_at < v_now - interval '395 days';   -- kept at least a year, then purged
  get diagnostics n_audit = row_count;
  perform set_config('app.retention_purge', '', true);
  delete from privacy.public_grievances g where g.closed_at is not null and g.closed_at < v_now - interval '365 days';
  get diagnostics n_grievances = row_count;
  delete from privacy.waitlist_entries w where w.created_at < v_now - interval '12 months';
  get diagnostics n_waitlist = row_count;
  return jsonb_build_object('audit_events', n_audit, 'public_grievances', n_grievances, 'waitlist', n_waitlist);
end;
$$;
revoke all on function public.privacy_worker_purge_logs() from public, anon;
grant execute on function public.privacy_worker_purge_logs() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. "download my data" also holds the consent ledger (the function of job BN, re-created from its own definition with one key added)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.data_export_person_data()'::regprocedure);
  v_new text;
begin
  if position('    ''my_deletion_requests'',' in v_def) = 0 then
    raise exception 'dq_dpdp: the person export function is not the one this migration expects';
  end if;
  v_new := replace(v_def, '    ''my_deletion_requests'',',
    '    ''consents'', coalesce((select jsonb_agg(jsonb_build_object(''purpose'', c.purpose, ''action'', c.action, ''at'', c.created_at, ''notice_version'', c.notice_version, ''via'', c.via) order by c.id) from privacy.consent_events c where c.user_id = v_uid), ''[]''::jsonb),'
    || E'\n    ''my_deletion_requests'',');
  execute v_new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. the erasure of a lapsed workspace is run by the scheduler, who is not an Owner: the archive guard of job T003 lets an erasure that is executing (its own door: the request names this workspace and says
--    'executing') archive the records it erases. A full copy of the guard with that one added condition; every other write path is exactly as before.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.erasure_door_open(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.erasure_running(p_tenant) $$;
revoke all on function app.erasure_door_open(uuid) from public;
grant execute on function app.erasure_door_open(uuid) to authenticated;   -- the archive guard runs as the caller; this answers one yes/no and reads nothing back

create or replace function app.guard_archive() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and not app.has_tenant_role(new.tenant_id, array['owner', 'admin']::public.app_role[])
     and not app.erasure_door_open(new.tenant_id) then
    raise exception 'only an owner or admin can archive or restore records' using errcode = '42501';
  end if;
  return new;
end;
$$;
