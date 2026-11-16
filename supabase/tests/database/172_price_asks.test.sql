-- Migration 20261231974000: "Price asked: <item>" (owner 15 Nov 2026).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.rec(p_user text, p_tenant text, p_item text, p_source text default 'assistant', p_lead text default null) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.price_ask_record(%L, %L, %L, %s)::text$q$, tests.tid(p_tenant), p_item, p_source, case when p_lead is null then 'null' else format('%L::uuid', p_lead) end)) $$;

select is(pg_temp.rec('a_owner', 'a', 'Dharmavaram silk saree') ~ '^[0-9a-f-]{36}$', true, 'A1 the Owner writes a question down');
select is(pg_temp.rec('a_sales', 'a', 'Kanchipuram saree x 10') ~ '^[0-9a-f-]{36}$', true, 'A2 so does a Sales person');
select is(pg_temp.rec('a_viewer', 'a', 'x question'), 'ERR:42501', 'A3 DENY: a Viewer');
select is(pg_temp.rec('b_owner', 'a', 'x question'), 'ERR:42501', 'A4 DENY: another business''s Owner');
select is(pg_temp.rec('anon', 'a', 'x question'), 'ERR:42501', 'A5 DENY: anon');
select is(pg_temp.rec('a_owner', 'a', 'x', 'assistant'), 'ERR:22023', 'A6 too short is refused');
select is(pg_temp.rec('a_owner', 'a', 'a price', 'telepathy'), 'ERR:22023', 'A7 an unknown source is refused');
select is((select count(*)::int from public.price_asks where tenant_id = tests.tid('a')), 2, 'A8 only the two good ones are stored');

select is(pg_temp.rec('a_owner', 'a', 'Dharmavaram  silk saree') = pg_temp.rec('a_owner', 'a', 'Dharmavaram silk saree'), true, 'B1 the same words within 10 minutes (spaces folded) are the same question');
select is((select count(*)::int from public.price_asks where tenant_id = tests.tid('a')), 2, 'B2 no second row');
select is(pg_temp.rec('a_owner', 'a', 'A rate', 'call', '00000000-0000-4000-8000-000000000001'), 'ERR:23503', 'B3 a lead that is not this business''s is refused');

select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.price_ask_list(%L))::text$q$, tests.tid('a'))), '2', 'C1 the open list shows both');
select is(pg_temp.val('a_viewer', format($q$select public.price_ask_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C2 DENY: a Viewer reads nothing');
select is(pg_temp.val('b_owner', format($q$select public.price_ask_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C3 DENY: another business');
select is(pg_temp.val('a_sales', format($q$select public.price_ask_answer(%L, %L)::text$q$, tests.tid('a'), (select id from public.price_asks where tenant_id = tests.tid('a') order by asked_at limit 1))), 'true', 'C4 a Sales person marks one answered');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.price_ask_list(%L))::text$q$, tests.tid('a'))), '1', 'C5 the open list is one shorter');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.price_ask_list(%L, false))::text$q$, tests.tid('a'))), '2', 'C6 the whole list still has both');
select is(pg_temp.val('a_owner', format($q$select public.price_ask_answer(%L, '00000000-0000-4000-8000-000000000009')::text$q$, tests.tid('a'))), 'ERR:23503', 'C7 an id that does not exist');
select is(pg_temp.val('a_owner', format($q$select public.price_ask_answer(%L, %L)::text$q$, tests.tid('b'), (select id from public.price_asks where tenant_id = tests.tid('a') limit 1))), 'ERR:42501', 'C8 DENY: another business''s id through the wrong tenant');
select is((select count(*)::int from public.audit_events where entity_type = 'price_ask' and tenant_id = tests.tid('a')) >= 3, true, 'D1 every change is an audit row');
select is(pg_temp.val('a_owner', $q$update public.price_asks set item = 'edited'$q$), 'ERR:42501', 'D2 nobody edits a row directly');

select * from finish();
rollback;
