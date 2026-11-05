-- The assistant does the work, part A2 (owner, 4 Nov 2026: "build the file path end to end FIRST"): a file dropped in the chat, the plan card the assistant proposes for it, the action log of what
-- it did, and the undo of a lead import. docs/contracts/assistant-tools.md sections 1 to 3.
--
--   public.assistant_files          a file dropped in the chat. Kept ONLY until the import needs it: at most 24 hours, deleted after the plan ran or was cancelled (DPDP). Only the person who dropped it
--                                   reads it back. The bytes never reach a model: the lead import reads the grid with code, and the AI column matcher sees the headers and a few samples, as on the screen.
--   public.assistant_work_plans     one plan card: 1 to 20 steps, each a tool (a route of this API) with its arguments, its status and the closed error word. NO file bytes (the step names the file).
--                                   Proposed -> running -> done | partly_done | failed; proposed -> cancelled | expired (30 minutes); done | partly_done -> undone. A compare-and-set on the status: a
--                                   double tap of "Do it" runs the plan once.
--   public.assistant_work_actions   the action log (Settings -> Activity): one row per step that ran, by the assistant on <requested_by>'s request, with how to undo it (7 days). Owner and Admin read it.
--   public.lead_intake_created      which contacts and leads an import CREATED (not the ones it merged into), so the import can be undone. Ids only.
--   public.lead_import_undo         archives what an import created and nobody has worked on since (no touch, no message, no second arrival, still "new"); the rest stays as it is and is counted.
-- Nothing here messages or calls anybody (the contract's section 4).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- errors
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.aw_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'state'     then raise exception 'not possible in the state it is in now' using errcode = 'SM981';
    when 'expired'   then raise exception 'expired' using errcode = 'SM982';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.aw_error(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.assistant_files (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  created_by   uuid not null,
  name         text not null check (char_length(name) between 1 and 200 and app.text_is_clean(name)),
  content_type text not null check (char_length(content_type) between 3 and 100 and content_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  kind         text not null check (kind in ('sheet', 'pdf', 'image', 'doc', 'contacts', 'text')),
  size_bytes   integer not null check (size_bytes between 1 and 20000000),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data         bytea check (data is null or octet_length(data) = size_bytes),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
comment on table public.assistant_files is 'Job assistant-does-the-work A2: a file dropped in the chat, kept only until its import ran (at most 24 h). Only the person who dropped it reads it back.';
comment on column public.assistant_files.name is 'PII: the file''s name as the person gave it (it may name a person). Erased with the workspace; deleted with the file.';
comment on column public.assistant_files.content_type is 'SAFE: a media type. CLEAN-EXEMPT: pattern CHECK';
comment on column public.assistant_files.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_files.sha256 is 'SAFE: the sha-256 of the bytes. CLEAN-EXEMPT: pattern CHECK';
comment on column public.assistant_files.data is 'PII: the file itself (a lead list holds names and numbers). Kept at most 24 h, deleted after its plan ran or was cancelled, never read by a model. Erased with the workspace. CLEAN-EXEMPT: bytes, never shown as text';
comment on column public.assistant_files.created_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
create index assistant_files_tenant_idx on public.assistant_files (tenant_id, created_at desc, id);
create index assistant_files_owner_idx on public.assistant_files (tenant_id, created_by);
create index assistant_files_expiry_idx on public.assistant_files (expires_at);

create table public.assistant_work_plans (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  message_id      uuid not null,          -- the assistant's reply that showed the card
  conversation_id uuid,
  requested_by    uuid not null,
  file_id         uuid,                   -- the chat file the plan reads (null once the file is deleted)
  title           text not null check (char_length(title) between 1 and 200 and app.text_is_clean(title)),
  file_name       text check (file_name is null or (char_length(file_name) between 1 and 200 and app.text_is_clean(file_name))),
  status          text not null default 'proposed' check (status in ('proposed', 'running', 'done', 'partly_done', 'failed', 'cancelled', 'undone', 'expired')),
  sensitive       text check (sensitive is null or sensitive in ('money', 'sending', 'members', 'deleting', 'billing', 'secrets')),
  owner_only      boolean not null default false,
  needs_second_factor boolean not null default false,
  card            jsonb not null default '{}'::jsonb check (jsonb_typeof(card) = 'object' and octet_length(card::text) <= 20000),
  steps           jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 20 and octet_length(steps::text) <= 60000),
  expires_at      timestamptz not null,
  decided_by      uuid,
  decided_at      timestamptz,
  finished_at     timestamptz,
  undone_by       uuid,
  undone_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes')
);
comment on table public.assistant_work_plans is 'Job assistant-does-the-work A2: a plan card the assistant proposed in the chat and its steps. No file bytes. Written only by the assistant_plan_* functions.';
comment on column public.assistant_work_plans.title is 'PII: the plan''s title, which names the file ("Add 34 leads from ''march leads.xlsx''"). Erased with the workspace. Built by code.';
comment on column public.assistant_work_plans.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_work_plans.sensitive is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_work_plans.file_name is 'PII: the name of the file the plan reads, as the person gave it. Erased with the workspace.';
comment on column public.assistant_work_plans.card is 'SAFE: what the card shows besides the plan: the destination, the counts by closed code and the file''s column headers (never a row of it, never its name: file_name). CLEAN-EXEMPT: a validated document, written by code only';
comment on column public.assistant_work_plans.steps is 'SAFE: each step''s tool name, its words, its status and closed error word, and the arguments of the route (ids, a column mapping, a source tag; never file bytes or a secret). CLEAN-EXEMPT: a validated document, written by code only';
comment on column public.assistant_work_plans.requested_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
comment on column public.assistant_work_plans.decided_by is 'SAFE: the id of the member who said "Do it" or "Cancel". CLEAN-EXEMPT: uuid';
comment on column public.assistant_work_plans.undone_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
create index assistant_work_plans_message_idx on public.assistant_work_plans (tenant_id, message_id);
create index assistant_work_plans_tenant_idx on public.assistant_work_plans (tenant_id, created_at desc, id);

create table public.assistant_work_actions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  plan_id      uuid not null,
  step_no      smallint not null check (step_no between 1 and 20),
  tool         text not null check (tool ~ '^[a-z0-9_-]+(\.[a-z0-9_]+){1,3}$' and char_length(tool) <= 120),
  summary      text not null check (char_length(summary) between 1 and 300 and app.text_is_clean(summary)),
  changed      jsonb not null default '{}'::jsonb check (jsonb_typeof(changed) = 'object' and octet_length(changed::text) <= 4000),
  requested_by uuid not null,
  decided_by   uuid not null,
  message_id   uuid not null,
  status       text not null check (status in ('done', 'failed', 'undone')),
  error        text check (error is null or error in ('forbidden', 'invalid', 'conflict', 'not_found', 'limit', 'down')),
  undo         jsonb check (undo is null or (jsonb_typeof(undo) = 'object' and octet_length(undo::text) <= 8000)),
  undo_until   timestamptz,
  undone_by    uuid,
  undone_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, plan_id, step_no),
  foreign key (tenant_id, plan_id) references public.assistant_work_plans (tenant_id, id)
);
comment on table public.assistant_work_actions is 'Job assistant-does-the-work design 6: what the assistant did, one row per step that ran, by the assistant on the requester''s request. Owner and Admin read it (Settings -> Activity).';
comment on column public.assistant_work_actions.tool is 'SAFE: the tool''s name (the route''s area and function). CLEAN-EXEMPT: pattern CHECK';
comment on column public.assistant_work_actions.summary is 'PII: the step''s words, which may name a file. Erased with the workspace. Built by code.';
comment on column public.assistant_work_actions.changed is 'SAFE: counts and ids of what changed ({"leads_added": 34}). CLEAN-EXEMPT: a validated document of numbers and ids, written by code only';
comment on column public.assistant_work_actions.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_work_actions.error is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_work_actions.undo is 'SAFE: how to undo the step: the tool and its path ids, or the settings as they were (no secret: a secret field is never a tool argument). CLEAN-EXEMPT: a validated document, written by code only';
comment on column public.assistant_work_actions.requested_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
comment on column public.assistant_work_actions.decided_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
comment on column public.assistant_work_actions.undone_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
create index assistant_work_actions_tenant_idx on public.assistant_work_actions (tenant_id, created_at desc, id);

create table public.lead_intake_created (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  import_id  uuid not null,
  contact_id uuid not null,
  lead_id    uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, import_id, contact_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
comment on table public.lead_intake_created is 'Job assistant-does-the-work A2: the contacts and leads an import CREATED (not merged into), so the import can be undone. Ids only. Written only by lead_intake_apply.';
create index lead_intake_created_contact_idx on public.lead_intake_created (tenant_id, contact_id);
create index lead_intake_created_lead_idx on public.lead_intake_created (tenant_id, lead_id);

alter table public.lead_intakes add column undone_at timestamptz, add column undone_by uuid, add column undo_counts jsonb check (undo_counts is null or (jsonb_typeof(undo_counts) = 'object' and octet_length(undo_counts::text) <= 500));
comment on column public.lead_intakes.undone_by is 'SAFE: the id of the member who undid the import. CLEAN-EXEMPT: uuid';
comment on column public.lead_intakes.undo_counts is 'SAFE: numbers only (archived, kept). CLEAN-EXEMPT: not client-writable (written only by lead_import_undo)';

do $$
declare
  t text;
begin
  foreach t in array array['assistant_files', 'assistant_work_plans', 'assistant_work_actions', 'lead_intake_created'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
-- the file's bytes are read only through assistant_file_get (the person who dropped it): the table grant leaves `data` out
grant select (id, tenant_id, created_by, name, content_type, kind, size_bytes, sha256, expires_at, created_at) on public.assistant_files to authenticated;
create policy assistant_files_select on public.assistant_files for select to authenticated
  using (created_by = (select auth.uid()) and tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
grant select on public.assistant_work_plans, public.assistant_work_actions, public.lead_intake_created to authenticated;
create policy assistant_work_plans_select on public.assistant_work_plans for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[])
         or (requested_by = (select auth.uid()) and tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[])));
create policy assistant_work_actions_select on public.assistant_work_actions for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create policy lead_intake_created_select on public.lead_intake_created for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger audit_lead_intake_created after insert or update or delete on public.lead_intake_created for each row execute function app.audit_row_change('lead_intake_created', '');
create trigger audit_assistant_files after insert or delete on public.assistant_files for each row execute function app.audit_row_change('assistant_file', 'name,data');
create trigger audit_assistant_work_plans after insert or update or delete on public.assistant_work_plans for each row execute function app.audit_row_change('assistant_work_plan', 'title,file_name');
create trigger audit_assistant_work_actions after insert or update or delete on public.assistant_work_actions for each row execute function app.audit_row_change('assistant_work_action', 'summary');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('assistant_files', 'name',     'tenant', 'tombstone', 'erased:1'),
  ('assistant_files', 'name',     'sweep',  'substring', 'erased:1'),
  ('assistant_files', 'data',     'tenant', 'null',      'erased:1'),
  ('assistant_work_plans', 'title', 'tenant', 'tombstone', 'erased:1'),
  ('assistant_work_plans', 'title', 'sweep',  'substring', 'erased:1'),
  ('assistant_work_plans', 'file_name', 'tenant', 'null', 'erased:1'),
  ('assistant_work_plans', 'file_name', 'sweep',  'substring', 'erased:1'),
  ('assistant_work_actions', 'summary', 'tenant', 'tombstone', 'erased:1'),
  ('assistant_work_actions', 'summary', 'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- who may
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.aw_gate(p_tenant_id uuid, p_roles public.app_role[]) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, p_roles) then
    perform app.aw_error('deny');
  end if;
end;
$$;
revoke all on function app.aw_gate(uuid, public.app_role[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_file_put(p_tenant_id uuid, p_name text, p_content_type text, p_kind text, p_data_base64 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data bytea;
  v_row  public.assistant_files;
  v_name text;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  delete from public.assistant_files f where f.tenant_id = p_tenant_id and f.expires_at <= now();   -- every drop sweeps the workspace's expired files
  begin
    v_data := decode(coalesce(p_data_base64, ''), 'base64');
  exception when others then
    perform app.aw_error('invalid');
  end;
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g')), 200);
  if octet_length(v_data) = 0 or octet_length(v_data) > 20000000 or v_name = '' or not app.text_is_clean(v_name) then
    perform app.aw_error('invalid');
  end if;
  if (select count(*) from public.assistant_files f where f.tenant_id = p_tenant_id and f.created_by = auth.uid()) >= 20 then
    perform app.aw_error('state');   -- at most 20 files a person keeps at once
  end if;
  insert into public.assistant_files (tenant_id, created_by, name, content_type, kind, size_bytes, sha256, data, expires_at)
  values (p_tenant_id, auth.uid(), v_name, lower(p_content_type), p_kind, octet_length(v_data), encode(sha256(v_data), 'hex'), v_data, now() + interval '24 hours')
  returning * into v_row;
  return jsonb_build_object('file_id', v_row.id, 'name', v_row.name, 'size_bytes', v_row.size_bytes, 'kind', v_row.kind, 'content_type', v_row.content_type, 'expires_at', v_row.expires_at);
exception
  when check_violation or invalid_text_representation then
    perform app.aw_error('invalid');
end;
$$;
revoke all on function public.assistant_file_put(uuid, text, text, text, text) from public, anon;
grant execute on function public.assistant_file_put(uuid, text, text, text, text) to authenticated;

create function public.assistant_file_get(p_tenant_id uuid, p_file_id uuid, p_with_data boolean default true) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.assistant_files;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into v_row from public.assistant_files f where f.tenant_id = p_tenant_id and f.id = p_file_id and f.created_by = auth.uid() and f.expires_at > now() and f.data is not null;
  if not found then
    perform app.aw_error('reference');   -- someone else's file, an expired one or a deleted one: not found
  end if;
  return jsonb_build_object('file_id', v_row.id, 'name', v_row.name, 'size_bytes', v_row.size_bytes, 'kind', v_row.kind, 'content_type', v_row.content_type, 'expires_at', v_row.expires_at,
                            'data_base64', case when p_with_data then translate(encode(v_row.data, 'base64'), E'\n', '') end);
end;
$$;
revoke all on function public.assistant_file_get(uuid, uuid, boolean) from public, anon;
grant execute on function public.assistant_file_get(uuid, uuid, boolean) to authenticated;

create function public.assistant_file_drop(p_tenant_id uuid, p_file_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  delete from public.assistant_files f where f.tenant_id = p_tenant_id and f.id = p_file_id and (f.created_by = auth.uid() or app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]));
  return found;
end;
$$;
revoke all on function public.assistant_file_drop(uuid, uuid) from public, anon;
grant execute on function public.assistant_file_drop(uuid, uuid) to authenticated;

-- the worker's sweep (and the operator's): every expired file of every workspace
create function public.scheduler_assistant_files_purge() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not app.is_scheduler() then
    perform app.aw_error('deny');
  end if;
  delete from public.assistant_files f where f.expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.scheduler_assistant_files_purge() from public, anon;
grant execute on function public.scheduler_assistant_files_purge() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.aw_plan_json(p public.assistant_work_plans) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('plan_id', p.id, 'message_id', p.message_id, 'conversation_id', p.conversation_id, 'requested_by', p.requested_by, 'file_id', p.file_id, 'title', p.title, 'file_name', p.file_name,
                            'status', case when p.status = 'proposed' and p.expires_at <= now() then 'expired' else p.status end,
                            'sensitive', p.sensitive, 'owner_only', p.owner_only, 'needs_second_factor', p.needs_second_factor, 'card', p.card, 'steps', p.steps, 'expires_at', p.expires_at,
                            'decided_by', p.decided_by, 'decided_at', p.decided_at, 'finished_at', p.finished_at, 'undone_by', p.undone_by, 'undone_at', p.undone_at, 'created_at', p.created_at)
$$;
revoke all on function app.aw_plan_json(public.assistant_work_plans) from public, anon, authenticated, service_role;

create function public.assistant_plan_put(p_tenant_id uuid, p_plan jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.assistant_work_plans;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    perform app.aw_error('invalid');
  end if;
  begin
    insert into public.assistant_work_plans (id, tenant_id, message_id, conversation_id, requested_by, file_id, title, file_name, sensitive, owner_only, needs_second_factor, card, steps, expires_at)
    values ((p_plan ->> 'plan_id')::uuid, p_tenant_id, (p_plan ->> 'message_id')::uuid, nullif(p_plan ->> 'conversation_id', '')::uuid, auth.uid(), nullif(p_plan ->> 'file_id', '')::uuid,
            p_plan ->> 'title', nullif(p_plan ->> 'file_name', ''), nullif(p_plan ->> 'sensitive', ''), coalesce((p_plan ->> 'owner_only')::boolean, false), coalesce((p_plan ->> 'needs_second_factor')::boolean, false),
            coalesce(p_plan -> 'card', '{}'::jsonb), p_plan -> 'steps', now() + interval '30 minutes')
    on conflict (id) do nothing
    returning * into v_row;
  exception
    when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value then
      perform app.aw_error('invalid');
  end;
  if v_row.id is null then
    select * into v_row from public.assistant_work_plans p where p.id = (p_plan ->> 'plan_id')::uuid and p.tenant_id = p_tenant_id and p.requested_by = auth.uid();
    if not found then
      perform app.aw_error('state');
    end if;
  end if;
  return app.aw_plan_json(v_row);
end;
$$;
revoke all on function public.assistant_plan_put(uuid, jsonb) from public, anon;
grant execute on function public.assistant_plan_put(uuid, jsonb) to authenticated;

create function public.assistant_plan_get(p_tenant_id uuid, p_plan_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.assistant_work_plans;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into v_row from public.assistant_work_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id
     and (p.requested_by = auth.uid() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]));
  if not found then
    perform app.aw_error('reference');
  end if;
  return app.aw_plan_json(v_row);
end;
$$;
revoke all on function public.assistant_plan_get(uuid, uuid) from public, anon;
grant execute on function public.assistant_plan_get(uuid, uuid) to authenticated;

create function public.assistant_plans_for_messages(p_tenant_id uuid, p_message_ids uuid[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if coalesce(array_length(p_message_ids, 1), 0) > 200 then
    perform app.aw_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.aw_plan_json(p) order by p.created_at, p.id) from public.assistant_work_plans p
                    where p.tenant_id = p_tenant_id and p.message_id = any (p_message_ids)
                      and (p.requested_by = auth.uid() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]))), '[]'::jsonb);
