# Plans and billing: the API contract for the Plan screens (job DI, ADR 0092)

**Status: the shapes are final for the Plan screens; the endpoints are built on this branch (`api/di-plans-billing`) tonight.** Until they are on a deployed API, build against the example payloads (`packages/contracts/billing.examples.json`: one per screen state, validated by a test against the schema).

Files (generated from `services/ai-api/app/billing/models.py` by `make contracts`; a test fails if they are stale):
- `packages/contracts/billing.schema.json` (JSON Schema, the source of truth)
- `packages/contracts/billing.ts` (TypeScript interfaces)
- `packages/contracts/billing.examples.json` (mock payloads)
- the plans themselves are data: `packages/plans/plans.json` (+ `plans.schema.json`)

## What an owner is shown (and nothing else)
Two things are metered: **AI call minutes** and **business-initiated WhatsApp messages**. AI itself is "included, fair use" on every plan: **no AI rupees, tokens or allowances appear in any shape** (a test enforces it). Prices are **null** until the owner of the product sets them (`price_set: false`: show "price to be announced").

## Endpoints
All JSON. Errors use the usual `{error: {code, message, ...}}` shape.

| Method and path | Who | Answer |
|---|---|---|
| `GET /v1/plans` | any signed-in user | `PlansOut`: the catalogue (7 plans: `free_trial`, `starter`, `growth`, `business`, `calls_payg`, `calls_300`, `calls_1000`; ids are data, never hard-code them, loop over `plans` sorted by `sort`, group by `kind`). **Calls-only plans include business WhatsApp messages for call follow-ups: Calls 300 = 300 minutes + 300 messages, Calls 1,000 = 1,000 + 1,000. Pay-as-you-go is billed per minute AND per message: `allowances.call_minutes` and `allowances.whatsapp_messages` are both `null` (nothing included, no ceiling) and `price_paise_per_minute` / `price_paise_per_message` hold the rates (null until set).** `whatsapp_messages` is therefore `number | null`; a meter with `allowance: null` has no bar |
| `GET /v1/tenants/{tenant_id}/billing` | Owner, Admin | `BillingOut`: the plan in force, the subscription (or null), the period, both meters, the notices, `can_start_trial`, and **`access`** (`"full"` or `"read_only"`, with `read_only_since`, `delete_on`, `data_days_left`) |
| `GET /v1/tenants/{tenant_id}/billing/access` | any member (a Viewer too) | `AccessOut`: just `access` and the three dates, small enough for every page's header |
| `GET /v1/tenants/{tenant_id}/billing/usage` | Owner, Admin | `UsageViewOut`: the same period, meters and notices only (small; for a banner on Today) |
| `POST /v1/tenants/{tenant_id}/billing/trial` | Owner | body `TrialStartIn` `{plan_id, checkout_ref}` -> `BillingOut` (status `trialing`). The **14-day trial counts from the day the workspace's WhatsApp is connected** (owner decision 25 Oct 2026). Choosing a plan starts it with a payment method on file; **nothing is charged during the trial**. Chosen **before** WhatsApp is connected, the subscription is **`trial_pending`** (see below) |
| `POST /v1/tenants/{tenant_id}/billing/cancel` | Owner | `BillingOut`. Cancelling during the trial = no charge, ever. Cancelling an active plan ends it at the end of the paid period (`cancel_at_period_end: true`) |

`checkout_ref` is what the payment provider's checkout returns for the payment method. Only the **fake** provider exists now: use `pm_fake_ok` (charges succeed), `pm_fake_declined` (the trial cannot start: HTTP 402 `payment_method_declined`) or `pm_fake_declines_on_renewal` (the trial starts, the first charge fails: the subscription becomes `past_due`). A real provider (Razorpay) later changes only what the browser's checkout produces, not these shapes.

## Read-only (the trial ended unpaid), `access`
`access` is `"full"` or `"read_only"` (owner decision 25 Oct 2026). **`read_only` = view and export only: switch every edit, send, AI and call button off** and show the dates: `read_only_since` (the day it began), `delete_on` (the data is kept 90 days, then deleted) and `data_days_left`. Signing in, viewing, exporting, asking for a copy of the data, asking for deletion and choosing a plan (`/billing/*`) still work; every other change answers **403 `workspace_read_only`** (also the AI and the messages: the outbox holds all sending). The Owners get e-mails at day 1, 30, 60 and 83 of read-only. A workspace is `read_only` when: it has no subscription and 30 days have passed since it was made; or its trial ended with no first charge (one day of grace); or a failed payment's grace period (7 days) ended; or a cancelled plan's paid period ended (a cancel during the trial keeps the rest of the trial). **`access` is always `"full"` while the platform's billing switch is off** (it is off today), so build the screens now and they come alive when it is switched on. Examples: `billing_read_only_trial_ended`, `access_full`, `access_read_only`.

## Rules the screens can rely on
- `BillingOut.plan` is the plan whose allowances apply **now**: while `subscription.status == "trialing"` it is the trial plan (`free_trial`: 30 minutes, 100 messages), whatever `subscription.plan_id` (the plan chosen) says. After the first successful charge it is the chosen plan.
- A meter: `used` (minutes with one decimal, or a count), `allowance` (includes top-ups; **null = pay as you go: no ceiling**), `percent` (whole 0 to 100, null without a ceiling), `state`:
  - `ok` under 80 percent, `notice` from 80 percent, `stopped` at 100 percent **or when the plan includes none** (`included: false`: show an upgrade prompt, not a bar).
