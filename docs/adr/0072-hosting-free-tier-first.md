# ADR 0072: hosting, free tier first (Supabase Mumbai + Google Cloud Run Mumbai)

Status: PROPOSED, for the owner's decision (job BG, 2026-10-11; **addendum of job CE, 2026-10-12, at the end: where the web runs, the domain, cookies and CORS, the Host-header question, and the rehearsal**). **Nothing is deployed, no account exists, nothing is bought.** ADR 0017 still holds: any paid dependency needs the owner's prior written approval, and the real-data gate stays closed. This ADR replaces the staging recommendation in ADR 0015 (Supabase Pro + Cloud Run, Mumbai) with a free-first plan that arrives at the same place in steps. The step-by-step is `docs/runbooks/hosting-owner-runbook.md`.
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

---

# Addendum (job CE, 2026-10-12): the web's host, the domain, cookies and CORS, and the rehearsal

Status: PROPOSED. Nothing is deployed and no account exists. Facts were read from the providers' own pages on 2026-10-12 (sources at the end); **(estimate)** means mine, to be measured in the rehearsal. The step-by-step for the owner is [`hosting-rehearsal-owner.md`](../runbooks/hosting-rehearsal-owner.md); every setting by name is [`hosting-env-and-secrets.md`](../runbooks/hosting-env-and-secrets.md).

## What reading the code and the providers changed

