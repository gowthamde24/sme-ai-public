"""Manual-price quotes through the HTTP side, against in-memory fakes (manual-price quote, slice 3): who may, WHAT is sent to the database (the request built exactly as
`app.quote_build_manual` builds it, the engine's own canonical texts, exactly the three typed keys per line, the caller's own token), strict bodies, the fixed error mapping,
reading a quote that has no price list, no product and no delivery state, the approval's recomputation, and the customer text (the item type's name, never the LINE-n key, and the
GST note exactly once, last). The database rules are pgTAP 68; the real stack is tests/integration/test_manual_quote_api.py. All data is synthetic."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any

import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.quotes import engine_port
from app.quotes.builder import ManualLine, Policy, build_manual_request, today_ist
from app.quotes.errors import (
    EnquiryHasRequirementError,
    OwnerApprovalRequiredError,
    PriceNotTypedByPersonError,
    QuoteInputMissingError,
    QuoteMismatchError,
    QuoteStaleError,
)
from app.tenancy.repository import Forbidden, InvalidInput, MfaRequired, UpstreamError
from tests.fakes import TENANT_A, TENANT_B, auth
from tests.quotes_fakes import ENQ, POLICY_ROW
from tests.test_quotes_routes import World, call, code

CANARY = "CANARY-77c1d2"
QID = uuid.UUID(int=0x9101)
TYPES = [
    {"id": str(uuid.UUID(int=1)), "code": "01", "name": "Item type one", "position": 1, "active": True, "min_price_paise": None, "max_price_paise": None},
    {"id": str(uuid.UUID(int=2)), "code": "04", "name": "Item type four", "position": 2, "active": True, "min_price_paise": 50_000, "max_price_paise": 400_000},
]  # fmt: skip
LINES = [
    {"item_type_code": "01", "qty": 3, "unit_price_paise": 250_000},
    {"item_type_code": "04", "qty": 1, "unit_price_paise": 99_999},
]
BODY: dict[str, Any] = {"id": str(QID), "customer_kind": "new", "lines": LINES}
PATH = f"/enquiries/{ENQ}/manual-quotes"


@pytest.fixture
def w() -> World:
    world = World()
    world.q.item_type_rows = [dict(t) for t in TYPES]
    return world


def post(w: World, body: Any = BODY, user: str = "a_owner", **claims: Any) -> Any:
    return call(w, "POST", PATH, body, user, **claims)


def sent(w: World, name: str) -> list[Any]:
    return [args for n, args in w.q.calls if n == name]


# ----------------------------------------------------------------------------- authorization (gate first)
def test_nobody_without_a_token_no_sales_no_viewer_and_no_outsider_gets_anything(w: World) -> None:
    assert call(w, "POST", PATH, BODY, None).status_code == 401
    for user in ("a_sales", "a_viewer"):
        r = post(w, user=user)
        assert r.status_code == 403 and code(r) == "forbidden", user
    assert call(w, "POST", PATH, BODY, "outsider").status_code == 404
    assert call(w, "POST", PATH, BODY, "b_owner", TENANT_A.id).status_code == 404
    assert (
        call(w, "POST", f"/enquiries/{ENQ}/manual-quotes", BODY, "b_owner", TENANT_B.id).status_code
        == 404
    )
    assert w.q.tokens == [] and w.q.calls == [], "a refused caller never reaches the data layer"


@pytest.mark.parametrize("user", ["a_owner", "a_admin"])
@pytest.mark.parametrize("claims", [{}, {"aal": "aal1"}])
def test_an_owner_and_an_admin_make_a_draft_with_or_without_a_second_factor(
    w: World, user: str, claims: dict[str, Any]
) -> None:
    r = post(w, user=user, **claims)
    assert r.status_code == 201, r.text


def test_an_enquiry_of_another_workspace_or_an_unknown_one_is_not_found(w: World) -> None:
    r = call(w, "POST", f"/enquiries/{uuid.uuid4()}/manual-quotes", BODY, "a_owner")
    assert r.status_code == 404 and code(r) == "not_found"
    assert (
        call(w, "POST", "/enquiries/not-a-uuid/manual-quotes", BODY, "a_owner").status_code == 404
    )
    assert sent(w, "create_manual_draft") == []


def test_the_route_is_unavailable_without_the_repositories() -> None:
    from tests.fakes import make_client

    client, _ = make_client()
    r = client.post(f"/v1/tenants/{TENANT_A.id}{PATH}", json=BODY, headers=auth("a_owner"))
    assert r.status_code == 503


# ----------------------------------------------------------------------------- what is sent: the request is the database's own
def expected_request(kind: str = "new", rate: int = 500) -> dict[str, Any]:
    """Written by hand from the plan: one synthetic sku per line, the item type's name, the typed price, GST on every line, no courier, half-up."""
    return {
        "as_of": today_ist().isoformat(),
        "price_list": [
            {"sku": "LINE-1", "name": "Item type one", "unit_price": 250_000, "minimum_order_quantity": 1, "price_breaks": [], "tax_bps": rate},
            {"sku": "LINE-2", "name": "Item type four", "unit_price": 99_999, "minimum_order_quantity": 1, "price_breaks": [], "tax_bps": rate},
        ],
        "customer": {"kind": "new"} if kind == "new" else {"kind": "repeat", "credit_limit": POLICY_ROW["repeat_credit_limit_paise"]},
        "order_lines": [{"sku": "LINE-1", "qty": 3}, {"sku": "LINE-2", "qty": 1}],
        "policy": {
            "discount_ceiling_bps": POLICY_ROW["discount_ceiling_bps"],
            "shipping": {"flat_fee": 0, "tax_bps": rate},
            "validity_days": POLICY_ROW["validity_days"],
            "payment_terms": {
                "new_advance_bps": POLICY_ROW["new_advance_bps"],
                "repeat_advance_bps": POLICY_ROW["repeat_advance_bps"],
                "net_days": POLICY_ROW["new_net_days"] if kind == "new" else POLICY_ROW["repeat_net_days"],
            },
            "tax_mode": "exclusive",
            "rounding_mode": "half_up",
        },
    }  # fmt: skip


