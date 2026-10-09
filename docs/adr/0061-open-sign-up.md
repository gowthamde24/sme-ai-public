# ADR 0061: Open sign-up, the free-trial plan and the first-login setup

Status: built locally (job AD, 2026-10-09); nothing deployed, nothing pushed to a hosted project. Related: ADR 0001, 0002, 0003, 0016, 0060.

## Context
The v2 port needs a front door: a person finds the site, signs up, confirms their e-mail address and lands in their own business. Until now
accounts were invited and added to a workspace by the operator, and sign-up was closed (ADR 0003). The first businesses are on a free trial
with one workspace.

## Decision
1. **Supabase Auth does the sign-up and the confirmation.** `enable_confirmations = true` (local `supabase/config.toml`). The confirmation mail
   links to the app's own `/auth/confirm?token_hash=...&type=email&next=/app` page (template `supabase/templates/confirmation.html`), which asks
   for a button press before it uses the token, so a mail scanner cannot use it up. Locally every mail goes to the local mail catcher
   (`http://127.0.0.1:54324`); no SMTP is configured, so nothing can leave the machine. No session exists until the address is confirmed.
2. **Terms.** The sign-up carries `terms_version` ("draft-1" for now) in its metadata. A trigger on `auth.users` copies it into
   `public.terms_acceptances` with the **database's** clock. A client reads its own row and writes nothing.
3. **One business per account, made at the first confirmed login** by `public.complete_setup(business_type, language)`: it makes the tenant (name
   from the sign-up, a readable slug plus a random tail), the Owner membership and a row in `public.account_setups`, in one transaction, serialised
   per account by an advisory lock, so a double click or a second tab ends with the same single business. The business name can only come from the
   sign-up, never from the setup call. It refuses if the e-mail is unconfirmed (SM309), the terms were not accepted (SM308) or the account already
   owns a workspace (SM307). `public.get_account_setup()` says `none | needed | done`.
4. **The plan and the workspace limit** (D1). `tenants.plan = 'free_trial'`, `workspace_limit = 1`, `trial_started_at`. Clients can read them, never
   write them. A trigger on `memberships` refuses an owner row that would take a person past their limit (SM307) however it arrives; a client's
   forbidden write is still refused first by row-level security.
5. **The API decides nothing.** `GET/POST /v1/account/setup` and `GET /v1/tenants/{id}` pass the caller's own token to PostgREST; the database checks.
6. **Per-address brake.** At most N sign-ups per hour per address (`SIGNUP_MAX_PER_HOUR`, default 5), counted **in the web process's memory**
   (`apps/web/lib/auth/signup-limit.ts`). It is not shared between instances, starts again on a restart, keeps no personal data, and does not stop
   someone who talks to the Auth server directly. A database-backed counter would need a function callable by `anon`, which the catalog guard
   (pgTAP 06) forbids for good reason, and a table anyone could fill; that is why it is not one. The real controls are the Auth server's own rate
   limits and a CAPTCHA at the edge (pre-pilot checklist).

7. **Reads for the Today screen and the office** (D3). `GET /v1/tenants/{id}/today`, `.../ai-usage/today`, `.../agents/status`. Two new
   read-only SECURITY INVOKER functions (`today_summary`, `agents_status`) and the existing `agent_cost_summary`; every row is read under the caller's
   own row-level security. What is "waiting for you" is by role: quote drafts and follow-up message drafts for Owner and Admin, closed orders that
   still hold money for the Owner (recording a refund is the Owner's); Sales get the cards and the recent steps, a Viewer gets zeros. `followup_due`
   means a follow-up **draft** waiting for approval, not a lead whose gap has elapsed: that needs the pinned cadence engine, which runs in the API and
   not in a single query. AI spend is `public.ai_usage_today` (Owner or Admin) in paise, for the **Asia/Kolkata day** (owner review 2026-10-09; a call belongs to the day it was authorised), counting money reserved by a call in flight as spent, rounded up; the cap rounded down. A micro is a millionth of a rupee. The daily cap itself is still enforced per UTC day by the database; the screen's "left" can be zero while a call is still allowed on the UTC day.

## Consequences
- **No account enumeration (owner review 2026-10-09, ADR 0003 stands).** `signUp` answers `{ ok: true, next: "check-email" }` for an address that already has an account too, held to the same minimum duration as a new sign-up; there is no `email_taken`. The owner of the address simply gets no new mail. The Auth server's own answer for an existing address (a 422 locally, a user with no identities on a hosted project) never reaches the screen.
- **Local tooling confirms its own throwaway accounts** through the local database container (`scripts/local_confirm.py`, `e2e/lib.mjs`), the same
  channel the demo seed already uses for the authenticator secret. The real link path is covered by `tests/integration/test_open_signup.py`.
- **Hosted**: "Allow new users to sign up" stays OFF in `docs/runbooks/hosted-auth-settings.md` until the owner decides to open sign-up there; the
  local config must never be pushed (`supabase config push`).
- The terms text, the privacy notice and the trial rules (length, what happens at the end) are not written; `draft-1` is a placeholder. The trial
  has a start date and no end date: nothing expires.