end;
$$;
revoke all on function public.assistant_plans_for_messages(uuid, uuid[]) from public, anon;
grant execute on function public.assistant_plans_for_messages(uuid, uuid[]) to authenticated;

-- one move of the plan, compare-and-set: the plan moves from p_expect to p_status, or nothing happens and the caller is told `state` (a second "Do it" while the first runs)
--   proposed -> running | cancelled          the requester, or the Owner (an Admin when the plan is not the Owner's only)
--   running  -> done | partly_done | failed  whoever moved it to running
--   done | partly_done -> undone             the Owner, or whoever said "Do it"
create function public.assistant_plan_move(p_tenant_id uuid, p_plan_id uuid, p_expect text, p_status text, p_steps jsonb default null, p_file_gone boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.assistant_work_plans;
  v_owner boolean;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  v_owner := app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]);
  select * into v_row from public.assistant_work_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id for update;
  if not found or not (v_row.requested_by = auth.uid() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])) then
    perform app.aw_error('reference');
  end if;
  if (p_expect, p_status) not in (('proposed', 'running'), ('proposed', 'cancelled'), ('running', 'done'), ('running', 'partly_done'), ('running', 'failed'), ('done', 'undone'), ('partly_done', 'undone'),
                                  ('proposed', 'expired')) then
    perform app.aw_error('invalid');
  end if;
  if v_row.status <> p_expect then
    perform app.aw_error('state');
  end if;
  if p_expect = 'proposed' and p_status <> 'expired' then
    if v_row.expires_at <= now() then
      update public.assistant_work_plans p set status = 'expired' where p.id = v_row.id;
      perform app.aw_error('expired');
    end if;
    if not (v_row.requested_by = auth.uid() or v_owner or (app.has_tenant_role(p_tenant_id, array['admin']::public.app_role[]) and not v_row.owner_only)) then
      perform app.aw_error('deny');
    end if;
    if v_row.owner_only and p_status = 'running' and not v_owner then
      perform app.aw_error('deny');
    end if;
  elsif p_expect = 'running' and v_row.decided_by is distinct from auth.uid() then
    perform app.aw_error('deny');
  elsif p_status = 'undone' and not (v_owner or v_row.decided_by = auth.uid()) then
    perform app.aw_error('deny');
  end if;
  if p_steps is not null and (jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) <> jsonb_array_length(v_row.steps)) then
    perform app.aw_error('invalid');
  end if;
  update public.assistant_work_plans p set
    status      = p_status,
    steps       = coalesce(p_steps, p.steps),
    file_id     = case when p_file_gone then null else p.file_id end,
    decided_by  = case when p_expect = 'proposed' then auth.uid() else p.decided_by end,
    decided_at  = case when p_expect = 'proposed' then now() else p.decided_at end,
    finished_at = case when p_expect = 'running' then now() else p.finished_at end,
    undone_by   = case when p_status = 'undone' then auth.uid() else p.undone_by end,
    undone_at   = case when p_status = 'undone' then now() else p.undone_at end
  where p.id = v_row.id
  returning * into v_row;
  return app.aw_plan_json(v_row);
