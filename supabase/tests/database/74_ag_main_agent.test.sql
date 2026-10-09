-- Job AG: the Main agent's database side: the switches, the run it starts, the chat (private to its owner), what it may save, and the price/language checks on a reply draft.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 1000 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');

create function pg_temp.begin(p_user text, p_tenant text, p_conv text, p_msg text, p_text text, p_run text default null) returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_begin_message(%L, %L, %L, %L, %L, 'en', %L)$q$,
    tests.rid(coalesce(p_run, 'run_' || p_msg)), tests.tid(p_tenant), tests.rid(p_conv), tests.rid(p_msg), p_text, repeat('a', 64))) $$;
create function pg_temp.begin_json(p_user text, p_tenant text, p_conv text, p_msg text, p_text text, p_run text default null) returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_user), format($q$select public.assistant_begin_message(%L, %L, %L, %L, %L, 'en', %L)$q$,
    tests.rid(coalesce(p_run, 'run_' || p_msg)), tests.tid(p_tenant), tests.rid(p_conv), tests.rid(p_msg), p_text, repeat('a', 64)))::jsonb $$;

-- ---- switched off by default: the definition, the flag, the allow-list
select is((select requires_flag from public.agent_definitions where agent_name = 'assistant'), 'assistant_enabled', 'the assistant has its own platform flag');
select is((select enabled from public.platform_flags where key = 'assistant_enabled'), false, '...OFF by default');
select is((select cardinality(allowed_tenants) from public.agent_definitions where agent_name = 'assistant'), 0, '...and no business may use it until the operator allows one');
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', 'hello'), 'SM204', 'switched off: SM204 (every layer is off)');
select is((select count(*) from public.assistant_messages where tenant_id in (tests.tid('a'), tests.tid('b'))), 0::bigint, '...and nothing was stored');

-- each layer on its own
update public.platform_flags set enabled = true where key = 'assistant_enabled';
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', 'hello'), 'SM204', 'the platform flag is on but no business is allowed: SM204');
update public.agent_definitions set allowed_tenants = array[tests.tid('a')] where agent_name = 'assistant';
update public.tenant_agent_settings set enabled = false where tenant_id = tests.tid('a');
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', 'hello'), 'SM204', 'the business is allowed but its own switch is off: SM204');
update public.tenant_agent_settings set enabled = true where tenant_id = tests.tid('a');
update public.platform_flags set enabled = false where key = 'agents_enabled';
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', 'hello'), 'SM204', 'the platform agents flag is off: SM204');
update public.platform_flags set enabled = true where key = 'agents_enabled';
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select app.agent_switch_on(%L, 'assistant')$$, tests.tid('a'))), 'true', 'all three on: the switch helper says so to a member');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select app.agent_switch_on(%L, 'assistant')$$, tests.tid('a'))), 'false', '...but a stranger gets a plain false, not the business''s state');

-- ---- who may start
select is(pg_temp.begin('a_viewer', 'a', 'conv1', 'm1', 'hello'), '42501', 'DENY: a Viewer');
select is(pg_temp.begin('outsider', 'a', 'conv1', 'm1', 'hello'), '42501', 'DENY: a stranger');
select is(pg_temp.begin('b_owner', 'a', 'conv1', 'm1', 'hello'), '42501', 'DENY: the owner of another business');
select is(tests.sqlstate_as(null, format($$select public.assistant_begin_message(%L, %L, %L, %L, 'hi', 'en', %L)$$, tests.rid('r'), tests.tid('a'), tests.rid('c'), tests.rid('m'), repeat('a', 64))), '42501', 'DENY: no identity');
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', '   '), '22023', 'DENY: an empty message');
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', repeat('x', 4001)), '22023', 'DENY: a message over 4000 characters');
select is((select count(*) from public.assistant_messages where tenant_id in (tests.tid('a'), tests.tid('b'))), 0::bigint, 'none of those stored anything');

