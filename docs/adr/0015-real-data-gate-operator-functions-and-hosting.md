# ADR 0015: The real-data gate, the operator functions, and the staging hosting recommendation

Status: accepted (2026-10-05; T006b milestone 2, owner review fixes applied in `20261012090100_t006b_m2_review_fixes.sql`). The gate, the operator functions and the verifier are built and tested. The hosting
choice is a **recommendation for the owner**: nothing was deployed and no account exists.
Related: ADR 0010 (the old import-only gate), ADR 0013 (agents), ADR 0014 (erasure), `docs/pre-pilot-checklist.md`, `docs/runbooks/`.
Code: `supabase/migrations/20261011090000_t006b_real_data_gate.sql`, `20261011090100_t006b_sole_owner_and_members.sql`,
`20261012090100_t006b_m2_review_fixes.sql` (members must have accepted; the gate fails closed; service_role writes revoked),
`supabase/hosted/verify.sql`, `scripts/verify_hosted.py`, `deploy/`.
Tests: `supabase/tests/database/45_real_data_gate.test.sql`, `46_sole_owner_and_operator_members.test.sql`,
`tests/integration/test_real_data_gate_direct_postgrest.py`, `tests/integration/test_verify_hosted_sql.py`,
`services/ai-api/tests/test_verify_hosted.py`.

## Context

Until the erasure workflow existed, the only thing keeping real people's data out was a constant inside `import_lead_rows`
(reserved e-mail domains, phones starting `+00`). A human could still type a real contact through the API or PostgREST. ADR 0014
shipped erasure. The family is about to label real leads, so the rule must hold on **every** path, be **per workspace**, start
**closed**, and be opened only by a person with the keys, on the record, after four preconditions.

## Decisions

### 1. The gate is a trigger on `contacts`, per workspace, default closed

* `public.tenant_data_policy` (one row per workspace once the operator touches it). **No row means closed.** Members can read it
  (the web banner and `GET /v1/tenants/{id}/data-policy`); **no request can write it** (clients hold SELECT only).
* `app.guard_real_data()` is a trigger on `contacts` (insert and update). While closed, a written **e-mail** must be on a reserved
  domain (RFC 2606 / 6761: `.test`, `.invalid`, `.example`, `example.com/org/net` and their subdomains) and a written **phone** must
  start `+00`; otherwise `SM401` with the fixed message "real data is not accepted in this workspace yet" (no value in it). It fires
  for the API, direct PostgREST, the import function and a privileged session alike.
* Only an identifier that is **being written** is checked. An archive, a rename, an erasure (identifiers become NULL), or a fix of the
  e-mail on a row whose phone is already in is never blocked, so data already in can always be corrected or removed (tested, including
  closing the gate again with real data inside).
* A value the table's own CHECKs will refuse (malformed, invisible characters) is left to them: their error says what is wrong.
* `import_lead_rows` consults the gate: closed keeps its reserved-address rejection with a code; open accepts real contacts. The
  trigger is the backstop.
* **Known limit:** a contact's **name** and job title cannot be checked (a real name beside a reserved address passes). The gate guards
  the identifiers that can be used to reach a person. The Privacy and review screens say "synthetic data only" while closed.

### 2. Opening and closing are operator-only, recorded and reversible

* `app.operator_open_real_data_gate(slug, erasure_ref, hosting_ref, dpdp_review_ref, restore_drill_ref)` needs **all four** prerequisites
  as typed references (`kind:token`, e.g. `adr:0014`, `doc:dpdp-review-2026-10`) and **checks** that the erasure functions are
  installed (`SM402` otherwise). The row is audited by the audit trigger (the system as actor, the references as values).
* `app.operator_close_real_data_gate(slug)` closes at once and keeps the references as history. Real data already inside is not touched;
  the runbook says what to do with it.
* Both live in schema `app` (not exposed by PostgREST), are executable by their owner only (verified for `anon`, `authenticated`,
  `service_role`), and refuse any session that carries a request identity (`auth.uid()` is not null), so even a client role that gained
  EXECUTE could not use them. Each condition is mutation-tested alone.
* The references are claims by the operator, not proof. What the function can verify (erasure installed) it does; the rest is the
  operator's signed statement in the audit log. The DPDP review is a legal act the system cannot check.

### 3. The last Owner cannot erase themselves (ADR 0014 open question 2)

`execute_erasure` (and its preview) refuses with `SM305` when the contact's address is the sign-in address of the workspace's **only**
Owner: ownership is transferred first. The exception is operator-run after out-of-band identity verification:
`app.operator_add_owner_exception(slug, email, reason)` adds a second Owner (reason of 20+ characters recorded in the audit log).
`app.operator_add_member(slug, email, role, reason)` adds a family member at admin, sales or viewer, **never owner**. Both need an
existing account: hosted sign-up is closed, so a person is invited first (dashboard), then added here.

### 4. Hosting recommendation (the owner decides; nothing is deployed)

Prices fetched 2026-10-05 from the vendors' pages (Cloud Run Tier 2 rates and the free tier from a search summary of Google's page
because the page truncates for the fetcher; **re-check before committing money**). 730 hours a month = 2,628,000 seconds.

