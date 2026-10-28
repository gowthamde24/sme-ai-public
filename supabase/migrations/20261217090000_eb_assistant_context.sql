-- Job EB part A (job-context-and-easy-sources): "About my business". The owner's own notes for the assistant, per workspace, VERSIONED: every save is a new row (who, when, what changed), none is edited or
-- deleted (except by the erasure of the workspace). The assistant reads the latest version in chats, calls, Ask, drafts and automatic replies; a fact in it may be stated ("from your notes").
-- Read: any member. Write: Owner and Admin, through assistant_context_save only (it checks the version the caller saw, so two people cannot overwrite each other without noticing).

create table public.assistant_context_versions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  version    integer not null check (version >= 1),
  notes      text not null check (char_length(notes) <= 20000 and app.text_is_clean(notes)),
  change     text not null check (char_length(change) between 1 and 60 and app.text_is_clean(change)),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);
comment on table public.assistant_context_versions is 'Job EB: the owner''s notes about the business, one row per saved version. Append-only. Written only by assistant_context_save.';
comment on column public.assistant_context_versions.notes is 'PII: what the owner wrote about the business (prices, areas, rules; may name a person or a supplier). Erased with the workspace.';
comment on column public.assistant_context_versions.change is 'SAFE: a short machine-made label such as "added 3 lines" or "restored version 2". Clean text; no person''s data.';
comment on column public.assistant_context_versions.version is 'SAFE: a counter. CLEAN-EXEMPT: number';
comment on column public.assistant_context_versions.created_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';
create index assistant_context_versions_latest_idx on public.assistant_context_versions (tenant_id, version desc);
alter table public.assistant_context_versions enable row level security;
alter table public.assistant_context_versions force row level security;
revoke all on public.assistant_context_versions from public, anon, authenticated, service_role;
grant select on public.assistant_context_versions to authenticated;
create policy assistant_context_versions_select on public.assistant_context_versions for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales', 'viewer']::public.app_role[])))::uuid[]));
create trigger assistant_context_versions_forbid_tenant_id_change before update on public.assistant_context_versions for each row execute function app.forbid_tenant_id_change();
create trigger audit_assistant_context_versions after insert on public.assistant_context_versions for each row execute function app.audit_row_change('assistant_context', 'notes');

-- a version is never edited or deleted; only the erasure of the whole workspace may blank the words
create function app.assistant_context_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'saved versions of the notes are never deleted' using errcode = '42501';
  end if;
  if new is not distinct from old then
    return new;   -- a self-assignment changes nothing
  end if;
  if not app.erasure_running(old.tenant_id) then
    raise exception 'saved versions of the notes do not change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger assistant_context_versions_guard before update or delete on public.assistant_context_versions for each row execute function app.assistant_context_guard();
create trigger assistant_context_versions_no_truncate before truncate on public.assistant_context_versions for each statement execute function app.assistant_context_guard();

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('assistant_context_versions', 'notes', 'tenant', 'tombstone', 'erased:1'),
  ('assistant_context_versions', 'notes', 'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.assistant_context_json(v public.assistant_context_versions) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'notes', v.notes, 'version', v.version, 'updated_at', v.created_at, 'change', v.change, 'size', char_length(v.notes),
    'updated_by', case when v.created_by is null then null else jsonb_build_object('id', v.created_by,
      'name', (select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '') from auth.users u where u.id = v.created_by)) end)
$$;
revoke all on function app.assistant_context_json(public.assistant_context_versions) from public, anon, authenticated, service_role;

-- the latest version (or version 0 with empty notes before the first save)
create function public.assistant_context_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.assistant_context_versions;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v from public.assistant_context_versions x where x.tenant_id = p_tenant_id order by x.version desc limit 1;
  if not found then
    return jsonb_build_object('notes', '', 'version', 0, 'updated_at', null, 'change', null, 'size', 0, 'updated_by', null);
  end if;
  return app.assistant_context_json(v);
end;
$$;
revoke all on function public.assistant_context_get(uuid) from public, anon;
grant execute on function public.assistant_context_get(uuid) to authenticated;

create function public.assistant_context_versions_list(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.assistant_context_json(x) - 'notes' order by x.version desc)
      from (select * from public.assistant_context_versions v where v.tenant_id = p_tenant_id order by v.version desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb));
end;
$$;
revoke all on function public.assistant_context_versions_list(uuid, integer) from public, anon;
grant execute on function public.assistant_context_versions_list(uuid, integer) to authenticated;