- **At 100 percent that kind stops for this workspace until a top-up or the next period** (minutes: no new AI call is started; messages: business-initiated WhatsApp messages stay queued, not lost). **Quotes, orders, follow-ups and customers never stop.** Replies inside the customer's 24-hour window are not metered.
- `notices`: at most one event per kind per level per period (`level` 80 or 100). Show them as a dismissible banner; they are facts, not toasts.
- Period: India days (`Asia/Kolkata`), `end` is the last day; `days_left` counts today.
- `can_start_trial` is false once any subscription exists (a trial is started once per workspace).
- Errors the screens should have words for: `workspace_read_only` (403), `plan_unknown` (422), `trial_already_started` (409), `payment_method_declined` (402), `plan_limit_reached` (409, from the call/message start paths), `forbidden` (403, a role without access).

## Example (a Growth trial at 83 percent of its messages)
See `packages/contracts/billing.examples.json`, key `billing_trialing_notice_at_80`.


## The trial: 14 days from the day WhatsApp is connected (job DM, owner decisions 25 Oct 2026)
- `PlansOut.trial`: `days` 14, **`starts_on`** `"whatsapp_connected"` (version 1 had `"sign_up"`), **`setup_days_without_whatsapp`** 30, `payment_method_at_start`, `grace_days_after_failed_payment`. All trial wording reads `trial.days`.
- `SubscriptionOut.status` gains **`trial_pending`**: the plan is chosen and a payment method is on file, but WhatsApp is not connected, so **`trial_ends_at` is null** and **`trial_waiting_for` is `"whatsapp"`** (null in every other state; it replaces the earlier boolean). **Nothing is charged.** The workspace can set up everything (catalogue, customers, AI assistant settings): `access` stays `"full"`. **Sending, AI calls and campaign sends stay off until WhatsApp is connected** (messages stay queued; behind the billing switch, which is off today). The day WhatsApp becomes active the status turns **`trialing`** and `trial_ends_at` is that day + 14.
- `BillingOut.whatsapp_connected_at`: the day the number first became active, or null.
- A `trial_pending` workspace is never made read-only for waiting. If WhatsApp is still not connected 30, 60 and 90 days after the plan was chosen, the Owners get a reminder e-mail (fake sender for now).
- Cancelling a `trial_pending` or `trialing` subscription ends it at once; nothing was ever charged.
- A workspace with no subscription at all is read-only 14 days after WhatsApp was connected (30 days after it was made if it never connected), once the billing switch is on.
- Examples: `billing_trial_pending_waiting_for_whatsapp`, `billing_trialing_notice_at_80` (its `whatsapp_connected_at` and `trial_ends_at`).


## Read-only everywhere, the hold while waiting for WhatsApp, and paying again (job DP part 3, 26 Oct 2026; branch `api/dp-readonly-resume`)
**One rule in one place** (`services/ai-api/app/billing/gate.py`), applied to every route under `/v1/tenants/{tenant_id}` (a test lists all of them). Three kinds of request:
- **read** (every GET, and `/billing`, `/data-exports`, `/deletion-requests`, `/exports`): always open, also when read-only. The one GET that spends, `/leads/search` (the outside lead search), is held like a send.
- **change** (every other POST, PUT, PATCH, DELETE): 403 **`workspace_read_only`** in a read-only workspace.
- **spend** (sends a message, calls a model, starts a call, approves a campaign, reaches an outside service: the Ask dock `/assistant/*`, `/agent-runs`, drafts and their approvals, `/outbox/*` send and approve, `/call-requests/*` approve and connect, `/campaigns/*/approve|resume`, `/ai-assistant/test-call`, `/voice-notes/preview`, `/institution/marks-messages/send`, `/payment-links/*/send`, `/trips/*/notify` ...): 403 `workspace_read_only` when read-only, **and 403 `waiting_for_whatsapp` while the workspace has chosen a plan but not connected WhatsApp** (`trial_pending`). Everything else a waiting workspace does (catalogue, customers, assistant settings, connecting WhatsApp) works.
The worker never runs a read-only or waiting workspace, and the outbox's claim already held its sends. Inbound events from outside (a customer's WhatsApp message, a payment provider's webhook) are still recorded; they send nothing.

**`AccessOut` gains three fields** (build the banner and the button states from them):
| Field | Meaning |
|---|---|
| `can_resume` | the plan has lapsed (trial or paid period ended unpaid, or it was cancelled): show "Choose a plan to continue" |
| `sending` | `"off"` while the workspace is read-only OR still waiting for WhatsApp: switch the send, AI, call and campaign buttons off |
| `waiting_for` | `"whatsapp"` while `trial_pending`, else null (word the hold: "Connect WhatsApp to start"; read-only gets its own words) |
**`BillingOut` gains `can_resume`.** **`can_start_trial` is false after a lapse**: there is no new trial; pay again.

**`POST /v1/tenants/{tenant_id}/billing/resume`** (Owner, second factor): body `ResumeIn` `{plan_id, checkout_ref}` (same values as the trial's) -> `BillingOut` with `subscription.status` `active`, `can_resume` false, `access` `full`. A paid plan starts **at once with no new trial**: the first month is recorded as paid, the period runs one month, the provider's next charge is one month ahead. Works from read-only (it is under `/billing`). Errors: **409 `not_lapsed`** (a trial is running, a plan is active, the workspace waits for WhatsApp, or it is exempt), 422 `plan_unknown`, 402 `payment_method_declined` (nothing starts), 403 `mfa_required`, 403 for anyone but the Owner. Example request: `resume_request`.

**Exempt workspaces** (Customer Zero and the demo workspaces) never lapse: `access` is always `full` and `can_resume` false. The operator switch is `app.operator_billing_exempt(tenant, true)` (docs/runbooks/billing-exempt.md).
