-- OPS part 1 (13 Nov 2026): the per-provider usage ledger. Who may write (the system accounts only), a retry changes nothing, the cost is units x the rate in force at occurred_at rounded half up,
-- invalid input is refused, the batch is all or nothing, and no client role has any privilege on the ops tables.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
select app.operator_register_channel_agent('x6@test.local');

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
-- one usage line as a user: record(user, provider, unit, units, kind, ref [, occurred_at])
create function pg_temp.rec(p_user text, p_provider text, p_unit text, p_units text, p_kind text, p_ref text, p_at text default 'now()') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.ops_record_usage(%L, %L, %L, %s, %L, %L, %s)::text$q$, tests.tid('a'), p_provider, p_unit, p_units, p_kind, p_ref, p_at)) $$;

-- A. the seed: the rate card
select is((select count(*) from ops.provider_rates), 10::bigint, 'A1: ten starting rates');
select is((select string_agg(distinct provider, ',' order by provider) from ops.provider_rates), 'anthropic,cartesia,google,meta,plivo,sarvam', 'A2: every provider has a rate');
select is((select cost_micro_paise from ops.provider_rates where provider = 'plivo' and unit = 'second'), 633333::bigint, 'A3: Plivo: Rs 0.38 a minute as micro-paise a second');
select is((select count(*) from ops.provider_rates where provider = 'meta' and rate_source <> 'estimate'), 0::bigint, 'A4: the Meta per-message rates are estimates (not confirmed)');
select throws_ok($q$insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values ('plivo', 'character', 1, now(), 'estimate', 'x')$q$, '23514', null, 'A5: a unit that does not belong to the provider is refused');
select throws_ok($q$insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values ('plivo', 'second', -1, now(), 'estimate', 'x')$q$, '23514', null, 'A6: a negative rate is refused');
select throws_ok($q$insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values ('plivo', 'second', 1, now(), 'guess', 'x')$q$, '23514', null, 'A7: an unknown source is refused');

-- B. who may call
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '90', 'call', 'call-b-0001'), 'replayed'), 'false', 'B1: the scheduler account records usage');
select is(pg_temp.j(pg_temp.rec('x6', 'plivo', 'second', '30', 'call', 'call-b-0002'), 'replayed'), 'false', 'B2: so does the channel account');
select is(pg_temp.rec('a_owner', 'plivo', 'second', '30', 'call', 'call-b-0003'), 'ERR:42501', 'B3: DENY: the Owner of the business');
select is(pg_temp.rec('a_admin', 'plivo', 'second', '30', 'call', 'call-b-0003'), 'ERR:42501', 'B4: DENY: an Admin');
select is(pg_temp.rec('a_sales', 'plivo', 'second', '30', 'call', 'call-b-0003'), 'ERR:42501', 'B5: DENY: a member');
select is(pg_temp.rec('a_viewer', 'plivo', 'second', '30', 'call', 'call-b-0003'), 'ERR:42501', 'B6: DENY: a viewer');
select is(pg_temp.rec('b_owner', 'plivo', 'second', '30', 'call', 'call-b-0003'), 'ERR:42501', 'B7: DENY: the Owner of another business');
select is(pg_temp.rec('anon', 'plivo', 'second', '30', 'call', 'call-b-0003'), 'ERR:42501', 'B8: DENY: nobody signed in');
select is((select count(*) from ops.provider_usage where ref_id = 'call-b-0003'), 0::bigint, 'B9: and nothing was written by any of them');
select is(pg_temp.sc('a_owner', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, '[{"tenant_id":"' || tests.tid('a') || '","provider":"plivo","unit":"second","units":30,"ref_kind":"call","ref_id":"call-b-0004"}]')), 'ERR:42501', 'B10: DENY: the Owner may not use the batch door either');
select is(pg_temp.sc('anon', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, '[]')), 'ERR:42501', 'B11: DENY: nobody signed in, batch');

