# Runbook: opening and closing the real-data gate

Each workspace starts **closed**: its contacts may carry only a reserved e-mail domain (`example.test` and friends) and a phone that
starts `+00` (ADR 0015). While closed, anything else is refused by the gate itself (`SM401`), including a malformed e-mail or one with
invisible characters. Opening it lets real contact details in. Only the **operator** (a person with the database-owner login) can,
and only with four recorded prerequisites. Everything here is plain SQL run as the `postgres` role.

Where to run it: **local** `docker exec -i supabase_db_<project_id> psql -U postgres -d postgres`; **hosted** the SQL editor. Confirm first:
`select current_user;` must say `postgres`.

## Which workspace (Customer Zero)

Customer Zero uses a **new workspace created after the hosted deploy**. The demo / synthetic workspace is **never opened**: it holds
fictional data and must stay closed (or be deleted) for good.

How a new workspace is created today: **there is no operator function for it.** The family's Owner signs in to the hosted web app and
creates it on the Workspaces page ("Create a workspace"); that person becomes its Owner, and it starts **closed**. Nothing was built for
the operator to create one on someone's behalf, and none is needed yet. Then add the family at limited roles (`add-family-member.md`).

Before you open it: run the hosted verifier (`scripts/verify_hosted.py`, `hosting-deploy.md`) and record its output with the hosting
reference. `hosting_ref` points at that record: the deployment AND the verifier's `ALL CHECKS PASSED` for the day you open.

## The four prerequisites (all four, every time)

| Reference | What must be true | Example reference |
| --- | --- | --- |
| `erasure_ref` | the erasure workflow is shipped and reviewed (the function checks it is installed) | `adr:0014` |
| `hosting_ref` | the hosted deployment exists and `scripts/verify_hosted.py` ends `ALL CHECKS PASSED` (keep the output) | `doc:hosting-2026-10` |
| `dpdp_review_ref` | the India DPDP legal review is done and filed (also covers the HMAC suppression list before outreach) | `doc:dpdp-review-2026-10` |
| `restore_drill_ref` | a backup was restored on a throwaway project, `verify.sql` passed there, executed erasures were re-applied (`backup-restore-drill.md`) | `doc:restore-drill-2026-10` |

A reference is `kind:token` (letters, digits, `. _ # / -`). It points at a document you keep; the database records it, it cannot read it.
Before you open it, also confirm (not enforced by the database): the family has been told what goes in and what does not; Owner and
Admin accounts have a second factor if the project offers it (`hosted-auth-settings.md`); the budget alert exists.

## Open one workspace

```sql
select app.operator_open_real_data_gate(
  'family-silks',                 -- the workspace slug
  'adr:0014', 'doc:hosting-2026-10', 'doc:dpdp-review-2026-10', 'doc:restore-drill-2026-10');
```

Errors: `22023` a reference is missing or not `kind:token`; `23503` unknown workspace; `SM402` the erasure workflow is not installed;
`42501` you are not running as the operator (a request identity is present).

Check: `select * from public.tenant_data_policy;` and the audit trail
`select created_at, action, new_values from public.audit_events where entity_type = 'tenant_data_policy' order by id desc limit 5;`.
The workspace page loses its "Synthetic data only" banner on the next load.

## Close it again (reversible, immediate)

```sql
select app.operator_close_real_data_gate('family-silks');
```

New real e-mails and phones are refused at once, on every path. **Real data already inside stays** (it is not touched): archive it, erase
it through the Privacy page (ADR 0014), or keep it knowingly. Reopening needs all four references again.

## When to close

A prerequisite stops being true (the hosted project is replaced, a restore drill fails, the legal basis changes); a suspected leak; a
person asks for the workspace to be erased. Close first, then act.

## What the gate does not do

It does not check names or job titles, and does not make the data lawful. **It is a tripwire for contact identifiers, not a data
classifier:** company names and free text (lead source, notes, evidence snippets) are not checked. The real controls are the banner, the
rule for the family, and the review before opening. See ADR 0015, "What this does not do".
