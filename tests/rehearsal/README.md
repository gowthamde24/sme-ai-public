# Thin-slice rehearsal (docs/plans/thin-slice-rehearsal.md)

`make db-reset && make rehearse-thin-slice` runs the whole slice through our API on the LOCAL stack, as an Owner, an Admin, a Sales user and a Viewer (plus a second workspace's Owner), from the synthetic CSV in `data/` to `closed_paid`, then runs it a second time on the same database (it must change nothing). It writes `rehearsal-report.md` at the repository root (git-ignored).

* `drive.py` the script (people, steps, hand-worked expectations); `harness.py` the network guard, the people, the recorder and the API caller; `report.py` the markdown.
* It decides nothing: no price, tax, advance or lifecycle rule lives here. It compares the API's answers with `data/expected.json`, worked out by hand (`data/expected.md`).
* Every id is deterministic (uuid5), so every write of the second pass is a retry. The people and their authenticator secrets are invented and kept in `.rehearsal/state.json` (git-ignored); delete it only together with `make db-reset`.
* Opt-in: not part of `make check`. Synthetic data only, no model, nothing is sent; connections to anything but 127.0.0.1 are refused by the script.

## The follow-up rehearsal (T010 part 2, commit 4)

`followups.py` builds a NEW synthetic workspace on every run (no `make db-reset` needed: the history is dated relative to now, so a repeat is a new workspace with new ids) with a follow-up policy in force and twelve leads in twelve states (due now, not yet, replied, opted out, order accepted, no first message, touch limit, a requirement with questions, a reply after a draft, a WhatsApp number shared with an opted-out contact, a phone-only contact taken through WhatsApp end to end, a contact who withdrew e-mail consent after the first message).

* `make rehearse-prepare-followups`: only builds the workspace, for the owner to click through by hand (`docs/rehearsal-followups-checklist.md`). Prints how to sign in and the address of each lead.
* `make rehearse-followups`: builds it, then runs the whole journey headless through the API as Owner, Admin, Sales and Viewer, asserting each step and every refusal (code and reason), and that nothing could have been sent. Writes `rehearsal-followups-report.md` (git-ignored). Opt-in: not part of `make check`.

Operator SQL is used in three places, each marked in the code: a lead's creation time is moved back 30 days (the API refuses a touch older than its lead), counts (rows, keys: never a value), and the database's own day. Contacts get their suppression keys because they are made through the API, which the in-process app computes with a synthetic, non-secret key; the run counts that every prepared contact is keyed. There is still no SCREEN to key an existing unkeyed contact: the Owner's `POST /suppression/backfill` endpoint exists (and `GET /suppression/status`), but nothing in the web calls them.
