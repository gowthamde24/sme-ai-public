# Contract: lead sources and imports (C1 -> C2), night 4, part A2. Published BEFORE building; shapes are final unless a line says "draft".

Branch `api/dr-lead-sources` (stacked on `api/dr-leads-pack`). Base: the API, all paths under `/v1`. Errors have the one shape `{error:{code,message,retry_after,request_id}}` (some add a closed `reason`).
The API has no DELETE verb and no multipart: files go as base64 inside JSON. Wording the API sends for the owner is for native review where it is not English.
Roles: **import and preview** = Owner, Admin, Sales. **Sources, sheet links, rotate/pause** = Owner, Admin. **Read lists** = Owner, Admin (Sales sees `GET /lead-imports` only).
Synthetic data only while the workspace's real-data gate is closed: a real number or e-mail is refused row by row with `reason:"real_data_gate"` (nothing else changes).

## 0. The source tags (`leads.source`, exact strings; the cost table and the reports use the same)
`indiamart` `justdial` `99acres` `magicbricks` `housing` `meta_lead_ads` `website_form` `webhook` `excel_upload` `google_sheet` `pasted_list` `vcard`
Every import and every live source writes exactly one of these into `leads.source` (text). The Source cost table (A3) is keyed by the same strings.

## 1. Bulk: file, Google Sheet, pasted list, vCard (Owner, Admin, Sales)

Nothing is kept between the three calls (read -> preview -> import): the client sends the same source content each time. A sheet is fetched again each time; the import itself is idempotent on `import_id`.

### POST /tenants/{t}/lead-imports/read   — "what is in this file" (no writes)
Body (strict): `{ "kind": "file"|"paste"|"vcard"|"sheet", "filename": str|null, "content_base64": str|null, "text": str|null, "sheet_url": str|null, "use_ai": bool (default true) }`
- `file`: `content_base64` of a .csv / .xlsx (UTF-8 CSV, tab-separated, or the first sheet of an xlsx; 3 MB, 5,000 data rows).
- `paste`: `text`, one lead per line: `name, phone` / `phone` alone / `name<TAB>phone<TAB>email` (up to 5,000 lines). No column mapping needed.
- `vcard`: `content_base64` or `text` of a .vcf (many cards in one file). No column mapping needed.
- `sheet`: `sheet_url` is a Google Sheets link (docs.google.com only). The sheet must be "Anyone with the link can view" or "Published to the web"; a private sheet answers 422 `sheet_not_public`.
-> `200`
```json
{ "kind": "file", "rows": 142,
  "columns": [ { "index": 0, "header": "పేరు", "samples": ["Ravi", "Anitha", "Kiran"], "field": "name", "confidence": "exact"|"partial"|"weak"|"ai"|"none" } , … ],
  "fields": [ { "field": "name", "label": "Name", "required": false }, { "field": "phone", "label": "Phone or WhatsApp number", "required": false }, … ]   // every field is optional; a PHONE OR AN E-MAIL must be mapped (else 422 `mapping_required_missing`),
  "mapping": { "name": 0, "phone": 1, "email": 3 },
  "mapped_by": "rules"|"rules+ai"|"none", "needs_confirmation": true, "warnings": ["cells_cut","formulas_ignored"] }
```
`mapping` is a SUGGESTION: the owner confirms or changes it on the next call. `field` values (closed): `name, phone, email, city, message, external_id, received_at, source_note`. Header text may be English, Telugu, Hindi, Kannada, Tamil, Malayalam or messy ("Mob. No.", "WA number"). The rules go first; only columns the rules cannot place are shown to the model, and the model sees the HEADER and a SHAPE of the values ("10 digits", "e-mail", "short text"), never a real value. For `paste` and `vcard`: `columns:[]`, `mapping:null`, `needs_confirmation:false`.
Refusals: 422 `sheet_refused` with `reason` in `empty, too_large, not_utf8, malformed_csv, too_many_rows, too_many_columns, no_header, not_xlsx, encrypted, unsafe_xml, unreadable`; 422 `sheet_not_public`; 422 `sheet_link_invalid`; 502 `sheet_unreachable`.

