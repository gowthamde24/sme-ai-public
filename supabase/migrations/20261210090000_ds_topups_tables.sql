-- Job DS part E2 (night 4, ADR 0114): RUNNING OUT BEFORE THE MONTH ENDS. Migration 1 of 3: the tables.
-- Builds on job DI (20261127090200: the meters, notices and the operator top-up ledger `billing_topups`, kept as it is). Payments are FAKE; billing stays OFF until the owner's gates.
--
--   billing.topup_config          ONE row of data: the 90-day expiry, the GST rate, the (placeholder) seller, the (placeholder) overage rates. No client grant (schema billing).
--   billing.topup_packs           the catalogue of top-up packs as DATA: +100 / +300 / +1,000 minutes and the same for messages (placeholder prices until the owner of the product sets them).
--   public.billing_invoices       fake invoices with GST fields (CGST + SGST inside the seller's state, IGST otherwise). Append-only.
--   public.billing_topup_purchases one bought pack: units, price, the invoice, the expiry. Append-only; the unused part is derived from the draws.
--   public.billing_topup_draws    the units a pack gave to usage, in ledger units (seconds / messages), oldest pack first. Append-only.
--   public.billing_topup_settings per workspace: auto top-up (pack per kind + monthly cap) and overage (switch per kind + monthly cap). OFF by default.
--   public.billing_alert_sends    which alert (kind, level, period) went out on which channel (e-mail, WhatsApp to the owner), so a retry never sends twice.
-- Every table is read by Owner and Admin only and written only by the functions of migrations 2 and 3.
-- SQLSTATEs added: SM831 purchase id used for another pack, SM832 unknown pack, SM833 no plan to attach it to, SM834 a cap is required, SM835 not an upgrade.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the data: configuration and the pack catalogue
-- ---------------------------------------------------------------------------------------------------------------------------------
create table billing.topup_config (
  only_row                 boolean primary key default true check (only_row),
  expiry_days              integer not null check (expiry_days between 1 and 730),
  gst_rate_bp              integer not null check (gst_rate_bp between 0 and 5000),
  seller_name              text    not null check (char_length(seller_name) between 3 and 120),
  seller_state_code        text    not null check (seller_state_code ~ '^[0-9]{2}$'),
  seller_gstin             text    check (seller_gstin is null or app.gstin_is_valid(seller_gstin)),
  overage_paise_per_minute integer not null check (overage_paise_per_minute between 0 and 1000000),
  overage_paise_per_message integer not null check (overage_paise_per_message between 0 and 1000000),
  price_is_placeholder     boolean not null
);
insert into billing.topup_config (expiry_days, gst_rate_bp, seller_name, seller_state_code, seller_gstin, overage_paise_per_minute, overage_paise_per_message, price_is_placeholder)
values (90, 1800, 'Stack19 (seller details to be filled in by the owner of the product)', '36', null, 500, 70, true);

create table billing.topup_packs (
  code       text primary key check (code ~ '^[a-z0-9_]{3,30}$'),
  kind       text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  units      integer not null check (units between 1 and 1000000),
  price_paise integer not null check (price_paise between 0 and 100000000),
  sort       integer not null unique
);
-- placeholder prices (GST excluded): minutes Rs 4 each, messages Rs 0.60 each, with a volume discount; the owner of the product replaces them (a new row set, never a client edit)
insert into billing.topup_packs (code, kind, units, price_paise, sort) values
  ('minutes_100',   'call_minutes',      100,   40000, 1),
  ('minutes_300',   'call_minutes',      300,  108000, 2),
  ('minutes_1000',  'call_minutes',     1000,  340000, 3),
  ('messages_100',  'whatsapp_messages', 100,    6000, 4),
  ('messages_300',  'whatsapp_messages', 300,   16200, 5),
  ('messages_1000', 'whatsapp_messages',1000,   51000, 6);
revoke all on billing.topup_config, billing.topup_packs from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the workspace's tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.billing_invoices (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  number            text not null check (number ~ '^S19-[0-9]{4}-[0-9]{6}$'),
  kind              text not null check (kind in ('topup', 'upgrade', 'overage')),
  description       text not null check (char_length(description) between 3 and 200 and app.text_is_clean(description)),
  period_start      date,
  taxable_paise     bigint not null check (taxable_paise between 0 and 1000000000),
  gst_rate_bp       integer not null check (gst_rate_bp between 0 and 5000),
  cgst_paise        bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise        bigint not null default 0 check (sgst_paise >= 0),
  igst_paise        bigint not null default 0 check (igst_paise >= 0),
  total_paise       bigint not null check (total_paise >= 0),
  seller_name       text not null check (char_length(seller_name) between 3 and 120),
  seller_state_code text not null check (seller_state_code ~ '^[0-9]{2}$'),
  seller_gstin      text,
  buyer_gstin       text,
  buyer_state_code  text check (buyer_state_code is null or buyer_state_code ~ '^[0-9]{2}$'),
  fake              boolean not null default true,
  payment_status    text not null check (payment_status in ('paid_fake')),
  issued_at         timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  unique (tenant_id, number),
  check (total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise)
);
create index billing_invoices_list_idx on public.billing_invoices (tenant_id, issued_at desc, id);
create unique index billing_invoices_overage_period on public.billing_invoices (tenant_id, period_start) where kind = 'overage';
comment on table public.billing_invoices is 'Job DS E2: a FAKE invoice with GST fields. Written only by app.invoice_make; never changed.';
comment on column public.billing_invoices.number is 'SAFE: S19-<yymm>-<serial>. CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.billing_invoices.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.billing_invoices.description is 'SAFE: a fixed sentence made by the invoice function (guarded by app.text_is_clean in the CHECK)';
comment on column public.billing_invoices.seller_name is 'SAFE: the seller''s name from the configuration. CLEAN-EXEMPT: copied from the operator''s configuration, never client-written';
comment on column public.billing_invoices.seller_state_code is 'SAFE: two digits. CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.billing_invoices.seller_gstin is 'SAFE: the seller''s GSTIN from the configuration. CLEAN-EXEMPT: copied from the operator''s configuration, never client-written';
comment on column public.billing_invoices.buyer_gstin is 'SAFE: the shop''s own GSTIN as printed on its invoices (business_profile). CLEAN-EXEMPT: copied from a validated column, never client-written';
comment on column public.billing_invoices.buyer_state_code is 'SAFE: two digits. CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.billing_invoices.payment_status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.billing_topup_purchases (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  pack_code    text not null check (pack_code ~ '^[a-z0-9_]{3,30}$'),
  kind         text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  units        integer not null check (units between 1 and 1000000),
  price_paise  bigint not null check (price_paise >= 0),
  invoice_id   uuid not null,
  source       text not null check (source in ('manual', 'auto')),
  purchased_at timestamptz not null default app.outbox_now(),
  expires_at   timestamptz not null,
  created_by   uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.billing_invoices (tenant_id, id),
  check (expires_at > purchased_at)
);
create index billing_topup_purchases_fifo_idx on public.billing_topup_purchases (tenant_id, kind, purchased_at, id);
create index billing_topup_purchases_invoice_idx on public.billing_topup_purchases (tenant_id, invoice_id);
comment on table public.billing_topup_purchases is 'Job DS E2: one bought top-up pack (fake payment). The id is chosen by the client, so a retry changes nothing.';
comment on column public.billing_topup_purchases.pack_code is 'SAFE: a pack code of the catalogue. CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.billing_topup_purchases.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.billing_topup_purchases.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.billing_topup_purchases.created_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';

