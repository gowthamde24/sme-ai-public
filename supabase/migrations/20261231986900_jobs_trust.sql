-- JOBS core, slice S1: THE TRUST PIECES (contract ~/Desktop/stack19-jobs/contracts/jobs-contract-DRAFT.md FINAL 1.0, sections 0, 1, 6, 14, 15, 16; build plan slice S1). Database half; the API is behind the flag JOBS.
--   A  the shared closed refusals (SQLSTATEs below) and the words helpers
--   B  public.jobs_meta (kind, the owner's own name for the helper, what the helper asks) and public.job_faqs (question, answer <=300 chars each; an answer may not mention a price, a discount or a promise)
--   C  the do-not-call list: what contacts.suppressed_at / suppression_reason and the suppression keys ALREADY are (nothing is copied), read as entries; add (a number that is not a contact is stored as its KEY only,
--      with its last four digits); remove (Owner, second factor, ONLY an entry the owner added: an entry the customer asked for, on WhatsApp or on a call, can never be removed by anyone)
--   D  the consent tick on lead sources: who, when and which wording version, on the source
-- SQLSTATEs: 42501 not allowed, 22023 invalid, 23503 not found, SM983 name_invalid, SM984 faq_not_allowed, SM985 stopped_by_customer, SM986 not_removable (an entry that is not the owner's to take off: a legal,
-- complaint or bounce entry, or a number that carries one).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- A. closed refusals and helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.jobs_error(p_kind text) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_kind
    when 'deny'          then raise exception 'not allowed' using errcode = '42501';
    when 'invalid'       then raise exception 'invalid input' using errcode = '22023';
    when 'reference'     then raise exception 'not found' using errcode = '23503';
    when 'name_invalid'  then raise exception 'name not allowed' using errcode = 'SM983';
    when 'faq_not_allowed' then raise exception 'an answer may not state a price, a discount or a promise' using errcode = 'SM984';
    when 'stopped'       then raise exception 'stopped by the customer' using errcode = 'SM985';
    when 'not_removable' then raise exception 'this entry cannot be removed' using errcode = 'SM986';
    else raise exception 'jobs error' using errcode = 'XX000';
  end case;
end;
$$;
revoke all on function app.jobs_error(text) from public, anon, authenticated, service_role;

-- every script's decimal digits as the digits they are (the same set as app.phone_norm)
create function app.ascii_digits(p text) returns text
language sql
immutable
set search_path = ''
as $$
  select translate(normalize(coalesce(p, ''), NFKC),
                   '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९০১২৩৪৫৬৭৮৯੦੧੨੩੪੫੬੭੮੯૦૧૨૩૪૫૬૭૮૯୦୧୨୩୪୫୬୭୮୯௦௧௨௩௪௫௬௭௮௯౦౧౨౩౪౫౬౭౮౯೦೧೨೩೪೫೬೭೮೯൦൧൨൩൪൫൬൭൮൯',
                   repeat('0123456789', 11))
$$;
revoke all on function app.ascii_digits(text) from public, anon, authenticated, service_role;

-- the owner's own name for a helper (contract section 1): 1 to 40 characters, clean, not only digits, no web address, no e-mail address, no phone number (seven digits or more). An empty name is "no name" and is
-- handled by the caller (it clears).
create function app.job_name_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and char_length(p) between 1 and 40
     and app.text_is_clean(p)
     -- not only digits and separators
     and regexp_replace(app.ascii_digits(p), '[0-9[:space:]().+,/-]', '', 'g') <> ''
     -- not a phone number
     and char_length(regexp_replace(app.ascii_digits(p), '[^0-9]', '', 'g')) < 7
     -- not a web address or an e-mail address
     and p !~* '(://|https?:|www\.|@|\.(com|net|org|in|co|io|app|me|shop|store|info|biz|online|site|xyz|dev|link|ly)(\M|/))'
$$;
revoke all on function app.job_name_ok(text) from public, anon, authenticated, service_role;

-- what the helper may ask (contract section 6): closed keys per kind, each true or false. Only the two kinds the contract names have keys today; the others hold none until a later contract part says so.
create function app.job_finds_out_ok(p_kind text, p_value jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_allowed text[];
  k text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;
  v_allowed := case p_kind
    when 'speed_to_lead' then array['need', 'quantity', 'when', 'visit']
    when 'followups'     then array['still_interested', 'budget_range']
    when 'custom'        then array['need', 'quantity', 'when', 'visit', 'still_interested', 'budget_range']
    else array[]::text[] end;
  for k in select jsonb_object_keys(p_value) loop
    if not k = any (v_allowed) or jsonb_typeof(p_value -> k) <> 'boolean' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function app.job_finds_out_ok(text, jsonb) from public, anon, authenticated, service_role;

-- an FAQ answer may not mention a price, a discount or a promise: the SAME words the outbox uses for its "money" and "commitment" flags decide (app.outbox_content_flags), so a job answer and a message follow one rule
create function app.job_faq_answer_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not ('money' = any (app.outbox_content_flags(p)) or 'commitment' = any (app.outbox_content_flags(p)))
$$;
revoke all on function app.job_faq_answer_ok(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- B. jobs_meta and job_faqs
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.jobs_meta (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  kind        text not null check (kind in ('speed_to_lead', 'answer_calls', 'followups', 'store_visits', 'offers', 'researcher', 'custom')),
  custom_name text check (custom_name is null or (char_length(custom_name) between 1 and 40 and app.text_is_clean(custom_name))),
  finds_out   jsonb not null default '{}'::jsonb,
  created_by  uuid not null,
  created_at  timestamptz not null default app.outbox_now(),
  updated_at  timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  check (app.job_finds_out_ok(kind, finds_out))
);
-- one job per kind in a workspace, plus any number of custom ones
create unique index jobs_meta_one_per_kind on public.jobs_meta (tenant_id, kind) where kind <> 'custom';
comment on table public.jobs_meta is 'Jobs (contract 1.0 section 1): what a job needs that the old tables do not hold: the owner''s own name for the helper and the closed list of what it asks. A job owns no other row. Written only by the job_meta_* functions.';
comment on column public.jobs_meta.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, not client-writable';
comment on column public.jobs_meta.custom_name is 'PII: the owner''s own name for the helper (up to 40 characters; never a web address or a number). Erased with the workspace.';
comment on column public.jobs_meta.finds_out is 'SAFE: closed keys, each true or false. CLEAN-EXEMPT: closed key set CHECK, not client-writable';
comment on column public.jobs_meta.created_by is 'SAFE: a user id. CLEAN-EXEMPT: an id';

create table public.job_faqs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  job_id     uuid not null,
  question   text not null check (char_length(question) between 1 and 300 and app.text_is_clean(question)),
  answer     text not null check (char_length(answer) between 1 and 300 and app.text_is_clean(answer)),
  created_by uuid not null,
  created_at timestamptz not null default app.outbox_now(),
  updated_at timestamptz not null default app.outbox_now(),
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references public.jobs_meta (tenant_id, id)
);
create index job_faqs_job_idx on public.job_faqs (tenant_id, job_id, created_at, id);
comment on table public.job_faqs is 'Jobs (contract 1.0 section 6): what the owner lets a helper answer when asked (a question and its answer, 300 characters each). An answer never states a price, a discount or a promise. Written only by the job_faq_* functions.';
comment on column public.job_faqs.question is 'PII: the owner''s own words (a question a customer may ask). Erased with the workspace.';
comment on column public.job_faqs.answer is 'PII: the owner''s own words (what the helper may answer). Erased with the workspace.';
comment on column public.job_faqs.created_by is 'SAFE: a user id. CLEAN-EXEMPT: an id';

do $$
declare
  t text;
begin
  foreach t in array array['jobs_meta', 'job_faqs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create trigger audit_jobs_meta after insert or update or delete on public.jobs_meta for each row execute function app.audit_row_change('job_meta', 'custom_name');
create trigger audit_job_faqs after insert or update or delete on public.job_faqs for each row execute function app.audit_row_change('job_faq', 'question,answer');
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('jobs_meta', 'custom_name', 'tenant', 'tombstone', 'erased:1'),
  ('jobs_meta', 'custom_name', 'sweep',  'substring', 'erased:1'),
  ('job_faqs',  'question',    'tenant', 'tombstone', 'erased:1'),
  ('job_faqs',  'question',    'sweep',  'substring', 'erased:1'),
  ('job_faqs',  'answer',      'tenant', 'tombstone', 'erased:1'),
  ('job_faqs',  'answer',      'sweep',  'substring', 'erased:1');

create function app.job_meta_json(m public.jobs_meta) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'kind', m.kind, 'custom_name', m.custom_name, 'finds_out', m.finds_out, 'created_at', m.created_at)
$$;
revoke all on function app.job_meta_json(public.jobs_meta) from public, anon, authenticated, service_role;

create function app.job_faq_json(f public.job_faqs) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', f.id, 'job_id', f.job_id, 'question', f.question, 'answer', f.answer, 'created_at', f.created_at, 'updated_at', f.updated_at)
$$;
revoke all on function app.job_faq_json(public.job_faqs) from public, anon, authenticated, service_role;

-- the job of a suggested kind, made the first time it is needed (one per kind and workspace); a custom job is made from a plan card, later
create function public.job_meta_ensure(p_tenant_id uuid, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m     public.jobs_meta;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  if p_kind is null or p_kind not in ('speed_to_lead', 'answer_calls', 'followups', 'store_visits', 'offers', 'researcher') then
    perform app.jobs_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job_meta:' || p_tenant_id::text || ':' || p_kind, 0));
  select * into m from public.jobs_meta x where x.tenant_id = p_tenant_id and x.kind = p_kind;
  if not found then
    insert into public.jobs_meta (tenant_id, kind, created_by) values (p_tenant_id, p_kind, v_uid) returning * into m;
  end if;
  return app.job_meta_json(m);
end;
$$;
revoke all on function public.job_meta_ensure(uuid, text) from public, anon;
grant execute on function public.job_meta_ensure(uuid, text) to authenticated;

-- every member reads
create function public.job_meta_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.jobs_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.job_meta_json(m) order by m.created_at, m.id) from public.jobs_meta m where m.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;
revoke all on function public.job_meta_list(uuid) from public, anon;
grant execute on function public.job_meta_list(uuid) to authenticated;

-- the helper's own name: an empty or whitespace name clears it; a digits-only name, a web address, an e-mail address or a phone number is refused (SM983)
create function public.job_meta_set_name(p_tenant_id uuid, p_id uuid, p_name text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  m      public.jobs_meta;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  if v_name is not null and not app.job_name_ok(v_name) then
    perform app.jobs_error('name_invalid');
  end if;
  update public.jobs_meta set custom_name = v_name, updated_at = app.outbox_now() where tenant_id = p_tenant_id and id = p_id returning * into m;
  if not found then
    perform app.jobs_error('reference');
  end if;
  return app.job_meta_json(m);
end;
$$;
revoke all on function public.job_meta_set_name(uuid, uuid, text) from public, anon;
grant execute on function public.job_meta_set_name(uuid, uuid, text) to authenticated;

-- what the helper asks: a PATCH of {key: true|false}; the keys must be this kind's closed keys
create function public.job_meta_set_finds_out(p_tenant_id uuid, p_id uuid, p_finds_out jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  m     public.jobs_meta;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  select * into m from public.jobs_meta x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.jobs_error('reference');
  end if;
  if p_finds_out is null or not app.job_finds_out_ok(m.kind, p_finds_out) then
    perform app.jobs_error('invalid');
  end if;
  update public.jobs_meta set finds_out = finds_out || p_finds_out, updated_at = app.outbox_now() where id = m.id returning * into m;
  return app.job_meta_json(m);
end;
$$;
revoke all on function public.job_meta_set_finds_out(uuid, uuid, jsonb) from public, anon;
grant execute on function public.job_meta_set_finds_out(uuid, uuid, jsonb) to authenticated;

-- FAQs. The same id again is the same FAQ (a retry); an answer that states a price, a discount or a promise is refused (SM984)
create function public.job_faq_add(p_tenant_id uuid, p_job_id uuid, p_question text, p_answer text, p_id uuid default gen_random_uuid()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := btrim(coalesce(p_question, ''));
  v_a   text := btrim(coalesce(p_answer, ''));
  f     public.job_faqs;
begin
  if v_uid is null or p_tenant_id is null or p_job_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  if char_length(v_q) not between 1 and 300 or char_length(v_a) not between 1 and 300 or not app.text_is_clean(v_q) or not app.text_is_clean(v_a) then
    perform app.jobs_error('invalid');
  end if;
  if not exists (select 1 from public.jobs_meta m where m.tenant_id = p_tenant_id and m.id = p_job_id) then
    perform app.jobs_error('reference');
  end if;
  select * into f from public.job_faqs x where x.tenant_id = p_tenant_id and x.id = p_id;
  if found then
    if f.job_id <> p_job_id then
      perform app.jobs_error('invalid');
    end if;
    return app.job_faq_json(f);
  end if;
  if not app.job_faq_answer_ok(v_a) then
    perform app.jobs_error('faq_not_allowed');
  end if;
  insert into public.job_faqs (id, tenant_id, job_id, question, answer, created_by) values (p_id, p_tenant_id, p_job_id, v_q, v_a, v_uid) returning * into f;
  return app.job_faq_json(f);
end;
$$;
revoke all on function public.job_faq_add(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.job_faq_add(uuid, uuid, text, text, uuid) to authenticated;

create function public.job_faq_update(p_tenant_id uuid, p_job_id uuid, p_id uuid, p_question text default null, p_answer text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := case when p_question is null then null else btrim(p_question) end;
  v_a   text := case when p_answer is null then null else btrim(p_answer) end;
  f     public.job_faqs;
begin
  if v_uid is null or p_tenant_id is null or p_job_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  if (v_q is null and v_a is null)
     or (v_q is not null and (char_length(v_q) not between 1 and 300 or not app.text_is_clean(v_q)))
     or (v_a is not null and (char_length(v_a) not between 1 and 300 or not app.text_is_clean(v_a))) then
    perform app.jobs_error('invalid');
  end if;
  if v_a is not null and not app.job_faq_answer_ok(v_a) then
    perform app.jobs_error('faq_not_allowed');
  end if;
  update public.job_faqs set question = coalesce(v_q, question), answer = coalesce(v_a, answer), updated_at = app.outbox_now() where tenant_id = p_tenant_id and job_id = p_job_id and id = p_id returning * into f;
  if not found then
    perform app.jobs_error('reference');
  end if;
  return app.job_faq_json(f);
end;
$$;
revoke all on function public.job_faq_update(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.job_faq_update(uuid, uuid, uuid, text, text) to authenticated;

create function public.job_faq_remove(p_tenant_id uuid, p_job_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or p_tenant_id is null or p_job_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  delete from public.job_faqs where tenant_id = p_tenant_id and job_id = p_job_id and id = p_id returning id into v_id;
  if not found then
    perform app.jobs_error('reference');
  end if;
  return jsonb_build_object('id', v_id, 'removed', true);
end;
$$;
revoke all on function public.job_faq_remove(uuid, uuid, uuid) from public, anon;
grant execute on function public.job_faq_remove(uuid, uuid, uuid) to authenticated;

-- every member reads
create function public.job_faq_list(p_tenant_id uuid, p_job_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_job_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.jobs_error('deny');
  end if;
  if not exists (select 1 from public.jobs_meta m where m.tenant_id = p_tenant_id and m.id = p_job_id) then
    perform app.jobs_error('reference');
  end if;
  return coalesce((select jsonb_agg(app.job_faq_json(f) order by f.created_at, f.id) from public.job_faqs f where f.tenant_id = p_tenant_id and f.job_id = p_job_id), '[]'::jsonb);
end;
$$;
revoke all on function public.job_faq_list(uuid, uuid) from public, anon;
grant execute on function public.job_faq_list(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- C. the do-not-call list
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the last four digits of a number the owner added that is NOT a contact are kept next to its key (the key alone cannot be shown); never written for a contact's number. Kept like the key (the ledger is retained on purpose).
alter table suppression.key_events add column last4 text check (last4 is null or last4 ~ '^[0-9]{4}$');
comment on column suppression.key_events.last4 is 'PII: the last four digits of a number the owner added to the do-not-call list that is not a contact (to show it); null otherwise; kept with its key (ADR 0020)';
drop trigger audit_key_events on suppression.key_events;
create trigger audit_key_events after insert or update or delete on suppression.key_events for each row execute function app.audit_row_change('suppression_key_event', 'key_hmac,last4');

-- the reason an entry is on the list, in the contract's words (1.0 section 6, build plan decision 1): the latest `suppressed` event of the contact decides.
--   opted_out from a WhatsApp STOP (the reference starts "whatsapp:")      stop_whatsapp     the customer's own word: never removable
--   opted_out said on a call (the reference starts "call:" or "call-list:") asked_on_call     the customer's own word: never removable
--   manual                                                                  added_by_owner    the only entry an Owner may take off
--   everything else (an opt-out without such a reference, legal, complained, bounced)  other  no Remove
create function app.dnc_reason_of(p_reason text, p_ref text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_reason = 'opted_out' and p_ref like 'whatsapp:%' then 'stop_whatsapp'
              when p_reason = 'opted_out' and (p_ref like 'call:%' or p_ref like 'call-list:%') then 'asked_on_call'
              when p_reason = 'manual' then 'added_by_owner'
              else 'other' end
$$;
revoke all on function app.dnc_reason_of(text, text) from public, anon, authenticated, service_role;

-- the reason of a number that has no contact (a key only): it is the owner's (and removable) only when EVERY suppression of the key since its last lift was an owner's `manual` one
create function app.dnc_key_reason(p_tenant uuid, p_hmac text) returns text
language sql
stable
set search_path = ''
as $$
  select case when exists (select 1 from suppression.key_events e
                            where e.tenant_id = p_tenant and e.kind = 'phone' and e.key_hmac = p_hmac and e.event = 'suppressed' and e.reason <> 'manual'
                              and e.seq > coalesce((select max(l.seq) from suppression.key_events l where l.tenant_id = p_tenant and l.kind = 'phone' and l.key_hmac = p_hmac and l.event = 'lifted'), 0))
              then 'other' else 'added_by_owner' end
$$;
revoke all on function app.dnc_key_reason(uuid, text) from public, anon, authenticated, service_role;

-- every entry, as the answer's JSON, with what the list sorts and searches by. A contact's entry has the contact's id; a number with no contact has the id of its latest `suppressed` event (it needs its last four digits to be
-- shown). `lifted` entries (a customer opted back in) are listed only when asked: state "lifted" with the history of how.
create function app.dnc_entries(p_tenant uuid, p_include_lifted boolean) returns table (e_id uuid, e_state text, e_sort timestamptz, e_digits text, e_last4 text, e_by text, e_json jsonb)
language sql
stable
set search_path = ''
as $$
  with latest_sup as (
    select distinct on (e.contact_id) e.contact_id, e.suppression_reason::text as reason, e.evidence_ref, e.recorded_by, e.created_at
      from public.consent_events e
     where e.tenant_id = p_tenant and e.event_type = 'suppressed'
     order by e.contact_id, e.created_at desc, e.id desc),
  lifts as (
    select e.contact_id,
           max(e.created_at) as last_lift,
           jsonb_agg(jsonb_build_object('at', e.created_at,
                                        'how', case e.evidence_ref when 'dnc:customer_message' then 'customer_message' when 'dnc:form_tick' then 'form_tick' else 'owner_recorded_yes' end,
                                        'by',  case e.evidence_ref when 'dnc:customer_message' then 'customer' when 'dnc:form_tick' then 'customer' else 'owner_recorded' end)
                     order by e.created_at, e.id) as history
      from public.consent_events e
     where e.tenant_id = p_tenant and e.event_type = 'suppression_lifted' and e.evidence_ref is distinct from 'dnc:owner_removed'
     group by e.contact_id),
  contact_entries as (
    select c.id as cid,
           case when c.suppressed_at is not null then 'active' else 'lifted' end as st,
           case when c.suppressed_at is not null then c.suppressed_at else l.last_lift end as sort_at,
           coalesce(c.suppressed_at, s.created_at) as added_at,
           case when c.suppressed_at is null then l.last_lift end as lifted_at,
           right(app.phone_norm(c.phone), 4) as last4,
           app.phone_norm(c.phone) as digits,
           app.dnc_reason_of(case when c.suppressed_at is not null then c.suppression_reason::text else s.reason end,
                             case when s.reason is not distinct from (case when c.suppressed_at is not null then c.suppression_reason::text else s.reason end) then s.evidence_ref end) as reason,
           s.recorded_by as by_user,
           coalesce(l.history, '[]'::jsonb) as history
      from public.contacts c
      left join latest_sup s on s.contact_id = c.id
      left join lifts l on l.contact_id = c.id
     where c.tenant_id = p_tenant and c.erased_at is null and app.phone_norm(c.phone) is not null
       and (c.suppressed_at is not null or (p_include_lifted and l.contact_id is not null))),
  key_entries as (
    select e.id as eid, e.created_at as added_at, e.last4, app.dnc_key_reason(p_tenant, e.key_hmac) as reason, e.created_by as by_user
      from suppression.key_events e
     where e.tenant_id = p_tenant and e.kind = 'phone' and e.event = 'suppressed' and e.last4 is not null
       and e.seq = (select max(x.seq) from suppression.key_events x where x.tenant_id = e.tenant_id and x.kind = e.kind and x.key_hmac = e.key_hmac)
       and not exists (select 1 from suppression.contact_keys k join public.contacts c on c.tenant_id = k.tenant_id and c.id = k.contact_id
                        where k.tenant_id = e.tenant_id and k.phone_hmac = e.key_hmac and c.erased_at is null and c.suppressed_at is not null))
  select ce.cid, ce.st, ce.sort_at, ce.digits, ce.last4,
         case when ce.reason = 'added_by_owner' then (select u.display_name from public.users u where u.id = ce.by_user) end,
         jsonb_build_object('id', ce.cid, 'state', ce.st, 'reason', ce.reason, 'phone_masked', '•••• ' || ce.last4, 'last4', ce.last4,
                            'added_by', case when ce.reason = 'added_by_owner' then (select u.display_name from public.users u where u.id = ce.by_user) end,
                            'added_at', ce.added_at, 'lifted_at', ce.lifted_at, 'history', ce.history)
    from contact_entries ce
  union all
  select ke.eid, 'active', ke.added_at, null::text, ke.last4,
         case when ke.reason = 'added_by_owner' then (select u.display_name from public.users u where u.id = ke.by_user) end,
         jsonb_build_object('id', ke.eid, 'state', 'active', 'reason', ke.reason, 'phone_masked', '•••• ' || ke.last4, 'last4', ke.last4,
                            'added_by', case when ke.reason = 'added_by_owner' then (select u.display_name from public.users u where u.id = ke.by_user) end,
                            'added_at', ke.added_at, 'lifted_at', null, 'history', '[]'::jsonb)
    from key_entries ke
$$;
revoke all on function app.dnc_entries(uuid, boolean) from public, anon, authenticated, service_role;

-- the list: `count` is ALWAYS the active entries; `lifted_count` only with include_lifted (contract section 16). Newest first; the cursor is "<microseconds>_<id>" of the last entry of the page before.
create function public.do_not_call_list(p_tenant_id uuid, p_q text default null, p_cursor text default null, p_limit integer default 50, p_include_lifted boolean default false) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q       text := btrim(coalesce(p_q, ''));
  v_digits  text;
  v_limit   integer := coalesce(p_limit, 50);
  v_at      timestamptz;
  v_id      uuid;
  v_items   jsonb;
  v_more    boolean;
  v_last_at timestamptz;
  v_last_id uuid;
  v_next    text;
  v_count   integer;
  v_lifted  integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.jobs_error('deny');
  end if;
  if v_limit not between 1 and 100 or char_length(v_q) > 80 or not app.text_is_clean(v_q) then
    perform app.jobs_error('invalid');
  end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]{10,17}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.jobs_error('invalid');
    end if;
    v_at := timestamptz 'epoch' + (split_part(p_cursor, '_', 1)::bigint::double precision * interval '1 microsecond');
    v_id := split_part(p_cursor, '_', 2)::uuid;
  end if;
  v_digits := regexp_replace(app.ascii_digits(v_q), '[^0-9]', '', 'g');
  with f as (
    select x.e_id, x.e_sort, x.e_json
      from app.dnc_entries(p_tenant_id, coalesce(p_include_lifted, false)) x
     where (v_q = ''
            or (v_digits <> '' and ((x.e_digits is not null and position(v_digits in x.e_digits) > 0)
                                    or (x.e_last4 is not null and (case when char_length(v_digits) > 4 then right(v_digits, 4) = x.e_last4 else position(v_digits in x.e_last4) > 0 end))))
            or (x.e_by is not null and position(lower(v_q) in lower(x.e_by)) > 0))
       and (v_at is null or (x.e_sort, x.e_id) < (v_at, v_id))),
  top as (select * from f order by e_sort desc, e_id desc limit v_limit),
  oldest as (select e_sort, e_id from top order by e_sort asc, e_id asc limit 1)
  select coalesce((select jsonb_agg(t.e_json order by t.e_sort desc, t.e_id desc) from top t), '[]'::jsonb),
         (select count(*) from f) > v_limit,
         (select o.e_sort from oldest o),
         (select o.e_id from oldest o)
    into v_items, v_more, v_last_at, v_last_id;
  if v_more then
    v_next := (extract(epoch from v_last_at) * 1000000)::bigint::text || '_' || v_last_id::text;
  end if;
  select count(*) into v_count from app.dnc_entries(p_tenant_id, false);
  select count(*) into v_lifted from app.dnc_entries(p_tenant_id, true) x where x.e_state = 'lifted';
  return jsonb_build_object('items', v_items, 'count', v_count, 'next_cursor', v_next)
         || case when coalesce(p_include_lifted, false) then jsonb_build_object('lifted_count', v_lifted) else '{}'::jsonb end;
end;
$$;
revoke all on function public.do_not_call_list(uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.do_not_call_list(uuid, text, text, integer, boolean) to authenticated;

-- add a number (Owner, Admin). A contact that has it is suppressed through the EXISTING function (reason manual: the owner's own entry); a number that is not a contact is stored as its KEY only
-- (the API's HMAC: the database cannot check it, like every key) with its last four digits. The same number again is the same entry.
create function public.do_not_call_add(p_tenant_id uuid, p_phone text, p_keys jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_norm  text := app.phone_norm(p_phone);
  v_hmac  text;
  v_ver   smallint;
  c       record;
  v_id    uuid;
  v_found boolean := false;
  v_last  suppression.key_events;
  v_entry jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  if v_norm is null or p_keys is null or jsonb_typeof(p_keys) <> 'object' or p_keys ? 'email' or (p_keys ->> 'phone') is null or not app.suppression_keys_ok(p_keys, '{}'::jsonb) then
    perform app.jobs_error('invalid');
  end if;
  v_hmac := p_keys ->> 'phone';
  v_ver := (p_keys ->> 'version')::smallint;
  for c in
    select x.id, x.suppressed_at from public.contacts x
     where x.tenant_id = p_tenant_id and x.erased_at is null and app.phone_norm(x.phone) = v_norm order by x.created_at, x.id
  loop
    v_found := true;
    v_id := coalesce(v_id, c.id);
    if c.suppressed_at is null then
      perform public.suppress_contact(p_tenant_id, c.id, 'manual'::public.suppression_reason, 'other'::public.evidence_type, 'dnc:owner_added');
    end if;
  end loop;
  if not v_found then
    perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || p_tenant_id::text || ':phone:' || v_hmac, 0));
    select * into v_last from suppression.key_events e where e.tenant_id = p_tenant_id and e.kind = 'phone' and e.key_hmac = v_hmac order by e.seq desc limit 1;
    -- nothing to do when the key is already suppressed AND already shows its last digits; otherwise the owner's own event is added (an older, stronger reason on the same key keeps it from being removed)
    if not (found and v_last.event = 'suppressed' and v_last.last4 is not null) then
      insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason, source_contact_id, created_by, last4)
      values (p_tenant_id, 'phone', v_hmac, v_ver, 'suppressed', 'manual', null, v_uid, right(v_norm, 4)) returning * into v_last;
    end if;
    v_id := v_last.id;
  end if;
  select x.e_json into v_entry from app.dnc_entries(p_tenant_id, false) x where x.e_id = v_id;
  return coalesce(v_entry, jsonb_build_object('id', v_id, 'state', 'active'));
end;
$$;
revoke all on function public.do_not_call_add(uuid, text, jsonb) from public, anon;
grant execute on function public.do_not_call_add(uuid, text, jsonb) to authenticated;

-- take an entry off: the OWNER only, with the second factor, and ONLY an entry the owner added. An entry whose reason is stop_whatsapp or asked_on_call can NEVER be removed by anyone (SM985); `other` has no
-- Remove (SM986). The removal is itself a recorded event: a `suppression_lifted` ledger row (evidence "dnc:owner_removed") for a contact, a `lifted` key event for a number with no contact.
create function public.do_not_call_remove(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_entry  jsonb;
  v_reason text;
  c        public.contacts;
  e        suppression.key_events;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  perform app.require_aal2();
  select x.e_json into v_entry from app.dnc_entries(p_tenant_id, false) x where x.e_id = p_id;
  if v_entry is null then
    perform app.jobs_error('reference');
  end if;
  v_reason := v_entry ->> 'reason';
  if v_reason in ('stop_whatsapp', 'asked_on_call') then
    perform app.jobs_error('stopped');
  elsif v_reason <> 'added_by_owner' then
    perform app.jobs_error('not_removable');
  end if;
  select * into c from public.contacts x where x.tenant_id = p_tenant_id and x.id = p_id and x.erased_at is null for update;
  if found then
    perform public.lift_suppression(p_tenant_id, c.id, 'other'::public.evidence_type, 'dnc:owner_removed');
  else
    select * into e from suppression.key_events k where k.tenant_id = p_tenant_id and k.id = p_id and k.kind = 'phone' and k.event = 'suppressed';
    if not found then
      perform app.jobs_error('reference');
    end if;
    perform app.suppression_key_lift(p_tenant_id, 'phone', e.key_hmac, e.key_version, null, v_uid);
  end if;
  return v_entry || jsonb_build_object('state', 'removed');
end;
$$;
revoke all on function public.do_not_call_remove(uuid, uuid) from public, anon;
grant execute on function public.do_not_call_remove(uuid, uuid) to authenticated;

-- the ONLY way an entry the customer asked for comes off: the customer opts back in (a message saying they want contact, a form tick) or the owner records the customer's yes with how it was given. Internal: no
-- client role can call it (the callers that know the customer wrote or ticked come later); it records the lift with the closed word of HOW so the entry can show its history. Consent itself is NOT given back.
create function app.dnc_opt_in(p_tenant uuid, p_contact uuid, p_how text, p_by uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  c    public.contacts;
  v_id uuid;
begin
  if p_how is null or p_how not in ('customer_message', 'owner_recorded_yes', 'form_tick') then
    perform app.jobs_error('invalid');
  end if;
  select * into c from public.contacts x where x.tenant_id = p_tenant and x.id = p_contact and x.erased_at is null for update;
  if not found then
    perform app.jobs_error('reference');
  end if;
  if c.suppressed_at is null then
    return null;
  end if;
  update public.contacts set suppressed_at = null, suppression_reason = null where id = c.id;
  insert into public.consent_events (tenant_id, contact_id, event_type, evidence_type, evidence_ref, recorded_by)
  values (p_tenant, c.id, 'suppression_lifted',
          case p_how when 'form_tick' then 'web_form'::public.evidence_type when 'owner_recorded_yes' then 'verbal'::public.evidence_type else 'other'::public.evidence_type end,
          'dnc:' || p_how, p_by)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.dnc_opt_in(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- D. the consent tick on lead sources (contract section 6): who confirmed, when, and which wording they saw
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.lead_sources
  add column consent_confirmed_by uuid,
  add column consent_confirmed_at timestamptz,
  add column consent_text_version text check (consent_text_version is null or consent_text_version ~ '^[a-z0-9._-]{1,32}$'),
  add constraint lead_sources_consent_tick_whole check ((consent_confirmed_by is null) = (consent_confirmed_at is null) and (consent_text_version is null or consent_confirmed_at is not null));
comment on column public.lead_sources.consent_confirmed_by is 'SAFE: the user who ticked "the people in this source agreed to be contacted" when connecting it. CLEAN-EXEMPT: an id';
comment on column public.lead_sources.consent_confirmed_at is 'SAFE: when they ticked it. CLEAN-EXEMPT: a time';
comment on column public.lead_sources.consent_text_version is 'SAFE: the version word of the sentence they ticked (the web holds the words). CLEAN-EXEMPT: pattern CHECK';

create function public.lead_source_consent_tick(p_tenant_id uuid, p_kinds text[], p_text_version text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.jobs_error('deny');
  end if;
  if p_kinds is null or cardinality(p_kinds) not between 1 and 8 or p_text_version is null or p_text_version !~ '^[a-z0-9._-]{1,32}$'
     or exists (select 1 from unnest(p_kinds) k where k is null or k !~ '^[a-z_]{2,30}$') then
    perform app.jobs_error('invalid');
  end if;
  update public.lead_sources set consent_confirmed_by = v_uid, consent_confirmed_at = app.outbox_now(), consent_text_version = p_text_version, updated_at = app.outbox_now()
   where tenant_id = p_tenant_id and kind = any (p_kinds);
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end;
$$;
revoke all on function public.lead_source_consent_tick(uuid, text[], text) from public, anon;
grant execute on function public.lead_source_consent_tick(uuid, text[], text) to authenticated;
