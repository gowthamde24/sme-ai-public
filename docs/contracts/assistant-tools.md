# The assistant does the work: the API contract (C1 -> C2)

Status: **published 4 Nov 2026, stable for the shapes below**; the routes land in parts (each section says which PR). **Built (5 Nov): sections 0, 1 (files -> leads) and 2's `file_preview`, `plan`, `cant_do`, decide and undo.** Not yet: the secret and setup cards, the router's do / clarify for typed requests, section 3's list. Job `~/Desktop/stack19-jobs/job-assistant-does-the-work.md`. Base `/v1/tenants/{tenant_id}`.
Errors always have the one shape `{error:{code,message,retry_after,request_id}}`. JSON is snake_case. This **confirms C2's assumed shapes** (`apps/web/lib/assistant-work/types.ts`, PR #302) with the
changes marked **CHANGED**; everything else is exactly as C2 assumed.

## 0. The tools (A1, merged first)
- `GET /assistant/tools` -> `{ items: [ { name, method, path, level: "read" | "write" | "sensitive", sensitive: "money" | "sending" | "members" | "deleting" | "billing" | "secrets" | null, undo: "snapshot" | "inverse" | "none", summary } ], screen_only: [ { method, path, reason } ] }`
  (Owner, Admin, Sales). The same list the planner uses. You need it only for Settings -> Activity's labels and for a debug screen; the cards carry their own words.
- Every user-facing operation of the API is decided by `app/assistant_tools/catalog.py`. The table is `docs/assistant-tools-coverage.md`, generated from the live routes (527 operations: 480 tools; 93.6% of
  the non-forbidden ones). **A tool is a thin wrapper over the SAME route the screens call**, run with the person's own token: the same row-level security, validation, role rules and audit. There is no
  back door, so a Sales member's plan can only do what Sales may do (a step the route refuses is `failed` with `error: "forbidden"`).
- **Levels**:
  - read: runs at once, with no card;
  - write: a plan card, then the OK, then the run, then "Done · Undo";
  - sensitive (money, sending or calling, members and roles, deleting, secrets, a paid outside search): the plan card with an **explicit second confirm**, and **Owner only**.
