# Runbook: the sole Owner asks to be erased

The app refuses (`SM305`) to erase the contact record of a workspace's **only** Owner (ADR 0014, open question 2): ownership is
transferred first. Normally the Owner adds a second Owner through the Members screen and the erasure then runs. When that is not
possible (the Owner cannot sign in, or the person asking is not at the keyboard), the operator makes the exception.

## Rules
1. **Verify the identity out of band.** Not by reply to an e-mail from the account. Call or meet the person on a number or at a place you
   already knew, or have a second family member who knows them confirm. Do not proceed on a message alone.
2. **Write down how you verified** (who, how, when). This text becomes the audit reason, so it must contain **no personal data**: no phone
   number, no address, no full name. "Verified by video call with the Owner's sibling, 2026-10-05" is fine.
3. The person to be erased must have a **successor**: an existing account (invited, confirmed) of someone who will own the workspace.

## Steps (SQL as `postgres`; hosted: the SQL editor)
```sql
-- 1. add the successor as a second Owner, with the recorded reason (20+ characters)
select app.operator_add_owner_exception('family-silks', 'successor@example.com',
  'Verified by video call with the Owner and a second family member, 2026-10-05');
-- 2. the Owner's contact record can now be erased in the app (Privacy page); the successor, as an Owner, can run it.
```
Then, if the person is leaving the workspace, remove their membership in the dashboard or with the members API, **after** the erasure.

Errors: `22023` reason shorter than 20 characters; `23503` unknown workspace or no such account (invite the successor first);
`23505` already a member.

The audit log records `membership.operator_added_owner` with the reason, as the system.

## What stays
The person's sign-in account (`auth.users`) and display name are staff data, not workspace records (ADR 0014). Delete the account in the
dashboard when appropriate. Their past actions stay in the audit log by user id.
