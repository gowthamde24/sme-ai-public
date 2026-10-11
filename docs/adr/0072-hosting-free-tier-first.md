# ADR 0072: hosting, free tier first (Supabase Mumbai + Google Cloud Run Mumbai)

Status: PROPOSED, for the owner's decision (job BG, 2026-10-11). **Nothing is deployed, no account exists, nothing is bought.** ADR 0017 still holds: any paid dependency needs the owner's prior written approval, and the real-data gate stays closed. This ADR replaces the staging recommendation in ADR 0015 (Supabase Pro + Cloud Run, Mumbai) with a free-first plan that arrives at the same place in steps. The step-by-step is `docs/runbooks/hosting-owner-runbook.md`.
Facts below were read from the providers' own pages on 2026-10-11 (sources at the end). Anything marked **(estimate)** is mine, not the provider's, and is to be measured in staging.

## Context

An India-based family shop (Customer Zero, then other SMEs). The users are in India, on phones, and the people are not engineers. We need: Postgres + Auth + Storage (Supabase), the Python API, the Next.js web, and a small scheduler process, with: low latency to India, as little money as possible until real data arrives, no cold-start surprises for a shopkeeper, and a bill that stays predictable when we outgrow the free limits.

## Decision

1. **Supabase, region Mumbai (`ap-south-1`).** Start on the **Free** plan with synthetic data only. **Upgrade to Pro (USD 25 a month) before the real-data gate is opened**, not later. Free is for rehearsal, not for customers (reasons below).
2. **API and web on Google Cloud Run, region `asia-south1` (Mumbai).** Both from the Dockerfiles that already exist. Scale to zero while the app is a rehearsal; one warm instance each (about USD 8 a month each) when a real person depends on it. One platform, one bill, one set of tools, same region as the database.
3. **The scheduler worker as a Cloud Run *job* started by Cloud Scheduler** (`python -m app.scheduler.worker --once`, every 5 minutes, or every minute), not as an always-on process. It costs nothing while it waits.
4. **Backups:** Free has none, so `deploy/backup-db.sh` (a `pg_dump` the owner runs, password typed hidden) is the safety net until Pro; Pro adds 7 daily backups, and the restore drill (`backup-restore-drill.md`) is run before the gate opens.
5. **Domain and HTTPS:** staging uses the free HTTPS `*.run.app` addresses. A custom domain on Cloud Run in Mumbai has no simple free path (see risks); the recommended way is a global external Application Load Balancer (about USD 18 a month plus a little traffic) in front of web and API under one domain, which also puts both on one site (no CORS, same cookies). Decide this when the shop wants its own address, not before.
6. **Agents stay off hosted until the owner decides.** Agent runs execute in threads inside the API process and stall when Cloud Run throttles the CPU between requests; turning them on means CPU always allocated (about USD 44 a month for the API, see below). Until then `AGENTS_ENABLED=false` and the app is request/response only.

## Why this and not the others

| Option | What I found | Verdict |
|---|---|---|
| **Supabase Free** | 500 MB database, 1 GB files, 5 GB egress, 50,000 MAU, 2 projects, **no backups**, **paused after a week of low activity**; shared CPU, 500 MB RAM. Supabase's built-in sender allows only about 2 e-mails an hour (custom SMTP is needed for invitations). Leaked-password protection and session time-boxing are Pro. | Right for a synthetic rehearsal (and a second free project for the restore drill). **Not for real customers' data.** |
| **Supabase Pro** | USD 25 a month; 8 GB database then USD 0.125/GB; 100 GB files; 250 GB egress; daily backups for 7 days; never paused; USD 10 compute credit covers one Micro instance. Mumbai is a listed region. | The floor for Customer Zero. |
| **Cloud Run, Mumbai** | `asia-south1` is **Tier 1** pricing (Delhi, `asia-south2`, is Tier 2). Free every month: 2 million requests, 180,000 vCPU-seconds, 360,000 GiB-seconds (request-based); 240,000 vCPU-s and 450,000 GiB-s (instance-based). Scale to zero. A warm idle instance bills CPU at a tenth of the active rate. | **Chosen.** |
| Render | Free web service sleeps after 15 minutes and takes about a minute to wake; no India region (Oregon, Ohio, Virginia, Frankfurt, Singapore); free Postgres expires after 30 days. | No: the wake-up alone fails a shopkeeper test. |
| Fly.io | No free tier for new organisations (a 2-hour/7-day trial); a small machine is about USD 2 to 4 a month in the cheapest US regions; outbound traffic to India costs USD 0.12/GB. I could not confirm a Mumbai region on its pricing page. | Possible later for an always-on process if Cloud Run's CPU-always price hurts; confirm the region first. |
| Vercel Hobby (web) | Free, but **"non-commercial, personal use only"**. Pro is USD 20 per developer seat per month. | No: Customer Zero is a business. |
| Cloudflare Workers (web) | Free plan: 100,000 requests a day and **10 ms CPU per request**; paid from USD 5 a month. Running this Next.js app there needs an adaptation layer I have not tested. | No for now; it is the thing to evaluate if Cloud Run's web cost ever matters. |
| Oracle Cloud Always Free VM | A genuinely free VM, but idle instances can be reclaimed, ARM capacity in a given region is not guaranteed, and we would run the box ourselves (patches, TLS, restarts). | Not for a family business without an operator. |

## Latency, cold starts and cost

