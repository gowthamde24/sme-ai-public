-- Sarvam 105B in the price table (owner, 29 Oct 2026, Pay As You Go): Rs 15 per million input tokens, Rs 60 per million output tokens, EXCLUDING GST; a cached input token costs Rs 5 per million.
-- The table holds millionths of a rupee per million tokens (one rupee per million = 1,000,000), so: input 15,000,000, output 60,000,000. It has no column for the cached rate: the ledger bills every
-- input token at the full Rs 15, so a cached call is counted DEARER than it is (never undercounted). GST is added by the provider's invoice, not here (as for the other models).
-- The model id is the one the API sends ("sarvam-105b", SARVAM_CHAT_MODEL). Having a price does NOT switch it on: Claude stays the default for the owner chat (BROWSER_VOICE_TURN_MODEL=claude);
-- without a row every call to a model is refused, with one an operator can choose it.
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok)
values ('sarvam-105b', 15000000, 60000000)
on conflict (model) do update set input_micros_per_mtok = excluded.input_micros_per_mtok, output_micros_per_mtok = excluded.output_micros_per_mtok, updated_at = now();
