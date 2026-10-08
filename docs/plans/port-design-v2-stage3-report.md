# Design v2 port, Stage 3 report: the sign-in and account screens (a skin, nothing else)

Status: **built and committed locally on `web/port-stage3-plan`, nothing pushed.** Plan: `port-design-v2-stage3-plan.md` (answers in 12a, the layout decision in 12b). Risk check: `port-design-v2-stage3-risk-check.md`. The screens are `/login`, `/auth/forgot`, `/auth/confirm`, `/auth/mfa`, `/auth/set-password`. **Lane A must review the diff and run `make check` and `e2e/auth.mjs` on the local stack before this merges** (section 7). Numbers below come from commands run in this stage.

## 1. What changed

* **Two route layouts carry the frame** (owner decision, option 1 of the risk check): `app/login/layout.tsx` and `app/auth/layout.tsx`. Each is the frame (through `components/v2/auth/AuthFrame.tsx`, an async server component) and `export const metadata = { robots: { index: false, follow: false } }`. No session, no redirect, no action, no data, no title. The frame: skip link to `#main`, header (wordmark, language select, theme button), the side panel from `md` up, a `<div lang="en">` around the page's own `<main>`, the way back. Chrome words (8 keys of `login.json`) are in the visitor's language; the form region stays English.
* **The five pages change class names and `id="main"` only** (classes come from `components/v2/auth/ui.ts`). The `<main>` is the card. No element added or removed, no logic touched. The 29 other `login.json` keys are not used (they differ from the real words, which tests and `e2e/auth.mjs` pin, or are not true of the product: section 4 of the plan).
* **Not touched:** every `actions.ts`, `lib/*`, `proxy.ts`, `csp.ts`, `next.config.ts`, `app/layout.tsx`, `globals.css`, `app/app/**`, `followups/**`, `e2e/**`, every existing test file.
* **One side fix, found by the new probe:** the landing header used Tailwind's `sticky` utility, an unscoped class that also matched the legacy class `sticky` (a legacy screen reached by a soft navigation from a v2 page got `position: sticky` at desktop width: harmless, no offsets, but a leak). The header now uses `[position:sticky]`.

## 2. Check A and the guard lists

* **Check A (before any skin code):** an `AuthFrame` with `cookies()`, fonts and controls inside the page broke the existing `mfa` and `confirm` page tests (details in the risk-check note); the owner chose route layouts. The layouts are not rendered by the page tests.
* **Pages under `app/login/` and `app/auth/`:** exactly five `page.tsx` (`login`, `auth/confirm`, `auth/forgot`, `auth/mfa`, `auth/set-password`); no other page, no route group, no `loading`/`error`/`not-found`, nothing moved. So each layout frames only those.
* **Forbidden paths in the diff against the stage base (`web/port-flip`):** none. The only `package.json` change is the script line `"audit:auth": "node scripts/audit-auth.mjs"`; the lockfile is unchanged (no dependency).
* **Test files (`git diff --name-status web/port-flip...HEAD -- '*.test.ts' '*.test.tsx'`):** only `A`: `app/auth/skin-contract.test.tsx`, `app/auth/skin-contract-states.test.tsx`, `components/v2/auth/AuthFrame.test.tsx`, `components/v2/auth/ui.test.ts`, `i18n/auth.test.ts`, `scripts/lib/legacy-probe.test.ts`. No existing test file was modified or deleted.
* **Guarded repository paths** (`.github lanes.json AGENTS.md CLAUDE.md docs/lanes.md scripts Makefile`): empty diff.
* **Under `app/`, the only new non-test paths are the two layouts.**
* **The 7 existing auth and login test files pass unchanged: 7 files, 90 tests** (`app/login/actions.test.ts`, the four `app/auth/*/actions.test.ts`, `app/auth/confirm/page.test.tsx`, `app/auth/mfa/page.test.tsx`), at every commit and on the final build.

## 3. Removed lines (non-test files of `app/login` and `app/auth`, against the stage base)

