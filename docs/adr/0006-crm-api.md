# ADR 0006: CRM API (T003, milestone 2)

Status: accepted for milestone 2. Builds on ADR 0002 (auth), 0003 (web), 0005 (consent/audit).

## Decisions

1. **Same identity model, no new privilege.** Every CRM call reaches PostgREST with the caller's own
   JWT plus the public anon key. There is no service-role key anywhere. RLS, column grants and the
   table triggers decide again after the API's own checks.
2. **Tenant from the path, authorization in a fixed order.** `/v1/tenants/{tenant_id}/{entity}`:
   valid JWT (401) -> membership of the PATH tenant (**404** when absent: never 403, never data) ->
   role allowed for the action in the caller's own tenant (**403**) -> the database. A malformed id
   is a 404. Foreign-tenant answers are byte-identical, and no foreign request reaches the data layer.
3. **Endpoints** for companies, contacts, products, leads, opportunities: list (keyset, default 50,
   max 100, `include_archived`, name filter on companies only), get, create, PATCH, `archive`,
   `restore`; plus `record-consent`, `suppress`, `lift-suppression` on contacts (the three RPCs, with
   tenant and contact taken from the path). **No DELETE route exists** (a test inspects OpenAPI).
   Roles: read = any member; create/update = Sales+ (products: Admin+); archive/restore, lift = Admin+;
   record-consent / suppress = Sales+.
4. **Strict models, generated contracts.** Request models are `extra="forbid"`: `created_by`,
   `created_via`, `closed_at`, `tenant_id`, `archived_at` and every consent column cannot be sent;
   create bodies carry no `status`. Ids are canonical UUIDs only. `packages/contracts/crm.schema.json`
   and `crm.ts` are generated from these models (`make contracts`); a test fails if they are stale and
   integration responses are validated against the schema.
5. **Idempotent create by client UUID.** `id` is required. A retry with the same payload returns the
   stored row (200; first creation is 201). The same id with a different payload is **409
   `conflict`**, and an id held by another tenant (invisible to the caller) produces **the identical
   body**. Postgres may report the primary key or a per-tenant unique value (e-mail) first, so both
   trigger the retry check. A genuine duplicate e-mail/SKU inside the caller's own tenant is 409
   `duplicate_value` naming only the field.
6. **References.** A foreign OR nonexistent company / contact / lead / owner (and a contact that
   belongs to a different company) all return the same **422 `invalid_reference`** with a fixed
   message; the body names no field and no id.
7. **Archive.** Archive and restore are idempotent Admin+ endpoints. Updating an archived record is
   409 `archived` (even for admins); lists hide archived rows unless asked.
8. **Opportunity transitions** follow the database rules and surface as stable codes: closing as lost
   without a reason is 422 (also caught by the model), won<->lost is 409 `invalid_transition`,
   reopening by a non-admin is 403.
9. **Errors never carry data.** PostgREST errors contain Postgres text with row values (a unique
   violation prints the e-mail). `classify_error` reads that text ONLY to derive a SQLSTATE and a
   constraint name; the text is never returned, never logged, and never chained (`raise ... from
   None`, so a traceback cannot print it). A pydantic error from a malformed row is dropped the same
   way. Validation errors name fields, never values.
10. **Logs.** The data-layer logger records `http`, `sqlstate`, `constraint` only. The uvicorn access
    log drops the query string (`?<redacted>`), because `?q=` can hold a person's name; `httpx` /
    `httpcore` are held at WARNING because their INFO line prints the full URL. Verified against the real server.
11. **Tests.** Unit: models (every server-owned field refused on every model, UUID forms, sizes,
    cursor tampering), routes against an in-memory data layer (all roles x all endpoints x both
    tenants), the adapter with canary-laden errors, log redaction, contracts in sync. Integration
    (real stack, 7 users in 2 tenants): every endpoint family looped over every user of both tenants,
    cross-tenant 404s with no change to the other tenant, idempotency, identical reference errors,
    keyset pagination with 130 rows sharing one `created_at` (several page sizes, rows inserted while
    paging), archive rules, opportunity transitions, the consent flows including the opt-out
    withdrawal, and a PII canary that must appear in no error body and no log line.

## Known limits

- The transition error is recognised by its message text (`terminal`). A dedicated SQLSTATE in a
  future migration would be sturdier.
- Searching puts the term in the URL. Application logs and the uvicorn access log are redacted, but any
  reverse proxy / CDN / load balancer in front must drop query strings from its logs (checklist).
- There is no request-size limit or rate limiting in the API yet (checklist).
- `PATCH` re-reads the row before updating (to refuse archived rows), so an archive that lands
  between the read and the write is not detected by the API; the database does not forbid it either.
- Read access to contacts includes e-mail and phone for every role (Viewer is read-only, not
  redacted).
- Local only: the auth signup rate limit in `supabase/config.toml` was raised so back-to-back
  integration runs do not trip it.
