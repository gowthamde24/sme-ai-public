# Hosted verification of staging, 28 Oct 2026 (`hosting_ref` = `doc:hosting-verify-2026-10-28`)

`scripts/verify_hosted.py` (read-only) against the staging deployment: Supabase `uiallwgywitryxatcqxf`, API `https://sme-api-620338396268.asia-south1.run.app`, web origin `https://staging.stack19.com`, with the database check (`supabase/hosted/verify.sql` as `postgres`). Run with `HOSTED_ALLOWED_PROVIDERS=google`: the owner approved "Continue with Google" for people who already have an account (open sign-up stays OFF, so nobody new can arrive that way).

The first run of the day ended `FAIL` on two lines, both fixed in the script the same day (not in the deployment):
- "phone sign-in is off :: enabled": the check read Supabase's `sms_provider: twilio` label, which is sent even when phone sign-in is off. The switch is `external.phone`, which is `false`. The check now reads that.
- "no social / phone sign-in providers enabled :: google": the intended Google sign-in. The script now accepts providers named in `HOSTED_ALLOWED_PROVIDERS`, and shows them in the line.

Output of the run (no key and no database address is printed by the script):

```
PASS  open sign-up is OFF :: disable_signup = True
PASS  e-mail confirmation is ON :: mailer_autoconfirm = False
PASS  no social / phone sign-in providers enabled :: only e-mail and the allowed: google
PASS  phone sign-in is off :: external.phone = False
PASS  anon reads nothing from tenants :: HTTP 401
PASS  anon reads nothing from contacts :: HTTP 401
PASS  anon reads nothing from audit_events :: HTTP 401
PASS  anon reads nothing from erasure_requests :: HTTP 401
PASS  anon reads nothing from tenant_data_policy :: HTTP 401
PASS  schema app is not exposed :: HTTP 406
PASS  schema auth is not exposed :: HTTP 406
PASS  schema erasure is not exposed :: HTTP 406
PASS  the API description lists no private objects :: clean
PASS  API /health :: HTTP 200
PASS  API runs outside development mode :: environment = 'production'
PASS  API refuses an anonymous call :: HTTP 401
PASS  CORS allows the web origin :: allow-origin = 'https://staging.stack19.com'
PASS  CORS refuses another origin (and is never '*') :: allow-origin = None
INFO  API documentation page :: HTTP 404 (not served)
PASS  Content-Security-Policy is sent :: present
PASS  scripts run only by nonce (no unsafe-inline, no unsafe-eval) :: script-src 'self' 'nonce-/HI+AZ6W/jzGN0+gf3bzDw==' 'strict-d
PASS  the app cannot be framed :: frame-ancestors
PASS  no plugins, no base-tag tricks :: object-src, base-uri
PASS  HSTS for at least six months, subdomains included :: max-age=63072000; includeSubDomains
PASS  X-Content-Type-Options: nosniff :: nosniff
PASS  Referrer-Policy is restrictive :: strict-origin-when-cross-origin
PASS  Permissions-Policy is sent :: present
PASS  X-Frame-Options: DENY :: DENY
PASS  the framework is not advertised :: no X-Powered-By
INFO  second factor (MFA) on the project :: cannot be read from outside: confirm Authentication > Multi-factor > TOTP is ON (docs/runbooks/hosted-auth-settings.md); the database check below proves every Owner and Admin has enrolled
PASS  anon holds no privilege on any public table :: role_table_grants for anon / PUBLIC in public
PASS  clients cannot write the immutable and operator tables :: INSERT / UPDATE / DELETE / TRUNCATE by authenticated on those tables
PASS  connected as the trusted role :: current_user = postgres
PASS  definer functions owned by postgres :: all of them
PASS  every definer function pins search_path :: 622 definer functions
PASS  every Owner and Admin has a verified authenticator :: 0 Owner / Admin account(s) without one: they are refused erasure, export, member and settings changes until they enrol
PASS  execute_erasure carries its own statement timeout :: a large workspace needs longer than the client roles' 8 s
PASS  no operator-only table is readable by anon :: tenant_data_policy, erasure_requests
PASS  no trigger in public is disabled :: none
PASS  operator functions are not executable by any client role :: 23 operator functions
PASS  private schemas are closed to client roles :: no USAGE on schema erasure for anon / authenticated
PASS  RLS enabled and forced on every table with a tenant_id :: 129 tenant tables
PASS  role postgres bypasses RLS (the definer functions read forced-RLS tables as postgres) :: if false, the gate and every definer function silently see nothing: the gate stays closed
PASS  service_role holds no write privilege on any public table or view :: the key that bypasses RLS can read, never write
PASS  the contacts guards are installed and enabled (gate and erased-row) :: contacts_guard_real_data, contacts_guard_erased: present and tgenabled = O (a disabled trigger silently opens the gate)
PASS  the erasure workflow is installed :: request_erasure, execute_erasure, cancel_erasure, erasure.registry
PASS  the immutability, consent and audit guards are installed and enabled :: 618 enabled triggers in public; 23 named guards expected present
PASS  the immutable-record guard knows the erasure exception :: app.guard_immutable_record calls app.erasure_running
PASS  the provenance predicate is intact (set_created_meta, set_agent_run_id) :: both trigger functions trust exactly current_user = 'postgres'
PASS  the second-factor enforcement is installed (ADR 0016) :: require_aal2, the memberships and tenants triggers, and the four definer functions that call it
INFO  INFO accounts :: 8
INFO  INFO agents platform switch :: enabled=false
INFO  INFO workspaces :: 6
INFO  INFO workspaces with the real-data gate OPEN :: none (every workspace is closed)

RESULT: ALL CHECKS PASSED
```
