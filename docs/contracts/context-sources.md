# Contract: "About my business" context + dead-simple lead sources (C1 -> C2), job context-and-easy-sources (28 Oct 2026)

Status: shapes FINAL unless a line says "draft". Base: the API, all paths under `/v1/tenants/{tenant_id}`. One error shape `{error:{code,message,retry_after,request_id}}`; no DELETE verb; files go as base64 inside JSON (3 MB). Synthetic data only while the real-data gate is closed (only the Owner Test workspace can hold real leads on staging).

## A. About my business (the assistant's context)
Roles: read = any member; write = Owner and Admin. Per workspace, versioned, never shared across workspaces.

### A1. The notes
- `GET /ai-assistant/context` -> `{ notes: str (<= 20,000 chars, Markdown allowed), version: int, updated_at, updated_by: {id, name}|null, prompts: [{key, label, hint}], used_by: ["chats","calls","ask","drafts"] }`. `prompts` are the gentle headings the screen offers (what we sell, prices and ranges, delivery areas and charges, timings, payment terms, always say, never say or promise, discounts, when to hand over to me, tone, FAQs); the owner fills or ignores them.
- `PUT /ai-assistant/context` body `{ notes: str, expected_version: int }` (autosave). `200` the new state (`version` +1). `409 context_changed` + the current state when someone else saved first (the screen merges or reloads). A save of the same text changes nothing. Blank is allowed.
- `GET /ai-assistant/context/versions?limit=20` -> `{items: [{version, updated_at, updated_by, size, change: "added 3 lines"|...}]}`; `GET .../versions/{v}` the text of that version; `POST .../versions/{v}/restore` makes it a NEW version. (Who changed what, when.)
- Schools (Education pack): the server REFUSES notes that make the assistant discuss fees, marks, dues or children's details: `422 not_for_schools` with `reason: "fees"|"marks"|"dues"|"children"`; the screen shows the plain sentence from `message`.
- Facts from the notes count as the business's own source: the assistant may state them ("from your notes") in chats, calls, Ask / the orb and drafts. Anything not in the records or the notes is still never invented.

### A2. Add context in any form (type, paste, upload, speak) with a preview
- `POST /ai-assistant/context/understand` body `{ kind: "paste"|"file"|"voice", text?: str, filename?: str, content_base64?: str, language?: "te"|"en"|"hi"|"kn" }`. Files: PDF, Excel (.xlsx), CSV, image (JPG/PNG: read by a vision model), DOCX, TXT; voice: a recorded clip (webm/ogg/wav, <= 2 minutes) transcribed by the speech service (the same Sarvam recogniser as the voice orb).
  -> `200 { preview_id, understood: [{section: "prices"|"delivery"|"timings"|"payment"|"always_say"|"never_say"|"discounts"|"handover"|"tone"|"faq"|"products"|"other", text: str}], notes_markdown: str, source: {kind, filename|null}, warnings: ["cells_cut","illegible_part","looks_like_personal_data"], expires_at }`. NOTHING is saved: this is the "Here is what I understood" screen; the owner reads and edits `notes_markdown`.
- `POST /ai-assistant/context/understand/{preview_id}/save` body `{ notes_markdown: str, mode: "append"|"replace", expected_version: int }` -> `200` the new context state. Previews expire after 30 minutes (`410 preview_expired`).
- Refusals: `422 sheet_refused` / `file_unreadable` / `file_too_large`; `422 not_for_schools` as above; `502 model_unavailable` (try again).
- Personal data: a price list is fine; a customer list is not context. If the file looks like a list of people (many phone numbers), the preview carries `warnings: ["looks_like_personal_data"]` and `notes_markdown` is empty: the screen points to Sources (import) instead.

