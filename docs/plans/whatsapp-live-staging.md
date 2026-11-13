# WhatsApp Cloud API live on staging, templates, Embedded Signup (owner instruction 13 Nov 2026: "Meta is verified")

## What already exists (jobs BR, DU, DY; read in code 13 Nov)
Meta's Cloud API adapter (`app/whatsapp`, Graph v25.0, official, no BSP); webhook `GET/POST /v1/webhooks/whatsapp` (verify token, `X-Hub-Signature-256`, idempotent, inbound messages become leads, delivery and read statuses update the outbox log, STOP in en/hi/te/kn suppresses); the outbox policy (money check, approval queue, 24-hour window, approved template outside it, quiet hours, per-customer daily limit, global switch, event log); the test fence `WHATSAPP_ALLOWED_RECIPIENTS` (real sends ONLY to the sandbox list); template drafts, status and `submit` to Meta (`/whatsapp/templates`); conversations list; the account link (`/whatsapp/account`). Staging runs `OUTBOX_ADAPTER=whatsapp` with the Meta test number.

## What this instruction adds, in order
| # | What | Status |
|---|---|---|
| W1 | Prove it with the test number: a REAL sandbox send and a reply, through the staging API (the owner's own allow-listed number only) | QUEUED |
| W2 | First templates, drafted in te / hi / kn / en (visit reminder, visit confirmation, follow-up nudge with no prices, catalogue share, "we tried to call you"), created as drafts, template status read back from Meta, report which are approved | QUEUED |
| W3 | "Connect WhatsApp" with Embedded Signup (Tech Provider): per business WABA id + phone number id, our app subscribed to its webhooks | QUEUED |
| W4 | `docs/plans/meta-app-review.md`: screen-recording script, permission justifications (`whatsapp_business_messaging`, `whatsapp_business_management`), privacy and data-deletion links. **OWNER submits App Review and creates the System User token (hidden prompt into Secret Manager)** | QUEUED |
| W5 | WhatsApp cost per message (Meta's price, no mark-up) into the ₹ ledger | waits for billing v2 P1 |
| W6 | "Open in WhatsApp" fallback for shops without a connected number: DONE (#538 route, #539 web, behind `OUTBOX_WHATSAPP`) | DONE |
