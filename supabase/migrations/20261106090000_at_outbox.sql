-- Job AT (ADR 0066): the OUTBOX, its deterministic send POLICY, and CALL REQUESTS. A new migration; nothing earlier is amended except two functions replaced as full copies
-- (public.today_summary, app.guard_*: see section 9).
--
-- Owner decision (auto-send policy): the agent sends WhatsApp automatically EXCEPT financial and sensitive content; calls only after the owner approves. This file is the "explicit
-- policy and approval path" that non-negotiable 3 asks for. NOTHING here reaches a real network: the only channel adapter that exists is a LOCAL FAKE (see app/outbox/adapter.py).
--
--   public.outbox_messages   every outgoing message is a row: lead + contact, channel, text, language, category, status (queued | needs_approval | sent | blocked | failed), a closed reason.
--   public.outbox_settings   per business: auto-send on/off (default OFF) and the per-customer daily limit (default 3).
--   public.call_requests     a request to phone a customer (reason + script draft); only the Owner (aal2) approves; approval is recorded, nobody dials.
--   platform flag outbox_enabled   the GLOBAL KILL SWITCH. Default OFF: while it is off, every submitted message is blocked ('switch_off') and nothing already queued is sent.
--
-- THE POLICY (app.outbox_hard_block, app.outbox_decide_content), in this order, first match wins:
--   BLOCKED   switch_off (kill switch) | erased | stopped (contact suppressed / WhatsApp withdrawn / the phone's suppression key is suppressed) | no_phone | no_key (the phone has no recorded
--             suppression key: ADR 0020, missing data never means "not suppressed") | no_opt_in (consent not granted AND no inbound WhatsApp history)
--             | daily_limit (this customer already has the per-customer limit of queued + sent messages today, India day)
--   NEEDS APPROVAL (default; a person decides)  money (₹, rupee words, price / discount / GST / advance / payment / refund / credit / UPI / bank ... in en te hi kn ta) | commitment (promise,
--             guarantee, warranty, replacement ...) | complaint (in the text, or in the customer's latest message) | model_flagged | uncertain | category 'other' | no_inbound_window (a "reply"
--             with no inbound WhatsApp message in the last 24 hours) | auto_off (the business has not switched auto-send on)
--   QUEUED (auto)  a reply to an inbound message within 24h, catalogue / hours / location, visit booking / confirm / reminder, a follow-up without prices, an order status without amounts.
--             Quiet hours 21:00 to 09:00 IST: queued with scheduled_for = the next 09:00.
-- The FIRST message to a customer carries the AI-assistant disclosure line in their language. An approval is an explicit human decision: the owner may approve text the policy held back
-- (the hard blocks are checked again at approval and again at dispatch).
--
-- SQLSTATEs: 42501 deny, 22023 invalid, 23503 unknown / foreign reference, 23505 id reused for other content, SM501 the row is not in the state this needs, SM502 the customer has asked us to stop.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the global kill switch
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled', 'requirement_enabled', 'assistant_enabled', 'outbox_enabled'));
insert into public.platform_flags (key, enabled) values ('outbox_enabled', false);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.outbox_settings (
  tenant_id                uuid primary key references public.tenants (id) on delete restrict,
  auto_send_enabled        boolean not null default false,
  per_customer_daily_limit smallint not null default 3 check (per_customer_daily_limit between 1 and 20),
  updated_by               uuid,
  updated_at               timestamptz not null default now()
);
comment on column public.outbox_settings.updated_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';

create table public.outbox_messages (
  id               uuid primary key,
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  lead_id          uuid not null,
  -- the lead's contact and company when the message was made (derived by the function, never client-written); no contact only on a blocked 'no_contact' row
  contact_id       uuid,
  company_id       uuid,
  channel          text not null check (channel in ('whatsapp')),
  body             text not null check (char_length(body) between 2 and 4000 and app.text_is_clean(body)),
  language         text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  category         text not null check (category in ('reply_to_inbound', 'info', 'visit', 'followup', 'order_status', 'other')),
  source           text not null default 'assistant' check (source in ('assistant', 'owner', 'system')),
  status           text not null check (status in ('queued', 'needs_approval', 'sent', 'blocked', 'failed')),
  reason           text not null check (reason in ('auto_allowed', 'quiet_hours', 'owner_approved', 'money', 'commitment', 'complaint', 'model_flagged', 'uncertain',
                                                   'category_other', 'no_inbound_window', 'auto_off', 'switch_off', 'no_contact', 'no_phone', 'stopped', 'erased',
                                                   'no_opt_in', 'no_key', 'daily_limit', 'owner_rejected', 'send_failed')),
  -- every content flag found in the text, whatever the reason says first: money | commitment | complaint
  flags            text[] not null default '{}' check (flags <@ array['money', 'commitment', 'complaint']::text[] and cardinality(flags) <= 3),
  model_flagged    boolean not null default false,
  uncertain        boolean not null default false,
  disclosure_added boolean not null default false,
  policy_version   text not null default 'outbox-policy-1' check (policy_version = 'outbox-policy-1'),
  request_sha256   text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  scheduled_for    timestamptz,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  edited_by        uuid,
  edited_at        timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  claimed_at       timestamptz,
  attempts         smallint not null default 0 check (attempts between 0 and 20),
  sent_at          timestamptz,
  adapter          text check (adapter in ('fake')),
  adapter_message_id text check (char_length(adapter_message_id) between 1 and 100),
  failure_code     text check (failure_code in ('adapter_error', 'timeout', 'rejected')),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  check (contact_id is not null or (status = 'blocked' and reason = 'no_contact')),
  check ((status = 'sent') = (sent_at is not null)),
  check ((status = 'sent') = (adapter_message_id is not null)),
  check ((status = 'failed') = (failure_code is not null)),
  check (status <> 'needs_approval' or scheduled_for is null),
  check (status <> 'sent' or adapter is not null)
);
create index outbox_messages_keyset_idx   on public.outbox_messages (tenant_id, created_at, id);
create index outbox_messages_lead_idx     on public.outbox_messages (tenant_id, lead_id, created_at);
create index outbox_messages_contact_idx  on public.outbox_messages (tenant_id, contact_id, created_at) where contact_id is not null;
create index outbox_messages_approval_idx on public.outbox_messages (tenant_id, created_at) where status = 'needs_approval';
create index outbox_messages_due_idx      on public.outbox_messages (tenant_id, scheduled_for) where status = 'queued';
create index outbox_messages_company_idx  on public.outbox_messages (tenant_id, company_id);
comment on column public.outbox_messages.body is 'PII: the text of a message to a customer; it can name them. Erased by the tenant scope and swept for exact identifiers (ADR 0014).';
comment on column public.outbox_messages.channel is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.category is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.flags is 'SAFE: closed words. CLEAN-EXEMPT: subset of a closed list';
comment on column public.outbox_messages.policy_version is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.request_sha256 is 'SAFE: a hash. CLEAN-EXEMPT: hex digits only';
comment on column public.outbox_messages.adapter is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outbox_messages.adapter_message_id is 'SAFE: the fake adapter''s own id (a generated token, no customer data). CLEAN-EXEMPT: generated token';
comment on column public.outbox_messages.failure_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

