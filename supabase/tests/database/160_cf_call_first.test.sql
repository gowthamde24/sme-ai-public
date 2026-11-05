-- CALL FIRST (migration 20261231140000; owner, 5 Nov 2026): a new lead is called; WhatsApp only when the customer asks or agrees on the call (captured.whatsapp); retries by kind from the call settings
-- or the pack; never an automatic WhatsApp after the last unanswered call. The clock is pinned: Monday 2 November 2026, 11:00 India time.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30'::timestamptz);
select app.operator_register_scheduler('x5@test.local');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;

select tests.cn_guards_off();
select tests.open_gate('a');
insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Call First Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, phone_consent, whatsapp_consent) values
  (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran One', '+91 98111 00001', 'granted', 'granted'),
  (tests.rid('k2'), tests.tid('a'), tests.rid('co'), 'Kiran Two', '+91 98111 00002', 'granted', 'granted'),
  (tests.rid('k3'), tests.tid('a'), tests.rid('co'), 'Kiran Three', '+91 98111 00003', 'granted', 'granted'),
  (tests.rid('k4'), tests.tid('a'), tests.rid('co'), 'Kiran Four', '+91 98111 00004', 'granted', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id) select tests.rid('l' || right(k, 1)), tests.tid('a'), tests.rid('co'), tests.rid(k) from unnest(array['k1', 'k2', 'k3', 'k4']) k;

-- a batch with a message (channel both): the person is CALLED first
create function pg_temp.mk(p_batch text, p_contact text, p_channel text default 'both') returns uuid language plpgsql as $$
declare
  v_id uuid := tests.rid(p_batch);
begin
  insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, status, plan_sha256, created_by, approved_by, approved_at, message_text)
  values (v_id, tests.tid('a'), 'cf ' || p_batch, 'general', p_channel, 'en', 'running', repeat('a', 64), tests.uid('a_owner'), tests.uid('a_owner'), now(), 'Namaste {name}, here are the details.');
  insert into public.outreach_items (tenant_id, batch_id, contact_id, lead_id, status, next_action, next_at)
  select tests.tid('a'), v_id, c.id, (select l.id from public.leads l where l.contact_id = c.id limit 1), 'waiting', 'call', now() from public.contacts c where c.id = tests.rid(p_contact);
  return (select id from public.outreach_items where batch_id = v_id);
end $$;
create function pg_temp.res(p_item uuid, p_result text, p_outcome text default 'null') returns text language sql as $$
  select pg_temp.val('x5', format($q$select public.outreach_item_result(%L, %L, %L, %L::jsonb, 1, false)::text$q$, tests.tid('a'), p_item, p_result, p_outcome)) $$;

-- A. the first step
select is((select next_action from app.outreach_first_batch_step(tests.tid('a'), 'both', now())), 'call', 'A1 a batch with WhatsApp and calls: the CALL comes first');
select is((select then_action from app.outreach_first_batch_step(tests.tid('a'), 'both', now())), null, 'A2 ... and no WhatsApp is planned behind it');
select is((select next_action from app.outreach_first_batch_step(tests.tid('a'), 'whatsapp', now())), 'whatsapp', 'A3 the Owner''s own message campaign to a list stays a message');
select throws_ok($$insert into public.outreach_rules (id, tenant_id, source, action, within_minutes, goal, channel, language, approved_by)
                   values (gen_random_uuid(), tests.tid('a'), 'meta_lead_ads', 'whatsapp_first', 2, 'qualify', 'both', 'en', tests.uid('a_owner'))$$, '22023', null, 'A4 a WhatsApp-first rule is refused');
select throws_ok($$insert into public.outreach_rules (id, tenant_id, source, action, within_minutes, goal, channel, language, approved_by)
                   values (gen_random_uuid(), tests.tid('a'), 'website_form', 'call_within_minutes', 2, 'qualify', 'whatsapp', 'en', tests.uid('a_owner'))$$, '22023', null, 'A5 so is a message-only rule for new leads');

