# Runbook: add a family member at a limited role

Hosted sign-up is **closed**. A person gets in by invitation and then by being added to a workspace by the operator.

1. **Invite** (dashboard > Authentication > Users > Invite user). They receive an e-mail and set a password. This needs custom SMTP,
   the redirect allow-list and the web app's confirmation route (M3: `/auth/confirm`, set-password); until then, create the user from the
   dashboard with a temporary password you hand over in person and force a change.
2. **Add them to the workspace** at the lowest role that works (SQL as `postgres`):
   ```sql
   select app.operator_add_member('family-silks', 'aunt@example.com', 'sales', 'Aunt, labels leads on her phone');
   ```
   Roles: `viewer` (read only), `sales` (label leads, create and edit records), `admin` (also archive, export, request an erasure).
   **Never `owner` here.** The reason is required (3-200 characters), recorded in the audit log, and must contain no personal data.
3. Check: they sign in and see exactly that workspace.

Errors: `23503` unknown workspace, or no such account (invite first); `22023` bad role or missing reason; `23505` already a member (change
a role in the dashboard, not here); `42501` not run as the operator.

Removing someone: delete their membership (Owner or Admin in the app, or the operator in SQL). Their past actions remain in the audit log.
Defaults for the family (decision 7): the owner is the Owner, one parent is Admin, labelers are Sales, nobody is a Viewer.
