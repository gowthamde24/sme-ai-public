# Error reporting (Sentry), off until the owner provides a project (job DP part 6)

**Nothing is sent today.** The API, the worker and the web's server report unexpected errors to Sentry only when `SENTRY_DSN` is set; unset (the default) nothing is imported, started or sent. No account was created for this.

## What leaves when it is on
The error's **class name and stack frames** (module, function, line; no source lines, no variables), the release, the environment, a request id (API) or the route pattern and Next's digest (web). **Never:** the exception message (it may hold a name, a number or a sentence a person said), a URL, query, header, cookie or body, a user, an IP address, breadcrumbs, log lines. The API scrubs every event before it leaves (`app/observability/sentry.py`; a test uses a capturing transport and PII-laden errors). The web has no SDK (`apps/web/lib/observability/report.ts`, `instrumentation.ts`): one small envelope post, with the same rules. The browser does not report (its Content-Security-Policy lets it talk to this app only).

## What the owner must create (about ten minutes, no money: Sentry's free developer plan is enough to start)
1. An account at sentry.io (choose the EU data region if offered), one organisation, **two projects**: `stack19-api` (platform Python) and `stack19-web` (platform JavaScript, any). Leave Sentry's own data scrubbing switched on (more scrubbing is welcome).
2. In each project: Settings > Client Keys (DSN). Copy the DSN (`https://<key>@o<number>.ingest.<region>.sentry.io/<project>`). It is not a password but it is not for chat or Git either.
3. Put each DSN in Google Secret Manager (project project-2757c07e-37d2-4167-88f): `sme-sentry-dsn-api` and `sme-sentry-dsn-web`. Let the run service accounts read them: `sme-api-run` and `sme-worker-run` the first, `sme-web-run` the second (role Secret Manager Secret Accessor on that secret only).
4. Switch it on, per service, without a redeploy of code: `gcloud run services update sme-api --region asia-south1 --update-secrets SENTRY_DSN=sme-sentry-dsn-api:latest --update-env-vars SENTRY_ENVIRONMENT=staging` and the same for `sme-web` with the web's secret; `gcloud run jobs update sme-worker ...` with the API's secret. (The deploy script does not touch these, so a later deploy keeps them.)
5. Check: Sentry's "Issues" stays empty until something breaks; do not break staging on purpose, the tests prove the path with a capturing transport. When an issue does arrive, it shows the class name, the stack and the request id (API) or the route pattern (web), and nothing else.

## Off again
`gcloud run services update sme-api --region asia-south1 --remove-secrets SENTRY_DSN` (and the same for the web and the worker).
