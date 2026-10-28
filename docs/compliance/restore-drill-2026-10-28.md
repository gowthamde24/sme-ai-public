# Restore drill, 28 Oct 2026 (`restore_drill_ref` = `doc:restore-drill-2026-10-28`)

Procedure: `docs/runbooks/backup-restore-drill.md`, run with `scripts/staging_backup.py` (`make staging-backup`, then `make staging-drill FILE=...`): a `pg_dump` (custom format) of the HOSTED staging database, restored into a SCRATCH database on the local agent stack (Postgres 17), then `supabase/hosted/verify.sql` on the copy, a row-count comparison of every table, and the scratch database dropped. The throwaway target is a local scratch database, not a second Supabase project.

## Run 1 (18:47 local): FAIL, and why that mattered
- 14 `pg_restore` errors: `schema "billing" does not exist`, `function app.billing_plan_row(uuid) does not exist`, `function app.topup_cfg() does not exist`. The script's list of schemas to dump did not include `billing` (added after the script was written), so the backup silently left out the billing tables and functions. A real restore would have come back without them.
- 1 table differed: `auth.flow_state` 17 live vs 15 restored (sign-in flows created while the 4-minute dump ran; an expected-to-change table, now listed as such).
- Fixes (same day): `billing` added; the dump now STOPS if the database has a schema the script does not list or know to be platform-managed; two tests (`test_dv_staging_backup_schemas.py`) fail the build when a migration creates a schema the backup does not list.

## Run 2 (18:49 local): PASS
- Dump: 5,464,325 bytes (5.2 MB), 293.1 s, mode 600, on the Stack19 volume outside the repository (`/Volumes/Stack19/stack19/staging-backups/stack19-staging-20261028T174908Z.dump`). Backup time: 2026-10-28 17:49:08 UTC.
- Restore: **12.2 s end to end (the RTO of this drill)**, 0 `pg_restore` error lines.
- Row counts: **232 tables in staging, 232 restored, 0 differ.**
- `verify.sql` on the restored copy: 20 checks, **0 not ok**.
- Erasures executed after the backup time (to be re-applied on a restore): **0** (`select count(*) from public.erasure_requests where status = 'executed' and executed_at > '2026-10-28 17:49:08+00'`).
- Scratch database dropped.

## Limits (stated, not hidden)
- The dump covers the app schemas and `auth`; Supabase's own `storage`, `realtime`, `vault`, `graphql` schemas come with a platform restore (shop logos in storage are not in this dump).
- The restore target is the local Postgres 17 container, not a second hosted project; the dashboard's own daily backups were not exercised.
- The dump holds password hashes and authenticator secrets of staging accounts, including the owner's real account: it stays mode 600 on the volume, outside Git, and is not shared.
