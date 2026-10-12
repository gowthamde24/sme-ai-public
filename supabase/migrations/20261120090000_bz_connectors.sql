-- Job BZ (ADR 0080): CONNECTORS. IndiaMART lead pull, UPI payment links (Razorpay, Cashfree), missed calls and the owner-approved click-to-call bridge (Exotel). The database side only: the providers are
-- called by the API, behind interfaces with fakes, switched on by environment variables the owner sets later.
--
--   * integrations.pull_state       when a pull from a lead source last ran (IndiaMART asks for no more than one call in five minutes, and blocks a key for 15 minutes after more than five in a minute).
--   * integrations.payment_links    a payment link made for an ORDER: amount in paise, our reference, the provider's link id and address, and what the provider told us. Never a card number, a UPI
--                                   address, a bank detail or the provider's whole message: only the status, the amount paid, the provider's payment reference and the time.
--   * integrations.webhook_events   one row per provider message already handled (a retry changes nothing).
--   * integrations.missed_calls     a call to the business's missed-call number. A caller who is a contact of the business is stored by contact (the number lives only in the contact, so erasing the contact
--                                   erases it); a caller who is not is stored with the number for 14 days at most.
--   * integrations.call_bridges     one row per APPROVED call request that was handed to the telephony provider (one bridge per request: a retry places no second call).
--
-- WHO CALLS WHAT. A PERSON (Owner/Admin, and Sales for reading and for handling missed calls) calls the public functions with their own token. A provider's webhook reaches the API, which checks the provider's signature
-- (or a secret path) and then signs in as the registered worker account (job AW) to call the public.scheduler_* functions below; those answer 42501 to anyone else. Money is NEVER recorded here: a paid link only
-- says "the provider reports Rs X received"; a person records the payment on the order (the order lifecycle stays the one place that moves an order).
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 not found, SM611 asked too soon, SM612 not in a state that allows this, SM613 an open link exists already, SM614 outside the hours calls are allowed.

create schema if not exists integrations;
revoke all on schema integrations from public, anon, authenticated, service_role;

create function app.connector_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'too_soon'  then raise exception 'asked too soon' using errcode = 'SM611';
    when 'state'     then raise exception 'not in a state that allows this' using errcode = 'SM612';
    when 'open_link' then raise exception 'an open payment link exists for this order' using errcode = 'SM613';
    when 'hours'     then raise exception 'outside the hours calls are allowed' using errcode = 'SM614';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.connector_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. IndiaMART: the pull window
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.pull_state (
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  source          text not null check (source in ('indiamart')),
  last_attempt_at timestamptz,
  last_end        timestamptz,
  last_count      integer check (last_count between 0 and 100000),
  primary key (tenant_id, source)
);
alter table integrations.pull_state enable row level security;
alter table integrations.pull_state force row level security;
revoke all on integrations.pull_state from public, anon, authenticated, service_role;

