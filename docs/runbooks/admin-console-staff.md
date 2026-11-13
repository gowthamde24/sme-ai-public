# Admin console: Stack19 staff accounts (13 Nov 2026)

The console is for Stack19 staff only (roles `owner`, `support`, `finance`; exactly one `owner`). Plan: `docs/plans/admin-console.md`. API: `docs/contracts/admin-console.md`. Switch: `ADMIN_CONSOLE` (on in staging, off in production).

## Create a staff account (the person does it, in their own terminal)
```
! python3 -I scripts/admin_staff_register.py --i-know-this-creates-staff-in-staging --project-ref uiallwgywitryxatcqxf \
    --api-url https://sme-api-620338396268.asia-south1.run.app --email <their e-mail> --name "<Their Name>" --role owner|support|finance
```
Run it from a checkout linked to the staging project (`supabase/.temp` present). It asks for the password and the authenticator code at hidden prompts. A QR code is drawn in the terminal for your authenticator app (no image file is made); the setup key itself is never printed unless you add `--show-secret` to type it by hand. Nobody else sees the password. A staff account belongs to no workspace; a shop owner's account cannot be made staff.

## Rules the database enforces on every admin call
Active staff row, the role, a second factor in THIS session (always), and a live session: **30 minutes without a call ends it** (sign in again). Every list, access, read and audit view is written to the append-only trail. Looking at one business needs a reason first (15-minute access); the shop owner sees it in their activity log; end-customer names and numbers are masked.

## Rotation and removal
- **Rotate a password**: the person runs the script again with `--reset-password` (hidden prompt), or uses "forgot password". Old sessions end by themselves within 30 minutes of inactivity; to cut one off at once, remove and re-register the account (below) or revoke it in the Supabase dashboard (Authentication > Users > the person > sign out).
- **Rotate the authenticator**: remove the factor in the Supabase dashboard (Authentication > Users > the person > MFA), run the script again with the same e-mail and password: it enrols a new one.
- **Remove a person**: `supabase db query --linked "select app.operator_remove_staff('their@email')"` (switches the account off at once; the audit rows stay).
- **The owner role** is one person: moving it means `operator_remove_staff` for the old owner first, then registering the new one with `--role owner`.
- The generated secrets of this feature live nowhere in git; the script never stores a password or a factor secret.
