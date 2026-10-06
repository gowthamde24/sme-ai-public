"""Order conversion, commit 2: the request builder (app/orders/builder.py). Pure: the same inputs give the same request, and the request is exactly what the database's `app.order_build` produces
(the real-stack test of commit 4 compares them). Here: the shape by value, the time rules, the ledger order, the derived override, and that no input lets a caller set an amount, an approver,
a state or the override."""

# ruff: noqa: E501

from __future__ import annotations

import dataclasses
import inspect
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

import pytest

from app.orders import builder
from app.orders.builder import (
    EVENT_TYPES,
    LOST_REASONS,
    OrderEvent,
    OrderRequestError,
    OrderState,
    build_request,
    owner_override,
    utc_text,
    valid_until_text,
)
from app.orders.lifecycle_port import expected_hash, run_transition

P1 = "11111111-1111-4111-8111-111111111111"
P2 = "22222222-2222-4222-8222-222222222222"
R1 = "33333333-3333-4333-8333-333333333333"
IST = timezone(timedelta(hours=5, minutes=30))
AS_OF = datetime(2026, 10, 6, 11, 30, 15, 987654, tzinfo=IST)  # 06:00:15 UTC


def state(**over: Any) -> OrderState:
    base: dict[str, Any] = {
        "state": "accepted",
        "order_total_paise": 100000,
        "advance_paise": 40000,
        "valid_until": date(2026, 10, 6),
        "advance_required": True,
        "dispatch_requires_advance": True,
        "cancel_allowed_until_state": "in_preparation",
        "payments": ((P1, 10000),),
        "refunds": (),
    }
    return OrderState(**{**base, **over})


def test_the_request_is_exactly_the_documented_shape() -> None:
    request = build_request(
        state(), OrderEvent("record_payment", 30000, P2), as_of=AS_OF, role="admin"
    )
    assert request == {
        "current_state": "accepted",
        "event": {"type": "record_payment", "amount": 30000, "payment_id": P2},
        "as_of": "2026-10-06T06:00:15Z",
        "valid_until": "2026-10-06T18:29:59Z",
        "order_total": 100000,
        "payments": [{"payment_id": P1, "amount": 10000}],
        "refunds": [],
        "policy": {
            "advance_required": True,
            "advance_amount": 40000,
            "dispatch_requires_advance": True,
            "cancel_allowed_until_state": "in_preparation",
        },
        "flags": {"owner_override": False},
    }


def test_a_refund_event_uses_its_own_namespace() -> None:
    request = build_request(
        state(refunds=((R1, 500),)),
        OrderEvent("record_refund", 700, R1.replace("3", "4")),
        as_of=AS_OF,
        role="owner",
    )
    assert request["event"] == {
        "type": "record_refund",
        "amount": 700,
        "refund_id": R1.replace("3", "4"),
    }
    assert request["refunds"] == [{"refund_id": R1, "amount": 500}]


def test_non_money_events_carry_only_their_type() -> None:
    for name in EVENT_TYPES:
        if name in builder.MONEY_EVENTS:
            continue
        assert build_request(state(), OrderEvent(name), as_of=AS_OF, role="sales")["event"] == {
            "type": name
        }


def test_the_ledger_keeps_its_order() -> None:
    request = build_request(
        state(payments=((P2, 3), (P1, 2))), OrderEvent("send_quote"), as_of=AS_OF, role="admin"
    )
    assert [p["payment_id"] for p in request["payments"]] == [P2, P1]  # seq order, never sorted


# ---------------------------------------------------------------------------------------------- time
@pytest.mark.parametrize(
    ("moment", "text"),
    [
        (datetime(2026, 10, 6, 6, 0, 0, tzinfo=UTC), "2026-10-06T06:00:00Z"),
        (
            datetime(2026, 10, 6, 6, 0, 0, 999999, tzinfo=UTC),
            "2026-10-06T06:00:00Z",
        ),  # truncated, never rounded up
        (datetime(2026, 10, 6, 11, 30, 0, tzinfo=IST), "2026-10-06T06:00:00Z"),
        (
            datetime(2026, 10, 7, 0, 10, 0, tzinfo=IST),
            "2026-10-06T18:40:00Z",
        ),  # after midnight in India, still the 6th in UTC
        (datetime(2026, 12, 31, 23, 59, 59, tzinfo=UTC), "2026-12-31T23:59:59Z"),
    ],
)
def test_timestamps_are_utc_whole_seconds(moment: datetime, text: str) -> None:
    assert utc_text(moment) == text


