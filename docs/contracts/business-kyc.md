# Business KYC per VoiceLink client (Model B, 24 Nov 2026)

Off (404) unless the API has `KYC_PER_CLIENT=true` (and the VoiceLink login and `KYC_RETURN_URL`). Written against VoiceLink's reseller documentation; **to be verified by the first real purchase** (final-submit for a client, who approves, what a client may do before KYC completes). Every unknown answer of VoiceLink is shown as a closed `reason` in plain words, never raw.
Identity numbers (PAN, GSTIN) and documents pass through the API to VoiceLink and are dropped: never stored, logged or returned. Aadhaar never touches us (DigiLocker opens in the person's own browser and returns to VoiceLink's page, then to `KYC_RETURN_URL`).
Roles: Owner and Admin read; the Owner writes.

## GET /v1/tenants/{t}/phone-kyc/business
`{ state, account_type, step, steps:{pan,aadhaar,gst: uploaded?}, missing:[...], reason, words }`. `state`: `not_started`, `created`, `in_progress`, `submitted`, `verified`, `stuck`. `words` is a plain sentence for `reason` when there is one.

## The steps (Owner), each answers the same status shape
* `POST .../business/start` 201: makes the business's own VoiceLink client (once; its e-mail is the Owner's; one channel; billing on OUR wallet). 422 `email_in_use`.
* `POST .../business/details` `{ account_type: individual|business, business_name?, full_name, phone, billing_address, state?, city?, pincode?, accept_terms: true }`.
* `POST .../business/pan` `{ pan_number, holder_name }` -> 422 `pan_mismatch` ("Type it exactly as on the card") / `pan_invalid`.
* `POST .../business/aadhaar` -> `{ redirect_url }`: open it on the PERSON'S OWN PHONE (DigiLocker). Say so on the screen.
* `POST .../business/documents` `{ document_type: pan|aadhaar|gst, content_type: image/jpeg|image/png|application/pdf, content_base64 }` up to 10 MB -> 422 `file_unreadable` / `file_too_big` / `step_order`.
* `POST .../business/gst` `{ gst_number }` (businesses only) -> 422 `gst_invalid`.
* `POST .../business/submit` -> `submitted`; 422 `missing_documents` with `missing: ["PAN Card", ...]`; 409 `stuck` (our team has been told; nothing is lost).
Refusals are `{ error: { code: "kyc_refused" | "kyc_unavailable", reason, message, ... } }`; 503 `kyc_unavailable` when VoiceLink does not answer.

## The number picker: verify first, then buy (26 Nov 2026, the owner's decision: the ONLY path for a new number)
With `KYC_PER_CLIENT` on, `POST /numbers/claim` (Owner + second factor) buys a number only for a workspace whose own VoiceLink client is **verified**:
1. Not verified (no client yet, or the KYC is not complete): **`409 numbers_unavailable` with `reason: "kyc_required"`**, before anything is locked, paid or recorded. Send the Owner to the verify step (`GET/POST /phone-kyc/business/...` below). Nothing is created by a refused claim.
2. Verified: the number is bought from our wallet for that client and attached with calls ON (`201 {state: "ready"}`; `GET /numbers` then shows `calls_on`).
3. `kyc_pending` survives only for a number bought earlier under the old buy-first rule: `GET /numbers` shows `kyc_pending` for it until VoiceLink approves the business (the worker marks it within a few minutes), then `calls_off` or `calls_on`. A call to or from such a number is refused as before.
4. If VoiceLink still refuses to buy for a client we consider verified, nothing is paid and the answer is the same 409 `kyc_required`; if it was already paid and only the mapping is refused, the number is kept and the team is told (state `getting_ready`).
Document upload is `POST /phone-kyc/business/documents` (JSON with base64).

