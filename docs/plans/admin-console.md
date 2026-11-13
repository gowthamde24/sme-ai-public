# Admin console (Stack19 staff only) — plan, 13 Nov 2026

Owner approved the 3 phases on 13 Nov ("don't wait for me"). Staging only, flag `ADMIN_CONSOLE` (off in production). The UI is C2's, in the same design system, on a separate host (admin.staging…). Shop owners never see it, never see provider names or our costs. This file is the C1 plan; the API shapes C2 builds on go in `docs/contracts/admin-console.md` (C2's draft is being brought in line with the owner's brief).

## Decisions (owner, 13 Nov)
- **Staff accounts**: roles `owner`, `support`, `finance`. Exactly one `owner` (the owner). Created by an operator script (`app.operator_register_staff`), never by sign-up; a staff account belongs to no workspace. The owner sets their own password and second factor at the hidden prompt; I never see them.
- **Login**: staff only, **always** a second factor (aal2 is required for every admin call, even if a normal account could skip it) and a verified authenticator factor. Sessions time out after **30 minutes without activity**.
- **Every action is audit-logged** (append-only table; no update, no delete).
- **View as owner** (Phase 2): read-only (no write path exists in the mode), reason required (BEFORE any data), an audit row, and:
  - the shop owner sees every support view in their own activity log: "Stack19 support viewed your account · <date time> · reason: <reason>";
  - end-customer personal data (phone numbers, names, transcripts) is **masked by default** in support view; unmasking needs a **second reason** and is logged separately;
  - per-business switch "Require my OK before support views my account", default **OFF**;
  - the consent/privacy wording is a DRAFT until the owner approves it.
- **Money actions** (goodwill ₹ credit, refund): Finance or Owner only, reason required, second confirm.
- **Per-provider cost** is recorded from now on, as real usage events written when the thing happens (no back-filled guesses): provider, units, our cost in ₹ (paise) for every call minute (Cartesia, Sarvam, Plivo, Claude), WhatsApp message (Meta), Lead Finder search (Google). The margin screens read only these.

## Design
- Schema `admin` (staff, sessions, audit, access grants, per-business setting) and schema `ops` (provider rate card, provider usage events). No client role has any privilege on either; everything goes through `public.admin_*` / `public.ops_*` security-definer functions with `set search_path = ''`, each proving the staff role (and aal2, and a live session) FIRST. The API never uses a service key: the staff member's own token is the caller.
- Staff check `admin.staff_check(roles[])`: signed in, active staff row, role allowed, JWT `aal = aal2`, session (JWT `session_id`) touched within 30 min, else 42501 / SM-coded error (`not_staff`, `second_factor_required`, `session_expired`).
- Audit: `admin.audit(id, at, staff_id, action, tenant_id, scope, reason_code, reason_text, target_kind, target_id, customer_visible)`; `customer_visible` rows are added to the shop owner's `activity_log`.
- Provider usage: `ops.provider_rates` (provider, unit, our cost per unit in paise as an exact fraction, valid_from; edited by the operator, every event stores the rate it used) and `ops.provider_usage` (tenant, provider, unit, units, cost_paise, ref_kind, ref_id, occurred_at; unique per (provider, unit, ref_kind, ref_id) so a retry changes nothing). Written by `public.ops_record_usage` (system accounts only) from: call end (Plivo minutes in 30 s pulses, Cartesia characters, Sarvam audio seconds, Claude tokens), WhatsApp send (Meta, by message category), Lead Finder search finish (Google Places SKU).

## Phases
1. **Foundation + recording**: staff accounts, roles, 2FA, 30-min sessions, audit; `GET /v1/admin/me`, businesses list + search (plan, ₹ balance, status Not live / In training / Live / Paused, signup date, last activity), business detail (setup progress, numbers, WhatsApp connection, recent calls/chats — read-only, end-customer data masked), audit list; the usage ledger and its recording hooks.
2. **Support and money**: support inbox (tickets / WhatsApp support inbox), view as owner (above), resend invoice, pause/resume assistant, goodwill ₹ credit; MRR, active subscriptions per plan, top-ups, refunds, failed payments, GST invoice list (test mode).
3. **Usage, health, compliance**: minutes / messages / Lead Finder searches per business; our cost per provider vs revenue, margin per business and overall (the only place provider names and costs appear); call success rate, failed calls, webhook errors, queue backlog, CI/deploy link, alerts; consent records, STOP opt-outs, export/delete requests with status.

## Open (owner can reverse)
- Role names differ from C2's draft (`support|admin`): the owner's three roles win; the draft's `admin` becomes `owner` (everything) and `finance` (money, invoices, refunds, usage and margin; no customer data views).
- C2's draft requires the customer's consent for view-as; the owner's decision is a reason + audit + the per-business "Require my OK" switch (default OFF).