-- C. rounding: units x micro-paise / 1,000,000, half up
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '90', 'call', 'call-c-0001'), 'cost_paise'), '57', 'C1: 1.5 minutes of Plivo (90 s x 633,333) = 56.99997 paise = 57');
select is(pg_temp.j(pg_temp.rec('outsider', 'sarvam', 'character', '5', 'call', 'call-c-0002'), 'cost_paise'), '2', 'C2: 5 Sarvam characters = 1.5 paise: half rounds UP to 2');
select is(pg_temp.j(pg_temp.rec('outsider', 'sarvam', 'character', '3', 'call', 'call-c-0003'), 'cost_paise'), '1', 'C3: 0.9 paise rounds to 1');
select is(pg_temp.j(pg_temp.rec('outsider', 'sarvam', 'character', '1', 'call', 'call-c-0004'), 'cost_paise'), '0', 'C4: 0.3 paise rounds to 0 (the line is still kept)');
select is(pg_temp.j(pg_temp.rec('outsider', 'anthropic', 'token_in', '1000', 'assistant_turn', 'run-c-0005:usage-1'), 'cost_paise'), '9', 'C5: 1,000 input tokens = 8.5 paise: rounds up to 9');
select is(pg_temp.j(pg_temp.rec('outsider', 'meta', 'message_marketing', '1', 'message', 'wamid.c-0006'), 'cost_paise'), '60', 'C6: one marketing message = the 60 paise estimate');
select is(pg_temp.j(pg_temp.rec('outsider', 'meta', 'message_service', '1', 'message', 'wamid.c-0007'), 'cost_paise'), '0', 'C7: a service message costs 0 and is still recorded');
select is(pg_temp.j(pg_temp.rec('outsider', 'google', 'search', '1', 'search', 'search-c-0008'), 'cost_paise'), '300', 'C8: one Places request = Rs 3');
select is(pg_temp.j(pg_temp.rec('outsider', 'cartesia', 'character', '1000', 'call', 'call-c-0009'), 'cost_paise'), '550', 'C9: 1,000 Cartesia characters = Rs 5.50');
select is(pg_temp.j(pg_temp.rec('outsider', 'sarvam', 'second', '60.5', 'call', 'call-c-0010'), 'units'), '60.500', 'C10: fractional units are kept to three decimals');
select is(pg_temp.j(pg_temp.rec('outsider', 'sarvam', 'second', '3600', 'call', 'call-c-0011'), 'cost_paise'), '3000', 'C11: an hour of Sarvam speech-to-text = Rs 30 (list price)');
select is((select rate_id from ops.provider_usage where ref_id = 'call-c-0001'), (select id from ops.provider_rates where provider = 'plivo' and unit = 'second'), 'C12: the row keeps the rate it used');
select is((select tenant_id from ops.provider_usage where ref_id = 'call-c-0001'), tests.tid('a'), 'C13: and its business');

-- D. a retry changes nothing
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '90', 'call', 'call-c-0001'), 'replayed'), 'true', 'D1: the same line again is a replay');
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '600', 'call', 'call-c-0001'), 'cost_paise'), '57', 'D2: a retry with other units still answers the FIRST row');
select is((select count(*) from ops.provider_usage where provider = 'plivo' and unit = 'second' and ref_id = 'call-c-0001'), 1::bigint, 'D3: one row');
select is((select units::text from ops.provider_usage where ref_id = 'call-c-0001'), '90.000', 'D4: with the first units');
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '90', 'search', 'call-c-0001'), 'replayed'), 'false', 'D5: the same id under another kind is another line');
select is(pg_temp.j(pg_temp.rec('outsider', 'sarvam', 'second', '90', 'call', 'call-c-0001'), 'replayed'), 'false', 'D6: and under another provider too (a call has a line for each)');

-- E. the rate in force at occurred_at
insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values ('plivo', 'second', 1000000, now() - interval '1 day', 'invoice', 'test: a newer rate from the invoice');
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '100', 'call', 'call-e-0001'), 'cost_paise'), '100', 'E1: now: the newer rate (1 paisa a second)');
select is(pg_temp.j(pg_temp.rec('outsider', 'plivo', 'second', '100', 'call', 'call-e-0002', $$now() - interval '3 days'$$), 'cost_paise'), '63', 'E2: three days ago: the rate that was in force then (100 s x 633,333 = 63.3 paise)');
select isnt((select rate_id from ops.provider_usage where ref_id = 'call-e-0001'), (select rate_id from ops.provider_usage where ref_id = 'call-e-0002'), 'E3: each row names the rate it used');
select is(pg_temp.rec('outsider', 'plivo', 'second', '100', 'call', 'call-e-0003', $$'2020-01-01T00:00:00Z'::timestamptz$$), 'ERR:22023', 'E4: before any rate was in force: refused');