create table public.call_requests (
  id             uuid primary key,
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  lead_id        uuid not null,
  contact_id     uuid not null,
  company_id     uuid,
  reason         text not null check (char_length(reason) between 2 and 500 and app.text_is_clean(reason)),
  script_draft   text not null check (char_length(script_draft) between 2 and 4000 and app.text_is_clean(script_draft)),
  language       text not null check (language in ('en', 'te', 'hi', 'kn', 'ta')),
  status         text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by   uuid not null,
  created_at     timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text check (char_length(decision_note) <= 500 and app.text_is_clean(decision_note)),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, company_id) references public.companies (tenant_id, id),
  check ((status = 'requested') = (decided_at is null)),
  check ((decided_by is null) = (decided_at is null))
);
create index call_requests_keyset_idx  on public.call_requests (tenant_id, created_at, id);
create index call_requests_pending_idx on public.call_requests (tenant_id, created_at) where status = 'requested';
create index call_requests_lead_idx    on public.call_requests (tenant_id, lead_id, created_at);
create index call_requests_contact_idx on public.call_requests (tenant_id, contact_id);
create index call_requests_company_idx on public.call_requests (tenant_id, company_id);
comment on column public.call_requests.reason is 'PII: why the call is wanted; it can name the customer. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.call_requests.script_draft is 'PII: the draft of what to say on the call; it can name the customer. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.call_requests.decision_note is 'PII: the Owner''s note on the decision; it can name the customer. Erased by the tenant scope and swept (ADR 0014).';
comment on column public.call_requests.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.call_requests.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.call_requests.request_sha256 is 'SAFE: a hash. CLEAN-EXEMPT: hex digits only';

create trigger outbox_settings_forbid_tenant_id_change before update on public.outbox_settings for each row execute function app.forbid_tenant_id_change();
create trigger outbox_messages_forbid_tenant_id_change before update on public.outbox_messages for each row execute function app.forbid_tenant_id_change();
create trigger outbox_messages_set_updated_at before update on public.outbox_messages for each row execute function app.set_updated_at();
create trigger call_requests_forbid_tenant_id_change before update on public.call_requests for each row execute function app.forbid_tenant_id_change();
create trigger audit_outbox_settings after insert or update or delete on public.outbox_settings for each row execute function app.audit_row_change('outbox_settings');
create trigger audit_outbox_messages after insert or update or delete on public.outbox_messages for each row execute function app.audit_row_change('outbox_message', 'body');
create trigger audit_call_requests after insert or update or delete on public.call_requests for each row execute function app.audit_row_change('call_request', 'reason,script_draft,decision_note');

