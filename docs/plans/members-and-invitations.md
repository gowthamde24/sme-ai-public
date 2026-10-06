# Members and invitations: how a person joins a workspace (PLAN ONLY, nothing built)

Status: written 2026-10-06 after rehearsal steps 4 and 5 (the rehearsal found that the API has no route to add a member). **Nothing in this plan is built and nothing here starts without the owner's approval.**
Related: ADR 0001 (roles), ADR 0016 (second factor), ADR 0017 (local-first: no e-mail, no SMTP, no hosting yet), `docs/runbooks/add-family-member.md` (the operator's path today), `docs/runbooks/sole-owner-erasure.md`, `docs/pre-pilot-checklist.md`.
Reads before building: CLAUDE.md, AGENTS.md, `docs/lanes.md`, this plan, ADR 0016.

## 1. How a person joins today

There are two ways, and neither is a screen a family member can use.

1. **The operator** (hosted stage): `app.operator_add_member('<slug>', '<email>', '<role>', '<reason>')`, run as `postgres` after the person accepted an account invitation from the Supabase dashboard (which needs SMTP). Never `owner`. Recorded in the audit log with the reason.
2. **The Owner or an Admin writes into the `memberships` table through the database API** with their own token (what the rehearsal driver does). It needs the new person's *user id*, a value only that person can read (`GET /v1/me`); a workspace member cannot look up anyone else's id (the `users` table is readable only for people one already shares a workspace with). No page, no API route, no prompt for the person's consent.

### What the policies actually allow (read from `20261004120200_t002_rls_policies.sql` and `20261005090000_t003_rls_policy_pattern.sql`, and checked against the local database on 2026-10-06)

Column grants for `authenticated`: `select`; `insert (tenant_id, user_id, role)`; `update (role)`; `delete`. Every client write also passes `app.guard_aal2_client_write()` (a password-only session is refused with SM306) and the audit trigger (`membership.create` is written with the actor; the audit trail of the rehearsal workspace shows it). `app.protect_last_owner()` refuses removing or demoting the last Owner (23514, a raw trigger message).

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

1. **No consent.** An Owner can put ANY existing account into the workspace, as Owner, with nothing but its id. The person is not asked, and learns of it when a workspace appears. An account that belongs to somebody else's customer or a former employee can be added without their knowing.
2. **No way to find the id.** The person has to read a raw UUID from `/v1/me` and send it. No screen shows it, no screen takes it.
3. **Granting Owner is one write.** One compromised or hurried Owner session (second factor included) can add an attacker's account as a co-Owner, who can then demote the original (the last-Owner guard only protects the last one).
4. **Errors are unreadable.** An Admin who tries to add an Admin gets a raw row-level-security message; an Admin editing their own row gets "0 rows" and no explanation; the last-Owner refusal is an unnamed 23514.
5. **A removal is a bare `delete`.** No reason is recorded, nothing says what happens to the person's open work, and the person is not told.
6. **No invitation exists to expire or revoke.** A mistaken add cannot be taken back except by removing the member (after they have already had access).
7. **The operator path needs SMTP and SQL.** Fine for the family's first account; not for adding a cousin on a Sunday.

## 3. The design

Principles: nobody is put into a workspace without having asked to be (accept with a code); a code is a one-time secret handed over by any channel (in person, on paper, by any chat; **no e-mail or SMTP is needed to join**: delivery by e-mail is a later add-on at the hosted stage); roles are granted only by functions that say who may grant which; everything privileged needs the second factor and writes an audit event; the table loses its client write grants.

### 3.1 Data (one migration, append-only; ADR 0022)
* `public.invitations` (tenant-owned, RLS, **no client write grant**, in `tests.tenant_table_registry`): `id` (the caller's id: idempotent create), `tenant_id`, `role` (`admin`, `sales`, `viewer`, or `owner`), `code_sha256` (the SHA-256 of a 100-bit random code; the code itself is never stored), `label` (up to 60 characters, "for the new cutter", no contact data), `created_by`, `created_at`, `expires_at` (default 7 days, at most 30), `status` (`pending`, `accepted`, `revoked`), `accepted_by`, `accepted_at`, `revoked_by`, `revoked_at`. Owner and Admin read their workspace's rows (never a code); nobody else reads any.
* `public.invitation_attempts` (private schema, no client access): a counter of failed code presentations per user per hour, to answer SM241 after 5.
* `memberships` loses `insert`, `update` and `delete` for `authenticated` (reads stay). The functions below run as definer and are the only writers (plus `create_tenant` and the operator functions, unchanged). The aal2 trigger stays as a second line.
* An audit event for each of: invitation created, accepted, revoked; member role changed; member removed (actor, tenant, target, role before and after, the closed reason; no code, no e-mail).

### 3.2 Functions (definer, `set search_path = ''`, role first, then the second factor, then the specific refusals; one generic 42501 before the role is proven)
| Function | Who | Second factor | What it does |
| --- | --- | --- | --- |
| `create_invitation(id, tenant, role, days, label)` | Owner: any role. Admin: `sales`, `viewer` only | yes | creates a pending invitation; **returns the code once** (20 characters, Crockford base32, four groups of five: `7QX2K-M9R4D-...`); an exact retry with the same id returns the SAME invitation but never the code again ("lost: revoke and make a new one"); at most 20 pending per workspace; at most 3 Owners in total |
| `accept_invitation(code)` | any signed-in person (not yet a member of that workspace) | for `admin` and `owner` roles (the person must have enrolled their authenticator first) | one transaction: looks the code up by its hash under a per-code lock, checks pending and not expired, inserts the membership, marks the invitation accepted, writes the audit event. **One generic refusal (SM240) for unknown, expired, used, revoked and wrong-workspace codes**: no oracle. Wrong codes count against SM241 |
| `revoke_invitation(id)` | Owner; Admin for `sales` / `viewer` invitations | yes | pending only; idempotent |
| `change_member_role(tenant, user, role, reason)` | Owner: any change except leaving no Owner. Admin: `sales` <-> `viewer` only | yes | reason from the closed list below; refuses changing your own role (SM245) so a demotion is always somebody else's decision |
| `remove_member(tenant, user, reason)` | Owner: anyone but the last Owner. Admin: `sales`, `viewer`. A non-Owner may remove THEMSELVES ("leave") | yes (not for leaving) | see 3.3 |
| `list_members(tenant)` | any member | no | role, display name, `joined_at`, pending count for Owner/Admin; the existing read route gains the fields |

Closed reasons for a role change or a removal: `left`, `role_changed`, `no_longer_works_here`, `access_no_longer_needed`, `security_concern`, `other`. No free text (PII minimisation).

### 3.3 What happens to a removed member's open work
* Access ends at once, in the database: every policy consults `memberships`, so the person's existing tokens read and write nothing in this workspace from the next request (they keep their account and any other workspaces).
* `leads.owner_user_id` and `opportunities.owner_user_id` become empty by the existing foreign key (`on delete set null`): the records are kept and show as unassigned (the screens must say "unassigned", and the owner must be offered the list).
* Quote drafts they made stay drafts; an Owner or Admin may reject any draft (they already may). Approved quotes, orders and their ledger events keep attributing the person ("a former member"); the audit trail is never rewritten.
* Their running or queued agent runs are cancelled in the same transaction (option-A delegated runs end with the person's access: ADR 0013).
* Their unaccepted invitations (if they were an Admin) are revoked.
* The removal result lists counts only (leads unassigned, drafts left, runs cancelled) so the Owner can follow up; no names, no content.
* Not done here: deleting the person's data (that is the erasure workflow, DPDP; a member who asks to be erased goes through it) and ending their sessions in other workspaces (not ours to end).

### 3.4 API and screens
* `POST /v1/tenants/{id}/invitations` (returns the code once), `GET .../invitations`, `POST .../invitations/{id}/revoke`, `POST /v1/invitations/accept` (not tenant-scoped: the caller is not a member yet), `POST .../members/{user}/role`, `POST .../members/{user}/remove`, and `GET .../members` extended. Every body carries only the person's inputs; the API decides nothing about roles; closed fixed sentences for every SQLSTATE; the code is never logged (the path words `invitations`, `accept` join the log-safety list; the body is never logged).
* Members page (Owner/Admin): the list, "Invite a person" (role, label, days) that shows the code **once** with copy and with the sentence "Give this code to the person yourself. It works once, for 7 days, and nobody can read it again"; pending invitations with revoke; change role and remove with the closed reasons and the open-work counts.
* "Join a workspace" page for a signed-in person without a workspace (or any person): a code box; the result is "You joined <workspace> as <role>". Role words are ours. The code is also accepted from a link fragment (`/app/join#code=...`), never a query string.
* The rehearsal driver replaces its direct membership insert by invitation, acceptance and the new routes; the report's finding is closed.

### 3.5 E-mail (later, not part of this build)
At the hosted stage, with SMTP, an invitation gains an optional "send to this address" step (an outbound message: needs the owner's approval and the usual draft/approve/send path). The code flow is unchanged, so nothing here has to be redone.

## 4. SQLSTATEs (free range SM240-SM249; SM2xx up to SM239 are taken)
| Code | Meaning |
| --- | --- |
| SM240 | the invitation code is not valid (unknown, expired, used, revoked or for another workspace: one answer) |
| SM241 | too many wrong codes: try again later |
| SM242 | this role cannot be granted or changed by the caller (an Admin granting `admin` or `owner`; more than 3 Owners; over the pending limit is SM246) |
| SM243 | no such member in this workspace |
| SM244 | the workspace must keep an Owner (replaces the raw 23514 of `protect_last_owner`) |
| SM245 | you cannot change your own role |
| SM246 | too many pending invitations (20) |
| SM247 | the person is already a member |
| 22023 / 23505 | invalid argument / the invitation id is used with other content; 42501 the one generic refusal before the role is proven; SM306 second factor |

## 5. Tests
* **pgTAP** (new file; each function by each role by aal): the matrix of section 3.2 cell by cell; the code is returned once and never stored (hash only; a second call with the same id returns no code); a code of another workspace, an expired, a used and a revoked code give the same SM240; the rate limit; replays; a removed member reads nothing at once (the same token); owner/leads/opportunities fields emptied; running agent runs cancelled; last-Owner and Owner-cap refusals; audit rows without a code; the table has no client write grant any more (a direct insert is refused for every role); the tenant registry and role matrix include the new tables.
* **Real stack**: through the API with real tokens: invite, accept as a freshly signed-up person, the second factor, every refusal's fixed sentence, replay, the other workspace, a hostile code (very long, unicode, SQL-looking) refused with the same answer; **two accepts of one code at once** (one membership), **accept racing revoke**, **accept racing a removal of the inviter**.
* **Unit and web**: fixed messages with no data-layer text; the code never in a log line; the join and members pages for every role; the code shown once and not in the page after a reload.
* **Mutation pass** on the role rules, the code lifecycle, the aal2 and last-Owner guards, the closed reasons.

## 6. Commit order (stop for review after commit 1 and after commit 3)
1. ADR 0022 and the migration (tables, functions, the revoked grants) with its pgTAP and the copy-pin tests.
2. The API: repository, routes, fixed errors, log-safety words, fakes, unit and real-stack tests (including the races).
3. The web: members page, join page, tests. **Stop: the owner reviews.**
4. The driver and the click checklist use invitations; the runbook `add-family-member.md` becomes "hand over a code"; the operator function stays for the first Owner and for recovery.
5. Mutation pass, full `make check`, the hand-off.

## 7. Open owner decisions (recommended default first)
1. **Expiry.** 7 days, at most 30. (Shorter is safer, longer is kinder to a cousin who is away.)
2. **Who may invite an Owner.** The Owner only, with the invited person's second factor enrolled, at most 3 Owners. (Alternative: no new Owners at all through the app; the operator does it.)
3. **Admin's reach.** `sales` and `viewer` only (as today).
4. **Code form.** 20 characters of Crockford base32 (100 bits, no look-alike letters), shown once. (Alternative: a longer phrase for reading aloud.)
5. **A lost code.** Revoke and make a new one; the code is never shown again.
6. **Accounts.** Today an account is made by hosted sign-up (closed) or by the operator's dashboard invitation (needs SMTP). Default: keep hosted sign-up CLOSED and let the operator create the account (one dashboard action), then the Owner invites by code; revisit with SMTP at the hosted stage. (Alternative: open sign-up so a person can create an account and use a code, which still needs e-mail confirmation and so SMTP.)
7. **Removal reasons.** The closed list above. (Alternative: none.)
8. **Open-work counts on removal.** Shown to the Owner, never names. (Alternative: block a removal while a person has queued agent runs.)
9. **Sessions elsewhere.** Not ended: access to this workspace ends at once through the database; their other workspaces are not ours. (Alternative: also end all their sessions, which needs a GoTrue call from a trusted service: not available locally.)
10. **A former member in history.** Shown as "a former member" without a name after removal. (Alternative: keep the display name.)
11. **Pending limit.** 20 per workspace.
12. **Direct table writes.** Revoked once the functions exist (default). (Alternative: keep them for the Owner as a break-glass: not recommended, it keeps problem 1.)
