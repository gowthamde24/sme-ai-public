# Runbook: the real-stack end-to-end run (`make e2e-local`, job BE)

One command drives the **real web**, the **real API** and the **local Supabase stack with Storage** through a real browser, the way a person would, and says PASS or FAIL for each step. It uses **its own ports (web 3002, API 8002)** and **its own throwaway account and workspace** (`e2e-<stamp>`), so the owner's demo (3000, 8000, the demo workspace) is never touched. Everything is invented; **nothing leaves this machine** (the only channel is the API's local stand-in).

## Run it
```
make db-start            # the local Supabase stack, with Storage (once)
make e2e-local
```
It needs Docker, the Supabase CLI, the API's virtualenv (`make install`; Pillow is a declared dependency of the API), Node, and a browser (the first time: `cd e2e && npm ci && npx playwright install chromium`).
What it does, in order: refuses unless the ports are free (never 3000, 8000, 8001) and the stack, including Storage, is up; starts the API (`AGENTS_ENABLED=true`, the scripted model) and the web, recording their PIDs; runs `e2e/be-stack.mjs`; stops **only the processes it started** (by PID and their children); removes the throwaway workspace and account (`e2e/cleanup-be.mjs`). Set `E2E_KEEP=1` to keep the workspace to look at it, `E2E_SHOTS=dir` to choose where the screenshots go (default `e2e/shots-be/`, git-ignored). Exit code 0 only if every step passed.

## What it checks
| Step | What |
|---|---|
| A1-A5 | **Sign-up** on the real page; the local stack asks for e-mail confirmation (a local database step); first-login setup makes the business with the person as Owner; **authenticator enrolment** in the browser (QR, key, six digits); sign out, sign in: password alone is not enough, the code is asked for |
| B0 | The data a person would already have, made through the API with their own second-factor token: two customers (phone, WhatsApp consent, a message they wrote), a message with a price in Telugu **and an English gloss** (waits), a plain one |
| C1-C2 | **Today** shows the waiting message with its words, the English gloss and why it waits; **Approve and send** |
| D1-D5 | **Outbox**: counts on the tabs from `GET /outbox/summary`; the approved message under Sent (or Scheduled in quiet hours); the row's English gloss and the **real history from the events** ("Made by Agent OWL", "Approved by <name>", "Held for the morning..." or "Sent"); the customer and date filters done by the **server**; **Send what is due now** in plain words (due, held for the morning); Hindi, Telugu and Kannada pages without a hydration error |
| E1-E3 | **Settings, Agent OWL**: quiet hours editable (start 19-23, end 7-10), saved with the second factor, persisted; the evening-reminder-inside-quiet-hours sentence; the API refuses a start of 18 |
| F1-F2 | **Visits**: book a customer into a free time, confirm, "they are here", complete (checked in the database) |
| G1-G4 | **Catalogue**: add a saree with a **real photo** (shrunk in the browser, uploaded through the app's upload route to real Storage, progress shown), served back through a signed Storage link that the page's CSP allows; the list thumbnail; **send it to a customer** (lead search, preview, outbox, plain-words answer); the **Outbox shows the photo thumbnail** |
| H1-H2 | **Ask Agent OWL**: a question answered by the scripted model; a saree named in an answer links to its page (see below) |
| H3-H7 | **Voice in the Ask box (job BF)**: the API runs its own **fake** speech adapters (`VOICE_STT_PROVIDER=fake`, `VOICE_TTS_PROVIDER=fake`: development only, no key, no cost) and Chrome a fake microphone. H3: the mic is drawn because the API says voice is on, with the privacy line and the auto-play switch; `Permissions-Policy` lets the site use the microphone. H4: tap, countdown, Cancel sends nothing. H5: record, stop, "You said: ..." (the fake hears a fixed sentence), the written answer, a spoken answer with Stop/Play, the recording sent as `audio/webm`. H6: voice off (route stub) draws no mic. H7: a used-up allowance (route stub) is said in words |
| V2 | The recording bar on a phone (360 px, a finger tap), light and dark: targets >= 44 px, no sideways scroll, text >= 14 px, axe |
| Z1 | No Content-Security-Policy violation and no hydration error in the browser console during the whole run |

## Things to know
* **Quiet hours.** The outbox holds messages from 21:00 to 09:00 India time (the default). The run reads the real clock: at night an approved message is **held for the morning** (the run checks the Scheduled tab, the "Held for the morning" history line and the "1 held for the morning" dispatch sentence); in the day it checks that the message is **Sent** by the fake channel. Both branches are in the script; the summary says which one ran.
* **The scripted model has no catalogue keyword**, so a real catalogue question cannot be answered with a saree source locally. H2 therefore uses the real Ask box with a stand-in for the model's reply to check the link; the real model path needs a model key.
* **The database is shared.** An integration or pgTAP session pins the database-wide clock and `make db-reset` rebuilds the database. The run **refuses to start** while a test session is alive or the clock is pinned, and says so. Run it when nothing else uses the stack.
* **The clean-up has a safety lock (job BF).** `e2e/cleanup-be.mjs` switches row guards off, so it **refuses** (exit 2, before any query) unless every database address it can see (`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, the usual database URL/host variables, the container it talks to) is this machine (`localhost`, `127.0.0.1`, `::1`, the Docker host, the local `supabase_db_*` container), and refuses if any workspace it would delete has a slug that does not start with `e2e-`; the SQL repeats the slug check and fails the whole transaction. `apps/web/scripts/e2e-cleanup-guard.test.ts` pins this (look-alike hosts such as `localhost.example.com` are not local).
* **Clean-up** (`e2e/cleanup-be.mjs`) deletes only workspaces named `E2E Silks ...` with a slug starting `e2e-` and accounts `e2e-*@e2e.example.test`. The app never deletes a workspace (append-only audit), so the script switches the row guards off inside one transaction for those rows alone. The photo **files** stay in the local Storage volume (Storage refuses to delete them from SQL): a few small synthetic pictures.
* **Not in CI.** It needs Docker, the whole local stack, Storage and a browser. Whether it can run in CI without secrets has not been tried; it would need the CI job to `supabase start` (which the integration groups already do) and a browser.
