-- Job CR (night run C1, ADR 0087), migration 3 of 4: FEES on job CP's shared ledger. A fee plan (heads, instalments with due dates, an optional late-fee rule) is assigned to a student; the assignment writes
-- the instalments as CHARGES on that student's own ledger account; payments get receipt numbers (R/2026-27/000001, the one series per business); concessions need a reason code and an Owner or Admin with a second
-- factor; a late fee is computed by a fixed rule and POSTED by an Owner or Admin with a second factor (nothing adds money to a parent's account on its own). Every amount comes from a plan or an entry a person
-- made, never from a model. Admitting an enquiry makes the student and (optionally) assigns the plan in one transaction.
--
--   public.ledger_accounts.student_id    a student has their OWN account (the ledger per student); the account is one of company, contact or student. A voided or erased student's account stays (money records).
--   public.fee_plans / fee_plan_lines    the plan for a programme (and optionally one group) in an academic year; changes only while nobody has been assigned it (then a new plan).
--   public.fee_assignments               a student's plan for an academic year (one live assignment per year); voiding it voids its charges.
--   Reminders (job CP): a guardian's students' accounts are ONE person in a campaign list built from the ledger (one message with the total, the earliest date); the recipient's `ledger_scope` says so
--   ('guardian'), and one helper (app.recipient_outstanding) answers "what is still owed" for both kinds. The functions that used the single account are REPLACED as FULL COPIES, listed in
--   services/ai-api/tests/test_migration_copies_cr.py with exactly the lines that differ.
--
-- Who: Owner, Admin and Sales read the plans, the ledgers and the receipts (a Viewer sees no money); Owner and Admin assign, void, give concessions and adjust (concessions, adjustments and late fees with a second
-- factor); Owner, Admin and Sales record payments. SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, 23505 id reused for another record, SM701 module off, SM813 the fee plan is in use,
-- SM814 the student already has a plan for that year, SM815 the student left or was erased, SM812 (admissions) the stage cannot change that way.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. a student has their own account
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.ledger_accounts add column student_id uuid;
alter table public.ledger_accounts add constraint ledger_accounts_student_fkey foreign key (tenant_id, student_id) references public.students (tenant_id, id);
alter table public.ledger_accounts drop constraint ledger_accounts_check;
alter table public.ledger_accounts add constraint ledger_accounts_party_check check (num_nonnulls(company_id, contact_id, student_id) = 1);
create unique index ledger_accounts_student_key on public.ledger_accounts (tenant_id, student_id) where student_id is not null;

alter table public.campaign_recipients add column ledger_scope text not null default 'account' check (ledger_scope in ('account', 'guardian'));
comment on column public.campaign_recipients.ledger_scope is 'SAFE: a closed word (account = the one ledger account; guardian = the accounts of a guardian''s students together). CLEAN-EXEMPT: closed CHECK list';

-- what is still owed by a recipient: the one account's balance, or, for a guardian, the balances of their students' accounts together
create function app.recipient_outstanding(p_tenant uuid, p_account uuid, p_contact uuid, p_scope text, p_as_of date) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_scope = 'guardian'
              then coalesce((select sum(app.ledger_outstanding(p_tenant, a.id, p_as_of)) from public.ledger_accounts a join public.students s on s.tenant_id = a.tenant_id and s.id = a.student_id
                              where a.tenant_id = p_tenant and s.contact_id = p_contact and s.erased_at is null), 0)::bigint
              else app.ledger_outstanding(p_tenant, p_account, p_as_of) end
$$;
revoke all on function app.recipient_outstanding(uuid, uuid, uuid, text, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the ledger functions that learn about students (FULL COPIES of job CP's, with the named changes)
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function app.ledger_record_core(uuid, uuid, uuid, text, text, uuid, uuid, date, date, bigint, text, text, text, text, uuid, uuid, text);
drop function app.ledger_account_of(uuid, uuid, uuid);

-- the account of a party (null when it has none yet): a company, a contact or a student
create function app.ledger_account_of(p_tenant uuid, p_company uuid, p_contact uuid, p_student uuid default null) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.ledger_accounts a
   where a.tenant_id = p_tenant and ((p_company is not null and a.company_id = p_company) or (p_contact is not null and a.contact_id = p_contact) or (p_student is not null and a.student_id = p_student))
$$;
revoke all on function app.ledger_account_of(uuid, uuid, uuid, uuid) from public;

create function app.ledger_record_core(
  p_actor uuid, p_entry_id uuid, p_tenant uuid, p_kind text, p_direction text, p_company uuid, p_contact uuid, p_entry_date date, p_due_date date, p_amount bigint,
  p_invoice_no text, p_reference text, p_method text, p_reason text, p_against uuid, p_order uuid, p_source text, p_student uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_no      text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
  v_old     public.ledger_entries;
  v_acc     uuid;
  v_target  public.ledger_entries;
  v_fy      text;
  v_seq     integer;
  v_rno     text;
  v_cons    text;
  v_today   date := app.dues_today();
begin
  if p_entry_id is null or p_kind is null or p_direction is null or p_entry_date is null or p_amount is null or p_source is null
     or num_nonnulls(p_company, p_contact, p_student) <> 1 or p_source not in ('manual', 'import') then
    perform app.dues_error('invalid');
  end if;
  if not ((p_kind = 'charge' and p_direction = 'debit') or (p_kind in ('payment', 'concession') and p_direction = 'credit') or (p_kind = 'adjustment' and p_direction in ('debit', 'credit'))) then
    perform app.dues_error('invalid');
  end if;
  if (p_direction = 'debit') <> (p_due_date is not null) or (p_due_date is not null and p_due_date < p_entry_date) then
    perform app.dues_error('invalid');
  end if;
  if (v_no is not null and p_kind <> 'charge') or (v_ref is not null and p_kind = 'payment') or ((p_kind = 'payment') <> (p_method is not null)) or ((p_kind in ('adjustment', 'concession')) <> (p_reason is not null)) then
    perform app.dues_error('invalid');
  end if;
  if p_kind <> 'charge' and p_entry_date > v_today + 1 then
    perform app.dues_error('invalid');  -- money received, a concession or an adjustment is never dated in the future
  end if;

  -- a retry: the same figures under the same id replay; other figures conflict
  select * into v_old from public.ledger_entries x where x.id = p_entry_id;
  if found then
    select a.id into v_acc from public.ledger_accounts a where a.id = v_old.account_id and a.tenant_id = p_tenant
       and a.company_id is not distinct from p_company and a.contact_id is not distinct from p_contact and a.student_id is not distinct from p_student;
    if v_old.tenant_id <> p_tenant or v_acc is null or v_old.kind <> p_kind or v_old.direction <> p_direction or v_old.entry_date <> p_entry_date or v_old.due_date is distinct from p_due_date
       or v_old.amount_paise <> p_amount or v_old.invoice_no is distinct from v_no or v_old.reference is distinct from v_ref or v_old.method is distinct from p_method
       or v_old.reason_code is distinct from p_reason or v_old.against_entry_id is distinct from p_against or v_old.order_id is distinct from p_order then
      perform app.dues_error('conflict');
    end if;
    return jsonb_build_object('entry_id', v_old.id, 'account_id', v_old.account_id, 'receipt_no', v_old.receipt_no, 'replayed', true);
  end if;

  if p_company is not null and not exists (select 1 from public.companies c where c.id = p_company and c.tenant_id = p_tenant and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_contact is not null and not exists (select 1 from public.contacts c where c.id = p_contact and c.tenant_id = p_tenant and c.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_student is not null and not exists (select 1 from public.students s where s.id = p_student and s.tenant_id = p_tenant and s.erased_at is null) then
    perform app.dues_error('reference');
  end if;
  if p_order is not null and not exists (select 1 from public.orders o where o.id = p_order and o.tenant_id = p_tenant) then
    perform app.dues_error('reference');
  end if;

  -- the account of this party (made on the first entry)
  v_acc := app.ledger_account_of(p_tenant, p_company, p_contact, p_student);
  if v_acc is null then
    begin
      insert into public.ledger_accounts (id, tenant_id, company_id, contact_id, student_id) values (gen_random_uuid(), p_tenant, p_company, p_contact, p_student) returning id into v_acc;
    exception when unique_violation then
      v_acc := app.ledger_account_of(p_tenant, p_company, p_contact, p_student);
    end;
  end if;
  if p_against is not null then
    select * into v_target from public.ledger_entries x where x.id = p_against and x.tenant_id = p_tenant and x.account_id = v_acc;
    if not found or (p_direction = 'credit' and v_target.direction <> 'debit') then
      perform app.dues_error('reference');
    end if;
  end if;

  if p_kind = 'payment' then
    -- the receipt number: one series per business per financial year, numbered in the order the receipts are made (a voided receipt keeps its number; a number is never reused)
    v_fy := app.ledger_fy(v_today);
    perform pg_advisory_xact_lock(hashtextextended('ledger-receipt:' || p_tenant::text || ':' || v_fy, 0));
    select coalesce(max(e.receipt_seq), 0) + 1 into v_seq from public.ledger_entries e where e.tenant_id = p_tenant and e.receipt_fy = v_fy;
    if v_seq > 999999 then
      perform app.dues_error('invalid');
    end if;
    v_rno := 'R/' || v_fy || '/' || lpad(v_seq::text, 6, '0');
  end if;

  begin
    insert into public.ledger_entries (id, tenant_id, account_id, kind, direction, amount_paise, entry_date, due_date, invoice_no, reference, method, reason_code, receipt_fy, receipt_seq, receipt_no,
                                       against_entry_id, order_id, source, recorded_by)
    values (p_entry_id, p_tenant, v_acc, p_kind, p_direction, p_amount, p_entry_date, p_due_date, v_no, v_ref, p_method, p_reason, case when v_rno is not null then v_fy end, v_seq, v_rno,
            p_against, p_order, p_source, p_actor);
  exception
    when check_violation then perform app.dues_error('invalid');
    when unique_violation then
      get stacked diagnostics v_cons = constraint_name;
      if v_cons = 'ledger_entries_invoice_no_key' then
        perform app.dues_error('number');
      end if;
      perform app.dues_error('conflict');
  end;
  return jsonb_build_object('entry_id', p_entry_id, 'account_id', v_acc, 'receipt_no', v_rno, 'replayed', false);
end;
$$;
revoke all on function app.ledger_record_core(uuid, uuid, uuid, text, text, uuid, uuid, date, date, bigint, text, text, text, text, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

create or replace function app.ledger_statement_json(p_tenant uuid, p_account uuid, p_as_of date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a         public.ledger_accounts;
  v_debits  bigint;
  v_credits bigint;
  v_pay     bigint;
  v_conc    bigint;
  v_adj     bigint;
  v_limit   bigint;
  v_out     bigint;
  v_b       jsonb;
  v_o       jsonb;
  v_overdue bigint;
  v_open    jsonb;
begin
  select * into a from public.ledger_accounts x where x.tenant_id = p_tenant and x.id = p_account;
  select coalesce(sum(e.amount_paise) filter (where e.direction = 'debit'), 0),
         coalesce(sum(e.amount_paise) filter (where e.direction = 'credit'), 0),
         coalesce(sum(e.amount_paise) filter (where e.kind = 'payment'), 0),
         coalesce(sum(e.amount_paise) filter (where e.kind = 'concession'), 0),
         coalesce(sum(case when e.kind = 'adjustment' and e.direction = 'debit' then e.amount_paise when e.kind = 'adjustment' then -e.amount_paise else 0 end), 0)
    into v_debits, v_credits, v_pay, v_conc, v_adj
    from public.ledger_entries e where e.tenant_id = p_tenant and e.account_id = p_account and e.voided_at is null and e.entry_date <= p_as_of;
  if a.company_id is not null then
    select l.limit_paise into v_limit from public.customer_credit_limits l where l.tenant_id = p_tenant and l.company_id = a.company_id;
  end if;
  select coalesce(sum(o.open_paise), 0),
         jsonb_build_object(
           'd0_30',    coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date <= 30), 0),
           'd31_60',   coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date between 31 and 60), 0),
           'd61_90',   coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date between 61 and 90), 0),
           'd90_plus', coalesce(sum(o.open_paise) filter (where p_as_of - o.entry_date > 90), 0)),
         jsonb_build_object(
           'not_due',  coalesce(sum(o.open_paise) filter (where o.due_date >= p_as_of), 0),
           'd1_30',    coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date between 1 and 30), 0),
           'd31_60',   coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date between 31 and 60), 0),
           'd61_90',   coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date between 61 and 90), 0),
           'd90_plus', coalesce(sum(o.open_paise) filter (where p_as_of - o.due_date > 90), 0)),
         coalesce(sum(o.open_paise) filter (where o.due_date < p_as_of), 0),
         coalesce(jsonb_agg(jsonb_build_object('invoice_id', o.entry_id, 'entry_id', o.entry_id, 'kind', o.kind, 'invoice_no', o.invoice_no, 'reference', o.reference,
                                               'invoice_date', o.entry_date, 'due_date', o.due_date, 'amount_paise', o.amount_paise, 'open_paise', o.open_paise,
                                               'age_days', p_as_of - o.entry_date, 'overdue_days', greatest(0, p_as_of - o.due_date)) order by o.entry_date, o.due_date, o.entry_id) filter (where o.open_paise > 0), '[]'::jsonb)
    into v_out, v_b, v_o, v_overdue, v_open
    from app.ledger_open_items(p_tenant, p_account, p_as_of) o;
  return jsonb_build_object(
    'account_id', p_account, 'company_id', a.company_id, 'contact_id', a.contact_id, 'student_id', a.student_id, 'as_of', p_as_of,
    'invoiced_paise', v_debits, 'paid_paise', v_credits, 'payments_paise', v_pay, 'concessions_paise', v_conc, 'adjustments_paise', v_adj,
    'outstanding_paise', v_out, 'credit_paise', greatest(0::bigint, v_credits - v_debits), 'overdue_paise', v_overdue,
    'ageing', v_b, 'overdue_ageing', v_o, 'open_invoices', v_open, 'credit_limit_paise', v_limit, 'over_limit', v_limit is not null and v_out > v_limit);
