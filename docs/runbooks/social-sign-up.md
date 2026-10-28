# Runbook: Google and Facebook sign-up (job CK)

Sign-up asks one thing, the **business type**, then offers **Continue with Google**, **Continue with Facebook** and **Continue with e-mail**, with the line "By continuing you agree to the Terms and Privacy policy". Everything else is asked later, in context.

## How it is wired

* Supabase Auth does the sign-in. The API never sees a provider secret.
* **Off when missing.** Each provider is configured by environment. The committed `supabase/config.toml` has both switched **off** with `env(...)` placeholders; the API offers a button only when its **public** id is set (`AUTH_GOOGLE_CLIENT_ID`, `AUTH_FACEBOOK_APP_ID`). `GET /v1/auth/providers` (no sign-in) says which are on; the web reads it. With nothing set, only e-mail is offered.
* **Link by verified e-mail only.** Supabase links a social sign-in to an existing account by e-mail only when the provider says the address is verified; `enable_manual_linking` stays `false` in `config.toml` and must stay off in the hosted project. The setup (`complete_setup`) adds a second lock: it refuses an account whose address Supabase did not confirm, or that a provider marked unverified (SM309, `email_not_confirmed`).
* **Terms recorded.** An e-mail sign-up records the terms version from the sign-up metadata (job AD). A social sign-up has no form, so `POST /v1/account/setup` takes `accepted_terms_version` (and the privacy version), writes it to the acceptance record **before** the business is made, and `complete_setup` accepts either evidence (SM308 otherwise).
* **The second factor is not asked at sign-up.** It is asked at the first action that needs one: approving a quote, a follow-up, an outbox message, a call or an order; connecting WhatsApp; the other Owner and Admin acts of ADR 0016. The database refuses those at aal1 (SM306 `mfa_required`). `GET /v1/account/security` says where the session stands.

## Turn Google on (owner steps, by hand; nothing here is automated)

1. Google Cloud console: an OAuth client of type Web; authorised redirect URI = the Supabase callback of the project (`https://<project>.supabase.co/auth/v1/callback`). Public use needs Google's OAuth verification (blueprint section 10: a domain and a privacy page).
2. Supabase dashboard (hosted: by hand, **never `supabase config push`**) > Authentication > Providers > Google: paste the client id and secret, enable. Leave "Allow manual linking" off and "Confirm e-mail" on.
3. API environment: `AUTH_GOOGLE_CLIENT_ID=<the same public client id>` (not the secret). Redeploy. `GET /v1/auth/providers` now says `google: true`.

## Turn Facebook on

1. Meta for Developers: an app with Facebook Login; valid OAuth redirect = the same Supabase callback. Public use needs Meta app review and business verification (blueprint section 10).
2. Supabase dashboard > Providers > Facebook: app id and secret, enable.
3. API environment: `AUTH_FACEBOOK_APP_ID=<the app id>`.

## Try one on the local stack

Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (or the Facebook pair) in your shell, change `enabled = true` for that provider in **your copy** of `supabase/config.toml` (do not commit it), restart the stack, and set the API's public id. The CLI refuses a provider that is enabled without its keys, which is why the committed file keeps them off.

## What cannot be checked offline

A real Google or Facebook round trip needs the owner's accounts, so it has not been run. What is proved without them: the setup refuses an unverified address (pgTAP 95), accepts the terms by acceptance record, treats a social account as "needs setup" until it has a business (pgTAP 95), the provider list is off by default and never carries a secret (`tests/test_ck_routes.py`), and the committed config is off with no literal key (`tests/test_supabase_config.py`).

## Google on the sign-in page (staging, 27 Oct)
* `/login` draws **Continue with Google** whenever `GET /v1/auth/providers` says `google: true`, that is whenever the API has `AUTH_GOOGLE_CLIENT_ID` (staging: set in `deploy/staging.sh`, it is the public id of the client `stack19-staging`). It does not depend on the sign-up being open.
* It **signs existing people in and makes nobody**: the Auth server's "Allow new users to sign up" stays OFF on staging (`enable_signup = false`), and while it is off an unknown Google address is refused by the Auth server; the return (`/auth/callback?error_code=signup_disabled`) ends on `/login?notice=nosignup` with "There is no account for that Google address, and sign-up is closed for now." A Google address that matches an existing, confirmed account is linked to it by e-mail (manual linking stays off).
* Supabase Auth > URL configuration must list `https://staging.stack19.com/**` (Redirect URLs) and have `https://staging.stack19.com` as the Site URL; otherwise the Auth server sends the browser to the Site URL instead of `/auth/callback`. Read it back without changing anything: `supabase config diff --agent no --output-format json` (look at `auth.additional_redirect_urls`; never `config push`).
* Test to Google's own page (it stops there, nothing is typed): `node e2e/staging-google-signin.mjs https://staging.stack19.com`.