-- Row-level security: Owner, Admin and Sales read; a Viewer reads none of it (a message can hold a price); nobody writes directly (only the functions below).
do $$
declare t text;
begin
  foreach t in array array['outbox_settings', 'outbox_messages', 'call_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy outbox_settings_select on public.outbox_settings for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy outbox_messages_select on public.outbox_messages for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy call_requests_select on public.call_requests for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));

-- Erasure (ADR 0014): the free text, in the tenant scope and in the sweep (an exact e-mail, phone or name found inside is replaced); the contact and company scopes are in section 10.
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('outbox_messages', 'body',          'tenant', 'tombstone', 'erased:1'),
  ('call_requests',   'reason',        'tenant', 'tombstone', 'erased:1'),
  ('call_requests',   'script_draft',  'tenant', 'tombstone', 'erased:1'),
  ('call_requests',   'decision_note', 'tenant', 'tombstone', 'erased:1'),
  ('outbox_messages', 'body',          'sweep',  'substring', 'erased:1'),
  ('call_requests',   'reason',        'sweep',  'substring', 'erased:1'),
  ('call_requests',   'script_draft',  'sweep',  'substring', 'erased:1'),
  ('call_requests',   'decision_note', 'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the words (pure, immutable): money, commitments, complaints, quiet hours, the disclosure line
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outbox_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'deny'      then raise exception 'not allowed' using errcode = '42501';
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'conflict'  then raise exception 'id already used for other content' using errcode = '23505';
    when 'state'     then raise exception 'the row is not in a state that allows this' using errcode = 'SM501';
    when 'stopped'   then raise exception 'the customer has asked us to stop' using errcode = 'SM502';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.outbox_error(text) from public;

-- Content flags: which of money | commitment | complaint a text shows. Latin words need word edges; Indic words are matched as substrings (their word edges are not reliable in a regex),
-- which errs on the side of asking a person. DEFAULT IS NEEDS_APPROVAL: a text with none of these still goes to a person unless its category is one of the automatic ones.
create function app.outbox_content_flags(p_text text) returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := coalesce(p_text, '');
  f text[] := '{}';
begin
  if t ~* ('(₹|/-|\mrs\M|\minr\M|\mrupees?\M|\mrupaye\M|\mrupaiyan?\M|\mrupayee\M|\mmrp\M'
        || '|\m(price|prices|pricing|priced|rate|rates|cost|costs|costing|discount|discounts|offer|offers|gst|tax|taxes|advance|payment|payments|pay|paying|paid|refund|refunds|credit|upi|bank|ifsc'
        || '|invoice|invoices|bill|bills|billing|amount|total|emi|cheque|balance|outstanding|charge|charges|fee|fees|cash|cod|quotation|quoted|gpay|phonepe|paytm|neft|rtgs|imps|wholesale|lakh|lakhs|crore)\M'
        -- Telugu
        || '|రూపాయ|రూ\.|ధర|రేటు|రేట్|ఖరీదు|డిస్కౌంట్|తగ్గింపు|జీఎస్టీ|పన్ను|అడ్వాన్స్|ముందస్తు|చెల్లింపు|చెల్లించ|డబ్బు|రీఫండ్|వాపసు|క్రెడిట్|అప్పు|యూపీఐ|బ్యాంక్|బ్యాంకు|ఇన్వాయిస్|బిల్లు|మొత్తం|ఈఎంఐ|చెక్కు|బ్యాలెన్స్|లక్ష|కోటి'
        -- Hindi
        || '|रुपय|रुपए|रूपय|रू\.|कीमत|दाम|भाव|रेट|लागत|छूट|डिस्काउंट|जीएसटी|टैक्स|अग्रिम|एडवांस|भुगतान|पेमेंट|पैसे|पैसा|रकम|राशि|रिफंड|क्रेडिट|उधार|यूपीआई|बैंक|बिल|कुल|ईएमआई|चेक|बकाया|शुल्क|लाख|करोड़'
        -- Kannada
        || '|ರೂಪಾಯಿ|ರೂ\.|ಬೆಲೆ|ದರ|ಖರ್ಚು|ರಿಯಾಯಿತಿ|ಡಿಸ್ಕೌಂಟ್|ಜಿಎಸ್ಟಿ|ತೆರಿಗೆ|ಮುಂಗಡ|ಅಡ್ವಾನ್ಸ್|ಪಾವತಿ|ಹಣ|ಮರುಪಾವತಿ|ರಿಫಂಡ್|ಕ್ರೆಡಿಟ್|ಸಾಲ|ಯುಪಿಐ|ಬ್ಯಾಂಕ್|ಬಿಲ್|ಒಟ್ಟು|ಇಎಂಐ|ಚೆಕ್|ಬಾಕಿ|ಶುಲ್ಕ|ಲಕ್ಷ|ಕೋಟಿ'
        -- Tamil
        || '|ரூபாய்|ரூ\.|விலை|தள்ளுபடி|ஜிஎஸ்டி|வரி|முன்பணம்|அட்வான்ஸ்|பணம்|செலுத்|கட்டணம்|ரீஃபண்ட்|கடன்|யுபிஐ|வங்கி|பேங்க்|பில்|மொத்தம்|இஎம்ஐ|காசோலை|நிலுவை|லட்சம்|கோடி)') then
    f := f || 'money'::text;
  end if;
  -- a digit run followed or preceded by a currency sign ("500/-", "Rs500", "₹ 1,200") is money even if a word list missed the language
  if t ~* '(₹\s*[0-9०-९౦-౯೦-೯௦-௯]|[0-9०-९౦-౯೦-೯௦-௯][0-9०-९౦-౯೦-೯௦-௯,.]*\s*(₹|/-|rs\M))' and not 'money' = any (f) then
    f := f || 'money'::text;
  end if;
  if t ~* ('(\m(promise|promised|promises|guarantee|guaranteed|guarantees|assure|assured|warranty|replacement|replace|exchange|exchanged|reserved|reserve|free delivery|will deliver|deliver by|delivery by|dispatch by|ship by|committed)\M'
        || '|వాగ్దానం|హామీ|గ్యారంటీ|వారంటీ|వాగ్ధానం'
        || '|वादा|वादे|गारंटी|वारंटी|वचन'
        || '|ಭರವಸೆ|ಖಾತರಿ|ಗ್ಯಾರಂಟಿ|ವಾರಂಟಿ'
        || '|உறுதி|வாக்குறுதி|உத்தரவாதம்|கேரண்டி)') then
    f := f || 'commitment'::text;
  end if;
  if t ~* ('(\m(complain|complaint|complaints|complained|problem|problems|damaged|damage|defect|defective|broken|torn|wrong|unhappy|disappointed|angry|cheated|cheat|fraud|scam|worst|legal|court|police|delayed|delay|late|poor quality|bad quality|not received|never received)\M'
        || '|ఫిర్యాదు|సమస్య|పాడైన|లోపం|మోసం|కోపం|అసంతృప్తి|ఆలస్యం|తప్పు'
        || '|शिकायत|समस्या|खराब|टूटा|धोखा|नाराज|देरी|गलत|ग़लत'
        || '|ದೂರು|ಸಮಸ್ಯೆ|ಹಾಳಾದ|ದೋಷ|ಮೋಸ|ಕೋಪ|ಅಸಮಾಧಾನ|ವಿಳಂಬ|ತಪ್ಪು'
        || '|புகார்|பிரச்சனை|பழுது|சேதம்|மோசடி|கோபம்|தாமதம்|தவறு)') then
    f := f || 'complaint'::text;
  end if;
  return f;
end;
$$;
revoke all on function app.outbox_content_flags(text) from public;

create function app.outbox_in_quiet_hours(p_at timestamptz) returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(hour from (p_at at time zone 'Asia/Kolkata')) >= 21 or extract(hour from (p_at at time zone 'Asia/Kolkata')) < 9
$$;
revoke all on function app.outbox_in_quiet_hours(timestamptz) from public;

-- the first moment a message may go: now outside quiet hours, else the next 09:00 India time
create function app.outbox_next_open(p_at timestamptz) returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
           when extract(hour from l) < 9  then (date_trunc('day', l) + interval '9 hours') at time zone 'Asia/Kolkata'
           when extract(hour from l) >= 21 then (date_trunc('day', l) + interval '1 day 9 hours') at time zone 'Asia/Kolkata'
           else p_at
         end
    from (select p_at at time zone 'Asia/Kolkata' as l) x
$$;
revoke all on function app.outbox_next_open(timestamptz) from public;

create function app.outbox_disclosure(p_language text) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_language
    when 'te' then 'ఈ సందేశం వ్యాపారం యొక్క AI సహాయకుడి నుండి వచ్చింది.'
    when 'hi' then 'यह संदेश व्यवसाय के AI सहायक की ओर से है।'
    when 'kn' then 'ಈ ಸಂದೇಶ ವ್ಯಾಪಾರದ AI ಸಹಾಯಕರಿಂದ ಬಂದಿದೆ.'
    when 'ta' then 'இந்தச் செய்தி வணிகத்தின் AI உதவியாளரிடமிருந்து வருகிறது.'
    else 'This message is from the business''s AI assistant.'
  end
$$;
revoke all on function app.outbox_disclosure(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the policy (SECURITY INVOKER helpers called by the definer functions below; no client role may call them)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outbox_limit(p_tenant uuid) returns integer
language sql
stable
set search_path = ''
as $$ select coalesce((select s.per_customer_daily_limit from public.outbox_settings s where s.tenant_id = p_tenant), 3)::integer $$;
revoke all on function app.outbox_limit(uuid) from public;

create function app.outbox_switch_on() returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((select f.enabled from public.platform_flags f where f.key = 'outbox_enabled'), false) $$;
revoke all on function app.outbox_switch_on() from public;

-- the reason a message to this contact may not go at all, or null. The caller holds the advisory lock of the contact when the daily count matters.
create function app.outbox_hard_block(p_tenant uuid, c public.contacts, p_exclude uuid, p_now timestamptz) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text;
begin
  if not app.outbox_switch_on() then
    return 'switch_off';
  end if;
  if c.id is null then
    return 'no_contact';
  end if;
  if c.erased_at is not null then
    return 'erased';
  end if;
  if c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn' then
    return 'stopped';
  end if;
  if c.phone is null then
    return 'no_phone';
  end if;
  -- the number's keyed hash must be on record (the API records it when it holds the key), and the ledger must not say it is suppressed (this contact's, or any other record of the same number)
  select k.phone_hmac into v_key from suppression.contact_keys k where k.tenant_id = p_tenant and k.contact_id = c.id;
  if v_key is null then
    return 'no_key';
  end if;
  if app.key_active(p_tenant, 'phone', v_key) then
    return 'stopped';
  end if;
  if c.whatsapp_consent <> 'granted'
     and not exists (select 1 from public.enquiries e where e.tenant_id = p_tenant and e.contact_id = c.id and e.channel = 'whatsapp')
     and not exists (select 1 from public.lead_touches t where t.tenant_id = p_tenant and t.contact_id = c.id and t.direction = 'in' and t.channel = 'whatsapp') then
    return 'no_opt_in';
  end if;
  if (select count(*) from public.outbox_messages m
       where m.tenant_id = p_tenant and m.contact_id = c.id and m.status in ('queued', 'sent') and m.id is distinct from p_exclude
         and (m.created_at at time zone 'Asia/Kolkata')::date = (p_now at time zone 'Asia/Kolkata')::date) >= app.outbox_limit(p_tenant) then
    return 'daily_limit';
  end if;
  return null;
end;
$$;
revoke all on function app.outbox_hard_block(uuid, public.contacts, uuid, timestamptz) from public;

-- Content decision for a message that is not blocked: {status: queued | needs_approval, reason, flags, scheduled_for}
create function app.outbox_decide_content(
  p_tenant uuid, p_lead uuid, p_body text, p_category text, p_model_flagged boolean, p_uncertain boolean, p_now timestamptz
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_flags   text[] := app.outbox_content_flags(p_body);
  v_inbound timestamptz;
  v_window  boolean;
  v_text_in text;
  v_reason  text;
begin
  select greatest(
           (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now),
           (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_now))
    into v_inbound;
  v_window := v_inbound is not null and v_inbound > p_now - interval '24 hours';
  -- a complaint in the customer's latest message makes the reply a person's call, whatever the reply says
  if v_window then
    select e.body into v_text_in from public.enquiries e
     where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now
     order by e.received_at desc, e.id desc limit 1;
    if 'complaint' = any (app.outbox_content_flags(v_text_in)) and not 'complaint' = any (v_flags) then
      v_flags := v_flags || 'complaint'::text;
    end if;
  end if;

  v_reason := case
    when 'money' = any (v_flags) then 'money'
    when 'commitment' = any (v_flags) then 'commitment'
    when 'complaint' = any (v_flags) then 'complaint'
    when p_model_flagged then 'model_flagged'
    when p_uncertain then 'uncertain'
    when p_category = 'other' then 'category_other'
    when p_category = 'reply_to_inbound' and not v_window then 'no_inbound_window'
    when not coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant), false) then 'auto_off'
    else null
  end;
  if v_reason is not null then
    return jsonb_build_object('status', 'needs_approval', 'reason', v_reason, 'flags', to_jsonb(v_flags), 'scheduled_for', null);
  end if;
  if app.outbox_in_quiet_hours(p_now) then
    return jsonb_build_object('status', 'queued', 'reason', 'quiet_hours', 'flags', to_jsonb(v_flags), 'scheduled_for', app.outbox_next_open(p_now));
  end if;
  return jsonb_build_object('status', 'queued', 'reason', 'auto_allowed', 'flags', to_jsonb(v_flags), 'scheduled_for', p_now);
end;
$$;
revoke all on function app.outbox_decide_content(uuid, uuid, text, text, boolean, boolean, timestamptz) from public;

create function app.outbox_row_json(m public.outbox_messages, p_replayed boolean) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'status', m.status, 'reason', m.reason, 'flags', to_jsonb(m.flags), 'scheduled_for', m.scheduled_for,
                            'disclosure_added', m.disclosure_added, 'replayed', p_replayed)
