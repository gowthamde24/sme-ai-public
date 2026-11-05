# ADR 0121: The developer API, test mode first

Status: accepted (owner decision 5 Nov 2026, job developer-api; this ADR records C1's reading of it overnight)

## Context
The owner wants a small, stable developer API: POST a lead, get the outcome by a signed webhook. Real calls stay off until the lawyer's review (ADR 0120). The API must never bypass a guard
(RLS, consent, DND, calling hours, plan, approvals).

## Decision
1. **Test mode is a sandbox, the Stripe way.** An `sk_test_` key reads and writes the workspace's **sandbox** tables only. It never touches the real leads, follow-ups, Lead Desk, calls, messages
   or money. Calls are simulated: the outcome comes from the number's last digit. Validation is the app's own: consent, dedupe and the simulated DND. Calling hours are the workspace's real
   ones. `sk_live_` does not exist until the lawyer's review, a verified business and the owner's approval of live calls. Live mode will then write through the real lead pipeline.
2. **A key is a credential the database checks**, like the lead-intake address (no user JWT).
   - The API calls `SECURITY DEFINER` functions as the worker account. Each function is given the key's SHA-256 hash, and checks that the key exists, is not revoked, has the scope and
     belongs to the workspace before it reads or writes. There is no service role in the request path and no generic SQL.
   - Keys are made only by an Owner or an Admin, signed in, through Settings -> Developers (RLS as every screen). The secret is shown once; the database keeps a hash, the prefix and the last
     four.
3. **Idempotency** is stored per key: the Idempotency-Key, a hash of the body and the first answer, for 24 h.
4. **Rate limit:** 60 requests a minute per key, counted in the database, with 429 and Retry-After. One counter row per key and minute.
5. **Webhooks** are signed with HMAC-SHA256 over `t.body`, with the endpoint's own secret, which is kept in Secret Manager like the workspace's keys.
   - The scheduler worker delivers them (no new process), with backoff.
   - URLs must be public https.
6. **The OpenAPI spec is generated from the code.** A CI test fails when the published copy is stale.

## Consequences
- Developers can build and test the whole flow now, with no risk to real people.
- The sandbox tables are tenant-owned: RLS, the registry, the privacy export and erasure apply as for any table.
- Moving to live mode is a new ADR: the same routes, with the real pipeline behind `sk_live_`.
