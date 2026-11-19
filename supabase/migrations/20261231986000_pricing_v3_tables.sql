-- PRICING V3, part 1 (tables): the owner's plans and pricing of 19 Nov 2026 (project doc decision-plans-and-pricing.md), built NEXT TO billing v2 and behind the API flag PRICING_V3 (default off).
-- Nothing of billing v2 changes: pricing.plans keeps its three rows and its numbers (the v2 tests pin them). The new terms sit in their own table, keyed by the SAME plan ids, so a subscription, an order,
-- an invoice and a provider event keep working as they are. The owner-facing names are Pay as you go / Pro / Business; the old plan ids (sales_assistant, sales_lead_finder) are an INTERNAL mapping only
-- (pricing.plan_terms.plan_id <-> api_id): the v3 API never shows them.
--   pricing.plan_terms       the v3 terms of each plan, as DATA: included minutes, the Rs 5 minute, Lead Finder free searches and the price after them, onboarding
--   pricing.settings_v3      one row: the extra number (Rs 299), the 30-day hold, the grace and the 90 days of kept data, the queue, the upgrade hint's floor
--   pricing.feature_limits   the OPTIONAL spending limit per feature (calls, lead_finder, numbers, whatsapp) for the usage window
--   pricing.auto_topups      the OPTIONAL automatic top-up of the wallet (amount, when, a monthly limit) and pricing.auto_topup_runs (what it did, once per payment)
--   pricing.queued_calls     a call that could not start (wallet empty, limit reached, read-only) waits here instead of being a lost lead
--   pricing.number_rentals   the business numbers: 1 included, each extra is Rs 299 a month, a released number is held 30 days
--   pricing.warning_marks    which 80 % / 100 % warning was already given (once per level and period)
-- pricing.usage learns two more kinds: `number` (an extra number's month) and `whatsapp` (Meta's own cost, no mark-up).
-- No client role touches any of these tables: only the public.pricing_v3_* functions (migration 20261231986100 and 986200) reach them.

create table pricing.plan_terms (
  plan_id             text primary key references pricing.plans (id),
  api_id              text not null unique check (api_id in ('payg', 'pro', 'business')),
  name                text not null check (char_length(name) between 1 and 60),
  sort                integer not null,
  popular             boolean not null default false,
  included_minutes    integer not null check (included_minutes between 0 and 100000),
  minute_paise        integer not null check (minute_paise between 0 and 100000 and minute_paise % 2 = 0),
  free_searches_month integer not null check (free_searches_month between 0 and 100000),
  search_paise        integer not null check (search_paise between 0 and 1000000),
  onboarding          text not null check (onboarding in ('self_and_assistant', 'priority'))
);
comment on table pricing.plan_terms is 'Operator data: the plans of 19 Nov 2026 (v3 terms). SAFE: not personal data.';
comment on column pricing.plan_terms.plan_id is 'SAFE: the INTERNAL plan id (foreign key). CLEAN-EXEMPT: foreign key to a closed list';
comment on column pricing.plan_terms.api_id is 'SAFE: the owner-facing plan id. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.plan_terms.name is 'SAFE: the owner-facing name. CLEAN-EXEMPT: length CHECK, operator data';
comment on column pricing.plan_terms.onboarding is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
-- the prices stay in pricing.plans (Rs 499 / 1,999 / 5,999 a month, yearly = ten months): the same rows billing v2 charges
insert into pricing.plan_terms (plan_id, api_id, name, sort, popular, included_minutes, minute_paise, free_searches_month, search_paise, onboarding) values
  ('payg',              'payg',     'Pay as you go', 10, false,    0, 500,   2, 4900, 'self_and_assistant'),
  ('sales_assistant',   'pro',      'Pro',           20, true,   500, 500,  10, 3900, 'self_and_assistant'),
  ('sales_lead_finder', 'business', 'Business',      30, false, 1500, 500, 100, 2900, 'priority');
alter table pricing.plan_terms enable row level security;
alter table pricing.plan_terms force row level security;
revoke all on pricing.plan_terms from public, anon, authenticated, service_role;

create table pricing.settings_v3 (
  one                 boolean primary key default true check (one),
  extra_number_paise  bigint not null check (extra_number_paise between 0 and 100000000),
  number_hold_days    integer not null check (number_hold_days between 0 and 365),
  queue_days          integer not null check (queue_days between 1 and 90),
  grace_days          integer not null check (grace_days between 0 and 60),
  data_days           integer not null check (data_days between 1 and 3650),
  hint_days           integer not null check (hint_days between 1 and 365),
  hint_min_saving     bigint not null check (hint_min_saving between 0 and 100000000),
  warn_pct            integer not null check (warn_pct between 1 and 99),
  limit_min_paise     bigint not null check (limit_min_paise >= 0),
  limit_max_paise     bigint not null check (limit_max_paise >= limit_min_paise),
  topup_min_paise     bigint not null check (topup_min_paise > 0),
  topup_max_paise     bigint not null check (topup_max_paise >= topup_min_paise)
);
comment on table pricing.settings_v3 is 'Operator data: extra number price, number hold, queue, grace, kept data, upgrade hint floor, warning level, limit and top-up bounds. SAFE: not personal data.';
insert into pricing.settings_v3 (extra_number_paise, number_hold_days, queue_days, grace_days, data_days, hint_days, hint_min_saving, warn_pct, limit_min_paise, limit_max_paise, topup_min_paise, topup_max_paise)
values (29900, 30, 7, 3, 90, 30, 5000, 80, 10000, 100000000, 10000, 10000000);
alter table pricing.settings_v3 enable row level security;
alter table pricing.settings_v3 force row level security;
revoke all on pricing.settings_v3 from public, anon, authenticated, service_role;