$$;
revoke all on function app.outbox_row_json(public.outbox_messages, boolean) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. guard triggers: the state machine, the immutable columns, no deletes, no truncates
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outbox_forbid_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'outbox and call rows are never deleted' using errcode = '42501';
end;
$$;
revoke all on function app.outbox_forbid_delete() from public;
create trigger outbox_messages_no_delete before delete on public.outbox_messages for each row execute function app.outbox_forbid_delete();
create trigger call_requests_no_delete before delete on public.call_requests for each row execute function app.outbox_forbid_delete();
create trigger outbox_messages_no_truncate before truncate on public.outbox_messages for each statement execute function app.outbox_forbid_delete();
create trigger call_requests_no_truncate before truncate on public.call_requests for each statement execute function app.outbox_forbid_delete();

create function app.outbox_messages_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('queued', 'needs_approval', 'blocked') or new.sent_at is not null or new.attempts <> 0 or new.decided_at is not null or new.claimed_at is not null then
    raise exception 'an outbox message starts queued, held for approval or blocked' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.outbox_messages_guard_insert() from public;
create trigger outbox_messages_guard_insert before insert on public.outbox_messages for each row execute function app.outbox_messages_guard_insert();

-- what may change: status along the machine, its bookkeeping, and the body only while the message waits for a person (or while an erasure of this business runs)
create function app.outbox_messages_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed text[] := array['id', 'tenant_id', 'lead_id', 'contact_id', 'company_id', 'channel', 'language', 'category', 'source', 'request_sha256', 'created_by', 'created_at', 'policy_version', 'model_flagged', 'uncertain'];
  k text;