* **Latency (estimate, to be measured):** Cloud Run and Supabase in the same Mumbai region should make the API's database calls a few milliseconds; a browser in an Indian city reaches Mumbai in tens of milliseconds. A Singapore or Frankfurt host adds a long hop on every page and every database call.
* **Cold start (estimate, to be measured):** a scaled-to-zero Python or Node container takes a couple of seconds to answer its first request. Measure it in staging (`curl -w '%{time_total}'` after 15 idle minutes). If it is too slow for the shop, set `--min-instances 1`: Cloud Run bills a warm idle instance at USD 0.0000025 per vCPU-second and per GiB-second, which for 1 vCPU + 0.5 GiB is about **USD 8 a month** per service (2,592,000 s in a 30-day month: USD 6.48 for the CPU + USD 1.62 for the memory).
* **Agents on (CPU always, instance-based):** 1 vCPU + 0.5 GiB for a month, less the 240,000 vCPU-s and 450,000 GiB-s free: (2,592,000 − 240,000) × 0.000018 = USD 42.3, plus (1,296,000 − 450,000) × 0.000002 = USD 1.7, **about USD 44** (USD 49 if the free amount is already used up elsewhere). ADR 0015 said USD 54; this uses the current price and the free amount.

| Stage | What runs | Monthly cost (USD, before tax and the model's own usage) |
|---|---|---|
| **0. Rehearsal** (synthetic data) | Supabase Free, Cloud Run scale-to-zero (API, web), worker job, `run.app` addresses | **about 0** (a few cents of image storage) |
| **1. Customer Zero** (real data, agents off) | Supabase Pro 25; API and web scale-to-zero **or** one warm instance each (+8 each); worker job; custom SMTP on a free plan | **25 to 41** |
| 1b. + own domain | + global load balancer about 18 (+ the domain, about a year's fee) | 43 to 59 |
| **2. Agents on** | + API with CPU always (+44, replacing its +8); the model provider's usage (capped by the workspace allowance and the provider-side hard cap) | about 70 to 110 |
| **3. Outgrown** | Supabase: disk beyond 8 GB at 0.125/GB, a bigger compute add-on; Cloud Run grows with requests (USD 0.40 per million past 2 million); the free amounts are shared by every service on the billing account | grows with use; Supabase compute is the first thing to change |

## Consequences and risks (honest list)

* **Free Supabase pauses.** A project with little database activity for a week may be paused; the owner restores it from the dashboard. The scheduler job's ticks may keep it awake, but that is not a promise. Another reason Stage 0 is synthetic only.
* **No backups on Free.** Until Pro, the only copy is the database itself plus the owner's own `backup-db.sh` dumps. This is why Pro comes before the gate (ADR 0015's four prerequisites include a restore drill).
* **Custom domains in Mumbai.** Cloud Run domain mappings are a **Preview** feature, "not recommended for production", and **`asia-south1` is not on the supported-region list.** Firebase Hosting rewrites do support `asia-south1`, but I have not verified how it treats the cookies Supabase's sign-in uses, so it is not recommended without a test. A Cloudflare free-plan proxy in front of `run.app` needs the Host header rewritten, which an older Cloudflare plan table lists as Enterprise-only (I could not confirm the current rule); a small Cloudflare Worker that forwards requests is an option to test, not a recommendation. The load balancer is the documented route.
* **The deploy script had a gap, now closed:** `SUPPRESSION_HMAC_KEY` (T010) is required outside development and was not passed by `deploy/cloudrun.sh`, so the API would not have started. The script now takes it from Secret Manager (`deploy/cloudrun.sh secrets` generates it and never shows it).
* **No real send channel exists** (`OUTBOX_ADAPTER` accepts only `fake`), so the hosted worker sends nothing to anyone; the owner sends from the phone using the WhatsApp link. Real sending is a separate decision (WhatsApp provider, consent, cost).
* **Nothing here was run.** The scripts are dry-run by default; the first `--execute` will find the mistakes that paper cannot. The restore drill, the erasure timing test and the cold-start measurement are staging tasks.
* **Pricing changes.** Prices and limits were read on 2026-10-11 and move; re-read them on the day each step is done (the runbook says where).

## Sources (read 2026-10-11)

* Supabase pricing: https://supabase.com/pricing · regions (Mumbai `ap-south-1`): https://supabase.com/docs/guides/platform/regions · backups and PITR: https://supabase.com/docs/guides/platform/backups · production checklist (pausing, SMTP, SSL): https://supabase.com/docs/guides/deployment/going-into-prod · pausing: https://supabase.com/docs/guides/platform/free-project-pausing
* Cloud Run pricing: https://cloud.google.com/run/pricing · region tiers (`asia-south1` Tier 1): https://docs.cloud.google.com/run/docs/locations · minimum instances: https://docs.cloud.google.com/run/docs/configuring/min-instances · custom domains (Preview, region list): https://docs.cloud.google.com/run/docs/mapping-custom-domains · jobs on a schedule: https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule · Firebase Hosting to Cloud Run regions: https://firebase.google.com/docs/hosting/cloud-run
* Cloud Scheduler pricing (3 free jobs per billing account, then USD 0.10 per job a month): https://cloud.google.com/scheduler/pricing · Load Balancing pricing (a global forwarding rule is USD 0.025 an hour for the first five): https://cloud.google.com/load-balancing/pricing
* Render free tier: https://render.com/docs/free · regions: https://render.com/docs/regions
* Fly.io pricing: https://docs.fly.io/about/pricing
* Vercel Hobby: https://vercel.com/docs/plans/hobby
* Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/ · Origin Rules (Host header override): https://developers.cloudflare.com/rules/origin-rules/
* Oracle Always Free (idle reclaim): https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
* Third-party summaries used only for the free e-mail plans (verify on the vendors' pages before relying on them): Brevo 300 e-mails a day; Resend 3,000 a month and 100 a day.
