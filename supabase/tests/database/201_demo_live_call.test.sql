-- "Start demo": a DEMO workspace makes a labelled live call at any hour (migration 20261231650000). Only an Owner or Admin of a workspace flagged demo; a synthetic +00 customer; one at a time; ended by the same people or,
-- at 15 minutes, by the worker as a completed simulated call. Every other workspace, role and anonymous caller is refused; real calls are closed by the worker exactly as before.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.start(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.q(p_user, format('select public.demo_start_live_call(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.stop(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.q(p_user, format('select public.demo_end_live_call(%L)::text', tests.tid(p_tenant))) $$;

-- business A has two synthetic customers (+00 numbers; the database refuses a real-looking number in a test workspace, so "never a real number" is the +00 filter plus that gate)
insert into public.companies (id, tenant_id, name, type, country) values (tests.rid('co1'), tests.tid('a'), 'Synthetic Silks', 'customer', 'India'), (tests.rid('co2'), tests.tid('a'), 'Real Looking Co', 'customer', 'India');
insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid('ct1'), tests.tid('a'), tests.rid('co1'), 'Demo Customer', '+00 90003 00001'), (tests.rid('ct2'), tests.tid('a'), tests.rid('co2'), 'Second Demo Customer', '+00 90003 00002');
insert into public.leads (id, tenant_id, company_id, contact_id, status, source) values (tests.rid('ld1'), tests.tid('a'), tests.rid('co1'), tests.rid('ct1'), 'new', 'Walk-in'), (tests.rid('ld2'), tests.tid('a'), tests.rid('co2'), tests.rid('ct2'), 'new', 'Walk-in');

select is(pg_temp.start('a_owner'), 'ERR:42501', 'A1: business A is not flagged demo: refused, even for its Owner');
update public.tenants set demo = true where id = tests.tid('a');
select is(pg_temp.start('b_owner', 'a'), 'ERR:42501', 'A2: another business''s Owner is refused');
select is(pg_temp.start('a_sales'), 'ERR:42501', 'A3: Sales is refused');
select is(pg_temp.start('a_viewer'), 'ERR:42501', 'A4: a Viewer is refused');
select is(pg_temp.start('anon'), 'ERR:42501', 'A5: anonymous is refused');
select is(pg_temp.start('b_owner', 'b'), 'ERR:42501', 'A6: business B is not demo');

select is(pg_temp.q('a_owner', format('select (public.demo_start_live_call(%L) ->> ''started'')', tests.tid('a'))), 'true', 'B1: the Owner of a demo workspace starts a demo call');
select is((select count(*)::int from public.phone_calls where tenant_id = tests.tid('a') and state = 'in_progress'), 1, 'B2: one live call');
select ok((select c.simulated and c.sandbox and c.provider = 'sandbox' and c.contact_id in (tests.rid('ct1'), tests.rid('ct2')) and c.direction = 'outbound' and not c.recorded from public.phone_calls c where c.tenant_id = tests.tid('a') and c.state = 'in_progress'), 'B3: simulated and sandboxed, to a +00 customer');
select is(pg_temp.q('a_owner', format('select (public.demo_start_live_call(%L) ->> ''started'')', tests.tid('a'))), 'false', 'B4: asked again while it is live: the same call, no second one');
select is((select count(*)::int from public.phone_calls where tenant_id = tests.tid('a') and state = 'in_progress'), 1, 'B5: still one');
select is(pg_temp.q('a_owner', format($q$select jsonb_array_length(public.phone_calls_list(%L, 'live'))::text$q$, tests.tid('a'))), '1', 'B6: it shows in the live strip');
select is(pg_temp.q('a_admin', format($q$select (select x ->> 'simulated' from jsonb_array_elements(public.phone_calls_list(%L, 'live')) x limit 1)$q$, tests.tid('a'))), 'true', 'B7: and says it is simulated (the label)');

-- the worker leaves it alone while it is young, even with no beat for a long time; a real call in the same state is closed
update public.phone_calls set heartbeat_at = now() - interval '1 hour' where tenant_id = tests.tid('a') and simulated;
insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, answered_at, created_at, heartbeat_at)
values (tests.rid('real_quiet'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'in_progress', now() - interval '8 minutes', now() - interval '9 minutes', now() - interval '7 minutes');
select is(pg_temp.q('outsider', $$select public.phone_calls_close_orphans(240)::text$$), '1', 'C1: the worker closes the silent real call and leaves the simulated one');
select is((select state from public.phone_calls where id = tests.rid('real_quiet')), 'failed', 'C2: the real call failed, as before');
select is((select count(*)::int from public.phone_calls where tenant_id = tests.tid('a') and simulated and state = 'in_progress'), 1, 'C3: the demo call is still live');
update public.phone_calls set created_at = now() - interval '16 minutes', answered_at = now() - interval '16 minutes' where tenant_id = tests.tid('a') and simulated;
select is(pg_temp.q('outsider', $$select public.phone_calls_close_orphans(240)::text$$), '1', 'C4: at 16 minutes the worker ends it');
select is((select state || '/' || end_reason from public.phone_calls where tenant_id = tests.tid('a') and simulated), 'completed/goodbye', 'C5: as a completed simulated call, not a failed one');

-- ending it by hand
select is(pg_temp.q('a_owner', format('select (public.demo_start_live_call(%L) ->> ''started'')', tests.tid('a'))), 'true', 'D1: a new one can start once the old one ended');
select is(pg_temp.stop('a_sales'), 'ERR:42501', 'D2: Sales cannot end it');
select is(pg_temp.stop('b_owner', 'a'), 'ERR:42501', 'D3: nor another business');
select is(pg_temp.q('a_admin', format('select (public.demo_end_live_call(%L) ->> ''ended'')', tests.tid('a'))), '1', 'D4: an Admin ends it');
select is((select count(*)::int from public.phone_calls where tenant_id = tests.tid('a') and state = 'in_progress'), 0, 'D5: nothing is live');
select is((select summary from public.phone_calls where tenant_id = tests.tid('a') and simulated and ended_at > now() - interval '1 minute' order by ended_at desc limit 1), 'A simulated demo call: nobody was called.', 'D6: its summary says nobody was called');

-- a demo workspace with no synthetic customer: a plain refusal, nothing made
update public.contacts set archived_at = now() where tenant_id = tests.tid('a') and id in (tests.rid('ct1'), tests.rid('ct2'));
select is(pg_temp.start('a_owner'), 'ERR:22023', 'E1: no customer to call (none left that is not archived): nothing is made');
select * from finish();
rollback;
