# The 12 Nov 2026 database timeouts: what they were, what we changed, how big production's database must be

**Status: findings and a PROPOSAL. The owner buys the compute size after reading this; nothing here has been bought or run on production.**

## What happened
Staging (Supabase Free, **Nano**), 12 Nov, 10:22:10 to 10:24:11 UTC: 19 errors, all `57014 canceling statement due to statement timeout` (the `authenticated` role's limit is 8 s). The web's Today page fires about 30 reads at once. Pass 1 of the call-capacity plan (page limiter, queue, read cache, 15 s membership memory, bootstrap) is live; the today-summary endpoint (contract: `docs/contracts/today-summary.md`) follows.

## What the investigation found (staging, `pg_stat_statements` since 24 Oct, read-only)
1. **The queries are cheap.** Alone and warm, as a signed-in owner, 100 calls in one session: `today_summary` 5.4 ms and 89 buffers; `nav_counts` 4.7 ms; `agents_status` 3.9 ms; `billing_usage_get` about 8 ms; the RLS tenant-list helpers 0.02 ms. All index scans, no sequential scans, 95 MB database, 100 % cache hit rate. The recorded averages of the same calls are 255, 743, 218 and 297 ms, and their maximums 6.7 to 8.0 s: **about 50 times slower than alone, on every kind of statement**, including trivial ones (`billing_access` 63 buffers, max 6.3 s) and Auth's `insert into sessions` (max 4.8 s). A common cause outside the queries: the instance stalled.
2. **The RLS is already in the once-per-query form.** Every hot-table policy reads `tenant_id = ANY ((SELECT app.my_tenant_ids())::uuid[])` (an InitPlan). None of the 181 policies calls a membership helper per row. 166 of 168 tables with a `tenant_id` already have an index that leads with it.
3. **The 215,215 "membership" calls are the API's own per-request lookup** (`GET memberships?user_id&tenant_id`, 2.95 ms each), not an RLS helper. The 15 s membership cache (Phase 1h) removes most of them.
4. **A burst of Today pages on a 2-CPU Postgres (local, real engine, same schema):** one user, a page of 30 reads: 19 ms. 30 users at once: p50 342 ms, p95 1.0 s. 60 at once: p50 1.0 s, p95 4.6 s, worst 5.8 s, and throughput FALLS from 65 to 36 pages/s. So the same cheap queries turn into seconds when many arrive on few CPUs, and past saturation it gets worse, not just slower.
5. **What Supabase says about Nano** (supabase.com/docs/guides/platform/compute-and-disk, read 12 Nov): shared CPU, 0.5 GB, baseline disk **5 MB/s and 250 IOPS**, bursting to 261 MB/s and 11,800 IOPS only "for short periods ... drawing on a disk IO budget. Once the budget is exhausted, performance returns to baseline. If you hit your IOPS or throughput limit, throttling will occur."
**Conclusion (strong, not proven):** the 57014s are the small shared instance stalling under a burst, not a missing index or a bad query. **To prove it, open Supabase > Reports > CPU and Disk IO for 10:22 to 10:24 UTC**: a pinned CPU or an empty IO budget settles it. (The assistant's Supabase connector had no permission on this project.)

## What was changed (migration `20261231510000_db_index_hygiene.sql`, goes with production)
The Advisor's remaining suggestions, which are hygiene, not the cure: the two duplicate indexes dropped (`delivery_trips_order_idx`, `marks_send_log_batch_idx`: plain copies of a unique constraint's index); the unindexed foreign keys indexed (7 indexes covering 8 keys: `tenants.plan`, `agent_definitions.requires_flag`, `calendar_tokens.user_id`, `data_exports.tenant_id`, `wa_message_status (tenant_id, message_id)` which also serves its `tenant_id` key, `missed_calls (tenant_id, contact_id)`, `voice_budget.notice_tenant`); the two `storage.objects` picture policies call `(select auth.uid())` once per query (`alter policy`, in place). Expected effect on the incident: none (that is the point of the finding above). Expected effect on production: no scans of child tables on parent deletes and one less per-row call on uploads as data grows.

## Sizing production (prices from supabase.com/pricing and the compute docs, 12 Nov 2026; USD, Rs at 88)
Pro is $25/month and includes a $10 compute credit (the first Micro is free on a paid plan). Daily backups, 7 days; point-in-time recovery is $100/month per 7 days (not in the approved baseline).

| Size | Compute | RAM | Baseline disk | Connections (direct / pooler) | Price | Extra over the $10 credit |
|---|---|---|---|---|---|---|
| Nano (free, staging) | shared | 0.5 GB | 5 MB/s, 250 IOPS | 60 / 200 | $0 | n/a |
| Micro | shared | 1 GB | 11 MB/s, 500 IOPS | 60 / 200 | $10 | $0 |
| **Small** | shared | 2 GB | 22 MB/s, **1,000 IOPS** | 90 / 400 | **$15** | **$5 (about Rs 440)** |
| Medium | shared | 4 GB | 39 MB/s, 2,000 IOPS | 120 / 600 | $60 | $50 (about Rs 4,400) |
| Large | **dedicated 2 vCPU** | 8 GB | 79 MB/s, 3,600 IOPS | 160 / 800 | $110 | $100 (about Rs 8,800) |

All sizes up to 2XL burst above their baseline while an IO budget lasts; consistent disk performance needs 4XL or larger (docs). Dedicated CPUs start at Large.

**Proposal: Small ($15; Pro total about $30 a month, which is the "+ about 5 for the small instance" already in the approved baseline).**
* Why not Micro: it is Nano with 2 times the RAM and 2 times the baseline IOPS, the same shared CPU; one step cheaper than Small by $5 and one step closer to the failure we just saw.
* Why not Medium or Large now: Customer Zero is one shop. After Phase 1 and the today-summary endpoint a Today load is about 3 requests, and one page costs 19 ms of database time alone. The evidence does not justify $50 to $100 a month more before the replay says so.
* **Pre-agreed step up:** a resize is a few minutes of restart (verify the exact downtime in the dashboard before doing it). If the replay below fails, or in the first weeks any trigger fires, move to Medium; Large only if shared CPU itself is shown to be the limit.
* The database must never be Nano in production (free projects also pause).

## The replay before go-live (owner: "replay the 12 Nov burst against it")
Run on the production project at the chosen size after the migrations and before the waitlist form is on, with ONE synthetic workspace (gate closed, synthetic data only, removed afterwards), from the owner's Mac, inside the heavy lock; first the same replay on staging (Nano) as the BEFORE number (it will reproduce timeouts on staging for a few minutes: the owner says when).
* **Load:** the 12 Nov pattern: one signed-in owner opens Today (about 30 reads at once, through the API as the web does it) every 5 s for 10 minutes; then 10 and 30 such users at once for 5 minutes each; then the same with a synthetic call running (plan 1g: the call has no audio gap).
* **Pass:** zero 57014 and zero `503 busy`; the Today page body in under 1 s at p95 for 10 users and under 2 s at 30; no statement over 1 s in `pg_stat_statements` (reset first); CPU under 70 % and the IO budget not falling below 50 % in Reports; a live synthetic call unaffected.
* **Record:** the numbers (p50, p95, max per read, requests per second, CPU, IO budget) in a table next to the BEFORE numbers, in `docs/plans/db-timeouts-and-sizing.md`.
* A harness for it (API-level, signs in like `e2e/staging-df-lib.mjs`) is built when the owner approves the size; it needs no new spending.

## Triggers to move up (watch from the first day)
Supabase Reports: CPU over 70 % for 5 minutes, IO budget under 30 %, connections over 70 % of the limit; the API log line `slow lookup` (Phase 1, #495) appearing; any 57014. The production alert set already mails data-layer timeouts (more than 5 a minute).
