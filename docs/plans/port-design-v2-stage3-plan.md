# Port design v2: Stage 3 plan (the sign-in and account pages: a skin, nothing else)

Status: **PLAN ONLY**, written 2026-10-08 on branch `web/port-stage3-plan` (from `web/port-flip`, which is `origin/main` plus the flip of `/`). No code, no packages, no push. Read first: `docs/plans/port-design-v2.md` (Stage 3 row), `port-design-v2-stage2-report.md`, `port-design-v2-landing-launch-checklist.md`, ADR 0060 and ADR 0016 (the CSP and the second factor), and the design-lab login source (`origin/web/landing:design-lab/src/login/*`: `LoginPage.tsx` 181 lines, `copy.ts`, `state.ts`, which is a sign-in **simulator**).

Standing rules: no push, no rm, nothing outside `docs/plans/` in this run, synthetic data only, `.env` never read, no `proxy.ts` / `csp.ts` / `next.config.ts` / root-layout / auth / login change in this run, `followups/**` untouched, lockfiles only with `npx -y npm@10.9.2`.

**The one sentence that governs the stage:** `app/login/*` and `app/auth/*` carry security logic (server actions, the second factor, set-password, redirects). Stage 3 is a **SKIN change only**: markup and classes around the same fields, the same words, the same actions. Every existing test passes **unchanged**. Where a design-lab behaviour cannot be had without touching logic, this plan says so and makes it a decision (section 6, section 12); it is not built.

Assumptions are marked **Assumption** and carried into "Decisions I need from the owner".

## 1. Scope and files

**In scope (five screens, all in `apps/web/app`):** `/login`, `/auth/forgot`, `/auth/confirm`, `/auth/mfa`, `/auth/set-password`: wrapped in the v2 frame (header with the wordmark, language select and theme button; the split layout with a side panel from `md` up; the card), fields and buttons restyled with v2 classes. **Out of scope:** everything in section 2; the show/hide password button; any new word on the forms; the `/app` screens (Stage 4 onward); a sign-up page (none exists and none is added: "Accounts are by invitation").

**What exists today (read for this plan):**

| Screen | Files | Server-side logic on the page | Existing tests |
|---|---|---|---|
| `/login` | `app/login/page.tsx` (reads `next`, `notice`; `safeRedirectPath`), `login-form.tsx` (client, `useActionState(signIn)`), `actions.ts` | `searchParams`, notice map | `actions.test.ts` |
| `/auth/forgot` | `page.tsx`, `forgot-form.tsx`, `actions.ts` | none | `actions.test.ts` |
| `/auth/confirm` | `page.tsx` (token check, `HEADINGS`), `confirm-form.tsx`, `actions.ts` | `searchParams`, `parseConfirmType`, `parseTokenHash`, `safeRedirectPath` | `actions.test.ts`, `page.test.tsx` |
| `/auth/mfa` | `page.tsx` (`requireUserBeforeSecondFactor`, redirects), `mfa-form.tsx`, `actions.ts` | the session gate and two redirects | `actions.test.ts`, `page.test.tsx` |
| `/auth/set-password` | `page.tsx` (`requireUser`), `set-password-form.tsx`, `actions.ts` | the session gate | `actions.test.ts` |

**Files to create** (all under `apps/web`; pattern in the expected-paths table in the last column):

