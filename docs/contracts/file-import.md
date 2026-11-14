# Contract: files in the assistant (C1 -> C2), 14 Nov 2026 (owner prompt C)

**What exists today** (job assistant-does-the-work A2/A3, `docs/contracts/assistant-tools.md` sections 1 and 2): upload in the chat -> kind by code -> text extraction (Word, PDF with text, local OCR in English/Telugu/Hindi/Kannada, AI vision on page images when OCR finds nothing; never for a school) -> a `file_preview` card (5 sample rows) -> `plan` -> "Do it" -> Undo. **What this contract adds** (built by C1 in slice C, behind the same routes; mock against it now): an EDITABLE preview with confidence per cell, handwritten pages, a consent source, a price-list / catalogue destination, 20 MB, 90-day originals.

## 1. Upload
`POST /assistant/files` `{name, content_type, size_bytes, data_base64}` (unchanged) -> `201 {file_id, name, size_bytes, kind, expires_at}`.
* **Limit 20 MB** (was 10; the request limit grows to 28 MB base64). Refusals: 413 `file_too_large`, 415 `file_type` (allowed: pdf, png, jpg, jpeg, webp, heic, gif, xlsx, xls, csv, tsv, ods, docx, vcf, txt), 422 `file_empty`, **422 `file_unsafe`** (new: a type/virus check failed; draw "That file looks unsafe, I did not open it").
* Paperclip, drag-and-drop, pasted screenshot and the phone's "Take photo" all end here (an image from the camera is `image/jpeg`).
* `expires_at` is when the READ COPY goes (24 h). **The original is kept 90 days, private to the business, and is deleted then** (say so once in the card: "We keep the original for 90 days"). The owner can delete it earlier from the card.

## 2. The turn
`POST /assistant/turns` with `attachment_ids` (unchanged). The reply is one `work_card` per file.

## 3. The editable preview card: `file_preview` v2
```
{ "kind":"file_preview", "id":"uuid", "import_id":"uuid", "file_name":"...", "destination": "leads"|"catalogue"|"knowledge"|"customer",
  "read_by":"file"|"local_ocr"|"ai"|"ai_handwriting", "language":"te",
  "state":"ready"|"importing"|"done"|"cancelled",
  "columns":[ {"key":"name","label":"Name"}, {"key":"phone","label":"Phone"}, {"key":"interest","label":"Interested in"}, {"key":"source","label":"Source"} ],     // catalogue: item, price, stock, unit
  "counts": {"rows":23, "new":19, "existing":3, "invalid_phone":1, "unsure":4},
  "rows":[ {"row_id":"r1", "include":true,
            "cells":{"name":{"value":"Ravi Textiles","unsure":false}, "phone":{"value":"+919876543210","unsure":false,"valid":true}, "interest":{"value":"Pattu sarees","unsure":true}},
            "flags":{"duplicate_of":{"lead_id":"uuid","name":"Ravi T."} | null, "invalid_phone":false, "missing_required":false} } ],
  "next_cursor":null,
  "consent": {"required":true, "options":["walk_in","asked_us","existing_customer"], "chosen":null},
  "plan": <plan> | null }
```
* **`unsure: true`** cells are highlighted (low OCR/vision confidence). Phones are normalised to `+91XXXXXXXXXX`; `valid:false` = not an Indian number (the row is excluded by default). Dedupe is by phone (`duplicate_of` set; default `include:false`).
* Rows are returned in pages (`next_cursor`); the card holds at most 5,000 rows. Row data is kept only until the import runs or is cancelled (and at most 24 h).

## 4. Editing and confirming
* `GET /assistant/imports/{import_id}?cursor=` -> the card (state and rows now).
* `PATCH /assistant/imports/{import_id}/rows` `{edits:[{row_id, cell:"name", value:"..."}, ...], include:[{row_id, include:false}]}` -> `{counts}` (revalidates phones and duplicates; an edited cell is no longer `unsure`).
* `POST /assistant/imports/{import_id}/confirm` `{consent_source: "walk_in"|"asked_us"|"existing_customer" (required for destination leads), exclude_row_ids?: []}` -> the plan card (the usual plan: "Do it" -> `POST /assistant/plans/{id}/decide`). **Imported people get that consent source; nobody can be called or messaged without one** (calls and messages stay refused by the outbox until a source is recorded).
* `DELETE /assistant/imports/{import_id}` cancels and deletes the rows and the original at once.
* "Add 23 leads" = the button of the plan card; Undo is the plan's undo (archives what the import created and nobody has worked on since).
* Errors: 404 (not yours / gone), 409 `import_state`, 422 `consent_source_required`, 422 `validation_error` (bad edit).

## 5. Catalogue / price lists
`destination:"catalogue"`: columns `item`, `price` (rupees as text "24,500" and `price_paise` int), `stock`, `unit`; flags `changed` (old -> new price shown as `old_price_paise`), `not_in_catalogue` (will be added). The plan applies prices as the catalogue import does today (undo = prices restored).

## 6. Handwriting
A photo of handwritten Telugu/English/Hindi pages is read by the AI vision model (`read_by:"ai_handwriting"`, cost-accounted under the day's allowance, never for a school); every cell is `unsure` unless the model marks it clear; the owner always reviews. Nothing is written before "Add N leads".
