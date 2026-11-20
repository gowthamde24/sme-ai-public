# Production bring-up runbook (C1, Sat 21 Nov 2026): every command, in order

(Copy of the planner-facing report reports/prod-bringup-runbook.md; this file is the one in the repository.)

Why now: a real second business is waiting (early access). Target: possible from **Sun 22 Nov**, as soon as the owner's accounts and secrets exist; the fixed dates (26-27 Nov) stay the fallback.
Nothing here has been run. Everything below is a DRY RUN until `--execute` AND `PROD_CONFIRM=<short commit>` (printed by `preflight`). Production never shares anything with staging: `deploy/production.sh` refuses the staging project, the staging database and any web origin that names staging.

Legend: **[OWNER]** only the owner can (account, payment, password, secret, DNS, console click, decision) · **[C1 ON GO]** I run it once the owner says go for that step · **[C1 NOW]** prepared in the repo, no owner needed · **[GATE]** stays closed/off until the owner writes the word.
Older, narrower plans (kept as reference, this file supersedes their ORDER): `docs/runbooks/production-bringup.md`, `production-waitlist-slice.md`, `production-owner-steps.md`, `customer-zero-go-live-checklist.md`, `hosting-owner-runbook.md`.

## 0. What the owner must decide or have before step 1 (one line each)
1. **[OWNER]** Supabase **Pro**, compute **Small**, region Mumbai (about USD 25 + 15 a month; production database = Small, see the 12 Nov sizing memo).
2. **[OWNER]** A NEW Google Cloud project linked to the billing account "My Billing Account" (holds the Google for Startups credits). Note project id + project number.
3. **[OWNER]** The scheduler account address (e.g. `scheduler@stack19.com`) and the alert e-mail address.
4. **[OWNER]** For the second business to use WhatsApp: a **production Meta app** (or the same app moved to Live) with the WhatsApp product, an Embedded Signup configuration id, and the app's id (public ids, not secrets). Without it the production outbox stays the fake adapter (no WhatsApp) and the business can still use calls, the web app and Today.
5. **[OWNER]** The early-access terms and privacy text approved as dated drafts (privacy page stays a draft until the owner says; version string `PRIVACY_VERSION`).
6. **[OWNER]** The business's allowed list for the first week (WHATSAPP_ALLOWED_RECIPIENTS) = the owner's own number plus the new business owner's own number only, until the owner says "open".

## 1. Accounts and public ids [OWNER, then C1 checks]
```
cp deploy/production.env.example deploy/.env.production     # git ignores it
# fill: PROD_PROJECT_ID PROD_PROJECT_NUMBER PROD_SUPABASE_REF PROD_SCHEDULER_EMAIL
#       PROD_WEB_ORIGIN=https://app.stack19.com  PROD_MAIL_DOMAIN=stack19.com  (PROD_SITE_ORIGIN=https://stack19.com optional)
```
**[C1 ON GO]** `deploy/production.sh preflight` (read-only): ids differ from staging, git clean on main == origin/main, required secrets exist, prints `PROD_CONFIRM=<commit>`.

## 2. Database [OWNER types the DB password; C1 reads the output]
```
supabase link --project-ref <PROD_SUPABASE_REF>            # asks the database password, typed by the owner
supabase db push --dry-run                                  # C1 reads the list: every migration up to the newest on main
supabase db push --yes
psql / SQL editor: run supabase/hosted/verify.sql           # every row ok = true
```
Then by hand in the dashboard: `supabase/hosted/hosted-auth-settings.md` (session timeout, e-mail templates, redirect URLs, sign-up CLOSED, e-mail confirmation ON, MFA for Owner/Admin, SSL enforced, custom SMTP with Resend). **[OWNER]**
Register the scheduler account (the worker signs in as it): `docs/runbooks/scheduler-local.md`, hidden prompt for its password.
Backups: Dashboard > Database > Backups: daily backup on, first backup exists BEFORE any real data. **[OWNER]**
Rollback of this step: none needed for an empty database; a bad migration is fixed forward by a new migration (never edit applied ones).

