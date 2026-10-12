-- Job CA (ADR 0081): GSTIN. The shop's own GSTIN and a customer's, validated (format, state code, check character) and stored; shown in orders and quotes; written to the accounting files.
--
--   * app.gstin_is_valid(text)       the 15 characters: a state code (01 to 38, 97, 99), the holder's PAN (five letters, four digits, a letter), an entity number (1 to 9, A to Z), the letter Z, and a
--                                    check character: Luhn mod 36 over the first 14 (every second character doubled from the right, the sum of the digits of each product in base 36, the check character
--                                    brings the total to a multiple of 36). Checked against three published example numbers (27AAPFU0939F1ZV, 29AAGCB7383J1Z4, 24AAACC1206D1ZM). It says a number is WELL FORMED,
--                                    never that the business exists or is active (only the taxpayer search of the GST portal says that).
--   * public.companies.gstin         the customer's GSTIN (nullable). PERSONAL DATA of a sole proprietor (it holds the proprietor's PAN): classified PII, kept out of the audit log by value, wiped by the
--                                    company-scope erasure, in the erasure registry.
--   * public.business_profile        one row per business: the shop's own GSTIN. Written only through public.business_profile_set (Owner or Admin, second factor); read by every member.
--   * app.erase_company              replaced as a FULL COPY of job BB's (20261111090000) plus one line: the company-scope erasure nulls the GSTIN. Pinned by test_migration_copies_ca.py.
--   * public.export_accounting_data  replaced as a FULL COPY of job BI's (20261114090000) plus three additions: each order and payment carries the customer's `gstin` (null for an erased customer) and the
--                                    result carries `shop_gstin`. Pinned by test_migration_copies_ca.py.
-- SQLSTATEs: 42501 deny, 22023 invalid, SM306 second factor needed.

create function app.gstin_is_valid(p text) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_alpha constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_sum integer := 0;
  v_f   integer := 2;
  v_p   integer;
  v_i   integer;
begin
  if p is null or p !~ '^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    return false;
  end if;
  for v_i in reverse 14..1 loop
    v_p := (position(substr(p, v_i, 1) in c_alpha) - 1) * v_f;
    v_sum := v_sum + v_p / 36 + v_p % 36;
    v_f := 3 - v_f;
  end loop;
  return substr(c_alpha, ((36 - v_sum % 36) % 36) + 1, 1) = substr(p, 15, 1);
end;
$$;
revoke all on function app.gstin_is_valid(text) from public;
grant execute on function app.gstin_is_valid(text) to authenticated;  -- a CHECK runs with the writer's rights (like app.text_is_clean)

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the customer's GSTIN
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.companies add column gstin text check (gstin is null or (app.gstin_is_valid(gstin) and app.text_is_clean(gstin)));
grant insert (gstin) on public.companies to authenticated;
grant update (gstin) on public.companies to authenticated;
comment on column public.companies.gstin is 'PII: the customer''s GST registration number; it contains the proprietor''s PAN. Audited by name only; nulled by the company-scope erasure';
drop trigger audit_companies on public.companies;
create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function app.audit_row_change('company', 'name,website,city,region,tags,gstin');
insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set, tenant_exempt) values
  ('companies', 'gstin', 'company', 'null', 'erased:1', null, true);
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('companies', 'gstin', 'sweep', 'substring', 'erased:1');

