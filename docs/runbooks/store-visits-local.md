# Store visits, locally (job AS, ADR 0067)

Everything here is the LOCAL stack, synthetic data only. Nothing is sent to anyone: the only channel is the outbox's stand-in (`OUTBOX_ADAPTER=fake`).

## See it
1. `make db-start`, then your own API on a free port (for example `API_PORT=8001`; ports 3000 and 8000 are the owner's demo).
2. `SEED_API_URL=http://localhost:8001 make seed-demo` books eight invented visits for today and tomorrow (India date) in mixed states and prints them. Running it again the same day changes nothing; on another day it adds that day's.
3. As the demo owner: `GET /v1/tenants/{id}/visits/today`, `GET /visits?from=...&to=...`, `GET /visits/slots?date=...`, `GET/PUT /visits/settings`.

## Messages
A confirmation or a reminder goes into the outbox (`POST /visits/{id}/messages`). With the global switch off (the default) it is blocked as `switch_off`. To see it queue: `make seed-demo-outbox` turns the switch on and automatic sending on for the demo business (see `outbox-local.md`). In quiet hours (21:00 to 09:00 India time) it waits for 09:00. A message in Telugu, Hindi, Kannada or Tamil always waits for a person until a native reader has read the templates in `app/visits/texts.py` and `CHECKED_LANGUAGES` names the language.

## Tests that pin the clock
`supabase/tests/database/77_as_store_visits.test.sql` replaces `app.outbox_now()` for its own transaction. Run it at another hour with `PGOPTIONS='-c tests.visit_pin=2026-10-05T23:30:00+05:30'` (the dates in it assume the pin falls on Monday 5 October 2026). `tests/integration/test_visits_api.py` runs twice, pinned to 14:00 IST and to 23:30 IST, and has a test for the minutes around midnight.
