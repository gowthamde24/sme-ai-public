# How calls are billed (25 Nov 2026; API switch BILLING_CHARGE_CALLS, OFF at deploy)

The wallet pays for calls. The price is the plan's per-minute rate (Pay as you go: Rs 5 a minute, plus 18% GST on top-ups, never on a call).
1. **Calls are billed per 30 seconds, rounded up** (a 70-second call is three blocks). A block is half the plan's minute rate.
2. **A call nobody answers costs nothing**: no answer, busy, failed, refused.
3. **Calls you receive cost the same as calls we make for you.**
4. **Test calls are free**: the browser's test call, the practice screen, sandbox and simulated calls. A workspace marked billing-exempt (Customer Zero, demos) is never charged.

Before a call starts: an OUTBOUND call (a test call to your own phone is not outbound billing: it is a sandbox call and free; a call to a customer, a call-back, an instant lead call) is refused with `409 call_not_allowed`, `reason: "wallet_low"` when the balance is below one minute at the plan's rate and the plan has no included minutes left. An INBOUND call is always answered while the workspace is active; the wallet may run past zero by a small floor (a setting, Rs 50): the shortfall is remembered as a small debt that the next top-up pays first. Past the floor the assistant stops answering inbound calls with AI (the call is refused as `billing_blocked`, the Owner sees it in the call list) until credits are added; the existing low-balance flag (under four minutes) and the credits-low item on Today already tell the Owner before that.
**Order of spending:** the credit that expires first is spent first, so the free trial credit goes before a top-up bought later. Included minutes of a plan go before any credit.
**Charged once:** one row per call id (a retry or a repeated end event is a replay). **Reconcile:** the worker charges answered calls that ended without a charge row and logs a warning when it had to.
The ledger of OUR costs (`ops.provider_usage`: carrier, voice, speech, model) is a separate record from this charge.
