# Runbook: stopping agents (the three kill-switch levels)

Agents can be stopped at three levels. Each is a plain SQL statement run as the **database owner** (the `postgres` role): no
application role can do any of them except level 1 (an owner, admin or the run's starter can cancel a run in the app), because the
platform switch, the limits and the agent definitions have no application grant (ADR 0013 decisions 2, 3, 9).

How a run notices: **every** agent write re-checks the run, the switches and the starter's role inside the database function, so a
stopped run writes nothing more, even if its process is still alive. The run ends as `cancelled` (level 1) or `killed` (levels 2
and 3) at its next step. A process restart also drops every in-flight run (they read as `expired` after their expiry).

Where to run it:
- **Local stack:** `docker exec -i supabase_db_<project_id> psql -U postgres -d postgres` (the project id is in `supabase/config.toml`).
- **Hosted project:** the SQL editor, as the owner role. Confirm first that you are connected as `postgres` (`select current_user;`).

Find what is running (any level):

```sql
select r.id, t.slug as workspace, r.agent_name, r.status, r.created_at, r.expires_at, r.writes_used, r.max_writes
  from public.agent_runs r join public.tenants t on t.id = r.tenant_id
 where r.status = 'running' and r.expires_at > now()
 order by r.created_at;
```

## Level 1: cancel ONE run

Preferred: the **Cancel** button on the Agents page (owner, admin, or whoever started it), or `POST /v1/tenants/{tenant}/agent-runs/{run}/cancel`.
As the operator (when the app is unavailable). Replace `:RUN_ID`:

```sql
update public.agent_runs
   set status = 'cancelled', cancel_requested_at = now(), cancelled_by = '00000000-0000-0000-0000-000000000000',
       finished_at = now(), error_code = 'cancelled'
 where id = ':RUN_ID' and status = 'running';
```

Verify it took effect:

```sql
select id, status, error_code, finished_at, writes_used from public.agent_runs where id = ':RUN_ID';
-- expect: status = cancelled. Run it again after ~10 seconds: writes_used must not have grown.
```

## Level 2: switch agents off for ONE workspace

Preferred: the **Turn agents off** button on the Agents page (owner or admin). As the operator. Replace `:SLUG`:

```sql
update public.tenant_agent_settings
   set enabled = false, updated_at = now()
 where tenant_id = (select id from public.tenants where slug = ':SLUG');
```

Verify it took effect:

```sql
select t.slug, s.enabled from public.tenant_agent_settings s join public.tenants t on t.id = s.tenant_id where t.slug = ':SLUG';
-- expect: enabled = false. New starts now answer 409 agents_disabled, and every run of that workspace that was still running
-- ends as 'killed' (error_code 'killed') at its next step:
select r.id, r.status, r.error_code from public.agent_runs r join public.tenants t on t.id = r.tenant_id
 where t.slug = ':SLUG' order by r.created_at desc limit 5;
```

To turn it back on: set `enabled = true` (or use the button).

## Level 3: switch ALL agents off (platform)

```sql
update public.platform_flags set enabled = false where key = 'agents_enabled';
```

One agent only, leaving the rest: `where key = 'selftest_enabled'` (the selftest agent) or `where key = 'research_enabled'` (the Research Agent, which is also OFF and allowed for no workspace until the operator runs `app.operator_enable_research('<slug>')` in a LOCAL database) instead.

Verify it took effect:

```sql
select key, enabled from public.platform_flags order by key;
-- expect: agents_enabled = false. Every start answers 409 agents_disabled in every workspace, and every running run ends as
-- 'killed' at its next step:
select status, count(*) from public.agent_runs where created_at > now() - interval '1 hour' group by status;
```

To turn agents back on, set the flag back to `true`, **and** check that the workspace switches and the agent's allow-list
(`agent_definitions.allowed_tenants`) are what you intend: a platform flag never opens an agent to a workspace by itself.

## Spending: the allowance, the light model and the hard pause (job AK K2b, ADR 0064)

AI is included in every plan under **fair use**. Each plan has a daily and a monthly **allowance** (`plan_ai_allowances`, paise; free trial 20 / 300 rupees, starter 15 / 300, growth 40 / 900, business 100 / 2,500). The daily window is the Asia/Kolkata day; the monthly window runs from the billing date (or the trial start) in whole months.

| Spend, either window | What happens |
|---|---|
| under 80 % | nothing |
| 80 % | `GET /ai-usage` says `warn` |
| 100 % | **the AI does not stop.** The workspace's calls switch to the **light model** (`LLM_LIGHT_MODEL`) until that window resets; `GET /ai-usage` says `light` |
| 300 % | the AI **pauses** (`ai_paused_until`, with the time it is back). `GET /ai-usage` says `paused`. Quotes, orders, follow-ups and customers never pause |

The database enforces the 300 % wall (a run start, a message start and every model call are refused with no room); the API only chooses the model. A light model with **no price row** is never used (the workspace stays on the main model, still capped), so a missing price can never stop the AI.

**Setting up the light model (operator, once):** set `LLM_LIGHT_MODEL`, `LLM_LIGHT_INPUT_MICROS_PER_MTOK` and `LLM_LIGHT_OUTPUT_MICROS_PER_MTOK` in the API's environment (all three or the API refuses to start), and add the same prices to the database, as you did for the main model (replace :MODEL_ID and the two example prices; for `claude-haiku-4-5-20251001` the environment is `LLM_LIGHT_MODEL=claude-haiku-4-5-20251001 LLM_LIGHT_INPUT_MICROS_PER_MTOK=90000000 LLM_LIGHT_OUTPUT_MICROS_PER_MTOK=450000000`):

```sql
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok)
values (':MODEL_ID', 90000000, 450000000)  -- :MODEL_ID is the light model id (e.g. claude-haiku-4-5-20251001); the two numbers are that example's prices in the app's unit: use the provider's current prices
on conflict (model) do update set input_micros_per_mtok = excluded.input_micros_per_mtok, output_micros_per_mtok = excluded.output_micros_per_mtok, updated_at = now();
```

**Changing a plan's numbers:** `update public.plan_ai_allowances set daily_paise = ..., monthly_paise = ... where plan = '...'` (a day may not exceed 50,000 paise, the 500-rupee wall). **A workspace's own cap** (`set_tenant_daily_cost_cap`, Owner only, 0 to 500.00) is a *hard* cap and wins over the plan's 300 % wall: set lower than the allowance it pauses the AI earlier on purpose; 0 switches the AI off for that workspace.

**Which model for which task:** each agent call declares a task class (`simple` or `hard`); `app/agents/llm/routing.py` holds the table. Today both classes use the main model, and both use the light model while a workspace is over its allowance; the model bake-off will fill the table.

Amounts are millionths of the billing currency (2,000,000 = 2.00). Run the queries below as the database owner.

Today's spend and cap, per workspace:

```sql
select t.slug as workspace,
       app.agent_day_spend(t.id, app.agent_utc_today()) as spent_today,
       app.agent_daily_cap(t.id)                        as cap_today
  from public.tenants t
 order by spent_today desc;
```

The calls behind it (newest first), and what was refused:

```sql
select r.created_at, r.run_id, r.step_key, r.cost_day, r.model, r.reserved_micros, r.settled_micros
  from public.agent_cost_reservations r join public.tenants t on t.id = r.tenant_id
 where t.slug = ':SLUG' order by r.created_at desc limit 20;
select created_at, entity_id as run_id, new_values from public.audit_events
 where tenant_id = (select id from public.tenants where slug = ':SLUG') and action in ('agent_cost.refused', 'agent_cost.overshoot')
 order by id desc limit 20;
```

Open (never settled) reservations of a workspace, with their run's status. An open reservation counts at its WORST case until its Indian day ends
(a cancelled, expired or crashed run, or a call whose outcome is unknown); the Owner sees the same in the Agents page and `GET /agent-cost`:

```sql
select r.created_at, r.run_id, r.step_key, r.cost_day, r.reserved_micros, a.status as run_status
  from public.agent_cost_reservations r
  join public.agent_runs a on a.tenant_id = r.tenant_id and a.id = r.run_id
  join public.tenants t on t.id = r.tenant_id
 where t.slug = ':SLUG' and r.settled_micros is null
 order by r.created_at desc;
```

Stop a workspace's agents spending at once (a zero cap refuses every start and every model call; it applies from the next call):

```sql
insert into public.tenant_agent_settings (tenant_id, daily_cost_cap_micros)
values ((select id from public.tenants where slug = ':SLUG'), 0)
on conflict (tenant_id) do update set daily_cost_cap_micros = 0, updated_at = now();
-- back to the operator default: set daily_cost_cap_micros = null
```

The operator default (applies to every workspace without its own value; at most 20,000,000):

```sql
update public.agent_limits set limit_value = 2000000 where limit_key = 'daily_cost_micros';
```

Prices: **a model without a price row is refused** (fail closed). Add the real model's price from the provider's price list, and keep it equal
to `LLM_INPUT_MICROS_PER_MTOK` / `LLM_OUTPUT_MICROS_PER_MTOK`; prices must be above zero:

```sql
insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values (':MODEL_ID', 3000000, 15000000)
on conflict (model) do update set input_micros_per_mtok = excluded.input_micros_per_mtok,
                                  output_micros_per_mtok = excluded.output_micros_per_mtok, updated_at = now();
```

## Belt and braces

If the API process itself must stop (for example a runaway cost at the model provider): stop the process (this ends every
in-flight run), set `AGENTS_ENABLED=false` for the next start, **and** set the provider-side spend cap (the real limit; see
`docs/pre-pilot-checklist.md`). The database's daily cap limits what the runtime reserves and reports; it cannot see what the provider bills.


## The plan allowance (job AK / K2): a daily AND a monthly window

Every workspace has a plan (`tenants.plan`: free_trial, starter, growth, business). `public.plan_ai_allowances` holds, per plan, a daily and a monthly AI allowance **in paise** (the values in the migration are placeholders:
change them with an `update`; no code change). The daily cap of a workspace is its own override if one is set, else its plan's daily allowance, else the operator default (as before). The month runs from
`tenants.billing_anchor_at`, or from `trial_started_at` while that is null, in whole months (Indian dates). When either window is used up, **only** AI features pause (the assistant, research, requirement
drafting): the API answers 429 `ai_paused_until` with `until`. Quotes, orders, follow-ups and customers keep working.

```sql
update public.plan_ai_allowances set daily_paise = 500, monthly_paise = 15000 where plan = 'starter';
update public.tenants set plan = 'starter', billing_anchor_at = now() where slug = ':SLUG';   -- a paid period starts now
```
