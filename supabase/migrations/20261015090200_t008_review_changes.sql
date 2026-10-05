-- T008 / commit 3b (owner review of commit 3): a new migration; nothing earlier is amended.
--
--   1. public.add_requirement_field: a HUMAN adds a field the extraction missed ("add missing field"). Owner / Admin / Sales. Creates the
--      draft requirement if none exists (the enquiry row is locked; SM208 when a confirmed one exists), stores the field as state 'corrected'
--      decided by the caller, created_via 'manual'. One field per (line, key); same value shape and caps as the agent path. The quote is
--      optional; when given it is verified exactly like the agent's. quote / quote_start / quote_end are nullable ONLY for a manual field.
--   2. agent_write_requirement_field: a delivery city must appear in its quote (whitespace-normalised, lower-cased). A human correction stays free.
--   3. a unique_violation on requirements_one_active_key (a confirm / insert race) becomes SM208, in the agent write and in add_requirement_field.
--   4. app.text_has_contact: the same rule, faster patterns (the e-mail scan started at every position of a long run of address characters and
--      was quadratic: it now starts only at the start of a run; the phone test is guarded by a one-character lookahead). The Python scrubber uses
--      the SAME two patterns (a test fails when they drift). Its timing on adversarial 6,000-character inputs is tested (pgTAP 55, unit tests).
--   5. public.requirement_v1: ONLY the confirmed / corrected fields of a CONFIRMED requirement, same RLS as the tables (security invoker).
--      It is the contract the quote ticket will read (docs/plans/t009-quote-engine.md). No quote and no enquiry text in it.
--   6. the requirement definition's input ceiling is 40,000 tokens (it was 20,000): a 6,000-character text in Devanagari, Kannada or Telugu is up
--      to 18,000 bytes, and the cost reservation bounds a call's input by the BYTES it sends (ADR 0013), plus the prompt and the provider's overhead.

-- ---------------------------------------------------------------------------------------------
-- 1. manual fields: the quote is optional for them and only for them
-- ---------------------------------------------------------------------------------------------
alter table public.requirement_fields alter column quote drop not null;
alter table public.requirement_fields alter column quote_start drop not null;
alter table public.requirement_fields alter column quote_end drop not null;
alter table public.requirement_fields add constraint requirement_fields_quote_all_or_none
  check ((quote is null) = (quote_start is null) and (quote is null) = (quote_end is null));
alter table public.requirement_fields add constraint requirement_fields_agent_needs_quote
  check (created_via = 'manual' or quote is not null);

