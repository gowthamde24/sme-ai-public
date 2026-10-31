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
| `SENTRY_DSN` | secret | api, worker, web | Error reporting (job DP part 6): unset (the default) = nothing is imported or sent. Set per service from Secret Manager (`--update-secrets`) once the owner has a Sentry project. Only the exception class name and the stack leave. docs/runbooks/error-reporting-sentry.md |
| `SENTRY_ENVIRONMENT` | plain | api, worker, web | The environment name Sentry shows (`staging`, `production`). Optional: defaults to the API's environment. |
| `SENTRY_RELEASE` | plain | api, worker, web | The release Sentry shows (the image tag). Optional. |
| `OUTBOX_ADAPTER` | plain | worker | `fake` in the rehearsal and Customer Zero until WhatsApp is connected (`whatsapp` is the real adapter, section D). The script sets `fake` on the worker. |
| `BILLING_PROVIDER` | plain | api | `fake` (the default and the only value that exists, job DI, ADR 0092): a deterministic stand-in, no network, no key. Any other value stops the process at start. A real provider (Razorpay) is added later, with its secrets in Secret Manager (ADR 0092 lists them). |
| `BILLING_EMAIL_SENDER` | plain | worker | `fake` (the default: the reminders are composed and handed to a sender that sends nothing) or `resend` (job RESEND: Resend's HTTP API from noreply@stack19.com, reply-to support@stack19.com; needs `RESEND_API_KEY`). Anything else stops the worker at start. Staging sets `resend`. Runbook: docs/runbooks/email-resend.md. |
| `RESEND_API_KEY` | secret | api, worker | The Resend API key, from Secret Manager `sme-resend-api-key` (`--set-secrets`). Never in Git, a log or a chat. Without it `BILLING_EMAIL_SENDER=resend` stops the process at start. |
| `MAIL_FROM` | plain | worker | The address app e-mails are sent from (a plain address on the domain verified at the e-mail provider; shown as "Stack19 <address>"). Staging: made from `MAIL_DOMAIN` by `deploy/staging.sh`. Needed when `BILLING_EMAIL_SENDER=resend`. |
| `PRIVACY_EMAIL` | plain | api, worker | The privacy inbox (job DQ, DPDP): the notice shows it and the worker e-mails each public grievance to it. Unset = grievances are stored and acknowledged on screen but not e-mailed. |
| `HELLO_EMAIL` | plain | api, worker | The hello inbox: the worker e-mails each waitlist entry to it. Unset = entries are stored only. |
| `CAPTCHA_PROVIDER` | plain | api | `none` (the default) or `turnstile`: the check on the two public forms (grievance, waitlist). Needs `CAPTCHA_SECRET` when `turnstile`. |
| `CAPTCHA_SECRET` | secret | api | The Turnstile secret key, from Secret Manager. The owner makes the Cloudflare widget; nothing is created here. |
| `MAIL_REPLY_TO` | plain | worker | Where a reply to an app e-mail goes (a mailbox someone reads). Optional. |
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
| `ORIGIN_LOCK_SECRET` | secret | api, web | Unset = no origin lock (the default). Set it only after the Cloudflare Worker adds the same value in `X-Stack19-Origin`; then both services answer only requests that carry it (except `/health` and `/ready`). Steps and order: `docs/runbooks/origin-lock.md`. |
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
| `AI_JOB_ASK` | plain | api | Night 3, ADR 0102: the model of the ask job: `claude` (default: the main model as `LLM_PROVIDER` configures it). `sarvam` is refused at start for this job (see `app/agents/llm/jobs.py`). |
| `AI_JOB_RESEARCH` | plain | api | Night 3, ADR 0102: the model of the research job: `claude` (default: the main model as `LLM_PROVIDER` configures it). `sarvam` is refused at start for this job (see `app/agents/llm/jobs.py`). |
| `AI_JOB_OUTCOME_CLASSIFY` | plain | api | Night 3, ADR 0102: the model of the outcome_classify job: `claude` (default: the main model as `LLM_PROVIDER` configures it). `sarvam` is refused at start for this job (see `app/agents/llm/jobs.py`). |
| `AI_JOB_FOLLOWUP_PLAN` | plain | api | Night 3, ADR 0102: the model of the followup_plan job: `claude` (default: the main model as `LLM_PROVIDER` configures it). `sarvam` is refused at start for this job (see `app/agents/llm/jobs.py`). |
| `AI_JOB_CALL_TURN` | plain | api | Night 3, ADR 0102: the model of the call_turn job: `claude` (default: the main model as `LLM_PROVIDER` configures it) or `sarvam` (needs `SARVAM_API_KEY` and `LLM_SPEND_CAP_CONFIRMED`). |
| `AI_JOB_WHATSAPP_REPLY` | plain | api | Night 3, ADR 0102: the model of the whatsapp_reply job: `claude` (default: the main model as `LLM_PROVIDER` configures it) or `sarvam` (needs `SARVAM_API_KEY` and `LLM_SPEND_CAP_CONFIRMED`). |
| `SARVAM_CHAT_MODEL` | plain | api | The Sarvam chat model for the jobs that choose it (default `sarvam-105b`; the operator adds its row to `agent_model_prices` first: docs/adr/0102-model-per-job-and-claude-vs-sarvam.md). |
| `SARVAM_CHAT_INPUT_MICROS_PER_MTOK` | plain | api | Its input price, millionths of a rupee per million tokens (default 15000000 = Rs 15). |
| `SARVAM_CHAT_OUTPUT_MICROS_PER_MTOK` | plain | api | Its output price (default 60000000 = Rs 60). |
| `LLM_LIGHT_MODEL` | plain | api | Optional cheaper model used after a workspace has used its allowance (ADR 0064). |
| `LLM_LIGHT_INPUT_MICROS_PER_MTOK` | plain | api | Its input price. |
| `LLM_LIGHT_OUTPUT_MICROS_PER_MTOK` | plain | api | Its output price. |
| `AGENTS_MAX_WORKERS` | plain | api | Agent runs in parallel inside one instance (default 2). Agents need CPU always allocated (ADR 0072). |
| `AGENTS_MAX_QUEUE` | plain | api | Runs waiting (default 8). |
| `RESEARCH_FIXTURE_DIR` | plain | api | Development only (synthetic sites on disk). Never set on a deployment. |
| `SARVAM_API_KEY` | secret | api | Only for voice or Hindi/Indic models through Sarvam. |
| `CARTESIA_API_KEY` | secret | api | Job voice-picker: Cartesia Sonic, the primary voice of the picker's preview (`GET .../ai-assistant/voices/preview`). Unset = no preview (404 `no_preview`); the catalogue, the choice and the pre-rendered samples need no key. Secret Manager name `sme-cartesia-api-key`; the API's service account needs access to it (an owner step). |
| `VOICE_STT_PROVIDER` | plain | api | `off` (default). Speech to text: `sarvam`, `bhashini`, `google`, `ai4bharat`. |
| `VOICE_TTS_PROVIDER` | plain | api | `off` (default). Text to speech. |
| `VOICE_NOTE_TTS_PROVIDER` | plain | worker | `auto` (default, job DJ, ADR 0093): Sarvam when `SARVAM_API_KEY` is set (it then also needs ffmpeg, which the worker image has), else `VOICE_TTS_PROVIDER` when it names one, else the fake provider in development and NONE in a deployment (every message then goes as text). `off`, `fake` (development only) or `sarvam` force a choice. |
| `VOICE_NOTE_FFMPEG` | plain | worker | `ffmpeg` (default): the program that codes the speech as OGG/Opus mono for WhatsApp. The worker image installs it (the API image does not). |
| `SARVAM_STT_MODEL` | plain | api | Default `saaras:v4`. |
| `SARVAM_TTS_MODEL` | plain | api | Default `bulbul:v3`. |
| `SARVAM_TTS_SPEAKER` | plain | api | Optional speaker name. |
| `SPEECH_PROVIDER` | plain | api, worker | Night 3, ADR 0101: ONE switch for the speech stack. Empty (default) = each `VOICE_*_PROVIDER` decides, as before; `sarvam` = Sarvam for speech-to-text, text-to-speech and voice notes (needs `SARVAM_API_KEY`; set on staging by `deploy/staging.sh`); `fake` = development only. |
| `OUTREACH_DIALER` | plain | worker | Night 4, ADR 0108: who makes the calls of speed to lead. Empty (default) = nobody (calls wait in the queue; new leads and the hand-off reminders still run); `fake` = a table-driven fake that dials nobody (set on staging by `deploy/staging.sh`). No real telephony exists yet. |
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
| `BROWSER_VOICE_ENABLED` | plain | api | Job DV: `true` turns on "talk to your assistant" in the browser (a WebSocket, `/v1/tenants/{id}/voice-chat`). Needs `SARVAM_API_KEY`, `CARTESIA_API_KEY` and, for the default turn model, `ANTHROPIC_API_KEY` + `LLM_MODEL`; a half-set configuration stays off and the log names what is missing. Default off. |
| `BROWSER_VOICE_SESSION_SECONDS` | plain | api | Hard length of one voice session. Default `300` (Cloud Run's request timeout is also 300 s). |
| `BROWSER_VOICE_DAY_SECONDS` | plain | api | A workspace's live-talk time per day, all sessions together. Default `7200`; staging runs `3600` (one hour a day, owner decision 30 Oct 2026). |
| `BROWSER_VOICE_SEMANTIC_TURNS` | plain | api | Live conversation standard A1/A2 (31 Oct 2026): an unfinished thought ("2000 sq ft ki...") is not answered, the line is listened to for up to ~2.8 s more, and the speaker's own pause sets the quiet that ends their turn. Default `true`. |
| `BROWSER_VOICE_VERIFY_BARGE_IN` | plain | api | Standard B1/B2: a `barge_in` message with `verify:true` only pauses the assistant; a cough, a click, a TV or a "hmm" lets the reply go on where it stopped, real words end it. Default `true`; without `verify` a barge-in still stops for good. |
| `BROWSER_VOICE_FAST_SMALLTALK` | plain | api | Owner decision 31 Oct 2026: small talk and general help in Live talk go to the fast, streaming model (the first word in well under a second) instead of the written chat's whole turn, and are STILL written into the same conversation thread (the caller's words and the reply, a light run, cost recorded). Business questions and actions keep the written chat's turn. Default `true`; `false` sends every Live turn through the written chat's turn as before. |
| `BROWSER_VOICE_AUDIO_AHEAD_MS` | plain | api | Standard B1 (31 Oct 2026): the server sends the browser no more than this many milliseconds of audio ahead of what it has played (default `300`), so a barge-in stop is not queued behind seconds of audio in the socket and a pause cuts off at most that much. `0` sends as fast as the voice makes it. |
| `BROWSER_VOICE_SPECULATIVE` | plain | api | Standard A3 (31 Oct 2026): for small talk and general help the fast model is started on a stable partial transcript that looks finished, before the recogniser's final; the thread is written only when the final confirms the same words, and the reply is thrown away when the caller goes on. Default `true`. |
| `BROWSER_VOICE_FILLER_AFTER_MS` | plain | api | Owner decision 31 Oct 2026: fillers only when the wait is real. A data or action turn gets a short pre-rendered "one moment" only if its answer audio has not started after this many ms (default `1800`). At most one per turn, never on two turns in a row, never the same line twice in a row, and dropped when the answer is ready first. |
| `BROWSER_VOICE_FILLER_ON_CASUAL` | plain | api | `true` also lets small talk and general help (the fast tier) have a filler. Default `false`: never. |
| `BROWSER_VOICE_STT_MODES` | plain | api | What the speech recogniser writes per language, over the built-in defaults: `te=transcribe,kn=transcribe,en=transcribe,ta=transcribe,hi=verbatim,ml=verbatim`. Empty = the defaults. A language or mode it does not know is ignored. |
| `BROWSER_VOICE_DAY_TTS_CHARS` | plain | api | Characters a workspace may send to the voice engines per day. Default `6000`. |
| `BROWSER_VOICE_SESSIONS_PER_MINUTE` | plain | api | Sessions a workspace may open per minute (one runs at a time). Default `6`. |
| `BROWSER_VOICE_TURN_MODEL` | plain | api | Who answers the short turns: `claude` (default: the model `LLM_MODEL`) or `sarvam` (105b: needs its price row and `LLM_SPEND_CAP_CONFIRMED`, ADR 0102). Questions about the business's data always go to Ask. |
| `AUTO_REPLY_ENABLED` | plain | worker | Job DY: `true` lets the worker answer customers' WhatsApp messages for the workspaces whose Owner switched it on (`PUT /ai-assistant/auto-reply`, second factor). Needs `ANTHROPIC_API_KEY` and a model in the WORKER's environment; a half-set configuration stays off and the log names what is missing. Default off. The reply goes through the outbox, so consent, STOP, the 24-hour window, the limits and the kill switches still apply, and a price, a promise, a person asked for or a doubt waits for the Owner. |
| `AUTO_REPLY_MODEL` | plain | worker | The model that writes the automatic replies; default: `LLM_MODEL`. |
| `WHATSAPP_PHONE_NUMBER_ID` | plain | api | Meta's id of the sending number (not a secret). Staging: set by `deploy/staging.sh` (docs/runbooks/whatsapp-staging.md). |
| `WHATSAPP_WABA_ID` | plain | api | Meta's id of the WhatsApp Business Account (not a secret). Staging: set by `deploy/staging.sh`. |
| `WHATSAPP_ALLOWED_RECIPIENTS` | plain | api | The TEST FENCE: the only numbers (digits with the country code, `;` or `,` between) a message may go to. Unset = no fence (production). Set but empty = nothing is sent. Staging always sets it. |
| `CHANNEL_AGENT_EMAIL` | plain | api | The registered account the API signs in as to hand a webhook to the database (belongs to no workspace). |
| `CHANNEL_AGENT_PASSWORD` | secret | api | Its password. |
| `PACKS_DIR` | plain | api | Where `packages/packs` lives. Unset is right in the container image (`/srv/packages/packs`, set by the Dockerfile) and in a checkout. `GET /v1/packs` serves the sign-up cards from it. |
| `AUTH_GOOGLE_CLIENT_ID` | plain | api | The PUBLIC Google client id. Set only when Google sign-up is turned on in Supabase Auth (docs/runbooks/social-sign-up.md); unset = the button is not offered. The secret lives in Supabase, never here. |
| `AUTH_FACEBOOK_APP_ID` | plain | api | The PUBLIC Facebook app id, same rule. |
| `INTEGRATIONS_TENANT_ID` | plain | api | The ONE workspace the installation's connector credentials belong to. |
| `INDIAMART_PROVIDER` | plain | api | `off` (default) | `fake` | `real`. |
| `INDIAMART_CRM_KEY` | secret | api | Only with `real`. |
| `LEAD_INBOUND_DOMAIN` | plain | api | Job DR / A2: the domain of the forwarding addresses `leads+TOKEN@domain`. Unset = no address is shown. |
| `LEAD_INBOUND_SECRET` | secret | api | Job DR / A2: the header `X-Inbound-Secret` of the one global inbound mail address. Unset = that route answers 503. |
| `LEAD_READER_ENABLED` | plain | worker | Owner decision 31 Oct 2026: the AI lead reader. `true` = the worker reads the first WhatsApp message of a new lead (and later messages while need/quantity are empty) with a light model and stores need / quantity / area / city / budget / timeline / urgency / language with LOW confidence (the "?"). Needs `ANTHROPIC_API_KEY` and a model. The database decides who is read: real-data gate open, not a school, agents switched on, at most 200 reads a workspace a day, five reads a lead. Default off. |
| `LEAD_READER_MODEL` | plain | worker | The light, fast model of the lead reader (staging: `claude-haiku-5-5`); falls back to `AUTO_REPLY_MODEL`, then `LLM_MODEL`. |
| `LEAD_RESEND_API_KEY` | secret | api | Lead e-mails received by Resend (`leads.stack19.com`): the key that FETCHES a received mail, from Secret Manager `sme-resend-leads-api-key` (`--set-secrets`). It is NOT `RESEND_API_KEY` (the key the app's own e-mails are sent with, `sme-resend-api-key`); never reuse one for the other. Set together with `LEAD_RESEND_WEBHOOK_SECRET` or not at all (the API refuses to start with one of them). |
| `LEAD_RESEND_WEBHOOK_SECRET` | secret | api | The signing secret (`whsec_...`) of the Resend webhook `POST /v1/lead-intake/resend` (event `email.received` only), from Secret Manager `sme-resend-webhook-secret`. Unset = that route answers 503. |
| `LEAD_DND_PROVIDER` | plain | api | Job DR / A2: `off` (default) \| `fake` (development only). No real Do-Not-Disturb lookup is chosen yet. |
| `META_LEAD_PROVIDER` | plain | api | Job DR / A2: `off` (default) \| `fake` (development only) \| `graph` (after Meta's app verification). |
| `META_APP_SECRET` | secret | api | Job DR / A2: signs Meta's webhook. Only with `graph`. |
| `META_PAGE_TOKEN` | secret | api | Job DR / A2: fetches a lead from the Graph API. Only with `graph`. |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` | plain | api | Job DR / A2: shown to owners as the address to share a private sheet with (the key is not used yet). |
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
| `VAPID_SUBJECT` | plain | api, worker | `mailto:` plus a role address of the business that someone reads (the support address of `apps/web/lib/site/business.ts`), never a personal address. |

**Not a setting of the API or the web: the sender of app e-mails (job DB).** The only e-mail the product sends today is Supabase Auth's (sign-up confirmation, password reset). Its sender is configured in Supabase (dashboard, Authentication, SMTP: sender e-mail, e.g. `noreply@stack19.com`; locally the `env(MAIL_FROM)` line of the commented `[auth.email.smtp]` block in `supabase/config.toml`). Never a personal address, never written in code. The four PUBLIC addresses people write to (hello, support, billing, privacy) are not environment settings either: they are in `apps/web/lib/site/business.ts`.

## E. Policy versions (public text settings)

Change only when the published terms or privacy notice change.

| Variable | Kind | Read by | Value or when to set it |
|---|---|---|---|
| `TERMS_VERSION` | plain | api | Default `2026-10-01`; staging sets `2026-10-27` (deploy/staging.sh: the legal texts of 25 Oct 2026, the 14-day trial counted from the day WhatsApp is connected). |
| `PRIVACY_VERSION` | plain | api | Default `2026-10-01`; staging sets `2026-10-27` together with the terms. |
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
| `NEXT_PUBLIC_SIGNUP_OPEN` | plain | BUILD | Job DH (read by the server at request time, so a Cloud Run environment variable of this name overrides the image's value without a rebuild): `0` closes public sign-up: `/signup` shows "We are opening to businesses soon", the early-access address (selectable text with Copy, no form, nothing stored) and the sign-in link, with no business cards, no e-mail form and no Google or Facebook button; the sign-up actions refuse. Unset or anything else leaves it open (local stack, e2e). The deploy scripts build with `0` (`SIGNUP_OPEN=1 make deploy-staging` opens it; also turn on sign-up in Supabase, which is a separate switch). |
| `NEXT_OUTPUT` | plain | BUILD | Job DE: `standalone` makes `next build` trace the server into `.next/standalone` (what `deploy/Dockerfile.web` runs). Set by the Dockerfile itself; leave unset everywhere else (dev, `next start`, the demo scripts). |
| `PLAN_SCREENS` | plain | RUN | Job DK, the feature flag of the Plan and usage screens (read by the server at request time, so a Cloud Run environment variable is enough; no rebuild). Unset or `0`: off, and it stays off until billing is real (Settings has no Plan part, `/app/tenants/<id>/plans` is a 404). `1`: on, reading the plans and billing API of job DI (`GET /v1/plans`, `GET /v1/tenants/<id>/billing`, `POST …/billing/trial`, `POST …/billing/cancel`; only its FAKE payment provider exists today, so the screens say "test mode"; if the API cannot be reached they say "Not available yet"). `mock`: on with a FAKE provider whose state lives in a browser cookie (test mode label, no payment, nothing stored on a server); for review only, never on production. |
| `CALL_SCREENS` | plain | RUN | Job DM, the feature flag of the live call screen (`/app/tenants/<id>/office/live` and the "Live now" card on Today). Read by the server at request time (no rebuild). Unset or `0`: off (the page is a 404). `mock`: a PRETEND call (nobody is called; the screen says so), for review only, never on production. `1`: on, for the real call feed, which does not exist yet: the page says "Not available yet". |
| `OUTCOME_SCREENS` | plain | RUN | Job DM, the feature flag of the outcomes (what happened after each call and WhatsApp follow-up: on a customer's page and as today's totals on Today). Server, at request time. Unset or `0`: off (nothing is drawn). `mock`: invented outcomes, and the owner's corrections are kept in a cookie; review only. `1`: on, for C1's outcomes API (contract-outcomes.md), which is not published yet: the parts say "Not available yet". |
| `ASSISTANT_SCREENS` | plain | RUN | Job DM, the feature flag of Settings > AI assistant (name, voice, languages, way of talking, what it may do, hand-over rules, calling hours). Server, at request time. Unset or `0`: off (no tab). `mock`: the owner's choices are kept in a cookie of that browser; review only. `1`: on, for C1's per-workspace assistant settings (not published yet): the part says "Not available yet". |
| `CALL_SETTINGS_SCREENS` | plain | RUN | Job DP, the feature flag of Settings > AI assistant > Advanced (how calls behave: retries, voicemail, silence, pronunciations, hours and holidays, hand-over, purposes). Server, at request time. Unset or `0`: off. `mock`: kept in a cookie of that browser; review only. `1`: on, C1's `/call-settings` API (the Owner saves with the second factor). |
| `OWN_VOICE_SCREENS` | plain | RUN | Job DP, the feature flag of "Use my own voice" under the assistant (a recorded consent sentence and a sample, created and deleted by the Owner). Server, at request time. Unset or `0`: off. `mock`: the status is a cookie, no recording is kept; review only. `1`: on, C1's `/voice-clone` API. |
| `MARKS_SCREENS` | plain | RUN | Job DP, the feature flag of a school's "Send marks to parents" (`/marks`). Server, at request time. Unset or `0`: off (the page is not there). `mock`: the preview is made from the file in memory, nothing is sent, a counts-only log is kept in a cookie; review only. `1`: on, C1's `/institution/marks-messages` API. The platform never stores marks. |
| `SITE_MODE` | plain | RUN | Job DQ: `website` serves only the public website (home, the three business pages, plans, contact, privacy, terms, data deletion): `/app`, sign-in, sign-up and the other sign-in pages show "Opening soon — book a demo", the service worker is not registered and robots.txt and the sitemap are open to search engines when the request comes from `stack19.com` or `www.stack19.com` (never from another address). Read by the server at request time (no rebuild). Unset or anything else: the usual behaviour, every page. Steps and rollback: `go-live-website.md` in the owner's job folder (docs/runbooks/website-go-live.md). |
| `ORIGIN_LOCK_SECRET` | secret | RUN | The same value as the API's (job DT, `docs/runbooks/origin-lock.md`): unset = no lock; set = the web answers only requests that carry it in `X-Stack19-Origin` and adds it to its own calls to the API. The one server secret the web holds; it comes from Secret Manager. |
| `WAITLIST` | plain | RUN | Job DQ: the "Book a demo / join the waitlist" form of the public pages. Server, at request time. Unset: on in website mode, off otherwise. `off`: the form is not there. `mock`: it takes the details and keeps nothing (review and pictures). `1`: posts to the API's `POST /v1/public/waitlist` (no sign-in). |
| `DPDP_SCREENS` | plain | RUN | Job DQ part 2, the feature flag of the screens that need C1's consent and grievance API (`contract-dpdp.md`): the marketing switch and "Raise a grievance" in Settings > Privacy and data, and the separate unticked marketing box of sign-up. Server, at request time (no rebuild). Unset or `0`: off (those parts are not drawn; the Privacy notice, its list of processors and the consent line under the buttons are always there). `mock`: on with fake data kept in a cookie, for review. `1`: on, with the API (`GET/PUT /v1/me/consents`, `POST /v1/privacy/grievance`). Turn it on after the API of job DQ is deployed. |
| `VOICE_SAMPLE_SCREENS` | plain | RUN | Job DQ part 3, the feature flag of the voice picker's samples (the play buttons beside each voice and the warm/crisp choice in Settings > AI assistant). Server, at request time (no rebuild). Unset or `0`: off (no play buttons; the route `/app/tenants/<id>/voice-sample` answers 404). `mock`: a synthetic two-note sound that tells the voices apart by pitch, for review. `1`: on, with the API sample endpoint (assumed shape in `c2-questions-3.md`). The sound goes through our own route, so the person's token never reaches the browser. |
| `LEADS_SCREENS` | plain | RUN | Night 4 (job DR), Lead Desk: the nine "any business with leads" types and their picker at sign-up, the setup wizard, the knowledge base and playbook, lead imports (Excel, sheet, pasted list, contacts), Settings > Lead sources and the Lead Desk list. Server, at request time (no rebuild). Unset or `0`: off (nothing of it is drawn; the nine types show as ordinary cards if the API lists them). `mock`: on with fake data kept in a cookie, for review. `1`: on, with the API (`/v1/lead-templates`, `/lead-playbook`, `/knowledge/*`, `/lead-imports/*`, `/lead-sources`, `/lead-sheet-links`). Turn it on after the API of job DR (A1, A2) is deployed. |
| `OUTREACH_SCREENS` | plain | RUN | Night 4 (job DR part A3), speed to lead: batch plans with one "Approve all", standing rules per source, hot-lead hand-offs and the lead report. Server, at request time. Unset or `0`: off. `mock`: fake data in a cookie. `1`: the API (`/v1/tenants/{id}/outreach/*`). |
| `TASK_SCREENS` | plain | RUN | Night 4 (job DR part B), "Ask Vijaya to do it": an instruction becomes a plan, one "Approve all", live progress and a report; Calls > Tasks. Server, at request time. Unset or `0`: off. `mock`: fake data in a cookie (every result is marked simulated). `1`: the API (`/v1/tenants/{id}/tasks/*`). |
| `OPENING_LINE_SCREENS` | plain | RUN | Night 5, Settings > AI assistant > Opening line (the greeting text per language, the switch for mentioning the AI, a preview, a per-campaign override). Server, at request time. Unset or `0`: off. `mock`: fake data in a cookie (no sound). `1`: the API (`/v1/tenants/{id}/opening-line*`). |
| `ABOUT_BUSINESS_SCREENS` | plain | RUN | Settings > AI assistant > About my business (the owner's notes the assistant reads in chats, calls, Ask and drafts; add by paste, file or voice with a preview; "Try it"; versions). Server, at request time. Unset or `0`: off. `mock`: notes kept in the memory of the server (nothing is sent). `1`: the API (`/v1/tenants/{id}/ai-assistant/context*`, contract-context-sources.md part A). |
| `SOURCE_CARDS_SCREENS` | plain | RUN | Lead sources as simple cards (Meta lead ads, IndiaMART key, forwarded e-mails, website snippet, files, WhatsApp, missed calls) on the Lead sources page. Server, at request time. Unset or `0`: off. `mock`: made-up cards in the memory of the server. `1`: the API (`/v1/tenants/{id}/lead-sources/cards` and its connect calls, contract-context-sources.md part B). |
| `AUTO_REPLY_SCREENS` | plain | RUN | Settings > AI assistant > Automatic replies (job DY: the Owner's switch for the assistant answering customers' WhatsApp messages on its own, the three standing rules in plain words, today's counts). Server, at request time. Unset or `0`: off. `mock`: the switch kept in a cookie (nothing is sent). `1`: the API (`GET/PUT /v1/tenants/{id}/ai-assistant/auto-reply`; turning it on needs the Owner's second factor). The worker's own `AUTO_REPLY_ENABLED` is separate. |
| `PRONUNCIATION_SCREENS` | plain | RUN | Settings > AI assistant > Pronunciation and "Mispronounced?" under spoken chat messages (job pronunciation-quality: the workspace's own words with how they sound, Hear it in the chosen voice, Owner and Admin change it). Server, at request time. Unset or `0`: off. `mock`: the list kept in a cookie of the browser (the sounds are tones). `1`: the API (`/v1/tenants/{id}/ai-assistant/pronunciation`, `POST /pronunciation/preview`). |
| `VOICE_PICKER_SCREENS` | plain | RUN | Owner decision 28 Oct, Settings > AI assistant > Voice (the approved voices of each language with a recorded sample, and the voice the workspace chooses per language). Server, at request time. Unset or `0`: off. `mock`: the approved catalogue, the choice kept in a cookie (the sounds are tones). `1`: the API (`GET`/`PUT /v1/tenants/{id}/ai-assistant/voices`, samples `/v1/voice-samples/{id}.mp3`). |
| `GUIDED_DEMO` | plain | RUN | Owner request 28 Oct, the guided demo: a "Start demo" button in the DEMO workspaces (named "DEMO ...") plays a six-step story over the real screens (a new lead, the assistant reaches out, a question and an answer from the catalogue, a follow-up draft, a visit, Today), with made-up data only and nothing sent. Server, at request time. Unset or `0`: off. `1`: on (staging). |
| `BROWSER_VOICE` | plain | RUN | Job DV, "Talk to your assistant" in the browser: the floating orb becomes a microphone and the assistant answers aloud over a WebSocket to the API (`wss://<api>/v1/tenants/{id}/voice-chat`, contract-browser-voice.md, ADR 0118). Server, at request time; with it on, the page's `connect-src` also allows the API's `wss://` address (from `NEXT_PUBLIC_API_BASE_URL`). The API needs `BROWSER_VOICE_ENABLED=true`. Unset or `0`: off. `1`: on (staging). |
| `TURNSTILE_SITE_KEY` | plain | RUN | Night 5, security: the PUBLIC site key of the Cloudflare Turnstile widget. When set, the waitlist form, the contact form and the sign-in after three failures show the check box and need its token (the API verifies it with the secret it holds: `POST /v1/public/turnstile/verify`; the web holds no secret). Server, at request time. Unset: no check box. Set it only after the API has that endpoint. |
| `TOPUP_SCREENS` | plain | RUN | Night 4 (job DS part F2): top-ups of minutes and messages, usage alerts and the test checkout in Settings > Plan. Server, at request time. Unset or `0`: off. `mock`: fake data in a cookie (the checkout is a clearly marked test). `1`: the API of C1's top-up job. Payments stay fake until the owner's billing gates. |
| `SIGNUP_MAX_PER_HOUR` | plain | RUN | Default 5. A brake in one server instance's memory. |
| `STACK19_WHATSAPP` | plain | RUN | Job CM: OUR OWN WhatsApp number (digits with the country code, for example `919876543210`), for the public site's contact form and the calculator's "Get exact quote on WhatsApp". It is a public number, read on the server only (not `NEXT_PUBLIC_`, so it is not in any page's HTML until a visitor has ticked consent and asked for the chat). Unset: the pages say chat is not set up and show no button. |
| `SITE_LEAD_MAX_PER_HOUR` | plain | RUN | Job CM: how many times one address may ask for that chat in an hour (default 10). A brake in one server instance's memory, like `SIGNUP_MAX_PER_HOUR`. |
| `TZ` | plain | RUN | Optional `Asia/Kolkata`. The screens format times in India time explicitly, so it is a belt, not a need. |
| `PUBLIC_LAUNCH_REQUIRES_REVIEWED` | plain | BUILD | Optional. Set to `1` on the build to FAIL it while any translation is still a draft (the owner's launch gate). |
| `NODE_ENV` | plain | RUN | `production`, set by `next start` and the Dockerfile. It makes the session cookie `Secure`. |

## How each is set on Google Cloud Run

* **Plain values:** `--set-env-vars NAME=value,...` (the script does this from your shell for one run). Change one later with `gcloud run services update sme-api --update-env-vars NAME=value`.
* **Secrets:** create once (`./deploy/cloudrun.sh secrets`, or `printf '%s' "$VALUE" | gcloud secrets create NAME --data-file=-` with the value typed hidden into a variable first), then reference: `--set-secrets NAME=secret-name:latest`. Give the service's account (`RUN_SA`, ideally a dedicated account with no other role) `roles/secretmanager.secretAccessor` on exactly those secrets. A new version of a secret is picked up at the next deploy of the service (`:latest` is resolved when an instance starts).
* **Never:** a value in the repository, in `deploy/hosting.env.example`, in a Docker image, in a build argument (build arguments are visible in the image history; only the public `NEXT_PUBLIC_*` values are build arguments), or in the Cloud Run "plain" environment for something in the secret rows.
* **On Vercel (if chosen):** the same `NEXT_PUBLIC_*` names as Project variables for Production; mark none as secret because none is, and set the function region to `bom1` (Mumbai).

