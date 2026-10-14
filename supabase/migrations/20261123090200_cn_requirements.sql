-- Job CN (wave 2, C1, ADR 0085), migration 3 of 7: the REQUIREMENT fields of a building-materials enquiry (blueprint section 5.2). The enum values were added by migration 2; this file uses them.
--
--   Application (driveway, footpath, parking, industrial yard, garden, road), product type, thickness (mm), area (sq ft or sq m, in hundredths) or length and width (ft or m, in hundredths), site location, laying
--   (yes or no) and the existing needed-by date (`deadline`), delivery city, budget and payment terms. A line (1 to 5) is one product the customer wants; application, site location and laying belong to the whole enquiry.
--   The Requirement Analyst proposes them with a quote of the enquiry exactly as it does for sarees; a person confirms, corrects or rejects each one; a value it is not sure of is `ambiguous` and goes to the owner.
--
--   * app.requirement_vocab / app.requirement_value_ok   REPLACED as full copies (the previous text plus the new arms; the quantity basis also takes the selling units of the closed list)
--   * app.requirement_keys(tenant)   the field keys a business uses: the building-materials keys where the `materials` module is on, the saree keys everywhere else (so every existing business is unchanged)
--   * app.requirement_confirmable    REPLACED: where `materials` is on, a requirement may be confirmed when one line has its product type AND its area (or length and width, or a quantity) confirmed; elsewhere the old rule
--   * public.add_requirement_field and public.agent_write_requirement_field   REPLACED as full copies; the ONLY differences are the key allow-list (app.requirement_keys) and, in the agent's, the rule "a delivery city must
--     appear in its quote" which now also applies to the site location (services/ai-api/tests/test_migration_copies_cn.py pins the differences)
--   * a trigger refuses a field key the business does not use (belt and braces)
-- SQLSTATEs are the existing ones (22023, SM2xx); nothing new.

create or replace function app.requirement_vocab(p_key text) returns text[]
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
    when 'application' then array['driveway', 'footpath', 'parking', 'industrial_yard', 'garden', 'road', 'other']
    when 'product_type' then array['paver_block', 'kerb_stone', 'brick', 'tile', 'cement', 'sand', 'aggregate', 'other']
    when 'laying' then array['yes', 'no']
  end
$$;

create or replace function app.requirement_value_ok(
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
                           and p_date is null and p_text is null and p_basis in ('piece', 'set', 'box', 'bag', 'tonne', 'cft', 'truckload')
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
    when 'application' then p_line is null and p_code = any (app.requirement_vocab('application'))
                           and p_int is null and p_date is null and p_text is null and p_basis is null
    when 'product_type' then p_line between 1 and 5 and p_code = any (app.requirement_vocab('product_type'))
                           and p_int is null and p_date is null and p_text is null and p_basis is null
    when 'thickness'  then p_line between 1 and 5 and p_code is null and p_int between 10 and 300
                           and p_date is null and p_text is null and p_basis = 'mm'
    when 'area'       then p_line between 1 and 5 and p_code is null and p_int between 1 and 100000000
                           and p_date is null and p_text is null and p_basis in ('sq_ft', 'sq_m')
    when 'length'     then p_line between 1 and 5 and p_code is null and p_int between 1 and 10000000
                           and p_date is null and p_text is null and p_basis in ('ft', 'm')
    when 'width'      then p_line between 1 and 5 and p_code is null and p_int between 1 and 10000000
                           and p_date is null and p_text is null and p_basis in ('ft', 'm')
    when 'site_location' then p_line is null and p_code is null and p_int is null and p_date is null and p_basis is null
                           and char_length(btrim(p_text)) between 1 and 120
    when 'laying'     then p_line is null and p_code = any (app.requirement_vocab('laying'))
                           and p_int is null and p_date is null and p_text is null and p_basis is null
  end, false)
$$;

