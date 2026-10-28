# WhatsApp Cloud API on staging (job DU, 28 Oct 2026)

The WhatsApp adapter of job BR (ADR 0076) now talks to Meta's Cloud API **v25.0** on staging, with the Meta **test number** (+1 555 188 6186, phone number id `1329673453571780`, account id `1421890996429034`). Synthetic data only. **A message can only go to a number on the test fence** (below).

## What runs where
| Part | Where | Notes |
|---|---|---|
| Session and template sends | `sme-api` (`OUTBOX_ADAPTER=whatsapp`) | an Owner/Admin's approve or send hands due messages to the adapter; inside the 24-hour window a `text` (or `image`) message, outside it the approved template |
| Webhook | `sme-api` | `GET` verification (verify token) and `POST` notifications; the body is checked against `X-Hub-Signature-256` with the app secret |
| Delivery and read statuses | the same webhook | `sent`, `delivered`, `read`, `failed` update the message in the outbox log; the message id travels as `biz_opaque_callback_data` |
| Inbound messages | the same webhook | each becomes a contact, a **lead (source whatsapp)** and an enquiry in the Lead Desk, the customer's opt-in is recorded, "STOP" (also in Hindi, Telugu, Kannada) suppresses the contact |
| Worker's automatic sending | `sme-worker` job | stays on the fake adapter. Turning it to WhatsApp needs `sme-worker-run` to read the token (a follow-up) |

## Webhook address and verify token (what to type into Meta)
- **Callback URL:** `https://sme-api-620338396268.asia-south1.run.app/v1/webhooks/whatsapp` (the staging API; `staging.stack19.com` does not forward `/v1`).
- **Verify token:** the value of Secret Manager secret **`sme-whatsapp-verify-token`** (project `project-2757c07e-37d2-4167-88f`). Read it on your machine with `gcloud secrets versions access latest --secret sme-whatsapp-verify-token --project project-2757c07e-37d2-4167-88f` and paste it into Meta's "Verify token" box. It is never written in the repo.
- Meta: App > WhatsApp > Configuration > Webhook > Edit > callback URL + verify token > Verify and save > **Manage** > subscribe the field **messages**.
- The app secret (`sme-whatsapp-app-secret`) is what signs every POST; without it the webhook answers 401, and without the verify token the GET answers 503.

## One-time set-up (owner)
1. Verify token (once): `python3 -c "import secrets;print(secrets.token_urlsafe(32),end='')" | gcloud secrets create sme-whatsapp-verify-token --data-file=- --project project-2757c07e-37d2-4167-88f`, then give `sme-api-run` the role `roles/secretmanager.secretAccessor` on that one secret.
2. Channel account (once): the webhook hands what Meta sends to the database as a **channel principal**: a sign-in that belongs to no workspace.
   Supabase (staging project) > Authentication > Add user: `channel-agent@demo.example.test`, a long random password, auto-confirm. Store the password: `... | gcloud secrets create sme-channel-agent-password --data-file=- ...`, give `sme-api-run` secretAccessor on it, and register it in the SQL editor: `select app.operator_register_channel_agent('channel-agent@demo.example.test');`
3. The test fence: `WHATSAPP_ALLOWED_RECIPIENTS="91XXXXXXXXXX;1415XXXXXXX" ./deploy/staging.sh api --execute` (the owner's allow-listed test numbers, which must also be in Meta's list of up to 5 recipients). Empty = nothing is sent.
4. Deploy: `./deploy/staging.sh api --execute` mounts the token, the app secret, the verify token and the channel account (the last two only once they exist).

## Check it
`make staging-whatsapp WA_NUMBER=91XXXXXXXXXX` links the test number to the real-estate demo workspace, posts a signed synthetic inbound (and a duplicate, and one with a wrong signature), and confirms a conversation exists on a Lead Desk lead. `WA_ARGS="--send"` also sends ONE reply to that number; `WA_ARGS="--template"` submits a one-variable test template to Meta (the only approved template on the test account, `hello_world`, takes no variable, so a message outside the 24-hour window needs ours; set it to approved with `POST /whatsapp/templates/{id}/status` once Meta has decided).

## Notes
- Meta test numbers can message only the recipients added in the developer app, and only after the recipient has opted in by messaging the number or by a template.
- The token is a permanent system-user token (`sme-whatsapp-token`, version 2): read at run time by Cloud Run; never logged, never in the database (a workspace row holds only the *name* `default`).
- If the origin lock (`ORIGIN_LOCK_SECRET`) is turned on, Meta cannot send the header: exempt `/v1/webhooks/whatsapp` (its own signature check protects it) before turning the lock on.
