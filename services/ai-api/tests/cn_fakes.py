"""In-memory fakes of the four job-CN repositories (sites, dues, material quotes, deliveries), for the route tests (no database). The material fake builds its request from the golden vector of the calculator's
worked example and computes the "database's" core with the REAL calculator, so a route test exercises the real engine; a test that wants a disagreement edits the core."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from app.materials import engine_port

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "packages" / "quote-engine" / "tests" / "fixtures" / "construction_vectors.json").read_text(encoding="utf-8"))["vectors"]
WORKED = next(v for v in VECTORS if v["name"].startswith("worked_example"))["request"]
NOW = "2026-10-14T09:00:00+00:00"
CORE_KEYS = ("lines", "trips", "totals", "payment_terms", "valid_until")
ITEM_ID = uuid.UUID(int=0x1111)


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.error: Exception | None = None

    def _go(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.error is not None:
            raise self.error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]


def site_row(site_id: uuid.UUID, **over: Any) -> dict[str, Any]:
    return {
        "id": str(site_id), "company_id": str(uuid.UUID(int=0xC0)), "name": "Kukatpally villa", "address_line": "Plot 4", "city": "Hyderabad", "pin": "500072", "map_lat": 17.412345, "map_lng": 78.434567,
        "distance_km": 22, "lane_width_ft": 14, "night_delivery": False, "unloading_help": True, "access_notes": None, "site_contact_id": None, "active": True, "created_at": NOW, "updated_at": NOW, **over,
    }  # fmt: skip


class FakeSites(_Recorder):
    def __init__(self) -> None:
        super().__init__()
        self.rows: dict[str, dict[str, Any]] = {}

    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("save", token, args)
        created = args["p_site_id"] not in self.rows
        row = site_row(uuid.UUID(args["p_site_id"]), company_id=args["p_company_id"], name=args["p_name"], pin=args["p_pin"], site_contact_id=args["p_site_contact_id"], active=args["p_active"])
        self.rows[args["p_site_id"]] = row
        return {**row, "created": created}

    def get(self, token: str, tenant_id: uuid.UUID, site_id: uuid.UUID) -> dict[str, Any]:
        self._go("get", token, site_id)
        if str(site_id) not in self.rows:
            from app.crm.repository import NotFoundError

            raise NotFoundError("23503")
        return self.rows[str(site_id)]

    def list(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, include_inactive: bool, limit: int, after: Any) -> list[dict[str, Any]]:
        self._go("list", token, company_id, include_inactive, limit, after)
        return [r for r in self.rows.values() if (include_inactive or r["active"]) and (company_id is None or r["company_id"] == str(company_id))][:limit]


STATEMENT = {
    "company_id": str(uuid.UUID(int=0xC0)), "as_of": "2026-10-14", "invoiced_paise": 3600000, "paid_paise": 1200000, "outstanding_paise": 2400000, "credit_paise": 0, "overdue_paise": 1800000,
    "ageing": {"d0_30": 600000, "d31_60": 0, "d61_90": 1800000, "d90_plus": 0},
    "open_invoices": [{"invoice_id": str(uuid.UUID(int=0x1)), "invoice_no": "INV-2", "invoice_date": "2026-08-01", "due_date": "2026-09-01", "amount_paise": 2000000, "open_paise": 1800000, "age_days": 74, "overdue_days": 43}],
    "credit_limit_paise": None, "over_limit": False,
}  # fmt: skip


class FakeDues(_Recorder):
    def invoice_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("invoice_record", token, args)
        return {"invoice_id": args["p_invoice_id"], "replayed": False}

    def invoices_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        self._go("invoices_import", token, batch_id, rows)
        # every 7th row of a part is skipped, so the offsets of the row numbers are visible
        return {"batch_id": str(batch_id), "added": len(rows) - len(rows) // 7, "skipped": [{"row": i, "reason": "invoice_number_used"} for i in range(7, len(rows) + 1, 7)]}

    def invoice_void(self, token: str, tenant_id: uuid.UUID, invoice_id: uuid.UUID) -> dict[str, Any]:
        self._go("invoice_void", token, invoice_id)
        return {"invoice_id": str(invoice_id), "voided": True}

    def payment_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("payment_record", token, args)
        return {"payment_id": args["p_payment_id"], "replayed": args["p_amount_paise"] == 777}

    def payment_void(self, token: str, tenant_id: uuid.UUID, payment_id: uuid.UUID) -> dict[str, Any]:
        self._go("payment_void", token, payment_id)
        return {"payment_id": str(payment_id), "voided": True}

    def credit_limit_set(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, limit_paise: int | None) -> dict[str, Any]:
        self._go("credit_limit_set", token, company_id, limit_paise)
        return {"company_id": str(company_id), "limit_paise": limit_paise}

    def statement(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, as_of: date | None) -> dict[str, Any]:
        self._go("statement", token, company_id, as_of)
        return {**STATEMENT, "company_id": str(company_id)}

    def summary(self, token: str, tenant_id: uuid.UUID, as_of: date | None, limit: int, after: Any) -> list[dict[str, Any]]:
        self._go("summary", token, as_of, limit, after)
        return [{**STATEMENT, "company_name": "Company a"}]

    def credit_check(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, amount_paise: int) -> dict[str, Any]:
        self._go("credit_check", token, company_id, amount_paise)
        return {"company_id": str(company_id), "credit_limit_paise": 2500000, "outstanding_paise": 2400000, "new_amount_paise": amount_paise, "would_be_paise": 2400000 + amount_paise, "has_limit": True, "exceeded": 2400000 + amount_paise > 2500000}

    def ledger(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, limit: int) -> dict[str, Any]:
        self._go("ledger", token, company_id, limit)
        return {
            "invoices": [{"id": str(uuid.UUID(int=1)), "invoice_no": "INV-1", "invoice_date": "2026-06-01", "due_date": "2026-07-01", "amount_paise": 1000000, "order_id": None, "source": "manual", "voided": False}],
            "payments": [{"id": str(uuid.UUID(int=2)), "received_on": "2026-09-01", "amount_paise": 1200000, "method": "cash", "invoice_id": None, "voided": False}],
        }  # fmt: skip


def build_worked(picks: list[dict[str, Any]], site_id: uuid.UUID | None) -> dict[str, Any]:
    """What the database would return for the worked example: the request, and its OWN computation (here the real calculator's, standing in)."""
    request = copy.deepcopy(WORKED)
    result = engine_port.calculate(request)
    return {
        "request": request, "core": {k: result[k] for k in CORE_KEYS}, "flag_list": result["flags"]["reasons"], "as_of": request["as_of"], "valid_until": result["valid_until"],
        "due_date": result["payment_terms"]["due_date"], "picks": [{"line_no": p["line_no"], "item_id": p["item_id"], "area_x100": 100000, "area_unit": "sq_ft"} for p in picks],
        "lead_id": str(uuid.UUID(int=0x1E)), "enquiry_id": str(uuid.UUID(int=0xE)), "company_id": str(uuid.UUID(int=0xC0)), "site_id": str(site_id) if site_id else None, "policy_version_id": str(uuid.UUID(int=0x9)),
    }  # fmt: skip


def item_row(item_id: uuid.UUID, **over: Any) -> dict[str, Any]:
    return {
        "id": str(item_id), "name": "Paver block 80 mm grey", "fabric": None, "colours": None, "zari": "none", "border": None, "occasions": [], "price_band": None, "price_paise": 6500, "stock_status": "in_stock",
        "active": False, "item_kind": "material", "sell_unit": "sq_ft", "area_unit": "sq_ft", "created_at": NOW, "updated_at": NOW, "photos": [], **over,
    }  # fmt: skip


INPUTS = {"price_paise": 6500, "gst_bps": 1800, "hsn": "68101990", "pieces_per_area_x1000": 4500, "pieces_per_pallet": 500, "min_order_qty": None, "lead_days": 3, "missing_for_area": [], "missing_for_quantity": []}


class FakeMaterials(_Recorder):
    def __init__(self) -> None:
        super().__init__()
        self.quotes: dict[str, dict[str, Any]] = {}
        self.tamper_core = False
        self.status_after_approve = "approved"

    def policy_create(self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID, effective_from: date, policy: dict[str, Any]) -> dict[str, Any]:
        self._go("policy_create", token, version_id, effective_from, policy)
        return {"version_id": str(version_id), "version_no": 2, "effective_from": effective_from.isoformat(), "replayed": False}

    def policy_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("policy_get", token)
        return {
            "current": {"version_id": str(uuid.UUID(int=9)), "version_no": 2, "effective_from": "2026-10-14", "policy": WORKED["policy"]},
            "versions": [{"version_id": str(uuid.UUID(int=9)), "version_no": 2, "effective_from": "2026-10-14", "created_at": NOW}],
        }  # fmt: skip

    def item_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("item_save", token, args)
        return {"id": args["p_item_id"], "active": args["p_active"], "created": True}

    def item_inputs(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> dict[str, Any]:
        self._go("item_inputs", token, item_id)
        return INPUTS

    def quote_build(self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, picks: list[dict[str, Any]], site_id: uuid.UUID | None) -> dict[str, Any]:
        self._go("quote_build", token, requirement_id, picks, site_id)
        built = build_worked(picks, site_id)
        if self.tamper_core:
            built["core"]["totals"] = {**built["core"]["totals"], "total": built["core"]["totals"]["total"] + 1}
        return built

    def quote_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("quote_draft", token, args)
        request = json.loads(args["p_request_text"])
        result = json.loads(args["p_result_text"])
        t = result["totals"]
        self.quotes[args["p_quote_id"]] = {
            "id": args["p_quote_id"], "quote_no": len(self.quotes) + 1, "requirement_id": args["p_requirement_id"], "enquiry_id": str(uuid.UUID(int=0xE)), "lead_id": str(uuid.UUID(int=0x1E)), "site_id": args["p_site_id"],
            "status": "draft", "policy_version_id": str(uuid.UUID(int=9)), "engine_version": args["p_engine_version"], "canonical_hash": result["canonical_hash"], "as_of": request["as_of"], "valid_until": result["valid_until"],
            "due_date": result["payment_terms"]["due_date"], "trips": result["trips"], "material_paise": t["material"], "transport_paise": t["transport"], "handling_paise": t["handling"], "laying_paise": t["laying"],
            "tax_paise": t["tax"], "total_paise": t["total"], "advance_paise": result["payment_terms"]["advance_amount"], "balance_paise": result["payment_terms"]["balance"], "flags": [f["code"] for f in result["flags"]["reasons"]],
            "needs_owner_approval": bool(result["flags"]["reasons"]), "created_at": NOW, "approved_at": None, "rejected_at": None, "reject_code": None, "request_text": args["p_request_text"], "result_text": args["p_result_text"],
            "lines": [
                {"line_no": 1, "catalogue_item_id": str(ITEM_ID), "name": "Paver block 80 mm grey", "mode": "area", "sold_per": "sq_ft", "unit_price_paise": 6500, "gst_bps": 1800, "hsn": "68101990", "area_x100": 100000,
                 "area_unit": "sq_ft", "pieces": 4725, "pallets": 10, "delivered_area_x100": 105000, "billed_quantity": 105000, "material_paise": t["material"], "tax_paise": result["lines"][0]["tax"]}
            ],
        }  # fmt: skip
        return {"quote_id": args["p_quote_id"], "quote_no": 1, "status": "draft", "needs_owner_approval": False, "canonical_hash": result["canonical_hash"], "replayed": False}

    def quote_approve(self, token: str, quote_id: uuid.UUID, recomputed_hash: str) -> dict[str, Any]:
        self._go("quote_approve", token, quote_id, recomputed_hash)
        self.quotes[str(quote_id)]["status"] = self.status_after_approve
        self.quotes[str(quote_id)]["approved_at"] = NOW
        return {"quote_id": str(quote_id), "status": "approved", "replayed": False}

    def quote_reject(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]:
        self._go("quote_reject", token, quote_id, code)
        self.quotes[str(quote_id)].update(status="rejected", rejected_at=NOW, reject_code=code)
        return {"quote_id": str(quote_id), "status": "rejected", "replayed": False}

    def quote_get(self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]:
        self._go("quote_get", token, quote_id)
        if str(quote_id) not in self.quotes:
            from app.crm.repository import NotFoundError

            raise NotFoundError("23503")
        return self.quotes[str(quote_id)]

    def quotes_list(self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        self._go("quotes_list", token, requirement_id, limit)
        return list(self.quotes.values())[:limit]

    def order_create(self, token: str, order_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]:
        self._go("order_create", token, order_id, quote_id)
        return {"order_id": str(order_id), "order_no": 3, "state": "quote_approved", "replayed": False, "credit": {"credit_limit_paise": 2500000, "outstanding_paise": 24000000, "would_be_paise": 28439750, "exceeded": True}}


def trip_row(trip_id: uuid.UUID, **over: Any) -> dict[str, Any]:
    return {
        "id": str(trip_id), "order_id": str(uuid.UUID(int=0x0D)), "order_no": 2, "trip_no": 1, "challan_no": 1, "site_id": str(uuid.UUID(int=0x5)), "site_contact_id": str(uuid.UUID(int=0xC1)), "planned_date": "2026-10-20",
        "vehicle_no": "TS09 AB 1234", "driver_name": "Ramesh", "driver_phone": "+91 98480 11111", "status": "planned", "problem_code": None, "created_at": NOW, "updated_at": NOW, "delivered_at": None,
        "lines": [{"quote_line_id": str(uuid.UUID(int=0x71)), "line_no": 1, "name": "Paver block 80 mm grey", "quantity": 2500, "unit": "piece"}], "proof": None, **over,
    }  # fmt: skip


class FakeDeliveries(_Recorder):
    def __init__(self) -> None:
        super().__init__()
        self.trips: dict[str, dict[str, Any]] = {}
        self.deliver_error: Exception | None = None
        self.notify_status = ("queued", "auto_allowed")

    def plan(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("plan", token, args)
        row = trip_row(uuid.UUID(args["p_trip_id"]), vehicle_no=args["p_vehicle_no"], driver_name=args["p_driver_name"], planned_date=args["p_planned_date"])
        self.trips[args["p_trip_id"]] = row
        return {**row, "replayed": False}

    def update(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("update", token, args)
        row = self.trips[args["p_trip_id"]]
        row.update(planned_date=args["p_planned_date"], vehicle_no=args["p_vehicle_no"])
        return row

    def set_status(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID, status: str, problem_code: str | None) -> dict[str, Any]:
        self._go("set_status", token, trip_id, status, problem_code)
        self.trips[str(trip_id)].update(status=status, problem_code=problem_code)
        return {**self.trips[str(trip_id)], "replayed": False}

    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        self._go("ensure_bucket", token)
        return f"pod-{tenant_id}"

    def deliver(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("deliver", token, args)
        if self.deliver_error is not None:
            raise self.deliver_error
        row = self.trips[args["p_trip_id"]]
        row.update(
            status="delivered", delivered_at=NOW,
            proof={"received_by": args["p_received_by"], "recorded_at": NOW, "bucket": f"pod-{uuid.UUID(int=0xA)}", "path": f"{args['p_trip_id']}/{args['p_photo_id']}.jpg", "width": args["p_width"], "height": args["p_height"], "bytes": args["p_bytes"]},
        )  # fmt: skip
        return {**row, "replayed": False}

    def get(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID) -> dict[str, Any]:
        self._go("get", token, trip_id)
        if str(trip_id) not in self.trips:
            from app.crm.repository import NotFoundError

            raise NotFoundError("23503")
        return {**self.trips[str(trip_id)], "events": [{"seq": 1, "from": None, "to": "planned", "problem_code": None, "recorded_at": NOW}]}

    def list(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID | None, on: date | None, status: str | None, limit: int) -> list[dict[str, Any]]:
        self._go("list", token, order_id, on, status, limit)
        return [t for t in self.trips.values() if status is None or t["status"] == status][:limit]

    def challan(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID) -> dict[str, Any]:
        self._go("challan", token, trip_id)
        return {
            "challan_no": 1, "trip_no": 1, "order_no": 2, "date": "2026-10-20", "business": "Tenant A", "customer": "Company a", "site": {"name": "Kukatpally villa", "address_line": "Plot 4", "city": "Hyderabad", "pin": "500072", "access_notes": None},
            "site_contact": {"name": "Site supervisor", "phone": "+00 90000 00051"}, "vehicle_no": "TS09 AB 1234", "driver_name": "Ramesh", "driver_phone": "+91 98480 11111", "status": "planned",
            "lines": [{"line_no": 1, "description": "Paver block 80 mm grey", "quantity": 2500, "unit": "piece", "hsn": "68101990"}], "received_by": None, "received_at": None,
        }  # fmt: skip

    def notify(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("notify", token, args)
        return {"id": args["p_message_id"], "status": self.notify_status[0], "reason": self.notify_status[1], "replayed": False}


def stored_quote(quote_id: uuid.UUID, **over: Any) -> dict[str, Any]:
    """A drafted quote through the fake, for tests that need one without calling the draft route."""
    fake = FakeMaterials()
    fake.quote_draft("t", {"p_quote_id": str(quote_id), "p_requirement_id": str(uuid.UUID(int=0xAA)), "p_site_id": None, "p_engine_version": "1.0.0",
                           "p_request_text": engine_port.canonical_json(WORKED), "p_result_text": engine_port.canonical_json(engine_port.calculate(WORKED))})  # fmt: skip
    return {**fake.quotes[str(quote_id)], **over}

