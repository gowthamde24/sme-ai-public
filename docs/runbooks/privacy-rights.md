# Privacy rights: runbook (job BN, ADR 0075)

Local stack only. Nothing here needs a key, an account or money.

## What runs where
* The API (`make dev-api-local`) makes the export files and answers the routes. It needs Storage on (`make db-start`).
* The scheduler worker (`make dev-worker-local`) does the housekeeping: deletes accounts after the 14-day cooling-off, removes expired export files, runs the retention clean-up. It does it even while the outbox switches are off. With no worker, nothing is deleted or purged (an export file just stays until the worker runs).

## Try it
1. Sign in as a member; `POST /v1/me/data-exports {"export_id": "<new uuid>"}` -> 202; `GET /v1/me/data-exports/<id>` until `ready`; `POST /v1/me/data-exports/<id>/link` -> a URL that works for 5 minutes.
2. As an Owner (second factor): `POST /v1/tenants/<t>/data-exports` for the workspace.
3. To see the clean-up: in psql as the database owner, `update privacy.data_exports set expires_at = now() - interval '1 minute' where id = '<id>'`, then run one worker pass (`python -m app.scheduler.worker --once`).
4. To see a cooling-off end: `update privacy.deletion_requests set requested_at = now() - interval '15 days', execute_after = now() - interval '1 minute' where id = '<id>'` (and for a workspace also `update public.erasure_requests set execute_after = now() - interval '1 minute' where id = '<id>'`), then the worker pass (account) or `POST .../deletion-requests/<id>/execute` (workspace).

## Settings
| Setting | Meaning | Default |
|---|---|---|
| `TERMS_VERSION`, `PRIVACY_VERSION` | the current versions | 2026-10-01 |
| `TERMS_EFFECTIVE_FROM`, `PRIVACY_EFFECTIVE_FROM` | the day a version binds (empty = at once) | empty |
| `POLICY_ENFORCE` | refuse workspace routes until the binding versions are accepted | false |

To publish a new version: set the new version and an effective date a week ahead, tell people (the web shows `needs_acceptance` before the date), and set `POLICY_ENFORCE=true` once the web screen exists.

## Things to know
* The bucket of a person's exports is created on their first export; nothing is public.
* An export that stays "running" for 30 minutes is given up on the person's next request.
* Retention never touches the outbox, orders, quotes or evidence. A voice transcript is a user message of a run that was charged `voice-stt`.
* Deleting a workspace anonymises it (ADR 0014); it does not drop rows.
* To see what the worker did: its log lines `privacy housekeeping: ...` (counts only) and the `retention.run` / `account.deleted` audit events.
