# ADR 0083: one error shape for the whole API, and the tooling for Meta's test number

Status: accepted for the local stage (job CD, 2026-10-12). Builds on ADR 0076 (the WhatsApp channel) and ADR 0082 (request id, rate limits). No migration. No new dependency.

## Decisions

1. **Every refusal has one body**: `{"error": {"code", "message", "retry_after", "request_id", ...closed extras}}`.
   * `code` is a closed word the web maps to a page or a sentence; `message` is a fixed sentence (never a submitted value, never data-layer text).
   * `retry_after` is whole seconds, or `null` when waiting does not help. It is also sent as the `Retry-After` header; an `ApiError` given either one produces both (only the seconds form of the header is read).
   * `request_id` is the id of this response (`x-request-id`, made or kept by the outermost middleware); the person can quote it, and the access log line carries the same id.
   * Extras are closed: `fields` (a 422: the NAMES of the fields refused; `body` when the whole body was the wrong kind of thing; never a value), `reason` (a closed word on the refusals that have one), `until` (a pause).
2. **One builder.** `app/errors.py: error_body` builds every body: the `ApiError` handler, the 404/405 handler, the validation handler, the repository-error handler in `main.py`, the rate-limit middleware, the size-limit middleware, the price-list "file has problems" 422 (which keeps its top-level `issues`) and a new last-resort handler for an unexpected exception (`500 internal_error`, nothing about the failure; the 500 also carries the `x-request-id` header, because it leaves from outside the request-id middleware). A test scans the source and fails if any other module builds an error body.
3. **The shape is documented in the OpenAPI document**: one schema `ApiErrorBody`, named on every operation's 422, 429 and 500 (and 401, 403, 404 on the signed-in `/v1/tenants` and `/v1/me` routes), replacing FastAPI's own 422 schema. The contract schema (`packages/contracts/tenancy.schema.json`, `index.ts`) lists the new fields; in TypeScript they are optional so older mocks still type-check.
4. **A test walks the OpenAPI operations** and calls every one signed out, as a Viewer, as a stranger to the workspace and with a body of the wrong kind; every answer of 400 or more must have the shape, with `request_id` equal to the header and `retry_after` equal to `Retry-After`. The middleware 429, the 500, the unknown path and the wrong method are checked as well.
5. **Compatible for the web**: `code` and `message` are unchanged everywhere; the new keys are additions. The one 422 whose message changed is a body of the wrong kind (it now names `body`).
6. **Tests send a fixed `x-request-id`**, so the tests that prove two refusals are byte-identical (a foreign and an unknown workspace) stay meaningful: the request id is the only per-request part of a refusal.
7. **Meta's test number gets its own tooling, not a code path in the app.** `make dev-api-whatsapp` is the only place that turns the real adapter on (`OUTBOX_ADAPTER=whatsapp`); it reads the access token, the app secret and the verify phrase with `read -rs`, checks the token with Meta (the token travels on `curl`'s stdin, never in the process list), prepares the channel account in the local database and starts the API. `make whatsapp-test` connects the number to its own local workspace `wa-test-local` and shows the inbox, sends a reply and shows the delivery steps. The fake stays the default; nothing sets the real adapter in the Makefile.

## Not decided here

* Whether the real-data gate may be opened for `wa-test-local` so that the owner's own number can be used: it is the owner's exception to make (runbook `whatsapp-test-number.md`).
* A web screen for the WhatsApp account, templates and inbox (the web lane); the helper stands in until it exists.
