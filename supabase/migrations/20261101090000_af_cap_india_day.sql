-- Job AF: the AI daily cost cap is enforced per ASIA/KOLKATA day, the day the usage card already shows (job AD, public.ai_usage_today).
--
-- Every place that decides a day goes through ONE function, app.agent_utc_today() (reserve, settle with no reservation, the early refusal when a run
-- starts, the claim-home checks, the Owner's cost summary). Its NAME is kept on purpose, because it is the clock seam the pgTAP files and the other
-- functions already use; since this migration it returns the INDIAN date, not the UTC one. Nothing else about the cap changes: the same default,
-- the same reserve / settle / open-reservation rules, the same errors.
--
--   app.agent_cost_day(timestamptz)  the Indian date of an instant, a pure function (so the midnight boundary can be tested at fixed instants).
--   app.agent_utc_today()            now(), through it. (Replaced in place: owner, privileges and every caller are unchanged.)
--   the data                         reservations already recorded carry the UTC date they were made on. Each is re-dated to the Indian date of
--                                    its own created_at (the instant it was authorised), so that history, the card and the cap agree. A call
--                                    belongs to the day it was AUTHORISED; settling never moves it (unchanged).

create function app.agent_cost_day(p_at timestamptz) returns date
language sql
immutable
security definer
set search_path = ''
as $$ select (p_at at time zone 'Asia/Kolkata')::date $$;
revoke all on function app.agent_cost_day(timestamptz) from public, anon, authenticated, service_role;

create or replace function app.agent_utc_today() returns date
language sql
stable
security definer
set search_path = ''
as $$ select app.agent_cost_day(now()) $$;
comment on function app.agent_utc_today() is 'The cost day of the daily AI cap: the Asia/Kolkata date of now() (since job AF; the name is the original clock seam and is kept).';

update public.agent_cost_reservations
   set cost_day = app.agent_cost_day(created_at)
 where cost_day is distinct from app.agent_cost_day(created_at);