-- F. invalid input
select is(pg_temp.rec('outsider', 'twilio', 'second', '10', 'call', 'call-f-0001'), 'ERR:22023', 'F1: an unknown provider');
select is(pg_temp.rec('outsider', 'plivo', 'character', '10', 'call', 'call-f-0002'), 'ERR:22023', 'F2: a unit that is not the provider''s');
select is(pg_temp.rec('outsider', 'plivo', 'minute', '10', 'call', 'call-f-0003'), 'ERR:22023', 'F3: an unknown unit');
select is(pg_temp.rec('outsider', 'plivo', 'second', '0', 'call', 'call-f-0004'), 'ERR:22023', 'F4: zero units');
select is(pg_temp.rec('outsider', 'plivo', 'second', '-5', 'call', 'call-f-0005'), 'ERR:22023', 'F5: negative units');
select is(pg_temp.rec('outsider', 'plivo', 'second', 'null', 'call', 'call-f-0006'), 'ERR:22023', 'F6: no units');
select is(pg_temp.rec('outsider', 'plivo', 'second', '0.0004', 'call', 'call-f-0007'), 'ERR:22023', 'F7: units that round to nothing');
select is(pg_temp.rec('outsider', 'plivo', 'second', '10', 'phone', 'call-f-0008'), 'ERR:22023', 'F8: an unknown ref_kind');
select is(pg_temp.rec('outsider', 'plivo', 'second', '10', 'call', 'a b c d'), 'ERR:22023', 'F9: a reference with spaces');
select is(pg_temp.rec('outsider', 'plivo', 'second', '10', 'call', 'ab'), 'ERR:22023', 'F10: a reference that is too short');
select is(pg_temp.rec('outsider', 'plivo', 'second', '10', 'call', repeat('x', 101)), 'ERR:22023', 'F11: a reference that is too long');
select is(pg_temp.rec('outsider', 'plivo', 'second', '10', 'call', 'call-f-0012; drop table x'), 'ERR:22023', 'F12: a reference with punctuation');
select is(pg_temp.sc('outsider', $q$select public.ops_record_usage(null, 'plivo', 'second', 10, 'call', 'call-f-0013')::text$q$), 'ERR:22023', 'F13: no business');
select is(pg_temp.sc('outsider', format($q$select public.ops_record_usage(%L, 'plivo', 'second', 10, 'call', 'call-f-0014')::text$q$, gen_random_uuid())), 'ERR:23503', 'F14: a business that does not exist');
select is((select count(*) from ops.provider_usage where ref_id like 'call-f-%'), 0::bigint, 'F15: none of them wrote a row');

-- G. the batch: one round trip, all or nothing
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, jsonb_build_array(
  jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 120, 'ref_kind', 'call', 'ref_id', 'call-g-0001'),
  jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'cartesia', 'unit', 'character', 'units', 900, 'ref_kind', 'call', 'ref_id', 'call-g-0001'),
  jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'sarvam', 'unit', 'second', 'units', 65.25, 'ref_kind', 'call', 'ref_id', 'call-g-0001', 'occurred_at', '2026-11-13T10:00:00+00:00')))), 'count'), '3', 'G1: three lines of one call in one round trip');
select is((select count(*) from ops.provider_usage where ref_id = 'call-g-0001'), 3::bigint, 'G2: three rows');
select is((select occurred_at from ops.provider_usage where ref_id = 'call-g-0001' and provider = 'sarvam'), '2026-11-13T10:00:00+00:00'::timestamptz, 'G3: the time of the line is the one given');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select (public.ops_record_usage_batch(%L::jsonb) -> 'items' -> 0)::text$q$, jsonb_build_array(
  jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 120, 'ref_kind', 'call', 'ref_id', 'call-g-0001')))), 'replayed'), 'true', 'G4: the same batch again changes nothing (replayed)');
select is((select count(*) from ops.provider_usage where ref_id = 'call-g-0001'), 3::bigint, 'G5: still three rows');
select is(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, jsonb_build_array(
  jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 10, 'ref_kind', 'call', 'ref_id', 'call-g-0002'),
  jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 0, 'ref_kind', 'call', 'ref_id', 'call-g-0003')))), 'ERR:22023', 'G6: one bad line refuses the whole batch');