end;
$$;

create or replace function public.ledger_summary(p_tenant_id uuid, p_as_of date default null, p_limit integer default 50, p_after_paise bigint default null, p_after_id uuid default null, p_party text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
  v_out jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'dues');
  if p_limit is null or p_limit not between 1 and 100 or ((p_after_paise is null) <> (p_after_id is null)) or (p_party is not null and p_party not in ('company', 'contact')) then
    perform app.dues_error('invalid');
  end if;
  select coalesce(jsonb_agg(z.j || jsonb_build_object('party_kind', z.party_kind, 'party_name', z.party_name) order by z.out desc, z.acc desc), '[]'::jsonb) into v_out
    from (select a.id as acc, o.out, app.ledger_statement_json(p_tenant_id, a.id, v_day) as j,
                 case when a.company_id is not null then 'company' else 'contact' end as party_kind,
                 coalesce(co.name, ct.full_name) as party_name
            from public.ledger_accounts a
            left join public.companies co on co.tenant_id = a.tenant_id and co.id = a.company_id
            left join public.contacts ct on ct.tenant_id = a.tenant_id and ct.id = a.contact_id
            cross join lateral (select app.ledger_outstanding(p_tenant_id, a.id, v_day) as out) o
           where a.tenant_id = p_tenant_id and a.student_id is null and o.out > 0
             and (p_party is null or (p_party = 'company' and a.company_id is not null) or (p_party = 'contact' and a.contact_id is not null))
             and (p_after_paise is null or (o.out, a.id) < (p_after_paise, p_after_id))
           order by o.out desc, a.id desc
           limit p_limit) z;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. reminders: the runner, the call step, the results and the list from the ledger (FULL COPIES with the named changes)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.campaign_step_run(p_actor uuid, s public.campaign_steps) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_now  timestamptz := app.outbox_now();
  c      public.campaigns;
  r      public.campaign_recipients;
  ct     public.contacts;
  v_tpl  text;
  v_out  bigint;
  v_biz  text;
  v_id   uuid;
  v_res  jsonb;
