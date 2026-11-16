-- Chat promises (migration 20261231978500; owner, 16 Nov 2026): a promise the assistant makes in a customer's chat is written down at once (price_asks, with the day the customer named), one open item per customer and kind;
-- the product the customer asks about goes on the profile; only the registered worker may write any of it.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-12T14:00:00+05:30');   -- a Thursday
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
select app.operator_register_channel_agent('x6@test.local');
select app.operator_register_scheduler('x5@test.local');
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
create function pg_temp.inb(p_wamid text, p_from text, p_text text) returns jsonb language sql as $$
  select to_jsonb(pg_temp.sc('x6', format($q$select public.wa_ingest_inbound('100000000000001', %L, %L, 'Kavitha Gowda', 'text', %L, '2026-11-12T14:00:00+05:30', %L, 1, false)::text$q$, p_wamid, p_from, p_text, pg_temp.h(p_from)))) $$;
create function pg_temp.note(p_enq text, p_promise boolean, p_kind text, p_item text, p_by text, p_product text, p_user text default 'x5') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.scheduler_auto_reply_note(%L, %L, %L, %L, %L, %L)::text$q$, p_enq, p_promise, p_kind, p_item, p_by, p_product)) $$;
create temp table cp as select (pg_temp.inb('wamid.K1', '0091234567821', 'Semi silk tissue sarees price? Need it for Sunday') #>> '{}') as t;
create function pg_temp.enq() returns text language sql as $$ select (t::jsonb ->> 'enquiry_id') from cp $$;
create function pg_temp.lead() returns uuid language sql as $$ select (t::jsonb ->> 'lead_id')::uuid from cp $$;

-- A. who may write
select is(pg_temp.note(pg_temp.enq(), true, 'price', 'Semi silk tissue', '2026-11-15', 'Semi silk tissue', 'a_owner'), 'ERR:42501', 'A1 an Owner cannot call the worker''s function');
select is(pg_temp.note(pg_temp.enq(), true, 'price', 'Semi silk tissue', '2026-11-15', 'Semi silk tissue', 'x6'), 'ERR:42501', 'A2 nor the channel account');

-- B. a promise on a price question is written down at once, with the day the customer named
select is((pg_temp.note(pg_temp.enq(), true, 'price', 'Semi silk tissue', '2026-11-15', 'Semi silk tissue')::jsonb) ->> 'outcome', 'recorded', 'B1 the promise is recorded');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead() and answered_at is null), 1::bigint, 'B2 ... as one open item');
select is((select item || '|' || kind || '|' || source || '|' || needed_by::text from public.price_asks where lead_id = pg_temp.lead()), 'Semi silk tissue|price|whatsapp|2026-11-15', 'B3 with the product, the kind, where, and the Sunday the customer named');
select is((select contact_id is not null from public.price_asks where lead_id = pg_temp.lead()), true, 'B4 and the customer');
select is((select product from public.lead_profiles where lead_id = pg_temp.lead()), 'Semi silk tissue', 'B5 the profile carries the product');
select is((select need from public.lead_profiles where lead_id = pg_temp.lead()), null, 'B6 ... and the customer''s own words are not touched (need is not written here)');
select is((pg_temp.sc('a_owner', format($q$select public.price_ask_list(%L, true, 20)::text$q$, tests.tid('a')))::jsonb) -> 0 ->> 'kind', 'price', 'B7 the owner''s Today list says what kind it is');
select is((pg_temp.sc('a_owner', format($q$select public.price_ask_list(%L, true, 20)::text$q$, tests.tid('a')))::jsonb) -> 0 ->> 'needed_by', '2026-11-15', 'B8 ... and by when');

