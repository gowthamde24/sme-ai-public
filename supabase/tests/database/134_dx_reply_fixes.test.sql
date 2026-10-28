-- Job DX (28 Oct 2026): two fixes to the send policy, found in the first real WhatsApp round trip.
--   A quiet hours do not hold a reply inside an active conversation (made, approved, released)   B the AI line labels only what the assistant wrote
-- THE CLOCK is pinned (app.outbox_now) to Monday 2026-10-05 23:30 IST, inside quiet hours (21:00 to 09:00).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select app.operator_set_outbox(true);

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.mk(p_label text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:bb')$q$, tests.tid(p_tenant), tests.rid(p_label || '_c')));
  end if;
end $$;
create function pg_temp.inbound(p_lead text, p_at text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, created_via)
  values (gen_random_uuid(), tests.tid(p_tenant), tests.rid(p_lead), 'whatsapp', p_at::timestamptz, 'Is the green saree in stock?', 'agent');
end $$;
create function pg_temp.sub(p_msg text, p_lead text, p_source text, p_cat text, p_text text default 'It is in stock, sir.') returns text language sql as $$
  select pg_temp.sc('a_sales', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, 'en', %L, %L, false, false, '{}'::uuid[], false, null)$q$,
                                      tests.rid(p_msg), tests.tid('a'), tests.rid(p_lead), p_text, p_cat, p_source)) $$;
create function pg_temp.st(p_msg text) returns text language sql as $$ select status || '/' || reason from public.outbox_messages where id = tests.rid(p_msg) $$;
create function pg_temp.at(p_msg text) returns text language sql as $$
  select coalesce(to_char(scheduled_for at time zone 'Asia/Kolkata', 'MM-DD HH24:MI'), '-') from public.outbox_messages where id = tests.rid(p_msg) $$;
create function pg_temp.auto(p_on boolean) returns text language sql as $$
  select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, %s, 5)::text', tests.tid('a'), p_on::text)) $$;

select pg_temp.pin(timestamptz '2026-10-05 23:30:00+05:30');
select ok(pg_temp.auto(true) not like 'ERR:%', 'setup: automatic sending is on for business a');
select pg_temp.mk('dx1');
select pg_temp.mk('dx2');
select pg_temp.mk('dx3');
select pg_temp.mk('dx4');
select pg_temp.mk('dx5');
select pg_temp.mk('dx6');

-- A. quiet hours
select pg_temp.inbound('dx1', '2026-10-05 23:10:00+05:30');   -- 20 minutes ago: an active conversation
select pg_temp.inbound('dx2', '2026-10-05 22:50:00+05:30');   -- 40 minutes ago: not any more
select pg_temp.inbound('dx3', '2026-10-05 23:20:00+05:30');
select is(app.outbox_active_conversation(tests.tid('a'), tests.rid('dx1'), 'reply_to_inbound', timestamptz '2026-10-05 23:30:00+05:30'), true, 'A1: 20 minutes after the customer wrote, a reply is inside the conversation');
select is(app.outbox_active_conversation(tests.tid('a'), tests.rid('dx1'), 'reply_to_inbound', timestamptz '2026-10-05 23:40:00+05:30'), true, 'A2: exactly 30 minutes after counts');
select is(app.outbox_active_conversation(tests.tid('a'), tests.rid('dx1'), 'reply_to_inbound', timestamptz '2026-10-05 23:41:00+05:30'), false, 'A3: 31 minutes after: no longer');
select is(app.outbox_active_conversation(tests.tid('a'), tests.rid('dx2'), 'reply_to_inbound', timestamptz '2026-10-05 23:30:00+05:30'), false, 'A4: 40 minutes after: not active');
select is(app.outbox_active_conversation(tests.tid('a'), tests.rid('dx3'), 'followup', timestamptz '2026-10-05 23:30:00+05:30'), false, 'A5: a follow-up is business-initiated, whatever the customer wrote a minute ago');
select is(app.outbox_active_conversation(tests.tid('a'), tests.rid('dx4'), 'reply_to_inbound', timestamptz '2026-10-05 23:30:00+05:30'), false, 'A6: a customer who never wrote: no conversation');
select is(app.outbox_active_conversation(tests.tid('b'), tests.rid('dx1'), 'reply_to_inbound', timestamptz '2026-10-05 23:30:00+05:30'), false, 'A7: another business cannot see our customer''s conversation');

select pg_temp.sub('dx_m1', 'dx1', 'owner', 'reply_to_inbound');
select is(pg_temp.st('dx_m1'), 'queued/auto_allowed', 'A8: AT NIGHT, a reply in an active conversation goes now (not held for the morning)');
select is(pg_temp.at('dx_m1'), '10-05 23:30', 'A9: ...scheduled for this very minute');
select pg_temp.sub('dx_m2', 'dx2', 'owner', 'reply_to_inbound');
select is(pg_temp.st('dx_m2'), 'queued/quiet_hours', 'A10: the same reply 40 minutes after the customer wrote waits for morning');
select is(pg_temp.at('dx_m2'), '10-06 09:00', 'A11: ...until 09:00');
select pg_temp.sub('dx_m3', 'dx3', 'assistant', 'followup', 'Just checking in on the saree.');
select is(pg_temp.st('dx_m3'), 'queued/quiet_hours', 'A12: a follow-up waits for morning even a minute after the customer wrote');
select pg_temp.sub('dx_m4', 'dx1', 'assistant', 'info', 'We open at nine.');
select is(pg_temp.st('dx_m4'), 'queued/auto_allowed', 'A13: an information reply inside the conversation goes now too');

