-- Job OR (migration 20261224130000): a WhatsApp lead's profile is read from what the customer wrote on WhatsApp.
--   A the words of a lead   B the Lead Desk shape and the list to guess   C a new message re-opens a rules-only guess   D roles
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.ch(p_sql text) returns text language sql as $$ select pg_temp.sc('x6', p_sql) $$;
-- each message gets its own minute (messages do have distinct times; equal ones would be ordered by id)
create function pg_temp.inb(p_wamid text, p_from text, p_text text default 'Hello', p_name text default 'Ravi Kumar', p_kind text default 'text') returns text language sql as $$
  select pg_temp.ch(format($q$select public.wa_ingest_inbound('100000000000001', %L, %L, %L, %L, %L, now() - make_interval(mins => 100 - %s), %L, 1, false)$q$, p_wamid, p_from, p_name, p_kind, p_text, substr(p_wamid, 8)::int * 10, pg_temp.h(p_from))) $$;

select app.operator_register_channel_agent('X6@test.local');
select is(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a'))) like 'ERR:%', false, 'setup: the business has its WhatsApp number');

select is(pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')))::jsonb ->> 'status', 'active', 'setup: and it is switched on');
create temp table orw as select pg_temp.inb('wamid.W1', '0091234567801', 'Hi', 'Gowtham Reddy')::jsonb as r;
select is((select r ->> 'outcome' from orw), 'stored', 'setup: a first message from a new number is stored');
create function pg_temp.lead() returns uuid language sql as $$ select (r ->> 'lead_id')::uuid from orw $$;
create function pg_temp.words() returns text language sql as $$ select app.lead_words(tests.tid('a'), pg_temp.lead()) $$;
create function pg_temp.desk(p_user text default 'a_owner') returns jsonb language sql as $$
  select pg_temp.sc(p_user, format($q$select public.lead_desk_get(%L, %L)::text$q$, tests.tid('a'), pg_temp.lead()))::jsonb $$;

-- A. the words of a lead
select is(pg_temp.words(), 'Hi', 'A1: a WhatsApp lead''s words are what the customer wrote');
select is(pg_temp.inb('wamid.W2', '0091234567801', 'paver blocks for 2000 sq ft', 'Gowtham Reddy')::jsonb ->> 'outcome', 'stored', 'A2: a second message is stored');
select is(pg_temp.words(), E'Hi\npaver blocks for 2000 sq ft', 'A3: the words are the first messages, oldest first');
select is(pg_temp.inb('wamid.W3', '0091234567801', null, 'Gowtham Reddy', 'image')::jsonb ->> 'outcome', 'stored', 'A4: a photo is stored as a placeholder');
select is(pg_temp.words(), E'Hi\npaver blocks for 2000 sq ft', 'A5: ...and a placeholder such as "[image]" is not part of the words');
select is((select count(*) from public.enquiries where lead_id = pg_temp.lead() and channel = 'whatsapp')::int, 3, 'A6: all three are enquiries');
select is((select length(pg_temp.words())) <= 1000, true, 'A7: the words are cut at 1,000 characters');
select is(app.lead_words(tests.tid('b'), pg_temp.lead()), null, 'A8: another workspace gets nothing for this lead');
select is(app.lead_words(tests.tid('a'), tests.rid('nobody')), null, 'A9: a lead with no words has none');

-- B. the shape and the list
select is(pg_temp.desk() -> 'profile' ->> 'original_text', E'Hi\npaver blocks for 2000 sq ft', 'B1: the Lead Desk shows the customer''s words as the original text');
select is(pg_temp.desk('a_viewer') -> 'profile' ->> 'original_text', null, 'B2: a Viewer still sees no text');
select is(pg_temp.desk() ->> 'needs_profile', 'true', 'B3: nobody has guessed its profile yet');
select is((pg_temp.sc('a_owner', format($q$select public.lead_profile_unseeded(%L)::text$q$, tests.tid('a')) ) like 'ERR:%'), true, 'B4: (the call needs its limit argument)');
select is((pg_temp.sc('a_owner', format($q$select public.lead_profile_unseeded(%L, 50)::text$q$, tests.tid('a')))::jsonb @> jsonb_build_array(jsonb_build_object('lead_id', pg_temp.lead(), 'source', 'whatsapp', 'text', E'Hi\npaver blocks for 2000 sq ft'))), true, 'B5: the list of leads to guess carries the same words');

-- C. a new message re-opens a rules-only guess, nothing else
select is(pg_temp.sc('a_owner', format($q$select public.lead_profile_seed(%L, %L::jsonb)$q$, tests.tid('a'), jsonb_build_array(jsonb_build_object('lead_id', pg_temp.lead(), 'fields', '{"quantity":"2000 sq ft"}'::jsonb, 'confidence', '{"quantity":"medium"}'::jsonb, 'junk', null))::text)), '1', 'C1: the rules'' guess is stored');
select is(pg_temp.desk() ->> 'needs_profile', 'false', 'C2: it is guessed now');
select is(pg_temp.inb('wamid.W4', '0091234567801', 'delivery to Hindupur')::jsonb ->> 'outcome', 'stored', 'C3: a new message arrives');
select is(pg_temp.desk() ->> 'needs_profile', 'true', 'C4: the rules'' guess is open again');
update public.lead_profiles set normalised_by = 'ai', normalised_at = now() where lead_id = pg_temp.lead();
select is(pg_temp.inb('wamid.W5', '0091234567801', 'and 500 bricks')::jsonb ->> 'outcome', 'stored', 'C5: another message arrives');
select is(pg_temp.desk() ->> 'needs_profile', 'false', 'C6: an AI guess is not thrown away by it');

-- D. a message with a phone number or an e-mail address in it is received, without those details
select is(pg_temp.inb('wamid.W6', '0091234567801', 'paver blocks, call me on 98765 43210 tomorrow')::jsonb ->> 'outcome', 'stored', 'D1: a message with a phone number in it is received (it used to fail and be lost)');
select is((select body from public.enquiries where lead_id = pg_temp.lead() and body like 'paver blocks, call me%'), 'paver blocks, call me on tomorrow', 'D2: the number is taken out of the words, the rest is kept');
select is(pg_temp.inb('wamid.W7', '0091234567801', 'mail me at buyer@example.test please')::jsonb ->> 'outcome', 'stored', 'D3: so is one with an e-mail address');
select is((select body from public.enquiries where lead_id = pg_temp.lead() and body like 'mail me at%'), 'mail me at please', 'D4: ...without it');
select is(pg_temp.inb('wamid.W8', '0091234567801', '9876543210')::jsonb ->> 'outcome', 'stored', 'D5: a message that is only a number is received');
select is((select count(*) from public.enquiries where lead_id = pg_temp.lead() and body = '[message not shown]')::int, 1, 'D6: ...and has no text to show');
select is((select count(*) from public.enquiries where lead_id = pg_temp.lead() and (body ~ '[0-9]{6}' or body ~ '@'))::int, 0, 'D7: no number or address is kept in any enquiry');
select is(pg_temp.inb('wamid.W9', '0091234567801', 'we need 2000 sq ft and 500 bricks')::jsonb ->> 'outcome', 'stored', 'D8: ordinary quantities are not mistaken for a phone number');
select is((select body from public.enquiries where lead_id = pg_temp.lead() and body like 'we need%'), 'we need 2000 sq ft and 500 bricks', 'D9: ...and stay in the words');
select * from finish();
rollback;
