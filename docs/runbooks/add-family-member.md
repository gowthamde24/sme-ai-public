# Runbook: add a family member at a limited role

Hosted sign-up is **closed**. A person gets in by invitation and then by being added to a workspace by the operator.

1. **Invite** (dashboard > Authentication > Users > Invite user). They receive an e-mail, open the link (`/auth/confirm`), and set a
   password (12+ characters). This needs custom SMTP, the redirect allow-list and e-mail templates from `hosted-auth-settings.md`.
   **Wait until they have accepted**: the operator function refuses an account that has not confirmed its e-mail (`SM403`). Owners and
   Admins then enrol an authenticator (`/app/security`).
2. **Add them to the workspace** at the lowest role that works (SQL as `postgres`):
   ```sql
   select app.operator_add_member('family-silks', 'aunt@example.com', 'sales', 'Aunt, labels leads on her phone');
   ```
   Roles: `viewer` (read only), `sales` (label leads, create and edit records), `admin` (also archive, export, request an erasure).
   **Never `owner` here.** The reason is required (3-200 characters), recorded in the audit log, and must contain no personal data.
3. Check: they sign in and see exactly that workspace.

Errors: `23503` unknown workspace, or no such account (invite first); `SM403` the person must accept their invitation first (not confirmed yet, deleted or banned); `22023` bad role or missing reason; `23505` already a member (change
a role in the dashboard, not here); `42501` not run as the operator.

Removing someone: delete their membership (Owner or Admin in the app, or the operator in SQL). Their past actions remain in the audit log.
Defaults for the family (decision 7): the owner is the Owner, one parent is Admin, labelers are Sales, nobody is a Viewer.
