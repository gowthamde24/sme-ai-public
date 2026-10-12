# Runbook: GSTIN (job CA, ADR 0081)

The application stores two GST registration numbers: the **shop's own** and each **customer's**. It checks that a number is well formed. It does **not** check that the business exists or is active: only the GST portal's taxpayer search says that (there is no public API for it; a paid provider would be needed, ADR 0078).

## What "valid" means here
Fifteen characters: a state code (01 to 38, 97 or 99), the holder's PAN (five letters, four digits, one letter), an entity number (1 to 9, then A to Z), the letter **Z**, and a check character (Luhn mod 36 over the first 14). Spaces, dashes and lower case are forgiven when you type; the number is stored in capitals without spaces. A number with the wrong check character is refused with a plain message (422). Special registrations that do not end the usual way (some government and UN bodies) are not accepted.

## The shop's own GSTIN
* `GET /v1/tenants/<t>/business-profile` (every member) → `{"gstin": "27AAPFU0939F1ZV", "state": "Maharashtra"}`.
* `PUT /v1/tenants/<t>/business-profile` (Owner or Admin, **second factor**) with `{"gstin": "27AAPFU0939F1ZV"}`; `{"gstin": null}` clears it. The body must have the `gstin` key: an empty body is refused so it cannot clear the number by accident.
* Every change is in the audit trail (the shop's own number is a business identifier and is audited by value).

## A customer's GSTIN
Set it on the customer (company): `PATCH /v1/tenants/<t>/companies/<id>` with `{"gstin": "..."}` (Owner, Admin, Sales); `null` clears. It is **personal data of a sole proprietor** (it contains their PAN): it never appears in the audit log by value (only that the field changed), and the **company-scope erasure** (`docs/runbooks/sole-owner-erasure.md`) sets it to null. A GSTIN typed into a free-text note is not found by the erasure sweep.

## Where it shows
* An **order** and a **quote** (detail) show `customer_gstin` (from the company of the lead) and `shop_gstin`, read when the screen is shown, not copied: a corrected number shows at once. A quote list row shows `customer_gstin`. (On a quote the two fields are left out of the JSON when empty.) The quote's customer text is fixed by the pinned engine and does not carry them.
* The **accounting files**: CSV and XLSX (the `GSTIN` column, and `Seller GSTIN` last), the Vyapar workbook (Parties and Sales). **Not the Tally files**: see `docs/runbooks/accounting-export.md`.

## Not done (on purpose)
* No verification against the GST portal or a provider.
* No GSTIN column in the spreadsheet import yet.
* No GSTIN on the printed/typed customer text of a quote.