-- B. WhatsApp only on the customer's request
select is(pg_temp.j(pg_temp.res(pg_temp.mk('b1', 'k1'), 'connected', '{"outcome": "positive", "category": "interested", "captured": {"whatsapp": "asked", "product": "silk sarees"}}'), 'whatsapp'), 'asked',
          'B1 interested and "send me the photos on WhatsApp": the message goes now');
select is((select next_action from public.outreach_items where batch_id = tests.rid('b1')), 'whatsapp', 'B2 the next step is the WhatsApp message');
select is((select count(*)::int from public.outreach_handoffs where contact_id = tests.rid('k1')), 1, 'B3 and a person is handed the hot lead as before');
select is(pg_temp.j(pg_temp.res(pg_temp.mk('b2', 'k2'), 'connected', '{"outcome": "positive", "category": "interested"}'), 'reason'), 'interested', 'B4 interested, WhatsApp not asked: no message, the person takes over');
select is(pg_temp.res(pg_temp.mk('b3', 'k3'), 'connected', '{"outcome": "unclear", "category": "call_back_later", "callback_at": "2026-11-02T17:00:00+05:30", "captured": {"whatsapp": "agreed"}}')::jsonb ->> 'status', 'waiting',
          'B5 "can''t talk now, WhatsApp me": waits');
select is((select next_action || '>' || then_action || '@' || then_at::text from public.outreach_items where batch_id = tests.rid('b3')), 'whatsapp>call@' || '2026-11-02T17:00:00+05:30'::timestamptz::text,
          'B6 ... the WhatsApp now, the call at the agreed time');
select is(pg_temp.res(pg_temp.mk('b4', 'k4'), 'connected', '{"outcome": "positive", "category": "interested", "captured": {"whatsapp": "maybe"}}')::jsonb ->> 'reason', 'interested', 'B7 any other word is not a yes');

-- C. retries by kind, and never an automatic WhatsApp
select is(pg_temp.j(pg_temp.res(pg_temp.mk('c1', 'k2', 'both'), 'busy'), 'status'), 'waiting', 'C1 busy: tried again');
select is((select next_at from public.outreach_items where batch_id = tests.rid('c1')), app.outreach_slot(tests.tid('a'), '2026-11-02T11:30:00+05:30'::timestamptz), 'C2 ... after the pack''s busy gap (30 minutes)');
select pg_temp.res((select id from public.outreach_items where batch_id = tests.rid('c1')), 'busy');
select is(pg_temp.j(pg_temp.res((select id from public.outreach_items where batch_id = tests.rid('c1')), 'busy'), 'reason'), 'attempts_used', 'C3 busy a third time: stop (the pack allows two retries)');
select is((select count(*)::int from public.outreach_attempts where item_id = (select id from public.outreach_items where batch_id = tests.rid('c1')) and channel = 'whatsapp'), 0, 'C4 and no WhatsApp went');
insert into public.call_settings (tenant_id, settings, updated_by) values (tests.tid('a'), '{"retry_busy": {"count": 0, "gap_minutes": 30}}', tests.uid('a_owner'))
  on conflict (tenant_id) where campaign_id is null do update set settings = excluded.settings;
select is(pg_temp.j(pg_temp.res(pg_temp.mk('c2', 'k3', 'call'), 'busy'), 'reason'), 'attempts_used', 'C5 the workspace''s own call settings win: no busy retry');
select is((app.outreach_retry(tests.tid('a'), 'retry_no_answer') ->> 'gap_minutes'), '120', 'C6 a setting the workspace has not saved: the pack''s default');

-- D. a school: fewer retries, wider apart
update packs.workspace_pack set pack_code = 'education' where tenant_id = tests.tid('b');
select is((app.outreach_retry(tests.tid('b'), 'retry_no_answer'))::text, '{"count": 2, "gap_minutes": 180}', 'D1 a school: two no-answer retries, three hours apart');

select * from finish();
rollback;
