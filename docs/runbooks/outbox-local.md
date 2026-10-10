# Runbook: the outbox on the local stack (job AT, ADR 0066)

Everything here is local and synthetic. **Nothing is ever sent to anyone**: the only channel is a stand-in inside the API process (`OUTBOX_ADAPTER=fake`, the only value that exists). A real WhatsApp channel is a later job and needs the owner's written approval.

## The switches (all closed by default)
| Switch | Who | Default | How |
|---|---|---|---|
| Global kill switch (`outbox_enabled`) | the operator | OFF: every message is blocked (`switch_off`), nothing queued goes | local: `./scripts/dev-enable-outbox.sh on` (or `off`) |
| Automatic sending for a business | its Owner, second factor | OFF: every message waits for a person (`auto_off`) | `PUT /v1/tenants/{id}/outbox/settings {"auto_send_enabled": true, "per_customer_daily_limit": 3}` |

## Try it
```
make db-start
make dev-api-local              # leave running
make seed-demo-manual           # once: the DEMO business
make seed-demo-outbox           # switches the kill switch on locally, then makes: one message that goes by itself, a Telugu price and a reply to a complaint that WAIT, one blocked, one call request
```
Then, as the demo owner: `GET /outbox/messages` (the log), `GET /outbox/approvals` (the queue), `POST /outbox/messages/{id}/edit|approve|reject`, `POST /outbox/dispatch`, `GET|POST /call-requests`. Approving a message and approving a call need the Owner's (or Admin's, for messages) second factor.

**The web's Today must know the new kinds `outbox_approval` and `call_approval` first.** An older web build shows an error for Today (it checks every item strictly) while one of them waits. If you see that, `make db-reset` and `make seed-demo-manual` give you the old Today back.

## What the policy does (the short version; the full rules are in ADR 0066 and the migration header)
* Goes by itself: a reply within 24 hours of the customer's message; catalogue, hours, location; visit booking, confirmation, reminder; a follow-up without prices; an order status without amounts. Between 21:00 and 09:00 India time it waits for 09:00.
* Waits for a person (the default): money in any of English, Telugu, Hindi, Kannada, Tamil (a rupee sign, rupee words, price, discount, GST, advance, payment, refund, credit, UPI, bank...), a promise or guarantee, a complaint, anything the assistant flagged or was unsure about, anything uncategorised, a "reply" with no message from the customer in the last 24 hours.
* Blocked: the kill switch is off; the customer asked us to stop (STOP is `POST /contacts/{id}/suppress`); the contact is erased; no phone; no suppression key on record; no opt-in and no contact history; more than the per-customer daily limit (default 3) today.
* The first message to a customer carries "This message is from the business's AI assistant." in their language.
* A person can approve what waited (even money), edit it, or reject it. The blocks are checked again at approval and at dispatch.

## Dispatch
There is no scheduler yet. Owner and Admin dispatch right after they submit or approve, and with `POST /outbox/dispatch`. A scheduled worker needs its own principal first (ADR 0013 option B).

## Stop everything
`./scripts/dev-enable-outbox.sh off` (nothing is claimed while it is off; the queue waits). To remove the demo rows: `make db-reset`.
