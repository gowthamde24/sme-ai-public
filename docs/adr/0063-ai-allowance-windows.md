# ADR 0063: The AI allowance per plan, in two windows

Status: built locally (job AK / K2, 2026-10-10); nothing deployed. Related: ADR 0013 (daily cap), job AF (the Asia/Kolkata day), ADR 0061 (plans), ADR 0062 (Main agent).

## Context
The owner should see AI usage the way a usage meter shows it (a percentage of today's and this month's allowance) and never see paise or tokens. Until now there was one number: a daily cap in micros, enforced by the database.

## Decision
1. **One config table**, `plan_ai_allowances (plan, daily_paise, monthly_paise)`, for free_trial, starter, growth and business. Operator-managed (no client grant). The seeded numbers are placeholders for the owner to set.
2. **The monthly window** runs from `tenants.billing_anchor_at` (a paid period) or `trial_started_at`, in whole months, as Asia/Kolkata dates; a 31st anchor clamps like a calendar.
3. **The database enforces both windows through the function every enforcement point already calls.** `app.agent_daily_cap` is now: the workspace's own cap, else its plan's daily allowance, else the operator default, squeezed to `least(that, today's spend + what the month has left)`. The start of a run, the start of an assistant message, the authorisation of a model call and the settlement therefore refuse in both windows with no change to their code (SQLSTATE SM207 at a start, `daily_cap` at a call). Only agent runs and the assistant call them: quotes, orders, follow-ups and customers keep working.
4. **`public.ai_usage(tenant)`** (Owner, Admin) returns `{today_percent, month_percent, resets_at_today, resets_at_month, state}`; percent = spent / allowance rounded down, at most 100; state ok / warn (>= 80) / paused (100). **`public.ai_paused_until(tenant)`** (any member) returns when the AI is back. Neither returns an amount.
5. **The API** serves `GET /ai-usage` and answers a refused AI start or message with 429 **`ai_paused_until`** plus `until` (replacing `cost_cap_reached`). The old `GET /ai-usage/today` (paise) stays for the operator's view.

## Consequences
* A paid plan with a daily allowance above the operator's own-cap ceiling (20 rupees) works because the ceiling applies to overrides, not to plan values.
* A call is reserved at its worst case, so a call can be refused slightly before 100 %: `until` then falls back to the next Indian midnight.
* Changing a plan or a billing date is an operator `update` for now (checklist row).
