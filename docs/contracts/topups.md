# Contract: running out before the month ends: alerts, top-ups, auto top-up, upgrade, overage, queueing, invoices (night 4 part E2, C1 -> C2)

Published BEFORE building; shapes are final unless a line says "draft". Branch `api/ds-topups` (based on `api/night4-combined`). Everything under `/v1/tenants/{t}/billing/...`, errors with the usual shape `{error:{code,message,...}}`. The API has no DELETE verb. **Payments are FAKE** (the fake provider; `checkout_ref` is `pm_fake_ok` or `pm_fake_declined`), invoices are fake records, **billing stays OFF** until the owner's gates (`billing_enforced` false: meters count and alert, nothing stops). AI stays "included, fair use": no AI rupees or tokens anywhere. Prices here are **placeholders** (`price_is_placeholder: true`) until the owner of the product sets them; the web shows "Test prices".

Two things are metered (unchanged): **AI call minutes** (`call_minutes`) and **business-initiated WhatsApp messages** (`whatsapp_messages`). Replies inside the customer's 24-hour window are never metered and never stop.

## 1. The meter grows (`UsageOut.call_minutes|whatsapp_messages`, `BillingOut.usage`, `GET /billing/usage`)
Existing fields stay. New fields (all additive):
```json
{ "kind": "call_minutes", "unit": "minutes", "used": 241.5, "allowance": 300, "remaining": 58.5, "percent": 80, "state": "notice", "included": true, "topup": 0,
  "plan_allowance": 300,              // the plan's own part of `allowance` (minutes or messages)
  "topup_balance": 200,               // unexpired top-up units still unused (inside `allowance` only once drawn; see rule 2)
  "next_topup_expiry": "2027-01-12",  // date the oldest unused top-up expires, or null
  "projected_run_out_on": "2026-11-21", // India date the allowance runs out at this period's pace; null when nothing used yet, when the pace will not use it up before the period ends, or when there is no ceiling
  "runs_out_before_period_end": true,
  "blocked": false,                   // true when a new call/message of this kind really cannot start now (state stopped AND overage not covering it)
  "overage": null | { "enabled": true, "units": 12.0, "spent_paise": 6000, "cap_paise": 50000, "rate_paise_per_unit": 500 },
  "queued": 12 }                      // call_minutes: leads whose call waits for minutes (status waiting_for_minutes); whatsapp_messages: messages held in the outbox
```
`state` is unchanged in meaning (`ok` < 80 percent, `notice` from 80, `stopped` at 100 or when none is included) with ONE addition: while **overage** is switched on and its monthly cap is not reached, a used-up meter reads `notice` (not `stopped`) and `blocked:false`; when the cap is reached it reads `stopped`, `blocked:true`.
`GET /billing/usage` (`UsageViewOut`) gains `queued_calls` (int) next to `period`, `usage`, `notices`.

