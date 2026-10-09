"""The pure shaping of the database's facts into the Today screen, AI usage and the helpers' status (job AD / D3)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.errors import ApiError
from app.today import service
from app.today.models import AGENT_ORDER, LastEvent

ID = str(uuid.UUID(int=7))
QID, LID, OID = (str(uuid.UUID(int=n)) for n in (11, 12, 13))
AT = "2026-10-09T09:30:00+00:00"


@pytest.mark.parametrize(
    ("paise", "text"),
    [
        (0, "₹0.00"),
        (5, "₹0.05"),
        (100, "₹1.00"),
        (99_999, "₹999.99"),
        (100_000, "₹1,000.00"),
        (1_050_000, "₹10,500.00"),
        (12_345_678, "₹1,23,456.78"),
        (1_000_000_000, "₹1,00,00,000.00"),
        (-250, "-₹2.50"),
    ],
)
def test_rupees_use_indian_grouping(paise: int, text: str) -> None:
    assert service.format_rupees(paise) == text


def today_raw(**over: Any) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "cards": {"waiting": 3, "money_held_paise": 40_000, "orders_open": 2},
        "needs_you": [
            {
                "kind": "quote_approval",
                "id": ID,
                "customer": "Harbour Retail",
                "city": "Hyderabad",
                "agent": "quote_writer",
                "ref": "12",
                "amount_paise": 1_050_000,
                "at": AT,
                "target": {"type": "quote", "id": QID},
            },
            {
                "kind": "followup_due",
                "id": ID,
                "customer": None,
                "city": None,
                "agent": "followup_desk",
                "ref": "2",
                "amount_paise": None,
                "at": AT,
                "target": {"type": "lead", "id": LID},
            },
            {
                "kind": "order_money_held",
                "id": ID,
                "customer": "Lakshmi Silks",
                "city": "Guntur",
                "agent": "order_desk",
                "ref": "4",
                "amount_paise": 40_000,
                "at": AT,
                "target": {"type": "order", "id": OID},
            },
        ],
        "recent": [
            {
                "order_no": 4,
                "order_id": OID,
                "customer": "Lakshmi Silks",
                "type": "cancel",
                "new_state": "cancelled",
                "amount_paise": None,
                "at": AT,
            }
        ],
    }
    raw.update(over)
    return raw


def test_today_is_shaped_to_the_contract() -> None:
    out = service.shape_today(today_raw()).model_dump(mode="json")
    assert out["cards"] == {"waiting": 3, "money_held_paise": 40_000, "orders_open": 2}
    quote, followup, held = out["needs_you"]
    assert quote["summary"] == "Quote 12 for ₹10,500.00 is ready for your approval."
    assert (quote["customer"], quote["city"], quote["agent"], quote["amount_paise"]) == (
        "Harbour Retail",
        "Hyderabad",
        "quote_writer",
        1_050_000,
    )
    assert (
        followup["customer"] == "A customer"
        and followup["city"] is None
        and followup["amount_paise"] is None
    )
    assert (
        followup["summary"]
        == "A follow-up message (number 2) is drafted and waiting for your approval."
    )
    assert held["summary"] == "Order 4 is closed but still holds ₹400.00. A refund may be owed."
    assert out["recent"] == [
        {
            "kind": "order_step",
            "order_ref": "Order 4",
            "customer": "Lakshmi Silks",
            "text": "Order cancelled",
            "at": AT.replace("+00:00", "Z"),
            "target": {"type": "order", "id": OID},
        }
    ]
    assert [i["target"] for i in out["needs_you"]] == [
        {"type": "quote", "id": QID},
        {"type": "lead", "id": LID},
        {"type": "order", "id": OID},
    ]
    assert set(quote) == {
        "kind",
        "id",
        "customer",
        "city",
        "agent",
        "summary",
        "at",
        "amount_paise",
        "target",
    }


@pytest.mark.parametrize(
    ("kind", "amount", "text"),
    [
        ("created", None, "Order started"),
        ("send_quote", None, "Quote marked as sent to the customer"),
        ("customer_accept", None, "Customer accepted the quote"),
        ("customer_decline", None, "Customer said no"),
        ("expire", None, "Quote expired"),
        ("request_advance", None, "Advance asked for"),
        ("record_payment", 50_000, "Payment of ₹500.00 recorded"),
        ("record_refund", 12_345, "Refund of ₹123.45 recorded"),
        ("start_preparation", None, "Preparation started"),
        ("dispatch", None, "Order dispatched"),
        ("deliver", None, "Order delivered"),
        ("cancel", None, "Order cancelled"),
        ("something_new", None, "Order updated"),
    ],
)
def test_every_order_step_has_plain_words(kind: str, amount: int | None, text: str) -> None:
    raw = today_raw(
        recent=[
            {
                "order_no": 1,
                "order_id": OID,
                "customer": "X",
                "type": kind,
                "amount_paise": amount,
                "at": AT,
            }
        ]
    )
    assert service.shape_today(raw).recent[0].text == text


def test_at_most_five_recent_steps_are_kept() -> None:
    raw = today_raw(
        recent=[
            {
                "order_no": n,
                "order_id": OID,
                "customer": "X",
                "type": "cancel",
                "amount_paise": None,
                "at": AT,
            }
            for n in range(1, 9)
        ]
    )
    assert [r.order_ref for r in service.shape_today(raw).recent] == [
        f"Order {n}" for n in range(1, 6)
    ]


def test_an_empty_business_is_all_zero_and_empty() -> None:
    out = service.shape_today(
        {
            "cards": {"waiting": 0, "money_held_paise": 0, "orders_open": 0},
            "needs_you": [],
            "recent": [],
        }
    )
    assert out.model_dump(mode="json") == {
        "cards": {"waiting": 0, "money_held_paise": 0, "orders_open": 0},
        "needs_you": [],
        "recent": [],
    }


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        "x",
        {},
        {"cards": []},
        {
            "cards": {"waiting": "3", "money_held_paise": 0, "orders_open": 0},
            "needs_you": [],
            "recent": [],
        },
        {
            "cards": {"waiting": True, "money_held_paise": 0, "orders_open": 0},
            "needs_you": [],
            "recent": [],
        },
    ],
)
def test_an_unexpected_answer_is_a_502_never_a_guess(bad: Any) -> None:
    with pytest.raises(ApiError) as caught:
        service.shape_today(bad)
    assert caught.value.status_code == 502


def test_ai_usage_is_in_paise_rounded_the_safe_way() -> None:
    out = service.shape_ai_usage({"cap_micros": 250_000_000, "spent_micros": 1_734_567})
    assert (out.spent_paise, out.cap_paise, out.left_paise) == (
        174,
        25_000,
        24_826,
    )  # 1,734,567 micros = 173.4567 paise, rounded UP
    one = service.shape_ai_usage({"cap_micros": 19_999, "spent_micros": 1})
    assert (one.spent_paise, one.cap_paise, one.left_paise) == (
        1,
        1,
        0,
    )  # a cap is rounded DOWN, so "left" never overstates


def test_ai_usage_left_never_goes_below_zero_and_zero_is_zero() -> None:
    over = service.shape_ai_usage({"cap_micros": 100_000, "spent_micros": 900_000})
    assert (over.spent_paise, over.cap_paise, over.left_paise) == (90, 10, 0)
    none = service.shape_ai_usage({"cap_micros": 250_000, "spent_micros": 0})
    assert (none.spent_paise, none.left_paise) == (0, 25)


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        {},
        {"cap_micros": "1", "spent_micros": 0},
        {"cap_micros": 1, "spent_micros": None},
    ],
)
def test_unexpected_usage_is_a_502(bad: Any) -> None:
    with pytest.raises(ApiError) as caught:
        service.shape_ai_usage(bad)
    assert caught.value.status_code == 502


def agents_raw(**over: Any) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "agents_enabled": True,
        "main": {"switched_on": True, "running": False, "last_status": "succeeded", "last_at": AT},
        "researcher": {"switched_on": True, "running": False, "last_status": "succeeded", "last_at": AT},
        "requirement_analyst": {"switched_on": True, "running": True, "last_status": None, "last_at": None},
        "quote_writer": {"last_no": 12, "last_at": AT},
        "followup_desk": {"last_touch": 2, "last_at": AT},
        "order_desk": {"last_type": "record_payment", "last_at": AT},
    }
    raw.update(over)
    return raw


def test_all_seven_helpers_come_back_in_the_same_order() -> None:
    out = service.shape_agents(agents_raw())
    assert (
        [a.agent for a in out]
        == list(AGENT_ORDER)
        == [
            "main",
            "lead_finder",
            "researcher",
            "requirement_analyst",
            "quote_writer",
            "followup_desk",
            "order_desk",
        ]
    )
    assert all(a.job for a in out)


AT_TIME = datetime(2026, 10, 9, tzinfo=UTC)


def test_states_and_latest_events() -> None:
    by = {a.agent: a for a in service.shape_agents(agents_raw())}
    assert by["lead_finder"].state == "not_available" and by["lead_finder"].last_event is None
    assert by["main"].state == "idle"
    assert by["main"].last_event is not None and by["main"].last_event.text == "Answered a question"
    assert by["researcher"].state == "idle"
    assert (
        by["researcher"].last_event is not None
        and by["researcher"].last_event.text == "Finished a run"
    )
    assert (by["requirement_analyst"].state, by["requirement_analyst"].last_event) == (
        "working",
        None,
    )
    assert by["quote_writer"].state == "idle"
    texts = [
        (by[k].last_event or LastEvent(text="-", at=AT_TIME)).text
        for k in ("quote_writer", "followup_desk", "order_desk")
    ]
    assert texts == [
        "Prepared quote 12",
        "Drafted follow-up message number 2",
        "Payment recorded",
    ]


def test_when_a_switch_is_off_the_helper_says_switched_off_and_the_desks_still_report() -> None:
    raw = agents_raw(
        main={"switched_on": False, "running": False, "last_status": None, "last_at": None},
        researcher={"switched_on": False, "running": False, "last_status": "succeeded", "last_at": AT},
        requirement_analyst={"switched_on": False, "running": False, "last_status": None, "last_at": None},
    )
    by = {a.agent: a for a in service.shape_agents(raw)}
    assert by["main"].state == by["researcher"].state == by["requirement_analyst"].state == "switched_off"
    assert by["lead_finder"].state == "not_available", "a helper that does not exist is not 'switched off'"
    assert by["researcher"].last_event is not None  # what happened before is still true
    assert by["quote_writer"].state == by["followup_desk"].state == by["order_desk"].state == "idle"


def test_one_helper_can_be_on_while_another_is_off() -> None:
    raw = agents_raw(researcher={"switched_on": False, "running": False, "last_status": None, "last_at": None})
    by = {a.agent: a.state for a in service.shape_agents(raw)}
    assert (by["main"], by["researcher"], by["requirement_analyst"]) == ("idle", "switched_off", "working")


def test_an_answer_without_the_per_helper_flag_falls_back_to_the_workspace_switch() -> None:
    by = {a.agent: a.state for a in service.shape_agents({"agents_enabled": False, "researcher": {}, "requirement_analyst": {}, "main": {}})}
    assert (by["main"], by["researcher"], by["requirement_analyst"]) == ("switched_off",) * 3


def test_a_quiet_business_has_seven_idle_or_unavailable_helpers_and_no_events() -> None:
    out = service.shape_agents(
        {
            "agents_enabled": False,
            "main": {"switched_on": False, "running": False, "last_status": None, "last_at": None},
            "researcher": {"switched_on": False, "running": False, "last_status": None, "last_at": None},
            "requirement_analyst": {"switched_on": False, "running": False, "last_status": None, "last_at": None},
            "quote_writer": {},
            "followup_desk": {},
            "order_desk": {},
        }
    )
    assert [a.state for a in out] == [
        "switched_off",
        "not_available",
        "switched_off",
        "switched_off",
        "idle",
        "idle",
        "idle",
    ]
    assert all(a.last_event is None for a in out)


@pytest.mark.parametrize(
    "status", ["succeeded", "failed", "cancelled", "expired", "killed", "running"]
)
def test_every_run_status_has_words(status: str) -> None:
    out = service.shape_agents(
        agents_raw(researcher={"running": False, "last_status": status, "last_at": AT})
    )
    assert out[2].last_event is not None and out[2].last_event.text


@pytest.mark.parametrize("bad", [None, [], "x"])
def test_unexpected_agents_answer_is_a_502(bad: Any) -> None:
    with pytest.raises(ApiError) as caught:
        service.shape_agents(bad)
    assert caught.value.status_code == 502