begin
  if current_user = 'postgres' and app.erasure_running(new.tenant_id)
     and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
    return new;
  end if;
  foreach k in array v_fixed loop
    if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k then
      raise exception 'outbox messages are immutable except for their state' using errcode = '42501';
    end if;
  end loop;
  if new.body is distinct from old.body and old.status <> 'needs_approval' then
    raise exception 'only a message waiting for approval can be edited' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'needs_approval' and new.status in ('queued', 'blocked'))
         or (old.status = 'queued' and new.status in ('sent', 'failed', 'blocked'))) then
      raise exception 'an outbox message cannot move from % to %', old.status, new.status using errcode = '42501';
    end if;
  elsif old.status in ('sent', 'failed', 'blocked') and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'a closed outbox message stays closed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.outbox_messages_guard_update() from public;
create trigger outbox_messages_guard_update before update on public.outbox_messages for each row execute function app.outbox_messages_guard_update();

create function app.call_requests_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'postgres' and app.erasure_running(new.tenant_id)
     and app.changed_columns(to_jsonb(old), to_jsonb(new)) <@ app.erasure_columns(tg_table_name) then
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at' - 'decision_note') is distinct from (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at' - 'decision_note') then
    raise exception 'call requests are immutable: approve or reject them' using errcode = '42501';
  end if;
  if old.status <> 'requested' and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a decided call request stays decided' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (old.status = 'requested' and new.status in ('approved', 'rejected')) then
    raise exception 'a call request cannot move from % to %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.call_requests_guard_update() from public;
create trigger call_requests_guard_update before update on public.call_requests for each row execute function app.call_requests_guard_update();

-- A customer who asks us to stop (or whose record is erased) takes every message that has not gone out off the road at once.
create function app.outbox_block_pending_for_contact() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.suppressed_at is not null and old.suppressed_at is null)
     or (new.whatsapp_consent = 'withdrawn' and old.whatsapp_consent is distinct from 'withdrawn')
     or (new.erased_at is not null and old.erased_at is null) then
    update public.outbox_messages
       set status = 'blocked', reason = case when new.erased_at is not null then 'erased' else 'stopped' end, scheduled_for = null
     where tenant_id = new.tenant_id and contact_id = new.id and status in ('queued', 'needs_approval');
  end if;
  return new;
end;
$$;
revoke all on function app.outbox_block_pending_for_contact() from public;
create trigger contacts_block_pending_outbox after update on public.contacts for each row execute function app.outbox_block_pending_for_contact();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the functions a person (or the agent, in a person's name) calls. Role first, then the work; one generic 42501 for any denial.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.outbox_submit(
  p_message_id uuid, p_tenant_id uuid, p_lead_id uuid, p_channel text, p_body text, p_language text, p_category text,
  p_source text default 'assistant', p_model_flagged boolean default false, p_uncertain boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := now();
  v_text    text := btrim(coalesce(p_body, ''));
  v_lead    public.leads;
  v_contact public.contacts;
  v_sha     text;
  v_old     public.outbox_messages;
  v_hard    text;
  v_dec     jsonb;
  v_body    text;
  v_disc    text;
  v_added   boolean := false;
  v_status  text;
  v_reason  text;
  v_flags   text[];
  v_sched   timestamptz;
  m         public.outbox_messages;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_message_id is null or p_lead_id is null or p_channel is distinct from 'whatsapp' or char_length(v_text) not between 2 and 3000
     or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta')
     or p_category is null or p_category not in ('reply_to_inbound', 'info', 'visit', 'followup', 'order_status', 'other')
     or p_source is null or p_source not in ('assistant', 'owner', 'system')
     or p_model_flagged is null or p_uncertain is null or not app.text_is_clean(v_text) then
    perform app.outbox_error('invalid');
  end if;

  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_channel, p_category, p_language, p_source, p_model_flagged, p_uncertain, v_text), 'UTF8')), 'hex');

  -- a retry: the same words under the same id replay; other words conflict
  select * into v_old from public.outbox_messages x where x.id = p_message_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then
      perform app.outbox_error('conflict');
    end if;
    return app.outbox_row_json(v_old, true);
  end if;

  select * into v_lead from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if v_lead.archived_at is not null then
    perform app.outbox_error('invalid');
  end if;
  if v_lead.contact_id is not null then
    -- serialise the messages of one customer: the daily count and "the first message" must not race
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || v_lead.contact_id::text, 0));
    select * into v_contact from public.contacts c where c.id = v_lead.contact_id and c.tenant_id = p_tenant_id;
  end if;

  v_body := v_text;
  if v_contact.id is not null then
    v_disc := app.outbox_disclosure(p_language);
    if not exists (select 1 from public.outbox_messages x where x.tenant_id = p_tenant_id and x.contact_id = v_contact.id and x.disclosure_added and x.status in ('queued', 'needs_approval', 'sent'))
       and position(v_disc in v_body) = 0 then
      v_body := v_body || E'\n\n' || v_disc;
      v_added := true;
    end if;
  end if;

  v_hard := case when v_contact.id is null then (case when app.outbox_switch_on() then 'no_contact' else 'switch_off' end)
                 else app.outbox_hard_block(p_tenant_id, v_contact, null, v_now) end;
  v_flags := app.outbox_content_flags(v_text);
  if v_hard is not null then
    v_status := 'blocked'; v_reason := v_hard; v_sched := null;
  else
    v_dec := app.outbox_decide_content(p_tenant_id, p_lead_id, v_text, p_category, p_model_flagged, p_uncertain, v_now);
    v_status := v_dec ->> 'status';
    v_reason := v_dec ->> 'reason';
    v_flags := array(select jsonb_array_elements_text(v_dec -> 'flags'));
    v_sched := nullif(v_dec ->> 'scheduled_for', '')::timestamptz;
  end if;

  insert into public.outbox_messages
    (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, flags, model_flagged, uncertain,
     disclosure_added, request_sha256, scheduled_for, created_by)
  values
    (p_message_id, p_tenant_id, p_lead_id, v_contact.id, v_lead.company_id, p_channel, v_body, p_language, p_category, p_source, v_status, v_reason, v_flags,
     p_model_flagged, p_uncertain, v_added, v_sha, v_sched, v_uid)
  returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.outbox_submit(uuid, uuid, uuid, text, text, text, text, text, boolean, boolean) to authenticated;

