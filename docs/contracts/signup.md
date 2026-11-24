# Opening sign-up (24 Nov 2026)

Off (404) unless the API has `SIGNUP_OPEN=true`. The database's own switch `signup.settings.open` (operator function `ops_signup_set`) decides whether a trial credit is granted; both are off in production until the planner and the owner's gate.
All routes need a signed-in person (Supabase token). No response carries a phone number, an e-mail, an address or a code (except `debug_code` on a staging API with `SIGNUP_PHONE_SENDER=fake` and `SIGNUP_FAKE_CODE_ECHO=true`; the API refuses to start with the echo in production).

## GET /v1/signup/status
`{ open, terms_version, privacy_version, aup_version, email_confirmed, email_blocked, consent_done, phone_verified, trial_claimed }`. The screen shows the next missing step.

## POST /v1/signup/consent  `{ kind: "terms"|"privacy"|"aup", version }`
200 `{ok:true}`. 422 when the version is not the current one (so an old tick never counts). Record all three (terms, privacy notice, acceptable-use policy) before the claim; `status` carries the three current versions.

## POST /v1/signup/phone/start  `{ phone }`
Indian numbers as typed ("98480 12345", "+91 98480-12345") or E.164. 200 `{ok:true, expires_in_s:600}`. A code (6 digits) is sent; it lives 10 minutes, 5 tries.
Refusals (plain sentence in `message`, closed word in `reason`): 409 `signup_closed`, 409 `email_unconfirmed`, 422 `email_not_allowed` (throwaway mail), 429 `rate_limited` (5 an hour per person and per e-mail, 3 per phone, 20 per address; `Retry-After: 3600`), 409 `phone_taken` (another account proved this phone), 503 `phone_code_unavailable` (no sender), 422 `validation_error` (bad phone).

## POST /v1/signup/phone/verify  `{ code }`
200 `{ok:true}`. 422 `code_wrong` (`tries_left`), 422 `code_expired`, 422 `code_missing`, 429 `code_locked` (five wrong tries: ask for a new code), 409 `phone_taken`.

## POST /v1/tenants/{t}/billing/trial-claim   Owner
Always 200 `{ granted, reason, balance_paise }`. `granted:true` once per person. `reason` when not granted: `closed`, `email_unconfirmed`, `email_blocked`, `phone_not_verified`, `consent_missing`, `email_used` (this identity already had its credit; Gmail dots and +tags count as the same address), `daily_cap`, `already_granted` (this workspace), `phone_used`.
The amount is `pricing.settings.free_start_paise` (Rs 100 = 10000 at launch; the web reads the text from the pricing catalogue, never a literal).