1. **The API has no database connection to put behind a pooler.** It reaches Supabase over HTTPS (PostgREST, Auth, Storage) with the person's own token; no Postgres driver is installed and there is no database password in any service. So "use the pooler URL for the API" is answered by "there is no URL to set", and the pooler (session mode, port 5432, over IPv4) is for the tools the owner runs by hand: migrations, backups, the restore drill. If a direct connection from Cloud Run is ever added, it must use the **transaction pooler (6543)**, because Cloud Run's egress is IPv4 and Supabase's direct address is IPv6 only without the paid add-on, and because many short-lived instances would exhaust real connections. (Details and the table: `hosting-env-and-secrets.md`.)
2. **The web image did not build.** `next build` type-checks every file, two tests import files from `/e2e` that the image rightly leaves out, and the build stopped. Fixed: the Dockerfile removes the test files before building, and now also the build cache and the development packages (1.83 GB to 1.27 GB as Docker counts it; still large for a cold start: Next's `output: "standalone"` would cut it to a fraction and is the next step if the cold start is too slow). It was built and run once on the agent machine (port 3001): `/login` answers, and **a signed-out `/app` redirects with a relative `Location: /login?next=%2Fapp` whatever `Host` or `X-Forwarded-Host` the request carried** (measured with four different headers), which makes check 1 below much less likely to fail.
3. **uvicorn trusted a forged `X-Forwarded-For`.** `deploy/Dockerfile.api` ran `--proxy-headers --forwarded-allow-ips='*'`: a request with `X-Forwarded-For: 203.0.113.77` was logged and rate-limited as that address (shown by a before-and-after run of the image). The API reads the header itself, only as far as `TRUSTED_PROXY_HOPS` says; the flags are now off, and `make container-smoke` fails if a forged header changes the caller. `deploy/cloudrun.sh` now sets `TRUSTED_PROXY_HOPS=1` (with `0` every public-route caller behind Cloud Run would share one address).
4. **The status card would have said "stopped" four minutes out of five.** The worker reports its interval to the database as 60 seconds by default; a Cloud Scheduler job every 5 minutes made "running" (last tick under three intervals old) true for 3 of every 5 minutes. `WORKER_EVERY_MINUTES` now sets the schedule and `SCHEDULER_INTERVAL_SECONDS` together.
5. **The web would have said `http://localhost:3000` in its sitemap and share pictures**: `NEXT_PUBLIC_SITE_URL` was not a build argument. It is now.
6. **Vercel Functions cap a request body at 4.5 MB** (their limits page); the catalogue photo upload goes through a Next route and the API accepts photos up to 5 MB, so a phone photo between 4.5 and 5 MB would fail on Vercel. Cloud Run's HTTP/1 limit is 32 MiB.
7. **Cloudflare's Host-header override is Enterprise-only** (their Origin Rules table: "Override Host header: Free No, Pro No, Business No, Enterprise Yes"). The older uncertainty in this ADR is closed: a Free-plan proxy cannot rewrite the Host header to a `run.app` address by rule.

## Decision: where the web runs

| Option | Cost per month (USD) | Speed for a browser in India | Fit with this app | Custom domain and the Host header | Verdict |
|---|---|---|---|---|---|
| **A. Vercel Pro** | 20 per paid seat (1 seat), includes 20 of usage; Hobby is "non-commercial, personal use only" | Functions can run in Mumbai (`bom1`); the CDN has 126 points of presence (I could not confirm which Indian cities) | **4.5 MB request cap breaks a 4.5 to 5 MB photo upload** unless the browser shrinks photos first (a change to build). Ask streaming is fine (up to 800 s on Pro). Another vendor, another bill, another set of variables | Custom domain is native; the Host header is the browser's | Good product, wrong fit today. Second fallback |
| **B. Cloud Run (Mumbai) on its own `run.app` address** | about 0 scale-to-zero, about 8 with a warm instance | Mumbai to Mumbai for the API calls; a browser in India reaches Mumbai in tens of ms (estimate) | Everything works (32 MiB bodies, 60-minute requests, same platform as the API) | No custom domain; the Host header is Google's own, so nothing to break | **The rehearsal, and acceptable for the first weeks of Customer Zero** |
| **C. Cloud Run behind Cloudflare Free, proxy by Origin Rule (Host override)** | 0 | Cloudflare has data centres in at least 12 Indian cities as of 2022 (their blog; check cloudflare.com/network) | Same as B | **Not possible: the Host-header override is Enterprise-only.** Without it Cloud Run answers a foreign Host with an error | Rejected |
| **D. Cloud Run behind Cloudflare Free, proxy by a Worker that forwards to the `run.app` address** | 0 (Workers Free: 100,000 requests a day, 1,000 a minute burst, 10 ms CPU a request not counting waiting for the origin) | As C; static files are not cached by the Worker unless it asks to be | Same as B, if the app copes with the Host it receives (below) | The Worker's request reaches Cloud Run with the `run.app` Host, so the app sees the wrong host unless it reads `X-Forwarded-Host`. **Unproven: the rehearsal decides** | **Recommended for the custom domain, only if it passes the six checks below** |
| **E. Cloud Run behind Google's global external Application Load Balancer** (Cloudflare used only for DNS, grey cloud) | about 18 plus traffic | Google's edge terminates TLS close to the user (estimate) | Same as B; one domain for web and API with host rules | Documented route for Cloud Run in Mumbai; the Host header reaches the app unchanged | **The fallback** |

**Recommendation: the web on Cloud Run in Mumbai (B), as the rehearsal and the first stage, with the custom domain by D if the rehearsal proves it and by E if it does not.** Reasons: the app works on Cloud Run as it stands (no 4.5 MB cap), it is one platform and one bill with the API and the worker, it costs about nothing while idle, and the Cloudflare question is answered by an experiment that costs nothing (a Cloudflare Free account needs no card). Vercel is not chosen because of the body cap and the extra seat; if photos are later shrunk in the browser it becomes a reasonable alternative.

### The Host-header question: what must be proved, not assumed

The app builds absolute redirects from the Host it receives (`proxy.ts`: `new URL("/login", request.url)`), its Server Actions compare the request's `Origin` with the Host (or `X-Forwarded-Host`), and `fromThisSite` accepts a browser's `Sec-Fetch-Site: same-origin` first and otherwise compares `Origin` with `Host`. A proxy that changes the Host therefore risks: a sign-in redirect to the `run.app` address (the cookie, being host-only, is then lost), a refused Server Action, a refused upload. **The rehearsal proves all of it for option D with six checks** (the first is automatic in `make hosted-smoke`, and `make hosted-smoke` was run for real against the agent stack's API and web, where its only FAILs were the four development-mode items it exists to catch):
1. a signed-out `GET /app` redirects to `/login` **on the public host**, not to `run.app`;
2. the sign-in works through the public address, and the session cookie is host-only on `app.<domain>`;
3. a Server Action (create a workspace; save a setting) succeeds;
4. a 4 MB file upload (a catalogue photo) succeeds;
5. an Ask answer streams without being cut (**not testable in the rehearsal**: the assistant is off without a paid model key; the Worker passes the answer through as it arrives, so this is an expectation to confirm at stage 2);
6. a request with a forged `Host` or `X-Forwarded-Host` of another site does not change the redirect target.
If 1 to 3 fail and the cause is the Host, there is a contained code fix (build the redirect from `NEXT_PUBLIC_SITE_URL` instead of the request) that is not made now, because it would change behaviour on every local port; the decision is the owner's after the evidence. If anything fails, use E.

## Decision: cookies and CORS with `app.<domain>` and `api.<domain>`

* **The browser talks to `app.<domain>` only.** Every browser request is same-origin (`credentials: "same-origin"`), and the page's Content-Security-Policy has `connect-src 'self'`, so even a bug could not make the browser call `api.<domain>`.
* **The web server calls the API** with the person's access token in an `Authorization: Bearer` header. No cookie is sent to the API. A test reads the web source and fails on `credentials: "include"`, on the API address being read outside `lib/`, and on a cookie in the API client.
* **The session cookie is host-only** on `app.<domain>`: `HttpOnly`, `Secure` (production), `SameSite=Lax`, path `/`, and **no `Domain` attribute**: `hardenCookieOptions` now deletes one if it is passed. `app.` and `api.` are the *same site* (one registrable domain), so SameSite does not separate them; being host-only does. A cookie with `Domain=<domain>` would also go to `api.<domain>` and to any other subdomain, which could read or overwrite it.
* **The API sets no cookie and reads none** as a credential (a request with only a session cookie is a 401).
* **CORS:** `API_CORS_ORIGINS=https://app.<domain>`, exactly one origin, https, no path, never `*`, never with credentials, methods GET/POST/PATCH/PUT, headers `Authorization` and `Content-Type`. It is a fence: today nothing needs it. Leaving it empty is also correct; `scripts/verify_hosted.py` expects the web's origin and `hosted_smoke.py` accepts either. Tests cover the origin matrix (the web, the API's own host, a sibling subdomain, a lookalike, http, a port).
* **Supabase Auth:** Site URL `https://app.<domain>`; the redirect allow-list holds only `https://app.<domain>/auth/confirm`.
* **`api.<domain>` is optional** until a provider needs a stable callback address (Meta, a payment gateway); the web reaches the API at its `run.app` address in the meantime.

## Containers (built and run locally on the agent stack by `make container-smoke`)

One image runs the API (default command) and the worker (`python -m app.scheduler.worker --once`, a Cloud Run job started by Cloud Scheduler). about 70 MB to pull (329 MB unpacked on disk); numeric user 10001; `HEALTHCHECK` on `/health`; `exec uvicorn` so it is process 1 and receives SIGTERM; `--timeout-graceful-shutdown 8` (Cloud Run waits 10 seconds); stopped in about a second with exit code 0 in the test; refuses to start outside development without its settings; `/ready` reaches the agent stack's database; the worker image completes a tick and its heartbeat reaches the database. The web image (1.27 GB as Docker counts it) was also built and run once: it answers `/login`, runs as the unprivileged `node` user, and stops on SIGTERM (exit code 143, the signal's own). A mid-tick SIGTERM to a `--once` worker ends the process at once: safe, because every message is handed out under a row lock and a lease, and the next tick (5 minutes later) picks the work up.