-- The company-scope erasure names its columns one by one, so the new column is added to it: a FULL COPY of job BB's app.erase_company (20261111090000) plus the one line for companies.gstin
-- (pinned by test_migration_copies_ca.py).
create or replace function app.erase_company(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  co public.companies;
  v_counts jsonb := '{}'::jsonb;
  v_patterns text[];
  v_name text;
  v_leads text;
  v_claims text;
  v_evidence text;
  v_enq text;
  v_fields text;
  v_keys constant text[] := array['name', 'website', 'city', 'region'];
  sw record;
  d record;
  n bigint;
begin
  select * into co from public.companies where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if co.erased_at is not null then
    return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
  end if;

  v_patterns := array_remove(array[app.erasure_host_pattern(co.website)], null);
  v_name := app.erasure_name(co.name);

  -- row selectors, over the alias t of the table being changed
  v_leads := format('t.company_id = %L', co.id);
  v_claims := format('(t.company_id = %1$L or t.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L))', co.id);
  v_evidence := format($f$t.id in (select k.evidence_id from public.evidence_links k where k.tenant_id = t.tenant_id and (
      k.company_id = %1$L
      or k.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)
      or k.claim_id in (select c.id from public.claims c where c.tenant_id = t.tenant_id and (
           c.company_id = %1$L or c.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)))))$f$, co.id);

  v_counts := app.erasure_add(v_counts, 'evidence.url',       app.erase_column(r.tenant_id, 'company', 'evidence', 'url',       v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.reference', app.erase_column(r.tenant_id, 'company', 'evidence', 'reference', v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.snippet',   app.erase_column(r.tenant_id, 'company', 'evidence', 'snippet',   v_evidence));
  v_counts := app.erasure_add(v_counts, 'claims.value',       app.erase_column(r.tenant_id, 'company', 'claims', 'value',       v_claims));
  v_counts := app.erasure_add(v_counts, 'leads.source',              app.erase_column(r.tenant_id, 'company', 'leads', 'source',              v_leads));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason', app.erase_column(r.tenant_id, 'company', 'leads', 'disqualified_reason', v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',       app.erase_column(r.tenant_id, 'company', 'opportunities', 'title',       v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason', app.erase_column(r.tenant_id, 'company', 'opportunities', 'lost_reason', v_leads));

  -- T008: the enquiries of this company's leads, and what was extracted from them
  v_enq := format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 't', co.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.company_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.company_id = %2$L))', 'e', co.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'company', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'company', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'company', 'requirement_fields', 'value_text', v_fields));

  -- job AT: the messages written to this company's leads, and the call requests about them
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'outbox_messages.gloss_en',  app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'gloss_en', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'company', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'company', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'company', 'call_requests', 'decision_note', v_enq));

  -- job AS: the store visits of this person's leads (what the visit was for, the note, why it was cancelled)
  v_counts := app.erasure_add(v_counts, 'store_visits.purpose', app.erase_column(r.tenant_id, 'company', 'store_visits', 'purpose', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.note', app.erase_column(r.tenant_id, 'company', 'store_visits', 'note', v_enq));
  v_counts := app.erasure_add(v_counts, 'store_visits.cancel_reason', app.erase_column(r.tenant_id, 'company', 'store_visits', 'cancel_reason', v_enq));

  v_counts := app.erasure_add(v_counts, 'companies.name',    app.erase_column(r.tenant_id, 'company', 'companies', 'name',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.website', app.erase_column(r.tenant_id, 'company', 'companies', 'website', format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.city',    app.erase_column(r.tenant_id, 'company', 'companies', 'city',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.region',  app.erase_column(r.tenant_id, 'company', 'companies', 'region',  format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.tags',    app.erase_column(r.tenant_id, 'company', 'companies', 'tags',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.gstin',   app.erase_column(r.tenant_id, 'company', 'companies', 'gstin',   format('t.id = %L', co.id)));
  update public.companies set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = co.id;

  -- audit rows written before the four identity columns were classified PII carry their values: remove those KEYS (nothing else)
  update public.audit_events a
     set old_values = a.old_values - v_keys, new_values = a.new_values - v_keys
   where a.tenant_id = r.tenant_id and a.entity_type = 'company' and a.entity_id = co.id
     and (a.old_values ?| v_keys or a.new_values ?| v_keys);
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'audit_events.values', n);

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  return jsonb_build_object('counts', v_counts, 'review', sw.o_review, 'review_truncated', sw.o_truncated);
end;
$$;
revoke all on function app.erase_company(public.erasure_requests) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the shop's own GSTIN
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.business_profile (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  gstin      text check (gstin is null or (app.gstin_is_valid(gstin) and app.text_is_clean(gstin))),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on column public.business_profile.gstin is 'SAFE: the shop''s own GST registration number, entered by its Owner and printed on its invoices';
comment on column public.business_profile.updated_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';
alter table public.business_profile enable row level security;
alter table public.business_profile force row level security;
revoke all on public.business_profile from public, anon, authenticated, service_role;
grant select on public.business_profile to authenticated;
create policy business_profile_select on public.business_profile for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create trigger business_profile_forbid_tenant_id_change before update on public.business_profile for each row execute function app.forbid_tenant_id_change();
create trigger audit_business_profile after insert or update or delete on public.business_profile
  for each row execute function app.audit_row_change('business_profile', '');

-- Set (or clear, with null) the shop's GSTIN. Owner or Admin with a second factor. A GSTIN that is not well formed is refused (22023). The text is normalised to capitals without spaces first.
create function public.business_profile_set(p_tenant_id uuid, p_gstin text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g text := nullif(upper(regexp_replace(coalesce(p_gstin, ''), '\s', '', 'g')), '');
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  if v_g is not null and not app.gstin_is_valid(v_g) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into public.business_profile (tenant_id, gstin, updated_by) values (p_tenant_id, v_g, auth.uid())
  on conflict (tenant_id) do update set gstin = excluded.gstin, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('gstin', v_g);
end;
$$;
revoke all on function public.business_profile_set(uuid, text) from public, anon;
grant execute on function public.business_profile_set(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the accounting export: a full copy of BI's with the GSTINs
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.export_accounting_data(p_tenant_id uuid, p_export_id uuid, p_format text, p_from date, p_to date) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_ts timestamptz;
  v_to_ts   timestamptz;
  v_orders  jsonb;
  v_pay     jsonb;
  v_n_ord   integer;
  v_n_pay   integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.integration_error('deny');
  end if;
  perform app.require_aal2();
  if p_export_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365
     or p_format is null or p_format not in ('tally_masters_xml', 'tally_vouchers_xml', 'tally_zip', 'vyapar_xlsx', 'csv', 'xlsx') then
    perform app.integration_error('invalid');
  end if;
  v_from_ts := (p_from::timestamp) at time zone 'Asia/Kolkata';
  v_to_ts   := ((p_to + 1)::timestamp) at time zone 'Asia/Kolkata';

  select count(*) into v_n_ord from public.orders o
   where o.tenant_id = p_tenant_id
     and o.state in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')
     and exists (select 1 from public.order_events e where e.tenant_id = o.tenant_id and e.order_id = o.id and e.type = 'customer_accept' and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts);
  select count(*) into v_n_pay from public.order_events e
   where e.tenant_id = p_tenant_id and e.type in ('record_payment', 'record_refund') and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts;
  if v_n_ord > 2000 or v_n_pay > 5000 then
    perform app.integration_error('too_large');
  end if;

  select coalesce(jsonb_agg(x.j order by x.accepted_at, x.order_no), '[]'::jsonb) into v_orders from (
    select a.accepted_at, o.order_no,
           jsonb_build_object(
             'order_id', o.id, 'order_no', o.order_no, 'state', o.state, 'accepted_at', a.accepted_at,
             'accepted_on', (a.accepted_at at time zone 'Asia/Kolkata')::date,
             'party', case when co.erased_at is not null then 'Erased customer' else coalesce(co.name, 'Walk-in customer') end,
             'city', case when co.erased_at is not null then null else co.city end,
             'gstin', case when co.erased_at is not null then null else co.gstin end,
             'quote_no', q.quote_no, 'delivery_state', q.delivery_state, 'gst_supply', q.gst_supply,
             'merchandise_net_paise', q.merchandise_net_paise, 'item_tax_paise', q.item_tax_paise,
             'shipping_net_paise', q.shipping_net_paise, 'shipping_tax_paise', q.shipping_tax_paise,
             'total_paise', o.order_total_paise, 'advance_paise', o.advance_paise,
             'lines', coalesce((select jsonb_agg(jsonb_build_object(
                          'line_no', l.line_no, 'sku', l.sku, 'name', l.name, 'sale_unit', l.sale_unit, 'qty', l.qty,
                          'unit_price_paise', l.unit_price_applied_paise, 'net_paise', l.net_paise, 'tax_paise', l.tax_paise, 'tax_bps', l.tax_bps) order by l.line_no)
                         from public.quote_lines l where l.tenant_id = o.tenant_id and l.quote_id = o.quote_id), '[]'::jsonb)) as j
      from public.orders o
      join public.quotes q on q.tenant_id = o.tenant_id and q.id = o.quote_id
      join lateral (select min(e.occurred_at) as accepted_at from public.order_events e
                     where e.tenant_id = o.tenant_id and e.order_id = o.id and e.type = 'customer_accept') a on a.accepted_at is not null
      left join public.leads ld on ld.tenant_id = o.tenant_id and ld.id = o.lead_id
      left join public.companies co on co.tenant_id = ld.tenant_id and co.id = ld.company_id
     where o.tenant_id = p_tenant_id
       and o.state in ('accepted', 'advance_requested', 'advance_paid', 'in_preparation', 'dispatched', 'delivered', 'closed_paid')
       and a.accepted_at >= v_from_ts and a.accepted_at < v_to_ts
  ) x;

  select coalesce(jsonb_agg(y.j order by y.occurred_at, y.order_no, y.seq), '[]'::jsonb) into v_pay from (
    select e.occurred_at, o.order_no, e.seq,
           jsonb_build_object(
             'payment_id', e.ledger_id, 'event_id', e.id, 'order_id', o.id, 'order_no', o.order_no,
             'kind', case e.type when 'record_payment' then 'payment' else 'refund' end,
             'amount_paise', e.amount_paise, 'occurred_at', e.occurred_at, 'occurred_on', (e.occurred_at at time zone 'Asia/Kolkata')::date,
             'party', case when co.erased_at is not null then 'Erased customer' else coalesce(co.name, 'Walk-in customer') end,
             'gstin', case when co.erased_at is not null then null else co.gstin end) as j
      from public.order_events e
      join public.orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
      left join public.leads ld on ld.tenant_id = o.tenant_id and ld.id = o.lead_id
      left join public.companies co on co.tenant_id = ld.tenant_id and co.id = ld.company_id
     where e.tenant_id = p_tenant_id and e.type in ('record_payment', 'record_refund') and e.occurred_at >= v_from_ts and e.occurred_at < v_to_ts
  ) y;

  -- the record of this export, in the same transaction as the read: who (the JWT subject, by the writer), when, which window and format, how many rows. No customer data in it.
  perform app.write_audit_event(
    p_tenant_id, 'export.create', 'data_export', p_export_id, null,
    jsonb_build_object('kind', 'accounting', 'format', p_format, 'from', p_from, 'to', p_to, 'orders', v_n_ord, 'payments', v_n_pay));

  return jsonb_build_object('from', p_from, 'to', p_to, 'shop_gstin', (select bp.gstin from public.business_profile bp where bp.tenant_id = p_tenant_id), 'orders', v_orders, 'payments', v_pay);
end;
$$;
revoke all on function public.export_accounting_data(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.export_accounting_data(uuid, uuid, text, date, date) to authenticated;
comment on function public.export_accounting_data(uuid, uuid, text, date, date) is 'Jobs BI and CA: the sales and payments of an India-date window for the accounting files, with the customers'' GSTINs and the shop''s own; Owner/Admin with a second factor; writes the export audit event in the same transaction.';
