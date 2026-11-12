# B6: "outbound only to people who enquired themselves": what the code does today, what is missing

Written 12 Nov 2026 by C1 after reading the code (master list row B6, "TO VERIFY"). **Nothing was changed by this note.** **Launch scope (Plivo's written correction, ticket #37858): inbound + call-backs to enquirers on 080, so this rule is a prerequisite for the FIRST real call-back.** The go-live checklist says: *outbound to enquirers only; every outbound call has the enquiry as its recorded reason* (`customer-zero-go-live-checklist.md`, line 27).

## What exists (verified in code)
* **The gate** (`app/telephony/gate.py`, `check_outbound`): a call is refused unless telephony is on, outbound is on, `live` is confirmed, the number is on the sandbox list (sandbox mode), the workspace is not paused or billing-blocked, the purpose is allowed, hours/holidays/caps are respected, the contact is not suppressed or erased, DND is not `yes`/`unknown`, and **`can_contact` is true**. Each refusal is recorded on a call row with a closed reason word.
* **`can_contact`** is the database function `app.can_contact(contact, channel)`: phone consent is `granted`, a phone number exists, the contact is not suppressed or archived. Consent is written by `public.record_consent(...)` with a **basis** (`explicit_consent`, `contractual`, `legitimate_use`, `other`) and **evidence** (`web_form`, `email_reply`, `verbal`, `written`, `imported`, `other`); the ledger is append-only. Imports carry an owner attestation (`consent_id`).
* **Today's outbound path** (`app/telephony/plivo_outbound.py`, `PlivoOutbound.place`): calls only the **owner's own sandbox numbers**: it passes `can_contact = (sandbox mode and the number is on the sandbox list)`, `dnd = "no"` for those, and `approval="task", approval_valid=True` as constants. For any other number `can_contact` is false, so `live` mode refuses with `no_consent`. The Lead Desk dialer (`PlivoDialer`) goes through the same `place`, and `OUTREACH_DIALER` is `fake` everywhere. So **no real call to a customer can be placed today**, by construction.

## What is NOT there (the gap)
1. `place()` takes **no enquiry reference**. A call row records `purpose` and a language, not "which enquiry asked for this call".
2. `can_contact` says *a consent exists*, not *the person enquired themselves*: an **imported list with the owner's attestation** (basis `imported`/`other`) is `granted` too, and so would pass the gate for a call-back. That is exactly the cold-list case the owner excluded.
3. The `approval` the gate receives is a constant, not the Owner's approval of THIS call for THIS lead.

## Proposal (small, behind the same OFF switches; needs the owner's OK before it is built)
* A call-back to a customer needs a **proof of request** found by the database, not typed by a person: a lead of that contact whose source is a **self-made enquiry** (`website_form`, `meta_lead_ads`, a portal, `email_forward`, an inbound call, or a message the customer sent), **created within the last 30 days (default; the owner may change it)**, and not an import. Imports and pasted lists never count.
* New nullable columns on the call row: `request_lead_id`, `request_source`, `request_at` (copied at placing time, so the record survives a later edit of the lead). A call without them is refused with a new closed word `no_proof_of_request` in `live` mode; sandbox calls to the owner's own phone are unchanged.
* `approval` becomes the Owner's real approval of the call request (`call_requests` already exist for the Lead Desk) instead of a constant.
* Tests: (a) an imported contact with granted consent is refused `no_proof_of_request`; (b) a form enquiry from 3 days ago passes; (c) 45 days ago refused; (d) the three columns are on the row and appear in the call's audit trail; (e) sandbox own-number calls still work; (f) the constant `approval_valid=True` is gone (a grep test).
* Cost: one migration (3 columns + a SQL function `app.request_proof(contact)`), about 150 lines of API, tests. **Do not build before the owner confirms the rule** (30 days; which sources count; whether a customer who *called in* counts as an enquiry).

## Questions for the owner
1. Which sources count as "enquired themselves"? (proposal: website form, Meta lead ad, portal e-mail, e-mail forward, inbound call, a message the customer sent).
2. How old may the enquiry be for a call-back? (proposal: 30 days.)
3. Is an **import with the owner's attestation** ever enough? (proposal: no, never, for calls.)