## Open, for the rehearsal to answer

The cold start (measure: first request after 15 idle minutes); whether option D passes the six checks; `TRUSTED_PROXY_HOPS` behind a proxy (1 direct on Cloud Run; more behind Cloudflare or a load balancer); whether the billing alert in the owner's currency behaves as described; the Cloudflare Worker's request count for a normal day; Google Cloud's sign-up for an individual versus a company in India (the screens decide; the runbook marks every step that asked for a card or a company).

## Sources (read 2026-10-12)

* Cloudflare Origin Rules (plans and the Host-header override): https://developers.cloudflare.com/rules/origin-rules/ · Workers limits: https://developers.cloudflare.com/workers/platform/limits · India data centres: https://blog.cloudflare.com/new-cities-april-2022-edition
* Vercel Functions limits (4.5 MB body, durations): https://vercel.com/docs/functions/limitations · regions (`bom1`, 126 points of presence): https://vercel.com/docs/regions · Hobby is non-commercial and Pro is 20 per seat: https://vercel.com/pricing (third-party summaries agreed; read the page on the day)
* Cloud Run domain mappings (Preview; `asia-south1` not supported; recommends the load balancer): https://docs.cloud.google.com/run/docs/mapping-custom-domains · quotas (32 MiB HTTP/1 request): https://docs.cloud.google.com/run/quotas · `gcloud run deploy` flags (startup probe): https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy
* Supabase connection modes (direct is IPv6, session 5432, transaction 6543, no prepared statements in transaction mode): https://supabase.com/docs/guides/database/connecting-to-postgres
