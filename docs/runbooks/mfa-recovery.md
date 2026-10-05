# Runbook: an Owner or Admin lost their authenticator (ADR 0016)

Owners and Admins need a second factor (TOTP) for privileged actions: erasure, member and role changes, export, workspace settings.
There are no recovery codes in v1. A person who loses their phone is locked out of those actions until the operator resets the factor.

## What the person does
1. Sign in with e-mail and password. The workspace opens, but privileged actions are refused and the page says so.
2. Tell the operator **in person or by a call you place to a number you already know**. Never act on an e-mail, a text or a chat message alone.

## What the operator does
1. **Verify who it is out of band** (you know them; call them back). If you cannot be sure, stop.
2. Run as `postgres`, with a reason of 20+ characters and no personal data:
   ```sql
   select app.operator_reset_mfa('owner@example.com', 'Phone lost; identity confirmed by call-back to the known number');
   ```
   This removes every authenticator of that account **and ends all of its sessions** (the lost device may be in someone else's hands).
   It writes `mfa.operator_reset` to the audit log of every workspace the person belongs to.
3. The person signs in with the password and enrols a new authenticator on the Security page (`/app/security`).
4. Check the audit log shows the reset, and that the person now sees "Authenticator on".

Errors: `23503` no such account; `22023` reason too short or not clean; `42501` not run as the operator.

## If the password is also in doubt
Reset the password first (dashboard > Authentication > Users, or the "Forgot password" page), then the factor. Reset the password **before**
the factor, otherwise whoever holds the password can enrol their own authenticator.

## Limits to know
- TOTP does not stop a live phishing page that relays the code. Passkeys are a later hardening (checklist).
- The sole Owner who loses a device and cannot be verified: do not reset; follow `sole-owner-erasure.md` thinking and involve the family.