def test_a_naive_time_is_refused() -> None:
    with pytest.raises(OrderRequestError) as caught:
        utc_text(datetime(2026, 10, 6, 6, 0, 0))
    assert caught.value.code == "naive_time"


@pytest.mark.parametrize(
    ("day", "text"),
    [
        (date(2026, 10, 6), "2026-10-06T18:29:59Z"),  # 23:59:59 IST
        (date(2026, 1, 1), "2026-01-01T18:29:59Z"),
        (date(2026, 12, 31), "2026-12-31T18:29:59Z"),
    ],
)
def test_a_quote_is_valid_through_the_last_second_of_its_day_in_india(day: date, text: str) -> None:
    assert valid_until_text(day) == text


# ---------------------------------------------------------------------------------------------- the override is derived, never supplied
def test_only_an_owner_dispatching_can_use_the_override() -> None:
    for role in ("owner", "admin", "sales", "viewer", "", "OWNER", "Owner"):
        for name in EVENT_TYPES:
            assert owner_override(role, name) is (role == "owner" and name == "dispatch"), (
                role,
                name,
            )
        request = build_request(
            state(state="in_preparation"), OrderEvent("dispatch"), as_of=AS_OF, role=role
        )
        assert request["flags"] == {"owner_override": role == "owner"}