## 3. Google side [OWNER presses, C1 prepared]
```
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com logging.googleapis.com monitoring.googleapis.com --project <PROD_PROJECT_ID>
gcloud artifacts repositories create sme --repository-format=docker --location=asia-south1 --project <PROD_PROJECT_ID>
# service accounts: sme-api-run sme-web-run sme-worker-run sme-tick sme-build  (exact least-privilege grants: docs/runbooks/hosting-owner-runbook.md section "service accounts")
deploy/budget-alerts.sh            # dry run first; INR 1,000 monthly alert, alerts only
```

## 4. Secrets: names only, each typed at a HIDDEN prompt in the owner's terminal [OWNER]
Never in chat, a file or a command line. Pattern (value is typed, nothing shows):
```
read -rs -p "value: " V; echo; printf %s "$V" | gcloud secrets create <NAME> --project <PROD_PROJECT_ID> --replication-policy=automatic --data-file=-; unset V
```
| Secret name | What | Needed for |
|---|---|---|
| `sme-suppression-hmac-key` | generated by `deploy/cloudrun.sh secrets --execute`, nobody sees it | everything (do-not-call keys) |
| `sme-scheduler-password` | the scheduler account's password | worker |
| `sme-resend-api-key` | Resend production sending key | mail |
| `sme-anthropic-api-key` | model key | assistant, auto-reply, evals |
| `sme-sarvam-api-key` | Sarvam (Telugu speech, TTS) | calls, voice samples |
| `sme-cartesia-api-key` | Cartesia | calls |
| `sme-plivo-auth-id`, `sme-plivo-auth-token` | Plivo production account | calls, number checks |
| `sme-exotel-stream-secret` | signs per-call media tokens | calls |
| `sme-telephony-sandbox-numbers` | owner/test numbers allowed while TELEPHONY_MODE=sandbox | calls |
| `sme-telephony-shop-numbers` | the business's own mobile(s), comma-separated | forwarded-call recognition (Customer Zero list, section C) |
| `sme-whatsapp-token` | the system-user token of the PRODUCTION Meta app | WhatsApp send + template sync |
| `sme-whatsapp-app-secret` | the production Meta app's secret (webhook signature) | WhatsApp webhook |
| `sme-whatsapp-verify-token` | a long random string the owner invents, entered also in Meta | WhatsApp webhook handshake |
| `sme-turnstile-secret` | Cloudflare Turnstile secret key (only the waitlist slice) | waitlist |
Grant each secret to ONLY the service account that reads it (`gcloud secrets add-iam-policy-binding <NAME> --member serviceAccount:<sa> --role roles/secretmanager.secretAccessor`); C1 prints the grant table to read together. The Customer Zero list forbids any staging secret in production: do not copy values.
Check (C1 ON GO): `gcloud secrets list --project <PROD_PROJECT_ID> --format='value(name)'`.

## 5. Declared production settings: what must change in the repo BEFORE the first full deploy [C1 NOW, one reviewed PR]
`deploy/settings/production/api.env` is the declared truth (the deploy refuses anything else). Today it is the phone-first v1: it has no WhatsApp and no Jobs. The PR "production settings for the second business" adds, and ONLY after the owner's item 4 above:
* `JOBS=on` (API; **this PR adds it now, it is safe: routes only**) and the web flag that turns the Jobs screens on in `deploy/production-web-flags.env` (C2's lane: they add it in their reviewed PR; the staging file's tenant ids are NOT copied).
* `OUTBOX_ADAPTER=whatsapp`, `OUTBOX_WHATSAPP=true`, `WHATSAPP_GRAPH_VERSION=v25.0`, `WHATSAPP_APP_ID`, `WHATSAPP_EMBEDDED_CONFIG_ID`, `WHATSAPP_EMBEDDED_VERSION`, `WHATSAPP_ALLOWED_RECIPIENTS` (the fence from item 6; unset = empty fence = nothing sent) and in `api.secrets`: `WHATSAPP_ACCESS_TOKEN=sme-whatsapp-token`, `WHATSAPP_APP_SECRET=sme-whatsapp-app-secret`, `WHATSAPP_VERIFY_TOKEN=sme-whatsapp-verify-token`.
* The worker: `deploy/production.sh` still hard-codes `WORKER_OUTBOX_ADAPTER=fake` and none of `AUTO_REPLY_ENABLED`, `TOKEN_EXPIRY_CHECK`, `TEMPLATE_SYNC`. The PR copies staging's switches (`WORKER_AUTO_REPLY`, `WORKER_TOKEN_EXPIRY`, `WORKER_TEMPLATE_SYNC`, the WhatsApp token secret, `WHATSAPP_ALLOWED_RECIPIENTS`) into the production worker command, defaults OFF, so each is an explicit owner-visible flag.
* Left exactly as is: `TELEPHONY_MODE=sandbox`, `TELEPHONY_OUTBOUND=false`, `TASKS_DIALER=off`, `LEAD_FINDER=off`, `MIN_INSTANCES=1`, `MAX_INSTANCES=1`. `PRICING_V2`, `ADMIN_CONSOLE`, `DEVELOPER_API`, `ASSISTANT_WORK_TENANTS` (a staging tenant list) stay unset in production.
* **Fence rule: while `WHATSAPP_ALLOWED_RECIPIENTS` is set, nothing reaches anyone else.** Widening it is a declared-settings PR plus the owner's written word.

