"""An in-memory QuotesRepository for the route tests. The real rules are the database's (pgTAP 57-59) and the real-stack API tests (tests/integration/test_quote_api.py);
this fake only holds the rows the service reads and records what the service writes, so the route tests can check WHAT was sent to the database and with whose token."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import uuid
from datetime import UTC, date, datetime
from typing import Any

from app.enquiries.repository import QuoteDependsError
from app.quotes import engine_port
from app.quotes.errors import (
    OwnerApprovalRequiredError,
    QuoteInputMissingError,
    QuoteMismatchError,
    QuoteNotDraftError,
    QuoteStaleError,
    RequirementNotConfirmedError,
)

TODAY = date(2026, 10, 6)
PV = uuid.UUID(int=0x701)  # the price list version in force
POL = uuid.UUID(int=0x702)
P1, P2, P3 = (uuid.UUID(int=0x501 + i) for i in range(3))
ENQ = uuid.UUID(int=0xE01)
RID = uuid.UUID(int=0xE02)
LEAD = uuid.UUID(int=0x1EAD)
QID = uuid.UUID(int=0x9001)

ITEM_ROWS: list[dict[str, Any]] = [
    {
        "product_id": str(P1),
        "sku": "SYN-K",
        "name": "Synthetic kanjivaram",
        "sale_unit": "piece",
        "unit_price_paise": 400000,
        "minimum_order_quantity": 4,
        "tax_bps": 500,
        "breaks": [{"min_qty": 10, "unit_price_paise": 380000}],
    },
    {
        "product_id": str(P2),
        "sku": "SYN-B",
        "name": "Synthetic banarasi",
        "sale_unit": "piece",
        "unit_price_paise": 310000,
        "minimum_order_quantity": 4,
        "tax_bps": 1200,
        "breaks": [],
    },
    {
        "product_id": str(P3),
        "sku": "SYN-O",
        "name": "Synthetic other",
        "sale_unit": "set",
        "unit_price_paise": 280000,
        "minimum_order_quantity": 1,
        "tax_bps": 500,
        "breaks": [],
    },
]
POLICY_ROW: dict[str, Any] = {
    "id": str(POL), "version_no": 1, "effective_from": "2026-10-01", "discount_ceiling_bps": 0, "shipping_flat_fee_paise": 5000, "shipping_free_above_paise": None, "shipping_tax_bps": 1800,
    "validity_days": 15, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "net_days": 30, "tax_mode": "exclusive", "rounding_mode": "half_up",
    "repeat_credit_limit_paise": 250000, "seller_state": "TG", "required_inputs": ["delivery_state"],
}  # fmt: skip
PRODUCTS: list[dict[str, Any]] = [
    {"id": str(P1), "sku": "SYN-K", "category": "kanjivaram", "attributes": {}, "active": True},
    {"id": str(P2), "sku": "SYN-B", "category": "banarasi", "attributes": {}, "active": True},
    {"id": str(P3), "sku": "SYN-O", "category": "paithani", "attributes": {}, "active": True},
]
MAPPER_ROW = {
    "id": str(uuid.UUID(int=0x703)), "default_sale_unit": "piece",
    "config": {"saree_type_to_categories": {"kanjivaram": ["kanjivaram"], "banarasi": ["banarasi"]}, "fabric_to_values": {}, "colour_to_values": {}},
}  # fmt: skip


def field(line: int | None, key: str, state: str = "confirmed", **value: Any) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "line_no": line,
        "field_key": key,
        "state": state,
        "value_code": None,
        "value_int": None,
        "value_date": None,
        "value_text": None,
        "basis": None,
        **value,
    }


def two_line_rows() -> list[dict[str, Any]]:
    return [
        field(1, "saree_type", value_code="kanjivaram"), field(1, "quantity", value_int=20, basis="piece"),
        field(2, "saree_type", value_code="banarasi"), field(2, "quantity", value_int=5, basis="piece"),
    ]  # fmt: skip


def requirement(status: str = "confirmed") -> dict[str, Any]:
    return {"id": str(RID), "status": status}


def quote_from(
    request: dict[str, Any], result: dict[str, Any], **over: Any
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """A stored quote row and its lines, made from an engine result the way the database stores them (figures are the engine's; this is a FAKE, not a verifier)."""
    t, pt = result["totals"], result["payment_terms"]
    row: dict[str, Any] = {
        "id": str(QID), "quote_no": 1, "requirement_id": str(RID), "enquiry_id": str(ENQ), "lead_id": str(LEAD), "status": "draft",
        "price_list_version_id": str(PV), "policy_version_id": str(POL), "engine_version": result["engine_version"], "canonical_hash": result["canonical_hash"],
        "customer_kind": request["customer"]["kind"], "delivery_state": "MH", "gst_supply": "inter_state", "as_of": request["as_of"], "valid_until": result["valid_until"],
        "due_date": pt["due_date"], "merchandise_net_paise": t["net"], "item_tax_paise": t["item_tax"], "shipping_net_paise": t["shipping"], "shipping_tax_paise": t["shipping_tax"],
        "total_paise": t["total"], "advance_paise": pt["advance_amount"], "balance_paise": pt["balance"], "engine_flags": [], "review_flags": [], "needs_owner_approval": False,
        "created_by": None, "created_at": "2026-10-06T05:00:00+00:00", "approved_by": None, "approved_at": None, "rejected_by": None, "rejected_at": None, "reject_code": None,
        "withdrawn_by": None, "withdrawn_at": None, "withdraw_code": None, **over,
    }  # fmt: skip
    skus = {i["sku"]: i for i in ITEM_ROWS}
    lines = [
        {"line_no": n, "requirement_line_no": n, "product_id": skus[x["sku"]]["product_id"], "sku": x["sku"], "name": x["name"], "sale_unit": skus[x["sku"]]["sale_unit"], "qty": x["quantity"],
         "unit_price_applied_paise": x["unit_price_applied"], "price_break_min_qty": (x["price_break_applied"] or {}).get("min_qty"), "line_subtotal_paise": x["line_subtotal"],
         "net_paise": x["net"], "tax_paise": x["tax"], "gross_paise": x["gross"], "tax_bps": skus[x["sku"]]["tax_bps"]}
        for n, x in enumerate(result["lines"], start=1)
    ]  # fmt: skip
    return row, lines


class FakeQuotes:
    def __init__(self) -> None:
        self.versions: list[dict[str, Any]] = [
            {"id": str(PV), "version_no": 1, "effective_from": "2026-10-01"}
        ]
        self.items = list(ITEM_ROWS)
        self.policy_row: dict[str, Any] | None = dict(POLICY_ROW)
        self.policy_list: list[dict[str, Any]] | None = None  # None: just the seeded row
        self.policy_ids: dict[
            str, int
        ] = {}  # policy versions created through the API: id -> version number
        self.mapper: dict[str, Any] | None = MAPPER_ROW
        self.products_rows = list(PRODUCTS)
        self.pick_rows: list[dict[str, Any]] = []
        self.rows: dict[uuid.UUID, tuple[dict[str, Any], list[dict[str, Any]]]] = {}
        self.texts: dict[uuid.UUID, dict[str, Any]] = {}
        self.approved_hashes: dict[
            uuid.UUID, str
        ] = {}  # not a column the API reads: only the text endpoint's lookup
        self.company: str | None = "Synthetic Buyer"
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str] = []
        self.tenant = uuid.UUID(
            int=0xA
        )  # the one tenant these rows belong to: another tenant's caller sees nothing, like RLS
        self.errors: list[Exception] = []  # raised by the next write

    def _tok(self, token: str) -> None:
        self.tokens.append(token)

    def _maybe(self) -> None:
        if self.errors:
            raise self.errors.pop(0)

    # ---- reads
    def active_price_version(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None:
        self._tok(token)
        return self.versions[-1] if self.versions else None

    def price_items(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        self._tok(token)
        return list(self.items)

    def active_policy(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any] | None:
        self._tok(token)
        return self.policy_row

    def policy(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self._tok(token)
        return self.policy_row

    def active_mapper_config(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None:
        self._tok(token)
        return self.mapper

    def products(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._tok(token)
        return list(self.products_rows)

    def picks(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        self._tok(token)
        return list(self.pick_rows)

    def company_name(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> str | None:
        self._tok(token)
        return self.company

    def list_quotes(
        self, token: str, tenant_id: uuid.UUID, *, enquiry_id: uuid.UUID | None, limit: int
    ) -> list[dict[str, Any]]:
        self._tok(token)
        keys = (
            "id",
            "quote_no",
            "enquiry_id",
            "status",
            "customer_kind",
            "valid_until",
            "total_paise",
            "needs_owner_approval",
            "created_at",
            "withdrawn_at",
        )
        return [
            {k: row[k] for k in keys}
            for row, _ in self.rows.values()
            if enquiry_id is None or row["enquiry_id"] == str(enquiry_id)
        ][:limit]

    def get_quote(
        self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
        self._tok(token)
        return self.rows.get(quote_id) if tenant_id == self.tenant else None

    def get_quote_texts(
        self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self._tok(token)
        stored = self.texts.get(quote_id)
        if stored is None or tenant_id != self.tenant:
            return None
        row = self.rows[quote_id][0]
        return {
            "id": str(quote_id),
            "status": row["status"],
            "canonical_hash": row["canonical_hash"],
            "approved_hash": self.approved_hashes.get(quote_id),
            **stored,
        }

    # ---- the quote policy
    def list_policies(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        self._tok(token)
        self.calls.append(("list_policies", {"tenant_id": str(tenant_id), "limit": limit}))
        if tenant_id != self.tenant:
            return []
        if self.policy_list is not None:
            return [dict(r) for r in self.policy_list]
        return (
            [{**self.policy_row, "created_at": "2026-10-01T05:00:00+00:00"}]
            if self.policy_row
            else []
        )

    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._tok(token)
        self._maybe()
        self.calls.append(("create_policy", copy.deepcopy(args)))
        version_id = args["p_version_id"]
        replayed = version_id in self.policy_ids
        if not replayed:
            self.policy_ids[version_id] = len(self.policy_ids) + 2  # the seeded row is version 1
        return {
            "version_id": version_id,
            "version_no": self.policy_ids[version_id],
            "effective_from": args["p_effective_from"],
            "content_sha256": "0" * 64,  # the database returns it; the API never passes it on
            "replayed": replayed,
        }

    # ---- writes
    def pick(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._tok(token)
        self._maybe()
        self.calls.append(("pick", args))
        return {
            "pick_id": str(uuid.uuid4()),
            "requirement_id": args["p_requirement_id"],
            "line": args["p_line"],
            "product_id": args["p_product_id"],
            "qty": args["p_qty"],
            "sale_unit": args["p_sale_unit"],
            "replayed": False,
        }

    def create_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._tok(token)
        self._maybe()
        self.calls.append(("create_draft", args))
        request, result = json.loads(args["p_request_text"]), json.loads(args["p_result_text"])
        qid = uuid.UUID(args["p_quote_id"])
        replayed = qid in self.rows
        if not replayed:
            row, lines = quote_from(
                request,
                result,
                id=str(qid),
                delivery_state=args["p_delivery_state"],
                customer_kind=args["p_customer_kind"],
            )
            self.rows[qid] = (row, lines)
            self.texts[qid] = {
                "request_text": args["p_request_text"],
                "result_text": args["p_result_text"],
                "engine_version": args["p_engine_version"],
            }
        return {
            "quote_id": str(qid),
            "quote_no": 1,
            "status": "draft",
            "needs_owner_approval": False,
            "canonical_hash": result["canonical_hash"],
            "replayed": replayed,
        }

    def approve(self, token: str, quote_id: uuid.UUID, recomputed_hash: str) -> dict[str, Any]:
        self._tok(token)
        self._maybe()
        self.calls.append(("approve", (quote_id, recomputed_hash)))
        row, _ = self.rows[quote_id]
        row.update(
            status="approved",
            approved_by=str(uuid.uuid4()),
            approved_at="2026-10-06T06:00:00+00:00",
        )
        self.approved_hashes[quote_id] = recomputed_hash
        return {
            "quote_id": str(quote_id),
            "status": "approved",
            "approved_by": row["approved_by"],
            "replayed": False,
        }

    def reject(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]:
        self._tok(token)
        self._maybe()
        self.calls.append(("reject", (quote_id, code)))
        self.rows[quote_id][0].update(status="rejected", reject_code=code)
        return {"quote_id": str(quote_id), "status": "rejected", "replayed": False}

    def withdraw(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]:
        self._tok(token)
        self._maybe()
        self.calls.append(("withdraw", (quote_id, code)))
        self.rows[quote_id][0].update(
            status="superseded",
            withdrawn_at="2026-10-06T07:00:00+00:00",
            withdrawn_by=str(uuid.uuid4()),
            withdraw_code=code,
        )
        return {
            "quote_id": str(quote_id),
            "status": "superseded",
            "withdrawn": True,
            "replayed": False,
        }


__all__ = [
    "ENQ", "LEAD", "P1", "P2", "P3", "POL", "PV", "QID", "RID", "TODAY", "FakeQuotes", "OwnerApprovalRequiredError", "QuoteDependsError", "QuoteInputMissingError",
    "QuoteMismatchError", "QuoteNotDraftError", "QuoteStaleError", "RequirementNotConfirmedError", "engine_port", "field", "quote_from", "requirement", "two_line_rows", "datetime", "UTC",
]  # fmt: skip