begin
  select * into c from public.campaigns x where x.tenant_id = s.tenant_id and x.id = s.campaign_id for update;
  if c.status not in ('approved', 'running') then
    return 'skipped';  -- paused, cancelled or finished since the list was read
  end if;
  -- the campaign is still exactly what the Owner approved, or nothing is sent and it goes back to draft
  if app.campaign_content_sha(s.tenant_id, s.campaign_id) is distinct from c.content_sha256 then
    perform app.campaign_reset(s.tenant_id, s.campaign_id, 'content_changed');
    return 'reset';
  end if;
  select * into r from public.campaign_recipients x where x.tenant_id = s.tenant_id and x.id = s.recipient_id;
  -- a person who was closed (paid, wrong number, stopped) gets nothing more; a PROMISE silences only the reminders before its date (those were skipped when it was recorded), later ones still go
  if r.closed_at is not null and r.closed_reason <> 'promised' then
    perform app.campaign_step_skip(s.id, 'recipient_closed'); return 'skipped';
  end if;
  if s.scheduled_for < v_now - interval '24 hours' then
    perform app.campaign_step_skip(s.id, 'missed'); return 'skipped';
  end if;
  select w.status into v_tpl from integrations.wa_templates w where w.tenant_id = s.tenant_id and w.id = c.wa_template_id;
  if v_tpl is distinct from 'approved' then
    perform app.campaign_step_skip(s.id, 'template'); return 'skipped';
  end if;
  -- a list made from the LEDGER is checked against it again: paid since, or paid in part, is not reminded of the old amount
  if r.account_id is not null and r.amount_paise is not null then
    v_out := app.recipient_outstanding(s.tenant_id, r.account_id, r.contact_id, r.ledger_scope, app.dues_today());
    if v_out = 0 then
      perform app.campaign_step_skip(s.id, 'paid'); return 'skipped';
    elsif v_out < r.amount_paise then
      perform app.campaign_step_skip(s.id, 'balance_changed'); return 'skipped';
    end if;
  end if;
  select * into ct from public.contacts x where x.tenant_id = s.tenant_id and x.id = r.contact_id;
  select t.name into v_biz from public.tenants t where t.id = s.tenant_id;
  v_id := app.campaign_message_id(s.campaign_id, s.recipient_id, s.step_no, r.due_date);
  v_res := app.campaign_submit(p_actor, v_id, s.tenant_id, r.lead_id,
                               app.campaign_render(c.message_text, case when ct.erased_at is null then ct.full_name else '' end, r.amount_paise, r.due_date, r.reference, v_biz), c.language);
  update public.campaign_steps set status = 'submitted', outbox_message_id = v_id, materialised_at = v_now where id = s.id;
  if c.status = 'approved' then
    update public.campaigns set status = 'running' where id = c.id;
  end if;
  return case v_res ->> 'status' when 'queued' then 'queued' when 'needs_approval' then 'held' else 'blocked' end;
end;
$$;

create or replace function app.campaign_calls_run(p_actor uuid, p_tenant uuid, p_limit integer) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_now    timestamptz := app.outbox_now();
  v_made   integer := 0;
  x        record;
  v_req    uuid;
  v_sha    text;
  v_script text;
  v_biz    text;
  v_out    bigint;
begin
  select t.name into v_biz from public.tenants t where t.id = p_tenant;
  for x in
    select r.id as recipient_id, r.campaign_id, r.lead_id, r.contact_id, r.due_date, r.amount_paise, r.reference, r.account_id, r.ledger_scope, c.call_after_step, c.message_text, c.language, c.approved_by, ct.full_name
      from public.campaign_recipients r
      join public.campaigns c on c.tenant_id = r.tenant_id and c.id = r.campaign_id
      join public.campaign_steps s on s.tenant_id = r.tenant_id and s.recipient_id = r.id and s.step_no = c.call_after_step
      join public.outbox_messages m on m.tenant_id = s.tenant_id and m.id = s.outbox_message_id
      join public.contacts ct on ct.tenant_id = r.tenant_id and ct.id = r.contact_id
     where r.tenant_id = p_tenant and r.closed_at is null and c.status in ('approved', 'running') and c.call_after_step is not null and s.status = 'submitted'
       and m.status in ('sent', 'failed') and coalesce(m.sent_at, m.updated_at) + make_interval(hours => c.call_wait_hours) <= v_now
       and ct.erased_at is null and ct.suppressed_at is null and ct.phone is not null and ct.phone_consent <> 'withdrawn'
       and not exists (select 1 from public.call_list_items i where i.tenant_id = r.tenant_id and i.recipient_id = r.id)
       and not app.campaign_replied(r.tenant_id, r.lead_id, coalesce(m.sent_at, m.created_at))
     order by coalesce(m.sent_at, m.updated_at), r.id
     limit p_limit
       for update of r skip locked
  loop
    if x.account_id is not null then
      v_out := app.recipient_outstanding(p_tenant, x.account_id, x.contact_id, x.ledger_scope, app.dues_today());
      if v_out = 0 then
        update public.campaign_recipients set closed_at = v_now, closed_reason = 'paid' where id = x.recipient_id;
        update public.campaign_steps set status = 'skipped', reason = 'paid', materialised_at = v_now where tenant_id = p_tenant and recipient_id = x.recipient_id and status = 'planned';
        continue;
      end if;
    end if;
    v_req := gen_random_uuid();
    v_script := app.campaign_render(x.message_text, x.full_name, x.amount_paise, x.due_date, x.reference, v_biz);
    v_sha := encode(sha256(convert_to(concat_ws('|', x.lead_id, x.language, 'campaign', x.recipient_id, v_script), 'UTF8')), 'hex');
    insert into public.call_requests (id, tenant_id, lead_id, contact_id, company_id, reason, script_draft, language, status, request_sha256, requested_by, decided_by, decided_at, decision_note)
    select v_req, p_tenant, x.lead_id, x.contact_id, l.company_id, 'Reminder campaign: no reply, and not marked as paid, after step ' || x.call_after_step::text,
           v_script, x.language, 'approved', v_sha, p_actor, x.approved_by, v_now, 'approved with the campaign'
      from public.leads l where l.tenant_id = p_tenant and l.id = x.lead_id;
    insert into public.call_list_items (tenant_id, campaign_id, recipient_id, call_request_id, lead_id, contact_id, step_no)
    values (p_tenant, x.campaign_id, x.recipient_id, v_req, x.lead_id, x.contact_id, x.call_after_step);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;

create or replace function public.campaign_results(p_tenant_id uuid, p_campaign_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.campaigns;
  v_out    jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id;
  if not found then
    perform app.campaign_error('reference');
  end if;
  with st as (
    select s.recipient_id, s.scheduled_for,
           case when s.status = 'planned' then 'planned' when s.status = 'skipped' then 'skipped'
                when m.status = 'needs_approval' then 'held' when m.status = 'queued' then 'waiting'
                when m.status = 'sent' then case when w.status in ('delivered', 'read') then w.status else 'sent' end
                when m.status = 'failed' then 'failed' else 'blocked' end as state,
           case when s.status = 'skipped' then s.reason when m.status in ('blocked', 'needs_approval') then m.reason end as why,
           m.sent_at
      from public.campaign_steps s
      left join public.outbox_messages m on m.tenant_id = s.tenant_id and m.id = s.outbox_message_id
      left join integrations.wa_message_status w on w.tenant_id = s.tenant_id and w.message_id = s.outbox_message_id
     where s.tenant_id = p_tenant_id and s.campaign_id = p_campaign_id),
  states as (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) as j from (select state, count(*) as n from st group by state) x),
  reasons as (select coalesce(jsonb_object_agg(why, n), '{}'::jsonb) as j from (select why, count(*) as n from st where why is not null group by why) x),
  days as (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'states', stt) order by d), '[]'::jsonb) as j
             from (select y.d, jsonb_object_agg(y.state, y.n) as stt
                     from (select (scheduled_for at time zone 'Asia/Kolkata')::date as d, state, count(*) as n from st group by 1, 2) y group by y.d) z),
  first_sent as (select r.id, r.lead_id, r.account_id, r.contact_id, r.ledger_scope, r.amount_paise, r.closed_reason, min(st.sent_at) as at
                   from public.campaign_recipients r join st on st.recipient_id = r.id and st.sent_at is not null
                  where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id group by r.id),
  settled as (select f.*, (f.closed_reason = 'paid' or (f.account_id is not null and app.recipient_outstanding(p_tenant_id, f.account_id, f.contact_id, f.ledger_scope, app.dues_today()) = 0
                                                         and app.recipient_outstanding(p_tenant_id, f.account_id, f.contact_id, f.ledger_scope, (f.at at time zone 'Asia/Kolkata')::date) > 0)) as paid
                from first_sent f),
  closed as (select coalesce(jsonb_object_agg(closed_reason, n), '{}'::jsonb) as j
               from (select r.closed_reason, count(*) as n from public.campaign_recipients r
                      where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id and r.closed_reason is not null group by 1) x),
  calls as (select jsonb_build_object(
                     'open', count(*) filter (where i.status = 'open'), 'done', count(*) filter (where i.status = 'done'),
                     'outcomes', coalesce((select jsonb_object_agg(o.outcome, o.n) from (select i2.outcome, count(*) as n from public.call_list_items i2
                                            where i2.tenant_id = p_tenant_id and i2.campaign_id = p_campaign_id and i2.outcome is not null group by 1) o), '{}'::jsonb)) as j
              from public.call_list_items i where i.tenant_id = p_tenant_id and i.campaign_id = p_campaign_id)
  select jsonb_build_object(
           'campaign_id', c.id, 'status', c.status,
           'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id),
           'by_state', (select j from states), 'by_reason', (select j from reasons), 'by_day', (select j from days),
           'delivered_total', coalesce(((select j from states) ->> 'delivered')::int, 0) + coalesce(((select j from states) ->> 'read')::int, 0),
           'replied', (select count(*) from settled f where app.campaign_replied(p_tenant_id, f.lead_id, f.at)),
           'paid_after_reminder', jsonb_build_object('recipients', (select count(*) from settled where paid), 'amount_paise', (select coalesce(sum(amount_paise), 0) from settled where paid)),
           'closed', (select j from closed), 'calls', (select j from calls))
    into v_out;
  return v_out;
