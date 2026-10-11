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
npm run privacy                                # the Owner's erasure page (WRITES: erases one synthetic demo contact)
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
- **privacy.mjs:** the Privacy link and page (Owner/Admin only), asking erases nothing, the Admin can cancel but not run, preview changes
  nothing, erasing needs the typed words (ERASE plus the name), the completed row shows counts and the names note but no value, the erased contact is
  gone from the list, a workspace-wide request is refused inside 24 hours and can be cancelled, Sales and Viewer get a refusal.
- **export.mjs:** the CSV has a reason on every Bad row and no formula cells; only Owner/Admin can export.

A label belongs to one reviewer, so each labelling run needs a reviewer who has not labelled yet: re-seed the database
(`supabase db reset` then `make seed-demo`) or create more users in `setup-local-users.mjs`.


## The real-stack run (job BE): `make e2e-local`

Unlike the walkthroughs above (which drive the demo on :3000/:8000), `be-stack.mjs` starts **its own API (:8002) and web (:3002)** against the local Supabase stack **with Storage**, signs up a **throwaway account and workspace** (`e2e-<stamp>`) through the real pages, and walks sign-in with the authenticator, Today, the Outbox, Settings, Visits and the saree Catalogue (a real photo upload), then removes everything it made. It never touches the demo, never uses :3000, :8000 or :8001, and refuses to start while an integration or pgTAP session is using the shared database. Run it from the repository root: `make e2e-local`. Details, the step list and the things to know (quiet hours, the scripted model, clean-up, why it is not in CI): `docs/runbooks/e2e-real-stack.md`.

Files: `be-stack.mjs` (the steps), `be-lib.mjs` (API, sign-in token, database and shared-database guards), `be-env.mjs` (the ports), `cleanup-be.mjs` (removes `e2e-*` workspaces and accounts) with its safety lock `cleanup-guard.mjs` (local database host AND `e2e-` slug, or it refuses; tested by `apps/web/scripts/e2e-cleanup-guard.test.ts`), `fixtures/saree-demo.jpg` (a drawn picture, no real product photo). Screenshots go to `shots-be/` (git-ignored).
