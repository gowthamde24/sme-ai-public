-- Job OR (migration 20261224140000): the AI lead reader runs by itself on WhatsApp leads.
--   A catalog and roles   B who is read and when (new lead, later message, gate, switch, cap)   C what is stored (low confidence, fixed fields, better guesses)   D the limits
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select app.operator_set_outbox(true);
select app.operator_register_scheduler('outsider@test.local');
select app.operator_register_channel_agent('X6@test.local');
select app.operator_enable_assistant((select slug from public.tenants where id = tests.tid('a')));

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.inb(p_wamid text, p_from text, p_text text, p_mins int) returns text language sql as $$
  select pg_temp.sc('x6', format($q$select public.wa_ingest_inbound('100000000000001', %L, %L, 'Cust', 'text', %L, now() - make_interval(mins => %s), %L, 1, false)$q$, p_wamid, p_from, p_text, p_mins, pg_temp.h(p_from))) $$;
create function pg_temp.pending() returns jsonb language plpgsql as $$
declare r text;
begin r := pg_temp.sch('select public.scheduler_lead_reads_pending(10)::text'); return case when r like 'ERR:%' then jsonb_build_array(r) else r::jsonb end; end $$;
create function pg_temp.has(p_lead uuid) returns boolean language sql as $$ select exists (select 1 from jsonb_array_elements(pg_temp.pending()) e where e ->> 'lead_id' = p_lead::text) $$;
create function pg_temp.apply(p_lead uuid, p_fields jsonb, p_conf jsonb default null, p_msgs int default 1) returns text language sql as $$
  select pg_temp.sch(format($q$select public.scheduler_lead_read_apply(%L, %L, %L::jsonb, %L::jsonb, %s)$q$, tests.tid('a'), p_lead, p_fields::text,
    coalesce(p_conf, (select jsonb_object_agg(k, 'low') from jsonb_object_keys(p_fields) k))::text, p_msgs)) $$;