-- where `materials` is on: the product type and the measure of the SAME line are settled by a human (the measure is an area, a length and a width, or a quantity); elsewhere exactly the old rule
create or replace function app.requirement_confirmable(p_tenant uuid, p_requirement uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select case when app.module_enabled(p_tenant, 'materials') then
    exists (
      select 1 from public.requirement_fields t
       where t.tenant_id = p_tenant and t.requirement_id = p_requirement and t.field_key = 'product_type' and t.state in ('confirmed', 'corrected')
         and (exists (select 1 from public.requirement_fields u
                       where u.tenant_id = t.tenant_id and u.requirement_id = t.requirement_id and u.field_key in ('area', 'quantity')
                         and u.line_no = t.line_no and u.state in ('confirmed', 'corrected'))
              or (exists (select 1 from public.requirement_fields u
                           where u.tenant_id = t.tenant_id and u.requirement_id = t.requirement_id and u.field_key = 'length' and u.line_no = t.line_no and u.state in ('confirmed', 'corrected'))
                  and exists (select 1 from public.requirement_fields u
                               where u.tenant_id = t.tenant_id and u.requirement_id = t.requirement_id and u.field_key = 'width' and u.line_no = t.line_no and u.state in ('confirmed', 'corrected')))))
  else
    exists (
      select 1 from public.requirement_fields t
       where t.tenant_id = p_tenant and t.requirement_id = p_requirement and t.field_key = 'saree_type' and t.state in ('confirmed', 'corrected')
         and exists (select 1 from public.requirement_fields u
                      where u.tenant_id = t.tenant_id and u.requirement_id = t.requirement_id and u.field_key = 'quantity'
                        and u.line_no = t.line_no and u.state in ('confirmed', 'corrected')))
  end
$$;

create function app.requirement_keys(p_tenant uuid) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.module_enabled(p_tenant, 'materials')
              then array['application', 'product_type', 'thickness', 'area', 'length', 'width', 'site_location', 'laying', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms']
              else array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'] end
$$;
revoke all on function app.requirement_keys(uuid) from public;

create function app.requirement_fields_key_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.field_key::text <> all (app.requirement_keys(new.tenant_id)) then
    raise exception 'this field is not used by this business' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.requirement_fields_key_guard() from public;
create trigger requirement_fields_key_guard before insert on public.requirement_fields for each row execute function app.requirement_fields_key_guard();

create or replace function public.add_requirement_field(
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
  v_status public.requirement_status;
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
  if p_key is null or p_key <> all (app.requirement_keys(e.tenant_id))
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
  -- the active requirement, locked (enquiry row first, then this row): only a DRAFT takes a field
  select q.id, q.status into v_req, v_status from public.requirements q
   where q.tenant_id = e.tenant_id and q.enquiry_id = e.id and q.status in ('draft', 'confirmed') for update;
  if found and v_status <> 'draft' then
    -- small fix A1: an EXACT retry of a typed field replays even after the requirement is confirmed (checked before the refusal); anything else is still refused
    select * into f from public.requirement_fields x
     where x.tenant_id = e.tenant_id and x.requirement_id = v_req and x.field_key = p_key::public.requirement_field_key and x.line_no is not distinct from p_line;
    if found and f.created_via = 'manual' and f.decided_by = v_uid and f.value_code is not distinct from p_value_code and f.value_int is not distinct from p_value_int
       and f.value_date is not distinct from p_value_date and f.value_text is not distinct from p_value_text and f.basis is not distinct from p_basis
       and f.quote is not distinct from (case when p_quote is null then null else app.requirement_ws(p_quote) end) and f.quote_start is not distinct from p_start
       and f.quote_end is not distinct from p_end then
      return jsonb_build_object('field_id', f.id, 'requirement_id', v_req, 'replayed', true);
    end if;
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
  v_status public.requirement_status;
  v_field  uuid;
begin
  r := app.agent_open_run(p_run_id);
  if r.agent_name <> 'requirement' or r.enquiry_id is null then
    perform app.agent_state_error('value');
  end if;
  if p_step_key is null or p_key is null or p_certainty is null or p_quote is null or p_start is null or p_end is null or p_conflict is null
     or p_key <> all (app.requirement_keys(r.tenant_id))
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
  if p_key in ('delivery_city', 'site_location') and strpos(lower(v_quote), lower(app.requirement_ws(p_value_text))) = 0 then
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
  select q.status into v_status from public.requirements q where q.tenant_id = r.tenant_id and q.id = v_req for update;
  if found then
    -- this run's own requirement (enquiry row first, then this row): a later run superseded it, or it was discarded: no more fields
    if v_status <> 'draft' then
      perform app.requirement_error('SM209');
    end if;
  else
    -- the first write supersedes the enquiry's active draft: not when a person has worked on it since the run started. The draft is locked
    -- BEFORE the test (decide_requirement_field holds that lock while it decides), so a decision in flight is waited for and then seen.
    perform 1 from public.requirements q where q.tenant_id = r.tenant_id and q.enquiry_id = r.enquiry_id and q.status = 'draft' for update;
    if app.requirement_human_work(r.tenant_id, r.enquiry_id) then
      perform app.requirement_error('SM211');
    end if;
    perform set_config('app.created_via', 'agent', true);
    update public.requirements q set status = 'superseded' where q.tenant_id = r.tenant_id and q.enquiry_id = r.enquiry_id and q.status = 'draft';
    begin
      insert into public.requirements (id, tenant_id, enquiry_id, agent_run_id, status) values (v_req, r.tenant_id, r.enquiry_id, r.id, 'draft');
    exception when unique_violation then
      -- cannot happen under the enquiry lock (confirm takes it first); kept so a broken invariant answers SM208, not a unique violation
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

-- the grants of the replaced functions are unchanged (create or replace keeps them); stated again so a reader need not look
revoke all on function public.add_requirement_field(uuid, smallint, text, text, bigint, date, text, text, text, integer, integer) from public, anon;
