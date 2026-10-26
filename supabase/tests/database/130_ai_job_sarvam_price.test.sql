-- Night 3 (migration 20261201090100): Sarvam's chat model has a price row, so the AI ledger can reserve and settle its calls; nothing else about pricing moved.
begin;
select no_plan();

select is((select input_micros_per_mtok from public.agent_model_prices where model = 'sarvam-105b'), 15000000::bigint, 'Sarvam 105B input: Rs 15 per million tokens');
select is((select output_micros_per_mtok from public.agent_model_prices where model = 'sarvam-105b'), 60000000::bigint, 'Sarvam 105B output: Rs 60 per million tokens');
select ok((select count(*) from public.agent_model_prices where model = 'sarvam-105b') = 1, 'one row');
-- an operator's own row is never overwritten by the migration (on conflict do nothing): replaying the insert changes nothing
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('sarvam-105b', 1, 1) on conflict (model) do nothing;
select is((select input_micros_per_mtok from public.agent_model_prices where model = 'sarvam-105b'), 15000000::bigint, 'replaying the insert leaves the row alone');
-- the older rows are still there
select ok(exists (select 1 from public.agent_model_prices where model = 'fake-selftest') and exists (select 1 from public.agent_model_prices where model = 'voice-tts'), 'the other rows are untouched');
-- still closed to the app roles
select ok(not has_table_privilege('authenticated', 'public.agent_model_prices', 'select') and not has_table_privilege('anon', 'public.agent_model_prices', 'select'), 'the price table stays closed to the app roles');

select * from finish();
rollback;
