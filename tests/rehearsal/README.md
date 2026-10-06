# Thin-slice rehearsal (docs/plans/thin-slice-rehearsal.md)

`make db-reset && make rehearse-thin-slice` runs the whole slice through our API on the LOCAL stack, as an Owner, an Admin, a Sales user and a Viewer (plus a second workspace's Owner), from the synthetic CSV in `data/` to `closed_paid`, then runs it a second time on the same database (it must change nothing). It writes `rehearsal-report.md` at the repository root (git-ignored).

* `drive.py` the script (people, steps, hand-worked expectations); `harness.py` the network guard, the people, the recorder and the API caller; `report.py` the markdown.
* It decides nothing: no price, tax, advance or lifecycle rule lives here. It compares the API's answers with `data/expected.json`, worked out by hand (`data/expected.md`).
* Every id is deterministic (uuid5), so every write of the second pass is a retry. The people and their authenticator secrets are invented and kept in `.rehearsal/state.json` (git-ignored); delete it only together with `make db-reset`.
* Opt-in: not part of `make check`. Synthetic data only, no model, nothing is sent; connections to anything but 127.0.0.1 are refused by the script.
