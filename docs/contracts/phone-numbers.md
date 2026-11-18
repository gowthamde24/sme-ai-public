# A business's own phone number (18 Nov 2026, planner; blocker 3 of the launch list)

`/v1/tenants/{t}/phone-line`. One line per business. Built against the adapter in `app/phone_numbers/provider.py`; `PHONE_NUMBERS_PROVIDER` = `off` (default, 503 `numbers_unavailable`) | `fake` (staging: made-up 080 numbers, nothing rented, no cost; `live: false` in every answer) | `plivo` (the real adapter, never the default; needs the Plivo account and the secret store).

| Method and path | Who | Answer |
|---|---|---|
| `GET /phone-line/available?pattern=` (pattern: up to 6 digits) | Owner, Admin | `{live, items: ["+9180…", …]}` at most 5; renting nothing |
| `GET /phone-line` | Owner, Admin | `{state: "none"\|"ready", number, inbound_on, live}` |
| `POST /phone-line` `{number}` | Owner + second factor | takes the number: rents it for the business's own sub-account and accepted KYC, makes its Application, links it, records the line with `inbound_on: false` (the operator switches inbound on after the first test call). 409 `phone_kyc_required` (the business registration is not accepted yet, at Plivo or in our record; see `/phone-kyc`), 409 `already_has_number`, 409 `number_not_available`, 502 `number_provider_unavailable` |
| `DELETE /phone-line` | Owner + second factor | gives it back: the provider FIRST (a number that cannot be released stays on the record), then the record. Idempotent |

Release on close: the worker tick lists the lines of ARCHIVED workspaces (`scheduler_phone_lines_closed`), gives each back at the provider and removes its row (`scheduler_phone_line_removed`); a line that cannot be released now waits for the next tick. In `plivo` mode the worker builds the same secret store as the API; in `fake` mode it can only release the fake's own made-up numbers (a real number is refused, so a worker started with the wrong provider never deletes the record of a rented line). It takes at most 5 lines per tick, in random order, so a line that keeps failing cannot starve the others.

The per-business model (a Plivo sub-account per business, filed by the in-app KYC, with the business's own accepted compliance application) is ONE class, `PlivoSubaccountNumbers`. Plivo's answer on how a reseller holds numbers (ticket #37858 follow-up) changes that class only. The REST shapes follow Plivo's documentation and have been exercised only against `tests/fake_plivo_numbers.py`; the first real run is the check (a dry run first: `scripts/plivo_onboarding.py` is the operator path until then).

Costs: a number is rented at the provider (a monthly rent) when the Owner takes it; the free early access allowance is one number per business.

Rules found in review (18 Nov): the database binds the line to the workspace (the vault key is THIS workspace's own, the sub-account is the one its accepted KYC made); that the provider really rented the number is the API's duty (a signed-in Owner who calls the RPC directly can only record a number for their own workspace). The number is released by the sub-account that holds it, then by the main account; Plivo not knowing it under either counts as released. If the Application or the link fails after the rent has started, the number is given back at once. An Application left behind after release costs nothing and is not deleted.