-- ---- a message starts a run and is stored, in one step
select is(pg_temp.begin_json('a_owner', 'a', 'conv1', 'm1', 'What is waiting?') ->> 'replayed', 'false', 'ALLOW: Owner, Admin and Sales may use the assistant (Owner first)');
select is((select agent_name || '|' || status || '|' || (conversation_id is not null)::text from public.agent_runs where id = tests.rid('run_m1')), 'assistant|running|true', 'the run is an assistant run on the conversation');
select is((select role || '|' || seq || '|' || created_by::text = 'user|1|' || tests.uid('a_owner')::text from public.assistant_messages where id = tests.rid('m1')), true, 'the message is stored as the owner''s, number 1');
select is((select created_by = tests.uid('a_owner') from public.assistant_conversations where id = tests.rid('conv1')), true, 'the conversation belongs to its starter');
select is(pg_temp.begin('a_admin', 'a', 'conv2', 'm2', 'hi'), 'ok', 'ALLOW: an Admin');
select is(pg_temp.begin('a_sales', 'a', 'conv3', 'm3', 'hi'), 'ok', 'ALLOW: Sales');

-- ---- a retry replays; other words under the same id conflict; nobody else's chat can be entered
select is(pg_temp.begin_json('a_owner', 'a', 'conv1', 'm1', 'What is waiting?') ->> 'replayed', 'true', 'the same message again is a replay');
select is((select count(*) from public.agent_runs where conversation_id = tests.rid('conv1')), 1::bigint, '...it started no second run');
select is(pg_temp.begin('a_owner', 'a', 'conv1', 'm1', 'Something else'), '23505', 'the same id with other words: 23505');
select is(pg_temp.begin('a_admin', 'a', 'conv1', 'm9', 'let me in'), '42501', 'DENY: another member cannot add to someone else''s chat');
select is(pg_temp.begin('a_owner', 'b', 'conv1', 'm9', 'wrong business'), '42501', 'DENY: the right chat under the wrong business');
select is(pg_temp.begin('b_owner', 'b', 'conv1', 'm9', 'claim it'), '42501', 'DENY: a stranger cannot take over the conversation id');

-- ---- a chat is private to its starter (and to the roles that may use the assistant)
select is(tests.rows_as(tests.uid('a_owner'), 'select 1 from public.assistant_conversations'), 1::bigint, 'the owner reads their own chat');
select is(tests.rows_as(tests.uid('a_admin'), format($$select 1 from public.assistant_conversations where id = %L$$, tests.rid('conv1'))), 0::bigint, 'an Admin does not read the owner''s chat');
select is(tests.rows_as(tests.uid('a_admin'), 'select 1 from public.assistant_messages'), 1::bigint, '...only their own message');
select is(tests.rows_as(tests.uid('a_owner'), format($$select 1 from public.assistant_messages where conversation_id = %L$$, tests.rid('conv2'))), 0::bigint, 'and the owner does not read the Admin''s');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.assistant_messages'), 0::bigint, 'another business reads nothing');
select is(tests.sqlstate_as(null, 'select * from public.assistant_messages'), '42501', 'anon: no access');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by) values (%L, %L, %L, 9, 'user', 'x', %L)$$, tests.rid('x'), tests.tid('a'), tests.rid('conv1'), tests.uid('a_owner'))), '42501', 'DENY: no client writes a message');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.assistant_messages set body = 'edited' where id = %L$$, tests.rid('m1'))), '42501', 'DENY: no client edits one');
select is(tests.sqlstate_as(tests.uid('a_owner'), $$delete from public.assistant_conversations$$), '42501', 'DENY: no client deletes a chat');

-- ---- the day's cost cap and the start limits apply
select is(tests.scalar_as(tests.uid('a_owner'), format($$select public.agent_reserve_cost(%L, 'cap-1', 'fake-selftest', 600, 300)$$, tests.rid('run_m1')))::jsonb ->> 'granted', 'true', 'the day''s spend so far: 900 micros');
update public.tenant_agent_settings set daily_cost_cap_micros = 500 where tenant_id = tests.tid('a');
select is(pg_temp.begin('a_owner', 'a', 'conv4', 'm4', 'hi'), 'SM207', 'a business at its daily cost cap cannot start a message: SM207');
update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = tests.tid('a');
update public.agent_limits set limit_value = 1 where limit_key = 'max_runs_per_hour';
select is(pg_temp.begin('a_owner', 'a', 'conv4', 'm4', 'hi'), 'SM206', 'the hourly start limit applies: SM206');
update public.agent_limits set limit_value = 1000 where limit_key = 'max_runs_per_hour';
select is((select count(*) from public.assistant_messages where id = tests.rid('m4')), 0::bigint, 'a refused message is not stored');

