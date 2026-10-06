"""The order use cases. The API DECIDES NOTHING: for an event it reads the order's recorded state with the caller's own token, builds the lifecycle request from it
(app/orders/builder.py, the same JSON the database's `app.order_build` produces), runs the pinned lifecycle (app/orders/lifecycle_port.py, as of its own clock), and hands the database the
person's inputs together with the request and the result. The database rebuilds the request, recomputes the decision and refuses any difference; a stale read is told (SM238) to reload.
`owner_override` is derived from the role the token proved: it is never a field of any request."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import NotFoundError
from app.errors import ApiError
from app.orders import lifecycle_port
from app.orders.builder import (
    OrderEvent,
    OrderRequestError,
    OrderState,
    build_request,
    new_ledger_id,
)
from app.orders.models import (
    EventResultOut,
    OrderDetailOut,
    OrderEventOut,
    OrderOut,
    RecordEventIn,
    outcome_of,
)
from app.orders.repository import OrdersRepository
from app.tenancy.models import Role


def order_out(row: dict[str, Any]) -> OrderOut:
    return OrderOut.model_validate({**row, "outcome": outcome_of(str(row["state"]))})


def order_detail(
    orders: OrdersRepository, token: str, tenant: uuid.UUID, order_id: uuid.UUID
) -> OrderDetailOut | None:
    row = orders.get_order(token, tenant, order_id)
    if row is None:
        return None
    events = [OrderEventOut.model_validate(e) for e in orders.events(token, tenant, order_id)]
    return OrderDetailOut.model_validate({**order_out(row).model_dump(), "events": events})


GUIDANCE_PROBES: tuple[str, ...] = (
    "send_quote",
    "customer_accept",
    "customer_decline",
    "expire",
    "request_advance",
    "record_payment",
    "start_preparation",
    "dispatch",
    "deliver",
    "cancel",
    "record_refund",
)


def guidance(snapshot: OrderState, role: Role, now: datetime) -> list[str]:
    """Which events the pinned lifecycle would ACCEPT for this order right now, for this role (guidance for a screen, never approval). Each event type is put to the lifecycle itself, so
    no rule is copied here; a money event is asked with one paisa and a fresh ledger id. A lifecycle that cannot run gives no guidance (the screen then offers nothing)."""
    allowed: list[str] = []
    for kind in GUIDANCE_PROBES:
        money = kind in ("record_payment", "record_refund")
        event = OrderEvent(kind, 1 if money else None, new_ledger_id() if money else None)
        try:
            result = lifecycle_port.run_transition(
                build_request(snapshot, event, as_of=now, role=role.value)
            )
        except (
            OrderRequestError,
            lifecycle_port.LifecycleUnavailable,
            lifecycle_port.LifecycleInputError,
            lifecycle_port.LifecycleError,
        ):
            return []
        if result.get("status") == "ok":
            allowed.append(kind)
    return allowed


def with_guidance(
    orders: OrdersRepository,
    token: str,
    tenant: uuid.UUID,
    role: Role,
    detail: OrderDetailOut,
    *,
    now: datetime | None = None,
) -> OrderDetailOut:
    snapshot = orders.snapshot(token, tenant, detail.id)
    if snapshot is None:
        return detail
    return detail.model_copy(
        update={"allowed_next_events": guidance(snapshot, role, now or datetime.now(UTC))}
    )


def _lifecycle_failure(exc: Exception) -> ApiError:
    if isinstance(exc, lifecycle_port.LifecycleUnavailable):
        return ApiError(503, "order_lifecycle_unavailable", "Orders are not available right now.")
    return ApiError(
        502, "order_lifecycle_failed", "The order rules could not be run. Nothing was recorded."
    )


def record_event(
    orders: OrdersRepository,
    token: str,
    tenant: uuid.UUID,
    role: Role,
    order_id: uuid.UUID,
    body: RecordEventIn,
    *,
    now: datetime | None = None,
) -> EventResultOut:
    snapshot = orders.snapshot(token, tenant, order_id)
    if snapshot is None:
        raise NotFoundError("order")
    moment = now or datetime.now(UTC)
    event = OrderEvent(
        body.type, body.amount_paise, str(body.ledger_id) if body.ledger_id is not None else None
    )
    try:
        request = build_request(snapshot, event, as_of=moment, role=role.value)
    except OrderRequestError:
        raise ApiError(422, "validation_error", "Invalid input.") from None
    try:
        result = lifecycle_port.run_transition(request)
        request_text = lifecycle_port.canonical_json(request)
        result_text = lifecycle_port.canonical_json(result)
        version = lifecycle_port.lifecycle_version()
    except (
        lifecycle_port.LifecycleUnavailable,
        lifecycle_port.LifecycleInputError,
        lifecycle_port.LifecycleError,
    ) as exc:
        raise _lifecycle_failure(exc) from None
    done = orders.record_event(
        token,
        {
            "p_event_id": str(body.id),
            "p_order_id": str(order_id),
            "p_type": body.type,
            "p_occurred_at": (body.occurred_at or moment).isoformat(),
            "p_amount_paise": body.amount_paise,
            "p_ledger_id": str(body.ledger_id) if body.ledger_id is not None else None,
            "p_reason_code": body.reason_code,
            "p_engine_version": version,
            "p_request_text": request_text,
            "p_result_text": result_text,
        },
    )
    replayed = bool(done.get("replayed"))
    state = str(done["state"])
    # a replay ran nothing new: the lifecycle result above described a transition that has already happened, so none of it is reported
    ok = (not replayed) and result.get("status") == "ok"
    return EventResultOut(
        event_id=uuid.UUID(str(done["event_id"])),
        order_id=uuid.UUID(str(done["order_id"])),
        seq=int(done["seq"]),
        state=state,  # type: ignore[arg-type]
        prior_state=done.get("prior_state"),
        outcome=outcome_of(state),
        replayed=replayed,
        allowed_next_events=[str(e) for e in result.get("allowed_next_events", [])] if ok else [],
        flags=sorted({str(r["code"]) for r in result["flags"]["reasons"]}) if ok else [],
        paid_total=result.get("paid_total") if ok else None,
        balance_due=result.get("balance_due") if ok else None,
    )
