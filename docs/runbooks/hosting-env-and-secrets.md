# Hosted settings: every variable and secret, by name (job CE)

**Names only: no value is in this file, and none may be.** Where each is set depends on the host (Google Cloud Run: [Secret Manager](https://cloud.google.com/run/docs/configuring/services/secrets) for secrets, plain environment variables for the rest; Vercel: Project settings > Environment Variables, marked Sensitive). The settings are read by `services/ai-api/app/config.py` (the API and the worker) and `apps/web` (the web). A test (`tests/test_ce_hosting_files.py`) fails when a setting exists in the code and is missing here, or is a secret there and plain here. Read with [ADR 0072](../adr/0072-hosting-free-tier-first.md) and [`hosting-rehearsal-owner.md`](hosting-rehearsal-owner.md).

**Kinds.** `secret`: server side only; Secret Manager (or the host's secret store); typed hidden; never in a file, a chat, a screenshot or a command line. `plain`: not secret (an address, a switch, a number, a public key); it may be seen. A public key that reaches the browser (the Supabase publishable key, the VAPID public key) is `plain` on purpose.

## The API and the worker are the same image

`deploy/Dockerfile.api` builds one image. Cloud Run runs it as the **service** `sme-api` (the default command) and as the **job** `sme-worker` (`python -m app.scheduler.worker --once`, started by Cloud Scheduler). The tables say which of the two reads each setting (`api`, `worker` or both). A setting the worker does not read is simply ignored there, so giving the worker the whole set would be harmless but is not least privilege: `deploy/cloudrun.sh` gives it only the Supabase settings, the suppression key and its own account.

## The database connection: there is none to set, and why (read this before looking for a pooler URL)

The API and the worker **do not open a Postgres connection**. Every read and write goes over HTTPS to Supabase (`SUPABASE_URL/rest/v1`, `/auth/v1`, `/storage/v1`) with the signed-in person's own token, so row-level security always applies and there is no database password anywhere in the API (`app/config.py` has none; no Postgres driver is installed). Supabase's API gateway keeps and pools its own database connections behind that address. So the answer to "which pooler URL does the API use" is: **none, and that is deliberate**: nothing can leak a database password from the API, and the number of connections does not grow with Cloud Run's instances.

The pooler URL (Supabase > Connect) matters only for the tools you run by hand, which DO connect to Postgres:

| Tool | Connection | Why |
|---|---|---|
| `supabase link` + `supabase db push` (migrations), `deploy/backup-db.sh`, the restore drill, `HOSTED_DATABASE_URL` for `verify_hosted.py` | **session pooler**: `postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres` | Supabase's direct address (`db.<ref>.supabase.co`) is **IPv6 only** unless the paid IPv4 add-on is on, and many home networks and **Cloud Run (IPv4 egress by default)** cannot reach it. The session pooler works over IPv4 and supports everything `pg_dump` and migrations need (prepared statements, long sessions). Copy the exact host from the Connect dialog: it cannot be built from the region. |
| **Any future code in the API or the worker that talks to Postgres directly** (none today) | **transaction pooler**: port **6543**, with prepared statements turned off | Cloud Run starts many short-lived instances, each of which would open its own connections; the transaction pooler shares a small number of real connections between them, and it is the IPv4 path. Using the direct address from Cloud Run would fail on IPv6 or exhaust connections. A new setting for it would be a secret (`DATABASE_URL`, Secret Manager) and needs its own ADR: it would also bypass row-level security if used as the `postgres` role. |

The password of the database is typed hidden into those tools; it is never an environment variable of any service.

## A. Always set on the hosted API (and, where marked, the worker): set by `deploy/cloudrun.sh`

The script writes these from the public values you export for one run. Nothing here is secret.

| Variable | Kind | Read by | Value or when to set it |
|---|---|---|---|
| `API_ENV` | plain | api, worker | `production`. Anything else than exactly `development` makes the process refuse to start unless the settings below are complete and https. |
| `SUPABASE_URL` | plain | api, worker | `https://<project ref>.supabase.co` (Supabase > Project settings > API). Every database, sign-in and file call goes through this address. |
| `SUPABASE_PUBLISHABLE_KEY` | plain | api, worker | The publishable (formerly anon) key. Public by design; it grants nothing without a person's token. NEVER the secret or service-role key: nothing here uses one. |
| `SUPABASE_ANON_KEY` | plain | api, worker | The legacy name of the same public key. Leave unset; the new name wins when both are set. |
| `SUPABASE_JWT_ISSUER` | plain | api, worker | `<SUPABASE_URL>/auth/v1`. |
| `SUPABASE_JWT_AUDIENCE` | plain | api, worker | `authenticated`. |
| `SUPABASE_JWKS_URL` | plain | api, worker | `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (the public signing keys; no secret). |
| `SUPABASE_JWT_ALGORITHMS` | plain | api, worker | `ES256` (Supabase's asymmetric signing keys; hosted-auth-settings.md). |
| `SUPABASE_JWT_SECRET` | secret | api | Only if you still use the legacy HS256 shared secret AND list `HS256` above. Do not: use ES256. If ever needed: Secret Manager, 32+ characters. |
| `API_CORS_ORIGINS` | plain | api | Exactly the web's address, `https://app.<domain>` (no path, no `*`). The browser never calls the API (the web server does), so this is a fence for a future direct call, not a need. See "Cookies and CORS" in ADR 0072. |
| `AGENTS_ENABLED` | plain | api | `false` for the rehearsal and the first pilot. `true` only together with `CPU_ALWAYS=true` (the script refuses otherwise) and a model provider (section C). |
| `TRUSTED_PROXY_HOPS` | plain | api | `1` on Cloud Run (the script's default): the one proxy that writes `X-Forwarded-For` is Google's. Behind Cloudflare or a load balancer it is more (2 or 3): measure in the rehearsal. `0` would make every public-route caller look like Google's front end. Used for rate limits and logs only. |
| `LOG_FORMAT` | plain | api, worker | `json`: one line per request, readable by Cloud Logging. No name, phone or e-mail is ever in a log line. |
| `OUTBOX_ADAPTER` | plain | worker | `fake` in the rehearsal and Customer Zero until WhatsApp is connected (`whatsapp` is the real adapter, section D). The script sets `fake` on the worker. |
| `SCHEDULER_EMAIL` | plain | worker | The scheduler's own account (docs/runbooks/hosting-owner-runbook.md Part B). An address, not a secret. |
| `SCHEDULER_INTERVAL_SECONDS` | plain | worker | `WORKER_EVERY_MINUTES` x 60 (300 for every 5 minutes), set by the script. It MUST match the Cloud Scheduler schedule: the status card says the worker is running while its last tick is under three intervals old. |

## B. Secrets that every hosted deployment needs (Secret Manager)

Created by `./deploy/cloudrun.sh secrets` (the suppression key is generated and never shown; the scheduler password is typed hidden). Passed to Cloud Run as secret references (`--set-secrets NAME=secret:latest`), never as plain values.

| Variable | Kind | Read by | Value or when to set it |
|---|---|---|---|
| `SUPPRESSION_HMAC_KEY` | secret | api, worker | Secret `sme-suppression-hmac-key`. Required outside development: the API refuses to start without it. Turns an e-mail or phone number into a key that survives erasure. Never rotate by replacing it: use the `_PREVIOUS` settings below. |
| `SCHEDULER_PASSWORD` | secret | worker | Secret `sme-scheduler-password`. The password of the scheduler account; typed hidden. |
| `SUPPRESSION_HMAC_KEY_VERSION` | plain | api, worker | `1`; raised by one when the key is rotated. |
| `SUPPRESSION_HMAC_KEY_PREVIOUS` | secret | api, worker | Only during a rotation: the old key, kept so old keys still match (matching only). |
| `SUPPRESSION_HMAC_KEY_PREVIOUS_VERSION` | plain | api, worker | Only during a rotation: the old key's version. |

## C. Optional on the API: switch on one at a time, each with its own approval

Off or fake by default. The rehearsal sets none of them. A provider named without its key stops the process at start (so a half-configured feature cannot run). Secrets go to Secret Manager and are added to the deploy with `EXTRA_SECRETS=NAME=secret:latest[,NAME2=secret2:latest]`; plain values are added with `--update-env-vars`.

| Variable | Kind | Read by | Value or when to set it |
|---|---|---|---|
| `METRICS_TOKEN` | secret | api | Unset = `/metrics` answers 404 to everyone (the default). Set it only if you will scrape the counters; then `Authorization: Bearer <it>`. |
| `RATE_LIMIT_ENABLED` | plain | api | `true` (default). Leave on. The limits live in one instance's memory: with two instances each keeps its own count (ADR 0082). |
| `EXPOSE_API_DOCS` | plain | api | `false` (default outside development): `/docs`, `/redoc`, `/openapi.json` answer 404. `hosted-smoke` checks it. |
| `LLM_PROVIDER` | plain | api | `fake` is refused outside development. With agents on: `anthropic`, `openai`, `gemini` or another named in ADR 0013 and the bake-off. |
| `LLM_MODEL` | plain | api | No default: the owner chooses it from the bake-off. |
| `ANTHROPIC_API_KEY` | secret | api | Only with `LLM_PROVIDER=anthropic`. Create the key WITH a hard monthly cap at the provider first. |
| `OPENAI_API_KEY` | secret | api | Only with `LLM_PROVIDER=openai`. |
| `GEMINI_API_KEY` | secret | api | Only with the Gemini provider. |
| `LLM_API_KEY` | secret | api | Only for the free hosted tiers allowed in development; not used in a deployment. |
| `LLM_BASE_URL` | plain | api | Local OpenAI-compatible server (Ollama) in development only; refused for a hosted address outside the allow-list. |
| `ANTHROPIC_BASE_URL` | plain | api | Default `https://api.anthropic.com`; change only for a proxy you run. |
| `LLM_INPUT_MICROS_PER_MTOK` | plain | api | The model's input price, from the provider's price list (millionths of the billing currency per million tokens). |
| `LLM_OUTPUT_MICROS_PER_MTOK` | plain | api | The model's output price, likewise. |
| `LLM_SPEND_CAP_CONFIRMED` | plain | api | `true` ONLY after the provider-side hard cap exists. The first real call is refused without it. |
| `LLM_LIGHT_MODEL` | plain | api | Optional cheaper model used after a workspace has used its allowance (ADR 0064). |
| `LLM_LIGHT_INPUT_MICROS_PER_MTOK` | plain | api | Its input price. |
| `LLM_LIGHT_OUTPUT_MICROS_PER_MTOK` | plain | api | Its output price. |
| `AGENTS_MAX_WORKERS` | plain | api | Agent runs in parallel inside one instance (default 2). Agents need CPU always allocated (ADR 0072). |
| `AGENTS_MAX_QUEUE` | plain | api | Runs waiting (default 8). |
| `RESEARCH_FIXTURE_DIR` | plain | api | Development only (synthetic sites on disk). Never set on a deployment. |
| `SARVAM_API_KEY` | secret | api | Only for voice or Hindi/Indic models through Sarvam. |
| `VOICE_STT_PROVIDER` | plain | api | `off` (default). Speech to text: `sarvam`, `bhashini`, `google`, `ai4bharat`. |
| `VOICE_TTS_PROVIDER` | plain | api | `off` (default). Text to speech. |
| `SARVAM_STT_MODEL` | plain | api | Default `saaras:v4`. |
| `SARVAM_TTS_MODEL` | plain | api | Default `bulbul:v3`. |
| `SARVAM_TTS_SPEAKER` | plain | api | Optional speaker name. |
| `BHASHINI_API_KEY` | secret | api | Only with Bhashini voice. |
| `BHASHINI_ASR_SERVICE_ID` | plain | api | Bhashini's service id for speech to text. |
| `BHASHINI_TTS_SERVICE_ID` | plain | api | Bhashini's service id for text to speech. |
| `GOOGLE_API_KEY` | secret | api | Only with Google voice. |
| `AI4BHARAT_STT_URL` | plain | api | An address you run yourself (not in the plan). |
| `AI4BHARAT_TTS_URL` | plain | api | Likewise. |
| `AI4BHARAT_TOKEN` | secret | api | Likewise. |
| `WEB_SEARCH_PROVIDER` | plain | api | `off` (default) | `tavily` | `brave`. Web research for the assistant (ADR 0078). |
| `TAVILY_API_KEY` | secret | api | Only with `tavily`. |
| `BRAVE_SEARCH_API_KEY` | secret | api | Only with `brave`. |
| `PLACES_PROVIDER` | plain | api | `off` (default) | `google`. The Find retailers map search. Google Places is billed per request: set the quota and a budget alert at Google first. |
| `GOOGLE_PLACES_API_KEY` | secret | api | Only with `google`. Restrict the key to the Places API (New) in Google Cloud. |
| `PLACES_FIELD_TIER` | plain | api | `pro` (name, address, link; default) or `ids` (place ids only, the free tier). |
| `METALS_PROVIDER` | plain | api | `off` (default) | `metals_dev`. Gold and silver reference prices. |
| `METALS_DEV_API_KEY` | secret | api | Only with `metals_dev`. |
| `WEB_FETCH` | plain | api | `off` (default) | `real` (the guarded page reader: robots.txt, no private addresses, size and time limits). |

## D. Optional: channels and connectors (each off until named)

None is part of the rehearsal. The webhook addresses these providers call are `https://api.<domain>/v1/webhooks/...`: they need the API's stable public address (`PUBLIC_BASE_URL`).

| Variable | Kind | Read by | Value or when to set it |
|---|---|---|---|
| `PUBLIC_BASE_URL` | plain | api | `https://api.<domain>`: the address providers call back (payment and call webhooks). |
| `WHATSAPP_API_BASE` | plain | api | Default `https://graph.facebook.com`. |
| `WHATSAPP_GRAPH_VERSION` | plain | api | Default `v25.0` (from Meta's documentation of 2026-10-12; check before use). |
| `WHATSAPP_APP_SECRET` | secret | api | Meta's app secret: signs every webhook. Without it the webhook answers 401. |
| `WHATSAPP_VERIFY_TOKEN` | secret | api | The phrase you type into Meta's webhook page. |
| `WHATSAPP_ACCESS_TOKEN` | secret | api | A PERMANENT system-user token for production (the test number's token lasts a day). |
| `WHATSAPP_ACCESS_TOKENS` | secret | api | A JSON object `{token_ref: token}` when workspaces have their own numbers. |
| `CHANNEL_AGENT_EMAIL` | plain | api | The registered account the API signs in as to hand a webhook to the database (belongs to no workspace). |
| `CHANNEL_AGENT_PASSWORD` | secret | api | Its password. |
| `PACKS_DIR` | plain | api | Where `packages/packs` lives. Unset is right in the container image (`/srv/packages/packs`, set by the Dockerfile) and in a checkout. `GET /v1/packs` serves the sign-up cards from it. |
| `AUTH_GOOGLE_CLIENT_ID` | plain | api | The PUBLIC Google client id. Set only when Google sign-up is turned on in Supabase Auth (docs/runbooks/social-sign-up.md); unset = the button is not offered. The secret lives in Supabase, never here. |
| `AUTH_FACEBOOK_APP_ID` | plain | api | The PUBLIC Facebook app id, same rule. |
| `INTEGRATIONS_TENANT_ID` | plain | api | The ONE workspace the installation's connector credentials belong to. |
| `INDIAMART_PROVIDER` | plain | api | `off` (default) | `fake` | `real`. |
| `INDIAMART_CRM_KEY` | secret | api | Only with `real`. |
| `PAYMENTS_PROVIDER` | plain | api | `off` (default) | `fake` | `razorpay` | `cashfree`. |
| `RAZORPAY_KEY_ID` | plain | api | An identifier, not a secret (but keep it private). |
| `RAZORPAY_KEY_SECRET` | secret | api | Only with `razorpay`. |
| `RAZORPAY_WEBHOOK_SECRET` | secret | api | Only with `razorpay`. |
| `CASHFREE_CLIENT_ID` | plain | api | An identifier, not a secret. |
| `CASHFREE_CLIENT_SECRET` | secret | api | Only with `cashfree`. |
| `CASHFREE_ENV` | plain | api | `sandbox` (default) | `production`. |
| `CALLS_PROVIDER` | plain | api | `off` (default) | `fake` | `exotel`. |
| `EXOTEL_SID` | plain | api | Exotel account id. |
| `EXOTEL_API_KEY` | plain | api | Exotel's key id (the token below is the secret half). |
| `EXOTEL_API_TOKEN` | secret | api | Only with `exotel`. |
| `EXOTEL_SUBDOMAIN` | plain | api | Default `api.in.exotel.com`. |
| `EXOTEL_CALLER_ID` | plain | api | The ExoPhone number shown to the customer. |
| `EXOTEL_AGENT_NUMBER` | plain | api | The shop's own phone, rung first. |
| `EXOTEL_WEBHOOK_TOKEN` | secret | api | The secret in the webhook addresses. |
| `MISSED_CALL_REPLY_LANGUAGE` | plain | api | Default `en`. |
| `VAPID_PRIVATE_KEY` | secret | api, worker | Web-push (job BY): off until BOTH keys are set. Generate once; typed hidden. |
| `VAPID_PUBLIC_KEY` | plain | api, worker | The matching public key (reaches the browser). |
| `VAPID_SUBJECT` | plain | api, worker | `mailto:<an address you read>`. |

## E. Policy versions (public text settings)

Change only when the published terms or privacy notice change.

| Variable | Kind | Read by | Value or when to set it |
|---|---|---|---|
| `TERMS_VERSION` | plain | api | Default `2026-10-01`. |
| `PRIVACY_VERSION` | plain | api | Default `2026-10-01`. |
| `TERMS_EFFECTIVE_FROM` | plain | api | A date; empty = at once. |
| `PRIVACY_EFFECTIVE_FROM` | plain | api | A date; empty = at once. |
| `POLICY_ENFORCE` | plain | api | `false` until the first real version change is published. |

## The web (Cloud Run or Vercel)

The web has **no server secret**: everything it needs is public. The `NEXT_PUBLIC_*` values are fixed when the web is BUILT (changing one means building again: `deploy/cloudrun.sh web` passes them as build arguments; on Vercel they are project variables present at build). They reach the browser's bundle, so they are public by design. Real secrets (the person's session) live in an HttpOnly cookie that belongs to the web's own address only.

| Variable | Kind | Set at | Value or when to set it |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | plain | BUILD | `https://api.<domain>`: where the web SERVER calls the API. Required in production (the build's server refuses without it). Read only in `lib/api/client.ts`; the browser never uses it. |
| `NEXT_PUBLIC_SUPABASE_URL` | plain | BUILD | `https://<ref>.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | plain | BUILD | The public publishable key (reaches the browser by design). The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still read. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | plain | BUILD | Legacy name of the same key; leave unset. |
| `NEXT_PUBLIC_SITE_URL` | plain | BUILD | `https://app.<domain>`: the address the pages are served from (sitemap, share pictures). Without it the build says `http://localhost:3000`. |
| `NEXT_PUBLIC_SITE_LIVE` | plain | BUILD | `0`/unset until the public launch: every page says noindex and robots.txt turns crawlers away. `1` is the launch switch. |
| `SIGNUP_MAX_PER_HOUR` | plain | RUN | Default 5. A brake in one server instance's memory. |
| `TZ` | plain | RUN | Optional `Asia/Kolkata`. The screens format times in India time explicitly, so it is a belt, not a need. |
| `PUBLIC_LAUNCH_REQUIRES_REVIEWED` | plain | BUILD | Optional. Set to `1` on the build to FAIL it while any translation is still a draft (the owner's launch gate). |
| `NODE_ENV` | plain | RUN | `production`, set by `next start` and the Dockerfile. It makes the session cookie `Secure`. |

## How each is set on Google Cloud Run

* **Plain values:** `--set-env-vars NAME=value,...` (the script does this from your shell for one run). Change one later with `gcloud run services update sme-api --update-env-vars NAME=value`.
* **Secrets:** create once (`./deploy/cloudrun.sh secrets`, or `printf '%s' "$VALUE" | gcloud secrets create NAME --data-file=-` with the value typed hidden into a variable first), then reference: `--set-secrets NAME=secret-name:latest`. Give the service's account (`RUN_SA`, ideally a dedicated account with no other role) `roles/secretmanager.secretAccessor` on exactly those secrets. A new version of a secret is picked up at the next deploy of the service (`:latest` is resolved when an instance starts).
* **Never:** a value in the repository, in `deploy/hosting.env.example`, in a Docker image, in a build argument (build arguments are visible in the image history; only the public `NEXT_PUBLIC_*` values are build arguments), or in the Cloud Run "plain" environment for something in the secret rows.
* **On Vercel (if chosen):** the same `NEXT_PUBLIC_*` names as Project variables for Production; mark none as secret because none is, and set the function region to `bom1` (Mumbai).
