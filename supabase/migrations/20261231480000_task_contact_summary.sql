-- Write structured call answers back (owner GO 11 Nov 2026; plan ~/Desktop/stack19-jobs/drafts/call-answers-plan.md).
-- A Lead Desk task call that was answered now stores, on the person's row, a one-line English summary beside the checked answers (task_contacts.captured, keyed by the plan's question keys; the keys
-- that start with "_" are not answers: "_how" says, per answer, whether the person SAID it or it was IMPLIED and which transcript line it came from).
--   * task_contacts.summary: new column, at most 600 characters, PII, erased with the workspace.
--   * app.task_contact_json gives it to every reader (the contacts list, the sample on the task, the report rows).
--   * public.task_contact_result takes it (the runner's door; the same checks as before, plus the summary: a string of at most 600 characters).
-- Append-only: this replaces the two functions of 20261207090000 by CREATE OR REPLACE with the same signatures and grants.

alter table public.task_contacts add column summary text check (summary is null or char_length(summary) <= 600);
comment on column public.task_contacts.summary is 'PII: one short English line about what the person said on the call (what they wanted, what happens next), written by the end-of-call record from the transcript. Erased with the workspace. CLEAN-EXEMPT: read by people only, never by a model';

-- a PII column is registered for erasure (the workspace's erasure wipes it; a person's erasure sweeps their identifiers out of it) and is on the audit trigger's PII list (never audited by value)
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('task_contacts', 'summary', 'tenant', 'null',      'erased:1'),
  ('task_contacts', 'summary', 'sweep',  'substring', 'erased:1');
drop trigger audit_task_contacts on public.task_contacts;
create trigger audit_task_contacts after insert or update or delete on public.task_contacts for each row execute function app.audit_row_change('task_contact', 'captured,transcript,summary');

create or replace function app.task_contact_json(c public.task_contacts, k public.contacts) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'contact_id', c.contact_id, 'name', case when k.erased_at is not null then 'erased' else k.full_name end,
           'phone_last4', case when k.erased_at is not null or k.phone is null then null else right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 4) end,
           'status', case when c.status = 'waiting' then 'waiting' else c.status end, 'skip_reason', c.skip_reason, 'outcome', c.outcome, 'outcome_category', c.category,
           'captured', c.captured, 'summary', c.summary, 'message_status', c.message_status, 'simulated', c.simulated)
$$;
revoke all on function app.task_contact_json(public.task_contacts, public.contacts) from public;

create or replace function public.task_contact_result(p_tenant_id uuid, p_task_id uuid, p_row_id uuid, p_result jsonb) returns jsonb
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
     or (p_result -> 'summary' is not null and jsonb_typeof(p_result -> 'summary') not in ('string', 'null'))
     or char_length(coalesce(p_result ->> 'summary', '')) > 600
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
    summary = nullif(btrim(coalesce(p_result ->> 'summary', '')), ''),
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
