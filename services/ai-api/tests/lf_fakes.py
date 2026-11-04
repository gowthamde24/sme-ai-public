"""An in-memory Lead Finder database for the API tests (the real rules are proved by supabase/tests/database/150_lf_prospects.test.sql). Business types are DATA here: the pack ids come from the
pack files, never a literal in app code."""

# ruff: noqa: E501
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.lead_finder.errors import NotForThisBusinessError, ProspectStateError, SearchCapError
from app.tenancy.repository import RepositoryError

NOW = datetime(2026, 11, 4, 6, 0, tzinfo=UTC)   # 11:30 in India: inside the calling hours
TEXTILE_STOCK: list[dict[str, Any]] = [
    {"name": "Kanchi Pattu Bridal", "fabric": "kanchi_pattu", "occasions": ["wedding"], "price_paise": 850000, "stock_status": "in_stock", "item_kind": "saree", "sell_unit": "piece"},
    {"name": "Dharmavaram Silk Classic", "fabric": "dharmavaram_silk", "occasions": ["festival"], "price_paise": 450000, "stock_status": "in_stock", "item_kind": "saree", "sell_unit": "piece"},
    {"name": "Soft Silk Daily", "fabric": "soft_silk", "occasions": [], "price_paise": None, "stock_status": "few_left", "item_kind": "saree", "sell_unit": "piece"},
    {"name": "Banarasi Georgette", "fabric": "banarasi", "occasions": ["party"], "price_paise": 600000, "stock_status": "made_to_order", "item_kind": "saree", "sell_unit": "piece"},
]
MATERIAL_STOCK: list[dict[str, Any]] = [
    {"name": "OPC 53 Cement", "fabric": None, "occasions": [], "price_paise": 38000, "stock_status": "in_stock", "item_kind": "material", "sell_unit": "bag"},
    {"name": "TMT Steel 12mm", "fabric": None, "occasions": [], "price_paise": None, "stock_status": "in_stock", "item_kind": "material", "sell_unit": "kg"},
    {"name": "Paver Blocks Zigzag", "fabric": None, "occasions": [], "price_paise": 4200, "stock_status": "few_left", "item_kind": "material", "sell_unit": "piece"},
    {"name": "Red Clay Bricks", "fabric": None, "occasions": [], "price_paise": 900, "stock_status": "made_to_order", "item_kind": "material", "sell_unit": "piece"},
]


