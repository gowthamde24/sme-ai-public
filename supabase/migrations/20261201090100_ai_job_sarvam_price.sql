-- Night 3 (ADR 0102): the AI ledger prices every model call at a row of public.agent_model_prices, and a model with no row is refused ("model_not_configured"). The per-job model setting
-- (AI_JOB_CALL_TURN, AI_JOB_WHATSAPP_REPLY = sarvam) names Sarvam's chat model, so it needs its row. Prices are millionths of a rupee per million tokens: Rs 15 in and Rs 60 out per million
-- tokens (sarvam.ai/api-pricing, 26 Oct 2026) = 15,000,000 and 60,000,000. `on conflict do nothing`: an operator's own row for the model is never overwritten. Nothing switches to Sarvam by this row;
-- every job stays on the default model until its setting says otherwise.
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values
  ('sarvam-105b', 15000000, 60000000)
on conflict (model) do nothing;