def test_the_database_gets_the_callers_token_the_enquiry_the_typed_lines_and_the_engines_own_texts(
    w: World,
) -> None:
    assert post(w).status_code == 201
    (args,) = sent(w, "create_manual_draft")
    request = json.loads(args["p_request_text"])
    assert request == expected_request(), "the request is exactly the one the database builds"
    assert args["p_request_text"] == engine_port.canonical_json(request)
    result = engine_port.run_quote(request)
    assert args["p_result_text"] == engine_port.canonical_json(result), (
        "the result is the PINNED engine's, unchanged"
    )
    assert args["p_quote_id"] == str(QID) and args["p_enquiry_id"] == str(ENQ)
    assert args["p_customer_kind"] == "new" and args["p_delivery_state"] is None
    assert args["p_engine_version"] == engine_port.engine_version()
    assert args["p_lines"] == LINES and all(
        set(line) == {"item_type_code", "qty", "unit_price_paise"} for line in args["p_lines"]
    )
    assert set(args) == {
        "p_quote_id",
        "p_enquiry_id",
        "p_customer_kind",
        "p_delivery_state",
        "p_engine_version",
        "p_request_text",
        "p_result_text",
        "p_lines",
    }


def test_gst_is_charged_per_line_half_up_and_there_is_no_courier(w: World) -> None:
    post(w)
    (args,) = sent(w, "create_manual_draft")
    totals = json.loads(args["p_result_text"])["totals"]
    # 3 x 2,500.00 = 750000 -> GST 37500; 1 x 999.99 -> 4999.95 rounds UP to 5000 (the engine and the database agree)
    assert (
        totals["net"],
        totals["item_tax"],
        totals["shipping"],
        totals["shipping_tax"],
        totals["total"],
    ) == (849_999, 42_500, 0, 0, 892_499)


def test_a_repeat_customer_and_a_delivery_state_are_passed_as_chosen(w: World) -> None:
    assert post(w, {**BODY, "customer_kind": "repeat", "delivery_state": "KA"}).status_code == 201
    (args,) = sent(w, "create_manual_draft")
    assert json.loads(args["p_request_text"]) == expected_request("repeat")
    assert args["p_delivery_state"] == "KA" and args["p_customer_kind"] == "repeat"