-- the Owner's approval (automatic sending off: the reply waits for a person, then the person approves)
select ok(pg_temp.auto(false) not like 'ERR:%', 'setup: automatic sending off');
select pg_temp.inbound('dx5', '2026-10-05 23:15:00+05:30');
select pg_temp.inbound('dx6', '2026-10-05 22:00:00+05:30');
select pg_temp.sub('dx_m5', 'dx5', 'owner', 'reply_to_inbound', 'done');
select pg_temp.sub('dx_m6', 'dx6', 'owner', 'reply_to_inbound', 'done too');
select is(pg_temp.st('dx_m5'), 'needs_approval/auto_off', 'A14: with automatic sending off the reply waits for the Owner');
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('dx_m5')));
select pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('dx_m6')));
select is(pg_temp.st('dx_m5'), 'queued/owner_approved', 'A15: approved');
select is(pg_temp.at('dx_m5'), '10-05 23:30', 'A16: APPROVED AT NIGHT INSIDE THE CONVERSATION: it goes now');
select is(pg_temp.at('dx_m6'), '10-06 09:00', 'A17: approved at night, the customer wrote 90 minutes ago: it waits for 09:00');

-- the release (the worker's claim): a conversation reply is handed out at night, an old one is held
select pg_temp.pin(timestamptz '2026-10-05 23:36:00+05:30');
select is((select count(*)::int from jsonb_array_elements(app.outbox_claim_due_core(tests.tid('a'), 10, false)) e where e ->> 'id' = tests.rid('dx_m5')::text), 1, 'A18: the release hands out the approved conversation reply at night');
select is((select count(*)::int from jsonb_array_elements(app.outbox_claim_due_core(tests.tid('a'), 10, false)) e where e ->> 'id' = tests.rid('dx_m2')::text), 0, 'A19: and not the reply that waits for 09:00');
select is((select claimed_at is null from public.outbox_messages where id = tests.rid('dx_m6')), true, 'A20: the old approved one was not claimed');
select pg_temp.pin(timestamptz '2026-10-05 23:30:00+05:30');

-- B. the AI line
select pg_temp.mk('dx7');
select pg_temp.mk('dx8');
select pg_temp.mk('dx9');
select pg_temp.inbound('dx7', '2026-10-05 23:20:00+05:30');
select pg_temp.inbound('dx8', '2026-10-05 23:20:00+05:30');
select pg_temp.inbound('dx9', '2026-10-05 23:20:00+05:30');
select ok(pg_temp.auto(true) not like 'ERR:%', 'setup: automatic sending on again');
select pg_temp.sub('dx_h7', 'dx7', 'owner', 'reply_to_inbound', 'A person wrote this.');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('dx_h7')), false, 'B1: a reply a PERSON wrote (source owner) is not labelled');
select is((select body from public.outbox_messages where id = tests.rid('dx_h7')), 'A person wrote this.', 'B2: its words are exactly what the person typed: nothing appended');
select pg_temp.sub('dx_a8', 'dx8', 'assistant', 'reply_to_inbound', 'The assistant wrote this.');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('dx_a8')), true, 'B3: the first message the ASSISTANT wrote to a customer is labelled');
select pg_temp.sub('dx_s9', 'dx9', 'system', 'info', 'A system notice.');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('dx_s9')), false, 'B4: a system message is not an assistant message: no label');
select pg_temp.sub('dx_h8', 'dx8', 'owner', 'reply_to_inbound', 'Now a person writes to the same customer.');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('dx_h8')), false, 'B5: a person''s later message is not labelled either');

-- the Owner's setting: "mention that I am an AI assistant" off -> the assistant's messages are not labelled
insert into workspace.opening_settings (workspace_id, campaign_key, mention_ai, updated_by) values (tests.tid('a'), '00000000-0000-0000-0000-000000000000', false, tests.uid('a_owner'));
select pg_temp.mk('dx10');
select pg_temp.inbound('dx10', '2026-10-05 23:20:00+05:30');
select pg_temp.sub('dx_a10', 'dx10', 'assistant', 'reply_to_inbound', 'The assistant wrote this, setting off.');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('dx_a10')), false, 'B6: with the Owner''s switch off, the assistant''s message carries no label');
select is(app.outbox_mention_ai(tests.tid('a')), false, 'B7: the switch is read from the opening settings');
select is(app.outbox_mention_ai(tests.tid('b')), true, 'B8: and is on by default');

select * from finish();
rollback;
