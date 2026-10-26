# DPDP in operation (job DQ part 4)

What exists, where it lives and what the operator does. The contract for the web is `docs/contracts/dpdp.md`; the decisions are in ADR 0104; the breach plan is `docs/runbooks/breach.md`.

## What the person can do (all logged)
| Right | How |
|---|---|
| See and change consents | `GET /v1/me/consents`, `PUT /v1/me/consents/marketing` (give and withdraw are the same call; marketing is off by default). The `service` consent is the account; it ends only with the account |
| Correct my data | `PUT /v1/me/profile` (the display name; the e-mail belongs to the sign-in provider) |
| Download my data | `POST /v1/me/data-exports` (person) or `POST /v1/tenants/{t}/data-exports` (Owner + second factor): a zip of JSON and CSV |
| Delete my account / workspace | `POST /v1/me/deletion-requests` / `POST /v1/tenants/{t}/deletion-requests`; **7 days** to cancel; then the worker erases |
| Complain or ask | `POST /v1/privacy/grievance` (anyone): stored, reference given, e-mailed to the privacy inbox, answered within **30 days** |

## What the platform does by itself
* **Lapsed workspaces:** read-only for 90 days (job DI); an e-mail to the Owners **48 hours before**; then the existing tenant erasure runs. Exempt workspaces (Customer Zero, the demos) are never touched. This is behind its own switch, OFF until the operator turns it on:
  ```
  -- psql as the database owner, after reading the list of workspaces it would warn first
  select app.operator_set_lapse_erasure(true);     -- also needs app.operator_set_billing_enforced(true)
  select app.operator_set_lapse_erasure(false);    -- off again
  ```
  Before switching on, list who is due: `select t.id, t.name, app.lapse_erase_at(t.id) from public.tenants t where app.lapse_erase_at(t.id) is not null;`. Anyone you do not want erased: `select app.operator_billing_exempt('<id>', true);`.
* **Old logs:** audit rows older than 395 days (a year, plus a month's grace), resolved public grievances a year after they close, waitlist rows after 12 months (the worker, once an hour).
* **E-mails:** the worker sends the privacy-inbox mail, the person's acknowledgement and the waitlist mail through the one e-mail sender (Resend on staging). A failed send is tried again at the next tick.

## Settings
`PRIVACY_EMAIL`, `HELLO_EMAIL` (api, worker), `CAPTCHA_PROVIDER` (`none` | `turnstile`) and `CAPTCHA_SECRET` (api). See `docs/runbooks/hosting-env-and-secrets.md`.

## Handling a grievance
The privacy inbox gets one mail per grievance with the reference and the text. Answer by e-mail within 30 days, quoting the reference. To record the outcome in the database (so the purge clock starts): `update privacy.public_grievances set status='resolved', closed_at=now(), resolution_note='...' where reference='GR-...';` (operator, psql). For a request to delete a person's data that is in a workspace, use the workspace's own deletion flow with its Owner.
