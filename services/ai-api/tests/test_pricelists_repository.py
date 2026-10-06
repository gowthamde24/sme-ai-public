"""The PostgREST adapter for price lists (app/pricelists/repository.py) against a mock transport: what it sends (the caller's own token, the anon key, the tenant filter, only active and
unarchived products, the definer function for the one write) and how it classifies what comes back (SQLSTATE only; nothing from the data layer reaches an exception)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.pricelists.repository import CHUNK, PostgrestPriceListRepository
from app.tenancy.repository import Forbidden, MfaRequired, TokenRejected, UpstreamError

TENANT = uuid.UUID(int=0xA)
CANARY = "CANARY-31d0aa secret row data"
P1 = uuid.UUID(int=0x1)


def repo(handler: Callable[[httpx.Request], httpx.Response]) -> PostgrestPriceListRepository:
    return PostgrestPriceListRepository(
        "http://rest.test",
        "anon-key",
        client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://rest.test"),
    )


def row(sku: str, i: int = 1) -> dict[str, str]:
    return {"id": str(uuid.UUID(int=i)), "sku": sku, "name": f"name of {sku}", "unit": "piece"}


def test_products_are_read_with_the_callers_token_a_tenant_filter_and_only_active_unarchived_ones() -> (
    None
):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[row("A-1"), row("B-2", 2)])

    found = repo(handler).products_by_sku("user-token", TENANT, ["B-2", "A-1", "A-1"])
    (request,) = seen
    assert (
        request.headers["authorization"] == "Bearer user-token"
        and request.headers["apikey"] == "anon-key"
    )
    params = dict(request.url.params)
    assert (
        params["tenant_id"] == f"eq.{TENANT}"
        and params["active"] == "eq.true"
        and params["archived_at"] == "is.null"
        and params["sku"] == "in.(A-1,B-2)"
    )
    assert (
        sorted(found) == ["A-1", "B-2"]
        and found["A-1"].name == "name of A-1"
        and found["B-2"].unit == "piece"
    )


def test_a_sku_that_is_not_shaped_like_one_is_never_sent() -> None:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    repo(record).products_by_sku("t", TENANT, ["A,B", 'a"b', "x)", "ok-1", "=CMD", ""])
    assert [dict(r.url.params)["sku"] for r in seen] == ["in.(ok-1)"]
    seen.clear()
    assert (
        repo(lambda r: httpx.Response(200, json=[])).products_by_sku("t", TENANT, ["A,B"]) == {}
        and seen == []
    )


def test_a_product_without_a_unit_is_sold_by_the_piece() -> None:
    found = repo(
        lambda r: httpx.Response(200, json=[{"id": str(P1), "sku": "A", "name": "n", "unit": None}])
    ).products_by_sku("t", TENANT, ["A"])
    assert found["A"].unit == "piece"


def test_a_long_list_is_asked_in_chunks() -> None:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    repo(record).products_by_sku("t", TENANT, [f"S{i}" for i in range(201)])
    assert (
        CHUNK == 100
        and len(seen) == 3
        and all(len(dict(r.url.params)["sku"].split(",")) <= 100 for r in seen)
    )


@pytest.mark.parametrize(
    "body",
    [
        {"not": "a list"},
        [1],
        [{"id": 1, "sku": "A", "name": "n", "unit": "piece"}],
        [{"id": str(P1), "sku": "A"}],
    ],
)
def test_a_malformed_catalog_answer_is_refused(body: Any) -> None:
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, json=body)).products_by_sku("t", TENANT, ["A"])


def test_the_one_write_is_the_definer_function_with_the_callers_token() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"version_id": str(P1)})

    out = repo(handler).create_version("user-token", {"p_version_id": str(P1), "p_items": []})
    (request,) = seen
    assert request.method == "POST" and request.url.path == "/rpc/create_price_list_version"
    assert (
        request.headers["authorization"] == "Bearer user-token"
        and request.headers["apikey"] == "anon-key"
    )
    assert json.loads(request.content) == {"p_version_id": str(P1), "p_items": []} and out == {
        "version_id": str(P1)
    }
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, json=[1])).create_version("t", {})


@pytest.mark.parametrize(
    ("status", "code", "error"),
    [
        (409, "23505", ConflictError),
        (409, "23503", InvalidReferenceError),
        (400, "22023", InvalidValueError),
        (400, "23514", InvalidValueError),
        (403, "SM306", MfaRequired),
        (403, "42501", Forbidden),
        (401, "PGRST301", TokenRejected),
    ],
)
def test_every_sqlstate_becomes_one_typed_exception_without_the_data_layers_text(
    status: int, code: str, error: type[Exception]
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json={"code": code, "message": CANARY, "details": CANARY, "hint": CANARY}
        )

    with pytest.raises(error) as caught:
        repo(handler).create_version("t", {})
    assert CANARY not in str(caught.value) and CANARY not in repr(caught.value.__cause__)


def test_an_unknown_answer_and_a_dead_data_layer_are_an_upstream_error_without_text() -> None:
    with pytest.raises(UpstreamError) as caught:
        repo(lambda r: httpx.Response(500, text=CANARY)).create_version("t", {})
    assert CANARY not in str(caught.value)

    def dead(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(CANARY)

    with pytest.raises(UpstreamError) as down:
        repo(dead).products_by_sku("t", TENANT, ["A"])
    assert CANARY not in str(down.value) and CANARY not in repr(down.value.__cause__)
