# ADR 0064: AI included, fair use: a light model at 100 %, a pause only at 300 %

Status: accepted (owner decision, 2026-10-10). Amends ADR 0063 (the allowance windows).

## Context
ADR 0063 paused the AI at 100 % of a plan's daily or monthly allowance. The owner's pricing is "AI included, fair use": the AI should never just stop for an ordinary customer. A person who is over the allowance should still get answers, from a cheaper model, and only a runaway workspace should be paused.

## Decision
1. **Allowances** (paise, `plan_ai_allowances`): free trial 2,000 a day / 30,000 a month (Rs 20 / Rs 300), starter 1,500 / 30,000, growth 4,000 / 90,000, business 10,000 / 250,000. A day may not exceed 50,000 paise (the Rs 500 wall of ADR 0063's addendum).
2. **100 % of either window: light.** The workspace's calls are served by the light model (`LLM_LIGHT_MODEL`, its own prices, the same provider and key, the same cost accounting and caps) until that window resets. Nothing stops. `app.ai_is_light` is the single definition; the runtime asks `public.agent_ai_mode(run, light_model)` before every call.
3. **300 % of either window: paused.** `app.agent_daily_cap` now returns the HARD cap, `least(3 x the daily allowance, the wall)` combined with what is left under 3 x the monthly allowance, so the existing enforcement points (run start, message start, authorisation of every model call, settlement) refuse with no change to their code (SM207 at a start, `daily_cap` at a call), and the API answers 429 `ai_paused_until` with `until`. Only AI features call these functions: quotes, orders, follow-ups and customers do not pause.
4. **A workspace's own cap** (`tenant_agent_settings.daily_cost_cap_micros`, Owner only, 0 to Rs 500) keeps its meaning: a hard cap. It replaces the plan's 3 x wall for the day; below the allowance it pauses the AI earlier by choice; 0 switches AI off.
5. **The database decides the mode and the wall; the API only chooses the model.** If the named light model has no price row the answer is `normal` (the main model, still capped): a missing price can never stop the AI. A wrong choice by the API cannot spend past the hard cap, because every call is reserved at the price of the model it names.
6. **`GET /ai-usage`** returns `{today_percent, month_percent, resets_at_today, resets_at_month, state}` with `state` one of `ok`, `warn` (>= 80 %), `light` (>= 100 %), `paused` (>= 300 %). The percentages stay 0 to 100 (spent / allowance, rounded down, capped at 100): the state carries light and paused. No paise, no tokens.
7. **Task classes.** Every model call declares `simple` or `hard` (`LlmRequest.task_class`, set from the agent's spec; the Main agent is `hard`, the self-test `simple`). `app/agents/llm/routing.py` holds the routing table: today both classes use the main model in normal mode and the light model in light mode. The model bake-off (K3) fills the table later.

## Consequences
* The legacy `GET /ai-usage/today` (micros, operator view) now reports the hard cap as `cap_micros`; the screens should move to `/ai-usage`.
* Tests that exhausted the old default cap set an explicit cap or plan allowance now (pgTAP 49, 52, 75; integration).
* The light model is optional: unset, the main model keeps serving until the 300 % wall.
* Evals run in light mode too: the 30 assistant cases and the agent containment cases with the scripted model (`tests/integration/test_assistant_evals.py`, `test_agent_evals.py`).
