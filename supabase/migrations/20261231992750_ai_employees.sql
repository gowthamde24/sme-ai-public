-- AI employees (owner go, 26 Nov 2026; design: reports/ai-employees-design.md). A workspace has one DEFAULT employee (today's business assistant, migrated 1:1: nothing changes for it) and, on a paid plan, up to four more, each with its own name, role,
-- responsibilities, instructions, languages, voice per language, opening line, hours, what it may do alone, never-say words and (later) its own phone number and WhatsApp number.
-- ONE migration holds all three phases' columns. Behind the API flag EMPLOYEES (off by default): until it is switched on nothing reads these tables on a call.
--   public.ai_employees          one row per employee
--   public.ai_employee_voices    the voice (catalogue id) an employee speaks each language with
--   ai_employee_id               nullable columns on phone_calls, tasks, jobs_meta and phone_numbers (null = the default employee)
-- The default employee keeps its persona in public.assistant_settings and public.voice_choices (the owner's "My assistant" settings): its row here holds only the identity (role, responsibilities, extra instructions, never-say). A non-default employee holds everything itself.
-- Safety above employee text is in code, not here: money guard, consent, DND, calling window (an employee's hours can only NARROW the legal 10:00 to 21:00 window), lawyer-opinion rules, the workspace's never-say words (an employee's are ADDED).

create function app.employee_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'employee_limit'     then raise exception 'too many employees' using errcode = 'SM861';
    when 'name_taken'         then raise exception 'name already used' using errcode = 'SM862';
    when 'last_default'       then raise exception 'the default employee cannot be archived or paused' using errcode = 'SM863';
    when 'hours_wider'        then raise exception 'hours wider than the allowed calling window' using errcode = 'SM864';
    when 'settings_elsewhere' then raise exception 'the default employee''s persona is set in My assistant' using errcode = 'SM865';
    when 'invalid'            then raise exception 'invalid input' using errcode = '22023';
    when 'reference'          then raise exception 'not found' using errcode = '23503';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.employee_error(text) from public;

create table public.ai_employees (
  id                    uuid not null,
  tenant_id             uuid not null references public.tenants (id) on delete restrict,
  name                  text not null check (char_length(btrim(name)) between 1 and 24 and app.text_is_clean(name) and name !~ '[<>{}@/\\|]'),
  role_code             text not null check (role_code in ('receptionist', 'sales', 'follow_up', 'collections', 'support', 'appointments', 'custom')),
  role_title            text check (role_title is null or (char_length(btrim(role_title)) between 3 and 60 and app.text_is_clean(role_title) and role_title !~ '[<>]')),
  status                text not null default 'draft' check (status in ('draft', 'on', 'paused', 'archived')),
  is_default            boolean not null default false,
  sort_order            integer not null default 0,
  responsibilities      text[] not null default '{}' check (cardinality(responsibilities) <= 20 and app.text_is_clean(responsibilities)),
  extra_instructions    text check (extra_instructions is null or (char_length(extra_instructions) <= 1500 and app.text_is_clean(extra_instructions))),
  languages             text[] not null default '{en}' check (cardinality(languages) between 1 and 7 and languages <@ array['en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr']),
  auto_switch_language  boolean not null default true,
  allow_english_mixing  boolean not null default true,
  style                 text check (style is null or style in ('friendly', 'respectful', 'quick', 'casual')),
  speed                 numeric(3, 2) check (speed is null or speed between 0.7 and 1.3),
  opening_line          jsonb not null default '{}'::jsonb check (jsonb_typeof(opening_line) = 'object'),
  autonomy              jsonb not null default '{}'::jsonb check (jsonb_typeof(autonomy) = 'object'),
  ask_first             text[] not null default '{send_message,make_call,give_discount,promise_date}' check (ask_first <@ array['send_message', 'make_call', 'give_discount', 'promise_date', 'book_visit', 'share_price', 'send_media']),
  hours                 jsonb check (hours is null or jsonb_typeof(hours) = 'object'),
  never_say             text[] not null default '{}' check (cardinality(never_say) <= 30 and app.text_is_clean(never_say)),
  phone_number_id       uuid,
  whatsapp_number_ref   text check (whatsapp_number_ref is null or (char_length(whatsapp_number_ref) <= 64 and app.text_is_clean(whatsapp_number_ref))),
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_by            uuid,
  updated_at            timestamptz not null default now(),
  primary key (tenant_id, id)
);
create unique index ai_employees_one_default on public.ai_employees (tenant_id) where is_default and status <> 'archived';
create unique index ai_employees_name_live on public.ai_employees (tenant_id, lower(name)) where status <> 'archived';
create index ai_employees_phone_idx on public.ai_employees (tenant_id, phone_number_id) where phone_number_id is not null;
comment on table public.ai_employees is 'The AI employees of a business (the default one is the business assistant). Written only by SECURITY DEFINER functions; behind the EMPLOYEES switch.';
comment on column public.ai_employees.name is 'SAFE: the employee''s own name, as the owner chose it; passes app.text_is_clean, no markup characters';
comment on column public.ai_employees.role_code is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_employees.role_title is 'SAFE: the owner''s words for the job title; passes app.text_is_clean, no markup characters';
comment on column public.ai_employees.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_employees.responsibilities is 'SAFE: closed ids of the jobs the employee does (checked in the function); passes app.text_is_clean';
comment on column public.ai_employees.extra_instructions is 'SAFE: the owner''s own instructions for this employee (at most 1,500 characters); treated as DATA by the call, never above the platform rules; passes app.text_is_clean';
comment on column public.ai_employees.languages is 'SAFE: language codes. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_employees.style is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_employees.opening_line is 'SAFE: the opening sentence per language, written by the Owner; checked with app.text_is_clean in the function. CLEAN-EXEMPT: bounded object';
comment on column public.ai_employees.autonomy is 'SAFE: closed keys (may_answer_prices, may_book_visits, ...) with booleans and numbers. CLEAN-EXEMPT: checked in the function';
comment on column public.ai_employees.ask_first is 'SAFE: closed action words. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_employees.hours is 'SAFE: days and minutes of the day. CLEAN-EXEMPT: checked in the function (never wider than the legal calling window)';
comment on column public.ai_employees.never_say is 'SAFE: words the Owner never wants this employee to say; passes app.text_is_clean; added to the workspace''s never-say list';
comment on column public.ai_employees.whatsapp_number_ref is 'SAFE: the id of a WhatsApp number at the provider, not a phone number';

create table public.ai_employee_voices (
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  employee_id  uuid not null,
  language     text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')),
  voice_code   text not null check (voice_code ~ '^[a-z]{2}-[a-z0-9_]{1,40}$'),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, employee_id, language),
  foreign key (tenant_id, employee_id) references public.ai_employees (tenant_id, id) on delete restrict
);
comment on table public.ai_employee_voices is 'The catalogue voice an AI employee speaks each language with. Written only by SECURITY DEFINER functions.';
comment on column public.ai_employee_voices.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_employee_voices.voice_code is 'SAFE: a voice id of the catalogue. CLEAN-EXEMPT: pattern CHECK';

-- (the starters table of migration 992710 had no FORCE row level security: the guard that checks every public table wants it)
alter table public.sell_list_starters force row level security;

-- the references (all nullable: null means the default employee)
alter table public.phone_calls add column ai_employee_id uuid;
alter table public.tasks add column ai_employee_id uuid;
alter table public.jobs_meta add column ai_employee_id uuid;
alter table public.phone_numbers add column ai_employee_id uuid;
alter table public.phone_calls add constraint phone_calls_ai_employee_fk foreign key (tenant_id, ai_employee_id) references public.ai_employees (tenant_id, id) on delete restrict;
alter table public.tasks add constraint tasks_ai_employee_fk foreign key (tenant_id, ai_employee_id) references public.ai_employees (tenant_id, id) on delete restrict;
alter table public.jobs_meta add constraint jobs_meta_ai_employee_fk foreign key (tenant_id, ai_employee_id) references public.ai_employees (tenant_id, id) on delete restrict;
alter table public.phone_numbers add constraint phone_numbers_ai_employee_fk foreign key (tenant_id, ai_employee_id) references public.ai_employees (tenant_id, id) on delete restrict;
create index tasks_ai_employee_idx on public.tasks (tenant_id, ai_employee_id) where ai_employee_id is not null;
create index jobs_meta_ai_employee_idx on public.jobs_meta (tenant_id, ai_employee_id) where ai_employee_id is not null;
create index phone_calls_ai_employee_idx on public.phone_calls (tenant_id, ai_employee_id, created_at desc) where ai_employee_id is not null;
create index phone_numbers_ai_employee_idx on public.phone_numbers (tenant_id, ai_employee_id) where ai_employee_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['ai_employees', 'ai_employee_voices'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t || '_select', t);
  end loop;
end $$;
create trigger audit_ai_employees after insert or update or delete on public.ai_employees for each row execute function app.audit_row_change('ai_employee');
create trigger audit_ai_employee_voices after insert or update or delete on public.ai_employee_voices for each row execute function app.audit_row_change('ai_employee_voice');

-- ------------------------------------------------------------------------------------------------------------------------------ helpers
create function app.employee_cap(p_tenant uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$ select case when app.sell_list_paid(p_tenant) then 5 else 1 end $$;
revoke all on function app.employee_cap(uuid) from public, anon, authenticated, service_role;

-- the default employee: today's assistant, made once per workspace (the migration below does every existing workspace; a new workspace gets it on first read)
create function app.employees_ensure_default(p_tenant uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_lang text;
  v_name text;
begin
  select e.id into v_id from public.ai_employees e where e.tenant_id = p_tenant and e.is_default and e.status <> 'archived';
  if found then
    return v_id;
  end if;
  select nullif(btrim(a.assistant_name), ''), a.main_language into v_name, v_lang from public.assistant_settings a where a.tenant_id = p_tenant;
  v_id := gen_random_uuid();
  insert into public.ai_employees (id, tenant_id, name, role_code, status, is_default, languages, ask_first)
  values (v_id, p_tenant, left(coalesce(v_name, 'Assistant'), 24), 'receptionist', 'on', true,
          case when v_lang in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr') then array[v_lang] else array['en'] end,
          '{send_message,make_call,give_discount,promise_date}')
  on conflict do nothing;
  select e.id into v_id from public.ai_employees e where e.tenant_id = p_tenant and e.is_default and e.status <> 'archived';
  return v_id;
end;
$$;
revoke all on function app.employees_ensure_default(uuid) from public, anon, authenticated, service_role;

-- every existing workspace gets its default employee, copied from today's assistant (1:1: the persona stays where it is)
insert into public.ai_employees (id, tenant_id, name, role_code, status, is_default, languages)
select gen_random_uuid(), t.id, left(coalesce(nullif(btrim(a.assistant_name), ''), 'Assistant'), 24), 'receptionist', 'on', true,
       case when a.main_language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr') then array[a.main_language] else array['en'] end
  from public.tenants t left join public.assistant_settings a on a.tenant_id = t.id
 where not exists (select 1 from public.ai_employees e where e.tenant_id = t.id and e.is_default);

create function app.employee_json(p_tenant uuid, p_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'name', case when e.is_default then coalesce(nullif(btrim(a.assistant_name), ''), e.name) else e.name end,
    'role_code', e.role_code, 'role_title', e.role_title, 'status', e.status, 'is_default', e.is_default,
    'responsibilities', to_jsonb(e.responsibilities), 'extra_instructions', e.extra_instructions,
    'languages', to_jsonb(e.languages), 'auto_switch_language', e.auto_switch_language, 'allow_english_mixing', e.allow_english_mixing,
    'style', e.style, 'speed', e.speed, 'opening_line', e.opening_line, 'autonomy', e.autonomy, 'ask_first', to_jsonb(e.ask_first),
    'hours', e.hours, 'never_say', to_jsonb(e.never_say), 'phone_number_id', e.phone_number_id, 'whatsapp_number_ref', e.whatsapp_number_ref,
    'persona_in', case when e.is_default then 'my_assistant' else 'employee' end,
    'voices', case when e.is_default then coalesce((select jsonb_object_agg(v.language, v.voice_code) from public.voice_choices v where v.tenant_id = e.tenant_id), '{}'::jsonb)
                   else coalesce((select jsonb_object_agg(v.language, v.voice_code) from public.ai_employee_voices v where v.tenant_id = e.tenant_id and v.employee_id = e.id), '{}'::jsonb) end,
    'calls_today', (select count(*) from public.phone_calls c where c.tenant_id = e.tenant_id and c.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                       and (c.ai_employee_id = e.id or (e.is_default and c.ai_employee_id is null))),
    'created_at', e.created_at, 'updated_at', e.updated_at)
    from public.ai_employees e left join public.assistant_settings a on a.tenant_id = e.tenant_id and e.is_default
   where e.tenant_id = p_tenant and e.id = p_id
$$;
revoke all on function app.employee_json(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ reads
create function public.employees_list(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.employee_error('deny');
  end if;
  perform app.employees_ensure_default(p_tenant_id);
  return jsonb_build_object('employees', coalesce((select jsonb_agg(app.employee_json(e.tenant_id, e.id) order by e.is_default desc, e.sort_order, e.created_at, e.id)
                                                    from public.ai_employees e where e.tenant_id = p_tenant_id and e.status <> 'archived'), '[]'::jsonb),
                            'limit', app.employee_cap(p_tenant_id));
end;
$$;
revoke all on function public.employees_list(uuid) from public, anon;
grant execute on function public.employees_list(uuid) to authenticated;

create function public.employee_get(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or p_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.employee_error('deny');
  end if;
  perform app.employees_ensure_default(p_tenant_id);
  if not exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = p_id) then
    perform app.employee_error('reference');
  end if;
  return app.employee_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.employee_get(uuid, uuid) from public, anon;
grant execute on function public.employee_get(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ writes
create function public.employee_create(p_tenant_id uuid, p_id uuid, p_role_code text, p_name text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_old  public.ai_employees;
  v_n    integer;
  v_resp text[];
  v_lang text[];
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.employee_error('deny');
  end if;
  if char_length(v_name) not between 1 and 24 or not app.text_is_clean(v_name) or v_name ~ '[<>{}@/\\|]'
     or p_role_code is null or p_role_code not in ('receptionist', 'sales', 'follow_up', 'collections', 'support', 'appointments', 'custom') then
    perform app.employee_error('invalid');
  end if;
  perform app.employees_ensure_default(p_tenant_id);
  select * into v_old from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = p_id for update;
  if found then   -- the same id again is a retry of the same employee
    if v_old.status = 'archived' or v_old.role_code <> p_role_code or lower(v_old.name) <> lower(v_name) then
      perform app.employee_error('invalid');
    end if;
    return app.employee_json(p_tenant_id, p_id);
  end if;
  select count(*) into v_n from public.ai_employees e where e.tenant_id = p_tenant_id and e.status <> 'archived';
  if v_n >= app.employee_cap(p_tenant_id) then
    perform app.employee_error('employee_limit');
  end if;
  if exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant_id and e.status <> 'archived' and lower(e.name) = lower(v_name)) then
    perform app.employee_error('name_taken');
  end if;
  -- the role's starting point: what it is usually asked to do (the owner edits it)
  v_resp := case p_role_code
    when 'receptionist' then array['enquiry_reply', 'faq_answers', 'visit_booking']
    when 'sales' then array['enquiry_reply', 'quote_chase', 'lead_qualify']
    when 'follow_up' then array['follow_up', 'review_request']
    when 'collections' then array['payment_reminder']
    when 'support' then array['enquiry_reply', 'faq_answers']
    when 'appointments' then array['visit_booking', 'appointment_reminder']
    else '{}'::text[] end;
  select coalesce(array[a.main_language], array['en']) into v_lang from (select main_language from public.assistant_settings where tenant_id = p_tenant_id) a;
  v_lang := coalesce(v_lang, array['en']);
  if not (v_lang <@ array['en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr']) then
    v_lang := array['en'];
  end if;
  insert into public.ai_employees (id, tenant_id, name, role_code, status, sort_order, responsibilities, languages, created_by, updated_by)
  values (p_id, p_tenant_id, v_name, p_role_code, 'draft', v_n, v_resp, v_lang, v_uid, v_uid);
  return app.employee_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.employee_create(uuid, uuid, text, text) from public, anon;
grant execute on function public.employee_create(uuid, uuid, text, text) to authenticated;

-- one patch of the editable fields (what is left out is kept). The default employee takes identity fields only: its persona is the Owner's "My assistant" settings.
create function public.employee_update(p_tenant_id uuid, p_id uuid, p_patch jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  e      public.ai_employees;
  k      text;
  v_name text;
  v_arr  text[];
  v_def_keys constant text[] := array['name', 'role_code', 'role_title', 'responsibilities', 'extra_instructions', 'never_say'];
  v_all_keys constant text[] := array['name', 'role_code', 'role_title', 'responsibilities', 'extra_instructions', 'never_say', 'languages', 'auto_switch_language', 'allow_english_mixing', 'style', 'speed', 'opening_line', 'autonomy', 'ask_first', 'hours'];
  v_from integer;
  v_to   integer;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.employee_error('deny');
  end if;
  select * into e from public.ai_employees x where x.tenant_id = p_tenant_id and x.id = p_id and x.status <> 'archived' for update;
  if not found then
    perform app.employee_error('reference');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_all_keys)) then
      perform app.employee_error('invalid');
    end if;
    if e.is_default and not (k = any (v_def_keys)) then
      perform app.employee_error('settings_elsewhere');
    end if;
  end loop;
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if char_length(v_name) not between 1 and 24 or not app.text_is_clean(v_name) or v_name ~ '[<>{}@/\\|]' then
      perform app.employee_error('invalid');
    end if;
    if exists (select 1 from public.ai_employees x where x.tenant_id = p_tenant_id and x.id <> p_id and x.status <> 'archived' and lower(x.name) = lower(v_name)) then
      perform app.employee_error('name_taken');
    end if;
    e.name := v_name;
    if e.is_default then   -- the default employee's name IS the assistant's name
      update public.assistant_settings set assistant_name = v_name, updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id;
    end if;
  end if;
  if p_patch ? 'role_code' then
    if p_patch ->> 'role_code' not in ('receptionist', 'sales', 'follow_up', 'collections', 'support', 'appointments', 'custom') then
      perform app.employee_error('invalid');
    end if;
    e.role_code := p_patch ->> 'role_code';
  end if;
  if p_patch ? 'role_title' then
    e.role_title := nullif(btrim(coalesce(p_patch ->> 'role_title', '')), '');
  end if;
  if p_patch ? 'responsibilities' then
    if jsonb_typeof(p_patch -> 'responsibilities') <> 'array' then perform app.employee_error('invalid'); end if;
    v_arr := array(select jsonb_array_elements_text(p_patch -> 'responsibilities'));
    if cardinality(v_arr) > 20 or exists (select 1 from unnest(v_arr) r where r !~ '^[a-z][a-z0-9_]{1,40}$') then perform app.employee_error('invalid'); end if;
    e.responsibilities := v_arr;
  end if;
  if p_patch ? 'extra_instructions' then
    e.extra_instructions := nullif(btrim(coalesce(p_patch ->> 'extra_instructions', '')), '');
  end if;
  if p_patch ? 'never_say' then
    if jsonb_typeof(p_patch -> 'never_say') <> 'array' then perform app.employee_error('invalid'); end if;
    v_arr := array(select btrim(w) from jsonb_array_elements_text(p_patch -> 'never_say') w where btrim(w) <> '');
    if cardinality(v_arr) > 30 or exists (select 1 from unnest(v_arr) w where char_length(w) > 60 or not app.text_is_clean(w)) then perform app.employee_error('invalid'); end if;
    e.never_say := v_arr;
  end if;
  if p_patch ? 'languages' then
    if jsonb_typeof(p_patch -> 'languages') <> 'array' then perform app.employee_error('invalid'); end if;
    v_arr := array(select jsonb_array_elements_text(p_patch -> 'languages'));
    if cardinality(v_arr) not between 1 and 7 or not (v_arr <@ array['en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr']) then perform app.employee_error('invalid'); end if;
    e.languages := v_arr;
  end if;
  if p_patch ? 'auto_switch_language' then e.auto_switch_language := coalesce((p_patch ->> 'auto_switch_language')::boolean, true); end if;
  if p_patch ? 'allow_english_mixing' then e.allow_english_mixing := coalesce((p_patch ->> 'allow_english_mixing')::boolean, true); end if;
  if p_patch ? 'style' then e.style := nullif(p_patch ->> 'style', ''); end if;
  if p_patch ? 'speed' then e.speed := nullif(p_patch ->> 'speed', '')::numeric; end if;
  if p_patch ? 'opening_line' then
    if jsonb_typeof(p_patch -> 'opening_line') <> 'object'
       or exists (select 1 from jsonb_each_text(p_patch -> 'opening_line') o where o.key not in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr') or char_length(btrim(o.value)) not between 10 and 300 or not app.text_is_clean(o.value) or o.value ~ '[<>]') then
      perform app.employee_error('invalid');
    end if;
    e.opening_line := p_patch -> 'opening_line';
  end if;
  if p_patch ? 'autonomy' then
    if jsonb_typeof(p_patch -> 'autonomy') <> 'object'
       or exists (select 1 from jsonb_object_keys(p_patch -> 'autonomy') a where a not in ('may_answer_prices', 'may_book_visits', 'may_send_media', 'may_talk_dues', 'max_discount_percent', 'handover_owner_asked', 'handover_upset', 'handover_order_above_paise')) then
      perform app.employee_error('invalid');
    end if;
    if (p_patch -> 'autonomy' ? 'max_discount_percent' and ((p_patch -> 'autonomy' ->> 'max_discount_percent')::integer not between 0 and 100))
       or (p_patch -> 'autonomy' ? 'handover_order_above_paise' and ((p_patch -> 'autonomy' ->> 'handover_order_above_paise')::bigint not between 0 and 100000000000)) then
      perform app.employee_error('invalid');
    end if;
    e.autonomy := p_patch -> 'autonomy';
  end if;
  if p_patch ? 'ask_first' then
    if jsonb_typeof(p_patch -> 'ask_first') <> 'array' then perform app.employee_error('invalid'); end if;
    v_arr := array(select jsonb_array_elements_text(p_patch -> 'ask_first'));
    if not (v_arr <@ array['send_message', 'make_call', 'give_discount', 'promise_date', 'book_visit', 'share_price', 'send_media']) then perform app.employee_error('invalid'); end if;
    e.ask_first := v_arr;
  end if;
  if p_patch ? 'hours' then
    if p_patch -> 'hours' = 'null'::jsonb then
      e.hours := null;
    else
      v_from := (p_patch -> 'hours' ->> 'from_minute')::integer;
      v_to := (p_patch -> 'hours' ->> 'to_minute')::integer;
      if jsonb_typeof(p_patch -> 'hours') <> 'object' or jsonb_typeof(p_patch -> 'hours' -> 'days') <> 'array' or v_from is null or v_to is null or v_from >= v_to
         or exists (select 1 from jsonb_array_elements_text(p_patch -> 'hours' -> 'days') d where d !~ '^[1-7]$') or jsonb_array_length(p_patch -> 'hours' -> 'days') not between 1 and 7 then
        perform app.employee_error('invalid');
      end if;
      if v_from < 600 or v_to > 1260 then   -- never wider than the legal calling window (10:00 to 21:00)
        perform app.employee_error('hours_wider');
      end if;
      e.hours := jsonb_build_object('days', p_patch -> 'hours' -> 'days', 'from_minute', v_from, 'to_minute', v_to);
    end if;
  end if;
  update public.ai_employees x set name = e.name, role_code = e.role_code, role_title = e.role_title, responsibilities = e.responsibilities, extra_instructions = e.extra_instructions,
         never_say = e.never_say, languages = e.languages, auto_switch_language = e.auto_switch_language, allow_english_mixing = e.allow_english_mixing, style = e.style, speed = e.speed,
         opening_line = e.opening_line, autonomy = e.autonomy, ask_first = e.ask_first, hours = e.hours, updated_by = v_uid, updated_at = now()
   where x.tenant_id = p_tenant_id and x.id = p_id;
  return app.employee_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.employee_update(uuid, uuid, jsonb) from public, anon;
grant execute on function public.employee_update(uuid, uuid, jsonb) to authenticated;

create function public.employee_status_set(p_tenant_id uuid, p_id uuid, p_status text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e     public.ai_employees;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.employee_error('deny');
  end if;
  if p_status is null or p_status not in ('on', 'paused', 'archived') then
    perform app.employee_error('invalid');
  end if;
  select * into e from public.ai_employees x where x.tenant_id = p_tenant_id and x.id = p_id and x.status <> 'archived' for update;
  if not found then
    perform app.employee_error('reference');
  end if;
  if e.is_default and p_status <> 'on' then
    perform app.employee_error('last_default');
  end if;
  if p_status = 'on' and e.status = 'draft' and (e.role_title is null and cardinality(e.responsibilities) = 0) then
    perform app.employee_error('invalid');   -- a draft needs at least a title or something to do before it is switched on
  end if;
  if p_status = 'archived' then   -- an employee that numbers or jobs still point at is released from them first (the references stay on the old calls and tasks)
    update public.phone_numbers set ai_employee_id = null where tenant_id = p_tenant_id and ai_employee_id = p_id;
    update public.jobs_meta set ai_employee_id = null where tenant_id = p_tenant_id and ai_employee_id = p_id;
    update public.ai_employees set phone_number_id = null where tenant_id = p_tenant_id and id = p_id;
  end if;
  update public.ai_employees set status = p_status, updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id and id = p_id;
  return app.employee_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.employee_status_set(uuid, uuid, text) from public, anon;
grant execute on function public.employee_status_set(uuid, uuid, text) to authenticated;

create function public.employee_voice_set(p_tenant_id uuid, p_id uuid, p_language text, p_voice_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e     public.ai_employees;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.employee_error('deny');
  end if;
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr') or p_voice_code is null or p_voice_code !~ '^[a-z]{2}-[a-z0-9_]{1,40}$' or left(p_voice_code, 2) <> p_language then
    perform app.employee_error('invalid');
  end if;
  select * into e from public.ai_employees x where x.tenant_id = p_tenant_id and x.id = p_id and x.status <> 'archived' for update;
  if not found then
    perform app.employee_error('reference');
  end if;
  if e.is_default then   -- the default employee speaks with the workspace's own choices (My assistant > Voice)
    perform app.employee_error('settings_elsewhere');
  end if;
  if not (p_language = any (e.languages)) then
    perform app.employee_error('invalid');
  end if;
  insert into public.ai_employee_voices (tenant_id, employee_id, language, voice_code, updated_by) values (p_tenant_id, p_id, p_language, p_voice_code, v_uid)
  on conflict (tenant_id, employee_id, language) do update set voice_code = excluded.voice_code, updated_by = excluded.updated_by, updated_at = now();
  return app.employee_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.employee_voice_set(uuid, uuid, text, text) from public, anon;
grant execute on function public.employee_voice_set(uuid, uuid, text, text) to authenticated;

-- Phase 3: the line an employee answers (a number of this workspace; null takes it away). A line has one employee.
create function public.employee_phone_set(p_tenant_id uuid, p_id uuid, p_phone_number_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  e     public.ai_employees;
begin
  if v_uid is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.employee_error('deny');
  end if;
  select * into e from public.ai_employees x where x.tenant_id = p_tenant_id and x.id = p_id and x.status <> 'archived' for update;
  if not found then
    perform app.employee_error('reference');
  end if;
  if e.is_default then
    perform app.employee_error('settings_elsewhere');   -- a number with no employee already goes to the default
  end if;
  if p_phone_number_id is not null and not exists (select 1 from public.phone_numbers n where n.tenant_id = p_tenant_id and n.id = p_phone_number_id) then
    perform app.employee_error('reference');
  end if;
  update public.phone_numbers set ai_employee_id = null where tenant_id = p_tenant_id and ai_employee_id = p_id;
  if p_phone_number_id is not null then
    update public.phone_numbers set ai_employee_id = p_id where tenant_id = p_tenant_id and id = p_phone_number_id;
  end if;
  update public.ai_employees set phone_number_id = p_phone_number_id, updated_by = v_uid, updated_at = now() where tenant_id = p_tenant_id and id = p_id;
  return app.employee_json(p_tenant_id, p_id);
end;
$$;
revoke all on function public.employee_phone_set(uuid, uuid, uuid) from public, anon;
grant execute on function public.employee_phone_set(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ activity
create function public.employee_activity(p_tenant_id uuid, p_id uuid, p_limit integer default 30, p_before timestamptz default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def boolean;
begin
  if auth.uid() is null or p_tenant_id is null or p_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.employee_error('deny');
  end if;
  select e.is_default into v_def from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = p_id;
  if not found then
    perform app.employee_error('reference');
  end if;
  return jsonb_build_object('calls', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'direction', c.direction, 'state', c.state, 'purpose', c.purpose, 'language', c.language, 'outcome', c.outcome,
                                                      'duration_s', c.duration_s, 'created_at', c.created_at) order by c.created_at desc, c.id)
                                               from (select * from public.phone_calls x where x.tenant_id = p_tenant_id and (x.ai_employee_id = p_id or (v_def and x.ai_employee_id is null))
                                                        and (p_before is null or x.created_at < p_before) order by x.created_at desc, x.id limit greatest(1, least(coalesce(p_limit, 30), 100))) c), '[]'::jsonb));
end;
$$;
revoke all on function public.employee_activity(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.employee_activity(uuid, uuid, integer, timestamptz) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ what a call reads (the scheduler's account)
-- The employee that answers a line (Phase 3) or does a task (the task's own, else the default), with what the call needs. The default employee returns `persona_in: my_assistant`: the call keeps reading assistant_settings and voice_choices as before.
create function public.employee_runtime(p_tenant_id uuid, p_employee_id uuid default null, p_line text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_employee_id;
  v_json jsonb;
begin
  if auth.uid() is null or not app.is_scheduler() or p_tenant_id is null then
    perform app.employee_error('deny');
  end if;
  if v_id is null and p_line is not null then
    select n.ai_employee_id into v_id from public.phone_numbers n where n.tenant_id = p_tenant_id and n.number = p_line;
  end if;
  if v_id is not null and not exists (select 1 from public.ai_employees e where e.tenant_id = p_tenant_id and e.id = v_id and e.status = 'on') then
    v_id := null;   -- an employee that is not on (draft, paused, archived) never answers: the default does
  end if;
  if v_id is null then
    select e.id into v_id from public.ai_employees e where e.tenant_id = p_tenant_id and e.is_default and e.status <> 'archived';
  end if;
  if v_id is null then
    return null;
  end if;
  v_json := app.employee_json(p_tenant_id, v_id);
  return v_json - 'calls_today' - 'created_at' - 'updated_at';
end;
$$;
revoke all on function public.employee_runtime(uuid, uuid, text) from public, anon;
grant execute on function public.employee_runtime(uuid, uuid, text) to authenticated;
