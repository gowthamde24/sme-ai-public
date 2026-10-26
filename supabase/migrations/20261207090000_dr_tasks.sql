-- Job DR part B1 (night run 27 Oct 2026): "ASK VIJAYA TO DO IT". The owner types or says one instruction ("call all new leads from this week and ask if they still want a site visit", "ask my three cement suppliers
-- their price per bag and delivery day"); the assistant turns it into a PLAN (who, which channel, the goal, the questions, a time window, the estimated cost); the owner approves ONCE for everyone; the platform runs it
-- and reports: a short answer first, then a row per person.
--
--   public.tasks             the task: the instruction, the plan (a validated document), its state, the estimate, the cap and what was spent
--   public.task_contacts     one row per person: waiting | excluded | in_progress | done | failed | skipped, with the outcome, the captured fields, the (simulated) transcript, the cost
--   public.task_save / task_get / tasks_list / task_contacts_list / task_exclude / task_approve / task_claim / task_contact_result / task_set_state / task_set_cap / task_report
--
-- Who: Owner, Admin and Sales plan, answer, exclude and read (a Viewer reads); only the OWNER approves (second factor); Owner and Admin run, pause, resume and cancel. Nobody writes a table: every write is a SECURITY DEFINER
-- function that proves the role first. A model never reads these tables: the plan is written by the API from the model's structured answer and checked by code; the report is built by code.
-- THE PEOPLE are the workspace's own contacts (each with a lead): the API resolves the model's description against the workspace's own rows, and the database refuses a contact of another workspace.
-- SCHOOLS (owner decision, 25 Oct): no fees, marks or dues in any goal, question or message, and no payment reminder: the database refuses a school's plan whose text reads as money (SM951).
-- Telephony does not exist yet: every result is marked simulated and carries a synthetic transcript.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM306 second factor needed, SM951 not for schools, SM952 the plan changed since it was seen, SM953 not in a state that allows this.

create function app.task_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'schools'   then raise exception 'not for schools' using errcode = 'SM951';
    when 'changed'   then raise exception 'the plan changed since it was seen' using errcode = 'SM952';
    when 'state'     then raise exception 'the task is not in a state that allows this' using errcode = 'SM953';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.task_error(text) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  instruction     text not null check (char_length(instruction) between 3 and 1500 and app.text_is_clean(instruction)),
  language        text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  status          text not null default 'planned' check (status in ('needs_answer', 'planned', 'approved', 'running', 'paused', 'done', 'cancelled')),
  template        text not null default 'custom' check (template in ('call_new_leads', 'reengage_old_leads', 'confirm_appointments', 'collect_feedback', 'payment_reminder', 'supplier_price_enquiry', 'offer_invite', 'custom')),
  question        text check (char_length(question) <= 300 and app.text_is_clean(question)),
  answer          text check (char_length(answer) <= 500 and app.text_is_clean(answer)),
  plan            jsonb check (plan is null or (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 20000)),
  plan_sha256     text check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  estimate        jsonb not null default '{}'::jsonb check (jsonb_typeof(estimate) = 'object'),
  estimated_paise bigint not null default 0 check (estimated_paise >= 0),
  cap_paise       bigint check (cap_paise is null or cap_paise >= 0),
  spent_paise     bigint not null default 0 check (spent_paise >= 0),
  pause_reason    text check (pause_reason in ('cap', 'owner')),
  created_by      uuid not null,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz not null default app.outbox_now(),
  updated_at      timestamptz not null default app.outbox_now(),
  finished_at     timestamptz,
  unique (tenant_id, id),
  check ((status in ('approved', 'running', 'paused', 'done')) = (approved_at is not null) or status = 'cancelled'),
  check ((status = 'paused') = (pause_reason is not null))
);
comment on table public.tasks is 'Job DR B1: an instruction the owner gave and the plan made from it. Written only by the task functions. A model never reads it.';
comment on column public.tasks.instruction is 'PII: the owner''s own words (may name a customer or a supplier). Erased with the workspace.';
comment on column public.tasks.question is 'PII: the one question the assistant asked (may repeat a name). Erased with the workspace.';
comment on column public.tasks.answer is 'PII: the owner''s answer. Erased with the workspace.';
comment on column public.tasks.plan is 'PII: goal, questions and wording of the task (may name a business or a product). Validated by the API; read by people only. CLEAN-EXEMPT: a validated document, never read by a model';
comment on column public.tasks.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.tasks.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.tasks.template is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.tasks.pause_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.tasks.plan_sha256 is 'SAFE: a hash. CLEAN-EXEMPT: pattern CHECK';
comment on column public.tasks.estimate is 'SAFE: numbers (counts, minutes, paise) computed by code. CLEAN-EXEMPT: numbers only';
create index tasks_tenant_idx on public.tasks (tenant_id, created_at desc, id);

