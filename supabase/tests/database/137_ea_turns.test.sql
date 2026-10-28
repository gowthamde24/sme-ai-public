-- Job EA (migration 20261216090000): the conversational assistant's database side: a reply has a type and may point at a task, a person lists their OWN conversations, and archives one.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 1000 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
update public.platform_flags set enabled = true where key in ('assistant_enabled', 'agents_enabled');
update public.agent_definitions set allowed_tenants = array[tests.tid('a')] where agent_name = 'assistant';
update public.tenant_agent_settings set enabled = true where tenant_id = tests.tid('a');

create function pg_temp.begin(p_user text, p_conv text, p_msg text, p_text text) returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_begin_message(%L, %L, %L, %L, %L, 'en', %L)$q$,
    tests.rid('run_' || p_msg), tests.tid('a'), tests.rid(p_conv), tests.rid(p_msg), p_text, repeat('a', 64))) $$;
create function pg_temp.reply(p_user text, p_msg text, p_reply text, p_body text) returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_save_reply(%L, %L, %L, 'en', '[]'::jsonb, '[]'::jsonb)$q$, tests.rid('run_' || p_msg), tests.rid(p_reply), p_body)) $$;
create function pg_temp.mark(p_user text, p_msg text, p_reply text, p_kind text, p_task text default null) returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_mark_reply(%L, %L, %L, %s)$q$, tests.rid('run_' || p_msg), tests.rid(p_reply), p_kind,
    case when p_task is null then 'null::uuid' else format('%L::uuid', tests.rid(p_task)) end)) $$;
create function pg_temp.list(p_user text) returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_user), format($q$select public.assistant_conversations_list(%L, 30, null)$q$, tests.tid('a')))::jsonb $$;

-- the owner's chat (two messages), the admin's chat, and the task planner's own bookkeeping conversation
select is(pg_temp.begin('a_owner', 'conv1', 'm1', 'tell me a joke about a shopkeeper who sells sarees to everybody in the whole town and beyond'), 'ok', 'setup: the owner starts a chat');
select is(pg_temp.reply('a_owner', 'm1', 'r1', 'Here is one.'), 'ok', 'setup: the reply is stored');
select is(pg_temp.begin('a_admin', 'conv2', 'm2', 'hello'), 'ok', 'setup: the admin starts their own chat');
select is(pg_temp.reply('a_admin', 'm2', 'r2', 'Hi!'), 'ok', 'setup: ...and gets a reply');
select is(pg_temp.begin('a_owner', 'convp', 'mp', 'Plan a task'), 'ok', 'setup: the planner''s bookkeeping conversation');
select is(pg_temp.reply('a_owner', 'mp', 'rp', 'Plan made'), 'ok', 'setup: ...with its reply');

-- ---- a reply is a plain answer until it is marked
select is((select kind || '|' || coalesce(task_id::text, 'none') from public.assistant_messages where id = tests.rid('r1')), 'answer|none', 'a stored reply is an answer with no task');
select is((select kind from public.assistant_messages where id = tests.rid('m1')), 'answer', 'so is the owner''s own message');

-- ---- marking: the type, the task, who may
insert into public.tasks (id, tenant_id, instruction, language, created_by) values
  (tests.rid('t_owner'), tests.tid('a'), 'Call the new leads', 'en', tests.uid('a_owner')),
  (tests.rid('t_admin'), tests.tid('a'), 'Call the old leads', 'en', tests.uid('a_admin'));
select is(pg_temp.mark('a_owner', 'm1', 'r1', 'clarify'), 'ok', 'ALLOW: a question needs no task');
select is((select kind from public.assistant_messages where id = tests.rid('r1')), 'clarify', '...and the reply says it is one');
select is(pg_temp.mark('a_owner', 'm1', 'r1', 'confirm_action', 't_owner'), 'ok', 'ALLOW: a plan points at the caller''s own task');
select is((select kind || '|' || (task_id = tests.rid('t_owner'))::text from public.assistant_messages where id = tests.rid('r1')), 'confirm_action|true', '...and the task is stored with it');
select is(pg_temp.mark('a_owner', 'm1', 'r1', 'confirm_action'), '22023', 'DENY: a plan with no task');
select is(pg_temp.mark('a_owner', 'm1', 'r1', 'answer', 't_owner'), '22023', 'DENY: a plain answer with a task');
select is(pg_temp.mark('a_owner', 'm1', 'r1', 'confirm_action', 't_admin'), '22023', 'DENY: someone else''s task');
select is(pg_temp.mark('a_owner', 'm1', 'r1', 'shout'), '22023', 'DENY: a type outside the closed list');
select is(pg_temp.mark('a_owner', 'm1', 'r2', 'clarify'), '22023', 'DENY: a reply that belongs to another run');
select is(pg_temp.mark('a_admin', 'm1', 'r1', 'clarify'), '42501', 'DENY: another person''s run');
select is(pg_temp.mark('a_viewer', 'm1', 'r1', 'clarify'), '42501', 'DENY: a Viewer');
select is(tests.sqlstate_as(null, format($$select public.assistant_mark_reply(%L, %L, 'clarify', null)$$, tests.rid('run_m1'), tests.rid('r1'))), '42501', 'DENY: no identity');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.assistant_messages set kind = 'clarify' where id = %L$$, tests.rid('r1'))), '42501', 'DENY: no client edits the type directly');

