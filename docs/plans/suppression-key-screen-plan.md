# Plan: the suppression-key screen (K1)

Status: **BUILD PLAN, written before the build (2026-10-08), branch `web/suppression-key-screen` from `origin/main` at `79e5e1a`.** Web only: no migration, no API change, no new dependency. Source rows: hand-off OPEN item 2 (`docs/handoff-t010-part2.md`), the checklist rows "Screen/endpoint to record suppression keys" and "Backfill the keys of existing contacts" (`docs/pre-pilot-checklist.md`), ADR 0020.

## 1. What it is

A plain Owner-only page, `/app/tenants/{id}/suppression`, that shows how many contacts are still **unkeyed** and runs the existing backfill. It is the way the Owner clears the hard gate "no contact without a suppression key before the first outreach".

It calls two endpoints that already exist and does not change them:

| Call | Who (the API decides) | Returns |
| --- | --- | --- |
| `GET /v1/tenants/{id}/suppression/status` | Owner or Admin | `key_configured`, `key_version`, `unkeyed_contacts` (counts and flags only) |
| `POST /v1/tenants/{id}/suppression/backfill` | Owner with a second factor (403 `mfa_required` otherwise) | `recorded`, `skipped`, `flagged`, `unkeyable`, `remaining` |

The backfill is idempotent and batched (100 a batch, 5 batches a call): the Owner presses the button again while `remaining` is above zero.

## 2. What the screen shows, and the states

One question decides the headline, and it is decided by one pure function `suppressionReadiness(status)` fed only by the **status** the API just returned:

| State | When | Headline |
| --- | --- | --- |
| `unavailable` | the status could not be read (outage, 503 `suppression_unavailable`, a body that fails the contract) | "Could not read the suppression status. Treat this as NOT ready." No number is shown. |
| `no_key` | `key_configured` is false | "The suppression key is not configured on the server. Contacts cannot be keyed. NOT ready." No button. |
| `unkeyed` | `unkeyed_contacts` is a number above 0, or null | "N contacts have no suppression key. NOT ready: they cannot receive a follow-up draft." The button. |
| `clear` | `key_configured` and `unkeyed_contacts === 0` | "No contact is waiting for a key." plus "This is one condition before the first outreach; it does not open the real-data gate." |

Rules that make it impossible to read as ready while a contact is unkeyed:

* The word "ready" never appears except in the negative ("NOT ready") and only `clear` gets the calm headline. Anything unknown (null, outage, a mismatch) is `unavailable` or `unkeyed`, never `clear`.
* **A backfill's own answer never says clear.** It reports its counts ("recorded N, still unkeyed M") and then the page re-reads the status; only the re-read can say `clear`. A contact whose address cannot be normalised (`unkeyable`) stays unkeyed, so `remaining` stays above zero and the headline stays `unkeyed`; the result line says how many of them there are.
* The check time is shown, because a contact made later straight through PostgREST is unkeyed again.
* No key, hash, address or phone number is ever displayed (the API does not send one; the parser refuses a body with an unknown field, so a new field cannot be rendered by accident).

Not shown, on purpose: a count of keyed contacts. The status endpoint returns only the unkeyed count and this ticket does not change the API. If the owner wants "N keyed of M", it is a small API addition (a follow-up, listed in the report).

## 3. Who sees what

| Person | Sees | API called |
| --- | --- | --- |
| Owner with a second factor (aal2) | status, button, result | status, backfill |
| Owner without it | status, and in place of the button: "Recording keys needs your authenticator app. Set it up on the Security page, then sign in again with its code." | status only |
| Admin, Sales, Viewer | "Only the owner records suppression keys." and nothing else | none |
| not signed in | redirect to `/login` | none |
| another workspace or a malformed id | not found | `fetchTenant` only |

This is the same pattern as the price-list page (`user.aal !== "aal2"` shows the note) and the same server refusal (`mfa_required` becomes the authenticator sentence). The guard is reused as it is; the API and the database enforce regardless of what the page shows.

## 4. Errors

Short sentences of our own words; a raw API body or a submitted value is never echoed. `mfa_required` gives the authenticator sentence; 403 "Only the owner can record suppression keys."; 404 "This workspace is not available."; `suppression_key_not_configured` and 503 "Suppression keys are not available right now. Nothing was changed."; anything else "Could not record the keys. Try again." A rejected session redirects to `/login`.

## 5. Files

New:
* `apps/web/lib/api/suppression.ts` (+ `.test.ts`): strict parsers, `fetchSuppressionStatus`, `runBackfill`, `suppressionReadiness`.
* `apps/web/app/app/tenants/[tenantId]/suppression/page.tsx`, `actions.ts`, `suppression-form.tsx` (the client button and result), with `page.test.tsx` and `actions.test.ts`.

Touched:
* the tenant home page: one Owner-only link "Suppression keys →" (+ its test).
* `docs/pre-pilot-checklist.md` (the screen row) and `docs/handoff-t010-part2.md` (OPEN item 2): status only.

Not touched: any API file, any migration, RLS, SECURITY DEFINER function, `followup_cadence`, the design-v2 files, `package.json`.

## 6. Tests

* Parsers: accept the API's bodies; refuse an unknown field, a negative or non-integer count, a missing field, a string where a number belongs.
* `suppressionReadiness`: `clear` only for configured and exactly zero; null, positive, not configured and unavailable are never `clear` (table test).
* Page: Owner aal2 sees status and button; Owner aal1 sees the status and the note and no button; Admin, Sales and Viewer get the notice and the API is not called; not found, login redirect and outage as on the other pages; **a headline with unkeyed above 0 contains "NOT ready" and never the clear sentence**; no key, hash, address or phone in the HTML (canary values in the fake).
* Action: authenticates first; calls the backfill with the user's token and the tenant only (no body); revalidates the page; the result line never says clear even when `remaining` is 0 in the answer; each error code maps to its sentence; a canary in a thrown error is not echoed; a malformed tenant id never reaches the API; a second press is safe (the API is idempotent).
* The home link shows for the Owner only.

## 7. Checks and stops

Per commit: `make check-fast` and the touched vitest files. A full `make check` only if the permission or suppression path (API or database) changes, which this ticket does not. At the end, once: the web CI set with npm 10.9.2 (`npx -y npm@10.9.2`): lint, typecheck, test, build; no lockfile regenerated.

Stop and report if: a migration or API change seems needed; the second-factor guard cannot be reused; a test needs real data; a dependency is needed. None is expected.

## 8. Assumptions

* The screen is plain English text like its neighbours (price list, privacy); the design-v2 i18n store and tokens belong to another agent and are not used.
* Admin may read the status through the API, but the screen is Owner-only as requested, so an Admin sees the notice and no call is made for them.
