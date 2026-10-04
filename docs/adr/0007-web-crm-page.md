# ADR 0007: Web CRM page (T003, milestone 3)

Status: accepted for milestone 3. Builds on ADR 0003 (web auth) and ADR 0006 (CRM API).

## Decisions

1. **One page: `/app/tenants/[tenantId]`.** Five read-only tables (companies, contacts, products, leads,
   opportunities) behind tabs, "Load more" pagination, empty states, a clear error state, and one
   create form (company). Linked from the workspace list on `/app`.
2. **Server-side only, through OUR API.** `requireUser()` runs first (no session: redirect before any
   other call); every data call goes to `NEXT_PUBLIC_API_BASE_URL` with the user's own token
   (`lib/api/crm.ts`). The web never calls Supabase PostgREST. Guard tests fail on `/rest/v1`,
   `.rpc(`, `supabase.from(`, `createClient`, on any `fetch(` outside `lib/api/client.ts`, and on any
   CRM page/client importing the Supabase plumbing; all earlier guards (no service-role or JWT-secret
   names, allow-listed `NEXT_PUBLIC_*`, no browser Supabase client) still hold.
3. **Not found is one answer.** A tenant that does not exist, a malformed id, and a tenant the caller
   does not belong to all call `notFound()`: the API answers 404 for the last two without distinction
   and the page never says which. Verified end to end: user B on user A's tenant page gets the same
   HTTP 404 (noindex, same not-found payload, bodies equal once the requested id is masked) as a
   random uuid or a malformed id, and nothing about A's workspace appears.
4. **Pagination uses the API's opaque cursor in the URL** (`?tab=contacts&cursor=...`). The cursor is
   not PII; URLs carry only the tab and the cursor (no names, e-mails or search terms; there is no
   search box). "Load more" is a link to the next page (server-rendered), with a link back to page one.
   The API redacts query strings from its access log.
5. **Create company: idempotent by construction.** The page generates the row id ONCE per render
   (`crypto.randomUUID()` on the server) and puts it in a hidden field; a double submit repeats the same
   id, so the API treats the second call as a retry (200, one row). The Server Action re-validates
   everything (canonical uuid, lengths, type), sends only non-empty optional fields, and maps API
   failures to short generic messages (403 role, 404 unavailable, 409 "form already used", 422 values,
   anything else "try again"). Raw API bodies, codes and submitted values are never shown. The form is
   shown only to owner/admin/sales; the API still enforces it (a forged post by a viewer or by another
   tenant's user was refused: 403 / 404, nothing created).
6. **Responses are validated, not trusted.** `parsePage` checks every displayed field's type and enum;
   a malformed payload becomes the error state, never rendered. Types come from
   `packages/contracts/crm.ts` (generated from the API models); no new dependencies.
7. **No placeholder data.** If the API is down the page says so and shows no table.

## Verified locally (real stack)

Supabase + FastAPI + a production build of the web app (`next build && next start`), three users in
two tenants, driven over HTTP exactly as a browser's form posts: workspace creation through the UI;
the tenant page for the owner; creating a company; double submit (one row); same id with a different
payload (generic 409 message, no second row); malformed form id; all five tables with real rows;
pagination across 31 rows (25 + 6, no duplicates or gaps) with a tampered cursor giving the error
state; user B and user A each getting the identical 404 for the other's tenant and for tabs of it;
signed-out redirect with a relative `next`; a viewer seeing tables but no form, and a forged create by
the viewer and by the other tenant's user refused with nothing created; no service-role key or JWT
secret in any served page or script, and no PostgREST URL in the browser bundle; API stopped: the page
shows an error and no data. 45 checks. No PII in the API or web logs (query strings, including
cursors, show as `?<redacted>`).

## Known limits

- **Not-found UI is streamed.** In this Next.js version a `notFound()` thrown from a dynamic page
  returns HTTP 404 with `noindex`, and the not-found UI arrives in the streamed payload and is rendered
  by JavaScript; the server-rendered HTML body is empty (a bare dynamic page that only calls
  `notFound()` behaves the same, so this is framework behaviour). Clients without JavaScript see a blank
  page with a 404 status. In development the response additionally embeds a stack trace in a
  `<template>` (file paths): never expose `next dev`.
- Forward-only pagination (no "previous"); archived records are hidden and there is no UI to archive,
  edit, or create contacts, products, leads or opportunities, and no consent actions yet.
- Contact e-mail and phone are shown to every role (the API returns them to any member).
- Local production verification needed two scratch-only adaptations (http Supabase URL, non-Secure
  cookies) because the app deliberately refuses both in production; the repo code is unchanged.
