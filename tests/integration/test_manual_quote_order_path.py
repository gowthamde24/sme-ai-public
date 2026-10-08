"""Manual-price quote, slice 4b (findings, part A): an APPROVED quote whose prices a person typed is accepted and turned into an order, and the order runs to closed_paid,
through OUR application on the real stack. A typed-price quote has no price list, no product, and may have no delivery state or GST label; the order path copies the quote's
TOTALS (create_order_from_quote reads the totals, the validity and the advance, nothing else), so nothing in it needs those. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

from typing import Any

import operator_sql
import pytest
from conftest import bearer
from crm_support import World
from evidence_support import pg, uid
from fastapi.testclient import TestClient
from order_support import OrderWorld
from quote_support import QuoteWorld, rpc


@pytest.fixture(scope="module")
def ow(eval_world: World) -> OrderWorld:
    qw = QuoteWorld(eval_world, eval_world.a, n_products=0)
    qw.policy_version(seller_state="TG", gst_rate_bps=500, new_net_days=10, repeat_net_days=45, repeat_credit_limit_paise=1_000_000_000)
    for code, name in (("OP1", "Order path type one"), ("OP2", "Order path type two")):
        r = rpc(qw.w, qw.owner.token, "save_item_type", p_tenant_id=qw.t.id, p_code=code, p_name=name, p_position=1, p_active=True, p_min_price_paise=None, p_max_price_paise=None)
        assert r.status_code == 200, r.text
    world = OrderWorld(qw)
    world.policy()
    return world


def h(user: Any) -> dict[str, str]:
    return bearer(user)


def enquiry(ow: OrderWorld) -> str:
    eid = uid()
    r = pg(ow.w.stack, ow.qw.sales, "POST", "/enquiries", json={"id": eid, "tenant_id": ow.t.id, "lead_id": ow.t.rows["leads"]["id"], "channel": "email",
           "received_at": "2026-10-05T10:00:00+00:00", "body": f"Synthetic enquiry {eid}"}, representation=False)  # fmt: skip
    assert r.status_code == 201, r.text
    return eid


def test_an_approved_typed_price_quote_becomes_an_order_and_the_order_runs_to_closed_paid(ow: OrderWorld, client: TestClient) -> None:
    base = f"/v1/tenants/{ow.t.id}"
    made = client.post(f"{base}/enquiries/{enquiry(ow)}/manual-quotes", json={"id": uid(), "customer_kind": "new", "lines": [
        {"item_type_code": "OP1", "qty": 3, "unit_price_paise": 250_000}, {"item_type_code": "OP2", "qty": 1, "unit_price_paise": 99_999}]}, headers=h(ow.qw.owner))  # fmt: skip
    assert made.status_code == 201, made.text
    quote = made.json()
    assert quote["pricing_kind"] == "manual" and quote["price_list_version_id"] is None and quote["delivery_state"] is None
    assert client.post(f"{base}/quotes/{quote['id']}/approve", headers=h(ow.qw.owner)).status_code == 200

    created = client.post(f"{base}/orders", json={"id": uid(), "quote_id": quote["id"]}, headers=h(ow.qw.owner))
    assert created.status_code == 201, created.text
    order = created.json()
    assert (order["order_total_paise"], order["advance_paise"], order["state"]) == (quote["total_paise"], quote["advance_paise"], "quote_approved") == (892_499, 446_250, "quote_approved")
    assert client.get(f"{base}/orders/{order['id']}", headers=h(ow.qw.sales)).status_code == 200
    assert order["id"] in [o["id"] for o in client.get(f"{base}/orders", headers=h(ow.qw.sales)).json()["items"]]
    assert [o["id"] for o in client.get(f"{base}/orders?quote_id={quote['id']}", headers=h(ow.qw.owner)).json()["items"]] == [order["id"]]

    total, advance, paid = quote["total_paise"], quote["advance_paise"], 0
    steps = [("sales", "send_quote", None), ("sales", "customer_accept", None), ("sales", "request_advance", None), ("admin", "record_payment", advance), ("sales", "start_preparation", None),
             ("sales", "dispatch", None), ("sales", "deliver", None), ("admin", "record_payment", total - advance)]  # fmt: skip
    for user, type_, amount in steps:
        body: dict[str, Any] = {"id": uid(), "type": type_}
        if amount is not None:
            body["amount_paise"], body["ledger_id"] = amount, uid()
        r = client.post(f"{base}/orders/{order['id']}/events", json=body, headers=h(ow.users[user]))
        assert r.status_code == 200, (type_, r.text)
        paid += amount or 0
        assert r.json()["paid_total"] == paid and r.json()["balance_due"] == total - paid
        ow.invariants(order["id"])
    assert r.json()["state"] == "closed_paid" and r.json()["outcome"] == "won"
    assert operator_sql.sql(f"select count(*) from public.orders where quote_id = '{quote['id']}'").strip() == "1"
