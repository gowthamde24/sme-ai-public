# Runbook: putting the app on the internet, step by step (the owner's checklist; job BG)

**Nothing here has been run.** No account exists, nothing is deployed, nothing is bought. **Start with the rehearsal, [`hosting-rehearsal-owner.md`](hosting-rehearsal-owner.md) (job CE): the same steps with synthetic data, a 10 EUR budget alert first, a smoke test, and a teardown. Every setting by name: [`hosting-env-and-secrets.md`](hosting-env-and-secrets.md).** This is the plan in [ADR 0072](../adr/0072-hosting-free-tier-first.md) (read its short table first: Supabase Mumbai + Google Cloud Run Mumbai, free at first, Pro before real data). It builds on `hosting-deploy.md` (the commands), `hosted-auth-settings.md` (the Supabase checklist), `backup-restore-drill.md` and `scripts/verify_hosted.py`. ADR 0017 applies: **any step that costs money needs your written approval first**, and the real-data gate stays closed until all four of its prerequisites exist.

Legend. **[OWNER ONLY]**: only you can do it (an account, a payment, a secret only you hold, a DNS change, a decision). **[ANY AGENT CAN PREPARE]**: the command or file is in the repository and can be dry-run for you, but you press the button. Every script is a **dry run unless you add `--execute`**.

## The stages, so you know where you are

| Stage | Data | Costs | You may stop here |
|---|---|---|---|
| **0. Rehearsal** | synthetic only | about USD 0 | yes: it proves the whole thing works on the internet |
| **1. Customer Zero** | real, gate opened | Supabase Pro USD 25 + optional warm instances | the target |
| **2. Agents on** | real | + about USD 44 for the API's CPU, + the model provider | later |

Do not skip to stage 1 with the free Supabase plan: it has no backups and can pause (ADR 0072).

## Part A: accounts [OWNER ONLY]

Use an e-mail address you will keep for years (a shared family mailbox is better than a personal one), a password manager, and two-step sign-in on every account below.

1. **Supabase** (supabase.com): create an account and an organisation. Free plan is enough for stage 0. [OWNER ONLY]
2. **Google Cloud** (cloud.google.com): create an account, a **billing account** (a card is required even for the free amounts), then **one project** (the id is your `PROJECT_ID`). Immediately create a **budget alert** (Billing > Budgets): for stage 0 set it at USD 5 with e-mail alerts at 50 % and 100 %. There is no hard spending cap on Google Cloud: the alert is your brake. [OWNER ONLY]
3. **A domain name**, only when you want your own address (stage 1b). Any registrar; keep its login to yourself. [OWNER ONLY]
4. **An e-mail sending service (SMTP)** for sign-in and invitation e-mails: Supabase's built-in sender allows about 2 e-mails an hour, which is not enough for real people. Free plans exist (Brevo: 300 a day; Resend: 3,000 a month and 100 a day; verify both on the vendors' pages). You will need a verified sending domain (SPF and DKIM records), so this goes with step 3. Stage 0 can do without: test with your own address only. [OWNER ONLY]
5. **A model provider**, only at stage 2 (see ADR 0013): create a key **with a hard monthly spend cap set at the provider**. [OWNER ONLY]

## Part B: the database (Supabase) [OWNER ONLY, then verify]

1. Create a project: name `sme-staging`, **region South Asia (Mumbai)**, a long random database password stored in your password manager. You will type this password into your own terminal when asked; do not paste it into a chat or a file. [OWNER ONLY]
2. Apply the settings in **`hosted-auth-settings.md`** by hand in the dashboard (never `supabase config push`). Sign-up OFF, confirm e-mail ON, MFA on, asymmetric (ES256) signing keys, exposed schemas `public` only, SSL enforcement ON. Items marked Pro (leaked-password protection, session time-box) wait for Pro. [OWNER ONLY]
3. In Project settings > API copy the **Project URL** and the **publishable key** (public). Do **not** copy the secret or service-role key anywhere: nothing here uses it. [OWNER ONLY]
4. Second free project `sme-restore-drill` (same region) for the restore drill later. The free plan allows two. [OWNER ONLY]

