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

## Spending cap (per workspace, per Asia/Kolkata day since job AF)

Each workspace's agents may spend at most the **daily cost cap** (default 2.00; the Owner can set 0 to 20.00 for their workspace with
`set_tenant_daily_cost_cap`). A model call is reserved **before** it is made; when the day is full runs end as `failed` / `budget`, new
starts answer 429 `cost_cap_reached`, and each refusal leaves an `agent_cost.refused` audit event. Amounts are millionths of the billing
currency (2,000,000 = 2.00). Run as the database owner.

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
