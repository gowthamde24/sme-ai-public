# Stage 3, risk check A: can the auth screens be wrapped in `AuthFrame` without touching an existing test?

Date: 2026-10-08. Branch `web/port-stage3-plan`. Result: **NO, not with `AuthFrame` as the plan describes it (an async server component that calls `cookies()` and renders the v2 wrapper and the language and theme controls inside the page).** The build stopped here, as the owner's stop rule says. No skin code was written, no existing test was changed, and no option below was chosen.

## What was tested, and how

The existing page tests render the page by calling the async page function directly and passing the result to testing-library's `render`:

* `app/auth/mfa/page.test.tsx`: mocks `next/navigation` with **only** `redirect`, mocks `@/lib/auth/session` and `./actions`; no mock of `next/headers`, no mock of `@/design/fonts`.
* `app/auth/confirm/page.test.tsx`: mocks `./actions` only.

A prototype `AuthFrame` was written as planned (async, `await cookies()`, `readLang`/`readTheme`, `V2Root`, `LangSelect`, `ThemeButton`, one `<main>`), `mfa/page.tsx` and `confirm/page.tsx` were wrapped in it **temporarily**, and the two existing test files were run **unchanged**. The pages were then restored with `git checkout --` and the prototype moved out of the repository (nothing of it is in any commit). Baseline on the clean tree afterwards: `app/auth` and `app/login`, 7 files, 90 tests, all passing.

## Results

| Variant of the frame inside the page | Result with the two existing tests, unchanged |
|---|---|
| **As planned** (async, `cookies()`, `V2Root`, `LangSelect`, `ThemeButton`) | **Both files fail to load, 0 tests run.** `TypeError: Plus_Jakarta_Sans is not a function`: `V2Root` imports `@/design/fonts`, which calls `next/font/google`; that only works inside a Next build. The landing tests avoid this with `vi.mock("@/design/fonts")`, which these two files do not have and may not be given. |
| Same, **with** the fonts mock added in a scratch copy of the tests (to look past the first failure) | **9 of 11 tests fail.** React reports `<AuthFrame> is an async Client Component. Only Server Components can be async at the moment`; the rendered DOM is an empty `<div />`, so every query (the heading, the code field's label, the alert) finds nothing. (Not reached, but certain to follow: `cookies()` called outside a request, and no `next/headers` mock exists in either file.) |
| Synchronous frame, no `cookies()`, no `V2Root`, but **with `LangSelect`** inside | **9 of 11 fail**: `[vitest] No "useRouter" export is defined on the "next/navigation" mock` (the mfa test mocks `next/navigation` with `redirect` only) and, in the confirm test, `invariant expected app router to be mounted`. |
| Synchronous frame, markup only (no `cookies()`, no `V2Root`/fonts, no client control) | **Passes: 2 files, 11 tests, unchanged.** |

So anything in the page's own component tree that needs `next/font`, `cookies()`, an async component or `useRouter` breaks the existing tests; markup and class names do not.

## Options I see (none chosen)

1. **Route layouts carry the frame.** `app/auth/layout.tsx` and `app/login/layout.tsx` (async, `cookies()`, `V2Root`, header with the controls, side panel) wrap `{children}`; the pages keep their own single `<main>` and change only classes and wrappers, importing plain class-string constants. The page tests never render a layout, so they are untouched. Costs: two new files; `app/login/layout.tsx` is not in the lane table's allow list (`app/auth/*` covers the auth one; login lists only `page.tsx` and `login-form.tsx`), so the table needs one row; `/login` and `/auth/*` are different segments, so a soft navigation between them swaps layouts (a remount, not a problem for correctness).
2. **Pages read the cookies and pass `lang`/`theme` to a synchronous frame.** The page would call `cookies()`, which fails in the two existing tests (no `next/headers` mock) and the frame would still need `V2Root` (fonts) and the controls (`useRouter`): it does not remove the failures above. Expected to fail; not run.
3. **Shared test support instead of per-file mocks** (`vitest.setup.ts` or `vitest.config.ts` mocking `next/font/google`, `next/headers` and `next/navigation`'s `useRouter` globally). No existing test file is modified, but shared test infrastructure changes for the whole web suite, and `apps/web/vitest*` is not in the expected-paths table. Needs the owner's explicit approval.
4. **Markup-only frame in the page, chrome elsewhere.** A synchronous, dependency-free frame in the page (passes, variant 4) plus the language and theme controls and fonts supplied by option 1's layouts. In effect option 1 with a thinner page.

The owner and lane A decide. Until then Stage 3's skin work is not started.
