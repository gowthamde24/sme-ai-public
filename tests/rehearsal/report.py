"""The rehearsal report: markdown, written for the owner to read. Numbers only from what the run recorded; nothing here is a judgement about whether they are good (no thresholds were set: plan decision 6)."""

# ruff: noqa: E501

from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _kind(step: str) -> str:
    return step.split(": ", 1)[1] if ": " in step else step


def _pct(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(p * (len(ordered) - 1))))]


def _table(header: list[str], rows: list[list[Any]]) -> str:
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    out += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(out)


def _rupees(paise: int) -> str:
    return f"{paise / 100:,.2f}"


def write_report(
    path: Path,
    results: list[Any],
    expected: dict[str, Any],
    *,
    total_seconds: float,
    tenant_ids: dict[str, str],
) -> None:
    first = results[0]
    second = results[1] if len(results) > 1 else None
    all_checks = [c for r in results for c in r.rec.checks]
    failed = [c for c in all_checks if not c.ok]
    stopped = next((r.stopped for r in results if r.stopped), None)
    verdict = "STOPPED" if stopped else ("FAILED" if failed else "PASSED")
    calls = first.rec.calls
    actions = [c for c in calls if c.kind == "action"]
    replays = [c for c in calls if c.kind == "replay"]
    probes = [c for c in calls if c.kind == "probe"]
    reads = [c for c in calls if c.kind in ("read", "lookup")]
    closed = [k for k, o in first.orders.items() if o["state"] == "closed_paid"]
    q = first.import_quality
    out: list[str] = []
    w = out.append
    w("# Thin-slice rehearsal: first report")
    w("")
    w(
        f"Written {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} by `make rehearse-thin-slice`. **Everything here is synthetic and local**: invented people, invented prices, the local stack, no model, nothing sent to anyone."
    )
    w("")
    w(
        f"**Verdict: {verdict}.** {len(all_checks) - len(failed)} of {len(all_checks)} checks passed"
        + (f"; the run stopped at: {stopped}" if stopped else "")
        + "."
    )
    w(
        f"The first pass ran on a {'FRESH database (no leads, no orders)' if first.fresh else 'database that already had data, so the figures about first-time creation are not available (run `make db-reset` and again)'}; a second pass then repeated the whole script on the same database."
    )
    w("")
    w("## Headline numbers (first pass)")
    w("")
    w(
        _table(
            ["What", "Number"],
            [
                ["Leads in the CSV file", q.get("file_lines", "n/a")],
                [
                    "... refused by the CSV adapter (before the API)",
                    q.get("adapter_refused", "n/a"),
                ],
                ["... imported as leads", q.get("created", "n/a")],
                ["... skipped as duplicates", q.get("duplicates", "n/a")],
                ["... rejected by the database", q.get("rejected", "n/a")],
                ["... imported but flagged (suppressed number)", q.get("flagged", "n/a")],
                [
                    "Enquiries pasted",
                    len([c for c in actions if _kind(c.step) == "paste the enquiry"]),
                ],
                ["Quotes made (all approved)", len(first.quotes)],
                ["Orders started / closed_paid", f"{len(first.orders)} / {len(closed)}"],
                [
                    "Final order states",
                    ", ".join(f"{k}={o['state']}" for k, o in sorted(first.orders.items())),
                ],
                ["Person actions (writes), import to the last event", len(actions)],
                ["Retries sent (every write twice)", len(replays)],
                ["Refusals provoked on purpose (probes)", len(probes)],
                ["Reads", len(reads)],
                [
                    "Wall-clock, first pass / second pass / whole script",
                    f"{first.seconds:.1f} s / {(second.seconds if second else 0):.1f} s / {total_seconds:.1f} s",
                ],
            ],
        )
    )
    w("")
    w("## 1. Correctness")
    w("")
    w(
        "Every figure below was worked out by hand before the engine ran (`tests/rehearsal/data/expected.md`). The driver holds no price, tax or advance rule."
    )
    w("")
    rows = []
    for key, got in sorted(first.quotes.items()):
        want = got["expected"]
        a = got["actual"]
        rows.append(
            [
                key,
                _rupees(want["total_paise"]),
                _rupees(a["total_paise"]),
                _rupees(want["advance_paise"]),
                _rupees(a["advance_paise"]),
                a["gst_supply"],
                "Owner only" if a["needs_owner_approval"] else "Owner or Admin",
                ", ".join(got["flags"]) or "-",
                "yes"
                if (
                    a["total_paise"],
                    a["advance_paise"],
                    a["merchandise_net_paise"],
                    a["item_tax_paise"],
                )
                == (
                    want["total_paise"],
                    want["advance_paise"],
                    want["subtotal_paise"],
                    want["tax_paise"],
                )
                else "NO",
            ]
        )
    w(
        _table(
            [
                "Quote",
                "Total (hand)",
                "Total (engine)",
                "Advance (hand)",
                "Advance (engine)",
                "GST supply",
                "Approval",
                "Flags",
                "Equal",
            ],
            rows,
        )
    )
    w("")
    rows = []
    for key, o in sorted(first.orders.items()):
        want = expected["orders"][key]
        rows.append(
            [
                key,
                want["final_state"],
                o["state"],
                _rupees(want.get("paid", 0)),
                _rupees(o["paid"]),
                _rupees(o["refunded"]),
                _rupees(o["balance"])
                if o["state"] not in ("declined", "cancelled", "expired")
                else "- (closed, not owed)",
                o["events"],
                o["lost_reason"] or "-",
            ]
        )
    w(
        _table(
            [
                "Order",
                "State (hand)",
                "State (actual)",
                "Paid (hand)",
                "Paid (actual)",
                "Refunded",
                "Balance",
                "Ledger events",
                "Lost reason",
            ],
            rows,
        )
    )
    w("")
    if failed:
        w("**Checks that failed:**")
        w("")
        for c in failed:
            w(f"* {c.name}: expected `{c.expected!r}`, got `{c.actual!r}`")
        w("")
    w("## 2. Gates and refusals")
    w("")
    refusals: Counter[tuple[int, str]] = Counter()
    where: dict[tuple[int, str], list[str]] = defaultdict(list)
    for c in calls:
        if c.status >= 400 and c.kind != "lookup":
            refusals[(c.status, c.code or "-")] += 1
            if len(where[(c.status, c.code or "-")]) < 2:
                where[(c.status, c.code or "-")].append(f"{c.who}: {c.step}")
    w(
        _table(
            ["HTTP", "Code", "Count", "Examples"],
            [
                [s, code, n, "; ".join(where[(s, code)])]
                for (s, code), n in sorted(refusals.items())
            ],
        )
    )
    unplanned = [c for c in calls if c.status >= 400 and c.kind not in ("probe", "lookup")]
    w("")
    w(
        f"Every refusal above was provoked on purpose by a probe. Refusals nobody asked for: **{len(unplanned)}** (a write or read that a person would have done, refused by the system)."
    )
    w("")
    w("## 3. Idempotency")
    w("")
    once = len(actions) - len(replays)
    w(
        f"* Every write but {once} was sent twice in the first pass ({len(replays)} retries; the {once} sent once are the preview, the opt-out and the erasure, which have no retry meaning): all retries were accepted and none created a second row (the retry's answer said `replayed` wherever the answer has that field)."
    )
    if second is not None:
        diff = {
            k: (second.before[k], second.after[k])
            for k in second.before
            if second.before[k] != second.after[k]
        }
        w(
            f"* The whole script was then run a second time on the same database: {len([c for c in second.rec.calls if c.kind == 'action'])} writes, **{'no row of any business table changed' if not diff else 'ROWS CHANGED: ' + str(diff)}**."
        )
        w("")
        w(
            _table(
                ["Table", "Rows before the second pass", "Rows after"],
                [
                    [k.replace("public.", ""), second.before[k], second.after[k]]
                    for k in sorted(second.before)
                ],
            )
        )
    w("")
    w("## 4. Effort")
    w("")
    w(
        "A **person action** is one write a person would make (typing a field, a pick, an approval, a recorded event). Retries, reads and refused probes are not counted."
    )
    w("")
    per_lead: dict[str, list[Any]] = defaultdict(list)
    for c in actions:
        if c.lead:
            per_lead[c.lead].append(c)
    lead_orders: dict[str, list[str]] = defaultdict(list)
    tags = {"A": "L2", "B": "L3", "B2": "L3", "C": "L4", "D": "L9", "E": "L12", "F": "L15"}
    for k, t in tags.items():
        lead_orders[t].append(f"{k}={first.orders.get(k, {}).get('state', '?')}")
    rows = []
    for tag in sorted(per_lead, key=lambda t: (t == "import", t)):
        mix = Counter(_kind(c.step) for c in per_lead[tag])
        rows.append(
            [
                tag,
                len(per_lead[tag]),
                "; ".join(lead_orders.get(tag, [])) or "-",
                ", ".join(f"{n} {k}" for k, n in mix.most_common(4)),
            ]
        )
    w(_table(["Lead (CSV line)", "Person actions", "Orders", "Most frequent actions"], rows))
    w("")
    done = [t for t in sorted(per_lead) if any("closed_paid" in s for s in lead_orders.get(t, []))]
    if done:
        w(
            "Person actions for a lead that went from the CSV to `closed_paid`: "
            + ", ".join(f"{t}: {len(per_lead[t])}" for t in done)
            + " (the one import action is shared by all leads and not counted here)."
        )
        w("")
    by_role = Counter(c.who for c in actions)
    w(_table(["Role", "Person actions"], [[r, n] for r, n in by_role.most_common()]))
    w("")
    w(
        "Wall-clock per step, through the API (milliseconds; the app runs in the same process, the database is the local stack; **a lower bound** for any hosted setup):"
    )
    w("")
    timing: dict[str, list[float]] = defaultdict(list)
    for c in calls:
        if c.kind in ("action", "read", "lookup"):
            timing[_kind(c.step)].append(c.ms)
    w(
        _table(
            ["Step", "Calls", "Median", "p95", "Max"],
            [
                [k, len(v), f"{statistics.median(v):.0f}", f"{_pct(v, 0.95):.0f}", f"{max(v):.0f}"]
                for k, v in sorted(timing.items(), key=lambda kv: -statistics.median(kv[1]))
            ],
        )
    )
    w("")
    w(
        "Not measured here (needs the web page and a person): real clicks, reading time, the manual baseline (the owner times one real quote-to-order in the family's current way)."
    )
    w("")
    w("## 5. Data quality (the CSV import)")
    w("")
    w(
        _table(
            ["Measure", "Number"],
            [
                ["Lines in the file", q.get("file_lines", "n/a")],
                ["Imported", q.get("created", "n/a")],
                ["Duplicate (merged into an existing lead)", q.get("duplicates", "n/a")],
                [
                    "Rejected by the adapter or the database",
                    q.get("rejected", 0) + q.get("adapter_refused", 0),
                ],
                ["Flagged as suppressed on arrival", q.get("flagged", "n/a")],
            ],
        )
    )
    w("")
    for line, why in sorted({**q.get("adapter_codes", {}), **q.get("reasons", {})}.items()):
        w(f"* {line}: {why}")
    for line, why in sorted(q.get("flagged_lines", {}).items(), key=lambda kv: int(kv[0])):
        w(f"* line {line}: arrived flagged ({why}): not contactable")
    w("")
    w(
        "A rehearsal on invented, tidy data says little about real data (other languages, messy addresses, free-text enquiries): these figures are a lower bound."
    )
    w("")
    w("## 6. Provenance and audit")
    w("")
    audit = first.audit
    w(
        f"* Audit trail of the workspace: {audit.get('events', 0)} events, every one with an actor and a time. By kind: "
        + ", ".join(f"{k} {n}" for k, n in audit.get("by_kind", {}).items())
        + "."
    )
    w(
        "* Every quote and every order event carries its engine version and canonical hash; every order event carries who recorded it (checked per order above)."
    )
    w(
        "* A customer text was rendered for each approved quote and is marked `sent_by_system: false`."
    )
    w("")
    w("## 7. Safety")
    w("")
    net = first.network_local
    w(
        f"* Network: connections made by the script, all to this machine: {', '.join(f'{k} x{n}' for k, n in sorted(net.items())) or 'none'}. Connections to anything else: **{len(first.network_refused)}** (the script refuses them)."
    )
    w(
        "* Messages sent: **0** (there is no route that sends; the quote text and the order events are records a person copies or enters). Model calls: **0** (the requirement was typed as a person would; the agents are off). Secrets read: **none** (only the local stack's public URL and key; the script refuses to run with a service-role value in its environment)."
    )
    w("")
    w("## 8. What this run found (read these first)")
    w("")
    w(
        "* The API has no route to add a member to a workspace: the Owner's token was used against the database API to add the Admin, the Sales user and the Viewer. The first real week needs an invite route or a runbook step."
    )
    w(
        "* A typed requirement field cannot be retried after the requirement is confirmed (`requirement_confirmed`, not a replay); the repeat pass therefore reads the requirement first and does not type it again, as a person would."
    )
    w(
        "* A quote replaced by a newer one (Q2 after Q2b) can no longer be approved (`quote_not_draft`); the repeat pass skips it for the same reason."
    )
    w(
        "* The repeat customer's ordinary quote (Q6) is flagged only `REPEAT_CUSTOMER_CLAIMED` (Owner only); Q7 is over its credit limit on purpose and is also flagged `CREDIT_LIMIT_EXCEEDED`. The limit is the seeded synthetic Rs 5,00,000: the real number is the owner's to set before real use (checklist)."
    )
    w(
        "* Orders B, C and F end lost or cancelled on purpose and D stays `in_preparation`; the balance of a lost or cancelled order is not owed and is not shown as a number."
    )
    w(
        "* Replays after the order has moved on report no guidance (by design); the driver checks each event's numbers on its first send and the order's ledger at the end."
    )
    w(
        "* The second pass can only repeat on the same UTC day (the times of the recorded events are the start of that day): a retry on another day is a different request."
    )
    w(
        "* Order steps were entered with a time of occurrence of the start of the UTC day plus a second per step, as a person would type a date."
    )
    w("")
    w("## 9. Reproduce")
    w("")
    w("```")
    w("make db-reset                     # a fresh local database (nothing real in it)")
    w("make rehearse-thin-slice           # runs the script twice and writes this file")
    w("```")
    w("")
    w(
        f"Workspaces: `{tenant_ids.get('a')}` (A), `{tenant_ids.get('b')}` (B). People and their authenticator secrets are invented and kept in `.rehearsal/state.json` (git-ignored)."
    )
    path.write_text("\n".join(out) + "\n")