Every removed line is a JSX element line that was re-added with `className={...}` (and `id="main"` on the `<main>`): `<main className="shell">` (6), `<p role="alert" className="error">` (6), `<form className="card" action={action}>` (5), `<button type="submit" disabled={pending}>` (5, re-added with a class), the `<h1>`, `<p>`, `<label>`, `<Link>`, `<div className="row">` and `<p className="hint">` lines, and the two `role="status"` lines. No line containing logic (`useActionState`, `redirect`, `safeRedirectPath`, `require*`, field attributes other than the class) was removed. The full list is reproduced by:
`git diff -U0 web/port-flip...HEAD -- app/login app/auth ':!*.test.ts' ':!*.test.tsx' ':!app/login/layout.tsx' ':!app/auth/layout.tsx' | grep '^-' | grep -v '^---'`

## 4. Proof

```
skin contract (app/auth/skin-contract*.test.tsx): 25 tests, written first and green on the unchanged screens; 10 deliberate mutations of the
  unchanged screens each failed it (a button word, a removed required, a second reset link, a removed alert role, maxLength 7 to 6,
  the lost-phone words, a visible hidden field, a second main, an autocomplete value, a pending word); a legacy class put back also fails it
full web CI set (npx -y npm@10.9.2): npm ci 0 | lint 0 | typecheck 0 | contracts tsc 0 | test 0 (113 files, 1692 tests) | build 0 | check-no-leftovers 0
audit:auth   chrome 108 ok 0 FAIL | webkit 108 ok 0 FAIL | firefox 108 ok 0 FAIL    (each: 107 page loads, 0 CSP violations, 0 console messages)
audit:leaks  page mode on /login, /auth/forgot, /auth/confirm (error state), /auth/confirm (with a token), /landing: en|te|hi|kn, light and dark:
             OVERRIDE 0, SHADOWED 0, BASE 0, CSP violations 0; legacy probe 83 elements, 38 legacy classes, 1200 and 390 px, light and dark: 0 properties change with the v2 sheet
audit:landing chrome 55 ok 0 FAIL (the header class change)
audit:budget /login 181,259 B gzip of 217,009 (margin 35,750) | /auth/forgot 181,099 | /auth/confirm 181,043 | /landing 184,010
```