create table public.billing_topup_draws (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  purchase_id uuid not null,
  kind        text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  units       integer not null check (units > 0),   -- ledger units: seconds for call minutes, messages for messages
  at          timestamptz not null default app.outbox_now(),
  foreign key (tenant_id, purchase_id) references public.billing_topup_purchases (tenant_id, id)
);
create index billing_topup_draws_purchase_idx on public.billing_topup_draws (tenant_id, purchase_id);
create index billing_topup_draws_window_idx on public.billing_topup_draws (tenant_id, kind, at);
comment on column public.billing_topup_draws.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.billing_topup_settings (
  tenant_id                 uuid primary key references public.tenants (id) on delete restrict,
  auto_minutes_pack         text check (auto_minutes_pack is null or auto_minutes_pack ~ '^[a-z0-9_]{3,30}$'),
  auto_messages_pack        text check (auto_messages_pack is null or auto_messages_pack ~ '^[a-z0-9_]{3,30}$'),
  auto_monthly_cap_paise    bigint not null default 0 check (auto_monthly_cap_paise between 0 and 1000000000),
  overage_minutes           boolean not null default false,
  overage_messages          boolean not null default false,
  overage_monthly_cap_paise bigint not null default 0 check (overage_monthly_cap_paise between 0 and 1000000000),
  updated_by                uuid,
  updated_at                timestamptz not null default app.outbox_now()
);
comment on column public.billing_topup_settings.auto_minutes_pack is 'SAFE: a pack code or null. CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.billing_topup_settings.auto_messages_pack is 'SAFE: a pack code or null. CLEAN-EXEMPT: strict pattern CHECK';
comment on column public.billing_topup_settings.updated_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';

