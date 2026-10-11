# Runbook: the scheduler on the local stack (job AW, ADR 0068)

Everything here is local and synthetic. **Nothing is ever sent to anyone**: the only channel is the local stand-in (`OUTBOX_ADAPTER=fake`). The worker is one extra process; it needs no queue, no account and nothing paid.

## What it does, every minute
1. **Releases** outbox messages that are due: held for the morning (quiet hours 21:00 to 09:00 India time), or queued and not yet handed over. The send policy, the STOP / erasure / no-key / opt-in / daily-limit checks and quiet hours are checked again at that moment, by the database; the worker cannot skip them.
2. **Queues visit reminders** through the outbox (the same policy as any message): *the evening before* (from 18:00 by default, never after 21:00) and *a few hours before* (120 minutes by default, never closer than 30 minutes, never in quiet hours). One per visit, kind and start time. A visit that moves is reminded again for its new time. Only for a **confirmed** visit.
3. **Marks missed visits** `no_show` a number of minutes after the slot ended (default 30), only for a confirmed visit. **Off** unless the Owner switches it on.

## It does nothing unless BOTH switches are on
| Switch | Who | Default |
|---|---|---|
| Global outbox kill switch | the operator: `./scripts/dev-enable-outbox.sh on` (`make seed-demo-outbox` also turns it on locally) | OFF |
| Automatic sending for the business | its Owner, second factor: `PUT /v1/tenants/{id}/outbox/settings {"auto_send_enabled": true, "per_customer_daily_limit": 3}` | OFF |

While the global switch is off the database lists no business, so the worker's tick is a heartbeat and nothing else. **A message the Owner approved is released even when the business's automatic sending is off** (approval is the Owner's consent to send; job AY): the business is then visited for that, and for nothing else. Quiet hours, STOP, opt-in, erasure and the daily limit still apply at that moment. A message that was allowed automatically earlier and still waits when automatic sending is switched off is NOT released (nobody approved it): it waits for "dispatch now" (`POST /outbox/dispatch`). Reminders and the no-show need automatic sending on.

## Run it
```
make db-start
make dev-api-local API_PORT=8001     # ports 3000 and 8000 are the owner's demo; use 8001 for your own
make seed-demo-manual                # once: the DEMO business (SEED_API_URL=http://localhost:8001 if your API is on 8001)
make seed-demo-outbox                # switches the global switch on locally and the demo's automatic sending on
make dev-worker-local                # leave running; Ctrl-C stops it
make dev-worker-local ARGS=--once    # one tick, then exit
```
The first run of `make dev-worker-local` creates the worker's account (`scheduler@system.example.test`, a constant local password, the same idea as the demo owner), confirms its e-mail through the local database container and registers it as the scheduler (`app.operator_register_scheduler`). It refuses any Supabase address that is not this machine. The account's address and password reach the worker through its environment only and are never printed.

The worker prints one line a tick, counts only: `scheduler tick: tenants=1 sent=0 failed=0 reminders=0 no_shows=0 errors=0`. No word of a message, no phone number, no name, no id.

## The Owner's settings and card (for the web later)
* `GET /v1/tenants/{id}/scheduler/status` (Owner, Admin): `platform_switch_on`, `auto_send_enabled`, `active` (both on), `releases_approved` (the global switch is on: approved messages go whatever automatic sending says), `worker_running` (heard from within three intervals), `last_run_at`, `next_run_at`, `interval_seconds`, `last_activity_at` and `today` (this India day: `sent`, `failed`, `reminders`, `no_shows`, `errors`).
* `GET|PUT /v1/tenants/{id}/scheduler/settings` (read: Owner, Admin; write: Owner with a second factor): `reminder_evening_enabled`, `reminder_evening_hour` (9 to 20), `reminder_heads_up_enabled`, `reminder_heads_up_minutes` (60 to 480), `no_show_enabled`, `no_show_after_minutes` (5 to 720). A business that never saved its own has the defaults (`is_default`).

## Two workers
Safe. The database hands each message and each reminder to exactly one of them (row locks with SKIP LOCKED, a two-minute lease, one record per reminder under a per-visit lock). Do not start two for fun: there is nothing to gain.

## When something looks wrong
| You see | Meaning |
|---|---|
| `scheduler: invalid scheduler configuration ...` and exit 2 | `SCHEDULER_EMAIL` / `SCHEDULER_PASSWORD` missing or the interval outside 5 to 3600 seconds. `make dev-worker-local` sets them. |
| `scheduler sign-in refused: http=400` every tick | the account does not exist or its password changed. Run `make dev-worker-local` again (it recreates and re-registers the local account). |
| every call refused (`scheduler tick ... errors=1`, status 403/42501 in the data layer) | the account is not registered (or was removed). `make dev-worker-local` registers it. |
| `tenants=0` for ever | one of the two switches is off. Check `GET /scheduler/status` (`platform_switch_on`, `auto_send_enabled`). |
| a reminder you expected did not come | it is only for a **confirmed** visit, never in quiet hours, not when the customer was told after the window opened, and not twice for the same time. A language other than English waits for a person in the approval queue (`uncertain`). |
| the same message twice after a crash | a tick that died between the channel and the database is offered again after two minutes with the SAME message id. The local fake does not care; a real adapter must use that id as its idempotency key (ADR 0066). |

## Stopping and removing
Ctrl-C (or SIGTERM) stops the worker; it finishes the tick it is in. To take its power away without touching the process: `docker exec -i supabase_db_sme-ai psql -U postgres -c "select app.operator_remove_scheduler('scheduler@system.example.test')"`; its next call is refused. `./scripts/dev-enable-outbox.sh off` stops all sending. `make db-reset` removes everything.

## Hosted (later, not now)
Not deployed and not planned before the Customer Zero stage (ADR 0017). When it is: create the worker's account like any account, register it with `app.operator_register_scheduler` run by the operator in the database, keep its password in the host's secret store (`SCHEDULER_EMAIL`, `SCHEDULER_PASSWORD`), run one worker process. Decide first whether one principal for all businesses is enough (`docs/pre-pilot-checklist.md`).