create table public.task_contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  task_id       uuid not null,
  contact_id    uuid not null,
  lead_id       uuid not null,
  seq           bigint generated always as identity,
  status        text not null default 'waiting' check (status in ('waiting', 'excluded', 'in_progress', 'done', 'failed', 'skipped')),
  skip_reason   text check (skip_reason in ('suppressed', 'erased', 'archived', 'no_phone', 'no_consent', 'promotional_call_off', 'opted_out', 'no_lead', 'not_in_plan', 'cancelled')),
  outcome       text check (outcome in ('positive', 'negative', 'unclear', 'no_answer', 'failed')),
  category      text check (category in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'call_back_later')),
  captured      jsonb check (captured is null or jsonb_typeof(captured) = 'object'),
  transcript    jsonb check (transcript is null or jsonb_typeof(transcript) = 'array'),
  recording_ref text check (char_length(recording_ref) <= 200),
  message_id    uuid,
  message_status text check (message_status in ('queued', 'needs_approval', 'sent', 'blocked', 'failed')),
  simulated     boolean not null default true,
  cost_paise    bigint not null default 0 check (cost_paise >= 0),
  attempts      integer not null default 0 check (attempts >= 0),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  unique (task_id, contact_id),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  check ((status = 'skipped') = (skip_reason is not null) or status = 'excluded')
);
comment on table public.task_contacts is 'Job DR B1: one person of one task and what came of it. Written only by the task functions.';
comment on column public.task_contacts.captured is 'PII: what the person said in answer to the task''s questions (a price, a day, a yes). Erased with the workspace. CLEAN-EXEMPT: a validated document, never read by a model';
comment on column public.task_contacts.transcript is 'PII: the (simulated) conversation, line by line. Erased with the workspace. CLEAN-EXEMPT: read by people only, never by a model';
comment on column public.task_contacts.recording_ref is 'SAFE: a storage path made by the platform (null until telephony exists). CLEAN-EXEMPT: generated by the platform, not client-writable';
comment on column public.task_contacts.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.task_contacts.skip_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.task_contacts.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.task_contacts.category is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.task_contacts.message_status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create index task_contacts_task_idx on public.task_contacts (tenant_id, task_id, seq);
create index task_contacts_contact_idx on public.task_contacts (tenant_id, contact_id);
create index task_contacts_lead_idx on public.task_contacts (tenant_id, lead_id);

do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'task_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales', 'viewer']::public.app_role[])))::uuid[]))$p$, t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function app.audit_row_change('task', 'instruction,question,answer,plan');
create trigger audit_task_contacts after insert or update or delete on public.task_contacts for each row execute function app.audit_row_change('task_contact', 'captured,transcript');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('tasks',         'instruction', 'tenant', 'tombstone', 'erased:1'),
  ('tasks',         'question',    'tenant', 'tombstone', 'erased:1'),
  ('tasks',         'answer',      'tenant', 'tombstone', 'erased:1'),
  ('tasks',         'instruction', 'sweep',  'substring', 'erased:1'),
  ('tasks',         'question',    'sweep',  'substring', 'erased:1'),
  ('tasks',         'answer',      'sweep',  'substring', 'erased:1'),
  ('tasks',         'plan',        'tenant', 'null',      'erased:1'),
  ('task_contacts', 'captured',    'tenant', 'null',      'erased:1'),
  ('task_contacts', 'transcript',  'tenant', 'null',      'erased:1');