def test_the_policys_freight_rounding_mode_and_shipping_tax_never_reach_a_manual_request(
    w: World,
) -> None:
    w.q.policy_row = {
        **POLICY_ROW,
        "shipping_flat_fee_paise": 7_500,
        "shipping_tax_bps": 1800,
        "rounding_mode": "half_even",
        "gst_rate_bps": 1200,
    }
    assert post(w).status_code == 201
    (args,) = sent(w, "create_manual_draft")
    request = json.loads(args["p_request_text"])
    assert request == expected_request(rate=1200)
    assert request["policy"]["shipping"] == {"flat_fee": 0, "tax_bps": 1200}
    assert request["policy"]["rounding_mode"] == "half_up"


def test_the_builder_has_the_database_rule_for_a_rate_not_yet_in_force() -> None:
    row = {**POLICY_ROW, "gst_effective_from": "2099-01-01"}
    from app.quotes.builder import MissingInput
    from app.quotes.service import to_policy

    with pytest.raises(MissingInput):
        build_manual_request(
            date(2026, 10, 8), "new", [ManualLine("01", "Item type one", 1, 1000)], to_policy(row)
        )
    on = build_manual_request(
        date(2099, 1, 1), "new", [ManualLine("01", "Item type one", 1, 1000)], to_policy(row)
    )
    assert on["price_list"][0]["tax_bps"] == 500
    empty = Policy(0, 0, None, 0, 15, 5000, 2500, 30, 30, "half_up", 0, "TG")
    with pytest.raises(MissingInput):
        build_manual_request(
            date(2026, 10, 8), "new", [ManualLine("01", "Item type one", 1, 1000)], empty
        )


def test_a_price_comes_only_from_the_body_not_from_the_query_or_a_header(w: World) -> None:
    r = call(w, "POST", PATH + "?unit_price_paise=1&price=1", BODY, "a_owner")
    assert r.status_code == 201
    (args,) = sent(w, "create_manual_draft")
    assert args["p_lines"] == LINES


# ----------------------------------------------------------------------------- the API decides nothing
def test_no_policy_in_force_or_no_rate_that_applies_today_is_a_fixed_422_and_nothing_is_stored(
    w: World,
) -> None:
    w.q.policy_row = None
    r = post(w)
    assert r.status_code == 422 and code(r) == "quote_input_missing"
    w.q.policy_row = {**POLICY_ROW, "gst_effective_from": "2099-01-01"}
    r = post(w)
    assert r.status_code == 422 and code(r) == "quote_input_missing"
    assert sent(w, "create_manual_draft") == []


def test_an_item_type_that_does_not_exist_is_the_same_invalid_reference_answer_as_the_databases(
    w: World,
) -> None:
    r = post(w, {**BODY, "lines": [{"item_type_code": "ZZ", "qty": 1, "unit_price_paise": 1000}]})
    assert r.status_code == 422 and code(r) == "invalid_reference"
    assert sent(w, "create_manual_draft") == []


def test_an_inactive_type_is_left_to_the_database_to_refuse(w: World) -> None:
    w.q.item_type_rows[0]["active"] = False
    w.q.errors.append(InvalidValueError("23514"))
    r = post(w)
    assert r.status_code == 422 and code(r) == "invalid_value"
    assert len(sent(w, "create_manual_draft")) == 1, (
        "the API builds the request; the database decides"
    )


def test_a_price_outside_the_range_is_not_judged_by_the_api(w: World) -> None:
    far = [
        {"item_type_code": "04", "qty": 1, "unit_price_paise": 9_000_000},
        {"item_type_code": "04", "qty": 1, "unit_price_paise": 1},
    ]
    assert post(w, {**BODY, "lines": far}).status_code == 201
    assert sent(w, "create_manual_draft")[0]["p_lines"] == far


# ----------------------------------------------------------------------------- strict bodies, checked before anything is read
@pytest.mark.parametrize(
    "extra",
    [
        "price",
        "total",
        "tax_bps",
        "gst_rate_bps",
        "price_source",
        "name",
        "tenant_id",
        "status",
        "needs_owner_approval",
        "discount_bps",
    ],
)
def test_a_field_that_is_not_the_callers_is_refused_at_the_top_level_and_on_a_line(
    w: World, extra: str
) -> None:
    assert post(w, {**BODY, extra: 1}).status_code == 422
    assert post(w, {**BODY, "lines": [{**LINES[0], extra: 1}]}).status_code == 422
    assert w.q.calls == [] and w.q.tokens == []


