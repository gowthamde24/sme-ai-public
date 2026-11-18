# Embedded Signup: what is ready without the App ID and the configuration id (18 Nov 2026, C1)

Everything below is tested against the fake Graph (`app/whatsapp/fake_graph.py`); nothing needs Meta, an App ID or a configuration id until the last section.

## Built and tested
* `GET /whatsapp/connect/config` says whether Connect can run and WHAT is missing, in closed words: `app_id`, `config_id`, `app_secret`, `platform_token`, `graph` (so the owner and the web know what is pending, and the button can be hidden).
* `POST /whatsapp/connect` (Owner + second factor) now refuses unless ALL hold: the browser sent the signup `code`; the code exchanges into a business token in OUR app; Meta's `debug_token` on that token lists the account (`waba_id`) among the accounts THAT signup shared (`granular_scopes` of `whatsapp_business_management`); our platform token reaches the number; our app subscribes to the account's webhooks; the account is recorded for this business only (the number id is unique, so one number cannot serve two businesses). Failing the first checks records and subscribes nothing; a failure to record after subscribing takes the subscription back. Without this, an Owner could claim any number our platform token reaches by sending its ids.
* Disconnect disables first, then unsubscribes. Templates: the first templates of a business are drafted and submitted on ITS account (`/whatsapp/templates/first`, `submit`), and the status check reads that account.
* Webhook routing by `phone_number_id` to the business, opt-out words, the 24-hour window and the approved-template path are covered by the existing WhatsApp tests.

## Only testable with the real ids (owner and Meta)
1. `WHATSAPP_APP_ID`, `WHATSAPP_EMBEDDED_CONFIG_ID` (public ids) and the app secret / platform System User token (hidden prompt): then `GET /whatsapp/connect/config` says `available: true` and `missing: []`.
2. Meta's real `debug_token` response shape (`data.granular_scopes[].target_ids`): written from Meta's documentation, checked only against the fake; the first real signup is the check.
3. Whether the number needs a registration call (`POST /{phone_number_id}/register` with a PIN) after the signup for a NEW number: not built until the first real signup shows it (an existing WhatsApp Business app number with coexistence does not).
4. App Review (`docs/plans/meta-app-review.md` section 3b) and business verification.
