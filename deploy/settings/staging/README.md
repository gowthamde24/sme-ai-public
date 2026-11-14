# Staging API settings, declared (owner, 12 Nov 2026)

`api.env`, `api.secrets` and `api.scale` ARE the staging API's settings; `deploy/staging.sh` applies exactly these (tool: `deploy/settings.py`). Edit them in a pull request, then deploy with `ALLOW_FLAG_CHANGE=NAME,NAME` naming what you changed. A hand edit of the service in the console shows up as drift and stops the next deploy.

Placeholders in `api.env`: `@env:NAME` (read from the deploy's environment: the Supabase publishable key, so no key-like string is in git), `@local:NAME` (from the gitignored `api.local.env` on the deploying machine: a personal phone number), `@worker-job:NAME` (from the Cloud Run job `sme-worker`: the test fence's numbers). `api.secrets` holds Secret Manager NAMES only.

## The lead e-mail door (OFF on staging; not part of the declared settings)

It was live on 30 Oct 2026 (#239) and is absent from every staging revision since at least 6 Nov (the old script mounted it only when `API_LEAD_INTAKE=1` was typed in front of the command, and nobody did). The three secrets exist in Secret Manager. To switch it on (the owner decides: it receives real people's e-mail on a staging system), add these lines (do not copy them anywhere else):

```
# api.env
LEAD_INBOUND_DOMAIN=leads.stack19.com
# api.secrets   (the LEADS key sme-resend-leads-api-key, NEVER the sending key sme-resend-api-key)
LEAD_INBOUND_SECRET=sme-lead-inbound-secret
LEAD_RESEND_API_KEY=sme-resend-leads-api-key
LEAD_RESEND_WEBHOOK_SECRET=sme-resend-webhook-secret
```

then `ALLOW_FLAG_CHANGE=LEAD_INBOUND_DOMAIN,LEAD_INBOUND_SECRET,LEAD_RESEND_API_KEY,LEAD_RESEND_WEBHOOK_SECRET ./deploy/staging.sh deploy api`. `SCHEDULER_EMAIL`, `SCHEDULER_PASSWORD` and `PUBLIC_BASE_URL` are already declared.

## Google Calendar sync (OFF on staging until the owner creates the OAuth client)

Built behind a fake Google (appointment booking slice 4, `docs/contracts/google-calendar.md`). Without the two lines below the feature answers `not_configured` and nothing else changes; adding them before the secrets exist (and before the run service account may read them) would stop the deploy. In order:

1. the owner creates the OAuth client (Web application; redirect URI `https://sme-api-620338396268.asia-south1.run.app/v1/integrations/google-calendar/callback`) and runs `python3 -I scripts/google_oauth_client_register.py --i-know-this-writes-staging-secrets --project project-2757c07e-37d2-4167-88f` (hidden prompts; writes `sme-google-oauth-client-id` and `sme-google-oauth-client-secret`);
2. the owner grants `sme-api-run` and `sme-worker-run` secretAccessor on both (the script prints the four commands; an IAM step);
3. add to `api.secrets` (do not copy them anywhere else):

```
GOOGLE_OAUTH_CLIENT_ID=sme-google-oauth-client-id
GOOGLE_OAUTH_CLIENT_SECRET=sme-google-oauth-client-secret
```

then `ALLOW_FLAG_CHANGE=GOOGLE_OAUTH_CLIENT_ID,GOOGLE_OAUTH_CLIENT_SECRET ./deploy/staging.sh deploy api`, and the worker with `WORKER_GOOGLE_CALENDAR=1 ./deploy/staging.sh deploy worker`. `WORKSPACE_SECRETS=gcp`, `SCHEDULER_EMAIL`, `SCHEDULER_PASSWORD`, `PUBLIC_BASE_URL` and `API_CORS_ORIGINS` (the web address the callback returns to) are already declared.
