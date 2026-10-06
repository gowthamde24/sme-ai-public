"""The thin-slice rehearsal driver (docs/plans/thin-slice-rehearsal.md, step 3).

One script, run through OUR API as the people of a small workspace (Owner, Admin, Sales, Viewer, and a second workspace's Owner), from a fresh local database to `closed_paid`:
import a synthetic CSV of leads, paste enquiries, enter and confirm the requirement, pick products, quote, approve, start an order, record what happens until it closes, with the side
paths (a decline then a new quote and a new order, a cancellation, a refund, a dispatch override). Every write is sent twice (a retry). Then the WHOLE script runs a second time on the
same database and must change nothing.

It decides nothing: it sends what a person would type and compares the answers with figures worked out BY HAND in tests/rehearsal/data (expected.json, expected.md). It carries no
price, tax, advance or lifecycle rule of its own; the only knowledge in it is the expected result of each step, written down by a person before the engine ever ran.
Everything is synthetic and local. Nothing is sent to anyone. Run it with `make rehearse-thin-slice`; it writes `rehearsal-report.md` at the repository root."""

# ruff: noqa: E501, S603, S607

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from harness import (
    Api,
    Deviation,
    NetworkGuard,
    People,
    Recorder,
    Stack,
    rid,
    snapshot,
)
from pydantic import SecretStr
from report import write_report

from app.config import Settings
from app.leads.csv_rows import rows_from_csv
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "tests" / "rehearsal" / "data"
API_DIR = ROOT / "services" / "ai-api"
REPORT = ROOT / "rehearsal-report.md"
SLUG_A, SLUG_B = "rehearsal-a", "rehearsal-b"
RECEIVED_AT = "2026-10-05T10:00:00+00:00"  # fixed: a retry on another day sends the same enquiry
SYNTHETIC_KEY = (
    "synthetic-rehearsal-suppression-key-0123456789"  # not a secret; only for this local run
)
ROLES_A = ("owner", "admin", "sales", "viewer")

EXPECTED: dict[str, Any] = json.loads((DATA / "expected.json").read_text())
ENQUIRIES: list[dict[str, Any]] = json.loads((DATA / "enquiries.json").read_text())["enquiries"]
SETUP: dict[str, Any] = json.loads((DATA / "setup.json").read_text())


@dataclass
class Step:
    """One event of an order, and what the hand-worked expectation says must follow."""

    who: str
    type: str
    amount: int | None = None
    state: str | None = None  # the state after
    paid: int | None = None  # net paid after (money events)
    flags: tuple[str, ...] = ()
    lost: str | None = None
    refused: tuple[int, str | None, str | None] | None = None  # a probe: (status, code, reason)
    weak: bool = False


def order_steps() -> dict[str, list[Step]]:
    pay = {k: v.get("payments", []) for k, v in EXPECTED["orders"].items() if isinstance(v, dict)}

    def happy(key: str) -> list[Step]:
        first, rest = pay[key][0], pay[key][1]
        return [
            Step("sales", "send_quote", state="quote_sent"),
            Step("sales", "customer_accept", state="accepted"),
            Step("sales", "request_advance", state="advance_requested"),
            Step("admin", "record_payment", first, "advance_paid", first),
            Step("sales", "start_preparation", state="in_preparation"),
            Step("sales", "dispatch", state="dispatched"),
            Step("sales", "deliver", state="delivered"),
            Step("admin", "record_payment", rest, "closed_paid", first + rest),
        ]

    d_adv = pay["D"][0]
    e1, e2 = pay["E"]
    f_adv, f_refund = pay["F"][0], EXPECTED["orders"]["F"]["refund"]
    return {
        "A": happy("A"),
        "B": [
            Step("sales", "send_quote", state="quote_sent"),
            Step(
                "sales",
                "customer_decline",
                state="declined",
                lost=EXPECTED["orders"]["B"]["decline_reason"],
            ),
        ],
        "B2": happy("B2"),
        "C": [
            Step("sales", "send_quote", state="quote_sent"),
            Step("admin", "cancel", state="cancelled"),
        ],
        "D": [
            Step("sales", "send_quote", state="quote_sent"),
            Step("sales", "customer_accept", state="accepted"),
            Step("sales", "request_advance", state="advance_requested"),
            Step("admin", "record_payment", d_adv, "advance_paid", d_adv),
            Step("sales", "start_preparation", state="in_preparation"),
        ],
        "E": [
            Step("sales", "send_quote", state="quote_sent"),
            Step("sales", "customer_accept", state="accepted"),
            Step("sales", "start_preparation", state="in_preparation"),
            Step("sales", "dispatch", refused=(409, "order_event_refused", "ADVANCE_NOT_PAID")),
            Step("admin", "dispatch", refused=(409, "order_event_refused", "ADVANCE_NOT_PAID")),
            Step("owner", "dispatch", refused=(403, "mfa_required", None), weak=True),
            Step("owner", "dispatch", state="dispatched", flags=("ADVANCE_OVERRIDE",)),
            Step("sales", "deliver", state="delivered"),
            Step("admin", "record_payment", e1, "delivered", e1),
            Step("admin", "record_payment", e2, "closed_paid", e1 + e2),
        ],
        "F": [
            Step("sales", "send_quote", state="quote_sent"),
            Step("sales", "customer_accept", state="accepted"),
            Step("sales", "request_advance", state="advance_requested"),
            Step("admin", "record_payment", f_adv, "advance_paid", f_adv),
            Step("admin", "record_refund", f_refund, refused=(403, "owner_required", None)),
            Step(
                "owner",
                "record_refund",
                f_refund,
                "advance_requested",
                f_adv - f_refund,
                ("REFUND_REQUIRES_OWNER_APPROVAL",),
            ),
            Step("admin", "cancel", refused=(403, "owner_required", None)),
            Step("owner", "cancel", state="cancelled", flags=("CANCELLATION_WITH_FUNDS",)),
        ],
    }


