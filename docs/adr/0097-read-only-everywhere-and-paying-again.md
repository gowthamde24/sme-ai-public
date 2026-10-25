# ADR 0097: read-only everywhere, the hold while waiting for WhatsApp, and paying again (job DP, part 3)

Status: built on branch `api/dp-readonly-resume` (night run 26 Oct 2026). Addendum to ADR 0092.

## Context
Job DI made a workspace whose trial ends unpaid read-only, but the rule lived in two places that only partly agreed: an API check on non-GET requests, and the outbox claim in the database. Job DM added a second state, `trial_pending` (a plan chosen, WhatsApp not connected), in which sending, AI and calls must stay off while everything else can be set up. Nothing let an owner pay again after a lapse without starting a new trial.

## Decision
1. **One rule, one place** (`app/billing/gate.py`), asked by **one door**: `require_tenant_role`, which every route under `/v1/tenants/{tenant_id}` uses (a test walks every route of the application and fails for any that does not). A request is a `read`, a `change` or a `spend`.
2. **`change`** (any non-GET outside the four open prefixes `/billing`, `/data-exports`, `/deletion-requests`, `/exports`) is refused in a read-only workspace: 403 `workspace_read_only`. **`spend`** (sends a message, calls a model, starts a call, approves a campaign, reaches an outside service) is refused in a read-only workspace **and** while the workspace waits for WhatsApp: 403 `waiting_for_whatsapp`. The list of spending requests is data in the gate; a test proves every entry matches a real route, and another proves every write and every spending route refuses in read-only (listed from the application, so a new route is covered automatically).
3. **Everything else of a waiting workspace works** (catalogue, customers, assistant settings, and connecting WhatsApp itself).
4. **The worker leaves read-only and waiting workspaces alone** (`public.scheduler_tenants` leaves them out), so nothing of theirs is released, reminded, planned or run; the outbox claim already held their sends. Inbound events from outside (a customer's message, a payment provider's webhook) are still recorded: they are not requests of the business and they send nothing.
5. **`POST /billing/resume`** (Owner, second factor) starts a paid plan **at once with no new trial** after a lapse (the plan ended unpaid, or was cancelled): active for one month, the first month recorded as paid, the provider's next charge one month ahead. **After a lapse there is no new trial:** `can_start_trial` is false and `billing_start_trial` refuses (SM822); the owner pays again instead. A trial that is running, a plan that is active, a workspace waiting for WhatsApp and an exempt workspace cannot resume (409 `not_lapsed`).
6. **`AccessOut` says why sending is off** (`sending`, `waiting_for`) and whether the owner can pay again (`can_resume`), so one small answer drives the banner and every button.
7. **Customer Zero and the demo workspaces never lapse** (`app.operator_billing_exempt`, job DI): `scripts/exempt_demo_workspaces.py` sets it on the three staging demo workspaces; the runbook says how for Customer Zero when production exists.

## Consequences
- Everything is behind the platform's billing switch, which is off: `access` stays `full` and nothing is held until it is switched on (the waiting hold also needs it, as the outbox's did).
- The access answer is remembered for 30 seconds per workspace, so a change of state shows within half a minute; a failure to ask lets the request through (a billing hiccup never locks a business out; the database holds the sending anyway).
- The fake provider only; a real one changes nothing here.
