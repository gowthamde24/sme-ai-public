# ADR 0002: API authentication and data access (T002, milestone 2)

Status: accepted for milestone 2. Builds on ADR 0001.

## Decisions

1. **The signing algorithm was checked, not assumed.** Supabase's docs describe both HS256 (legacy shared secret) and asymmetric signing keys served from `/auth/v1/.well-known/jwks.json`. A real sign-up against the local stack (Supabase CLI 2.119.0) returned an **ES256** token with a `kid`, and the JWKS endpoint serves the matching public key. So the default is ES256 via JWKS; HS256 is supported only when explicitly enabled with a secret (legacy hosted projects).
2. **Algorithms are pinned by configuration, never by the token.** The `alg` header is only compared against `SUPABASE_JWT_ALGORITHMS`; `none`, unlisted algorithms and HS/RS confusion are rejected before any key lookup. Asymmetric tokens verify only against JWKS keys, HS256 only against the configured secret; a public key is never used as an HMAC secret. `exp`, `iat`, `iss`, `aud` and `sub` are required; issuer and audience must match exactly; `role` must be `authenticated`; anonymous sign-ins are refused.
3. **Fail closed.** Only `API_ENV=development` (exact match) may fill gaps from the local stack. Anything else (including `prod`, `staging`, empty, typos) refuses to start if the URL, anon key, issuer, audience, algorithms, or key material (JWKS URL / HS256 secret) is missing, uses an unsupported algorithm, a too-short secret, or non-https URLs. In development with incomplete config the app still boots (so `/health` works) but every tenant endpoint answers 503, never "allow".
4. **No service-role key; user JWT only.** `PostgrestTenantRepository` calls PostgREST with the caller's own bearer token plus the public anon key as `apikey`, so Postgres RLS is the authorization layer even if a route forgot a check. The integration suite receives only the URL and anon key (`scripts/with-local-supabase-env.sh` filters the service-role key out).
5. **Tenant resolution is path-based and role comes from the database.** Tenant-scoped routes are `/v1/tenants/{tenant_id}/...`. The dependency looks up the caller's membership (via RLS) on every request. Unknown, malformed and foreign tenant ids all return an identical 404 (not 403), so existence cannot be probed; a member whose role is too low gets 403. This replaces the earlier plan to use an `X-Tenant-Id` header: a path parameter cannot disagree with the URL and needs no extra header handling. Because roles are read per request, removing a member takes effect immediately even though the token stays valid until expiry (tested).
6. **One error shape**, `{"error": {"code", "message"}}`, with generic auth messages: the rejection reason goes to the server log only, never to the client and never with the token. Validation errors name fields, never echo values. Data-layer failures are mapped to fixed codes (401/403/409/422/502) with no upstream detail.
7. **`POST /v1/tenants` is idempotent** (returns 200 with the existing tenant when its Owner retries the same slug). The database function is the authority; the API validates first only to give clean 422s.
8. **Provider behind an interface.** Routes depend on the `TenantRepository` protocol; PostgREST is one implementation, and unit tests use an in-memory fake that mimics what RLS exposes.

## Dependencies added (CLAUDE.md rule 8)

- `pyjwt[crypto]`: signature and claim verification, JWKS fetching/caching. Hand-rolled crypto is unacceptable; `python-jose` is poorly maintained.
- `httpx` moved from dev to runtime dependencies: it is the PostgREST client (already present for tests). No `supabase-py`: PostgREST over `httpx` is sufficient and keeps a single, auditable request path.

## Known limits

- JWKS keys are cached for 10 minutes. A key rotation is picked up on the next unknown `kid`, but a revoked key can still verify tokens for up to that window. Access tokens are short-lived (1h default) anyway.
- The synchronous `httpx` client runs in FastAPI's threadpool. Fine at V1 scale; revisit if the API becomes I/O heavy.
- No rate limiting on the API yet (T002 non-goal).
- Concurrent last-owner races are covered at the HTTP level against the real stack. Two Owners acting on their own memberships deterministically yield one success and one `23514`; Owners acting on each other yield one success and either `23514` or "no rows" (the winner already removed their authority). Removing the tenant row lock from the trigger makes the deterministic cases fail.
