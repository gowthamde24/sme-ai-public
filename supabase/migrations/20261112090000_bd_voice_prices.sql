-- Job BD (ADR 0071): voice counts against the workspace's AI allowance ("fair use"). The AI ledger prices model calls in TOKENS; speech has no tokens, so two ACCOUNTING MODELS carry it:
--
--   voice-stt   1 input token = one tenth of a second of audio  (10 tokens a second)
--   voice-tts   1 input token = one quarter of a character      (4 tokens a character)
--
-- Both are priced at the table's ceiling, 1,000,000,000 per million tokens = 1,000 micros per token (a micro is a millionth of a rupee), so a second of speech to text is charged 10,000 micros
-- (Rs 0.60 a minute) and a character of text to speech 4,000 micros (Rs 4 per 1,000 characters). That is deliberately a little ABOVE the dearest price list found for Indian-language speech
-- (Sarvam: Rs 0.50 a minute, Rs 3 per 1,000 characters), so the allowance is never undercounted whichever provider the operator switches on; it is a fair-use measure, not an invoice.
-- Reserve and settle go through the same functions as every model call (agent_reserve_cost / agent_record_usage), so the day and month caps, the pause and the "ai-usage" screens already count it.
-- A new migration; earlier files are not edited.
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values
  ('voice-stt', 1000000000, 1000000000),
  ('voice-tts', 1000000000, 1000000000)
on conflict (model) do nothing;

-- A voice request is charged to the SAME run as its question (the transcription before the answer, the spoken answer just before the run closes). The assistant run's own cost budget was Rs 1.00 (1,000,000
-- micros), which an ordinary text question never comes near (about Rs 0.01) but which one minute of speech (Rs 0.60) plus a spoken answer of 500 characters (Rs 2.00) would pass. It becomes Rs 3.00. The
-- run is still bounded by its token budgets, its tool-call limit, its 15-minute life, the per-hour run limit and the workspace's daily and monthly caps; only the per-run ceiling moves, by Rs 2.
update public.agent_definitions set max_cost_micros = 3000000 where agent_name = 'assistant';
