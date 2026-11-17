-- The owner's Today list of 17 Nov 2026 (migration 20261231981500): open price asks and promises are counted in Today's number of things waiting (the sidebar badge is that same number); the voice-credits card is a billing notice.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');

create function pg_temp.pin(p_instant text) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant);
end $fn$;
select pg_temp.pin('2026-11-02T11:00:00+05:30');
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.val('outsider', p_sql) $$;
create function pg_temp.tid(p text) returns text language sql as $$ select quote_literal(tests.tid(p)) $$;
create function pg_temp.rid(p text) returns text language sql as $$ select quote_literal(tests.rid(p)) $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;


insert into public.companies (id, tenant_id, name) values (tests.rid('co'), tests.tid('a'), 'Today Co');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('k1'), tests.tid('a'), tests.rid('co'), 'Kiran One', '+91 98333 00001');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values (tests.rid('l1'), tests.tid('a'), tests.rid('co'), tests.rid('k1'), 'website_form');
create function pg_temp.waiting(p_user text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.today_summary(%s) -> 'cards' ->> 'waiting')$q$, pg_temp.tid('a'))) $$;
create function pg_temp.badge(p_user text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.nav_counts(%s) ->> 'needs_you')$q$, pg_temp.tid('a'))) $$;

-- A. open price asks and promises count
select is(pg_temp.waiting('a_owner'), '0', 'A1 nothing waiting to begin with');
insert into public.price_asks (tenant_id, lead_id, contact_id, item, source, kind) values
  (tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'Semi silk saree', 'whatsapp', 'price'),
  (tests.tid('a'), tests.rid('l1'), tests.rid('k1'), 'Dye samples', 'whatsapp', 'follow_up');
select is(pg_temp.waiting('a_owner'), '2', 'A2 an open price ask and an open promise are two things waiting');
select is(pg_temp.badge('a_owner'), pg_temp.waiting('a_owner'), 'A3 the sidebar badge is that same number');
select is(pg_temp.waiting('a_sales'), '2', 'A4 Sales (who answers them) sees the same number');
select is(pg_temp.waiting('a_viewer'), '0', 'A5 a Viewer does not');
update public.price_asks set answered_at = now(), answered_by = tests.uid('a_owner') where item = 'Dye samples';
select is(pg_temp.waiting('a_owner'), '1', 'A6 an answered one is no longer waiting');
select is(pg_temp.badge('a_owner'), '1', 'A7 ... in the badge too');

-- B. the voice-credits card is a billing notice
update public.voice_budget set notice_tenant = tests.tid('a'), daily_chars = 1000 where engine = 'cartesia';
insert into public.voice_usage_days (engine, day, source, chars) values ('cartesia', app.voice_day(), 'call', 1000) on conflict (engine, day, source) do update set chars = 1000;
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(app.today_voice_budget_items(%s))::text$q$, pg_temp.tid('a'))), '0', 'B1 with billing not enforced the voice-credits card is not shown');
update public.platform_flags set enabled = true where key = 'billing_enforced';
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(app.today_voice_budget_items(%s))::text$q$, pg_temp.tid('a'))), '1', 'B2 with billing enforced it is');

select * from finish();
rollback;
