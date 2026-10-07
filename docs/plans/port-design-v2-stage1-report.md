# Port design v2: Stage 1 report (tokens, fonts, i18n store, leak audit; invisible)

Date: 2026-10-07. Branch `web/port-design-v2`. Owner decisions applied: Tailwind v4 with the `important` flag, tokens scoped under `[data-ui="v2"]`, no preflight, a scoped reset, `globals.css` untouched; public pages stay dynamic under today's nonce CSP; no change to `proxy.ts`, `csp.ts`, `next.config.ts`, the root layout or the `build` script. Nothing in a real route imports any of this.

## What was added (all under `apps/web`)
* `postcss.config.mjs`, `design/{tokens.css,reset.css,v2.css,fonts.ts}`, `components/v2/V2Root.tsx` (+ test).
* `i18n/{lang.ts,STYLE.md,review/i18n-glossary.csv,strings/{index.ts,landing.json,login.json,strings.test.ts}}`, `scripts/i18n-{status,export,import}.mjs`, `scripts/lib/i18n-data.mjs` (+ test).
* `scripts/contrast.mjs` (+ `lib/contrast.mjs`, test), and the leak audit: `scripts/audit-leaks.mjs`, `scripts/lib/{chrome,leak-audit,source-check}.mjs`, `scripts/audit/probe.html`, `source-check.test.ts`.
* `package.json`: the two exact devDependencies and six new scripts (`audit:leaks`, `audit:contrast`, `i18n:status`, `i18n:export`, `i18n:first-pass`, `i18n:import`). The `build` script is unchanged.

## Existing pages are unchanged (proof)
The web lane may not start Supabase or use ports 3000/8000/54321, so the snapshots use dummy public settings (`https://example.invalid`, never contacted) and `next start` on port 4175. Ten requests, before and after, with the per-request nonce and the build id normalised (two builds of the same code give identical normalised snapshots, checked first):

| Request | Status | Same before and after |
|---|---|---|
| `/login`, `/login?next=/app/x&notice=reset` | 200, 200 | yes (status, selected headers, full HTML) |
| `/`, `/does-not-exist` (the 404 page) | 200, 404 | yes |
| `/auth/forgot`, `/auth/confirm` | 200, 200 | yes |
| `/app`, `/app/tenants/<uuid>`, `/auth/mfa`, `/auth/set-password` (no session) | 307 | yes |

Also identical: the list of **every emitted css and js file with its sha256** (34 files, one css file), so every real route receives byte-identical JavaScript and CSS. **Limit:** an authenticated `/app` page cannot be rendered without a session; its components are covered by the existing tests in the CI web job (which pass) and by the identical JavaScript chunks above.

## Leak audit numbers (`npm run audit:leaks`)
Source check: 2 v2 source files, 38 legacy class names, 0 violations. Detector self-test: ok (4 of 4). Fixture audit (real legacy CSS + real compiled v2 CSS + a 16-element probe):

| Scheme | Elements | OVERRIDE leaks | SHADOWED utilities | BASE leaks outside allow-list | Allow-listed derived values |
|---|---|---|---|---|---|
| light | 16 | 0 | 0 | 0 | 6 |
| dark | 16 | 0 | 0 | 0 | 6 |

Allow-list (base leaks only): `width, height, inline-size, block-size, perspective-origin, transform-origin`, all derived from the legacy `html, body { margin: 0 }`. Four mutants were killed: utilities without `important` (68 shadowed utilities), no scoped reset (1 override leak, 52 base leaks), a legacy class and an inline style in `V2Root` (2 source violations), a global selector in `reset.css` (1 source violation). The audit found one real defect while it was written: a font stack built from undefined `var()`s makes the whole `font-family` invalid and silently hands the font back to the legacy sheet; every `var()` now has a fallback. It also found its own blind spot: with non-`important` utilities the v2 reset beat them and the legacy-on/off comparison saw no difference; the SHADOWED check closes that.

## Build with a v2 route (temporary canary, not committed)
A temporary route using `V2Root` was built and loaded in Chrome under today's nonce CSP, then removed: **0 CSP violations**; the button got `rgb(255, 119, 60)` (the brand token) with the on-brand text colour and a 12px radius; the legacy `body` kept `rgb(255, 255, 255)`; the v2 stylesheet (19 `!important`, tokens present) was a separate file from the legacy one (9,370 bytes, unchanged, no `!important`); the build emitted the five font families (the Indic ones declared per script; only the faces for the scripts on the page loaded). The build fetched those families from Google Fonts, as it already does for Geist.

## i18n status
Telugu 175 draft, 0 reviewed; Hindi 175 draft, 0 reviewed; Kannada 175 draft, 0 reviewed (landing 142 + login 37 keys; the design-lab-only `lab.*` and `ok.*` strings were not carried). The `PUBLIC_LAUNCH_REQUIRES_REVIEWED` wiring into `build` is a proposal for later.

