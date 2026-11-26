-- Cartesia sponsors the voice (owner, 26 Nov 2026): our own cap on the engine must practically never trip, but one hard ceiling stays so a runaway loop cannot burn the sponsorship.
-- Before: 20,000 characters a day, 2,000 a call (about 26 minutes of speech a day for the whole platform). The numbers below are about 20x a busy Customer Zero day (50 calls x 3 minutes, half of it the assistant speaking, about 60,000 characters, plus the owner's own use).
-- The 80 % and 100 % notices (Today card, to the notice workspace) already exist (app.today_voice_budget_items): the day's notice is at 80 % of daily_chars; the month's is at monthly_credits, which is the sponsored ALLOWANCE and is left to the owner to state (no number is invented here).
update public.voice_budget
   set daily_chars = 1500000,     -- about 32 hours of speech a day (the table allows up to 10,000,000)
       per_call_chars = 30000     -- about 38 minutes of speech in one call or one live talk (the table allows up to 1,000,000)
 where engine = 'cartesia';