### POST /tenants/{t}/lead-imports/preview   — counts and estimate (no writes: the database does the whole job and rolls it back)
Body: the `read` body plus `{ "mapping": {field: column index}|null, "source": <tag from section 0, optional: the default for the kind>, "consent_confirmed": bool (default false) }`.
-> `200`
```json
{ "rows_read": 142, "source": "excel_upload",
  "counts": { "ready": 96, "duplicates_merged": 18, "duplicates_in_file": 4, "already_imported": 0, "invalid": 11, "dnd": 7, "no_consent": 0, "blocked": 0 },
  "estimate": { "messages": 96, "call_minutes": 240, "cost_paise": 1234, "basis": "estimate" },
  "problems": [ { "row": 12, "reason": "invalid_number" }, … ],
  "dnd_lookup": "checked"|"not_configured" }
```
Meaning of the counts (they never overlap except `dnd` and `no_consent`, which are flags on rows that are also counted in `ready` or `duplicates_merged`):
- `ready`: a NEW lead was (or will be) created. `already_imported`: the sender's own id was seen before (a portal lead pulled twice, a sheet row seen at the last sync). `duplicates_merged`: the same phone (E.164, `+91` and spaces ignored) already belongs to a contact: the new row is added to that lead's history, no second lead. `duplicates_in_file`: the same phone twice in this file (the first row wins). `invalid`: no valid number (and no e-mail) - not imported, listed in `problems`. `dnd`: the number is on the Do-Not-Disturb register (provider lookup): the lead is imported, **WhatsApp only, no promotional calls**. `no_consent`: rows that would get no consent record because `consent_confirmed` is false: they are stored but **nothing is sent to them**. `blocked`: refused by the real-data gate (`reason:"real_data_gate"`), or the person opted out earlier and arrived again (`reason:"opted_out"`: nothing is stored).
- `estimate`: messages = the ready leads with consent; call_minutes = ready leads with consent and not DND x the average call length; `cost_paise` from the current price table (the model never calculates it). Always `basis:"estimate"`.
- `problems` holds at most 50 rows (the row is the line in the file): `reason` in `invalid_number, no_contact_way, duplicate_in_file, already_imported, real_data_gate, opted_out, row_refused`.
With `consent_confirmed:true` the preview shows what the confirmation will do (nobody is counted in `no_consent`); with false, every new lead without an earlier consent is.

### POST /tenants/{t}/lead-imports   — import
Body: the preview body plus
`{ "import_id": uuid (makes a retry safe), "consent": { "confirmed": true, "list_name": str 1..120, "purpose": str 1..300, "basis": "explicit_consent"|"legitimate_use"|"contractual", "how_collected": str 1..300 } | null, "cost_per_lead_paise": int 0..10000000 | null }`
-> `201`
```json
{ "import_id": uuid, "status": "done", "source": "excel_upload", "consent_id": uuid|null,
  "counts": { "ready": 96, "duplicates_merged": 18, "duplicates_in_file": 4, "already_imported": 0, "invalid": 11, "dnd": 7, "no_consent": 0, "blocked": 0 },
  "problems": [ { "row": 12, "reason": "invalid_number" } ], "created_at": ts }
```
A repeat of the same `import_id` with the same content answers `200` with the same body; a different content under the same id is `409 import_id_used`.
- **Consent**: with `consent.confirmed:true` the confirmation is stored ONCE as a consent record (who, when, which list, purpose, how collected, the wording version) and every imported contact gets WhatsApp (and phone, unless DND) consent recorded against it. A contact that WITHDREW earlier is never re-consented. Without `consent` the leads are stored with consent "unknown": **nothing is sent to them** (the usual rule) and the answer counts them in `no_consent`.
- `cost_per_lead_paise` (optional) is written to the source cost table (`public.lead_source_costs`, see section 5) for this source.

### GET /tenants/{t}/lead-imports   ·   GET /tenants/{t}/lead-imports/{import_id}
List (newest first; `?limit=` 1..100 and `?cursor=` = the `next_cursor` of the page before) `{ items:[…], next_cursor:str|null }`, and one: the import answer's shape plus `kind`, `by` (the user's display name), `rows_read`, `consent_id`. No lead data is returned.

