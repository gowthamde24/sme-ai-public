-- Chats, closed 24-hour window (migration 20261231978600; owner, 16 Nov 2026): the approved templates of the customer's language with their words filled in, and sending the one picked through the outbox.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-12T14:00:00+05:30');   -- a Thursday, daytime
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
select app.operator_register_channel_agent('x6@test.local');
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
create temp table ct as select (pg_temp.sc('x6', format($q$select public.wa_ingest_inbound('100000000000001', 'wamid.C1', '0091234567831', 'Kavitha Gowda', 'text', 'Semi silk tissue price?', '2026-11-12T14:00:00+05:30', %L, 1, false)::text$q$, pg_temp.h('0091234567831')))::jsonb) as r;
create function pg_temp.lead() returns text language sql as $$ select r ->> 'lead_id' from ct $$;
create function pg_temp.contact() returns text language sql as $$ select r ->> 'contact_id' from ct $$;
-- approved templates (the status goes through its steps like in life)
create function pg_temp.mk(p_id text, p_name text, p_lang text, p_cat text, p_purpose text, p_body text, p_button text default null, p_final text default 'approved') returns void language plpgsql as $$
begin
  perform pg_temp.sc('a_owner', format($q$select public.wa_template_save(%L, %L, %L, %L, %L, %L, %L, %L)$q$, tests.rid(p_id), tests.tid('a'), p_name, p_lang, p_cat, p_purpose, p_body, p_button));
  if p_final <> 'draft' then
    perform pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid(p_id)));
    if p_final = 'approved' then perform pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid(p_id))); end if;
  end if;
end $$;
select pg_temp.mk('c1', 'visit_reminder', 'en', 'utility', 'visit', 'Hello {{1}}, this is a reminder from {{2}} about your upcoming visit. Reply here to confirm.');
select pg_temp.mk('c2', 'missed_call_followup', 'en', 'utility', 'info', 'Hello {{1}}, {{2}} tried to call you but could not reach you. Reply here and we will call back.');
select pg_temp.mk('c3', 'catalogue_share', 'en', 'marketing', 'info', 'Hello {{1}}, thank you for asking about the collection at {{2}}. Reply with what you are looking for.');
select pg_temp.mk('c4', 'new_collection_offer', 'en', 'marketing', 'offer', 'Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here to know more.', 'Stop promotions');
select pg_temp.mk('c5', 'lead_ack', 'en', 'utility', 'lead', 'Hello {{1}}, thank you for contacting {{2}}. We will call you shortly.', null, 'draft');
select pg_temp.mk('c6', 'visit_reminder', 'te', 'utility', 'visit', 'నమస్కారం {{1}} గారు! {{2}} నుండి మీ రాబోయే సందర్శన గురించి రిమైండర్. ఇక్కడే రిప్లై ఇవ్వండి.');
create function pg_temp.list(p_user text default 'a_owner') returns jsonb language sql as $$
  select pg_temp.sc(p_user, format($q$select public.conversation_templates(%L, %L)::text$q$, tests.tid('a'), pg_temp.lead()))::jsonb $$;

update public.platform_flags set enabled = true where key = 'outbox_enabled';

-- A. who may ask
select is(pg_temp.sc('a_viewer', format($q$select public.conversation_templates(%L, %L)::text$q$, tests.tid('a'), pg_temp.lead())), 'ERR:42501', 'A1 a viewer cannot');
select is(pg_temp.sc('b_owner', format($q$select public.conversation_templates(%L, %L)::text$q$, tests.tid('a'), pg_temp.lead())), 'ERR:42501', 'A2 nor another business');
select is(pg_temp.sc('a_sales', format($q$select public.conversation_templates(%L, %L)::text$q$, tests.tid('a'), pg_temp.lead())) like '[%', true, 'A3 Sales can');