-- a finished or cancelled task never moves again, a task is never deleted
create function app.tasks_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'tasks are never deleted' using errcode = '42501';
  end if;
  if old.status in ('done', 'cancelled') and (new.status is distinct from old.status or new.plan_sha256 is distinct from old.plan_sha256) and not app.erasure_running(old.tenant_id) then
    raise exception 'a finished task does not change' using errcode = 'SM953';
  end if;
  new.updated_at := app.outbox_now();
  return new;
end;
$$;
create trigger tasks_guard before update or delete on public.tasks for each row execute function app.tasks_guard();
create trigger tasks_no_truncate before truncate on public.tasks for each statement execute function app.tasks_guard();
create function app.task_contacts_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'task rows are never deleted' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger task_contacts_guard before delete on public.task_contacts for each row execute function app.task_contacts_guard();
create trigger task_contacts_no_truncate before truncate on public.task_contacts for each statement execute function app.task_contacts_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the workspace is a school (its pack is education): no fees, marks or dues, no payment reminder
create function app.task_is_school(p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$ select exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant and w.pack_code = 'education') $$;
revoke all on function app.task_is_school(uuid) from public;

-- the API asks once whether the workspace is a school (it picks the templates and tells the assistant); the answer is one yes or no, for any member
create function public.task_context(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  return jsonb_build_object('school', app.task_is_school(p_tenant_id));
end;
$$;
revoke all on function public.task_context(uuid) from public, anon;
grant execute on function public.task_context(uuid) to authenticated;

-- what the owner is asked to approve: the template, the plan, the estimate and exactly which people are in (a person excluded or added changes it)
create function app.task_sha(p_task uuid) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|', t.template, coalesce(t.plan::text, ''), t.estimated_paise::text,
           coalesce((select string_agg(c.contact_id::text, ',' order by c.contact_id) from public.task_contacts c where c.task_id = t.id and c.status = 'waiting'), '')), 'UTF8')), 'hex')
    from public.tasks t where t.id = p_task
$$;
revoke all on function app.task_sha(uuid) from public;

create function app.task_counts(p_task uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*), 'excluded', count(*) filter (where status = 'excluded'), 'waiting', count(*) filter (where status = 'waiting'),
    'in_progress', count(*) filter (where status = 'in_progress'), 'done', count(*) filter (where status = 'done'), 'failed', count(*) filter (where status = 'failed'),
    'skipped', count(*) filter (where status = 'skipped'),
    'reached', count(*) filter (where status = 'done' and outcome in ('positive', 'negative', 'unclear')),
    'positive', count(*) filter (where status = 'done' and outcome = 'positive'))
    from public.task_contacts where task_id = p_task
$$;
revoke all on function app.task_counts(uuid) from public;

create function app.task_json(t public.tasks) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'status', t.status, 'instruction', t.instruction, 'language', t.language, 'template', t.template, 'question', t.question,
           'plan', t.plan, 'estimate', t.estimate, 'estimated_paise', t.estimated_paise, 'cap_paise', t.cap_paise, 'spent_paise', t.spent_paise, 'pause_reason', t.pause_reason,
           'plan_sha256', t.plan_sha256, 'progress', app.task_counts(t.id), 'approved_at', t.approved_at, 'finished_at', t.finished_at, 'created_at', t.created_at, 'updated_at', t.updated_at)
$$;
revoke all on function app.task_json(public.tasks) from public;