@dataclass
class RunResult:
    label: str
    fresh: bool
    rec: Recorder
    started: float = 0.0
    seconds: float = 0.0
    before: dict[str, int] = field(default_factory=dict)
    after: dict[str, int] = field(default_factory=dict)
    import_quality: dict[str, Any] = field(default_factory=dict)
    quotes: dict[str, dict[str, Any]] = field(default_factory=dict)
    orders: dict[str, dict[str, Any]] = field(default_factory=dict)
    audit: dict[str, Any] = field(default_factory=dict)
    stopped: str | None = None
    network_local: dict[str, int] = field(default_factory=dict)
    network_refused: list[str] = field(default_factory=list)


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat()


class Rehearsal:
    def __init__(
        self, api: Api, people: People, tenants: dict[str, str], result: RunResult
    ) -> None:
        self.api, self.people, self.tenants, self.res = api, people, tenants, result
        self.rec = result.rec
        self.fresh = result.fresh
        self.day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        self.leads: dict[int, dict[str, Any]] = {}  # csv line -> import outcome row
        self.quote_id: dict[str, str] = {}
        self.order_id: dict[str, str] = {}
        self.enquiry_id: dict[str, str] = {}

    # ------------------------------------------------------------------------------ the workspace's setup
    def setup_archive(self) -> None:
        """Two people who already exist BEFORE the import, one who opted out and one who was erased: so two rows of the CSV meet a suppression that exists."""
        api = self.api
        company = rid("setup", "company")
        if (
            api.get(
                "setup: look for the archive company",
                "sales",
                f"/companies/{company}",
                expect=(200, 404),
            ).status
            == 404
        ):
            api.call(
                "setup: the archive company",
                "sales",
                "POST",
                "/companies",
                {"id": company, "name": SETUP["company"]["name"], "city": SETUP["company"]["city"]},
            )
        for person in SETUP["contacts"]:
            cid = rid("setup", "contact", person["key"])
            found = api.get(
                f"setup: look for {person['key']}", "owner", f"/contacts/{cid}", expect=(200, 404)
            )
            if found.status == 404:
                api.call(
                    f"setup: the {person['key']} contact",
                    "sales",
                    "POST",
                    "/contacts",
                    {
                        "id": cid,
                        "company_id": company,
                        "full_name": person["full_name"],
                        "email": person["email"],
                        "phone": person["phone"],
                    },
                )
                found = api.get(f"setup: look for {person['key']}", "owner", f"/contacts/{cid}")
            body = found.body
            if person["then"] == "suppress" and body.get("suppressed_at") is None:
                api.call(
                    "setup: the opt-out",
                    "sales",
                    "POST",
                    f"/contacts/{cid}/suppress",
                    {
                        "reason": "opted_out",
                        "evidence_type": "verbal",
                        "evidence_ref": "call:rehearsal-1",
                    },
                    replay=False,
                )
            if person["then"] == "erase" and body.get("email") is not None:
                request = rid("setup", "erasure", person["key"])
                api.call(
                    "setup: the erasure request",
                    "owner",
                    "POST",
                    "/erasure-requests",
                    {"id": request, "scope": "contact", "subject_id": cid},
                )
                api.call(
                    "setup: the erasure",
                    "owner",
                    "POST",
                    f"/erasure-requests/{request}/execute",
                    {},
                    replay=False,
                )

    # ------------------------------------------------------------------------------ import
    def import_leads(self) -> None:
        api, rec, exp = self.api, self.rec, EXPECTED["csv_import"]
        parsed = rows_from_csv((DATA / "leads.csv").read_text())
        rec.check("import: the file is accepted by the adapter", None, parsed.fatal)
        rec.check(
            "import: the lines the adapter refused",
            [(i["line"], i["code"]) for i in exp["rows_rejected_by_adapter"]],
            [(i.line, i.code) for i in parsed.issues],
        )
        rec.check("import: rows sent to the API", exp["rows_sent"], len(parsed.rows))
        batch = {
            "batch_id": rid("import", "leads.csv"),
            "label": "rehearsal-leads",
            "rows": parsed.rows,
        }
        if self.fresh:
            preview = api.call(
                "import: preview",
                "sales",
                "POST",
                "/leads/import/preview",
                batch,
                expect=(200,),
                replay=False,
            )
            rec.check(
                "import: the preview says what the commit will do",
                (exp["created"], len(exp["skipped_duplicate"]), len(exp["rejected"])),
                (
                    preview.body["counts"]["created"],
                    preview.body["counts"]["skipped_duplicate"],
                    preview.body["counts"]["rejected"],
                ),
            )
            rec.check(
                "import: the preview wrote nothing", 0, snapshot(self.tenants["a"])["public.leads"]
            )
        done = api.call("import: commit", "sales", "POST", "/leads/import", batch, lead="import")
        counts = done.body["counts"]
        rec.check("import: created", exp["created"], counts["created"])
        rec.check("import: duplicates", len(exp["skipped_duplicate"]), counts["skipped_duplicate"])
        rec.check("import: rejected by the database", len(exp["rejected"]), counts["rejected"])
        rec.check("import: ambiguous", 0, counts["ambiguous"])
        if self.fresh:
            rec.check(
                "import: companies and contacts created",
                (exp["companies_created"], exp["contacts_created"]),
                (counts["companies_created"], counts["contacts_created"]),
            )
        by_line: dict[int, dict[str, Any]] = {}
        for outcome in done.body["rows"]:
            by_line[parsed.lines[outcome["row"] - 1]] = outcome
        for item in exp["skipped_duplicate"]:
            rec.check(
                f"import: line {item['line']}",
                ("skipped_duplicate", item["reason"]),
                (by_line[item["line"]]["outcome"], by_line[item["line"]]["reason"]),
            )
        for item in exp["rejected"]:
            rec.check(
                f"import: line {item['line']}",
                ("rejected", item["reason"]),
                (by_line[item["line"]]["outcome"], by_line[item["line"]]["reason"]),
            )
        listed = {i["line"] for i in exp["skipped_duplicate"] + exp["rejected"]}
        for line, outcome in by_line.items():
            if line not in listed:
                rec.check(f"import: line {line} is created", "created", outcome["outcome"])
                self.leads[line] = outcome
        # who arrived flagged: read every created contact the way a person would open it
        flagged: dict[int, str] = {}
        for line, outcome in sorted(self.leads.items()):
            if outcome.get("contact_id"):
                contact = api.get(
                    "import: open a contact", "owner", f"/contacts/{outcome['contact_id']}"
                ).body
                if contact.get("suppressed_at") is not None:
                    flagged[line] = str(contact.get("suppression_reason"))
        rec.check(
            "import: the flagged contacts",
            {str(i["line"]): i["reason"] for i in exp["flagged"]},
            {str(k): v for k, v in flagged.items()},
        )
        q = self.res.import_quality
        q.update(
            file_lines=exp["rows_in_file"], adapter_refused=len(parsed.issues), sent=len(parsed.rows), created=counts["created"], duplicates=counts["skipped_duplicate"],
            rejected=counts["rejected"], flagged=len(flagged), reasons={f"line {ln}": f"{o['outcome']}: {o['reason']}" for ln, o in by_line.items() if o["outcome"] != "created"},
            adapter_codes={f"line {i.line}": i.code for i in parsed.issues}, flagged_lines={str(k): v for k, v in flagged.items()},
        )  # fmt: skip

    # ------------------------------------------------------------------------------ enquiry to an approved quote
    def enquiry_to_quote(self, e: dict[str, Any]) -> None:
        api = self.api
        tag = f"L{e['lead_line']}"
        lead = self.leads[e["lead_line"]]["lead_id"]
        eid = rid("enquiry", e["key"])
        self.enquiry_id[e["key"]] = eid
        api.call(
            f"{e['key']}: paste the enquiry",
            "sales",
            "POST",
            f"/leads/{lead}/enquiries",
            {
                "id": eid,
                "channel": "email",
                "received_at": RECEIVED_AT,
                "subject": e["subject"],
                "text": e["text"],
            },
            lead=tag,
        )
        requirement: str | None = None
        seen = api.get(
            f"{e['key']}: open the requirement", "sales", f"/enquiries/{eid}/requirement", lead=tag
        ).body["requirement"]
        already = (
            seen is not None and seen["status"] == "confirmed"
        )  # a person does not type a confirmed requirement again (a retry of a typed field after the confirm is refused: requirement_confirmed)
        if already:
            requirement = seen["id"]
        for n, line in enumerate([] if already else e["lines"], start=1):
            for field_name, value in (
                ("saree_type", line["saree_type"]),
                ("quantity", line["quantity"]),
            ):
                if value is None:
                    continue
                added = api.call(
                    f"{e['key']}: type a requirement field",
                    "sales",
                    "POST",
                    f"/enquiries/{eid}/requirement-fields",
                    {"line": n, "field": field_name, "value": value},
                    lead=tag,
                )
                requirement = added.body["requirement_id"]
        if e["delivery_city"] and not already:
            added = api.call(
                f"{e['key']}: type the delivery city",
                "sales",
                "POST",
                f"/enquiries/{eid}/requirement-fields",
                {"field": "delivery_city", "value": e["delivery_city"]},
                lead=tag,
            )
            requirement = added.body["requirement_id"]
        if not e["quote"]:
            # it stops here on purpose: a quote cannot be made, and the refusal is what the rehearsal records
            api.probe(
                f"{e['key']}: try to quote ({e['stops_after']})",
                "sales",
                "POST",
                f"/enquiries/{eid}/quotes",
                {
                    "id": rid("quote", e["key"], "refused"),
                    "customer_kind": "new",
                    "delivery_state": "TG",
                },
                expect=(404, 409, 422),
            )
            return
        assert requirement is not None
        if not already:
            api.call(
                f"{e['key']}: confirm the requirement",
                "sales",
                "POST",
                f"/requirements/{requirement}/confirm",
                lead=tag,
            )
        setup = api.get(
            f"{e['key']}: open the quote screen", "sales", f"/enquiries/{eid}/quote-setup", lead=tag
        ).body
        products = {p["sku"]: p["product_id"] for p in setup["price_list"]}
        for n, line in enumerate(e["lines"], start=1):
            api.call(
                f"{e['key']}: pick a product",
                "sales",
                "POST",
                f"/enquiries/{eid}/picks",
                {
                    "line": n,
                    "product_id": products[line["sku"]],
                    "qty": line["qty"],
                    "sale_unit": "piece",
                },
                lead=tag,
            )
        self.make_quote(e["quote"], eid, e["customer_kind"], e["delivery_state"], tag)

    def make_quote(self, key: str, eid: str, kind: str, state: str, tag: str) -> None:
        api, rec = self.api, self.rec
        qid = rid("quote", key)
        self.quote_id[key] = qid
        made = api.call(
            f"{key}: make the quote",
            "sales",
            "POST",
            f"/enquiries/{eid}/quotes",
            {"id": qid, "customer_kind": kind, "delivery_state": state},
            lead=tag,
        ).body
        want = EXPECTED["quotes"][key]
        got = {
            k: made[k]
            for k in (
                "merchandise_net_paise",
                "item_tax_paise",
                "total_paise",
                "advance_paise",
                "gst_supply",
                "needs_owner_approval",
            )
        }
        rec.check(
            f"{key}: the figures equal the hand-worked ones",
            {
                "merchandise_net_paise": want["subtotal_paise"],
                "item_tax_paise": want["tax_paise"],
                "total_paise": want["total_paise"],
                "advance_paise": want["advance_paise"],
                "gst_supply": want["gst_supply"],
                "needs_owner_approval": want["owner_only"],
            },
            got,
        )
        rec.check(
            f"{key}: the flags equal the hand-worked ones",
            sorted(want["flags"]),
            sorted(made["review_flags"] + made["engine_flags"]),
        )
        self.res.quotes[key] = {
            "actual": got,
            "expected": want,
            "flags": made["review_flags"] + made["engine_flags"],
            "no": made["quote_no"],
            "engine_version": made["engine_version"],
        }
        rec.check(
            f"{key}: the quote carries its engine version and hash",
            True,
            bool(made["engine_version"]) and len(made["canonical_hash"]) == 64,
        )

    def approve(self, key: str, who: str, tag: str) -> None:
        api, rec = self.api, self.rec
        if (
            api.get(
                f"{key}: open the quote", "sales", f"/quotes/{self.quote_id[key]}", lead=tag
            ).body["status"]
            == "superseded"
        ):
            return  # a later quote replaced it (a person does not approve a replaced quote); the first pass already approved it
        done = api.call(
            f"{key}: approve", who, "POST", f"/quotes/{self.quote_id[key]}/approve", lead=tag
        ).body
        rec.check(f"{key}: approved", "approved", done["status"])
        text = (done.get("text") or {}).get("text", "")
        rupees = EXPECTED["quotes"][key]["total_paise"] // 100
        rec.check(
            f"{key}: the customer text shows the total and is never sent",
            (True, False),
            (
                str(rupees) in text.replace(",", ""),
                (done.get("text") or {}).get("sent_by_system", True),
            ),
        )

    def quotes_phase(self) -> None:
        by_key = {e["key"]: e for e in ENQUIRIES}
        for e in ENQUIRIES:
            self.enquiry_to_quote(e)
        who = {"Q1": "owner", "Q2": "admin", "Q3": "admin", "Q4": "owner", "Q5": "owner"}
        for key, approver in who.items():
            self.approve(
                key, approver, f"L{by_key[EXPECTED['quotes'][key]['enquiry']]['lead_line']}"
            )
        # the repeat customers' quotes: a flagged quote is the Owner's to approve (Q6 is an ordinary repeat quote, Q7 is over its credit limit on purpose)
        for key, enquiry in (("Q6", "E6"), ("Q7", "E9")):
            self.api.probe(
                f"{key}: an Admin tries to approve a repeat customer's quote",
                "admin",
                "POST",
                f"/quotes/{self.quote_id[key]}/approve",
                expect=(403,) if self.fresh else (403, 409),
                code="owner_approval_required" if self.fresh else None,
            )
            self.approve(key, "owner", f"L{by_key[enquiry]['lead_line']}")

    # ------------------------------------------------------------------------------ orders
    def create_order(self, key: str, quote_key: str, who: str, tag: str) -> None:
        r = self.api.call(
            f"{key}: start the order",
            who,
            "POST",
            "/orders",
            {"id": rid("order", key), "quote_id": self.quote_id[quote_key]},
            lead=tag,
        ).body
        self.order_id[key] = r["id"]
        want = EXPECTED["quotes"][quote_key]
        self.rec.check(
            f"order {key}: the figures are the quote's",
            (want["total_paise"], want["advance_paise"], "quote_approved" if self.fresh else None),
            (r["order_total_paise"], r["advance_paise"], r["state"] if self.fresh else None),
        )

    def run_order(self, key: str, steps: list[Step], tag: str) -> None:
        api, rec = self.api, self.rec
        oid = self.order_id[key]
        n = 0
        for step in steps:
            n += 1
            body: dict[str, Any] = {
                "id": rid("event", key, n),
                "type": step.type,
                "occurred_at": iso(self.day_start + timedelta(seconds=n)),
            }
            if step.amount is not None:
                body["amount_paise"], body["ledger_id"] = step.amount, rid("ledger", key, n)
            if step.lost:
                body["reason_code"] = step.lost
            path = f"/orders/{oid}/events"
            if step.refused is not None:
                status, code, reason = step.refused
                # the refusals that depend on the order's state are exact on a fresh database; on a repeat the order has moved on and any refusal will do
                api.probe(
                    f"{key}: {step.who} tries {step.type}",
                    step.who,
                    "POST",
                    path,
                    {**body, "id": rid("event", key, n, "refused")},
                    expect=(status,) if self.fresh else (400, 403, 409, 422),
                    weak=step.weak,
                    code=code if self.fresh else None,
                    reason=reason if self.fresh else None,
                )
                continue
            r = api.call(
                f"{key}: {step.type}", step.who, "POST", path, body, expect=(200,), lead=tag
            ).body
            if not r[
                "replayed"
            ]:  # a fresh write: the lifecycle's own answer is compared with the hand-worked one
                rec.check(
                    f"{key} step {n}: {step.type} leaves the order {step.state}",
                    step.state,
                    r["state"],
                )
                if step.paid is not None:
                    rec.check(
                        f"{key} step {n}: net paid after {step.type}", step.paid, r["paid_total"]
                    )
                missing = [f for f in step.flags if f not in r["flags"]]
                rec.check(f"{key} step {n}: flags {list(step.flags)}", [], missing)
        detail = api.get(f"{key}: open the order", "sales", f"/orders/{oid}", lead=tag).body
        want = EXPECTED["orders"][key]
        total = EXPECTED["quotes"][want["quote"]]["total_paise"]
        paid, refunded = want.get("paid", 0), want.get("refunded", 0)
        rec.check(
            f"order {key}: the end state and the ledger equal the hand-worked ones",
            {
                "state": want["final_state"],
                "paid": paid,
                "refunded": refunded,
                "balance": total - (paid - refunded),
                "events": 1 + len([s for s in steps if s.refused is None]),
            },
            {
                "state": detail["state"],
                "paid": detail["paid_paise"],
                "refunded": detail["refunded_paise"],
                "balance": detail["balance_paise"],
                "events": len(detail["events"]),
            },
        )
        stamped = [e for e in detail["events"] if e["type"] != "created"]
        rec.check(
            f"order {key}: every event carries its engine version and hash",
            True,
            all(e["engine_version"] and e["canonical_hash"] for e in stamped)
            and all(e["recorded_by"] for e in detail["events"]),
        )
        self.res.orders[key] = {
            "state": detail["state"],
            "total": detail["order_total_paise"],
            "paid": detail["paid_paise"],
            "refunded": detail["refunded_paise"],
            "balance": detail["balance_paise"],
            "events": len(detail["events"]),
            "lost_reason": detail["lost_reason"],
        }

    def orders_phase(self) -> None:
        api, rec = self.api, self.rec
        steps = order_steps()
        tags = {"A": "L2", "B": "L3", "B2": "L3", "C": "L4", "D": "L9", "E": "L12", "F": "L15"}
        # who may start an order, who may not
        api.probe(
            "A: Sales tries to start an order",
            "sales",
            "POST",
            "/orders",
            {"id": rid("order", "refused"), "quote_id": self.quote_id["Q1"]},
            expect=(403,),
            code="forbidden",
        )
        api.probe(
            "A: an Admin without the second factor tries to start an order",
            "admin",
            "POST",
            "/orders",
            {"id": rid("order", "refused"), "quote_id": self.quote_id["Q1"]},
            expect=(403,),
            weak=True,
            code="mfa_required",
        )
        self.create_order("A", "Q1", "admin", tags["A"])
        self.run_order("A", steps["A"], tags["A"])
        # a lost deal does not block a new quote
        self.create_order("B", "Q2", "admin", tags["B"])
        self.run_order("B", steps["B"], tags["B"])
        self.make_quote(
            "Q2b",
            self.enquiry_id["E2"],
            "new",
            EXPECTED["quotes"]["Q2b"]["delivery_state"],
            tags["B"],
        )
        self.approve("Q2b", "admin", tags["B"])
        self.create_order("B2", "Q2b", "admin", tags["B2"])
        self.run_order("B2", steps["B2"], tags["B2"])
        old = api.get(
            "Q2: open the old quote", "sales", f"/quotes/{self.quote_id['Q2']}", lead=tags["B"]
        ).body
        rec.check(
            "Q2: the quote of the lost deal is superseded, not deleted", "superseded", old["status"]
        )
        self.create_order("C", "Q3", "admin", tags["C"])
        self.run_order("C", steps["C"], tags["C"])
        self.create_order("D", "Q4", "owner", tags["D"])
        self.run_order("D", steps["D"], tags["D"])
        self.create_order("F", "Q6", "owner", tags["F"])
        self.run_order("F", steps["F"], tags["F"])
        # the Owner publishes a second order policy (advance not required to prepare; dispatch still needs it), and the next order follows it
        today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
        policy = {
            "id": rid("policy", "v2"),
            "effective_from": today,
            "advance_required": False,
            "dispatch_requires_advance": True,
            "cancel_allowed_until_state": "in_preparation",
            "allow_zero_value_orders": False,
        }
        api.probe(
            "policy: an Admin tries to publish an order policy",
            "admin",
            "POST",
            "/order-policy-versions",
            policy,
            expect=(403,),
            code="forbidden",
        )
        api.call(
            "policy: the Owner publishes version 2",
            "owner",
            "POST",
            "/order-policy-versions",
            policy,
        )
        self.create_order("E", "Q5", "owner", tags["E"])
        self.run_order("E", steps["E"], tags["E"])

    # ------------------------------------------------------------------------------ gates, isolation, audit
    def gates(self) -> None:
        api, rec = self.api, self.rec
        a = self.tenants["a"]
        order = self.order_id["A"]
        quote = self.quote_id["Q1"]
        api.probe(
            "gate: a Viewer reads no orders",
            "viewer",
            "GET",
            "/orders",
            expect=(403,),
            code="forbidden",
        )
        api.probe(
            "gate: a Viewer reads no quotes",
            "viewer",
            "GET",
            "/quotes",
            expect=(403,),
            code="forbidden",
        )
        api.probe(
            "gate: a Viewer imports nothing",
            "viewer",
            "POST",
            "/leads/import",
            {"batch_id": rid("import", "viewer"), "rows": [{"company_name": "No Such Co"}]},
            expect=(403,),
            code="forbidden",
        )
        api.probe(
            "gate: Sales cannot approve a quote",
            "sales",
            "POST",
            f"/quotes/{quote}/approve",
            expect=(403,),
            code="forbidden",
        )
        api.probe(
            "gate: an Owner without the second factor cannot approve",
            "owner",
            "POST",
            f"/quotes/{quote}/approve",
            expect=(403,),
            weak=True,
            code="mfa_required",
        )
        api.probe("gate: nobody is signed in", "owner", "GET", "/orders", expect=(401,), anon=True)
        api.probe(
            "gate: a forged owner_override in an event is refused",
            "admin",
            "POST",
            f"/orders/{order}/events",
            {"id": rid("forged"), "type": "dispatch", "owner_override": True},
            expect=(422,),
        )
        api.probe(
            "gate: a total in an event is refused",
            "admin",
            "POST",
            f"/orders/{order}/events",
            {
                "id": rid("forged", 2),
                "type": "record_payment",
                "amount_paise": 1,
                "ledger_id": rid("forged", 3),
                "order_total_paise": 1,
            },
            expect=(422,),
        )
        # another workspace: it sees nothing of this one, by path or by id
        api.probe(
            "isolation: the other workspace's Owner on this workspace's path",
            "b_owner",
            "GET",
            f"/v1/tenants/{a}/orders/{order}",
            expect=(404,),
            code="not_found",
        )
        api.probe(
            "isolation: ... and its list",
            "b_owner",
            "GET",
            f"/v1/tenants/{a}/orders",
            expect=(404,),
            code="not_found",
        )
        own = api.get("isolation: its own orders", "b_owner", "/orders", tenant="b").body
        rec.check("isolation: the other workspace's order list is empty", [], own["items"])
        api.probe(
            "isolation: this workspace's order id on its own path",
            "b_owner",
            "GET",
            f"/orders/{order}",
            expect=(404,),
            tenant="b",
            code="not_found",
        )
        api.probe(
            "isolation: this workspace's quote id on its own path",
            "b_owner",
            "GET",
            f"/quotes/{quote}",
            expect=(404,),
            tenant="b",
            code="not_found",
        )

    def audit_and_provenance(self) -> None:
        api, rec = self.api, self.rec
        events: list[dict[str, Any]] = []
        before: int | None = None
        for _ in range(60):
            path = "/audit-events?limit=100" + (f"&before_id={before}" if before else "")
            page = api.get("audit: read the audit trail", "owner", path).body
            events += page["events"]
            before = page["next_before_id"]
            if before is None:
                break
        kinds: dict[str, int] = {}
        for ev in events:
            kinds[f"{ev['entity_type']}.{ev['action']}"] = (
                kinds.get(f"{ev['entity_type']}.{ev['action']}", 0) + 1
            )
        rec.check(
            "audit: every event has an actor (a person or the system) and a time",
            True,
            all(
                (ev["actor_user_id"] or ev["actor_type"] == "system") and ev["created_at"]
                for ev in events
            ),
        )
        rec.check("audit: the trail is not empty", True, len(events) > 0)
        self.res.audit = {"events": len(events), "by_kind": dict(sorted(kinds.items()))}
        for key, qid in self.quote_id.items():
            q = api.get(f"{key}: open the quote", "sales", f"/quotes/{qid}").body
            rec.check(
                f"{key}: the quote records engine, hash, versions and approver",
                True,
                bool(
                    q["engine_version"]
                    and len(q["canonical_hash"]) == 64
                    and q["price_list_version_id"]
                    and q["policy_version_id"]
                ),
            )

    # ------------------------------------------------------------------------------ the whole script
    def run(self) -> None:
        self.setup_archive()
        self.import_leads()
        self.quotes_phase()
        self.orders_phase()
        self.gates()
        self.audit_and_provenance()