-- Edit a message that waits for approval (Owner, Admin). The first-message disclosure line stays. The policy is not re-run: the person is deciding.
create function public.outbox_edit(p_tenant_id uuid, p_message_id uuid, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := btrim(coalesce(p_body, ''));
  m      public.outbox_messages;
  v_disc text;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if char_length(v_text) not between 2 and 3000 or not app.text_is_clean(v_text) then
    perform app.outbox_error('invalid');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status <> 'needs_approval' then
    perform app.outbox_error('state');
  end if;
  v_disc := app.outbox_disclosure(m.language);
  if m.disclosure_added and position(v_disc in v_text) = 0 then
    v_text := v_text || E'\n\n' || v_disc;
  end if;
  update public.outbox_messages
     set body = v_text, flags = app.outbox_content_flags(v_text), edited_by = v_uid, edited_at = now()
   where id = m.id
   returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_edit(uuid, uuid, text) from public, anon;
grant execute on function public.outbox_edit(uuid, uuid, text) to authenticated;

-- Approve or reject a message that waits for a person. Owner or Admin; approving also needs a second factor. The hard blocks are checked again at approval.
create function public.outbox_decide(p_tenant_id uuid, p_message_id uuid, p_decision text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := now();
  m      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    perform app.outbox_error('invalid');
  end if;
  if p_decision = 'approve' then
    perform app.require_aal2();
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status <> 'needs_approval' then
    perform app.outbox_error('state');
  end if;
  if p_decision = 'reject' then
    update public.outbox_messages set status = 'blocked', reason = 'owner_rejected', decided_by = v_uid, decided_at = v_now, scheduled_for = null
     where id = m.id returning * into m;
    return app.outbox_row_json(m, false);
  end if;
  if m.contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || m.contact_id::text, 0));
    select * into c from public.contacts x where x.id = m.contact_id and x.tenant_id = p_tenant_id;
  end if;
  v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, m.id, v_now) end;
  if v_hard is not null then
    update public.outbox_messages set status = 'blocked', reason = v_hard, decided_by = v_uid, decided_at = v_now, scheduled_for = null
     where id = m.id returning * into m;
    return app.outbox_row_json(m, false);
  end if;
  update public.outbox_messages
     set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = app.outbox_next_open(v_now)
   where id = m.id returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_decide(uuid, uuid, text) from public, anon;
grant execute on function public.outbox_decide(uuid, uuid, text) to authenticated;

-- Dispatch, step 1: the messages that are due, claimed for two minutes. The hard blocks are checked again here (a STOP after the message was queued still stops it). While the kill
-- switch is off nothing is claimed and nothing is changed: the queue waits. During quiet hours a due message is pushed to the next 09:00. Owner or Admin.
create function public.outbox_claim_due(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := now();
  v_out  jsonb := '[]'::jsonb;
  r      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now) then
      update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now) where id = r.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || coalesce(r.contact_id::text, r.id::text), 0));
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, r.id, v_now) end;
    if v_hard is not null then
      update public.outbox_messages set status = 'blocked', reason = v_hard, scheduled_for = null where id = r.id;
      continue;
    end if;
    update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.outbox_claim_due(uuid, integer) from public, anon;
grant execute on function public.outbox_claim_due(uuid, integer) to authenticated;

-- Dispatch, step 2: what the adapter said. Idempotent: the same outcome again changes nothing.
create function public.outbox_mark(
  p_tenant_id uuid, p_message_id uuid, p_outcome text, p_adapter text, p_adapter_message_id text default null, p_failure_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m     public.outbox_messages;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'failed') or p_adapter is distinct from 'fake'
     or (p_outcome = 'sent' and (p_adapter_message_id is null or char_length(p_adapter_message_id) not between 1 and 100))
     or (p_outcome = 'failed' and (p_failure_code is null or p_failure_code not in ('adapter_error', 'timeout', 'rejected'))) then
    perform app.outbox_error('invalid');
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status = p_outcome then
    return app.outbox_row_json(m, true);
  end if;
  if m.status <> 'queued' or m.claimed_at is null then
    perform app.outbox_error('state');
  end if;
  if p_outcome = 'sent' then
    update public.outbox_messages set status = 'sent', sent_at = now(), adapter = p_adapter, adapter_message_id = p_adapter_message_id where id = m.id returning * into m;
  else
    update public.outbox_messages set status = 'failed', reason = 'send_failed', failure_code = p_failure_code where id = m.id returning * into m;
  end if;
  return app.outbox_row_json(m, false);
end;
$$;
revoke all on function public.outbox_mark(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.outbox_mark(uuid, uuid, text, text, text, text) to authenticated;

-- The business's own switches: auto-send (default off) and the per-customer daily limit (default 3). Owner, with a second factor.
create function public.outbox_set_settings(p_tenant_id uuid, p_auto_send_enabled boolean, p_per_customer_daily_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s     public.outbox_settings;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  perform app.require_aal2();
  if p_auto_send_enabled is null or p_per_customer_daily_limit is null or p_per_customer_daily_limit not between 1 and 20 then
    perform app.outbox_error('invalid');
  end if;
  insert into public.outbox_settings (tenant_id, auto_send_enabled, per_customer_daily_limit, updated_by)
  values (p_tenant_id, p_auto_send_enabled, p_per_customer_daily_limit, v_uid)
  on conflict (tenant_id) do update
    set auto_send_enabled = excluded.auto_send_enabled, per_customer_daily_limit = excluded.per_customer_daily_limit, updated_by = v_uid, updated_at = now()
  returning * into s;
  return jsonb_build_object('auto_send_enabled', s.auto_send_enabled, 'per_customer_daily_limit', s.per_customer_daily_limit);
end;
$$;
revoke all on function public.outbox_set_settings(uuid, boolean, integer) from public, anon;
grant execute on function public.outbox_set_settings(uuid, boolean, integer) to authenticated;

-- What the business has set, plus the global switch (read by Owner and Admin).
create function public.outbox_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  return jsonb_build_object(
    'platform_switch_on', app.outbox_switch_on(),
    'auto_send_enabled', coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant_id), false),
    'per_customer_daily_limit', app.outbox_limit(p_tenant_id));
end;
$$;
revoke all on function public.outbox_settings_get(uuid) from public, anon;
grant execute on function public.outbox_settings_get(uuid) to authenticated;

