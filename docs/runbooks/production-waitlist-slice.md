# Runbook: the waitlist first, production bring-up pulled forward (owner, 12 Nov 2026)

**Nothing here has been run.** Owner's words (12 Nov 2026): the public reel is posted, early-access requests are arriving (handled by hand); get the waitlist live as early as safely possible; the production database comes earlier (the owner buys Supabase Pro this weekend); **nothing else on the safety list changes.**
This is a slice of `production-bringup.md`, not a replacement: that runbook's order stays for everything else (phone, worker, app, domain `app.stack19.com`, 30 Nov). Same legend: **[OWNER]** only the owner can; **[C1]** the agent.

## What the slice is (and what the waitlist really needs)
The waitlist is `POST /v1/public/waitlist` and `GET /v1/privacy/notice` on the API. From the code (`app/dpdp/routes.py`): it needs the production **database** (migrations; `public.waitlist_join` is granted to `anon`, it saves into `privacy.waitlist_entries`) and the **API** with the Supabase URL and public key. It does NOT need: Plivo or Exotel, the LLM keys, the app web, the app domain. The route itself sends no e-mail and the entry is saved without the worker. **But the worker does two waitlist jobs** (`app/dpdp/mail.py`, `DpdpJobs`): it e-mails the hello inbox "a new waitlist entry has arrived" (nothing about the person in it; `HELLO_EMAIL` unset = no mail, entries stored only), and once an hour it purges waitlist rows older than 12 months (nothing is that old for a year). So without the worker nobody is TOLD about a new entry (the owner would read the table) and the purge does not run yet. Decision 4 below. So:

| In the slice | Not in the slice (stays on the original schedule) |
|---|---|
| Google project + billing, Artifact Registry, Cloud Build, `sme-api-run` and `sme-build` | `sme-web-run`; the worker job (`sme-worker-run`, `sme-tick`, schedule) is **optional in the slice**: recommended, see decision 4 |
| Supabase **Pro** project `sme-prod` (Mumbai), all migrations, `supabase/hosted/verify.sql`, auth settings | Plivo number, KYC, XML application (step 10); telephony stays **off** (not even sandbox) |
| API: **agents off, telephony off, scale to zero** (request-based CPU, about USD 0 to 2 a month), never the warm instance | The always-on warm API instance (44 USD/month): comes with the phone, step 7 |
| Secrets: `sme-suppression-hmac-key` (the API refuses to start in production without it) and `sme-turnstile-secret` (captcha) | The other secrets (Anthropic, Sarvam, Cartesia, Plivo, Exotel stream secret); Resend and the scheduler password only if the worker is in the slice |
| Daily backup on, **first backup exists**, restore drill done, alerts mailing the owner, `verify_hosted.py` passing, rollback tested | Failure drills 1, 2 and 6 (they need a call); drills 3, 4 and 5 ARE in the slice |
| The public site's waitlist form switched on (C2: `WAITLIST=1`, `WAITLIST_API_BASE=<production API>`, `TURNSTILE_SITE_KEY`) | The app on `app.stack19.com` |

