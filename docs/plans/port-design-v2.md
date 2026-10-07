# Plan: port design v2 and the landing page into apps/web (Next.js)

Status: **PLAN ONLY.** Written 2026-10-07 on branch `web/landing`. No code, nothing installed, nothing pushed, no remote changed, no `.env` opened. Every number and quotation below is from a command run for this plan; the exact output is in the appendix at the end. Where I could not prove something, it says so.

Ticket id: none yet (the owner assigns one; `docs/handoff-t010-part2.md` already says "the design v2 port is its own ticket"). Worktree and branch, created only after approval: `~/Desktop/sme-ai-port` on `web/port-design-v2`, **from `origin/main` (2fd595b), not from `web/landing`** (see 1.1).

## 0. Ten-second version

* `design-lab/` (Vite SPA, 70 source files, 9,272 lines, 757 `className` lines) is reference only. The real app `apps/web` has **no shell, no Tailwind, no i18n, 475 lines of unlayered global CSS, and a root layout that forces dynamic rendering because of the nonce CSP.** Those four facts decide the plan.
* "Static pre-rendered landing and login" **conflicts with the current CSP** (a prerendered page has no nonce). That needs a spike and an A/owner-reviewed security change before Stage 2.
* Recommended order: **tokens/fonts/i18n (invisible) → landing → login (UI only) → app shell (opt-in per page) → one screen family at a time → Office (3D) → follow-up screens last.** Reasons in section 3.
* Nothing on a real screen is fake: design-lab's `data/`, scripted voice, sign-in simulator and sample badges are **not carried**.
* New dependencies: **none are needed for Stages 1 to 9 if we choose CSS Modules; Tailwind v4 needs 2 dev dependencies; the 3D office needs 4.** Section 4.
* The lane guard does not know a "web" lane. A branch named `web/port-design-v2` is not guarded at all; a branch named `lane/web` fails closed until a setup change adds the lane. Section 6.

## 1. What I found (facts that shape the plan)

### 1.1 Branches
* `origin` is `https://github.com/gowthamde24/sme-ai.git` (fetch and push).
* `web/landing` (667a973) is already on the remote. It is **26 commits ahead of and 17 commits behind `origin/main`** (2fd595b); merge base a670c54. `origin/main` now contains T010 part 2 (the follow-up screens).
* So the port branch must start from `origin/main`. design-lab files are brought over one path at a time with `git checkout web/landing -- <path>`; nothing else is merged.
* `web/landing` changes **196 files** against `origin/main` (three-dot): 111 under `design-lab/` and **85 under `apps/web/src/`** (inventory in section 2).

### 1.2 The real app today (origin/main)
* Routes (`page.tsx`): `/`, `/login`, `/auth/{confirm,forgot,mfa,set-password}`, `/app` (workspace list), `/app/security`, and under `/app/tenants/[tenantId]/`: home, agents, companies/[id], enquiries/[id], followups, followups/policy, leads/[id], leads/[id]/followup, orders, orders/[id], price-list, privacy, requirements/[id]/questions, review, suggestions.
* **There is no `/app` layout, no shell, no loading or error boundary.** The only layout is `apps/web/app/layout.tsx`. Each page draws its own frame (a `.shell` box, a `.tabs` row).
* Styling: `app/globals.css`, 475 lines, plain unlayered CSS, **owned exclusively by lane B** (lane A is denied it in `lanes.json`). It has element selectors (`html, body`, `h1, h2`, `button`, `button:disabled`, `table`, `th, td`, `select`) and classes such as `.card .row .shell .hint .error .tabs .tap .badge`. No Tailwind anywhere in `apps/web`.
* Fonts: `next/font/google` (Geist, Geist Mono). Language: English only.
* No `apps/web/components/` directory exists. `components/ui/*` and `components/mocks/*` are **reserved for lane B**, so the port must not put its primitives there (use `components/v2/`).
* `apps/web/package.json`: next 16.3.8, react 19.2.8, `@supabase/*`, vitest 5, testing-library, eslint 9. `tsconfig` includes `**/*.ts(x)` and vitest includes `**/*.test.{ts,tsx}`, so **everything under `apps/web/src` is type-checked, linted and tested by CI** even though no route imports it (`git grep` found no import from `app/`, `lib/`, `proxy.ts` or `next.config.ts`).

### 1.3 The CSP problem for "static" pages (the biggest risk)
* `app/layout.tsx` exports `dynamic = "force-dynamic"` with the comment "A nonce-based CSP (proxy.ts) needs every page rendered per request: a prerendered page has no nonce for its scripts."
* The Next 16.3.8 docs in `node_modules` agree: nonces require dynamic rendering; "Static pages are generated at build time ... so no nonce can be injected"; PPR is incompatible.
* The docs offer an **experimental** alternative, SRI (`experimental.sri`), "available in App Router". In this install the only implementation I found is a **webpack** plugin (`SubresourceIntegrityPlugin` in `dist/build/webpack-config.js`). The app builds with plain `next build`. I did **not** prove whether Turbopack builds support SRI; the spike must.
* Static pages would also still carry Next's inline flight-data scripts; whether a hash/SRI policy lets them run is **unproven** (spike).
* `proxy.ts`, `lib/security/csp.ts`, `next.config.ts` are security-tier files (lane B is denied them; AGENTS.md says path grants never authorise security work for B/C). Any CSP change is **A or owner work with its own tests**.
* `/login` also reads `searchParams` (`next`, `notice`) on the server, which makes it dynamic by design. A static login needs the server shell to stop reading them and a small client island to read `useSearchParams` inside `<Suspense>`.
* A static page has no nonce, so **no inline pre-paint theme script** (docs: inline scripts are blocked by strict CSP). Dark mode then follows `prefers-color-scheme` first and applies a saved choice after hydration (a possible one-frame flash).

### 1.4 Coexistence with Claude 1 (WhatsApp)
* Branch `followups-whatsapp` (one commit so far, 7a96df3, a plan) edits `followups/due-view.tsx`, `lead-followup-view.tsx`, `create-draft-form.tsx`, `touch-form.tsx`, `followup-logic.ts` and the lead follow-up page, plus `docs/rehearsal-followups-checklist.md`. Its plan says "the plain screens stay plain; design v2 is its own ticket."
* `followups/checklist.test.ts` pins quoted sentences to those screens. A restyle that rewrites wording would break it.
* **Rule for the port:** no file under `app/app/tenants/[tenantId]/followups/**` or `leads/[leadId]/followup/**` is touched, and no shell chrome is wrapped around those pages, until that PR is merged (Stage 11).

