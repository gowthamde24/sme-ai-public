# Production, the waitlist slice: what ONLY YOU do (click / type), in order

**Nothing here has been run.** Written 12 Nov 2026 by C1. The plan and the reasons are in `production-waitlist-slice.md` (the slice) and `production-bringup.md` (everything after it). Legend: **[YOU]** a click or a typed secret only you can do; **[C1]** the agent does it once you say go. Every deploy is a dry run until you add `--execute` and `PROD_CONFIRM=<commit>`; nothing else touches production. Stop lines stay: no real customer data, real-data gate closed, telephony off, dialer off, no WhatsApp Cloud API, privacy text a draft until you approve it.

**Decisions I need from you before step 1** (answer in one line each): (a) Supabase **Pro**, compute **Small** (about USD 25 + 15 a month, the replay against Small is done before go-live); (b) the e-mail address for production alerts; (c) the scheduler account address (e.g. `scheduler@stack19.com`, any address you control: the worker signs in as it); (d) the privacy text and its version string (planned `2026-11-v1`, NOT approved).

## Step 1. Accounts [YOU] (about 20 minutes)
1. **Supabase**: upgrade your organisation to **Pro**; create the project `sme-prod` in **Mumbai (ap-south-1)**, compute **Small**. Choose a database password and keep it in your password manager (you type it later, I never see it). Note the **project reference** (the 20 letters in its URL).
2. **Google Cloud**: create a NEW project (e.g. `stack19-prod`) and **link it to the billing account "My Billing Account"** (the one with the Google for Startups credits). Note the **project id** and the **project number**.
3. Tell me the three values (project id, project number, Supabase reference): they are public ids, not secrets.

## Step 2. Fill the public ids [YOU + C1]
Copy `deploy/production.env.example` to `deploy/.env.production` (git ignores it) and fill `PROD_PROJECT_ID`, `PROD_PROJECT_NUMBER`, `PROD_SUPABASE_REF`, `PROD_SCHEDULER_EMAIL`. Optional: `PROD_SITE_ORIGIN=https://stack19.com`. I read it and run `PROD_SLICE=waitlist deploy/production.sh preflight` (read-only).

## Step 3. Database [YOU type the password, C1 reads the output]
In your terminal (prefix `!` here to run it in this session):
`supabase link --project-ref <ref>` (asks the database password), then `supabase db push --dry-run` (I read the list of migrations with you), then `supabase db push`, then run `supabase/hosted/verify.sql` in the Supabase SQL editor: **every row must say ok = true**. Then do `supabase/hosted/hosted-auth-settings.md` by hand in the dashboard (session timeout, e-mail templates, redirect URLs). Register the scheduler account as the runbook says.

## Step 4. Backups [YOU click, both check]
Dashboard, Database, Backups: confirm the **daily backup is on** and **the first backup exists** BEFORE the form is switched on. Then the restore drill into a scratch project (`backup-restore-drill.md`), timed. I write the result down.

## Step 5. Google side [YOU press, C1 prepared]
In the new project, in order: enable the APIs, create the Artifact Registry repository `sme`, the service accounts `sme-api-run`, `sme-build`, `sme-worker-run`, `sme-tick`, the budget alert (`deploy/budget-alerts.sh`, dry run first). I paste you the exact commands from `production-bringup.md` step 5; each is read-then-run.

## Step 6. Secrets: typed at a HIDDEN prompt, in YOUR terminal only [YOU]
Four secrets for the slice. The value is typed (nothing shows) and piped to Secret Manager; it never appears in the chat, in a file or on a command line:
```
read -rs -p "value: " V; echo; printf %s "$V" | gcloud secrets create <NAME> --project <prod project id> --replication-policy=automatic --data-file=-; unset V
```
for `<NAME>` = `sme-turnstile-secret` (the Cloudflare Turnstile **secret key** of the production site widget), `sme-resend-api-key` (Resend, the production sending key), `sme-scheduler-password` (a new strong password; also what you used to register the scheduler account), and `sme-suppression-hmac-key` (let `deploy/cloudrun.sh secrets --execute` generate it, nobody sees it). Then I print the grants (each service account gets access to ITS secrets only) and you press them.

## Step 7. First deploy [YOU confirm, C1 runs]
`PROD_SLICE=waitlist PRIVACY_VERSION=2026-11-v1 deploy/production.sh deploy all` is a **dry run**: we read every line together (API from `deploy/settings/production-waitlist/`: agents off, telephony off, scale to zero; plus the worker). Only then: `... deploy all --execute` with `PROD_CONFIRM=<the commit id preflight printed>`. **Do not use `2026-11-v1` until you approved the text** (until then WAITLIST stays off and the API runs with a clearly marked test value that I never switch the site to).

## Step 8. Verify [C1, you choose the alert address]
`scripts/verify_hosted.py` against the production API must end `ALL CHECKS PASSED`; `ALERT_EMAIL=<yours> deploy/production-alerts.sh` (dry run, then `--execute`) and we trigger each alert once; `rollback` then `latest`; drill 3 and 4.

## Step 9. Switch the waitlist on [YOU approve, C2 builds]
You approve the privacy text and its version string; I make one test entry through the production API and remove it with `operator_delete_waitlist_entry`; C2 builds the site with `WAITLIST=1`, `WAITLIST_API_BASE=<production API>`, `TURNSTILE_SITE_KEY=<site key>`; you press the deploy of the site (`website-go-live.md` step 8, `sme-site` moves into the production project). We watch the first real entry.

## What you never have to do
Type a secret into this chat; run a command you have not seen first; approve a deploy of a commit that is not the one `preflight` printed.

## Later (not the slice)
Plivo number and KYC, Anthropic / Sarvam / Cartesia keys, the always-on API (about USD 44 a month), the app on `app.stack19.com`: `production-bringup.md` steps 5 to 13, after the slice is live.
