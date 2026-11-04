# 0119: The Lead Finder: sources, Google Maps terms, caps and the legal guardrails

Status: accepted (4 Nov 2026, built unattended overnight; the owner reviews in the morning). Job: `~/Desktop/stack19-jobs/job-lead-finder.md` (owner decision 2 Nov 2026), parts A, B, C. Contract: `docs/contracts/lead-finder.md`.

## Decision

1. **A prospect is not a lead.** New tables `prospect_searches`, `prospects`, `lead_finder_settings` (migration `20261226090000`), RLS like the leads (Owner/Admin/Sales read; a Viewer does not), written only through
   sixteen SECURITY DEFINER functions, audited, in the erasure registry and the privacy export. A prospect becomes a Lead Desk lead only when a qualifying call qualifies it (`prospect_call_finish` ->
   `app.lead_intake_core`, source tag `lead_finder`, no consent granted: every later message still passes the consent, hours and opt-out rules).
2. **One provider interface, a flag.** `ProspectSource` with `FixtureSource` (synthetic businesses from the pack's `packages/packs/<pack>/lead_finder.json`, reserved `+00` numbers) and `GooglePlacesSource`
   (Places API (New) Text Search). `LEAD_FINDER=off|fixture|places`, default `fixture`. `places` is used only when **all three** hold: the flag, the workspace's **real-data gate is open** (the Owner Test
   workspace) and a key exists (`GOOGLE_PLACES_API_KEY`, shared with the web-search lane's setting). Anywhere else the fixture is used, so a demo workspace never reaches Google. The database enforces the
   same rule: `prospect_search_finish` refuses a Places result, and any non-`+00` number, in a workspace whose gate is closed.
3. **No pack id in code.** The business type's buyer types, competitor words, the call script (en, te) and the fixture are data in the pack's `lead_finder.json`. A pack without the file has no Lead Finder; the
   module flag `lead_finder` (already listed by textiles and construction materials, not by education) is checked first, in the API and in every database function (SM971). **A school never sees it**
   (`GET /lead-finder/availability` says `available: false`; every other route answers 403).
4. **The Researcher's decision is code.** Fit 0 to 100 = buyer type (0 to 40) + rating and reviews (0 to 20) + distance (0 to 15; unknown = 8) + stock match against our catalogue (0 to 25). Decisions, in order:
   skip (suppressed, contacted in 90 days, no phone, not a buyer type, fit < 50); needs the Owner (a competitor or wholesaler, a very large buyer, fit between 50 and the bar, low stock, no matching stock,
   and **every would-be call of a search until the Owner has said yes to ten of them**); call-ready (fit at or over the bar, stock in hand, inside the calling hours, under the daily cap); otherwise
   waiting (`researching`), decided again later. No model decides anything; the one-line reason is built from closed words and our own item names.
5. **The qualifying call is a simulator.** Our side is the pack's script run by code: the opening says "the AI assistant of {business}" in its first sentence (measured: 1.8 s in English, 3.5 s in Telugu at
   14 characters a second), then one question at a time (what they sell, price range, monthly quantity, current supplier, timing, who decides), then a pitch of **in-stock items only** (not "few left", not
   "made to order") with the catalogue price only when the Owner set one. "Not interested" / "do not call" end the call at once and suppress the business for good; "call later" ends with a callback; WhatsApp
   only after an explicit yes to the question. The other side is one of six scripted retailer personas. No model and no provider is called; the evals are exact (24 calls, all pass).
   This package imports no telephony provider, dialer, outbox or WhatsApp module (a test pins it) and its only call route is `/simulated-call`.

6. **The chat's way in** (owner, 4 Nov 2026, day 2). The conversational router (`app/turns/intent.py`) has a rule 0 before every other: an unmistakable request to FIND NEW businesses
   (`app/lead_finder/intent.py` `is_find_request`: a verb of finding, a word for a business we do not know yet with "new" or a place, or "new customers"; never with a word about our own records) is an
   action whose path is the Lead Finder (`app/turns/lead_finder.py`): the plan card as the event `lead_finder`, a fixed sentence in the chat language, no model call. The owner's OK is the card's button or a
   bare yes in the chat or by voice; no cancels. The plan takes the id of the chat reply that showed it, so a later yes, a replay and the stored chat find the card without a new column. The written Ask
   (`/assistant/messages`) is unchanged.