### 1.5 Legacy global CSS versus Tailwind (second biggest risk)
* Tailwind v4 emits its rules inside `@layer`s. **Unlayered CSS beats layered CSS regardless of specificity.** `globals.css` is unlayered, so its `button { ... }`, `table`, `select`, `h1, h2 { margin }` rules would override Tailwind utilities on any v2 page that also loads `globals.css` (the root layout loads it for every route).
* design-lab's own custom classes (`fade-enter live-dot office-bg page-enter pb-safe pop-enter sheet-enter side-enter skeleton wave-bar`) do not collide with the real class names, so name collisions are not the problem; the **cascade layering** is.

## 2. Inventory: files on `web/landing` outside `design-lab/` (85 files, all under `apps/web/src/`)

None of these is imported by any route. They come from older commits at the bottom of the branch, titled `T010: ...` or `web: ...`. **The `T010` in those subjects is not the real T010 (follow-up cadence); the names collide in history.** CI result for them is unknown (not run for this plan).

| Group | Files / lines | What it is | Decision |
|---|---|---|---|
| `apps/web/src/design-system` | 43 files, 3,950 lines | Teal `--sme-*` tokens (`tokens.css`, 239 lines), 13 CSS-module components (Badge, Button, Card, Dialog, Drawer, FormFields, ResponsiveTable, Skeleton, States, Stepper, Tabs, Toast, DesignSystemPreview), `theme.tsx`, `formatters.ts`, `useModalTrap.ts`, 5 tests | **DROP the group** (superseded by the v2 orange theme). **Keep as seeds, reworked:** `useModalTrap.ts` + `dialog-modal.test.tsx` (tested focus trap, lets us avoid `@radix-ui/react-dialog`); `formatters.ts` + test (paise money format; first diff it against any money formatting `apps/web` already has); the techniques of `contrast.test.ts` and `focus-outlines.test.ts` (re-pointed at v2 tokens). Drop `SampleDataBadge` and `DesignSystemPreview`. |
| `apps/web/src/app-shell-preview` | 30 files, 6,330 lines | Old shell (Shell, Sidebar, TopBar, BottomTabBar, shortcuts dialog), 7 screens running on `fixtures.ts` (288 lines of invented businesses and amounts), an older dictionary (`i18n.ts`, `i18n.review.ts`), `MasterPreview`, `standalone-preview.html` (806 lines), 4 tests | **DROP all** (fake data; older than design v2; its i18n is replaced by `src/i18n/strings`). |
| `apps/web/src/office-preview` | 12 files, 1,332 lines | The 2D SVG office, list view, `office-feed-fixture.ts` (invented events), 1 test | **DROP** (replaced by the 3D office with a List view in design-lab; the fixture is fake). |

**Recommended handling before anything is merged:** do not merge `web/landing` into `main` as it is (it would add 85 dead files to every CI run). Either keep it as a reference branch (recommended), or have the owner approve one cleanup commit that removes the three groups first. The port branch never contains them because it starts from `origin/main`.

### design-lab itself (111 files, reference only): what each area becomes

| design-lab area | Treatment |
|---|---|
| `src/i18n/strings/*.json`, `STYLE.md`, `review/*.csv`, `scripts/i18n-*.mjs` + `lib/i18n-data*.mjs` | **CARRY** (Stage 1), paths re-pointed to `apps/web/i18n/` |
| `src/index.css` (tokens, themes, motion) | **REWORK** into `apps/web/design/tokens.css` (Stage 1) |
| `src/landing/*` (LandingPage, Flow, Team, chrome, motion, copy) | **REWORK** into Next server and client components (Stage 2) |
| `src/login/*` | **UI only** (Stage 3); `state.ts` is a sign-in simulator with fake accounts: **DROP** |
| `src/components/Shell.tsx`, `ui.tsx` | **REWORK** (Stage 4) as `components/v2/*` |
| `src/screens/*` (Today, Leads, Quotes, Orders, Office, Integrations, Settings) | **NOT ported as they are** (they run on fixtures); each real screen is restyled from the real page (Stages 5 to 10) |
| `src/data/*` (fixtures, today, decisions) | **DROP** (fake data) |
| `src/voice/*` | `VoiceDock.tsx` UI **carried disabled** (section 5); `scripts.ts`, `VoiceProvider.tsx`, `machine.ts` (scripted replies from fixtures) **DROP** |
| `src/office/*` (16 files) | **CARRY the geometry, characters, seats and camera** in Stage 10; `stream.ts`, `people.ts` event fixtures **replaced** by a real-data adapter |
| `src/lib/*` | `cn`, `format`, `hooks`, `theme`, `toast` carried as needed; `route.ts` (hash router) **DROP** |
| `scripts/*` (screenshots, overflow audit, contrast, bundle report, browser driver) | **ADAPT** to run against `next start` on an unused port; the driver uses Node's built-in WebSocket and system Chrome, no dependency |

## 3. Stages (each small; each ends with a STOP for your review)

**Check rhythm (owner instruction, 2026-10-07):** *check, lint and the tests of the touched files* on every commit, and *the full check once at the end of each stage, before the STOP*.
* **Every commit**, from `apps/web`: type-check (`npm run typecheck`, which is `next typegen && tsc --noEmit`), lint (`npm run lint`), and vitest on **only the test files the commit touches or that cover the touched files** (`npx vitest run <paths>`). For the i18n scripts: `node scripts/i18n-status.mjs` and their tests.
* **End of each stage, once, before the STOP: the full check.** I read "full check" as the whole CI web job: `npm run lint`, `npm run typecheck`, `npx tsc --noEmit -p ../../packages/contracts/tsconfig.json`, `npm test` (the whole `apps/web` suite, not only touched files) and `npm run build`; plus the stage's own audits (contrast, overflow, i18n status, bundle budget). The result goes in the STOP report with the exit codes.
* **Not `make check`.** `make check` needs Docker and `supabase start`; AGENTS.md lets **only lane A** run it, once before each commit, and forbids B and C from it and from ports 3000/8000/54321. The web lane therefore never runs it. Where a stage touches security-tier files (Stage 3 login/auth, any CSP change in Stage 2, Stage 9 forms) the owner or lane A runs `make check` on the stage branch before the merge, and the STOP report says so. *(Open question 15: confirm this reading.)*
* Each STOP also has screenshots (light and dark; 390, 768, 1440; te/hi/kn where the screen is translated). Screenshots use an unused port (e.g. 4175) with `next start`.

