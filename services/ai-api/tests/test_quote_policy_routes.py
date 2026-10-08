"""The quote policy pair: POST/GET /v1/tenants/{tenant_id}/quote-policy-versions against an in-memory fake. Authorization order and the role matrix, WHAT is sent to the
database (the caller's own token, the tenant of the PATH, exactly the fields the person sent and no default of ours), strict bodies and their bounds, the replay status,
the newest-first list with the version in force marked, and a fixed sentence for every refusal. The database rules are pgTAP; the real stack is
tests/integration/test_quote_policy_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import uuid
from typing import Any

import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.tenancy.repository import Forbidden, InvalidInput, MfaRequired, UpstreamError
from tests.fakes import TENANT_A, auth, make_client
from tests.quotes_fakes import POLICY_ROW, FakeQuotes

CANARY = "CANARY-9f3b2c"
FIELDS = {
    "discount_ceiling_bps": 0,
    "shipping_flat_fee_paise": 5000,
    "shipping_tax_bps": 1800,
    "validity_days": 15,
    "new_advance_bps": 5000,
    "repeat_advance_bps": 2500,
    "net_days": 30,
    "seller_state": "TG",
}
BODY = {"id": str(uuid.UUID(int=0x9001)), "effective_from": "2026-10-20", **FIELDS}
FULL = {
    **BODY,
    "shipping_free_above_paise": 1_000_000,
    "tax_mode": "exclusive",
    "rounding_mode": "half_even",
    "repeat_credit_limit_paise": 250_000,
    "required_inputs": ["delivery_state", "deadline"],
}
URL = "/quote-policy-versions"
ENDPOINTS: list[tuple[str, dict[str, Any] | None]] = [("GET", None), ("POST", BODY)]


class World:
    def __init__(self) -> None:
        self.q = FakeQuotes()
        self.q.tenant = TENANT_A.id
        self.client, _ = make_client(quotes=self.q)

    def call(
        self,
        method: str,
        body: Any,
        user: str | None,
        tenant: uuid.UUID = TENANT_A.id,
        **claims: Any,
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, f"/v1/tenants/{tenant}{URL}", json=body, headers=headers)

    def post(self, body: Any = BODY, user: str = "a_owner", **claims: Any) -> Any:
        return self.call("POST", body, user, **claims)

    def sent(self, name: str) -> list[Any]:
        return [args for n, args in self.q.calls if n == name]


@pytest.fixture
def w() -> World:
    return World()


def who(token: str) -> tuple[Any, Any]:
    """(subject, aal) of a test token: tokens are minted fresh on every call, so they are compared by what they say."""
    payload = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return claims["sub"], claims.get("aal")


def bearer(user: str, **claims: Any) -> str:
    return auth(user, **claims)["Authorization"].removeprefix("Bearer ")


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


# ----------------------------------------------------------------------------- authorization (gate first)
@pytest.mark.parametrize(("method", "body"), ENDPOINTS)
def test_nobody_without_a_token_no_sales_no_viewer_and_no_outsider_gets_anything_and_nothing_is_read(
    w: World, method: str, body: Any
) -> None:
    assert w.call(method, body, None).status_code == 401
    for user in ("a_sales", "a_viewer"):
        r = w.call(method, body, user)
        assert r.status_code == 403 and code(r) == "forbidden", (method, user)
    outsider = w.call(method, body, "outsider")
    assert outsider.status_code == 404 and code(outsider) == "not_found"
    assert w.call(method, body, "b_owner", TENANT_A.id).status_code == 404  # another tenant's Owner
    assert w.q.tokens == [] and w.q.calls == []  # a refused caller never reaches the data layer


@pytest.mark.parametrize("user", ["a_owner", "a_admin"])
def test_an_owner_and_an_admin_with_a_second_factor_publish_and_read(w: World, user: str) -> None:
    assert w.post(user=user).status_code == 201
    assert w.call("GET", None, user).status_code == 200


@pytest.mark.parametrize("user", ["a_owner", "a_admin"])
@pytest.mark.parametrize("claim", [{"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}])
def test_publishing_needs_a_second_factor_and_nothing_is_sent_without_one(
    w: World, user: str, claim: dict[str, Any]
) -> None:
    r = w.post(user=user, **claim)
    assert r.status_code == 403 and code(r) == "mfa_required", (user, claim)
    assert w.q.calls == [] and w.q.tokens == []


def test_reading_does_not_need_the_second_factor_the_database_does_not_ask_for_it(
    w: World,
) -> None:
    assert w.call("GET", None, "a_owner", aal="aal1").status_code == 200


def test_the_pair_is_unavailable_without_the_quotes_repository() -> None:
    client, _ = make_client()
    for method, body in ENDPOINTS:
        r = client.request(
            method, f"/v1/tenants/{TENANT_A.id}{URL}", json=body, headers=auth("a_owner")
        )
        assert r.status_code == 503 and r.json()["error"]["code"] == "quotes_unavailable", method


# ----------------------------------------------------------------------------- a thin pass-through
def test_the_database_gets_the_callers_token_the_path_tenant_and_exactly_the_fields_sent(
    w: World,
) -> None:
    r = w.post()
    assert r.status_code == 201
    (args,) = w.sent("create_policy")
    assert args == {
        "p_version_id": BODY["id"],
        "p_tenant_id": str(TENANT_A.id),
        "p_effective_from": "2026-10-20",
        "p_policy": FIELDS,
    }, "no default of ours: an absent optional field is not sent"
    assert [who(t) for t in w.q.tokens] == [who(bearer("a_owner"))]


def test_every_field_the_person_sent_goes_through_unchanged(w: World) -> None:
    assert w.post(FULL).status_code == 201
    (args,) = w.sent("create_policy")
    assert args["p_policy"] == {k: v for k, v in FULL.items() if k not in ("id", "effective_from")}


def test_an_explicit_null_is_not_sent_either(w: World) -> None:
    assert w.post({**BODY, "shipping_free_above_paise": None, "tax_mode": None}).status_code == 201
    (args,) = w.sent("create_policy")
    assert (
        "shipping_free_above_paise" not in args["p_policy"] and "tax_mode" not in args["p_policy"]
    )


def test_the_answer_carries_only_the_four_things_the_person_needs(w: World) -> None:
    r = w.post()
    assert r.json() == {
        "version_id": BODY["id"],
        "version_no": 2,
        "effective_from": "2026-10-20",
        "replayed": False,
    }, "the content hash of the database result is not passed on"


def test_a_retry_of_the_same_id_is_a_200_replay_and_a_new_id_is_a_new_201(w: World) -> None:
    first = w.post()
    again = w.post()
    assert first.status_code == 201 and first.json()["replayed"] is False
    assert again.status_code == 200 and again.json()["replayed"] is True
    assert again.json()["version_no"] == first.json()["version_no"]
    other = w.post({**BODY, "id": str(uuid.UUID(int=0x9002))})
    assert other.status_code == 201 and other.json()["version_no"] == first.json()["version_no"] + 1


# ----------------------------------------------------------------------------- strict bodies, checked before anything is read
@pytest.mark.parametrize(
    "extra",
    [
        "tenant_id",
        "version_no",
        "content_sha256",
        "created_by",
        "created_at",
        "in_force",
        "gst_bps",
        "tax_bps",
        "approver",
        "total",
        "p_policy",
    ],
)
def test_a_field_the_database_derives_or_the_policy_does_not_have_is_refused(
    w: World, extra: str
) -> None:
    r = w.post({**BODY, extra: 1})
    assert r.status_code == 422 and code(r) == "validation_error", extra
    assert w.q.calls == [] and w.q.tokens == []


@pytest.mark.parametrize("missing", sorted([*FIELDS, "id", "effective_from"]))
def test_a_missing_required_field_is_refused(w: World, missing: str) -> None:
    r = w.post({k: v for k, v in BODY.items() if k != missing})
    assert r.status_code == 422 and code(r) == "validation_error", missing
    assert w.q.calls == []


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("discount_ceiling_bps", -1),
        ("discount_ceiling_bps", 10001),
        ("shipping_flat_fee_paise", -1),
        ("shipping_flat_fee_paise", 100_000_001),
        ("shipping_free_above_paise", -1),
        ("shipping_free_above_paise", 100_000_001),
        ("shipping_tax_bps", 10001),
        ("validity_days", 0),
        ("validity_days", 366),
        ("new_advance_bps", 10001),
        ("repeat_advance_bps", -1),
        ("net_days", -1),
        ("net_days", 181),
        ("repeat_credit_limit_paise", -1),
        ("repeat_credit_limit_paise", 1_000_000_001),
        ("seller_state", "tg"),
        ("seller_state", "T"),
        ("seller_state", "TGX"),
        ("seller_state", "T1"),
        ("seller_state", "TG\n"),
        ("seller_state", 12),
        ("tax_mode", "inclusive"),
        ("tax_mode", ""),
        ("rounding_mode", "up"),
        ("required_inputs", "delivery_state"),
        ("required_inputs", ["gst_number"]),
        ("required_inputs", [1]),
        ("required_inputs", ["delivery_state"] * 5),
        ("effective_from", "tomorrow"),
        ("effective_from", "20-10-2026"),
        ("effective_from", None),
        ("id", "not-a-uuid"),
        ("id", None),
    ],
)
def test_a_value_outside_the_database_bounds_or_of_the_wrong_kind_is_refused_first(
    w: World, field: str, bad: Any
) -> None:
    r = w.post({**FULL, field: bad})
    assert r.status_code == 422 and code(r) == "validation_error", (field, bad)
    assert w.q.calls == [] and w.q.tokens == []


@pytest.mark.parametrize(
    "field", [f for f in FIELDS if f != "seller_state"] + ["shipping_free_above_paise"]
)
@pytest.mark.parametrize("bad", [1.5, "100", True, [1]])
def test_a_number_must_be_a_whole_number_not_a_float_a_string_or_a_flag(
    w: World, field: str, bad: Any
) -> None:
    r = w.post({**FULL, field: bad})
    assert r.status_code == 422, (field, bad)
    assert w.q.calls == []


@pytest.mark.parametrize(
    ("field", "edge"),
    [
        ("discount_ceiling_bps", 0),
        ("discount_ceiling_bps", 10000),
        ("shipping_flat_fee_paise", 100_000_000),
        ("shipping_free_above_paise", 0),
        ("shipping_free_above_paise", 100_000_000),
        ("shipping_tax_bps", 10000),
        ("validity_days", 1),
        ("validity_days", 365),
        ("new_advance_bps", 10000),
        ("repeat_advance_bps", 0),
        ("net_days", 0),
        ("net_days", 180),
        ("repeat_credit_limit_paise", 0),
        ("repeat_credit_limit_paise", 1_000_000_000),
        ("seller_state", "KA"),
        ("rounding_mode", "half_up"),
        ("rounding_mode", "down"),
        ("required_inputs", []),
        ("required_inputs", ["delivery_state", "delivery_city", "payment_terms", "deadline"]),
    ],
)
def test_the_boundary_values_themselves_are_accepted_and_sent_as_typed(
    w: World, field: str, edge: Any
) -> None:
    assert w.post({**FULL, field: edge}).status_code == 201, (field, edge)
    (args,) = w.sent("create_policy")
    assert args["p_policy"][field] == edge


def test_the_api_decides_nothing_the_database_decides_a_repeated_input_or_a_missing_delivery_state(
    w: World,
) -> None:
    # the API checks shape and bounds only: whether delivery_state is required, or an entry is repeated, is the database's rule
    assert w.post({**FULL, "required_inputs": ["deadline", "deadline"]}).status_code == 201
    assert (
        w.post({**FULL, "id": str(uuid.uuid4()), "required_inputs": ["deadline"]}).status_code
        == 201
    )
    sent = w.sent("create_policy")
    assert sent[0]["p_policy"]["required_inputs"] == ["deadline", "deadline"]
    assert sent[1]["p_policy"]["required_inputs"] == ["deadline"]


def test_a_date_in_the_past_is_not_the_apis_to_judge_either(w: World) -> None:
    assert w.post({**BODY, "effective_from": "2020-01-01"}).status_code == 201
    assert w.sent("create_policy")[0]["p_effective_from"] == "2020-01-01"


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
    r = w.post()
    assert r.status_code == status and code(r) == name
    assert CANARY not in r.text and set(r.json()["error"]) == {"code", "message"}
    assert r.json()["error"]["message"].endswith(".")


def test_a_refusal_never_echoes_a_value_the_person_typed(w: World) -> None:
    # the app-wide handler (app/errors.py) names the FIELD that failed, never the value; an unknown key is the one name the caller chose
    # (reported, not changed: the handler is shared by every route)
    for bad in (
        {"seller_state": CANARY},
        {"required_inputs": [CANARY]},
        {"tax_mode": CANARY},
        {"rounding_mode": CANARY},
        {"id": CANARY},
        {"effective_from": CANARY},
        {"net_days": CANARY},
    ):
        r = w.post({**FULL, **bad})
        assert r.status_code == 422 and CANARY not in r.text, bad
        assert set(r.json()["error"]) == {"code", "message"}


def test_a_failed_publish_is_not_remembered_as_a_replay(w: World) -> None:
    w.q.errors.append(InvalidValueError("23514"))
    assert w.post().status_code == 422
    r = w.post()
    assert r.status_code == 201 and r.json()["replayed"] is False


# ----------------------------------------------------------------------------- the list
def row(i: int, effective: str, **over: Any) -> dict[str, Any]:
    return {
        **POLICY_ROW,
        "id": str(uuid.UUID(int=0x8000 + i)),
        "version_no": i,
        "effective_from": effective,
        "created_at": f"2026-10-0{i}T05:00:00+00:00",
        **over,
    }


def test_the_list_is_newest_first_in_the_order_the_database_returns_with_the_one_in_force_marked(
    w: World,
) -> None:
    rows = [row(3, "2099-01-01"), row(2, "2026-10-05"), row(1, "2026-10-01")]
    w.q.policy_list = rows
    w.q.policy_row = rows[
        1
    ]  # the in-force rule is the database's: the latest effective_from not after today
    r = w.call("GET", None, "a_owner")
    assert r.status_code == 200
    body = r.json()
    assert [v["version_no"] for v in body] == [3, 2, 1]
    assert [v["in_force"] for v in body] == [False, True, False]
    assert sum(v["in_force"] for v in body) == 1


def test_a_list_with_no_version_in_force_marks_none(w: World) -> None:
    w.q.policy_list = [row(1, "2099-01-01")]
    w.q.policy_row = None
    assert [v["in_force"] for v in w.call("GET", None, "a_admin").json()] == [False]


def test_the_list_reports_every_policy_field_and_nothing_else(w: World) -> None:
    w.q.policy_list = [
        row(1, "2026-10-01", **{"content_sha256": "x", "tenant_id": "t", "created_by": "u"})
    ]
    (v,) = w.call("GET", None, "a_owner").json()
    assert set(v) == {
        "id",
        "version_no",
        "effective_from",
        "discount_ceiling_bps",
        "shipping_flat_fee_paise",
        "shipping_free_above_paise",
        "shipping_tax_bps",
        "validity_days",
        "new_advance_bps",
        "repeat_advance_bps",
        "net_days",
        "tax_mode",
        "rounding_mode",
        "repeat_credit_limit_paise",
        "seller_state",
        "required_inputs",
        "created_at",
        "in_force",
    }


def test_the_list_asks_with_the_callers_token_the_path_tenant_and_a_bounded_page(w: World) -> None:
    assert w.call("GET", None, "a_owner").status_code == 200
    assert w.sent("list_policies") == [{"tenant_id": str(TENANT_A.id), "limit": 50}]
    assert {who(t) for t in w.q.tokens} == {who(bearer("a_owner"))}


def test_an_empty_workspace_has_an_empty_list(w: World) -> None:
    w.q.policy_list = []
    w.q.policy_row = None
    r = w.call("GET", None, "a_owner")
    assert r.status_code == 200 and r.json() == []


def test_a_list_failure_is_a_fixed_sentence(w: World) -> None:
    def boom(*_a: Any, **_k: Any) -> Any:
        raise UpstreamError("down " + CANARY)

    w.q.list_policies = boom  # type: ignore[method-assign]
    r = w.call("GET", None, "a_owner")
    assert r.status_code == 502 and CANARY not in r.text
