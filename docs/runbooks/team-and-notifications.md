# Team, report and notifications: runbook (job BY, ADR 0077)

## Adding a person (no e-mail needed)
1. The person signs up / signs in (their own account).
2. The Owner or an Admin (with the authenticator) makes an invitation: `POST /v1/tenants/<id>/invitations {"invitation_id":"<new uuid>","role":"sales","label":"for the new cutter"}`. The answer holds the code **once**. Hand it over yourself (in person, a WhatsApp message, paper).
3. The person: `POST /v1/invitations/accept {"code":"7QX2K-M9R4D-0A1B2-C3D4E"}` (any case, spaces or hyphens). An **Admin** invitation needs their session to be at the authenticator level.
4. Lost code: revoke (`POST .../invitations/<id>/revoke`) and make a new one. A wrong code five times locks that person for an hour.
5. Owners are added by the operator only: `select app.operator_add_owner_exception('<slug>', '<email>', '<reason of at least 20 characters>');` (at most 3 per workspace).

## Role changes and leaving
`POST .../members/<user>/role {"role","reason"}` (Owner/Admin + authenticator), `POST .../members/<user>/remove {"reason"}` (Owner/Admin + authenticator) or `{"reason":"left"}` by the person themselves. The answer lists, as counts, what was tidied (leads and opportunities unassigned, runs cancelled, invitations revoked).

## The weekly report
`GET /v1/tenants/<id>/reports/weekly` (Owner/Admin): this India week. `?week_start=2026-09-28` (a Monday) for an earlier one.

## Push notifications
1. Generate a VAPID key pair once (any tool that prints a P-256 key: e.g. `npx web-push generate-vapid-keys`). Keep the private key like a password.
2. Set on the API **and the worker**: `VAPID_PRIVATE_KEY` (entered hidden), `VAPID_SUBJECT=mailto:<owner address>`, optionally `VAPID_PUBLIC_KEY` (checked against the private one).
3. The browser fetches `GET /v1/push/public-key` (no sign-in), subscribes with it, and sends the PushSubscription JSON to `POST /v1/me/push-subscriptions`.
4. Each member opts in per workspace: `PUT /v1/tenants/<id>/notifications/push {"enabled":true}`. Off by default.
5. The scheduler worker (`make dev-worker-local`) sends the pushes, at most one a pass per member, never in quiet hours, each item once. Logs show counts only: `push pass: members=… sent=… gone=… failed=…`.
To try it without a real browser, run the tests: `tests/test_by_webpush.py` (the RFC's example, the sender, the runner) and `tests/integration/test_by_web_apis.py` (end to end with a fake push service that decrypts what it receives).

## What the web must do for push (C2) and the two event kinds (job WP)

The API side is complete once the keys exist; the web side is not built yet:

1. `GET /v1/push/public-key` gives the public key (404/empty while push is off: hide the button then). Ask the browser for permission only after a tap, never on page load.
2. `POST /v1/me/push-subscriptions` with the browser's subscription (endpoint, `p256dh`, `auth`); `POST /v1/me/push-subscriptions/remove` to unsubscribe; `PUT /v1/tenants/{t}/notifications/push` to opt in per workspace (off until then).
3. `apps/web/public/sw.js` has no `push` listener yet: it must show the notification from the payload (`title`, `body`, and `kinds` to choose the page it opens: `call_starting` → the Calls list, `customer_replied` → the conversation, the others → Needs you). iPhones deliver web push only after the site is added to the Home Screen.
4. The payload is a fixed sentence and counts only; never show or log more than that.

Events: `call_starting` (Owner, Admin; a live call under 90 seconds old) and `customer_replied` (Owner, Admin, Sales; a reply under 15 minutes old; one push per 5 minutes, batched). Both obey quiet hours and the opt-in.
