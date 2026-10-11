-- Job BI (ADR 0073), part 3 of 4: THE VISITS CALENDAR FEED. A private, revocable address per member that a calendar app (Google, Apple, Outlook) can subscribe to, listing the shop's upcoming
-- store visits. No Google account is involved: the address itself is the credential.
--
--   integrations.calendar_tokens                  private schema: only the SHA-256 of a token is stored (never the token); one active token per member and business
--   public.calendar_feed_create(tenant, hash)     any member: revokes the member's active token and stores the new hash (rotation)
--   public.calendar_feed_status(tenant)           any member: {active, created_at, last_used_at}; never a token
--   public.calendar_feed_revoke(tenant)           any member: revokes the member's active token
--   public.calendar_feed_read(hash)               ANON-callable on purpose (a calendar app has no sign-in): returns the upcoming visits for a token that is active AND whose member still belongs
--                                                 to the business, else null. This is the ONE function anon may execute (tests/06 names it). What it returns is minimal: when, how long, the
--                                                 state, the party size, and "first name + last initial" (or "Customer" when the person was erased). Never a phone number, e-mail, note, purpose or
--                                                 company. The token is 256 bits of randomness, so guessing is not a risk; the API adds a rate limit in front.
-- The clock is app.visit_now() (pinnable in tests). "Upcoming": from two hours ago to 90 days ahead, status booked, confirmed or arrived.

create table integrations.calendar_tokens (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create unique index calendar_tokens_one_active_idx on integrations.calendar_tokens (tenant_id, user_id) where revoked_at is null;
alter table integrations.calendar_tokens enable row level security;
alter table integrations.calendar_tokens force row level security;
revoke all on integrations.calendar_tokens from public, anon, authenticated, service_role;
comment on table integrations.calendar_tokens is 'Job BI: the hashes of the calendar-feed tokens. Only sha256 of a token is kept; the token is shown to its member once, when it is made.';

create function public.calendar_feed_create(p_tenant_id uuid, p_token_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.integration_error('deny');
  end if;
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    perform app.integration_error('invalid');
  end if;
  update integrations.calendar_tokens set revoked_at = now() where tenant_id = p_tenant_id and user_id = auth.uid() and revoked_at is null;
  begin
    insert into integrations.calendar_tokens (token_sha256, tenant_id, user_id) values (p_token_sha256, p_tenant_id, auth.uid()) returning created_at into v_created;
  exception when unique_violation then
    perform app.integration_error('invalid');   -- the same token twice: the API makes a new one
  end;
  perform app.write_audit_event(p_tenant_id, 'calendar_feed.create', 'calendar_feed', null, null, '{}'::jsonb);
  return jsonb_build_object('active', true, 'created_at', v_created, 'last_used_at', null);
end;
$$;
revoke all on function public.calendar_feed_create(uuid, text) from public, anon;
grant execute on function public.calendar_feed_create(uuid, text) to authenticated;

create function public.calendar_feed_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t integrations.calendar_tokens;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.integration_error('deny');
  end if;
  select * into t from integrations.calendar_tokens x where x.tenant_id = p_tenant_id and x.user_id = auth.uid() and x.revoked_at is null;
  if not found then
    return jsonb_build_object('active', false, 'created_at', null, 'last_used_at', null);
  end if;
  return jsonb_build_object('active', true, 'created_at', t.created_at, 'last_used_at', t.last_used_at);
end;
$$;
revoke all on function public.calendar_feed_status(uuid) from public, anon;
grant execute on function public.calendar_feed_status(uuid) to authenticated;

create function public.calendar_feed_revoke(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.integration_error('deny');
  end if;
  update integrations.calendar_tokens set revoked_at = now() where tenant_id = p_tenant_id and user_id = auth.uid() and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app.write_audit_event(p_tenant_id, 'calendar_feed.revoke', 'calendar_feed', null, null, '{}'::jsonb);
  end if;
  return jsonb_build_object('active', false, 'revoked', v_n);
end;
$$;
revoke all on function public.calendar_feed_revoke(uuid) from public, anon;
grant execute on function public.calendar_feed_revoke(uuid) to authenticated;

-- "Ravi Kumar" -> "Ravi K."; one word -> that word; nothing usable or an erased person -> "Customer". The name is cut to 24 characters and cleaned of anything but letters (any script), marks and spaces.
create function app.calendar_label(p_full_name text, p_erased boolean) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text;
  v_words text[];
  v_first text;
  v_last  text;
begin
  if coalesce(p_erased, false) or p_full_name is null then
    return 'Customer';
  end if;
  v_clean := btrim(regexp_replace(p_full_name, '[^[:alpha:][:space:]]', ' ', 'g'));
  v_words := regexp_split_to_array(v_clean, '\s+');
  v_first := left(coalesce(v_words[1], ''), 24);
  if v_first = '' or v_first like 'erased%' then
    return 'Customer';
  end if;
  if array_length(v_words, 1) > 1 then
    v_last := left(v_words[array_length(v_words, 1)], 1);
    return v_first || ' ' || upper(v_last) || '.';
  end if;
  return v_first;
end;
$$;
revoke all on function app.calendar_label(text, boolean) from public;

create function public.calendar_feed_read(p_token_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t     integrations.calendar_tokens;
  v_now timestamptz := app.visit_now();
  v_biz text;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select x.* into t from integrations.calendar_tokens x
   where x.token_sha256 = p_token_sha256 and x.revoked_at is null
     and exists (select 1 from public.memberships m where m.tenant_id = x.tenant_id and m.user_id = x.user_id);
  if not found then
    return null;
  end if;
  if t.last_used_at is null or t.last_used_at < v_now - interval '1 minute' then
    update integrations.calendar_tokens set last_used_at = v_now where token_sha256 = t.token_sha256;
  end if;
  select left(b.name, 80) into v_biz from public.tenants b where b.id = t.tenant_id;
  return jsonb_build_object(
    'business', v_biz,
    'generated_at', v_now,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'status', v.status, 'party_size', v.party_size,
               'label', app.calendar_label(c.full_name, c.erased_at is not null),
               'updated_at', v.updated_at) order by v.starts_at, v.id)
        from public.store_visits v
        left join public.contacts c on c.tenant_id = v.tenant_id and c.id = v.contact_id
       where v.tenant_id = t.tenant_id and v.status in ('booked', 'confirmed', 'arrived')
         and v.starts_at >= v_now - interval '2 hours' and v.starts_at < v_now + interval '90 days'), '[]'::jsonb));
end;
$$;
revoke all on function public.calendar_feed_read(text) from public;
grant execute on function public.calendar_feed_read(text) to anon, authenticated;
comment on function public.calendar_feed_read(text) is 'Job BI: the one function anon may execute. A calendar app has no sign-in; the token hash is the credential. Minimal fields only.';