create table public.billing_alert_sends (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  kind         text not null check (kind in ('call_minutes', 'whatsapp_messages')),
  level        smallint not null check (level in (80, 100)),
  period_start date not null,
  channel      text not null check (channel in ('email', 'whatsapp')),
  sent_at      timestamptz not null default app.outbox_now(),
  unique (tenant_id, kind, level, period_start, channel)
);
comment on column public.billing_alert_sends.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.billing_alert_sends.channel is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

do $$
declare
  t text;
begin
  foreach t in array array['billing_invoices', 'billing_topup_purchases', 'billing_topup_draws', 'billing_topup_settings', 'billing_alert_sends'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'']::public.app_role[])))::uuid[]))', t);
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$I for each row execute function app.forbid_tenant_id_change()', t);
  end loop;
end $$;
create trigger audit_billing_invoices after insert on public.billing_invoices for each row execute function app.audit_row_change('billing_invoice', '');
create trigger audit_billing_topup_purchases after insert on public.billing_topup_purchases for each row execute function app.audit_row_change('billing_topup_purchase', '');
create trigger audit_billing_topup_draws after insert on public.billing_topup_draws for each row execute function app.audit_row_change('billing_topup_draw', '');
create trigger audit_billing_topup_settings after insert or update on public.billing_topup_settings for each row execute function app.audit_row_change('billing_topup_setting', '');
create trigger audit_billing_alert_sends after insert on public.billing_alert_sends for each row execute function app.audit_row_change('billing_alert_send', '');

-- the ledgers are written once and never changed or deleted (the same guard as job DI's)
do $$
declare
  t text;
begin
  foreach t in array array['billing_invoices', 'billing_topup_purchases', 'billing_topup_draws', 'billing_alert_sends'] loop
    execute format('create trigger %1$s_guard before update or delete on public.%1$I for each row execute function app.billing_rows_guard()', t);
    execute format('create trigger %1$s_no_truncate before truncate on public.%1$I for each statement execute function app.billing_rows_guard()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. calls that wait for minutes: a new status of an outreach item (job DR A3's table; its old migration is not edited)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in select k.conname, pg_get_constraintdef(k.oid) as def from pg_constraint k where k.conrelid = 'public.outreach_items'::regclass and k.contype = 'c' loop
    if c.def like '%skipped%' and c.def not like '%next_action%' then
      execute format('alter table public.outreach_items drop constraint %I', c.conname);
      execute 'alter table public.outreach_items add constraint outreach_items_status_check check (status in (''planned'', ''waiting'', ''waiting_for_minutes'', ''done'', ''stopped'', ''skipped''))';
    elsif c.def like '%next_action%' and c.def like '%waiting%' then
      execute format('alter table public.outreach_items drop constraint %I', c.conname);
      execute 'alter table public.outreach_items add constraint outreach_items_next_step_check check ((status in (''waiting'', ''waiting_for_minutes'')) = (next_action is not null and next_at is not null))';
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.outreach_items'::regclass and conname = 'outreach_items_status_check')
     or not exists (select 1 from pg_constraint where conrelid = 'public.outreach_items'::regclass and conname = 'outreach_items_next_step_check') then
    raise exception 'ds_topups: the outreach item constraints are not the ones this migration expects';
  end if;
end $$;
create index outreach_items_minutes_idx on public.outreach_items (tenant_id) where status = 'waiting_for_minutes';
