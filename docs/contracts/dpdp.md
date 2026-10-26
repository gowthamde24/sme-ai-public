# Contract: DPDP backend (C1 -> C2), night 27 Oct. Published BEFORE building; shapes are final unless a line says "draft".

Base: the API, all paths under `/v1`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`. The API has no DELETE verb:
every "remove" is a POST. Addresses (privacy, hello) are NOT hard-coded in the web: read them from `GET /v1/privacy/notice`.
Wording that C2 shows from the API (`wording:"draft"`) is for native review.

## 1. Public (no sign-in)

### GET /v1/privacy/notice
```json
{ "privacy_version": "2026-10-25", "terms_version": "2026-10-25",
  "contact": { "privacy_email": "…", "hello_email": "…" },
  "grievance": { "acknowledged": "at once", "answer_within_days": 30 },
  "retention": { "lapsed_read_only_days": 90, "erasure_warning_hours": 48, "account_deletion_cancel_days": 7, "security_log_days": 365 },
  "purposes": [ { "purpose": "service", "required": true }, { "purpose": "marketing", "required": false, "default": "off" } ] }
```
### GET /v1/privacy/subprocessors
`{ "version": "2026-10-27", "updated_on": "2026-10-27", "wording": "draft", "subprocessors": [ { "id": "google_cloud", "name": "Google Cloud", "purpose": "Hosting of the app, its worker and files", "country": "India (Mumbai)", "data": "All app data", "link": "https://…" }, … ] }`
Ids: `google_cloud, supabase, resend, zoho, anthropic, meta_whatsapp, sarvam`. Fixed order. Cached, public.

### POST /v1/privacy/grievance
Body (strict): `{ "grievance_id": uuid (optional, makes a retry safe), "name": str 1..120, "contact": str 3..200 (e-mail or phone), "kind": "access"|"correction"|"erasure"|"withdraw_consent"|"complaint"|"other", "details": str 0..4000, "language": "en"|"te"|"hi"|"kn" (optional), "captcha_token": str (optional, see 4) }`
-> `201 { "reference": "GR-2026-000123", "status": "received", "received_at": ts, "answer_due_on": "YYYY-MM-DD", "answer_within_days": 30 }` (a repeat of the same grievance_id answers 200 with the same body).
Stored, e-mailed to the privacy inbox, the person is acknowledged by e-mail when `contact` is an e-mail. Errors: 422 invalid, 429 `rate_limited` (retry_after), 400 `captcha_failed`.

### POST /v1/public/waitlist  (the public site's "book a demo / join the waitlist")
Body (strict): `{ "name": str 1..120, "business_type": "textiles"|"construction"|"education"|"other", "city": str 1..80, "phone": str|null, "email": str|null (at least one of the two), "language": "en"|"te"|"hi"|"kn"|"ta"|"ml", "marketing_opt_in": bool (default false), "notice_version": str (the privacy_version the person saw), "captcha_token": str|null }`
-> `201 { "status": "joined", "marketing_opt_in": bool }` (the same contact again answers 200 `{"status":"already_joined"}`; it never says which). Rate limited 5 per hour per address and 3 per hour per contact. The consent (given or not) is stored with the notice version and the time. A "we got you" e-mail goes to the hello inbox. 429 `rate_limited`, 400 `captcha_failed`.

## 2. A signed-in person

### GET /v1/me/consents
```json
{ "notice_version": "2026-10-25",
  "consents": [ { "purpose": "service",   "state": "given",     "since": ts, "notice_version": "…", "via": "signup"|"google"|"settings"|"prompt" },
                { "purpose": "marketing", "state": "not_given"|"given"|"withdrawn", "since": ts|null, "notice_version": "…"|null, "via": "…"|null } ],
  "history": [ { "purpose": "marketing", "action": "given"|"withdrawn", "at": ts, "notice_version": "…", "via": "…" } ] }   // newest first, the last 50
```
`service` is shown but cannot be switched off here (it is the account itself); to end it the person deletes the account (section 3).
### PUT /v1/me/consents/marketing  — give and withdraw are the SAME one call
Body `{ "given": true|false, "via": "signup"|"google"|"settings" (default "settings") }` -> `200` the same body as GET. `via` "signup" / "google" is for the sign-up screen's optional, UNTICKED box (call it after sign-up). Repeating the same state changes nothing (no new history row). Withdrawing works at once and is never refused.
### GET /v1/me/profile  ·  PUT /v1/me/profile
`{ "display_name": str 1..100, "email": str (read only), "created_at": ts }`; PUT takes `{ "display_name": str 1..100 }` (the one thing a person can correct; the e-mail changes through the sign-in provider). Logged.

## 3. Rights that already exist and what changed
- Download my data: `POST /v1/me/data-exports {export_id}` (person) and `POST /v1/tenants/{t}/data-exports {export_id}` (Owner + second factor) -> 202, then `GET /v1/me/data-exports/{id}` until `ready`, `POST …/link` for a 5-minute signed URL. **Change:** the file is a zip of **JSON and CSV** (each table as `name.json` and `name.csv`; README and manifest inside); the person's zip now also holds `consents.json`/`.csv`.
- Delete my account: `POST /v1/me/deletion-requests {request_id, confirm_email}` -> 201; `POST /v1/me/deletion-requests/{id}/cancel`. **Change:** the cancel window is **7 days** (was 14). Same for a workspace (`POST /v1/tenants/{t}/deletion-requests`). Every step is logged (audit). Fields unchanged: `execute_after` is when it happens; show "you can cancel until {execute_after}".
- Lapsed workspace: unchanged fields on `GET /billing/access` (`access`, `read_only_since`, `delete_on`, `data_days_left`). **New:** `erasure_warning_sent_at` (ts|null) on the same answer. 90 days read-only, an e-mail to the Owner 48 hours before, then the workspace is erased.

## 4. Captcha
Every public POST takes an optional `captcha_token`. `CAPTCHA_PROVIDER=none` (today, everywhere) accepts without one; when it is switched to `turnstile` a missing/invalid token is `400 captcha_failed`. The web needs no change today; when it adds the widget, send the widget's token as `captcha_token`.

## 5. Not in this contract
Cookie banner, the privacy page layout and the wording of the notice are C2's. The breach runbook is internal (docs/runbooks/breach.md).

## 6. Additions made while building (27 Oct, nothing above changed)
- `POST /v1/public/waitlist` answers **409 `policy_version_outdated`** when `notice_version` is not the current `privacy_version` (read `GET /v1/privacy/notice` when the form opens and send that value).
- Both public POSTs have a per-minute allowance per address on top of the hourly caps (6 a minute); a refused request is the usual 429 with `Retry-After`.
- `GET /v1/tenants/{t}/billing/access` has the new field **`erasure_warning_sent_at`** (ts or null): null until the 48-hour e-mail went to the Owners; only read-only workspaces can have one. The erase day itself is the existing `delete_on`.
- The person's data download is a zip with every `.json` file ALSO as `.csv` (the workspace one too: `tables/<name>.json` and `.csv`), plus `consents.json`/`.csv`.
- Profile: `display_name` may not contain `< > { } \ |` (422).
- The lapse erasure is OFF until the operator switches it on (`docs/runbooks/dpdp-operations.md`); the screen should still show the dates from `/billing/access`.