| Item | Basis | Per month |
| --- | --- | --- |
| Supabase Pro (Mumbai `ap-south-1` is a listed region) | $25, includes $10 of compute credit = one Micro instance; spend cap on by default; daily backups kept 7 days; PITR +$100 (not recommended) | **$25** |
| **API, option A1: Cloud Run Mumbai, instance-based CPU, 1 instance always on** (1 vCPU, 512 MiB) | CPU (2,628,000 - 240,000 free) x $0.0000216 = $51.58; memory (1,314,000 - 450,000 free) x $0.0000024 = $2.07 | **about $54** (1 GiB: about $57) |
| **API, option A2: Cloud Run Mumbai, request-based CPU, scales to zero** | within the free tier at family volume; 1-3 s cold start | **about $0-2** |
| API, option B: Fly.io shared-cpu-1x 1 GB, always on | $6.70 (Ashburn price; other regions differ, not verified); **Fly's Mumbai (`bom`) is deprecated and takes no new Machines: the nearest is Singapore (`sin`)** | **about $7-10** |
| Web: Cloud Run, request-based, scales to zero | free tier | **about $0** |
| Artifact Registry, egress, logs | small | **about $1** |

**Why the API CPU question exists:** agent runs execute in worker threads inside the API process (ADR 0013). On request-based billing
Cloud Run throttles the CPU between requests, so a run would stall. Instance-based billing (`--no-cpu-throttling`) keeps the CPU on, at
the price above. **But agents are off (`AGENTS_ENABLED=false`) for the first pilot**: the family labels leads, which is request/response
work, and erasure runs inside a request. So:

* **Recommendation: Cloud Run in Mumbai (option A).** Start with **request-based CPU (A2): about $26-28 a month all in** (Supabase
  $25 + $1-3). Switch the API to **instance-based, one instance (A1), only when agents are switched on**: about **$80 a month** all
  in. The switch is one flag (`--no-cpu-throttling`) and a redeploy.
* **Why not Fly.io for the API:** it is the cheapest always-on option ($7-10 against $54) and has no throttling, but it places the API
  in **Singapore** while the database is in Mumbai: every API call makes several sequential round trips to the database (about 55-70 ms
  each, my estimate, not measured), and personal data is processed outside India. Cross-border processing may be acceptable under DPDP
  (not legal advice); that is a question for the DPDP review, and a reason to keep everything in India until it is answered. If the
  review accepts Singapore and the agents are on, Fly saves about $45 a month; revisit then.
* **Region:** Cloud Run `asia-south1` (Mumbai) with Supabase `ap-south-1` (Mumbai): same city, low latency, data stays in India.
* **Cost control:** Cloud Run max-instances 2 for the API, 3 for the web; a GCP budget alert (there is no hard cap on GCP; the alert
  is the control); Supabase's spend cap stays on.
* **Rejected:** a VPS (most upkeep, no India region at the price); Vercel for the web (a third vendor; per-user pricing).

### 5. The hosted verifier (read-only)

`scripts/verify_hosted.py` and `supabase/hosted/verify.sql` check a deployment **without writing anything** (the script sends only GET and
OPTIONS, a test proves it; the SQL is SELECT-only, a test proves it; the database session is forced read-only). They check: the trusted
role `postgres` owns every definer function and every definer function pins its search path; the provenance predicate is intact; RLS is
enabled **and forced** on every tenant table; `anon` holds nothing; clients cannot write the immutable or operator tables; the private
schemas and operator functions are closed to client roles; the erasure workflow, the guards and the statement timeout are installed;
sign-up is closed and e-mail confirmation is on; `anon` reads nothing; private schemas are not exposed; the API is not in development
mode, refuses an anonymous call and allows CORS from the web origin only. The SQL is also run against deliberately broken copies of the
local schema and must catch each (14 cases). Connection details travel in the environment, never on a command line, and are never printed.

## What this does not do

* It does not make the data legal to hold. The DPDP review is a prerequisite the operator records; it is not mine to close.
* It does not hide a real name typed next to a reserved address.
* The gate is a tripwire for contact identifiers, not a data classifier. Company names and free text (lead source, notes, evidence snippets)
  are not checked. The real controls are the banner, the rule for the family, and the review before opening.
* It does not cover backups of real data held before an erasure (the restore drill, M3).
* It deploys nothing and creates no account. `deploy/cloudrun.sh` is a dry run unless `--execute` is given; I never ran it with it.

## Consequences

* Every workspace, including every new one, starts closed. Fixtures that plant real-looking phones (the erasure suites) open the gate
  for their own tenants through the same operator function.
* Opening the gate needs a person with database-owner access, the four records, and the runbook (`docs/runbooks/real-data-gate.md`).
* Three new SQLSTATEs: `SM401` gate closed, `SM402` erasure not installed, `SM305` last Owner. The API maps them to fixed messages.
* Image sizes: API 297 MB, web 1.33 GB (a `standalone` build would shrink it; not needed yet).