select is((select count(*) from ops.provider_usage where ref_id in ('call-g-0002', 'call-g-0003')), 0::bigint, 'G7: and the good one before it was not kept');
select is(pg_temp.sc('outsider', $q$select public.ops_record_usage_batch('[]'::jsonb)::text$q$), 'ERR:22023', 'G8: an empty batch');
select is(pg_temp.sc('outsider', $q$select public.ops_record_usage_batch('{}'::jsonb)::text$q$), 'ERR:22023', 'G9: not an array');
select is(pg_temp.sc('outsider', $q$select public.ops_record_usage_batch(null)::text$q$), 'ERR:22023', 'G10: nothing');
select is(pg_temp.sc('outsider', $q$select public.ops_record_usage_batch('[1]'::jsonb)::text$q$), 'ERR:22023', 'G11: an item that is not an object');
select is(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, (select jsonb_agg(jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 1, 'ref_kind', 'call', 'ref_id', 'call-g-' || to_char(n, 'FM00000'))) from generate_series(1, 51) n))), 'ERR:22023', 'G12: 51 items are too many');
select is(pg_temp.j(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, (select jsonb_agg(jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 1, 'ref_kind', 'call', 'ref_id', 'call-h-' || to_char(n, 'FM00000'))) from generate_series(1, 50) n))), 'count'), '50', 'G13: 50 items are fine');
select is(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, jsonb_build_array(jsonb_build_object('tenant_id', 'not-a-uuid', 'provider', 'plivo', 'unit', 'second', 'units', 1, 'ref_kind', 'call', 'ref_id', 'call-i-0001')))), 'ERR:22023', 'G14: a business id that is not an id');
select is(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, jsonb_build_array(jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 'abc', 'ref_kind', 'call', 'ref_id', 'call-i-0002')))), 'ERR:22023', 'G15: units that are not a number');
select is(pg_temp.sc('outsider', format($q$select public.ops_record_usage_batch(%L::jsonb)::text$q$, jsonb_build_array(jsonb_build_object('tenant_id', tests.tid('a'), 'provider', 'plivo', 'unit', 'second', 'units', 1, 'ref_kind', 'call', 'ref_id', 'call-i-0003', 'occurred_at', 'yesterday')))), 'ERR:22023', 'G16: a time that is not a time');

-- H. nothing for a client
select is((select count(*) from information_schema.table_privileges where table_schema = 'ops' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'H1: no client role touches an ops table');
select is((select count(*) from information_schema.routine_privileges where routine_schema = 'ops' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'H2: nor an ops function');
select is(has_schema_privilege('authenticated', 'ops', 'usage') or has_schema_privilege('anon', 'ops', 'usage') or has_schema_privilege('service_role', 'ops', 'usage'), false, 'H3: nor the schema');
select is(pg_temp.sc('a_owner', 'select count(*) from ops.provider_usage'), 'ERR:42501', 'H4: the Owner cannot read the ledger');
select is(pg_temp.sc('b_owner', 'select count(*) from ops.provider_rates'), 'ERR:42501', 'H5: nor the rates');
select is(pg_temp.sc('outsider', 'select count(*) from ops.provider_usage'), 'ERR:42501', 'H6: not even the system account reads a table (it only writes through the function)');
select is(pg_temp.sc('a_owner', format($q$insert into ops.provider_usage (tenant_id, provider, unit, units, cost_paise, rate_id, ref_kind, ref_id, occurred_at) select %L, 'plivo', 'second', 1, 0, id, 'call', 'call-h-forged', now() from ops.provider_rates limit 1$q$, tests.tid('a'))), 'ERR:42501', 'H7: nor writes one');
select is((select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ops' and c.relkind = 'r'), true, 'H8: row-level security is on and forced for both tables');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ops' and c.relkind = 'r'), 2::bigint, 'H9: two tables');
select is((select count(*) from pg_proc p where p.proname in ('ops_record_usage', 'ops_record_usage_batch') and p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig = array['search_path=""']), 2::bigint, 'H10: both doors are SECURITY DEFINER with search_path fixed to empty');
select is(has_function_privilege('anon', 'public.ops_record_usage(uuid, text, text, numeric, text, text, timestamptz)', 'execute'), false, 'H11: anon cannot execute ops_record_usage');
select is(has_function_privilege('anon', 'public.ops_record_usage_batch(jsonb)', 'execute'), false, 'H12: nor the batch');
select is(has_function_privilege('authenticated', 'public.ops_record_usage(uuid, text, text, numeric, text, text, timestamptz)', 'execute'), true, 'H13: authenticated may call it (the body proves the role)');
select is((select count(*) from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.prosecdef), 0::bigint, 'H14: no definer function lives in ops itself');

select * from finish();
rollback;
