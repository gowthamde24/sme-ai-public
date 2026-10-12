# Runbook: connectors (IndiaMART, UPI payment links, missed calls, click-to-call) — job BZ, ADR 0080

Everything is **off** unless you name a provider. Nothing here opens an account, spends money by itself or stores a key. The first four steps use only fakes.

## Try the plumbing for free (no key, no network)
In the terminal that starts the API (agent stack, port 8001):

```
INTEGRATIONS_TENANT_ID=<the demo workspace id> \
INDIAMART_PROVIDER=fake PAYMENTS_PROVIDER=fake CALLS_PROVIDER=fake \
EXOTEL_WEBHOOK_TOKEN=<any 24+ letters, digits, - or _> \
SCHEDULER_EMAIL=<the worker account> SCHEDULER_PASSWORD=<its password> \
make dev-api-local API_PORT=8001
```
The webhooks sign in as the registered worker account of the scheduler (`docs/runbooks/scheduler-local.md`); without it a webhook answers 503. Then, as the demo Owner:

* `POST /v1/tenants/<t>/connectors/indiamart/pull` makes three invented buyers (numbers start +00, so a closed workspace accepts them).
* `POST /v1/tenants/<t>/orders/<order>/payment-links` `{"id": "<uuid>", "amount_paise": 40000}` makes a fake link; `POST /payment-links/<id>/send` queues the message for approval.
* To play the provider's webhook: sign a body with the fake secret (`app.connectors.payments.FakePayments.signed`) and POST it to `/v1/webhooks/fake-payments`; the link turns `paid`; `POST /payment-links/<id>/record` records it on the order.
* `GET /v1/webhooks/exotel/<token>/missed-call?CallSid=abc12345&CallFrom=09876543210&Direction=incoming` plays a missed call; `GET /missed-calls` lists it.

## Switch real providers on (when you decide to)
Enter each secret hidden in the terminal that starts the API, never in a file. A provider named without what it needs stops the API at start.

| Connector | Environment | Notes |
|---|---|---|
| All | `INTEGRATIONS_TENANT_ID` (the ONE workspace), `PUBLIC_BASE_URL` (https address of this API as the providers reach it) | other workspaces get 404 |
| IndiaMART | `INDIAMART_PROVIDER=real`, `INDIAMART_CRM_KEY` | key from Seller portal → Lead Manager → Import/Export Leads → Pull API (paid sellers). It expires after 7 days without use. Real buyers need the **real-data gate open** (`docs/runbooks/real-data-gate.md`); until then a pull reports them as `gated` and takes none. |
| Razorpay | `PAYMENTS_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | UPI links need Live mode with UPI enabled (not in Test mode). In the dashboard add a webhook to `<PUBLIC_BASE_URL>/v1/webhooks/razorpay` for `payment_link.paid`, `.partially_paid`, `.expired`, `.cancelled`, with the same secret. |
| Cashfree | `PAYMENTS_PROVIDER=cashfree`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV=sandbox|production` | needs the customer's phone on the contact. Webhook address `<PUBLIC_BASE_URL>/v1/webhooks/cashfree` (also sent per link as `notify_url`). Try the sandbox first: the documentation shows two spellings of the signed text; both are accepted. |
| Exotel | `CALLS_PROVIDER=exotel`, `EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_SUBDOMAIN` (default `api.in.exotel.com`; `api.exotel.com` for Singapore), `EXOTEL_CALLER_ID` (the ExoPhone), `EXOTEL_AGENT_NUMBER` (the shop's own phone), `EXOTEL_WEBHOOK_TOKEN` | In the ExoPhone's flow put a Passthru applet (async) under "if nobody answers" pointing at `<PUBLIC_BASE_URL>/v1/webhooks/exotel/<EXOTEL_WEBHOOK_TOKEN>/missed-call`. The status callback is sent per call. |

## What a person sees and does
* `GET /connectors/status` (Owner, Admin): what is on, the last pull, open links, **paid links waiting to be recorded**, missed calls waiting.
* A paid link does nothing to the order by itself. **Someone records it** (`POST /payment-links/<id>/record`). A `mismatch` (another amount was paid) is not recorded by this route: record the real amount by hand on the order.
* Missed calls from customers with consent get a fixed short reply only when automatic sending is on; everything else waits in `GET /missed-calls` until someone calls back or presses "dealt with".
* A call is placed from an **approved** call request: `POST /call-requests/<id>/connect` (Owner, Admin), 09:00–21:00 India time only, once per request.

## If something goes wrong
* `429 asked_too_soon` on a pull: IndiaMART allows one call in five minutes. `indiamart_unauthorized`: the key is wrong or expired (regenerate it in the seller portal).
* `gated` in a pull result: the workspace's real-data gate is closed; nothing was taken and the window was not moved.
* A webhook that never arrives: check the address, the secret and that the worker account can sign in (`503 webhooks_unavailable` otherwise).
* To switch a connector off, remove its environment variable and restart the API.
