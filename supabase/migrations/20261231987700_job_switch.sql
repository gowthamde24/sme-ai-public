-- A real on/off switch for the three jobs that have none of their own (jobs contract 1.0 section 2; JOBS S3a): follow-ups, store visits and the researcher. `jobs_meta.enabled` (default true: nothing changes for anyone who
-- never touches it) is written ONLY by public.job_meta_set_enabled (Owner or Admin, like the helper's name; audited by the table's audit trigger) and is READ where the work is done, so a paused job really stops:
--   followups     no new due list and no new draft (the policy is "not in force for work"); a draft that already waits can still be approved or discarded by a person
--   store_visits  no reminder is due, the assistant offers no slots and books no choice (a visit already booked stays booked)
--   researcher    no search can be planned or approved (what was found stays)
-- app.job_enabled is the one reader: no row, or a row with enabled = true, is on.

alter table public.jobs_meta add column enabled boolean not null default true;
comment on column public.jobs_meta.enabled is 'SAFE: whether the owner has the job switched on (follow-ups, store visits, researcher: the jobs with no switch of their own). CLEAN-EXEMPT: a boolean, written only by job_meta_set_enabled';

create or replace function app.job_meta_json(m public.jobs_meta) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'kind', m.kind, 'custom_name', m.custom_name, 'finds_out', m.finds_out, 'enabled', m.enabled, 'created_at', m.created_at)
$$;

create function app.job_enabled(p_tenant uuid, p_kind text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.enabled from public.jobs_meta m where m.tenant_id = p_tenant and m.kind = p_kind), true)
$$;
revoke all on function app.job_enabled(uuid, text) from public, anon, authenticated, service_role;

-- the follow-up policy "in force for work": the active version while the job is on, none while it is paused
create function app.followup_policy_for_work(p_tenant uuid, p_on date) returns uuid
language sql
stable
set search_path = ''
as $$
  select case when app.job_enabled(p_tenant, 'followups') then app.followup_active_policy_version(p_tenant, p_on) end
$$;
revoke all on function app.followup_policy_for_work(uuid, date) from public, anon, authenticated, service_role;

create function public.job_meta_set_enabled(p_tenant_id uuid, p_id uuid, p_enabled boolean) returns jsonb
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
  if p_enabled is null then
    perform app.jobs_error('invalid');
  end if;
  -- only the kinds that have no switch of their own: speed to lead, answering calls and offers are switched where their work is (rules, the assistant, the campaigns)
  update public.jobs_meta set enabled = p_enabled, updated_at = app.outbox_now()
   where tenant_id = p_tenant_id and id = p_id and kind in ('followups', 'store_visits', 'researcher') returning * into m;
  if not found then
    perform app.jobs_error('reference');
  end if;
  return app.job_meta_json(m);
end;
$$;
revoke all on function public.job_meta_set_enabled(uuid, uuid, boolean) from public, anon;
grant execute on function public.job_meta_set_enabled(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the work reads the switch. Each patch refuses to run when the text it expects is not there (the migration stops, nothing is half done).
-- ---------------------------------------------------------------------------------------------------------------------------------
do $patch$
declare
  v_def text;
  v_new text;
begin
  -- follow-ups: the due list and a new draft
  v_def := pg_get_functiondef('public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)'::regprocedure);
  v_new := replace(v_def, 'app.followup_active_policy_version(p_tenant_id, app.quote_today())', 'app.followup_policy_for_work(p_tenant_id, app.quote_today())');
  if v_new = v_def then raise exception 'followup_due_candidates has changed: the policy lookup was not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.create_followup_draft(uuid, uuid, text, text, text, text)'::regprocedure);
  v_new := replace(v_def, 'app.followup_active_policy_version(l.tenant_id, app.quote_today())', 'app.followup_policy_for_work(l.tenant_id, app.quote_today())');
  if v_new = v_def then raise exception 'create_followup_draft has changed: the policy lookup was not found'; end if;
  execute v_new;

  -- store visits: the assistant offers and books only while the job is on; no reminder is due while it is off
  v_def := pg_get_functiondef('app.appointment_assistant_may(uuid)'::regprocedure);
  v_new := replace(v_def, 'select app.module_enabled(p_tenant, ''visits'') and', 'select app.module_enabled(p_tenant, ''visits'') and app.job_enabled(p_tenant, ''store_visits'') and');
  if v_new = v_def then raise exception 'appointment_assistant_may has changed: the module check was not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.visit_slots_for_call(uuid, integer, integer)'::regprocedure);
  v_new := replace(v_def, 'if not app.module_enabled(p_tenant_id, ''visits'') then', 'if not app.module_enabled(p_tenant_id, ''visits'') or not app.job_enabled(p_tenant_id, ''store_visits'') then');
  if v_new = v_def then raise exception 'visit_slots_for_call has changed: the module check was not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('app.scheduler_reminder_due(public.store_visits, text, timestamptz, jsonb)'::regprocedure);
  v_new := replace(v_def, 'select m.status = ''confirmed'' and m.starts_at > p_now', 'select app.job_enabled(m.tenant_id, ''store_visits'') and m.status = ''confirmed'' and m.starts_at > p_now');
  if v_new = v_def then raise exception 'scheduler_reminder_due has changed: the status check was not found'; end if;
  execute v_new;

  -- the researcher: no search is planned or approved while it is paused (SM973, "not possible in the state it is in now")
  v_def := pg_get_functiondef('public.prospect_search_plan(uuid, uuid, text, text, text, integer, text, text, bigint, text)'::regprocedure);
  v_new := replace(v_def, E'  perform app.lf_gate(p_tenant_id, array[''owner'', ''admin'', ''sales'']::public.app_role[]);\n',
                   E'  perform app.lf_gate(p_tenant_id, array[''owner'', ''admin'', ''sales'']::public.app_role[]);\n  if not app.job_enabled(p_tenant_id, ''researcher'') then\n    perform app.lf_error(''state'');   -- the researcher is paused\n  end if;\n');
  if v_new = v_def then raise exception 'prospect_search_plan has changed: the gate was not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.prospect_search_approve(uuid, uuid)'::regprocedure);
  v_new := replace(v_def, E'  perform app.lf_gate(p_tenant_id, array[''owner'', ''admin'']::public.app_role[]);\n',
                   E'  perform app.lf_gate(p_tenant_id, array[''owner'', ''admin'']::public.app_role[]);\n  if not app.job_enabled(p_tenant_id, ''researcher'') then\n    perform app.lf_error(''state'');   -- the researcher is paused\n  end if;\n');
  if v_new = v_def then raise exception 'prospect_search_approve has changed: the gate was not found'; end if;
  execute v_new;
end
$patch$;
