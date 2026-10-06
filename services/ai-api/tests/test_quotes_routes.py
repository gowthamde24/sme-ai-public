"""T009 step 3: the HTTP side of quotes against in-memory fakes: authorization order and the role matrix on every endpoint, WHAT is sent to the database (the engine's request and
result, the approver's recomputed hash, the caller's own token), the fixed error mapping of SM212 to SM218, delivery-state validation against the real list, and the customer text
(the expected hash comes from the stored row, never from the request). The database rules are pgTAP 57-59; the real stack is tests/integration/test_quote_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import uuid
from datetime import date, timedelta
from typing import Any

import pytest

from app.quotes import engine_port, service
from app.quotes.builder import Pick, build_request, requirement_facts, today_ist
from app.quotes.states import ALL_CODES
from tests.enquiries_fakes import FakeEnquiries, enquiry_row
from tests.fakes import TENANT_A, TENANT_B, FakeCrmRepository, auth, make_client
from tests.quotes_fakes import (
    ENQ,
    ITEM_ROWS,
    LEAD,
    P1,
    P2,
    P3,
    POLICY_ROW,
    PV,
    QID,
    RID,
    FakeQuotes,
    OwnerApprovalRequiredError,
    QuoteDependsError,
    QuoteInputMissingError,
    QuoteMismatchError,
    QuoteNotDraftError,
    QuoteStaleError,
    RequirementNotConfirmedError,
    field,
    quote_from,
    requirement,
    two_line_rows,
)

CANARY = "CANARY-5d41c0"


class World:
    def __init__(self) -> None:
        self.crm = FakeCrmRepository()
        self.crm.seed("leads", TENANT_A.id, LEAD)
        self.enq = FakeEnquiries()
        self.enq.enquiries[(TENANT_A.id, ENQ)] = enquiry_row(
            TENANT_A.id, ENQ, LEAD, "Need 20 kanjivaram and 5 banarasi"
        )
        self.enq.requirement[ENQ] = (requirement(), two_line_rows())
        self.q = FakeQuotes()
        self.q.pick_rows = [
            {
                "line_no": 1,
                "product_id": str(P1),
                "qty": 20,
                "sale_unit": "piece",
                "source": "manual",
            },
            {
                "line_no": 2,
                "product_id": str(P2),
                "qty": 5,
                "sale_unit": "piece",
                "source": "manual",
            },
        ]
        self.client, _ = make_client(crm=self.crm, enquiries=self.enq, quotes=self.q)

    def url(self, path: str, tenant: uuid.UUID = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}{path}"

    def draft(
        self, user: str = "a_sales", quote_id: uuid.UUID = QID, kind: str = "new", state: str = "MH"
    ) -> Any:
        return self.client.post(
            self.url(f"/enquiries/{ENQ}/quotes"),
            json={"id": str(quote_id), "customer_kind": kind, "delivery_state": state},
            headers=auth(user),
        )

    def stored(self) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        return self.q.rows[QID]


@pytest.fixture
def w() -> World:
    return World()


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


# ----------------------------------------------------------------------------- authorization
ALL_ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", f"/enquiries/{ENQ}/quote-setup", None),
    ("GET", f"/enquiries/{ENQ}/quotes", None),
    ("GET", "/quotes", None),
    ("GET", f"/quotes/{QID}", None),
    ("GET", f"/quotes/{QID}/text", None),
    (
        "POST",
        f"/enquiries/{ENQ}/picks",
        {"line": 1, "product_id": str(P1), "qty": 20, "sale_unit": "piece"},
    ),
    (
        "POST",
        f"/enquiries/{ENQ}/quotes",
        {"id": str(uuid.uuid4()), "customer_kind": "new", "delivery_state": "MH"},
    ),
    ("POST", f"/quotes/{QID}/approve", None),
    ("POST", f"/quotes/{QID}/reject", {"code": "other"}),
    ("POST", f"/quotes/{QID}/withdraw", {"code": "other"}),
]


def call(
    w: World,
    method: str,
    path: str,
    body: Any,
    user: str | None,
    tenant: uuid.UUID = TENANT_A.id,
    **claims: Any,
) -> Any:
    headers = auth(user, **claims) if user else {}
    return w.client.request(method, w.url(path, tenant), json=body, headers=headers)


@pytest.mark.parametrize(("method", "path", "body"), ALL_ENDPOINTS)
def test_nobody_without_a_token_and_no_viewer_gets_anything_and_nothing_is_read(
    w: World, method: str, path: str, body: Any
) -> None:
    assert call(w, method, path, body, None).status_code == 401
    viewer = call(w, method, path, body, "a_viewer")
    assert viewer.status_code == 403 and code(viewer) == "forbidden"
    outsider = call(w, method, path, body, "outsider")
    assert outsider.status_code == 404 and code(outsider) == "not_found"
    foreign = call(
        w, method, path, body, "b_owner", TENANT_A.id
    )  # a member of ANOTHER tenant on this tenant's path
    assert foreign.status_code == 404
    assert w.q.tokens == [] and w.q.calls == []  # a refused caller never reaches the data layer


@pytest.mark.parametrize(
    ("method", "path"), [("POST", f"/quotes/{QID}/approve"), ("POST", f"/quotes/{QID}/withdraw")]
)
def test_approval_and_withdrawal_are_the_owners_or_admins_and_need_a_second_factor(
    w: World, method: str, path: str
) -> None:
    body = {"code": "other"} if "withdraw" in path else None
    for user in ("a_sales", "a_viewer"):
        assert call(w, method, path, body, user).status_code == 403
    for user in ("a_owner", "a_admin"):
        for claim in ({"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}):
            r = call(w, method, path, body, user, **claim)
            assert r.status_code == 403 and code(r) == "mfa_required", (user, claim)
    assert w.q.tokens == [] and w.q.calls == []


def test_the_viewer_is_refused_before_anything_is_looked_up(w: World) -> None:
    r = w.draft("a_viewer")
    assert r.status_code == 403 and w.enq.tokens == [] and w.q.tokens == []


def test_quotes_are_unavailable_without_their_repository() -> None:
    client, _ = make_client(enquiries=FakeEnquiries(), quotes=None)
    r = client.get(f"/v1/tenants/{TENANT_A.id}/quotes", headers=auth("a_sales"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "quotes_unavailable"


def test_every_call_carries_the_callers_own_token(w: World) -> None:
    headers = auth("a_sales")
    token = headers["Authorization"].split()[1]
    r = w.client.post(
        w.url(f"/enquiries/{ENQ}/quotes"),
        json={"id": str(QID), "customer_kind": "new", "delivery_state": "MH"},
        headers=headers,
    )
    assert r.status_code == 201
    assert w.q.tokens and set(w.q.tokens) == {token} and set(w.enq.tokens) == {token}


# ----------------------------------------------------------------------------- creating a draft
def test_a_draft_sends_the_engines_request_and_result_and_nothing_the_client_chose(
    w: World,
) -> None:
    r = w.draft()
    assert r.status_code == 201, r.text
    ((name, args),) = [c for c in w.q.calls if c[0] == "create_draft"]
    request, result = json.loads(args["p_request_text"]), json.loads(args["p_result_text"])
    # the request is the builder's from the sources; the result is what the PINNED engine answers to exactly that request
    rows = two_line_rows()
    expected = build_request(
        today_ist(), "new", requirement_facts(w.enq.requirement[ENQ][1]),
        [Pick(1, str(P1), 20, "piece"), Pick(2, str(P2), 5, "piece")], service.to_items(ITEM_ROWS), service.to_policy(POLICY_ROW),
    )  # fmt: skip
    assert rows and request == expected and result == engine_port.run_quote(expected)
    assert args["p_request_text"] == engine_port.canonical_json(expected) and args[
        "p_result_text"
    ] == engine_port.canonical_json(result)
    assert (
        args["p_engine_version"] == engine_port.engine_version()
        and args["p_requirement_id"] == str(RID)
        and args["p_delivery_state"] == "MH"
        and args["p_customer_kind"] == "new"
    )
    assert set(args) == {
        "p_quote_id",
        "p_requirement_id",
        "p_customer_kind",
        "p_delivery_state",
        "p_engine_version",
        "p_request_text",
        "p_result_text",
    }
    body = r.json()
    assert (
        body["total_paise"] == result["totals"]["total"]
        and "request_text" not in body
        and "result_text" not in body
    )


def test_a_retry_replays_with_200(w: World) -> None:
    assert w.draft().status_code == 201
    again = w.draft()
    assert again.status_code == 200 and again.json()["id"] == str(QID)


def test_the_delivery_state_is_one_of_the_real_codes(w: World) -> None:
    assert (
        len(ALL_CODES) == 36
        and "TG" in ALL_CODES
        and "TS" not in ALL_CODES
        and "UK" not in ALL_CODES
        and "OR" not in ALL_CODES
    )
    for good in ("TG", "MH", "DL", "LA", "UT", "OD"):
        assert w.draft(state=good, quote_id=uuid.uuid4()).status_code == 201, good
    for bad in ("TS", "UK", "OR", "ZZ", "tg", "T", "TGG", "", "  ", "1A", "IN"):
        r = w.client.post(
            w.url(f"/enquiries/{ENQ}/quotes"),
            json={"id": str(uuid.uuid4()), "customer_kind": "new", "delivery_state": bad},
            headers=auth("a_sales"),
        )
        assert r.status_code == 422, bad
    assert [
        c for c in w.q.calls if c[0] == "create_draft"
    ].__len__() == 6  # nothing was sent for a bad state


def test_a_bad_body_is_422_and_never_reaches_the_data_layer(w: World) -> None:
    for body in (
        {"id": "x", "customer_kind": "new", "delivery_state": "MH"},
        {"id": str(uuid.uuid4()), "customer_kind": "vip", "delivery_state": "MH"},
        {"id": str(uuid.uuid4()), "customer_kind": "new", "delivery_state": "MH", "total_paise": 1},
        {
            "id": str(uuid.uuid4()),
            "customer_kind": "new",
            "delivery_state": "MH",
            "needs_owner_approval": False,
        },
        {"id": str(uuid.uuid4()), "customer_kind": "new"},
    ):
        assert (
            w.client.post(
                w.url(f"/enquiries/{ENQ}/quotes"), json=body, headers=auth("a_sales")
            ).status_code
            == 422
        )
    assert w.q.calls == []


def test_a_requirement_that_is_not_confirmed_is_refused(w: World) -> None:
    w.enq.requirement[ENQ] = (requirement("draft"), two_line_rows())
    r = w.draft()
    assert r.status_code == 409 and code(r) == "requirement_not_confirmed" and w.q.calls == []
    w.enq.requirement[ENQ] = (None, [])
    assert code(w.draft()) == "requirement_not_confirmed"


def test_missing_sources_are_refused_with_one_fixed_code(w: World) -> None:
    w.q.pick_rows = w.q.pick_rows[:1]  # line 2 has no pick
    r = w.draft()
    assert r.status_code == 422 and code(r) == "quote_input_missing" and w.q.calls == []
    w.q.pick_rows = []
    assert code(w.draft()) == "quote_input_missing"
    w.q.versions = []  # no price list in force
    assert code(w.draft()) == "quote_input_missing"
    w.q.versions = [{"id": str(PV), "version_no": 1, "effective_from": "2026-10-01"}]
    w.q.policy_row = None
    assert code(w.draft()) == "quote_input_missing"


def test_a_field_nobody_confirmed_is_not_quoted(w: World) -> None:
    # a third line that an agent proposed and nobody reviewed: it is not in the quote, and the draft is not refused for it
    w.enq.requirement[ENQ] = (
        requirement(),
        [
            *two_line_rows(),
            field(3, "saree_type", "proposed", value_code="patola"),
            field(3, "quantity", "proposed", value_int=50, basis="piece"),
        ],
    )
    r = w.draft()
    assert r.status_code == 201 and [x["requirement_line_no"] for x in r.json()["lines"]] == [1, 2]
    shown = r.json()["unquoted_lines"]
    assert (
        [x["line_no"] for x in shown] == [3]
        and all("(not confirmed)" in part for part in shown[0]["summary"])
        and shown[0]["reason"] == "not_confirmed"
    )
    # a half-confirmed line is refused like the database refuses it, not silently dropped
    w.enq.requirement[ENQ] = (
        requirement(),
        [*two_line_rows(), field(3, "saree_type", "confirmed", value_code="patola")],
    )
    assert code(w.draft(quote_id=uuid.uuid4())) == "quote_input_missing"


def test_the_engine_refusing_or_failing_stores_nothing(
    w: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        engine_port, "run_quote", lambda request: {"status": "rejected", "codes": ["X"]}
    )
    r = w.draft()
    assert r.status_code == 422 and code(r) == "quote_not_computable" and w.q.calls == []

    def unavailable(request: Any) -> Any:
        raise engine_port.QuoteEngineUnavailable

    monkeypatch.setattr(engine_port, "run_quote", unavailable)
    r = w.draft()
    assert r.status_code == 503 and code(r) == "quote_computation_unavailable" and w.q.calls == []

    def broken(request: Any) -> Any:
        raise engine_port.QuoteEngineError

    monkeypatch.setattr(engine_port, "run_quote", broken)
    r = w.draft()
    assert r.status_code == 502 and code(r) == "quote_computation_failed" and w.q.calls == []
    assert "Traceback" not in r.text


# ----------------------------------------------------------------------------- the database's refusals, as fixed answers
@pytest.mark.parametrize(
    ("error", "status", "name"),
    [
        (QuoteDependsError("SM212"), 409, "quote_depends"),
        (RequirementNotConfirmedError("SM213"), 409, "requirement_not_confirmed"),
        (QuoteNotDraftError("SM214"), 409, "quote_not_draft"),
        (QuoteStaleError("SM215"), 409, "quote_stale"),
        (QuoteMismatchError("SM216"), 409, "quote_mismatch"),
        (QuoteInputMissingError("SM217"), 422, "quote_input_missing"),
        (OwnerApprovalRequiredError("SM218"), 403, "owner_approval_required"),
    ],
)
def test_each_refusal_has_one_status_one_stable_name_and_no_data_layer_text(
    w: World, error: Exception, status: int, name: str
) -> None:
    assert w.draft().status_code == 201
    for method, path, body, user in (
        (
            "POST",
            f"/enquiries/{ENQ}/quotes",
            {"id": str(uuid.uuid4()), "customer_kind": "new", "delivery_state": "MH"},
            "a_sales",
        ),
        (
            "POST",
            f"/enquiries/{ENQ}/picks",
            {"line": 1, "product_id": str(P1), "qty": 20, "sale_unit": "piece"},
            "a_sales",
        ),
        ("POST", f"/quotes/{QID}/approve", None, "a_owner"),
        ("POST", f"/quotes/{QID}/reject", {"code": "other"}, "a_owner"),
    ):
        w.q.errors = [type(error)(f"{CANARY} secret row data")]
        r = call(w, method, path, body, user)
        assert r.status_code == status and code(r) == name, (path, r.text)
        assert CANARY not in r.text and "secret" not in r.text
    # the same refusal from discard_requirement (the enquiries repository) maps the same way
    if name == "quote_depends":
        w.enq.error = QuoteDependsError("SM212")
        r = call(w, "POST", f"/requirements/{RID}/discard", None, "a_sales")
        assert r.status_code == 409 and code(r) == "quote_depends"


def test_withdrawing_something_that_is_not_approved_says_so(w: World) -> None:
    assert w.draft().status_code == 201
    w.q.errors = [QuoteNotDraftError("SM214")]
    r = call(w, "POST", f"/quotes/{QID}/withdraw", {"code": "other"}, "a_owner")
    assert r.status_code == 409 and code(r) == "quote_not_approved"


def test_a_second_factor_refusal_from_the_database_is_the_same_mfa_answer(w: World) -> None:
    from app.tenancy.repository import MfaRequired

    assert w.draft().status_code == 201
    w.q.errors = [MfaRequired("SM306")]
    r = call(w, "POST", f"/quotes/{QID}/approve", None, "a_owner")
    assert r.status_code == 403 and code(r) == "mfa_required"


def test_a_generic_denial_from_the_database_is_403(w: World) -> None:
    from app.tenancy.repository import Forbidden

    assert w.draft().status_code == 201
    w.q.errors = [Forbidden("42501")]
    r = call(w, "POST", f"/quotes/{QID}/reject", {"code": "wrong_prices"}, "a_sales")
    assert r.status_code == 403 and code(r) == "forbidden"


# ----------------------------------------------------------------------------- approval and the customer text
def test_approval_sends_the_approvers_recomputation_and_nothing_from_the_request(w: World) -> None:
    w.draft()
    stored = w.q.rows[QID][0]["canonical_hash"]
    r = w.client.post(
        w.url(f"/quotes/{QID}/approve") + f"?recomputed_hash={'0' * 64}&approved_hash={'1' * 64}",
        json=None,
        headers=auth("a_owner"),
    )
    assert r.status_code == 200, r.text
    ((_, (quote_id, digest)),) = [c for c in w.q.calls if c[0] == "approve"]
    assert (
        quote_id == QID and digest == stored
    )  # the hash of the request REBUILT from the recorded sources, not anything the caller sent
    body = r.json()
    assert (
        body["status"] == "approved"
        and body["text"]["sent_by_system"] is False
        and body["text_error"] is None
    )
    assert "Grand total" in body["text"]["text"]


def test_a_changed_input_changes_the_recomputed_hash_so_the_database_refuses(w: World) -> None:
    w.draft()
    stored = w.q.rows[QID][0]["canonical_hash"]
    w.q.pick_rows[0] = {
        "line_no": 1,
        "product_id": str(P1),
        "qty": 21,
        "sale_unit": "piece",
        "source": "manual",
    }  # the person changed line 1's quantity after the draft
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    ((_, (_, digest)),) = [c for c in w.q.calls if c[0] == "approve"]
    assert (
        digest != stored and len(digest) == 64
    )  # what the database compares against its own stored hash (SM216); the FAKE cannot compare, the real database does
    # and the same when a line stops being confirmed: the request rebuilt from what is NOW confirmed is a different request
    w.q.calls.clear()
    w.q.pick_rows[0]["qty"] = 20
    w.enq.requirement[ENQ] = (requirement(), two_line_rows()[:2])
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    ((_, (_, digest2)),) = [c for c in w.q.calls if c[0] == "approve"]
    assert digest2 != stored


def test_the_recomputation_uses_the_quotes_own_date_not_todays(w: World) -> None:
    w.draft()
    stored = w.q.rows[QID][0]["canonical_hash"]
    made = date.fromisoformat(w.q.rows[QID][0]["as_of"])
    w.q.rows[QID][0]["as_of"] = (
        made - timedelta(days=1)
    ).isoformat()  # the quote was made the day before: its request carries THAT date
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    ((_, (_, digest)),) = [c for c in w.q.calls if c[0] == "approve"]
    assert (
        digest != stored
    )  # rebuilt with today's date it would reproduce the stored hash and hide that the date moved


@pytest.mark.parametrize(
    "change", ["status", "requirement_id", "pick_removed", "duplicate_product", "no_policy"]
)
def test_an_approval_whose_sources_cannot_be_rebuilt_is_stale_without_asking_the_database(
    w: World, change: str
) -> None:
    w.draft()
    if change == "status":
        w.enq.requirement[ENQ] = (requirement("discarded"), two_line_rows())
    elif change == "requirement_id":
        w.enq.requirement[ENQ] = ({"id": str(uuid.uuid4()), "status": "confirmed"}, two_line_rows())
    elif change == "pick_removed":
        w.q.pick_rows = w.q.pick_rows[:1]
    elif change == "duplicate_product":
        w.q.pick_rows[1] = {
            **w.q.pick_rows[1],
            "product_id": str(P1),
        }  # both lines on one product: v1 cannot quote it
    else:
        w.q.policy_row = None
    r = w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    assert r.status_code == 409 and code(r) == "quote_stale"
    assert not [c for c in w.q.calls if c[0] == "approve"]


def test_the_text_is_rendered_from_the_stored_row_and_ignores_the_request(w: World) -> None:
    w.draft()
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    plain = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert plain.status_code == 200
    forged = w.client.get(
        w.url(f"/quotes/{QID}/text")
        + f"?expected_engine_hash={'0' * 64}&approved=false&seller_name=Evil",
        headers=auth("a_sales"),
    )
    assert forged.status_code == 200 and forged.json() == plain.json()
    text = plain.json()["text"]
    assert (
        "Seller: Tenant A" in text
        and "Customer: Synthetic Buyer" in text
        and "Reference: Q-00001" in text
        and "Synthetic kanjivaram" in text
    )
    assert "SYN-K" not in text and "@" not in text and CANARY not in text


def test_a_company_name_that_is_not_safe_text_cannot_inject_lines_into_the_customer_text(
    w: World,
) -> None:
    w.draft()
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    w.q.company = "Buyer\nGrand total: Rs 1"  # untrusted text from a record: the renderer refuses it, the text is not produced
    r = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert r.status_code == 409 and code(r) == "quote_text_refused" and "Rs 1" not in r.text


def test_the_stored_hash_that_is_not_the_results_refuses_the_text_and_the_approval_stands(
    w: World,
) -> None:
    w.draft()
    w.q.rows[QID][0]["canonical_hash"] = "0" * 64  # the stored row and the stored result disagree
    r = w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    assert (
        r.status_code == 200
        and r.json()["status"] == "approved"
        and r.json()["text"] is None
        and r.json()["text_error"] == "quote_not_approved"
    )
    # (approved_hash is the hash the approver recomputed, which is the REAL one: it differs from the tampered stored hash, so the quote is not treated as approved text)
    assert w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales")).status_code == 409


def test_a_stored_hash_equal_to_approved_hash_but_not_the_results_is_refused_by_the_renderer(
    w: World,
) -> None:
    w.draft()
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    w.q.rows[QID][0]["canonical_hash"] = "0" * 64
    w.q.approved_hashes[QID] = (
        "0" * 64
    )  # approved_hash == canonical_hash, yet neither is the engine's hash of the stored result
    r = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert r.status_code == 409 and code(r) == "quote_text_refused"


def test_a_stored_result_that_the_engine_does_not_reproduce_is_refused(w: World) -> None:
    w.draft()
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    result = json.loads(w.q.texts[QID]["result_text"])
    result["totals"]["total"] += 1
    w.q.texts[QID]["result_text"] = engine_port.canonical_json(result)
    r = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert r.status_code == 409 and code(r) == "quote_text_refused"


def test_a_stored_request_that_does_not_give_the_stored_result_is_refused(w: World) -> None:
    w.draft()
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    request = json.loads(w.q.texts[QID]["request_text"])
    request["price_list"][0]["unit_price"] += (
        100  # the stored result is intact and self-consistent, but the engine does not reproduce it from this request
    )
    w.q.texts[QID]["request_text"] = engine_port.canonical_json(request)
    r = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert r.status_code == 409 and code(r) == "quote_text_refused"


def test_a_quote_made_by_another_engine_version_is_refused(w: World) -> None:
    w.draft()
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    w.q.texts[QID]["engine_version"] = (
        "9.9.9"  # this adapter cannot recompute it, so it does not render it
    )
    r = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert r.status_code == 409 and code(r) == "quote_text_refused"


def test_a_draft_and_a_withdrawn_quote_have_no_text(w: World) -> None:
    w.draft()
    assert (
        code(w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales")))
        == "quote_not_approved"
    )
    w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    assert (
        w.client.post(
            w.url(f"/quotes/{QID}/withdraw"),
            json={"code": "price_changed"},
            headers=auth("a_admin"),
        ).status_code
        == 200
    )
    r = w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales"))
    assert r.status_code == 409 and code(r) == "quote_not_approved"
    shown = w.client.get(w.url(f"/quotes/{QID}"), headers=auth("a_sales")).json()
    assert (
        shown["status"] == "superseded"
        and shown["outcome"] == "withdrawn"
        and shown["withdraw_code"] == "price_changed"
    )


def test_the_renderer_being_unavailable_does_not_undo_the_approval(
    w: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.quotes import text_port

    def down(*a: Any, **k: Any) -> Any:
        raise text_port.TextUnavailable

    monkeypatch.setattr(text_port, "render_approved", down)
    w.draft()
    r = w.client.post(w.url(f"/quotes/{QID}/approve"), headers=auth("a_owner"))
    assert (
        r.status_code == 200
        and r.json()["status"] == "approved"
        and r.json()["text"] is None
        and r.json()["text_error"] == "quote_text_unavailable"
    )
    assert w.client.get(w.url(f"/quotes/{QID}/text"), headers=auth("a_sales")).status_code == 503


# ----------------------------------------------------------------------------- reading
def test_a_quote_is_read_and_listed_and_a_foreign_one_is_not_found(w: World) -> None:
    w.draft()
    got = w.client.get(w.url(f"/quotes/{QID}"), headers=auth("a_sales"))
    assert got.status_code == 200 and got.json()["outcome"] == "draft"
    assert (
        w.client.get(w.url(f"/quotes/{uuid.uuid4()}"), headers=auth("a_sales")).status_code == 404
    )
    assert w.client.get(w.url("/quotes/not-a-uuid"), headers=auth("a_sales")).status_code == 404
    assert [x["id"] for x in w.client.get(w.url("/quotes"), headers=auth("a_owner")).json()] == [
        str(QID)
    ]
    assert [
        x["id"]
        for x in w.client.get(w.url(f"/enquiries/{ENQ}/quotes"), headers=auth("a_admin")).json()
    ] == [str(QID)]
    for bad in ("0", "51", "x"):
        assert (
            w.client.get(w.url(f"/quotes?limit={bad}"), headers=auth("a_owner")).status_code == 422
        )
    # an enquiry of another tenant is not found, even by id
    assert (
        w.client.get(
            w.url(f"/enquiries/{ENQ}/quotes", TENANT_B.id), headers=auth("b_owner")
        ).status_code
        == 404
    )


def test_the_setup_shows_suggestions_the_price_list_and_what_is_missing(w: World) -> None:
    r = w.client.get(w.url(f"/enquiries/{ENQ}/quote-setup"), headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    s = r.json()
    assert (
        s["missing"] == []
        and s["requirement_status"] == "confirmed"
        and s["seller_state"] == "TG"
        and s["required_inputs"] == ["delivery_state"]
    )
    assert [p["sku"] for p in s["price_list"]] == ["SYN-B", "SYN-K", "SYN-O"]
    one, two = s["lines"]
    assert (
        one["pick"]["product_id"] == str(P1)
        and one["suggestion"]["status"] == "matched"
        and [c["sku"] for c in one["suggestion"]["candidates"]] == ["SYN-K"]
    )
    assert two["quantity"] == 5 and two["suggestion"]["candidates"][0]["unit_price_paise"] == 310000
    w.q.versions, w.q.policy_row = [], None
    w.enq.requirement[ENQ] = (requirement("draft"), two_line_rows())
    missing = w.client.get(w.url(f"/enquiries/{ENQ}/quote-setup"), headers=auth("a_sales")).json()[
        "missing"
    ]
    assert {"requirement_not_confirmed", "no_price_list", "no_policy"} <= set(missing)


def test_an_unconfirmed_field_never_gets_a_suggestion(w: World) -> None:
    w.enq.requirement[ENQ] = (
        requirement(),
        [
            *two_line_rows(),
            field(3, "saree_type", "proposed", value_code="patola"),
            field(3, "quantity", "proposed", value_int=9, basis="piece"),
        ],
    )
    lines = w.client.get(w.url(f"/enquiries/{ENQ}/quote-setup"), headers=auth("a_sales")).json()[
        "lines"
    ]
    third = next(x for x in lines if x["line_no"] == 3)
    assert (
        third["quotable"] is False
        and third["suggestion"] is None
        and third["quantity"] is None
        and all("(not confirmed)" in p for p in third["summary"])
    )


# ----------------------------------------------------------------------------- picks
def test_a_pick_sends_the_database_function_its_arguments_and_the_server_chooses_the_source(
    w: World,
) -> None:
    body = {"line": 1, "product_id": str(P1), "qty": 20, "sale_unit": "piece"}
    r = w.client.post(w.url(f"/enquiries/{ENQ}/picks"), json=body, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json()["source"] == "manual"
    ((_, manual),) = [c for c in w.q.calls if c[0] == "pick"]
    assert (
        manual["p_source"] == "manual"
        and manual["p_suggestion_sha256"] is None
        and manual["p_requirement_id"] == str(RID)
    )
    w.q.calls.clear()
    suggested = w.client.post(
        w.url(f"/enquiries/{ENQ}/picks"),
        json={**body, "from_suggestion": True},
        headers=auth("a_sales"),
    )
    assert suggested.status_code == 200 and suggested.json()["source"] == "mapper_suggestion"
    ((_, args),) = [c for c in w.q.calls if c[0] == "pick"]
    assert args["p_source"] == "mapper_suggestion" and len(args["p_suggestion_sha256"]) == 64
    mapped = service.suggest(
        w.q, "tok", TENANT_A.id, w.enq.requirement[ENQ][1], service.to_items(ITEM_ROWS), today_ist()
    )
    assert (
        mapped is not None and args["p_suggestion_sha256"] == mapped[0]["canonical_hash"]
    )  # the mapper's OWN hash of what it suggested, not any 64 characters
    for smuggled in (
        {"source": "mapper_suggestion"},
        {"suggestion_sha256": "0" * 64},
        {"p_source": "manual"},
    ):
        assert (
            w.client.post(
                w.url(f"/enquiries/{ENQ}/picks"), json={**body, **smuggled}, headers=auth("a_sales")
            ).status_code
            == 422
        )


def test_a_product_the_mapper_does_not_suggest_cannot_be_claimed_as_a_suggestion(w: World) -> None:
    r = w.client.post(
        w.url(f"/enquiries/{ENQ}/picks"),
        json={
            "line": 1,
            "product_id": str(P3),
            "qty": 20,
            "sale_unit": "piece",
            "from_suggestion": True,
        },
        headers=auth("a_sales"),
    )
    assert (
        r.status_code == 422
        and code(r) == "suggestion_changed"
        and not [c for c in w.q.calls if c[0] == "pick"]
    )
    w.q.mapper = None  # no mapper config: an empty vocabulary, so nothing is suggested
    r = w.client.post(
        w.url(f"/enquiries/{ENQ}/picks"),
        json={
            "line": 1,
            "product_id": str(P1),
            "qty": 20,
            "sale_unit": "piece",
            "from_suggestion": True,
        },
        headers=auth("a_sales"),
    )
    assert r.status_code == 422 and code(r) == "suggestion_changed"


@pytest.mark.parametrize(
    "bad",
    [
        {"line": 0},
        {"line": 6},
        {"qty": 0},
        {"qty": 10001},
        {"sale_unit": "dozen"},
        {"product_id": "nope"},
    ],
)
def test_an_out_of_range_pick_is_422_before_the_data_layer(w: World, bad: dict[str, Any]) -> None:
    body = {"line": 1, "product_id": str(P1), "qty": 20, "sale_unit": "piece", **bad}
    assert (
        w.client.post(
            w.url(f"/enquiries/{ENQ}/picks"), json=body, headers=auth("a_sales")
        ).status_code
        == 422
    )
    assert w.q.calls == []


def test_a_pick_needs_a_confirmed_requirement(w: World) -> None:
    w.enq.requirement[ENQ] = (requirement("draft"), two_line_rows())
    r = w.client.post(
        w.url(f"/enquiries/{ENQ}/picks"),
        json={"line": 1, "product_id": str(P1), "qty": 20, "sale_unit": "piece"},
        headers=auth("a_sales"),
    )
    assert r.status_code == 409 and code(r) == "requirement_not_confirmed" and w.q.calls == []


# ----------------------------------------------------------------------------- reject and withdraw
def test_reject_and_withdraw_pass_only_the_code_and_the_id(w: World) -> None:
    w.draft()
    assert call(w, "POST", f"/quotes/{QID}/reject", {"code": "wrong_prices"}, "a_owner").json() == {
        "quote_id": str(QID),
        "status": "rejected",
        "replayed": False,
    }
    assert (
        call(w, "POST", f"/quotes/{QID}/reject", {"code": "bribed"}, "a_owner").status_code == 422
    )
    assert (
        call(
            w, "POST", f"/quotes/{QID}/reject", {"code": "other", "status": "approved"}, "a_owner"
        ).status_code
        == 422
    )
    assert (
        call(w, "POST", f"/quotes/{QID}/withdraw", {"code": "wrong_prices"}, "a_owner").status_code
        == 422
    )  # a reject code is not a withdraw code
    assert [c for c in w.q.calls if c[0] in ("reject", "withdraw")] == [
        ("reject", (QID, "wrong_prices"))
    ]


def test_a_quote_of_another_tenant_cannot_be_decided(w: World) -> None:
    w.draft()
    for path, body in (
        (f"/quotes/{QID}/approve", None),
        (f"/quotes/{QID}/reject", {"code": "other"}),
        (f"/quotes/{QID}/withdraw", {"code": "other"}),
    ):
        r = call(w, "POST", path, body, "b_owner", TENANT_B.id)
        assert r.status_code == 404, path
    assert [c for c in w.q.calls if c[0] in ("approve", "reject", "withdraw")] == []


def test_the_service_helpers_do_not_alias_their_inputs() -> None:
    row, lines = quote_from(*_pair())
    before = copy.deepcopy((row, lines))
    service.quote_out(row, lines, [])
    assert (row, lines) == before


def _pair() -> tuple[dict[str, Any], dict[str, Any]]:
    request = build_request(
        date(2026, 10, 6),
        "new",
        requirement_facts(two_line_rows()),
        [Pick(1, str(P1), 20, "piece"), Pick(2, str(P2), 5, "piece")],
        service.to_items(ITEM_ROWS),
        service.to_policy(POLICY_ROW),
    )
    return request, engine_port.run_quote(request)