| Path | What | Table |
|---|---|---|
| `components/v2/auth/AuthFrame.tsx` | **server component**: `V2Root` with the content language and theme read from the two functional cookies (it calls `cookies()` itself, so no `page.tsx` has to read anything), skip link, header (`Wordmark`, `LangSelect`, `ThemeButton`, existing Stage 2 islands), `<main>` with the side panel (`md` and up) and the card slot, "Back to the home page" link | `components/v2/*` |
| `components/v2/auth/ui.ts` | class strings: `field`, `label`, `errorBox`, `noticeBox`, `btnPrimary` (re-exported), `btnSecondary`, `linkQuiet` | `components/v2/*` |
| `i18n/auth.ts` | `authT(lang)` over the **chrome subset** of `i18n/strings/login.json` (section 4), server only, like `landing.ts` | `i18n/*` |
| `components/v2/auth/*.test.tsx`, `i18n/auth.test.ts` | frame and subset tests | `components/v2/*`, `i18n/*` |
| `app/auth/skin-contract.test.tsx` | **new** test that pins what must not change (section 7) | not in the table: `apps/web/app/auth/*` is allowed there (tests are not actions) |
| `scripts/audit-auth.mjs` (+ edits to `scripts/lib/page-checks.mjs`) | the browser audit for the screens that can be loaded without a session (section 7) | `scripts/*` |
| `scripts/audit/legacy-probe.html`, edit of `scripts/audit-leaks.mjs` | the reverse audit against **legacy markup** (section 7: needed because `/login` stops being a legacy page) | `scripts/*` |
| `docs/plans/port-design-v2-stage3-report.md` | the STOP report | `docs/plans/port-design-v2*.md` |

**Files to edit (markup only):** `app/login/page.tsx`, `app/login/login-form.tsx`, `app/auth/{forgot,confirm,mfa,set-password}/page.tsx` and the four `*-form.tsx`. In each: the outer `<main className="shell">` becomes `<AuthFrame>`, the legacy class names (`shell`, `card`, `error`, `hint`, `row`, `secondary`) become v2 classes (the v2 source check **forbids** legacy class names in a v2 file, so this is also enforced), a wrapper element or two, an icon in the error box. **Nothing else.** `package.json` is not touched (no dependency: `lucide-react` is already in).

**Not touched:** every `actions.ts` and `actions.test.ts`; `lib/auth/*`, `lib/supabase/*`, `lib/security/*`, `lib/api/*`; `proxy.ts`; `next.config.ts`; `app/layout.tsx`; `app/globals.css`; `app/app/**`; `followups/**`; `e2e/**` (lane A runs it, section 7); `scripts/` at the repository root; `.github`, `lanes.json`, `AGENTS.md`, `CLAUDE.md`, `Makefile`, `docs/lanes.md`.

## 2. What stays untouched, and how that is enforced

1. **The guard, at every commit and at the STOP:** `git diff --name-status origin/main...HEAD` is checked against two lists. (a) Forbidden, must not appear at all: `apps/web/app/**/actions*.ts`, `apps/web/lib/**`, `apps/web/proxy*`, `apps/web/next.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/app/**`, `apps/web/test/**`, `e2e/**`. (b) **No existing test file may be modified or deleted:** `git diff --name-status origin/main...HEAD -- '*.test.ts' '*.test.tsx'` must show only `A` (added) lines. If either list is violated, the stage stops.
2. **The removed-lines report:** the STOP report prints `git diff -U0 origin/main...HEAD -- app/login app/auth | grep '^-' | grep -v '^---'`: every line the stage removed from those folders. The owner (and lane A) can read in a minute that no logic line is among them: only `className=`, `<main className="shell">`, and the closing `</main>`.
3. **The words:** section 4 and the skin-contract test pin every user-visible word, every `name`, `id`, `autoComplete`, `required`, `maxLength`, `pattern`, `inputMode`, `autoFocus` and `type`.

## 3. Rendering under the nonce CSP (ADR 0060 decision 2; ADR 0016)