@pytest.mark.parametrize(
    ("line", "bad"),
    [
        ("qty", 0), ("qty", 10_001), ("qty", -1), ("qty", 1.5), ("qty", "3"), ("qty", True), ("qty", None),
        ("unit_price_paise", 0), ("unit_price_paise", 100_000_001), ("unit_price_paise", -5), ("unit_price_paise", 10.5), ("unit_price_paise", "1000"), ("unit_price_paise", True),
        ("item_type_code", ""), ("item_type_code", "a b"), ("item_type_code", "x" * 21), ("item_type_code", "-x"), ("item_type_code", 1), ("item_type_code", None),
    ],
)  # fmt: skip
def test_a_value_outside_the_database_bounds_or_of_the_wrong_kind_is_refused_first(
    w: World, line: str, bad: Any
) -> None:
    r = post(w, {**BODY, "lines": [{**LINES[0], line: bad}]})
    assert r.status_code == 422 and code(r) == "validation_error", (line, bad)
    assert w.q.calls == [] and w.q.tokens == []


@pytest.mark.parametrize("lines", [[], LINES * 3, [LINES[0]] * 6, "x", None, [None], [[]]])
def test_one_to_five_lines_and_nothing_else(w: World, lines: Any) -> None:
    r = post(w, {**BODY, "lines": lines})
    assert r.status_code == 422 and code(r) == "validation_error"
    assert w.q.calls == []


def test_five_lines_are_accepted_and_get_their_own_synthetic_keys(w: World) -> None:
    five = [{"item_type_code": "01", "qty": n, "unit_price_paise": 1000 * n} for n in range(1, 6)]
    assert post(w, {**BODY, "lines": five}).status_code == 201
    request = json.loads(sent(w, "create_manual_draft")[0]["p_request_text"])
    assert [i["sku"] for i in request["price_list"]] == [f"LINE-{n}" for n in range(1, 6)]
    assert [i["unit_price"] for i in request["price_list"]] == [1000 * n for n in range(1, 6)]


@pytest.mark.parametrize(
    "bad",
    [
        {"customer_kind": "vip"},
        {"customer_kind": None},
        {"id": "not-a-uuid"},
        {"id": None},
        {"delivery_state": "T"},
        {"delivery_state": "TXX"},
    ],
)
def test_the_choices_are_checked_first(w: World, bad: dict[str, Any]) -> None:
    r = post(w, {**BODY, **bad})
    assert r.status_code == 422 and code(r) == "validation_error"
    assert w.q.calls == []


def test_a_delivery_state_that_is_not_a_state_code_is_refused_with_the_lists_own_sentence(
    w: World,
) -> None:
    r = post(w, {**BODY, "delivery_state": "ZZ"})
    assert r.status_code == 422 and code(r) == "invalid_delivery_state"
    assert w.q.calls == []


def test_the_delivery_state_is_optional_and_null_is_the_same_as_left_out(w: World) -> None:
    assert post(w, {**BODY, "delivery_state": None}).status_code == 201
    assert sent(w, "create_manual_draft")[0]["p_delivery_state"] is None


# ----------------------------------------------------------------------------- every refusal is a fixed sentence
ERRORS: list[tuple[Exception, int, str]] = [
    (QuoteMismatchError("SM216"), 409, "quote_mismatch"),
    (QuoteInputMissingError("SM217"), 422, "quote_input_missing"),
    (PriceNotTypedByPersonError("SM260"), 403, "price_not_typed_by_person"),
    (EnquiryHasRequirementError("SM208"), 409, "enquiry_has_requirement"),
    (QuoteStaleError("SM215"), 409, "quote_stale"),
    (OwnerApprovalRequiredError("SM218"), 403, "owner_approval_required"),
    (Forbidden("42501"), 403, "forbidden"),
    (MfaRequired("SM306"), 403, "mfa_required"),
    (InvalidInput("22023"), 422, "validation_error"),
    (InvalidValueError("23514"), 422, "invalid_value"),
    (InvalidReferenceError("23503"), 422, "invalid_reference"),
    (ConflictError("23505"), 409, "conflict"),
    (UpstreamError("boom"), 502, "upstream_error"),
]


