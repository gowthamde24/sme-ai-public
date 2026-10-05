-- T008 / commit 1: enquiries, requirements and requirement fields (docs/plans/t008-requirement-agent.md).
--
--   * app.text_has_contact(text): the database half of the contact scrubber (owner change A). It uses the SAME two regular expressions as
--     services/ai-api/app/requirements/scrub.py (a test fails when they drift apart) and is a CHECK on enquiries.subject / body: text that
--     still holds an e-mail address or an Indian mobile number is refused (23514), even from a client that skips the API.
--   * public.enquiries: a captured enquiry (an e-mail or WhatsApp text pasted by a human, ALREADY scrubbed; the original is kept nowhere).
--     Immutable except archived_at (and the registered erasure columns). company_id / contact_id are copied from the lead by a trigger, so
--     erasure can find the enquiries of a contact or a company. retain_until is the hook for a later retention rule (unused in T008).
--   * public.requirements / public.requirement_fields: what an agent proposed and a human decided. Written ONLY by the SECURITY DEFINER
--     functions of the next migration (no client write grant). The database re-checks the shape of every typed value
--     (app.requirement_value_ok), against the closed vocabularies (app.requirement_vocab) and the quote engine's operational bounds
--     (owner change H: quantity 1..10,000, per-piece budget <= INR 1,000,000, total budget <= INR 10,000,000, net days 0..180).
--   * agent_runs.enquiry_id: a third kind of target (exactly one of company, lead, enquiry).
--   * erasure: the four free-text PII columns are registered for the tenant, contact, company and sweep scopes, and erase_contact /
--     erase_company reach them (bodies are the previous definitions plus the enquiry / field lines).
-- Questions are NOT stored: they are derived at read time from the flags (owner change E).