### Migrations [OWNER ONLY to run; the plan can be read first]
From the repository root on your Mac (this is the repository's own `supabase/` project; do not use `scripts/sb`, which is for the local stacks):

```
supabase login                                  # opens the browser; [OWNER ONLY]
supabase link --project-ref <project ref>       # asks for the database password: type it hidden
supabase db push --dry-run                      # READ the list of migrations it will apply
supabase db push                                # applies them, in order, once
```
Then in the dashboard SQL editor, as `postgres`, run `supabase/hosted/verify.sql`: **every row must be `ok = true`**. If one is not, stop and tell the agent which.

### The scheduler's account [OWNER ONLY]
The worker signs in as its own account (ADR 0068). Create it once: Authentication > Users > Add user (an address such as `scheduler@<your domain>`, a long random password in the password manager, "auto confirm"), then register it as the scheduler in the SQL editor:

```sql
select app.operator_register_scheduler('scheduler@<your domain>');
```
It has no workspace and sees nothing by itself. To switch it off any time: `select app.operator_remove_scheduler('scheduler@<your domain>');`.

## Part C: Google Cloud setup [OWNER ONLY: sign in and approve; commands can be prepared]

```
gcloud auth login                                          # browser; [OWNER ONLY]
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create sme --repository-format=docker --location=asia-south1
gcloud auth configure-docker asia-south1-docker.pkg.dev
```
Docker must be running on your Mac. In Cloud Logging, exclude the request query string or set a short retention (search terms appear in query strings).

## Part D: the secrets, entered hidden [OWNER ONLY]

All server-side secrets live in **Secret Manager**, never in a file, a chat, a screenshot or a command line.

```
export PROJECT_ID=<id>
./deploy/cloudrun.sh secrets             # DRY RUN: read what it will do
./deploy/cloudrun.sh secrets --execute   # generates the suppression key and stores it WITHOUT showing it;
                                         # asks you to type the scheduler password HIDDEN (the one from Part B)
```
Then let the services read them (the service account is shown in Cloud Run > the service > Security; for a new project it is the default Compute Engine one):

```
for s in sme-suppression-hmac-key sme-scheduler-password; do
  gcloud secrets add-iam-policy-binding $s --member serviceAccount:<service account email> --role roles/secretmanager.secretAccessor
done
```
**Back up the suppression key's existence, not its value:** it turns an e-mail or a phone number into a key that survives erasure (ADR 0020). If it is lost or replaced without the rotation settings, opted-out people could be contacted again. Secret Manager keeps versions; do not delete them.

| Variable | Where | Public? |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | your shell for one deploy run (from Part B step 3) | public |
| `WEB_ORIGIN`, `API_URL` | your shell (the `run.app` addresses, or your domain) | public |
| `SUPPRESSION_HMAC_KEY` | Secret Manager `sme-suppression-hmac-key` | **secret** |
| `SCHEDULER_PASSWORD` | Secret Manager `sme-scheduler-password` | **secret** |
| model provider key (stage 2) | Secret Manager, passed with `EXTRA_SECRETS=NAME=secret:latest` | **secret** |
| database password | your password manager; typed hidden into `supabase link` and `backup-db.sh` | **secret** |

The complete list with comments is `deploy/hosting.env.example`.

## Part E: deploy the API and the web [OWNER ONLY to press; dry run first]

```
export PROJECT_ID=<id> SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key> WEB_ORIGIN=https://placeholder.invalid
./deploy/cloudrun.sh api                  # dry run: read every line
./deploy/cloudrun.sh api --execute        # builds, pushes, deploys; note the https://sme-api-....run.app address
export API_URL=https://<that api address>
./deploy/cloudrun.sh web --execute        # note the web address
export WEB_ORIGIN=https://<the web address>
./deploy/cloudrun.sh api --execute        # again, now with the real web address (CORS)
```
Then in Supabase: Authentication > URL configuration: **Site URL** = the web address; **redirect allow-list** = only `https://<web>/auth/confirm`.

Settings the script chooses (change them in the script, not by hand): region `asia-south1`; API 1 vCPU, 512 MiB, at most 2 instances; web at most 3; the API scales to zero. **Cold start:** the first request after 15 idle minutes is slow. Measure it: `curl -s -o /dev/null -w '%{time_total}\n' https://<web>/login`. If the shop would notice, add a warm instance (about USD 8 a month each) by editing `--min-instances 0` to `1` for that service (and tell the agent so it is recorded).

## Part F: verify (read-only) [ANY AGENT CAN RUN, you give it the addresses]

```
export HOSTED_SUPABASE_URL=... HOSTED_SUPABASE_PUBLISHABLE_KEY=... HOSTED_API_URL=... HOSTED_WEB_ORIGIN=...
python scripts/verify_hosted.py            # exit 0 and ALL CHECKS PASSED
```
Keep the output: it backs the gate's `hosting_ref`. Then sign up nothing and click through the login page once yourself; do not enter real customer data.

## Part G: the scheduler worker [OWNER ONLY to press]

It runs as a **Cloud Run job started by Cloud Scheduler**, one tick each time, so it costs nothing while idle. It signs in with the scheduler password from Secret Manager and acts only while the global outbox switch and the business's automatic sending are both on (they are off; and the only channel is the local stand-in, so it sends nothing to anyone).

```
export SCHEDULER_EMAIL=scheduler@<your domain>
export SCHEDULER_SA=<service account email Cloud Scheduler will use; grant it roles/run.invoker on the job>
./deploy/cloudrun.sh worker              # dry run
./deploy/cloudrun.sh worker --execute    # creates the job sme-worker and the schedule sme-worker-tick (every `WORKER_EVERY_MINUTES`, default 5, India time)
gcloud run jobs execute sme-worker --region asia-south1 --wait      # one tick now; read its log in Cloud Run > Jobs
```
Cloud Scheduler gives 3 free jobs per billing account. Change the frequency with `WORKER_EVERY_MINUTES=1` (every minute; it sets the schedule and the worker's own interval together) and run `./deploy/cloudrun.sh worker --execute` again (use `gcloud scheduler jobs update http` if the schedule job exists). The same code also runs as one always-on process (`python -m app.scheduler.worker`, tick every `SCHEDULER_INTERVAL_SECONDS`), which is only worth it at stage 2 beside the API.

## Part H: backups [OWNER ONLY for the password; the script is prepared]

* **Stage 0 (free):** there is no platform backup. Take your own as needed: from Supabase > Connect copy the **session pooler** host (works without IPv6) and the user `postgres.<ref>`, then
  ```
  BACKUP_DB_HOST=<host> BACKUP_DB_USER=postgres.<ref> ./deploy/backup-db.sh            # dry run
  BACKUP_DB_HOST=<host> BACKUP_DB_USER=postgres.<ref> ./deploy/backup-db.sh --execute  # asks the password hidden
  ```
  It writes a file in `~/sme-backups/` readable by you only. The file holds the whole database: synthetic now, personal later. Keep it on an encrypted disk, never in the repository (the script refuses a folder inside it).
* **Stage 1:** upgrade to **Pro** (Part J) *before* opening the gate: daily backups for 7 days, no pausing. Then run **`backup-restore-drill.md`** into `sme-restore-drill` and keep the record: it is the gate's fourth prerequisite. Point-in-time recovery (about USD 100 a month) is not bought.
* Both: put a reminder in your calendar monthly to confirm a backup exists and the drill still works.

## Part I: your own address and HTTPS [OWNER ONLY]

* Stages 0 and early 1: the `run.app` addresses are already HTTPS with Google's certificate. Use them.
* Your own domain (for example `app.<yourshop>.in`) on Cloud Run in Mumbai: **domain mappings do not support `asia-south1`** and are Preview. The documented route is a **global external Application Load Balancer** with a Google-managed certificate in front of the web and API services (about USD 18 a month plus traffic): one domain for both, so the browser sees one site. This is a separate small job (a plan the agent can prepare when you say yes; it costs money, so it needs your approval). Cheaper routes (a Cloudflare Worker forwarding to `run.app`, Firebase Hosting rewrite) exist but need a test of the sign-in cookies first.
* DNS records are made at your registrar: only you can. HTTPS needs nothing else; after it works set `WEB_ORIGIN`, `API_URL`, the Supabase Site URL and the redirect list to the new address and redeploy both services.
* Also needed with a domain: SPF, DKIM (and DMARC) records for the SMTP service (Part A step 4), then Supabase > Authentication > SMTP settings.

## Part J: going to Customer Zero [OWNER ONLY: the decision and the payment]

In order, none of it before the previous is done and written down:
1. Approve the spend in writing (ADR 0017): Supabase Pro USD 25 a month, plus optional warm instances and the load balancer.
2. Upgrade the Supabase project to **Pro** (Billing; keep the spend cap ON), then the Pro items of `hosted-auth-settings.md`.
3. Custom SMTP working; the invitation e-mail tested with your own address.
4. `backup-restore-drill.md` done; `verify_hosted.py` passing; the erasure timing test of `hosting-deploy.md`.
5. The DPDP review (T012) written; then the operator opens the gate (`real-data-gate.md`). Only then does any real customer record go in.

## Stopping and cleaning up
* Stop spending at once: Cloud Run > each service > Delete (the images in Artifact Registry cost cents; delete them too), Cloud Scheduler > pause or delete `sme-worker-tick`. Supabase Free costs nothing; Pro: downgrade in Billing (export first with `backup-db.sh`).
* Remove the agents' reach: `AGENTS_ENABLED=false` and `docs/runbooks/agents-kill-switch.md`.

## What this runbook does not cover (on purpose)
A real WhatsApp or e-mail sending channel (none exists; ADR 0066), rate limiting of the API (listed in `docs/pre-pilot-checklist.md`), the DPDP review, and choosing a model provider. Each needs its own decision.
