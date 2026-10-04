# ADR 0009: Web evidence pages and the demo seed (T004, milestone 3)

Status: accepted for milestone 3. Builds on ADR 0003 (web auth), ADR 0007 (web CRM page) and ADR 0008
(evidence model and API).

## Decisions

1. **Two detail pages**, server-rendered, under `/app/tenants/[tenantId]/`:
   `companies/[companyId]` and `leads/[leadId]`. Each shows a short read-only summary of the record and
   an Evidence section fed by `GET .../evidence` of OUR API (25 per page, "Load more" with the API's
   opaque cursor in the URL, "Back to the first page"). The company name and the lead status on the
   existing tenant page link to them (the link target is built from the row id only).
   `requireUser()` runs first; every data call is made on the server with the user's own token; the web
   never talks to PostgREST (the existing guards still hold).
2. **One not-found.** An unknown, malformed or foreign tenant, company or lead gives the same
   not-found page as T003 (the API answers 404 for all of them; this code never says which). A foreign
   company reached through the caller's own workspace path is also a 404. If the API is down the page
   shows an error and no placeholder data: an unreachable record fetch replaces the page with the error;
   an unreachable evidence fetch keeps the summary and shows an error in the Evidence section only.
3. **Evidence is plain text, enforced.** Kind, provider, retrieved / published dates, "added by"
   (`created_via`), URL, reference and snippet are rendered as text children of ordinary elements. The
   snippet keeps its line breaks through CSS (`white-space: pre-wrap`, class `plain-text`), not markup.
   Nothing builds an anchor, image, frame, media element, preview or prefetch from evidence data, and
   the page states that sources are never opened, fetched or previewed. `test/guards.test.ts` fails the
   build if the evidence UI contains `<a>`, `<img>`, `<iframe>`, `<script>` and friends, `next/image`,
   `dangerouslySetInnerHTML`, `.innerHTML`, `window.open`, a link `target`, any prefetch / preload hint,
   an `href` that is not an internal path, or an evidence field used anywhere but as a text child. A
   render test feeds hostile content (`javascript:` URLs, `<script>`, `<img onerror>`, an HTML anchor in
   a snippet) and asserts that it appears verbatim as text and creates no element.
4. **"Add evidence" form** (client component, Server Action `addEvidenceAction`), shown only to
   owner / admin / sales (the API still enforces the role; a forged post by a Viewer gets a 403 from the
   API). Fields: kind (select), URL, reference (with the typed-prefix hint), snippet, published date;
   a URL or a reference is required. The evidence id is generated ONCE per render of the page
   (`crypto.randomUUID()`) and sent in a hidden field, so a double submit repeats the same id and the API
   answers 200 for the identical retry. The action re-validates everything on the server (kind, URL
   scheme and length, reference pattern, snippet length, invisible characters with the same character set
   as `app.text_is_clean`, canonical ids, published date not in the future; the date becomes midnight
   UTC) before calling the API, and ignores any extra form field (no provider, origin, tenant or archive
   state can be sent). Failures become short generic messages (403 role, 404 unavailable, 409 archived /
   already-used form, 422 check the values, anything else try again); raw API text, codes and the
   submitted text are never shown, logged or echoed.
5. **Out of scope, on purpose:** no claims UI (no claims API; the research-agent ticket decides how
   claims are written), no archive / restore button (the API supports archiving links; the UI waits),
   no edit, no delete, no supersede, no contact / opportunity pages. No new dependency was added.