* All five screens are already dynamic (`searchParams`, the session gate, and the root layout's `force-dynamic`). **Nothing changes in rendering.** No inline script and no inline `<style>`; the form components stay client components with `useActionState`; the server actions run exactly as today (Next puts the nonce on its own scripts).
* `AuthFrame` reads the two preference cookies on the server (the same allow-listed `readLang` and `readTheme` as the landing). The first response is in the right theme; no pre-paint script, no flash.
* `V2Root` brings the v2 stylesheet to these routes. The legacy stylesheet still loads on them (the root layout imports it): the leak audit's page mode runs on `/login`, `/auth/forgot` and `/auth/confirm` too (section 7). After a successful sign-in, `redirect(next)` is a soft navigation into the legacy `/app` screens, **with the v2 stylesheet still in the document** (Stage 0 finding): the reverse audit proves the legacy screens compute identically with it (section 7).
* `<html lang>` stays `en` (Stage 2 decision 6). The wrapper carries the content language; the **form region carries `lang="en"`** (section 4: its words stay English).
* `/login` redirects a signed-in visitor to `/app` in `proxy.ts` (optimistic, not the security boundary); `AuthFrame` does not duplicate or replace it.

## 4. The strings: what already exists and what cannot be used

`i18n/strings/login.json` has 37 keys in four languages (all draft) written for design-lab's login **simulator**. Checked key by key against the real screens and their tests:

| Group (keys) | Verdict | Why |
|---|---|---|
| Chrome (8): `skip`, `lang.label`, `theme.toDark`, `theme.toLight`, `home`, `side.title`, `side.d`, `side.note` | **use** (plus `signin.sub` as an optional welcome line) | new elements around the form; no existing word is replaced. `side.d` repeats the landing's "Every message is a draft. You approve it, and you send it yourself": it is covered by item (b) of the launch checklist. |
| `signin.title` "Sign in", `signin.password` "Password" | same as today | the real words are identical; not needed |
| `signin.email` "E-mail" | **not used** | the real label is "Email" |
| `signin.submit` "Continue" | **not used** | the real button is "Sign in"; `e2e/lib.mjs` clicks `button:has-text("Sign in")` |
| `signin.forgot` "Forgot your password? Coming soon." | **not used, and false** | the real link works (`/auth/forgot`); `e2e/auth.mjs` M1 requires exactly one `a[href="/auth/forgot"]` |
| `signin.noRemember` "We do not keep you signed in. You will enter a code each time you sign in." | **not used, and unproven** | the app keeps a session cookie, and asks for a code only for people who set up an authenticator |
| `signin.join`, `signin.joinLink` ("Request early access") | **not used** | the real line is "Accounts are by invitation. Ask the owner of your workspace if you need one."; the early-access button on the landing is a placeholder |
| `signin.show`, `signin.hide` | **not used** (decision 4) | they belong to the show/hide password button |
| `code.*` (7) | **not used** | the real MFA words differ ("Enter your code", "Code from your authenticator app", "Verify", the lost-phone text, which `mfa/page.test.tsx` pins) |
| `err.*` (9) | **not used** | the actions return English sentences ("Invalid email or password.", "Enter a valid email and password.", ...); the store's `locked`, `refused`, `expired`, `network` states have no counterpart in any action |
| `meta.title`, `meta.description` | **not used** (decision 7) | the real titles are "Sign in · SME AI Revenue Engine" etc. |

So only the chrome subset (8 keys, optionally 9) is used; `i18n/auth.ts` exposes exactly those and a test fails if a key is used that is not in the subset, or if a subset key is missing in a language. **There are no strings for `/auth/forgot`, `/auth/confirm` and `/auth/set-password` in the store at all.** Translating the form words, the server messages and the headings is a **different change**: the words are pinned by `mfa/page.test.tsx`, `confirm/page.test.tsx`, the five `actions.test.ts` files and `e2e/*.mjs`; the messages come out of server actions (denied to this lane); a translation layer would have to map English sentences to keys on the client, or change the actions. That is lane A's, with its own tests (decision 1).

## 5. The skin, screen by screen (what changes, mechanically)

Common: `<AuthFrame>` replaces `<main className="shell">` (the frame renders the one `<main>`; the existing `h1` stays inside it, with the same words). The form keeps `action={action}` and its `role="status"` / `role="alert"` messages **inside the `<form>`** (the e2e scripts read `form [role="status"], form [role="alert"]`). Field markup: the same `label`/`input` pairs with the same `id`/`name`/attributes, with v2 field and label classes; error and notice boxes keep their roles and gain colour, an icon (`aria-hidden`) and padding; the buttons keep their words (`Sign in`, `Send the link`, `Continue`, `Verify`, `Save password`, `Sign out`) and use the v2 primary and secondary styles; the pending words (`Sending...`, `Checking...`, `Saving...`) stay.

| Screen | Specific skin points | Must stay identical |
|---|---|---|
| `/login` | split layout; card with title "Sign in"; notice (`role="status"`) inside the form; the "Forgot your password?" `Link` and the "Accounts are by invitation..." hint keep their words | hidden `next`; `email`/`password` inputs (`required`, `maxLength`, `autoComplete`); the button word; exactly one `a[href="/auth/forgot"]` |
| `/auth/forgot` | card; the explanation paragraph; "Back to sign in" link | `email` input; "Send the link"; `role="status"` message position |
| `/auth/confirm` | card; two states: the error state (`role="alert"`, "expired or was already used", the two links) and the form state | the Continue button is a **button**: pressing it, not loading the page, verifies the token (a link scanner must not use it up); hidden `token_hash`, `type`, `next` |
| `/auth/mfa` | card with a key icon; hint paragraph; the second form (Sign out) | `autoFocus`, `inputMode`, `pattern`, `maxLength`, `autoComplete="one-time-code"`; the lost-phone sentence; two separate forms |
| `/auth/set-password` | card; helper hint; two password fields | `minLength`/`maxLength` from `lib/auth/password-policy`; `autoComplete="new-password"` |

## 6. Where a design-lab behaviour cannot be a skin change (each is a decision, none is built)

| Design-lab has | Why it is not a skin change | Plan |
|---|---|---|
| Different words everywhere (labels, button, errors, MFA copy) | changes tests, `e2e/*`, and the message strings that come from server actions | **keep today's words** (decision 1) |
| A show/hide password button | new client state inside the form components next to `useActionState` | **defer** (decision 4); can be added later as its own small change with tests |
| `noValidate` and no `required` | removes browser validation (a behaviour change; the server still validates, but the form's attributes are pinned) | **not adopted** |
| `autoComplete="username"` on e-mail | password-manager behaviour change | **not adopted**: `email` stays |
| A two-step flow on one page (sign-in then code) with simulated accounts | the real flow is two routes with a server gate (`/login`, `/auth/mfa`) | **not carried**: design-lab's `state.ts` is dropped, as the main plan said |
| "Request early access" link and "We do not keep you signed in" | new claims and new words | **not carried** (section 4) |
| Error variants `locked`, `refused`, `expired`, `network` | no action returns them | **not carried** |

Nothing in this table needs a change to `actions.ts`, `lib/auth`, `proxy.ts`, `csp.ts` or the root layout, **provided decision 1 is "keep today's words"**. If the owner chooses to adopt new words (decision 1, option B), the stage stops being a skin change and goes to lane A as a separate ticket with its own plan.

## 7. Testing and proof

**Per commit:** `npm run lint`, `npm run typecheck`, `npx vitest run` on the touched folders **plus the existing tests of `app/login` and `app/auth` (unchanged)**, `npm run audit:leaks -- --source-only`; CSS-affecting commits run the full `audit:leaks`.

**New tests:**
* `app/auth/skin-contract.test.tsx` (new; **written first and green on the unchanged code**, then green after each commit: a failing-first mutation proves it can fail): for each of the five screens, rendered markup contains the pinned words (headings, labels, buttons, hints, pending words), the pinned field attributes (`name`, `id`, `type`, `autoComplete`, `required`, `maxLength`, `minLength`, `pattern`, `inputMode`, `autoFocus`), the hidden fields, exactly one `a[href="/auth/forgot"]` on `/login`, `role="alert"`/`role="status"` inside the `<form>`, exactly one `<main>` and one `<h1>`, and **no legacy class name** (`shell`, `card`, `error`, `hint`, `row`, `secondary`).
* `AuthFrame` in four languages (the chrome words in each language, `lang` on the wrapper, `lang="en"` on the form region, skin-only: no form inside the frame), `i18n/auth.test.ts` (the subset).

**Existing tests that must pass unchanged:** `app/login/actions.test.ts`, `app/auth/{forgot,confirm,mfa,set-password}/actions.test.ts`, `app/auth/confirm/page.test.tsx`, `app/auth/mfa/page.test.tsx`, and the whole web suite (1,589+ tests at the end of Stage 2).

**Browser audit for the screens that load without a session:** `scripts/audit-auth.mjs` reuses `page-checks.mjs` (overflow at 360, 390, 768, 1024, 1440; text at least 14 px; computed contrast light and dark; touch targets; a real Tab walk with ring contrast; 0 CSP violations and 0 console errors) in Chrome, WebKit and Firefox, on: `/login`, `/login?notice=reset`, `/login?notice=link`, `/login` after a rejected submit (a malformed address is rejected by the action **before any network call**, so the error state is real and offline), `/auth/forgot`, `/auth/confirm` (no token: the error state), `/auth/confirm?type=invite&token_hash=<32 hex>` (the form state). The app runs with the dummy public Supabase settings (host `example.invalid`), as in Stage 2. **`/auth/mfa` and `/auth/set-password` redirect to `/login` without a session, so the browser audit cannot load them:** they are proved by their unit tests, the skin-contract test and the leak audit's source check, and by **lane A's run of `make check` and `e2e/auth.mjs` on the local stack before the merge** (this lane has no local stack: AGENTS.md).

**The proof that nothing else moved:**
* the Stage 1/2 snapshot script, ten requests, before/after: **only `/login`, `/login?next=...&notice=reset`, `/auth/forgot` and `/auth/confirm` may differ** (their bodies); `/`, `/does-not-exist`, `/app`, `/app/tenants/...`, `/auth/mfa` and `/auth/set-password` (both 307 redirects) must be byte-identical, and the emitted css/js list may only **add** files (every existing file keeps its sha256). **The legacy stylesheet's file hash must be unchanged** (`globals.css` is not touched);
* **the reverse audit changes target:** today it soft-navigates from the landing to `/login` and compares a *legacy* page with the v2 sheet on and off. After Stage 3 `/login` is a v2 page, and no other legacy page loads without a session. So `audit:leaks` gains a **legacy probe** (`scripts/audit/legacy-probe.html`: representative legacy markup built from the real class names in `globals.css`: `.shell`, `.card`, `.row`, `.tabs`, `.badge`, tables, `select`, buttons, `.error`, `.hint`) injected into a page that has the v2 sheet loaded, and compares every computed property with the v2 sheet on and off: 0 differences. The old landing-to-login soft navigation stays as a smoke test that the v2 sheet is in the document;
* `git diff` guards (section 2), the removed-lines report, and `git diff --stat` on the guarded repository paths (must be empty).

**JS budget:** `/login` must stay within the Stage 2 budget (217,009 B gzip); the forms add no dependency and `AuthFrame` is a server component, so the expected addition is the two small islands already in the landing bundle.

**Once at the end:** the full web CI set from a clean install with `npx -y npm@10.9.2 ci`, lint, typecheck, contracts `tsc`, test, build, then the audits above in the three engines.

## 8. Commit slicing (about 8)

1. docs: add `apps/web/components/v2/auth/*` (already covered by `components/v2/*`) and the Stage 3 decisions to the plan; record the owner's answers.
2a. **Risk check before any skin code (docs or test only, nothing committed in app code):** prove with a scratch test that a page wrapped in `AuthFrame` (an async server component that calls `cookies()`) still renders, **unchanged**, in the existing `mfa/page.test.tsx` and `confirm/page.test.tsx` (direct call of the async page, `react-dom/server`, testing-library, mocks of `next/headers`). If it cannot: stop and report the exact failure and the options; no existing test is modified and no mock is added to one.
2. `skin-contract.test.tsx` written against the **unchanged** screens (green), plus a mutation run showing it fails when a word or attribute changes.
3. `i18n/auth.ts` (the chrome subset) + test; `components/v2/auth/ui.ts`.
4. `AuthFrame` + tests in four languages.
5. `/login` skin (`page.tsx`, `login-form.tsx`), with the additive `robots` metadata (decision 8).
6. `/auth/forgot` and `/auth/confirm` skin.
7. `/auth/mfa` and `/auth/set-password` skin.
8. audit: `audit-auth.mjs`, the legacy probe in `audit:leaks`, and a drift test for the probe (every class selector in `legacy-probe.html` exists in `globals.css`; the probe covers `shell`, `card`, `error`, `hint`, `row`, `secondary`).
9. docs: Stage 3 report. **STOP.**

## 9. STOP report (same format as Stage 2, raw outputs)

`git status --short`; `git log --oneline origin/main..HEAD`; the guard lists (forbidden paths: none; test files: only `A`); `git diff -U0 ... | grep '^-'` for `app/login` and `app/auth` (the removed lines); the guarded repository diff (empty); the full web CI exit codes with npm 10.9.2; the existing login and auth tests, **unchanged and passing** (file list with counts); `skin-contract` and its mutation proof; `audit:leaks` (page mode on `/login`, `/auth/forgot`, `/auth/confirm`, the legacy probe); `audit-auth` in three engines; `audit:budget` for `/login`; the ten-request before/after with the legacy stylesheet hash; what lane A must still run (`make check`, `e2e/auth.mjs`) and the exact commands; the lists "Skipped", "Assumptions", "Stopped at".

## 10. Risks

1. **A skin edit slips into logic.** The guard, the removed-lines report, the skin-contract test and lane A's review exist for this. The five `actions.ts` files are not opened for writing.
2. **A class or attribute the e2e scripts depend on disappears:** `e2e/lib.mjs` and `e2e/auth.mjs` use `input[name=...]`, `button:has-text("Sign in" | "Send the link" | "Continue" | "Verify")`, `form [role=status|alert]`, `a[href="/auth/forgot"]` (exactly one), `main` (exactly one), "no 'Create account'". The skin-contract test pins each. This lane cannot run the e2e scripts; lane A does, before the merge.
3. **`/auth/mfa` and `/auth/set-password` cannot be loaded in a browser here** (they need a session): covered by unit tests, the contract test and lane A's stack run. That is a real gap in this lane's proof, stated here and in the report.
4. **Mixed languages on one screen** (translated chrome and side panel, English form and messages): accurate, but visibly uneven. Decision 2.
5. **The side panel repeats landing claims** ("Every message is a draft...", "Early access, invitation only"): they inherit launch-checklist items (b) and (g). Drafts in te/hi/kn.
6. **The product name differs:** the wordmark says "Sme-AI (working name)", the legacy page titles say "SME AI Revenue Engine". Left alone (decision 7); launch-checklist item (f).
7. **A legacy rule leaks into the new screens, or the other way:** the same leak audit as Stage 2, on the real compiled pages, plus the legacy probe.
8. **Password managers and autofill:** field attributes are unchanged, so behaviour is unchanged; the v2 field styles are checked with the autofill pseudo-state only by a manual look (not automated): a note in the report.
9. **Dynamic rendering, no CDN caching:** unchanged from Stage 2 (parked for T012).
10. **Security review expectation:** the lane table allows these files, but they are security-tier by the repository's own rules ("restyle-only discipline and A review"): the merge needs lane A's review of the diff and its local-stack runs.

## 11. Expected-paths table (checked at the STOP)

Allowed: `apps/web/components/v2/auth/*`, `apps/web/i18n/auth*`, `apps/web/app/login/page.tsx`, `apps/web/app/login/login-form.tsx`, `apps/web/app/auth/*/page.tsx`, `apps/web/app/auth/*/*-form.tsx`, `apps/web/app/auth/skin-contract.test.tsx`, `apps/web/scripts/*`, `docs/plans/port-design-v2*.md`. Everything else in the name-status output must be explained or the stage stops.

## 12. Decisions I need from the owner (8)

1. **Words.** Keep every current English word, label, hint, button and error exactly as today (skin only), or adopt design-lab's words and add translations to the forms? *Recommend keep. Adopting new words changes five test files and the e2e scripts, needs the server messages localised (server actions, lane A), and would remove claims that are not true today ("Coming soon" on a working link, "We do not keep you signed in"). Do it later as its own ticket.*
2. **Language on these screens.** Language select present, chrome and side panel translated, the form and its messages in English (with `lang="en"` on that region), or English-only screens without a language select? *Recommend the first: the visitor's choice from the landing carries over, nothing in the form changes, and the page says honestly which part is which. The uneven look goes away when decision 1 is done later.*
3. **Scope.** All five screens in Stage 3, or `/login` and `/auth/forgot` first? *Recommend all five: they are one family and share the frame; `/auth/mfa` and `/auth/set-password` get the same markup-only change and are proved by tests and lane A's e2e run.*
4. **Show/hide password button.** Build it now or defer? *Recommend defer: it adds client state to two security forms. It is a small, separate change with its own tests.*
5. **Layout.** The design-lab split layout (side panel from `md` up, card on the right), or a single centred card with no side panel? *Recommend the split layout; the side panel is chrome only and its text is the store's.*
6. **Review path.** Lane A reviews the diff and runs `make check` and `e2e/auth.mjs` on the local stack before the merge? *Recommend yes (this lane has no stack, and these are security-tier files by the repository's own rules).*
7. **Page titles.** Keep today's titles ("Sign in · SME AI Revenue Engine", ...) or use the store's ("Sign in · {brand}")? *Recommend keep: the brand name is undecided (launch checklist f) and a title is a word the tests and e2e do not pin but the owner has not reviewed.*
8. **Indexing.** Add `robots: noindex, nofollow` metadata to the five screens (additive, tested), or leave them as they are? *Recommend add: sign-in and account pages have no business in a search index; it changes metadata only.*

## 12a. Owner answers (2026-10-08), recorded before the build

1. **Words: keep every current English word** exactly as today (skin only).
2. **Language:** translated chrome and side panel; the form region stays English with `lang="en"`.
3. **Scope:** all five screens.
4. **Show/hide password button:** deferred, not built.
5. **Layout:** the split layout (side panel from `md` up).
6. **Review path:** lane A (Claude 1) reviews the diff and runs `make check` and `e2e/auth.mjs` on the local stack. **There is no phone or manual click checklist** (the owner declined those).
7. **Page titles:** keep today's titles.
8. **Indexing:** add `robots: noindex, nofollow` metadata to the five screens, as an **additive** export: where a page already exports `metadata`, it is extended and its title is unchanged.

**Changes to this plan, same day:** (A) a **risk check before any skin code** (commit 2a, section 8): the existing `mfa` and `confirm` page tests must still render a page wrapped in `AuthFrame` unchanged; if not, the build stops and reports the options. (B) decision 8 is built as described above, tested in new files only. (C) the legacy probe gets a drift test (section 8, commit 8). (D) everything else in sections 1 to 11 stands. **Stop rules:** a forbidden path in the diff; any existing test needing a change; the CSP, proxy, actions, `lib/*` or the root layout needing a change; the risk check failing; a dependency needed; an audit failing twice after a fix. If the Firefox audit hangs, the processes are killed by PID and the audit is rerun once, and the hang is reported.
