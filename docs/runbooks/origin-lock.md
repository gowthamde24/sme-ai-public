# Origin lock: Cloud Run answers only what came through our Cloudflare Worker (job DT)

Both Cloud Run services (`sme-web`, `sme-api`) are reachable at their own `*.run.app` addresses. Anyone who finds one can skip Cloudflare's firewall, bot checks and rate limits. The lock closes that: when a secret is set, the service answers only requests that carry it in the header `X-Stack19-Origin`, except the health probes (`/health`, `/ready`). The Cloudflare Worker adds the header; so do our own server-to-server callers (the web's server, the seed and demo-refresh scripts).

Unset = no lock, so nothing changes until you do the steps below.

## What the code does
- API: `app/hardening/originlock.py`, env `ORIGIN_LOCK_SECRET`; a wrong or missing header is a plain 403 `forbidden`; the comparison is constant-time.
- Web: `proxy.ts` does the same for pages; `lib/api/client.ts` adds the header to every call the web's server makes to the API.
- `scripts/seed_staging.py` adds it when `ORIGIN_LOCK_SECRET` is in its environment.

## Owner steps (nobody can do these for you: they are secrets and Cloudflare settings)
1. Make a long random secret (for example `openssl rand -base64 32`); do not paste it into chat or a file in the repository.
2. Store it in Secret Manager: `printf %s "$SECRET" | gcloud secrets create sme-origin-lock --data-file=- --project <project>` (a new secret); give `sme-api-run` and `sme-web-run` access to THAT secret only (`secretmanager.secretAccessor` on the one secret).
3. Put it in the Worker: Cloudflare > Workers > the Worker in front of stack19.com > Settings > Variables and Secrets > add a **secret** `ORIGIN_LOCK_SECRET`. In the Worker code, add the header to the request that goes to the origin:
   ```js
   const upstream = new Request(request);
   upstream.headers.set("X-Stack19-Origin", env.ORIGIN_LOCK_SECRET);
   return fetch(upstream);
   ```
4. Deploy with the secret mounted as `ORIGIN_LOCK_SECRET` on both services (the deploy scripts take it from Secret Manager like the other secrets: add `ORIGIN_LOCK_SECRET=sme-origin-lock` to the secret list). **Do the Worker first, then the services**; the other way round locks you out until the Worker has it.
5. Check: `curl -i https://<service>.run.app/v1/packs` must be 403; `curl -i https://api.stack19.com/v1/packs` (through Cloudflare) must be 200; `/health` answers 200 on both.
6. Rotate it the same way (Worker secret first, then Secret Manager version and a new deploy).

## Things that call the services directly and need the header
- Cloud Scheduler jobs that hit an HTTP address (none today: `sme-tick` and `sme-demo-refresh-daily` start Cloud Run jobs through the Run API, not our services).
- The Cloud Run job `sme-demo-refresh` calls the API: set `ORIGIN_LOCK_SECRET` on that job too (`gcloud run jobs update ... --set-secrets`).
- The staging smoke and click-through scripts: export `ORIGIN_LOCK_SECRET` before running them.