## Lockfile: every package added, removed or changed against `origin/main`
`package.json` gains exactly `"@tailwindcss/postcss": "4.3.3"` and `"tailwindcss": "4.3.3"` (no caret). The first `npm install` produced a lockfile that `npm ci` **rejected** ("lock file's @emnapi/wasi-threads@1.2.1 does not satisfy @emnapi/wasi-threads@1.2.3; Missing @emnapi/core@1.10.0 from lock file"); a second `npm install` repaired it, and `npm ci` then succeeded (456 packages). The committed lockfile:

```
ADDED 36
  + @alloc/quick-lru 5.3.0 dev 
  + @tailwindcss/node 4.3.3 dev 
  + @tailwindcss/node/lightningcss 1.32.0 dev 
  + @tailwindcss/node/lightningcss-android-arm64 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-darwin-arm64 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-darwin-x64 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-freebsd-x64 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-linux-arm-gnueabihf 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-linux-arm64-gnu 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-linux-arm64-musl 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-linux-x64-gnu 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-linux-x64-musl 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-win32-arm64-msvc 1.32.0 dev optional
  + @tailwindcss/node/lightningcss-win32-x64-msvc 1.32.0 dev optional
  + @tailwindcss/node/magic-string 0.30.21 dev 
  + @tailwindcss/oxide 4.3.3 dev 
  + @tailwindcss/oxide-android-arm64 4.3.3 dev optional
  + @tailwindcss/oxide-darwin-arm64 4.3.3 dev optional
  + @tailwindcss/oxide-darwin-x64 4.3.3 dev optional
  + @tailwindcss/oxide-freebsd-x64 4.3.3 dev optional
  + @tailwindcss/oxide-linux-arm-gnueabihf 4.3.3 dev optional
  + @tailwindcss/oxide-linux-arm64-gnu 4.3.3 dev optional
  + @tailwindcss/oxide-linux-arm64-musl 4.3.3 dev optional
  + @tailwindcss/oxide-linux-x64-gnu 4.3.3 dev optional
  + @tailwindcss/oxide-linux-x64-musl 4.3.3 dev optional
  + @tailwindcss/oxide-wasm32-wasi 4.3.3 dev optional
  + @tailwindcss/oxide-win32-arm64-msvc 4.3.3 dev optional
  + @tailwindcss/oxide-win32-x64-msvc 4.3.3 dev optional
  + @tailwindcss/postcss 4.3.3 dev 
  + @unrs/resolver-binding-wasm32-wasi/@emnapi/core 1.10.0 dev optional
  + @unrs/resolver-binding-wasm32-wasi/@emnapi/wasi-threads 1.2.1 dev optional
  + enhanced-resolve 5.26.0 dev 
  + graceful-fs 4.2.11 dev 
  + jiti 2.7.0 dev 
  + tailwindcss 4.3.3 dev 
  + tapable 2.3.3 dev 
REMOVED 2
  - @emnapi/core 1.10.0
  - @emnapi/runtime 1.11.3
CHANGED 2
  ~ @emnapi/wasi-threads ('1.2.1', True, True, False) -> ('1.2.3', True, True, False)
  ~ eslint-plugin-import ('2.32.0', True, False, False) -> ('2.32.0', True, False, True)
```

* The "removed 1 package" seen in Stage 0 was **`@emnapi/runtime@1.11.3`**: it was the only package that disappeared from `node_modules`. The lock also drops `@emnapi/core` 1.10.0, which is optional, wasm-only and was never installed on this machine. `@tailwindcss/oxide-wasm32-wasi` now bundles its own `@emnapi/*` copies, and npm re-resolved the optional wasm tree: nested copies of `@emnapi/core` 1.10.0 and `@emnapi/wasi-threads` 1.2.1 appear under `@unrs/resolver-binding-wasm32-wasi`, and the top-level optional `@emnapi/wasi-threads` moves to 1.2.3.
* `eslint-plugin-import` 2.32.0 only gains the metadata flag `peer: true` (no version change).
* Platform binaries (`@tailwindcss/oxide-*`, `lightningcss-*`) are optional: `npm ci` installs only the one for the machine.
* `npm ls` already reported `extraneous` wasm packages before this change (`@emnapi/runtime`, `@img/sharp-wasm32`); it now reports `@img/sharp-wasm32`, `@napi-rs/wasm-runtime` and `@tybys/wasm-util`. All wasm32-only, never loaded on a normal machine.
* **Not verified:** CI uses Node 22.13.0 (`.nvmrc`) and therefore npm 10.x; this lockfile was written and checked with npm 11.6.2 on Node 22.12.0.
