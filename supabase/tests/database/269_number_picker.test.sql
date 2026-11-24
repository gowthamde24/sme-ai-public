-- The number picker (migration 20261231988800): every platform guardrail is enforced by the database, whoever calls: the switch, the second factor, the plan's one number, the daily cap, one purchase per number, the Owner only.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- switch OFF (the default): nobody can start a claim
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_begin(%L, '+919000000011', 'mobile')::text$q$, tests.tid('a'))), 'ERR:SM933', 'A1: with the platform switch off the Owner cannot claim');
select app.operator_set_number_picker(true, 5);

-- the screen asks first
select is(pg_temp.sc('a_owner', format($q$select coalesce(public.number_claim_check(%L), 'ok')$q$, tests.tid('a'))), 'ok', 'A2: with the switch on and nothing claimed the check says ok');
select is(pg_temp.sc('b_owner', format($q$select coalesce(public.number_claim_check(%L), 'ok')$q$, tests.tid('a'))), 'ERR:42501', 'A3: another workspace cannot ask');

-- who may
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_begin(%L, '+919000000011', 'mobile')::text$q$, tests.tid('a')), 'aal1'), 'ERR:SM306', 'B1: the Owner without a second factor is refused');
select is(pg_temp.sc('b_owner', format($q$select public.number_claim_begin(%L, '+919000000011', 'mobile')::text$q$, tests.tid('a'))), 'ERR:42501', 'B2: another workspace''s Owner is refused');
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_begin(%L, '12345', 'mobile')::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: a garbled number is refused (invalid)');
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_begin(%L, '+919000000011', 'toll_free')::text$q$, tests.tid('a'))), 'ERR:22023', 'B4: only mobile and landline');

-- the first number is included; one purchase per number; a trial has one number
create temp table t_claim as select pg_temp.sc('a_owner', format($q$select public.number_claim_begin(%L, '+919000000011', 'mobile')::text$q$, tests.tid('a'))) as id;
select is((select state from ops.number_purchases where id = (select id::uuid from t_claim)), 'started', 'C1: the first claim is recorded as started');
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_check(%L)$q$, tests.tid('a'))), 'already_has_number', 'C2a: the check says why: already_has_number');
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_begin(%L, '+919000000012', 'mobile')::text$q$, tests.tid('a'))), 'ERR:SM932', 'C2: a trial workspace has ONE number (the second is refused: already_has_number)');
select is(pg_temp.sc('b_owner', format($q$select public.number_claim_begin(%L, '+919000000011', 'mobile')::text$q$, tests.tid('b'))), 'ERR:SM935', 'C3: the same number cannot be claimed twice (number_taken)');

-- how far it got; attaching needs the number routed
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_attach(%L)::text$q$, (select id from t_claim))), 'ERR:SM961', 'D1: a claim that is not routed cannot be attached');
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_finish(%L, 'routed', null, 29900, 'ORD-1')::text$q$, (select id from t_claim))), '', 'D2: the API reports the claim routed, with what it cost us');
select is(pg_temp.sc('b_owner', format($q$select public.number_claim_attach(%L)::text$q$, (select id from t_claim))), 'ERR:42501', 'D3: another workspace''s Owner cannot attach it');
select is(pg_temp.sc('a_owner', format($q$select (public.number_claim_attach(%L)::jsonb) ->> 'inbound_on'$q$, (select id from t_claim))), 'false', 'D4: attached with calls OFF');
select is((select count(*) from public.phone_numbers where tenant_id = tests.tid('a') and number = '+919000000011' and provider = 'voicelink'), 1::bigint, 'D5: it is the workspace''s VoiceLink line');
select is((select state || ':' || cost_paise from ops.number_purchases where id = (select id::uuid from t_claim)), 'attached:29900', 'D6: the row says attached and what it cost');
select is(pg_temp.sc('a_owner', format($q$select public.number_claim_finish(%L, 'failed')::text$q$, (select id from t_claim))), 'ERR:SM961', 'D7: an attached claim never moves again');
select is(pg_temp.sc('a_owner', format($q$select jsonb_array_length(public.numbers_list(%L))::text$q$, tests.tid('a'))), '1', 'E1: the workspace sees its one number');
select is(pg_temp.sc('b_owner', format($q$select jsonb_array_length(public.numbers_list(%L))::text$q$, tests.tid('b'))), '0', 'E2: the other workspace sees none of it');

-- the platform daily cap
select app.operator_set_number_picker(true, 1);
select is(pg_temp.sc('b_owner', format($q$select public.number_claim_begin(%L, '+919000000013', 'mobile')::text$q$, tests.tid('b'))), 'ERR:SM934', 'F1: the daily cap of purchases is enforced (daily_limit)');

select * from finish();
rollback;
