-- Chat promises: a promise about the same thing the customer already asked is ONE open item, whichever kind it is (migration 20261231980000; owner's end-to-end test, 17 Nov 2026).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant);
end $fn$;
select pg_temp.pin('2026-11-12T10:00:00+05:30');
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql); exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
select app.operator_register_channel_agent('x6@test.local');
select app.operator_register_scheduler('x5@test.local');
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
create function pg_temp.inb(p_wamid text, p_from text, p_text text) returns jsonb language sql as $$
  select to_jsonb(pg_temp.sc('x6', format($q$select public.wa_ingest_inbound('100000000000001', %L, %L, 'Asha Test', 'text', %L, '2026-11-12T14:00:00+05:30', %L, 1, false)::text$q$, p_wamid, p_from, p_text, pg_temp.h(p_from)))) $$;
create function pg_temp.note(p_enq text, p_promise boolean, p_kind text, p_item text, p_by text, p_product text) returns text language sql as $$
  select pg_temp.sc('x5', format($q$select public.scheduler_auto_reply_note(%L, %L, %L, %L, %L, %L)::text$q$, p_enq, p_promise, p_kind, p_item, p_by, p_product)) $$;
create temp table c1 as select (pg_temp.inb('wamid.P1', '0091234567831', 'Hi, do you have bridal kanchipuram silk sarees? What is the price?') #>> '{}') as t;
create temp table c2 as select (pg_temp.inb('wamid.P2', '0091234567832', 'Hi, do you have bridal kanchipuram silk sarees? What is the price?') #>> '{}') as t;
create function pg_temp.enq(p text) returns text language sql as $$ select case p when 'c1' then (select (t::jsonb ->> 'enquiry_id') from c1) else (select (t::jsonb ->> 'enquiry_id') from c2) end $$;
create function pg_temp.lead(p text) returns uuid language sql as $$ select case p when 'c1' then (select (t::jsonb ->> 'lead_id') from c1) else (select (t::jsonb ->> 'lead_id') from c2) end::uuid $$;

-- A. the price is asked, then "need it Sunday": one item, with the deadline
select is((pg_temp.note(pg_temp.enq('c1'), true, 'price', 'Bridal Kanchipuram silk saree', null, 'Bridal Kanchipuram silk saree')::jsonb) ->> 'outcome', 'recorded', 'A1 the price question is written down');
select is((pg_temp.note(pg_temp.enq('c1'), true, 'follow_up', 'Bridal Kanchipuram silk saree', '2026-11-15', null)::jsonb) ->> 'outcome', 'updated', 'A2 the follow-up about the same saree updates it');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead('c1') and answered_at is null), 1::bigint, 'A3 ... there is one open item, not two');
select is((select kind from public.price_asks where lead_id = pg_temp.lead('c1') and answered_at is null), 'price', 'A4 ... it stays a price item');
select is((select needed_by::text from public.price_asks where lead_id = pg_temp.lead('c1') and answered_at is null), '2026-11-15', 'A5 ... and now carries the deadline');
select is((select item from public.price_asks where lead_id = pg_temp.lead('c1') and answered_at is null), 'Bridal Kanchipuram silk saree', 'A6 ... with its own words');

-- B. something else is still its own item
select is((pg_temp.note(pg_temp.enq('c1'), true, 'follow_up', 'Dye samples', null, null)::jsonb) ->> 'outcome', 'recorded', 'B1 a promise about something else is its own item');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead('c1') and answered_at is null), 2::bigint, 'B2 two open items');

-- C. the other way round: a follow-up first, then the price asked about the same thing
select is((pg_temp.note(pg_temp.enq('c2'), true, 'follow_up', 'Bridal Kanchipuram silk', null, null)::jsonb) ->> 'outcome', 'recorded', 'C1 a follow-up is written down');
select is((pg_temp.note(pg_temp.enq('c2'), true, 'price', 'Bridal Kanchipuram silk saree', '2026-11-14', null)::jsonb) ->> 'outcome', 'updated', 'C2 the price asked about the same thing (one holds the other) joins it');
select is((select count(*) from public.price_asks where lead_id = pg_temp.lead('c2') and answered_at is null), 1::bigint, 'C3 ... one open item');
select is((select kind from public.price_asks where lead_id = pg_temp.lead('c2') and answered_at is null), 'price', 'C4 ... and it is a price item (the more specific ask)');
select is((select needed_by::text from public.price_asks where lead_id = pg_temp.lead('c2') and answered_at is null), '2026-11-14', 'C5 ... with the deadline');

select * from finish();
rollback;