## 6. First deploy [C1 ON GO; owner confirms each execute]
Dry run, read it together, then execute. Order: worker last, API before web.
```
deploy/production.sh preflight
PRIVACY_VERSION=<approved string> deploy/production.sh deploy api            # DRY RUN
PRIVACY_VERSION=<approved string> PROD_CONFIRM=<commit> deploy/production.sh deploy api --execute
```
The API is deployed WITHOUT traffic, compared with the declared settings, and only then given the traffic (`deploy/api_guard.sh`); a difference stops with exit 3 and the new revision gets no traffic. Then:
```
deploy/production.sh deploy web          # DRY RUN, then --execute with PROD_CONFIRM; uses deploy/production-web-flags.env
deploy/production.sh deploy worker       # DRY RUN, then --execute
python3 deploy/drift.py snapshot production web    <PROD_PROJECT_ID> asia-south1   # writes deploy/settings/production/web.env   -> reviewed PR
python3 deploy/drift.py snapshot production worker <PROD_PROJECT_ID> asia-south1   # writes deploy/settings/production/worker.env -> reviewed PR
```
From the snapshot on, every deploy of web and worker first compares live with declared (STOP on a difference); `make drift-staging` is the same check for staging.
Rollback of any step: `deploy/production.sh rollback sme-api|sme-web [REVISION] --execute` (100 % traffic to the earlier revision), `latest` to undo. Worker: redeploy the previous tag. Everything off: `AGENTS_ENABLED=false` redeploy, or set min-instances 0, or close the real-data gate (`real-data-gate.md`).

## 7. Webhooks and providers [OWNER clicks, C1 gives the exact values]
The API's address never changes: `https://sme-api-<PROD_PROJECT_NUMBER>.asia-south1.run.app`. The app domain (`app.stack19.com`) is a Cloudflare Worker in front of the web only; calls and callbacks use the run.app address.
* **WhatsApp (Meta developers > the production app > WhatsApp > Configuration)**: Callback URL `https://sme-api-<NUMBER>.asia-south1.run.app/v1/webhooks/whatsapp`, Verify token = the value of `sme-whatsapp-verify-token` (owner types it into Meta), subscribe to `messages` (and message_template_status_update). Then in the app: Settings > Connect WhatsApp (Embedded Signup) as the owner of the new business; templates are submitted automatically after Connect.
* **Plivo (console)**: an 080 or 022 number in the production account, KYC with GST / certificate / Udyam (the 080 decision of 12 Nov); an XML application whose Answer URL is `.../v1/telephony/plivo/answer` and Hangup URL `.../v1/telephony/plivo/hangup`; link the number; inbound stays OFF in the line row until the test call. **[GATE]** `TELEPHONY_MODE=live` only by the owner's written "live" (reviewed PR, `ALLOW_FLAG_CHANGE=TELEPHONY_MODE PROD_LIVE_OK=yes`).
* **Plivo fallback Worker** (`deploy/cloudflare-worker-plivo-fallback.js`, variables set in the Cloudflare dashboard): before real calls.
* **Cloudflare**: custom domain `app.stack19.com` to the web Worker (`deploy/cloudflare-worker-proxy.js`). Delete the Worker's custom domain to take the web down.
* **Resend**: domain verified for `stack19.com`; the invitation e-mail tested with the owner's own address.