-- the text of a plan that a school must not have money in
create function app.task_plan_text(p_instruction text, p_plan jsonb) returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' ', p_instruction, p_plan ->> 'goal', p_plan ->> 'script_notes', p_plan ->> 'message_text',
                   (select string_agg(q ->> 'text', ' ') from jsonb_array_elements(coalesce(p_plan -> 'questions', '[]'::jsonb)) q))
$$;
revoke all on function app.task_plan_text(text, jsonb) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. save a draft (the API's plan): create it, or replace a draft that is still waiting for an answer or an approval
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.task_save(
  p_tenant_id uuid, p_task_id uuid, p_instruction text, p_language text, p_status text, p_template text, p_question text, p_answer text,
  p_plan jsonb, p_estimate jsonb, p_estimated_paise bigint, p_contacts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  t     public.tasks;
  r     jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_task_id is null or p_instruction is null or btrim(p_instruction) = '' or p_status is null or p_status not in ('needs_answer', 'planned')
     or p_template is null or p_estimated_paise is null or p_estimated_paise < 0
     or (p_status = 'needs_answer' and (p_question is null or btrim(p_question) = ''))
     or (p_status = 'planned' and (p_plan is null or jsonb_typeof(p_plan) <> 'object'))
     or (p_contacts is not null and jsonb_typeof(p_contacts) <> 'array') then
    perform app.task_error('invalid');
  end if;
  if p_plan is not null and jsonb_typeof(p_plan) = 'null' then
    p_plan := null;
  end if;
  if coalesce(jsonb_array_length(p_contacts), 0) > 500 then
    perform app.task_error('invalid');
  end if;
  if app.task_is_school(p_tenant_id) and (p_template = 'payment_reminder' or 'money' = any (app.outbox_content_flags(app.task_plan_text(p_instruction, p_plan)))) then
    perform app.task_error('schools');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task:' || p_task_id::text, 0));
  select * into t from public.tasks x where x.id = p_task_id;
  if found then
    if t.tenant_id <> p_tenant_id then
      perform app.task_error('reference');
    end if;
    if t.status not in ('needs_answer', 'planned') then
      perform app.task_error('state');
    end if;
    update public.tasks set instruction = btrim(p_instruction), language = p_language, status = p_status, template = p_template, question = nullif(btrim(coalesce(p_question, '')), ''),
           answer = coalesce(nullif(btrim(coalesce(p_answer, '')), ''), answer), plan = p_plan, estimate = coalesce(p_estimate, '{}'::jsonb), estimated_paise = p_estimated_paise
     where id = p_task_id;
  else
    insert into public.tasks (id, tenant_id, instruction, language, status, template, question, answer, plan, estimate, estimated_paise, created_by)
    values (p_task_id, p_tenant_id, btrim(p_instruction), p_language, p_status, p_template, nullif(btrim(coalesce(p_question, '')), ''), nullif(btrim(coalesce(p_answer, '')), ''),
            p_plan, coalesce(p_estimate, '{}'::jsonb), p_estimated_paise, v_uid);
  end if;
  if p_contacts is not null then
    -- a draft's people are replaced as a whole: the new ones are added, an earlier one the plan no longer names is skipped (a row is never deleted; a draft's rows carry no result yet)
    for r in select * from jsonb_array_elements(p_contacts) loop
      if (r ->> 'contact_id') is null or (r ->> 'lead_id') is null then
        perform app.task_error('invalid');
      end if;
      insert into public.task_contacts (tenant_id, task_id, contact_id, lead_id, status, skip_reason)
      values (p_tenant_id, p_task_id, (r ->> 'contact_id')::uuid, (r ->> 'lead_id')::uuid,
              (case when nullif(r ->> 'skip_reason', '') is null then 'waiting' else 'skipped' end), nullif(r ->> 'skip_reason', ''))
      on conflict (task_id, contact_id) do update set status = excluded.status, skip_reason = excluded.skip_reason, lead_id = excluded.lead_id;
    end loop;
    update public.task_contacts c set status = 'skipped', skip_reason = 'not_in_plan'
     where c.task_id = p_task_id and c.status in ('waiting', 'excluded') and not exists (select 1 from jsonb_array_elements(p_contacts) x where (x ->> 'contact_id')::uuid = c.contact_id);
  end if;
  update public.tasks set plan_sha256 = app.task_sha(p_task_id) where id = p_task_id returning * into t;
  return app.task_json(t);
end;
$$;
revoke all on function public.task_save(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.task_save(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. read
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.task_get(p_tenant_id uuid, p_task_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.task_error('reference');
  end if;
  return app.task_json(t) || jsonb_build_object('contacts_sample', coalesce((
    select jsonb_agg(jsonb_build_object('contact_id', c.contact_id, 'name', case when k.erased_at is not null then 'erased' else k.full_name end) order by c.seq)
      from (select * from public.task_contacts x where x.task_id = t.id and x.status <> 'excluded' order by x.seq limit 5) c join public.contacts k on k.id = c.contact_id), '[]'::jsonb));
end;
$$;
revoke all on function public.task_get(uuid, uuid) from public, anon;
grant execute on function public.task_get(uuid, uuid) to authenticated;

create function public.tasks_list(p_tenant_id uuid, p_status text default null, p_limit integer default 30, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_status is not null and p_status not in ('needs_answer', 'planned', 'approved', 'running', 'paused', 'done', 'cancelled')) then
    perform app.task_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.task_json(x) order by x.created_at desc, x.id)
                     from (select * from public.tasks t where t.tenant_id = p_tenant_id and (p_status is null or t.status = p_status) and (p_before is null or t.created_at < p_before)
                            order by t.created_at desc, t.id limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.tasks_list(uuid, text, integer, timestamptz) from public, anon;
grant execute on function public.tasks_list(uuid, text, integer, timestamptz) to authenticated;

create function app.task_contact_json(c public.task_contacts, k public.contacts) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'contact_id', c.contact_id, 'name', case when k.erased_at is not null then 'erased' else k.full_name end,
           'phone_last4', case when k.erased_at is not null or k.phone is null then null else right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 4) end,
           'status', case when c.status = 'waiting' then 'waiting' else c.status end, 'skip_reason', c.skip_reason, 'outcome', c.outcome, 'outcome_category', c.category,
           'captured', c.captured, 'message_status', c.message_status, 'simulated', c.simulated)
$$;
revoke all on function app.task_contact_json(public.task_contacts, public.contacts) from public;

create function public.task_contacts_list(p_tenant_id uuid, p_task_id uuid, p_status text default null, p_limit integer default 50, p_after_seq bigint default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 or (p_status is not null and p_status not in ('waiting', 'excluded', 'in_progress', 'done', 'failed', 'skipped'))
     or not exists (select 1 from public.tasks t where t.id = p_task_id and t.tenant_id = p_tenant_id) then
    perform app.task_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.task_contact_json(c, k) || jsonb_build_object('seq', c.seq) order by c.seq)
                     from (select * from public.task_contacts x where x.task_id = p_task_id and (p_status is null or x.status = p_status) and (p_after_seq is null or x.seq > p_after_seq)
                            order by x.seq limit p_limit) c join public.contacts k on k.id = c.contact_id), '[]'::jsonb);
