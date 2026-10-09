# Runbook: hosted Supabase Auth and API settings (checklist)

> **Deferred (2026-10-05):** The hosted settings are applied in the Customer Zero stage (T012). Nothing is hosted before (ADR 0017).

**Never run `supabase config push` against a hosted project without the owner's explicit approval.** `supabase/config.toml` carries
local-only values (`sign_in_sign_ups = 200`, e-mail confirmation off, 6-character passwords). Pushing it would apply them. Set the hosted
project by hand from this list, then run `scripts/verify_hosted.py`, which checks the parts it can see.

Set in the Supabase dashboard (names are the dashboard's; they move, look for the meaning):

## Sign-in
- [ ] **Allow new users to sign up: OFF** until the owner decides to open sign-up on the hosted project. (Authentication > Sign In / Providers.)
      People are invited, then added to a workspace by the operator (`add-family-member.md`). `verify_hosted.py` checks `disable_signup`.
      The app has open sign-up built and working locally (ADR 0061, job AD); turning this ON hosted also needs the rows added to
      `docs/pre-pilot-checklist.md` (rate limits and CAPTCHA, the terms text) and the "Confirm sign-up" template
      below pointing at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/app`. Never `supabase config push` the local file.
- [ ] **Confirm e-mail: ON.** (`mailer_autoconfirm` must be false.) The web app's `/auth/confirm` route exists (M3a); the e-mail templates below must point at it.
- [ ] **E-mail provider only.** Every other provider and phone sign-in OFF.
- [ ] **Password:** minimum length 12 or more; require mixed character types; **leaked-password protection ON** (Pro plan).
- [ ] **Sessions:** a time-box (for example 7 days) and an inactivity timeout (for example 8 hours) (Pro plan).
- [ ] **MFA (TOTP): enrol and verify both ON** for the project. The app has the enrolment screen (`/app/security`) and enforces aal2 for
      Owner and Admin on privileged actions in the database and the API (ADR 0016). If this setting is off, Owners cannot enrol and are
      locked out of those actions. The setting cannot be read from outside; `scripts/verify_hosted.py` checks the other side (the database
      enforcement is installed; every Owner/Admin has a verified authenticator). Lost device: `mfa-recovery.md`.
- [ ] **Rate limits** reviewed (sign-in, token refresh, e-mail sending). Defaults are generous.

## URLs and e-mail
- [ ] **Site URL** = the web app's https origin. **Redirect allow-list** = only `https://<web>/auth/confirm`. No wildcards.
- [ ] **E-mail templates** (Invite, Reset password, Confirm sign-up) link to the app, not to Supabase's verify URL, using the token hash:
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (and `type=recovery`, `type=email`).
      The page shows a Continue button and verifies on click, so a mail scanner that opens the link does not use up the one-time token.
- [ ] **Custom SMTP** configured (the built-in sender is heavily limited and not for real users); sender domain verified (SPF, DKIM).
- [ ] E-mail templates say who you are and carry no personal data.

## Web app headers (checked by `verify_hosted.py`, GET/OPTIONS only)
- [ ] The web origin answers with `Content-Security-Policy` (nonce, no `unsafe-inline` scripts, `frame-ancestors 'none'`),
      `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- [ ] The API sends **no** CORS headers unless `API_CORS_ORIGINS` lists explicit https origins (the web app calls the API server-side, so the
      default is none). A `*` value is refused at startup.

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
