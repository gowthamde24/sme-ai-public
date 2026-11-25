-- The two computed platform alerts (migration 20261231989200): a stopped worker and a quiet live line. Nothing is stored; the facts decide.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.kinds(p_role text) returns text language sql as $$
  select coalesce(string_agg(e ->> 'kind', ',' order by e ->> 'kind'), '') from jsonb_array_elements(admin.computed_alerts(p_role)) e where e ->> 'kind' <> 'wallet_low' $$;   -- the fixture workspaces hold no credit; the wallet_low alert has its own checks in 288

set local session_replication_role = replica;
delete from scheduler.heartbeat;
select is(pg_temp.kinds('owner'), '', 'A1: no heartbeat row at all (a fresh database): not an alert');
insert into scheduler.heartbeat (id, last_tick_at, interval_seconds, ticks, last_errors) values (1, app.outbox_now(), 60, 5, 0);
select is(pg_temp.kinds('owner'), '', 'A2: a fresh heartbeat: nothing');
update scheduler.heartbeat set last_tick_at = app.outbox_now() - interval '2 hours';
select is(pg_temp.kinds('support'), 'worker_stale', 'A3: two hours old: support sees it too');
select is(pg_temp.kinds('finance'), 'worker_stale', 'A4: and finance');
select is(pg_temp.kinds('nobody'), '', 'A5: an unknown role sees nothing');
update scheduler.heartbeat set last_tick_at = app.outbox_now() - interval '9 minutes';
select is(pg_temp.kinds('owner'), '', 'A6: nine minutes is not yet stopped');
update scheduler.heartbeat set last_tick_at = app.outbox_now();

insert into public.phone_numbers (id, tenant_id, number, label, inbound_on, provider) values (tests.rid('mon_pn'), tests.tid('a'), '+919000000555', 'x', true, 'voicelink');
select is(pg_temp.kinds('owner'), '', 'B1: a live line that never had a call: nothing (a new number is quiet)');
insert into public.phone_calls (id, tenant_id, direction, provider, created_at) values (tests.rid('mon_c1'), tests.tid('a'), 'inbound', 'voicelink', app.outbox_now() - interval '3 days');
select is(pg_temp.kinds('owner'), 'quiet_line', 'B2: calls three days ago and none since: an item');
select is(pg_temp.kinds('support'), '', 'B3: support does not see it');
insert into public.phone_calls (id, tenant_id, direction, provider, created_at) values (tests.rid('mon_c2'), tests.tid('a'), 'inbound', 'voicelink', app.outbox_now() - interval '1 hour');
select is(pg_temp.kinds('owner'), '', 'B4: a call in the last day: gone');

select * from finish();
rollback;
