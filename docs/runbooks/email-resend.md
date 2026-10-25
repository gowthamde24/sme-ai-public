# E-mail through Resend (job RESEND, staging first)

What sends e-mail, and from where:

| Mail | Sent by | Through |
|---|---|---|
| Sign-up confirmation, magic link, password reset, invitation | Supabase Auth | SMTP `smtp.resend.com:465`, user `resend`, the key as the password (set on the Auth settings of the project) |
| Trial reminders (day 11 and day 13 of the 14-day trial), "WhatsApp not connected" reminders (30, 60, 90 days), read-only reminders | the worker (`sme-worker`) | Resend's HTTP API (`app/billing/resend_sender.py`), `BILLING_EMAIL_SENDER=resend` |

From `Stack19 <noreply@stack19.com>`, reply-to `support@stack19.com`. The domain stack19.com is verified in Resend (Tokyo) with DKIM, SPF and DMARC in Cloudflare; open and click tracking are off, and the messages carry no images or links of their own. The app reminders are English, Telugu and Hindi (the workspace's assistant language when it is one of these, else English); Telugu and Hindi are drafts for native review. They go out only while the platform's billing switch is on (`billing_enforced`, off by default), never to an exempt workspace, and a failed send is not marked, so it is offered again on the next tick (a retry carries the same Idempotency-Key, so Resend drops a duplicate).

## The key
Secret Manager `sme-resend-api-key` (project project-2757c07e-37d2-4167-88f). `sme-api-run` and `sme-worker-run` can read it. Never print it. `deploy/staging.sh` passes it to the API and the worker with `--set-secrets RESEND_API_KEY=sme-resend-api-key:latest`.

## Staging, in order
1. `python3 -I scripts/apply_auth_smtp.py` (dry run), then `--apply`: puts Resend on the Auth settings of the STAGING project only (the reference is fixed in the script; the key is read from Secret Manager and sent to the Management API, never printed) and raises the Auth e-mail limit to 30 an hour.
2. `python3 -I scripts/apply_auth_templates.py --project-ref uiallwgywitryxatcqxf --apply`: the four branded templates (`supabase/templates/*.html`: orange #c2410c, short, "Stack19 Team"). Templates can only be changed once a custom SMTP provider is set (step 1 first).
3. `supabase db push` (the trial-reminder tables), `make deploy-staging`.
4. Check: ask for a magic link from https://staging.stack19.com/login to an address you own and look at the message headers: `spf=pass`, `dkim=pass`, `dmarc=pass` (in Gmail: "Show original").

## Production
Not done. Same steps for the production project with its own reference, after the owner decides; the script refuses any other reference than staging until it is changed on purpose.
