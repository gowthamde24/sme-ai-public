# Plan: members and invitations, the build plan (ADR 0023)

## Owner decisions (2026-10-08)

Decisions 1 to 8 of section 15: **all YES, as recommended.** The plan text below is unchanged and still shows the questions.

- Decision 3 (a second factor for Sales and Viewer): YES as recommended, which is **no** second factor for the family at Customer Zero. **Revisit before any external customer.**

Status: **PLAN ONLY. Not approved. No code, migration, test or dependency was written or changed.** Written 2026-10-08 on the branch `plan-customer-zero` from `origin/main` at `81060dd`. Queue position (owner, 2026-10-06): after the owner brief (T011a), before the Customer Zero stage (T012): see `docs/plans/customer-zero-roadmap.md`.

**This plan EXTENDS, and does not replace, `docs/plans/members-and-invitations.md`.** That file holds the design and **the owner's twelve recorded decisions of 2026-10-06** (expiry 7 days; no Owner invitations through the app; an Admin invites `sales` and `viewer` only; a 20-character one-time code; a lost code is revoked and remade; hosted sign-up stays closed; the closed removal reasons; counts only on removal; sessions elsewhere not ended; "a former member"; 20 pending per workspace; direct table writes revoked) and the amendments A1 to A6. They all stand here. This file adds what a build needs: the role table of the whole product, the invitation flow without real e-mail (a `Mailer` interface with a fake), MFA at first sign-in, what changed in the repository since the design was written, the full test and mutation plan under the current rhythm, and commit slicing with the full-check points. Where this plan changes something, it says **CHANGE**; where it adds, **ADD**.

## 0. Assumptions