**Recommended order, and why it differs from your proposal.** You proposed tokens, then shell, then landing and login. I recommend **tokens → landing → login → shell → screens**:
1. The landing needs no auth, no data, no shell and touches no existing screen, so it is the cheapest place to learn the two unknowns (static vs CSP; Tailwind vs legacy CSS) before they cost anything.
2. The shell is the first thing that visibly changes real, authenticated pages; it needs tenant and role context and must be opt-in so it never wraps the follow-up screens. It should come after the styling and CSP decisions are proven.
3. Login is security-tier (A review), so it gets its own small stage after the landing has settled the design and the CSP approach.
4. Screens last, by risk: low-risk read screens first, approval and money screens after the shell and primitives are proven, follow-ups after Claude 1 merges.

| # | Stage | What is in it | STOP: what you review | Commits (est.) |
|---|---|---|---|---|
| 0 | **Decisions and two spikes** | ADR draft. Spike A: static route + CSP (SRI, webpack vs Turbopack, do inline scripts run, JS baseline of an empty Next route). Spike B: Tailwind v4 (layered) vs CSS Modules next to the unlayered `globals.css`, one throwaway route, plus proof that an existing page renders byte-identical. Spikes are thrown away; only the findings are committed. | Findings for Q2 and Q3, with numbers | 3 to 4 |
| 1 | **Tokens, fonts, i18n store (invisible)** | `apps/web/design/` (tokens, one orange theme, light/dark, contrast script), fonts through `next/font/google` (Bricolage Grotesque, Plus Jakarta Sans, Noto Sans Telugu/Devanagari/Kannada; loaded only by v2 routes), `apps/web/i18n/strings` + `dictFor` + the hyphen rule, i18n scripts and tests, `i18n:status` added to the build, `PUBLIC_LAUNCH_REQUIRES_REVIEWED` wired, **and the legacy-CSS mitigation with its failing test (section 3.2)**. Nothing imports it yet. | Proof the existing pages are unchanged (HTML snapshot of `/login` and one `/app` page before and after); draft counts | 6 to 8 |
| 2 | **Landing (static)** | Replaces the foundation placeholder at `/`. Header, hero flow strip, problem, steps, control, team, languages, privacy, early access (no form, sends nothing), FAQ, footer, SEO metadata, theme and language switch (client). Needs the CSP outcome of Spike A and an A/owner-reviewed change to `proxy.ts`/`csp.ts` if static is chosen. | Screenshots; first-load JS against a budget re-measured from the spike; CSP tests; honesty tests (no guarantees, testimonials, counts) | 10 to 14 |
| 3 | **Login and auth pages, UI only** | Restyle `/login`, `/auth/{mfa,forgot,set-password,confirm}` markup. **`actions.ts`, `lib/auth/*`, `lib/supabase/*` untouched.** Server messages stay as they are (English) until A agrees how to localise them. No remember-me. | A's review of the diff (it must contain no logic change); the existing auth tests unchanged and green | 4 to 6 |
| 4 | **App shell, opt-in** | `components/v2/*`: sidebar, top bar, phone bottom tabs, account menu using the real `signOut`, theme and language, a `V2Frame` wrapper that **each page opts into**. Nav lists **only real routes**. No "Sample data" badge (the data is real). | Screens: `/app` and the workspace home framed; follow-up pages demonstrably unframed | 8 to 10 |
| 5 | Family: **workspace home** (`/app`, `tenants/[id]`) | Restyle the real pages with their real data. No new endpoints (anything the v2 "Today" shows that has no API stays out and is listed as a gap). | Screenshots from a synthetic workspace (Q10) | 5 to 7 |
| 6 | Family: **leads and review** | `review/*`, lead page, companies. Lane B owns `factor-breakdown*` and `touch-targets.test.ts`: keep them green; coordinate. | Screenshots; touch-target test | 6 to 8 |
| 7 | Family: **enquiries, requirements, quotes** | The largest and most business-critical (approval controls, "I sent it", quote text). Strings kept verbatim where tests pin them. | Screenshots; the approval path click-through | 10 to 14 |
| 8 | Family: **orders** | Orders list and order page; money held shown amber and never hidden. | Screenshots | 5 to 7 |
| 9 | Family: **price list, privacy, security, agents forms** | Security-tier forms restyled only (no action changes). | A review; screenshots | 6 to 8 |
| 10 | **Agents / Office (3D)** | The 3D scene over **real agent-run state** (`lib/api/agents.ts`), List view as the accessible equivalent, lazy chunk, default List on weak devices. Needs the 3D dependencies. | Screenshots, chunk size, a weak-device simulation | 12 to 16 |
| 11 | **Follow-up screens** | Only after Claude 1's PR is merged and the owner says so. | Screenshots; `checklist.test.ts` green | 6 to 8 |

**Estimate: 81 to 110 commits in total** (sum of the table below). This is a guess from design-lab's size; Stages 0, 2 and 7 are the least predictable.

### 3.1 Commits per stage (exact low and high, and running totals)

Counted: feature, test and docs commits, one commit per small step. **Not counted:** review-fix rounds after your review at a STOP (earlier tickets needed about 5 to 7 fix commits per round; expect 10 to 25 more across the whole port) and the setup-branch commits for the web lane (3 to 5, made by you or A, not by the port branch).

| Stage | Low | High | Running low | Running high |
|---|---|---|---|---|
| 0 Decisions and spikes | 3 | 4 | 3 | 4 |
| 1 Tokens, fonts, i18n store, CSS-leak audit | 6 | 8 | 9 | 12 |
| 2 Landing (static) | 10 | 14 | 19 | 26 |
| 3 Login and auth pages (UI only) | 4 | 6 | 23 | 32 |
| 4 App shell (opt-in) | 8 | 10 | 31 | 42 |
| 5 Workspace home | 5 | 7 | 36 | 49 |
| 6 Leads and review | 6 | 8 | 42 | 57 |
| 7 Enquiries, requirements, quotes | 10 | 14 | 52 | 71 |
| 8 Orders | 5 | 7 | 57 | 78 |
| 9 Price list, privacy, security, agents forms | 6 | 8 | 63 | 86 |
| 10 Agents / Office (3D) | 12 | 16 | 75 | 102 |
| 11 Follow-up screens (after Claude 1 merges) | 6 | 8 | 81 | 110 |
| **Total** | **81** | **110** | | |