## 2. How units are used (the rules in code)
1. Per period (India days, the workspace's month window): units used are `billing_usage_events` as before.
2. **Consumption order:** the **plan allowance first** (plus any operator top-up of the period, as before), **then the oldest unexpired top-up pack** (first purchased, first used). A top-up pack unit used is recorded as a draw; **unused top-up units carry over and expire 90 days after purchase** (`expires_at`). `allowance` = plan + (top-up units drawn this period) + (unexpired balance).
3. When a pack is empty and overage is on, further units are billed per unit at the overage rate until the monthly cap; then the kind stops.
4. When a kind is exhausted (and billing is ON): **calls are QUEUED, not lost**: the lead is captured as always; its outreach step gets `status:"waiting_for_minutes"` and the worker does not call. It becomes `waiting` again by itself **on a top-up, an upgrade, or the next period** (the worker checks each minute). Free WhatsApp replies inside 24 hours continue; business-initiated messages stay queued in the outbox (existing rule).

## 3. Alerts (80 and 100 percent)
At 80 and 100 percent of either kind the Owner gets, once per kind, level and period (the existing notice, `billing_notices`):
- a **Needs-you** item on Today: kind `topup_low` (80) / `topup_empty` (100), `target:{type:"billing", id:<tenant id>}`; texts "Your calls are at 80 percent of this month's minutes. At this pace they run out on 21 Nov. Top up." / "Your minutes are used up. Calls are queued (12 waiting). Top up to continue.";
- a **WhatsApp message to the Owner** (FAKE: recorded, nothing sent) and an **e-mail** (the existing sender: fake locally, Resend on staging), both in the Owner's language (en/te/hi/kn drafts) with the projected run-out date.
The worker sends them (`scheduler_usage_alerts_*`); each is marked per channel so a retry never sends twice.

## 4. Top-up packs (data) and purchase
`GET /billing/topups` (Owner, Admin) -> `TopupsOut`:
```json
{ "packs": [ { "code": "minutes_100", "kind": "call_minutes", "units": 100, "price_paise": 40000, "gst_rate_bp": 1800, "gst_paise": 7200, "total_paise": 47200, "price_is_placeholder": true },
             { "code": "minutes_300" }, { "code": "minutes_1000" }, { "code": "messages_100" }, { "code": "messages_300" }, { "code": "messages_1000" } ],
  "balance": { "call_minutes": { "units": 200, "lots": [ { "purchase_id": "uuid", "units_left": 200, "purchased_at": "ts", "expires_at": "ts" } ] }, "whatsapp_messages": { "units": 0, "lots": [] } },
  "settings": { "auto_minutes_pack": null, "auto_messages_pack": null, "auto_monthly_cap_paise": 0, "overage_minutes": false, "overage_messages": false, "overage_monthly_cap_paise": 0,
                "overage_rate_paise_per_minute": 500, "overage_rate_paise_per_message": 70, "auto_spent_paise": 0, "overage_spent_paise": 0 },
  "history": [ TopupPurchase ] }          // newest first, up to 20
```
`TopupPurchase`: `{ id, pack_code, kind, units, source: "manual"|"auto"|"operator", price_paise, total_paise, purchased_at, expires_at, units_left, invoice_id }`.
`POST /billing/topups` (Owner + second factor) body `{ "purchase_id": uuid, "pack_code": "minutes_300", "checkout_ref": "pm_fake_ok" }` -> `201 { purchase: TopupPurchase, invoice: Invoice, usage: UsageOut }`. The `purchase_id` is chosen by the client: the same id with the same pack answers `200` with the same body (nothing charged twice); with another pack `409 purchase_id_used`. Errors: `422 pack_unknown`, `402 payment_method_declined`, `403` (role / no second factor), `409 no_subscription` (there is no plan to attach it to; a workspace needs a plan, trial or paid), `503 billing_unavailable`.
Queued calls resume at once (the answer's `usage.call_minutes.queued` is then 0).

## 5. Auto top-up and overage settings
`PUT /billing/topups/settings` (Owner + second factor), body (all fields required):
```json
{ "auto_minutes_pack": "minutes_100" | null, "auto_messages_pack": "messages_300" | null, "auto_monthly_cap_paise": 200000,
  "overage_minutes": false, "overage_messages": false, "overage_monthly_cap_paise": 0 }
```
-> the `settings` object above. **Both are OFF by default.** Auto top-up of a kind: when that kind reaches 100 percent and the month's auto top-ups plus the pack's total would stay within `auto_monthly_cap_paise` (GST included), the pack is bought automatically (source `auto`, fake payment, a normal invoice, the Owner is told by the same alert channels); it needs a plan with a payment method on file. Overage: needs `overage_monthly_cap_paise > 0` (else `422 cap_required`); units beyond all packs are charged at the overage rate until the cap is spent; billed on one invoice when the period ends (kind `overage`). `422 pack_unknown` / `422 pack_wrong_kind`.

## 6. Mid-month upgrade, pro-rata
`GET /billing/upgrade-preview?plan_id=calls_1000` (Owner, Admin) -> `{ "from_plan_id", "to_plan_id", "price_set": true|false, "days_in_period": 30, "days_left": 11, "prorated_paise": 7333 | null, "gst_paise", "total_paise" | null, "new_allowances": { "call_minutes": 1000, "whatsapp_messages": 1000 }, "effective": "now", "note": "..." }`.
Pro-rata = (new monthly price - old monthly price) x days_left / days_in_period, rounded half up to the paise; prices are the plan catalogue's (null until the owner of the product sets them: then `price_set:false`, `prorated_paise:null`, the upgrade is still allowed and records a zero-rupee invoice flagged `fake`).
`POST /billing/upgrade` (Owner + second factor) `{ "plan_id", "checkout_ref" }` -> `{ billing: BillingOut, invoice: Invoice|null }`: the new plan's **allowance applies immediately**, the period does not move, queued calls resume. Only an `active` or `trialing` subscription can upgrade to a plan with a higher `sort` (`409 not_an_upgrade`, `409 no_subscription`, `422 plan_unknown`, `402 payment_method_declined`).

## 7. Invoices (fake records with GST fields)
`GET /billing/invoices?cursor=` (Owner, Admin) -> `{ items: [Invoice], next_cursor }` newest first; `GET /billing/invoices/{id}` -> `Invoice`:
```json
{ "id": "uuid", "number": "S19-2610-000001", "kind": "topup"|"upgrade"|"overage", "description": "Top-up: 300 minutes", "issued_at": "ts", "period_start": "2026-10-01"|null,
  "taxable_paise": 108000, "gst_rate_bp": 1800, "cgst_paise": 0, "sgst_paise": 0, "igst_paise": 19440, "total_paise": 127440,
  "seller": { "name": "...", "state_code": "36", "gstin": null }, "buyer": { "gstin": "29ABCDE1234F1Z5"|null, "state_code": "29"|null },
  "fake": true, "payment_status": "paid_fake" }
```
Maths in whole paise: GST = round half up (taxable x rate_bp / 10000); **same state as the seller (buyer's state from the first two digits of the workspace GSTIN, set in Settings) -> CGST = floor(GST/2) and SGST = GST - CGST; any other case, or no GSTIN -> IGST = GST**. Prices are GST-exclusive; total = taxable + GST. The seller's name and state are placeholders until the owner of the product fills them; every invoice says `fake:true`.

## 8. Roles and gates
Owner and Admin read (`GET`s); the Owner with a second factor changes anything (purchase, settings, upgrade). A Sales member or Viewer: 403. Billing routes stay open in a read-only workspace. These are NOT "spend" requests (they are payments).

## 9. As built (added after the first publication; nothing above changed meaning)
- **Shapes** are in `packages/contracts/billing.schema.json` / `billing.ts` / `billing.examples.json` (keys `topups_get`, `topup_buy_request`, `topup_buy_response`, `topup_settings_request`, `invoices`, `upgrade_preview`, `upgrade_request`, `usage_view_queued`); the meter's new fields have defaults, so an older answer still reads.
- `POST /billing/topups` answers `201` for a new purchase and `200` for the same purchase id again. `GET /billing/invoices` pages 50 at a time (`?cursor=`, opaque).
- **Plan chosen but WhatsApp not connected** (`trial_pending`) counts as a trial for the upgrade: nothing is charged, the chosen plan changes. A cancelled or past-due subscription cannot upgrade or buy (`409 no_subscription`).
- **Allowance maths:** `allowance` = the plan's part (+ the operator's top-ups of the period, as before) + the pack units already drawn this period + the unexpired, unused pack units. Packs are drawn only when the period's use passes the plan's part, oldest pack first (a draw is recorded per pack). Unused pack units carry into the next period and expire 90 days after purchase.
- **One monthly overage cap for the workspace**, shared by minutes and messages (`overage_monthly_cap_paise`); a started minute counts as a minute. The overage invoice (`kind: "overage"`, `period_start` = the first day of the period it closes) is made by the worker once the period has ended, only while billing is on, at most the cap.
- **Alerts** go out only while billing is ON (like every other reminder), never for an exempt (demo) workspace; the Today items (`topup_low`, `topup_empty`, customer label "Your plan", target `{type:"billing", id:<tenant id>}`) show only while billing is ON and only to the Owner and Admin; `topup_low` is replaced by `topup_empty` at 100 percent, and `topup_empty` stays only while no pack balance is left.
- **The alert e-mail and the WhatsApp message to the owner** are in English, Telugu or Hindi (drafts; Kannada falls back to English); the database has no owner-language column yet, so the worker asks for `en`.
- **Queued calls:** an outreach item the worker cannot start for want of minutes becomes `waiting_for_minutes` (its next step is kept); it is `waiting` again on a top-up, an upgrade, a change of the overage setting, or when the meter is open at the next worker minute (the next period). The batch `progress` keeps counting it in `waiting` and adds `waiting_for_minutes` (the subset); excluding a person or cancelling the batch stops it too. A call that connected puts its seconds on the meter.