6. **The demo seed (`make seed-demo`, `scripts/seed_demo.py`)** is the T004 acceptance test: "a synthetic
   SME can be represented end-to-end and every researched fact can carry evidence."
   - It builds a clearly fake business: a workspace, a company, three contacts, three products, a lead,
     an opportunity, four evidence items on the company and two on the lead, and four claims. Every name
     starts with "DEMO" and says it is fictional; every address is on a reserved `.test` domain; no real
     person and no Customer Zero data.
   - **Everything goes through OUR API except claims.** Claims have no API, so the seed creates the claims
     and their evidence links (statuses: `supports`, `contradicts`, `context`; confidences: `unverified`,
     `low`, `medium`; every claim has at least one link, one claim has a contradicting one) through
     PostgREST using the demo user's **own JWT and the public anon key, under row-level security like
     any user**. There is **no service-role key** anywhere in the script (a test greps for the names).
   - **Safety:** it refuses to run unless both the Supabase URL and the API URL are local (`127.0.0.1`,
     `localhost`, `::1`; look-alike hosts such as `127.0.0.1.evil.example` and private addresses are
     refused), checked before any network call. It is idempotent: every row has an id derived from a
     name (`uuid5`), so a re-run sends the same ids, the API answers 200 for identical retries, and claims
     and links are looked up before being created (first run: 24 rows created; second run: 0). It reads
     its configuration from the environment or from the usual env files (`services/ai-api/.env`,
     `apps/web/.env.local`) for exactly the public values it needs and never prints them. The demo login
     is a fixed fake user whose password is a constant in the script: acceptable only because the script
     refuses any non-local host (checklist).
   - It ends with its own acceptance check (every claim has evidence; the API lists the company's
     evidence) and fails loudly otherwise.
   - `tests/integration/test_demo_seed.py` runs it against the real stack, twice, and verifies: the
     second run creates nothing; every claim has at least one evidence link and one is `contradicts`; the
     evidence appears through the API list for the company and the lead; every name is obviously fake; a
     second user in another workspace gets 404 on every demo URL (workspace, company, lead, their
     evidence, and the demo ids through their OWN workspace path), sees nothing of it through PostgREST,
     and cannot write into it.

## Verified locally (real stack, production build)

Supabase local stack + FastAPI (`uvicorn`, port 8100) + `next build && next start` (port 3100, a
scratch copy so the owner's own dev servers on 3000 / 8000 were never touched), `make seed-demo`
(24 rows created, then 0 on re-run), then 58 scripted checks as real users through the real forms:
the demo user signs in, opens the company and lead pages (summary + 4 / 2 evidence rows as plain text,
no anchor / image / script in the list, no external `href`, no claims or archive UI), adds evidence
through the form (listed newest first, markup in a snippet escaped, line breaks kept, a double submit
with the same form id leaves one row, the same id with different content gives the short 409 message,
six invalid inputs give short messages and store nothing, a reference-only entry works, 22 more rows
paginate 25 + 3 with no duplicates, a tampered cursor gives the error state), and the lead page takes
evidence too. A second user in another workspace gets HTTP 404 with the not-found payload (and no demo
data) for the demo workspace, company and lead, for an unknown company, and for the demo ids through
their own workspace; a foreign, a nonexistent and a malformed id answer identically (ids masked);
signed-out requests redirect to `/login`; the second user's forged "add evidence" is refused and adds
nothing; a viewer added to the workspace reads the evidence, gets no form, and their forged post is a
403 in the API log; no JWT secret or privileged key appears in the pages or the 11 scripts served, and
no PostgREST URL in the bundle. Neither the API's nor the web server's log contains any demo URL,
reference or snippet.

### Development server vs production build (observed)

| | `next dev` | `next build && next start` |
| --- | --- | --- |
| Supabase URL | `http://` accepted | **refused unless `https://`** (fail closed by design); verified through a throwaway local TLS proxy |
| Session cookies | not `Secure` | `Secure` (a plain-http client must be told to send them, as browsers do for localhost) |
| 404 body | ~17 KB, contains a `<template>` with **stack frames and file paths** | ~7.7 KB, no stack frames, no template |
| `Cache-Control` of a data page | `no-cache, must-revalidate` | `private, no-cache, no-store, max-age=0, must-revalidate` |
| 404 behaviour | status 404, `noindex`, same not-found payload for foreign / nonexistent / malformed ids | identical |

The isolation behaviour is the same in both; only production is safe to expose.

## Known limits

- The detail pages are summaries: no edit, archive, restore or delete; the lead page does not show its
  company or contact.
- The not-found UI is JavaScript-rendered (framework behaviour; checklist).
- `published_at` is entered as a date (midnight UTC), not a time.
- Evidence added by an agent will show `agent` in "Added by", but nothing writes as an agent yet (ADR 0008 #9).