- **Screen only** (never the assistant's): the real-data gate, billing changes, deleting the workspace, erasing a person's data, the assistant's own doors, the worker's doors. A file's bytes come in through
  the chat's file drop, never as a tool argument. Asked for one of these, the assistant answers with the `cant_do` card (`reason: "screen_only"`) and the screen's link.

## 1. Files in the chat (A2)
- `POST /assistant/files` `{ name, content_type, size_bytes, data_base64 }` -> 201 `{ file_id, name, size_bytes, kind: "sheet" | "pdf" | "image" | "doc" | "contacts" | "text", expires_at }` (Owner, Admin, Sales).
  - Limits: **CHANGED 10 MB** (the API's request limit is 20 MB and base64 is 4/3 bigger), 5 files per message, 5,000 rows per import; a lead list over 3 MB (the import's own limit) gets `cant_do`.
  - The kind is decided by code: the first bytes win over the name (a PDF named `.csv` is a PDF). `name` is cut to its last part (no path).
  - Only the person who dropped a file reads it back (another member's `file_id` in a turn: the sentence says the file is no longer here, no card).
  - The file is kept only as long as the import needs it, then deleted (DPDP; `expires_at`, at most 24 h).
  - Refusals: 413 `file_too_large`, 415 `file_type`, 422 `file_empty`.
- `POST /assistant/turns` gains **`attachment_ids: [uuid]`** (at most 5, each a `file_id` of this person, not expired). `text` is still required (1+ characters): send the person's words, or the
  file's name when they typed none. The router reads what each file is and where it goes, and answers with one `work_card` per file. **Nothing is written before the plan's OK.** No model call
  decides the kind; the AI column matcher sees only the headers it could not place and a few samples, as on the import screen.
  - sheet (.xlsx, .xls, .csv, .tsv, .ods), contacts (.vcf), text: read and previewed by the lead import's own routes -> `file_preview` (destination `leads`) with its plan, or with `plan: null`
    when nobody new is in it;
  - a sheet with no phone or e-mail column whose headers look like prices -> `cant_do` (`not_yet`, "adding a price list from a file", screen `/catalogue`);
  - pdf, image, doc -> `cant_do` (`not_yet`, screen `/settings/knowledge`). Brochures into About my business and price lists into the catalogue are later parts.

## 2. The cards: the turn's `work_card` event
`event: work_card` / `data: { "type": "work_card", "card": <one of the kinds below> }`, after the sentence, before `done`. The card's `id` is stable. A replay and `GET /assistant/conversations/{id}`
(`message.work_cards: [...]`) give the cards again, in their state now.

### file_preview
```json
{ "kind": "file_preview", "id": "uuid", "file_name": "march leads.xlsx", "destination": "leads" | "catalogue" | "knowledge" | "customer", "customer_name": null,
  "facts": [ { "code": "found", "n": 38 }, { "code": "existing", "n": 4 }, { "code": "no_phone", "n": 2 }, { "code": "supplier", "n": 1 } ],
  "columns": ["Name", "Phone", "Area"], "rows": [["Ravi Textiles", "+00 000 000 1234", "Jayanagar"]], "plan": <plan, below> | null }
```
- `facts` codes: found, existing, no_phone, supplier, no_price, duplicate, unreadable, too_many (today: found = new + existing, existing, no_phone, duplicate, unreadable, too_many). At most 5
  sample `rows`, with phone numbers as written in the file, **at the turn only**: the rows are not kept (DPDP), so a replay and `GET /assistant/conversations/{id}` give the card with `rows: []`.
  The card's `id` is stable (derived from its plan). A `cant_do` card and a preview with `plan: null` are not stored: a replay gives the sentence only.
- The leads import **reuses the existing bulk import**: the AI column matching, the dedupe and the consent record (`/lead-imports`). Price lists and stock reuse the catalogue import, and brochures use
  About my business (`/knowledge`).

### plan
```json
{ "kind": "plan", "id": "uuid", "plan": {
  "plan_id": "uuid", "title": "Add 34 leads from 'march leads.xlsx'", "status": "proposed",
  "steps": [ { "tool": "lead-imports.commit", "summary": "Add 34 new leads (4 already exist, left as they are)", "undoable": true, "status": "proposed", "error": null } ],
  "sensitive": null | "money" | "sending" | "members" | "deleting" | "billing" | "secrets", "owner_only": false, "needs_second_factor": false, "expires_at": "iso" } }
```
- `status`: proposed | running | done | partly_done | failed | cancelled | undone | expired. A step's status: proposed | running | done | failed | skipped | undone. A step's `error`: forbidden | invalid |
  conflict | not_found | limit | down.
- A plan has 1 to 20 steps, in order: "import this list, then tag them wedding season" is ONE plan. A plan expires 30 minutes after it was proposed.
- `GET /assistant/plans/{plan_id}` -> the plan (the requester's; the Owner and an Admin see every plan).
- `POST /assistant/plans/{plan_id}/decide` `{ decision: "do" | "cancel", confirmed: bool }` -> the plan (the `plan` object above, not the card). The file is deleted once the plan ran or was cancelled.
  - A sensitive plan needs `confirmed: true` (the card's second tap), otherwise 409 `confirm_needed`. It is the Owner's only (403 otherwise).
  - If a step's route needs the second factor, the plan says `needs_second_factor`, and a token without it gets 403 `mfa_required`.
  - A plan that is no longer proposed: 409 `plan_state`. Expired: 409 `plan_expired`.
- `POST /assistant/plans/{plan_id}/undo` -> the plan. It undoes the done steps that declare an undo, newest first, and leaves the others as they are, with their own words. It is the Owner's, or the
  person who said "Do it", **and each step's own undo route decides too**: an import's undo (`POST /lead-imports/{import_id}/undo`) archives what the import created and nobody has worked on since
  (no message, no touch, no second arrival, still "new", no quote or order); the rest stays. Archiving is the Owner's or an Admin's, so a Sales member who imported gets 403 `forbidden` on Undo.
  Nothing undone: 409 `nothing_to_undo`. A plan that did not run: 409 `plan_state`.

### secret (A4)
```json
{ "kind": "secret", "id": "uuid", "request_id": "uuid", "secret": "indiamart_key" | "justdial_key" | "whatsapp_token" | "smtp_password" | "sheet_key" | "other", "title": "Your IndiaMART CRM key", "hint": "Lead Manager -> Settings -> CRM key", "saved": null | { "last4": "1a2b" } }
```
- **CHANGED**: the card's `id` and its `request_id` are both given; the value goes to `request_id`.
- `POST /assistant/secrets/{request_id}` `{ value }` -> `{ saved: true, last4: "1a2b" | null }` (Owner only). The value is stored in Secret Manager like today, under a name made from the workspace and the kind.
  - It is **never** in the conversation, in a turn's history, in the model's input, in a log, an audit row or an error.
  - A test pins all of this. The answer says at most the last four characters.
  - A request is good for 15 minutes, and once.

### setup
```json
{ "kind": "setup", "id": "uuid", "setup": "indiamart" | "email_forward" | "website_form" | "google_sheet" | "voice_language" | "calling_hours" | "followup_rules" | "team_invite",
  "title": "...", "steps": ["..."], "copy": [ { "label": "Your lead address", "value": "leads+ab12@leads.stack19.com", "code": false } ], "portals": [ { "name": "JustDial", "steps": ["..."] } ],
  "secret": <secret card> | null, "test": "send_test_lead" | "pull_now" | "test_call" | "send_test_mail" | null, "last_test": null | { "ok": true, "reason": null, "detail": null, "at": "iso" },
  "screen": { "label": "Lead sources", "href": "/lead-sources" } | null }
```
- `POST /assistant/setups/{setup_id}/test` `{ test }` -> `{ ok, reason: null | "no_key" | "key_rejected" | "nothing_arrived" | "form_not_found" | "sheet_not_shared" | "not_reachable" | "timeout" | "other", detail, at }`.
  - `detail` is plain words, never a key.
  - `test_call` is the existing simulated test call: nothing is dialled.

### cant_do (A6)
```json
{ "kind": "cant_do", "id": "uuid", "reason": "not_yet" | "screen_only", "what": "Opening the real-data gate", "screen": { "label": "Settings -> Data", "href": "/settings/data" } | null }
```
`href` is a path inside the workspace, which your `insideBase` keeps. `not_yet` means no tool exists for it yet: the assistant says so, never pretends. `screen_only` means it is always a screen and a person.

## 3. Settings -> Activity (design 6)
- `GET /assistant/actions?since=<iso>&before=<iso>&limit=50` -> `{ items: [ { action_id, tool, summary, changed, requested_by, message_id, at, status: "done" | "failed" | "undone", undo: "available" | "done" | "none" | "expired" } ], next_before }`
  (Owner, Admin). Every entry is "by the assistant, on <requested_by>'s request". **Built: the log is written** (one row per step that ran, with its undo for 7 days); the list and its undo
  routes are the next part. **CHANGED:** the change's own audit row is the person's (the route ran with their token); the request carries `X-Assistant-Message: <message id>`, and the action log
  row carries the `message_id`. Writing it into the audit row too is a later part.
- `POST /assistant/actions/{action_id}/undo` -> the entry. An undo is offered for 7 days, then `undo: "expired"`.
- "What did you change today?" in the chat is answered from the same list.

## 4. Never
Imported or edited contacts are **never** messaged or called because of this: the normal follow-up rules and the auto-send policy apply. A plan's step "add 34 leads" adds leads. It does not message them.