end;
$$;

create or replace function public.campaign_recipients_from_ledger(p_tenant_id uuid, p_campaign_id uuid, p_filter jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  c         public.campaigns;
  v_from    date;
  v_to      date;
  v_min     bigint;
  v_party   text;
  v_today   date := app.dues_today();
  a         record;
  v_contact uuid;
  v_lead    uuid;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_n       integer := 0;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or p_filter is null or jsonb_typeof(p_filter) <> 'object'
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  perform app.require_module(p_tenant_id, 'dues');
  begin
    v_from := (p_filter ->> 'due_from')::date;
    v_to := (p_filter ->> 'due_to')::date;
    v_min := coalesce(nullif(p_filter ->> 'min_open_paise', '')::bigint, 1);
  exception when others then
    perform app.campaign_error('invalid');
  end;
  v_party := p_filter ->> 'party';
  if v_from is null or v_to is null or v_to < v_from or v_to - v_from > 400 or v_min < 1 or (v_party is not null and v_party not in ('company', 'contact', 'student'))
     or exists (select 1 from jsonb_object_keys(p_filter) k where k not in ('due_from', 'due_to', 'min_open_paise', 'party')) then
    perform app.campaign_error('invalid');
  end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if not app.campaign_money_kind(c.kind) then
    perform app.campaign_error('invalid');  -- a ledger list is for the kinds that are about money
  end if;
  perform app.require_module(p_tenant_id, app.campaign_kind_module(c.kind));
  perform app.campaign_reset(p_tenant_id, p_campaign_id, 'list_changed');
  for a in
    -- one person per account, EXCEPT that the accounts of a guardian's students are one person: the guardian (one message, the total of the claims in the range, the earliest date)
    select (array_agg(g.account_id order by g.account_id))[1] as account_id, g.company_id, g.contact_id, g.is_student,
           sum(g.open_paise)::bigint as open_paise, min(g.due_date) as due_date,
           case when sum(g.claims) = 1 then max(g.ref) end as ref
      from (select acc.id as account_id, acc.company_id, coalesce(acc.contact_id, st.contact_id) as contact_id, acc.student_id is not null as is_student,
                   case when acc.student_id is not null then 'g:' || st.contact_id::text else 'a:' || acc.id::text end as party_key,
                   sum(o.open_paise)::bigint as open_paise, min(o.due_date) as due_date, count(*) as claims, max(coalesce(o.invoice_no, o.reference)) as ref
              from public.ledger_accounts acc
              left join public.students st on st.tenant_id = acc.tenant_id and st.id = acc.student_id and st.erased_at is null
              cross join lateral app.ledger_open_items(p_tenant_id, acc.id, v_today) o
             where acc.tenant_id = p_tenant_id and o.open_paise > 0 and o.due_date between v_from and v_to
               and (acc.student_id is null or st.id is not null)
               and (v_party is null or (v_party = 'company' and acc.company_id is not null) or (v_party = 'contact' and acc.contact_id is not null) or (v_party = 'student' and acc.student_id is not null))
             group by acc.id, acc.company_id, acc.contact_id, st.contact_id, acc.student_id) g
     group by g.party_key, g.company_id, g.contact_id, g.is_student
    having sum(g.open_paise) >= v_min
     order by min(g.due_date), (array_agg(g.account_id order by g.account_id))[1]
  loop
    v_n := v_n + 1;
    v_contact := null;
    if a.contact_id is not null then
      select ct.id into v_contact from public.contacts ct where ct.tenant_id = p_tenant_id and ct.id = a.contact_id and ct.erased_at is null and ct.suppressed_at is null and ct.phone is not null;
    else
      select ct.id into v_contact from public.contacts ct where ct.tenant_id = p_tenant_id and ct.company_id = a.company_id and ct.erased_at is null and ct.suppressed_at is null and ct.phone is not null
       order by ct.created_at, ct.id limit 1;
    end if;
    if v_contact is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_contact');
      continue;
    end if;
    if a.open_paise > 100000000 then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'amount_over_cap');
      continue;
    end if;
    v_lead := app.campaign_lead_for(p_tenant_id, v_contact);
    if v_lead is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_lead');
      continue;
    end if;
    begin
      insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, reference, account_id, ledger_scope, row_hash, created_by)
      values (p_tenant_id, p_campaign_id, v_contact, v_lead, a.due_date, a.open_paise, case when a.ref ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$' then a.ref end, a.account_id, case when a.is_student then 'guardian' else 'account' end,
              encode(sha256(convert_to(concat_ws('|', v_contact, a.due_date, a.open_paise::text, coalesce(a.ref, ''), a.account_id::text), 'UTF8')), 'hex'), v_uid);
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'duplicate');
    end;
  end loop;
  update public.campaigns set audience_kind = 'filter', audience_filter = p_filter where id = p_campaign_id;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped,
                            'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. fee plans, their lines, and assignments
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fee_plans (
  id                  uuid primary key,
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  name                text not null check (char_length(name) between 1 and 80 and app.text_is_clean(name) and not app.text_has_contact(name)),
  programme_id        uuid not null,
  group_id            uuid,
  academic_year       text not null check (academic_year ~ '^20[0-9]{2}-[0-9]{2}$'),
  late_fee_kind       text not null default 'none' check (late_fee_kind in ('none', 'fixed', 'per_day')),
  late_fee_paise      bigint check (late_fee_paise between 1 and 100000000),
  late_fee_grace_days smallint not null default 0 check (late_fee_grace_days between 0 and 60),
  late_fee_cap_paise  bigint check (late_fee_cap_paise between 1 and 1000000000),
  active              boolean not null default true,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, programme_id) references public.programmes (tenant_id, id),
  foreign key (tenant_id, programme_id, group_id) references public.programme_groups (tenant_id, programme_id, id),
  check ((late_fee_kind = 'none') = (late_fee_paise is null)),
  check (late_fee_cap_paise is null or late_fee_kind = 'per_day')
);
create unique index fee_plans_name_key on public.fee_plans (tenant_id, academic_year, lower(name));
create index fee_plans_programme_idx on public.fee_plans (tenant_id, programme_id, academic_year);
create index fee_plans_group_idx on public.fee_plans (tenant_id, programme_id, group_id) where group_id is not null;
create index fee_plans_keyset_idx on public.fee_plans (tenant_id, created_at desc, id);
comment on column public.fee_plans.name is 'SAFE: the institution''s name for a fee plan (Class 5 fees 2026-27); no person. Hygiene-checked, no phone or e-mail';
comment on column public.fee_plans.academic_year is 'SAFE: a year such as 2026-27. CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.fee_plans.late_fee_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.fee_plan_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  plan_id       uuid not null,
  head          text not null check (head in ('tuition', 'admission', 'transport', 'hostel', 'exam', 'books', 'other')),
  instalment_no smallint not null check (instalment_no between 1 and 24),
  due_date      date not null check (due_date between date '2020-01-01' and date '2100-12-31'),
  amount_paise  bigint not null check (amount_paise between 1 and 100000000),
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, plan_id, head, instalment_no),
  foreign key (tenant_id, plan_id) references public.fee_plans (tenant_id, id)
);
create index fee_plan_lines_plan_idx on public.fee_plan_lines (tenant_id, plan_id, due_date, instalment_no);
create index fee_plan_lines_keyset_idx on public.fee_plan_lines (tenant_id, created_at desc, id);
comment on column public.fee_plan_lines.head is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.fee_assignments (
  id            uuid primary key,
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  student_id    uuid not null,
  plan_id       uuid not null,
  academic_year text not null check (academic_year ~ '^20[0-9]{2}-[0-9]{2}$'),
  assigned_on   date not null,
  assigned_by   uuid not null,
  created_at    timestamptz not null default now(),
  voided_at     timestamptz,
  voided_by     uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  foreign key (tenant_id, plan_id) references public.fee_plans (tenant_id, id),
  check ((voided_at is null) = (voided_by is null))
);
create unique index fee_assignments_live_key on public.fee_assignments (tenant_id, student_id, academic_year) where voided_at is null;
create index fee_assignments_plan_idx on public.fee_assignments (tenant_id, plan_id);
create index fee_assignments_keyset_idx on public.fee_assignments (tenant_id, created_at desc, id);
comment on column public.fee_assignments.academic_year is 'SAFE: a year such as 2026-27. CLEAN-EXEMPT: strict pattern in a CHECK';

