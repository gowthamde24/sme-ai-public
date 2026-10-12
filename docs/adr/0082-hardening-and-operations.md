# ADR 0082: hardening and operations (security pass, rate limits, readiness, metrics, restore drill, load test)

Status: accepted for the local stage (job CB, 2026-10-12). Builds on ADR 0013 (agent containment), ADR 0016 (second factor), ADR 0072 (free-tier hosting), ADR 0073 (public routes: calendar feed, policies).
No migration. No new dependency. Runbook `docs/runbooks/hardening.md`; the OWASP Top 10 review is `docs/security/owasp-top10-review.md`.

## Decisions

1. **Security headers on every API response** (`app/hardening/headers.py`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, a locked `Permissions-Policy`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and `Cache-Control: no-store`. `Strict-Transport-Security` only when `APP_ENV=production` (a plain-http local run must not pin HSTS). The web app keeps its own nonce CSP in `proxy.ts`; the two do not overlap because the API serves JSON only.
2. **A request body ceiling of 20 MB** (the spreadsheet import is the largest legitimate upload) answered `413 payload_too_large`, enforced on `Content-Length` and on a chunked stream.
3. **Rate limits on every public route and a global allowance.** Public routes (no sign-in) are limited per client IP and per minute: health 120, ready 30, metrics 30, policies 60, calendar feed 30, webhooks 300, docs/redoc/openapi 20. Signed-in traffic has a generous per-token allowance (1,200 a minute, keyed by a hash of the Authorization header, never the token). Repeated failed sign-ins from one address (30 in 300 s) put that address on a slower limit (20 a minute). The answer is `429 {"error":"rate_limited"}` with `Retry-After`. The per-feature limits that already existed (sign-up, assistant, research quotas, voice) are unchanged and stay in the database where they are money or abuse limits.
4. **The limiter is in memory, per process.** This is deliberate for the local stage and the free tier (one worker). A second worker or a second instance multiplies every allowance; a shared store is a hosting decision (pre-launch checklist). `TRUSTED_PROXY_HOPS` says how many proxies sit in front, and the client address is taken from `X-Forwarded-For` counting from the right; with 0 hops the header is ignored (a client cannot choose its own address).
5. **API docs are off outside development** (`/docs`, `/redoc`, `/openapi.json`) unless `EXPOSE_API_DOCS=true`. The contract files in `packages/contracts` are the published contract. `uvicorn --no-server-header` removes the `server` header (Makefile targets updated).
6. **A request id and one access line.** `X-Request-Id` is generated (or a sane inbound one kept, 8 to 64 safe characters) and returned. The access line (logger `app.access`) carries only the request id, method, the ROUTE PATTERN (never the URL with its ids or query), status, milliseconds and an 8-hex hash of the caller. `LOG_FORMAT=json` gives one JSON object per line; every log record passes a scrubber (e-mail addresses become `[email]`, runs of 9 to 15 digits become `[number]`, exceptions are logged by class only).
7. **Readiness and metrics.** `GET /ready` checks the auth keys and the database (HEAD to PostgREST, 2 s) and answers 200 or 503 with fixed words only (`ok`/`fail`), never an error text. `GET /metrics` answers 404 unless `METRICS_TOKEN` is set and sent as a Bearer token (compared in constant time); it is Prometheus text: request counts by route pattern and status class, latency histogram, in-flight, rate-limited and 5xx counters. No tenant, user or id is a label.
8. **A secret scan in `make check-fast`** (`scripts/secret_scan.py`): provider key shapes, private keys, JWT-looking strings, service-role assignments, hosted database URLs with a password; an allow-list for test-only canaries. It reads tracked and new files, never `.env`.
9. **A restore drill script** (`scripts/restore_drill.py`): the default is a printed plan (dry run) that refuses a target equal to the source or not named as a throwaway; `--local` performs the real drill in the AGENT stack's container only (dump, restore into a scratch database keeping owners, compare row counts of every table, run `supabase/hosted/verify.sql` on both, time each step, always clean up).
10. **A load test script** (`scripts/loadtest.py`, `make loadtest`): N invented shops, each a typical day of mixed reads and writes through the API (sign in, enquiries, leads, quotes, orders, the Ask box with the fake model), refuses anything but the local agent stack, reports per-class percentiles and a pass/fail verdict.

## Findings fixed in this job
* The API sent no security headers, had no global limit, no readiness or metrics, served its docs in production and named its server software.
* Logs could in principle carry an e-mail or phone number in an exception message; now scrubbed.
* Public-route inventory is now a test: a new route without a sign-in dependency fails the test unless it is added to the allow-list on purpose.

## Findings not fixed (and why)
* `npm audit` (full): 5 high, all development-only (`eslint-config-next` to `braces`/`fast-glob`/`micromatch`; build-time linting, never shipped). The only offered fix is a major downgrade of `eslint-config-next`; the web app is Claude 2's lane. `npm audit --omit=dev`: 0. `pip-audit` of the API environment: 0.
* The in-memory limiter (decision 4).
* No WAF or bot protection: a hosting decision.

## Consequences and risks
* Limits are guesses until real traffic exists; every number is a Settings-level constant in `app/hardening/ratelimit.py` and the 429 answer tells the web how long to wait.
* A client behind a shared NAT shares one public-route allowance; the per-token allowance is per person.
* The restore time measured locally (2 MB, 18.9 s) is a plumbing figure, not an RTO for hosted data.
* The load test ran against one uvicorn worker, a local database and a fake model; it says nothing about model latency or hosted network latency.
