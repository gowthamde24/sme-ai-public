# ADR 0100: error reporting, off until a DSN is set (job DP, part 6)

Status: built on branch `ops/dp-mail-sentry` (night run 26 Oct 2026). No Sentry account exists; nothing is sent.

## Decision
1. **Off by default:** with no `SENTRY_DSN` nothing is imported, started or sent (API, worker, web server). A test proves the SDK is not even imported.
2. **API and worker: `sentry-sdk`** (one new dependency, pure Python; why: the protocol, retries, a bounded queue and transport are not worth rewriting). Started with `send_default_pii=False`, no integrations, no breadcrumbs, no local variables, no source context, no tracing, no profiling; **every event goes through `scrub_event`**, which keeps the exception CLASS NAME and the stack frames (module, function, line) and a request id, and drops everything else, including the message (it may hold what a person said). An event that cannot be scrubbed is dropped.
3. **Web: no SDK, no dependency.** `@sentry/nextjs` would add a browser bundle (the route-JS budget audit), need a looser Content-Security-Policy (`connect-src 'self'` is pinned by tests) and collects request data by default. Instead `instrumentation.ts` (`onRequestError`) posts one small envelope per server-side error (`lib/observability/report.ts`): class name, frames inside the build, the route PATTERN (never the address asked for), Next's digest. **The browser does not report**; that needs a CSP change and the owner's decision.
4. **Never what a person said:** no message, URL, query, header, cookie, body, user, IP address or log line leaves, on either side; tests feed PII-laden errors through both and read what would have been sent.
5. **The DSN is a secret of the environment** (Secret Manager, `--update-secrets`), switched on per service without a code release (docs/runbooks/error-reporting-sentry.md).

## Consequences
- Error volume is the owner's to watch only once they create a project; until then the logs (class name, request id) are the record.
- If the owner later wants the browser covered, or traces, that is a separate decision (CSP and privacy review first).