## Field rules (26 Nov 2026), checked on the server for every KYC step
All fields below are mandatory. A refusal is `422 kyc_fields_invalid` with `fields` (the names, sorted) and `reasons` (one closed word per field); the value is never echoed or logged.
| Field | Rule | Reason word |
|---|---|---|
| `account_type` | `individual` or `business` | `account_type_required` |
| `full_name` | 2 to 120 characters, no markup | `name_required` |
| `business_name` | business only: 2 to 120 characters | `business_name_required` |
| `phone` | an Indian mobile: 10 digits starting 6 to 9 (`+91`, `91`, a leading 0, spaces, dashes and brackets are accepted and removed; the 10 digits are sent) | `mobile_invalid` |
| `billing_address` | 8 to 300 characters | `address_required` |
| `city` | 1 to 60 characters | `city_required` |
| `state` | one of the 28 states and 8 union territories (any case) | `state_invalid` |
| `pincode` | 6 digits, not starting 0 | `pincode_invalid` |
| `accept_terms` | `true` | `terms_required` |
| `pan_number` (`/pan`) | 5 letters, 4 digits, 1 letter (any case; sent in capitals), e.g. AAAAA9999A | `pan_invalid` |
| `holder_name` (`/pan`) | 2 to 120 characters | `name_required` |
| `gst_number` (`/gst`) | 15 characters: state code 01 to 38, PAN shape, entity digit, `Z`, check character (any case) | `gstin_invalid` |
| `/gst` for an individual | a GSTIN belongs to a business account | `gstin_business_only` |
| `document_type` (`/documents`) | `pan`, `aadhaar` or `gst` | `document_type_invalid` |
| `content_type` (`/documents`) | `image/jpeg`, `image/png` or `application/pdf` | `file_type_invalid` |
Files: up to 10 MB (`422 kyc_refused` with `reason: file_too_big`; an unreadable or wrong-looking file is `file_unreadable`). The older `pan_invalid` / `pan_mismatch` / `gst_invalid` words of VoiceLink's own answer stay as they were (`kyc_refused` with a `reason`).

