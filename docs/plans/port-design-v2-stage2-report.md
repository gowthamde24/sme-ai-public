# Design v2 port, Stage 2 report: the public landing page at `/landing`

Status: **built, committed locally on `web/port-stage2`, nothing pushed.** Plan: `docs/plans/port-design-v2-stage2-plan.md`. ADR 0060 still governs (dynamic rendering under the nonce CSP, Tailwind with `important`, scoped tokens). The route is **`/landing`; `/` is not flipped** (owner decision 1, waits for approval). Every number below comes from a command run in this stage (raw lines in section 5).

## 1. What exists now

* `GET /landing`: the whole public page in English, Telugu, Hindi and Kannada, light and dark: header (language select, theme button, "Sign in" to `/login`), hero with the self-starting six-step flow, the problem, how it works, "you stay in control", the team, languages, privacy, early access (a "coming soon" placeholder that sends and saves nothing), FAQ, footer (privacy, terms, contact as plain text labelled "(placeholder)").
* Language and theme come from two functional cookies, `sme_lang` and `sme_theme` (Path=/, SameSite=Lax, one year, Secure only on https, values allow-listed on the server). No pre-paint script, no `localStorage`. `<html lang>` stays `en` (decision 6); the page's own wrapper carries the content language.
* Metadata: localized plain title and description, `robots: noindex, nofollow`, Open Graph without an image, **no JSON-LD** (decision 5).
* The brand name is one constant (`design/brand.ts`, "Sme-AI (working name)"); renaming is one edit, proven by a test with a mocked module.
* All copy is in the string store (`i18n/strings/landing.json`, 142 keys x 4 languages). **Every te/hi/kn string is still a machine-written draft** (`i18n:status`: 175 draft, 0 reviewed per language, including the shared strings). The owner's review loop from the earlier work is unchanged.
* Nothing on the page is real data: the flow's figures are made up and labelled "Example, not real data".

To look at it: `cd apps/web && npm run build && npm start`, then open `http://localhost:3000/landing` (dummy `NEXT_PUBLIC_SUPABASE_*` values are enough; the page makes no Supabase call).

## 2. How it is built (what a reviewer should know)