-- Start a pull: refuses a second call within five minutes of the last one (SM611), and says which window to ask for: from five minutes before the end of the last good pull (the provider's own advice:
-- overlap, then drop what was seen) or the last 24 hours the first time, never more than 7 days back (the provider's limit), up to now.
create function public.indiamart_pull_begin(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := app.outbox_now();
  s       integrations.pull_state;
  v_start timestamptz;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  insert into integrations.pull_state (tenant_id, source) values (p_tenant_id, 'indiamart') on conflict do nothing;
  select * into s from integrations.pull_state x where x.tenant_id = p_tenant_id and x.source = 'indiamart' for update;
  if s.last_attempt_at is not null and s.last_attempt_at > v_now - interval '5 minutes' then
    perform app.connector_error('too_soon');
  end if;
  v_start := greatest(coalesce(s.last_end - interval '5 minutes', v_now - interval '24 hours'), v_now - interval '7 days');
  update integrations.pull_state set last_attempt_at = v_now where tenant_id = p_tenant_id and source = 'indiamart';
  return jsonb_build_object('start', v_start, 'end', v_now);
end;
$$;
revoke all on function public.indiamart_pull_begin(uuid) from public, anon;
grant execute on function public.indiamart_pull_begin(uuid) to authenticated;

-- The pull worked: the next window starts from here.
create function public.indiamart_pull_finish(p_tenant_id uuid, p_end timestamptz, p_count integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  if p_end is null or p_count is null or p_count not between 0 and 100000 or p_end > app.outbox_now() + interval '1 minute' then
    perform app.connector_error('invalid');
  end if;
  update integrations.pull_state set last_end = greatest(coalesce(last_end, p_end), p_end), last_count = p_count where tenant_id = p_tenant_id and source = 'indiamart';
  if not found then
    perform app.connector_error('reference');
  end if;
  return jsonb_build_object('last_end', p_end, 'last_count', p_count);
end;
$$;
revoke all on function public.indiamart_pull_finish(uuid, timestamptz, integer) from public, anon;
grant execute on function public.indiamart_pull_finish(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. payment links
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.payment_links (
  id                  uuid primary key,
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  order_id            uuid not null,
  provider            text not null check (provider in ('razorpay', 'cashfree', 'fake')),
  reference           text not null check (reference ~ '^pl_[0-9a-f]{32}$'),
  amount_paise        bigint not null check (amount_paise between 100 and 1000000000),
  status              text not null default 'pending' check (status in ('pending', 'created', 'paid', 'mismatch', 'expired', 'cancelled', 'failed', 'recorded')),
  provider_link_id    text check (char_length(provider_link_id) between 1 and 100 and provider_link_id ~ '^[A-Za-z0-9_.-]+$'),
  url                 text check (char_length(url) <= 500 and url ~ '^https://[^[:space:]]+$'),
  expires_at          timestamptz not null,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  paid_amount_paise   bigint check (paid_amount_paise between 1 and 1000000000),
  paid_at             timestamptz,
  provider_payment_ref text check (char_length(provider_payment_ref) between 1 and 100 and provider_payment_ref ~ '^[A-Za-z0-9_.-]+$'),
  recorded_event_id   uuid,
  recorded_by         uuid,
  recorded_at         timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, reference),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  check ((status in ('created', 'paid', 'mismatch', 'expired', 'cancelled', 'recorded')) = (provider_link_id is not null and url is not null) or status in ('failed')),
  check ((status in ('paid', 'mismatch', 'recorded')) = (paid_at is not null)),
  check ((status = 'recorded') = (recorded_event_id is not null))
);
create unique index payment_links_provider_idx on integrations.payment_links (provider, provider_link_id) where provider_link_id is not null;
create index payment_links_order_idx on integrations.payment_links (tenant_id, order_id, created_at);
alter table integrations.payment_links enable row level security;
alter table integrations.payment_links force row level security;
revoke all on integrations.payment_links from public, anon, authenticated, service_role;

create table integrations.webhook_events (
  provider    text not null check (provider in ('razorpay', 'cashfree', 'fake', 'exotel')),
  event_id    text not null check (char_length(event_id) between 8 and 200),
  received_at timestamptz not null default now(),
  outcome     text not null check (char_length(outcome) <= 40),
  primary key (provider, event_id)
);
alter table integrations.webhook_events enable row level security;
alter table integrations.webhook_events force row level security;
revoke all on integrations.webhook_events from public, anon, authenticated, service_role;

create function app.payment_link_json(l integrations.payment_links) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'order_id', l.order_id, 'provider', l.provider, 'reference', l.reference, 'amount_paise', l.amount_paise, 'status', l.status,
                            'url', l.url, 'expires_at', l.expires_at, 'created_at', l.created_at, 'paid_amount_paise', l.paid_amount_paise, 'paid_at', l.paid_at,
                            'recorded_at', l.recorded_at)
$$;
revoke all on function app.payment_link_json(integrations.payment_links) from public;

-- What an order still lacks: its total less what was paid, plus what was refunded. (The order lifecycle owns the figures; this only reads them.)
create function app.order_balance_paise(p_tenant uuid, p_order uuid) returns bigint
language sql
stable
set search_path = ''
as $$
  select o.order_total_paise - coalesce((select sum(case e.type when 'record_payment' then e.amount_paise when 'record_refund' then -e.amount_paise else 0 end)
                                           from public.order_events e where e.tenant_id = o.tenant_id and e.order_id = o.id), 0)
    from public.orders o where o.tenant_id = p_tenant and o.id = p_order
$$;
revoke all on function app.order_balance_paise(uuid, uuid) from public;

-- Make the row for a link BEFORE the provider is asked (so a crash leaves a record, and a retry of the same link id replays). Owner or Admin. The amount may not pass what the order still lacks, the order
-- must be open, and only one link per order may be open at a time (an expired one is not open).
create function public.payment_link_begin(p_tenant_id uuid, p_link_id uuid, p_order_id uuid, p_provider text, p_amount_paise bigint, p_expires_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  o     public.orders;
  l     integrations.payment_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  if p_link_id is null or p_order_id is null or p_provider is null or p_provider not in ('razorpay', 'cashfree', 'fake')
     or p_amount_paise is null or p_amount_paise not between 100 and 1000000000
     or p_expires_at is null or p_expires_at < v_now + interval '15 minutes' or p_expires_at > v_now + interval '30 days' then
    perform app.connector_error('invalid');
  end if;
  select * into l from integrations.payment_links x where x.id = p_link_id;
  if found then
    if l.tenant_id <> p_tenant_id or l.order_id <> p_order_id or l.amount_paise <> p_amount_paise or l.provider <> p_provider then
      perform app.connector_error('invalid');
    end if;
    return jsonb_build_object('link', app.payment_link_json(l), 'replayed', true);
  end if;
  select * into o from public.orders x where x.tenant_id = p_tenant_id and x.id = p_order_id for update;
  if not found then
    perform app.connector_error('reference');
  end if;
  if o.closed_at is not null then
    perform app.connector_error('state');
  end if;
  if p_amount_paise > app.order_balance_paise(p_tenant_id, p_order_id) then
    perform app.connector_error('invalid');
  end if;
  if exists (select 1 from integrations.payment_links x where x.tenant_id = p_tenant_id and x.order_id = p_order_id and x.status in ('pending', 'created') and x.expires_at > v_now) then
    perform app.connector_error('open_link');
  end if;
  insert into integrations.payment_links (id, tenant_id, order_id, provider, reference, amount_paise, expires_at, created_by)
  values (p_link_id, p_tenant_id, p_order_id, p_provider, 'pl_' || replace(p_link_id::text, '-', ''), p_amount_paise, p_expires_at, auth.uid())
  returning * into l;
  perform app.write_audit_event(p_tenant_id, 'payment_link.begun', 'payment_link', l.id, null, jsonb_build_object('order_id', p_order_id, 'amount_paise', p_amount_paise, 'provider', p_provider));
  return jsonb_build_object('link', app.payment_link_json(l), 'replayed', false);
end;
$$;
revoke all on function public.payment_link_begin(uuid, uuid, uuid, text, bigint, timestamptz) from public, anon;
grant execute on function public.payment_link_begin(uuid, uuid, uuid, text, bigint, timestamptz) to authenticated;

-- The provider made the link: keep its id and its address.
create function public.payment_link_attach(p_tenant_id uuid, p_link_id uuid, p_provider_link_id text, p_url text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.payment_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  select * into l from integrations.payment_links x where x.tenant_id = p_tenant_id and x.id = p_link_id for update;
  if not found then
    perform app.connector_error('reference');
  end if;
  if l.status = 'created' and l.provider_link_id = p_provider_link_id and l.url = p_url then
    return app.payment_link_json(l);
  end if;
  if l.status <> 'pending' then
    perform app.connector_error('state');
  end if;
  begin
    update integrations.payment_links set status = 'created', provider_link_id = p_provider_link_id, url = p_url, updated_at = now() where id = l.id returning * into l;
  exception when check_violation or unique_violation then
    perform app.connector_error('invalid');
  end;
  return app.payment_link_json(l);
end;
$$;
revoke all on function public.payment_link_attach(uuid, uuid, text, text) from public, anon;
grant execute on function public.payment_link_attach(uuid, uuid, text, text) to authenticated;

-- The provider refused or could not be reached: the link is dead and the order may get another.
create function public.payment_link_fail(p_tenant_id uuid, p_link_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.payment_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  select * into l from integrations.payment_links x where x.tenant_id = p_tenant_id and x.id = p_link_id for update;
  if not found then
    perform app.connector_error('reference');
  end if;
  if l.status = 'failed' then
    return app.payment_link_json(l);
  end if;
  if l.status <> 'pending' then
    perform app.connector_error('state');
  end if;
  update integrations.payment_links set status = 'failed', updated_at = now() where id = l.id returning * into l;
  return app.payment_link_json(l);
end;
$$;
revoke all on function public.payment_link_fail(uuid, uuid) from public, anon;
grant execute on function public.payment_link_fail(uuid, uuid) to authenticated;

-- Read: the links of an order (Owner, Admin, Sales), newest first; or one link.
create function public.payment_link_list(p_tenant_id uuid, p_order_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.payment_link_json(l) order by l.created_at desc) from integrations.payment_links l
                    where l.tenant_id = p_tenant_id and (p_order_id is null or l.order_id = p_order_id)), '[]'::jsonb);
end;
$$;
revoke all on function public.payment_link_list(uuid, uuid) from public, anon;
grant execute on function public.payment_link_list(uuid, uuid) to authenticated;

create function public.payment_link_get(p_tenant_id uuid, p_link_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l integrations.payment_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  select * into l from integrations.payment_links x where x.tenant_id = p_tenant_id and x.id = p_link_id;
  if not found then
    perform app.connector_error('reference');
  end if;
  return app.payment_link_json(l);
end;
$$;
revoke all on function public.payment_link_get(uuid, uuid) from public, anon;
grant execute on function public.payment_link_get(uuid, uuid) to authenticated;

-- A person recorded the payment on the order (through the order lifecycle); the link remembers which event. Only a link the provider reported PAID can be recorded, and only once.
create function public.payment_link_mark_recorded(p_tenant_id uuid, p_link_id uuid, p_event_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l integrations.payment_links;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  if p_event_id is null then
    perform app.connector_error('invalid');
  end if;
  select * into l from integrations.payment_links x where x.tenant_id = p_tenant_id and x.id = p_link_id for update;
  if not found then
    perform app.connector_error('reference');
  end if;
  if l.status = 'recorded' then
    if l.recorded_event_id <> p_event_id then
      perform app.connector_error('state');
    end if;
    return app.payment_link_json(l);
  end if;
  if l.status <> 'paid' then
    perform app.connector_error('state');
  end if;
  update integrations.payment_links set status = 'recorded', recorded_event_id = p_event_id, recorded_by = auth.uid(), recorded_at = now(), updated_at = now() where id = l.id returning * into l;
  perform app.write_audit_event(p_tenant_id, 'payment_link.recorded', 'payment_link', l.id, null, jsonb_build_object('order_id', l.order_id, 'amount_paise', l.paid_amount_paise));
  return app.payment_link_json(l);
end;
$$;
revoke all on function public.payment_link_mark_recorded(uuid, uuid, uuid) from public, anon;
grant execute on function public.payment_link_mark_recorded(uuid, uuid, uuid) to authenticated;

-- The provider's message (already checked for its signature by the API). Worker account only. A message seen before changes nothing. A link the provider does not know of, or whose reference is not ours,
-- is ignored. "paid" for exactly the link's amount makes it `paid`; for any other amount `mismatch` (a person decides). expired and cancelled only close an open link.
create function public.scheduler_payment_event(
  p_provider text, p_event_id text, p_provider_link_id text, p_reference text, p_status text, p_amount_paise bigint, p_payment_ref text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  l     integrations.payment_links;
  v_new text;
begin
  if not app.is_scheduler() then
    perform app.connector_error('deny');
  end if;
  if p_provider is null or p_provider not in ('razorpay', 'cashfree', 'fake') or p_event_id is null or char_length(p_event_id) not between 8 and 200
     or p_provider_link_id is null or p_status is null or p_status not in ('paid', 'partially_paid', 'expired', 'cancelled')
     or (p_status = 'paid' and (p_amount_paise is null or p_amount_paise not between 1 and 1000000000)) then
    perform app.connector_error('invalid');
  end if;
  insert into integrations.webhook_events (provider, event_id, outcome) values (p_provider, p_event_id, 'received') on conflict do nothing;
  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  select * into l from integrations.payment_links x where x.provider = p_provider and x.provider_link_id = p_provider_link_id for update;
  if not found or (p_reference is not null and l.reference <> p_reference) then
    update integrations.webhook_events set outcome = 'unknown' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'unknown');
  end if;
  if p_status = 'partially_paid' or l.status <> 'created' then
    update integrations.webhook_events set outcome = 'ignored' where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object('outcome', 'ignored', 'link_id', l.id);
  end if;
  if p_status = 'paid' then
    v_new := case when p_amount_paise = l.amount_paise then 'paid' else 'mismatch' end;
    begin
      update integrations.payment_links set status = v_new, paid_amount_paise = p_amount_paise, paid_at = v_now, provider_payment_ref = nullif(left(coalesce(p_payment_ref, ''), 100), ''), updated_at = now()
       where id = l.id returning * into l;
    exception when check_violation then
      update integrations.payment_links set status = v_new, paid_amount_paise = p_amount_paise, paid_at = v_now, provider_payment_ref = null, updated_at = now() where id = l.id returning * into l;
    end;
    perform app.write_audit_event(l.tenant_id, 'payment_link.' || v_new, 'payment_link', l.id, null, jsonb_build_object('order_id', l.order_id, 'amount_paise', l.amount_paise, 'paid_amount_paise', p_amount_paise));
  else
    v_new := p_status;
    update integrations.payment_links set status = v_new, updated_at = now() where id = l.id returning * into l;
  end if;
  update integrations.webhook_events set outcome = v_new where provider = p_provider and event_id = p_event_id;
  return jsonb_build_object('outcome', v_new, 'link_id', l.id);
end;
$$;
revoke all on function public.scheduler_payment_event(text, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.scheduler_payment_event(text, text, text, text, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. missed calls
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.missed_calls (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  provider         text not null check (provider in ('exotel', 'fake')),
  provider_call_id text not null check (char_length(provider_call_id) between 4 and 100),
  contact_id       uuid,
  lead_id          uuid,
  caller_phone     text check (char_length(caller_phone) between 8 and 20),
  caller_last4     text not null check (caller_last4 ~ '^[0-9]{4}$'),
  received_at      timestamptz not null,
  outcome          text not null check (outcome in ('replied', 'needs_owner')),
  message_id       uuid,
  handled_at       timestamptz,
  handled_by       uuid,
  created_at       timestamptz not null default now(),
  unique (provider, provider_call_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check (contact_id is null or caller_phone is null)
);
create index missed_calls_open_idx on integrations.missed_calls (tenant_id, received_at) where handled_at is null;
alter table integrations.missed_calls enable row level security;
alter table integrations.missed_calls force row level security;
revoke all on integrations.missed_calls from public, anon, authenticated, service_role;
comment on column integrations.missed_calls.caller_phone is 'PII: set only for a caller who is not a contact of the business, and only for 14 days (purged by scheduler_missed_call). For a contact the number stays in the contact.';

-- A call to the missed-call number (the API verified the secret in the address). Worker account only. Dedupes by the provider's call id. Finds the caller among the business's contacts by the last ten digits
-- (exactly one match; two contacts with one number is "needs owner"). If the caller is a contact with a lead, whose WhatsApp consent is `granted`, and the business turned automatic sending on, a short
-- fixed reply is QUEUED through the outbox (only if none of the outbox's hard blocks applies: no key, a stop, the daily limit; so no blocked message is left behind) (the same policy as a person's message: a stop, a quiet hour, the daily limit and a held-for-approval rule all still apply). In every other case the call waits
-- for a person. Old rows are purged here (14 days; a caller who was erased).
create function public.scheduler_missed_call(
  p_tenant_id uuid, p_provider text, p_call_id text, p_phone text, p_called_at timestamptz, p_message_id uuid, p_body text, p_language text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := app.outbox_now();
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_last10  text;
  v_n       integer;
  c         public.contacts;
  v_lead    uuid;
  v_out     text := 'needs_owner';
  v_msg     uuid;
  v_res     jsonb;
  m         integrations.missed_calls;
begin
  if not app.is_scheduler() then
    perform app.connector_error('deny');
  end if;
  if p_tenant_id is null or p_provider is null or p_provider not in ('exotel', 'fake') or p_call_id is null or char_length(p_call_id) not between 4 and 100
     or char_length(v_digits) < 10 or char_length(v_digits) > 15 or p_called_at is null or p_called_at > v_now + interval '5 minutes' then
    perform app.connector_error('invalid');
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    perform app.connector_error('reference');
  end if;
  v_last10 := right(v_digits, 10);
  delete from integrations.missed_calls x
   where x.created_at < v_now - interval '14 days' or (x.contact_id is not null and exists (select 1 from public.contacts k where k.tenant_id = x.tenant_id and k.id = x.contact_id and k.erased_at is not null));
  select * into m from integrations.missed_calls x where x.provider = p_provider and x.provider_call_id = p_call_id;
  if found then
    return jsonb_build_object('outcome', 'duplicate', 'id', m.id);
  end if;
  select count(*) into v_n from public.contacts k
   where k.tenant_id = p_tenant_id and k.erased_at is null and k.phone is not null and char_length(regexp_replace(k.phone, '[^0-9]', '', 'g')) >= 10
     and right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 10) = v_last10;
  if v_n = 1 then
    select * into c from public.contacts k
     where k.tenant_id = p_tenant_id and k.erased_at is null and k.phone is not null and char_length(regexp_replace(k.phone, '[^0-9]', '', 'g')) >= 10
       and right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 10) = v_last10;
    select l.id into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.contact_id = c.id and l.archived_at is null order by l.created_at desc limit 1;
    if v_lead is not null and c.whatsapp_consent = 'granted' and c.suppressed_at is null and app.scheduler_tenant_on(p_tenant_id) and app.outbox_hard_block(p_tenant_id, c, null, v_now) is null
       and p_message_id is not null and p_body is not null and p_language in ('en', 'te', 'hi', 'kn', 'ta') then
      v_res := app.outbox_submit_core(auth.uid(), p_message_id, p_tenant_id, v_lead, 'whatsapp', p_body, p_language, 'reply_to_inbound', 'system', false, false);
      if v_res ->> 'status' in ('queued', 'needs_approval') then
        v_out := 'replied';
        v_msg := p_message_id;
      end if;
    end if;
    insert into integrations.missed_calls (tenant_id, provider, provider_call_id, contact_id, lead_id, caller_last4, received_at, outcome, message_id)
    values (p_tenant_id, p_provider, p_call_id, c.id, v_lead, right(v_digits, 4), p_called_at, v_out, v_msg) returning * into m;
  else
    insert into integrations.missed_calls (tenant_id, provider, provider_call_id, caller_phone, caller_last4, received_at, outcome)
    values (p_tenant_id, p_provider, p_call_id, left(v_digits, 15), right(v_digits, 4), p_called_at, 'needs_owner') returning * into m;
  end if;
  return jsonb_build_object('outcome', v_out, 'id', m.id, 'matched', v_n = 1, 'message_id', v_msg);
end;
$$;
revoke all on function public.scheduler_missed_call(uuid, text, text, text, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.scheduler_missed_call(uuid, text, text, text, timestamptz, uuid, text, text) to authenticated;

-- A person reads the missed calls that wait (Owner, Admin, Sales): a contact is shown by name and the last four digits; a stranger by the number (so that the person can call back or make a lead).
create function public.missed_call_list(p_tenant_id uuid, p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'received_at', x.received_at, 'outcome', x.outcome, 'caller_last4', x.caller_last4, 'phone', x.caller_phone,
                                        'contact_id', x.contact_id, 'lead_id', x.lead_id, 'contact_name', k.full_name, 'handled_at', x.handled_at) order by x.received_at desc)
      from (select * from integrations.missed_calls y where y.tenant_id = p_tenant_id and y.handled_at is null and y.created_at >= app.outbox_now() - interval '14 days'
             order by y.received_at desc limit greatest(1, least(coalesce(p_limit, 50), 100))) x
      left join public.contacts k on k.tenant_id = x.tenant_id and k.id = x.contact_id and k.erased_at is null), '[]'::jsonb);
end;
$$;
revoke all on function public.missed_call_list(uuid, integer) from public, anon;
grant execute on function public.missed_call_list(uuid, integer) to authenticated;

-- "I dealt with it": the row stays (without the number) so the log is complete.
create function public.missed_call_handle(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m integrations.missed_calls;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  select * into m from integrations.missed_calls x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.connector_error('reference');
  end if;
  if m.handled_at is null then
    update integrations.missed_calls set handled_at = now(), handled_by = auth.uid(), caller_phone = null where id = m.id;
  end if;
  return jsonb_build_object('id', m.id, 'handled', true);
end;
$$;
revoke all on function public.missed_call_handle(uuid, uuid) from public, anon;
grant execute on function public.missed_call_handle(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the click-to-call bridge
-- ---------------------------------------------------------------------------------------------------------------------------------
create table integrations.call_bridges (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  call_request_id  uuid not null,
  provider         text not null check (provider in ('exotel', 'fake')),
  provider_call_id text check (char_length(provider_call_id) between 4 and 100),
  status           text not null default 'starting' check (status in ('starting', 'queued', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled')),
  requested_by     uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, call_request_id),
  foreign key (tenant_id, call_request_id) references public.call_requests (tenant_id, id)
);
create unique index call_bridges_provider_idx on integrations.call_bridges (provider, provider_call_id) where provider_call_id is not null;
alter table integrations.call_bridges enable row level security;
alter table integrations.call_bridges force row level security;
revoke all on integrations.call_bridges from public, anon, authenticated, service_role;

-- Before the API asks the provider to place the call: Owner or Admin, for a call request that a person APPROVED (job AT), whose contact is not erased, not stopped (suppressed, or phone consent withdrawn), has a
-- number, and only between 09:00 and 21:00 India time (the conservative reading of the calling-hour rule for commercial calls; see the ADR). One bridge per request: a second ask returns the first (replayed) and
-- must not place a second call. Returns the number to call (the API passes it to the provider and keeps it nowhere).
create function public.call_bridge_prepare(p_tenant_id uuid, p_call_request_id uuid, p_provider text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  r     public.call_requests;
  c     public.contacts;
  b     integrations.call_bridges;
  v_hr  integer := extract(hour from v_now at time zone 'Asia/Kolkata');
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  if p_call_request_id is null or p_provider is null or p_provider not in ('exotel', 'fake') then
    perform app.connector_error('invalid');
  end if;
  select * into r from public.call_requests x where x.tenant_id = p_tenant_id and x.id = p_call_request_id;
  if not found then
    perform app.connector_error('reference');
  end if;
  select * into b from integrations.call_bridges x where x.tenant_id = p_tenant_id and x.call_request_id = p_call_request_id;
  if found then
    return jsonb_build_object('bridge_id', b.id, 'status', b.status, 'replayed', true, 'to_number', null);
  end if;
  if r.status <> 'approved' then
    perform app.connector_error('state');
  end if;
  select * into c from public.contacts k where k.tenant_id = p_tenant_id and k.id = r.contact_id;
  if not found or c.erased_at is not null or c.suppressed_at is not null or c.phone_consent = 'withdrawn' or c.phone is null then
    perform app.connector_error('state');
  end if;
  if v_hr < 9 or v_hr >= 21 then
    perform app.connector_error('hours');
  end if;
  insert into integrations.call_bridges (tenant_id, call_request_id, provider, requested_by) values (p_tenant_id, p_call_request_id, p_provider, auth.uid()) returning * into b;
  perform app.write_audit_event(p_tenant_id, 'call_bridge.started', 'call_request', p_call_request_id, null, jsonb_build_object('provider', p_provider));
  return jsonb_build_object('bridge_id', b.id, 'status', b.status, 'replayed', false, 'to_number', c.phone);
end;
$$;
revoke all on function public.call_bridge_prepare(uuid, uuid, text) from public, anon;
grant execute on function public.call_bridge_prepare(uuid, uuid, text) to authenticated;

-- The provider accepted (or refused) the call.
create function public.call_bridge_finish(p_tenant_id uuid, p_bridge_id uuid, p_provider_call_id text, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b integrations.call_bridges;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  if p_status is null or p_status not in ('queued', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled') then
    perform app.connector_error('invalid');
  end if;
  select * into b from integrations.call_bridges x where x.tenant_id = p_tenant_id and x.id = p_bridge_id for update;
  if not found then
    perform app.connector_error('reference');
  end if;
  begin
    update integrations.call_bridges set provider_call_id = coalesce(provider_call_id, p_provider_call_id), status = p_status, updated_at = now() where id = b.id returning * into b;
  exception when check_violation or unique_violation then
    perform app.connector_error('invalid');
  end;
  return jsonb_build_object('bridge_id', b.id, 'status', b.status);
end;
$$;
revoke all on function public.call_bridge_finish(uuid, uuid, text, text) from public, anon;
grant execute on function public.call_bridge_finish(uuid, uuid, text, text) to authenticated;

-- The provider's status callback (the API checked its secret). Worker account only. A final status is never changed again.
create function public.scheduler_call_status(p_provider text, p_provider_call_id text, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b integrations.call_bridges;
begin
  if not app.is_scheduler() then
    perform app.connector_error('deny');
  end if;
  if p_provider is null or p_provider not in ('exotel', 'fake') or p_provider_call_id is null or p_status is null
     or p_status not in ('queued', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled') then
    perform app.connector_error('invalid');
  end if;
  select * into b from integrations.call_bridges x where x.provider = p_provider and x.provider_call_id = p_provider_call_id for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  if b.status in ('completed', 'failed', 'busy', 'no-answer', 'canceled') then
    return jsonb_build_object('outcome', 'final', 'status', b.status);
  end if;
  update integrations.call_bridges set status = p_status, updated_at = now() where id = b.id;
  return jsonb_build_object('outcome', 'updated', 'status', p_status);
end;
$$;
revoke all on function public.scheduler_call_status(text, text, text) from public, anon;
grant execute on function public.scheduler_call_status(text, text, text) to authenticated;

-- What is switched on and waiting, for a settings line (Owner, Admin).
create function public.connectors_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s integrations.pull_state;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  select * into s from integrations.pull_state x where x.tenant_id = p_tenant_id and x.source = 'indiamart';
  return jsonb_build_object(
    'indiamart_last_end', s.last_end, 'indiamart_last_count', s.last_count,
    'open_links', (select count(*) from integrations.payment_links l where l.tenant_id = p_tenant_id and l.status = 'created' and l.expires_at > app.outbox_now()),
    'paid_to_record', (select count(*) from integrations.payment_links l where l.tenant_id = p_tenant_id and l.status in ('paid', 'mismatch')),
    'missed_calls_waiting', (select count(*) from integrations.missed_calls m where m.tenant_id = p_tenant_id and m.handled_at is null and m.created_at >= app.outbox_now() - interval '14 days'));
end;
$$;
revoke all on function public.connectors_status(uuid) from public, anon;
grant execute on function public.connectors_status(uuid) to authenticated;