-- C. the customer asks again: the same open item, never a second one
select is((pg_temp.note(pg_temp.enq(), true, 'price', 'Semi silk tissue sarees', null, 'Semi silk tissue')::jsonb) ->> 'outcome', 'updated', 'C1 a second promise on the same customer updates the open item');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead()), 1::bigint, 'C2 ... there is still one');
select is((select needed_by::text from public.price_asks where lead_id = pg_temp.lead()), '2026-11-15', 'C3 ... and a promise without a deadline keeps the deadline');
select is((pg_temp.note(pg_temp.enq(), false, null, null, '2026-11-16', null)::jsonb) ->> 'outcome', 'deadline', 'C4 a later deadline without a new promise moves the deadline');
select is((select needed_by::text from public.price_asks where lead_id = pg_temp.lead()), '2026-11-16', 'C5 ... on the open item');
select is((pg_temp.note(pg_temp.enq(), true, 'follow_up', 'Dye samples', null, null)::jsonb) ->> 'outcome', 'recorded', 'C6 another kind of promise is its own item');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead() and answered_at is null), 2::bigint, 'C7 two open items');
select pg_temp.sc('a_owner', format($q$select public.price_ask_answer(%L, %L)$q$, tests.tid('a'), (select id from public.price_asks where lead_id = pg_temp.lead() and kind = 'price')));
select is((pg_temp.note(pg_temp.enq(), true, 'price', 'Pure silk', null, null)::jsonb) ->> 'outcome', 'recorded', 'C8 once the shop answered, a new promise is a new item');

-- D. what is refused or left out
select is(pg_temp.note(pg_temp.enq(), true, 'price', 'x', null, null), 'ERR:22023', 'D2 a promise needs an item of at least two characters');
select is(pg_temp.note(pg_temp.enq(), true, 'money', 'Silk', null, null), 'ERR:22023', 'D3 the kind is a closed word');
select is((pg_temp.note(pg_temp.enq(), false, null, null, '2020-01-01', null)::jsonb) ->> 'outcome', 'nothing', 'D4 a deadline long past is ignored');
select is((pg_temp.note(pg_temp.enq(), false, null, null, '2026-11-10', null)::jsonb) ->> 'outcome', 'deadline', 'D4b a deadline two days behind us is kept (an old promise written down late is overdue, which is more urgent)');
select is((pg_temp.note(pg_temp.enq(), false, null, null, '2027-06-01', null)::jsonb) ->> 'outcome', 'nothing', 'D5 ... and one more than 120 days away');
select is((pg_temp.note(pg_temp.enq(), false, null, null, null, 'call 9876543210 now')::jsonb) ->> 'outcome', 'nothing', 'D6 a product with a phone number in it is left out');
select is((select product from public.lead_profiles where lead_id = pg_temp.lead()), 'Semi silk tissue', 'D7 ... and the product stays as it was');
select is((pg_temp.note(gen_random_uuid()::text, true, 'price', 'Silk', null, null)::jsonb) ->> 'outcome', 'not_found', 'D8 an unknown message says so');
update public.lead_profiles set fixed = array['product'] where lead_id = pg_temp.lead();
select is((pg_temp.note(pg_temp.enq(), false, null, null, null, 'Kanchi silk')::jsonb) ->> 'outcome', 'nothing', 'D9 a field the owner fixed is never overwritten');
update public.lead_profiles set fixed = '{}' where lead_id = pg_temp.lead();
select is((pg_temp.note(pg_temp.enq(), false, null, null, null, 'Kanchi silk')::jsonb) ->> 'outcome', 'product', 'D10 an unfixed product follows the customer''s latest words');

-- E. the card and the audit
select is((select (app.lead_desk_json(l, p, c, tests.uid('a_owner'), true) -> 'profile' ->> 'product') from public.leads l join public.lead_profiles p on p.lead_id = l.id join public.contacts c on c.id = l.contact_id where l.id = pg_temp.lead()), 'Kanchi silk', 'E1 the lead card''s profile has `product`');
select is((select count(*) from public.audit_events where entity_type = 'lead_profile' and entity_id is not null and (new_values::text like '%Kanchi%' or old_values::text like '%Kanchi%')), 0::bigint, 'E2 the product is never in the audit trail (it is the customer''s own word)');
select is((select count(*) from erasure.registry where table_name = 'lead_profiles' and column_name = 'product'), 2::bigint, 'E3 it leaves with the workspace and is swept when a person is forgotten');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead() and kind = 'follow_up' and source = 'whatsapp'), 1::bigint, 'E4 the follow-up promise is a WhatsApp one');

select * from finish();
rollback;
