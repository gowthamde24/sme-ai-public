# ADR 0060: Design v2 port: how v2 styles live next to the legacy CSS, and how the public pages are rendered

Status: **DRAFT, proposed by Stage 0 of the port (2026-10-07); not accepted.** The owner decides Q2 and Q3 from `docs/plans/port-design-v2-stage0-findings.md`. Related: `docs/plans/port-design-v2.md` (the plan and the owner's 15 answers), ADR 0016 (the nonce-based CSP), AGENTS.md and `docs/lanes.md` (lane paths). ADR numbers 0060 to 0069 are reserved for this port.

## Context
`design-lab/` (a Vite SPA, reference only) holds design v2 and a landing and sign-in page. `apps/web` is the real Next.js 16.3.8 app. Two facts block a straight port:
1. **The legacy stylesheet** `app/globals.css` (475 lines, unlayered, owned by lane B, loaded by the root layout for every route) has element rules (`button`, `table`, `select`, `h1, h2`, `html, body`, `*`). Unlayered CSS beats layered CSS, so Tailwind utilities lose to it. Measured: 65 of a v2 probe's declarations were overridden.
2. **The CSP uses a per-request nonce** (`proxy.ts`, `lib/security/csp.ts`), which forces every page to render dynamically (`dynamic = "force-dynamic"` in the root layout). A prerendered page has no nonce. Measured: under today's policy a prerendered page does not hydrate (12 violations).

## Decisions (proposed)
**1. Styling: Tailwind v4 with the `important` flag, tokens scoped under `[data-ui="v2"]`, no Tailwind preflight, and a scoped reset.** The v2 stylesheet contains no global element selectors; a wrapper component sets `data-ui="v2"` and loads the v2 stylesheet, so only pages that opt in receive it. `globals.css` is not edited. A **leak audit** (headless Chrome: computed styles inside `[data-ui="v2"]` with and without the legacy sheet) is a failing test: **override leaks must be 0**, base leaks limited to an allow-list. v2 code must not use legacy class names and must not mix CSS Modules or inline `style` with utilities on one element. Evidence: override leaks 65 → 0 (Tailwind 4.3.3, Turbopack); the legacy stylesheet compiles byte-identical with the PostCSS plugin on. Dependencies at Stage 1, each needing the owner's "deps ok": `tailwindcss`, `@tailwindcss/postcss`.
*Fallbacks if A proves unworkable:* wrap `globals.css` in `@layer legacy` with an explicit `@layer legacy, theme, base, components, utilities;` line (one edit to a lane-B file, approved first); or CSS Modules (2 override leaks remained in the spike).

**2. Public pages (landing now; the login shell later) are statically prerendered, with a hash-based CSP.** The post-build step hashes every inline script of every prerendered page into a manifest; the proxy sends `script-src 'self' <that page's hashes>` for paths in the manifest and today's nonce policy for all others (self-correcting). `force-dynamic` moves off the root layout (kept on `not-found.tsx`; `/app` and `/login` stay dynamic until converted). SRI is **not** adopted (it does not cover inline scripts). Evidence: static pages hydrated with 0 violations under the hash policy, with a constant pre-paint theme script and a static login shell using a `useSearchParams` island.
*Fallback (owner's answer 3):* keep the nonce policy and render the public pages dynamically; measured to cost the same JS and no CDN caching, and no CSP change.

**3. Branch and review.** Branch `web/port-design-v2`; the lane guard is advisory (no `web` lane, no branch protection). At every STOP the report shows the exact output of `git diff --stat origin/main...web/port-design-v2 -- .github lanes.json AGENTS.md CLAUDE.md docs/lanes.md scripts Makefile` (must be empty) and the changed paths checked against the expected-paths table in the plan.

**4. Separate proposals, never part of a styling commit.** Any change to `proxy.ts`, `lib/security/csp.ts`, `next.config.ts`, the root layout, the build script, or auth/login logic is a small proposal to the owner and Claude 1. For decision 2 that proposal is: the manifest step, the proxy lookup, the layout change, the `not-found` change and the extended CSP and proxy tests.

**5. JS budget.** Baseline of an empty route measured at 177,009 B gzip; the budget for a public page is baseline + 40 KB, about 217 KB gzip.

## Consequences
* v2 pages are isolated from legacy pages in both directions (the audit proves it); the old screens, including follow-ups, are not restyled.
* Utilities are `!important`: components style by class only.
* Static pages depend on a build artifact read at run time by the proxy: fine for `next start` and a container, to be verified on the chosen host before T012. If the manifest is missing, static pages are not interactive (the proxy test fails closed).
* Only Chrome was tested; Safari and Firefox must be checked at Stage 2.

## Not decided here
Icons (`lucide-react` needs "deps ok" at Stage 2); the 3D dependencies (Stage 10); how server messages on auth pages are localised (A decides); whether the 3D office ships in v1 (owner, Stage 10).