## 8. Smoke tests and gates [C1 ON GO]
```
python3 scripts/verify_hosted.py --api https://sme-api-<NUMBER>.asia-south1.run.app --web https://app.stack19.com     # must end ALL CHECKS PASSED; keep the output (hosting_ref)
ALERT_EMAIL=<owner> deploy/production-alerts.sh       # dry run, then --execute; trigger each alert once, owner sees the mail
deploy/production.sh rollback sme-api && deploy/production.sh latest sme-api     # dry runs, then once for real with --execute
```
Then a SYNTHETIC workspace (never the demo, never real data): sign up, business type, Connect WhatsApp to the owner's own test number, a first lead, a reply, an owner test call, Today. The real-data gate stays CLOSED until its four references exist (`real-data-gate.md`): `erasure_ref` (erase a synthetic person on production), `hosting_ref` (the verify_hosted output), `dpdp_review_ref` (the owner's dated review note), `restore_drill_ref` (restore a backup into a scratch project, `backup-restore-drill.md`). **[OWNER]** opens the gate by the operator command; nothing opens by itself.

## 9. The new business, day one on production (after step 8) [OWNER + C1]
1. The owner creates their workspace by invitation (sign-up is closed): the owner invites the business owner's e-mail.
1b. **[OWNER/operator, one statement per workspace]** the assistant is OFF for a new workspace by design (agent allow-list): `select app.operator_enable_assistant('<workspace slug>');` (also switches the platform flags `agents_enabled`/`assistant_enabled` on the first time). Without it chat, auto-reply drafting and plan cards answer "not available". `ASSISTANT_WORK_TENANTS` stays UNSET in production (unset = every workspace).
2. Business type chosen in the app; assistant name and languages; hours.
3. Number: the business's own mobile as the business phone; Plivo number forwarding only on no-answer (`customer-zero-go-live-checklist.md` section C) after the three-phone test.
4. Connect WhatsApp (Embedded Signup); templates auto-submit; the business sees "waiting"/"approved" per message; a rejected one appears on Today.
5. Free early access: 500 call minutes, set by the operator: `select app.operator_set_call_minutes('<workspace id>', 500);` (`early-access.md`). Fence = their own number plus the owner's until "open".
6. First lead from their own enquiry; the assistant replies (auto-reply on only when the owner has flipped `WORKER_AUTO_REPLY=1` for production).

## Owner-gated checklist at a glance
Accounts (2) · Supabase password (3) · every secret (4) · Meta production app + webhook (7) · Plivo console + KYC (7) · Cloudflare domain (7) · alert e-mail (8) · privacy text (0.5) · `TELEPHONY_MODE=live` · gate opening · widening the WhatsApp fence · `PROD_CONFIRM` of each execute.

## What I (C1) do ahead of the owner, with no production access
Sat 21 Nov: PR with `JOBS=on` in production api.env and the worker/WhatsApp switches in production.sh (defaults off, dry-run tested by the existing fake-gcloud tests) → merge on green. Sun 22 Nov: every step above dry-run read-through on the staging twin (`deploy/staging.sh`) for the commands that exist there.

## Known gaps in the repo found while writing this (all listed, none blocking the DB/API/web part)
G1 production.sh worker: fake outbox, no auto-reply / token-expiry / template-sync switches (fixed by the PR above). G2 production api.env: no WhatsApp, no JOBS (JOBS added now, WhatsApp only with the owner's Meta ids). G3 `deploy/production-web-flags.env` is empty on purpose (C2 fills it; `REVIEWED_TRANSLATIONS_ONLY=1` must be in it). G4 `deploy/settings/production/web.env` and `worker.env` do not exist until the first snapshot (step 6). G5 the Plivo number KYC takes days: start it first.
