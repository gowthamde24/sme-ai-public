# Runbook: hosted Supabase Auth and API settings (checklist)

**Never run `supabase config push` against a hosted project without the owner's explicit approval.** `supabase/config.toml` carries
local-only values (`sign_in_sign_ups = 200`, e-mail confirmation off, 6-character passwords). Pushing it would apply them. Set the hosted
project by hand from this list, then run `scripts/verify_hosted.py`, which checks the parts it can see.

Set in the Supabase dashboard (names are the dashboard's; they move, look for the meaning):

## Sign-in
- [ ] **Allow new users to sign up: OFF.** (Authentication > Sign In / Providers.) People are invited, then added to a workspace by the
      operator (`add-family-member.md`). `verify_hosted.py` checks `disable_signup`.
- [ ] **Confirm e-mail: ON.** (`mailer_autoconfirm` must be false.) Needs the confirmation route in the web app (`/auth/confirm`: M3, not built).
- [ ] **E-mail provider only.** Every other provider and phone sign-in OFF.
- [ ] **Password:** minimum length 12 or more; require mixed character types; **leaked-password protection ON** (Pro plan).
- [ ] **Sessions:** a time-box (for example 7 days) and an inactivity timeout (for example 8 hours) (Pro plan).
- [ ] **MFA (TOTP): ON** for the project. The app has no enrolment screen yet (checklist): until it does, Owners and Admins cannot enrol.
      Decision 7 wants a second factor for Owner and Admin before the gate opens: build the enrolment (or accept in writing) first.
- [ ] **Rate limits** reviewed (sign-in, token refresh, e-mail sending). Defaults are generous.

## URLs and e-mail
- [ ] **Site URL** = the web app's https origin. **Redirect allow-list** = only `https://<web>/auth/confirm` (and the password-reset route
      when it exists). No wildcards.
- [ ] **Custom SMTP** configured (the built-in sender is heavily limited and not for real users); sender domain verified (SPF, DKIM).
- [ ] E-mail templates say who you are and carry no personal data.

## Keys and tokens
- [ ] **JWT signing keys: asymmetric (ES256)**, and `SUPABASE_JWT_ALGORITHMS=ES256` on the API. The API refuses to start otherwise.
- [ ] The **publishable / anon key** is the only key in the web build and the API settings. **The service-role key is not used by anything
      in this repository: never put it in an environment, a build argument, a screenshot or a chat.**
- [ ] The **database password** is kept by the operator only (a password manager), used for `psql` and nothing else.

## Data API (PostgREST)
- [ ] **Exposed schemas: `public` only** (not `app`, `erasure`, `auth`). `verify_hosted.py` checks that `app`, `auth` and `erasure` are refused.
- [ ] **GraphQL: disabled** (not used). Row limit sane (the API pages at 20-100).
- [ ] Network restrictions are not needed for the API's own calls (they come from Cloud Run) but SSL enforcement is ON.

## Backups
- [ ] Daily backups ON (Pro: 7 days). PITR not bought for staging. Test with `backup-restore-drill.md`.

## After every change
Run `scripts/verify_hosted.py` (see `hosting-deploy.md`) and keep its output with the gate's `hosting_ref`.
