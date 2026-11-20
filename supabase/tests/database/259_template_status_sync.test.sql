-- WhatsApp's decision on our templates (migration 20261231986800): the system account asks which accounts are due and writes the decisions (audited when a status changes, never for a draft, bad words refused),
-- and a message WhatsApp sent back is a Needs-you item for the Owner and Admin (one per message name, gone when approved again).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
create function pg_temp.mk(p_id text, p_name text, p_lang text, p_final text) returns void language plpgsql as $$
begin
  perform pg_temp.sc('a_owner', format($q$select public.wa_template_save(%L, %L, %L, %L, 'utility', 'info', %L, null)$q$, tests.rid(p_id), tests.tid('a'), p_name, p_lang, 'Hello {{1}}, your order from {{2}} is ready. Reply here to collect it.'));
  if p_final <> 'draft' then perform pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid(p_id))); end if;
end $$;
select pg_temp.mk('s1', 'order_ready', 'en', 'submitted');
select pg_temp.mk('s2', 'order_ready', 'te', 'submitted');
select pg_temp.mk('s3', 'visit_invite', 'en', 'submitted');
select pg_temp.mk('s4', 'time_to_come_back', 'en', 'draft');
create function pg_temp.due(p_user text default 'outsider') returns text language sql as $$ select pg_temp.sc(p_user, $q$select public.scheduler_wa_templates_due(20, 10)::text$q$) $$;
create function pg_temp.decide(p_decisions text, p_user text default 'outsider') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.scheduler_wa_templates_decided(%L, %L::jsonb)::text$q$, tests.tid('a'), p_decisions))
$$;
create function pg_temp.kinds(p_user text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), format($q$select coalesce(string_agg(x ->> 'kind', ',' order by x ->> 'kind'), '') from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x$q$, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate; end $$;

-- A. who asks, what is due
select is(pg_temp.due('a_owner'), 'ERR:42501', 'A1 a workspace owner cannot ask');
select is((pg_temp.due()::jsonb -> 0 ->> 'waba_id'), '200000000000001', 'A2 the system sees the account with submitted templates');
select is(jsonb_array_length(pg_temp.due()::jsonb -> 0 -> 'templates'), 3, 'A3 its three SUBMITTED templates (the draft is not asked about)');

-- B. what WhatsApp said
select is(pg_temp.decide(format('[{"id":"%s","status":"approved"},{"id":"%s","status":"rejected","reject_code":"INVALID_FORMAT"}]', tests.rid('s1'), tests.rid('s3'))), '{"changed": 2}', 'B1 two statuses changed');
select is((select status from integrations.wa_templates where id = tests.rid('s1')), 'approved', 'B2 approved');
select is((select status || '/' || reject_code from integrations.wa_templates where id = tests.rid('s3')), 'rejected/INVALID_FORMAT', 'B3 rejected, with Meta''s closed reason word');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action in ('whatsapp.template_approved', 'whatsapp.template_rejected')), 2, 'B4 each change is in the audit trail');
select is(pg_temp.decide(format('[{"id":"%s","status":"approved"}]', tests.rid('s1'))), '{"changed": 0}', 'B5 the same word again changes nothing');
select is(pg_temp.decide(format('[{"id":"%s","status":"approved"}]', tests.rid('s4'))), '{"changed": 0}', 'B6 a draft is never moved by a decision');
select is((select status from integrations.wa_templates where id = tests.rid('s4')), 'draft', 'B7 it is still a draft');
select is(pg_temp.decide(format('[{"id":"%s","status":"launched"}]', tests.rid('s2'))), 'ERR:22023', 'B8 a word outside the list is refused');
select is(pg_temp.decide(format('[{"id":"%s","status":"rejected","reject_code":"bad code!"}]', tests.rid('s2'))), 'ERR:22023', 'B9 so is a reason that is not a closed word');
select is(pg_temp.decide('[]', 'a_owner'), 'ERR:42501', 'B10 a workspace owner cannot write decisions');
select is(jsonb_array_length(pg_temp.due()::jsonb -> 0 -> 'templates'), 1, 'B11 only the one still submitted and not asked in the last 10 minutes is due');

-- C. Needs you
select is(pg_temp.kinds('a_owner') like '%message_needs_change%', true, 'C1 the rejected message is on the Owner''s Needs you');
select is(pg_temp.kinds('a_admin') like '%message_needs_change%', true, 'C2 and on an Admin''s');
select is(pg_temp.kinds('a_sales') like '%message_needs_change%', false, 'C3 not on Sales''');
select is(pg_temp.kinds('b_owner') like '%message_needs_change%', false, 'C4 not on another business''s');
select is((select x ->> 'ref' from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.today_summary(%L) -> 'needs_you')::text$q$, tests.tid('a')))::jsonb) x where x ->> 'kind' = 'message_needs_change'), 'visit invite', 'C5 it names the message in words');
select is((select x -> 'target' ->> 'type' from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.today_summary(%L) -> 'needs_you')::text$q$, tests.tid('a')))::jsonb) x where x ->> 'kind' = 'message_needs_change'), 'message', 'C6 pointing at the message');
select pg_temp.decide(format('[{"id":"%s","status":"rejected","reject_code":"INVALID_FORMAT"}]', tests.rid('s2')));
select is((select count(*)::int from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.today_summary(%L) -> 'needs_you')::text$q$, tests.tid('a')))::jsonb) x where x ->> 'kind' = 'message_needs_change'), 2, 'C7 one item per message name (order ready and visit invite)');
update integrations.wa_templates set status = 'approved' where id = tests.rid('s3');
select is((select count(*)::int from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select (public.today_summary(%L) -> 'needs_you')::text$q$, tests.tid('a')))::jsonb) x where x ->> 'kind' = 'message_needs_change'), 1, 'C8 approved again: it leaves');
update integrations.wa_templates set updated_at = now() - interval '31 days' where id = tests.rid('s2');
select is(pg_temp.kinds('a_owner') like '%message_needs_change%', false, 'C9 after 30 days it leaves too');

select * from finish();
rollback;
