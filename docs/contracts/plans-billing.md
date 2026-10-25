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
| `POST /v1/tenants/{tenant_id}/billing/trial` | Owner | body `TrialStartIn` `{plan_id, checkout_ref}` -> `BillingOut` (status `trialing`). The 30-day trial starts with a payment method on file; **nothing is charged during the trial** |
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