### Google Sheet kept in sync (Owner, Admin)
- `GET /tenants/{t}/lead-sheet-links/access` -> `{ "modes": [ { "mode": "anyone_with_link", "available": true }, { "mode": "published_csv", "available": true }, { "mode": "service_account", "available": false, "service_account_email": null } ] }`. `service_account` (the owner shares the sheet with our address) is **not available until the operator creates a Google service account** (then `available:true` and the e-mail address to share with).
- `POST /tenants/{t}/lead-sheet-links` `{ "link_id": uuid, "sheet_url": str, "mapping": {field: index}, "consent": {…as above}|null, "cost_per_lead_paise": int|null }` (the tag is always `google_sheet`) -> 201 `{ id, status:"active", sheet_title:null, last_synced_at:null, last_row_count:null, next_sync_at }`. The mapping is the one the owner confirmed on `read`.
- `GET /tenants/{t}/lead-sheet-links` -> `{ "items": [ { id, status: "active"|"paused"|"needs_attention", source, last_synced_at, last_row_count, last_result: {…counts}|null, last_error: "sheet_not_public"|"columns_changed"|"unreachable"|null, created_at } ] }`
- `POST …/lead-sheet-links/{id}/sync` (run now: 202 `{status:"queued", link}`, the worker pulls it within a minute), `…/pause`, `…/resume` (200 the link; nothing is ever deleted). The worker syncs active links every 15 minutes: only rows not seen before become leads (the phone is the identity), and a header change that breaks the mapping sets `needs_attention` instead of guessing.

## 2. Live sources (Owner, Admin)
A live source is a place where leads arrive by themselves. Each has an address that works like a password: **shown once** at creation (and again only after `rotate`); we keep only a hash.

