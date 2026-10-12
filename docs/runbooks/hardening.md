# Hardening and operations (job CB, ADR 0082)

## Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | the global limiter (public routes per IP, signed-in per token). Switch off only for a test. |
| `TRUSTED_PROXY_HOPS` | `0` | proxies in front of the API. 0 ignores `X-Forwarded-For`. Set it to the real number on the host or every client looks like the proxy. |
| `METRICS_TOKEN` | unset | unset = `/metrics` answers 404. Set = Bearer token required. |
| `LOG_FORMAT` | `text` | `json` for one JSON object per line. |
| `EXPOSE_API_DOCS` | `false` | `/docs`, `/redoc`, `/openapi.json` outside development. |
| uvicorn `--no-server-header` | in the Makefile | removes the `server` header. Put it in the hosted start command too. |

## Checks
* `GET /health` is liveness (no dependencies). `GET /ready` is readiness (auth keys, database); use it for the host's health check.
* `curl -H "Authorization: Bearer $METRICS_TOKEN" $API/metrics`.
* `make secret-scan` (also in `make check-fast`).

## Restore drill
* Plan only: `make restore-drill` (prints the steps; with `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL` set it checks the target is not the source and is a throwaway, and never prints a password).
* Real, local: `make agent-db-reset` first, then `make restore-drill DRILL=local` (agent stack only). The report says PASS/FAIL and the time of each step. Restore as the database's admin role keeping owners: with `--no-owner` the definer functions change owner and `verify.sql` correctly fails.
* Hosted: follow `docs/runbooks/backup-restore-drill.md` with the plan this script prints, on a throwaway project.

## Load test
`make loadtest SHOPS=50 DURATION=90 REPORT=path.md` against the agent stack's API (`make dev-api-local`, port 8001). It refuses non-local URLs and the owner's ports. Re-run it on the hosted API before launch with the hosted limits in mind (it needs a throwaway project).

## Known limits
The limiter lives in the process; more than one worker or instance multiplies the allowances. Decide a shared store (for example the database or a small cache) when hosting is chosen.