* **A1.** The design of the existing plan (sections 3.1 to 3.5, the SQLSTATE table SM240 to SM249, the commit order) is the baseline. **Verified free:** SM240 to SM249 are used by no migration (the highest SM2xx in use is SM238, orders); SM306 is the second-factor refusal, SM403 "must have accepted" (operator function).
* **A2.** **No real e-mail in this build.** A person joins by a code handed over in person or by any chat. Delivery of the code by e-mail is an optional add-on behind a `Mailer` interface whose only implementation in this build is a fake; the real SMTP adapter is a T012 item and **needs the owner's written approval** (ADR 0017: no SMTP, no domain, no paid service before then).
* **A3.** Hosted sign-up stays closed; the operator creates an account (with a temporary password) and the Owner then hands over a code. The local stack has sign-up open with auto-confirm, which is **not** the hosted path (the existing plan's A6 says so).
* **A4.** ADR numbers: this plan is ADR 0023; the owner brief is ADR 0024 (`docs/plans/owner-agent-plan.md`).
* **A5.** The family's roles at Customer Zero (runbook, decision 7): the owner is the Owner, one parent is Admin, labelers are Sales, nobody is a Viewer. Plan for dozens of members at most, not thousands.
* **A6.** Testing rhythm as in the other plans: per commit `make check-fast` plus the touched tests; the full `make check` in every commit with a migration or a change to roles, permissions, consent, suppression or erasure (so: the migration commit, and the commits that touch the role rules); a full `make check` from a clean `db-reset` once at the end of the ticket; mutation at the end, one runner at a time; the headless driver is the acceptance (no stopwatch click test, owner decision 2026-10-07), the click checklist is kept and pinned to the screens.

## 1. What exists today (re-verified on `main` at `81060dd`)

* **Roles:** `owner`, `admin`, `sales`, `viewer` (ADR 0001). Memberships are the single source of authorization (CLAUDE.md, ADR 0013).
* **How a person joins:** (1) the operator, as `postgres`: `app.operator_add_member(slug, email, role, reason)` (refuses `owner`, refuses an account that has not confirmed its e-mail, SM403) and `app.operator_add_owner_exception(slug, email, reason)` (reason of at least 20 characters, audit event); (2) an Owner or Admin writes into `memberships` with their own token, which needs the new person's raw user id. Neither is a screen. `docs/runbooks/add-family-member.md` is the operator path.
* **Guards that already exist:** `app.guard_aal2_client_write()` (a password-only session cannot change `memberships`: SM306); `app.protect_last_owner()` (a raw 23514); the audit trigger (`membership.create` with the actor); ADR 0016 (Owner and Admin need a second factor for privileged actions).
* **Added since the design was written (2026-10-06), and relevant to removal and erasure:** touches (`lead_touches.recorded_by`), follow-up drafts (`created_by`, `approved_by`, `discarded_by`), question drafts (`created_by`, `decided_by`), orders and the order ledger (the actor of each event), the due list; the capture plan will add files and chat messages (`uploaded_by`, authors). All of these keep the person's id for attribution. **ADD:** section 7 says what a removal does to each.

## 2. Principles

1. **Nobody is put into a workspace without having asked to be:** accept with a one-time code.
2. **The Owner role is never granted through the app.** Only the operator function creates an Owner (reason of at least 20 characters, audit event, the cap of three Owners lives there).
3. **Role first, then the second factor, then the specific refusals;** one generic `42501` for every refusal before the role is proven; no data-layer text reaches a client.
4. **The API decides nothing.** It passes the person's own token and their inputs; the database re-checks (who may grant which role, the last Owner, the code lifecycle).
5. **Least privilege and PII minimisation:** the invitation label cannot hold a phone number or an address; the invitee's e-mail address is never stored; the code is stored only as a hash and shown once.
6. **A person's removal ends their access at once and rewrites no history.**
7. **Nothing sends anything** in this build; a "send" of a code to an address goes to a fake.

## 3. Roles and what each may do

Read from the ADRs and the existing plan; "aal2" means the session must be at the second-factor level.

| Area | Owner | Admin | Sales | Viewer |
| --- | --- | --- | --- | --- |
| Read CRM records (contacts include e-mail and phone for every role: a known open row) | yes | yes | yes | yes |
| Read orders, events and the ledger (ADR 0021) | yes | yes | yes | **no** |
| Follow-up screens (touches, drafts, the due list) (ADR 0022) | yes | yes | yes | **no** |
| Create and edit CRM records (products: Admin and Owner only), import leads, label leads, start agent runs | yes | yes | yes | no |
| Archive, export, request an erasure (aal2) | yes | yes | no | no |
| Execute or cancel an erasure; publish a follow-up policy; create an order policy (aal2) | yes | no | no | no |
| Approve a follow-up draft (aal2); approve a quote (aal2) or reject it; create an order, record a payment, cancel an order with no money (aal2) | yes | yes | no | no |
| Approve a flagged quote; cancel an order that carries money; record a refund; the dispatch override | **Owner only** | refused (SM218 / SM234) | no | no |
| Record a touch, ask for a draft, discard own draft; send / accept / decline order events | yes | yes | yes | no |
| Turn the agents switch on or off (aal2); promote a claim | yes | yes | no | no |
| **Members (this plan)** | | | | |
| See the members list and display names | yes | yes | yes | yes |
| Create an invitation for `admin` | yes | **no** | no | no |
| Create an invitation for `sales` or `viewer` (aal2) | yes | yes | no | no |
| Create an invitation for `owner` | **refused for everyone (SM242)** | refused | no | no |
| Revoke a pending invitation (aal2) | any | `sales` / `viewer` ones | no | no |
| Change a role among `admin`, `sales`, `viewer` (aal2; never your own, SM245) | yes | `sales` <-> `viewer` only | no | no |
| Remove a member (aal2) | anyone but the last Owner and another Owner | `sales` / `viewer` | no | no |
| Leave the workspace yourself | yes unless last Owner | yes | yes | yes |
| Accept an invitation (an `admin` one needs a CURRENT aal2 session) | any signed-in person who is not yet a member | | | |

## 4. Architecture (the flow)

```
operator (hosted: dashboard create-user, temporary password)  ──▶ an account exists (password-only, aal1)
Owner/Admin (aal2) ── create_invitation(id, tenant, role, days, label, [deliver_to]) ──▶ the DATABASE stores sha256(code), returns the code ONCE
      │                                                                  │
      │   (optional) the API holds the code only for this request and hands it to Mailer.send(...)  ──▶ FakeMailer (dev/test) / SmtpMailer (T012, approval)
      ▼
the Owner hands the code over (in person, on paper, any chat)
the invitee: sign in ─▶ /auth/set-password (first login) ─▶ [admin invitation: enrol TOTP, sign in again with the code = aal2] ─▶ /app/join#code=...
accept_invitation(code): locked? / invalid? / (proven valid) second factor for `admin`, already a member, insert, status, audit  ─▶ {joined, tenant, role}
```

Everything privileged is a `SECURITY DEFINER` function with `set search_path = ''`; the table loses its client write grants (existing plan 3.1, 3.2).

## 5. The invitation flow without real e-mail

* **Primary path (unchanged):** the code is shown once on the Owner's screen and handed over by any channel. No e-mail, no SMTP.
* **ADD: an optional "deliver to this address" step behind an interface.** `app/members/mailer.py`: `Mailer.send(to: str, subject: str, text: str) -> MailResult` (a closed result: `queued` or `failed`; never a provider's text). Implementations: `FakeMailer` (an in-process outbox, readable only by tests and by a **dev-only** read route that does not exist outside `API_ENV=development`) and, at T012, `SmtpMailer` (**needs the owner's written approval**: provider, domain, sending address, a spend / volume cap).
* **The address is never stored.** `create_invitation` takes no address; the API receives `deliver_to` in the same request, calls the mailer while it holds the one-time code, and discards both. The database, the audit event, the logs and the response carry neither the address nor the code beyond the one-time response to the creator.
* **The message** is a fixed English template (a Telugu / Hindi / Kannada set is a later, native-reviewed item): who invited, the workspace name, the role in words, the validity, and the join link `/app/join#code=...` (the **fragment**, so the code is not sent to any server by the browser). No customer data.
* **Failure is safe:** if the mailer fails the invitation still exists and the code is still shown on the creator's screen with "the e-mail was not sent"; nothing is retried automatically (a retry would need the code again, which is never stored).
* **Why a fake now:** it lets the whole flow, including the message text and the failure path, be tested, and makes T012's real adapter a single class plus an approval. If the owner would rather not build the e-mail step at all before T012, slice M3 below is simply skipped (decision 1).

## 6. MFA at first sign-in

The existing rules (ADR 0016) stay: Owner and Admin need a second factor for privileged actions; Sales and Viewer are unaffected.

* **A new `sales` or `viewer` member:** operator-created account (temporary password) → first sign-in → **password change** (below) → accept the code. No second factor is required by the product; the page offers the enrolment link.
* **A new `admin`:** the invitation can only be accepted in a session that is **already `aal2`**, so the person must enrol an authenticator *before* accepting: sign in, change the password, open `/app/security`, enrol, sign in again with the 6-digit code, then `/app/join`. The join page says "This needs your authenticator app for this session" when the session is lower. (This is the existing plan's rule; the order of steps is written out here because it is the part a real person gets wrong.)
* **Forced password change at first sign-in (the existing plan's open point A6).** Supabase has no native "must change password" flag. Two options: (a) rely on the operator telling the person to use `/auth/set-password` first (a manual step, easy to forget); (b) **ADD a small marker:** a private table `private.password_change_required(user_id)` written by an operator function when the operator creates the account, read by the web proxy, which redirects the person to `/auth/set-password` until a definer function `app.clear_password_change_required()` (called by that page after a successful change) removes the row. Recommendation: (b) (decision 4), because a temporary password handed over in person is the weakest moment of the flow. **Not verified locally:** the hosted dashboard's create-user with auto-confirm (the admin endpoint needs the service-role key this work must never use); it is checked at T012.
* **Lost device:** unchanged (`docs/runbooks/mfa-recovery.md`, operator reset, audited).

## 7. Data model, removal and what it touches

Tables and functions are as in the existing plan (3.1 to 3.3): `public.invitations` (hash of the normalised code, role in `admin`/`sales`/`viewer` by a check, a label that refuses 7 or more consecutive digits and "@", `created_by`, `expires_at` default 7 days and at most 30, `status` in `pending`/`accepted`/`revoked`, `accepted_by`/`accepted_at`), `private.invitation_attempts` (failed presentations, 5 an hour locks the caller, rows older than 24 hours deleted), `memberships` loses its client `insert`/`update`/`delete`, the functions `create_invitation`, `accept_invitation` (returns `joined` / `invalid` / `locked` and **never raises on a wrong code**, amendment A1), `revoke_invitation`, `change_member_role`, `remove_member`, `list_members`, and the operator Owner function with its cap of three.

**ADD: what `remove_member` does to the records added since the design** (it always lists counts only, never names):

| Record | What happens | Why |
| --- | --- | --- |
| `leads.owner_user_id`, `opportunities.owner_user_id` | set to null explicitly (also done by the composite foreign key `ON DELETE SET NULL`) | existing amendment A4 |
| Quote drafts they made | stay drafts; an Owner or Admin may reject them | existing plan |
| **Waiting or approved follow-up drafts they made** | stay; an Owner or Admin may discard them (Sales may discard only their own, so a removed Sales member's drafts need an Owner or Admin); the removal result counts them | ADR 0022 discard rules |
| **Touches they recorded, drafts they approved, order events, ledger entries, question decisions** | keep the person's id; every screen shows "a former member"; never rewritten | an audit and business record |
| Running or queued agent runs | cancelled in the same transaction | option A: a run ends with its starter's access (ADR 0013) |
| Unaccepted invitations they created | revoked | existing plan |
| **Files and chat (if built): their uploads and messages** | stay; attribution shows "a former member"; erasure is the way to remove personal content | the capture plan's retention and erasure design |
| Their account and other workspaces | untouched; sessions elsewhere are not ended | owner decision 9 |

**Erasure and the real-data gate.** The invitation `label` and `users.display_name` are free text; the label rule keeps phone numbers and addresses out, the column is covered by `erase_tenant` and registered in the erasure registry, and `tenants.name` / `users.display_name` remain the known open "free text outside the hygiene guard" row. A member is **staff, not a data principal in the workspace's records** (ADR 0014's reasoning for `started_by`); a member who asks to be erased from their own account is a separate path (the account-deletion vs last-Owner row stays open). The real-data gate (a trigger on `contacts`) does not concern memberships; invitations carry no contact data by construction (decision: label rule, no address stored).

## 8. Role change, removal, last-Owner protection, expiry and one-time use

* **Role change** (`change_member_role`): Owner among `admin`/`sales`/`viewer`; Admin `sales` <-> `viewer`; never your own role (SM245); never to or from `owner` (the operator's); a closed reason; second factor; audit.
* **Removal** (`remove_member`): Owner anyone but the last Owner and another Owner; Admin `sales`/`viewer`; a non-Owner may **leave**; closed reason; counts returned; audit; access ends in the same transaction because every policy consults `memberships`.
* **Last-Owner protection:** the workspace must keep an Owner: SM244 replaces the raw 23514 of `protect_last_owner` (the trigger stays as the second line, and the existing concurrent-last-owner race test stays).
* **Expiry and one-time use:** `expires_at` is checked inside `accept_invitation` under a per-hash lock; an accepted, revoked, expired, unknown or other-workspace code is the same `invalid` result and one failed-attempt row; two accepts of one code at once produce one membership; accept racing revoke, and accept racing the removal of the inviter, are tested.

## 9. RLS and definer functions

* `invitations` is tenant-owned with RLS and **no client write grant**; it is in `tests.tenant_table_registry`; Owner and Admin may read their workspace's invitations (never the code: only the hash exists); Sales and Viewer read none.
* `private.invitation_attempts` has no client access at all.
* Every function above: `security definer`, empty `search_path`, role proven first (one generic `42501`), then the second factor, then the specific refusals; `revoke ... from public, anon`; `grant execute ... to authenticated`; `accept_invitation` is callable by any signed-in person (the caller is not a member yet), so its only authority is the code.
* The `06_catalog_guards` allow-lists (the only SECURITY DEFINER functions of the API schema, and what `authenticated` may execute) gain exactly these functions.

## 10. Audit

One audit event each for: invitation created, accepted, revoked; role changed; member removed; (operator) Owner added. Each records the actor, the tenant, the target user id, role before and after and the closed reason. **Never** the code, the code hash, an e-mail address or a label's content beyond its existence. The log-safety word list gains `invitations` and `accept` so the code never appears in an access log (existing amendment A5).

## 11. Tests and mutation plan

* **pgTAP (new file, next number after 66):** the whole matrix of section 3's member rows, cell by cell, by role and by assurance level; `create_invitation` with role `owner` is SM242 for everyone and the table check refuses an `owner` row from SQL; the code is returned once and never stored (second call with the same id returns no code); A1: a wrong code RETURNS and the failed-attempt row persists (checked from a separate transaction), five wrong codes lock the caller, a correct code during the lock is not looked at; unknown, expired, used, revoked and other-workspace codes take the same result and write one failed attempt each; the normaliser (case, hyphens, spaces, Crockford look-alikes) pinned equal to the web normaliser; the admin invitation needs a current `aal2` session and fails after the code is proven (SM306 without a recorded failure); already a member is SM247 only after the code is proven; the last Owner (SM244), your own role (SM245), the 20-pending cap (SM246); `remove_member` effects table by table (section 7); the revoked grants (a direct `insert`/`update`/`delete` on `memberships` by a client is refused); every new personal column is in the erasure registry; the catalog guard.
* **Copy tests** for every replaced function (`tests/test_migration_copies.py` pattern), including the operator Owner cap.
* **Real stack (integration):** invite, accept as a freshly signed-up person, the second factor for an `admin` invitation, every refusal's fixed sentence, replay, another workspace, a hostile code (very long, unicode, SQL-looking) giving the same answer as an unknown one, the lock after five wrong codes; races: two accepts of one code, accept vs revoke, accept vs removal of the inviter, two role changes at once; direct-PostgREST attacks on `memberships` and `invitations`.
* **Unit and web:** fixed messages with no data-layer text; the code never in a log line (API log capture) and never in an audit row; the join page for every role; the fragment is read, copied and removed with `history.replaceState`, a query-string code is ignored, `Referrer-Policy: no-referrer` on `/app/join`; the members page offers no Owner role; the code is shown once and not after a reload; the `FakeMailer` path: the message text pinned, the address never reaching the database, a mailer failure leaves a valid invitation and a clear screen.
* **Headless driver:** `make rehearse-members` (opt-in, never in `make check`): a synthetic workspace; the existing rehearsal drivers' direct membership insert is replaced by invitation, acceptance and the new routes; every refusal asserted; "nothing could send" checks (no setting names a provider; the fake outbox is the only mail path).
* **Mutation (at the end, one runner at a time):** SQL mutants for every new function and constraint (role lists, the code lifecycle, the attempt counter, the aal2 and last-Owner guards, the closed reasons, the label rule, the cap, the revoked grants); Python and web mutants for the normaliser, the validators, the fixed messages, the join page's fragment handling and the mailer path. Survivors closed with tests or documented as equivalent with reasons.

## 12. Slicing (commits, sizes, full-check points)

| # | Commit | Size | Checks that run |
| --- | --- | --- | --- |
| M0 | ADR 0023 (incl. the amended role table) and the plan's as-built corrections | S | `make check-fast` |
| M1 | **Migration**: tables, functions, revoked grants, the operator Owner cap, the catalog allow-lists; pgTAP; copy tests | M | **full `make check`** (migration; roles, permissions) |
| M2 | API: repository, routes, fixed errors, log-safety words, fakes, unit and real-stack tests including the races | M | `make check-fast` + the touched integration files, then the race files |
| M3 | Web: members page, join page (fragment, `replaceState`, the header), tests. **STOP: the owner reviews** | M | `make check-fast` + the touched web tests |
| M4 | Optional (decision 1): the `Mailer` interface, `FakeMailer`, the `deliver_to` step and its tests | S | `make check-fast` + touched tests |
| M5 | Optional (decision 4): the password-change marker (operator function, proxy redirect, clear function) | S to M | **full `make check`** (migration) |
| M6 | The headless driver and the pinned click checklist use invitations; `add-family-member.md` becomes "hand over a code" | S | the driver; `make check-fast` |
| M7 | Mutation pass, ADR addendum, hand-off, checklist rows closed, `CLAUDE.md`; **one full `make check` from a clean `db-reset`** | S | full |

The owner reviews after M1 (the database and its proofs) and after M3 (the screens), as the existing plan says. Total: L (about two weeks of the agent's work without the optional slices).

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| The code leaks through a log, a referrer, a screenshot or the address bar | the fragment, `replaceState`, `no-referrer`, the log-safety words, a test that captures the logs; the code is shown once |
| Brute force of the code | 100 bits, 5 failed attempts an hour per caller, one answer for every failure, a per-hash lock |
| A hurried Owner invites the wrong role | the Owner role cannot be invited at all; role words are ours; a removal and a role change are one click away and audited |
| An operator-created account with a temporary password is guessed or reused | the forced change at first sign-in (decision 4); the password policy; MFA for Admin and Owner |
| Removal leaves orphaned work | counts are returned; Owner / Admin can discard drafts; ownership fields are nulled; nothing is rewritten |
| The fake mailer is mistaken for real delivery | the dev-only outbox route does not exist outside development; the UI says "e-mail delivery is not set up" unless the real adapter is configured |
| The new function set widens `SECURITY DEFINER` surface | role first in each, the catalog allow-list test, mutation of every role list, a direct-PostgREST attack suite |
| Sessions elsewhere stay valid after removal | stated (decision 9); access to THIS workspace ends at once through the database; revisit at the hosted stage |

## 14. Not in scope

Real e-mail delivery or SMTP; inviting an Owner through the app; self-service sign-up; SSO / passkeys; ending a person's sessions elsewhere; deleting a person's account or data (the erasure workflow); per-member permissions beyond the four roles; a tenant switcher redesign; invitation analytics; bulk invitations; a Telugu / Hindi / Kannada invitation message (a later native-reviewed item).

## 15. Decisions I need from the owner (maximum eight, each with my recommendation)

1. **Build the optional e-mail step now (slice M4: `Mailer` + `FakeMailer` + `deliver_to`), or leave it to T012?** *Recommendation: build the interface and the fake now (small), keep the real adapter for T012 with your approval; skip it only if you prefer to hand codes over in person for ever.*
2. **Confirm the role table of section 3** (especially: Viewers see no orders and no follow-ups; Admin cannot approve a flagged quote or cancel an order with money). *Recommendation: confirm; it is read from your own ADRs.*
3. **Should Sales and Viewer accounts also be required to enrol a second factor at first sign-in?** ADR 0016 limits it to Owner and Admin. *Recommendation: no for the family at Customer Zero; revisit before any external customer.*
4. **Build the forced-password-change marker (slice M5)** or rely on the operator telling the person to change it. *Recommendation: build it; a temporary password handed over in person is the weakest moment.*
5. **A cap on Admins** (the Owner role is already capped at three by the operator function). *Recommendation: no cap in v1.*
6. **Invitation default expiry 7 days, at most 30** (decision 1 of 2026-10-06). *Recommendation: keep.*
7. **Add the invitee's workspace name to the join confirmation** ("You joined Family Silks as sales") and nothing else. *Recommendation: yes.*
8. **Run M1 and M3 as owner-review stops** exactly as the existing plan says. *Recommendation: yes.*

**Not decided (left open on purpose):** the exact message wording of the invitation e-mail; whether a removed member may be re-invited at once (the design allows it); the hosted create-user path (checked at T012); the display of a former member in exports; the translation set.