-- ---------------------------------------------------------------------------------------------
-- The contact guard (same patterns as app/requirements/scrub.py)
-- ---------------------------------------------------------------------------------------------
create function app.text_has_contact(p text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is not null and (
    p ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+'
    or p ~* '(?<![A-Za-z0-9₹#/])(?<![0-9][,.])(?<!rs\ )(?<!rs\.)(?<!rs\.\ )(?<!rs:)(?<!rs:\ )(?<!rs\-)(?<!rs\-\ )(?<!rs\#)(?<!rs\#\ )(?<!inr\ )(?<!inr\.)(?<!inr\.\ )(?<!inr:)(?<!inr:\ )(?<!inr\-)(?<!inr\-\ )(?<!inr\#)(?<!inr\#\ )(?<!rupees\ )(?<!rupees\.)(?<!rupees\.\ )(?<!rupees:)(?<!rupees:\ )(?<!rupees\-)(?<!rupees\-\ )(?<!rupees\#)(?<!rupees\#\ )(?<!rupee\ )(?<!rupee\.)(?<!rupee\.\ )(?<!rupee:)(?<!rupee:\ )(?<!rupee\-)(?<!rupee\-\ )(?<!rupee\#)(?<!rupee\#\ )(?<!po\ )(?<!po\.)(?<!po\.\ )(?<!po:)(?<!po:\ )(?<!po\-)(?<!po\-\ )(?<!po\#)(?<!po\#\ )(?<!ref\ )(?<!ref\.)(?<!ref\.\ )(?<!ref:)(?<!ref:\ )(?<!ref\-)(?<!ref\-\ )(?<!ref\#)(?<!ref\#\ )(?<!inv\ )(?<!inv\.)(?<!inv\.\ )(?<!inv:)(?<!inv:\ )(?<!inv\-)(?<!inv\-\ )(?<!inv\#)(?<!inv\#\ )(?<!invoice\ )(?<!invoice\.)(?<!invoice\.\ )(?<!invoice:)(?<!invoice:\ )(?<!invoice\-)(?<!invoice\-\ )(?<!invoice\#)(?<!invoice\#\ )(?<!order\ )(?<!order\.)(?<!order\.\ )(?<!order:)(?<!order:\ )(?<!order\-)(?<!order\-\ )(?<!order\#)(?<!order\#\ )(?<!no\ )(?<!no\.)(?<!no\.\ )(?<!no:)(?<!no:\ )(?<!no\-)(?<!no\-\ )(?<!no\#)(?<!no\#\ )(?<!gst\ )(?<!gst\.)(?<!gst\.\ )(?<!gst:)(?<!gst:\ )(?<!gst\-)(?<!gst\-\ )(?<!gst\#)(?<!gst\#\ )(?<!gstin\ )(?<!gstin\.)(?<!gstin\.\ )(?<!gstin:)(?<!gstin:\ )(?<!gstin\-)(?<!gstin\-\ )(?<!gstin\#)(?<!gstin\#\ )(?<!pin\ )(?<!pin\.)(?<!pin\.\ )(?<!pin:)(?<!pin:\ )(?<!pin\-)(?<!pin\-\ )(?<!pin\#)(?<!pin\#\ )(?<!amt\ )(?<!amt\.)(?<!amt\.\ )(?<!amt:)(?<!amt:\ )(?<!amt\-)(?<!amt\-\ )(?<!amt\#)(?<!amt\#\ )(?<!amount\ )(?<!amount\.)(?<!amount\.\ )(?<!amount:)(?<!amount:\ )(?<!amount\-)(?<!amount\-\ )(?<!amount\#)(?<!amount\#\ )(?<!total\ )(?<!total\.)(?<!total\.\ )(?<!total:)(?<!total:\ )(?<!total\-)(?<!total\-\ )(?<!total\#)(?<!total\#\ )(?<!qty\ )(?<!qty\.)(?<!qty\.\ )(?<!qty:)(?<!qty:\ )(?<!qty\-)(?<!qty\-\ )(?<!qty\#)(?<!qty\#\ )(?<!₹\ )(?<!₹\.)(?<!₹\.\ )(?<!₹:)(?<!₹:\ )(?<!₹\-)(?<!₹\-\ )(?<!₹\#)(?<!₹\#\ )(?:(?:\+91|91|0)[ -]?[6-9][0-9]{4}[ -]?[0-9]{5}|[6-9][0-9]{9}|(?![6-9][0-9]{2}00[ -][0-9]{3}00(?![0-9]))[6-9][0-9]{4}[ -][0-9]{5})(?![A-Za-z0-9]|[,.][0-9]{1,3}(?![0-9]))')
$$;
revoke all on function app.text_has_contact(text) from public;
grant execute on function app.text_has_contact(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Types and the closed vocabularies (placeholders for the family to replace; app/requirements/vocabulary.py must equal them)
-- ---------------------------------------------------------------------------------------------
create type public.enquiry_channel         as enum ('email', 'whatsapp', 'form', 'other');
create type public.requirement_status      as enum ('draft', 'confirmed', 'superseded', 'discarded');
create type public.requirement_field_key   as enum ('saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms');
create type public.requirement_certainty   as enum ('stated', 'implied', 'ambiguous');
create type public.requirement_field_state as enum ('proposed', 'confirmed', 'corrected', 'rejected');

create function app.requirement_vocab(p_key text) returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_key
    when 'saree_type' then array['kanjivaram', 'banarasi', 'mysore_silk', 'paithani', 'dharmavaram_pattu', 'patola', 'chanderi', 'other']
    when 'fabric' then array['silk', 'cotton_silk', 'tussar', 'organza', 'georgette', 'crepe', 'cotton', 'other']
    when 'colour' then array['red', 'maroon', 'pink', 'orange', 'yellow', 'green', 'blue', 'navy', 'purple', 'black', 'white', 'cream', 'gold', 'silver', 'brown', 'grey', 'other']
    when 'payment_terms' then array['advance_full', 'advance_partial', 'net_days', 'cash_on_delivery']
  end
$$;
revoke all on function app.requirement_vocab(text) from public;
grant execute on function app.requirement_vocab(text) to authenticated;

-- The shape of one field's typed value. Caps are the quote engine's operational bounds (docs/plans/t009-quote-engine.md):
-- quantity per line 1..10,000; per-piece budget <= 100,000,000 paise; total budget <= 1,000,000,000 paise; net days 0..180; advance 1..9,999 bps.
create function app.requirement_value_ok(
  p_key text, p_line smallint, p_code text, p_int bigint, p_date date, p_text text, p_basis text
) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(case p_key
    when 'saree_type' then p_line between 1 and 5 and p_code = any (app.requirement_vocab('saree_type'))
                           and p_int is null and p_date is null and p_text is null and p_basis is null
    when 'fabric'     then p_line between 1 and 5 and p_code = any (app.requirement_vocab('fabric'))
                           and p_int is null and p_date is null and p_text is null and p_basis is null
    when 'colour'     then p_line between 1 and 5 and p_code = any (app.requirement_vocab('colour'))
                           and p_int is null and p_date is null and p_text is null and p_basis is null
    when 'quantity'   then p_line between 1 and 5 and p_code is null and p_int between 1 and 10000
                           and p_date is null and p_text is null and p_basis in ('piece', 'set')
    when 'budget'     then p_line is null and p_code is null and p_date is null and p_text is null
                           and ((p_basis = 'per_piece' and p_int between 1 and 100000000)
                             or (p_basis = 'total' and p_int between 1 and 1000000000))
    when 'deadline'   then p_line is null and p_code is null and p_int is null and p_text is null and p_basis is null
                           and p_date between date '2020-01-01' and date '2100-01-01'
    when 'delivery_city' then p_line is null and p_code is null and p_int is null and p_date is null and p_basis is null
                           and char_length(btrim(p_text)) between 1 and 60
    when 'payment_terms' then p_line is null and p_date is null and p_text is null
                           and ((p_code in ('advance_full', 'cash_on_delivery') and p_int is null and p_basis is null)
                             or (p_code = 'advance_partial' and p_int between 1 and 9999 and p_basis = 'bps')
                             or (p_code = 'net_days' and p_int between 0 and 180 and p_basis = 'days'))
  end, false)
$$;
revoke all on function app.requirement_value_ok(text, smallint, text, bigint, date, text, text) from public;
grant execute on function app.requirement_value_ok(text, smallint, text, bigint, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- enquiries
-- ---------------------------------------------------------------------------------------------
create table public.enquiries (
  id             uuid primary key,
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  lead_id        uuid not null,
  -- copied from the lead by the trigger below (never client-writable)
  company_id     uuid,
  contact_id     uuid,
  channel        public.enquiry_channel not null,
  -- when the enquiry reached us, as stated by the human who captured it
  received_at    timestamptz not null check (received_at >= timestamptz '2020-01-01'),
  subject        text check (char_length(subject) <= 200 and app.text_is_clean(subject) and not app.text_has_contact(subject)),
  body           text not null check (char_length(body) between 1 and 6000 and btrim(body, E' \t\r\n') <> ''
                                      and app.text_is_clean(body) and not app.text_has_contact(body)),
  body_sha256    text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  -- the original length when the paste was longer than 6,000 characters and was cut
  truncated_from integer check (truncated_from is null or truncated_from > 6000),
  -- the hook for a later retention rule: a new function and job, not a table change. Unused in T008, never client-writable.
  retain_until   timestamptz,
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  archived_at    timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id)    references public.leads (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
create index enquiries_tenant_created_idx on public.enquiries (tenant_id, created_at desc, id);
create index enquiries_lead_idx           on public.enquiries (tenant_id, lead_id, created_at desc);
create index enquiries_company_idx        on public.enquiries (tenant_id, company_id) where company_id is not null;
create index enquiries_contact_idx        on public.enquiries (tenant_id, contact_id) where contact_id is not null;
create index enquiries_retain_idx         on public.enquiries (tenant_id, retain_until) where retain_until is not null;

-- company / contact come from the lead; the hash is of the stored (scrubbed) body; the received time may not be in the future.
create function app.enquiry_set_context() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  l public.leads;
begin
  select * into l from public.leads where id = new.lead_id and tenant_id = new.tenant_id;
  new.company_id := l.company_id;
  new.contact_id := l.contact_id;
  new.body_sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
  if new.received_at > now() + interval '5 minutes' then
    raise exception 'received_at must not be in the future'
      using errcode = '23514', constraint = 'enquiries_received_at_not_future', table = 'enquiries', schema = 'public';
  end if;
  return new;
end;
$$;
revoke all on function app.enquiry_set_context() from public;
create trigger enquiries_set_context before insert on public.enquiries
  for each row execute function app.enquiry_set_context();

-- ---------------------------------------------------------------------------------------------
-- requirements (one per extraction run) and requirement_fields
-- ---------------------------------------------------------------------------------------------
create table public.requirements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  enquiry_id     uuid not null,
  agent_run_id   uuid,
  status         public.requirement_status not null default 'draft',
  schema_version smallint not null default 1 check (schema_version = 1),
  confirmed_by   uuid,
  confirmed_at   timestamptz,
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, enquiry_id)   references public.enquiries (tenant_id, id),
  foreign key (tenant_id, agent_run_id) references public.agent_runs (tenant_id, id),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check ((status = 'confirmed') = (confirmed_by is not null))
);
-- at most one ACTIVE requirement per enquiry: a new run supersedes a draft; a confirmed one is replaced only after a human discards it
create unique index requirements_one_active_key on public.requirements (tenant_id, enquiry_id) where status in ('draft', 'confirmed');
create index requirements_tenant_created_idx on public.requirements (tenant_id, created_at desc, id);
create index requirements_enquiry_idx        on public.requirements (tenant_id, enquiry_id, created_at desc);
create index requirements_run_idx            on public.requirements (tenant_id, agent_run_id) where agent_run_id is not null;

create table public.requirement_fields (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  requirement_id uuid not null,
  -- null = an order-level field; 1..5 = an order line
  line_no        smallint,
  field_key      public.requirement_field_key not null,
  value_code     text check (app.text_is_clean(value_code)),
  value_int      bigint,
  value_date     date,
  value_text     text check (app.text_is_clean(value_text)),
  basis          text check (app.text_is_clean(basis)),
  certainty      public.requirement_certainty not null,
  -- what the enquiry says (a quote of the stored text) and where; the database checks the span against the enquiry body (next migration)
  quote          text not null check (char_length(quote) between 1 and 300 and btrim(quote, E' \t\r\n') <> '' and app.text_is_clean(quote)),
  quote_start    integer not null check (quote_start >= 0),
  quote_end      integer not null,
  state          public.requirement_field_state not null default 'proposed',
  decided_by     uuid,
  decided_at     timestamptz,
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, requirement_id) references public.requirements (tenant_id, id),
  check (quote_end > quote_start and quote_end - quote_start <= 1200),
  check (app.requirement_value_ok(field_key::text, line_no, value_code, value_int, value_date, value_text, basis)),
  check ((state = 'proposed') = (decided_at is null)),
  check ((decided_at is null) = (decided_by is null))
);
create unique index requirement_fields_slot_key on public.requirement_fields (tenant_id, requirement_id, coalesce(line_no, 0), field_key);
create index requirement_fields_tenant_created_idx on public.requirement_fields (tenant_id, created_at desc, id);

-- ---------------------------------------------------------------------------------------------
-- agent_runs: a third kind of target
-- ---------------------------------------------------------------------------------------------
alter table public.agent_runs add column enquiry_id uuid;
alter table public.agent_runs add constraint agent_runs_enquiry_fk foreign key (tenant_id, enquiry_id) references public.enquiries (tenant_id, id);
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.agent_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%num_nonnulls(company_id, lead_id)%';
  execute format('alter table public.agent_runs drop constraint %I', v_name);
end $$;
alter table public.agent_runs add constraint agent_runs_one_target check (num_nonnulls(company_id, lead_id, enquiry_id) = 1);
create index agent_runs_enquiry_idx on public.agent_runs (tenant_id, enquiry_id) where enquiry_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
create trigger enquiries_forbid_tenant_id_change before update on public.enquiries for each row execute function app.forbid_tenant_id_change();
create trigger enquiries_set_created_meta        before insert or update on public.enquiries for each row execute function app.set_created_meta();
create trigger enquiries_guard_archive           before update on public.enquiries for each row execute function app.guard_archive();
create trigger enquiries_guard_immutable         before update on public.enquiries for each row execute function app.guard_immutable_record();

do $$
declare t text;
begin
  foreach t in array array['requirements', 'requirement_fields'] loop
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function app.set_updated_at()', t);
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$s for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger %1$s_set_created_meta before insert or update on public.%1$s for each row execute function app.set_created_meta()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Column classification (read by the audit and erasure guards). UNTRUSTED text is data, never instructions.
-- ---------------------------------------------------------------------------------------------
comment on column public.enquiries.subject     is 'PII: UNTRUSTED subject line of a captured enquiry, contact details already removed; it can name a person. Audited by name only; anonymised by the erasure scopes';
comment on column public.enquiries.body        is 'PII: UNTRUSTED text of a captured enquiry, contact details already removed (app.text_has_contact); it can name a person. Audited by name only; anonymised by the erasure scopes';
comment on column public.enquiries.body_sha256 is 'SAFE: sha256 of the stored (scrubbed) body, set by a trigger. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.requirement_fields.value_code is 'SAFE: a code of a closed vocabulary (app.requirement_vocab) or a payment-terms code';
comment on column public.requirement_fields.value_text is 'PII: the delivery city as the enquiry wrote it (a location can identify a person). Audited by name only; anonymised by the erasure scopes';
comment on column public.requirement_fields.basis      is 'SAFE: unit or basis of a typed value (piece, set, per_piece, total, days, bps), fixed by app.requirement_value_ok';
comment on column public.requirement_fields.quote      is 'PII: UNTRUSTED words of the enquiry that support the value; it can name a person. Audited by name only; anonymised by the erasure scopes';

create trigger audit_enquiries         after insert or update or delete on public.enquiries
  for each row execute function app.audit_row_change('enquiry', 'subject,body');
create trigger audit_requirements      after insert or update or delete on public.requirements
  for each row execute function app.audit_row_change('requirement');
create trigger audit_requirement_fields after insert or update or delete on public.requirement_fields
  for each row execute function app.audit_row_change('requirement_field', 'quote,value_text');

-- ---------------------------------------------------------------------------------------------
-- RLS: enabled and forced; read = any member; enquiries are written by Owner / Admin / Sales (insert) and archived by Owner / Admin;
-- requirements and fields are written ONLY by the definer functions of the next migration. Nobody deletes.
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['enquiries', 'requirements', 'requirement_fields'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy enquiries_insert on public.enquiries for insert to authenticated
  with check (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy enquiries_update on public.enquiries for update to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]))
  with check (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
-- absent on purpose: company_id, contact_id, body_sha256, retain_until, created_by / via / at (server-owned); every content column on UPDATE
grant insert (id, tenant_id, lead_id, channel, received_at, subject, body, truncated_from) on public.enquiries to authenticated;
grant update (archived_at) on public.enquiries to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Erasure (ADR 0014): the four free-text PII columns, in every scope
-- ---------------------------------------------------------------------------------------------
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('enquiries',          'subject',    'tenant',  'tombstone', 'erased:1'),
  ('enquiries',          'body',       'tenant',  'tombstone', 'erased:1'),
  ('requirement_fields', 'quote',      'tenant',  'tombstone', 'erased:1'),
  ('requirement_fields', 'value_text', 'tenant',  'tombstone', 'erased:1'),
  ('enquiries',          'subject',    'sweep',   'substring', 'erased:1'),
  ('enquiries',          'body',       'sweep',   'substring', 'erased:1'),
  ('requirement_fields', 'quote',      'sweep',   'substring', 'erased:1'),
  ('requirement_fields', 'value_text', 'sweep',   'substring', 'erased:1'),
  ('enquiries',          'subject',    'contact', 'tombstone', 'erased:1'),
  ('enquiries',          'body',       'contact', 'tombstone', 'erased:1'),
  ('requirement_fields', 'quote',      'contact', 'tombstone', 'erased:1'),
  ('requirement_fields', 'value_text', 'contact', 'tombstone', 'erased:1'),
  ('enquiries',          'subject',    'company', 'tombstone', 'erased:1'),
  ('enquiries',          'body',       'company', 'tombstone', 'erased:1'),
  ('requirement_fields', 'quote',      'company', 'tombstone', 'erased:1'),
  ('requirement_fields', 'value_text', 'company', 'tombstone', 'erased:1');

create or replace function app.erase_contact(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
  v_counts jsonb := '{}'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_patterns text[];
  v_name text;
  v_phone_digits text;
  v_enq text;
  v_fields text;
  sw record;
  d record;
  n bigint;
begin
  select * into c from public.contacts where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if c.erased_at is not null then
    -- nothing identifying is left to search for
    return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', false);
  end if;

  -- The last Owner cannot erase their own record: ownership is transferred first. An exception goes through the operator, after the
  -- person's identity was verified out of band, with a recorded reason (app.operator_add_owner_exception; docs/runbooks/sole-owner-erasure.md).
  -- The Owner's identity is their sign-in address; the comparison ignores case.
  if c.email is not null
     and (select count(*) from public.memberships m where m.tenant_id = r.tenant_id and m.role = 'owner') = 1
     and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                  where m.tenant_id = r.tenant_id and m.role = 'owner' and lower(u.email) = lower(c.email)) then
    perform app.erasure_state_error('SM305');
  end if;

  -- what identifies the person, taken BEFORE the row is anonymised
  v_patterns := array_remove(array[app.erasure_email_pattern(c.email), app.erasure_phone_pattern(c.phone)], null);
  v_name := app.erasure_name(c.full_name);
  v_phone_digits := nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '');

  v_counts := app.erasure_add(v_counts, 'contacts.full_name', app.erase_column(r.tenant_id, 'contact', 'contacts', 'full_name', format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.email',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'email',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.phone',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'phone',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.job_title', app.erase_column(r.tenant_id, 'contact', 'contacts', 'job_title', format('t.id = %L', c.id)));
  update public.contacts set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = c.id;

  -- the consent ledger is KEPT (event, channel, basis, type, time); only its reference is anonymised
  v_counts := app.erasure_add(v_counts, 'consent_events.evidence_ref', app.erase_column(r.tenant_id, 'contact', 'consent_events', 'evidence_ref', format('t.contact_id = %L', c.id)));
  -- what was written about this person in the leads and opportunities linked to them
  v_counts := app.erasure_add(v_counts, 'leads.source',               app.erase_column(r.tenant_id, 'contact', 'leads', 'source',               format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason',  app.erase_column(r.tenant_id, 'contact', 'leads', 'disqualified_reason',  format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',        app.erase_column(r.tenant_id, 'contact', 'opportunities', 'title',        format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason',  app.erase_column(r.tenant_id, 'contact', 'opportunities', 'lost_reason',  format('t.contact_id = %L', c.id)));

  -- T008: the enquiries captured on this person's leads (or from them), and what was extracted from them
  v_enq := format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 't', c.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 'e', c.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'contact', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'contact', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'value_text', v_fields));

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  v_review := sw.o_review;
  v_truncated := sw.o_truncated;

  -- another contact that carries the same e-mail or number is the same person in a structured column: listed for the Owner
  for d in
    select o.id, (lower(o.email) = lower(c.email)) as same_email
      from public.contacts o
     where o.tenant_id = r.tenant_id and o.id <> c.id and o.erased_at is null
       and ((c.email is not null and lower(o.email) = lower(c.email))
         or (v_phone_digits is not null and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') = v_phone_digits))
     order by o.id
  loop
    v_review := v_review || jsonb_build_array(jsonb_build_object('table', 'contacts', 'column', case when d.same_email then 'email' else 'phone' end, 'id', d.id));
  end loop;

  return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', v_truncated);
end;
$$;


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

  v_counts := app.erasure_add(v_counts, 'companies.name',    app.erase_column(r.tenant_id, 'company', 'companies', 'name',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.website', app.erase_column(r.tenant_id, 'company', 'companies', 'website', format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.city',    app.erase_column(r.tenant_id, 'company', 'companies', 'city',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.region',  app.erase_column(r.tenant_id, 'company', 'companies', 'region',  format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.tags',    app.erase_column(r.tenant_id, 'company', 'companies', 'tags',    format('t.id = %L', co.id)));
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