exception
  when check_violation then
    perform app.aw_error('invalid');
end;
$$;
revoke all on function public.assistant_plan_move(uuid, uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.assistant_plan_move(uuid, uuid, text, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the action log
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_action_record(p_tenant_id uuid, p_plan_id uuid, p_step_no integer, p_tool text, p_summary text, p_status text, p_error text, p_changed jsonb, p_undo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.assistant_work_plans;
  v_id   uuid;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into v_plan from public.assistant_work_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id;
  if not found or v_plan.status <> 'running' or v_plan.decided_by is distinct from auth.uid() then
    perform app.aw_error('state');   -- only the run of a plan that is running, by whoever started it, writes its log
  end if;
  begin
    insert into public.assistant_work_actions (tenant_id, plan_id, step_no, tool, summary, changed, requested_by, decided_by, message_id, status, error, undo, undo_until)
    values (p_tenant_id, p_plan_id, p_step_no, p_tool, p_summary, coalesce(p_changed, '{}'::jsonb), v_plan.requested_by, auth.uid(), v_plan.message_id, p_status, p_error, p_undo,
            case when p_undo is not null and p_status = 'done' then now() + interval '7 days' end)
    on conflict (tenant_id, plan_id, step_no) do nothing
    returning id into v_id;
  exception
    when check_violation or not_null_violation then
      perform app.aw_error('invalid');
  end;
  return jsonb_build_object('action_id', v_id);
end;
$$;
revoke all on function public.assistant_action_record(uuid, uuid, integer, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.assistant_action_record(uuid, uuid, integer, text, text, text, text, jsonb, jsonb) to authenticated;

create function public.assistant_action_mark_undone(p_tenant_id uuid, p_plan_id uuid, p_step_no integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.assistant_work_plans;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into v_plan from public.assistant_work_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id;
  if not found or not (app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) or v_plan.decided_by = auth.uid()) then
    perform app.aw_error('deny');
  end if;
  update public.assistant_work_actions a set status = 'undone', undone_by = auth.uid(), undone_at = now()
   where a.tenant_id = p_tenant_id and a.plan_id = p_plan_id and a.step_no = p_step_no and a.status = 'done';
  return found;
end;
$$;
revoke all on function public.assistant_action_mark_undone(uuid, uuid, integer) from public, anon;
grant execute on function public.assistant_action_mark_undone(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- an import's undo: what it created is recorded (lead_intake_apply, below), then archived on request
-- ---------------------------------------------------------------------------------------------------------------------------------
-- the import names itself to the per-row code through a transaction-local setting (the per-row code is shared with the live doors and the Lead Finder, which pass none): a created contact is recorded
-- with its import. A dry run (the preview) rolls the record back with everything else.
do $$
declare
  v_core    text := pg_get_functiondef('app.lead_intake_core(uuid, uuid, text, uuid, jsonb, boolean)'::regprocedure);
  v_apply   text := pg_get_functiondef('public.lead_intake_apply(uuid, uuid, uuid, integer, text, text, uuid, jsonb, bigint, boolean, boolean)'::regprocedure);
  v_m_core  constant text := E'        insert into public.contacts (tenant_id, full_name, email, phone) values (p_tenant, v_name, v_email, v_phone) returning * into v_contact;\n        v_lead := app.contact_lead(p_tenant, v_contact.id, p_tag);\n        v_outcome := ''created'';\n';
  v_m_apply constant text := E'    v_result := app.lead_intake_core(p_tenant_id, v_uid, p_tag, coalesce(p_consent_id, v_tmp), p_rows, false);\n';
begin
  if position(v_m_core in v_core) = 0 or position(v_m_apply in v_apply) = 0 then
    raise exception 'assistant work: the import functions are not the ones this migration expects';
  end if;
  execute replace(v_core, v_m_core, v_m_core
    || E'        if nullif(current_setting(''app.lead_import_id'', true), '''') is not null then\n'
    || E'          insert into public.lead_intake_created (tenant_id, import_id, contact_id, lead_id) values (p_tenant, current_setting(''app.lead_import_id'', true)::uuid, v_contact.id, v_lead) on conflict do nothing;\n'
    || E'        end if;\n');
  execute replace(v_apply, v_m_apply, E'    perform set_config(''app.lead_import_id'', p_import_id::text, true);\n' || v_m_apply || E'    perform set_config(''app.lead_import_id'', '''', true);\n');
end;
$$;

create function public.lead_import_undo(p_tenant_id uuid, p_import_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done     timestamptz;
  v_counts   jsonb;
  v_archived integer := 0;
  v_kept     integer := 0;
  r          record;
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select i.undone_at, i.undo_counts into v_done, v_counts from public.lead_intakes i where i.tenant_id = p_tenant_id and i.import_id = p_import_id order by i.part limit 1;
  if not found then
    perform app.aw_error('reference');
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.aw_error('deny');   -- archiving is the Owner's or an Admin's (as on the screens), so is the undo of an import
  end if;
  if v_done is not null then
    return jsonb_build_object('import_id', p_import_id, 'already_undone', true) || coalesce(v_counts, '{}'::jsonb);
  end if;
  for r in
    select c.contact_id, c.lead_id, l.status, l.archived_at as lead_archived, k.archived_at as contact_archived, k.erased_at
      from public.lead_intake_created c
      join public.leads l on l.tenant_id = c.tenant_id and l.id = c.lead_id
      join public.contacts k on k.tenant_id = c.tenant_id and k.id = c.contact_id
     where c.tenant_id = p_tenant_id and c.import_id = p_import_id
     for update of l, k
  loop
    if r.erased_at is not null or r.lead_archived is not null or r.contact_archived is not null then
      continue;   -- gone already: neither archived by us nor kept
    end if;
    -- worked on since the import: kept as it is (a message, a touch, a second arrival, a stage that moved, a quote or an order)
    if r.status <> 'new'
       or exists (select 1 from public.lead_touches t where t.tenant_id = p_tenant_id and t.lead_id = r.lead_id)
       or exists (select 1 from public.outbox_messages m where m.tenant_id = p_tenant_id and m.contact_id = r.contact_id)
       or (select count(*) from public.lead_arrivals a where a.tenant_id = p_tenant_id and a.contact_id = r.contact_id) > 1
       or exists (select 1 from public.quotes q where q.tenant_id = p_tenant_id and q.lead_id = r.lead_id)
       or exists (select 1 from public.orders o where o.tenant_id = p_tenant_id and o.lead_id = r.lead_id) then
      v_kept := v_kept + 1;
      continue;
    end if;
    update public.leads l set archived_at = now() where l.tenant_id = p_tenant_id and l.id = r.lead_id;
    update public.contacts k set archived_at = now() where k.tenant_id = p_tenant_id and k.id = r.contact_id;
    v_archived := v_archived + 1;
  end loop;
  v_counts := jsonb_build_object('archived', v_archived, 'kept', v_kept);
  update public.lead_intakes i set undone_at = now(), undone_by = auth.uid(), undo_counts = v_counts where i.tenant_id = p_tenant_id and i.import_id = p_import_id;
  return jsonb_build_object('import_id', p_import_id, 'already_undone', false) || v_counts;
end;
$$;
revoke all on function public.lead_import_undo(uuid, uuid) from public, anon;
grant execute on function public.lead_import_undo(uuid, uuid) to authenticated;
comment on function public.lead_import_undo(uuid, uuid) is 'Job assistant-does-the-work A2: archives the contacts and leads an import created that nobody has worked on since; counts the rest (kept). Once: a second call answers the first result. The Owner or an Admin (archiving is theirs).';
