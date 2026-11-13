# Billing v2: the API shapes for C2 (the owner's final pricing, 13 Nov 2026) — C1 -> C2

Everything is in **rupees**; the ledger counts paise (1 credit = ₹1 inside), but **no answer and no string says "credits"**. Flag `PRICING_V2` (on in staging, off in production); off = these routes answer 404. Plans and rules: `docs/plans/billing-v2-final-pricing.md`. Built behind v1 (the old `/billing` trial routes are untouched).

| Method and path | Who | Answer |
|---|---|---|
| `GET /v1/pricing` | any signed-in user | `CatalogueOut`: `{gst_percent, gst_text:"+18% GST on invoices", free_start_paise, free_start_text:"₹50 free to start, no card", plans:[PlanOut]}`; a plan: `{id, name, monthly_paise, yearly_paise, monthly_text:"₹1,999 a month", yearly_text:"₹19,990 a year", yearly_saving_text:"2 months free", included_minutes, rate_paise_per_minute, rate_text:"₹4.50 a minute", numbers_included, lead_finder, free_searches_month, extra_search_paise, lines:[...]}`. Plans: `payg`, `sales_assistant`, `sales_lead_finder` (ids are data: loop over `plans`). `lines` are plain English for a card (drafts; reword freely). |
| `GET /v1/tenants/{t}/billing/balance` | any member | `BalanceOut`: `{balance_paise, balance_text:"₹1,550", minutes_estimate, summary_text:"₹1,550 · about 310 call minutes", plan_id, plan_name, low, topup_available, free_start_granted, free_start_left_paise, free_start_left_text:"₹40"|null, included_minutes, included_minutes_left, subscription:{interval, status, period_end, cancel_at_period_end, price_locked_until}|null}`. `low` = under about 20 minutes of calling. A workspace with no subscription runs on pay-as-you-go terms. |
| `POST /v1/tenants/{t}/billing/free-start` | Owner | `{granted, reason: null|"already_granted"|"phone_used", balance_paise, balance_text}`. ₹50 of usage on sign-up, no card, once per business (and once per verified phone when the sign-up passes its keyed hash: the web's phone step). Idempotent. |
| `POST /v1/tenants/{t}/billing/estimate` body `{calls, avg_minutes}` | Owner, Admin | `{calls, avg_minutes, total_minutes, included_minutes_used, paid_minutes, rate_text, cost_paise, cost_text, time_text:"about 2 h 30 min of calling", balance_paise, enough, shortfall_text:"₹35 more needed"|null}`. Each call is rounded UP to the next half minute (billed per 30 seconds); the plan's included minutes are used first; the rate is that business's plan. For plan cards and suggestions. |

Payments (Razorpay TEST on staging, the fake provider elsewhere; all amounts shown in ₹ with +18% GST on top, never "credits"):

| Method and path | Who | Answer |
|---|---|---|
| `POST …/billing/subscription-checkout` body `{plan_id, interval}` | Owner | `{provider, key_id|null, subscription_id, plan_id, interval, amount_text, gst_text, total_text}`: open Razorpay Checkout with `subscription_id` (fake provider: no checkout, use `checkout_ref` `pm_fake_ok`). |
| `POST …/billing/subscribe` body `{plan_id, interval, checkout_ref}` | Owner | `BalanceOut`. `checkout_ref` = `<subscription_id>.<payment_id>.<signature>` from Checkout; a wrong signature is `402 payment_method_declined`. |
| `POST …/billing/change-quote` body `{plan_id, interval}` | Owner | `{amount_text, gst_text, total_text, credit_text|null, needs_payment}`: the prorated difference for the days left (a downgrade goes to the balance as a credit note, `credit_text`). |
| `POST …/billing/change` body `{plan_id, interval}` | Owner | applies a change that needs no payment; `402 payment_required` otherwise (pay by an order with `purpose: "plan_change"`). |
| `POST …/billing/plan/cancel` | Owner | cancels at the end of the period (the provider is told); the reference is never returned. |
| `POST …/billing/orders` body `{purpose: "topup"|"payg_fee"|"plan_change", amount_paise?, plan_id?, interval?}` | Owner | `{provider, order_id, key_id|null, purpose, amount_text, gst_text, total_paise, total_text}`. The amount is priced by the database; a top-up is ₹100 to ₹50,000. |
| `POST …/billing/orders/{order_id}/confirm` body `{payment_id, signature}` | Owner | `BalanceOut` once the signature checks (`402 payment_not_verified` otherwise); the stored order is settled once, whether the browser or the webhook comes first. |
| `GET …/billing/gst-invoices` | Owner, Admin | `{items:[{number:"S19-2026-000001", kind, subtotal_text, gst_text, total_text, total_paise, issued_at}]}` (the older `/billing/invoices` stays for the v1 trial screens). |

The webhook `POST /v1/webhooks/razorpay-billing` (signed with the webhook secret, idempotent per event id) applies `order.paid`, `subscription.charged/pending/halted/cancelled` to the same functions.