class FakeLeadFinderRepo:
    def __init__(self, pack: str | None, *, module_on: bool = True, real_data_open: bool = False, stock: list[dict[str, Any]] | None = None, customers: list[dict[str, Any]] | None = None,
                 plan_has_lead_finder: bool = True) -> None:
        self.pack = pack
        self.plan_has_lead_finder = plan_has_lead_finder   # AI Workforce (True) or Lead Desk (False)
        self.on = module_on
        self.real_data_open = real_data_open
        self._stock = stock if stock is not None else TEXTILE_STOCK
        self.customers = customers or []
        self.settings: dict[str, Any] = {"fit_bar": 70, "daily_call_cap": 20, "call_from_hour": 10, "call_to_hour": 19, "searches_per_day": 5, "results_per_search": 20, "updated_at": None}
        self.searches_rows: dict[str, dict[str, Any]] = {}
        self.rows: dict[str, dict[str, Any]] = {}
        self.leads: list[str] = []
        self.calls: list[tuple[str, Any]] = []

    def _gate(self) -> None:
        if not self.on:
            raise NotForThisBusinessError("SM971")

    def pack_id(self, token: str, tenant_id: uuid.UUID) -> str | None:
        return self.pack

    def module_on(self, token: str, tenant_id: uuid.UUID) -> bool:
        return self.on

    def entitled(self, token: str, tenant_id: uuid.UUID) -> bool:
        return self.plan_has_lead_finder

    def stock(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return list(self._stock)

    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._gate()
        return dict(self.settings)

    def settings_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        self._gate()
        self.settings.update(settings)
        self.settings["updated_at"] = NOW.isoformat()
        return dict(self.settings)

    def context(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._gate()
        today = sum(1 for s in self.searches_rows.values() if s["approved_at"] and s["state"] != "cancelled")
        approved: dict[str, int] = {}
        for r in self.rows.values():
            if r["owner_approved"] and r["search_id"]:
                approved[r["search_id"]] = approved.get(r["search_id"], 0) + 1
        return {"customers": self.customers, "companies": [], "real_data_open": self.real_data_open, "searches_today": today, "approved_by_search": approved,
                "ready_waiting": sum(1 for r in self.rows.values() if r["status"] == "call_ready"), "calls_today": sum(1 for r in self.rows.values() if r["last_contacted_at"]),
                "prospects": [{"place_id": r["place_id"], "phone_key": r["phone_key"], "name_key": r["name_key"], "area": r["area"], "suppressed": r["suppressed"], "last_contacted_at": r["last_contacted_at"]} for r in self.rows.values()]}

    def search_plan(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self._gate()
        row = {"id": args["p_id"], "query": args["p_query"], "area": args["p_area"], "category_hint": args["p_category_hint"], "max_results": args["p_max_results"], "provider": args["p_provider"],
               "sku": args["p_sku"], "est_cost_paise": args["p_est_cost_paise"], "cost_paise": 0, "state": "planned", "found": 0, "counts": None, "source_label": args["p_source_label"],
               "created_at": NOW.isoformat(), "approved_at": None, "finished_at": None}
        self.searches_rows[row["id"]] = row
        return dict(row)

    def search_approve(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        self._gate()
        row = self.searches_rows[str(search_id)]
        if row["state"] in ("approved", "done"):
            return dict(row)
        if row["state"] != "planned":
            raise ProspectStateError("SM973")
        if sum(1 for s in self.searches_rows.values() if s["approved_at"] and s["state"] != "cancelled") >= self.settings["searches_per_day"]:
            raise SearchCapError("SM972")
        row.update(state="approved", approved_at=NOW.isoformat())
        return dict(row)

    def search_cancel(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        row = self.searches_rows[str(search_id)]
        row["state"] = "cancelled"
        return dict(row)

    def search_finish(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID, items: list[dict[str, Any]], state: str, cost_paise: int, counts: dict[str, Any]) -> dict[str, Any]:
        row = self.searches_rows[str(search_id)]
        if row["provider"] == "places" and not self.real_data_open:
            raise RepositoryError("42501")
        if not self.real_data_open and any(i.get("phone") and not str(i["phone"]).startswith("+00") for i in items):
            raise RepositoryError("22023")
        n = 0
        for i in items:
            if any(r["place_id"] == i["place_id"] for r in self.rows.values()):
                continue
            pid = str(uuid.uuid4())
            self.rows[pid] = {**i, "id": pid, "search_id": str(search_id), "source": "google_maps" if row["provider"] == "places" else "fixture", "source_label": row["source_label"],
                              "owner_approved": False, "suppressed": False, "ask_after": None, "last_contacted_at": None, "lead_id": None, "qualification": None,
                              "created_at": NOW.isoformat(), "updated_at": NOW.isoformat(), "fetched_at": NOW.isoformat()}
            n += 1
        row.update(state=state, found=n, cost_paise=cost_paise, counts=counts, finished_at=NOW.isoformat())
        return dict(row)

    def search_get(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.searches_rows[str(search_id)])

    def searches(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return [dict(r) for r in self.searches_rows.values()][:limit]

    def prospects(self, token: str, tenant_id: uuid.UUID, status: str | None, search_id: uuid.UUID | None, limit: int, before: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]:
        rows = [r for r in self.rows.values() if (status is None or r["status"] == status) and (search_id is None or r["search_id"] == str(search_id))]
        return sorted(rows, key=lambda r: -(r["fit_score"] or -1))[:limit]

    def prospect_get(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.rows[str(prospect_id)])

    def stats(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID | None) -> dict[str, Any]:
        by: dict[str, int] = {}
        for r in self.rows.values():
            by[r["status"]] = by.get(r["status"], 0) + 1
        return {"total": len(self.rows), "by_status": by}

    def decisions_apply(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> int:
        n = 0
        for i in items:
            r = self.rows[str(i["id"])]
            if not r["suppressed"]:
                r.update(status=i["status"], decision_reason=i["decision_reason"])
                n += 1
        return n

    def act(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, action: str) -> dict[str, Any]:
        r = self.rows[str(prospect_id)]
        if action in ("not_interested", "do_not_call"):
            r.update(status="not_interested", suppressed=True, decision_reason="suppressed")
            return dict(r)
        if r["suppressed"]:
            raise ProspectStateError("SM973")
        if action == "call":
            r.update(status="call_ready", owner_approved=True, decision_reason="owner_approved")
        elif action == "later":
            r.update(status="needs_owner", decision_reason="asked_later")
        else:
            r.update(status="skipped", decision_reason="owner_skipped")
        return dict(r)

    def call_finish(self, token: str, tenant_id: uuid.UUID, prospect_id: uuid.UUID, call_id: uuid.UUID, result: str, qualification: dict[str, Any] | None) -> dict[str, Any]:
        r = self.rows[str(prospect_id)]
        self.calls.append((result, qualification))
        if r["status"] != "call_ready" or r["suppressed"]:
            raise ProspectStateError("SM973")
        if result in ("not_interested", "do_not_call"):
            r.update(status="not_interested", suppressed=True)
        elif result == "qualified":
            lead = str(uuid.uuid4())
            self.leads.append(lead)
            r.update(status="qualified", lead_id=lead)
        else:
            r.update(status="contacted")
        r.update(last_contacted_at=NOW.isoformat(), qualification=qualification)
        return dict(r)
