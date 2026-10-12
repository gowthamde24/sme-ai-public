# ADR 0074: phone-first contacts

Status: accepted for the local stage (job BO, 2026-10-12). Branch `api/bo-phone-contacts`, built on `api/bi-integrations` (it changes the spreadsheet import and the Tally export of BI). Migration `20261115090000_bo_phone_contacts.sql`; pgTAP `84_bo_phone_contacts`.

## Context
A saree shop in India is reached on WhatsApp, on a phone number; many have no e-mail address. The lead import insisted on an e-mail for every contact (`contact_requires_email`) and found an existing contact only by e-mail, so a phone-only customer could not be imported and the same person written two ways could not be recognised. The suppression keys (ADR 0020) and the outbox already worked on the phone.

## Decisions
1. **One stored form.** An Indian mobile is stored as `+91` and ten digits (`+919876543210`) whatever was typed (`98765 43210`, `098765-43210`, `+91 98765 43210`, `91-9876543210`, digits in Devanagari, Telugu, Kannada, Tamil ...). Anything that is not clearly an Indian mobile (a landline with an STD code, another country, the synthetic `+00 ...` numbers of the demo) is kept as typed. Applied in the API models of a contact (create and update) and of the lead-import row (`app/crm/phone.py`).
2. **One comparison form, in two places that agree.** `app.phone_norm` (SQL) and `normalise_phone` (Python, the suppression key's rule) reduce a number to its comparison digits: every script's decimal digits read as digits, a leading `00` dropped, `91` + ten or `0` + ten reduced to ten, leading zeros dropped, 3 to 32 digits else none. A table of 30 numbers is checked against both in `tests/integration/test_bo_phone_contacts.py`.
3. **A number is found, not forbidden.** A hard "one contact per number" rule was tried and withdrawn: two people of one family may share a phone, and the suppression keys are built for that. Instead a lookup index and `public.find_contact_by_phone` (every live holder, the oldest first, with company and open leads) for the duplicate warning of a manual entry, for the outbox and for the assistant: `GET /v1/tenants/{id}/contacts/by-phone?phone=`.
4. **The lead import** (`public.import_lead_rows`, replaced in place, same signature and grants): a contact needs an e-mail **or** a phone; it is found by e-mail, or, for a row **without** an e-mail, by the normalised phone (the holder in the same company first); a number held by a contact of another company is refused (`contact_belongs_to_other_company`); a row with an e-mail keeps e-mail as its identity (a new e-mail with a number that is already held is a new contact that shares the number, as before). The real-data gate, atomic rows, provenance and idempotency are the T006b function unchanged; a phone that cannot be compared (too short) is kept as typed unless the row has no e-mail.
5. **Spreadsheet import** keeps phone-only contacts: the contact is named after the shop when the sheet has no contact name (`contact_named_after_company`); a name or role with no way to reach the person keeps only the company (`contact_needs_phone_or_email`).
6. **Agent OWL** finds a customer by a number (`find_customers` with a question that is a number); the number itself never goes to the model.
7. **Suppression keys and erasure are unchanged and proven for a phone-only contact**: its phone key is recorded (the e-mail key is empty), a re-created contact with the number is flagged, and the erasure of the contact removes the number and writes the key.
8. **Tally**: every voucher carries a stable `GUID` (and the same `REMOTEID`), derived from the order or payment id, in the shape Tally writes (`<uuid>-00000001`). With Tally's import option "Overwrite voucher when a voucher with same GUID exists" set to Yes, importing a range again replaces its vouchers instead of doubling them; the voucher numbers were already stable.

## Found on the way: the flaky pgTAP test (`70_ad_d2_open_signup`, test 31)
It counted ALL rows of `account_setups`. That table has no foreign key to the business, so another session's sign-up that was later deleted (the e2e clean-up deletes users and businesses, not these rows) leaves a row behind on the shared agent database, and the global count failed at random. Reproduced (3 leftover rows made it fail every time), fixed by counting only that file's own fixture people. The e2e clean-up (`e2e/cleanup-be.mjs`, Claude 2's lane) could delete the e2e account's `account_setups` row too; recommended, not done here.

## Consequences
* Contacts with the same number in one business are possible, and are found together.
* The Tally GUID shape is from Tally's published behaviour and my reading of its export files; try a re-import on a copy first.
* Existing stored numbers keep their form; only new writes are canonicalised.