### A3. Test it
- `POST /ai-assistant/context/test` body `{ question: str (<= 500), language?: str }` -> `200 { answer: str, language, used: [{from: "notes"|"facts", snippet: str}], would_hand_over: bool, reason: "asked_for_a_person"|"asked_about_money"|"complaint"|"unsure"|null }`. It answers as the assistant would to a customer on WhatsApp (same rules: no prices unless the notes say the assistant may; a price question WAITS FOR THE OWNER, shown as `would_hand_over`), using the saved notes. Costs one cheap model call (counts against the AI allowance); rate limit 10 a minute.

## B. Lead sources: one or two steps
### B1. The cards
- `GET /lead-sources/cards` (Owner, Admin) -> `{ items: [Card] }`, always in this order: `meta`, `indiamart`, `email_forward`, `website`, `files`, `whatsapp`, `missed_calls`.
  `Card = { kind, title, status: "not_connected"|"connected"|"needs_attention"|"coming_soon", headline: str ("Connected"), detail: str|null ("12 leads this week"), received_7d: int, last_received_at: iso|null, action: {type: "oauth"|"paste_key"|"copy_address"|"copy_snippet"|"upload"|"none", label: str}, problem: {code, message, fix: {type, label}}|null, available: bool }`.
  Plain words only (no HTTP codes, no API terms). `available:false` = the operator has not switched the door on (the card says "Coming soon" or "Ask us to switch this on").
