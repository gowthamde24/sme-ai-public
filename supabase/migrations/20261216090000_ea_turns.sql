-- Job EA (the conversational assistant): a reply has a TYPE (answer, confirm_action, clarify) and may point at the task it proposed or asked about; a person can list their own conversations
-- and archive one. No existing function is replaced: assistant_save_reply keeps its definition, and the new assistant_mark_reply is called right after it, inside the same run.
-- (The pairing of the type and the task is kept by assistant_mark_reply, the only writer.)
-- Nothing here sends or approves anything: a task is approved only by public.task_approve (Owner + second factor), exactly as before.

alter table public.assistant_messages add column kind text not null default 'answer' check (kind in ('answer', 'confirm_action', 'clarify'));
alter table public.assistant_messages add column task_id uuid;
alter table public.assistant_messages add constraint assistant_messages_task_fk foreign key (tenant_id, task_id) references public.tasks (tenant_id, id);
create index assistant_messages_task_idx on public.assistant_messages (tenant_id, task_id) where task_id is not null;
comment on column public.assistant_messages.kind is 'SAFE: a closed word (answer, confirm_action, clarify). CLEAN-EXEMPT: closed CHECK list';
comment on column public.assistant_messages.task_id is 'SAFE: the id of the task this reply proposed (confirm_action) or asked about (clarify). CLEAN-EXEMPT: uuid';

alter table public.assistant_conversations add column archived_at timestamptz;
comment on column public.assistant_conversations.archived_at is 'SAFE: when the person hid this conversation from their list (nothing is deleted). CLEAN-EXEMPT: timestamp';
create index assistant_conversations_list_idx on public.assistant_conversations (tenant_id, created_by, updated_at desc) where archived_at is null;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The type of a stored reply, and the task it is about. Called by the run that saved the reply (same guards as assistant_save_reply: the run is the caller's own, still running, and the agents are on).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_mark_reply(p_run_id uuid, p_message_id uuid, p_kind text, p_task_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_runs;
begin
  r := app.agent_open_run(p_run_id);
  if r.conversation_id is null or p_message_id is null or p_kind is null or p_kind not in ('answer', 'confirm_action', 'clarify')
     or (p_kind = 'answer' and p_task_id is not null) or (p_kind = 'confirm_action' and p_task_id is null) then
    perform app.agent_state_error('invalid');
  end if;
  if p_task_id is not null and not exists (select 1 from public.tasks t where t.tenant_id = r.tenant_id and t.id = p_task_id and t.created_by = r.started_by) then
    perform app.agent_state_error('invalid');
  end if;
  update public.assistant_messages m set kind = p_kind, task_id = p_task_id
   where m.id = p_message_id and m.tenant_id = r.tenant_id and m.run_id = r.id and m.role = 'assistant';
  if not found then
    perform app.agent_state_error('invalid');
  end if;
  return jsonb_build_object('message_id', p_message_id, 'kind', p_kind, 'task_id', p_task_id);
end;
$$;
revoke all on function public.assistant_mark_reply(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.assistant_mark_reply(uuid, uuid, text, uuid) to authenticated;
comment on function public.assistant_mark_reply(uuid, uuid, text, uuid) is 'Job EA: sets the type of the reply this run saved (answer, confirm_action, clarify) and the task it proposed or asked about (the caller''s own, same workspace).';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The caller's own conversations, newest first: id, a title (the first thing they said, cut to 60 characters; never a summary), when, how many messages, the last words. Archived ones are left out.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_conversations_list(p_tenant_id uuid, p_limit integer default 30, p_before timestamptz default null) returns jsonb
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
       -- the task planner keeps its own bookkeeping conversation ("Plan a task"); it is not something the person said
       and not exists (select 1 from public.assistant_messages m where m.tenant_id = c.tenant_id and m.conversation_id = c.id and m.role = 'user' and m.seq = 1 and m.body = 'Plan a task')
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
revoke all on function public.assistant_conversations_list(uuid, integer, timestamptz) from public, anon;
grant execute on function public.assistant_conversations_list(uuid, integer, timestamptz) to authenticated;
comment on function public.assistant_conversations_list(uuid, integer, timestamptz) is 'Job EA: the caller''s own conversations in one workspace, newest first, archived ones left out. PII: titles and last words are what the person wrote.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- "Archive": hide one of the caller's own conversations from the list. Nothing is deleted; asking again is fine; someone else's, another workspace's or an unknown one is the same generic refusal.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.assistant_conversation_archive(p_tenant_id uuid, p_conversation_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c     public.assistant_conversations;
begin
  if v_uid is null or p_tenant_id is null or p_conversation_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  select * into c from public.assistant_conversations x where x.id = p_conversation_id and x.tenant_id = p_tenant_id and x.created_by = v_uid for update;
  if not found then
    perform app.agent_deny();
  end if;
  update public.assistant_conversations set archived_at = coalesce(c.archived_at, now()) where tenant_id = c.tenant_id and id = c.id;
  return jsonb_build_object('id', c.id, 'archived', true);
end;
$$;
revoke all on function public.assistant_conversation_archive(uuid, uuid) from public, anon;
grant execute on function public.assistant_conversation_archive(uuid, uuid) to authenticated;
comment on function public.assistant_conversation_archive(uuid, uuid) is 'Job EA: hides one of the caller''s own conversations from their list. Nothing is deleted.';