## What stays exactly as it is (the safety list)
* The real-data gate of every workspace stays **closed** (`real-data-gate.md`); the waitlist is its own table and is not a workspace. The Lead Desk dialer stays **off**, telephony stays **off**, no WhatsApp Cloud API.
* Every production step needs the owner's go, `PROD_CONFIRM=<commit>`, a clean main equal to origin/main, and a dry run read first (`production.sh`).
* **Real people's data is stored from the first form**: so (a) the privacy text is the owner-approved one and `PRIVACY_VERSION` is its new version string, set on the API at the same deploy as the site build that carries the text (a stale form gets `409 policy_version_outdated`); (b) the first backup exists BEFORE the form is switched on; (c) the way to remove a person is `app.operator_delete_waitlist_entry(contact)` (DPDP; migration `wl_operator_delete_waitlist`), tried once on a test entry before go-live; (d) the captcha is on (`CAPTCHA_PROVIDER=turnstile`; the code default is `none`, which would accept bots).
* No point-in-time recovery for now, daily backups only (owner's baseline, `production-bringup.md`).

## Order (dates are proposals; each step waits for the owner)
| # | Step | Who | Proposed |
|---|---|---|---|
| 0 | Prepare: `production.sh` gets `PROD_SLICE=waitlist` (only the slice's secrets required; agents, telephony and the warm instance off; refuses to run without an explicit `PRIVACY_VERSION`; sets turnstile). Settings of production declared in a versioned file from the first revision (`docs/plans/declared-settings.md`, step 4). Tests. | C1 | before the weekend |
| 1 | Owner buys Supabase Pro; creates the production Supabase project (Mumbai) and the production Google project **linked to the paid billing account**; budget alerts; fills `deploy/.env.production` (public ids only) | OWNER | Sat 14 / Sun 15 Nov |
| 2 | `supabase db push --dry-run` (read the list), `db push`, `verify.sql` every row `ok = true`, `hosted-auth-settings.md` by hand | OWNER types the DB password, C1 reads the output | Mon 16 Nov |
| 3 | Backups: the Pro daily backup is on and the first one exists; restore drill into a scratch project, timed (`backup-restore-drill.md`) | both | Mon 16 to Tue 17 Nov |
| 4 | Google side for the slice (APIs, Artifact Registry, `sme-api-run`, `sme-build`), the two secrets at a hidden prompt, grants on THOSE secrets only | OWNER presses, C1 prepares | Tue 17 Nov |
| 5 | `production.sh preflight`, `deploy api` as a DRY RUN (read it), then `--execute` with `PROD_CONFIRM`; the new revision is made without traffic, checked against the settings file, then given the traffic | OWNER confirms, C1 runs | Tue 17 / Wed 18 Nov |
| 6 | `scripts/verify_hosted.py` on the production API (must end `ALL CHECKS PASSED`); alerts (`ALERT_EMAIL=... production-alerts.sh`, trigger each once); `rollback` then `latest`; drill 3 (roll back and forward) and drill 4 (database unreachable on a scratch revision) | C1, OWNER chooses the address | Wed 18 Nov |
| 7 | Owner approves the privacy text and its version string; test entry through the production API (`POST /v1/public/waitlist`), read it, remove it with `operator_delete_waitlist_entry` | OWNER, C1 | Wed 18 / Thu 19 Nov |
| 8 | Site revision with `WAITLIST=1`, `WAITLIST_API_BASE`, `TURNSTILE_SITE_KEY` after the new site image (C2's PR) is built; check the form from outside; first real entry watched | C2 builds, OWNER presses | Thu 19 Nov |

Earliest realistic go-live is therefore **Thu 19 Nov**, if the owner does step 1 at the weekend and approves the text by Wednesday. It does not move earlier safely: steps 2 to 4 each need the previous one (the backup needs data to be meaningful but must exist before the form is on), and the owner confirms each production action. What moves it later: Supabase KYC or billing delays, the privacy text version not settled, a failed `verify.sql` row.

## What the full bring-up still needs afterwards (unchanged)
Steps 5 to 13 of `production-bringup.md` for the phone, worker, app and `app.stack19.com`, 30 Nov target. Because deploys now only UPDATE settings and are checked before they get traffic, growing the slice into the full stack (telephony sandbox, warm instance, more secrets) is a named change (`ALLOW_FLAG_CHANGE=...`) on a later deploy, not a rebuild.

## Decisions only the owner can make
1. The public site service lives in the STAGING Google project today; with `WAITLIST_API_BASE` it sends the form to the production API, so request metadata (not the data) is logged in the staging project. Move the site service to the production project (cleaner; one more service there) or accept it for now?
2. The sentence the website runbook asks for in step 0 (`website-go-live.md`): the owner opens the waitlist table alone, in production, with DPDP consent records, daily backups, no point-in-time recovery.
3. The privacy text and its version string (the date-style string in `PRIVACY_VERSION`).
4. **The worker in the slice, for the "new entry" e-mail?** With it: one more Cloud Run job at about USD 0, the scheduler account registered in production auth, the secrets `sme-scheduler-password` and `sme-resend-api-key`, `HELLO_EMAIL`, service accounts `sme-worker-run` and `sme-tick`, outbox adapter fake; the entry mail says only THAT someone joined. Without it: you look at the table yourself (daily), the entries are just as safe, and the 12-month purge starts when the worker comes with the full bring-up. Recommended: with it, because you are answering requests by hand today and a missed entry is a lost lead.