@pytest.mark.parametrize(("error", "status", "name"), ERRORS)
def test_every_refusal_has_one_status_one_stable_name_and_no_data_layer_text(
    w: World, error: Exception, status: int, name: str
) -> None:
    w.q.errors = [type(error)(f"{CANARY} secret row data")]
    r = post(w)
    assert r.status_code == status and code(r) == name, r.text
    assert (
        CANARY not in r.text
        and "secret" not in r.text
        and set(r.json()["error"]) == {"code", "message"}
    )
    assert w.q.rows == {}, "a refused draft stored nothing"


def test_a_retry_replays_and_the_same_id_with_other_lines_conflicts(w: World) -> None:
    first = post(w)
    again = post(w)
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"] and len(w.q.rows) == 1
    w.q.errors.append(ConflictError("23505"))
    other = post(w, {**BODY, "lines": [{**LINES[0], "unit_price_paise": 250_001}]})
    assert other.status_code == 409 and code(other) == "conflict"


# ----------------------------------------------------------------------------- reading a quote with no price list, no product and no delivery state
def test_a_manual_quote_reads_with_nulls_where_a_list_quote_has_values(w: World) -> None:
    created = post(w)
    got = call(w, "GET", f"/quotes/{QID}", None, "a_sales")
    assert got.status_code == 200
    body = got.json()
    assert created.json() == body
    assert body["pricing_kind"] == "manual"
    assert (
        body["price_list_version_id"] is None
        and body["delivery_state"] is None
        and body["gst_supply"] is None
    )
    assert [(x["sku"], x["name"], x["item_type_code"], x["price_source"], x["product_id"], x["tax_bps"]) for x in body["lines"]] == [
        ("LINE-1", "Item type one", "01", "typed_by_person", None, 500),
        ("LINE-2", "Item type four", "04", "typed_by_person", None, 500),
    ]  # fmt: skip
    assert (
        body["merchandise_net_paise"],
        body["item_tax_paise"],
        body["shipping_net_paise"],
        body["total_paise"],
    ) == (849_999, 42_500, 0, 892_499)
    assert body["unquoted_lines"] == [] or all("summary" in u for u in body["unquoted_lines"])


def test_a_manual_quote_with_a_delivery_state_shows_it(w: World) -> None:
    post(w, {**BODY, "delivery_state": "KA"})
    body = call(w, "GET", f"/quotes/{QID}", None, "a_owner").json()
    assert body["delivery_state"] == "KA" and body["gst_supply"] == "inter_state"


def test_the_list_marks_a_manual_quote_and_the_warning_flag_is_in_the_output(w: World) -> None:
    w.q.manual_review_flags = ["TYPED_PRICE_OUTSIDE_RANGE"]
    r = post(w)
    assert r.status_code == 201
    assert (
        r.json()["review_flags"] == ["TYPED_PRICE_OUTSIDE_RANGE"]
        and r.json()["needs_owner_approval"] is True
    )
    listed = call(w, "GET", "/quotes", None, "a_owner").json()
    assert [(x["id"], x["pricing_kind"], x["needs_owner_approval"]) for x in listed] == [
        (str(QID), "manual", True)
    ]
    per_enquiry = call(w, "GET", f"/enquiries/{ENQ}/quotes", None, "a_admin").json()
    assert per_enquiry[0]["pricing_kind"] == "manual"


def test_the_warning_flag_is_information_only_the_draft_is_saved_and_nothing_is_refused(
    w: World,
) -> None:
    w.q.manual_review_flags = ["TYPED_PRICE_OUTSIDE_RANGE"]
    far = [{"item_type_code": "04", "qty": 1, "unit_price_paise": 9_000_000}]
    r = post(w, {**BODY, "lines": far})
    assert r.status_code == 201 and r.json()["lines"][0]["unit_price_applied_paise"] == 9_000_000


# ----------------------------------------------------------------------------- approval, rejection, withdrawal
def test_the_approver_recomputes_from_the_stored_lines_and_the_database_gets_that_hash(
    w: World,
) -> None:
    post(w)
    stored_hash = json.loads(w.q.texts[QID]["result_text"])["canonical_hash"]
    r = call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner")
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text
    ((approved_id, digest),) = sent(w, "approve")
    assert approved_id == QID and digest == stored_hash, (
        "the hash is the engine's, run on the request rebuilt from the stored lines"
    )


