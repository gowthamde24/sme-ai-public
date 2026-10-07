# Port design v2: Stage 2 plan (the public landing page)

Status: **PLAN ONLY**, written 2026-10-07 on branch `web/port-stage2-plan` (from `web/port-design-v2` at 9deb8d5, which equals `origin/web/port-design-v2`). No code, no packages, no push. Read first: `docs/plans/port-design-v2.md` (Stage 2 row), `port-design-v2-stage0-findings.md`, `port-design-v2-stage1-report.md`, ADR 0060, and the design-lab landing source on `web/landing` (`design-lab/src/landing/*`, 366-line `LandingPage.tsx`, 339-line `Flow.tsx`).

Standing rules: no push, no rm, nothing outside `docs/plans/` in this run, synthetic data only, `.env` never read, no `proxy.ts`/`csp.ts`/`next.config.ts`/root-layout/auth/login change, `followups/**` untouched, lockfiles only with `npx -y npm@10.9.2` (checked with npm 10.9.2 and the local npm).

Assumptions are marked **Assumption** and carried into "Decisions I need from the owner" where they matter.

## 1. Scope and files

**In scope:** the public landing page in four languages (en/te/hi/kn): header with language and theme controls, hero with the self-starting flow strip, the problem, the six steps, "you stay in control", the team, languages, privacy, early access (a placeholder that sends nothing), FAQ, footer. **Out of scope:** the login page (Stage 3), any real data, the app shell, the voice dock, any form, any network call from the page.

**Files to create** (all under `apps/web`; the pattern each matches in the expected-paths table is in the last column):

| Path | What | Table |
|---|---|---|
| `design/brand.ts` | the ONE brand constant (section 4), `BRAND_TEXT`, placeholder site URLs | `design/*` |
| `design/format.ts` | `formatINR` for the labelled example amounts (copied from design-lab `lib/format.ts`) | `design/*` |
| `design/motion.css` | the v2 keyframes and `prefers-reduced-motion` rules, every selector under `[data-ui="v2"]` (imported by `design/v2.css`) | `design/*` |
| `i18n/fill.ts` | `fill(template, vars)` (`{brand}`, `{year}`, `{amount}`...), `fillPlain` | `i18n/*` |
| `i18n/landing.ts` | `landingDict(lang)` and the `LandingKey` type, built with `dictFor` (server only) | `i18n/*` |
| `i18n/server.ts` | `readLang(cookie)`, `readTheme(cookie)`: allow-listed values only, default `en` and "system" | `i18n/*` |
| `components/v2/icons.tsx` | the 21 icons the landing uses (decision 3) | `components/v2/*` |
| `components/v2/Wordmark.tsx` | the name, split from the constant | `components/v2/*` |
| `components/v2/controls/{LangSelect,ThemeButton}.tsx` | the two client islands in the header | `components/v2/*` |
| `components/v2/landing/{LandingView,Header,Hero,Problem,How,Control,TeamSection,TeamIllustration,LanguagesSection,Privacy,EarlyAccess,Faq,Footer}.tsx` | the sections; server components except `EarlyAccess` | `components/v2/*` |
| `components/v2/landing/{Flow.tsx,motion.ts,example-data.ts}` | the flow strip (client), its pure timing logic, the labelled example constants | `components/v2/*` |
| `components/v2/**/*.test.ts(x)` | tests (section 9) | `components/v2/*` |
| `app/landing/page.tsx`, `page.test.tsx` | the route (decision 1) and its metadata | **`apps/web/app/landing/*` is not in the table: add it (docs-only commit)** |
| `scripts/audit-budget.mjs`, `scripts/budget.json` | the JS budget check | `scripts/*` |
| `scripts/audit-landing.mjs`, `scripts/lib/page-checks.mjs` | the browser audit of the page | `scripts/*` |
| `docs/plans/port-design-v2-stage2-report.md` | the STOP report | `docs/plans/port-design-v2*.md` |