-- ---- save the answer: only for the run's own starter, while it runs
create function pg_temp.reply(p_user text, p_run text, p_msg text, p_sources text default '[]', p_drafts text default '[]', p_body text default 'Two quotes are waiting.') returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_save_reply(%L, %L, %L, 'en', %L::jsonb, %L::jsonb)$q$, tests.rid(p_run), tests.rid(p_msg), p_body, p_sources, p_drafts)) $$;
select is(pg_temp.reply('a_admin', 'run_m1', 'r1'), '42501', 'DENY: someone else''s run');
select is(pg_temp.reply('b_owner', 'run_m1', 'r1'), '42501', 'DENY: another business''s owner');
select is(pg_temp.reply('a_owner', 'run_m1', 'r1', '[{"type":"dashboard","id":"00000000-0000-0000-0000-000000000001"}]'), '22023', 'a source type outside the list is invalid');
select is(pg_temp.reply('a_owner', 'run_m1', 'r1', format('[{"type":"lead","id":"%s","label":"Name"}]', tests.rid('a_lead'))), '22023', 'a source with a name in it is invalid (ids only)');
select is(pg_temp.reply('a_owner', 'run_m1', 'r1', '[{"type":"lead","id":"not-a-uuid"}]'), '22023', 'a source with a bad id is invalid');
select is(pg_temp.reply('a_owner', 'run_m1', 'r1', '[]', '[]', ''), '22023', 'an empty answer is invalid');
select is(pg_temp.reply('a_owner', 'run_m1', 'r1', format('[{"type":"lead","id":"%s"}]', tests.rid('a_lead')), format('[{"type":"quote","id":"%s"}]', tests.rid('a_quote'))), 'ok', 'ALLOW: the starter saves the answer with ids only');
select is((select role || '|' || seq || '|' || jsonb_array_length(sources) || '|' || jsonb_array_length(drafts) from public.assistant_messages where id = tests.rid('r1')), 'assistant|2|1|1', 'stored as the assistant''s reply, number 2');
select is(pg_temp.reply('a_owner', 'run_m1', 'r1'), 'ok', 'the same message id again is a replay');
select is((select count(*) from public.assistant_messages where conversation_id = tests.rid('conv1')), 2::bigint, '...no third message');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.finish_agent_run(%L, 'succeeded', null)$$, tests.rid('run_m1'))), 'ok', 'the run is closed');
select is(pg_temp.reply('a_owner', 'run_m1', 'r2'), 'SM201', 'a closed run saves nothing: SM201');
-- the kill switch is re-read on every save
update public.platform_flags set enabled = false where key = 'assistant_enabled';
select is(pg_temp.reply('a_admin', 'run_m2', 'r3'), 'SM204', 'switched off while it ran: the save is refused (SM204)');
update public.platform_flags set enabled = true where key = 'assistant_enabled';

