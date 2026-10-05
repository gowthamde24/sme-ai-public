# Key-model audit (read-only), 2026-10-05

Scope: every use of the anon key, the service-role key and the JWT secret across code, config, scripts, tests and docs. No behaviour was
changed. `.env` was not read; `.env.example` was.

## Inventory
| Key | Where it is used | Notes |
| --- | --- | --- |
| **anon / publishable** (public by design) | Web: `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/web/lib/supabase/config.ts`, `server.ts`, `proxy-session.ts`. API: setting `SUPABASE_ANON_KEY` (`app/config.py`) used as the PostgREST `apikey` by all repositories (`tenancy`, `crm`, `evidence`, `leads`, `erasure`, `agent_runs`, `agents/db.py`, `agent_runs/wiring.py`) | Never sufficient alone: PostgREST answers 401 without a user JWT (checked below). |
| | Scripts: `scripts/seed_demo.py`, `scale_erasure.py` (`SUPABASE_ANON_KEY`), `verify_hosted.py` (`HOSTED_SUPABASE_ANON_KEY`), `with-local-supabase-env.sh` (exports only `API_URL`, `ANON_KEY`), `e2e/lib.mjs`, `Makefile` | The wrapper whitelists two variables, so no other key reaches a test process. |
| | Deploy: `deploy/cloudrun.sh`, `deploy/Dockerfile.web` (build arg) | Dry run unless `--execute`; never run. |
| | Tests: `tests/integration/conftest.py` and about 12 integration files; API unit tests for config and repositories | All read it from the local stack through the wrapper. |
| **service_role / secret** (privileged) | **No code, config, script or test uses it.** Mentions are refusals and guards: `app/auth/jwt.py` rejects tokens with role `service_role` or `anon`; `apps/web/test/guards.test.ts` fails if `service[_-]?role` appears in browser code; `with-local-supabase-env.sh` filters it out; `.env.example` and CLAUDE.md say none exists | pgTAP file 37 grants it temporarily inside a rolled-back test only to prove provenance triggers refuse it. |
| | Database: writes revoked on every public table and view, and by default for new tables (`20261012090100`); the catalog guard (pgTAP 06) and `supabase/hosted/verify.sql` assert it; operator functions are closed to it | SELECT stays. It still bypasses RLS for reads. |
| **JWT secret** (legacy HS256) | `SUPABASE_JWT_SECRET` in `app/config.py` (only if `HS256` is listed in `SUPABASE_JWT_ALGORITHMS`), `app/auth/jwt.py`, `tests/keys.py`, `.env.example` (commented) | Not needed on the local stack: it signs ES256 with a key id, verified through JWKS. |
| **Other secrets** | `ANTHROPIC_API_KEY` (environment only; runtime refuses live calls until `LLM_SPEND_CAP_CONFIRMED=true`, a model id and prices are set) | Covered by ADR 0013 and ADR 0017 b. |

## Checked on the local stack (2026-10-05, a throwaway local user, no key printed)
* `supabase status` already prints `PUBLISHABLE_KEY` (`sb_publishable_...`) and `SECRET_KEY` (`sb_secret_...`) next to `ANON_KEY` and
  `SERVICE_ROLE_KEY`.
* Sign-up works with the publishable key as `apikey`. The access token is ES256 with a `kid`.
* PostgREST with the publishable key plus the user JWT returns 200 under RLS; with the publishable or the anon key alone it returns 401
  (permission denied), the same for both.
* The API's `TokenVerifier` (settings `API_ENV=development`, `SUPABASE_ANON_KEY` set to the publishable value) accepts the user JWT through
  JWKS. The anon and the publishable key are both refused as bearer tokens.
* Conclusion: user-JWT verification does not depend on which key name is configured. Side effect: one local user
  `keycheck-<hex>@example.test` now exists in the local database (next `supabase db reset` removes it).

## Proposed rename (not applied: this is a docs-only task)
Support both names, new first: `SUPABASE_PUBLISHABLE_KEY` (API, scripts), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (web),
`HOSTED_SUPABASE_PUBLISHABLE_KEY` (verifier). Fall back to the old name silently.
* `app/config.py`: one setting with `AliasChoices("supabase_publishable_key", "supabase_anon_key")`; the fail-closed test covers both names.
* `apps/web/lib/supabase/config.ts` reads the new name, then the old; the web guard test gains `sb_secret` and `secret[_-]?key` patterns.
* `with-local-supabase-env.sh` exports `SUPABASE_PUBLISHABLE_KEY` from `PUBLISHABLE_KEY` (falling back to `ANON_KEY`) and still only
  whitelists the URL and the one public key. `e2e/lib.mjs`, `seed_demo.py`, `scale_erasure.py`, `verify_hosted.py`, `cloudrun.sh`,
  `Dockerfile.web`, `.env.example` and the runbooks follow.
* About 15 files, mechanical, with the config tests. Recommended as a small separate commit at the start of T007, on the owner's go.
* There is no variable for a secret key and none is added (ADR 0017 c).

## What changes at the deployment stage (T012)
1. Use the project's publishable key everywhere the anon key is used today; confirm on the hosted project whether the legacy anon and
   service-role keys can be disabled, and disable them if so.
2. JWT signing keys asymmetric (ES256); set `SUPABASE_JWKS_URL`, issuer, audience and `SUPABASE_JWT_ALGORITHMS=ES256` (already in
   `deploy/cloudrun.sh`). `SUPABASE_JWT_SECRET` stays unset.
3. The only Cloud Run values are public (URL, publishable key). No secret key in an environment, a build argument or a log. If a privileged
   key is ever needed it lives in Secret Manager under an ADR (ADR 0017 c).
4. `verify_hosted.py` uses the publishable key and its existing checks that the anon surface reads nothing.
5. Rotate nothing now: there is no hosted project.