-- B. what is offered: approved, the customer's language, utility; marketing only with consent; never an offer
select is(jsonb_array_length(pg_temp.list()), 2, 'B1 two templates: the two approved utility ones in English');
select is((select string_agg(x ->> 'name', ',' order by x ->> 'name') from jsonb_array_elements(pg_temp.list()) x), 'missed_call_followup,visit_reminder', 'B2 ... a draft, a Telugu one, a marketing one without consent and an offer are not offered');
select is((select x ->> 'preview' from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'visit_reminder'), 'Hello Kavitha, this is a reminder from ' || (select name from public.tenants where id = tests.tid('a')) || ' about your upcoming visit. Reply here to confirm.', 'B3 the preview has the real first name and the business name filled in');
select is((select jsonb_array_length(x -> 'variables') from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'visit_reminder'), 2, 'B4 two variables');
select is((select (x -> 'variables' -> 0) ->> 'key' || ',' || ((x -> 'variables' -> 0) ->> 'value') || ',' || ((x -> 'variables' -> 0) ->> 'editable') from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'visit_reminder'), 'first_name,Kavitha,false', 'B5 the first one is the first name, filled, and not editable');
select is(pg_temp.sc('a_owner', format($q$select public.marketing_consent_set(%L, %L, 'said yes in shop')::text$q$, tests.tid('a'), pg_temp.contact())) like '%granted%', true, 'B6 the owner records marketing consent');
select is((select string_agg(x ->> 'name', ',' order by x ->> 'name') from jsonb_array_elements(pg_temp.list()) x), 'catalogue_share,missed_call_followup,visit_reminder', 'B7 now the marketing-category template is offered too (an offer still is not)');
select pg_temp.sc('a_owner', format($q$select public.marketing_consent_withdraw(%L, %L)::text$q$, tests.tid('a'), pg_temp.contact()));
select is(jsonb_array_length(pg_temp.list()), 2, 'B8 withdrawn consent takes it away again');
insert into public.lead_profiles (tenant_id, lead_id, language) values (tests.tid('a'), pg_temp.lead()::uuid, 'te') on conflict (tenant_id, lead_id) do update set language = 'te';
select is((select string_agg(x ->> 'name' || '/' || (x ->> 'language'), ',') from jsonb_array_elements(pg_temp.list()) x), 'visit_reminder/te', 'B9 the customer''s language decides');
update public.lead_profiles set language = 'en' where lead_id = pg_temp.lead()::uuid;

-- C. sending the picked one
create function pg_temp.send(p_msg text, p_tpl text, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.conversation_template_send(%L, %L, %L, %L)::text$q$, tests.rid(p_msg), tests.tid('a'), pg_temp.lead(), tests.rid(p_tpl))) $$;
select is(pg_temp.send('m1', 'c1', 'a_viewer'), 'ERR:42501', 'C1 a viewer cannot send');
select ok(pg_temp.send('m1', 'c3') like 'ERR:%', 'C2 a template that is not offered (marketing, no consent) is refused');
select ok(pg_temp.send('m1', 'c4') like 'ERR:%', 'C3 an offer cannot be sent from a chat');
select ok(pg_temp.send('m1', 'c5') like 'ERR:%', 'C4 a draft cannot');
select ok(pg_temp.send('m1', 'c6') like 'ERR:%', 'C5 nor one in another language than the customer''s');
create temp table cs as select pg_temp.send('m1', 'c1')::jsonb as r;
select ok((select r ->> 'status' from cs) in ('queued', 'needs_approval'), 'C6 the visit reminder goes into the outbox (queued, or held for approval by the policy)');
select is((select body from public.outbox_messages where id = tests.rid('m1')), 'Hello Kavitha, this is a reminder from ' || (select name from public.tenants where id = tests.tid('a')) || ' about your upcoming visit. Reply here to confirm.', 'C7 its words are the preview''s');
select is((select category || '/' || source from public.outbox_messages where id = tests.rid('m1')), 'visit/owner', 'C8 a visit message from the owner');
select is((pg_temp.send('m1', 'c1')::jsonb) ->> 'replayed', 'true', 'C9 the same id again replays');

