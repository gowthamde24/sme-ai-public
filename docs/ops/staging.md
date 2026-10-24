# Staging: what runs where, how to deploy and roll back, what it costs, how to take it down (job DC)

Staging is a **hosting rehearsal with synthetic data only**. The real-data gate (ADR 0015) stays CLOSED: no real customer, phone number or e-mail goes in. The plan it follows is ADR 0072 (Cloud Run in Mumbai +
Supabase in Mumbai) and `docs/runbooks/hosting-rehearsal-owner.md`; where this page differs, this page says why.

## What runs where

| Piece | Where | Name / address |
|---|---|---|
| Database, Auth, Storage | Supabase **stack19-staging** (org stack19, Free plan, Mumbai `ap-south-1`) | project ref `uiallwgywitryxatcqxf`, `https://uiallwgywitryxatcqxf.supabase.co` |
| API (FastAPI) | Google Cloud Run service `sme-api`, `asia-south1` | `https://sme-api-620338396268.asia-south1.run.app` |
| Web (Next.js) | Cloud Run service `sme-web`, `asia-south1` (runs on Cloud Run, as ADR 0072 decided), behind a Cloudflare Worker | **`https://staging.stack19.com`** (the run.app address `https://sme-web-620338396268.asia-south1.run.app` still answers) |
| Scheduler worker | Cloud Run **job** `sme-worker`, started every 5 minutes by Cloud Scheduler job `sme-worker-tick` | one tick, then exits |
| Images | Artifact Registry repository `sme` (`asia-south1`), built remotely by Cloud Build | `api:<git tag>`, `web:<git tag>` |
| Google Cloud project | `project-2757c07e-37d2-4167-88f` (name stack19-staging), India billing account, free-trial credits | |

Sizes: API and web 1 vCPU, 512 MiB, **min instances 0**, max 2 (API) and 3 (web). The API is deployed with `AGENTS_ENABLED=true` and CPU allocated while an instance is up (the assistant runs in a thread),
but min instances stay 0, so there is no fixed cost: it scales to zero when idle. Outgoing messages are fake only (`OUTBOX_ADAPTER=fake`); WhatsApp, voice and payments are off.

