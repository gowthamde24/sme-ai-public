# Contract: "What you sell", the four styles that are not products (C1 -> C2), 25 Nov 2026
Status: **built on a branch, held** (migration 20261231988100; it goes in with the combined production database push). This is the API the web adapter `apps/web/lib/api/what-you-sell.ts` has always called ("contract 1.1 part 1"): until now only the web side existed, so the adapter answered "not ready" on every 404. Behind the API flag `JOBS` (404 `not_found` on every route while it is off; the workspace door comes first). Same error shape as everywhere. Base `/v1/tenants/{tenant_id}`.
Products are NOT here: `style=products` is the catalogue (`/catalogue/...`), unchanged. The reading call is built (28 Nov 2026): see the last section.

## Read
`GET /what-you-sell?style=services|courses|properties|pricelist&limit=1..50&cursor=` (any member) -> `{ "style": "services", "items": [ { "id": "<uuid>", "name": "Haircut", ...the style's fields } ], "next_cursor": "<short word> | null" }`. Oldest first. Removed entries are not listed. `style=products` or any other word: 422.

## The fields of each style (the same keys the adapter reads and writes)
| style | fields (besides `id`, `name` 1..120) |
|---|---|
| services | `minutes` 5..1440 or null, `price_paise` whole paise or null, `price_from` bool, `booking` any_day / not_sunday / book_ahead, `place` at_shop / at_home / both / null |
| courses | `batch` (<= 120, may be empty), `starts_on` YYYY-MM-DD or null, `fee_paise` or null, `seats` `{state: open\|left\|full, count: 1..100000 only with left}`, `total` 1..100000 or null, `description` (<= 200) or null |
| properties | `location` (<= 120), `size` 1..10,000,000, `size_unit` sq_ft / sq_yd / acre / cent, `note` (<= 200) or null, `price_paise` or null, `status` available / booked / sold |
| pricelist | `moq` 1..10,000,000, `unit` piece / metre / kg / set / dozen, `rates` 1..8 of `{from_qty, rate_paise}` (quantities go up, a bigger order never costs more per piece), `good_until` YYYY-MM-DD or null |

## Write
`PUT /what-you-sell/{style}/{id}` body = the whole entry WITHOUT `id` (it is in the path) and with `name` (Owner or Admin; the authenticator code once per session for those who turned it on: 403 `mfa_required`). Answer: **201** the entry as stored when it is new, **200** when the same id was there (a retry or a change: never a second row). 422 `validation_error` with `error.fields` (names only, never the values) for a wrong shape; 422 too when the database refuses a text (a phone number or an address inside a name, a place or a note). **Only the Owner sets or changes an amount** (a price, a fee, a rate): an Admin who sends a different amount gets 403 (the same rule as the catalogue's exact price); an Admin may change every other field. An id that was removed is not brought back (404). An entry cannot change its style.
`POST /what-you-sell/{style}/{id}/remove` body `{}` (Owner or Admin) -> `{"removed": true}`; soft remove; removing twice is fine; a wrong style or id: 404. The API has no HTTP DELETE.

## First run
`GET /first-run` `items.count` = the catalogue's items + these entries that are not removed (docs/contracts/first-run.md). A non-textile business saves its first item here.

## The reading call (28 Nov 2026)
`POST /what-you-sell/{style}/read` (style = services | courses | properties | pricelist; Owner or Admin; the JOBS flag as the other routes) body `{ "kind": "sheet" | "photo" | "talk", "file_id": "<uuid from POST /assistant/files>" (sheet, photo), "text": "<= 2000 characters" (talk), "language": en|te|hi|kn|ta|ml }` -> `{ "style", "drafts": [ ... ], "unclear": bool, "notes": [ { "code", "row"? } ] }`. **Nothing is saved**: the owner checks each draft and saves it with the PUT above.
* A sheet is read cell by cell (xlsx, csv); a photo or PDF by local OCR first and, only when that finds nothing, by the AI model's vision (never in a school's workspace; it costs one assistant run, the hourly limit applies: 429 `ai_limit`); the owner's words (talk) one item a line ("Fall and pico 150"). All CODE: a price is the digits the file holds (`1,200`, `Rs. 4,800`, `₹1,250`, `1250/-`, up to 2 decimals) in whole paise; a price that is not clearly one (a range, "call us", a word) is NOT guessed: the draft carries `null` and the note `price_missing` with its row (1 to 20).
* Drafts (at most 20): pricelist `{name, moq (1 when the sheet has none), unit (only when the sheet says piece/metre/kg/set/dozen), rates: [{from_qty: moq, rate_paise | null}], good_until: null}`; services and properties `{name, price_paise | null}`; courses `{name, fee_paise | null}`.
* Notes (closed): `price_missing` (row), `unit_missing` (row, said once), `too_many` (more than 20 rows: only the first 20), `unreadable` (no table of an item and a price was found: `unclear: true`, no drafts).
* Errors: 404 for `products` or any other style, for a file that is gone (`file_gone`) and while JOBS or the assistant-work door is off; 422 `file_unreadable` with `reason` (and `fields`): doc_format (save as .docx), heic (send a JPG), scanned_school, no_reader (vision is off), unreadable; 422 `validation_error` (no text, no file); 403 for Sales and Viewer; 429 `ai_limit`.

## Reading a PRODUCTS price list from a photo or a PDF (26 Nov 2026; Customer Zero)
`POST /v1/tenants/{t}/what-you-sell/products/read`, Owner or Admin, JOBS on and the assistant's file door on for the workspace (404 otherwise), body `{ "file_id": "<uuid>" }` (strict). The file is the one dropped with `POST /v1/tenants/{t}/assistant/files` (a jpg, png or webp photo, or a PDF, up to 15 MB there; a phone's HEIC is turned into a JPEG by the web first: HEIC answers 422 `file_unreadable`, reason `heic`). Answer 200:
`{ "style": "products", "drafts": [{ "name", "price_paise": int|null, "unit": "piece|metre|kg|set|dozen|pair|box"|null, "notes": str|null, "confidence": "high|medium|low" }], "unclear": bool, "notes": [{ "code": "price_missing", "row": n } | { "code": "too_many" } | { "code": "unreadable" }], "read_by": "text_layer|ai_vision", "pages": n }`.
- NOTHING is saved. The owner checks each draft and saves it as a catalogue item or a row of a list with the usual routes (`style=products` is never stored under what-you-sell).
- The file is dropped after a reading that gave drafts; a page that gave none keeps it so the owner can try again.
- A PDF with a real text layer is read by code (confidence `high`, `read_by: text_layer`, no model, no cost). A photo, a scan or a handwritten notebook goes to the AI model's vision, one page at a time (at most 6 pages), `read_by: ai_vision`: English, Telugu, Hindi and Kannada, mixed; names stay in the script they are written in; digits of any script become 0-9. A school's pictures never go to the model (422 `file_unreadable`, reason `scanned_school`).
- Code, never the model, decides every number: a price is a number of rupees from 1 to 1,00,00,000 or `null` (never guessed; `confidence` is then `low` and the note `price_missing` names the row); a range or words is not a price; a phone number or an e-mail address in a name or note is removed; a row without a name is dropped; the same name with the same price is merged; at most 60 drafts (`too_many`).
- Cost and limits: one cost-accounted model call per page (label "Read a price list", 1,400 output tokens at most), inside the workspace's daily AI allowance: when it is used up the answer is 429 `ai_limit` (reason `run_limit_reached`). The log names the model, the pages and the number of rows, never a word of the page.