7. **A school: only the Lead Finder is blocked** (owner, 4 Nov 2026, day 2). Prospecting strangers is never for a school: the module is off for education (SM971 in the database, 403 from every route, no
   card in the chat, no screen). Everything a school does with people who asked it (admission calls and follow-ups to parents who enquired, campus-visit rules: night 4 E1) stays on; the outreach block
   tried in #287 is not put back.
8. **A qualified call's quote suggestion becomes a DRAFT quote, on the Owner's button** (owner, 4 Nov 2026, day 2; `app/lead_finder/quote_draft.py`). `GET /prospects/{id}/quote-draft` previews, `POST`
   (Owner or Admin with the second factor) makes one enquiry on the call's Lead Desk lead and one manual-price draft through the quotes' own path (the pinned engine; the database recomputes it, SM216).
   A line is an item the call pitched, found in the catalogue now and still in stock, at the Owner's own EXACT catalogue price, for the quantity the buyer said (digits, or English and Telugu number
   words); anything else is left out with its reason: a price or a quantity is never made up. It is a person's action, not an agent's (the database refuses a typed price in an agent context, SM260),
   and the draft is approved on the quote page like any other. Each item gets an item type of its own on first use (`LF-` + a digest of its name). Ids derive from the prospect: the button again replays.

## Google Maps Platform terms (the rules this code follows)

* **Only the official API**: Places API (New) `places:searchText`. No scraping of Google, IndiaMART, JustDial or any site. IndiaMART BuyLeads keep arriving only through the existing CRM pull.
* **Field mask**, always (`X-Goog-FieldMask`): `places.id, displayName, primaryTypeDisplayName, types, formattedAddress, location, businessStatus, nationalPhoneNumber, websiteUri, rating, userRatingCount`.
  The phone number, website, rating and review count are **Text Search Enterprise** fields (Google's SKU table, read 4 Nov 2026), so one search bills **one Text Search Enterprise request**; nothing from
  the Enterprise + Atmosphere tier (reviews, photos) is asked for. The phone number is what a call needs, so Enterprise is the cheapest tier that does the job. One request per search (`pageSize` <= 20,
  no next page). The cost recorded on the search is an ESTIMATE (`LEAD_FINDER_PLACES_COST_PAISE`, default 300 paise), shown as an estimate; the real price is Google's price list and the account's credits.
* **Caching**: the `place_id` is kept indefinitely (the terms allow it). Every other field from Google is kept **at most 30 days** (`fetched_at`): `prospect_places_expire` (scheduler only, run by the worker every six hours) blanks them and a
  prospect that was still waiting is skipped; a call after that needs the details fetched again by `place_id` (Place Details: **not built yet**, see Open).
* **Attribution**: every API response that carries Places data says `attribution: "Google Maps"` and the screens show it next to that data.

## Caps

Per workspace, in `lead_finder_settings` (Owner/Admin, Settings -> Lead Finder): searches a day (default 5, counted at the Owner's OK, India's day, in the database under a lock), results a search (default and
maximum 20), the call bar (default 70), the daily call cap (default 20) and the calling hours (default 10:00 to 19:00, never outside 09:00 to 21:00). The search's SKU, request count and cost are stored on the
search. The usage meter's kinds stay `call_minutes` and `whatsapp_messages` (a closed list): Places searches are counted on the search log, not as minutes; a simulated call bills nothing.

## Legal guardrails (unchanged by this ADR)

No real outbound call: `TELEPHONY_MODE` stays off and nothing here dials. Real calls need the owner's December lawyer review, a registered calling number and DND scrubbing first. Every prospect keeps its source
in words ("Google Maps search 'saree shops Jayanagar', 2 Nov"). The real-data gate stays closed everywhere except the Owner Test workspace.

## Open

* Place Details re-fetch after 30 days; `redecide` on a schedule. (The scheduler worker already runs `prospect_places_expire` every six hours: `app/lead_finder/housekeeping.py`.)
* The draft quote of a construction call: the construction pack quotes through its own materials path (`/materials`), which has no manual-price draft yet; its quote suggestion stays a suggestion.
* Distance: the business's own location is not stored yet, so every place scores the "unknown" 8 points.
* A1 (a real Places search in Owner Test) waits for the owner's key.
