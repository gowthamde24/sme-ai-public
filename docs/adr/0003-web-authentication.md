# ADR 0003: Web authentication (T002, milestone 3)

Status: accepted for milestone 3. Builds on ADR 0001 (RLS) and ADR 0002 (API).

Written after reading the bundled Next.js 16 docs (`node_modules/next/dist/docs`): `middleware` is now `proxy` (Node runtime by default), `cookies()` is async and can only be written in Server Actions/Route Handlers, `searchParams` is a Promise, and the docs state that proxy checks are optimistic and not a security boundary.

## Decisions

1. **Auth happens on the server only.** Sign-in, sign-up and sign-out are Server Actions. The browser never creates a Supabase client (`createBrowserClient` is banned by a guard test) and the session cookies are written `HttpOnly`, `SameSite=Lax`, and `Secure` in production, so page scripts cannot read the tokens. The browser's only Supabase knowledge is the project URL and anon key, and in practice it never even needs them.
2. **Identity is `auth.getUser()`, never `getSession()`.** `getUser()` makes the Auth server validate the token. `getSession()` merely decodes the cookie and is unverified. `requireUser()` (the data-access layer used by pages and actions) calls `getUser()` first and redirects on any failure; only after it succeeds does it read the session, solely to obtain the access token to forward to the API. A guard test asserts that the only `getSession()` call lives there and comes after `getUser()`; a unit test asserts `getSession()` is not consulted when `getUser()` fails (a forged cookie still yields a "session").
3. **The proxy is optimistic, not the boundary.** `proxy.ts` refreshes the session (rotating tokens, writing cookies plus the library's `no-store` headers so a CDN cannot cache one user's session for another) and redirects signed-out visitors of `/app` to `/login` and signed-in visitors of `/login` to `/app`. It runs only on `/app/:path*` and `/login`. Every protected render re-authenticates through `requireUser()`, the API re-verifies the JWT (ADR 0002), and RLS decides data access.
4. **Post-login redirects are validated twice.** `safeRedirectPath()` accepts only same-site relative paths. It refuses protocol-relative (`//x`), backslash, absolute and `javascript:` forms, control characters (including tab/newline that browsers strip), and encoded variants (`%2f%2f`, `%5c`), re-resolves the result against a placeholder origin, and never redirects back into `/login`. It runs when `/login` renders the hidden `next` field and again in the Server Action, because the form field is attacker-controlled.
5. **`/app` shows real backend state.** It fetches `GET /v1/me` server-side with the caller's own token, validates the response shape (an unexpected body is an error, not rendered), and refuses to render if the API's `user_id` differs from Supabase Auth's. If the API is down it says so; it never shows placeholder data.
6. **Generic failures.** Sign-in returns one message for unknown email and wrong password; sign-up returns the same message whether or not the address exists; submitted values are never echoed back. Input is validated again on the server.
7. **No privileged credential in `apps/web`.** Guard tests scan the tree for service-role, JWT-secret, DB-URL and JWKS names, allow-list the only `NEXT_PUBLIC_*` variables, forbid dynamic `process.env` access, and fail if any `'use client'` file imports server-only modules.

## Dependencies added (CLAUDE.md rule 8)

- `@supabase/ssr` and `@supabase/supabase-js`: the official cookie-based session handling for the App Router, including token refresh and the cookie chunking for large sessions. Rewriting that by hand would be error-prone. `npm audit --omit=dev` reports 0 vulnerabilities; the 5 high findings are in dev tooling (`braces`) and pre-date this change.

## Verified

Beyond the unit tests, the flow was driven over HTTP against real servers (Next dev, FastAPI, local Supabase): signed-out `/app` redirect, sign-up with a hostile `next`, HttpOnly cookies, `/app` empty state, workspace creation and listing from `/v1/me`, slug conflict between two users, a tampered session cookie being rejected, wrong password, safe and unsafe `next` on sign-in, sign-out, and a scan of every served script for the local service-role key and JWT secret (none found).

## Known limits

- **Email confirmation is incomplete.** With confirmations enabled on a hosted project, `signUp` sends a link, but there is no `/auth/confirm` route handler to complete it (the local stack has confirmations off). Must be built before confirmations are switched on.
- No login rate limiting beyond Supabase Auth's own; no CAPTCHA; no MFA; no password reset UI.
- No security headers or CSP yet.
- The proxy calls `getUser()` (a network round trip to Auth) on every `/app` and `/login` request. Acceptable now; measure before scale.
- The workspace picker is a plain list; there is no tenant-scoped page yet. T003+ pages must use `/app/tenants/{id}/...` and rely on the API's 404 for foreign tenants.
