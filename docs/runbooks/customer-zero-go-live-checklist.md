# Go-live checklist: Customer Zero (the family silk-saree wholesale shop, real data, production)

Target: real data around 14 Dec 2026. Scope (owner, 11 Nov): **inbound calls** (the shop's number answered by the assistant) and **outbound only to people who enquired themselves**. No cold calls to strangers. Promotional calling (140 series, DLT, DND scrub) is the next phase and does not block this.
Rule: **no real customer data until every box in sections A to D is ticked and written down.** The gate is opened by the operator with four references (`real-data-gate.md`); this list is what must be true before that.

## A. The four gate prerequisites (`real-data-gate.md`)
- [ ] `erasure_ref`: the erasure workflow shipped and reviewed (ADR 0014) and tested ON PRODUCTION with a synthetic person (export, erase, scan shows nothing left).
- [ ] `hosting_ref`: production deployed from a named commit; `scripts/verify_hosted.py` ended `ALL CHECKS PASSED`; output kept.
- [ ] `dpdp_review_ref`: the DPDP review done by the lawyer and filed; the lawyer's answers confirmed IN WRITING (the 10 Nov ones were verbal); the AI-call question list answered (`~/Desktop/stack19-jobs/drafts/lawyer-questions-DRAFT.md`).
- [ ] `restore_drill_ref`: a production backup restored on a scratch project, `verify.sql` passed there, erasures after the backup re-applied, time measured (`backup-restore-drill.md`).

## B. Database and accounts
- [ ] Supabase Pro, Mumbai, daily backups visible; no point-in-time recovery (decision 11 Nov, revisit at the first paying customer).
- [ ] RLS checked on production: `supabase/hosted/verify.sql` all `ok = true`; a cross-workspace read attempt from a second synthetic workspace returns nothing.
- [ ] Sign-up closed, e-mail confirmation on, MFA on for Owner and Admin accounts, asymmetric signing keys, SSL enforced (`hosted-auth-settings.md`).
- [ ] No staging secret, key or data exists in production (a one-time check of the secret list and the environment of each service).
- [ ] Service-role/database admin secret is in no service and no browser bundle.
- [ ] Custom SMTP working; the invitation e-mail tested with the owner's own address.

## C. Calls and the shop's phone line
- [ ] Plivo account in the India data region (confirmed 11 Nov); the inbound number is in the production account, KYC accepted, Answer/Hangup URLs are the production API's run.app address, signature check passes on a synthetic call.
- [ ] `TELEPHONY_MODE` is `sandbox` until the owner writes "live"; then `PROD_TELEPHONY_MODE=live PROD_LIVE_OK=yes`. `TELEPHONY_OUTBOUND` false and `TASKS_DIALER` OFF until the owner says otherwise.
- [ ] The assistant says it is an AI at the start of every call; no recording; no price, discount or promise on a call (guards on); a spoken stop word ends the assistant's turn at once.
- [ ] Hours 09:00 to 21:00 India time; outbound to enquirers only; every outbound call has the enquiry as its recorded reason; suppression (opt-out) keys work (T010 part 1).
- [ ] Spend caps: a per-call maximum, a per-day cap, the providers' hard caps set, a test that the billing stop works.
### The shop's mobile number forwards to the Plivo number
- [ ] **Decision (owner):** how callers reach the assistant. (1) the shop publishes the Plivo number as its business number (no forwarding; simplest and safest; fallback below has no loop); (2) the shop keeps its mobile and forwards to the Plivo number: *unconditional* (every call goes to the assistant) or *conditional* (when unanswered after N rings, busy, or unreachable: the shop's phone rings first).
- [ ] **Setup and cost are the shop's mobile operator's**: ask the operator (a) the exact forwarding code or app setting for each condition, (b) the per-minute charge for the forwarded leg (it is billed to the shop's mobile account, not to Plivo), (c) whether forwarding to a number outside the operator is allowed. The forwarded call keeps the original caller's number only if the operator passes it; test it, because the assistant's "Caller ending ..." and its suppression checks rely on it.
- [ ] Test calls from three different phones (the owner's, a family member's on another operator, a landline if available) and write down: does the assistant answer, does it see the caller's number, how long until the first sound.
### Fallback: if the assistant is down, the call goes back to the shop's phone
- [ ] Plivo application **Fallback Answer URL** points at a tiny Cloudflare Worker (separate from the API, so an API outage cannot take it down) that answers with a `Dial` to the shop's phone. The shop's number is a Worker variable, never in the repository. (Worker file and test: C1 prepares `deploy/cloudflare-worker-plivo-fallback.js` before 25 Nov.)
- [ ] **Loop guard (important):** if the shop's mobile forwards *unconditionally* to the Plivo number, a fallback that dials that same mobile would be forwarded straight back. Use a second number for the fallback (another phone of the family) or choose option (1) or conditional forwarding. The owner decides; the test is a call with the API deliberately stopped on a scratch revision.
- [ ] Also covered in the API: when the gate refuses a call (outside hours, capacity, gate closed) the caller hears a short closing line, not silence.
- [ ] Verified with a real call: API stopped -> the shop's phone rings within 10 seconds -> the call is answered by a human.

## D. Operation
- [ ] Alerts live and each triggered once (errors, call failures, latency, no instance, spend); the owner received each mail.
- [ ] Rollback tested once (`deploy/production.sh rollback` and `latest`); the previous revision names are written down.
- [ ] Runbooks read by the owner: stop everything (`agents-kill-switch.md`, gate close), a bad call, key rotation, restore, breach (`breach.md`), erasure on request.
- [ ] Family told what goes in and what does not; Customer Zero's workspace is NEW (the demo workspace is never opened); data entered is only what the workflow needs.
- [ ] Data inventory and the sub-processor list match what is deployed (Plivo, Supabase, Google Cloud, Resend, Anthropic, Sarvam, Cartesia); privacy text applied only after the lawyer approved it.
- [ ] The first week: the owner (or a family member) reads every call summary; a review on day 3 and day 7 before widening anything.

## E. Not on this list (next phases)
Promotional calls (140 series + DLT + DND scrub + consent records), WhatsApp Business API, a second instance/routing, point-in-time recovery, outbound dialer for Lead Desk tasks (built, OFF).
