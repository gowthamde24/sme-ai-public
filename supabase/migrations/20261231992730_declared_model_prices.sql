-- The model price rows the declared settings need (26 Nov 2026). Production had `LLM_MODEL=claude-haiku-5-5` declared but NO price row for it (rows are added by an operator, and nobody had): every model turn of the assistant was refused with `model_not_configured`, which the voice screen showed as "That did not work".
-- The rows below are the prices declared next to the model (LLM_INPUT/OUTPUT_MICROS_PER_MTOK in deploy/settings/*/api.env). `on conflict do nothing`: an operator's own number is never overwritten. A test (tests/test_declared_model_prices.py) fails when a declared model has no row here.
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values
  ('claude-haiku-5-5', 9000000, 45000000),
  ('sarvam-105b', 15000000, 60000000)
on conflict (model) do nothing;
