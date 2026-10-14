# Visual tests (job BX)

Pictures of the main screens, compared with the ones kept in `baselines/`:

| Screens | Today, Visits, Outbox, Catalogue, a lead page, Settings, the Office (job CJ), the landing page |
|---|---|
| Sizes | a phone (360 × 780) and a desktop (1280 × 800), the first screenful |
| Looks | light and dark |
| Languages | English and Telugu (the Telugu words are drafts) |

56 pictures. A picture "changed" when more than 0.2 % of its pixels differ by more than 24 (of 255) in a colour channel.

## Run

```
make visual                      # builds the web app (1–2 minutes), compares, exit 1 if a picture changed
make visual ARGS="--no-build"    # reuse the last visual build
make visual ARGS="--only today,lead"
make visual-update               # you meant the change: write this system's baselines
```

A changed picture is written to `e2e/visual/out/<name>.actual.jpg` with `<name>.diff.png` (red = what differs). `out/` is git-ignored.

## What it starts (and stops again, by its own process ids)

- **the stand-in backend**, https on `127.0.0.1:54999` (`stand-in.mjs`): answers for BOTH the Supabase Auth server (one invented owner with an authenticator, so the session is "aal2") and the SME AI API (`fixtures.mjs`: one invented business, a few customers and sarees, generated saree pictures). Read-only: POST/PUT/DELETE are refused. A request it has no fixture for is a 404 **and is listed at the end of the run** (and fails it), so a screen that starts asking for something new is noticed instead of being drawn half empty.
- **the web app**, built against the stand-in's addresses and served with `next start` on `127.0.0.1:3014`. The server clock is pinned to 14 Oct 2026 10:30 India time (`fake-clock.cjs`), the browser clock too.
- **Chromium** from `apps/web/node_modules/playwright-core` (install it once with `npx playwright-core install chromium` in `apps/web` if it is missing).

No database, no keys, no network after the build, no real person. It never uses ports 3000, 8000, 8001, 3002 or 8002, and it does not kill anything it did not start (if a port is busy it stops and says so).

## Why the baselines are per system

Fonts and anti-aliasing differ between macOS and Linux, so pictures taken on one do not match the other: `baselines/darwin/` and `baselines/linux/`. Only the system you run on is compared. The Linux ones are made by CI (`.github/workflows/visual.yml`, run it by hand with "update" ticked, then download the artifact `visual-baselines-linux` and commit its `baselines/linux/` folder); until they exist the CI job skips itself and says so.

## Keeping the data honest

`apps/web/test/visual-fixtures.test.ts` runs every fixture through the real parser of the app (in `npm test`), so a change of the API's shape fails there rather than showing "Not available yet" in the pictures. Invented names only; example addresses only.

## Known limits

- First screenful only (the tab bar and menus are fixed, so a full-page capture would put them in the middle).
- The Agent OWL (the plush owlet, job CI) is drawn as its still picture: the run refuses the layer files it animates from (`/owl/v3/<agent>/owlet-head|body|beak|wing-*-512.webp`), so the owl never moves and a picture cannot differ from run to run. Its moods are checked by `e2e/ci-owl-shots.mjs` and the unit tests, not here. Animated parts are frozen.
- A real change that is below the threshold (a one-pixel line, a faint colour) will not be caught: this is a safety net for layout, not an exact diff.