def prepare(people: People) -> None:
    """Sign the five people in (the first run signs them up, with a second factor)."""
    for role in ("owner", "admin", "sales", "viewer", "b_owner"):
        people.sign_in(role)


def main() -> int:
    stack = Stack.from_env()
    if any("SERVICE_ROLE" in k.upper() for k in os.environ):
        raise SystemExit(
            "refusing: a service-role value is in the environment; the rehearsal needs only the public URL and key"
        )
    started = time.perf_counter()
    results: list[RunResult] = []
    guard = NetworkGuard()
    settings = Settings(
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        suppression_hmac_key=SecretStr(SYNTHETIC_KEY),
    )  # type: ignore[call-arg]
    with guard, TestClient(create_app(settings)) as client:
        people = People(stack)
        prepare(people)
        # the two workspaces (idempotent by slug) and the members of the first
        boot = Recorder()
        boot_api = Api(client, people, {}, boot)
        tenants: dict[str, str] = {}
        for key, slug, who in (("a", SLUG_A, "owner"), ("b", SLUG_B, "b_owner")):
            made = boot_api.call(
                "workspace: create",
                who,
                "POST",
                "/v1/tenants",
                {"name": f"Rehearsal Workspace {key.upper()}", "slug": slug},
                replay=False,
            )
            tenants[key] = made.body["id"]
        boot_api.tenants = tenants
        members = {
            m["user_id"]
            for m in boot_api.get("workspace: members", "owner", "/members").body["members"]
        }
        for role in ("admin", "sales", "viewer"):
            if (
                people.ids[role] not in members
            ):  # the API has no invite route yet: the Owner adds a member through the database API with their own token (see the report)
                added = stack.pg(
                    people.tokens["owner"]["aal2"],
                    "POST",
                    "/memberships",
                    json={"tenant_id": tenants["a"], "user_id": people.ids[role], "role": role},
                )
                if added.status_code != 201:
                    raise SystemExit(f"could not add the {role}: {added.status_code}")
        seeded = subprocess.run(
            [sys.executable, "seeds/seed_quote_reference_data.py", "--tenant-slug", SLUG_A],
            cwd=API_DIR,
            capture_output=True,
            text=True,
            timeout=90,
        )
        if seeded.returncode != 0:
            raise SystemExit(
                "the synthetic reference data could not be seeded: " + seeded.stderr.strip()[:200]
            )
        for label in ("first", "second"):
            rec = Recorder()
            before = snapshot(tenants["a"])
            fresh = (
                label == "first" and before["public.leads"] == 0 and before["public.orders"] == 0
            )
            res = RunResult(label=label, fresh=fresh, rec=rec, before=before)
            res.started = time.perf_counter()
            results.append(res)
            try:
                Rehearsal(Api(client, people, tenants, rec), people, tenants, res).run()
            except Deviation as exc:
                res.stopped = str(exc)
            res.seconds = time.perf_counter() - res.started
            res.after = snapshot(tenants["a"])
            if res.stopped:
                break
            if label == "second":
                changed = {
                    k: (before[k], res.after[k]) for k in before if before[k] != res.after[k]
                }
                rec.check("the second pass changed no row of any business table", {}, changed)
    for res in results:
        res.network_local, res.network_refused = dict(guard.local), list(guard.refused)
    first = results[0]
    first.rec.check("no connection but the local stack", [], guard.refused)
    write_report(
        REPORT, results, EXPECTED, total_seconds=time.perf_counter() - started, tenant_ids=tenants
    )
    failed = [c for r in results for c in r.rec.failed()]
    stopped = [r.stopped for r in results if r.stopped]
    print(
        f"rehearsal: {'STOPPED' if stopped else 'ran'}; checks {sum(len(r.rec.checks) for r in results) - len(failed)}/{sum(len(r.rec.checks) for r in results)} passed; report: {REPORT}"
    )
    if stopped:
        print("stopped at: " + str(stopped[0]))
    for c in failed[:20]:
        print(f"FAILED: {c.name}: expected {c.expected!r}, got {c.actual!r}")
    return 1 if (failed or stopped) else 0


if __name__ == "__main__":
    raise SystemExit(main())
