# Runbook: backup and restore drill (and the erasures that must be re-applied)

> **Deferred (2026-10-05):** The restore drill belongs to the Customer Zero stage (T012), with the owner's accounts (ADR 0017).

Purpose: prove that a backup restores into a working, **safe** database, and that people who were erased after the backup are erased
again. It is the fourth prerequisite of the real-data gate (`restore_drill_ref`). Do it on a **throwaway** project, never on production.
M3 runs it with the owner's accounts; this is the procedure.

What the platform gives (Supabase Pro): daily backups kept 7 days, so the worst case is **up to 24 hours** of lost writes (point-in-time
recovery would shrink that and costs $100/month; not bought). An erasure leaves a backup only when the backup ages out: **at most 7 days**.

## 1. Prepare
- A second Supabase project (the free tier is enough for the drill), same region. Note its reference.
- Write down the **backup time** you restore from.
- On production, list the erasures that happened **after** that time (these are what the restore brings back):
  ```sql
  select id, scope, subject_id, executed_at
    from public.erasure_requests
   where status = 'executed' and executed_at > '<backup time>'
   order by executed_at;
  ```
  (ids and times only; the request log holds no personal value.)

## 2. Restore
- Dashboard > Database > Backups: download or restore the chosen backup into the throwaway project (or `supabase db dump` from
  production and `psql` into the throwaway one). Roles and extensions come with a Supabase restore; a plain dump needs `--role-only` first.
- Time it. Write down how long the restore took (your RTO).

## 3. Verify the restored database is the same SAFE database
- Run `supabase/hosted/verify.sql` there as `postgres`: every row `ok = true`. It checks function owners, forced RLS, grants, the gate,
  the erasure workflow and the guards. A restore that comes back without them is not a restore.
- Run `scripts/verify_hosted.py` against the throwaway project's URL if you deployed a test API against it (optional).
- Check the gate: `select slug, real_data_allowed from public.tenant_data_policy join public.tenants on id = tenant_id;`. The restored
  gate state is the backup's. If a workspace was closed after the backup, close it again.

## 4. Re-apply the erasures newer than the backup
For each request from step 1, on the restored copy, as that workspace's Owner (replace the ids; this is the same call the app makes):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<owner user id>","role":"authenticated"}', true);
select public.request_erasure('<new request uuid>', '<tenant id>', '<scope>', '<subject id or null>');
select public.execute_erasure('<new request uuid>', false);   -- a workspace-wide request: the operator first sets execute_after in the past
commit;
```
Contact and company scopes re-derive the identifiers (e-mail, phone, host) from the restored rows; the tenant scope needs nothing. Then
re-run the checks of ADR 0014: the person's e-mail and number appear nowhere (a scan over the workspace's text columns).
If this step is painful, that is the signal to build a `reapply_erasures(since)` helper (ADR 0014); it is not built.

## 5. Record
Keep: the backup time, the restore duration, the `verify.sql` output, the list of re-applied erasures and the scan result, as one document.
Its name is the gate's `restore_drill_ref` (for example `doc:restore-drill-2026-10`). Delete the throwaway project's data afterwards:
it held a copy of production.

## If production must be restored for real
Stop writes first (close the gate, switch agents off, tell the family), restore, run steps 3 and 4 on production, then reopen.

## Plan for when real customer data starts (job DT, security audit)
1. **Plan:** move the production Supabase project to **Pro** BEFORE the first real customer record (the free plan has no daily backups). Daily backups, 7 days kept.
2. **Point-in-time recovery:** the add-on turns "up to 24 hours of lost writes" into "up to a few minutes". Decision for the owner at go-live: buy it once there are paying customers (about USD 100/month, see above); until then the 24-hour window is the stated promise and must not be described as anything better on the website.
3. **Off-site copy:** a weekly `make staging-backup`-style dump of production to an encrypted location outside Supabase (the owner's choice; no key in the repository), kept 8 weeks. Erasures made after a backup are re-applied after any restore (section 1 above).
4. **Drill:** run this runbook on a throwaway project once before go-live, then every quarter (`make restore-drill`, or `DRILL=local` for the local variant); write the date and the measured restore time in the real-data gate record (`restore_drill_ref`).
5. **Who is told:** a failed or skipped drill blocks opening the real-data gate (docs/runbooks/real-data-gate.md).
