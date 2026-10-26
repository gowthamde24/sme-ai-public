# Personal-data breach: what to do (job DQ, DPDP)

A personal-data breach is any loss, leak, unauthorised access to, alteration or destruction of personal data that Stack19 holds, whether by an attacker, a mistake, a lost device or a provider's failure. Under the DPDP Act, 2023 and its Rules, Stack19 (the Data Fiduciary) must tell **the Data Protection Board of India** and **each affected person** without delay, and send the Board a **detailed report within 72 hours**. This page is the plan. It is an engineering runbook, not legal advice: the owner confirms the current Rules and takes counsel before the first real-data customer.

**Who does what.** Until there is a team the owner (Gowtham) is Incident Lead, Communications and Data Protection contact in one. The engineering agents (C1 API/DB, C2 web) are the responders: they read logs, contain, fix and write the timeline. Nobody else decides whether to notify; the Incident Lead does, in writing in the incident note (step 1).

## 0. Before anything goes wrong
- Real data stays behind the real-data gate (`docs/runbooks/real-data-gate.md`); until it is open there are no real individuals in the system and a breach is a drill.
- Know where the data is: `docs/data-inventory.md`, and the processors in `GET /v1/privacy/subprocessors`.
- Know how to stop things: the agents kill switch (`docs/runbooks/agents-kill-switch.md`), the outbox switch, `app.operator_set_billing_enforced(false)`, revoking a key in Secret Manager, pausing a Cloud Run service.
- Logs hold no personal data (counts, ids, class names), so logs can be shared in an incident without widening it.

## 1. Detect and record (minute 0)
Signals: a Sentry error spike or an alert; a provider's notice (Supabase, Google Cloud, Resend, Meta, Sarvam, Anthropic); a user's report to the privacy inbox; an unexpected row count in the audit trail (`public.audit_events`); a credential found in a repository or a log.
Open an incident note (a dated file in the owner's private notes, NOT in the repository) with: what was seen, when, by whom, the time you started the clock. **The 72 hours start when Stack19 becomes aware.**

## 2. Contain (first hour)
- Stop the cause: revoke or rotate the exposed key (Secret Manager: add a new version, redeploy, disable the old); disable the account; pause the affected service; switch off the outbox or the agents.
- Do not delete evidence. Do not "clean up" rows: preserve the logs and the audit trail (they are kept for a year).
- If a credential leaked, assume it was used: rotate it first, investigate after.

## 3. Assess (first 24 hours)
Answer, from the logs, the audit trail and the data inventory: what data (which tables, which fields), whose (which workspaces, how many people, children's data?), how (the cause), when (first and last unauthorised access), whether it is still happening, whether the data was encrypted or only exposed. Children's data (the education pack) and the Owner's own voice recording are the most serious classes: say so in the note.

## 4. Inform (without delay; do not wait for the full picture)
1. **Affected workspaces' Owners**: they are the Data Fiduciaries for their customers' data and have their own duty to their customers. Write plainly: what happened, what data, what we did, what they should do, who to write to (the privacy inbox from `GET /v1/privacy/notice`). Use the Owner's e-mail from `auth.users` through the operator session; send through the Resend sender or personally.
2. **Affected individuals** (a person with an account; for a workspace's customers, through the Owner unless the Owner cannot be reached): what happened, the data involved, the likely consequences, what we have done, what they can do (change a password, watch for calls), and a contact point.
3. **The Data Protection Board of India**: notify without delay through the Board's channel (the owner confirms the current channel and form in the Rules before the first real customer; this page is updated then).
4. If another regime applies to a person (a customer outside India), the owner takes counsel the same day.

## 5. Report to the Board within 72 hours
A written detailed report: the nature, extent and timing of the breach and its likely impact; the findings on who caused it and why; the remedial steps taken; the measures to prevent a repeat; and the notice given to affected persons. Keep a copy.

## 6. Recover and learn
- Fix the root cause on a branch, with a test that would have caught it; review the same class elsewhere (`docs/security/`).
- Restore from a backup only after the cause is closed (`docs/runbooks/backup-restore-drill.md`).
- Within a week: a short post-mortem (what, why, what changed). Update this page and the data inventory.

## 7. Drill
Once before the real-data gate opens and then yearly: pick a made-up scenario (a leaked service key, a misconfigured bucket, a lost laptop with a session), run steps 1-6 on paper with timestamps, and check that 72 hours is achievable. The drill is complete when the report text exists.
