"""Order conversion commit 5: the PostgREST adapter for orders (app/orders/repository.py) against a mock transport: what it sends (the caller's own token, the anon key, a tenant filter on
EVERY read, the definer functions for every write) and how it classifies what comes back (SQLSTATE only; SM232's DETAIL is read only to pick one reason from a closed list; nothing from the
data layer ever reaches an exception)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.orders.errors import (
    REASONS,
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
from app.orders.repository import PostgrestOrdersRepository
from app.tenancy.repository import Forbidden, MfaRequired, TokenRejected, UpstreamError

TENANT = uuid.UUID(int=0xA)
ID = uuid.UUID(int=0x1)
CANARY = "CANARY-8e3a90 secret row data"


def repo(handler: Callable[[httpx.Request], httpx.Response]) -> PostgrestOrdersRepository:
    return PostgrestOrdersRepository(
        "http://rest.test",
        "anon-key",
        client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://rest.test"),
    )


def refusing(
    status: int, code: str, details: str = CANARY
) -> Callable[[httpx.Request], httpx.Response]:
    return lambda request: httpx.Response(
        status, json={"code": code, "message": CANARY, "details": details, "hint": CANARY}
    )


@pytest.mark.parametrize(
    ("status", "code", "error"),
    [
        (400, "SM230", OrderQuoteNotApprovedError),
        (400, "SM231", OrderExistsError),
        (400, "SM233", OrderFiguresError),
        (400, "SM234", OwnerRequiredError),
        (400, "SM235", OrderClosedError),
        (400, "SM236", QuoteExpiredError),
        (400, "SM237", QuoteHasOrderError),
        (400, "SM238", OrderMismatchError),
        (400, "SM239", NoOrderPolicyError),
        (403, "SM306", MfaRequired),
        (403, "42501", Forbidden),
        (409, "23505", ConflictError),
        (409, "23503", InvalidReferenceError),
        (400, "22023", InvalidValueError),
        (401, "PGRST301", TokenRejected),
    ],
)
def test_every_sqlstate_becomes_one_typed_exception_without_the_data_layers_text(
    status: int, code: str, error: type[Exception]
) -> None:
    with pytest.raises(error) as caught:
        repo(refusing(status, code)).record_event("t", {})
    assert CANARY not in str(caught.value) and CANARY not in repr(caught.value.__cause__)


def test_the_closed_list_of_reasons_is_pinned() -> None:
    assert REASONS == (
        "ILLEGAL_TRANSITION", "QUOTE_NOT_EXPIRED", "QUOTE_EXPIRED", "CANCEL_WINDOW_CLOSED", "ADVANCE_NOT_PAID", "DUPLICATE_PAYMENT_ID", "DUPLICATE_REFUND_ID",
        "OVERPAYMENT", "REFUND_EXCEEDS_PAID", "CLOSED_UNPAID", "INVALID_ADVANCE", "INVALID_CANCEL_WINDOW", "INVALID_STATE", "INVALID_EVENT", "OUT_OF_RANGE", "OTHER",
    )  # fmt: skip


@pytest.mark.parametrize("reason", REASONS)
def test_sm232_carries_one_closed_reason(reason: str) -> None:
    with pytest.raises(OrderRefusedError) as caught:
        repo(refusing(400, "SM232", reason)).record_event("t", {})
    assert caught.value.reason == reason and CANARY not in str(caught.value)


@pytest.mark.parametrize(
    "detail",
    [CANARY, "", "Overpayment of 5000", "ILLEGAL_TRANSITION; drop table", "illegal_transition"],
)
def test_a_detail_that_is_not_on_the_closed_list_becomes_other(detail: str) -> None:
    with pytest.raises(OrderRefusedError) as caught:
        repo(refusing(400, "SM232", detail)).record_event("t", {})
    assert caught.value.reason == "OTHER" and (detail == "" or detail not in str(caught.value))


def test_an_unknown_sqlstate_and_a_dead_data_layer_are_an_upstream_error_without_text() -> None:
    with pytest.raises(UpstreamError) as caught:
        repo(refusing(500, "XX000")).create_order("t", ID, ID)
    assert CANARY not in str(caught.value)

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(CANARY)

    with pytest.raises(UpstreamError) as caught2:
        repo(down).create_order("t", ID, ID)
    assert CANARY not in str(caught2.value) and CANARY not in repr(caught2.value.__cause__)


def test_a_write_is_a_definer_function_call_with_the_callers_token_and_the_anon_key() -> None:
    seen: list[httpx.Request] = []

    def ok(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"order_id": str(ID), "replayed": False})

    r = repo(ok)
    r.create_order("caller-token", ID, ID)
    r.record_event("caller-token", {"p_event_id": str(ID)})
    r.create_policy("caller-token", {"p_version_id": str(ID)})
    assert [req.url.path for req in seen] == [
        "/rpc/create_order_from_quote",
        "/rpc/record_order_event",
        "/rpc/create_order_policy_version",
    ]
    for req in seen:
        assert (
            req.method == "POST"
            and req.headers["authorization"] == "Bearer caller-token"
            and req.headers["apikey"] == "anon-key"
        )
    assert json.loads(seen[0].content) == {"p_order_id": str(ID), "p_quote_id": str(ID)}


def test_every_read_carries_the_tenant_filter_and_the_callers_token() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/orders":
            return httpx.Response(
                200,
                json=[
                    {
                        "id": str(ID),
                        "state": "accepted",
                        "order_total_paise": 100,
                        "advance_paise": 40,
                        "valid_until": "2026-10-16",
                        "policy_version_id": str(ID),
                    }
                ],
            )
        if request.url.path == "/order_policy_versions":
            return httpx.Response(
                200,
                json=[
                    {
                        "advance_required": True,
                        "dispatch_requires_advance": False,
                        "cancel_allowed_until_state": "in_preparation",
                    }
                ],
            )
        return httpx.Response(200, json=[])

    r = repo(handler)
    r.get_order("tok", TENANT, ID)
    r.events("tok", TENANT, ID)
    r.list_orders("tok", TENANT, limit=5, cursor=None)
    r.snapshot("tok", TENANT, ID)
    assert seen and all(req.headers["authorization"] == "Bearer tok" for req in seen)
    for req in seen:
        if req.url.path in ("/orders", "/order_events", "/order_ledger", "/order_policy_versions"):
            assert req.url.params["tenant_id"] == f"eq.{TENANT}", req.url


def test_a_snapshot_is_the_builders_input_in_ledger_order() -> None:
    p1, p2, r1 = (uuid.UUID(int=n) for n in (0x11, 0x22, 0x33))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/orders":
            return httpx.Response(
                200,
                json=[
                    {
                        "state": "in_preparation",
                        "order_total_paise": 100000,
                        "advance_paise": 40000,
                        "valid_until": "2026-10-16",
                        "policy_version_id": str(ID),
                    }
                ],
            )
        if request.url.path == "/order_policy_versions":
            return httpx.Response(
                200,
                json=[
                    {
                        "advance_required": True,
                        "dispatch_requires_advance": True,
                        "cancel_allowed_until_state": "accepted",
                    }
                ],
            )
        return httpx.Response(200, json=[
            {"type": "created", "seq": 1, "amount_paise": None, "ledger_id": None},
            {"type": "record_payment", "seq": 2, "amount_paise": 30000, "ledger_id": str(p1)},
            {"type": "record_payment", "seq": 3, "amount_paise": 10000, "ledger_id": str(p2)},
            {"type": "record_refund", "seq": 4, "amount_paise": 500, "ledger_id": str(r1)},
        ])  # fmt: skip

    snap = repo(handler).snapshot("t", TENANT, ID)
    assert snap is not None
    assert (
        snap.state,
        snap.order_total_paise,
        snap.advance_paise,
        snap.valid_until,
        snap.cancel_allowed_until_state,
    ) == ("in_preparation", 100000, 40000, date(2026, 10, 16), "accepted")
    assert snap.payments == ((str(p1), 30000), (str(p2), 10000)) and snap.refunds == (
        (str(r1), 500),
    )


def test_a_snapshot_of_an_unknown_order_is_none_and_a_missing_policy_is_not_guessed() -> None:
    assert repo(lambda request: httpx.Response(200, json=[])).snapshot("t", TENANT, ID) is None

    def no_policy(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/orders":
            return httpx.Response(
                200,
                json=[
                    {
                        "state": "accepted",
                        "order_total_paise": 1,
                        "advance_paise": 0,
                        "valid_until": "2026-10-16",
                        "policy_version_id": str(ID),
                    }
                ],
            )
        return httpx.Response(200, json=[])

    with pytest.raises(UpstreamError):
        repo(no_policy).snapshot("t", TENANT, ID)


def test_the_list_is_keyset_filtered_and_asks_for_one_row_more() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    repo(handler).list_orders("t", TENANT, limit=7, cursor=("2026-10-06T06:00:00+00:00", ID))
    first = seen[0].url.params
    assert (
        first["limit"] == "8"
        and first["order"] == "created_at.desc,id.desc"
        and "created_at.lt." in first["or"]
    )


def test_a_malformed_list_from_the_data_layer_is_refused() -> None:
    with pytest.raises(UpstreamError):
        repo(lambda request: httpx.Response(200, json={"not": "a list"})).events("t", TENANT, ID)
    with pytest.raises(UpstreamError):
        repo(lambda request: httpx.Response(200, json=["x"])).events("t", TENANT, ID)


def test_the_ledger_of_an_order_without_totals_defaults_to_zero_paid() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/orders":
            return httpx.Response(200, json=[{"id": str(ID), "order_total_paise": 500}])
        return httpx.Response(200, json=[])

    row: Any = repo(handler).get_order("t", TENANT, ID)
    assert (row["paid_paise"], row["balance_paise"], row["event_count"]) == (0, 500, 0)
