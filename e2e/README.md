# e2e: on-demand browser walkthroughs

Playwright scripts that drive the **running local app** the way a person would, save screenshots, and print one line per step:
`PASS`, `FAIL` or `CONFUSING` (something a non-engineer would not understand). They are **not** part of `make check` and **not**
in CI. This folder has its own `package.json` and lockfile; nothing here is a dependency of the apps.

**Local only.** Every script refuses a URL that is not `localhost` / `127.0.0.1`, signs in with the demo seed's fixed password
(valid only against a local stack) and writes demo data.

## Run

```
make db-start                                  # local Supabase
AGENTS_ENABLED=true make dev-api               # terminal 1  (agents are off unless you say so)
make dev-web                                   # terminal 2
make seed-demo                                 # the DEMO workspace, 20 leads, one agent run

cd e2e
npm ci
npm run install-browser                        # once: downloads Chromium
npm run setup-users                            # Admin, Sales, Viewer and two Sales "labelers" on the demo workspace
npm run all                                    # or one at a time:
npm run agents                                 # agents click-through (7 steps)
npm run review:desktop                         # label 20 leads as labeler1 (desktop)
npm run export                                 # Admin CSV export; Sales / Viewer refused
npm run review:phone                           # the same walkthrough at 390x844 as labeler2, with touch-target measurements
```

Screenshots and the downloaded CSV go to `e2e/shots/` (git-ignored). Override with `E2E_SHOTS`, `E2E_WEB_URL`, `E2E_API_URL`.

## What it checks

- **agents.mjs:** agents page, start a selftest run, suggestions on the company page marked "agent suggestion, unreviewed", promote
  as Owner (nothing preselected), "Change decision" hides Accept/Reject afterwards, honest accept message, Sales and Viewer see
  suggestions but no review buttons.
- **review.mjs:** scores hidden by default and no band filters; contact details collapsed; "Next unreviewed"; label 20 leads (4 Bad
  with different reasons, 4 Maybe, 12 Good); labels persist after reload; a double click makes one label (checked in the local
  database through `docker exec`); "Unreviewed only"; blindness off shows scores, bands and the plain-language breakdown. On the
  phone it also measures horizontal scroll, text overflow and touch targets under 44px.
- **export.mjs:** the CSV has a reason on every Bad row and no formula cells; only Owner/Admin can export.

A label belongs to one reviewer, so each labelling run needs a reviewer who has not labelled yet: re-seed the database
(`supabase db reset` then `make seed-demo`) or create more users in `setup-local-users.mjs`.
