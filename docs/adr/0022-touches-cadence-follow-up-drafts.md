# ADR 0022: Touches, the cadence policy, follow-up drafts and question drafts (T010 part 2)

Status: built for the local-first stage; **commit 1 (the database and its proofs) awaits the owner's review.** Plan and owner decisions: `docs/plans/t010-integration.md` (sections 2.2-6, 8, 11). Related: ADR 0005 (consent ledger), ADR 0013 (option A / B), ADR 0016 (second factor), ADR 0017 (local-first),
ADR 0018 (questions; lock order), ADR 0020 (suppression keys: the gate this part enforces), ADR 0021 (orders: the follow-up stop), `docs/plans/t010-followup-cadence.md` (lane C's pure engine, `packages/pure/followup_cadence` 1.0.0, the contract this wraps).

## Context
Part 1 built the suppression keys. Part 2 is what a person does with them: record what they sent and what the customer said (touches), keep a versioned cadence policy, and get a DRAFT follow-up (and persisted question drafts) that a person reviews, approves, copies and sends OUTSIDE the system.
**Nothing here sends anything, calls a model or a provider.** A touch, a draft and an approval are records. Migrations `20261024090000_t010_part2_followups.sql` and `20261024090100_t010_part2_question_drafts.sql`; pgTAP files 62 and 63.

## Decisions
**1. The gate lives in the database and is repeated at every step.** `app.followup_gate(lead, channel, lock)` is run by `record_touch` (outbound), `create_followup_draft`, `approve_followup_draft` and `record_draft_sent`, each time against the state as it is then (owner review 2026-10-07, requirement 1). Order of the checks (safety first): no contact, erased, suppressed
(SM220, detail `contact` / `erased`), no identifier for the channel, **no stored key for the channel (SM221: missing data never means "not suppressed")**, a suppressed key (SM220, detail `key`, or `erased_key` when an erased marker follows the key's last lift), consent not granted or the contact archived (SM220, detail `consent`).
The key kind is part of the check: an e-mail draft reads the e-mail key, WhatsApp and phone read the phone key. With `p_lock` the key's advisory lock is taken in SHARED mode (a suppression that holds the same key waits for the transaction, or has committed): the suppression path (contact for update, then the key's exclusive lock) and this path (contact for share, lead for update, then the key's shared lock) take the same locks in the same order.

**2. The caller names a LEAD; the contact is derived.** The plan had `p_contact_id`; a caller-supplied contact is a way to name a different person than the lead's. The contact is the lead's current contact, locked first; a lead whose contact changed while a function waited (or since a draft was made) is stale (SM224).

**3. The database decides whether the engine would answer `draft_followup`.** The API runs the pinned engine; the database rebuilds the request (`app.followup_build`, same value as `services/ai-api/app/followups/builder.py`) and refuses any other (SM226), then computes the positive decision itself (`app.followup_blocker`: the flags, a reply, the touch limit, the future-history rejection, the gap and minimum gap after the LAST
outbound touch, the weekday, the recipient's local holiday, quiet hours, wrapping or not). The engine moves a candidate only forward and answers `draft_followup` only when the moved time is not after as_of, so a due draft is due at as_of itself; the whole positive condition is therefore checkable, not trusted. A refusal says why in a closed word (SM225 detail:
`suppressed | replied | closed | max_touches | initial_outreach | future_history | not_yet`), and the engine's result must then be exactly the draft answer for that touch number, request hash and engine version (SM226). WAIT and STOP results are not recomputed (nothing is created for them); the rule trace is stored as given. An equivalence test (the real engine against the database function, generated histories and calendars) pins them equal (commit 2).
This goes one step beyond the plan ("the database does not re-implement the engine"): the predicate is small, and it removes the option-A trust gap for the one thing that matters (a forged "due" result).

**4. No text from a person reaches a draft.** A draft's wording is a CLOSED template (`followup_templates`, English, migration-extended, no variables) copied by the database; the caller supplies no text. The wording is chosen by touch number (the last allowed touch, the second, every other). The templates are SYNTHETIC placeholders the family replaces (checklist). Question drafts store the API's closed-template text within caps
(8-300 characters, text hygiene, **no contact data** by `app.text_has_contact`, a code from the closed list, a line 0..5); the database cannot re-derive that text from the requirement's fields (limit, below).

**5. Touches.** `record_touch` is a person's record: Owner / Admin / Sales at any assurance level. **An outbound touch obeys the gate** (nobody can record contacting a person the system may not contact); **an inbound touch is ALWAYS recordable** (it can only stop outreach: the engine answers `human_takeover`, and refusing it could keep a cadence alive), and it discards every open draft of the lead (`reply_recorded`).
An outbound touch discards the open drafts for its touch number or an earlier one (`superseded`). The time: null is the database's clock; a stated time may be up to 7 days back and never in the future (no slack: the engine rejects a touch after as_of). 500 touches per lead (SM229). Append-only.

**6. Drafts.** One ACTIVE (draft or approved) draft per (tenant, lead, touch number) by a partial unique index. States: `draft -> approved -> recorded_sent`, or `discarded` (a person, or the system: superseded, reply_recorded, suppressed, erased). Approval is the Owner's or Admin's, **with a second factor, after the role is proven**. The approval carries the fingerprint the person reviewed
(`state_hash`, the request without as_of, the contact and the channel); it is refused when that is not the stored one, or when the state moved since (the history, the policy in force, the flags, the contact): SM224. `record_draft_sent` ("I sent it") re-runs the gate and the stop and requires the history to be the one the draft was made for (SM224): an approval that was valid when given is not enough later.
Touch 1 is a person's: there is no system draft for a lead with no outbound touch (`initial_outreach`); the person records the touch with `record_touch` and the cadence takes over.

**7. Stops.** `app.followup_stopped(lead)`: an archived lead, or an order accepted, declined or cancelled, or a withdrawn quote (`app.order_stops_followups`, the lead's latest order decides): SM227 with the closed reason, at create, approve and record-as-sent (owner review requirement 2).

**8. A contact that becomes suppressed or erased has its open drafts discarded** (a trigger on contacts; the draft rows only). The gate re-checks at every step too, so the trigger removes a draft from the screen; it is not the only line of defence. A key suppressed through ANOTHER contact is caught by the gate, not by the trigger.

**9. The policy** (`followup_policy_versions`): immutable, versioned like the quote policy; Owner with a second factor; effective today or later and never before the latest; typed columns with CHECKs (gaps 0..365 days, exactly max_touches - 1 of them, quiet hours HH:MM with distinct ends, weekdays 0..6 distinct, holidays distinct, offset -840..840 minutes). Weekdays and holidays are stored sorted (the engine request carries them in that order).

**10. SQLSTATEs** SM220 to SM229 (the part 2 family; SM221 shares its code with part 1's erasure refusal, whose message differs): see the migration header. **Reads:** `followup_gate` (blocked / stopped / policy_in_force in closed words, never a key) for the screens; the tables are readable by Owner / Admin / Sales through RLS, a Viewer reads none of it.

## What the database proves and what it trusts
Proven: tenant isolation, roles and the second factor (role first), the state machines, one active draft per touch, append-only touches, no client write grants, the gate at every step, the stop at every step, that the request is the database's own, that the draft is due by the engine's own rules, that the result is the draft answer for this request, that no text a person wrote is in a draft.
Trusted: that the HMAC the API recorded is the HMAC of the identifier (option A, ADR 0020: a member who talks to PostgREST could record a wrong key; option B before an external customer); that a person really sent what they say they sent; the question text within its caps; the rule trace as stored.

## Consequences and limits
* The 7-day backdating limit and "never in the future" are the database clock's; a touch recorded a second before an API clock reading is fine, one recorded after is refused.
* A key suppressed through ANOTHER contact stays visible to Sales as `key` in the gate (the existing `check_suppression` already answers a boolean per key).
* `occurred_at` of a "sent" touch is not bounded below by the draft's approval (the same limit as the order ledger's F5); it is bounded by 7 days.
* The question text is the API's word within its caps (decision 4); a member who talks to PostgREST directly can store another closed-looking question for a requirement. Nothing leaves the system.
* Languages other than English (owner question 13) are not built; templates are closed rows, so a language is a migration plus a reviewer who reads it.
