# "Talk to us" form of the public pages (25 Nov 2026)

`POST /v1/public/contact` — no sign-in. **404 unless the API has `CONTACT_FORM=true`.** Same door as the waitlist: the captcha (`CAPTCHA_PROVIDER`: Turnstile or none) and the per-address and per-contact limits (429 `rate_limited` with `Retry-After`; 400 `captcha_failed`).

Body (strict; an unknown field is 422):
`{ name (1..120), phone? (7..30), email?, business_kind? (<=80), good_time? (<=80), sells? (<=300), consent: true, terms_version, notice_version, captcha_token? }` — a phone **or** an e-mail is required. `terms_version` and `notice_version` are the versions the page showed (read them from `GET /v1/privacy/notice`); if either is no longer current: 409 `policy_version_outdated` (show the new text, send again).
Answers: 201 `{status: "received", reference: "TQ-1A2B3C4D"}`; 200 `{status: "duplicate", reference}` (the same phone or e-mail within 10 minutes: show the same thanks); 503 `busy` (500 messages a day platform-wide). Nothing personal is ever sent back.
Stored in `privacy.contact_requests` with the versions; kept 12 months. The hello inbox gets an e-mail that a message arrived (reference, kind of business, good time: never the name, phone or e-mail). Staff read the messages in the admin console: `GET /v1/admin/contact-requests?limit=50` (owner and support staff; each read is written to the staff log).
Web: `storeTalk` in `apps/web/lib/public/demo.ts` posts this body; the consent tick sends `consent: true` with the two versions.