- Statuses per kind: `meta` (Facebook/Instagram lead ads), `indiamart` (this workspace's own CRM key), `email_forward` (JustDial, Sulekha, other portals: forward the lead e-mails), `website` (a snippet or a form link; Google Forms and any form tool through the e-mail address), `files` (Excel, Google Sheet link, CSV, pasted list, phone contacts: the existing `lead-imports` + `lead-sheet-links` endpoints), `whatsapp` (connected through Integrations; new chats become leads automatically), `missed_calls` (`coming_soon` until telephony is live in December).

### B2. Per kind
- **Meta:** `POST /lead-sources/meta/connect` -> `{authorize_url, state}` (the screen opens it: "Continue with Facebook"); Meta redirects to the API's `GET /v1/lead-sources/meta/callback` (public, state-checked), which stores the page tokens and redirects the browser to `/app/tenants/{id}/lead-sources?meta=connected`. `GET /lead-sources/meta/pages` -> `{items: [{id, name, selected}]}`; `POST /lead-sources/meta/pages/{page_id}/select` -> the card turns `connected`. Needs Meta's app review (draft: `available:false` until then). `POST /lead-sources/meta/disconnect`.
- **IndiaMART:** `PUT /lead-sources/indiamart/key` body `{crm_key: str}` -> `200 {status: "connected"|"needs_attention", key_hint: "...a1b2"}`; the key is checked with one test pull and stored per workspace in Secret Manager; it is NEVER returned (only `key_hint`). `DELETE`-like: `POST /lead-sources/indiamart/disconnect`. A key that stopped working turns the card `needs_attention` with `problem: {code: "indiamart_key_rejected", message: "IndiaMART key stopped working: paste a new one", fix: {type: "paste_key"}}`.
- **E-mail forwarding:** `GET /lead-sources/email-address` -> `{address: "<workspace-token>@leads.stack19.com", gmail_filter_guide: [{step, text}], sample_portals: ["JustDial","Sulekha","IndiaMART e-mail"]}`; `POST /lead-sources/email-address/rotate`. Every forwarded mail is read by the AI normaliser (below); a mail it cannot read goes to `GET /lead-sources/unparsed` (a short list the owner can fix once).
- **Website:** `GET /lead-sources/website` -> `{snippet: "<script ...>", form_link: "https://.../f/<token>", webhook_url, rotate: ...}`.
- **Files, paste, contacts:** the existing `POST /lead-imports/read|preview` and `/lead-imports` (the AI already detects the columns; the owner never maps them unless the confidence is low).

### B3. Every lead is normalised (whatever the source)
`GET /leads` and `GET /leads/{id}` items gain `profile`:
`{ name, phone_e164, email, city, area, need: str|null (what they want), quantity: str|null ("2000 sq ft"), budget: str|null, timeline: str|null, urgency: "low"|"normal"|"high"|null, language: "te"|"en"|"hi"|"kn"|"ta"|"ml"|null, source: tag, campaign: str|null, original_text: str, confidence: {field: "high"|"medium"|"low"}, duplicate_of: lead_id|null, merged_count: int, junk: false|{reason: "spam"|"test"|"no_contact"|"abuse"}, fixed_by_you: [field] }`.
- Guessed fields carry `confidence: "low"|"medium"`; the card shows a small marker; `PATCH /leads/{id}/profile` body `{field: value, ...}` fixes a field in one tap (then `confidence` is "high" and the field is in `fixed_by_you`, and is never overwritten by a later guess).
- Duplicates (same phone or e-mail) are MERGED with a note (`merged_count`, the history keeps every arrival); junk is FLAGGED, never deleted (filter "Junk" shows it).
- Leads list filters: `source`, `status`, `urgency`, `created_from`, `created_to`, `q`; `new=true` highlights the leads not yet opened by this user (`is_new` per item).
- The original text is always kept and shown ("As they wrote it").

### B4. Errors in plain words
Never silent: every card with a problem has `problem.message` in plain words and `problem.fix` (one tap). A source that has received nothing for 7 days after being connected shows `detail: "Nothing received for 7 days"` (not an error).

### B5. Keys and secrets
Per-workspace keys (IndiaMART key, Meta page token) live in Secret Manager, named by workspace id, readable only by the API/worker service accounts; the database holds only the secret's NAME and a hint. Never shown back in full. Removing a source deletes the secret's active version.


## Built, 29 Oct 2026: part A (this section wins over the text above)
- **Built:** A1 (notes, versions, restore), A2 (understand for paste, Excel/CSV, Word .docx, text, voice; save), A3 (test). Part B is NOT built yet.
- **PDF and pictures are not read yet** (no PDF library on the API and the model interface has no image input): `422 not_supported_yet` with plain words ("I cannot read PDF files or pictures yet. Paste the text, or send it as Word, Excel or a text file."). The screen should offer paste / Excel / Word / text.
- `understand` kinds: `paste` (text), `file` (`filename` + `content_base64`, 3 MB), `voice` (`content_base64` audio, same recogniser as the voice orb; `503 voice_unavailable` when speech is not switched on). `preview_id` is a signed token valid 30 minutes for that person and workspace (`410 preview_expired` after; anything else invalid is 404). The preview saves nothing.
- Warnings in use: `cells_cut`, `illegible_part` (the document was longer than 60,000 characters; the rest was left out), `looks_like_personal_data` (five or more phone numbers/e-mails: `notes_markdown` is empty and the model is never called), `dropped_unverified` (a line whose numbers are not in the document was left out: the model may tidy, it may not invent).
- Errors: `409 context_changed` carries `error.current` = the whole current state; `422 not_for_schools` carries `error.reason`; `422 validation_error` (over 20,000 characters, unclean text), `422 no_notes` (test with no notes), `502 model_unavailable`, `503 model_busy`, the day's-allowance `budget` as for Ask.
- `test`: answers from the SAVED notes only (not the approved facts yet); a price/discount question, a request for a person, a complaint, or low confidence is `would_hand_over: true` with the fixed line "Let me check with the owner and come back to you." in `answer` and `used: []`. `used[].snippet` is checked to occur in the notes. Rate limit 10 a minute for test + understand together.
- Used by: chats (`/assistant/turns`), Ask (`/assistant/messages`: the notes are a source with `kind: "notes"`, label "From your notes", no target), the voice orb prompt, and the automatic WhatsApp replies (as facts; a price in the notes is still not repeated to a customer). Calls will read them when telephony exists. The notes are DATA, never instructions.
- `updated_by.name` comes from the sign-in profile when it has one (else null).