* **Server components for everything except four small client islands** (`LangSelect`, `ThemeButton`, `Flow`, `EarlyAccess`). Strings reach the islands as props, so the four dictionaries never enter the browser bundle (a test guards this).
* **Flow** renders both layouts (laptop strip and phone swipe row); CSS shows one; the one that is not displayed never plays (IntersectionObserver). Classes only, no inline styles.
* **Styling**: Tailwind utilities (all `!important`), tokens under `[data-ui="v2"]`. The scoped reset (`design/reset.css`) is now the equivalent of Tailwind's preflight (margins, list bullets, block images and svgs, form-control inheritance). Without it every block measured 16 to 40 px taller than in design-lab. With it the hero lands on design-lab's numbers.
* **Not touched** (empty diff, section 5.8): `proxy.ts`, `lib/security/*`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/login/*`, `app/auth/*`, `followups/**`, and every guarded repository file.

## 3. Deviations from the stage 2 plan (and why)

| Plan | Built | Why |
|---|---|---|
| `components/v2/icons.tsx` with inline SVG | `lucide-react` 1.47.0, one named import per icon | owner decision 3; 1.47.0 is the newest release at least 14 days old (1.48.0 was 13). The lockfile gained exactly that one entry. |
| `i18n/server.ts` | `i18n/preferences.ts` | same job (`readLang`, `readTheme`, `serializePreference`) |
| `design/motion.css` | none; reduced motion lives in `design/base.css` | the only global motion rule was already there; Tailwind utilities do the rest |
| first screen "for all languages" | Kannada headline one size step smaller (`--text-3xl/5xl/6xl` under `:lang(kn)`) | the audit found the Kannada hero card at 841 of 800 (1440x800) and 786 of 780 (360x780); now 723 and 727. First of the three allowed attempts. A side effect: the phone-size section headings (`h2`) are 26 px instead of 30 px in Kannada. |
| (not in plan) font diet | `v2FontClassName(lang)` puts only the page language's Indic font on the wrapper | the budget script showed 478,116 B of fonts for every visitor, because the language list shows all three scripts' names. Now en 142,592 B, te 266,356, hi 263,780, kn 233,164. Names in other scripts use the system's font for that script. Reversible in `design/fonts.ts`. |
| WebKit/Firefox "same checks" | same checks, with two engine accommodations | see section 4 |

## 4. Findings the owner should know

1. **The root layout preloads the Geist and Geist Mono fonts that no v2 page uses** (29,288 B + 23,108 B = 52,396 B on every `/landing` visit; Chrome fetches them silently). Firefox prints "preloaded ... was not used" for four files: those two, and also v2's own Plus Jakarta Sans and Bricolage Grotesque Latin files, which `document.fonts` reports as loaded in Firefox (so that second pair is a warning I did not get to the bottom of). Fixing the Geist preloads needs a change to `app/layout.tsx`, which the port may not touch. A small proposal for lane A or the owner: stop preloading Geist on `/landing` (for example move the Geist fonts out of the root layout into the legacy screens). Not done here. The audit counts these warnings as "known" and prints them; it does not hide them.
2. **Safari's engine upgrades `http://127.0.0.1` requests under the production CSP** (`upgrade-insecure-requests`), so a plain-http local run of the page does not load in Safari-class browsers at all. In production (https) this does not apply. The audit fronts the app with a local https proxy for those two engines; the CSP is untouched.
3. **Safari leaves links out of the plain Tab order** by default (a macOS setting); keyboard users of Safari use Option+Tab. The WebKit run walks with Option+Tab. Chrome and Firefox use Tab.
4. **Public pages are rendered per request** (dynamic), as ADR 0060 decided. The measured cost is no CDN caching. The static-with-hash-CSP option stays parked for T012.
5. **Tailwind's theme variables sit on `:root`** (49 custom properties such as `--text-lg`, `--tw-*`). No legacy rule uses these names; the reverse audit confirms the legacy `/login` page computes identically with the v2 sheet on and off and that no existing custom property is overridden. If a future legacy rule used one of those names it would be affected; `audit:leaks` would flag an override.
6. **`PUBLIC_LAUNCH_REQUIRES_REVIEWED` is not wired into the build** (still an open proposal). With the flag set, `i18n:status` exits 1 (525 draft strings), which is the intended gate.
7. **Only the WebKit and Firefox engines were run, not Safari itself**, on this one Mac, headless, with overlay scrollbars. Chrome ran with classic scrollbars hidden (`--hide-scrollbars`, as the design-lab audits did); with classic 15 px scrollbars every width is 15 px narrower.
8. **Fonts**: Indic text relies on web fonts for the page's own language and on the operating system's fonts for the other two scripts' names in the language list.

## 5. Raw results

All run after `npx -y npm@10.9.2 ci --no-audit --no-fund` and a fresh `npm run build`, in `apps/web`, Node v22.12.0.

### 5.1 Exit codes

```
npm ci exit 0
lint exit 0
typecheck exit 0
contracts tsc exit 0
test exit 0           (Test Files 107 passed (107), Tests 1589 passed (1589))
build exit 0
audit:leaks exit 0
audit:landing chrome exit 0
audit:landing webkit exit 0
audit:landing firefox exit 0
audit:budget exit 0
audit:contrast exit 0
i18n:status exit 0
i18n:status with PUBLIC_LAUNCH_REQUIRES_REVIEWED=1 exit 1   (525 strings still draft, as intended)
./scripts/check-no-leftovers.sh exit 0
python3 scripts/test-lanes.py: Ran 28 tests, OK
```

Not run (need Docker and the local stack, not this stage): `make check`, pgTAP, integration, API tests. The branch touches `apps/web` and `docs/plans` only.

### 5.2 Lockfile (against `origin/main`), added lines only

```
+        "lucide-react": "1.47.0",                       (dependencies)
+        "playwright-core": "1.63.0",                    (devDependencies)
+    "node_modules/lucide-react": { "version": "1.47.0", ... "license": "ISC", "peerDependencies": { "react": "^16.5.1 || ... || ^19.0.0" } },
+    "node_modules/playwright-core": { "version": "1.63.0", ... "dev": true, "license": "Apache-2.0", "bin": { "playwright-core": "cli.js" }, "engines": { "node": ">=20" } },
```

No other package added, removed or changed. `npm ci --dry-run` passed with npm 10.9.2 at each of the two dependency commits. `playwright-core` has no dependencies, is dev-only, and downloads nothing at install time; the WebKit and Firefox builds were fetched once with `npx playwright-core install webkit firefox` into `~/Library/Caches/ms-playwright` (not in the repository, not in CI). 1.63.0 is the newest release at least 14 days old (1.64.0 appeared today).

### 5.3 `audit:leaks` (source, fixture and page mode)

```
source check: 27 v2 source file(s), 38 legacy class names (35 standalone, 4 combinations), 0 violation(s)
detector self-test: ok
fixture audit, light/dark: OVERRIDE leaks=0 | SHADOWED utilities=0 | BASE leaks outside the allow-list=0
page audit, en|te|hi|kn, light: elements=660 | OVERRIDE leaks=0 | SHADOWED utilities=0 | BASE leaks outside the allow-list=0 (allow-listed derived values: 57) | CSP violations=0
page audit, en|te|hi|kn, dark:  elements=668 | OVERRIDE leaks=0 | SHADOWED utilities=0 | BASE leaks outside the allow-list=0 (allow-listed derived values: 57) | CSP violations=0
reverse audit, light and dark: landed on /login; v2 sheet still in the document=true; legacy-page elements compared=16; properties whose computed value changes with the v2 sheet on/off=0; existing custom properties it overrides=0; new custom properties it adds on :root=49
AUDIT PASSED
```

Two things the page mode found and fixed on the way: an `auto` margin is a used value that moves with the legacy `body { margin: 0 }`, so it is counted as derived, like `width`; and the legacy `select { background: transparent }` shorthand reset `background-position` to `0px 0px` (the v2 reset now sets `0% 0%`).

### 5.4 `audit:landing` (55 result lines per engine; the lines that matter)

```
chrome  : 55 ok, 0 FAIL      webkit 26.6: 0 FAIL      firefox 155.0: 0 FAIL
structure x 8 (4 languages x light/dark): h1=1 headings=38 landmarks 1/1/1, robots="noindex, nofollow", og:image=false, json-ld=0
layout x 20 (4 languages x 5 sizes): no sideways scroll; h1, first button and first step card inside the first screen
  e.g. en 1440x800: h1 263, button 406, step card 708 of 800;  kn 1440x800: 265, 408, 723;  kn 360x780: 244, 450, 727 of 780
text x 16 (4 languages x light/dark x 360 and 1440): smallest text 14px; computed contrast of every text element passes (tightest = 1.03x its requirement in light, 1.36x in dark); touch targets at least 44px at 360, 24px at 1440
focus x 6: Chrome 25 tab stops, WebKit 25 (Option+Tab), Firefox 28; lowest ring contrast 4.84:1 (light), 7.95:1 (dark)
motion, laptop strip: starts alone; active=0,1,2,3 seen; pause icon pauses and resumes; off-screen and hidden tab pause and resume; the hidden layout is not playing
  animated while running: scale, translate, opacity; declared transitions on the strip: transform, scale, opacity, translate
motion, phone swipe row: advanced 0 -> 1 alone; a touch paused it for 4.5 s; resumed after the 12 s pause
motion, reduced motion 1440 and 390: playing=false, 6 of 6 step cards shown (strip), nothing moved in 3 s, 0 running animations
health: 54 page loads, 0 CSP violations, 0 console errors or warnings
  (Firefox only: plus 8 known "preloaded font not used" warnings, finding 1)
```

Mutation check of the audit itself (a scratch script, not committed): a pale text colour, 12 px text, a 20 px target, a gradient behind text, an element sticking out of the screen, a second `h1`, a heading jump, an unnamed button, no focus ring and a near-white ring were each reported. (Two of my first mutations did not register because Tailwind's `!important` utilities beat inline styles and the CSP blocks injected `<style>` elements; the checks were right, the mutations were wrong, and were redone with `!important` and an adopted stylesheet.)

### 5.5 `audit:budget`

```
route /landing: 9 script file(s), 596,169 B raw, 183,944 B gzip; 2 stylesheet(s), 10,074 B gzip (informational)
JS budget: baseline 177,009 + allowance 40,000 = 217,009 B gzip; total 183,944 B; margin 33,065 B (84.8% of the limit; the page itself adds 6,935 B over the empty route)
fonts a en visitor downloads (informational): 5 file(s), 142,592 B
fonts a te visitor downloads (informational): 6 file(s), 266,356 B
fonts a hi visitor downloads (informational): 6 file(s), 263,780 B
fonts a kn visitor downloads (informational): 6 file(s), 233,164 B
```

### 5.6 `audit:contrast` and `i18n:status`

```
52/52 checks passed (26 per mode).
dark tokens in the attribute block and the media-query block are identical.

Telugu 175 draft, 0 reviewed, 175 total
Hindi  175 draft, 0 reviewed, 175 total
Kannada 175 draft, 0 reviewed, 175 total
```

### 5.7 Unchanged-pages proof (before = the build without `/landing`, after = this branch)

The ten requests, `next start` on port 4175 with dummy public Supabase values, nonce and build id normalised:

```
/login                                          200  7413 B   29dfbe40dedf0812   identical
/login?next=/app/x&notice=reset                 200  7659 B   f3c9de10052a24c0   identical
/                                               200  5810 B   e13a1446c0eb4381   identical
/does-not-exist                                 404  6238 B   e1491c345aa105de   identical
/app                                            307    18 B   f364b56b7e3020ee   identical
/app/tenants/00000000-0000-0000-0000-000000000000  307  67 B  0cc7530c7a964daf   identical
/auth/forgot                                    200  7858 B   8f8e7641ce01c69a   identical
/auth/mfa                                       307  6152 B   c52ad40ed390f85e   identical
/auth/set-password                              307  6192 B   c3606af39cab8cd7   identical
/auth/confirm                                   200  7220 B   77cca0f90f634ee1   identical
```

All ten full normalised responses (status, `location`, CSP, cache-control, content-type and body) compare byte-identical with `cmp`. The list of emitted css/js files with sha256: every existing file has the same hash; exactly **two files are new** (`.next/static/chunks/0hnihsv2x4mb4.css`, `.next/static/chunks/25qyo-ixu6i58.js`) and none is missing or changed. The only other difference is the new route `ƒ /landing` in the build's route table.

### 5.8 Guard checks

```
git diff --stat origin/main...HEAD -- .github lanes.json AGENTS.md CLAUDE.md docs/lanes.md scripts Makefile
(empty)
git diff --stat origin/main...HEAD -- apps/web/proxy.ts apps/web/lib/security apps/web/next.config.ts apps/web/app/layout.tsx apps/web/app/globals.css apps/web/app/login apps/web/app/auth apps/web/app/app
(empty)
```

`git diff --name-status origin/main...HEAD`: 71 paths. Every one matches the expected-paths table (`apps/web/design/*`, `apps/web/i18n/*`, `apps/web/components/v2/*`, `apps/web/scripts/*`, `apps/web/app/landing/*`, `apps/web/package.json` and `package-lock.json` with the owner's "deps ok", `docs/plans/port-design-v2.md`, `docs/plans/port-design-v2-stage2-*.md`). Modified (not added): `design/fonts.ts`, `design/reset.css`, `design/v2.css`, `components/v2/V2Root.tsx` and its test, `i18n/strings/strings.test.ts`, `scripts/audit-leaks.mjs`, `scripts/audit/probe.html`, `scripts/lib/{chrome,leak-audit,source-check,source-check.test}`, `package.json`, the lockfile and `docs/plans/port-design-v2.md` (one table row).

## 6. Browser matrix

| Engine | How | Result |
|---|---|---|
| Chrome (system) | DevTools Protocol, no dependency | all checks pass |
| WebKit 26.6 (Safari's engine, not Safari) | `playwright-core`, local only | all checks pass (over https through a local proxy, finding 2; Option+Tab, finding 3) |
| Firefox 155.0 | `playwright-core`, local only | all checks pass (8 known font-preload warnings, finding 1) |
| Real Safari, real phones, screen readers | not run | **not verified** |

Run them: `npm run build`, then `npm run audit:landing`, `npm run audit:landing -- --engine webkit`, `npm run audit:landing -- --engine firefox`. The first time, `npx playwright-core install webkit firefox`.

## 7. Open items for the owner

1. Approve (or not) flipping `/` to the landing page (a separate commit after approval: the root `app/page.tsx` is not part of this branch).
2. Decide whether the root layout should stop preloading Geist on v2 pages (finding 1; lane A or the owner).
3. Review the Telugu, Hindi and Kannada drafts (the review sheet from the earlier work still applies; the string keys are unchanged).
4. Decide where the web audits run (today: local only, not in CI; CI runs lint, typecheck, test and build).
5. Placeholders to replace before launch: product name (`design/brand.ts`), privacy, terms and contact pages, the early-access form, noindex, an Open Graph image.