create function public.assistant_context_version_get(p_tenant_id uuid, p_version integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.assistant_context_versions;
begin
  if auth.uid() is null or p_tenant_id is null or p_version is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v from public.assistant_context_versions x where x.tenant_id = p_tenant_id and x.version = p_version;
  if not found then
    raise exception 'no such version' using errcode = 'P0002';
  end if;
  return app.assistant_context_json(v);
end;
$$;
revoke all on function public.assistant_context_version_get(uuid, integer) from public, anon;
grant execute on function public.assistant_context_version_get(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Save: Owner or Admin; the caller says which version they saw. Another person saved first: SM971 (the API answers 409 and shows the current text). The same words again change nothing.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_context_save(p_tenant_id uuid, p_notes text, p_expected_version integer, p_change text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_notes   text := coalesce(p_notes, '');
  cur       public.assistant_context_versions;
  v_current integer := 0;
  v_change  text := coalesce(nullif(btrim(p_change), ''), 'edited');
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or char_length(v_notes) > 20000 or not app.text_is_clean(v_notes) or char_length(v_change) > 60 or not app.text_is_clean(v_change) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant_context:' || p_tenant_id::text, 0));
  select * into cur from public.assistant_context_versions x where x.tenant_id = p_tenant_id order by x.version desc limit 1;
  if found then
    v_current := cur.version;
  end if;
  if p_expected_version <> v_current then
    raise exception 'the notes were changed by someone else' using errcode = 'SM971';
  end if;
  if found and cur.notes = v_notes then
    return app.assistant_context_json(cur);
  end if;
  if not found and v_notes = '' then
    return jsonb_build_object('notes', '', 'version', 0, 'updated_at', null, 'change', null, 'size', 0, 'updated_by', null);
  end if;
  insert into public.assistant_context_versions (tenant_id, version, notes, change, created_by) values (p_tenant_id, v_current + 1, v_notes, left(v_change, 60), v_uid) returning * into cur;
  return app.assistant_context_json(cur);
end;
$$;
revoke all on function public.assistant_context_save(uuid, text, integer, text) from public, anon;
grant execute on function public.assistant_context_save(uuid, text, integer, text) to authenticated;
comment on function public.assistant_context_save(uuid, text, integer, text) is 'Job EB: saves the notes as a NEW version (Owner or Admin) if the caller saw the latest; SM971 otherwise. The same words again change nothing.';

-- the automatic-reply worker reads the notes of the workspace it answers for (scheduler principal only)
create function public.scheduler_assistant_context(p_tenant_id uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  return coalesce((select x.notes from public.assistant_context_versions x where x.tenant_id = p_tenant_id order by x.version desc limit 1), '');
end;
$$;
revoke all on function public.scheduler_assistant_context(uuid) from public, anon;
grant execute on function public.scheduler_assistant_context(uuid) to authenticated;

-- The notes' own model runs ("understand" and "test") keep a bookkeeping conversation like the task planner's; the list leaves them out too. A full copy of the job EA definition with that one predicate widened.
create or replace function public.assistant_conversations_list(p_tenant_id uuid, p_limit integer default 30, p_before timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_items jsonb;
  v_next  timestamptz;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  with page as (
    select c.id, c.updated_at
      from public.assistant_conversations c
     where c.tenant_id = p_tenant_id and c.created_by = v_uid and c.archived_at is null
       and exists (select 1 from public.assistant_messages m where m.tenant_id = c.tenant_id and m.conversation_id = c.id)
       -- the task planner keeps its own bookkeeping conversation ("Plan a task", "Read business notes", "Test business notes"); it is not something the person said
       and not exists (select 1 from public.assistant_messages m where m.tenant_id = c.tenant_id and m.conversation_id = c.id and m.role = 'user' and m.seq = 1 and m.body in ('Plan a task', 'Read business notes', 'Test business notes'))
       and (p_before is null or c.updated_at < p_before)
     order by c.updated_at desc, c.id desc
     limit v_limit + 1
  ), shown as (select * from page order by updated_at desc, id desc limit v_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'title', (select left(m.body, 60) from public.assistant_messages m where m.tenant_id = p_tenant_id and m.conversation_id = s.id and m.role = 'user' order by m.seq limit 1),
           'updated_at', s.updated_at,
           'message_count', (select count(*) from public.assistant_messages m where m.tenant_id = p_tenant_id and m.conversation_id = s.id),
           'last_text', (select left(m.body, 120) from public.assistant_messages m where m.tenant_id = p_tenant_id and m.conversation_id = s.id order by m.seq desc limit 1)
         ) order by s.updated_at desc, s.id desc), '[]'::jsonb),
         case when (select count(*) from page) > v_limit then min(s.updated_at) end
    into v_items, v_next
    from shown s;
  return jsonb_build_object('items', v_items, 'next_before', v_next);
end;
$$;
