# ADR 0020: Suppression keys (HMAC) and consent-aware follow-up (T010, part 1: the hard gate)

Status: accepted for the local-first stage (owner review of the plan 2026-10-06; plan and amendments: `docs/plans/t010-integration.md`). Related: ADR 0005 (consent ledger), ADR 0013 (option A / B), ADR 0014 (erasure; open question 1,
"suppression after erasure"), ADR 0016 (second factor), ADR 0017 (local-first), `docs/plans/t010-followup-cadence.md` (lane C's pure cadence).

## Context
Erasing a contact removes its e-mail and phone. A later import of the same address would start with no opt-out, and a person who asked not to be contacted could be contacted again. The checklist made this a HARD GATE before the first outreach.
This ADR is the first third of T010 (the gate): the keys, their storage, the paths that compute them, and how erasure and lifting interact with them. The cadence, touches, drafts and the screens are later commits (nothing is sent in this ticket).

## Decisions
**1. A keyed HMAC, held outside the database.** For an e-mail address (trimmed, lower-cased; dots and plus-tags are NOT collapsed) and a phone number (digits only; an Indian mobile is reduced to its ten digits; other numbers keep their digits without leading zeros) the API computes
`HMAC-SHA256(key, kind + ":" + normalised)` with a key from its configuration (`SUPPRESSION_HMAC_KEY`, never a default; outside development the process refuses to start without it). Not a plain hash: phone numbers are brute-forceable. The key never enters the database,
a response, a log or a URL. A `key_version` is stored with every key; the API checks the current key and one previous version, so a rotation never forgets a suppressed address. The database cannot compute or verify an HMAC (the key is outside it by design): it stores, compares and
refuses; the VALUE is the API's word (the option-A limit; option B, a service principal that alone may record keys, is required before any external customer: checklist).

**2. Where the keys live: a private schema, not public tables.** `suppression.contact_keys` (the current keys of a contact, derived, erased with it) and `suppression.key_events` (the append-only ledger of suppressed / lifted events per `(tenant, kind, hmac)`) live in the schema
`suppression`, which no client role can use (the pattern of `erasure.registry`). A table in `public` would be readable through PostgREST `select=*` and would put the HMAC into `/audit-events`; here only SECURITY DEFINER functions reach them and the audit trigger records the key columns BY NAME only. Ordering uses an identity
sequence, never timestamps (several events can share a transaction time). The ledger is append-only (update, delete and truncate are refused for every role) and retains the key on purpose: it is the one deliberate retention of a derived identifier (the DPDP review row).

**3. The existing contact-level suppression stays the source of truth for a person; the keys follow it.** `public.suppress_contact` and the consent ledger are unchanged. A trigger on `contacts` mirrors the state: when a contact becomes suppressed, its stored keys are appended as `suppressed` events (with the
contact's reason); when the suppression is lifted, they are appended as `lifted`. Changing a contact's e-mail or phone forgets the stored key of that identifier (so a stale key is never trusted) until the API records a new one.

**4. The functions (all `SECURITY DEFINER`, `search_path=''`, one overload, `authenticated` only, the role proven BEFORE anything else is revealed, one generic 42501):**
`record_contact_keys` (Owner / Admin / Sales, any aal: stores the contact's keys; if any key is suppressed the contact is FLAGGED through `suppress_contact`, so it is never created contactable), `check_suppression` (the same roles; a boolean per kind, never the reason or the contact),
`unkeyed_contact_count` (Owner / Admin), `unkeyed_contacts` and `backfill_contact_keys` (Owner, aal2: the backfill of existing contacts), `allow_erasure_without_key` (Owner, aal2). `lift_suppression` is REPLACED: **Owner with aal2 only** (owner decision 4; it was Owner or Admin), and lifting a contact lifts its keys.

**5. Erasure is never blocked by a missing key (amendment a).** The API reads the contact, computes and records the keys, then erases. `app.erase_contact` (replaced; the T008 text plus these lines) appends the `erased` key events BEFORE the identifiers are removed, then deletes the stored keys with the contact.
A contact that holds an e-mail or phone with no recorded key is refused with **SM221** (so an accident cannot lose the key), UNLESS an Owner with aal2 marked that request `allow_erasure_without_key`, which is audited (the request row's audit) and counted in the result (`erased_without_key`). Tenant-wide erasure never refuses: it appends the keys that exist and
deletes the stored keys. The checklist lists every erasure without a key for review.

**6. Keys are computed on every path that creates or changes a contact (amendment b).** The create-contact route, the update route (when e-mail or phone change), the lead import (after the rows are created) and the backfill call `record_contact_keys`. A contact created directly through PostgREST has no key: it can be erased only with the explicit Owner step, and it cannot receive a follow-up draft (T010
part 2 refuses an unkeyed contact, SM221) until the backfill keys it. `GET /suppression/status` reports the unkeyed count; the backfill is an Owner, aal2, idempotent, batched action.

## What the database proves and what it trusts
Proven: tenant isolation, roles (and aal2 after the role), the append-only ledger, idempotent events, that the keys follow the contact's suppression and lifting, that a flagged contact is suppressed with consent withdrawn (the existing rules), that erasure writes the keys first and refuses an unkeyed contact without the Owner's explicit step, that no client can read a key.
Trusted: that the HMAC the API supplied is the HMAC of the contact's actual identifier under the right key (a malicious Sales user could record a wrong key through PostgREST: option A; option B before an external customer), the owner's custody of the key, and the normalisation (checked by vectors).

## Consequences and limits
* A person whose address was written in another form (different dots, a plus-tag, a different mailbox) escapes suppression: conservative normalisation, no guessing. Documented limit.
* The HMAC is arguably personal data (DPDP review); it is retained after erasure by design.
* Rotation: new keys under a new version; old events stay valid and the previous key is checked; no re-keying of erased contacts is possible (their identifiers are gone), so old key versions must be kept as long as their events matter.
* Not built here (T010 parts 2-3): the touch log, cadence policy, follow-up drafts, question drafts, the due list, the web screens. The draft gate (SM220, SM221, SM227) is part 2 and reads these keys.