do $$
declare t text;
begin
  foreach t in array array['fee_plans', 'fee_plan_lines', 'fee_assignments'] loop
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$I for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger module_guard before insert on public.%I for each row execute function app.module_guard(%L)', t, 'fees');
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'', ''sales'']::public.app_role[])))::uuid[]))', t);
  end loop;
end $$;
create trigger fee_plans_set_updated_at before update on public.fee_plans for each row execute function app.set_updated_at();
create trigger audit_fee_plans after insert or update or delete on public.fee_plans for each row execute function app.audit_row_change('fee_plan', '');
create trigger audit_fee_plan_lines after insert or update or delete on public.fee_plan_lines for each row execute function app.audit_row_change('fee_plan_line', '');
create trigger audit_fee_assignments after insert or update or delete on public.fee_assignments for each row execute function app.audit_row_change('fee_assignment', '');

-- a plan's lines change only through fee_plan_save (which sets the door below) and only while nobody has been assigned the plan; an assignment changes only to be voided
create function app.fee_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'fee records are never truncated' using errcode = '42501';
  end if;
  if tg_table_name = 'fee_plan_lines' then
    if tg_op = 'UPDATE' then
      raise exception 'a fee plan line is replaced, never changed' using errcode = '42501';
    end if;
    if coalesce(nullif(current_setting('app.fee_plan_edit', true), ''), '') <> (case when tg_op = 'DELETE' then old.plan_id else new.plan_id end)::text then
      raise exception 'fee plan lines change only through fee_plan_save' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  elsif tg_table_name = 'fee_assignments' then
    if tg_op = 'DELETE' or old.voided_at is not null or (to_jsonb(new) - 'voided_at' - 'voided_by') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by') then
      raise exception 'a fee assignment changes only by being voided, once' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'fee plans are never deleted: make them inactive' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.edu_edit', true), '') <> 'on' then
    raise exception 'fee plans change only through their functions' using errcode = '42501';
  end if;
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'a fee plan keeps its id, its author and its creation time' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.fee_rows_guard() from public;
create trigger fee_plans_guard before update or delete on public.fee_plans for each row execute function app.fee_rows_guard();
create trigger fee_plans_no_truncate before truncate on public.fee_plans for each statement execute function app.fee_rows_guard();
create trigger fee_plan_lines_guard before insert or update or delete on public.fee_plan_lines for each row execute function app.fee_rows_guard();
create trigger fee_plan_lines_no_truncate before truncate on public.fee_plan_lines for each statement execute function app.fee_rows_guard();
create trigger fee_assignments_guard before update or delete on public.fee_assignments for each row execute function app.fee_rows_guard();
create trigger fee_assignments_no_truncate before truncate on public.fee_assignments for each statement execute function app.fee_rows_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. fee plans: save, read, list
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.fee_plan_json(p public.fee_plans, p_lines boolean) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'programme_id', p.programme_id, 'group_id', p.group_id, 'academic_year', p.academic_year,
    'late_fee_kind', p.late_fee_kind, 'late_fee_paise', p.late_fee_paise, 'late_fee_grace_days', p.late_fee_grace_days, 'late_fee_cap_paise', p.late_fee_cap_paise,
    'active', p.active, 'created_at', p.created_at,
    'total_paise', (select coalesce(sum(l.amount_paise), 0) from public.fee_plan_lines l where l.tenant_id = p.tenant_id and l.plan_id = p.id),
    'assigned', (select count(*) from public.fee_assignments a where a.tenant_id = p.tenant_id and a.plan_id = p.id and a.voided_at is null))
  || case when p_lines then jsonb_build_object('lines', coalesce((select jsonb_agg(jsonb_build_object('head', l.head, 'instalment_no', l.instalment_no, 'due_date', l.due_date, 'amount_paise', l.amount_paise)
                                                                   order by l.due_date, l.instalment_no, l.head) from public.fee_plan_lines l where l.tenant_id = p.tenant_id and l.plan_id = p.id), '[]'::jsonb))
          else '{}'::jsonb end
$$;
revoke all on function app.fee_plan_json(public.fee_plans, boolean) from public, anon, authenticated, service_role;

