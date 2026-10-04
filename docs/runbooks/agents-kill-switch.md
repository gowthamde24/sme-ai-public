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

One agent only (for example the selftest agent), leaving the rest: `where key = 'selftest_enabled'` instead.

Verify it took effect:

```sql
select key, enabled from public.platform_flags order by key;
-- expect: agents_enabled = false. Every start answers 409 agents_disabled in every workspace, and every running run ends as
-- 'killed' at its next step:
select status, count(*) from public.agent_runs where created_at > now() - interval '1 hour' group by status;
```

To turn agents back on, set the flag back to `true`, **and** check that the workspace switches and the agent's allow-list
(`agent_definitions.allowed_tenants`) are what you intend: a platform flag never opens an agent to a workspace by itself.

## Belt and braces

If the API process itself must stop (for example a runaway cost at the model provider): stop the process (this ends every
in-flight run), set `AGENTS_ENABLED=false` for the next start, **and** set the provider-side spend cap (the real limit; see
`docs/pre-pilot-checklist.md`). The database caps only what the runtime reports.
