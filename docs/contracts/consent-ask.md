# Ask for consent in one tap (18 Nov 2026, planner)

For a lead whose WhatsApp consent is `unknown` ("ask first"): the owner sees the words, taps Send, and the ask goes through the outbox like any owner message. Nothing is ever sent automatically. Owner and Admin only.

## 1. Preview (reads only)
`GET /v1/tenants/{t}/leads/{lead_id}/consent-ask` -> 200
```json
{ "lead_id": "uuid", "customer": "Kalyani Gowda", "needed": true,
  "reason": null,              // or already_agreed | stopped | no_whatsapp_number | no_template
  "language": "en",            // the customer's language (te, hi, kn, ...)
  "text": "Hello, this is the AI assistant of {business}. May we call you and send you messages on WhatsApp? Reply OK if yes. Reply STOP any time to stop.",
  "how": "message",            // message (24-hour window open) | template (window closed, approved `consent_ask` template) | none
  "window_open": true, "message_id": "uuid" }
```
`needed` is false for already_agreed / stopped / no_whatsapp_number (hide the button). `no_template`: the window is closed and the workspace has no approved `consent_ask` template, so the ask cannot go yet (`needed` stays true; `how` is none).

## 2. Send (the owner's tap = the approval)
`POST /v1/tenants/{t}/leads/{lead_id}/consent-ask` body `{ "message_id": "<the preview's message_id>" }` -> 200 `{message, replayed, dispatched}` (same as a chat reply or template send). `how=message`: the preview's words go as an owner message (category info). `how=template`: the approved template goes. 422 `consent_ask_not_needed`; 409 `no_consent_template`. The same `message_id` twice is one message.

## 3. Facts
* The customer's "OK" reply is not recorded as consent by itself: the owner reads it in Chats and records consent as today.
* The `consent_ask` template is NOT in the first-template catalogue yet: it needs native-reviewed wording and the owner's submit click; until it is approved, a customer whose window is closed cannot be asked.
* Migration 20261231982300 `public.consent_ask_info(tenant, lead)` (Owner, Admin; reads only). The send is an owner message, so it also counts as a manual action for "Enquired again".