alter table pricing.usage drop constraint usage_kind_check;
alter table pricing.usage add constraint usage_kind_check check (kind in ('call', 'search', 'number', 'whatsapp'));

create table pricing.feature_limits (
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  feature     text not null check (feature in ('calls', 'lead_finder', 'numbers', 'whatsapp')),
  limit_paise bigint not null check (limit_paise > 0),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, feature)
);
comment on column pricing.feature_limits.feature is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table pricing.feature_limits enable row level security;
alter table pricing.feature_limits force row level security;
revoke all on pricing.feature_limits from public, anon, authenticated, service_role;

create table pricing.auto_topups (
  tenant_id           uuid primary key references public.tenants (id) on delete restrict,
  enabled             boolean not null,
  amount_paise        bigint not null check (amount_paise > 0),
  below_paise         bigint not null check (below_paise >= 0),
  monthly_limit_paise bigint not null check (monthly_limit_paise >= amount_paise),
  updated_at          timestamptz not null default now()
);
alter table pricing.auto_topups enable row level security;
alter table pricing.auto_topups force row level security;
revoke all on pricing.auto_topups from public, anon, authenticated, service_role;

create table pricing.auto_topup_runs (
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  payment_ref  text not null check (payment_ref ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  amount_paise bigint not null check (amount_paise > 0),
  at           timestamptz not null default now(),
  primary key (tenant_id, payment_ref)
);
comment on column pricing.auto_topup_runs.payment_ref is 'SAFE: the payment provider''s payment id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
alter table pricing.auto_topup_runs enable row level security;
alter table pricing.auto_topup_runs force row level security;
revoke all on pricing.auto_topup_runs from public, anon, authenticated, service_role;

create table pricing.queued_calls (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  ref         uuid not null,
  reason      text not null check (reason in ('wallet_empty', 'limit_reached', 'read_only')),
  status      text not null default 'queued' check (status in ('queued', 'released', 'expired')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (tenant_id, ref),
  check ((status = 'queued') = (resolved_at is null))
);
comment on column pricing.queued_calls.ref is 'SAFE: the caller''s own id of the call (a task or call-request id), an opaque uuid. CLEAN-EXEMPT: uuid, not text';
comment on column pricing.queued_calls.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.queued_calls.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create index queued_calls_waiting_idx on pricing.queued_calls (tenant_id, status, created_at);
alter table pricing.queued_calls enable row level security;
alter table pricing.queued_calls force row level security;
revoke all on pricing.queued_calls from public, anon, authenticated, service_role;

create table pricing.number_rentals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  number      text not null check (number ~ '^\+[0-9]{8,15}$'),
  status      text not null check (status in ('active', 'held', 'gone')),
  extra       boolean not null,
  started_at  timestamptz not null default now(),
  paid_until  timestamptz,
  released_at timestamptz,
  hold_until  timestamptz,
  check ((status = 'active') = (released_at is null)),
  check (case status when 'active' then hold_until is null when 'held' then hold_until is not null else true end),
  check (status <> 'active' or not extra or paid_until is not null)
);
comment on column pricing.number_rentals.number is 'SAFE: the business''s own rented line (a provider number, not a person''s). CLEAN-EXEMPT: strict pattern CHECK';
comment on column pricing.number_rentals.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create unique index number_rentals_live_idx on pricing.number_rentals (tenant_id, number) where status in ('active', 'held');
create index number_rentals_tenant_idx on pricing.number_rentals (tenant_id, status, started_at);
alter table pricing.number_rentals enable row level security;
alter table pricing.number_rentals force row level security;
revoke all on pricing.number_rentals from public, anon, authenticated, service_role;

create table pricing.warning_marks (
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  scope      text not null check (scope in ('wallet', 'calls', 'lead_finder', 'numbers', 'whatsapp')),
  level      integer not null check (level in (80, 100)),
  period_key text not null check (period_key ~ '^[0-9T]{1,20}$'),
  at         timestamptz not null default now(),
  primary key (tenant_id, scope, level, period_key)
);
comment on column pricing.warning_marks.scope is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.warning_marks.period_key is 'SAFE: a timestamp written as digits. CLEAN-EXEMPT: strict pattern CHECK';
alter table pricing.warning_marks enable row level security;
alter table pricing.warning_marks force row level security;
revoke all on pricing.warning_marks from public, anon, authenticated, service_role;
