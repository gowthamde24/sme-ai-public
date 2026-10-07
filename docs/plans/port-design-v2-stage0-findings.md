# Port design v2: Stage 0 findings (two spikes, with numbers)

Date: 2026-10-07. Branch: `web/port-design-v2` (from `origin/main` 2fd595b). Plan: `docs/plans/port-design-v2.md`. ADR draft: `docs/adr/0060-design-v2-port-styling-and-public-page-rendering.md`.

**What this is.** Two throwaway spikes in a local branch `spike/stage0` (commits 4bf1215 and b474f2d, **never pushed, never merged**; the spike routes `app/spike-*`, the `proxy.ts` and `next.config.ts` switches and `postcss.config.mjs` live only there). Only these findings and the ADR draft are committed to the port branch. `package.json` and `package-lock.json` were **not** changed: Tailwind was installed with `npm install --no-save` (`git status` clean for both files). Next 16.3.8, Turbopack unless stated, Node 22.12.0, Chrome headless over the DevTools Protocol (a small harness of Node's built-in `fetch`, `WebSocket` and `zlib`; no dependency). The harness started only `next start` on port 4175 and one Chrome on 9335, by PID; it never touched ports 3000, 8000 or 54321 and no Supabase.

**Answers in one paragraph.**
* **Q3 (static pages vs the CSP): proven within the time box.** A prerendered page works under a strict CSP if the CSP lists the SHA-256 of each inline script of that page (`script-src 'self' 'sha256-...'`). The hashes are computed from the build output and read by the proxy. Today's nonce CSP breaks every prerendered page (12 violations, no hydration). Next's experimental SRI works in both bundlers but **does not remove the inline-script problem**, so it is not needed. The fallback (public pages dynamic with the nonce CSP) works too and costs no CSP change.
* **Q2 (styling): Tailwind v4 with the `important` flag plus a scoped reset removes every override of a v2 style by the legacy CSS (65 override leaks down to 0) without editing `globals.css`.** Wrapping `globals.css` in a cascade layer also works (65 down to 1). CSS Modules leave 2 override leaks (pseudo-class specificity). Recommendation: Tailwind with `important` and the scoped reset.
* **Q9 (JS budget): the measured baseline of an empty Next route is 177,009 bytes gzip (9 scripts); baseline + 40 KB is about 217 KB gzip.**

Corrections to my plan (it said these were unproven): SRI is **not** webpack-only (it builds and writes `integrity` attributes under Turbopack too); removing `force-dynamic` from the root layout also makes `/auth/forgot` and `/_not-found` static; a static login shell with `useSearchParams` works.

---

## Spike A: static pages versus the nonce CSP

### A.1 Baseline (the app as it is on `origin/main`)
`npm run build`: Turbopack, **every route dynamic (ƒ)**, because `app/layout.tsx` exports `dynamic = "force-dynamic"`. Route `/` (the placeholder page, no client code of its own):

```
htmlBytes 6237, scripts 9, raw JS 575,113 B, gzip JS 177,009 B, inline scripts 2 (4,221 B)
CSP: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; ...
cache-control: private, no-cache, no-store, max-age=0, must-revalidate
script tags carrying a nonce: 11; CSP violations in Chrome: 0
```

### A.2 Which route is static?
| Variant (all Turbopack) | Route table | Result |
|---|---|---|
| v1: as is | `/` ƒ, `/login` ƒ, `/spike-a` ƒ | all dynamic |
| v2: `export const dynamic = "force-static"` on the page, layout still `force-dynamic` | `/spike-a` ƒ | **the layout wins; a page cannot opt out** |
| v3: `force-dynamic` removed from the root layout | `/` ○, `/spike-a` ○, `/login` ƒ (reads searchParams) | pages with no dynamic API become static |
| v4: v3 + `experimental.sri` (Turbopack) | same; build prints `· sri` | builds |
| v5: v3 + `experimental.sri` + `next build --webpack` | same | builds |

Side effect of v3 found in a later build: **`/auth/forgot` and `/_not-found` also become static** (○). Both would break under today's nonce policy (see A.3). Adding `export const dynamic = "force-dynamic"` to `app/not-found.tsx` makes `/_not-found` dynamic again (v9: `ƒ /_not-found`).

### A.3 The same static page under four CSP policies (spike route `/spike-a`: a server page plus a client button)
Measured in Chrome: did React hydrate (a `useEffect` marks `<html data-hydrated>` and a click increments a counter), and how many CSP violations.

| Build | Policy sent for the page | Hydrated | CSP violations |
|---|---|---|---|
| v1 dynamic | today's nonce policy | yes (`clicks: 1`) | 0 |
| v3 static | **today's nonce policy** (what `proxy.ts` sends now) | **no** | **12** (10 external chunks, 2 inline) |
| v3 static | `script-src 'self'` only | no | 2 (the two inline scripts) |
| v3 static | `script-src 'self' 'sha256-A' 'sha256-B'` (hashes of the page's 2 inline scripts) | **yes** | **0** |
| v3 static | no CSP | yes | 0 |
| v4 SRI + Turbopack | `script-src 'self'` | no | 2 (inline) |
| v4 SRI + Turbopack | hashes | yes | 0 |
| v5 SRI + webpack | `script-src 'self'` | no | 2 (inline) |
| v5 SRI + webpack | hashes | yes | 0 |

* `integrity` attributes written: **8** (Turbopack, 10 external scripts) and **6** (webpack, 8 external scripts). SRI works in both bundlers in 16.3.8, but the two **inline** scripts (Next's bootstrap and the page's flight data) are untouched by it, so `script-src 'self'` still blocks them. SRI is therefore **not the solution**; the hash list is.
* Static HTML has **0 `<style>` elements and 1 `<link rel="stylesheet">`**, so `style-src 'self'` (plus the existing `style-src-attr 'unsafe-inline'`) is enough for static pages.

### A.4 Delivering the hashes (the part that has to be built)
The hashes exist only after `next build`, so the proxy reads a small manifest written by a post-build step. Prototype (about 15 lines, run after the build): for every route in `prerender-manifest.json`, read `server/app/<route>.html`, take every `<script>` without `src`, SHA-256 its text, base64, and write `{ "/route": ["'sha256-…'", ...] }`. Result for the spike build: `routes hashed: /, /_global-error, /_not-found, /auth/forgot, /spike-a, /spike-a2, /spike-login | hashes per route: 2,2,2,2,2,3,2`.

`proxy.ts` (Node runtime, `readFileSync`, spike only) set `script-src 'self' <that route's hashes>` plus a production-like policy (`style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`).

| Route (v8 build, hashes read from the file at request time) | Hydrated | CSP violations |
|---|---|---|
| `/spike-a` | yes | 0 |
| `/spike-a2` (adds a **constant inline theme script**) | yes | 0 |
| `/spike-login?next=/app/y` | yes | 0 |
| `/does-not-exist` (static `_not-found` under the nonce policy) | **no** | **11** |

Three more facts from the spike:
* **A constant pre-paint theme script works.** On `/spike-a2` the script ran before hydration (`data-theme` was `dark` from `localStorage`), so static pages can have no theme flash; its hash is the same on every build.
* **A static login shell works.** `/spike-login` (a static server page, the `searchParams` read moved into a client island inside `<Suspense>`) is `○`, the HTML contains the fallback text, and after hydration the island read `?next=/app/x`.
* **Hashes differ per page and per build.** Across three static pages: 7 inline scripts, **5 distinct hashes**; one script (the bootstrap) is shared. So the manifest must be regenerated by every build.

### A.5 Numbers for Q9 and for Q3's cost
* **JS baseline of an empty route:** `/` dynamic 177,009 B gzip (575,113 B raw, 9 scripts); `/spike-a` static Turbopack 177,196 B and 177,300 B (two builds, 10 scripts); dynamic 177,300 B; **webpack 174,134 B** (8 scripts). **Budget = baseline + 40 KB: about 217 KB gzip** for the scripts a page references. (design-lab's 100 KB budget is not reachable on Next: the framework alone is 177 KB.)
* **Response headers:** static `cache-control: s-maxage=31536000` (CDN-cacheable, `x-nextjs-cache: HIT`); dynamic `private, no-cache, no-store, max-age=0, must-revalidate`.
* **Local response time** (loopback, 60 requests, trivial page): static median 2.8 ms (p90 5.4); dynamic median 3.5 ms (p90 7.0). Not representative of production; it only shows dynamic rendering of a light page is cheap. The real difference is CDN caching.
* **`getSupabasePublicConfig()` throws if the public Supabase variables are missing**, and the proxy calls it for `/login`, `/auth/*` and `/app/*`. Those routes cannot be served, so cannot be screenshotted, without that configuration; the landing (`/`) needs none.

### A.6 Conclusion and recommendation for Q3
**Static is proven.** Recommended production design (a **separate, small proposal for the owner and Claude 1**, because it touches security-tier files and is not a styling commit):
1. A post-build step writes the hash manifest; `npm run build` runs it (and a test fails if it is missing).
2. `proxy.ts` chooses the policy by lookup: **if the request path is in the manifest, send the hash policy; otherwise send today's nonce policy.** Self-correcting: any route that becomes static is covered; any dynamic route keeps the nonce.
3. Move `force-dynamic` off the root layout (it stays on `/app`, `/login` until converted, and on `not-found.tsx`). Without step 2, `/auth/forgot` would break.
4. Tests: `csp.test.ts` and `proxy.test.ts` extended (hash policy only for manifest routes; fail closed if the manifest is missing; no `'unsafe-inline'` for scripts).
5. Hosting check before T012: the proxy reads a build artifact at run time. That works for `next start` and a container; it must be verified on the chosen host.

Risks: the manifest must exist at run time; only Chrome was tested (no Safari or Firefox); `next dev` was not tested (dev needs its own relaxed policy); the 404 page needs `force-dynamic` in `not-found.tsx`.

**If you prefer no CSP change at all:** keep the nonce policy and render the public pages dynamically. Measured cost: the same JS (177.3 KB vs 177.2 KB gzip), about 0.7 ms more locally, and no CDN caching. It needs no proxy change. This is the fallback you named; it is no longer needed to make static work, only to avoid a security-tier change.

---

## Spike B: Tailwind v4 next to the unlayered legacy CSS

### B.1 Setup
`tailwindcss` **4.3.3** and `@tailwindcss/postcss` **4.3.3** (`postcss` 8.5.23 was already installed through Next), `npm install --no-save`, plus a throwaway `postcss.config.mjs` with the `@tailwindcss/postcss` plugin. (design-lab uses 4.0.9, so a few utility names may differ; not tested.) npm printed "added 15 packages, and removed 1 package" and two pre-existing `EBADENGINE` warnings (jsdom, eslint-visitor-keys); I did not identify the removed package. The build passes with the plugin active for every stylesheet.

* **The legacy stylesheet is byte-identical with the plugin on.** `globals.css` compiles to one 9,370-byte chunk; sha256 starts `d294772c84e3d0d8` with and without the plugin (`cmp`: byte-identical). Adding Tailwind does not change what the existing pages receive.
* **CSS is route-scoped.** `/` (legacy) loads only the legacy chunk; a v2 page loads the legacy chunk plus its own file (two separate sheets). After a **client-side navigation** from a v2 page to `/` the v2 stylesheet stays in the DOM, but the legacy `h1` has the identical computed style (`32px | 12px | 700 | rgb(17, 24, 39)`) because the v2 CSS has no global element selectors.
* Tailwind emits only the theme variables a page uses (e.g. `--color-white`, `--spacing`, `--text-xl` in `@layer theme`) and a `@layer properties` rule setting `--tw-*` custom properties on `*, :before, :after, ::backdrop`; no visual effect.

### B.2 The `important` flag works in this version
`@import "tailwindcss/utilities.css" layer(utilities) important source(none);` produced **32 `!important` declarations** in the compiled v2 sheet (0 without the flag), e.g. `.m-0{margin:0!important}`, `.rounded-v2{border-radius:12px!important}`. Tokens: `@theme inline { --color-v2-brand: var(--v2-brand); ... }` with `--v2-*` defined only under `[data-ui="v2"]`, so tokens do not reach legacy pages.

### B.3 The audit prototype (the Stage 1 test, prototyped)
`leak-audit` (Chrome over CDP): on a v2 page it takes the computed value of every property for every element inside `[data-ui="v2"]`, disables the legacy stylesheet (`sheet.disabled = true`; found as the sheet containing `.shell` and `.card`), takes them again, and reports differences in two classes:
* **OVERRIDE leak**: a property the v2 sheet itself declares for that element, but whose value changes when the legacy sheet is off, i.e. **a legacy rule overrides a v2 style. Must be 0.**
* **BASE leak**: a property the legacy sheet declares (103 distinct non-custom properties) whose value on a v2 element changes when the legacy sheet is off, i.e. legacy defaults seeping in. Handled by the scoped reset; benign residue allowed.
Custom properties (`--*`) are ignored, and border colour/style are ignored when the border width is 0. Probe: 10 elements (root, `h1`, `h2`, two `button`s (one disabled), `a.button`, `select`, `table`, `th`, `td`) using the legacy element selectors that matter.

| Page | Styling | Legacy `globals.css` | Override leaks | Base leaks |
|---|---|---|---|---|
| b0 | Tailwind, layered, **no** important, no reset | unchanged | **65** | 55 |
| b1 | Tailwind, layered, **important**, no reset | unchanged | **1** | 43 |
| b4 | CSS Modules | unchanged | **2** | 43 |
| **b5** | **Tailwind, important + scoped reset** | **unchanged** | **0** | **3** |
| b6 | Tailwind, no important, reset in `@layer base` | unchanged | 90 | 23 |
| b0 | Tailwind, layered, no important | **wrapped in `@layer legacy`** | **1** | 43 |
| b1 | Tailwind, important | wrapped | 1 | 43 |
| b5 | important + scoped reset | wrapped | 0 | 3 |

Reading the table:
* **The risk is real.** Without a mitigation (b0) the legacy `button`, `table`, `select` and `h1, h2` rules override 65 v2 declarations; for instance the v2 button background comes out as the legacy `rgb(17, 24, 39)` instead of the brand orange.
* **`important` alone** (b1) leaves 1: the table's used width, changed by the legacy `border-collapse: collapse`, which v2 does not declare. The scoped reset removes it (b5: **0**).
* **b5 is the recommended Stage 1 mechanism.** The 3 base leaks that remain are `width` of the root, `h1` and `h2`, caused by the legacy `html, body { margin: 0 }` (the UA default body margin would otherwise be 8px); benign and allow-listed.
* **b6 shows why a layered reset cannot work** next to unlayered legacy CSS (90 leaks): any rule inside a layer loses to unlayered legacy rules. (In the wrapped build b6 is also affected by layer order from import order; the layer order must be declared explicitly: `@layer legacy, theme, base, components, utilities;`.)
* **Wrapping `globals.css` in a layer** (the alternative) also works (65 → 1, then 0 with the reset) and needs no `!important`, but it edits a lane-B-exclusive file (approval first, one edit) and relies on the explicit layer-order line. Not needed.
* **CSS Modules** (b4) leave 2 override leaks: `button:disabled` (specificity 0,1,1) beats a module class (0,1,0), so the disabled button keeps the legacy `cursor: progress`; and the table width as above. Fixable with extra selectors but it is the same class of problem, plus a hand rewrite of design-lab's 757 `className` lines.

### B.4 Cost of option A (`important`)
Utilities cannot be overridden by ordinary CSS **or by an inline `style="..."` attribute** (inline normal declarations lose to `!important`). So v2 components must express all styling as classes, must not mix CSS Modules and utilities on the same element, and must not reuse legacy class names (`.card .row .shell .hint .error .tabs .tap .badge ...`). The Stage 1 audit includes a source check for the last rule.

### B.5 Conclusion and recommendation for Q2
**Tailwind v4 (4.3.3) with the `important` flag, tokens scoped under `[data-ui="v2"]`, no Tailwind preflight, and the scoped reset; plus the leak audit as a failing test.** It needs no edit to `globals.css`, so decision 5 stays untouched, and it measured 0 override leaks. Fallback if a later stage finds `!important` unworkable: wrap `globals.css` in `@layer legacy` with an explicit order line (one approved edit), or CSS Modules. **Dependencies for Stage 1 (needs your "deps ok" at that point):** `tailwindcss` and `@tailwindcss/postcss` (4.3.3 tested), nothing else; `postcss` is already present.

---

## Limits of this evidence
* Chrome only (no Safari, Firefox, mobile browsers); production builds only (`next dev` untested); loopback timings.
* Tailwind 4.3.3 was tested, not 4.0.9 (design-lab's version); utility names between them can differ.
* The probe has 10 elements; the Stage 1 audit must run on real v2 pages.
* The hash manifest was prototyped with a spike proxy, not with the real `proxy.ts`/`csp.ts`; their tests were not touched.
* I did not test client-side navigation between two static pages with different hash policies (the hashes apply to the document request; soft navigations load RSC payloads, not new documents).
* Hosting: the proxy's run-time read of a build file is untested on any host other than `next start` on this machine.

## How to reproduce
The spike branch `spike/stage0` (local) holds the routes and switches. Builds used `SPIKE_DIST=.next-<name>` (a `distDir` switch), CSP modes `SPIKE_CSP=nonce|self|hash|hashfile|none`, and `SPIKE_SRI=1`. The harness (`lib.mjs`, `a1.mjs` to `a4.mjs`, `leak-audit2.mjs`, `nav.mjs`, `csp-hashes.mjs`) is in the session scratchpad and is not committed; the algorithms are described above in enough detail to recreate them in Stage 1, where the audit and the hash manifest become real, tested scripts.