* **audit:auth, what was loaded:** `/login`, its two notices, `/login` after a rejected submit (a malformed address is refused by the server action before any network call, so the error state is real), `/auth/forgot`, `/auth/confirm` (no token and with a token); structure (one h1, banner, `main#main`, one skip link, the form region `lang="en"`, labels, the unchanged title, robots), five sizes with the h1 and the main action in the first screen, text and contrast in light and dark, touch targets, a Tab walk (lowest ring contrast 4.84:1). Mutation-checked: a removed skip link, a second h1, a changed region lang, a removed main id, a removed robots meta, a removed label, a changed title, pale text, a 20 px target are each reported.
* **Noindex and titles, on the BUILT html** (the ten-request snapshot): `/login`, `/login?next=...&notice=reset`, `/auth/forgot` and `/auth/confirm` all contain `<meta name="robots" content="noindex, nofollow"/>` (before: none), and their `<title>` is unchanged: "Sign in · SME AI Revenue Engine", "Reset your password · SME AI Revenue Engine", "Confirm · SME AI Revenue Engine".
* **Ten-request before/after** (before = this branch before any Stage 3 code; same snapshot script as Stages 1 and 2):
  * identical, byte for byte: `/app` (307), `/app/tenants/0000...` (307), `/does-not-exist` (404);
  * differ, as intended: `/login`, `/login?next=...&notice=reset`, `/auth/forgot`, `/auth/confirm` (the new frame and classes);
  * `/auth/mfa` and `/auth/set-password`: still `307` to `/login` with the same headers and CSP; the redirect page's body now lists the layout's script chunks and carries the robots meta (the layout runs before the page's redirect), nothing else;
  * `/`: identical once the chunk file names and the header's `sticky` class are normalised (bytes 123,043 to 123,065: the 11-character longer class, twice in the payload).
* **The legacy stylesheet is byte-identical:** `.next/static/chunks/0uq96_kecprg3.css`, sha256 `d294772c84e3d0d8` before and after (`globals.css` is untouched).
* **Emitted css/js files:** 36 before, 37 after; 29 identical, 7 replaced and 8 new. This is **not** "only additions" as Stages 1 and 2 were: adding client components to the `/login` and `/auth/*` routes and the layouts regrouped Turbopack's shared chunks. What matters, checked on the build's client-reference manifests: **all 19 legacy routes (`/app/**`, `/_not-found`, `/_global-error`) reference only chunks that are byte-identical to before** (0 changed). The changed chunks belong to `/`, `/landing`, `/login` and `/auth/*`.

## 5. Findings

1. **The old reverse audit stopped meaning anything** once `/login` became a v2 page (html and body size follow v2 content). `audit:leaks` now injects a hand-written legacy probe (`scripts/audit/legacy-probe.html`) and keeps the soft navigation as a smoke test. `scripts/lib/legacy-probe.test.ts` fails if the probe uses a class that is not in `globals.css` or stops covering `shell`, `card`, `error`, `hint`, `row`, `secondary` (mutation-checked).
2. **The probe found a real, harmless leak** (the `sticky` utility, above), fixed at the root. Every other legacy class is clean.
3. **Tool fix:** `audit:leaks --path /login` crashed because its soft-navigation step needs a "Sign in" link on the start page; it now always starts from `/landing`.
4. **The side panel repeats two landing claims** ("Every message is a draft. You approve it, and you send it yourself.", "Early access, invitation only."): they inherit items (b) and (g) of `port-design-v2-landing-launch-checklist.md`. The Telugu, Hindi and Kannada versions are drafts.
5. **Mixed languages by decision:** translated chrome and side panel, English form, headings and messages.
6. **The error box has no icon** (it needed a new element, which the decision forbids).
7. **Real Safari, real phones and screen readers were not run**; WebKit and Firefox are the engines through playwright-core.

## 6. Not verified here

* `/auth/mfa` and `/auth/set-password` in a browser (they redirect to `/login` without a session). They are covered by their unit tests, the skin contract and the leak audit's source check.
* The sign-in, second-factor, reset and invite flows end to end (they need the local Supabase stack).
* Anything on the hosted environment.

## 7. What lane A must run (this lane has no local stack)

```
cd <repo>                                    # on web/port-stage3-plan (or the merge candidate)
git diff -U0 origin/main...HEAD -- apps/web/app/login apps/web/app/auth ':!*.test.ts' ':!*.test.tsx' | grep '^-' | grep -v '^---'   # read the removed lines
make db-start                                # local Supabase
make check                                   # once before the commit/merge: lint, typecheck, unit, pgTAP, integration
AGENTS_ENABLED=true make dev-api             # terminal 1
make dev-web                                 # terminal 2
make seed-demo
cd e2e && npm ci && npm run install-browser && npm run setup-users && npm run auth
```
`npm run auth` is `e2e/auth.mjs`: the sign-in page (no sign-up, exactly one `a[href="/auth/forgot"]`), forgot-password answers, the confirm page's missing-token state and Continue button, sign-in and the code challenge, the security headers and the CSP under the real proxy, and the 360 px pass. It reads `input[name=...]`, `button:has-text("Sign in" | "Send the link" | "Continue" | "Verify")`, `form [role="status"|"alert"]` and `main`: all pinned by the skin contract. There is no manual or phone checklist (owner decision).

## 8. After the rebase onto `origin/main` (01d4d77, 2026-10-08)

The flip (`web/port-flip`, PR #11) is merged, so the branch was rebased onto `origin/main` (14 commits, no conflicts). Re-run on the rebased tree: forbidden-path list against `origin/main`: empty; test files against `origin/main`: only `A` (6 new files); guarded repository paths: empty diff; the only new non-test paths under `app/` are the two layouts (plus the skin-contract tests under `app/auth/`); `npm ci` (npm 10.9.2), lint, typecheck, build exit 0; full web suite 117 files, 1,790 tests (main gained the follow-up and suppression-key tests); the 7 existing auth and login test files: 90 tests, unchanged and passing; the 6 new Stage 3 test files: 51 tests. The browser audits above ran on the pre-rebase tree; nothing under `app/login`, `app/auth`, `components/v2` or `i18n` was touched by the merged commits, so they were not repeated.