def test_nothing_a_caller_passes_can_set_an_amount_an_approver_a_state_or_the_override() -> None:
    assert list(inspect.signature(build_request).parameters) == ["order", "event", "as_of", "role"]
    assert [f.name for f in dataclasses.fields(OrderEvent)] == ["type", "amount_paise", "ledger_id"]
    assert not any(
        word in {f.name for f in dataclasses.fields(OrderEvent)}
        for word in ("state", "approved_by", "owner_override", "total", "advance")
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        OrderEvent("send_quote").type = "dispatch"  # type: ignore[misc]
    with pytest.raises(dataclasses.FrozenInstanceError):
        state().state = "closed_paid"  # type: ignore[misc]
    with pytest.raises(TypeError):
        OrderEvent("send_quote", owner_override=True)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------------------------- refusals carry a fixed code, never a value
@pytest.mark.parametrize(
    ("event", "code"),
    [
        (OrderEvent("teleport"), "unknown_event"),
        (OrderEvent("record_payment"), "money_event_incomplete"),
        (OrderEvent("record_payment", 100), "money_event_incomplete"),
        (OrderEvent("record_payment", None, P2), "money_event_incomplete"),
        (OrderEvent("record_refund", 100), "money_event_incomplete"),
        (OrderEvent("send_quote", 100), "event_takes_no_amount"),
        (OrderEvent("dispatch", None, P2), "event_takes_no_amount"),
        (OrderEvent("record_payment", 0, P2), "amount_out_of_range"),
        (OrderEvent("record_payment", -5, P2), "amount_out_of_range"),
        (OrderEvent("record_payment", 1_000_000_001, P2), "amount_out_of_range"),
        (OrderEvent("record_payment", True, P2), "not_integer"),
        (OrderEvent("record_payment", 1.5, P2), "not_integer"),  # type: ignore[arg-type]
        (OrderEvent("record_payment", "100", P2), "not_integer"),  # type: ignore[arg-type]
        (OrderEvent("record_payment", 100, "not-a-uuid"), "bad_ledger_id"),
        (
            OrderEvent("record_payment", 100, "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
            "bad_ledger_id",
        ),
        (OrderEvent("record_payment", 100, 7), "bad_ledger_id"),  # type: ignore[arg-type]
    ],
)
def test_a_bad_event_is_refused_with_a_fixed_code(event: OrderEvent, code: str) -> None:
    with pytest.raises(OrderRequestError) as caught:
        build_request(state(), event, as_of=AS_OF, role="admin")
    assert caught.value.code == code and str(caught.value) == code


@pytest.mark.parametrize(
    ("over", "code"),
    [
        ({"cancel_allowed_until_state": "dispatched"}, "bad_cancel_window"),
        ({"cancel_allowed_until_state": "closed_paid"}, "bad_cancel_window"),
        ({"order_total_paise": 1000.0}, "not_integer"),
        ({"advance_paise": True}, "not_integer"),
        ({"advance_required": 1}, "not_boolean"),
        ({"dispatch_requires_advance": "true"}, "not_boolean"),
        ({"valid_until": datetime(2026, 10, 6, tzinfo=UTC)}, "bad_valid_until"),
        ({"valid_until": "2026-10-06"}, "bad_valid_until"),
        ({"payments": (("x", 1),)}, "bad_ledger_id"),
        ({"payments": ((P1, 1.5),)}, "not_integer"),
        ({"refunds": ((P1, True),)}, "not_integer"),
    ],
)
def test_a_bad_order_snapshot_is_refused_with_a_fixed_code(over: dict[str, Any], code: str) -> None:
    with pytest.raises(OrderRequestError) as caught:
        build_request(state(**over), OrderEvent("send_quote"), as_of=AS_OF, role="admin")
    assert caught.value.code == code


# ---------------------------------------------------------------------------------------------- what the builder builds the lifecycle accepts
def test_the_builder_and_the_lifecycle_walk_an_order_to_closed_paid_with_matching_money() -> None:
    """Quote approved -> sent -> accepted -> advance requested -> advance paid -> in preparation -> dispatched -> delivered -> paid in full. The ledger totals the lifecycle returns equal ours at every step."""
    order = state(state="quote_approved", payments=(), refunds=())
    steps = [
        (OrderEvent("send_quote"), "quote_sent"),
        (OrderEvent("customer_accept"), "accepted"),
        (OrderEvent("request_advance"), "advance_requested"),
        (OrderEvent("record_payment", 40000, P1), "advance_paid"),
        (OrderEvent("start_preparation"), "in_preparation"),
        (OrderEvent("dispatch"), "dispatched"),
        (OrderEvent("deliver"), "delivered"),
        (OrderEvent("record_payment", 60000, P2), "closed_paid"),
    ]
    paid = 0
    for event, expected in steps:
        request = build_request(order, event, as_of=AS_OF, role="admin")
        result = run_transition(request)
        assert (result["status"], result["new_state"]) == ("ok", expected), event
        assert result["canonical_hash"] == expected_hash(request)
        if event.type == "record_payment":
            assert event.amount_paise is not None and event.ledger_id is not None
            paid += event.amount_paise
            order = dataclasses.replace(
                order, payments=(*order.payments, (event.ledger_id, event.amount_paise))
            )
        assert result["paid_total"] == paid and result["balance_due"] == 100000 - paid
        order = dataclasses.replace(order, state=expected)
    assert result["allowed_next_events"] == []


def test_the_owner_override_dispatches_with_the_advance_unpaid_and_nobody_else_does() -> None:
    order = state(state="in_preparation", payments=((P1, 1000),))
    for role, expected in (("owner", "ok"), ("admin", "rejected"), ("sales", "rejected")):
        result = run_transition(
            build_request(order, OrderEvent("dispatch"), as_of=AS_OF, role=role)
        )
        assert result["status"] == expected, role
        assert (result["flags"]["reasons"] != []) is (role == "owner")


def test_the_lost_reasons_are_the_closed_list_of_the_plan() -> None:
    assert LOST_REASONS == (
        "price",
        "timing",
        "bought_elsewhere",
        "no_response",
        "requirement_changed",
        "product_unavailable",
        "credit_terms",
        "other",
    )


def test_the_builder_reads_no_clock_and_does_no_io() -> None:
    source = inspect.getsource(builder)
    for word in (
        "datetime.now",
        "time.time",
        "open(",
        "import requests",
        "import httpx",
        "os.environ",
        "import random",
    ):
        assert word not in source, word