-- ---- calls: a request that only the Owner can approve. Approval is recorded; nothing dials.
create function public.call_request_create(
  p_request_id uuid, p_tenant_id uuid, p_lead_id uuid, p_reason text, p_script_draft text, p_language text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rs   text := btrim(coalesce(p_reason, ''));
  v_sc   text := btrim(coalesce(p_script_draft, ''));
  v_sha  text;
  v_old  public.call_requests;
  v_lead public.leads;
  c      public.contacts;
  r      public.call_requests;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_request_id is null or p_lead_id is null or char_length(v_rs) not between 2 and 500 or char_length(v_sc) not between 2 and 4000
     or p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta') or not app.text_is_clean(v_rs) or not app.text_is_clean(v_sc) then
    perform app.outbox_error('invalid');
  end if;
  v_sha := encode(sha256(convert_to(concat_ws('|', p_lead_id, p_language, v_rs, v_sc), 'UTF8')), 'hex');
  select * into v_old from public.call_requests x where x.id = p_request_id;
  if found then
    if v_old.tenant_id <> p_tenant_id or v_old.request_sha256 <> v_sha then
      perform app.outbox_error('conflict');
    end if;
    return jsonb_build_object('id', v_old.id, 'status', v_old.status, 'replayed', true);
  end if;
  select * into v_lead from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id and l.archived_at is null;
  if not found or v_lead.contact_id is null then
    perform app.outbox_error('reference');
  end if;
  select * into c from public.contacts x where x.id = v_lead.contact_id and x.tenant_id = p_tenant_id for share;
  if c.erased_at is not null or c.suppressed_at is not null or c.phone_consent = 'withdrawn' then
    perform app.outbox_error('stopped');
  end if;
  if c.phone is null then
    perform app.outbox_error('invalid');
  end if;
  insert into public.call_requests (id, tenant_id, lead_id, contact_id, company_id, reason, script_draft, language, request_sha256, requested_by)
  values (p_request_id, p_tenant_id, p_lead_id, c.id, v_lead.company_id, v_rs, v_sc, p_language, v_sha, v_uid)
  returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status, 'replayed', false);
end;
$$;
revoke all on function public.call_request_create(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.call_request_create(uuid, uuid, uuid, text, text, text) to authenticated;

create function public.call_request_decide(p_tenant_id uuid, p_request_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r      public.call_requests;
  c      public.contacts;
begin
  if v_uid is null or p_tenant_id is null or p_request_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') or (v_note is not null and (char_length(v_note) > 500 or not app.text_is_clean(v_note))) then
    perform app.outbox_error('invalid');
  end if;
  perform app.require_aal2();
  select * into r from public.call_requests x where x.id = p_request_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if r.status <> 'requested' then
    perform app.outbox_error('state');
  end if;
  if p_decision = 'approve' then
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    if c.erased_at is not null or c.suppressed_at is not null or c.phone_consent = 'withdrawn' then
      perform app.outbox_error('stopped');
    end if;
  end if;
  update public.call_requests
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end, decided_by = v_uid, decided_at = now(), decision_note = v_note
   where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status, 'replayed', false);
end;
$$;
revoke all on function public.call_request_decide(uuid, uuid, text, text) from public, anon;
grant execute on function public.call_request_decide(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. the operator turns the kill switch on (local development; the hosted switch is the operator's)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.operator_set_outbox(p_enabled boolean) returns void
language sql
set search_path = ''
as $$ update public.platform_flags set enabled = p_enabled where key = 'outbox_enabled' $$;
revoke all on function app.operator_set_outbox(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Today: what waits for the Owner or an Admin now includes messages held for approval, and (Owner) call requests. A full copy of the AD / D3 function plus the two unions.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.today_summary(p_tenant_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_decider boolean;
  v_owner   boolean;
  v_reader  boolean;
  v_needs   jsonb;
  v_waiting integer;
  v_held    bigint := 0;
  v_open    integer := 0;
  v_recent  jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not (select app.is_tenant_member(p_tenant_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_decider := (select app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]));
  v_owner   := (select app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]));
  v_reader  := (select app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]));

  with items as (
    select 'quote_approval'::text as kind, qt.id, c.name as customer, c.city, 'quote_writer'::text as agent,
           qt.quote_no::text as ref, qt.total_paise as amount_paise, qt.created_at as at, 'quote'::text as target_type, qt.id as target_id
      from public.quotes qt
      left join public.leads l on l.tenant_id = qt.tenant_id and l.id = qt.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and qt.tenant_id = p_tenant_id and qt.status = 'draft'
    union all
    select 'followup_due', d.id, c.name, c.city, 'followup_desk', d.touch_number::text, null::bigint, d.created_at, 'lead', d.lead_id
      from public.followup_drafts d
      left join public.leads l on l.tenant_id = d.tenant_id and l.id = d.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and d.tenant_id = p_tenant_id and d.status = 'draft'
    union all
    select 'order_money_held', o.id, c.name, c.city, 'order_desk', o.order_no::text, g.net_paise, coalesce(o.closed_at, o.updated_at), 'order', o.id
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
      left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and o.tenant_id = p_tenant_id and o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0
    union all
    select 'outbox_approval', m.id, c.name, c.city, 'followup_desk', m.category, null::bigint, m.created_at, 'outbox_message', m.id
      from public.outbox_messages m
      left join public.leads l on l.tenant_id = m.tenant_id and l.id = m.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_decider and m.tenant_id = p_tenant_id and m.status = 'needs_approval'
    union all
    select 'call_approval', r.id, c.name, c.city, 'followup_desk', 'call', null::bigint, r.created_at, 'call_request', r.id
      from public.call_requests r
      left join public.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
     where v_owner and r.tenant_id = p_tenant_id and r.status = 'requested'
  ), top as (
    select * from items order by at desc, id limit 20
  )
  select (select count(*) from items)::integer,
         coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'id', t.id, 'customer', t.customer, 'city', t.city, 'agent', t.agent,
                                                       'ref', t.ref, 'amount_paise', t.amount_paise, 'at', t.at,
                                                       'target', jsonb_build_object('type', t.target_type, 'id', t.target_id)) order by t.at desc, t.id) from top t), '[]'::jsonb)
    into v_waiting, v_needs;

  if v_reader then
    select coalesce(sum(g.net_paise) filter (where o.state in ('declined', 'expired', 'cancelled') and g.net_paise > 0), 0)::bigint,
           count(*) filter (where o.closed_at is null)::integer
      into v_held, v_open
      from public.orders o
      join public.order_ledger g on g.tenant_id = o.tenant_id and g.order_id = o.id
     where o.tenant_id = p_tenant_id;

    select coalesce(jsonb_agg(r.j order by r.at desc, r.id desc), '[]'::jsonb)
      into v_recent
      from (select e.recorded_at as at, e.id,
                   jsonb_build_object('order_no', o.order_no, 'order_id', o.id, 'customer', c.name, 'type', e.type, 'new_state', e.new_state,
                                      'amount_paise', e.amount_paise, 'at', e.recorded_at) as j
              from public.order_events e
              join public.orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
              left join public.leads l on l.tenant_id = o.tenant_id and l.id = o.lead_id
              left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id
             where e.tenant_id = p_tenant_id
             order by e.recorded_at desc, e.id desc
             limit 5) r;
  end if;

  return jsonb_build_object(
    'cards', jsonb_build_object('waiting', v_waiting, 'money_held_paise', v_held, 'orders_open', v_open),
    'needs_you', v_needs,
    'recent', v_recent);
