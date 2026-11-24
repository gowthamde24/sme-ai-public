-- One lead address per job, and what arrived at it (28 Nov 2026; plan: reports/connectors-and-api-plan.md, C1 item 1). The address itself is a lead source of kind webhook, as before (same secret address, same intake, same consent and Do-Not-Call rules);
-- this adds (1) which JOB a source belongs to (`job_id`, one webhook source per job), and (2) the ACTIVITY of a source: one row per post that arrived, with a closed outcome and reason and no personal data, kept 30 days and at most 200 per source.
-- Rollback = drop public.lead_source_activity and the four functions, and drop the column job_id.

alter table public.lead_sources add column job_id text check (job_id is null or job_id ~ '^[a-z][a-z0-9_]{1,60}$');
comment on column public.lead_sources.job_id is 'SAFE: the id of the job this address belongs to (a catalogue word). CLEAN-EXEMPT: pattern CHECK';
create unique index lead_sources_one_per_job on public.lead_sources (tenant_id, job_id) where job_id is not null and kind = 'webhook';

create table public.lead_source_activity (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  source_id uuid not null,
  at        timestamptz not null default now(),
  outcome   text not null check (outcome in ('accepted', 'duplicate', 'refused')),
  reason    text not null check (reason ~ '^[a-z][a-z_]{1,30}$'),
  test      boolean not null default false,
  foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id) on delete restrict
);
create index lead_source_activity_source_idx on public.lead_source_activity (tenant_id, source_id, at desc, id);
comment on table public.lead_source_activity is 'What arrived at a lead source: one row per post with a closed outcome and reason (never a name, number or any field of the post). Written only by SECURITY DEFINER functions; kept 30 days, at most 200 a source.';
comment on column public.lead_source_activity.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_source_activity.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed pattern';
create trigger lead_source_activity_forbid_tenant_id_change before update on public.lead_source_activity for each row execute function app.forbid_tenant_id_change();
create trigger audit_lead_source_activity after insert or update or delete on public.lead_source_activity for each row execute function app.audit_row_change('lead_source_activity');
alter table public.lead_source_activity enable row level security;
alter table public.lead_source_activity force row level security;
revoke all on public.lead_source_activity from public, anon, authenticated;
grant select on public.lead_source_activity to authenticated;
create policy lead_source_activity_select on public.lead_source_activity for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));

-- the worker account (the public intake runs as it) records what happened to a post; a source it does not know is ignored
create function public.scheduler_lead_activity(p_token_hash text, p_outcome text, p_reason text, p_test boolean default false) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_outcome not in ('accepted', 'duplicate', 'refused') or p_reason is null or p_reason !~ '^[a-z][a-z_]{1,30}$' then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.token_hash = p_token_hash;
  if not found then
    return;
  end if;
  insert into public.lead_source_activity (tenant_id, source_id, outcome, reason, test) values (s.tenant_id, s.id, p_outcome, p_reason, coalesce(p_test, false));
  delete from public.lead_source_activity a where a.tenant_id = s.tenant_id and a.source_id = s.id
     and (a.at < now() - interval '30 days' or a.id not in (select b.id from public.lead_source_activity b where b.tenant_id = s.tenant_id and b.source_id = s.id order by b.at desc, b.id desc limit 200));
end;
$$;
revoke all on function public.scheduler_lead_activity(text, text, text, boolean) from public, anon;
grant execute on function public.scheduler_lead_activity(text, text, text, boolean) to authenticated;

create function public.lead_source_activity_list(p_tenant_id uuid, p_source_id uuid, p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if not exists (select 1 from public.lead_sources s where s.tenant_id = p_tenant_id and s.id = p_source_id) then
    perform app.lead_error('reference');
  end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'outcome', x.outcome, 'reason', x.reason, 'test', x.test) order by x.at desc, x.id desc)
                                                 from (select a.* from public.lead_source_activity a where a.tenant_id = p_tenant_id and a.source_id = p_source_id order by a.at desc, a.id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x), '[]'::jsonb));
end;
$$;
revoke all on function public.lead_source_activity_list(uuid, uuid, integer) from public, anon;
grant execute on function public.lead_source_activity_list(uuid, uuid, integer) to authenticated;

-- ties a webhook source of this workspace to a job (one per job); the same source again is a retry
create function public.job_lead_address_link(p_tenant_id uuid, p_job_id text, p_source_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_job_id is null or p_job_id !~ '^[a-z][a-z0-9_]{1,60}$' then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.tenant_id = p_tenant_id and x.id = p_source_id for update;
  if not found or s.kind <> 'webhook' then
    perform app.lead_error('reference');
  end if;
  if s.job_id is not null and s.job_id <> p_job_id then
    perform app.lead_error('invalid');
  end if;
  update public.lead_sources x set job_id = p_job_id, updated_at = app.outbox_now() where x.tenant_id = p_tenant_id and x.id = p_source_id;
  return jsonb_build_object('source_id', p_source_id, 'job_id', p_job_id);
end;
$$;
revoke all on function public.job_lead_address_link(uuid, text, uuid) from public, anon;
grant execute on function public.job_lead_address_link(uuid, text, uuid) to authenticated;

-- the source of a job (null when none): the id, its state and how much has arrived; never the secret (only its last four characters)
create function public.job_lead_address_get(p_tenant_id uuid, p_job_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  select * into s from public.lead_sources x where x.tenant_id = p_tenant_id and x.job_id = p_job_id and x.kind = 'webhook';
  if not found then
    return null;
  end if;
  return jsonb_build_object('source_id', s.id, 'job_id', s.job_id, 'status', s.status, 'token_hint', s.token_hint, 'last_received_at', s.last_received_at, 'received_count', s.received_count, 'label', s.label);
end;
$$;
revoke all on function public.job_lead_address_get(uuid, text) from public, anon;
grant execute on function public.job_lead_address_get(uuid, text) to authenticated;

-- "Send a test lead" is a dry run (nothing is stored as a lead); the Owner or Admin records that they tried it, with what would have happened
create function public.lead_source_test_logged(p_tenant_id uuid, p_source_id uuid, p_outcome text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_outcome not in ('accepted', 'duplicate', 'refused') or p_reason is null or p_reason !~ '^[a-z][a-z_]{1,30}$' then
    perform app.lead_error('invalid');
  end if;
  if not exists (select 1 from public.lead_sources s where s.tenant_id = p_tenant_id and s.id = p_source_id) then
    perform app.lead_error('reference');
  end if;
  insert into public.lead_source_activity (tenant_id, source_id, outcome, reason, test) values (p_tenant_id, p_source_id, p_outcome, p_reason, true);
  delete from public.lead_source_activity a where a.tenant_id = p_tenant_id and a.source_id = p_source_id
     and (a.at < now() - interval '30 days' or a.id not in (select b.id from public.lead_source_activity b where b.tenant_id = p_tenant_id and b.source_id = p_source_id order by b.at desc, b.id desc limit 200));
end;
$$;
revoke all on function public.lead_source_test_logged(uuid, uuid, text, text) from public, anon;
grant execute on function public.lead_source_test_logged(uuid, uuid, text, text) to authenticated;
