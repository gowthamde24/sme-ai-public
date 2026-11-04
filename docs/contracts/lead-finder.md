# Lead Finder: the API contract (C1 -> C2, job part D)

Status: **stable** for part D (4 Nov 2026). ADR 0119. Branch `api/lead-finder`. Base `/v1/tenants/{tenant_id}`. Errors always have the one shape `{error:{code,message,retry_after,request_id}}`.
Everything a demo workspace sees is **made-up businesses** (`source: "fixture"`). Google Maps results (`source: "google_maps"`) exist only in the Owner Test workspace, once the owner has created the Places key.
**No call is ever dialled**: the qualifying call is the simulator (`POST /prospects/{id}/simulated-call`).

Who: Owner, Admin and Sales read and act; **Owner and Admin** approve a search, change the settings and run a simulated call; a Viewer gets 403. A business type without the Lead Finder (a **school**) gets
**403 `lead_finder_not_available`** from every route below except `availability`, which says `available: false`: hide every Lead Finder screen, button and word then.

## 0. `GET /lead-finder/availability` -> 200
```json
{ "available": true, "source": "fixture | places | null", "reason": "ok | not_for_this_business | switched_off" }
```
Use it to show or hide the Prospects tab, the plan card and Settings -> Lead Finder. Never an error for a member.

## 1. The plan card: `POST /lead-finder/plan` -> 201 `SearchOut` (state `planned`)
Request (closed; one of `text` or `query`):
```json
{ "text": "find new retailers in Jayanagar", "language": "en" }
{ "query": "saree shops", "area": "Jayanagar Bengaluru", "max_results": 20 }
```
`text` is the owner's words, typed or transcribed, in en/te/kn/hi ("Jayanagar లో కొత్త retailers వెతుకు"). Nothing is searched yet. 422 `not_a_search` when the words are not a request to find businesses
(show the message: it gives an example). 409 `lead_finder_off` when the platform switch is off.

`SearchOut`:
```json
{ "id": "uuid", "state": "planned | approved | done | failed | cancelled",
  "query": "saree shops", "area": "Jayanagar Bengaluru", "category_hint": "retailer | boutique | contractor | builder | dealer | other | null",
  "max_results": 20, "provider": "fixture | places", "sku": "fixture | places_text_search_enterprise",
  "est_cost_paise": 0, "cost_paise": 0, "cost_is_estimate": false,
  "source_label": "Example search (made-up businesses) 'saree shops Jayanagar Bengaluru', 4 Nov",
  "found": 0, "counts": null, "searches_left_today": 5, "attribution": "Google Maps | null",
  "created_at": "iso", "approved_at": "iso | null", "finished_at": "iso | null" }
```
The plan card shows: query, area, max results, the estimated cost (`est_cost_paise`, "estimate" when `cost_is_estimate`), searches left today, and two buttons: **OK** (Owner/Admin) and Cancel.
`attribution` is `"Google Maps"` whenever the provider is `places`: show "Google Maps" next to any Places data (the result card, the list, a prospect).