end;
$$;
revoke all on function public.today_summary(uuid) from public, anon;
grant execute on function public.today_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. the Main agent can cite what Today lists: a message held for approval and a call request are sources it may save (a full copy of the AG function; the one change is the two words)
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.assistant_save_reply(
  p_run_id uuid, p_message_id uuid, p_body text, p_language text, p_sources jsonb, p_drafts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.agent_runs;
  m      public.assistant_messages;
  v_seq  integer;
  v_body text := btrim(coalesce(p_body, ''));
begin
  r := app.agent_open_run(p_run_id);
  if r.conversation_id is null or p_message_id is null or char_length(v_body) not between 1 and 12000
     or (p_language is not null and p_language not in ('en', 'te', 'hi', 'kn', 'ta'))
     or not app.assistant_pairs_ok(coalesce(p_sources, '[]'::jsonb), array['quote', 'lead', 'enquiry', 'order', 'company', 'customer', 'price_item', 'followup_draft', 'reply_draft', 'outbox_message', 'call_request'])
     or not app.assistant_pairs_ok(coalesce(p_drafts, '[]'::jsonb), array['quote', 'followup_draft', 'reply_draft', 'enquiry']) then
    perform app.agent_state_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant:' || r.conversation_id::text, 0));
  select * into m from public.assistant_messages x where x.id = p_message_id;
  if found then
    if m.tenant_id <> r.tenant_id or m.run_id is distinct from r.id or m.role <> 'assistant' then
      raise exception 'message id already used' using errcode = '23505', constraint = 'assistant_messages_pkey', table = 'assistant_messages', schema = 'public';
    end if;
    return jsonb_build_object('replayed', true, 'message_id', m.id, 'seq', m.seq);
  end if;
  select coalesce(max(x.seq), 0) + 1 into v_seq from public.assistant_messages x where x.tenant_id = r.tenant_id and x.conversation_id = r.conversation_id;
  insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, language, sources, drafts, run_id, created_by)
  values (p_message_id, r.tenant_id, r.conversation_id, v_seq, 'assistant', v_body, p_language, coalesce(p_sources, '[]'::jsonb), coalesce(p_drafts, '[]'::jsonb), r.id, r.started_by);
  update public.assistant_conversations set updated_at = now() where tenant_id = r.tenant_id and id = r.conversation_id;
  return jsonb_build_object('replayed', false, 'message_id', p_message_id, 'seq', v_seq);
end;
$$;
revoke all on function public.assistant_save_reply(uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.assistant_save_reply(uuid, uuid, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. erasure of one person or one company reaches their messages and call requests (full copies of app.erase_contact (T010 / erased marker) and app.erase_company (T008); the one change is the block
--     marked "job AT" in each). Registry rows first: erase_column refuses a column the registry does not name for the scope.
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('outbox_messages', 'body',          'contact', 'tombstone', 'erased:1'),
  ('call_requests',   'reason',        'contact', 'tombstone', 'erased:1'),
  ('call_requests',   'script_draft',  'contact', 'tombstone', 'erased:1'),
  ('call_requests',   'decision_note', 'contact', 'tombstone', 'erased:1'),
  ('outbox_messages', 'body',          'company', 'tombstone', 'erased:1'),
  ('call_requests',   'reason',        'company', 'tombstone', 'erased:1'),
  ('call_requests',   'script_draft',  'company', 'tombstone', 'erased:1'),
  ('call_requests',   'decision_note', 'company', 'tombstone', 'erased:1');

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
  k suppression.contact_keys;
  v_keys_n bigint := 0;
  v_markers bigint := 0;
  v_unkeyed boolean;
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

  -- T010 / ADR 0020: the suppression keys are written BEFORE any identifier is removed, so a later import of the same address is recognised.
  -- A contact that holds an e-mail or a phone number with no recorded key is refused (SM221), UNLESS an Owner with aal2 marked this request
  -- "without a key" (allow_erasure_without_key): erasure itself is never blocked for good, and that step is audited and counted.
  select * into k from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id for update;
  v_unkeyed := (c.email is not null and k.email_hmac is null) or (c.phone is not null and k.phone_hmac is null);
  if v_unkeyed then
    if r.without_key_at is null then
      perform app.suppression_error('SM221');
    end if;
    v_counts := app.erasure_add(v_counts, 'suppression.erased_without_key', 1);
  end if;
  if c.email is not null and k.email_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'email', k.email_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  if c.phone is not null and k.phone_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'phone', k.phone_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  delete from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
  v_counts := app.erasure_add(v_counts, 'suppression.erased_markers', v_markers);
  v_counts := app.erasure_add(v_counts, 'suppression.contact_keys', n);

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

  -- job AT: the messages written to this person (and the call requests about them) are tombstoned outright, not left to the name review
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'contact', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'contact', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'contact', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'contact', 'call_requests', 'decision_note', v_enq));

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

  -- job AT: the messages written to this company's leads, and the call requests about them
  v_counts := app.erasure_add(v_counts, 'outbox_messages.body',      app.erase_column(r.tenant_id, 'company', 'outbox_messages', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.reason',        app.erase_column(r.tenant_id, 'company', 'call_requests', 'reason', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.script_draft',  app.erase_column(r.tenant_id, 'company', 'call_requests', 'script_draft', v_enq));
  v_counts := app.erasure_add(v_counts, 'call_requests.decision_note', app.erase_column(r.tenant_id, 'company', 'call_requests', 'decision_note', v_enq));

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