-- ---- the list: my own conversations, newest first, a title cut to 60 characters, no bookkeeping
select is(jsonb_array_length(pg_temp.list('a_owner') -> 'items'), 1, 'the owner sees one conversation (not the admin''s, not the planner''s)');
select is(pg_temp.list('a_owner') -> 'items' -> 0 ->> 'id', tests.rid('conv1')::text, '...the right one');
select is(pg_temp.list('a_owner') -> 'items' -> 0 ->> 'title', left('tell me a joke about a shopkeeper who sells sarees to everybody in the whole town and beyond', 60), 'the title is what they said first, cut to 60');
select is((pg_temp.list('a_owner') -> 'items' -> 0 ->> 'message_count')::int, 2, 'it counts both messages');
select is(pg_temp.list('a_owner') -> 'items' -> 0 ->> 'last_text', 'Here is one.', 'and shows the last words');
select is(jsonb_array_length(pg_temp.list('a_admin') -> 'items'), 1, 'the admin sees only their own');
select is(pg_temp.list('a_owner') -> 'next_before', 'null'::jsonb, 'one page: no next page');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.assistant_conversations_list(%L, 30, null)$$, tests.tid('a'))), '42501', 'DENY: the owner of another business');
select is(tests.sqlstate_as(tests.uid('a_viewer'), format($$select public.assistant_conversations_list(%L, 30, null)$$, tests.tid('a'))), '42501', 'DENY: a Viewer');
select is(tests.sqlstate_as(null, format($$select public.assistant_conversations_list(%L, 30, null)$$, tests.tid('a'))), '42501', 'DENY: no identity');

-- ---- archive: only my own, nothing deleted
select is(tests.sqlstate_as(tests.uid('a_admin'), format($$select public.assistant_conversation_archive(%L, %L)$$, tests.tid('a'), tests.rid('conv1'))), '42501', 'DENY: archiving someone else''s conversation');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.assistant_conversation_archive(%L, %L)$$, tests.tid('a'), tests.rid('nobody'))), '42501', 'DENY: an unknown conversation (the same refusal)');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.assistant_conversation_archive(%L, %L)$$, tests.tid('a'), tests.rid('conv1'))), '42501', 'DENY: another business');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.assistant_conversation_archive(%L, %L)$$, tests.tid('a'), tests.rid('conv1'))), 'ok', 'ALLOW: archiving my own');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.assistant_conversation_archive(%L, %L)$$, tests.tid('a'), tests.rid('conv1'))), 'ok', '...asking again is fine');
select is(jsonb_array_length(pg_temp.list('a_owner') -> 'items'), 0, 'it is gone from my list');
select is((select count(*) from public.assistant_messages where conversation_id = tests.rid('conv1')), 2::bigint, '...but nothing was deleted');
select is(jsonb_array_length(pg_temp.list('a_admin') -> 'items'), 1, 'and the admin''s list is untouched');

-- ---- paging
select is(pg_temp.begin('a_owner', 'conv3', 'm3', 'second chat'), 'ok', 'setup: a second chat');
select is(pg_temp.reply('a_owner', 'm3', 'r3', 'ok'), 'ok', 'setup: its reply');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.assistant_conversations_list(%L, 1, null) -> 'items' -> 0 ->> 'title')$q$, tests.tid('a'))), 'second chat', 'limit 1 gives the newest');
select ok(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.assistant_conversations_list(%L, 0, null) -> 'items')::text$q$, tests.tid('a'))) is not null, 'a limit of 0 is treated as 1, not an error');

select * from finish();
rollback;