-- Make or change a plan (Owner, Admin). `p_lines` is the WHOLE list [{head, instalment_no, due_date, amount_paise}]; it replaces the old one. Once a student has been assigned the plan it can no longer change (SM813):
-- make a new plan. An exact repeat replays.
create function public.fee_plan_save(
  p_plan_id uuid, p_tenant_id uuid, p_name text, p_programme_id uuid, p_group_id uuid, p_academic_year text, p_late_fee_kind text, p_late_fee_paise bigint, p_late_fee_grace_days integer,
  p_late_fee_cap_paise bigint, p_active boolean, p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_old  public.fee_plans;
  p      public.fee_plans;
  l      jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_plan_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  if char_length(v_name) not between 1 and 80 or p_programme_id is null or p_academic_year is null or p_late_fee_kind is null or p_late_fee_grace_days is null or p_active is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    perform app.edu_error('invalid');
  end if;
  if not exists (select 1 from public.programmes pr where pr.id = p_programme_id and pr.tenant_id = p_tenant_id)
     or (p_group_id is not null and not exists (select 1 from public.programme_groups g where g.id = p_group_id and g.tenant_id = p_tenant_id and g.programme_id = p_programme_id)) then
    perform app.edu_error('reference');
  end if;
  select * into v_old from public.fee_plans x where x.id = p_plan_id for update;
  if found and v_old.tenant_id <> p_tenant_id then
    perform app.edu_error('conflict');
  end if;
  if found and exists (select 1 from public.fee_assignments a where a.tenant_id = p_tenant_id and a.plan_id = p_plan_id) then
    raise exception 'the fee plan is in use: make a new plan' using errcode = 'SM813';
  end if;
  begin
    if not found then
      insert into public.fee_plans (id, tenant_id, name, programme_id, group_id, academic_year, late_fee_kind, late_fee_paise, late_fee_grace_days, late_fee_cap_paise, active, created_by)
      values (p_plan_id, p_tenant_id, v_name, p_programme_id, p_group_id, p_academic_year, p_late_fee_kind, p_late_fee_paise, p_late_fee_grace_days, p_late_fee_cap_paise, p_active, v_uid) returning * into p;
    else
      perform app.edu_edit(true);
      update public.fee_plans
         set name = v_name, programme_id = p_programme_id, group_id = p_group_id, academic_year = p_academic_year, late_fee_kind = p_late_fee_kind, late_fee_paise = p_late_fee_paise,
             late_fee_grace_days = p_late_fee_grace_days, late_fee_cap_paise = p_late_fee_cap_paise, active = p_active, updated_by = v_uid
       where id = p_plan_id returning * into p;
      perform app.edu_edit(false);
    end if;
    perform set_config('app.fee_plan_edit', p_plan_id::text, true);
    delete from public.fee_plan_lines where tenant_id = p_tenant_id and plan_id = p_plan_id;
    for l in select value from jsonb_array_elements(p_lines) loop
      if jsonb_typeof(l) <> 'object' or exists (select 1 from jsonb_object_keys(l) k where k not in ('head', 'instalment_no', 'due_date', 'amount_paise')) then
        perform app.edu_error('invalid');
      end if;
      insert into public.fee_plan_lines (tenant_id, plan_id, head, instalment_no, due_date, amount_paise)
      values (p_tenant_id, p_plan_id, l ->> 'head', (l ->> 'instalment_no')::int, (l ->> 'due_date')::date, (l ->> 'amount_paise')::bigint);
    end loop;
    perform set_config('app.fee_plan_edit', '', true);
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or null_value_not_allowed then
      perform set_config('app.fee_plan_edit', '', true);
      perform app.edu_error('invalid');
    when unique_violation then
      perform set_config('app.fee_plan_edit', '', true);
      perform app.edu_error('conflict');
  end;
  return app.fee_plan_json(p, true);
end;
$$;
revoke all on function public.fee_plan_save(uuid, uuid, text, uuid, uuid, text, text, bigint, integer, bigint, boolean, jsonb) from public, anon;
grant execute on function public.fee_plan_save(uuid, uuid, text, uuid, uuid, text, text, bigint, integer, bigint, boolean, jsonb) to authenticated;

create function public.fee_plan_get(p_tenant_id uuid, p_plan_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.fee_plans;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  select * into p from public.fee_plans x where x.id = p_plan_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.edu_error('reference');
  end if;
  return app.fee_plan_json(p, true);
end;
$$;
revoke all on function public.fee_plan_get(uuid, uuid) from public, anon;
grant execute on function public.fee_plan_get(uuid, uuid) to authenticated;

create function public.fee_plans_list(p_tenant_id uuid, p_programme_id uuid default null, p_include_inactive boolean default false) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) or p_include_inactive is null then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  return coalesce((select jsonb_agg(app.fee_plan_json(x, false) order by x.academic_year desc, x.name, x.id)
                     from public.fee_plans x where x.tenant_id = p_tenant_id and (p_programme_id is null or x.programme_id = p_programme_id) and (p_include_inactive or x.active)), '[]'::jsonb);
end;
$$;
revoke all on function public.fee_plans_list(uuid, uuid, boolean) from public, anon;
grant execute on function public.fee_plans_list(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. assigning a plan: the instalments become charges on the student's account
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.fee_label(p_head text, p_no integer) returns text
language sql
immutable
set search_path = ''
as $$ select initcap(p_head) || ' ' || p_no::text $$;
revoke all on function app.fee_label(text, integer) from public;

-- The charge ids are derived from the assignment and the line, so a retry (or a second click) writes nothing twice.
create function app.fee_charge_id(p_assignment uuid, p_head text, p_no integer) returns uuid
language sql
immutable
set search_path = ''
as $$ select app.agent_derived_id(p_assignment, 'line-' || p_head || '-' || p_no::text, 'fee_charge') $$;
revoke all on function app.fee_charge_id(uuid, text, integer) from public;

-- Assign a plan to a student (Owner, Admin). The plan must be for the student's programme (and group, when it names one); one live plan per student per academic year (SM814).
create function public.fee_assign(p_assignment_id uuid, p_tenant_id uuid, p_student_id uuid, p_plan_id uuid, p_assigned_on date default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := app.dues_today();
  v_day   date := coalesce(p_assigned_on, app.dues_today());
  v_old   public.fee_assignments;
  s       public.students;
  p       public.fee_plans;
  l       public.fee_plan_lines;
  v_n     integer := 0;
  v_total bigint := 0;
begin
  if v_uid is null or p_tenant_id is null or p_assignment_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  perform app.require_module(p_tenant_id, 'dues');
  if p_student_id is null or p_plan_id is null or v_day > v_today + 1 or v_day < date '2020-01-01' then
    perform app.edu_error('invalid');
  end if;
  select * into v_old from public.fee_assignments x where x.id = p_assignment_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.student_id <> p_student_id or v_old.plan_id <> p_plan_id then
      perform app.edu_error('conflict');
    end if;
    return jsonb_build_object('assignment_id', v_old.id, 'student_id', v_old.student_id, 'plan_id', v_old.plan_id, 'voided', v_old.voided_at is not null, 'replayed', true);
  end if;
  select * into s from public.students x where x.id = p_student_id and x.tenant_id = p_tenant_id for update;
  select * into p from public.fee_plans x where x.id = p_plan_id and x.tenant_id = p_tenant_id;
  if s.id is null or p.id is null then
    perform app.edu_error('reference');
  end if;
  if s.erased_at is not null or s.status <> 'active' then
    perform app.edu_error('ineligible');
  end if;
  if not p.active or p.programme_id <> s.programme_id or (p.group_id is not null and p.group_id is distinct from s.group_id) then
    perform app.edu_error('invalid');
  end if;
  if exists (select 1 from public.fee_assignments a where a.tenant_id = p_tenant_id and a.student_id = p_student_id and a.academic_year = p.academic_year and a.voided_at is null) then
    raise exception 'the student already has a fee plan for that year' using errcode = 'SM814';
  end if;
  insert into public.fee_assignments (id, tenant_id, student_id, plan_id, academic_year, assigned_on, assigned_by) values (p_assignment_id, p_tenant_id, p_student_id, p_plan_id, p.academic_year, v_day, v_uid);
  for l in select * from public.fee_plan_lines x where x.tenant_id = p_tenant_id and x.plan_id = p_plan_id order by x.due_date, x.instalment_no, x.head loop
    perform app.ledger_record_core(v_uid, app.fee_charge_id(p_assignment_id, l.head, l.instalment_no), p_tenant_id, 'charge', 'debit', null, null, least(v_day, l.due_date), l.due_date, l.amount_paise,
                                   null, app.fee_label(l.head, l.instalment_no), null, null, null, null, 'manual', p_student_id);
    v_n := v_n + 1;
    v_total := v_total + l.amount_paise;
  end loop;
  return jsonb_build_object('assignment_id', p_assignment_id, 'student_id', p_student_id, 'plan_id', p_plan_id, 'charges', v_n, 'total_paise', v_total, 'replayed', false);
end;
$$;
revoke all on function public.fee_assign(uuid, uuid, uuid, uuid, date) from public, anon;
grant execute on function public.fee_assign(uuid, uuid, uuid, uuid, date) to authenticated;

-- Void an assignment (a mistake): its charges are voided (a payment already received stays and becomes a credit on the account). Owner, Admin.
create function public.fee_assignment_void(p_tenant_id uuid, p_assignment_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a     public.fee_assignments;
  l     public.fee_plan_lines;
  v_n   integer := 0;
begin
  if v_uid is null or p_tenant_id is null or p_assignment_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  select * into a from public.fee_assignments x where x.id = p_assignment_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.edu_error('reference');
  end if;
  if a.voided_at is not null then
    perform app.dues_error('voided');
  end if;
  for l in select * from public.fee_plan_lines x where x.tenant_id = p_tenant_id and x.plan_id = a.plan_id loop
    update public.ledger_entries set voided_at = now(), voided_by = v_uid
     where tenant_id = p_tenant_id and id = app.fee_charge_id(a.id, l.head, l.instalment_no) and voided_at is null;
    v_n := v_n + 1;
  end loop;
  update public.fee_assignments set voided_at = now(), voided_by = v_uid where id = a.id;
  return jsonb_build_object('assignment_id', a.id, 'voided', true, 'charges_voided', v_n);
end;
$$;
revoke all on function public.fee_assignment_void(uuid, uuid) from public, anon;
grant execute on function public.fee_assignment_void(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. money in and money adjusted on a student's ledger
-- ---------------------------------------------------------------------------------------------------------------------------------
-- A payment (Owner, Admin, Sales). The receipt number comes from the one series of the business. Credits go to the OLDEST claim first; `p_against_entry_id` records which charge it was meant for.
create function public.fee_payment_record(
  p_entry_id uuid, p_tenant_id uuid, p_student_id uuid, p_received_on date, p_amount_paise bigint, p_method text, p_against_entry_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_entry_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  perform app.require_module(p_tenant_id, 'dues');
  if p_student_id is null or p_received_on is null or p_amount_paise is null or p_method is null then
    perform app.dues_error('invalid');
  end if;
  r := app.ledger_record_core(v_uid, p_entry_id, p_tenant_id, 'payment', 'credit', null, null, p_received_on, null, p_amount_paise, null, null, p_method, null, p_against_entry_id, null, 'manual', p_student_id);
  return jsonb_build_object('entry_id', r -> 'entry_id', 'receipt_no', r -> 'receipt_no', 'replayed', r -> 'replayed');
end;
$$;
revoke all on function public.fee_payment_record(uuid, uuid, uuid, date, bigint, text, uuid) from public, anon;
grant execute on function public.fee_payment_record(uuid, uuid, uuid, date, bigint, text, uuid) to authenticated;

-- A concession (Owner, Admin, second factor): an amount, or a percentage of the fees charged to the student's account (never more than what was charged, concessions together). A reason code is required.
create function public.fee_concession_apply(
  p_entry_id uuid, p_tenant_id uuid, p_student_id uuid, p_mode text, p_value bigint, p_reason_code text, p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_acc     uuid;
  v_charged bigint;
  v_given   bigint;
  v_amount  bigint;
  r         jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_entry_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  perform app.require_module(p_tenant_id, 'dues');
  perform app.require_aal2();
  if p_student_id is null or p_mode is null or p_mode not in ('amount', 'percent') or p_value is null or p_value < 1 or (p_mode = 'percent' and p_value > 100)
     or p_reason_code is null or p_reason_code not in ('scholarship', 'sibling', 'staff_ward', 'hardship', 'merit', 'other') then
    perform app.dues_error('invalid');
  end if;
  if exists (select 1 from public.ledger_entries x where x.id = p_entry_id and x.tenant_id = p_tenant_id) then
    -- a retry: the core compares the figures; for a percentage the figure is the amount it came to, so let it compare what it stored
    select e.amount_paise into v_amount from public.ledger_entries e where e.id = p_entry_id and e.tenant_id = p_tenant_id;
  else
    v_acc := app.ledger_account_of(p_tenant_id, null, null, p_student_id);
    if v_acc is null then
      perform app.dues_error('reference');
    end if;
    select coalesce(sum(e.amount_paise) filter (where e.kind = 'charge'), 0), coalesce(sum(e.amount_paise) filter (where e.kind = 'concession'), 0)
      into v_charged, v_given from public.ledger_entries e where e.tenant_id = p_tenant_id and e.account_id = v_acc and e.voided_at is null;
    v_amount := case p_mode when 'amount' then p_value else (v_charged * p_value + 50) / 100 end;
    if v_amount < 1 or v_given + v_amount > v_charged then
      perform app.dues_error('invalid');
    end if;
  end if;
  r := app.ledger_record_core(v_uid, p_entry_id, p_tenant_id, 'concession', 'credit', null, null, app.dues_today(), null, v_amount, null, nullif(btrim(coalesce(p_reference, '')), ''), null, p_reason_code, null, null, 'manual', p_student_id);
  return jsonb_build_object('entry_id', r -> 'entry_id', 'amount_paise', v_amount, 'replayed', r -> 'replayed');
end;
$$;
revoke all on function public.fee_concession_apply(uuid, uuid, uuid, text, bigint, text, text) from public, anon;
grant execute on function public.fee_concession_apply(uuid, uuid, uuid, text, bigint, text, text) to authenticated;

-- An adjustment (Owner, Admin, second factor): a correction up (a debit with a due date) or down (a credit), with a reason code.
create function public.fee_adjustment_record(
  p_entry_id uuid, p_tenant_id uuid, p_student_id uuid, p_direction text, p_amount_paise bigint, p_reason_code text, p_due_date date default null, p_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := app.dues_today();
  r       jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_entry_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  perform app.require_module(p_tenant_id, 'dues');
  perform app.require_aal2();
  if p_student_id is null or p_direction is null or p_direction not in ('debit', 'credit') or p_amount_paise is null or p_reason_code is null or p_reason_code not in ('correction', 'waiver', 'rounding', 'other')
     or (p_direction = 'debit') <> (p_due_date is not null) then
    perform app.dues_error('invalid');
  end if;
  r := app.ledger_record_core(v_uid, p_entry_id, p_tenant_id, 'adjustment', p_direction, null, null, v_today, p_due_date, p_amount_paise, null, nullif(btrim(coalesce(p_reference, '')), ''), null, p_reason_code, null, null, 'manual', p_student_id);
  return jsonb_build_object('entry_id', r -> 'entry_id', 'replayed', r -> 'replayed');
end;
$$;
revoke all on function public.fee_adjustment_record(uuid, uuid, uuid, text, bigint, text, date, text) from public, anon;
grant execute on function public.fee_adjustment_record(uuid, uuid, uuid, text, bigint, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. late fees: a fixed rule, computed here, posted by a person
-- ---------------------------------------------------------------------------------------------------------------------------------
-- For every open instalment charge more than `late_fee_grace_days` past its due date, on a plan that has a rule: `fixed` = the amount once; `per_day` = days late times the amount, never above the cap. What was
-- posted before (a live late-fee adjustment against that charge) is taken off, so the rule can be run again and again. Each row has a derived entry id (the same row on the same day is the same entry).
create function app.fee_late_fee_rows(p_tenant uuid, p_as_of date)
returns table (student_id uuid, account_id uuid, charge_id uuid, entry_id uuid, amount_paise bigint, days_late integer)
language sql
stable
security definer
set search_path = ''
as $$
  select z.student_id, z.account_id, z.charge_id, z.entry_id, z.amount, z.days_late
    from (
      select s.id as student_id, a.id as account_id, o.entry_id as charge_id,
             app.agent_derived_id(o.entry_id, 'late-' || case fp.late_fee_kind when 'fixed' then 'fixed' else p_as_of::text end, 'fee_late') as entry_id,
             (case fp.late_fee_kind when 'fixed' then fp.late_fee_paise
                   else least(coalesce(fp.late_fee_cap_paise, 9000000000000000000::bigint), (p_as_of - (o.due_date + fp.late_fee_grace_days::int))::bigint * fp.late_fee_paise) end
              - coalesce(posted.total, 0))::bigint as amount,
             (p_as_of - (o.due_date + fp.late_fee_grace_days::int))::integer as days_late
        from public.ledger_accounts a
        join public.students s on s.tenant_id = a.tenant_id and s.id = a.student_id and s.erased_at is null
        join public.fee_assignments fa on fa.tenant_id = a.tenant_id and fa.student_id = s.id and fa.voided_at is null
        join public.fee_plans fp on fp.tenant_id = fa.tenant_id and fp.id = fa.plan_id and fp.late_fee_kind <> 'none'
        cross join lateral app.ledger_open_items(p_tenant, a.id, p_as_of) o
        left join lateral (select sum(e.amount_paise) as total from public.ledger_entries e
                            where e.tenant_id = a.tenant_id and e.account_id = a.id and e.kind = 'adjustment' and e.direction = 'debit' and e.reason_code = 'late_fee'
                              and e.voided_at is null and e.against_entry_id = o.entry_id) posted on true
       where a.tenant_id = p_tenant and o.kind = 'charge' and o.open_paise > 0 and p_as_of > o.due_date + fp.late_fee_grace_days::int) z
   where z.amount >= 1
$$;
revoke all on function app.fee_late_fee_rows(uuid, date) from public, anon, authenticated, service_role;

create function public.fee_late_fees_preview(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := app.dues_today();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  return jsonb_build_object('as_of', v_day,
    'count', (select count(*) from app.fee_late_fee_rows(p_tenant_id, v_day)),
    'total_paise', (select coalesce(sum(r.amount_paise), 0) from app.fee_late_fee_rows(p_tenant_id, v_day) r),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('student_id', r.student_id, 'charge_id', r.charge_id, 'amount_paise', r.amount_paise, 'days_late', r.days_late) order by r.days_late desc, r.student_id, r.charge_id)
                        from (select * from app.fee_late_fee_rows(p_tenant_id, v_day) order by days_late desc, student_id, charge_id limit 200) r), '[]'::jsonb));
end;
$$;
revoke all on function public.fee_late_fees_preview(uuid) from public, anon;
grant execute on function public.fee_late_fees_preview(uuid) to authenticated;

-- Post the late fees the rule gives today (Owner, Admin, second factor). A late fee is a debit adjustment against its instalment, due today.
create function public.fee_late_fees_post(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_day   date := app.dues_today();
  r       record;
  v_n     integer := 0;
  v_total bigint := 0;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  perform app.require_module(p_tenant_id, 'dues');
  perform app.require_aal2();
  for r in select * from app.fee_late_fee_rows(p_tenant_id, v_day) order by student_id, charge_id loop
    if exists (select 1 from public.ledger_entries x where x.id = r.entry_id) then
      continue;
    end if;
    perform app.ledger_record_core(v_uid, r.entry_id, p_tenant_id, 'adjustment', 'debit', null, null, v_day, v_day, r.amount_paise, null, 'Late fee', null, 'late_fee', r.charge_id, null, 'manual', r.student_id);
    v_n := v_n + 1;
    v_total := v_total + r.amount_paise;
  end loop;
  return jsonb_build_object('as_of', v_day, 'posted', v_n, 'total_paise', v_total);
end;
$$;
revoke all on function public.fee_late_fees_post(uuid) from public, anon;
grant execute on function public.fee_late_fees_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. reading a student's ledger, a receipt, a guardian's total
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.fee_statement(p_tenant_id uuid, p_student_id uuid, p_as_of date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
  v_acc uuid;
  s     public.students;
begin
  if auth.uid() is null or p_tenant_id is null or p_student_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  select * into s from public.students x where x.id = p_student_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.dues_error('reference');
  end if;
  v_acc := app.ledger_account_of(p_tenant_id, null, null, p_student_id);
  return jsonb_build_object('student', app.student_json(s),
    'assignment', (select jsonb_build_object('id', a.id, 'plan_id', a.plan_id, 'academic_year', a.academic_year, 'assigned_on', a.assigned_on, 'plan_name', fp.name)
                     from public.fee_assignments a join public.fee_plans fp on fp.tenant_id = a.tenant_id and fp.id = a.plan_id
                    where a.tenant_id = p_tenant_id and a.student_id = p_student_id and a.voided_at is null order by a.assigned_on desc limit 1),
    'statement', case when v_acc is null then app.ledger_empty_statement_json(null, null, v_day) || jsonb_build_object('student_id', p_student_id)
                      else app.ledger_statement_json(p_tenant_id, v_acc, v_day) end);
end;
$$;
revoke all on function public.fee_statement(uuid, uuid, date) from public, anon;
grant execute on function public.fee_statement(uuid, uuid, date) to authenticated;

create function public.fee_entries_list(p_tenant_id uuid, p_student_id uuid, p_limit integer default 100) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_acc uuid;
begin
  if auth.uid() is null or p_tenant_id is null or p_student_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  if p_limit is null or p_limit not between 1 and 500 then
    perform app.dues_error('invalid');
  end if;
  if not exists (select 1 from public.students x where x.id = p_student_id and x.tenant_id = p_tenant_id) then
    perform app.dues_error('reference');
  end if;
  v_acc := app.ledger_account_of(p_tenant_id, null, null, p_student_id);
  return jsonb_build_object('account_id', v_acc, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'direction', e.direction, 'amount_paise', e.amount_paise, 'entry_date', e.entry_date, 'due_date', e.due_date,
                                        'reference', e.reference, 'method', e.method, 'reason_code', e.reason_code, 'receipt_no', e.receipt_no, 'against_entry_id', e.against_entry_id,
                                        'source', e.source, 'voided', e.voided_at is not null) order by e.entry_date desc, e.id desc)
      from (select * from public.ledger_entries x where x.tenant_id = p_tenant_id and x.account_id = v_acc order by x.entry_date desc, x.id desc limit p_limit) e), '[]'::jsonb));
end;
$$;
revoke all on function public.fee_entries_list(uuid, uuid, integer) from public, anon;
grant execute on function public.fee_entries_list(uuid, uuid, integer) to authenticated;

-- A fee receipt, ready to print or to send: the number, the date, the amount, the method, who paid (the guardian), for whom (the student, the programme), what it was set against, the balance after. No model.
create function public.fee_receipt_get(p_tenant_id uuid, p_entry_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e   public.ledger_entries;
  s   public.students;
  v_biz text;
  v_ref text;
begin
  if auth.uid() is null or p_tenant_id is null or p_entry_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  select x.* into e from public.ledger_entries x join public.ledger_accounts a on a.tenant_id = x.tenant_id and a.id = x.account_id
   where x.id = p_entry_id and x.tenant_id = p_tenant_id and x.kind = 'payment' and a.student_id is not null;
  if not found then
    perform app.dues_error('reference');
  end if;
  select st.* into s from public.students st join public.ledger_accounts a on a.tenant_id = st.tenant_id and a.student_id = st.id where a.id = e.account_id;
  select t.name into v_biz from public.tenants t where t.id = p_tenant_id;
  select t.reference into v_ref from public.ledger_entries t where t.id = e.against_entry_id and t.tenant_id = p_tenant_id;
  return jsonb_build_object('receipt_no', e.receipt_no, 'received_on', e.entry_date, 'amount_paise', e.amount_paise, 'method', e.method, 'voided', e.voided_at is not null,
                            'business_name', v_biz, 'paid_by', (select case when c.erased_at is null then c.full_name end from public.contacts c where c.tenant_id = s.tenant_id and c.id = s.contact_id),
                            'student', app.student_json(s), 'against', v_ref,
                            'balance_after_paise', app.ledger_outstanding(p_tenant_id, e.account_id, e.entry_date), 'recorded_at', e.recorded_at);
end;
$$;
revoke all on function public.fee_receipt_get(uuid, uuid) from public, anon;
grant execute on function public.fee_receipt_get(uuid, uuid) to authenticated;

-- What one guardian (or adult student) owes across all their students: each student's balance and what is overdue, and the totals.
create function public.fee_guardian_statement(p_tenant_id uuid, p_contact_id uuid, p_as_of date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_as_of, app.dues_today());
  v_rows jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_contact_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.dues_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'fees');
  if not exists (select 1 from public.contacts c where c.id = p_contact_id and c.tenant_id = p_tenant_id) then
    perform app.dues_error('reference');
  end if;
  select coalesce(jsonb_agg(z.j order by z.n, z.id), '[]'::jsonb) into v_rows
    from (select s.id, s.created_at as n,
                 jsonb_build_object('student_id', s.id, 'display_name', app.student_json(s) -> 'display_name', 'outstanding_paise', coalesce(app.ledger_outstanding(p_tenant_id, a.id, v_day), 0),
                                    'overdue_paise', coalesce((select sum(o.open_paise) from app.ledger_open_items(p_tenant_id, a.id, v_day) o where o.due_date < v_day), 0)) as j
            from public.students s left join public.ledger_accounts a on a.tenant_id = s.tenant_id and a.student_id = s.id
           where s.tenant_id = p_tenant_id and s.contact_id = p_contact_id and s.erased_at is null) z;
  return jsonb_build_object('contact_id', p_contact_id, 'as_of', v_day, 'students', v_rows,
                            'outstanding_paise', (select coalesce(sum((e ->> 'outstanding_paise')::bigint), 0) from jsonb_array_elements(v_rows) e),
                            'overdue_paise', (select coalesce(sum((e ->> 'overdue_paise')::bigint), 0) from jsonb_array_elements(v_rows) e));
end;
$$;
revoke all on function public.fee_guardian_statement(uuid, uuid, date) from public, anon;
grant execute on function public.fee_guardian_statement(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. admitted: the enquiry becomes a student (and the plan is assigned), in one transaction
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Owner, Admin. The guardian is the enquiry's contact (an adult student IS that contact). `p_plan_id` is optional: with it the plan is assigned (needs the fees module). An exact repeat of an admission that
-- already happened replays.
create function public.admission_admit(
  p_tenant_id uuid, p_admission_id uuid, p_student_id uuid, p_is_adult boolean, p_child_label text, p_programme_id uuid, p_group_id uuid, p_admission_no text,
  p_plan_id uuid default null, p_assignment_id uuid default null, p_joined_on date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a     public.admissions;
  v_st  jsonb;
  v_as  jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_admission_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.edu_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'programmes');
  if p_student_id is null or (p_plan_id is null) <> (p_assignment_id is null) then
    perform app.edu_error('invalid');
  end if;
  select * into a from public.admissions x where x.id = p_admission_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.edu_error('reference');
  end if;
  if a.stage = 'admitted' then
    if a.student_id <> p_student_id then
      perform app.edu_error('conflict');
    end if;
    return app.admission_json(a) || jsonb_build_object('replayed', true);
  end if;
  if a.stage = 'lost' then
    perform app.admission_stage_error();
  end if;
  v_st := public.student_save(p_student_id, p_tenant_id, a.contact_id, p_is_adult, p_child_label, p_programme_id, p_group_id, p_admission_no, null, p_joined_on);
  if p_plan_id is not null then
    v_as := public.fee_assign(p_assignment_id, p_tenant_id, p_student_id, p_plan_id, p_joined_on);
  end if;
  perform app.edu_edit(true);
  update public.admissions set stage = 'admitted', lost_reason = null, student_id = p_student_id, stage_at = now(), programme_id = coalesce(programme_id, p_programme_id), updated_by = v_uid where id = a.id returning * into a;
  perform app.edu_edit(false);
  insert into public.admission_events (tenant_id, admission_id, stage, created_by) values (p_tenant_id, a.id, 'admitted', v_uid);
  return app.admission_json(a) || jsonb_build_object('replayed', false, 'student_created', v_st -> 'created', 'fee_assignment', v_as);
end;
$$;
revoke all on function public.admission_admit(uuid, uuid, uuid, boolean, text, uuid, uuid, text, uuid, uuid, date) from public, anon;
grant execute on function public.admission_admit(uuid, uuid, uuid, boolean, text, uuid, uuid, text, uuid, uuid, date) to authenticated;