create function public.add_requirement_field(
  p_enquiry_id  uuid,
  p_line        smallint,
  p_key         text,
  p_value_code  text default null,
  p_value_int   bigint default null,
  p_value_date  date default null,
  p_value_text  text default null,
  p_basis       text default null,
  p_quote       text default null,
  p_start       integer default null,
  p_end         integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  e       public.enquiries;
  v_body  text;
  v_quote text;
  v_req   uuid;
  f       public.requirement_fields;
  v_field uuid;
begin
  if v_uid is null or p_enquiry_id is null then
    perform app.requirement_deny();
  end if;
  -- the tenant comes from the ENQUIRY: an unknown id and another tenant's id are the same refusal
  select * into e from public.enquiries x where x.id = p_enquiry_id;
  if not found or not app.has_tenant_role(e.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.requirement_deny();
  end if;
  if p_key is null or p_key <> all (array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'])
     or (p_quote is null) <> (p_start is null) or (p_quote is null) <> (p_end is null)
     or char_length(coalesce(p_quote, '')) > 4000 or char_length(coalesce(p_value_text, '')) > 200
     or char_length(coalesce(p_value_code, '')) > 100 or char_length(coalesce(p_basis, '')) > 100 then
    perform app.requirement_error('invalid');
  end if;

  -- serialise with the agent's writes and other humans on this enquiry; an archived enquiry is not worked on
  select x.body into v_body from public.enquiries x where x.tenant_id = e.tenant_id and x.id = e.id and x.archived_at is null for update;
  if not found then
    perform app.requirement_error('reference');
  end if;
  if exists (select 1 from public.requirements q where q.tenant_id = e.tenant_id and q.enquiry_id = e.id and q.status = 'confirmed') then
    perform app.requirement_error('SM208');
  end if;

  -- same shape, vocabulary and caps as the agent's path
  if not app.requirement_value_ok(p_key, p_line, p_value_code, p_value_int, p_value_date, p_value_text, p_basis)
     or not app.text_is_clean(p_value_code) or not app.text_is_clean(p_value_text) or not app.text_is_clean(p_basis) then
    perform app.requirement_error('value');
  end if;
  -- the quote, when given, is verified exactly like the agent's
  if p_quote is not null then
    v_quote := app.requirement_ws(p_quote);
    if char_length(v_quote) not between 1 and 300 or p_start < 0 or p_end <= p_start or p_end > char_length(v_body) or p_end - p_start > 1200
       or app.requirement_ws(substr(v_body, p_start + 1, p_end - p_start)) is distinct from v_quote or not app.text_is_clean(v_quote) then
      perform app.requirement_error('value');
    end if;
  end if;

  -- the draft requirement: the active one, or a new manual draft
  select q.id into v_req from public.requirements q where q.tenant_id = e.tenant_id and q.enquiry_id = e.id and q.status = 'draft';
  if v_req is null then
    v_req := gen_random_uuid();
    perform set_config('app.created_via', 'manual', true);
    begin
      insert into public.requirements (id, tenant_id, enquiry_id, status) values (v_req, e.tenant_id, e.id, 'draft');
    exception when unique_violation then
      perform app.requirement_error('SM208');
    end;
    perform set_config('app.created_via', '', true);
  end if;

  -- one field per slot: an exact retry by the same person is a replay; anything else is refused (use decide_requirement_field to change a field)
  select * into f from public.requirement_fields x
   where x.tenant_id = e.tenant_id and x.requirement_id = v_req and x.field_key = p_key::public.requirement_field_key and x.line_no is not distinct from p_line;
  if found then
    if f.created_via = 'manual' and f.decided_by = v_uid and f.value_code is not distinct from p_value_code and f.value_int is not distinct from p_value_int
       and f.value_date is not distinct from p_value_date and f.value_text is not distinct from p_value_text and f.basis is not distinct from p_basis
       and f.quote is not distinct from v_quote and f.quote_start is not distinct from p_start and f.quote_end is not distinct from p_end then
      return jsonb_build_object('field_id', f.id, 'requirement_id', v_req, 'replayed', true);
    end if;
    perform app.requirement_error('value');
  end if;
  if (select count(*) from public.requirement_fields x where x.tenant_id = e.tenant_id and x.requirement_id = v_req) >= 40 then
    perform app.requirement_error('value');
  end if;

  v_field := gen_random_uuid();
  perform set_config('app.created_via', 'manual', true);
  insert into public.requirement_fields
    (id, tenant_id, requirement_id, line_no, field_key, value_code, value_int, value_date, value_text, basis, certainty, quote, quote_start, quote_end,
     state, decided_by, decided_at)
  values
    (v_field, e.tenant_id, v_req, p_line, p_key::public.requirement_field_key, p_value_code, p_value_int, p_value_date, p_value_text, p_basis, 'stated',
     v_quote, p_start, p_end, 'corrected', v_uid, now());
  perform set_config('app.created_via', '', true);
  return jsonb_build_object('field_id', v_field, 'requirement_id', v_req, 'replayed', false);
end;
$$;
revoke all on function public.add_requirement_field(uuid, smallint, text, text, bigint, date, text, text, text, integer, integer) from public, anon;
grant execute on function public.add_requirement_field(uuid, smallint, text, text, bigint, date, text, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2 and 3. agent_write_requirement_field: the previous definition plus the city rule and the SM208 mapping
-- ---------------------------------------------------------------------------------------------
create or replace function public.agent_write_requirement_field(
  p_run_id      uuid,
  p_step_key    text,
  p_line        smallint,
  p_key         text,
  p_value_code  text,
  p_value_int   bigint,
  p_value_date  date,
  p_value_text  text,
  p_basis       text,
  p_certainty   text,
  p_quote       text,
  p_start       integer,
  p_end         integer,
  p_conflict    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.agent_runs;
  v_body   text;
  v_quote  text;
  v_sha    text;
  v_replay jsonb;
  v_req    uuid;
  v_field  uuid;
begin
  r := app.agent_open_run(p_run_id);
  if r.agent_name <> 'requirement' or r.enquiry_id is null then
    perform app.agent_state_error('value');
  end if;
  if p_step_key is null or p_key is null or p_certainty is null or p_quote is null or p_start is null or p_end is null or p_conflict is null
     or p_key <> all (array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'])
     or p_certainty <> all (array['stated', 'implied', 'ambiguous']) then
    perform app.agent_state_error('invalid');
  end if;
  -- bound the work before doing any: a quote is at most 300 characters, and the whitespace around it is not worth more than a few thousand
  if char_length(p_quote) > 4000 or char_length(coalesce(p_value_text, '')) > 200 or char_length(coalesce(p_value_code, '')) > 100
     or char_length(coalesce(p_basis, '')) > 100 or char_length(p_step_key) > 64 then
    perform app.agent_state_error('invalid');
  end if;
  v_quote := app.requirement_ws(p_quote);
  v_sha := app.agent_args_sha(jsonb_build_object('line', p_line, 'key', p_key, 'code', p_value_code, 'int', p_value_int, 'date', p_value_date,
                                                  'text', p_value_text, 'basis', p_basis, 'certainty', p_certainty, 'quote', v_quote,
                                                  'start', p_start, 'end', p_end, 'conflict', p_conflict));
  v_replay := app.agent_step_replay(r, p_step_key, 'agent_write_requirement_field', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;

  -- the enquiry the run is about (the tenant is the run's own); lock it so two runs cannot both create the active draft
  select e.body into v_body from public.enquiries e
   where e.tenant_id = r.tenant_id and e.id = r.enquiry_id and e.archived_at is null for update;
  if not found then
    perform app.agent_state_error('reference');
  end if;
  if exists (select 1 from public.requirements q where q.tenant_id = r.tenant_id and q.enquiry_id = r.enquiry_id and q.status = 'confirmed') then
    perform app.requirement_error('SM208');
  end if;

  -- THE QUOTE IS VERIFIED HERE, against the stored text: the span (in characters) must say the quote, whitespace aside
  if char_length(v_quote) not between 1 and 300 or p_start < 0 or p_end <= p_start or p_end > char_length(v_body) or p_end - p_start > 1200
     or app.requirement_ws(substr(v_body, p_start + 1, p_end - p_start)) is distinct from v_quote then
    perform app.agent_state_error('value');
  end if;
  -- a delivery city must appear in its quote (whitespace-normalised, lower-cased); the human's correction stays free
  if p_key = 'delivery_city' and strpos(lower(v_quote), lower(app.requirement_ws(p_value_text))) = 0 then
    perform app.agent_state_error('value');
  end if;
  -- the value's shape, the vocabulary and the caps
  if not app.requirement_value_ok(p_key, p_line, p_value_code, p_value_int, p_value_date, p_value_text, p_basis)
     or not app.text_is_clean(p_value_code) or not app.text_is_clean(p_value_text) or not app.text_is_clean(p_basis) or not app.text_is_clean(v_quote) then
    perform app.agent_state_error('value');
  end if;

  -- this run's draft requirement (the first write creates it and supersedes an older draft of the same enquiry)
  perform app.agent_charge_write(r);
  v_req := app.agent_derived_id(r.id, 'requirement', 'requirement');
  if not exists (select 1 from public.requirements q where q.tenant_id = r.tenant_id and q.id = v_req) then
    perform set_config('app.created_via', 'agent', true);
    update public.requirements q set status = 'superseded' where q.tenant_id = r.tenant_id and q.enquiry_id = r.enquiry_id and q.status = 'draft';
    begin
      insert into public.requirements (id, tenant_id, enquiry_id, agent_run_id, status) values (v_req, r.tenant_id, r.enquiry_id, r.id, 'draft');
    exception when unique_violation then
      -- a confirm that committed between the check above and this insert: the enquiry has a confirmed requirement now
      perform app.requirement_error('SM208');
    end;
    perform set_config('app.created_via', '', true);
  end if;
  if (select count(*) from public.requirement_fields f where f.tenant_id = r.tenant_id and f.requirement_id = v_req) >= 40
     or exists (select 1 from public.requirement_fields f where f.tenant_id = r.tenant_id and f.requirement_id = v_req
                   and f.field_key = p_key::public.requirement_field_key and f.line_no is not distinct from p_line) then
    perform app.agent_state_error('value');
  end if;

  v_field := app.agent_derived_id(r.id, p_step_key, 'field');
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', r.id::text, true);
  insert into public.requirement_fields
    (id, tenant_id, requirement_id, line_no, field_key, value_code, value_int, value_date, value_text, basis, certainty, quote, quote_start, quote_end, conflict)
  values
    (v_field, r.tenant_id, v_req, p_line, p_key::public.requirement_field_key, p_value_code, p_value_int, p_value_date, p_value_text, p_basis,
     p_certainty::public.requirement_certainty, v_quote, p_start, p_end, p_conflict);
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);

  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'write', 'agent_write_requirement_field', 'ok', v_sha,
          jsonb_build_object('field_id', v_field, 'requirement_id', v_req));
  return jsonb_build_object('field_id', v_field, 'requirement_id', v_req, 'replayed', false);
end;
$$;


-- ---------------------------------------------------------------------------------------------
-- 4. the contact guard: same rule, linear-time patterns (identical to app/requirements/scrub.py)
-- ---------------------------------------------------------------------------------------------
create or replace function app.text_has_contact(p text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is not null and (
    p ~* '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+'
    or p ~* '(?=[+0-9])(?<![A-Za-z0-9₹#/])(?<![0-9][,.])(?<!rs\ )(?<!rs\.)(?<!rs\.\ )(?<!rs:)(?<!rs:\ )(?<!rs\-)(?<!rs\-\ )(?<!rs\#)(?<!rs\#\ )(?<!inr\ )(?<!inr\.)(?<!inr\.\ )(?<!inr:)(?<!inr:\ )(?<!inr\-)(?<!inr\-\ )(?<!inr\#)(?<!inr\#\ )(?<!rupees\ )(?<!rupees\.)(?<!rupees\.\ )(?<!rupees:)(?<!rupees:\ )(?<!rupees\-)(?<!rupees\-\ )(?<!rupees\#)(?<!rupees\#\ )(?<!rupee\ )(?<!rupee\.)(?<!rupee\.\ )(?<!rupee:)(?<!rupee:\ )(?<!rupee\-)(?<!rupee\-\ )(?<!rupee\#)(?<!rupee\#\ )(?<!po\ )(?<!po\.)(?<!po\.\ )(?<!po:)(?<!po:\ )(?<!po\-)(?<!po\-\ )(?<!po\#)(?<!po\#\ )(?<!ref\ )(?<!ref\.)(?<!ref\.\ )(?<!ref:)(?<!ref:\ )(?<!ref\-)(?<!ref\-\ )(?<!ref\#)(?<!ref\#\ )(?<!inv\ )(?<!inv\.)(?<!inv\.\ )(?<!inv:)(?<!inv:\ )(?<!inv\-)(?<!inv\-\ )(?<!inv\#)(?<!inv\#\ )(?<!invoice\ )(?<!invoice\.)(?<!invoice\.\ )(?<!invoice:)(?<!invoice:\ )(?<!invoice\-)(?<!invoice\-\ )(?<!invoice\#)(?<!invoice\#\ )(?<!order\ )(?<!order\.)(?<!order\.\ )(?<!order:)(?<!order:\ )(?<!order\-)(?<!order\-\ )(?<!order\#)(?<!order\#\ )(?<!no\ )(?<!no\.)(?<!no\.\ )(?<!no:)(?<!no:\ )(?<!no\-)(?<!no\-\ )(?<!no\#)(?<!no\#\ )(?<!gst\ )(?<!gst\.)(?<!gst\.\ )(?<!gst:)(?<!gst:\ )(?<!gst\-)(?<!gst\-\ )(?<!gst\#)(?<!gst\#\ )(?<!gstin\ )(?<!gstin\.)(?<!gstin\.\ )(?<!gstin:)(?<!gstin:\ )(?<!gstin\-)(?<!gstin\-\ )(?<!gstin\#)(?<!gstin\#\ )(?<!pin\ )(?<!pin\.)(?<!pin\.\ )(?<!pin:)(?<!pin:\ )(?<!pin\-)(?<!pin\-\ )(?<!pin\#)(?<!pin\#\ )(?<!amt\ )(?<!amt\.)(?<!amt\.\ )(?<!amt:)(?<!amt:\ )(?<!amt\-)(?<!amt\-\ )(?<!amt\#)(?<!amt\#\ )(?<!amount\ )(?<!amount\.)(?<!amount\.\ )(?<!amount:)(?<!amount:\ )(?<!amount\-)(?<!amount\-\ )(?<!amount\#)(?<!amount\#\ )(?<!total\ )(?<!total\.)(?<!total\.\ )(?<!total:)(?<!total:\ )(?<!total\-)(?<!total\-\ )(?<!total\#)(?<!total\#\ )(?<!qty\ )(?<!qty\.)(?<!qty\.\ )(?<!qty:)(?<!qty:\ )(?<!qty\-)(?<!qty\-\ )(?<!qty\#)(?<!qty\#\ )(?<!₹\ )(?<!₹\.)(?<!₹\.\ )(?<!₹:)(?<!₹:\ )(?<!₹\-)(?<!₹\-\ )(?<!₹\#)(?<!₹\#\ )(?:(?:\+91|91|0)[ -]?[6-9][0-9]{4}[ -]?[0-9]{5}|[6-9][0-9]{9}|(?![6-9][0-9]{2}00[ -][0-9]{3}00(?![0-9]))[6-9][0-9]{4}[ -][0-9]{5})(?![A-Za-z0-9]|[,.][0-9]{1,3}(?![0-9]))')
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. requirement_v1
-- ---------------------------------------------------------------------------------------------
create view public.requirement_v1 with (security_invoker = true) as
  select r.id as requirement_id, r.tenant_id, r.enquiry_id, r.schema_version, r.confirmed_by, r.confirmed_at,
         f.id as field_id, f.line_no, f.field_key, f.value_code, f.value_int, f.value_date, f.value_text, f.basis, f.state
    from public.requirements r
    join public.requirement_fields f on f.tenant_id = r.tenant_id and f.requirement_id = r.id
   where r.status = 'confirmed' and f.state in ('confirmed', 'corrected');
revoke all on public.requirement_v1 from public, anon, authenticated;
grant select on public.requirement_v1 to authenticated;
comment on view public.requirement_v1 is
  'T008 contract v1: the confirmed / corrected fields of a CONFIRMED requirement, nothing else (no quote, no enquiry text, no proposal). security_invoker: the caller''s RLS applies. Quantities are pieces or sets (1..10,000), money is paise, dates are calendar dates.';

-- ---------------------------------------------------------------------------------------------
-- 6. the input ceiling
-- ---------------------------------------------------------------------------------------------
update public.agent_definitions set max_input_tokens = 40000 where agent_name = 'requirement';