select is(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a'))) like 'ERR:%', false, 'setup: the business has its WhatsApp number');
select is(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')))::jsonb ->> 'status', 'active', 'setup: switched on');
select tests.open_gate('a');

-- A. catalog and roles
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('scheduler_lead_reads_pending', 'scheduler_lead_read_apply')
            and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 2::bigint, 'A1: both worker functions are SECURITY DEFINER, empty search_path, not for anon');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and table_name = 'lead_read_days' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A2: no client role touches the counter table');
select is(pg_temp.sc('a_owner', 'select public.scheduler_lead_reads_pending(3)::text'), 'ERR:42501', 'A3: an Owner is not the worker');
select is(pg_temp.sc('x6', 'select public.scheduler_lead_reads_pending(3)::text'), 'ERR:42501', 'A4: nor is the channel account');
select is(pg_temp.sch('select public.scheduler_lead_reads_pending(0)::text'), 'ERR:22023', 'A5: a limit of zero is refused');
select is(app.lead_reader_daily_cap(), 200, 'A6: 200 reads a workspace a day');

-- B. who is read, and when
create temp table orr as select pg_temp.inb('wamid.R1', '0091234567811', 'paver blocks for 2000 sq ft', 50)::jsonb as r;
create function pg_temp.lead() returns uuid language sql as $$ select (r ->> 'lead_id')::uuid from orr $$;
select is((select r ->> 'outcome' from orr), 'stored', 'B0: a first WhatsApp message makes a NEW lead');
select is(pg_temp.has(pg_temp.lead()), true, 'B1: a new lead is read at its first message');
select is((select e ->> 'text' from jsonb_array_elements(pg_temp.pending()) e where e ->> 'lead_id' = pg_temp.lead()::text), 'paver blocks for 2000 sq ft', 'B2: the reader is given the customer''s words, and only those');
select is((select e ->> 'messages' from jsonb_array_elements(pg_temp.pending()) e where e ->> 'lead_id' = pg_temp.lead()::text), '1', 'B3: ...and how many messages that is');
select app.operator_close_real_data_gate((select slug from public.tenants where id = tests.tid('a')));
select is(pg_temp.has(pg_temp.lead()), false, 'B4: a closed real-data gate: nothing is read');
select is(pg_temp.apply(pg_temp.lead(), '{"need":"paver blocks"}'), 'skipped', 'B5: ...and nothing is stored');
select tests.open_gate('a');
select is(pg_temp.has(pg_temp.lead()), true, 'B6: the gate open again: it is read');
select is(app.lead_reader_allowed(tests.tid('b')), false, 'B7: another workspace (assistant not enabled, gate shut) is never read');

-- C. what is stored
select is(pg_temp.apply(pg_temp.lead(), '{"need":"paver blocks","quantity":"2000 sq ft","urgency":"normal","language":"en","area":"Hindupur"}'), 'applied', 'C1: the reader''s fields are stored');
select is((select concat_ws('|', need, quantity, urgency, language, area, normalised_by) from public.lead_profiles where lead_id = pg_temp.lead()), 'paver blocks|2000 sq ft|normal|en|Hindupur|ai', 'C2: need, size, urgency, language and area are filled by the AI');
select is((select confidence from public.lead_profiles where lead_id = pg_temp.lead()), '{"need":"low","area":"low","quantity":"low","urgency":"low","language":"low"}'::jsonb, 'C3: every one with LOW confidence (the "?")');
select is(pg_temp.has(pg_temp.lead()), false, 'C4: the lead is not read again with no new message');
select is(pg_temp.inb('wamid.R2', '0091234567811', 'and delivery by Friday', 40)::jsonb ->> 'outcome', 'stored', 'C5: a later message arrives');
select is(pg_temp.has(pg_temp.lead()), false, 'C6: need and quantity are filled: a later message is NOT read again');
update public.lead_profiles set quantity = null where lead_id = pg_temp.lead();
select is(pg_temp.has(pg_temp.lead()), true, 'C7: a key field empty again (say the owner cleared it): the later message is read');
update public.lead_profiles set quantity = null, fixed = array['quantity'], confidence = confidence - 'quantity' where lead_id = pg_temp.lead();
select is(pg_temp.apply(pg_temp.lead(), '{"quantity":"5000 sq ft","timeline":"Friday"}', null, 2), 'applied', 'C8: a field the owner fixed is not written, the others are');
select is((select concat_ws('|', coalesce(quantity, '-'), timeline) from public.lead_profiles where lead_id = pg_temp.lead()), '-|Friday', 'C9: ...quantity stayed as the owner left it');
update public.lead_profiles set area = 'Eluru', confidence = confidence || '{"area":"medium"}'::jsonb where lead_id = pg_temp.lead();
select is(pg_temp.apply(pg_temp.lead(), '{"area":"Guntur"}', null, 2), 'nothing', 'C10: a better guess (medium) is not replaced by the model''s low one');
select is((select area from public.lead_profiles where lead_id = pg_temp.lead()), 'Eluru', 'C11: ...area is still the rules'' guess');
select is(pg_temp.apply(pg_temp.lead(), '{"need":"x"}', '{"need":"high"}'::jsonb, 2), 'nothing', 'C12: only LOW confidence is accepted from the reader');
select is(pg_temp.apply(pg_temp.lead(), '{"need":"call 9876543210 now"}', null, 2), 'nothing', 'C13: a value the profile refuses (a phone number) is dropped, the read still counts');
select is(pg_temp.apply(tests.rid('s1'), '{"need":"x"}'), 'ERR:23503', 'C14: a lead that is not a WhatsApp lead of this workspace is refused');
select is(pg_temp.sc('a_owner', format($q$select public.scheduler_lead_read_apply(%L, %L, '{}'::jsonb, '{}'::jsonb, 1)$q$, tests.tid('a'), pg_temp.lead())), 'ERR:42501', 'C15: only the worker stores a read');

-- D. the limits
select is((select ai_reads from public.lead_profiles where lead_id = pg_temp.lead())::int, 5, 'D1: five reads so far on this lead (the last one was refused by the profile''s own rules, and counted)');
select is((select reads from workspace.lead_read_days where workspace_id = tests.tid('a') and day = (now() at time zone 'Asia/Kolkata')::date), 5, 'D2: and five on the workspace''s day');
select is(pg_temp.apply(pg_temp.lead(), '{"budget":"1 lakh"}', null, 5), 'skipped', 'D3: a lead is read at most five times');
create temp table orr2 as select pg_temp.inb('wamid.R9', '0091234567812', 'need 100 bricks in Eluru', 30)::jsonb as r;
create function pg_temp.lead2() returns uuid language sql as $$ select (r ->> 'lead_id')::uuid from orr2 $$;
update workspace.lead_read_days set reads = 199 where workspace_id = tests.tid('a');
select is(pg_temp.apply(pg_temp.lead2(), '{"city":"Eluru"}', null, 1), 'applied', 'D4: the 200th read of the day is allowed');
select is(app.lead_reader_allowed(tests.tid('a')), false, 'D5: ...and then the workspace is at its cap');
select is(pg_temp.has(pg_temp.lead2()), false, 'D6: nothing is handed to the reader any more that day');
select is(pg_temp.apply(pg_temp.lead2(), '{"budget":"1 lakh"}', null, 2), 'skipped', 'D7: and nothing more is stored');
update workspace.lead_read_days set reads = 0 where workspace_id = tests.tid('a');
select is(pg_temp.apply(pg_temp.lead2(), '{"budget":"1 lakh"}', null, 2), 'applied', 'D8: the next day (the count back at zero) it reads again');
select * from finish();
rollback;
