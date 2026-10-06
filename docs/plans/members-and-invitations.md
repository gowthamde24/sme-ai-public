# Members and invitations: how a person joins a workspace (PLAN ONLY, nothing built)

Status: **Decisions recorded 2026-10-06. Not built. Queued after T011a, before T012.** Written after rehearsal steps 4 and 5 (the rehearsal found that the API has no route to add a member); the owner's decisions and amendments of 2026-10-06 are folded in below.
Related: ADR 0001 (roles), ADR 0016 (second factor), ADR 0017 (local-first: no e-mail, no SMTP, no hosting yet), `docs/runbooks/add-family-member.md` (the operator's path today), `docs/runbooks/sole-owner-erasure.md`, `docs/pre-pilot-checklist.md`.
Reads before building: CLAUDE.md, AGENTS.md, `docs/lanes.md`, this plan, ADR 0016.

## 1. How a person joins today

There are two ways, and neither is a screen a family member can use.

1. **The operator** (hosted stage): `app.operator_add_member('<slug>', '<email>', '<role>', '<reason>')`, run as `postgres` after the person accepted an account invitation from the Supabase dashboard (which needs SMTP). It refuses `owner`. A separate operator function, `app.operator_add_owner_exception(slug, email, reason)` (reason of at least 20 characters, audit event `membership.operator_added_owner`), adds an Owner; it exists for the sole-Owner recovery case. Both are recorded in the audit log with the reason.
2. **The Owner or an Admin writes into the `memberships` table through the database API** with their own token (what the rehearsal driver does). It needs the new person's *user id*, a value only that person can read (`GET /v1/me`); a workspace member cannot look up anyone else's id (the `users` table is readable only for people one already shares a workspace with). No page, no API route, no prompt for the person's consent.

### What the policies actually allow (read from `20261004120200_t002_rls_policies.sql` and `20261005090000_t003_rls_policy_pattern.sql`, and checked against the local database on 2026-10-06)

Column grants for `authenticated`: `select`; `insert (tenant_id, user_id, role)`; `update (role)`; `delete`. Every client write also passes `app.guard_aal2_client_write()` (a password-only session is refused with SM306) and the audit trigger (`membership.create` is written with the actor). `app.protect_last_owner()` refuses removing or demoting the last Owner (23514, a raw trigger message).

| Action | Owner | Admin | Sales / Viewer |
| --- | --- | --- | --- |
| read memberships and the display names of co-members | yes | yes | yes |
| add a member with role `sales` or `viewer` | yes | yes | no (0 rows) |
| add a member with role `admin` | yes | **refused** (RLS) | no |
| add a member with role `owner` | **yes** (no other check) | **refused** | no |
| change a role: to or from `admin` / `owner` | yes (not the last Owner) | **refused** | no |
| change `sales` <-> `viewer` | yes | yes | no |
| change or remove their OWN row | yes (not the last Owner) | no: 0 rows, silently | no |
| remove a member | any, not the last Owner | `sales` / `viewer` only | no |
| add a user id that does not exist | refused (foreign key 23503) | same | |
| without the second factor | refused (SM306) | refused (SM306) | n/a |

## 2. What is wrong with that

1. **No consent.** An Owner can put ANY existing account into the workspace, as Owner, with nothing but its id. The person is not asked, and learns of it when a workspace appears.
2. **No way to find the id.** The person has to read a raw UUID from `/v1/me` and send it. No screen shows it, no screen takes it.
3. **Granting Owner is one write.** One compromised or hurried Owner session (second factor included) can add an attacker's account as a co-Owner, who can then demote the original (the last-Owner guard only protects the last one).
4. **Errors are unreadable.** An Admin who tries to add an Admin gets a raw row-level-security message; an Admin editing their own row gets "0 rows" and no explanation; the last-Owner refusal is an unnamed 23514.
5. **A removal is a bare `delete`.** No reason is recorded, nothing says what happens to the person's open work, and the person is not told.
6. **No invitation exists to expire or revoke.** A mistaken add cannot be taken back except by removing the member (after they have already had access).
7. **The operator path needs SMTP and SQL.** Fine for the family's first account; not for adding a cousin on a Sunday.

## 3. The design

Principles: nobody is put into a workspace without having asked to be (accept with a code); a code is a one-time secret handed over by any channel (in person, on paper, by any chat; **no e-mail or SMTP is needed to join**: delivery by e-mail is a later add-on at the hosted stage); roles are granted only by functions that say who may grant which; everything privileged needs the second factor and writes an audit event; the table loses its client write grants; **the Owner role is never granted through the app** (decision 2).

### 3.1 Data (one migration, append-only; ADR 0022)
* `public.invitations` (tenant-owned, RLS, **no client write grant**, in `tests.tenant_table_registry`): `id` (the caller's id: idempotent create), `tenant_id`, `role` (**`admin`, `sales` or `viewer` only**; a check constraint refuses `owner`), `code_sha256` (the SHA-256 of the NORMALISED 100-bit random code; the code itself is never stored), `label` (up to 60 characters, "for the new cutter"; **refused when it holds a run of 7 or more digits or an "@"**, so it cannot carry a phone number or an address; the column is covered by `erase_tenant` and by the erasure registry), `created_by`, `created_at`, `expires_at` (default 7 days, at most 30), `status` (`pending`, `accepted`, `revoked`), `accepted_by`, `accepted_at`, `revoked_by`, `revoked_at`. Owner and Admin read their workspace's rows (never a code); nobody else reads any.
* `private.invitation_attempts` (private schema, no client access): one row per FAILED code presentation (user, time), used to answer SM241 after 5 in an hour. **Rows older than 24 hours are deleted** (by the next `accept_invitation` call and by a daily operator task; no scheduled job is assumed).
* `memberships` loses `insert`, `update` and `delete` for `authenticated` (reads stay). The functions below run as definer and are the only writers (plus `create_tenant` and the operator functions, unchanged). The aal2 trigger stays as a second line.
* An audit event for each of: invitation created, accepted, revoked; member role changed; member removed (actor, tenant, target, role before and after, the closed reason; no code, no e-mail).
* The Owner role: only `app.operator_add_owner_exception` (or its successor) creates an Owner membership, with a reason of at least 20 characters and an audit event; **the cap of 3 Owners lives in that operator function** (and in `change_member_role`, which cannot promote to `owner` at all).

### 3.2 Functions (definer, `set search_path = ''`, role first, then the second factor, then the specific refusals; one generic 42501 before the role is proven)
| Function | Who | Second factor | What it does |
| --- | --- | --- | --- |
| `create_invitation(id, tenant, role, days, label)` | Owner: `admin`, `sales`, `viewer`. Admin: `sales`, `viewer` only. **`owner` is refused (SM242) for everyone** | yes | creates a pending invitation; **returns the code once** (20 characters, Crockford base32, four groups of five: `7QX2K-M9R4D-...`); an exact retry with the same id returns the SAME invitation but never the code again ("lost: revoke and make a new one"); at most 20 pending per workspace (SM246) |
| `accept_invitation(code)` | any signed-in person (not yet a member of that workspace) | for an `admin` invitation: **the caller's CURRENT session must be aal2** (an authenticator enrolled but not used in this session is refused) | see 3.2.1 |
| `revoke_invitation(id)` | Owner; Admin for `sales` / `viewer` invitations | yes | pending only; idempotent |
| `change_member_role(tenant, user, role, reason)` | Owner: any change among `admin`, `sales`, `viewer` (a change TO or FROM `owner` is the operator's) except leaving no Owner. Admin: `sales` <-> `viewer` only | yes | reason from the closed list below; refuses changing your own role (SM245) so a demotion is always somebody else's decision |
| `remove_member(tenant, user, reason)` | Owner: anyone but the last Owner (and not another Owner: that is the operator's). Admin: `sales`, `viewer`. A non-Owner may remove THEMSELVES ("leave") | yes (not for leaving) | see 3.3 |
| `list_members(tenant)` | any member | no | role, display name, `joined_at`, pending count for Owner/Admin; the existing read route gains the fields |

Closed reasons for a role change or a removal: `left`, `role_changed`, `no_longer_works_here`, `access_no_longer_needed`, `security_concern`, `other`. No free text (PII minimisation).

#### 3.2.1 `accept_invitation` and the failed-attempt counter (amendment A1)
A function that RAISES on a wrong code rolls its own transaction back, and the failed-attempt row with it: the rate limit would never count. So **`accept_invitation` does not raise on a wrong code.** It runs in one transaction and returns a small result:
* it first deletes attempts older than 24 hours and checks the caller's failed attempts in the last hour: at 5 or more it returns `{status: 'locked'}` WITHOUT looking at the code (the API maps it to SM241);
* it normalises the presented code, hashes it, and looks the hash up under a per-hash lock. **Unknown, expired, used, revoked, and other-workspace codes all take the same path**: one failed-attempt row is written and `{status: 'invalid'}` is returned (the API maps it to SM240, the same answer for every cause, with no timing or wording difference);
* only a code that is PROVEN valid reaches the next checks: the second factor for an `admin` invitation (`SM306`, raised AFTER the code is proven and WITHOUT recording a failure), an existing membership (`SM247`, reachable only after the code is proven valid, so SM247 is never an oracle for "this workspace exists"), then the insert, the status change and the audit event, and `{status: 'joined', tenant, role}`;
* the function never reveals which of the causes it was. A refusal that needs a raise (SM306, SM247, the generic 42501 for no session) is raised only after the attempt bookkeeping is no longer needed, i.e. after a proven-valid code.

#### 3.2.2 Code handling (amendment A5)
* The presented code is **normalised before hashing**: case folded, hyphens and spaces removed, and the Crockford look-alikes mapped (`O`->`0`, `I` and `L`->`1`, `U` refused/removed per Crockford's rules). Length is checked after normalising (20 symbols); anything else is a failed attempt like any wrong code. The same normaliser runs in the database function (the hash is the authority) and in the web form (for the person's convenience), and a test pins them equal.
* The code is never logged: not by the API (the body and the `code` field are never logged; the path words `invitations` and `accept` join the log-safety list), not by the web server, and not in an audit event.
* The join page reads the code from the URL **fragment** (`/app/join#code=...`), copies it into the form, **removes it from the address bar with `history.replaceState`**, and the page is served with **`Referrer-Policy: no-referrer`** (a per-route header on `/app/join`; the app-wide default today is `strict-origin-when-cross-origin`). A fragment is never sent to a server, but the replaceState and the header keep it out of history sharing and referrers. A query-string code is not accepted.

### 3.3 What happens to a removed member's open work
* Access ends at once, in the database: every policy consults `memberships`, so the person's existing tokens read and write nothing in this workspace from the next request (they keep their account and any other workspaces).
* **`leads.owner_user_id` and `opportunities.owner_user_id` (amendment A4).** Checked against the local database on 2026-10-06: both columns are part of a composite foreign key `(tenant_id, owner_user_id) REFERENCES public.memberships (tenant_id, user_id) ON DELETE SET NULL (owner_user_id)`. They reference **`memberships`, not `users`**, so deleting the membership DOES fire the foreign key and empties the field by itself. Because that is a database side effect that a later migration could silently lose, **`remove_member` also nulls both fields explicitly in the same transaction**, and the pgTAP test asserts the result (the fields are null after the removal, for the removed member's leads and opportunities only, in that workspace only, the other members' rows untouched, and the count in the result equals the rows changed).
* Quote drafts they made stay drafts; an Owner or Admin may reject any draft (they already may). Approved quotes, orders and their ledger events keep attributing the person ("a former member"); the audit trail is never rewritten.
* Their running or queued agent runs are cancelled in the same transaction (option-A delegated runs end with the person's access: ADR 0013).
* Their unaccepted invitations (if they were an Admin) are revoked.
* The removal result lists counts only (leads unassigned, opportunities unassigned, drafts left, runs cancelled, invitations revoked) so the Owner can follow up; no names, no content.
* Not done here: deleting the person's data (that is the erasure workflow, DPDP; a member who asks to be erased goes through it) and ending their sessions in other workspaces or elsewhere (not ours to end; revisit at the hosted stage).

### 3.4 API and screens
* `POST /v1/tenants/{id}/invitations` (returns the code once), `GET .../invitations`, `POST .../invitations/{id}/revoke`, `POST /v1/invitations/accept` (not tenant-scoped: the caller is not a member yet), `POST .../members/{user}/role`, `POST .../members/{user}/remove`, and `GET .../members` extended. Every body carries only the person's inputs; the API decides nothing about roles; closed fixed sentences for every SQLSTATE; the API maps the accept function's `invalid` and `locked` results to SM240 and SM241.
* Members page (Owner/Admin): the list, "Invite a person" (role `admin`, `sales` or `viewer`; label; days) that shows the code **once** with copy and with the sentence "Give this code to the person yourself. It works once, for 7 days, and nobody can read it again"; pending invitations with revoke; change role and remove with the closed reasons and the open-work counts. There is no way to invite or promote an Owner here; the page says "Owners are added by the operator".
* "Join a workspace" page for a signed-in person: a code box, the fragment handling of 3.2.2; the result is "You joined <workspace> as <role>". Role words are ours. For an admin invitation the page says plainly "This needs your authenticator app for this session" when the session is not at the second-factor level.
* The rehearsal driver replaces its direct membership insert by invitation, acceptance and the new routes; the report's finding is closed.

### 3.5 E-mail (later, not part of this build)
At the hosted stage, with SMTP, an invitation gains an optional "send to this address" step (an outbound message: needs the owner's approval and the usual draft/approve/send path). The code flow is unchanged, so nothing here has to be redone.

## 4. SQLSTATEs (free range SM240-SM249; SM2xx up to SM239 are taken)
| Code | Meaning |
| --- | --- |
| SM240 | the invitation code is not valid (unknown, expired, used, revoked or for another workspace: one answer; returned by the API from the function's `invalid` result, never raised by the function) |
| SM241 | too many wrong codes: try again later (from the function's `locked` result) |
| SM242 | this role cannot be invited or changed by the caller: **`owner` can never be invited (for everyone, including the Owner)**; an Admin inviting or granting `admin`; a change to or from `owner` |
| SM243 | no such member in this workspace |
| SM244 | the workspace must keep an Owner (replaces the raw 23514 of `protect_last_owner`) |
| SM245 | you cannot change your own role |
| SM246 | too many pending invitations (20) |
| SM247 | the person is already a member (reachable only after the code is proven valid) |
| 22023 / 23505 | invalid argument (a label with a digit run of 7 or more or an "@", a role not in the list, days out of range) / the invitation id is used with other content; 42501 the one generic refusal before the role is proven; SM306 second factor |

The cap of 3 Owners is in the operator function and answers its own error there (not an application SQLSTATE: the operator runs it in SQL).

## 5. Tests
* **pgTAP** (new file; each function by each role by aal): the matrix of section 3.2 cell by cell; **`create_invitation` with role `owner` is refused SM242 for the Owner, an Admin and everyone, and the table check refuses an `owner` row even from SQL**; the code is returned once and never stored (hash only; a second call with the same id returns no code); **A1:** `accept_invitation` with a wrong code RETURNS (does not raise) and the failed-attempt row **persists after the call (checked from a separate transaction)**, five wrong codes lock the caller (`locked`), and a correct code during the lock is not looked at; **unknown, expired, used, revoked and other-workspace codes take the same code path and give the same answer** (same result, same attempt row, no difference in the returned shape); **SM247 is reachable only after the code is proven valid** (an already-member caller with a wrong code gets `invalid`, with a valid one gets SM247); attempts older than 24 hours are deleted; **A3:** an `admin` invitation accepted by an aal1 session (even with an enrolled factor) is refused SM306 after the code is proven and no failure is recorded, an aal2 session joins, a `sales` or `viewer` invitation needs no second factor; **A5:** the normaliser (lower case, hyphens, spaces, look-alikes) gives the same hash as the canonical code, a wrong-length code is a failed attempt, and the same normaliser in the web form is pinned equal by a test; the label check (a digit run of 7, a run of 6, an "@", exactly 60 and 61 characters) and its erasure by `erase_tenant`; replays; **A4:** after `remove_member` the removed member's `leads.owner_user_id` and `opportunities.owner_user_id` are null in that workspace and only those, the count in the result matches, the other members' rows and other workspaces are untouched, and the explicit update still holds if the foreign key action were absent (the test drops nothing: it asserts the result and reads the constraint definition so a changed foreign key fails the test); a removed member reads nothing at once (the same token); running agent runs cancelled; last-Owner and role-change refusals; audit rows without a code; the table has no client write grant any more (a direct insert is refused for every role); the tenant registry and role matrix include the new tables.
* **Real stack**: through the API with real tokens: invite, accept as a freshly signed-up person, the second factor for an admin invitation, every refusal's fixed sentence, replay, the other workspace, a hostile code (very long, unicode, SQL-looking) refused with the same answer as an unknown one, the lock after five wrong codes; **two accepts of one code at once** (one membership), **accept racing revoke**, **accept racing a removal of the inviter**.
* **Unit and web**: fixed messages with no data-layer text; the code never in a log line (API log capture) and never in an audit row; the join page for every role; the fragment is read, copied and removed with `history.replaceState`, a code in the query string is ignored, and the response carries `Referrer-Policy: no-referrer`; the members page offers no Owner role; the code shown once and not in the page after a reload.
* **Mutation pass** on the role rules, the code lifecycle and normaliser, the attempt counter, the aal2 and last-Owner guards, the closed reasons, the label rule.

## 6. Commit order (stop for review after commit 1 and after commit 3)
1. ADR 0022 and the migration (tables, functions, the revoked grants, the operator function's Owner cap) with its pgTAP and the copy-pin tests.
2. The API: repository, routes, fixed errors, log-safety words, fakes, unit and real-stack tests (including the races).
3. The web: members page, join page (fragment, replaceState, the header), tests. **Stop: the owner reviews.**
4. The driver and the click checklist use invitations; the runbook `add-family-member.md` becomes "hand over a code"; the operator functions stay for the first Owner and for recovery.
5. Mutation pass, full `make check`, the hand-off.

Queue: after T011a, before T012 (the Customer Zero stage needs a second person to join for real).

## 7. Decisions (owner, recorded 2026-10-06)
1. **Expiry:** 7 days by default, at most 30.
2. **No Owner invitations through the app.** The Owner role is created only by the operator function (a reason of at least 20 characters, an audit event); `create_invitation` with role `owner` is refused SM242; the 3-Owner cap lives in the operator function.
3. **Admin's reach:** an Admin invites `sales` and `viewer` only.
4. **Code form:** 20 characters of Crockford base32 (100 bits), shown once.
5. **A lost code:** revoke it and make a new one; it is never shown again.
6. **Accounts:** hosted sign-up stays CLOSED; the operator creates the account, then the Owner invites by code (see the runbook note below).
7. **Removal reasons:** the closed list of 3.2.
8. **Open-work counts on removal:** counts only, no names.
9. **Sessions elsewhere:** not ended; access to this workspace ends at once through the database. Revisit at the hosted stage.
10. **A former member in history:** shown as "a former member" without a name after removal.
11. **Pending limit:** 20 per workspace.
12. **Direct table writes:** revoked once the functions exist.

## 8. Runbook note: creating an account without SMTP (amendment A6; goes into `docs/runbooks/add-family-member.md` when this is built)
With sign-up closed and no SMTP, the operator creates the person's account in the Supabase dashboard's **create user** with **auto-confirm** and a **temporary password** handed over in person, then the Owner hands over the invitation code. The person must change the password and enrol their authenticator at first login.
* **Verified locally: NO.** This was not exercised: the local stack has sign-up open with auto-confirm, which is not the same path, and the admin create-user endpoint needs the service-role key, which this work must not read or use. What IS verified locally is the rest of the chain with an account made by public sign-up: sign in, enrol and answer the authenticator challenge (the rehearsal driver does this for five people), the second-factor level of a session, and `/auth/set-password`.
* **To verify at the hosted stage:** that the dashboard's create-user with auto-confirm works as described, and that a **forced** password change at first login exists. Supabase has no native "must change password" flag, so the plan must either use the existing `/auth/set-password` flow for the first sign-in, or add an application-side marker; this is an open design point for the hosted stage, not a verified fact.
