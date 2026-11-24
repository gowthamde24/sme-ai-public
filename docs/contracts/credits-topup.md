# Credits top-up through Razorpay (24 Nov 2026)

For the web team. Flag: **`PRICING_V2`** (on in staging, off in production; every route here is a plain 404 when it is off). Money is in rupees and paise; **no answer and no string says "credits"** (1 credit = ₹1 inside; the screen says "balance"). A top-up never expires. Razorpay is in **test mode** until the owner supplies live keys and sets `RAZORPAY_LIVE_OK`; every order and the options say `mode: "test" | "fake" | "live"` so the page can show a visible "Test payment" badge whenever `mode != "live"`.

Everything below is under `/v1/tenants/{tenant_id}/billing`. Errors have the usual body `{"error": {"code", "message", ...}}` (codes in `error-codes.md`).

## The journey

1. `GET /credits/topup-options` (Owner, Admin) -> the four amounts, the custom range, GST, the mode.
2. The owner picks ₹500 / ₹1,000 / ₹2,000 / ₹5,000 or types a whole number of rupees (₹100 to ₹1,00,000). Show **amount, GST and total as three lines** (the answer has all three as numbers and as text).
3. `POST /credits/topups` `{ "amount_rupees": 1000 }` (Owner) -> the checkout-ready order. Open Razorpay Checkout with `key_id`, `order_id`, `amount_paise`, `currency`, `name`, `description`. Nothing secret is in the answer; `key_id` is the public key id.
4. Checkout's `handler(response)` -> `POST /credits/topups/{order_id}/confirm` `{ "payment_id": response.razorpay_payment_id, "signature": response.razorpay_signature }` (Owner). The signature is checked on the server; then the balance is topped up once and the GST invoice is written. Safe to repeat (`replayed: true`), and safe when Razorpay's webhook got there first.
5. Checkout's `payment.failed` handler or `modal.ondismiss` -> `POST /credits/topups/{order_id}/failed` `{ "reason": "failed" | "dismissed" | "cancelled" }` (Owner). It only records why; the same order can still be paid (the customer may retry inside the same Checkout) and then settles normally.
6. If the page is closed after paying, the **signed webhook** (`POST /v1/webhooks/razorpay-billing`, events `order.paid` and `payment.failed`) does step 4 by itself. After a payment, poll `GET /credits/topups` (or `GET /balance`) for a few seconds until the order says `paid`; never trust the browser alone.

| Route | Who | Answer |
|---|---|---|
| `GET /credits/topup-options` | Owner, Admin | `{gst_percent, presets: [{added_paise, gst_paise, total_paise, added_text, gst_text, total_text}], custom_min_rupees: 100, custom_max_rupees: 100000, mode, checkout_ready}` |
| `POST /credits/topups` | Owner | `{provider, mode, order_id, key_id, currency: "INR", amount_paise (the total to charge), added_paise, gst_paise, added_text, gst_text, total_text, name, description}` |
| `POST /credits/topups/{order}/confirm` | Owner | `{state: "paid", replayed, added_text, balance: BalanceOut, invoice_number}` |
| `POST /credits/topups/{order}/failed` | Owner | `{recorded}` (false when the order is unknown or already paid: ignore) |
| `GET /credits/topups?limit=20` | Owner, Admin | `{items: [{order_id, state, added_paise, gst_paise, total_paise, added_text, total_text, failure_code, failure_text, created_at, paid_at, invoice_number, refunded}]}` |
| `GET /credits/statement?from=&to=&limit=&before=` | Owner, Admin | see below |
| `GET /gst-invoices` (existing) and `GET /gst-invoices/{number}` | Owner, Admin | the list, and one invoice in full |
| `GET /balance` (existing) | any member | now carries `low` (see below) |

`state` of a top-up: `pending` (made less than an hour ago, not paid), `paid`, `failed` (`failure_code` says why; `failure_text` is the sentence to show), `abandoned` (older than an hour and never paid). An abandoned or failed order is not money lost: nothing was charged by us. If a late payment arrives for it, it settles and the state becomes `paid`.

