-- Job BI (ADR 0073), part 4 of 4: WHICH TERMS AND PRIVACY NOTICE A PERSON ACCEPTED, AND WHEN. One row per person, kind (terms | privacy) and version. The CURRENT versions are the API's to
-- publish (GET /v1/policies/current) and it refuses to record any other; the database keeps the evidence. A person can only record their own acceptance and read their own rows; nothing is ever
-- changed or deleted by a client (a later version is a new row).
--
--   integrations.policy_acceptances         private schema (no client grant)
--   public.policy_accept(terms, privacy, via)     the signed-in person records the versions they accepted (either may be null); idempotent
--   public.policy_acceptances_mine()              the signed-in person's rows
--
-- Personal data: a user id and a version label. It is the person's own record of consent and goes with the account (on delete cascade); no free text.

create table integrations.policy_acceptances (
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('terms', 'privacy')),
  version     text not null check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  accepted_at timestamptz not null default now(),
  via         text not null check (via in ('signup', 'setup', 'prompt')),
  primary key (user_id, kind, version)
);
alter table integrations.policy_acceptances enable row level security;
alter table integrations.policy_acceptances force row level security;
revoke all on integrations.policy_acceptances from public, anon, authenticated, service_role;
comment on table integrations.policy_acceptances is 'Job BI: the terms and privacy versions each person accepted, with the time. Written only by public.policy_accept for the caller themself.';

create function public.policy_accept(p_terms_version text, p_privacy_version text, p_via text default 'prompt') returns jsonb
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
  end if;
  return public.policy_acceptances_mine();
end;
$$;
revoke all on function public.policy_accept(text, text, text) from public, anon;
grant execute on function public.policy_accept(text, text, text) to authenticated;

create function public.policy_acceptances_mine() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.integration_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'version', a.version, 'accepted_at', a.accepted_at, 'via', a.via) order by a.accepted_at, a.kind, a.version)
                     from integrations.policy_acceptances a where a.user_id = auth.uid()), '[]'::jsonb);
end;
$$;
revoke all on function public.policy_acceptances_mine() from public, anon;
grant execute on function public.policy_acceptances_mine() to authenticated;