AI: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-5-5` (Anthropic's cheapest model), prices recorded in the database (`agent_model_prices`) in millionths of a rupee per million tokens at an assumed
90 rupees to the dollar (9,000,000 in, 45,000,000 out). Limits: the assistant's own output cap per model call (1,500 tokens, in code), 3,000 output tokens per run (`agent_definitions.max_output_tokens`),
Rs 1 per run, **Rs 2 per workspace per day** (`agent_limits.daily_cost_micros`), plus the hard monthly limit set at Anthropic on the key.

## Service accounts (one per service, least privilege)

| Account | Runs | Roles |
|---|---|---|
| `sme-api-run` | the API | secret accessor on `sme-suppression-hmac-key` and `sme-anthropic-api-key` only |
| `sme-web-run` | the web | none (the web holds no secret) |
| `sme-worker-run` | the worker job | secret accessor on `sme-suppression-hmac-key` and `sme-scheduler-password` only |
| `sme-tick` | Cloud Scheduler | `run.invoker` on the job `sme-worker` only |
| `sme-build` | Cloud Build | read the `_cloudbuild` source bucket, write the `sme` repository, write logs |

## Secrets (names only; values are in Google Secret Manager, region asia-south1, and nowhere else)

`sme-suppression-hmac-key` (API, worker) · `sme-anthropic-api-key` (API) · `sme-scheduler-password` (worker's sign-in) · `sme-staging-db-password` (the owner's tools: `staging_backup.py`) ·
`sme-demo-<pack>-password` and `sme-demo-<pack>-totp` for `textiles`, `construction_materials`, `education` (the synthetic demo owners; read by the smoke tests).
Browser code holds only the Supabase **publishable** key. The service-role key is used by nothing that is deployed; `scripts/seed_staging.py` reads it from the CLI into memory to create the demo accounts.

## Deploy

```
supabase login && gcloud auth login            # once; the owner approves in the browser
make deploy-staging                            # api, web and worker: remote build, deploy (about 6 minutes)
make deploy-staging WHAT=api                   # one piece (api | web | worker)
make deploy-staging DRY=1                      # print every command, run none
make staging-status                            # what is live
make staging-smoke                             # hosted-smoke + API flows + browser flow
```
New migrations go first, from the repository root: `supabase db push --dry-run`, read it, then `supabase db push` (never `db reset`, never a data-wiping pgTAP suite against staging).
The web's `NEXT_PUBLIC_*` values are fixed at build time: changing the Supabase project, the API address or the site address means `make deploy-staging WHAT=web`.
Demo data: `python3 -I scripts/seed_staging.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url <api> [--scheduler]` (idempotent; refuses any other project).

## Roll back

```
make rollback-staging SERVICE=sme-api          # traffic to the revision before the live one
make rollback-staging SERVICE=sme-web REVISION=sme-web-00001-klb
make staging-latest SERVICE=sme-web            # undo the rollback: a deploy made after a rollback does NOT take traffic until you do this
make staging-status
```
This changes which image serves; it does not touch the database. A migration is append-only: a bad one is fixed by a new migration, not by going back.

## Backup and restore

`make staging-backup` writes a `pg_dump` (custom format, owners and grants kept, every app schema plus `auth`) to `/Volumes/Stack19/stack19/staging-backups/` (mode 600, outside Git) using the database password in Secret
Manager and the Postgres 17 inside the local agent stack's container. `make staging-drill FILE=<dump>` restores it into a scratch database on the local **agent** stack, runs `supabase/hosted/verify.sql` there,
compares every table's row count with staging and drops the scratch database. Free has no backups of its own: a dump is the only copy. When the gate opens, move to Supabase Pro (daily backups) and run the drill from the
real runbook (`docs/runbooks/backup-restore-drill.md`) first.

## Secrets rotation / owner actions
Database password: reset it in the Supabase dashboard (Settings > Database) and add a new version of `sme-staging-db-password`. Demo accounts: `scripts/seed_staging.py` creates what is missing and never changes an existing password.

## Expected monthly cost at low traffic (a few demo sessions a day)

Prices read on 2026-10-24 from Google's and Anthropic's pages; Google Cloud has no hard cap, only the budget alert (Rs 1,000 a month, alerts at 50, 90, 100 and 150 %).

| Item | Basis | Per month |
|---|---|---|
| Cloud Run web, API, worker job | inside the free amounts (2 million requests, 240,000 vCPU-seconds, 450,000 GiB-seconds); the worker is about 26,000 vCPU-seconds | about USD 0. Busier: each API session keeps an instance up about 20 minutes, 24,000 vCPU-seconds a day at 20 sessions a day, about USD 9 above the free amount |
| Cloud Scheduler | 1 job; 3 are free | 0 |
| Artifact Registry | 373 MB stored; 0.5 GB is free | 0 (USD 0.10 a GB above) |
| Cloud Build | about 1 to 4 minutes a build; the free allowance is far above that | 0 |
| Secret Manager | 11 active versions; 6 are free, USD 0.06 each above | about USD 0.30 |
| Logging, network egress | free allowances | 0 |
| Supabase Free | no card | 0 |
| Anthropic (Haiku 5.5) | about Rs 0.1 a question; the daily cap is Rs 2 a workspace, Rs 6 for the three | at most about Rs 180 (about USD 2); a few rupees in practice |
| **Total** | | **about USD 0.3 to 2, no fixed monthly cost; USD 11 as a high-water mark** |

What would add a fixed cost (each needs the owner's yes with the number): Supabase Pro USD 25 · a warm API instance (`MIN_INSTANCES=1`) about USD 44 · a warm web instance about USD 8 · Google's load balancer for a custom domain about USD 18 plus traffic.

## Custom domain: https://staging.stack19.com (live since 2026-10-24)

A Cloudflare **Worker** (`stack19-staging-proxy`, the code in `deploy/cloudflare-worker-proxy.js`, one variable `ORIGIN` = the web's run.app address, Custom Domain `staging.stack19.com` on the stack19.com zone) forwards every
request to the `sme-web` service; free (Workers Free: 100,000 requests a day, 10 ms CPU a request). Why this and not the others: Cloud Run domain mappings do not exist in `asia-south1`; Firebase Hosting strips every cookie except
`__session`, so Supabase's sign-in cookies would never reach the app; Cloudflare Free cannot rewrite the Host header by rule (Enterprise only); Google's load balancer works but costs about USD 18 a month (the fallback).
Set for it: Supabase Site URL `https://staging.stack19.com`, redirect list only `https://staging.stack19.com/auth/confirm`; the web is built with `NEXT_PUBLIC_SITE_URL` = that address and the API's CORS fence is that origin
(`deploy/staging.sh` defaults `WEB_ORIGIN` to it). The run.app web address still works but sign-in e-mail links and the CORS fence point at the custom domain.
The six checks of ADR 0072's addendum passed through it: `make hosted-smoke URL=https://staging.stack19.com ...` (1), `e2e/staging-domain-checks.mjs` (2 to 5), curl with forged `X-Forwarded-Host` (6). Re-run them after any change to the
Worker or the web's host handling. Not covered: an Ask answer far longer than a couple of sentences, and uploads between 4.2 and 5 MB (the one tested was 4.16 MB; the Worker reads a request body whole, and I did not look up Cloudflare's body-size limit for this plan).

## Take it down (staging is disposable)

```
gcloud run services delete sme-web sme-api --region asia-south1 --project project-2757c07e-37d2-4167-88f --quiet
gcloud run jobs delete sme-worker --region asia-south1 --project project-2757c07e-37d2-4167-88f --quiet
gcloud scheduler jobs delete sme-worker-tick --location asia-south1 --project project-2757c07e-37d2-4167-88f --quiet
gcloud artifacts repositories delete sme --location asia-south1 --project project-2757c07e-37d2-4167-88f --quiet
for s in $(gcloud secrets list --project project-2757c07e-37d2-4167-88f --format='value(name)' | grep '^sme-'); do gcloud secrets delete $s --project project-2757c07e-37d2-4167-88f --quiet; done   # the Anthropic key too: re-add it when you rebuild
```
Then, if you are done with it for good, delete the Google Cloud project (stops everything; kept 30 days) and the Supabase project (Settings > General > Delete project). Keep the billing account and the budget alert. Pause instead of delete: nothing to do, it costs about nothing idle; Supabase Free pauses itself after a week of no use (the worker's ticks may keep it awake).
