"""An in-memory OrdersRepository for the route tests. The real rules are the database's (pgTAP 61) and the real-stack API tests (tests/integration/test_order_api.py); this fake holds the
rows the service reads and records what the service writes, so the route tests can check WHAT was sent to the database and with whose token."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from app.orders.builder import OrderState
from app.orders.errors import (
    NoOrderPolicyError,
    OrderClosedError,
    OrderExistsError,
    OrderFiguresError,
    OrderMismatchError,
    OrderQuoteNotApprovedError,
    OrderRefusedError,
    OwnerRequiredError,
    QuoteExpiredError,
    QuoteHasOrderError,
)

ORDER = uuid.UUID(int=0x0D01)
QUOTE = uuid.UUID(int=0x9001)
POLICY = uuid.UUID(int=0x0A01)
LEAD = uuid.UUID(int=0x1EAD)
ENQ = uuid.UUID(int=0xE01)
REQ = uuid.UUID(int=0xE02)
VALID = date(2026, 10, 16)
CREATED = datetime(2026, 10, 6, 6, 0, tzinfo=UTC)

__all__ = [
    "ENQ", "LEAD", "ORDER", "POLICY", "QUOTE", "REQ", "FakeOrders", "NoOrderPolicyError", "OrderClosedError", "OrderExistsError", "OrderFiguresError", "OrderMismatchError",
    "OrderQuoteNotApprovedError", "OrderRefusedError", "OwnerRequiredError", "QuoteExpiredError", "QuoteHasOrderError", "order_row", "state_of",
]  # fmt: skip


def order_row(
    tenant: uuid.UUID,
    order_id: uuid.UUID = ORDER,
    state: str = "accepted",
    total: int = 100000,
    advance: int = 40000,
    **over: Any,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(order_id),
        "order_no": 1,
        "quote_id": str(QUOTE),
        "enquiry_id": str(ENQ),
        "requirement_id": str(REQ),
        "lead_id": str(LEAD),
        "state": state,
        "order_total_paise": total,
        "advance_paise": advance,
        "valid_until": VALID.isoformat(),
        "policy_version_id": str(POLICY),
        "created_at": CREATED.isoformat(),
        "closed_at": None,
        "paid_paise": 0,
        "refunded_paise": 0,
        "net_paise": 0,
        "balance_paise": total,
        "event_count": 1,
        "lost_reason": None,
    }
    row.update(over)
    return row


def state_of(
    state: str = "accepted",
    total: int = 100000,
    advance: int = 40000,
    payments: tuple[tuple[str, int], ...] = (),
) -> OrderState:
    return OrderState(
        state=state,
        order_total_paise=total,
        advance_paise=advance,
        valid_until=VALID,
        advance_required=True,
        dispatch_requires_advance=True,
        cancel_allowed_until_state="in_preparation",
        payments=payments,
    )


class FakeOrders:
    def __init__(self, tenant: uuid.UUID) -> None:
        self.tenant = tenant
        self.rows: dict[uuid.UUID, dict[str, Any]] = {ORDER: order_row(tenant)}
        self.snapshots: dict[uuid.UUID, OrderState] = {ORDER: state_of()}
        self.event_rows: dict[uuid.UUID, list[dict[str, Any]]] = {ORDER: [created_event()]}
        self.tokens: list[str] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.raise_next: Exception | None = None
        self.next_result: dict[str, Any] | None = None

    def _seen(self, token: str, name: str, args: dict[str, Any]) -> None:
        self.tokens.append(token)
        self.calls.append((name, args))
        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error

    # writes
    def create_order(self, token: str, order_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]:
        self._seen(
            token, "create_order", {"p_order_id": str(order_id), "p_quote_id": str(quote_id)}
        )
        replayed = order_id in self.rows
        self.rows.setdefault(
            order_id, order_row(self.tenant, order_id, state="quote_approved", order_no=2)
        )
        self.snapshots.setdefault(order_id, state_of("quote_approved"))
        self.event_rows.setdefault(order_id, [created_event()])
        return {
            "order_id": str(order_id),
            "order_no": 2,
            "state": "quote_approved",
            "replayed": replayed,
        }

    def record_event(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._seen(token, "record_event", args)
        if self.next_result is not None:
            return self.next_result
        return {
            "event_id": args["p_event_id"],
            "order_id": args["p_order_id"],
            "seq": 2,
            "state": "quote_sent",
            "prior_state": "quote_approved",
            "replayed": False,
        }

    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._seen(token, "create_policy", args)
        return {
            "version_id": args["p_version_id"],
            "version_no": 1,
            "effective_from": args["p_effective_from"],
            "content_sha256": "0" * 64,
            "replayed": False,
        }

    # reads
    def get_order(
        self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self.tokens.append(token)
        return self.rows.get(order_id) if tenant_id == self.tenant else None

    def list_orders(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> list[dict[str, Any]]:
        self.tokens.append(token)
        self.calls.append(("list_orders", {"limit": limit, "cursor": cursor}))
        return list(self.rows.values())[: limit + 1] if tenant_id == self.tenant else []

    def events(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID) -> list[dict[str, Any]]:
        self.tokens.append(token)
        return self.event_rows.get(order_id, [])

    def snapshot(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID) -> OrderState | None:
        self.tokens.append(token)
        return self.snapshots.get(order_id) if tenant_id == self.tenant else None


def created_event() -> dict[str, Any]:
    return {
        "id": str(uuid.UUID(int=0xE0E0)),
        "seq": 1,
        "type": "created",
        "prior_state": None,
        "new_state": "quote_approved",
        "amount_paise": None,
        "ledger_id": None,
        "occurred_at": CREATED.isoformat(),
        "reason_code": None,
        "owner_approved_by": None,
        "recorded_by": str(uuid.UUID(int=0x1000)),
        "recorded_at": CREATED.isoformat(),
        "engine_version": None,
        "canonical_hash": None,
    }