def test_an_approval_of_a_manual_quote_does_not_read_the_requirement_or_the_picks(w: World) -> None:
    post(w)
    w.enq.requirement.clear()  # a manual quote hangs on a field-less requirement: nothing there is needed
    r = call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner")
    assert r.status_code == 200, r.text


def test_a_policy_that_changed_since_the_draft_is_stale_not_a_wrong_hash(w: World) -> None:
    post(w)
    w.q.policy_row = None
    r = call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner")
    assert r.status_code == 409 and code(r) == "quote_stale"
    assert sent(w, "approve") == []


def test_a_flagged_manual_quote_is_refused_to_an_admin_with_the_owner_message(w: World) -> None:
    w.q.manual_review_flags = ["TYPED_PRICE_OUTSIDE_RANGE"]
    post(w)
    w.q.errors.append(OwnerApprovalRequiredError("SM218"))
    r = call(w, "POST", f"/quotes/{QID}/approve", None, "a_admin")
    assert r.status_code == 403 and code(r) == "owner_approval_required"
    w.q.errors.clear()
    assert call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner").status_code == 200


def test_approving_needs_a_second_factor_as_for_every_quote(w: World) -> None:
    post(w)
    r = call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner", aal="aal1")
    assert r.status_code == 403 and code(r) == "mfa_required"


def test_a_manual_draft_can_be_rejected_and_an_approved_one_withdrawn(w: World) -> None:
    post(w)
    assert (
        call(w, "POST", f"/quotes/{QID}/reject", {"code": "wrong_prices"}, "a_owner").status_code
        == 200
    )
    other = uuid.UUID(int=0x9102)
    post(w, {**BODY, "id": str(other)})
    call(w, "POST", f"/quotes/{other}/approve", None, "a_owner")
    r = call(w, "POST", f"/quotes/{other}/withdraw", {"code": "price_changed"}, "a_owner")
    assert r.status_code == 200 and r.json()["status"] == "superseded"


# ----------------------------------------------------------------------------- the customer text
def approved_text(w: World, body: dict[str, Any] | None = None) -> str:
    assert post(w, body or BODY).status_code == 201
    assert call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner").status_code == 200
    r = call(w, "GET", f"/quotes/{QID}/text", None, "a_sales")
    assert r.status_code == 200, r.text
    text: str = r.json()["text"]
    return text


def test_the_text_of_a_manual_quote_uses_the_item_type_names_and_never_prints_the_line_key(
    w: World,
) -> None:
    text = approved_text(w)
    assert "Item type one" in text and "Item type four" in text
    assert "LINE-" not in text and "LINE" not in text.replace("Line total", "")


def test_the_text_says_gst_as_applicable_at_invoicing_exactly_once_and_last(w: World) -> None:
    text = approved_text(w)
    lines = text.split("\n")
    assert lines.count("- GST as applicable at invoicing") == 1
    assert text.count("GST as applicable at invoicing") == 1
    assert lines[-1] == "- GST as applicable at invoicing", (
        "the renderer prints the notes at the very end"
    )
    assert lines.index("Notes:") < lines.index("- GST as applicable at invoicing")
    assert lines.index("balance by the due date.") < lines.index("Notes:"), (
        "after the payment terms"
    )
    for standard in ("- Prices are in Indian rupees (INR).", "- This is a quote, not an invoice."):
        assert standard in lines


def test_the_text_shows_the_rate_the_quote_was_made_with_and_no_courier_block(w: World) -> None:
    text = approved_text(w)
    assert "GST (5%)" in text
    assert "Shipping" not in text, "a zero shipping line is not printed (quote_text 1.2.0)"


def test_a_list_price_quote_text_has_no_gst_note_and_is_unchanged(w: World) -> None:
    assert w.draft().status_code == 201
    w.client.post(w.url(f"/quotes/{uuid.UUID(int=0x9001)}/approve"), headers=auth("a_owner"))
    text = w.client.get(
        w.url(f"/quotes/{uuid.UUID(int=0x9001)}/text"), headers=auth("a_sales")
    ).json()["text"]
    assert "GST as applicable at invoicing" not in text
    assert text.split("\n")[-1] == "- This is a quote, not an invoice."


def test_a_draft_manual_quote_has_no_text(w: World) -> None:
    post(w)
    r = call(w, "GET", f"/quotes/{QID}/text", None, "a_sales")
    assert r.status_code == 409 and code(r) == "quote_not_approved"
