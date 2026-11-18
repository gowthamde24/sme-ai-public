-- When the assistant takes requests again after the hourly run limit (migration 20261231982400; 18 Nov 2026). The limit itself (30 an hour) is not changed here.
begin;
select no_plan();
select tests.seed_two_tenants();

insert into public.assistant_conversations (id, tenant_id, created_by) values (tests.rid('conv'), tests.tid('a'), tests.uid('a_owner'));
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.reopen(p_user text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select coalesce(extract(epoch from public.agent_runs_reopen_at(%L) - now())::integer::text, 'null')$q$, tests.tid('a'))) $$;
create function pg_temp.run(p_n integer, p_ago interval) returns void language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, conversation_id, expires_at, input_sha256, created_at)
  values (gen_random_uuid(), tests.tid('a'), tests.uid('a_owner'), 'assistant', 'assistant-1', tests.rid('conv'), now() + interval '15 minutes', repeat(p_n::text, 64), now() - p_ago);
end $$;

-- the limit is 30 an hour; two runs now are far under it
select pg_temp.run(1, interval '10 minutes');
select pg_temp.run(2, interval '5 minutes');
select is(pg_temp.reopen('a_owner'), 'null', 'R1 under the limit: nothing to wait for');

-- a limit of 3 an hour for this test: the third run in the hour closes the door until the OLDEST of the hour ages out
alter table public.agent_limits disable trigger all;
update public.agent_limits set limit_value = 3 where limit_key = 'max_runs_per_hour';
select pg_temp.run(3, interval '1 minute');
select is((pg_temp.reopen('a_owner'))::integer between 49 * 60 and 50 * 60, true, 'R2 at the limit: the door opens when the oldest run (10 minutes ago) is an hour old, in about 50 minutes');
select pg_temp.run(4, interval '30 seconds');
select is((pg_temp.reopen('a_owner'))::integer between 54 * 60 and 55 * 60, true, 'R3 over the limit by one: the second oldest (5 minutes ago) decides, in about 55 minutes');

-- a run older than an hour does not count
update public.agent_runs set created_at = now() - interval '2 hours' where tenant_id = tests.tid('a') and input_sha256 = repeat('1', 64);
select is((pg_temp.reopen('a_owner'))::integer between 54 * 60 and 55 * 60, true, 'R4 a run older than an hour does not count: three are left, still at the limit of 3');
update public.agent_runs set created_at = now() - interval '2 hours' where tenant_id = tests.tid('a') and input_sha256 = repeat('2', 64);
select is(pg_temp.reopen('a_owner'), 'null', 'R4b two runs are left: back under the limit');

-- who may ask
select is(pg_temp.reopen('b_owner'), 'null', 'R5 another workspace''s Owner is told nothing (null)');
select is(pg_temp.val('anon', format($q$select public.agent_runs_reopen_at(%L)::text$q$, tests.tid('a'))) is null or pg_temp.val('anon', format($q$select public.agent_runs_reopen_at(%L)::text$q$, tests.tid('a'))) like 'ERR:%', true, 'R6 nobody signed in gets nothing');

select * from finish();
rollback;
