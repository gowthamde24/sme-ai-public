"""Shared helpers for the T009 quote tests on the real stack: build a workspace with products, a price list and a policy; make confirmed requirements with picks;
build the request the DATABASE expects (app.quote_build, read as the operator), run the REAL engine (through the adapter) on it, and call create_quote_draft with the
engine's own canonical text. Nothing here is the API (that comes later): it is the contract the API will follow.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import operator_sql
from crm_support import Tenant, World
from evidence_support import pg, uid

from app.quotes import engine_port

SAREE_TYPES = [
    "kanjivaram",
    "banarasi",
    "paithani",
    "chanderi",
    "patola",
    "mysore_silk",
    "dharmavaram_pattu",
    "other",
]


def rpc(w: World, token: str | None, name: str, **body: Any) -> httpx.Response:
    return httpx.post(
        f"{w.stack.rest}/rpc/{name}", headers=w.stack.headers(token), json=body, timeout=60
    )


def today() -> str:
    return operator_sql.sql("select app.quote_today()").strip()


class QuoteWorld:
    """One tenant of a World with products, a price list version and a policy version (effective today), and helpers to build requirements."""

    def __init__(self, w: World, tenant: Tenant, n_products: int = 8) -> None:
        self.w, self.t = w, tenant
        self.owner, self.admin, self.sales, self.viewer = (
            tenant.users[r] for r in ("owner", "admin", "sales", "viewer")
        )
        self.products: list[str] = []
        for i in range(n_products):
            pid = uid()
            r = pg(
                w.stack,
                self.owner,
                "POST",
                "/products",
                json={
                    "id": pid,
                    "tenant_id": tenant.id,
                    "sku": f"QT-{uuid.uuid4().hex[:8]}-{i}",
                    "name": f"Synthetic product {i}",
                    "category": "silk",
                },
            )
            assert r.status_code == 201, r.text
            self.products.append(pid)

    def add_product(self, sku: str, name: str | None = None, category: str = "silk") -> int:
        """A product with exactly this sku (the collation test needs skus that sort differently by locale and by code point). Returns its index."""
        pid = uid()
        r = pg(
            self.w.stack,
            self.owner,
            "POST",
            "/products",
            json={
                "id": pid,
                "tenant_id": self.t.id,
                "sku": sku,
                "name": name or f"Synthetic {sku}",
                "category": category,
            },
        )
        assert r.status_code == 201, r.text
        self.products.append(pid)
        return len(self.products) - 1

    # ------------------------------------------------------------------------------ reference data (aal2 Owner)
    def price_version(
        self, items: list[dict[str, Any]], version: str | None = None
    ) -> dict[str, Any]:
        r = rpc(
            self.w,
            self.owner.token,
            "create_price_list_version",
            p_version_id=version or uid(),
            p_tenant_id=self.t.id,
            p_effective_from=today(),
            p_items=items,
        )
        assert r.status_code == 200, r.text
        return dict(r.json())

    def policy_version(self, **over: Any) -> dict[str, Any]:
        policy = {
            "discount_ceiling_bps": 0,
            "shipping_flat_fee_paise": 0,
            "shipping_tax_bps": 0,
            "validity_days": 15,
            "new_advance_bps": 5000,
            "repeat_advance_bps": 2500,
            "new_net_days": 30,
            "repeat_net_days": 30,
            "seller_state": "TS",
            **over,
        }
        r = rpc(
            self.w,
            self.owner.token,
            "create_quote_policy_version",
            p_version_id=uid(),
            p_tenant_id=self.t.id,
            p_effective_from=today(),
            p_policy=policy,
        )
        assert r.status_code == 200, r.text
        return dict(r.json())

    def mapper_config(self, config: dict[str, Any], unit: str = "piece") -> dict[str, Any]:
        r = rpc(
            self.w,
            self.owner.token,
            "create_mapper_config_version",
            p_version_id=uid(),
            p_tenant_id=self.t.id,
            p_effective_from=today(),
            p_default_sale_unit=unit,
            p_config=config,
        )
        assert r.status_code == 200, r.text
        return dict(r.json())

    def item(
        self,
        i: int,
        price: int = 100000,
        moq: int = 4,
        tax: int = 500,
        breaks: list[dict[str, int]] | None = None,
        unit: str = "piece",
    ) -> dict[str, Any]:
        return {
            "product_id": self.products[i],
            "unit_price_paise": price,
            "minimum_order_quantity": moq,
            "tax_bps": tax,
            "sale_unit": unit,
            "breaks": breaks or [],
        }

    # ------------------------------------------------------------------------------ requirements
    def requirement(
        self,
        lines: list[tuple[str, int]],
        *,
        city: str | None = "Hyderabad",
        payment_terms: tuple[str, int, str] | None = None,
        confirm: bool = True,
        lead_id: str | None = None,
    ) -> tuple[str, str]:
        """A captured enquiry and a requirement whose lines a person added (saree type, quantity in pieces) and confirmed. Returns (enquiry id, requirement id)."""
        eid = uid()
        r = pg(self.w.stack, self.sales, "POST", "/enquiries", json={"id": eid, "tenant_id": self.t.id, "lead_id": lead_id or self.t.rows["leads"]["id"], "channel": "email",
               "received_at": "2026-10-05T10:00:00+00:00", "body": f"Synthetic enquiry {eid}"}, representation=False)  # fmt: skip
        assert r.status_code == 201, r.text
        requirement = ""
        for n, (saree, qty) in enumerate(lines, start=1):
            for key, kw in (
                ("saree_type", {"p_value_code": saree}),
                ("quantity", {"p_value_int": qty, "p_basis": "piece"}),
            ):
                a = rpc(
                    self.w,
                    self.sales.token,
                    "add_requirement_field",
                    p_enquiry_id=eid,
                    p_line=n,
                    p_key=key,
                    **kw,
                )
                assert a.status_code == 200, a.text
                requirement = a.json()["requirement_id"]
        if city:
            assert (
                rpc(
                    self.w,
                    self.sales.token,
                    "add_requirement_field",
                    p_enquiry_id=eid,
                    p_line=None,
                    p_key="delivery_city",
                    p_value_text=city,
                ).status_code
                == 200
            )
        if payment_terms:
            code, number, basis = payment_terms
            assert (
                rpc(
                    self.w,
                    self.sales.token,
                    "add_requirement_field",
                    p_enquiry_id=eid,
                    p_line=None,
                    p_key="payment_terms",
                    p_value_code=code,
                    p_value_int=number,
                    p_basis=basis,
                ).status_code
                == 200
            )
        if confirm:
            c = rpc(self.w, self.sales.token, "confirm_requirement", p_requirement_id=requirement)
            assert c.status_code == 200, c.text
        return eid, requirement

    def pick(
        self,
        requirement: str,
        line: int,
        product_index: int,
        qty: int,
        unit: str = "piece",
        token: str | None = None,
    ) -> httpx.Response:
        return rpc(
            self.w,
            token or self.sales.token,
            "pick_requirement_line_product",
            p_requirement_id=requirement,
            p_line=line,
            p_product_id=self.products[product_index],
            p_qty=qty,
            p_sale_unit=unit,
        )

    # ------------------------------------------------------------------------------ the database's build, the real engine, the call
    def versions(self) -> tuple[str, str]:
        raw = operator_sql.sql(
            f"select app.quote_active_price_version('{self.t.id}', app.quote_today()) || ',' || app.quote_active_policy_version('{self.t.id}', app.quote_today())"
        )
        price, policy = raw.strip().split(",")
        return price, policy

    def build(self, requirement: str, kind: str = "new") -> dict[str, Any]:
        price, policy = self.versions()
        raw = operator_sql.sql(
            f"select app.quote_build('{self.t.id}', '{requirement}', app.quote_today(), '{kind}', '{price}', '{policy}')::text"
        )
        return dict(json.loads(raw))

    def engine(self, request: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        """Run the REAL engine on the request; return (canonical request text, canonical result text, result)."""
        result = engine_port.run_quote(request)
        assert not engine_port.is_rejected(result), result
        return engine_port.canonical_json(request), engine_port.canonical_json(result), result

    def create(
        self,
        requirement: str,
        kind: str = "new",
        state: str = "TS",
        quote: str | None = None,
        token: str | None = None,
    ) -> httpx.Response:
        request = self.build(requirement, kind)["request"]
        request_text, result_text, _ = self.engine(request)
        return rpc(self.w, token or self.sales.token, "create_quote_draft", p_quote_id=quote or uid(), p_requirement_id=requirement, p_customer_kind=kind, p_delivery_state=state,
                   p_engine_version=engine_port.engine_version(), p_request_text=request_text, p_result_text=result_text)  # fmt: skip

    def approve(self, quote: str, token: str | None = None) -> httpx.Response:
        h = operator_sql.sql(
            f"select canonical_hash from public.quotes where id = '{quote}'"
        ).strip()
        return rpc(
            self.w,
            token or self.owner.token,
            "approve_quote",
            p_quote_id=quote,
            p_recomputed_hash=h,
        )

    def withdraw(
        self, quote: str, code: str = "price_changed", token: str | None = None
    ) -> httpx.Response:
        return rpc(
            self.w,
            token or self.owner.token,
            "withdraw_approved_quote",
            p_quote_id=quote,
            p_code=code,
        )

    def quote_row(self, quote: str) -> dict[str, Any]:
        raw = operator_sql.sql(
            f"select row_to_json(q) from (select status, total_paise, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, advance_paise, balance_paise, needs_owner_approval, engine_flags::text as engine_flags, review_flags::text as review_flags, quote_no from public.quotes where id = '{quote}') q"
        )
        return dict(json.loads(raw))
