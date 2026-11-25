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

## The number picker: buy first, verify after (25 Nov 2026, the planner's decision)
With `KYC_PER_CLIENT` on, `POST /numbers/claim` (Owner + second factor):
1. makes the business's own VoiceLink client if it has none (the account details are the signed-in Owner's e-mail and the business name; account type and the rest of the business details are collected later, on the verify page), buys the number from our wallet for that client, attaches it with calls OFF and answers 201 `{number, display, type, state}` with **`state: "kyc_pending"`** until the business is verified; then `ready`.
2. `kyc_pending` means: the number cannot place or take real calls (we enforce this ourselves, whatever VoiceLink allows): a call TO it is refused as "not active yet" (the caller is not answered by the assistant; the Owner sees a refused call); the Owner placing a call from it gets 409 `call_not_allowed` with `reason: "kyc_pending"`.
3. If VoiceLink refuses to buy because the client's KYC is pending, nothing is paid and the answer is **409 `numbers_unavailable` with `reason: "kyc_required"`** (send the Owner to the verify page, which is `GET/POST /phone-kyc/business/...` above). If it was already paid and VoiceLink only refuses to MAP the number, the number is kept, our team is told, and the state stays `kyc_pending`. If the client cannot be made at all (for example the Owner's e-mail is already a VoiceLink user) the answer is the same 409 `kyc_required`.
4. When VoiceLink approves the business, the worker marks it verified within a few minutes (the Owner does not have to open anything): `GET /numbers` then shows the number as `calls_off` (the Owner switches calls on) or `ready`.
Document upload for the verify page is `POST /phone-kyc/business/documents` (JSON with base64); the steps and their words are above.