## 2. The OK: `POST /lead-finder/searches/{id}/approve` -> 200 `SearchOut` (state `done` or `failed`)
Owner, Admin. Runs the search there and then (one request; a few seconds at most) and returns the **result card**. The same OK again returns the same result (idempotent).
`counts` on a done search:
```json
{ "found": 20, "new": 18, "duplicates": 2, "call_ready": 0, "needs_owner": 11, "skipped": 7, "researching": 0,
  "duplicate_customer": 1, "duplicate_company": 0, "duplicate_prospect": 1, "duplicate_suppressed": 0 }
```
Result card text: "Found {new} · {call_ready} call-ready · {needs_owner} need you · {skipped} skipped" (keys that are absent are 0). `failed` = the source did not answer (nothing billed, nothing stored).
Errors: 429 `search_cap_reached` (today's searches are used up; the cap is a setting), 409 `prospect_state` (the search was cancelled), 403 for Sales.
`POST /lead-finder/searches/{id}/cancel` (Owner, Admin) -> `SearchOut` state `cancelled` (only a planned search).
`GET /lead-finder/searches?limit=20` -> `{ "items": [SearchOut] }`; `GET /lead-finder/searches/{id}` -> `SearchOut`.

## 3. The Prospects tab: `GET /prospects?status=&search_id=&limit=50&cursor=` -> 200
Best fit first. `status` one of `new, researching, call_ready, needs_owner, skipped, contacted, qualified, not_interested`. `next_cursor` is passed back as `cursor`.
```json
{ "items": [ProspectOut], "next_cursor": "string | null" }
```
`ProspectOut`:
```json
{ "id": "uuid", "search_id": "uuid | null", "name": "Sri Lakshmi Sarees", "category": "Saree shop", "area": "Jayanagar",
  "phone": "+00 000 5123 4567", "website": null, "rating": 4.5, "review_count": 312, "lat": 12.93, "lng": 77.58,
  "source": "google_maps | fixture", "source_label": "Google Maps search 'saree shops Jayanagar', 2 Nov", "attribution": "Google Maps | null",
  "status": "needs_owner", "decision_reason": "first_calls",
  "fit_score": 82, "fit_reason": "Saree shop; we have Kanchi Pattu Bridal, Dharmavaram Silk Classic in stock; 312 reviews",
  "stock_match": { "matched": ["Kanchi Pattu Bridal"], "low": ["Soft Silk Daily"], "enough": true },
  "owner_approved": false, "suppressed": false, "ask_after": null, "last_contacted_at": null, "lead_id": null,
  "qualification": null, "created_at": "iso", "updated_at": "iso" }
```
* The decision badge is `status`: **call_ready** "Ready to call", **needs_owner** "Needs you", **skipped** "Skipped", **researching** "Waiting" (outside calling hours or today's cap), **contacted**, **qualified** (has a `lead_id`: link to the Lead Desk lead), **not_interested** (never called again; `suppressed: true`).
* `decision_reason` (closed words) for the one-line why: `fit_high`, `fit_middle` (fit 50 to the bar), `fit_low`, `first_calls` (the first 10 calls of every new search wait for the Owner), `low_stock`, `no_stock_match`, `very_large`, `competitor`, `not_a_buyer`, `suppressed`, `contacted_recently` (90 days), `outside_hours`, `daily_cap`, `owner_approved`, `owner_skipped`, `asked_later`, `no_phone`.
* Needs-you row text: "{name} · fit {fit_score} · {reason in words}" (e.g. "Sri Sai Constructions · fit 64 · low stock").
* `qualification` (after a call): `{summary, captured:{sells, price, quantity, supplier, timing, decision}, language, whatsapp_ok, callback, pitched:[...], quote_suggestion:[{item, unit, price_paise|null, moq|null, quantity_said}], simulated: true}`. Personal data: show it to members, never in a notification or a title.
* `GET /prospects/{id}` -> `ProspectOut`; `GET /prospects/stats?search_id=` -> `{ "total": 18, "by_status": { "needs_owner": 11, "skipped": 7 } }`.

## 4. Bulk buttons: `POST /prospects/actions` -> 200
```json
{ "ids": ["uuid", "..."], "action": "call | later | skip | not_interested | do_not_call" }
-> { "results": [ { "id": "uuid", "ok": true, "status": "call_ready", "error": null }, { "id": "uuid", "ok": false, "status": null, "error": "prospect_state | not_found" } ] }
```
Up to 50 ids. **Call** = the Owner's yes (moves it to `call_ready`; counts toward the first-10 rule); **Ask me later** = `later` (stays `needs_owner`, `ask_after` tomorrow); **Skip**; **Not interested** / **Do not call** = suppressed for good in this workspace (it never comes back from a search). A suppressed one answers `prospect_state` to any other action.
`POST /prospects/redecide` -> `{ "changed": 3 }` decides again the `researching` ones (call it when the screen opens; the worker will too).

## 5. The qualifying call, SIMULATED: `POST /prospects/{id}/simulated-call` -> 200
Owner, Admin; only a `call_ready` prospect (else 409 `prospect_state`). Body `{ "persona": "interested | price_shopper | busy_call_later | not_interested | wants_whatsapp | rude_hangs_up", "language": "en | te" }`.
```json
{ "simulated": true, "call_id": "uuid", "prospect": ProspectOut, "persona": "interested", "language": "te",
  "outcome": "qualified | contacted | not_interested | do_not_call", "end_reason": "goodbye | caller_hung_up | we_hung_up | stopped",
  "summary": "three lines", "whatsapp_ok": false, "pitched": ["Kanchi Pattu Bridal"], "quote_suggestion": [ ... ],
  "transcript": [ { "who": "assistant | business", "text": "…", "t": 0.0 } ], "evals": { "disclosure_first_10s": true, "never_pitches_out_of_stock": true, "never_invents_prices": true, ... } }
```
Label it **"Practice call (simulated): nothing was dialled"**. A `qualified` outcome has made a Lead Desk lead (`prospect.lead_id`, lead source `lead_finder`); the `quote_suggestion` is a DRAFT for the Owner's OK (prices only from the catalogue; `null` = the owner gives the price). The transcript is returned once and not stored.

## 6. Settings -> Lead Finder: `GET /lead-finder/settings`, `PUT /lead-finder/settings` (Owner, Admin)
```json
{ "fit_bar": 70, "daily_call_cap": 20, "call_from_hour": 10, "call_to_hour": 19, "searches_per_day": 5, "results_per_search": 20, "updated_at": "iso | null" }
```
PUT sends any subset. Ranges: bar 50 to 100, cap 0 to 500, hours 9 to 21 (India time; from before to), searches 1 to 20 a day, results 1 to 20. Out of range: 422.

## 7. The draft quote of a qualified call (day 2): `GET` / `POST /prospects/{id}/quote-draft`
After a practice call that QUALIFIED (`prospect.status: "qualified"`, it has a `lead_id`), the prospect's page shows **"Make the draft quote"**.
- `GET /prospects/{id}/quote-draft` (Owner, Admin, Sales) -> the PREVIEW, nothing stored:
```json
{ "prospect_id": "uuid", "lead_id": "uuid", "ready": true, "made": false, "quote_id": "uuid",
  "lines": [ { "item": "Kanchi Pattu Bridal", "item_type_code": "LF-1A2B3C4D", "qty": 40, "unit_price_paise": 850000, "quantity_said": "About forty pieces a month, more in the season." } ],
  "left_out": [ { "item": "Soft Silk Daily", "reason": "no_price | no_quantity | not_in_stock | not_in_catalogue | too_many_lines | item_type_off" } ] }
```
  Show each line (item × qty at ₹price, and "they said: …"), and each left-out item with its reason in words: "no exact price set" (no_price), "they said no number" (no_quantity), "not in stock now"
  (not_in_stock), "no longer in the catalogue" (not_in_catalogue), "a draft holds five lines" (too_many_lines), "its item type is switched off" (item_type_off). Show the button only when `ready`; when `made`, show
  "Open the draft quote" -> `/quotes/{quote_id}` instead. 409 `not_qualified` for any other call.
- `POST /prospects/{id}/quote-draft` `{ "customer_kind": "new" | "repeat", "delivery_state": "KA" | null }` (Owner, Admin, **with the second factor**: 403 `mfa_required` otherwise) -> 201 (200 on a repeat)
```json
{ "quote_id": "uuid", "quote_no": 21, "enquiry_id": "uuid", "status": "draft", "total_paise": 40120000, "needs_owner_approval": false, "lines": [...], "left_out": [...], "replayed": false }
```
  It makes ONE enquiry on the call's Lead Desk lead and ONE **draft** quote at the Owner's own catalogue prices. Nothing is approved or sent: the quote is approved on the quote page like any other.
  422 `nothing_to_quote` (no line can go in), 409 `quote_draft_exists` (a draft from this call was made with other prices: open it). A school: 403 like every route here.

## Words (en; te drafts for a native reader)
"Prospects" (ప్రాస్పెక్ట్స్), "Needs you" (మీరు చూడాలి), "Ready to call" (కాల్ చేయడానికి రెడీ), "Skipped" (వదిలేశాం), "Waiting" (వెయిట్ చేస్తోంది), "Practice call (simulated)" (ప్రాక్టీస్ కాల్ (సిమ్యులేషన్)),
"Made-up businesses for the demo" (డెమో కోసం కల్పిత వ్యాపారాలు). No machine-translation notice anywhere.
