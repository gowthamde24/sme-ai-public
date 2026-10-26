# Contract: "Leads & calls" business types, the lead playbook and the knowledge base (job DR / A1; C1 -> C2)

Published BEFORE the endpoints are built; shapes are final unless a line says "draft". Branch `api/dr-leads-pack` (stacked on `api/ds-spoken-style`, PR #118, which is stacked on #114-#117). API paths under `/v1`; errors have the one shape `{error:{code,message,retry_after,request_id}}`; the API has no DELETE verb (every removal is a POST). All non-English wording coming from the API is `wording:"draft"` for native review.

## 1. The nine business types (sign-up choice "Any business with leads")
They are ordinary packs (`GET /v1/packs` lists them with the three deep packs, status `preview` = "Not validated by a real owner yet"): `real_estate, coaching, clinic, insurance_loans, auto_dealer, interiors_solar, travel, gym, wholesale_b2b`. Accent token `leads_orange` (new: the web falls back to its default look until art exists) and one owl prop per type: `building, open_book, stethoscope, shield_check, car, sofa_sun, paper_plane, dumbbell, delivery_truck` (the web maps each to a stand-in icon in `PackCard.tsx`). The three deep packs (`textiles, construction_materials, education`) are unchanged and have NO template. `POST /v1/account/setup {business_type: "<pack id>"}` takes any of them.
Modules of these packs: today, inbox, contacts, enquiries, followups, visits, campaigns, call_list, voice_notes, reports, office, integrations (+ companies for wholesale_b2b).

### GET /v1/lead-templates  (no sign-in; for the template picker)
```json
{ "templates": [ { "pack_id": "real_estate", "version": 1, "names": {"en","te","hi","kn"}, "summary": {"en","te","hi","kn"},
                   "goal": { "code": "site_visit", "label": {"en","te","hi","kn"} }, "question_count": 7, "accent": "leads_orange", "owl_prop": "phone_headset", "validated": false } ] }
```
Order: by pack id. Cached 5 minutes.
### GET /v1/lead-templates/{pack_id}  (no sign-in; the full template for the wizard's "goal and questions" step)
```json
{ "pack_id": "real_estate", "version": 1, "names": {…}, "goal": { "code": "site_visit", "label": {…4 languages}, "ask": {"en": "…"} },
  "questions": [ { "code": "budget_band", "field": "budget_band", "ask": {"en": "What budget range are you comfortable with?"}, "required": true,
                   "field_definition": { "kind": "choice", "label": {"en": "Budget"}, "choices": [ {"code": "under_30l", "label": {"en": "Under 30 lakh"}}, … ] } } ],
  "objections": [ { "code": "too_expensive", "hears": ["too costly", "price is high"], "answer": {"en": "…"} } ],
  "followups": [ { "when": "no_answer", "after_minutes": 30, "channel": "call", "max_attempts": 3, "message": null } ],
  "outcome_reasons": { "not_interested": [ {"code": "budget_high", "label": {"en": "…"}} ], "interested": [ … ] },
  "safety": ["…"] }
```
`followups[].after_minutes`: minutes after the outcome; NEGATIVE = before the booked time (a reminder), only for `when: "booked"`. `when`: no_answer | interested | callback | booked | not_interested. 404 for a pack without a template (the deep packs).

## 2. The workspace's lead playbook (the owner edits the template)
### GET /v1/tenants/{t}/lead-playbook  (any member)
`{ "template_pack": "real_estate" | null, "saved": bool, "playbook": {goal_ask, questions, objections, followups, outcome_reasons}, "defaults": {same shape}, "safety": [..], "updated_at": ts|null, "wording": "draft" }`
`playbook` = what is in force (the saved one, else the template). `null` template_pack for a deep pack (then `playbook` is null and `defaults` is null). `playbook.questions[]`: `{field, ask:{en}, required}` (a subset and order of the pack's contact custom fields; at most 8); `objections[]`: `{code, hears[], answer:{en}}` (at most 8, answers state no price or promise); `followups[]` as above (at most 10); `goal_ask: {en}`; `outcome_reasons` as above. The `safety` rules are the type's and the platform's; they cannot be edited.
### PUT /v1/tenants/{t}/lead-playbook  (Owner + second factor)  ·  POST /v1/tenants/{t}/lead-playbook/reset  (Owner + second factor; back to the template)
Body of the PUT = the `playbook` object. 422 `playbook_invalid` with `reason` (a closed word: too_many_questions, unknown_field, price_or_promise, bad_followup, …) · 403/`mfa_required` · 409 `no_template` for a deep pack.

## 3. The knowledge base: facts the assistant may state
The owner pastes text (website, Instagram caption) or uploads a brochure / price list / FAQ (PDF, DOCX, plain text; images and scanned PDFs when a reader is configured), the AI drafts facts, the owner approves or edits them. **The assistant may only state APPROVED facts; a price only if it is an approved fact of kind `price`.** Roles: Owner/Admin manage; Sales and Viewer read APPROVED facts only.

- `GET /v1/tenants/{t}/knowledge/sources` → `{sources:[{id,title,kind:"paste"|"file",filename|null,content_type|null,chars,status:"read"|"drafted"|"discarded",created_at,facts:{draft,approved,rejected}}]}`
- `POST /v1/tenants/{t}/knowledge/sources` → 201 `{source}`. Body paste: `{source_id:uuid, kind:"paste", title, text}` (text up to 60,000 characters). Body file: `{source_id, kind:"file", title, filename, content_type, content_base64}` (raw file up to 5 MB; no multipart in this API). Errors: 413 `source_too_large`, 415 `unsupported_type`, 422 `unreadable_file`, 422 `no_text_found`, 503 `reader_unavailable` (an image or a scanned PDF and no reader configured: say "type or paste it instead"). A repeat of the same `source_id` answers 200 with the same source.
- `POST /v1/tenants/{t}/knowledge/sources/{id}/draft-facts` (a model call: counts against the plan's AI use; read-only workspaces get the usual 403) → `{facts:[{id,kind,text,status:"draft",source_id}]}`; running it again replaces the source's still-undecided drafts and keeps the decided ones.
- `GET /v1/tenants/{t}/knowledge/facts?status=draft|approved|rejected&source_id=&limit=&cursor=` → `{facts:[{id,kind,text,status,edited,source_id,decided_at,decided_by_you}], next_cursor}`
- `POST /v1/tenants/{t}/knowledge/facts` `{fact_id,kind,text}` → 201: a fact written by hand (status `draft`; it also needs approving).
- `POST /v1/tenants/{t}/knowledge/facts/{id}/edit` `{text, kind?}` → the fact, back to `draft` (an edit always needs approving again).
- `POST /v1/tenants/{t}/knowledge/facts/{id}/decide` `{decision:"approve"|"reject"}` → the fact. A `price` fact needs the Owner with a second factor; any other kind, Owner or Admin.
- `POST /v1/tenants/{t}/knowledge/sources/{id}/discard` → the source is hidden and its undecided drafts are dropped (approved facts stay until they are rejected or edited).
Fact kinds (closed): `price, offer, product_service, location, hours, policy, faq, contact, other`. Text 3 to 500 characters, plain text (no links to other sites, no markup).

## 4. Where the web should look
The setup wizard: step 2 = `GET /v1/lead-templates` + the pack choice at sign-up; step 1 = knowledge sources + facts review (a card per draft fact with Approve / Edit / Reject; prices flagged "needs your second factor"); step 3 = `GET/PUT /lead-playbook`.

> **Name (26 Oct 2026, part E1):** this family is part of **Lead Desk**, the core of Stack19 that is on for every business; see `lead-desk.md`. The nine business types are "template businesses"; the module `lead_desk` is core and not listed by any pack.
