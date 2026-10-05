# Runbook: deploying the staging environment (manual, by the owner)

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
export PROJECT_ID=...  SUPABASE_URL=https://<ref>.supabase.co  SUPABASE_ANON_KEY=<public anon key>  WEB_ORIGIN=https://<web url>
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
export HOSTED_SUPABASE_URL=...  HOSTED_SUPABASE_ANON_KEY=...  HOSTED_API_URL=...  HOSTED_WEB_ORIGIN=...
export HOSTED_DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres   # optional
python scripts/verify_hosted.py
```
Exit 0 and `ALL CHECKS PASSED`. Keep the output: it backs the gate's `hosting_ref`. The script sends only GET and OPTIONS requests and its
database step is read-only.

## Monitoring
An uptime check on `https://<api>/health` with an e-mail alert; the Cloud Run budget alert; Supabase's spend cap.

## Not built yet (M3 and later)
`/auth/confirm` and set-password routes; security headers and CSP on the web app; MFA enrolment; API rate limiting. See the checklist.
