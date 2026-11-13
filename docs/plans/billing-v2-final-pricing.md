# Billing v2: the owner's FINAL pricing of 13 Nov 2026 (source: project doc `decision-plans-and-pricing.md`)

Owner instruction (13 Nov): build on staging, Razorpay TEST mode only, do not wait. Status words: DONE / IN PROGRESS / QUEUED. Decisions marked (C1) are mine under the standing rule and can be reversed.

## The pricing (as the owner gave it)
| Plan | Monthly | Includes | After that |
|---|---|---|---|
| Pay as you go | ₹499 (business number + app) | nothing | ₹5 a minute |
| Sales Assistant | ₹1,999 | number included, 500 minutes | ₹4.50 a minute |
| Sales Assistant + Lead Finder | ₹5,999 | up to 3 numbers, 1,500 minutes, Lead Finder unlimited (fair use) | ₹4 a minute |

Everyone: 1 free Lead Finder search a month (PAYG extra searches about ₹49 each); billing per 30 seconds; unanswered calls free; yearly = 2 months free; launch prices locked 12 months for launch-phase sign-ups; +18% GST on invoices. WhatsApp is optional per business (on/off), charged at Meta's own cost with no mark-up. No user limits, no industry tier (the business type picks the pack and template). Free start: ₹50 of free usage on sign-up, no card, once per business and per verified phone.

## The balance
The ledger keeps 1 credit = ₹1 internally, but **every API answer and screen shows ₹** ("₹1,550 · about 310 call minutes"). The word "credits" appears nowhere a person reads. Top-ups carry 90 days; warnings at 80% and 100%; optional auto top-up with a monthly ₹ limit; queued calls instead of lost leads; read-only after an unpaid end, data kept 90 days (these rules already exist in billing v1 and are kept).

## Architecture decision (C1): billing v2 is a NEW module next to v1, behind `PRICING_V2` (ON in staging, OFF in production)
Billing v1 (units: minutes and messages against plan allowances, a 14-day card trial, the fake provider only) is built around a model the owner has replaced. Reshaping its tables in place would touch the trial clock, read-only lapse and the meters that other code relies on; a clean module in its own schema (`pricing.*`, functions `public.pricing_*`) can be tested against the owner's exact rules and switched on per environment. The v1 routes stay while the flag is off. When v2 is proven on staging, v1's trial and allowance code is removed in one PR. Reversible: set the flag off.

## The pull requests (in order)
| # | What | Status |
|---|---|---|
| P0 | #544 Razorpay TEST adapter, signed webhook, checkout; docs aligned with this pricing | IN CI |
| P1 | **Catalogue + ₹ wallet + metering in the database**: plans (data), wallet lots and ledger in paise, free ₹50 (idempotent per business and per verified phone), per-30-s call charge (unanswered = ₹0, included minutes then overage), Lead Finder search charge (1 free a month), GST invoice math, yearly price; pgTAP for each rule | QUEUED |
| P2 | **API**: pricing catalogue (public), `GET /billing/balance`, wallet, estimate, subscription (choose, change up/down with proration, cancel), invoices; all in ₹ | QUEUED |
| P3 | **Razorpay**: subscriptions monthly + yearly, ORDERS for wallet top-ups and the PAYG ₹499 fee, webhooks (`subscription.*`, `payment.captured`, `order.paid`) idempotent, GST invoice records; database accepts provider `razorpay` | QUEUED |
| P4 | **Staging walkthrough**: sign-up, free ₹50, test call, upgrade, top-up (script + report) | QUEUED |

## Rules the tests must prove (pgTAP and integration)
Per-30-s rounding (1 s = 30 s, 31 s = 60 s); unanswered = ₹0; included minutes first, then the overage rate; free ₹50 once; yearly = 10 months; GST math (18%, paise rounding, invoice total); webhook replay changes nothing.
