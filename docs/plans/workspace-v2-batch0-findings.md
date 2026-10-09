# Workspace redesign, Batch 0: what was built and what it found

Written 2026-10-09 (overnight job W). Branch `web/v2-b0-groundwork`, from `main` 1984e39 (Job U merged). No look changes in this batch.

## Built

| Piece | Where | Proof |
|---|---|---|
| Plain-text snapshot of every screen and role, taken from `main` before any markup change | `apps/web/test/screens/` (`screen-text.ts` the extractor, `scenarios.tsx` the screens, `fixtures.ts`, `__text__/*.txt` the 135 files) | `npx vitest run test/screens`; a test fails if a `page.tsx` under `app/app` has no scenario; the files are identical in `TZ=Asia/Kolkata` and `TZ=America/New_York` |
| The guard for look batches | `npm run guard:v2 -- <previous-branch> [--allow <glob>] [--allow-text]` | forbidden-path diff, every `ROLES`/`WRITERS`/`*_ROLES`/`ADMINS` line (25 today), the text snapshot |
| `getLang()` with an English fallback | `apps/web/i18n/get-lang.ts` | the real `cookies()` outside a request throws; `getLang()` answers `en` (test, no mock) |
| Theme bridge (owner approved) | `app/layout.tsx` (`<html data-theme>` from the `sme_theme` cookie), one marked block at the end of `app/globals.css`, `ThemeButton` flips every `[data-ui="v2"]` and `<html>` | `app/theme-bridge.test.ts` (same colours as the system-dark rules, both directions), `app/layout.test.tsx`, `controls/theme-sync.test.tsx` |
| Contact sheet | `e2e/screens.mjs` | ran against the demo: 84 pictures; see "Contact sheet" |

## Findings

1. **Snapshot design.** The extractor writes words, heading levels, link targets, button and control names (name, label, required, disabled, hidden values such as idempotency ids), options, table rows, roles and labels. It ignores class names, ids, styles and which element wraps a run of words, so a restyle can change markup freely and must not change this text. Paragraphs run on in one line; a line break is written only at headings, list items, rows, controls, buttons, fieldsets and labelled regions.
2. **Role gating differs by session level.** Owner and admin are rendered with a second factor; the states "no second factor" are separate scenarios (item types, quote policy, follow-up policy, price list, privacy, enquiry quote) because those screens change their words.
3. **A fixture the parser refuses is a test bug, not a screen state.** The harness records an `ApiContractError` from a fixture and fails the test, because a page turns it into "Could not load this".
4. **The owner's `:3000` dev server runs from this working folder** (`~/Desktop/sme-ai-polish/apps/web`), so a second `next dev` here is refused (lock). The overnight job served an APFS clone (`~/Desktop/v2-overnight/run`) on `:3002`. Anyone who wants the contact sheet while the owner's demo runs does the same, or points `--base` at their own port.
5. **Phone on the same Wi-Fi (unverified, not tried).** `next dev` listens on all interfaces (it printed a `Network:` address), but the web app talks to Supabase at `127.0.0.1:54321`, which a phone cannot reach, so sign-in would fail on a real phone. A phone check needs the Supabase URL to be the laptop's address; that is a change to `scripts/with-local-demo-env.sh`, not made here.
6. **Page weight (not measured).** `next dev` serves unoptimised bundles, so a number from it would mean nothing, and `next build` would write into the `.next` folder the owner's server uses. Left for the owner or lane A (`audit:budget` against one app route after Batch 1A, when the three Indic fonts load on every app route).
7. **Island-per-folder pattern.** Not proved on a throwaway route; it is proved by the first real migrated screen (Batch 1B-orders), where the contact sheet shows a v2 island next to the old frame content. The rule that makes it possible is verified: `V2Root` scopes tokens and reset to `[data-ui="v2"]`, utilities are not scoped, so layout utilities work on a plain wrapper and colours only inside an island.
8. **Audits.** `npm run audit:leaks -- --source-only` passes (41 v2 files, 0 violations). `audit:auth` and the browser steps of `audit:leaks` need Chrome and a build; not run.

## Contact sheet

`node e2e/screens.mjs --base http://localhost:3002 --batch <name> --out <dir>` signs in as the demo owner (password constant, code from `make demo-code`), visits 24 screens at 390x844 and 1280x800, light and dark, English. It reports horizontal overflow on the phone, non-2xx answers and a missing `<main>`. On `main` (before) it found two real overflows on a phone: the workspace home and the quote policy page.
