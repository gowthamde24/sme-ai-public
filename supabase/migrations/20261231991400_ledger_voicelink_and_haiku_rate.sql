-- The usage ledger learns VoiceLink and the real Haiku 5.5 price (24 Nov 2026; reports/cost-per-call-minute.md).
--   * a phone call carried by VoiceLink gets a carrier line: provider voicelink, unit second, Rs 0.50 a minute (the reseller's figure: an estimate until the first invoice), billed in whole 60-second pulses by the API;
--   * the Anthropic rate rows assumed a Haiku 4.5 price (USD 1 / 5 per million tokens); Claude Haiku 5.5 lists at USD 0.10 / 0.50 per million: new rows from today, earlier usage keeps the rate it was recorded with.
-- Rollback = delete the new rate rows and restore the previous checks.

alter table ops.provider_rates drop constraint if exists provider_rates_provider_check;
alter table ops.provider_usage drop constraint if exists provider_usage_provider_check;
alter table ops.provider_rates add constraint provider_rates_provider_check check (provider in ('cartesia', 'sarvam', 'plivo', 'anthropic', 'meta', 'google', 'voicelink'));
alter table ops.provider_usage add constraint provider_usage_provider_check check (provider in ('cartesia', 'sarvam', 'plivo', 'anthropic', 'meta', 'google', 'voicelink'));

create or replace function ops.unit_ok(p_provider text, p_unit text) returns boolean language sql immutable set search_path = '' as
$$ select case p_provider
       when 'plivo'     then p_unit = 'second'
       when 'voicelink' then p_unit = 'second'
       when 'cartesia'  then p_unit = 'character'
       when 'sarvam'    then p_unit in ('second', 'character')
       when 'anthropic' then p_unit in ('token_in', 'token_out')
       when 'meta'      then p_unit in ('message_marketing', 'message_utility', 'message_service')
       when 'google'    then p_unit in ('search', 'search_ids', 'search_pro', 'search_enterprise', 'details_pro', 'details_enterprise')
       else false end $$;

insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values
  ('voicelink', 'second',     833333, '2026-01-01 00:00:00+00', 'estimate',   'VoiceLink reseller call rate: Rs 0.50 a minute (the planner''s figure, before GST), billed in 60-second pulses; Rs 0.50 / 60 s rounded to a whole micro-paisa. Confirm on the first invoice.'),
  ('anthropic', 'token_in',      850, '2026-11-24 00:00:00+00', 'list_price', 'Claude Haiku 5.5 list price: USD 0.10 per million input tokens (prompts up to 100K) at about Rs 85 a dollar = 0.00085 paise a token'),
  ('anthropic', 'token_out',    4250, '2026-11-24 00:00:00+00', 'list_price', 'Claude Haiku 5.5 list price: USD 0.50 per million output tokens at about Rs 85 a dollar = 0.00425 paise a token');