end;
$$;
revoke all on function public.task_contacts_list(uuid, uuid, text, integer, bigint) from public, anon;
grant execute on function public.task_contacts_list(uuid, uuid, text, integer, bigint) to authenticated;

-- everything the report needs, in one call (at most 500 people): the rows with their transcripts
create function public.task_report(p_tenant_id uuid, p_task_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.task_error('reference');
  end if;
  return app.task_json(t) || jsonb_build_object('rows', coalesce((
    select jsonb_agg(app.task_contact_json(c, k) || jsonb_build_object('transcript', c.transcript, 'recording_ref', c.recording_ref, 'cost_paise', c.cost_paise) order by c.seq)
      from public.task_contacts c join public.contacts k on k.id = c.contact_id where c.task_id = t.id and c.status <> 'excluded'), '[]'::jsonb));
end;
$$;
revoke all on function public.task_report(uuid, uuid) from public, anon;
grant execute on function public.task_report(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. exclude, approve, cap, state
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.task_exclude(p_tenant_id uuid, p_task_id uuid, p_contact_ids uuid[], p_excluded boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_contact_ids is null or cardinality(p_contact_ids) not between 1 and 500 or p_excluded is null then
    perform app.task_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task:' || p_task_id::text, 0));
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.task_error('reference');
  end if;
  if t.status <> 'planned' then
    perform app.task_error('state');
  end if;
  if p_excluded then
    update public.task_contacts set status = 'excluded' where task_id = p_task_id and contact_id = any (p_contact_ids) and status = 'waiting';
  else
    update public.task_contacts set status = 'waiting' where task_id = p_task_id and contact_id = any (p_contact_ids) and status = 'excluded';
  end if;
  update public.tasks set plan_sha256 = app.task_sha(p_task_id) where id = p_task_id returning * into t;
  return app.task_json(t);
end;
$$;
revoke all on function public.task_exclude(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.task_exclude(uuid, uuid, uuid[], boolean) to authenticated;

-- ONE approval for everyone who is not excluded: the Owner, with a second factor, having seen this exact plan (its hash)
create function public.task_approve(p_tenant_id uuid, p_task_id uuid, p_plan_sha256 text, p_cap_paise bigint default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  v_waiting integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  perform app.require_aal2();
  if p_plan_sha256 is null or (p_cap_paise is not null and p_cap_paise < 0) then
    perform app.task_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task:' || p_task_id::text, 0));
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.task_error('reference');
  end if;
  if t.status <> 'planned' then
    perform app.task_error('state');
  end if;
  if t.plan_sha256 is distinct from app.task_sha(t.id) or p_plan_sha256 <> t.plan_sha256 then
    perform app.task_error('changed');
  end if;
  if app.task_is_school(p_tenant_id) and (t.template = 'payment_reminder' or 'money' = any (app.outbox_content_flags(app.task_plan_text(t.instruction, t.plan)))) then
    perform app.task_error('schools');
  end if;
  -- a promotional task goes only to people who agreed to hear from the business
  if t.template = 'offer_invite' then
    update public.task_contacts c set status = 'skipped', skip_reason = 'no_consent'
      from public.contacts k where c.task_id = t.id and c.status = 'waiting' and k.id = c.contact_id and k.whatsapp_consent <> 'granted';
  end if;
  select count(*) into v_waiting from public.task_contacts c where c.task_id = t.id and c.status = 'waiting';
  if v_waiting = 0 then
    perform app.task_error('invalid');
  end if;
  update public.tasks set status = 'approved', approved_by = auth.uid(), approved_at = app.outbox_now(), cap_paise = coalesce(p_cap_paise, (t.estimated_paise * 12 + 9) / 10)
   where id = t.id returning * into t;
  perform app.write_audit_event(p_tenant_id, 'task.approved', 'task', t.id, null, jsonb_build_object('contacts', v_waiting, 'cap_paise', t.cap_paise, 'template', t.template));
  return app.task_json(t);
end;
$$;
revoke all on function public.task_approve(uuid, uuid, text, bigint) from public, anon;
grant execute on function public.task_approve(uuid, uuid, text, bigint) to authenticated;

create function public.task_set_cap(p_tenant_id uuid, p_task_id uuid, p_cap_paise bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  perform app.require_aal2();
  if p_cap_paise is null or p_cap_paise < 0 then
    perform app.task_error('invalid');
  end if;
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.task_error('reference');
  end if;
  if t.status not in ('approved', 'running', 'paused') then
    perform app.task_error('state');
  end if;
  update public.tasks set cap_paise = p_cap_paise where id = t.id returning * into t;
  return app.task_json(t);
end;
$$;
revoke all on function public.task_set_cap(uuid, uuid, bigint) from public, anon;
grant execute on function public.task_set_cap(uuid, uuid, bigint) to authenticated;

create function public.task_set_state(p_tenant_id uuid, p_task_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_action is null or p_action not in ('pause', 'resume', 'cancel') then
    perform app.task_error('invalid');
  end if;
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.task_error('reference');
  end if;
  if p_action = 'pause' then
    if t.status not in ('approved', 'running') then
      perform app.task_error('state');
    end if;
    update public.tasks set status = 'paused', pause_reason = 'owner' where id = t.id returning * into t;
  elsif p_action = 'resume' then
    if t.status <> 'paused' or (t.pause_reason = 'cap' and t.cap_paise is not null and t.spent_paise >= t.cap_paise) then
      perform app.task_error('state');
    end if;
    update public.tasks set status = 'running', pause_reason = null where id = t.id returning * into t;
  else
    if t.status in ('done', 'cancelled') then
      perform app.task_error('state');
    end if;
    update public.tasks set status = 'cancelled', pause_reason = null, finished_at = app.outbox_now() where id = t.id returning * into t;
    update public.task_contacts set status = 'skipped', skip_reason = 'cancelled', finished_at = app.outbox_now() where task_id = t.id and status = 'waiting';
  end if;
  perform app.write_audit_event(p_tenant_id, 'task.' || p_action, 'task', t.id, null, '{}'::jsonb);
  return app.task_json(t);
end;
$$;
revoke all on function public.task_set_state(uuid, uuid, text) from public, anon;
grant execute on function public.task_set_state(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. the runner's two calls (the approver's own token: the Owner or an Admin)
-- ---------------------------------------------------------------------------------------------------------------------------------
-- hands out up to p_limit waiting people (and takes back the ones whose run stopped midway more than five minutes ago); moves the task to running; pauses it when the cap is reached
create function public.task_claim(p_tenant_id uuid, p_task_id uuid, p_limit integer default 10) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t     public.tasks;
  v_now timestamptz := app.outbox_now();
  v_ids uuid[];
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.task_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task:' || p_task_id::text, 0));
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id;
  if not found then
    perform app.task_error('reference');
  end if;
  if t.status not in ('approved', 'running') then
    return jsonb_build_object('task', app.task_json(t), 'claimed', '[]'::jsonb);
  end if;
  if t.cap_paise is not null and t.spent_paise >= t.cap_paise then
    update public.tasks set status = 'paused', pause_reason = 'cap' where id = t.id returning * into t;
    return jsonb_build_object('task', app.task_json(t), 'claimed', '[]'::jsonb);
  end if;
  update public.task_contacts set status = 'waiting', claimed_at = null where task_id = t.id and status = 'in_progress' and claimed_at < v_now - interval '5 minutes';
  update public.tasks set status = 'running' where id = t.id and status = 'approved' returning * into t;
  if not found then
    select * into t from public.tasks x where x.id = p_task_id;
  end if;
  select array_agg(x.id) into v_ids from (
    select c.id from public.task_contacts c where c.task_id = t.id and c.status = 'waiting' order by c.seq limit p_limit for update skip locked) x;
  update public.task_contacts set status = 'in_progress', claimed_at = v_now, attempts = attempts + 1 where id = any (coalesce(v_ids, '{}'::uuid[]));
  return jsonb_build_object('task', app.task_json(t), 'claimed', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'contact_id', m.contact_id, 'lead_id', m.lead_id, 'name', case when k.erased_at is not null then null else k.full_name end,
                                         'phone', case when k.erased_at is not null then null else k.phone end, 'whatsapp_consent', k.whatsapp_consent, 'phone_consent', k.phone_consent,
                                         'suppressed', k.suppressed_at is not null, 'erased', k.erased_at is not null, 'archived', k.archived_at is not null) order by m.seq)
      from public.task_contacts m join public.contacts k on k.id = m.contact_id where m.id = any (coalesce(v_ids, '{}'::uuid[]))), '[]'::jsonb));
end;
$$;
revoke all on function public.task_claim(uuid, uuid, integer) from public, anon;
grant execute on function public.task_claim(uuid, uuid, integer) to authenticated;

-- one person's result: the outcome, what was captured, the (simulated) transcript, the message, the cost
create function public.task_contact_result(p_tenant_id uuid, p_task_id uuid, p_row_id uuid, p_result jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t      public.tasks;
  c      public.task_contacts;
  v_stat text := p_result ->> 'status';
  v_cost bigint := coalesce((p_result ->> 'cost_paise')::bigint, 0);
  v_left integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.task_error('deny');
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or v_stat is null or v_stat not in ('done', 'failed', 'skipped') or v_cost < 0 or v_cost > 100000
     or (p_result -> 'captured' is not null and jsonb_typeof(p_result -> 'captured') not in ('object', 'null'))
     or (p_result -> 'transcript' is not null and jsonb_typeof(p_result -> 'transcript') not in ('array', 'null'))
     or (v_stat = 'skipped' and nullif(p_result ->> 'skip_reason', '') is null)
     or octet_length(p_result::text) > 20000 then
    perform app.task_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('task:' || p_task_id::text, 0));
  select * into t from public.tasks x where x.id = p_task_id and x.tenant_id = p_tenant_id;
  select * into c from public.task_contacts x where x.id = p_row_id and x.task_id = p_task_id and x.tenant_id = p_tenant_id;
  if t.id is null or c.id is null then
    perform app.task_error('reference');
  end if;
  if c.status <> 'in_progress' or t.status not in ('running', 'paused', 'cancelled') then
    perform app.task_error('state');
  end if;
  update public.task_contacts set
    status = v_stat, skip_reason = case when v_stat = 'skipped' then p_result ->> 'skip_reason' end,
    outcome = nullif(p_result ->> 'outcome', ''), category = nullif(p_result ->> 'category', ''),
    captured = case when jsonb_typeof(p_result -> 'captured') = 'object' then p_result -> 'captured' end,
    transcript = case when jsonb_typeof(p_result -> 'transcript') = 'array' then p_result -> 'transcript' end,
    recording_ref = nullif(p_result ->> 'recording_ref', ''), message_id = nullif(p_result ->> 'message_id', '')::uuid, message_status = nullif(p_result ->> 'message_status', ''),
    simulated = coalesce((p_result ->> 'simulated')::boolean, true), cost_paise = v_cost, finished_at = app.outbox_now()
   where id = c.id;
  update public.tasks set spent_paise = spent_paise + v_cost where id = t.id returning * into t;
  select count(*) into v_left from public.task_contacts x where x.task_id = t.id and x.status in ('waiting', 'in_progress');
  if v_left = 0 and t.status in ('running', 'paused') then
    update public.tasks set status = 'done', pause_reason = null, finished_at = app.outbox_now() where id = t.id returning * into t;
    perform app.write_audit_event(p_tenant_id, 'task.done', 'task', t.id, null, app.task_counts(t.id));
  elsif t.status = 'running' and t.cap_paise is not null and t.spent_paise >= t.cap_paise then
    update public.tasks set status = 'paused', pause_reason = 'cap' where id = t.id returning * into t;
  end if;
  return app.task_json(t);
end;
$$;
revoke all on function public.task_contact_result(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.task_contact_result(uuid, uuid, uuid, jsonb) to authenticated;