### 3.2 Stage 1: the concrete mitigation for legacy CSS versus the v2 styles (risk 1.5)

Facts (appendix): `apps/web/app/globals.css` has **0 `!important` and 0 `@layer`**, and is imported in exactly one place, `app/layout.tsx` line 3, so it loads on every route. It is owned by lane B. Its element rules (`button`, `button:disabled`, `a.button`, `table`, `th, td`, `select`, `h1, h2`, `html, body`, `*`) are unlayered normal declarations.

Options considered:

| Option | Does it fix the cascade? | Cost | Verdict |
|---|---|---|---|
| **A. Tailwind utilities declared `important`, tokens scoped under `[data-ui="v2"]`, no Tailwind preflight, a small scoped reset** | **Yes.** An `!important` declaration beats any normal declaration, layered or not, so unlayered `button { ... }` cannot override `bg-*`, `p-*`, `rounded-*` utilities. | No edit to the B-owned `globals.css`. Utilities cannot be overridden by ordinary CSS, so v2 must not mix Tailwind with CSS Modules or inline overrides on the same element. | **Default for Stage 1** |
| B. Wrap `globals.css` in `@layer legacy`, declare `@layer legacy, theme, base, components, utilities;` first | Yes, and cleanly. | Edits a B-exclusive file; the layer order must be declared in the first stylesheet that loads; one more thing to get wrong. | Fallback if A fails the audit; the owner or B makes the one edit |
| C. CSS Modules for all v2 code (no Tailwind) | Mostly: a hashed class (0,1,0) beats element selectors (0,0,1); properties the legacy rules set and v2 does not set still leak, so each component needs a scoped reset. | The class strings of design-lab (757 lines) are rewritten by hand. | Fallback if Spike B shows Tailwind unworkable |
| D. A class prefix (`tw:`) | **No.** Collisions by name do not exist (appendix: design-lab's custom classes and the real classes do not overlap); the problem is cascade layering, which a prefix does not touch. | Rewrites every class. | Rejected |

Stage 1 delivers, in this order:
1. **Tokens only under `[data-ui="v2"]`** (not `:root`), plus a v2 wrapper component that sets the attribute. Legacy pages never get the attribute, so v2 tokens cannot reach them. The v2 stylesheet contains **no global element selectors**, so it cannot restyle a legacy page even if the browser keeps it loaded after a client-side navigation.
2. **Tailwind v4 imported without preflight and with utilities marked `important`** (the v4 import option for this is to be confirmed against the installed version's docs in Spike B), loaded only by v2 routes (through the wrapper component, not the root layout).
3. **A scoped reset** for exactly the elements the legacy file styles: `[data-ui="v2"] :where(button, a.button, table, th, td, select, h1, h2, input, textarea)` restores the properties `globals.css` sets (the property list is read from `globals.css` by the audit below, not typed by hand).
4. **The test that fails when a legacy rule overrides a v2 style: `apps/web/scripts/css-leak-audit.mjs`.** It drives headless Chrome (Node's built-in WebSocket, no dependency; the driver is design-lab's `scripts/lib/browser.mjs`) against the built app. On a v2 page it: (a) records the computed values of `background-color`, `color`, `font-family`, `font-size`, `line-height`, `margin-*`, `padding-*`, `border-*`, `border-radius`, `box-shadow`, `width`, `display` for every visible element inside `[data-ui="v2"]`; (b) finds the legacy stylesheet (the one containing the `.shell` and `.card` rules) and sets `sheet.disabled = true`; (c) records them again. **Any difference means a legacy rule is leaking into v2: the audit exits 1 and names the element, property and the two values.** It also runs the reverse check on a legacy page (`/login` before Stage 3, one `/app` page): its computed styles must be identical with the v2 stylesheet disabled, so v2 never leaks into legacy.
5. **A self-test of the detector** (as for the hyphen detector in design-lab): a synthetic page with an unlayered `button { background: red }` and a layered, non-important utility must be flagged; the same page with the `important` utility must pass.
6. **A temporary canary route** in the Stage 1 branch (one `<button>`, headings, a table and a select with v2 classes), used to run the audit end to end and **removed in the stage's last commit**; the STOP report shows the audit output. From Stage 2 on, the audit runs on the real landing page instead.
7. **A "legacy unchanged" check:** the rendered HTML and the computed styles of `/login` and one `/app` page are identical before and after Stage 1 (the same audit, reverse direction).

Stage 0's Spike B must confirm (or reject) option A with the installed Tailwind version before Stage 1 starts; if A fails the audit, Stage 1 switches to B (owner or B makes the one `globals.css` edit) or C, and the plan's dependency answer changes accordingly.

## 4. New dependencies (each needs your written "deps ok")

Today `apps/web` has only next, react, react-dom, `@supabase/ssr`, `@supabase/supabase-js` and the test/lint tools.

| Package | Used for | Stage | Can it be avoided? |
|---|---|---|---|
| `tailwindcss` 4.x + `@tailwindcss/postcss` (dev; `postcss` if it is not already present) | Keeps design-lab's 757 `className` lines mostly copy-paste | 0 (spike), 1 | **Yes, with CSS Modules** (the pattern the old `src/design-system` already used, and Next supports natively). Costs a hand rewrite of the class strings. Spike B decides. |
| `lucide-react` 1.16.0 | 50 distinct icons across 15 files | 2 | **Yes:** the ~50 icons as small inline SVG components. More files, no dependency. |
| `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three` | The 3D office (drei is used only for `OrbitControls` and `PerformanceMonitor`) | 10 only | No (4 packages, lazy chunk, one screen). Defer the decision to Stage 10. |
| `@radix-ui/react-dialog` | 1 file in design-lab | none | **Avoided:** reuse the tested `useModalTrap` from `src/design-system`. |
| `clsx`, `tailwind-merge` | 1 file (`lib/cn.ts`) | none | **Avoided:** a 5-line local `cn`. |
| 5 `@fontsource-variable/*` packages | design-lab fonts | none | **Avoided:** `next/font/google`, already used by the root layout (the build needs network for it, as it does today). |

So: **Stages 0 to 9 need either 2 dev dependencies (Tailwind) or none (CSS Modules); only Stage 10 needs 4 more.** Nothing is installed until you say "deps ok" for a named list.

## 5. How things are carried

* **i18n.** The JSON store (`en/te/hi/kn` + draft/reviewed status per language), `dictFor`, the U+2060 hyphen rule, the export/import/first-pass/status scripts and their tests move to `apps/web/i18n/`, with `i18n:status` in the build and `PUBLIC_LAUNCH_REQUIRES_REVIEWED` honoured. Language is a client switch (stored choice; `<html lang>` updated after hydration); the static HTML is English. Language-prefixed static routes (`/te`, `/hi`, `/kn`) would be better for search engines but need a root-layout reshuffle that renames many files and would collide with Claude 1: **not recommended now.** Real screens are English today; each screen family **extracts its English strings into the store** so translation is data later, and gets te/hi/kn drafts only if you ask. Server error messages stay English until A decides how to localise them. Glossary and review notes (legal-sensitive terms: money held, workspace, refund, advance, consent, payment, GST) travel with the store.
* **Light/dark.** One orange theme, tokens as CSS custom properties, `prefers-color-scheme` first, saved choice applied after hydration (see 1.3). No dependency.
* **3D office.** `next/dynamic` with `ssr: false`, loaded only on the Office route (design-lab's chunk was about 270 KB gzip). **Off by default** (List view) when WebGL is missing, `prefers-reduced-motion` is set, `saveData` is on, `deviceMemory` or `hardwareConcurrency` is 4 or lower, or the device is a small coarse-pointer screen; an explicit choice is remembered and wins; `PerformanceMonitor` can drop to List at run time. **Design-lab only probes WebGL today, so the weak-device default is new work, not a carry-over.** It shows real agent-run state only: an agent with no run shows "No run yet", with no ambient animation (CLAUDE.md: "No decorative agents").
* **Voice dock.** The panel UI only, **disabled**, with the visible label "Preview - not connected yet" (with te/hi/kn drafts), disabled input and button, no microphone code (the app's `Permissions-Policy` already blocks the microphone), no scripted answers.
* **NOT carried:** design-lab's fixtures and `data/`, scripted voice replies, the sign-in simulator and its example accounts, every "Sample data" badge and the design-lab preview buttons, the hash router, and the app-dictionary strings that describe fake records (the "Pooja Sarees" cards and similar).

## 6. CI lane-paths: what it requires

What the repository says (appendix has the exact lines):
* `lanes.json` has four lanes: `A`, `B`, `C`, `setup`. **There is no `web` lane.** "Unknown lanes fail closed."
* `.github/workflows/lane-paths.yml` runs its job only `if: startsWith(github.head_ref, 'lane/')` and calls the guard with `${LANE_BRANCH#lane/}`. So the lane name is whatever follows `lane/`, and it must be a key in `lanes.json` **at the PR's base commit**.
* Consequences for a PR that touches `apps/web`:
  1. **Branch `web/port-design-v2` (as you specified): the lane-paths job is skipped.** CI is then only the normal suite (packages, hygiene = no-leftovers + `test-lanes.py`, web lint/typecheck/test/build, api, db). `docs/lanes.md` says non-`lane/*` PRs are unguarded and the owner should accept other agents' work only from `lane/*` branches, so this sits outside the documented model. The owner runs by hand: `git diff --stat main...web/port-design-v2 -- .github lanes.json AGENTS.md CLAUDE.md docs/lanes.md scripts Makefile` (must be empty) and reviews the path list.
  2. **Branch `lane/b`:** would fail. B may touch only `components/ui/*`, `components/mocks/*`, `globals.css`, the local-time, factor-breakdown and touch-targets files, `e2e/*` and a few docs, and is denied `lib/auth`, `lib/supabase`, `lib/security`, `lib/api`, `proxy*`, `next.config.ts`, `app/login/*`, `app/auth/*`, `*actions*`, `app/app/page*`.
  3. **Branch `lane/a`:** is denied `components/ui/*`, `components/mocks/*` and `globals.css`. A port that restyles globally would need B's paths.
  4. **Branch `lane/web`:** fails with "unknown lane" **until a setup branch adds the lane and merges first**, because CI reads the policy from the base commit.
* **Recommended way to satisfy it:** an owner-approved *setup* branch adds a `web` lane to `lanes.json`, a case to `scripts/test-lanes.py`, an ADR range, and (in the guard) the same symlink/mode checks B and C get. It is merged to `main` before the first port PR. The port then goes out as `lane/web` (one branch per lane name, so each stage is a PR from `lane/web` after the previous merge). Proposed policy (a proposal, not applied):
  * The proposal as a table. Patterns follow `lanes.json` syntax: full-path globs, `*` spans slashes, `[tenantId]` is literal, **deny wins**, anything not allowed is refused. Not applied.

    | Rule | Pattern | Why |
    |---|---|---|
    | allow | `apps/web/design/*` | tokens, fonts (new) |
    | allow | `apps/web/i18n/*` | the string store (new) |
    | allow | `apps/web/components/v2/*` | primitives and the shell (new; not `components/ui`, which is B's) |
    | allow | `apps/web/scripts/*` | i18n scripts, CSS-leak audit, screenshot and overflow scripts (new) |
    | allow | `apps/web/app/page.tsx`, `apps/web/app/page.test.tsx` | the landing at `/` |
    | allow | `apps/web/app/login/page.tsx`, `apps/web/app/login/login-form.tsx` | login markup only |
    | allow | `apps/web/app/auth/*` | auth pages and forms; the `*actions*` deny keeps server actions out |
    | allow | `apps/web/app/app/*` | real screens and their tests; the denies below keep actions, routes and gated families out |
    | allow | `apps/web/package.json`, `apps/web/package-lock.json` | only with your written "deps ok" (the guard cannot check that; you review the diff) |
    | allow | `docs/plans/port-design-v2.md`, `docs/checklist-notes/web.md`, `docs/adr/0060-*.md` to `docs/adr/0069-*.md` | the plan, the lane's notes, a proposed ADR range (unused today) |
    | deny | `lanes.json`, `AGENTS.md`, `CLAUDE.md`, `docs/lanes.md`, `scripts/check-lane-paths.sh`, `scripts/new-lane.sh`, `scripts/test-lanes.py`, `.github/*` | guard integrity (setup branch only) |
    | deny | `apps/web/lib/auth/*`, `apps/web/lib/supabase/*`, `apps/web/lib/security/*`, `apps/web/lib/api/*` | auth, session, CSP and API client are security tier (lane A) |
    | deny | `apps/web/proxy*`, `apps/web/next.config.ts`, `apps/web/next-config.test.ts`, `apps/web/test/*` | CSP, headers, request guard |
    | deny | `apps/web/app/layout.tsx` | root layout (forced dynamic rendering for the nonce CSP) |
    | deny | `apps/web/app/*actions*` | every server action (login, auth, tenant, quote, order, follow-up, privacy) |
    | deny | `apps/web/app/*route.ts`, `apps/web/app/*route.test.ts` | route handlers (export, etc.) |
    | deny | `apps/web/app/globals.css`, `apps/web/app/favicon.ico` | B-exclusive |
    | deny | `apps/web/components/ui/*`, `apps/web/components/mocks/*` | B-exclusive |
    | deny (until Stage 11) | `apps/web/app/app/tenants/[tenantId]/followups/*`, `apps/web/app/app/tenants/[tenantId]/leads/[leadId]/followup/*` | Claude 1's WhatsApp work; lifted by a setup change after that PR merges |
    | deny (until Stage 9) | `apps/web/app/app/security/*`, `apps/web/app/app/tenants/[tenantId]/privacy/*`, `apps/web/app/app/tenants/[tenantId]/agents/*` | security-tier forms (erasure, MFA, agent controls); lifted by a setup change when Stage 9 starts |
    | not allowed (not in the allow list) | `supabase/*`, `services/*`, `packages/*`, `e2e/*`, `tests/*`, `Makefile`, `deploy/*`, `config/*`, `design-lab/*` | outside the port; design-lab stays reference only |

  * The guard code applies its symlink, submodule, file-mode and new-executable refusals only to lanes `B` and `C`; the setup change must add `web` to that check.
  * Stage 2's CSP change and Stage 0's `next.config.ts` experiment touch denied files: they go through **lane A or the owner**, as separate small PRs.
* Whether `lane-paths` is a **required** status check in GitHub's branch rules cannot be seen from the repo; the owner should confirm.

## 7. Risks

1. **CSP vs static** (1.3): the static promise may not be achievable without an experimental, possibly webpack-only feature. Fallback below.
2. **Legacy CSS beats layered Tailwind** (1.5): mitigated in Stage 1 by `important` utilities, scoped tokens, no preflight, a scoped reset and a failing leak audit (section 3.2); fallbacks are wrapping `globals.css` in a layer (a B-exclusive file, one edit) or CSS Modules.
3. **Security-tier and lane-restricted files:** login/auth pages, `proxy.ts`, `csp.ts`, `next.config.ts`, `globals.css`. Restyle-only discipline and A review.
4. **Claude 1 collision:** opt-in framing; no edit of follow-up paths until merged; the shell's nav still links to follow-ups (they will appear unframed for now).
5. **Branch drift:** `web/landing` is 17 behind `main`; the port starts from `main`.
6. **Existing tests pin wording and markup** (`checklist.test.ts`, touch-targets, page tests): each stage keeps strings verbatim and runs the whole `apps/web` suite.
7. **Bundle budget:** design-lab's "under 100 KB gzip of JS per public page" was measured on a Vite app (React only). Next's runtime adds a baseline; **the budget must be restated from the spike's measured empty-route baseline** (recommend baseline + 40 KB).
8. **Data gaps:** v2 screens assume feeds the real app may not have ("needs you" cards, AI usage, plan, role matrix). We do not invent them; gaps become separate A tickets.
9. **Screenshots of authenticated screens** need a backend. The web lane cannot start the stack. Proxy code may also need Supabase config even for `/login`; I did not test this. See Q10.
10. **Translations are drafts** (every string `draft`; no native speaker has read them). With `PUBLIC_LAUNCH_REQUIRES_REVIEWED` set, a public build fails until the owner's review is imported.
11. **Fonts:** `next/font/google` needs network at build time (as today); three Indic fonts must not load for English visitors (use unicode-range subsets, no preload).
12. **Time:** the estimate above is a guess.

## 8. Open questions for you, each with my recommendation

1. **Base and the old preview files.** Start the port from `origin/main` and copy design-lab files individually; keep `web/landing` as a reference branch and do **not** merge it (or, if you want it merged, first remove the 85 `apps/web/src` files). *Recommend: do not merge; reference branch.*
2. **Styling.** Tailwind v4 or CSS Modules? *Recommend: decide at the end of Stage 0 on measured evidence; lean Tailwind only if the layering fix is a one-file change you approve, otherwise CSS Modules (no dependency, matches the old pattern).*
3. **Static vs CSP.** *Recommend: time-box Spike A to one day. If SRI/hash works under Turbopack or webpack with the inline scripts allowed, go static. If not, keep the nonce CSP and render the public pages dynamically (they are light and need no data); that satisfies every security rule today, and "static" becomes a later optimisation.*
4. **Lane.** Create a `web` lane through a setup branch (section 6), or keep `web/port-design-v2` unguarded with the manual checklist? *Recommend: create the lane; it is the only option where CI enforces the boundary.*
5. **`globals.css`** is B-exclusive. *Recommend: the port does not edit it, except at most one layer-wrap edit decided in Stage 0, done by you or B.*
6. **Navigation.** The v2 nav (Today, Leads, Quotes, Orders, Office, Integrations, Settings, Help) does not match the real routes (quotes live inside enquiries; there is no Integrations or Help page; Settings is split across privacy and security). *Recommend: nav shows only real routes: Workspace home, Leads (review), Enquiries and quotes, Orders, Follow-ups (unframed until Stage 11), Price list, Agents, Privacy, Security. No placeholder entries.*
7. **Languages on real screens.** *Recommend: landing, login and shell chrome in four languages; screens stay English with strings extracted into the store; te/hi/kn drafts for a screen family only when you ask.*
8. **Landing example card.** The hero flow shows an invented, labelled example ("Example Textiles", an amount). Your rule says no fake data on any real screen; the landing is public marketing but is a real page. *Recommend: keep it, clearly labelled "Example, not real data", unless you read the rule strictly; then I replace the names and amounts with neutral labels. Your call.*
9. **JS budget.** *Recommend: restate it from the Stage 0 baseline (baseline + 40 KB).*
10. **Who runs the stack for screenshots?** The web lane may not. *Recommend: you or lane A run the local stack with the synthetic seed at each screen-family STOP; I provide a read-only screenshot script and a click checklist (like the rehearsal checklists), and the port itself never starts the stack.*
11. **Office data.** *Recommend: real agent-run state only, "No run yet" for idle roles, List default on weak devices; and you decide at Stage 10 whether the 3D scene ships in v1 at all (about 270 KB gzip, lazy).*
12. **Icons.** `lucide-react` or inline SVG. *Recommend: `lucide-react` (pinned) if you approve one dependency; otherwise inline SVG.*
13. **ADR numbers** for the port. *Recommend: ask the setup change to reserve a range for the `web` lane (for example 0060 to 0069; unused today).*
15. **What "the full check" means for the web lane.** Your rhythm says the full check once at the end of each stage. *Recommend: for the web lane that is the whole CI web job (five commands above) run by the agent; `make check` stays with lane A, run by you or A at the stages that touch security-tier files, before the merge. If you want `make check` at every stage end, then A or you run it, since the web lane may not start the stack.*
14. **Plan file location.** This plan lives in `docs/plans/`, which is shared between A and C by ticket coordination. *Recommend: you confirm it may sit there.*

---

## Appendix: facts checked (exact command output, read-only, 2026-10-07)

### Remote and branches
```
$ git remote -v
origin	https://github.com/gowthamde24/sme-ai.git (fetch)
origin	https://github.com/gowthamde24/sme-ai.git (push)
$ git rev-parse --abbrev-ref HEAD
web/landing
$ git rev-parse origin/main origin/web/landing web/landing
2fd595bbfbcd815ff72c1022fac8d15e55248d6d
667a97308a9f01214f80ad501e842a3957c0df88
667a97308a9f01214f80ad501e842a3957c0df88
$ counts
behind_origin_main=17 ahead_of_origin_main=26 ahead_of_origin_web_landing=0
$ git merge-base origin/main web/landing
a670c54f7b1550fd6cd973b65d9675af3c027ec8
$ git worktree list
/Users/gowthamreddys/Desktop/sme-ai             7a96df3 [followups-whatsapp]
/Users/gowthamreddys/Desktop/sme-ai-c           fc6595a [lane/c]
/Users/gowthamreddys/Desktop/sme-ai-quote-text  c5c52db [quote-text-joiners]
/Users/gowthamreddys/Desktop/sme-ai-web         667a973 [web/landing]
```

### What web/landing adds outside design-lab/ (three-dot)
```
$ git diff --name-only origin/main...web/landing | grep -v '^design-lab/' | sed 's#/[^/]*$##' | sort | uniq -c
  30 apps/web/src/app-shell-preview
  43 apps/web/src/design-system
  12 apps/web/src/office-preview
total_files_in_range=     196  design_lab_files=111
apps/web/src files at origin/main:        0
```

### Lane policy and guard
```
$ lanes at origin/main
['A', 'B', 'C', 'setup']
$ lane-paths.yml
1:name: Lane paths
11:    if: startsWith(github.head_ref, 'lane/')
21:      - name: Check ownership with the base commit's guard
23:          LANE_BRANCH: ${{ github.head_ref }}
32:          bash "$guard" "${LANE_BRANCH#lane/}" "$BASE_SHA"
```

### CI jobs (`.github/workflows/ci.yml` lines 12 to 46)
```
  packages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - run: make test-packages

  hygiene:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/check-no-leftovers.sh
      - run: python3 scripts/test-lanes.py

  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: apps/web/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npx tsc --noEmit -p ../../packages/contracts/tsconfig.json
      - run: npm test
      - run: npm run build
```

### apps/web package.json and root layout
```
scripts {'dev': 'next dev', 'build': 'next build', 'start': 'next start', 'lint': 'eslint .', 'typecheck': 'next typegen && tsc --noEmit', 'test': 'vitest run'}
deps {'@supabase/ssr': '^0.12.7', '@supabase/supabase-js': '^2.117.2', 'next': '16.3.8', 'react': '19.2.8', 'react-dom': '19.2.8'}
dev {'@testing-library/dom': '^10.4.2', '@testing-library/jest-dom': '^7.0.1', '@testing-library/react': '^16.3.3', '@types/node': '^22.20.5', '@types/react': '^19', '@types/react-dom': '^19', '@vitejs/plugin-react': '^6.1.1', 'eslint': '^9', 'eslint-config-next': '16.3.8', 'jsdom': '^29.1.1', 'typescript': '^5', 'vitest': '^5.0.3'}
$ root layout
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// A nonce-based CSP (proxy.ts) needs every page rendered per request: a prerendered page has no nonce for its scripts.
export const dynamic = "force-dynamic";

const geistSans = Geist({
6:export const dynamic = "force-dynamic";
```

### Next 16.3.8 docs on nonces and SRI, and where SRI is implemented
```
$ next docs (CSP)
38:Every time a page is viewed, a fresh nonce should be generated. This means that you **must use [dynamic rendering](/docs/app/glossary#dynamic-rendering) to add nonces**.
181:To use a nonce, your page must be **dynamically rendered**. This is because Next.js applies nonces during **server-side rendering**, based on the CSP header present in the request. Static pages are generated at build time, whe
397:- **Partial Prerendering (PPR) is incompatible** with nonce-based CSP since static shell scripts won't have access to the nonce
## Subresource Integrity (Experimental)

As an alternative to nonces, Next.js offers experimental support for hash-based CSP using Subresource Integrity (SRI). This approach allows you to maintain static generation while still having a strict CSP.

> **Good to know**: This feature is experimental and available in App Router applications.
534:### Limitations of SRI
535-
536-- **Experimental**: Feature may change or be removed
537-- **App Router only**: Not supported in Pages Router
538-- **Build-time only**: Cannot handle dynamically generated scripts

$ SRI implementation
1802:            !dev && isClient && !!((_config_experimental_sri1 = config.experimental.sri) == null ? void 0 : _config_experimental_sri1.algorithm) 
subresource-integrity-plugin.d.ts
subresource-integrity-plugin.js
subresource-integrity-plugin.js.map
$ default build command
7:    "build": "next build",
next.config.ts: no webpack/turbopack setting
```
(I did not prove whether Turbopack builds support SRI. The search for a Turbopack mention of SRI failed to run and is not evidence either way.)

### Real routes, styling, layouts (origin/main)
```
$ real routes at origin/main
app/page.tsx
app/security/page.tsx
app/tenants/[tenantId]/agents/page.tsx
app/tenants/[tenantId]/companies/[companyId]/page.tsx
app/tenants/[tenantId]/enquiries/[enquiryId]/page.tsx
app/tenants/[tenantId]/followups/page.tsx
app/tenants/[tenantId]/followups/policy/page.tsx
app/tenants/[tenantId]/leads/[leadId]/followup/page.tsx
app/tenants/[tenantId]/leads/[leadId]/page.tsx
app/tenants/[tenantId]/orders/[orderId]/page.tsx
app/tenants/[tenantId]/orders/page.tsx
app/tenants/[tenantId]/page.tsx
app/tenants/[tenantId]/price-list/page.tsx
app/tenants/[tenantId]/privacy/page.tsx
app/tenants/[tenantId]/requirements/[requirementId]/questions/page.tsx
app/tenants/[tenantId]/review/page.tsx
app/tenants/[tenantId]/suggestions/page.tsx
auth/confirm/page.tsx
auth/forgot/page.tsx
auth/mfa/page.tsx
auth/set-password/page.tsx
login/page.tsx
page.tsx
$ layout/loading/error files at origin/main
apps/web/app/layout.tsx
$ styling
     475 apps/web/app/globals.css
no tailwind in apps/web/package.json or globals.css
ls: apps/web/components: No such file or directory
```
(The first `app/page.tsx` and `app/security/page.tsx` lines are `app/app/page.tsx` and `app/app/security/page.tsx` shortened by the `sed` that strips `apps/web/app/`; the last `page.tsx` is `/`.)

### Class and element selectors (collision check) and icon count
```
$ class selectors defined in design-lab/src/index.css (web/landing):
.fade-enter .live-dot .office-bg .page-enter .pb-safe .pop-enter .sheet-enter .side-enter .skeleton .wave-bar 
$ class selectors in apps/web/app/globals.css (origin/main):
.badge .badge-bad .badge-good .badge-hidden .badge-low-priority .badge-maybe .badge-priority .badge-worth-reviewing .button-bad .button-good .button-maybe .card .card-compact .error .evidence-item .evidence-list .factor-breakdown .factor-item .factors-grid .hint .hint-block .notice .plain-text .quote-text .review-actions .review-card .review-card-header .row .shell .sticky-actions .summary .tabs .tap 
$ element selectors in apps/web globals.css (these also hit new pages):
15:* {
19:html,
20:body {
43:h1,
44:h2 {
74:button {
84:a.button {
95:button.secondary {
100:button:disabled {
115:table {
121:th,
122:td {
143:select {
$ lucide icons used in design-lab: 50 distinct
```

### Claude 1's branch and the handoff note
```
$ followups-whatsapp plan, the web files it edits
87:* `followups/`: `due-view.tsx` (a row shows the channels and links to the default channel), `lead-followup-view.tsx` (tabs, the other-channel draft line), `create-draft-form.tsx` (a fixed channel), `touch-form.tsx` (a default channel), `followup-logic.ts` (helpers), the lead page (an optional channel).
136:The cadence engine (pinned 1.0.0), the blocker, the request builder, the replay and gate-first rules, every migration, the templates, sending (nothing is added that sends), the suppression-key scr...  [line 136 also contains "design v2 is its own ticket"; cut at 200 characters by the command]
7a96df3 docs: plan for WhatsApp as a first-class channel in the follow-up screens
$ handoff
**Web** (plain screens, no design work: the design v2 port is its own ticket): the lead's follow-up page, the due list, the policy page, the question drafts of a requirement, entry links from the workspace home, the lead and the requirement panel. One strings module (one fixed sentence per refusal; never the server's text); logic apart from markup; no field 
```

### design-lab size and dependencies, i18n status
```
$ design-lab deps
deps {'@fontsource-variable/bricolage-grotesque': '5.3.0', '@fontsource-variable/noto-sans-devanagari': '5.3.0', '@fontsource-variable/noto-sans-kannada': '5.3.0', '@fontsource-variable/noto-sans-telugu': '5.3.0', '@fontsource-variable/plus-jakarta-sans': '5.3.0', '@radix-ui/react-dialog': '1.1.6', '@react-three/drei': '10.7.9', '@react-three/fiber': '9.8.1', 'clsx': '2.1.1', 'lucide-react': '1.16.0', 'react': '19.0.0', 'react-dom': '19.0.0', 'tailwind-merge': '3.0.2', 'three': '0.186.1'}
dev {'@tailwindcss/vite': '4.0.9', '@types/node': '22.13.5', '@types/react': '19.0.10', '@types/react-dom': '19.0.4', '@types/three': '0.186.0', '@vitejs/plugin-react': '4.3.4', 'tailwindcss': '4.0.9', 'typescript': '5.7.3', 'vite': '6.4.4', 'vitest': '5.0.3'}
$ design-lab size
src files (non-test): 70
    9272 total
className= lines:      757
$ i18n status
i18n review status (draft = machine-written, owner has not confirmed it yet):
  Telugu     545 draft,     0 reviewed,   545 total
  Hindi      544 draft,     0 reviewed,   544 total
  Kannada    544 draft,     0 reviewed,   544 total
  (PUBLIC_LAUNCH_REQUIRES_REVIEWED is not set, so drafts do not fail the build.)
```

### Per-group line counts of the 85 preview files (from the earlier listing; produced with `git show web/landing:<file> | wc -l`)
design-system 43 files, 3,950 lines (13 CSS modules, 5 tests); app-shell-preview 30 files, 6,330 lines (7 CSS modules, 4 tests); office-preview 12 files, 1,332 lines (3 CSS modules, 1 test). The invented names in `app-shell-preview/fixtures.ts` include "Sample Textiles Hub (Surat)" and "Sample Saree Palace (Dharmavaram)".

### Legacy CSS facts used in section 3.2 (origin/main)
```
$ important in globals.css: 0
$ @layer in globals.css: 0
$ CSS files imported by app code:
origin/main:apps/web/app/layout.tsx:3:import "./globals.css";
```
