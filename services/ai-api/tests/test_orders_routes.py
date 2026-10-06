"""Order conversion commit 5: the HTTP side of orders against an in-memory fake: authorization order and the role matrix on every endpoint, WHAT is sent to the database (the lifecycle
request built from the order's recorded state, its result, the person's inputs, the caller's own token), that no body can carry a total, a state, an approver or `owner_override`, and the
fixed error mapping of SM230-SM239 (SM232 through a closed list of reasons). The database rules are pgTAP 61; the real stack is tests/integration/test_order_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest

from app.main import ORDER_REASON_TEXT
from app.orders import lifecycle_port
from app.orders.builder import OrderEvent, build_request
from app.orders.errors import REASONS
from app.tenancy.models import Role
from app.tenancy.repository import Forbidden, MfaRequired, UpstreamError
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.orders_fakes import (
    LEAD,
    ORDER,
    QUOTE,
    FakeOrders,
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
    order_row,
    state_of,
)

P1 = "11111111-1111-4111-8111-111111111111"
EVENT = "22222222-2222-4222-8222-222222222222"
CANARY = "CANARY-9f3b2c"


class World:
    def __init__(self) -> None:
        self.o = FakeOrders(TENANT_A.id)
        self.client, _ = make_client(orders=self.o)

    def url(self, path: str, tenant: uuid.UUID = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}{path}"

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
        return self.client.request(method, self.url(path, tenant), json=body, headers=headers)

    def event(
        self, body: dict[str, Any], user: str = "a_sales", order: uuid.UUID = ORDER, **claims: Any
    ) -> Any:
        return self.call("POST", f"/orders/{order}/events", {"id": EVENT, **body}, user, **claims)

    def sent(self, name: str) -> list[dict[str, Any]]:
        return [args for n, args in self.o.calls if n == name]


@pytest.fixture
def w() -> World:
    return World()


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


CREATE_BODY = {"id": str(uuid.uuid4()), "quote_id": str(QUOTE)}
POLICY_BODY = {
    "id": str(uuid.uuid4()),
    "effective_from": "2026-10-07",
    "advance_required": True,
    "dispatch_requires_advance": True,
    "cancel_allowed_until_state": "in_preparation",
    "allow_zero_value_orders": False,
}
EVENT_BODY = {"id": EVENT, "type": "send_quote"}
ALL_ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/orders", None),
    ("GET", f"/orders/{ORDER}", None),
    ("POST", "/orders", CREATE_BODY),
    ("POST", f"/orders/{ORDER}/events", EVENT_BODY),
    ("POST", "/order-policy-versions", POLICY_BODY),
]


# ----------------------------------------------------------------------------- authorization
@pytest.mark.parametrize(("method", "path", "body"), ALL_ENDPOINTS)
def test_nobody_without_a_token_no_viewer_and_no_outsider_gets_anything_and_nothing_is_read(
    w: World, method: str, path: str, body: Any
) -> None:
    assert w.call(method, path, body, None).status_code == 401
    viewer = w.call(method, path, body, "a_viewer")
    assert viewer.status_code == 403 and code(viewer) == "forbidden"
    outsider = w.call(method, path, body, "outsider")
    assert outsider.status_code == 404 and code(outsider) == "not_found"
    assert (
        w.call(method, path, body, "b_owner", TENANT_A.id).status_code == 404
    )  # a member of ANOTHER tenant on this tenant's path
    assert w.o.tokens == [] and w.o.calls == []  # a refused caller never reaches the data layer


def test_creating_an_order_is_the_owners_or_admins_with_a_second_factor_and_a_policy_is_the_owners(
    w: World,
) -> None:
    assert w.call("POST", "/orders", CREATE_BODY, "a_sales").status_code == 403
    for user in ("a_owner", "a_admin"):
        for claim in ({"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}):
            r = w.call("POST", "/orders", CREATE_BODY, user, **claim)
            assert r.status_code == 403 and code(r) == "mfa_required", (user, claim)
    for user in ("a_admin", "a_sales"):
        assert w.call("POST", "/order-policy-versions", POLICY_BODY, user).status_code == 403, user
    for claim in ({"aal": "aal1"}, {"aal": None}):
        r = w.call("POST", "/order-policy-versions", POLICY_BODY, "a_owner", **claim)
        assert r.status_code == 403 and code(r) == "mfa_required"
    assert w.o.calls == []


def test_sales_reads_and_records_events_and_the_database_decides_the_rest(w: World) -> None:
    assert w.call("GET", "/orders", None, "a_sales").status_code == 200
    assert w.call("GET", f"/orders/{ORDER}", None, "a_sales").status_code == 200
    assert w.event(EVENT_BODY).status_code == 200  # Sales may report "I sent the quote"
    # a payment is the Owner's or Admin's: the DATABASE refuses Sales (42501) and the route reports one generic denial
    w.o.raise_next = Forbidden("42501")
    r = w.event({"type": "record_payment", "amount_paise": 100, "ledger_id": P1}, "a_sales")
    assert r.status_code == 403 and code(r) == "forbidden"


def test_orders_are_unavailable_without_their_repository() -> None:
    client, _ = make_client()
    r = client.get(f"/v1/tenants/{TENANT_A.id}/orders", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "orders_unavailable"


# ----------------------------------------------------------------------------- the body can never carry what the database derives
FORBIDDEN_FIELDS = [
    "total",
    "order_total_paise",
    "state",
    "new_state",
    "approver",
    "owner_approved_by",
    "owner_override",
    "approved_by",
    "recorded_by",
    "tenant_id",
    "balance_paise",
    "flags",
    "request_text",
    "result_text",
    "engine_version",
    "canonical_hash",
    "seq",
]


@pytest.mark.parametrize("field", FORBIDDEN_FIELDS)
def test_an_event_body_with_a_field_the_database_derives_is_refused_and_nothing_is_read(
    w: World, field: str
) -> None:
    r = w.event({"type": "send_quote", field: True if field == "owner_override" else 1})
    assert r.status_code == 422 and code(r) == "validation_error", field
    assert w.o.calls == [] and w.o.tokens == []


@pytest.mark.parametrize(
    "field",
    [
        "total_paise",
        "order_total_paise",
        "advance_paise",
        "state",
        "approver",
        "owner_override",
        "tenant_id",
        "valid_until",
    ],
)
def test_creating_an_order_takes_no_figure_from_the_body(w: World, field: str) -> None:
    r = w.call("POST", "/orders", {**CREATE_BODY, field: 1}, "a_owner")
    assert r.status_code == 422 and w.o.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {"type": "teleport"},
        {"type": "record_payment"},
        {"type": "record_payment", "amount_paise": 100},
        {"type": "record_payment", "ledger_id": P1},
        {"type": "record_refund", "amount_paise": 100},
        {"type": "send_quote", "amount_paise": 100},
        {"type": "dispatch", "ledger_id": P1},
        {"type": "record_payment", "amount_paise": 0, "ledger_id": P1},
        {"type": "record_payment", "amount_paise": -5, "ledger_id": P1},
        {"type": "record_payment", "amount_paise": 1_000_000_001, "ledger_id": P1},
        {"type": "record_payment", "amount_paise": 1.5, "ledger_id": P1},
        {"type": "record_payment", "amount_paise": True, "ledger_id": P1},
        {"type": "record_payment", "amount_paise": "100", "ledger_id": P1},
        {"type": "record_payment", "amount_paise": 100, "ledger_id": "not-a-uuid"},
        {"type": "customer_decline"},
        {"type": "customer_decline", "reason_code": "because"},
        {"type": "send_quote", "reason_code": "price"},
        {"type": "send_quote", "occurred_at": "2026-10-06T10:00:00"},
        {"type": "send_quote", "occurred_at": "yesterday"},
        {"id": "not-a-uuid", "type": "send_quote"},
        {"type": None},
        {},
    ],
)
def test_a_malformed_event_body_is_refused_before_anything_is_read(
    w: World, body: dict[str, Any]
) -> None:
    payload = body if "id" in body else {"id": EVENT, **body}
    r = w.call("POST", f"/orders/{ORDER}/events", payload, "a_admin")
    assert r.status_code == 422 and code(r) == "validation_error", body
    assert w.o.calls == [] and w.o.tokens == []


def test_a_malformed_ids_and_an_unknown_order_look_the_same(w: World) -> None:
    for path in (
        "/orders/not-a-uuid",
        f"/orders/{uuid.uuid4()}",
        f"/orders/{uuid.UUID(int=0xBAD)}",
    ):
        assert w.call("GET", path, None, "a_sales").status_code == 404
    assert (
        w.call("POST", f"/orders/{uuid.uuid4()}/events", EVENT_BODY, "a_sales").status_code == 404
    )
    assert w.call("POST", "/orders/not-a-uuid/events", EVENT_BODY, "a_sales").status_code == 404
    assert w.sent("record_event") == []
    assert all(isinstance(asked, uuid.UUID) for asked in w.o.asked) and len(w.o.asked) == 3, (
        "a malformed id is a 404 before the data layer is asked anything"
    )


# ----------------------------------------------------------------------------- what is sent to the database
def parsed_request(args: dict[str, Any]) -> dict[str, Any]:
    return dict(json.loads(args["p_request_text"]))


def test_an_event_is_built_from_the_recorded_state_run_through_the_real_lifecycle_and_sent_with_the_callers_token(
    w: World,
) -> None:
    headers = auth("a_sales")
    token = headers["Authorization"].removeprefix("Bearer ")
    before = datetime.now(UTC)
    r = w.client.post(w.url(f"/orders/{ORDER}/events"), json=EVENT_BODY, headers=headers)
    assert r.status_code == 200, r.text
    (args,) = w.sent("record_event")
    assert set(args) == {
        "p_event_id",
        "p_order_id",
        "p_type",
        "p_occurred_at",
        "p_amount_paise",
        "p_ledger_id",
        "p_reason_code",
        "p_engine_version",
        "p_request_text",
        "p_result_text",
    }
    assert (args["p_event_id"], args["p_order_id"], args["p_type"]) == (
        EVENT,
        str(ORDER),
        "send_quote",
    )
    assert args["p_engine_version"] == lifecycle_port.lifecycle_version() == "1.0.0"
    request = parsed_request(args)
    as_of = datetime.fromisoformat(request["as_of"].replace("Z", "+00:00"))
    assert 0 <= (as_of - before.replace(microsecond=0)).total_seconds() < 5, (
        "as of the API's own clock"
    )
    expected = build_request(
        state_of("accepted"), OrderEvent("send_quote"), as_of=as_of, role="sales"
    )
    assert request == expected and args["p_request_text"] == lifecycle_port.canonical_json(expected)
    result = json.loads(args["p_result_text"])
    assert result == lifecycle_port.run_transition(
        expected
    )  # the lifecycle's own answer, nothing added
    assert result["canonical_hash"] == lifecycle_port.expected_hash(expected)
    assert set(w.o.tokens) == {token}, "every data-layer call carried the caller's own token"


@pytest.mark.parametrize(
    ("user", "override"), [("a_owner", True), ("a_admin", False), ("a_sales", False)]
)
def test_owner_override_is_derived_from_the_role_and_only_for_a_dispatch(
    w: World, user: str, override: bool
) -> None:
    w.o.snapshots[ORDER] = state_of("in_preparation", payments=((P1, 1000),))
    assert w.event({"type": "dispatch"}, user).status_code == 200
    assert parsed_request(w.sent("record_event")[-1])["flags"] == {"owner_override": override}
    assert (
        w.event(
            {"type": "record_payment", "amount_paise": 100, "ledger_id": P1.replace("1", "3")},
            "a_owner",
        ).status_code
        == 200
    )
    assert parsed_request(w.sent("record_event")[-1])["flags"] == {"owner_override": False}, (
        "an Owner's payment is no override"
    )


def test_a_money_event_carries_the_amount_the_ledger_id_the_time_and_a_decline_its_reason(
    w: World,
) -> None:
    r = w.event(
        {
            "type": "record_payment",
            "amount_paise": 40000,
            "ledger_id": P1.upper(),
            "occurred_at": "2026-10-06T10:00:00+05:30",
        },
        "a_admin",
    )
    assert r.status_code == 200
    (args,) = w.sent("record_event")
    assert args["p_amount_paise"] == 40000 and args["p_ledger_id"] == P1, (
        "the ledger id is the canonical lower-case text"
    )
    assert args["p_occurred_at"].startswith("2026-10-06T10:00:00")
    assert parsed_request(args)["event"] == {
        "type": "record_payment",
        "amount": 40000,
        "payment_id": P1,
    }
    w.o.snapshots[ORDER] = state_of("quote_sent")
    w.event({"type": "customer_decline", "reason_code": "price"})
    assert w.sent("record_event")[-1]["p_reason_code"] == "price"


def test_the_response_reports_the_lifecycles_guidance_for_a_new_event_and_nothing_for_a_replay(
    w: World,
) -> None:
    w.o.snapshots[ORDER] = state_of("accepted")
    w.o.next_result = {
        "event_id": EVENT,
        "order_id": str(ORDER),
        "seq": 2,
        "state": "advance_requested",
        "prior_state": "accepted",
        "replayed": False,
    }
    r = w.event({"type": "request_advance"})
    body = r.json()
    assert (
        r.status_code == 200
        and body["state"] == "advance_requested"
        and body["outcome"] == "won"
        and body["replayed"] is False
    )
    assert (
        "record_payment" in body["allowed_next_events"]
        and body["paid_total"] == 0
        and body["balance_due"] == 100000
    )
    w.o.next_result = {
        "event_id": EVENT,
        "order_id": str(ORDER),
        "seq": 2,
        "state": "advance_requested",
        "prior_state": "accepted",
        "replayed": True,
    }
    body = w.event({"type": "request_advance"}).json()
    assert (
        body["replayed"] is True
        and body["allowed_next_events"] == []
        and body["flags"] == []
        and body["paid_total"] is None
    )


def test_a_flagged_event_reports_its_flag_codes(w: World) -> None:
    w.o.snapshots[ORDER] = state_of("in_preparation", payments=((P1, 40000),))
    w.o.next_result = {
        "event_id": EVENT,
        "order_id": str(ORDER),
        "seq": 9,
        "state": "cancelled",
        "prior_state": "in_preparation",
        "replayed": False,
    }
    body = w.event({"type": "cancel"}, "a_owner").json()
    assert body["flags"] == ["CANCELLATION_WITH_FUNDS"] and body["outcome"] == "cancelled"


# ----------------------------------------------------------------------------- the lifecycle cannot be used: nothing is sent
def test_a_lifecycle_that_cannot_load_answers_503_and_nothing_is_sent(
    w: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(src: Any = None) -> Any:
        raise lifecycle_port.LifecycleUnavailable

    monkeypatch.setattr(lifecycle_port, "_lifecycle", None)
    monkeypatch.setattr(lifecycle_port, "_import", refuse)
    r = w.event(EVENT_BODY)
    assert r.status_code == 503 and code(r) == "order_lifecycle_unavailable"
    assert w.sent("record_event") == []


def test_an_inconsistent_lifecycle_answer_is_a_502_and_nothing_is_sent(
    w: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(request: dict[str, Any]) -> dict[str, Any]:
        raise lifecycle_port.LifecycleError

    monkeypatch.setattr(lifecycle_port, "run_transition", broken)
    r = w.event(EVENT_BODY)
    assert (
        r.status_code == 502
        and code(r) == "order_lifecycle_failed"
        and w.sent("record_event") == []
    )


# ----------------------------------------------------------------------------- fixed error mapping
ERRORS: list[tuple[Any, int, str]] = [
    (OrderQuoteNotApprovedError("SM230"), 409, "quote_not_approved"),
    (OrderExistsError("SM231"), 409, "order_exists"),
    (OrderFiguresError("SM233"), 409, "order_figures_invalid"),
    (OwnerRequiredError("SM234"), 403, "owner_required"),
    (OrderClosedError("SM235"), 409, "order_closed"),
    (QuoteExpiredError("SM236"), 409, "quote_expired"),
    (QuoteHasOrderError("SM237"), 409, "quote_has_order"),
    (OrderMismatchError("SM238"), 409, "order_changed"),
    (NoOrderPolicyError("SM239"), 409, "no_order_policy"),
    (MfaRequired("SM306"), 403, "mfa_required"),
    (Forbidden("42501"), 403, "forbidden"),
    (UpstreamError("boom " + CANARY), 502, "upstream_error"),
]


@pytest.mark.parametrize(("error", "status", "name"), ERRORS)
@pytest.mark.parametrize("which", ["create", "event"])
def test_every_refusal_has_a_fixed_message_and_no_data_layer_text(
    w: World, error: Exception, status: int, name: str, which: str
) -> None:
    w.o.raise_next = error
    r = (
        w.call("POST", "/orders", CREATE_BODY, "a_owner")
        if which == "create"
        else w.event(EVENT_BODY)
    )
    assert r.status_code == status and code(r) == name
    assert CANARY not in r.text and set(r.json()["error"]) == {"code", "message"}


@pytest.mark.parametrize("reason", REASONS)
def test_sm232_is_reported_with_one_closed_reason_and_a_fixed_sentence(
    w: World, reason: str
) -> None:
    w.o.raise_next = OrderRefusedError("SM232", reason)
    r = w.event(EVENT_BODY)
    error = r.json()["error"]
    assert (
        r.status_code == 409
        and error["code"] == "order_event_refused"
        and error["reason"] == reason
        and set(error) == {"code", "message", "reason"}
    )
    assert error["message"] != reason and error["message"].endswith(".") and CANARY not in r.text
    assert error["message"] == ORDER_REASON_TEXT[reason]


def test_the_sentences_are_the_ones_a_person_reads() -> None:
    assert ORDER_REASON_TEXT["ADVANCE_NOT_PAID"] == "The advance has not been paid."
    assert ORDER_REASON_TEXT["OTHER"] == "The order rules refuse this event."
    assert len(set(ORDER_REASON_TEXT.values())) == len(ORDER_REASON_TEXT) == 16, (
        "one sentence per reason"
    )


def test_an_admins_funded_cancellation_is_the_owners_to_decide(w: World) -> None:
    w.o.snapshots[ORDER] = state_of("in_preparation", payments=((P1, 40000),))
    w.o.raise_next = OwnerRequiredError("SM234")
    r = w.event({"type": "cancel"}, "a_admin")
    assert r.status_code == 403 and code(r) == "owner_required"
    assert parsed_request(w.sent("record_event")[-1])["flags"] == {"owner_override": False}


# ----------------------------------------------------------------------------- creating and reading
def test_creating_an_order_passes_only_the_two_ids_and_reads_the_result_back(w: World) -> None:
    new = uuid.uuid4()
    r = w.call("POST", "/orders", {"id": str(new), "quote_id": str(QUOTE)}, "a_owner")
    assert r.status_code == 201, r.text
    assert w.sent("create_order") == [{"p_order_id": str(new), "p_quote_id": str(QUOTE)}]
    assert (
        r.json()["id"] == str(new)
        and r.json()["state"] == "quote_approved"
        and r.json()["outcome"] == "open"
    )
    again = w.call("POST", "/orders", {"id": str(new), "quote_id": str(QUOTE)}, "a_admin")
    assert again.status_code == 200, "an exact retry replays"


def test_an_order_is_shown_with_its_ledger_in_our_words_and_without_the_stored_texts(
    w: World,
) -> None:
    w.o.rows[ORDER] = order_row(
        TENANT_A.id,
        state="declined",
        closed_at="2026-10-06T08:00:00+00:00",
        lost_reason="price",
        paid_paise=0,
        balance_paise=100000,
    )
    r = w.call("GET", f"/orders/{ORDER}", None, "a_sales")
    body = r.json()
    assert (
        r.status_code == 200
        and body["outcome"] == "lost"
        and body["lost_reason"] == "price"
        and body["lead_id"] == str(LEAD)
    )
    assert body["events"][0]["type"] == "created" and body["events"][0]["seq"] == 1
    assert (
        "request_text" not in r.text
        and "result_text" not in r.text
        and "hmac" not in r.text.lower()
    )
    assert all(
        k in body
        for k in (
            "order_total_paise",
            "advance_paise",
            "paid_paise",
            "refunded_paise",
            "net_paise",
            "balance_paise",
        )
    )


@pytest.mark.parametrize(
    ("state", "outcome"),
    [
        ("quote_approved", "open"),
        ("quote_sent", "open"),
        ("accepted", "won"),
        ("in_preparation", "won"),
        ("closed_paid", "won"),
        ("declined", "lost"),
        ("cancelled", "cancelled"),
        ("expired", "expired"),
    ],
)
def test_the_outcome_words(w: World, state: str, outcome: str) -> None:
    w.o.rows[ORDER] = order_row(TENANT_A.id, state=state)
    assert w.call("GET", f"/orders/{ORDER}", None, "a_sales").json()["outcome"] == outcome


def test_the_list_is_keyset_paged_and_a_bad_cursor_is_refused(w: World) -> None:
    for n in range(2, 5):
        oid = uuid.UUID(int=0x0D00 + n)
        w.o.rows[oid] = order_row(
            TENANT_A.id, oid, order_no=n, created_at=f"2026-10-06T0{n}:00:00+00:00"
        )
    page = w.call("GET", "/orders?limit=2", None, "a_sales").json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    assert w.sent("list_orders")[-1]["limit"] == 2
    w.call("GET", f"/orders?limit=2&cursor={page['next_cursor']}", None, "a_sales")
    assert w.sent("list_orders")[-1]["cursor"] is not None
    assert w.call("GET", "/orders?cursor=%25%25%25", None, "a_sales").status_code == 422
    assert w.call("GET", "/orders?limit=0", None, "a_sales").status_code == 422
    assert w.call("GET", "/orders?limit=51", None, "a_sales").status_code == 422
    last = w.call("GET", "/orders?limit=50", None, "a_sales").json()
    assert last["next_cursor"] is None


def test_an_order_of_another_workspace_is_not_found(w: World) -> None:
    w.o.rows[uuid.UUID(int=0xB0B)] = order_row(TENANT_B.id, uuid.UUID(int=0xB0B))
    assert (
        w.call("GET", f"/orders/{uuid.UUID(int=0xB0B)}", None, "a_sales").status_code == 200
    )  # (the fake is keyed by tenant: this is tenant A's call on a row id it holds)
    other = FakeOrders(TENANT_B.id)
    assert other.get_order("t", TENANT_A.id, ORDER) is None


def test_the_policy_is_published_with_the_tenant_of_the_path_and_only_the_four_flags(
    w: World,
) -> None:
    r = w.call("POST", "/order-policy-versions", POLICY_BODY, "a_owner")
    assert r.status_code == 201 and r.json()["version_no"] == 1 and r.json()["replayed"] is False
    again = w.call("POST", "/order-policy-versions", POLICY_BODY, "a_owner")
    assert again.status_code == 200 and again.json()["replayed"] is True, "a retry is a 200"
    w.o.calls.pop()  # (only the first send is checked below)
    (args,) = w.sent("create_policy")
    assert args["p_tenant_id"] == str(TENANT_A.id) and args["p_effective_from"] == "2026-10-07"
    assert args["p_policy"] == {
        "advance_required": True,
        "dispatch_requires_advance": True,
        "cancel_allowed_until_state": "in_preparation",
        "allow_zero_value_orders": False,
    }
    for bad in (
        {"advance_required": "yes"},
        {"cancel_allowed_until_state": "dispatched"},
        {"effective_from": "tomorrow"},
        {"extra": 1},
    ):
        assert (
            w.call("POST", "/order-policy-versions", {**POLICY_BODY, **bad}, "a_owner").status_code
            == 422
        ), bad


# ----------------------------------------------------------------------------- guidance on the order page
EARLY = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)  # well before the fake quote's valid_until
LATE = datetime(2030, 1, 1, tzinfo=UTC)  # after it


@pytest.mark.parametrize(
    ("state", "payments", "role", "now", "expected"),
    [
        # hand-read from docs/plans/order-lifecycle.md: the structural matrix, then the guards
        ("quote_approved", (), Role.OWNER, EARLY, ["send_quote", "cancel"]),
        ("quote_approved", (), Role.OWNER, LATE, ["expire", "cancel"]),
        ("quote_sent", (), Role.SALES, EARLY, ["customer_accept", "customer_decline", "cancel"]),
        ("accepted", (), Role.SALES, EARLY, ["request_advance", "record_payment", "cancel"]),
        (
            "accepted",
            (("11111111-1111-4111-8111-111111111111", 40000),),
            Role.ADMIN,
            EARLY,
            ["request_advance", "record_payment", "start_preparation", "cancel", "record_refund"],
        ),
        ("in_preparation", (), Role.SALES, EARLY, ["record_payment", "cancel"]),
        ("in_preparation", (), Role.OWNER, EARLY, ["record_payment", "dispatch", "cancel"]),
        (
            "in_preparation",
            (("11111111-1111-4111-8111-111111111111", 40000),),
            Role.SALES,
            EARLY,
            ["record_payment", "dispatch", "cancel", "record_refund"],
        ),
        ("dispatched", (), Role.SALES, EARLY, ["record_payment", "deliver"]),
        (
            "delivered",
            (("11111111-1111-4111-8111-111111111111", 60000),),
            Role.OWNER,
            EARLY,
            ["record_payment", "record_refund"],
        ),
        ("closed_paid", (), Role.OWNER, EARLY, []),
        ("declined", (), Role.OWNER, EARLY, []),
        ("cancelled", (), Role.OWNER, EARLY, []),
        ("expired", (), Role.OWNER, EARLY, []),
    ],
)
def test_guidance_is_what_the_lifecycle_would_accept_now_for_this_role(
    state: str,
    payments: tuple[tuple[str, int], ...],
    role: Role,
    now: datetime,
    expected: list[str],
) -> None:
    from app.orders.service import guidance

    assert guidance(state_of(state, payments=payments), role, now) == expected


def test_the_order_page_carries_guidance_for_the_callers_role(w: World) -> None:
    w.o.snapshots[ORDER] = state_of("in_preparation")
    owner = w.call("GET", f"/orders/{ORDER}", None, "a_owner").json()
    sales = w.call("GET", f"/orders/{ORDER}", None, "a_sales").json()
    assert "dispatch" in owner["allowed_next_events"], "the Owner may dispatch with the override"
    assert (
        "dispatch" not in sales["allowed_next_events"] and "cancel" in sales["allowed_next_events"]
    )
    w.o.snapshots[ORDER] = state_of("closed_paid")
    assert w.call("GET", f"/orders/{ORDER}", None, "a_owner").json()["allowed_next_events"] == []


def test_a_lifecycle_that_cannot_run_gives_no_guidance_at_all_not_a_partial_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.orders import service as order_service
    from app.orders.lifecycle_port import LifecycleError

    calls = {"n": 0}

    def failing(request: dict[str, Any]) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 3:
            raise LifecycleError
        return lifecycle_port.run_transition(request)

    monkeypatch.setattr(lifecycle_port, "run_transition", failing)
    assert order_service.guidance(state_of("quote_approved"), Role.OWNER, EARLY) == []


def test_the_default_clock_is_the_real_one(w: World) -> None:
    """A quote that expired on 3 October is expired now whatever the day: the guidance without an explicit clock reads the real time."""
    import dataclasses

    w.o.snapshots[ORDER] = dataclasses.replace(
        state_of("quote_approved"), valid_until=date(2026, 10, 3)
    )
    assert w.call("GET", f"/orders/{ORDER}", None, "a_owner").json()["allowed_next_events"] == [
        "expire",
        "cancel",
    ]


# ----------------------------------------------------------------------------- the quote filter (step F1)
def test_the_list_can_be_filtered_by_quote_even_past_the_first_fifty_orders(w: World) -> None:
    wanted = uuid.UUID(int=0x51)
    for n in range(
        2, 80
    ):  # 78 orders of other quotes, then the one we look for LAST (past any first page of 50)
        oid = uuid.UUID(int=0x0E00 + n)
        w.o.rows[oid] = order_row(
            TENANT_A.id, oid, order_no=n, quote_id=str(uuid.UUID(int=0x1000 + n))
        )
    target = uuid.UUID(int=0x0EFF)
    w.o.rows[target] = order_row(TENANT_A.id, target, order_no=99, quote_id=str(wanted))
    page = w.call("GET", f"/orders?quote_id={wanted}&limit=1", None, "a_sales").json()
    assert [i["id"] for i in page["items"]] == [str(target)] and page["next_cursor"] is None
    assert w.sent("list_orders")[-1]["quote_id"] == wanted
    unfiltered = w.call("GET", "/orders?limit=50", None, "a_sales").json()
    assert str(target) not in [i["id"] for i in unfiltered["items"]], (
        "without the filter it is not on the first page"
    )
    assert w.sent("list_orders")[-1]["quote_id"] is None


def test_a_quote_of_another_workspace_or_an_unknown_one_returns_nothing(w: World) -> None:
    theirs = uuid.UUID(int=0xB0B)
    other = FakeOrders(TENANT_B.id)
    other.rows[uuid.UUID(int=0xB0C)] = order_row(
        TENANT_B.id, uuid.UUID(int=0xB0C), quote_id=str(theirs)
    )
    assert other.list_orders("t", TENANT_A.id, limit=5, cursor=None, quote_id=theirs) == []
    assert w.call("GET", f"/orders?quote_id={theirs}", None, "a_sales").json() == {
        "items": [],
        "next_cursor": None,
    }
    assert w.call("GET", f"/orders?quote_id={uuid.uuid4()}", None, "a_owner").json()["items"] == []


@pytest.mark.parametrize(
    "bad", ["not-a-uuid", "1", "' or 1=1 --", "", "00000000-0000-0000-0000-00000000000g"]
)
def test_a_malformed_quote_id_is_a_422_and_the_data_layer_is_not_asked(w: World, bad: str) -> None:
    r = w.call("GET", f"/orders?quote_id={bad}", None, "a_sales")
    assert r.status_code == 422 and code(r) == "validation_error"
    assert w.o.calls == []


def test_the_quote_filter_keeps_every_role_rule(w: World) -> None:
    path = f"/orders?quote_id={QUOTE}"
    assert w.call("GET", path, None, None).status_code == 401
    assert w.call("GET", path, None, "a_viewer").status_code == 403
    assert w.call("GET", path, None, "outsider").status_code == 404
    assert w.call("GET", path, None, "b_owner", TENANT_A.id).status_code == 404
    assert w.o.calls == []
