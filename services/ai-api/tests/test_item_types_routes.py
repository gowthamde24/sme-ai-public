"""Item types: GET /v1/tenants/{tenant_id}/item-types and PUT /v1/tenants/{tenant_id}/item-types/{code} against an in-memory fake (manual-price quote, slice 1).
Authorization order and the role matrix, WHAT is sent to the database (the caller's own token, the tenant of the PATH, exactly the fields the person sent, a price bound left out as
null), strict bodies and their bounds, and a fixed sentence for every refusal. The database rules (RLS, the role, the second factor, min <= max) are pgTAP 67; the real stack is
tests/integration/test_item_types_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.tenancy.repository import Forbidden, InvalidInput, MfaRequired, UpstreamError
from tests.fakes import TENANT_A, auth, make_client
from tests.quotes_fakes import FakeQuotes

CANARY = "CANARY-5d1e7a"
BODY: dict[str, Any] = {
    "name": "Item type one",
    "position": 3,
    "active": True,
    "min_price_paise": 150_000,
    "max_price_paise": 1_000_000,
}


class World:
    def __init__(self) -> None:
        self.q = FakeQuotes()
        self.q.tenant = TENANT_A.id
        self.client, _ = make_client(quotes=self.q)

    def call(
        self,
        method: str,
        path: str,
        body: Any,
        user: str | None,
        tenant: uuid.UUID = TENANT_A.id,
        **claims: Any,
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(
            method, f"/v1/tenants/{tenant}/item-types{path}", json=body, headers=headers
        )

    def put(self, body: Any = BODY, code: str = "01", user: str = "a_owner", **claims: Any) -> Any:
        return self.call("PUT", f"/{code}", body, user, **claims)

    def sent(self, name: str) -> list[Any]:
        return [args for n, args in self.q.calls if n == name]


@pytest.fixture
def w() -> World:
    return World()


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


# ----------------------------------------------------------------------------- authorization (gate first)
def test_nobody_without_a_token_and_no_outsider_gets_anything_and_nothing_is_read(
    w: World,
) -> None:
    for method, path, body in (("GET", "", None), ("PUT", "/01", BODY)):
        assert w.call(method, path, body, None).status_code == 401
        outsider = w.call(method, path, body, "outsider")
        assert outsider.status_code == 404 and code(outsider) == "not_found"
        assert w.call(method, path, body, "b_owner", TENANT_A.id).status_code == 404
    assert w.q.tokens == [] and w.q.calls == []


def test_a_viewer_reads_no_price_and_sales_cannot_write(w: World) -> None:
    assert w.call("GET", "", None, "a_viewer").status_code == 403
    assert w.put(user="a_viewer").status_code == 403
    assert w.put(user="a_sales").status_code == 403
    assert w.call("GET", "", None, "a_sales").status_code == 200
    assert w.q.calls == [("list_item_types", {"tenant_id": str(TENANT_A.id)})]


@pytest.mark.parametrize("user", ["a_owner", "a_admin"])
def test_an_owner_and_an_admin_with_a_second_factor_save(w: World, user: str) -> None:
    assert w.put(user=user).status_code == 200


@pytest.mark.parametrize("user", ["a_owner", "a_admin"])
@pytest.mark.parametrize("claim", [{"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}])
def test_saving_needs_a_second_factor_and_nothing_is_sent_without_one(
    w: World, user: str, claim: dict[str, Any]
) -> None:
    r = w.put(user=user, **claim)
    assert r.status_code == 403 and code(r) == "mfa_required"
    assert w.q.calls == [] and w.q.tokens == []


def test_reading_does_not_need_the_second_factor(w: World) -> None:
    assert w.call("GET", "", None, "a_owner", aal="aal1").status_code == 200


def test_the_pair_is_unavailable_without_the_quotes_repository() -> None:
    client, _ = make_client()
    for method, path, body in (("GET", "", None), ("PUT", "/01", BODY)):
        r = client.request(
            method,
            f"/v1/tenants/{TENANT_A.id}/item-types{path}",
            json=body,
            headers=auth("a_owner"),
        )
        assert r.status_code == 503 and r.json()["error"]["code"] == "quotes_unavailable"


# ----------------------------------------------------------------------------- a thin pass-through
def test_the_database_gets_the_path_tenant_the_path_code_and_exactly_the_fields_sent(
    w: World,
) -> None:
    r = w.put()
    assert r.status_code == 200
    assert r.json() == {"id": str(uuid.UUID(int=0xA000)), "code": "01", "created": True}
    (args,) = w.sent("save_item_type")
    assert args == {
        "p_tenant_id": str(TENANT_A.id),
        "p_code": "01",
        "p_name": "Item type one",
        "p_position": 3,
        "p_active": True,
        "p_min_price_paise": 150_000,
        "p_max_price_paise": 1_000_000,
    }


def test_a_bound_left_out_is_sent_as_null_because_the_call_replaces_the_record(w: World) -> None:
    assert w.put({"name": "Only a name"}).status_code == 200
    (args,) = w.sent("save_item_type")
    assert args["p_min_price_paise"] is None and args["p_max_price_paise"] is None
    assert args["p_position"] == 0 and args["p_active"] is True


def test_a_second_save_of_the_same_code_is_not_created_again(w: World) -> None:
    assert w.put().json()["created"] is True
    again = w.put({**BODY, "name": "Renamed"})
    assert again.status_code == 200 and again.json()["created"] is False


def test_the_name_is_trimmed_and_the_code_comes_from_the_path_only(w: World) -> None:
    assert w.put({**BODY, "name": "  padded  "}, code="AB-12_x").status_code == 200
    (args,) = w.sent("save_item_type")
    assert args["p_name"] == "padded" and args["p_code"] == "AB-12_x"
    assert w.put({**BODY, "code": "02"}).status_code == 422  # not a body field


# ----------------------------------------------------------------------------- strict bodies, checked before anything is read
@pytest.mark.parametrize(
    "extra", ["tenant_id", "id", "created_by", "price", "override", "unit_price_paise", "tax_bps"]
)
def test_a_field_that_is_not_the_callers_to_set_is_refused(w: World, extra: str) -> None:
    r = w.put({**BODY, extra: 1})
    assert r.status_code == 422 and code(r) == "validation_error"
    assert w.q.calls == [] and w.q.tokens == []


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("name", ""),
        ("name", "   "),
        ("name", "x" * 201),
        ("name", 5),
        ("name", None),
        ("position", -1),
        ("position", 10001),
        ("position", 1.5),
        ("position", "1"),
        ("active", "yes"),
        ("active", 1),
        ("active", None),
        ("min_price_paise", 0),
        ("min_price_paise", -5),
        ("min_price_paise", 100_000_001),
        ("min_price_paise", 1.5),
        ("min_price_paise", "100"),
        ("min_price_paise", True),
        ("max_price_paise", 0),
        ("max_price_paise", 100_000_001),
        ("max_price_paise", 99.5),
    ],
)
def test_a_value_outside_the_database_bounds_or_of_the_wrong_kind_is_refused_first(
    w: World, field: str, bad: Any
) -> None:
    r = w.put({**BODY, field: bad})
    assert r.status_code == 422 and code(r) == "validation_error", (field, bad)
    assert w.q.calls == [] and w.q.tokens == []


def test_a_lowest_price_above_the_highest_is_refused_first(w: World) -> None:
    r = w.put({**BODY, "min_price_paise": 1_000_001, "max_price_paise": 1_000_000})
    assert r.status_code == 422 and code(r) == "validation_error"
    assert w.q.calls == []


@pytest.mark.parametrize(
    "bound",
    [
        {"min_price_paise": 5000, "max_price_paise": 5000},
        {"min_price_paise": 1},
        {"max_price_paise": 100_000_000},
    ],
)
def test_equal_bounds_and_a_single_bound_are_accepted(w: World, bound: dict[str, Any]) -> None:
    assert w.put({"name": "Bounds", **bound}).status_code == 200


@pytest.mark.parametrize("bad_code", ["a b", "-x", "_x", "x" * 21, "a.b", "a%20b"])
def test_a_code_that_is_not_a_plain_short_code_is_refused(w: World, bad_code: str) -> None:
    assert w.put(code=bad_code).status_code in (404, 422)
    assert w.q.calls == []


# ----------------------------------------------------------------------------- every refusal is a fixed sentence
ERRORS: list[tuple[Exception, int, str]] = [
    (Forbidden("42501"), 403, "forbidden"),
    (MfaRequired("SM306"), 403, "mfa_required"),
    (InvalidInput("22023"), 422, "validation_error"),
    (InvalidValueError("23514"), 422, "invalid_value"),
    (InvalidReferenceError("23503"), 422, "invalid_reference"),
    (ConflictError("23505"), 409, "conflict"),
    (UpstreamError("boom " + CANARY), 502, "upstream_error"),
]


@pytest.mark.parametrize(("error", "status", "name"), ERRORS)
def test_every_refusal_has_a_fixed_message_and_no_data_layer_text(
    w: World, error: Exception, status: int, name: str
) -> None:
    w.q.errors.append(error)
    r = w.put()
    assert r.status_code == status and code(r) == name
    assert CANARY not in r.text and set(r.json()["error"]) == {"code", "message"}


def test_a_refusal_never_echoes_a_value_the_person_typed(w: World) -> None:
    for bad in ({"name": CANARY * 40}, {"min_price_paise": CANARY}, {"active": CANARY}):
        r = w.put({**BODY, **bad})
        assert r.status_code == 422 and CANARY not in r.text, bad


# ----------------------------------------------------------------------------- the list
def test_the_list_reports_exactly_the_item_type_fields_in_the_order_the_database_returns(
    w: World,
) -> None:
    w.q.item_type_rows = [
        {
            "id": str(uuid.UUID(int=1)),
            "code": "01",
            "name": "One",
            "position": 1,
            "active": True,
            "min_price_paise": 100,
            "max_price_paise": None,
        },
        {
            "id": str(uuid.UUID(int=2)),
            "code": "02",
            "name": "Two",
            "position": 2,
            "active": False,
            "min_price_paise": None,
            "max_price_paise": None,
        },
    ]
    r = w.call("GET", "", None, "a_admin")
    assert r.status_code == 200
    body = r.json()
    assert [t["code"] for t in body] == ["01", "02"]
    assert set(body[0]) == {
        "id",
        "code",
        "name",
        "position",
        "active",
        "min_price_paise",
        "max_price_paise",
    }
    assert body[1]["active"] is False and body[1]["min_price_paise"] is None


def test_the_list_asks_about_the_path_tenant_only_and_an_empty_workspace_has_an_empty_list(
    w: World,
) -> None:
    assert w.call("GET", "", None, "a_owner").json() == []
    assert w.sent("list_item_types") == [{"tenant_id": str(TENANT_A.id)}]


def test_a_list_failure_is_a_fixed_sentence(w: World) -> None:
    def boom(*_a: Any, **_k: Any) -> Any:
        raise UpstreamError("down " + CANARY)

    w.q.list_item_types = boom  # type: ignore[method-assign]
    r = w.call("GET", "", None, "a_owner")
    assert r.status_code == 502 and CANARY not in r.text
