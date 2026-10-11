# Runbook: spreadsheet import, the visits calendar feed, policy acceptance (job BI, ADR 0073)

## Importing customers or catalogue stock from a spreadsheet
Who: Owner or Admin (the final step needs a second factor). File: CSV (UTF-8; Excel: *Save As > CSV UTF-8*), or **.xlsx** (Google Sheets: *File > Download > Microsoft Excel*). The first sheet; the first row is the column names; at most 500 rows, 2 MB (a CSV 1 MB). Nothing is stored from the file except a small record of the import (the file's hash, which column is which, counts, line numbers of problems).

1. **Inspect** (`POST /v1/tenants/{id}/imports/spreadsheet/inspect?kind=customers|stock`, the file as the body): the columns with a suggested meaning (English, Telugu, Hindi, Kannada, Tamil headers), three sample rows. Change nothing yet.
2. **Preview** (`.../preview?kind=...&job_id=<new uuid>&mapping={"company_name":0,"contact_phone":2}`; leave `mapping` out to use the suggestion): one verdict per row.
   * Customers: `will_create`, `duplicate` (an existing customer: **left alone, never overwritten**), `needs_review` (could be more than one existing company), `rejected` (with the lead import's code, for example `contact_domain_not_reserved` while the real-data gate is closed), or a problem in the file itself (`issues`: a line number and a code such as `formula_like`, `hidden_characters`, `company_name_missing`, `cell_too_long`). A row with a contact but no e-mail keeps its company and says `contact_needs_email`.
   * Stock: `will_change` (old status → new), `unchanged`, `not_found` (no catalogue saree with that name), `ambiguous` (two with that name). The status comes from a status column (English, Telugu, Hindi words) or from a quantity column (3 or more in stock, 1 or 2 few left, 0 made to order, which is also how "out of stock" is read: the catalogue has no "none" status).
3. **Confirm** (`POST .../imports/spreadsheet/{job_id}/confirm`, the **same file** again, second factor): runs it and closes the job with its counts. A different file is refused (`409 import_file_changed`); running a finished job again returns its result (`replay: true`), so a double click or a retry imports nothing twice; a failed job may be run again.
4. `GET .../imports/spreadsheet/jobs` and `.../jobs/{job_id}` show the jobs and their results.
Samples: `services/ai-api/tests/golden_bi/sample_customers_telugu.csv`, `sample_customers_hindi.csv`, `sample_stock.csv` (invented).
Limits worth knowing: a customer's contact needs an e-mail address (an existing rule of the lead import); GSTIN is not imported (nothing stores it yet).

## The visits calendar feed (Google or Apple Calendar, no Google account needed)
* Make yours: `POST /v1/tenants/{id}/calendar-feed` (any member). The answer has the **token once** and the path `/v1/calendar/feed/<token>.ics`; the address to give a calendar app is the API's public address + that path (the calendar app calls the API directly). Google Calendar: *Other calendars > From URL*; Apple: *File > New Calendar Subscription*.
* It lists the shop's upcoming visits (from two hours ago to 90 days ahead; booked, confirmed, arrived): when, how long, the state, the party size and **first name + last initial** (no phone, e-mail, note, purpose or company). Calendar apps refresh it about once an hour or a few times a day.
* Making a new one **revokes the old** at once; `POST /v1/tenants/{id}/calendar-feed/revoke` revokes yours; `GET` shows `{active, created_at, last_used_at}` and never a token. A feed also stops when its member leaves the business.
* Only the token's SHA-256 is stored. Rate limits: 60 reads an hour per token, 240 per 10 minutes per address, 20 unknown tokens per 10 minutes per address.

## Terms and privacy acceptance
`GET /v1/policies/current` (no sign-in) → `{terms: {version}, privacy: {version}}` (set by `TERMS_VERSION` and `PRIVACY_VERSION`). The sign-up page sends them with `POST /v1/account/setup` as `accepted_terms_version` and `accepted_privacy_version`; the evidence row (person, kind, version, time, how) is written before the business is made. Later: `GET/POST /v1/me/policy-acceptances`.

## Voice status
`GET /v1/tenants/{id}/assistant/voice/status` (Owner, Admin, Sales) → `{available, speech_available, languages, max_seconds, max_bytes, content_types}`; it calls no provider.
