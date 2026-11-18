-- Free early access (migration 20261231982600; planner, 18 Nov 2026): the plan early_access, its allowances as one row, no lapse, and the meter connected to the call path.
begin;
select no_plan();
select tests.seed_two_tenants();
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.call(p_provider text, p_secs integer, p_simulated boolean default false, p_outreach uuid default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, simulated, outreach_item_id) values (v, tests.tid('a'), 'outbound', 'in_progress', p_provider, false, p_simulated, p_outreach);
  update public.phone_calls set state = 'completed', ended_at = now(), duration_s = p_secs where id = v;
  return v;
end $$;

-- 1. the plan and its allowance row
select is((select count(*) from billing.plans where id = 'early_access'), 1::bigint, 'E1 the plan early_access exists');
select is((select call_minutes::text || '/' || whatsapp_messages::text from billing.plan_overrides where plan_id = 'early_access'), '60/300', 'E2 its allowances are one row: 60 call minutes, 300 messages');
select is((select count(*) from public.plan_ai_allowances where plan = 'early_access'), 1::bigint, 'E3 the AI fair use is the free trial''s');

-- 2. a workspace on it: the allowances come from the row; it never lapses
update public.tenants set plan = 'early_access' where id = tests.tid('a');
select is((select billing_exempt from public.tenants where id = tests.tid('a')), true, 'E4 putting a workspace on early_access exempts it from the lapse');
select is(pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') -> 'meter' ->> 'allowance')$q$, tests.tid('a'))), '60', 'E5 the call-minute meter says 60 minutes');
select is(pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'whatsapp_messages') -> 'meter' ->> 'allowance')$q$, tests.tid('a'))), '300', 'E6 the message meter says 300');
select is(pg_temp.val('a_owner', format($q$select public.billing_get(%L) is not null$q$, tests.tid('a'))), 'true', 'E7 the billing read still answers for a workspace on it');
update public.tenants set plan = 'free_trial' where id = tests.tid('a');
select is((select billing_exempt from public.tenants where id = tests.tid('a')), false, 'E8 leaving it undoes only what the plan did');
update public.tenants set plan = 'early_access', demo = true where id = tests.tid('a');
update public.tenants set plan = 'free_trial' where id = tests.tid('a');
select is((select billing_exempt from public.tenants where id = tests.tid('a')), true, 'E9 a demo workspace keeps its exemption');
update public.tenants set demo = false, plan = 'early_access' where id = tests.tid('a');

-- 3. the meter is connected to the call path
select pg_temp.call('plivo', 61);
select is(pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') -> 'meter' ->> 'used')$q$, tests.tid('a'))), '1.5', 'E10 a 61-second call is metered as 90 seconds (30-second pulses): 1.5 minutes');
select pg_temp.call('sandbox', 600);
select pg_temp.call('plivo', 600, true);
select is(pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') -> 'meter' ->> 'used')$q$, tests.tid('a'))), '1.5', 'E11 a call on the fake provider and a simulated call cost nothing and are not counted');
select pg_temp.call('plivo', 900, false, gen_random_uuid());
select is(pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') -> 'meter' ->> 'used')$q$, tests.tid('a'))), '1.5', 'E11b a call a standing rule placed is recorded by its own result, not twice');
select pg_temp.call('plivo', 3600);
select pg_temp.call('plivo', 3600);
select is(pg_temp.val('a_owner', format($q$select (public.billing_check_usage(%L, 'call_minutes') -> 'meter' ->> 'state')$q$, tests.tid('a'))), 'stopped', 'E12 the allowance is used up: the meter says stopped');

-- 4. the call path hears it, but only while the platform switch is on
select app.operator_set_billing_enforced(false);
select is(pg_temp.val('a_owner', format($q$select public.phone_line_for_tenant(%L, 'plivo') ->> 'billing_blocked'$q$, tests.tid('a'))), null, 'E13 (setup) no line yet: nothing');
insert into public.phone_numbers (id, tenant_id, number, provider, inbound_on) values (tests.rid('line'), tests.tid('a'), '+918044440001', 'plivo', true);
select is(pg_temp.val('a_owner', format($q$select public.phone_line_for_tenant(%L, 'plivo') ->> 'billing_blocked'$q$, tests.tid('a'))), 'false', 'E14 the switch is off: the meter stops nothing');
select app.operator_set_billing_enforced(true);
select is(pg_temp.val('a_owner', format($q$select public.phone_line_for_tenant(%L, 'plivo') ->> 'billing_blocked'$q$, tests.tid('a'))), 'true', 'E15 the switch is on and the minutes are used up: the outbound path is told billing_blocked');
select app.operator_register_scheduler('Outsider@test.local');
select is(pg_temp.val('outsider', $q$select public.phone_line_find('+918044440001') ->> 'billing_blocked'$q$), 'true', 'E16 the inbound path is told too');
select app.operator_set_plan_allowance('early_access', 500, 300);
select is(pg_temp.val('outsider', $q$select public.phone_line_find('+918044440001') ->> 'billing_blocked'$q$), 'false', 'E17 the owner''s numbers are one row: raise the minutes and the call path opens again');

-- 5. operator only, and the plan new workspaces start on
select is(pg_temp.val('a_owner', $q$select app.operator_set_plan_allowance('early_access', 1, 1)::text$q$), 'ERR:42501', 'E18 a signed-in person cannot change the allowance');
select app.operator_set_new_tenant_plan('early_access');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'plan'), '''early_access''::text', 'E19 the operator makes new workspaces start on early_access');
select throws_ok($q$select app.operator_set_new_tenant_plan('nope')$q$, '23503', null, 'E20 an unknown plan is refused');

select * from finish();
rollback;
