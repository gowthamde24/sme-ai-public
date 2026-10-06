"""T009 step 3: the PostgREST adapter for quotes (app/quotes/repository.py) against a mock transport: what it sends (the caller's own token, the anon key, a tenant filter on EVERY read) and how it
classifies what comes back (SQLSTATE only; nothing from the data layer ever reaches an exception)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import pytest

from app.crm.repository import ConflictError, InvalidReferenceError
from app.quotes.errors import (
    OwnerApprovalRequiredError,
    QuoteInputMissingError,
    QuoteMismatchError,
    QuoteNotDraftError,
    QuoteStaleError,
    RequirementNotConfirmedError,
)
from app.quotes.repository import PostgrestQuotesRepository
from app.tenancy.repository import Forbidden, MfaRequired, TokenRejected, UpstreamError

TENANT = uuid.UUID(int=0xA)
OTHER = uuid.UUID(int=0xB)
ID = uuid.UUID(int=0x1)
CANARY = "CANARY-8e3a90 secret row data"


def repo(handler: Callable[[httpx.Request], httpx.Response]) -> PostgrestQuotesRepository:
    return PostgrestQuotesRepository(
        "http://rest.test",
        "anon-key",
        client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://rest.test"),
    )


def refusing(status: int, code: str) -> Callable[[httpx.Request], httpx.Response]:
    return lambda request: httpx.Response(
        status, json={"code": code, "message": CANARY, "details": CANARY, "hint": CANARY}
    )


@pytest.mark.parametrize(
    ("status", "code", "error"),
    [
        (400, "SM213", RequirementNotConfirmedError),
        (400, "SM214", QuoteNotDraftError),
        (400, "SM215", QuoteStaleError),
        (400, "SM216", QuoteMismatchError),
        (400, "SM217", QuoteInputMissingError),
        (400, "SM218", OwnerApprovalRequiredError),
        (403, "SM306", MfaRequired),
        (403, "42501", Forbidden),
        (409, "23505", ConflictError),
        (409, "23503", InvalidReferenceError),
        (401, "PGRST301", TokenRejected),
    ],
)
def test_each_sqlstate_becomes_its_own_exception_and_the_data_layers_text_is_dropped(
    status: int, code: str, error: type[Exception]
) -> None:
    calls: list[Callable[[PostgrestQuotesRepository], Any]] = [
        lambda r: r.approve("tok", ID, "0" * 64),
        lambda r: r.reject("tok", ID, "other"),
        lambda r: r.withdraw("tok", ID, "other"),
        lambda r: r.create_draft("tok", {}),
        lambda r: r.pick("tok", {}),
        lambda r: r.get_quote("tok", TENANT, ID),
    ]
    for call in calls:
        with pytest.raises(error) as caught:
            call(repo(refusing(status, code)))
        assert (
            CANARY not in str(caught.value)
            and CANARY not in repr(caught.value)
            and caught.value.__cause__ is None
        )


def test_an_unreachable_data_layer_and_a_non_json_answer_are_fixed_errors() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(CANARY)

    with pytest.raises(UpstreamError) as e1:
        repo(down).get_quote("tok", TENANT, ID)
    assert CANARY not in str(e1.value)
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, text="not json")).get_quote("tok", TENANT, ID)
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, json={"not": "a list"})).list_quotes(
            "tok", TENANT, enquiry_id=None, limit=5
        )
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, json=[1, 2])).picks("tok", TENANT, ID)
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, json=[{"x": 1}])).approve(
            "tok", ID, "0" * 64
        )  # a function answers an object


def test_every_request_carries_the_callers_token_and_the_anon_key_never_another_credential() -> (
    None
):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[] if request.method == "GET" else {"quote_id": str(ID)})

    r = repo(handler)
    r.active_price_version("caller-token", TENANT, date(2026, 10, 6))
    r.approve("caller-token", ID, "0" * 64)
    assert len(seen) == 2
    for request in seen:
        assert (
            request.headers["authorization"] == "Bearer caller-token"
            and request.headers["apikey"] == "anon-key"
        )
        assert "service" not in request.headers["authorization"].lower()


def test_every_read_is_scoped_to_the_tenant_even_though_row_level_security_also_is() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"id": str(ID), "company_id": None}])

    r = repo(handler)
    day = date(2026, 10, 6)
    reads: list[Callable[[], Any]] = [
        lambda: r.active_price_version("t", OTHER, day),
        lambda: r.price_items("t", OTHER, ID),
        lambda: r.active_policy("t", OTHER, day),
        lambda: r.policy("t", OTHER, ID),
        lambda: r.active_mapper_config("t", OTHER, day),
        lambda: r.products("t", OTHER),
        lambda: r.picks("t", OTHER, ID),
        lambda: r.company_name("t", OTHER, ID),
        lambda: r.list_quotes("t", OTHER, enquiry_id=None, limit=5),
        lambda: r.list_quotes("t", OTHER, enquiry_id=ID, limit=5),
        lambda: r.get_quote("t", OTHER, ID),
        lambda: r.get_quote_texts("t", OTHER, ID),
    ]
    for read in reads:
        seen.clear()
        read()
        assert seen and all(
            request.url.params.get("tenant_id") == f"eq.{OTHER}" for request in seen
        ), str(seen[0].url)


def test_the_writes_go_through_the_definer_functions_only() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    r = repo(handler)
    r.pick("t", {"p_line": 1})
    r.create_draft("t", {"p_quote_id": "x"})
    r.approve("t", ID, "0" * 64)
    r.reject("t", ID, "other")
    r.withdraw("t", ID, "other")
    assert [(q.method, q.url.path) for q in seen] == [
        ("POST", "/rpc/pick_requirement_line_product"),
        ("POST", "/rpc/create_quote_draft"),
        ("POST", "/rpc/approve_quote"),
        ("POST", "/rpc/reject_quote"),
        ("POST", "/rpc/withdraw_approved_quote"),
    ]
    assert json.loads(seen[2].content) == {"p_quote_id": str(ID), "p_recomputed_hash": "0" * 64}
