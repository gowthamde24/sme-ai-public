"""Money at a glance and low stock (app v4, part 6; migration 20261231340000, proven by pgTAP 181): who may read which, and the answers are passed on as they are."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import date
from typing import Any

from tests.fakes import TENANT_A, auth, make_client


class FakeGlance:
    def money(self, token: str, tenant_id: Any, as_of: date | None) -> dict[str, Any]:
        return {"as_of": str(as_of or "2026-11-06"), "owed_paise": 1200000, "overdue_paise": 700000, "customers_owing": 1, "customers_overdue": 1, "paid_this_month_paise": 300000, "top": [], "complete": True}

    def low_stock(self, token: str, tenant_id: Any) -> list[dict[str, Any]]:
        return [{"id": "x", "name": "Red Kanchi silk", "stock_status": "few_left", "asked_this_week": 3, "asked_is_approximate": True}]


def test_money_for_sellers_and_low_stock_for_every_member() -> None:
    client, _ = make_client(glance=FakeGlance())
    base = f"/v1/tenants/{TENANT_A.id}"
    money = client.get(f"{base}/money/summary?as_of=2026-11-06", headers=auth("a_sales"))
    assert money.status_code == 200 and money.json()["owed_paise"] == 1200000 and money.json()["as_of"] == "2026-11-06"
    assert client.get(f"{base}/money/summary", headers=auth("a_viewer")).status_code == 403, "a Viewer reads no money"
    stock = client.get(f"{base}/catalogue/low-stock", headers=auth("a_viewer"))
    assert stock.status_code == 200 and stock.json() == {"items": [{"id": "x", "name": "Red Kanchi silk", "stock_status": "few_left", "asked_this_week": 3, "asked_is_approximate": True}], "counts_available": False}
    off, _ = make_client()
    assert off.get(f"{base}/catalogue/low-stock", headers=auth("a_owner")).json()["error"]["code"] == "glance_unavailable"
