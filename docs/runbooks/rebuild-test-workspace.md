# Rebuild one of the owner's test workspaces (staging)

Owner decision, 4 Nov 2026 (answer 1 to the Lead Finder report): **no purge**. Quotes, orders, the ledger, calls, fees, students and outcomes are append-only in the database and stay so. To start a test
week again, the operator **archives** the old test workspace and a **fresh** one is made. Operator only; staging only; synthetic data only.

## What "archived" means (migration `20261227090000`, pgTAP 152)
- **Read-only.** `public.billing_access` answers `access: read_only, archived: true`, so the API's gate refuses every change and every spend with 403 `workspace_read_only`. `app.billing_read_only` is true, so the
  outbox, the scheduler and outreach hand out nothing. Viewing and exporting stay.
- **Hidden from the switcher.** `GET /v1/me` leaves it out. A direct link still opens it, read-only.
- **Kept.** Nothing is deleted. Its name gains ` (archived YYYY-MM-DD)`. It gets no "your plan ended" reminder and is never on the 90-day deletion list (`app.billing_lapse` is unchanged).
- **It no longer counts** against the owner's workspace allowance (`app.owner_allowance`), so the fresh one can be added.
- The database **refuses** to archive a workspace whose real-data gate is OPEN, a demo workspace, or one without a reason of 20 to 300 characters. Members cannot touch the flag (only `name` is theirs to change).

## Run it
1. Look first (changes nothing):
   ```
   python3 -I scripts/rebuild_owner_test.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf \
       --api-url https://sme-api-620338396268.asia-south1.run.app --pack textiles --dry-run
   ```
   It prints the workspace it would archive, the generation and the helper account that makes the fresh one.
2. Rebuild: the same command without `--dry-run` and with `--reason "the owner asked for a fresh test week (<date>)"`. The script:
   1. archives the workspace in use (`app.operator_archive_workspace`);
   2. makes a NEW helper account: generation 1 is `owner-test-<pack>@demo.example.test`, and generation g is `owner-test-<pack>-g<g>@demo.example.test`, with secrets `sme-owner-test-<pack>-g<g>-password` and
      `-totp` in Secret Manager, made on first use and never printed;
   3. runs `scripts/seed_owner_test.py`'s phases for it:
      - **provision**: the workspace, billing-exempt, the assistant on, the owner as **Owner** again through `app.operator_add_owner_exception` (reason in the audit log), and the owner's display name;
      - **seed**: the week, through our API as the helper;
      - **handover**: the helper leaves.
   4. checks that the fresh workspace's real-data gate is closed.
3. A run that stopped half way is run again as it is: the generation is 1 + the archived workspaces of that name, so the same helper is used and every phase is idempotent.
4. Tell the owner: the fresh workspace is in the switcher under the same name; the old one is reachable only by its link, read-only.

## Undo
`select app.operator_unarchive_workspace('<tenant id>', '<reason of 20+ characters>');` (as the operator, `supabase db query --linked`). The name keeps " (archived …)"; rename it in Settings if wanted.
Two workspaces in use with the same name make the next rebuild refuse, so rename one first.