-- D. the sender names the template that was picked
create function pg_temp.ctx(p_msg text, p_at timestamptz) returns jsonb language sql as $$
  select app.wa_send_context((select m from public.outbox_messages m where m.id = tests.rid(p_msg)), p_at) $$;
select is(pg_temp.ctx('m1', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'visit_reminder', 'D1 three days later (window closed) the visit template is what is sent');
select is(jsonb_array_length(pg_temp.ctx('m1', '2026-11-15T14:00:00+05:30') -> 'template' -> 'variables'), 2, 'D2 ... with the first name and the business name');
select is((pg_temp.ctx('m1', '2026-11-15T14:00:00+05:30') ->> 'window_open'), 'false', 'D3 the window is closed');
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
select is(pg_temp.send('m2', 'c2') like '{%', true, 'D4 a second template of the same purpose can be picked');
select is(pg_temp.ctx('m2', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'missed_call_followup', 'D5 and it is that one that is sent (not the first of its purpose)');
select is(pg_temp.ctx('m1', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'opt_out', null, 'D6 a utility template carries no opt-out button');

-- E. a template with the visit's date and time ({{3}}): only when a visit is coming, and the sender names the right visit template
select pg_temp.mk('c7', 'visit_confirmation', 'en', 'utility', 'visit', 'Hello {{1}}, thank you! Your visit to {{2}} on {{3}} is confirmed. We look forward to seeing you.');
select pg_temp.mk('c8', 'visit_reminder', 'en', 'utility', 'visit', 'Hello {{1}}, this is a reminder from {{2}} about your visit on {{3}}. Reply here to confirm or change the time.');
select is((select count(*) from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' in ('visit_confirmation', 'visit_reminder')), 1::bigint, 'E1 with no visit coming only the older reminder (no time in it) is offered, never one that needs a time') ;
insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, status, confirmed_at, request_sha256, created_by)
select tests.rid('v1'), tests.tid('a'), pg_temp.lead()::uuid, pg_temp.contact()::uuid, '2026-11-14', '2026-11-14T11:00:00+05:30', '2026-11-14T11:30:00+05:30', 'booked', null, repeat('a', 64), tests.uid('a_owner');
update public.store_visits set status = 'confirmed', confirmed_at = now() where id = tests.rid('v1');
select is((select x ->> 'preview' from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'visit_confirmation'), 'Hello Kavitha, thank you! Your visit to ' || (select name from public.tenants where id = tests.tid('a')) || ' on Sat 14 Nov, 11:00 AM is confirmed. We look forward to seeing you.', 'E2 with a visit coming the confirmation is offered with its date and time filled in');
select is((select ((x -> 'variables') -> 2) ->> 'key' || ',' || (((x -> 'variables') -> 2) ->> 'value') || ',' || (((x -> 'variables') -> 2) ->> 'editable') from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'visit_confirmation'), 'visit_time,Sat 14 Nov, 11:00 AM,false', 'E3 the third variable is the visit time, not editable');
select is(pg_temp.send('m3', 'c7') like '{%', true, 'E4 it can be sent');
select is(pg_temp.ctx('m3', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'visit_confirmation', 'E5 and the sender names that template');
select is(pg_temp.ctx('m3', '2026-11-15T14:00:00+05:30') -> 'template' -> 'variables' ->> 2, 'Sat 14 Nov, 11:00 AM', 'E6 with the visit time as the third value');
-- a reminder message of the visit gets the reminder template, a confirmation the confirmation template (not the first of the purpose)
select pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Reminder for your visit.', 'en', 'visit', 'system')::text$q$, tests.rid('m4'), tests.tid('a'), pg_temp.lead()));
update public.store_visits set reminder_message_id = tests.rid('m4') where id = tests.rid('v1');
select is(pg_temp.ctx('m4', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'visit_reminder', 'E7 a visit''s reminder message is sent with the reminder template');
select pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Confirmation of your visit.', 'en', 'visit', 'system')::text$q$, tests.rid('m5'), tests.tid('a'), pg_temp.lead()));
update public.store_visits set confirmation_message_id = tests.rid('m5') where id = tests.rid('v1');
select is(pg_temp.ctx('m5', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'visit_confirmation', 'E8 ... and its confirmation with the confirmation template');
update public.store_visits set reminder_message_id = null, confirmation_message_id = null where id = tests.rid('v1');
select pg_temp.pin('2026-11-20T14:00:00+05:30');   -- the visit is behind us
select is(pg_temp.ctx('m4', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', null, 'E9 with no visit behind it a template that needs a visit''s time is never sent with a blank');

-- F. "Continue the chat" (migration 20261231984400): {{3}} is what the customer asked about, else a fallback; never blank, never typed
select pg_temp.mk('c9', 'continue_chat', 'en', 'utility', 'followup', 'Hi {{1}}, you contacted {{2}} about {{3}}. Reply here if you would like to continue.');
select is((select x ->> 'preview' from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'continue_chat'), 'Hi Kavitha, you contacted ' || (select name from public.tenants where id = tests.tid('a')) || ' about our products. Reply here if you would like to continue.', 'F1 offered with the fallback "our products" when the profile has no need');
update public.lead_profiles set need = 'Kanjivaram sarees' where lead_id = pg_temp.lead()::uuid;
select is((select x ->> 'preview' from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'continue_chat'), 'Hi Kavitha, you contacted ' || (select name from public.tenants where id = tests.tid('a')) || ' about Kanjivaram sarees. Reply here if you would like to continue.', 'F2 with a short clean need it says what they asked about');
select is((select ((x -> 'variables') -> 2) ->> 'key' || ',' || (((x -> 'variables') -> 2) ->> 'value') || ',' || (((x -> 'variables') -> 2) ->> 'editable') from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'continue_chat'), 'asked_about,Kanjivaram sarees,false', 'F3 the value is shown and cannot be edited');
update public.lead_profiles set need = 'sarees under Rs 500 for the wedding, please send the link http://x.test' where lead_id = pg_temp.lead()::uuid;
select is((select x ->> 'preview' from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'continue_chat') like '%about our products.%', true, 'F4 a need that is long, has a price or a link is not put in a template: the fallback is');
update public.lead_profiles set need = 'Kanjivaram sarees' where lead_id = pg_temp.lead()::uuid;
select is(pg_temp.send('m4', 'c9') like '{%', true, 'F5 it can be sent from the chat');
select is((select body from public.outbox_messages where id = tests.rid('m4')) like '%about Kanjivaram sarees.%', true, 'F6 the message that goes out has the filled words');
select is(pg_temp.ctx('m4', '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'continue_chat', 'F7 the sender names continue_chat (found by its words)');
select is(pg_temp.ctx('m4', '2026-11-15T14:00:00+05:30') -> 'template' -> 'variables' ->> 2, 'Kanjivaram sarees', 'F8 with what they asked about as the third value');
select is((select category from public.outbox_messages where id = tests.rid('m4')), 'followup', 'F9 it is a follow-up: quiet hours apply (no exemption for an active conversation)');
select pg_temp.mk('c10', 'continue_chat', 'te', 'utility', 'followup', 'నమస్కారం {{1}} గారు! మీరు {{3}} గురించి {{2}} ని అడిగారు. కొనసాగించాలంటే ఇక్కడే reply ఇవ్వండి.');
update public.lead_profiles set language = 'te', need = null where lead_id = pg_temp.lead()::uuid;
select is((select x ->> 'preview' from jsonb_array_elements(pg_temp.list()) x where x ->> 'name' = 'continue_chat') like '%మా products%', true, 'F10 in Telugu the fallback is "మా products"');

select * from finish();
rollback;