`failure_code` words: `payment_failed`, `bank_declined`, `payment_cancelled`, `dismissed`, `amount_mismatch` (the amount Razorpay says was paid is not the order's total: **nothing is added**, support looks at it; the web shows `failure_text`).

## The money

* The amount the customer chooses is what is **added to the balance** (before GST). GST is 18 % **added on top**, rounded half up to the paisa, shown separately: ₹500 -> +₹90 = ₹590; ₹1,000 -> +₹180 = ₹1,180; ₹2,000 -> +₹360 = ₹2,360; ₹5,000 -> +₹900 = ₹5,900; a custom ₹333 -> +₹59.94 = ₹392.94. The server prices the order; the database stores it; the payment is credited at the **stored** amount, and only when the paid amount equals the stored total.
* Whole rupees only (a credit is a rupee): `amount_rupees` is an integer from 100 to 100000 (422 `topup_amount_invalid` otherwise; the request model also refuses decimals and strings with a plain 422).
* The same payment id credits **once**, whatever the order of arrival (browser, webhook, repeats, many at once): the database serialises on the order. A different payment id for an order already paid, or one payment id for a second order, never credits again.

## Low balance

`GET /balance` -> `low: true` when **no included call minutes are left** in the period and the balance covers **fewer than 4 minutes** of calls at the plan's rate (₹20 at ₹5 a minute). The web may show a banner and a "Top up" button at once. The same fact is the Today "Needs you" item `credits_low` (Owner and Admin; target `{type: "billing", id: <workspace id>}`; it goes by itself after a top-up; see `today-summary.md`). The web must handle the new kind (an unknown kind is dropped by the parser).

## Statement

`GET /credits/statement` -> `{items, has_more, next_before, opening_paise, closing_paise, opening_text, closing_text, balance_paise, balance_text}`. Newest first. Each item: `{at, kind: "credit" | "usage" | "refund" | "expiry", label, amount_paise (positive added, negative taken), amount_text, balance_after_paise, balance_after_text, ref, invoice_number}`. Credits are top-ups (with their `invoice_number`), the free start, and amounts added by Stack19; usage is a call or a Lead Finder search (what was really taken); `refund` is a refund of unused balance; `expiry` is a free-start balance that ran out of its days (a top-up never expires). `from` and `to` are dates (India time, both days included); page with `before=<next_before>`. The closing line equals the balance when no `to` is given.

## GST invoices

One invoice per paid top-up, written in the same transaction as the credit. `GET /gst-invoices/{number}` (Owner, Admin) -> `{number, kind: "topup" | "credit_note" | "subscription" | "payg_fee", issued_at, description, subtotal_*, gst_*, total_*, gst_percent, tax_split: "cgst_sgst" | "igst" | null, cgst_paise, sgst_paise, igst_paise, against_number, buyer_name, buyer_gstin, buyer_state_code, seller_name, seller_gstin, seller_address, seller_sac, seller_details_missing}`.

* **Number**: `S19-2627-000001` = series, financial year (April 2026 to March 2027), a counter that restarts each year, one series for everybody, gapless (a payment that fails leaves no hole), 15 characters (the GST limit is 16). Older invoices keep their `S19-2026-000123` form.
* **Buyer** details are copied when the invoice is issued: the workspace name and the GSTIN of **Settings, Business profile** (`PUT /business-profile`). The seller's company name, GSTIN, address and SAC are operator settings that the owner of the product enters in the database (`pricing.settings`); until then `seller_details_missing: true`: show the invoice as a **draft** (it is not yet a valid tax invoice).
* **Split**: with the seller's GSTIN known, the buyer in the same state (or with no GSTIN) pays CGST 9 % + SGST 9 %, another state IGST 18 %. Unknown seller: `tax_split: null` and the whole GST is in `gst_paise`.
* A refund issues a **credit note** (`C19-2627-000001`, `kind: "credit_note"`, `against_number` = the invoice it reduces).
* The page prints the numbers; the server sends no PDF.

## Refunds (Stack19 staff only, not the shop)

`POST /v1/admin/businesses/{tenant_id}/topups/{order_id}/refund` `{reason_code, reason_text, idempotency_key}` (admin console on; staff role owner or finance; a fresh authenticator code; same rules as the goodwill credit). Refunds the **unused** part of one paid top-up (what was spent stays spent): the unused balance plus its share of the GST goes back to the customer's payment method through Razorpay, the unused balance leaves the wallet, a credit note is issued, and both audit trails get a row. Answer `{refund_id, status: "done", refund_paise, refund_text, unused_paise, gst_paise, credit_note_number, replayed}`. Errors: 409 `refund_nothing_unused`, 409 `refund_already_done`, 404 `refund_not_a_topup`, 502 `refund_declined` (Razorpay refused; nothing changed, the balance is back; try again), 502 `refund_unconfirmed` (no clear answer from Razorpay: **do not repeat**; the unused balance stays out until a person checks the payment in Razorpay's dashboard), plus the admin family (`not_staff`, `second_factor_required`, `second_confirm_required`, `reason_required`). A retry with the same key never refunds twice. Refunding after the top-up was partly used refunds only what is left.

## Test mode and live mode

* `RAZORPAY_LIVE_OK` (API setting, **false everywhere including production**): a `rzp_live_` key in `BILLING_RAZORPAY_KEY_ID` or `RAZORPAY_KEY_ID` stops the API at start unless it is `true`. A test key always starts. `mode` in the options and in each order says which it is.
* Staging uses Razorpay **test keys** and the test webhook (`BILLING_PROVIDER=razorpay`, `BILLING_RAZORPAY_KEY_ID`, `BILLING_RAZORPAY_KEY_SECRET`, `BILLING_RAZORPAY_WEBHOOK_SECRET`; the billing webhook account `BILLING_WEBHOOK_EMAIL` / `BILLING_WEBHOOK_PASSWORD` must exist). With `BILLING_PROVIDER=fake` the checkout is faked: `key_id` is `null`, the payment id is `pay_fake_...` and the signature is `sig_fake_ok`.
* Razorpay's test cards and UPI `success@razorpay` / `failure@razorpay` work in test mode. No real money moves.

## What changed under the hood (for the record)

Migrations `20261231992200_razorpay_topup.sql` and `20261231992210_topup_refund_low_balance.sql`; pgTAP `275_razorpay_topup`; tests `test_credits_topup.py` (fake Razorpay, a stateful fake database, concurrency) and `tests/integration/test_razorpay_topup_concurrency.py` (real Postgres, concurrent connections). The existing `POST /orders` and `/orders/{id}/confirm` keep working (same settle function); `/credits/topups` is the checkout-ready path for the web.