**Files to edit:** `design/v2.css` (one `@import "./motion.css";`, `@source` for new folders if they are outside `components/v2`), `scripts/audit-leaks.mjs` and `scripts/lib/leak-audit.mjs` (page mode), `package.json` (new scripts; dependencies only with approval). **Not touched:** `app/layout.tsx`, `proxy.ts`, `lib/security/*`, `next.config.ts`, `globals.css`, `app/login/*`, `app/auth/*`, `followups/**`.

**v2 components used:** `V2Root` (Stage 1), `design/tokens.css`, `reset.css`, `fonts.ts` (via `V2Root`); everything else in the table above is new in Stage 2.

**Not carried from design-lab:** the `?phase=`/`?slide=` freeze parameters (screenshot hooks; the audit uses reduced motion and timed waits instead), `makeI18n`, the localStorage language provider, the pre-paint theme script, the `landing.html` entry, `lib/theme.tsx` and `lib/hooks.ts` (replaced by cookies and two tiny hooks).

## 2. Routing: new route or replace `/`

| | A: replace `/` now | B: build at `/landing`, flip `/` in the last commit |
|---|---|---|
| Files | `app/page.tsx` renders the landing; `app/page.test.tsx` is rewritten (it asserts the foundation placeholder: heading "SME AI Revenue Engine" and "No business features yet") | new `app/landing/page.tsx`; `app/page.tsx` and its test untouched until the flip |
| Effect on the byte-identical proof | `/` changes from the first commit (expected, but it makes the whole stage's proof "all pages but `/`") | **all ten Stage 1 snapshots stay identical until the flip commit**, then exactly one differs (`/`), and the proof is re-run |
| Risk | the placeholder disappears before the page is reviewed | one extra small commit |
| Table | `app/page.tsx`, `page.test.tsx` are in the table | needs `apps/web/app/landing/*` added |

**Recommendation: B.** The page is built and reviewed at `/landing`, with the unchanged-pages proof clean for the whole stage. The flip (`app/page.tsx` re-exports the landing, test rewritten, proof re-run with `/` as the only intended difference) is its own commit after the owner approves at the STOP. `/landing` can stay as an alias or be removed in the flip commit (owner's call at the flip).

## 3. Rendering under the nonce CSP (ADR 0060 decision 2)

* The page is **dynamically rendered**: the root layout's `force-dynamic` already applies; nothing is changed. Next puts the request nonce on its own scripts and styles automatically. **No inline script of our own** and **no inline `<style>`**, so the strict policy holds without a new directive.
* Theme and language are read **on the server from two functional cookies** (`sme_theme`, `sme_lang`): the first response is already in the right language and theme, so there is **no pre-paint script** (design-lab needed one and a nonce would have been required) and no flash. **Assumption** (decision 2): cookies, not localStorage.
* The page is a thin server `page.tsx` that reads the cookies and renders `LandingView({ lang, theme })`, a pure component: easy to test in all four languages without mocking `next/headers`. Only the selected language's strings reach the browser (as props to the client islands), so the four dictionaries are not in the JavaScript bundle.
* Client islands only where interaction needs them: `LangSelect` (sets `sme_lang`, calls `router.refresh()`), `ThemeButton` (sets `sme_theme`, flips `data-theme` immediately), `Flow` (timers, `IntersectionObserver`, pause control), `EarlyAccess` (the placeholder message).
* Metadata from `generateMetadata` (title, description, Open Graph) in the selected language, **`robots: noindex, nofollow` until the owner removes it** (one constant). JSON-LD as a non-executable `<script type="application/ld+json">`; it is data, not script, so the CSP does not block it. **Assumption** (decision 5): no `publisher` and no `og:image` until a real entity and asset exist (design-lab had placeholder values for both).
* `<html lang>` is hard-coded `en` in the root layout, which we do not touch. The wrapper `V2Root` gets `lang={lang}` so assistive technology reads the page in the right language; the document-level attribute stays `en`. Limitation recorded; proposal to make the root attribute dynamic is separate (decision 6).
* The proof that the CSP holds: the page is loaded in Chrome under the real proxy policy and **0 CSP violations** is a check in `audit:landing`.

## 4. The brand name: one constant

`design/brand.ts` is the only place the string exists:

```ts
export const BRAND_NAME = "Sme-AI (working name)";
export const BRAND_TEXT = BRAND_NAME.replace(/-(?=\p{L})/gu, "-⁠"); // no line break inside "Sme-AI"
```

* Every sentence in the string store uses `{brand}`; `fill()` injects `BRAND_TEXT` into running text and `BRAND_NAME` into the title/description (plain, no joiner). `Wordmark` renders from the same constant, split at the first " (".
* **Tests that make "one-line rename" true:** (1) the string store test already fails if a string contains `sme-ai` literally; (2) a new source test fails if any file under `components/v2`, `app/landing` or `i18n` (other than `design/brand.ts`, tests and the strings JSON, which holds none) contains the literal; (3) a render test sets the constant via a mocked module to "Rename Test" and checks the rendered text, title and aria-labels contain it and not "Sme-AI".
* Changing the name later is one edit to `design/brand.ts` (plus `fonts`/logo work, which is not text).

## 5. i18n: keys, four languages, drafts, the gate

* **Keys:** the 142 keys of `i18n/strings/landing.json` (en/te/hi/kn), unchanged. The shared header strings use `lang.label`, `theme.toDark`, `theme.toLight`, `nav.*`. **A test fails if a key is unused or a rendered string is not from the store** (keys used only in `<head>` are listed: `meta.*`; `foot.copy` is built from the year and the brand). **Assumption:** no new key is needed. If one is, it is added in all four languages as a draft with `status: draft`.
* **Drafts stay drafts.** No string is marked `reviewed` in Stage 2. The page shows the existing notice (`langs.note`: the Telugu, Hindi and Kannada text is machine-written and the owner will proofread it) wherever the languages section shows a translated sample.
* **The gate stays on:** `npm run i18n:status` runs at the STOP (currently 175 draft per language for landing + login); with `PUBLIC_LAUNCH_REQUIRES_REVIEWED=1` it fails while any string is a draft. The wiring into `build` remains a separate security-tier proposal. The owner's `i18n:first-pass` sheet is the review path; nothing in Stage 2 changes the store except additions.
* **Language and register:** the page uses the everyday register of `i18n/STYLE.md`; the hyphen rule (U+2060) is applied by `dictFor`.
* **Cookie values** are validated against `en|te|hi|kn` and `light|dark` on the server; anything else is ignored.

## 6. Content rule: nothing we cannot prove

* Existing guard, extended to the rendered page: the forbidden-claims list (guarantee, testimonial, "trusted by", used/loved/chosen by, percentages, customer/user counts, ratings, awards, certifications, case studies, scale claims, "the AI sends messages", "replaces your staff") runs on the **rendered text of all four languages** of the page, not only on the JSON.
* **No logos, no customer or person names, no statistics.** The only invented content is the hero's **example card** ("Example Textiles, Hyderabad", a made-up quote amount, a made-up money-held amount), kept as decided and **labelled "Example, not real data"** on the page (key `flow.example`). Its constants live in one file (`example-data.ts`) with a comment that they are synthetic; a test fails if the label is absent whenever the example is rendered.
* Placeholders are visibly placeholders: the privacy policy, terms and contact entries in the footer are **plain text labelled "(placeholder)", not links** (**Assumption**: design-lab linked them to nothing); the early-access button is a placeholder that shows "coming soon", sends nothing and saves nothing (key `early.nodata`); a test clicks it and asserts no `fetch`/XHR/form submission happened.
* The privacy section states only what exists (`priv.3.d`: no independent review yet) and says nothing about certification or compliance.

## 7. Budgets and checks

* **JS budget = baseline + 40 KB:** baseline of an empty Next route measured at **177,009 B gzip** (Stage 0), so the page's referenced scripts must total **≤ 217,009 B gzip**. `npm run audit:budget` (`scripts/audit-budget.mjs`, no dependency) starts `next start` on an unused port, fetches the page, gzips every `<script src>` and prints the total, the baseline and the margin; thresholds live in `scripts/budget.json` (baseline 177,009, allowance 40,000). It also prints the font bytes a visitor of each language would download (informational).
* **`audit:leaks` extended to the landing (page mode):** on the real page served by `next start`, find the legacy sheet (contains `.shell` and `.card`) and the v2 sheet(s) (contain `[data-ui="v2"]`), and run the Stage 1 classification (OVERRIDE, SHADOWED, BASE with the same allow-list) on every element inside `[data-ui="v2"]`, in light and dark and in all four languages. **Reverse audit:** from the landing, soft-navigate (the header's "Sign in" link) to a legacy page and compare the computed styles of its elements with the v2 sheet enabled and disabled; they must be identical (Stage 0 showed the stylesheet stays loaded after a soft navigation).
* **Before/after proof that other pages stay byte-identical:** the Stage 1 snapshot script on the same ten requests plus the list of emitted css/js files with sha256, run before Stage 2 and at the STOP. **Under option B everything must be identical** (a new route adds new chunk files and a new route-table line, which the comparison lists separately); after the flip commit only `/` may differ. If Turbopack renames a shared chunk, the report shows which and why; a changed chunk referenced by another page is a finding, not a pass.
* **Accessibility (no new dependency):** `audit:contrast` on the tokens (52 checks) plus, in `audit:landing`, a computed contrast check of every visible text node against its effective background in light and dark (4.5:1, 3:1 for large text); one `h1` and clean heading order; landmarks; every control has an accessible name; visible focus ring on every control (ring token 3:1); touch targets at least 44px on a phone; text at least 14px; no horizontal scroll at 360, 390, 768, 1024 and 1440 px in all four languages; reduced motion shows the static strip with all six steps; the pause control works; **0 CSP violations and 0 console errors**. (An `axe-core` run would need a dev dependency: decision 7.)
* **Behaviour of the strip** (ported tests): auto-starts without a click, pauses off-screen and on a hidden tab, a touch pauses the swipe row, only `transform`, `translate`, `scale`, `rotate` and `opacity` animate, the hero card sits in the first screen at five sizes.

## 8. Browser checks without asking the owner to test by hand

Current facts on this machine (appendix): Google Chrome and Safari are installed, **Firefox is not**, `/usr/bin/safaridriver` exists, `geckodriver` and `playwright` are not on the PATH, and `~/Library/Caches/ms-playwright` holds Chromium builds only.

| Option | What it needs | Covers | Verdict |
|---|---|---|---|
| **P. Playwright**: dev dependency `playwright-core` (exact, via npm 10.9.2) and `npx playwright install webkit firefox` | **needs owner approval** (one dev dependency; a browser download from the Playwright CDN, hundreds of MB, size not verified here) | headless WebKit (the Safari engine, not Safari itself) and Firefox, fully scriptable, usable in CI later | **recommended** |
| S. Real Safari through the system `safaridriver` (WebDriver over HTTP with `fetch`, no dependency) | **needs owner approval**: a one-time `sudo safaridriver --enable` and Safari's "Allow Remote Automation" setting | the actual Safari on macOS; no Firefox | good complement |
| F. Firefox + `geckodriver` | **needs owner approval**: two downloads | Firefox only | not preferred |
| N. Chrome only | nothing | Chrome | **the fallback if the owner says no** |

If P is approved: `scripts/audit-landing.mjs` gains `--engine webkit|firefox` (the same page checks except the CDP-only ones), results are reported per engine. **If the owner says no to all:** the STOP report says plainly "Chrome only; Safari and Firefox not verified", the support statement is Tailwind v4's published baseline (Safari 16.4+, Chrome 111+, Firefox 128+; **stated from memory, not verified here**), and the audit adds a static check that lists the CSS features the v2 stylesheet and the page use (cascade layers, `color-mix`, individual `translate`/`scale` properties) so the owner can see what a browser must support. No hand testing is requested either way.

## 9. Testing rhythm

* **Per commit:** `npm run lint` and `npm run typecheck` ("check-fast": no Docker, no database) and `npx vitest run <the test files of the files touched>`. (In Stage 1 I ran lint and typecheck on the whole tree before the commits; in Stage 2 I run both before each commit.) CSS-affecting commits also run `npm run audit:leaks --source-only`; commits that touch the stylesheet or a v2 component run the full `audit:leaks`.
* **Once at the end of the stage, before the STOP: the full web CI set** from a clean install with CI's npm: `npx -y npm@10.9.2 ci --no-audit --no-fund`, `npm run lint`, `npm run typecheck`, `npx tsc --noEmit -p ../../packages/contracts/tsconfig.json`, `npm test`, `npm run build`; then `audit:leaks` (page mode), `audit:landing`, `audit:budget`, `audit:contrast`, `i18n:status`, and the unchanged-pages proof.
* **Tests to write:** `motion.ts` (ported unchanged), `Flow` playback rules, `LandingView` in four languages (every key used, no English in te/hi/kn except exempt keys, forbidden claims on rendered text, the example label, one `h1`), the brand-constant tests (section 4), cookie readers (`readLang`/`readTheme`), `LangSelect`/`ThemeButton` (cookie written, label changes), `EarlyAccess` (no network), icons (decorative `aria-hidden`), the route's metadata (noindex, localized title).

## 10. Commit slicing, order and the STOP report

Order (about 14 commits, in line with the plan's estimate of 10 to 14 for Stage 2; the browser-matrix commit is extra if approved):
1. docs: add `apps/web/app/landing/*` to the expected-paths table.
2. `design/brand.ts`, `design/format.ts`, `i18n/fill.ts`, `i18n/server.ts` + tests (brand one-constant tests included).
3. `i18n/landing.ts` + the unused-key test.
4. icons (inline SVG, or `lucide-react` after "deps ok": decision 3, in its own commit with the lockfile generated by npm 10.9.2).
5. `design/motion.css` + `Wordmark` + `TeamIllustration`.
6. `motion.ts` + tests (ported).
7. client islands `LangSelect`, `ThemeButton` + tests.
8. `Flow` + `example-data.ts` + tests.
9. the static sections (Header, Hero, Problem, How, Control, TeamSection, LanguagesSection, Privacy, Faq, Footer) and `EarlyAccess`, in two commits.
10. `LandingView` + render tests in four languages (honesty, brand, keys).
11. `app/landing/page.tsx` + metadata + route tests.
12. `audit:leaks` page mode + reverse audit; `audit:budget`.
13. `audit:landing` (structure, overflow, contrast, motion, CSP).
14. (only if approved) the browser matrix.
15. docs: Stage 2 report. Then **STOP**. The `/` flip is a separate commit after the owner's approval (decision 1).

**STOP report (same format as Stage 1, raw outputs, not summaries):** `git status --short`; `git log --oneline` of the stage; **`git diff --stat origin/main...web/port-design-v2 -- .github lanes.json AGENTS.md CLAUDE.md docs/lanes.md scripts Makefile` (must be empty; note `scripts/` also contains the port's own `apps/web/scripts`, which are not the repository's guarded `scripts/`)**; `git diff --name-status origin/main...web/port-design-v2` checked against the expected-paths table (each path listed as allowed or not); the lockfile list if any dependency was approved; the full web CI exit codes; `audit:leaks` (page mode, four languages, light and dark), `audit:landing`, `audit:budget` (total vs 217,009), `audit:contrast`, `i18n:status` counts and the flag run; the before/after snapshot comparison (ten requests plus asset sha256 list). Not touched: `followups/**`, `proxy.ts`, `csp.ts`, `next.config.ts`, root layout, auth, login, `globals.css`.

## 11. Risks

1. **Tailwind classes not generated** if a new folder is missing from `@source` (the page would look unstyled while tests pass): the page-mode audit's SHADOWED check and a screenshot comparison catch it; every new folder adds its `@source` line in the same commit.
2. **Inline style next to `className`** is forbidden by the source check, and `Flow` moves a chip with an inline `transform`: the moving element is split in two (outer element with the `style`, inner with the `className`), or the position is a CSS custom property on a wrapper without classes.
3. **JS size:** the client islands are small by design, but `Flow` plus `LangSelect` plus React/Next baseline must fit in 217,009 B gzip; `audit:budget` fails the commit that exceeds it.
4. **Cookies and the law:** `sme_lang` and `sme_theme` are first-party functional cookies; whether a notice is needed is for the owner and the lawyer (decision 2). Fallback: localStorage and a client-side language switch (more JavaScript, a flash, no localized first response).
5. **Hydration:** the theme button's label depends on the system theme when no cookie exists; it starts with the light-mode label and corrects itself after mount (no warning), documented.
6. **Fonts:** the Indic fonts are large and are fetched from Google Fonts at build time (as Geist already is); only the scripts a page uses are downloaded (Stage 1 canary).
7. **Safari and Firefox unverified** unless decision 4 is yes.
8. **Dynamic rendering means no CDN caching** (parked until T012).
9. **Example amounts** could be mistaken for real figures: always adjacent to the label, tested.
10. **The flip commit changes `/` and its test**; it is a separate commit so the stage's "other pages unchanged" proof is not muddied.
11. **Translations are drafts:** the page ships labelled; the gate prevents a public build until the owner's review is imported.

## 12. Decisions I need from the owner (8)

1. **Route:** build at `/landing` and flip `/` in a final, separate commit after you approve (B), or replace `/` from the start (A)? *Recommend B; it also needs `apps/web/app/landing/*` added to the expected-paths table.*
2. **Language and theme persistence:** two functional cookies read on the server (first response correct, no flash, less JavaScript) or localStorage as in design-lab? *Recommend cookies; please ask the lawyer whether strictly-functional preference cookies need a notice.*
3. **Icons:** approve `lucide-react` (exact pin, lockfile by npm 10.9.2) now, or 21 inline SVGs? *Recommend lucide-react: the port needs about 50 icons across later stages (design-lab used 50), so inline SVGs now would be thrown-away work. If you prefer no dependency, I do inline SVGs for Stage 2 and revisit at Stage 4.*
4. **Browser matrix:** approve Playwright (`playwright-core`, exact pin, plus a browser download for WebKit and Firefox), or Safari through `safaridriver` (one-time setup), or Chrome only? *Recommend Playwright (both engines, headless, CI-ready). "No" means Chrome-only with the honest label in section 8.*
5. **Indexing and structured data:** `noindex` until launch, and no JSON-LD `publisher` or `og:image` until a real legal entity and asset exist? *Recommend yes to both.*
6. **`<html lang>`:** accept that the document attribute stays `en` (the wrapper carries the right `lang`) until a separate root-layout proposal, rather than touching the root layout now? *Recommend accept; propose the root-layout change together with the T012 static decision.*
7. **Accessibility tooling:** custom checks only (no dependency), or add `axe-core` as a dev dependency for a broader rule set? *Recommend custom checks now; revisit if the browser matrix is approved (Playwright integrates axe cheaply).*
8. **Placeholders:** footer privacy/terms/contact as plain text labelled "(placeholder)" (not links), and the early-access button staying a "coming soon" placeholder that sends and saves nothing? *Recommend yes, as designed.*

## Appendix: facts checked in this run (exact output)

```
$ git status --short            (before the branch was created)
[empty]
$ git rev-parse HEAD            9deb8d5ae4f1e2e239d94e759fab05908e6ea3cf
$ git rev-parse origin/web/port-design-v2   9deb8d5ae4f1e2e239d94e759fab05908e6ea3cf
$ ls /Applications | grep -iE "firefox|safari|chrome|chromium|edge|brave|arc"
Google Chrome.app
Safari.app
$ ls /usr/bin/safaridriver
/usr/bin/safaridriver
$ ls ~/Library/Caches/ms-playwright
chromium-1140
chromium-1234
chromium-1243
$ command -v geckodriver playwright
(no output)
$ current apps/web/app/page.tsx: a 12-line placeholder ("SME AI Revenue Engine", "Foundation build (T001). No business features yet. ...")
$ current apps/web/app/page.test.tsx asserts: the heading "SME AI Revenue Engine" and the text /No business features yet/
$ design-lab landing, icons used (distinct): ArrowRight, Ban, Clock, Languages, ListChecks, Lock, MessagesSquare, ShieldCheck, TriangleAlert, UserCheck, Check, FileText, Inbox, MessageSquareText, PackageCheck, Pause, Play, Search, Globe, Moon, Sun (21)
$ design-lab landing, client-side needs: Flow (IntersectionObserver, timers, visibilitychange), LangSelect, ThemeButton, EarlyAccess (placeholder click)
```
