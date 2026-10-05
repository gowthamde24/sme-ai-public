# Runbook: deploying the staging environment (manual, by the owner)

> **Deferred (2026-10-05):** This runbook is for the Customer Zero stage (T012). Nothing is deployed before; the hosting recommendation is deferred, re-check prices then (ADR 0017).

Nothing here has been run. It needs accounts only the owner can create (ADR 0015 recommends Supabase Pro in Mumbai plus Google Cloud Run
in `asia-south1`). Every command is printed by `deploy/cloudrun.sh` before it runs; the script is a **dry run unless you pass `--execute`**.

## Accounts and one-time setup (owner)
1. **Supabase**: a Pro project in **Mumbai (`ap-south-1`)**; spend cap on. Apply `hosted-auth-settings.md`.
2. **Google Cloud**: a project, billing, a **budget alert** (there is no hard cap), Artifact Registry repository `sme` in `asia-south1`,
   the `gcloud` and `docker` tools signed in. Cloud Logging: exclude the request URL's query string or set a short retention (search
   terms appear in query strings).
3. **Domain and SMTP** when invitations are needed.

## Database
Apply the migrations to the hosted project from your laptop, **once per migration, in order** (`supabase link` then `supabase db push`
shows the plan first; read it). Then run `supabase/hosted/verify.sql` as `postgres` (SQL editor): every row must be `ok = true`. The
trusted role must own the definer functions (the migrations run as `postgres`, so they do; the check proves it).

## Deploy
```
export PROJECT_ID=...  SUPABASE_URL=https://<ref>.supabase.co  SUPABASE_PUBLISHABLE_KEY=<public publishable key>  WEB_ORIGIN=https://<web url>
./deploy/cloudrun.sh api              # dry run: read it
./deploy/cloudrun.sh api --execute    # then:
export API_URL=https://<api url printed by gcloud>
./deploy/cloudrun.sh web --execute
./deploy/cloudrun.sh api --execute    # again, now that WEB_ORIGIN is the real web URL (CORS)
```
The API needs **no secret** (it acts with each user's JWT); the three values the web build takes are public by design. The API refuses to
start if its auth settings are missing or not https (`API_ENV=production`). Agents stay off: `AGENTS_ENABLED=false`.
The API deploys on **request-based CPU, scaling to zero** (about $0-2 a month): enough while agents are off. To turn agents on, redeploy with
`CPU_ALWAYS=true AGENTS_ENABLED=true` (instance-based billing, one warm instance, about $54 a month); the script refuses `AGENTS_ENABLED=true`
without `CPU_ALWAYS=true`, because agent threads stall when the CPU is throttled. See ADR 0015.

## Verify (read-only)
```
export HOSTED_SUPABASE_URL=...  HOSTED_SUPABASE_PUBLISHABLE_KEY=...  HOSTED_API_URL=...  HOSTED_WEB_ORIGIN=...
export HOSTED_DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres   # optional
python scripts/verify_hosted.py
```
Exit 0 and `ALL CHECKS PASSED`. Keep the output: it backs the gate's `hosting_ref`. The script sends only GET and OPTIONS requests and its
database step is read-only.

## Erasure timeout on the hosted project (measure once, before any real data)
`execute_erasure` carries a 300 s statement timeout, and the web waits 120 s for it (measured locally: about 0.3 ms per row). A hosted
gateway may cut a long request earlier than either. On the hosted **staging** project, with a synthetic workspace of about 30,000 rows
(`scripts/scale_erasure.py` builds one), run a workspace-wide erasure from the Privacy page and note the time and any 5xx or timeout. If
the gateway cuts it earlier, an erasure that big is run by the operator in SQL (as `postgres`, no gateway), and the Privacy page says so.
Record the result with the hosting reference. (Not measured yet: no hosted project exists.)

## Monitoring
An uptime check on `https://<api>/health` with an e-mail alert; the Cloud Run budget alert; Supabase's spend cap.

## Not built yet (M3 and later)
API rate limiting. (The `/auth/confirm` and set-password routes, MFA and the security headers were built in M3a.) See the checklist.