## Verify first, then buy: the steps (26 Nov 2026)
The KYC steps belong to the business's own VoiceLink client, not to a number, so they work BEFORE any number is bought: the web's "Get a phone number" flow calls them in step 3 (Verification), after step 2 ("Your calling account") has made the client.
1. `POST /phone-kyc/business/start` (201) makes the client (what step 2 does). Then `details`, `pan`, `aadhaar` (the DigiLocker address, opened on the person's own phone), `documents`, `gst` (businesses) and `submit`, in that order, with no number in the workspace. Nothing here asks for a number.
2. **Poll `GET /phone-kyc/business`** and read `state`: `not_started` (no client yet: call `start`), `created` / `in_progress` (steps still to do; `step` and `steps{pan,aadhaar,gst}` say which), `submitted` (VoiceLink is reviewing: keep polling about every 10 seconds; the worker also marks it when it is approved), **`verified`** (done), `stuck` (our team has been told; show `words`). Only `verified` lets the next step be a purchase that starts with calls on.
3. `POST /numbers/claim` for a workspace whose client is **verified**: the answer is `201 {state: "ready"}` and the number is attached with **calls ON**: `GET /numbers` shows `state: "calls_on"`. No `kyc_pending` state ever appears (migration 20261231992630).
4. A workspace that is NOT verified yet cannot buy a new number: `409 kyc_required` (see above).
Number states of `GET /numbers`: `getting_ready`, `kyc_pending` (old rows only), `calls_off`, `calls_on`. KYC states of `GET /phone-kyc/business`: `not_started`, `waiting_for_line`, `created`, `in_progress`, `submitted`, `verified`, `stuck`.
**Proven on the real account (26 Nov 2026, the owner's yes):** once a channel is free, `client/create` works, `kyc/status` and `kyc/step-1-register-details` work with NO number bought (client 5911). The later steps (PAN, Aadhaar link, documents, GST, final submit, approval) have not been run for a number-less client yet; the order above is what the documentation implies. The fake VoiceLink (`scripts/fake_voicelink.py`) and `scripts/smoke_local_phone.py` cover the whole order.

## No free channel at VoiceLink (the real probe of 25 Nov 2026; migration 20261231992640)
Making a business's own client allocates at least one **channel from OUR reseller pool** (`client/create` needs `channel_count` of 1 or more). When the pool has none free VoiceLink refuses (`422 "Channel count cannot exceed available channels (0)."`), so KYC first needs a channel in stock before step 1.
* The API reads the pool first (`GET /reseller/profile` > `channels.available`) and, when it is 0 or when `client/create` is refused for channels, does NOT turn the business away: `POST /phone-kyc/business/start` answers `201` with **`state: "waiting_for_line"`**, `reason: "no_line_yet"` and `words: "We are setting up your line. This takes a short while."` and records the wait (`telephony.line_waits`).
* `GET /phone-kyc/business` keeps answering `waiting_for_line`. Each time the OWNER's screen reads it (poll about every 15 seconds) and a channel is free by then, the client is made in that same call and the state becomes `created`; the wait is cleared. (An Admin's read never retries.) The web shows the words above, never an error.
* Staff see the alert **`no_free_channels`** ("Businesses are waiting for a phone line": buy a channel at VoiceLink: Buy DIDs and Channels > Add channels; `POST /reseller/purchase/add-channel` then `/confirm`, a channels-only order, to be confirmed against the real account). `GET /numbers/claim` for a waiting business is `409 kyc_required` as for any unverified one.
* How channels reach the pool and move (from the reseller documentation, `reports/voicelink-llms.txt`): bought with `POST /reseller/purchase/add-channel` (`channel_count`, `months`, optional `order_id`; first month prorated; auto-renew on) then the order summary and `purchase/confirm`; `GET /reseller/profile` shows `channels.{available,total_allocated,total_purchased}`; `POST /reseller/client/update/{client_id}` takes `channel_count` ("channel allocation") so a client's channels can be changed, but it needs the client's whole profile (names, e-mail, username, rates, threshold) and reducing a LIVE client (5879) changes live call capacity: not done by this API.
* Money (built, migration 20261231992650): see "The first month of the number" below.

## The first month of the number (debit and refund on the wallet; 26 Nov 2026)
A phone number with its first call line costs **Rs 499 a month** (`pricing.settings.extra_number_paise`, config; the catalogue answer and plan lines read it). A NEW number includes 1 call line (`ops.line_settings.included_per_new_number`, recorded on the number); a number bought earlier keeps its 2.
* `POST /phone-kyc/business/start` (the "Your calling account" step), ONLY after a free channel exists, debits the first month from the credits as a usage row `number_reserved` (statement words **"Held for your phone number"**). Too little credit: `402 credits_needed` with `needed_paise` and `needed_text`, **nothing is created** (the web sends the person to add credits). A billing-exempt workspace pays nothing. Starting again debits nothing more.
* The status answers (`GET`, `start`, `cancel`) carry `reserve: {state: none|held|refunded|applied, amount_paise, amount_text, price_paise, price_text, due_at}`.
* **Refunded in full** (a refund lot, statement "Refund to your balance") on: `POST /phone-kyc/business/cancel` (Owner; not for a verified business; the unverified client is deleted at VoiceLink so its channel returns and the business may start again), a client that VoiceLink refuses after the debit (at once), a KYC that ends `stuck`, or 14 days without a verified business (the worker, idempotent, the same pass that marks approvals).
* **Applied** when the number is bought after verification: the held month simply becomes the number fee (`reserve.state: applied`), no money moves.
* Staff alerts: `no_free_channels` (someone waits) and `channels_low` (1 or fewer free channels, as last seen by the worker within 2 days).

## City and phone rules of VoiceLink's form (real answers of 26 Nov 2026)
* `phone`: digits only, 7 to 15 (a `+` is refused). The API sends the 10-digit Indian mobile it validated.
* `city` is required and must exist in VoiceLink's OWN list for that state ("Anantapur" refused, "Ananthapuramu" accepted); no list endpoint is documented. A refusal is `422 kyc_fields_invalid` with `reasons: {city: "city_not_found"}` ("Pick the city name as your post office writes it."). The web offers a PIN-code lookup (India Post's public PIN directory) that fills state and city with the post office's own spelling.

## Buying channels (adapter, off)
`app/telephony/channel_stock.py` (`VOICELINK_CHANNEL_BUY`, default off) buys channels for OUR pool with exactly three calls and no number: `purchase/add-channel` -> `purchase/summary/{id}` -> `purchase/confirm`. Guards before the confirm: a count of 1 to 3, a total no higher than `VOICELINK_CHANNEL_BUY_MAX_INR` (default Rs 200), a summary of exactly the channels asked and no number, and a wallet that keeps `VOICELINK_CHANNEL_WALLET_FLOOR_INR` (default Rs 500) after paying. Nothing calls it yet (the low-stock auto-buy is for later).