-- ---- a customer-reply draft
create function pg_temp.draft(p_user text, p_run text, p_id text, p_lead uuid, p_lang text, p_body text, p_gloss text) returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_save_reply_draft(%L, %L, %L, null, %L, %L, %L)$q$, tests.rid(p_run), tests.rid(p_id), p_lead, p_lang, p_body, p_gloss)) $$;
select is(pg_temp.draft('a_admin', 'run_m2', 'd1', tests.rid('a_lead'), 'te', 'నమస్కారం, ధన్యవాదాలు', 'Hello, thank you'), 'ok', 'ALLOW: a machine-written draft with an English gloss');
select is((select machine_draft::text || '|' || status || '|' || language from public.assistant_reply_drafts where id = tests.rid('d1')), 'true|draft|te', 'marked machine text, a draft');
select is(pg_temp.draft('a_admin', 'run_m2', 'd1', tests.rid('a_lead'), 'te', 'నమస్కారం, ధన్యవాదాలు', 'Hello, thank you'), 'ok', 'a retry is a replay');
select is(pg_temp.draft('a_admin', 'run_m2', 'd1', tests.rid('a_lead'), 'te', 'వేరే మాటలు', 'Other words'), '23505', 'the same id with other words conflicts');
select is((select count(*) from public.assistant_reply_drafts where tenant_id = tests.tid('a')), 1::bigint, '...still one draft');
select is(pg_temp.draft('a_admin', 'run_m2', 'd2', tests.rid('a_lead'), 'en', 'The price is ₹500 each', 'The price'), '23514', 'DENY: a rupee sign (a price) in the text');
select is(pg_temp.draft('a_admin', 'run_m2', 'd3', tests.rid('a_lead'), 'en', 'The price is Rs. 500 each', 'The price'), '23514', 'DENY: "Rs. 500"');
select is(pg_temp.draft('a_admin', 'run_m2', 'd4', tests.rid('a_lead'), 'en', 'It is 500/- each', 'It costs'), '23514', 'DENY: "500/-"');
select is(pg_temp.draft('a_admin', 'run_m2', 'd5', tests.rid('a_lead'), 'te', 'ధర రూ. 500', 'The price'), '23514', 'DENY: a Telugu rupee sign and number');
select is(pg_temp.draft('a_admin', 'run_m2', 'd6', tests.rid('a_lead'), 'en', 'Thank you for writing', 'It is five hundred rupees'), '23514', 'DENY: a price in the English gloss');
select is(pg_temp.draft('a_admin', 'run_m2', 'd7', tests.rid('a_lead'), 'fr', 'Merci', 'Thanks'), '22023', 'DENY: a language outside the five');
select is(pg_temp.draft('a_admin', 'run_m2', 'd8', tests.rid('b_lead'), 'en', 'Thank you for writing', 'Thank you for writing'), '23503', 'DENY: another business''s lead (a plain reference refusal)');
select is(pg_temp.draft('a_owner', 'run_m2', 'd9', tests.rid('a_lead'), 'en', 'Thank you for writing', 'Thank you for writing'), '42501', 'DENY: someone else''s run');
select is(tests.sqlstate_as(tests.uid('a_admin'), format($$select public.assistant_save_reply_draft(%L, %L, null, null, 'en', 'Hello there', 'Hello there')$$, tests.rid('run_m2'), tests.rid('d10'))), '22023', 'DENY: neither a lead nor an enquiry');
select is(tests.rows_as(tests.uid('a_admin'), 'select 1 from public.assistant_reply_drafts'), 1::bigint, 'the Admin reads their own draft');
select is(tests.rows_as(tests.uid('a_owner'), 'select 1 from public.assistant_reply_drafts'), 0::bigint, '...the owner does not');
select throws_ok(format($$insert into public.assistant_reply_drafts (id, tenant_id, conversation_id, run_id, lead_id, language, body, gloss_en, machine_draft, created_by)
  values (gen_random_uuid(), %L, %L, %L, %L, 'en', 'Hello there', 'Hello there', false, %L)$$, tests.tid('a'), tests.rid('conv2'), tests.rid('run_m2'), tests.rid('a_lead'), tests.uid('a_admin')), '23514', null, 'a reply draft cannot be un-marked as machine text');

-- ---- the status read: the Main agent is a helper, with its own state
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'main' ->> 'switched_on')$$, tests.tid('a'))), 'true', 'status: the assistant''s switch is on for A');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.agents_status(%L) -> 'main' ->> 'switched_on')$$, tests.tid('b'))), 'false', '...and off for B');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'main' ->> 'running')$$, tests.tid('a'))), 'true', '...running while a message is in flight');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'researcher' ->> 'switched_on')$$, tests.tid('a'))), 'false', 'the researcher is off: its own flag is off');

-- ---- erasure: a tenant-wide erasure tombstones what was said
select ok(exists (select 1 from erasure.registry where table_name = 'assistant_messages' and column_name = 'body' and scope = 'tenant'), 'erasure knows the messages (tenant scope)');
select ok(exists (select 1 from erasure.registry where table_name = 'assistant_messages' and column_name = 'body' and scope = 'sweep'), '...and sweeps them for exact e-mail and phone identifiers');
select ok(exists (select 1 from erasure.registry where table_name = 'assistant_reply_drafts' and column_name in ('body', 'gloss_en') and scope = 'tenant'), '...and the reply drafts');

select * from finish();
rollback;