### GET /tenants/{t}/lead-sources
`{ "items": [ { "id": uuid, "kind": "website_form"|"webhook"|"email_forward"|"meta_lead_ads"|"indiamart", "tag": <section 0>, "label": str, "status": "active"|"paused", "created_at": ts, "last_received_at": ts|null, "received_count": int, "token_hint": "…a1b2", "cost_per_lead_paise": int|null, "consent_confirmed": bool, "available": bool } ] }`
`available:false` = the kind needs something the operator has not switched on yet (`meta_lead_ads`: Meta verification; `indiamart`: the installation's IndiaMART key; `email_forward`: the inbound mail address). Creating one is still allowed; it simply receives nothing yet.
Tags per kind: `website_form`->`website_form`; `webhook`->`webhook`; `meta_lead_ads`->`meta_lead_ads`; `indiamart`->`indiamart`; `email_forward` -> the portal the owner picks in `portal`: `indiamart|justdial|99acres|magicbricks|housing` (or `webhook` for "any").

### POST /tenants/{t}/lead-sources
Body: `{ "source_id": uuid, "kind": …, "label": str 1..80, "portal": "indiamart"|"justdial"|"99acres"|"magicbricks"|"housing"|null (email_forward only), "consent": {confirmed:true, list_name, purpose, basis, how_collected}|null, "cost_per_lead_paise": int|null }`
-> `201` the list item plus
```json
"secret": { "shown_once": true,
            "url": "https://api.<host>/v1/lead-intake/<token>",                                      // website_form, webhook, email_forward (the mail provider posts here)
            "email_address": "leads+<token>@<inbound domain>" | null,                               // email_forward; null until the operator sets the inbound domain
            "snippet_html": "<form …>…</form>" | null,                                               // website_form: paste into any page (plain HTML, no script, posts to `url`)
            "meta_callback_url": "https://api.<host>/v1/lead-intake/meta/<token>", "meta_verify_token": "<token>" | null }   // meta_lead_ads
```
A repeat of the same `source_id` answers 200 WITHOUT the secret. Live leads without a stored consent confirmation are stored with consent "unknown" (nothing is sent to them).
### POST /tenants/{t}/lead-sources/{id}/rotate -> 200 the item + a new `secret` (the old address stops at once) · `…/pause` · `…/resume` -> 200 the item
### POST /tenants/{t}/lead-sources/indiamart/pull
The IndiaMART pull (the installation's key, as `POST /connectors/indiamart/pull`, which keeps working unchanged) through the same pipeline: de-duplication, DND, consent (the one confirmed when the `indiamart` source was registered), tag `indiamart`. Answer: `{ fetched, created, merged, invalid, existing, window_start, window_end }`. 503 `connector_not_available` when the key is not set.
### GET /tenants/{t}/lead-sources/unparsed   ·   POST /tenants/{t}/lead-sources/unparsed/{id}/discard
Mail that arrived on a forwarding address but no parser could read (so nothing is lost): `{ items: [ { id, source_id, received_at, subject, preview } ] }` (preview = first 300 characters; the owner copies the lead by hand or discards).

## 3. Public intake (NO sign-in; the address is the credential)
All answer without revealing anything about the workspace. Rate limited per address; the database holds its own caps (per source: 60 calls a minute, 2,000 leads a day, 20 leads a call).
### POST /v1/lead-intake/{token}
JSON or `application/x-www-form-urlencoded`. Fields (aliases accepted, extra fields ignored, all optional but a phone or an e-mail is needed): `name | full_name | your_name`, `phone | mobile | whatsapp | contact_number`, `email`, `message | requirement | enquiry | comments`, `city`, `external_id` (makes a retry safe), `consent` (true if the form has a tick box, **not** needed). A hidden `_hp` field that is filled = a bot: answered like a success, nothing stored.
-> `202 {"status":"received"}` (also for a duplicate or an invalid number: the sender learns nothing). `404` unknown or paused address. `429 rate_limited`.
Browsers: the embeddable snippet is a plain HTML `<form method="post">` (no script): the page navigates to the answer, so when the browser asks for HTML (`Accept: text/html`) the answer is a small "Thank you" HTML page instead of JSON. A script on the page may `fetch()` it with a form-encoded body (the answer carries `Access-Control-Allow-Origin: *`); a JSON body with a preflight from a browser page is NOT supported (server-to-server callers such as Zapier, n8n and Make have no such limit).
### POST /v1/lead-intake/{token}/email   (the mail provider's inbound webhook)
Body (strict): `{ "from": str, "to": str|null, "subject": str, "text": str, "html": str|null, "message_id": str|null }` -> `202 {"status":"received"|"unrecognised"}`. The sender is matched to a parser: **IndiaMART, JustDial, 99acres, MagicBricks, Housing** (one lead per mail; the tag is the portal's); a mail no parser can read is kept in the unparsed list. Mails from a forwarded Gmail (`Fwd:`) are unwrapped. The parsers are written from the portals' typical lead mails and are **not yet verified against real mails** - the owner should forward one real mail of each portal to check (see "Needs owner" in the report).
### POST /v1/lead-intake/mail   (one global address for the provider; header `X-Inbound-Secret`)
Same body; the source is found from the token inside `to` (`leads+<token>@…`). 401 without the right secret (env `LEAD_INBOUND_SECRET`). Not available (503) until the operator sets it.
### GET /v1/lead-intake/meta/{token}  ·  POST /v1/lead-intake/meta/{token}
Meta Lead Ads webhook: GET answers the `hub.challenge` when `hub.verify_token` is the source's token; POST takes Meta's payload (header `X-Hub-Signature-256` is checked with the Meta app secret) and fetches each lead from the Graph API with the page token. **Fake until Meta's app verification**: with `META_LEAD_PROVIDER` unset the route answers 503 `not_available`; with `fake` (development and tests) it creates the canned leads.

## 4. History of a lead (any member)
### GET /tenants/{t}/leads/{lead_id}/touches
`{ "items": [ { "at": ts, "kind": "first"|"repeat", "source": <tag>, "message": str|null } ], "flags": ["dnd","invalid_number"] }` - every time the same person arrived again (another file, another portal) is a `repeat` touch on the same lead; the message is the text they wrote (contact details inside it are removed).

## 5. Source cost table (created here, used by A3)
`public.lead_source_costs (tenant_id uuid, source text, cost_per_lead_paise bigint, updated_by uuid, updated_at timestamptz)`, primary key `(tenant_id, source)`; owner and admin may read it. **A3 does not create it.** The import writes it when `cost_per_lead_paise` is sent; A3 sets it through `PUT /outreach/source-costs`.

## 6. What changed for existing screens
- The old spreadsheet import (customers/stock/students) and `POST /connectors/indiamart/pull` are unchanged.
- `GET /v1/packs` and `GET /v1/lead-templates` are part A1's (see `contract-leads-pack.md`).
- `leads.source` of imported leads is one of the tags in section 0; the Leads list can group by it.
