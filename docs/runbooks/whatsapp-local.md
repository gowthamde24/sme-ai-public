# WhatsApp: runbook (job BR, ADR 0076)

Everything here runs on this machine. Nothing leaves it, nothing is bought, no Meta account is needed for the local fake.

## A. Locally, with the fake WhatsApp
1. Start the stack and the API as usual (`make agent-db-up`, then your API). Start the API with these set (a script or your shell; the values are made up, none is a secret):
   `OUTBOX_ADAPTER=whatsapp  WHATSAPP_API_BASE=http://127.0.0.1:8791  WHATSAPP_APP_SECRET=local-app-secret  WHATSAPP_VERIFY_TOKEN=local-verify  WHATSAPP_ACCESS_TOKENS='{"local":"fake-token"}'  CHANNEL_AGENT_EMAIL=<an account>  CHANNEL_AGENT_PASSWORD=<its password>`
   (`OUTBOX_ADAPTER` stays `fake` if you only want the inbox without sending.)
2. Make the channel account: sign up an ordinary account that belongs to no business, then in psql as the database owner: `select app.operator_register_channel_agent('<its e-mail>');`. (A scheduler worker account is separate: `app.operator_register_scheduler`.)
3. As the business Owner (with a second factor): `PUT /v1/tenants/<id>/whatsapp/account` with `{"waba_id":"200000000000001","phone_number_id":"100000000000001","coexistence":false,"token_ref":"local"}`, then `POST .../whatsapp/account/activate`.
4. `make dev-whatsapp-fake` (listens on 127.0.0.1:8791; pushes signed webhooks to the API at `WEBHOOK_URL`, default `http://127.0.0.1:8001/v1/webhooks/whatsapp`, with `APP_SECRET`, default `local-app-secret`; `--auto-status` follows every send with sent/delivered/read).
5. The "customer" writes: `curl -X POST localhost:8791/_fake/inbound -d '{"from":"0091234500001","text":"Do you have red sarees?","name":"Ravi"}'` (use a number starting `00` while the real-data gate is closed). It appears in `GET /v1/tenants/<id>/conversations`.
6. Reply with `POST /v1/tenants/<id>/outbox/messages` (`category: "reply_to_inbound"`). `GET localhost:8791/_fake/sent` shows what "WhatsApp" received. For the message to go by itself the business needs automatic sending on, the global switch on (`./scripts/dev-enable-outbox.sh on`) and the worker or a dispatch call.
7. Try: `"text":"STOP"` (the contact is opted out and nothing more is sent), a follow-up 25 hours later with no approved template (`template_required`), `POST /_fake/fail {"to":"0091234500001","status":400,"code":131026}` (the send is refused), `POST /_fake/approve_template {"name":"...","language":"en"}` after approving a template in the API.

## B. With Meta's free test number (when the owner decides)
Nothing here has been done. Facts from Meta's get-started guide (https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/):
1. Create a Meta developer account and an app, add the WhatsApp product: a **test WhatsApp Business Account and a test phone number** are made for you. The test number can send free messages to **up to 5 recipient numbers** that you verify (WhatsApp > API Setup > Manage phone number list; each gets a code).
2. In API Setup copy the **Phone number ID**, the **WABA ID** and a **temporary access token** (it expires in about a day; a permanent one needs a System User in Business Settings).
3. Set the secrets on the API (never in a file in the repository): `WHATSAPP_ACCESS_TOKEN` (or `WHATSAPP_ACCESS_TOKENS`), `WHATSAPP_APP_SECRET` (App settings > Basic), `WHATSAPP_VERIFY_TOKEN` (any long random string you choose), `WHATSAPP_API_BASE=https://graph.facebook.com`, `OUTBOX_ADAPTER=whatsapp`. Enter them hidden (no echo); do not paste them in chat.
4. A public HTTPS address for the webhook is required (your API cannot be reached on 127.0.0.1 by Meta). A tunnel to your laptop works for a test; hosting is a separate decision (ADR 0072).
5. In the app: WhatsApp > Configuration > Webhook: Callback URL `https://<your host>/v1/webhooks/whatsapp`, Verify token = `WHATSAPP_VERIFY_TOKEN`, then subscribe to the **messages** field.
6. Register the test number in the API (`PUT .../whatsapp/account`, `token_ref` = the name of the secret) and activate it. Send a first message to your own phone: Meta's guide has you start with the `hello_world` template; a customer reply opens the 24-hour window, after which free text works.
7. Templates: write one (`PUT .../whatsapp/templates/<id>`), `POST .../submit`, wait for Meta (up to 24 hours), then `POST .../status {"status":"approved"}`.

## C. What to watch
* `OUTBOX_ADAPTER=whatsapp` without a token stops the API at start.
* Counts only are logged: `whatsapp webhook handled: stored=… optouts=… statuses=… duplicates=… ignored=…`. A growing `ignored` means numbers that are not set up, or the real-data gate.
* Rotating the app secret: set the new one and restart; Meta signs with the secret in the app settings.
* Disable the number (`POST .../whatsapp/account/disable`) to stop both sending and receiving for a business at once.
