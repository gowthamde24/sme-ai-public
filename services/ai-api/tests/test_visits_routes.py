"""Job AS (ADR 0067): the HTTP side of store visits, the opening hours and the slots against an in-memory fake: the role matrix of every endpoint (with the second factor where one is needed), WHAT is
sent to the database, that no body can carry a status, a contact, a source or an approver, the closed validation of times and amounts, the fixed error mapping, the Today list, the fixed message
templates (all five languages, India time, midnight), the stable message ids, and the dispatch rule of the outbox. The database rules are pgTAP 77; the real stack is
tests/integration/test_visits_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.outbox.adapter import LocalFakeAdapter
from app.outbox.errors import OutboxStateError
from app.tenancy.repository import MfaRequired, UpstreamError
from app.visits import service, texts
from app.visits.errors import (
    CustomerErasedError,
    NoQuoteError,
    PastDateError,
    ShopClosedError,
    SlotFullError,
    SlotInvalidError,
    VisitStateError,
)
from tests.fakes import TENANT_A, auth, make_client
from tests.outbox_fakes import FakeOutbox, call_row
from tests.visits_fakes import LEAD, FakeVisits, visit_row

V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
V2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
C1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
BASE = f"/v1/tenants/{TENANT_A.id}"
A1, A2, A3, A4, A5, A6 = (str(uuid.UUID(int=n)) for n in range(1, 7))


class World:
    def __init__(self) -> None:
        self.outbox = FakeOutbox()
        self.db = FakeVisits(self.outbox)
        self.adapter = LocalFakeAdapter()
        self.client, _ = make_client(
            visits=self.db, outbox=self.outbox, outbox_adapter=self.adapter
        )
        self.db.rows[V1] = visit_row(V1)
        self.db.rows[V2] = visit_row(
            V2,
            status="confirmed",
            starts_at="2026-10-05T10:30:00+00:00",
            ends_at="2026-10-05T11:00:00+00:00",
            advance_requested=True,
            advance_paise=50000,
        )
        self.outbox.calls_rows[C1] = call_row(C1)

    def call(
        self, method: str, path: str, user: str | None, body: Any = None, **claims: Any
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, BASE + path, json=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


BOOK = {
    "visit_id": NEW,
    "lead_id": LEAD,
    "date": "2026-10-06",
    "slot_start": "11:00",
    "party_size": 2,
    "purpose": "Bridal sarees",
}
SETTINGS: dict[str, Any] = {
    "weekly_hours": {
        d: {"open": "10:00", "close": "20:30"} if d != "sun" else None
        for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    },
    "closed_dates": ["2026-10-20"],
    "slot_minutes": 30,
    "max_parallel": 2,
}
EVERY_MEMBER = ("a_owner", "a_admin", "a_sales", "a_viewer")
SALES_PLUS = ("a_owner", "a_admin", "a_sales")
# (method, path, body, the roles that may, whether a second factor is needed for the roles that may)
MATRIX: list[tuple[str, str, Any, tuple[str, ...], bool]] = [
    ("GET", "/visits/settings", None, EVERY_MEMBER, False),
    ("PUT", "/visits/settings", SETTINGS, ("a_owner", "a_admin"), False),
    ("GET", "/visits/slots?date=2026-10-05", None, EVERY_MEMBER, False),
    ("GET", "/visits/today", None, EVERY_MEMBER, False),
    ("GET", "/visits", None, EVERY_MEMBER, False),
    ("GET", f"/visits/{V1}", None, EVERY_MEMBER, False),
    ("POST", "/visits", BOOK, SALES_PLUS, False),
    ("POST", f"/visits/{V1}/change", {"party_size": 4}, SALES_PLUS, False),
    ("POST", f"/visits/{V1}/confirm", None, SALES_PLUS, False),
    ("POST", f"/visits/{V1}/arrive", None, SALES_PLUS, False),
    ("POST", f"/visits/{V1}/no-show", None, SALES_PLUS, False),
    ("POST", f"/visits/{V1}/cancel", {"reason": "Changed her mind"}, SALES_PLUS, False),
    ("POST", f"/visits/{V1}/complete", {"outcome": "will_return"}, SALES_PLUS, False),
    ("POST", f"/visits/{V2}/messages", {"kind": "confirmation"}, SALES_PLUS, False),
    ("POST", f"/call-requests/{C1}/offer-visit", None, ("a_owner",), True),
]
IDS = [f"{m} {p.replace(V1, '<v>').replace(V2, '<v>').replace(C1, '<c>')}" for m, p, *_ in MATRIX]


@pytest.mark.parametrize(("method", "path", "body", "allowed", "strong"), MATRIX, ids=IDS)
def test_the_role_matrix_of_every_endpoint(
    method: str, path: str, body: Any, allowed: tuple[str, ...], strong: bool
) -> None:
    for user in EVERY_MEMBER:
        w = World()
        r = w.call(method, path, user, body)
        if user in allowed:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (
                user,
                r.status_code,
                r.text,
            )
            assert not [c for c in w.db.calls if c[0] != "visit_list"], (
                f"{user} reached the data layer"
            )
    w = World()
    assert w.call(method, path, "outsider", body).status_code == 404, "a stranger learns nothing"
    assert w.call(method, path, "b_owner", body).status_code == 404, (
        "another business's owner learns nothing"
    )
    assert w.call(method, path, None, body).status_code == 401
    assert w.db.calls == []
    if strong:
        for user in allowed:
            w = World()
            r = w.call(method, path, user, body, aal="aal1")
            assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required", (
                user,
                r.text,
            )


# ---------------------------------------------------------------------------------------------- what is sent to the database
def test_booking_sends_exactly_the_lead_the_india_date_the_slot_and_a_fixed_source(
    w: World,
) -> None:
    r = w.call(
        "POST", "/visits", "a_sales", {**BOOK, "advance_paise": 50000, "note": "With her mother"}
    )
    assert r.status_code == 200
    args = w.db.last("visit_book")
    assert args == {
        "p_visit_id": NEW,
        "p_tenant_id": str(TENANT_A.id),
        "p_lead_id": LEAD,
        "p_date": "2026-10-06",
        "p_slot_start": "11:00",
        "p_party_size": 2,
        "p_purpose": "Bridal sarees",
        "p_note": "With her mother",
        "p_advance_paise": 50000,
        "p_source": "staff",
    }
    body = r.json()
    assert body["replayed"] is False and body["visit"]["id"] == NEW
    assert body["visit"]["advance_requested"] is True and body["visit"]["advance_paise"] == 50000


def test_an_advance_is_optional_and_off_by_default(w: World) -> None:
    body = w.call("POST", "/visits", "a_owner", BOOK).json()
    assert w.db.last("visit_book")["p_advance_paise"] is None
    assert body["visit"]["advance_requested"] is False and body["visit"]["advance_paise"] is None


@pytest.mark.parametrize(
    "extra",
    [
        {"status": "completed"},
        {"source": "assistant"},
        {"contact_id": V1},
        {"phone": "+91 98765 43210"},
        {"approved_by": V1},
        {"tenant_id": V1},
        {"p_source": "assistant"},
    ],
)
def test_no_body_can_carry_a_status_a_contact_a_source_a_phone_or_an_approver(
    w: World, extra: dict[str, Any]
) -> None:
    r = w.call("POST", "/visits", "a_owner", {**BOOK, **extra})
    assert r.status_code == 422 and w.db.calls == []


@pytest.mark.parametrize(
    "change",
    [
        {"slot_start": "9:30"},
        {"slot_start": "25:00"},
        {"slot_start": "10:60"},
        {"slot_start": "24:00"},
        {"date": "2026-13-01"},
        {"date": "tomorrow"},
        {"party_size": 0},
        {"party_size": 51},
        {"party_size": "two"},
        {"advance_paise": 0},
        {"advance_paise": -5},
        {"advance_paise": 100_000_001},
        {"advance_paise": 12.5},
        {"purpose": ""},
        {"purpose": "x" * 201},
        {"note": "x" * 1001},
    ],
)
def test_times_amounts_and_sizes_are_closed(w: World, change: dict[str, Any]) -> None:
    r = w.call("POST", "/visits", "a_owner", {**BOOK, **change})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert w.db.calls == []


def test_the_change_needs_a_date_and_a_slot_together_and_cannot_set_and_clear_the_advance(
    w: World,
) -> None:
    for body in (
        {"date": "2026-10-06"},
        {"slot_start": "11:00"},
        {"advance_paise": 5000, "clear_advance": True},
    ):
        r = w.call("POST", f"/visits/{V1}/change", "a_owner", body)
        assert r.status_code == 422, body
    assert "visit_change" not in w.db.names()
    r = w.call(
        "POST", f"/visits/{V1}/change", "a_owner", {"date": "2026-10-06", "slot_start": "11:30"}
    )
    assert r.status_code == 200 and r.json()["moved"] is True
    assert w.db.last("visit_change")["p_date"] == "2026-10-06"


def test_a_completion_with_a_quote_needs_an_order_and_an_order_needs_bought(w: World) -> None:
    for body in (
        {"outcome": "bought", "quote_id": C1},
        {"outcome": "will_return", "order_id": NEW},
        {"outcome": "maybe"},
        {"outcome": "bought", "order_id": "not-a-uuid"},
    ):
        assert w.call("POST", f"/visits/{V1}/complete", "a_owner", body).status_code == 422, body
    assert "visit_complete" not in w.db.names()
    r = w.call(
        "POST",
        f"/visits/{V1}/complete",
        "a_owner",
        {"outcome": "bought", "order_id": NEW, "quote_id": C1},
    )
    assert r.status_code == 200
    assert w.db.last("visit_complete") | {} == {
        "p_tenant_id": str(TENANT_A.id),
        "p_visit_id": V1,
        "p_outcome": "bought",
        "p_order_id": NEW,
        "p_quote_id": C1,
    }
    assert r.json()["order_id"] == NEW and r.json()["visit"]["status"] == "completed"


def test_the_settings_are_the_whole_week_with_all_seven_days(w: World) -> None:
    bad = {**SETTINGS, "weekly_hours": {"mon": {"open": "10:00", "close": "20:00"}}}
    assert w.call("PUT", "/visits/settings", "a_owner", bad).status_code == 422
    for hours in (
        {"open": "10:00", "close": "09:00"},
        {"open": "10:00", "close": "10:00"},
        {"open": "10:00", "close": "25:00"},
        {"open": "10:00"},
    ):
        week = {**SETTINGS["weekly_hours"], "mon": hours}
        r = w.call("PUT", "/visits/settings", "a_owner", {**SETTINGS, "weekly_hours": week})
        assert r.status_code == 422, hours
    for patch in (
        {"slot_minutes": 25},
        {"max_parallel": 0},
        {"max_parallel": 51},
        {"closed_dates": ["x"]},
    ):
        assert (
            w.call("PUT", "/visits/settings", "a_owner", {**SETTINGS, **patch}).status_code == 422
        )
    assert "visit_settings_set" not in w.db.names()
    week = {**SETTINGS["weekly_hours"], "tue": {"open": "00:00", "close": "24:00"}}
    r = w.call("PUT", "/visits/settings", "a_admin", {**SETTINGS, "weekly_hours": week})
    assert r.status_code == 200
    sent = w.db.last("visit_settings_set")
    assert sent["p_weekly_hours"]["tue"] == {"open": "00:00", "close": "24:00"}
    assert sent["p_weekly_hours"]["sun"] is None and sent["p_closed_dates"] == ["2026-10-20"]
    assert r.json()["is_default"] is False and r.json()["weekly_hours"]["sun"] is None


def test_a_closed_date_list_is_sorted_and_without_duplicates(w: World) -> None:
    body = {**SETTINGS, "closed_dates": ["2026-10-20", "2026-10-12", "2026-10-20"]}
    assert w.call("PUT", "/visits/settings", "a_owner", body).status_code == 200
    assert w.db.last("visit_settings_set")["p_closed_dates"] == ["2026-10-12", "2026-10-20"]


def test_the_defaults_say_so(w: World) -> None:
    body = w.call("GET", "/visits/settings", "a_viewer").json()
    assert body["is_default"] is True and body["slot_minutes"] == 30 and body["max_parallel"] == 2
    assert body["weekly_hours"]["tue"] == {"open": "10:00", "close": "20:30"}


def test_slots_need_a_date(w: World) -> None:
    assert w.call("GET", "/visits/slots", "a_owner").status_code == 422
    assert w.call("GET", "/visits/slots?date=soon", "a_owner").status_code == 422
    body = w.call("GET", "/visits/slots?date=2026-10-05", "a_viewer").json()
    assert body["slots"][0] == {
        "start": "10:00",
        "starts_at": "2026-10-05T04:30:00Z",
        "ends_at": "2026-10-05T05:00:00Z",
        "capacity": 2,
        "free": 1,
        "past": False,
    }
    assert w.db.last("visit_slots") == {"day": "2026-10-05"}


# ---------------------------------------------------------------------------------------------- lists, today and the shaping
def test_the_list_passes_its_filters_and_answers_with_from_and_to(w: World) -> None:
    r = w.call(
        "GET",
        f"/visits?from=2026-10-05&to=2026-10-12&status=confirmed&lead_id={LEAD}&open_only=true",
        "a_viewer",
    )
    assert r.status_code == 200
    assert w.db.last("visit_list") == {
        "from": "2026-10-05",
        "to": "2026-10-12",
        "open_only": True,
        "status": "confirmed",
        "lead_id": LEAD,
        "visit_id": None,
    }
    body = r.json()
    assert set(body) == {"from", "to", "items"} and [i["id"] for i in body["items"]] == [V2]
    assert w.call("GET", "/visits?status=gone", "a_owner").status_code == 422
    assert w.call("GET", "/visits?lead_id=nope", "a_owner").status_code == 404


def test_an_item_has_every_field_the_web_needs(w: World) -> None:
    item = w.call("GET", f"/visits/{V2}", "a_viewer").json()
    assert set(item) == {
        "id", "lead_id", "contact_id", "customer", "contact_name", "who", "city", "date", "starts_at",
        "ends_at", "party_size", "purpose", "note", "status", "source", "outcome", "order_id",
        "advance_requested", "advance_paise", "confirmation_message_id", "reminder_message_id",
        "confirmation_sent", "reminder_sent", "cancel_reason", "created_at", "confirmed_at",
        "arrived_at", "closed_at",
    }  # fmt: skip
    assert item["who"] == "Priya S." and item["customer"] == "Synthetic Silks"
    assert item["date"] == "2026-10-05" and item["starts_at"] == "2026-10-05T10:30:00Z"


def test_one_visit_unknown_or_malformed_is_a_404(w: World) -> None:
    assert w.call("GET", f"/visits/{NEW}", "a_owner").status_code == 404
    assert w.call("GET", "/visits/not-a-uuid", "a_owner").status_code == 404
    assert w.call("POST", f"/visits/{NEW}/confirm", "a_owner").status_code == 404
    assert "visit_step" not in w.db.names()


def test_today_lists_what_is_still_to_come_in_the_three_words_the_page_draws(w: World) -> None:
    w.db.rows.clear()
    w.db.rows[A1] = visit_row(
        A1, status="booked", party_size=1, purpose=None, starts_at="2026-10-05T04:30:00+00:00"
    )
    w.db.rows[A2] = visit_row(A2, status="confirmed", party_size=3)
    w.db.rows[A3] = visit_row(A3, status="confirmed", reminder_sent=True, contact_name="Anand")
    w.db.rows[A4] = visit_row(
        A4, status="arrived", contact_name=None, company_name="Synthetic Silks"
    )
    w.db.rows[A5] = visit_row(A5, status="completed")
    w.db.rows[A6] = visit_row(A6, status="cancelled")
    body = w.call("GET", "/visits/today", "a_viewer").json()
    assert w.db.last("visit_list")["open_only"] is True
    assert body["date"] == "2026-10-05"
    got = {i["id"]: i for i in body["items"]}
    assert set(got) == {A1, A2, A3, A4}, (
        "completed and cancelled visits are not 'at the store today'"
    )
    assert got[A1]["status"] == "requested" and got[A1]["extra"] == 0 and got[A1]["topic"] is None
    assert (
        got[A2]["status"] == "confirmed" and got[A2]["extra"] == 2 and got[A2]["who"] == "Priya S."
    )
    assert got[A3]["status"] == "reminder_sent" and got[A3]["who"] == "Anand"
    assert (
        got[A4]["status"] == "confirmed"
        and got[A4]["visit_status"] == "arrived"
        and got[A4]["who"] == "Synthetic Silks"
    )
    assert set(got[A2]) == {
        "id",
        "lead_id",
        "starts_at",
        "who",
        "extra",
        "topic",
        "status",
        "visit_status",
    }


@pytest.mark.parametrize(
    ("name", "short"),
    [
        ("Priya Sharma", "Priya S."),
        ("Priya", "Priya"),
        ("  Priya   Kumari   Reddy ", "Priya R."),
        ("", None),
        (None, None),
        ("erased:1", None),
        (42, None),
    ],
)
def test_the_short_name(name: Any, short: str | None) -> None:
    assert service.short_name(name) == short


def test_an_erased_customer_shows_as_a_customer_and_leaks_nothing() -> None:
    row = visit_row(
        V1,
        contact_name="erased:1",
        company_name="erased:1",
        city="erased:1",
        purpose="erased:1",
        note="erased:1",
    )
    out = service.visit_out(row)
    assert out.who == "A customer" and out.customer is None and out.contact_name is None
    assert out.purpose is None and out.note is None and out.city is None


def test_an_unexpected_row_is_a_502_not_a_guess(w: World) -> None:
    w.db.rows[V1].pop("status")
    r = w.call("GET", f"/visits/{V1}", "a_owner")
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"


# ---------------------------------------------------------------------------------------------- the steps and the fixed error mapping
@pytest.mark.parametrize(
    ("path", "body", "action"),
    [
        ("confirm", None, "confirm"),
        ("arrive", None, "arrive"),
        ("no-show", None, "no_show"),
        ("cancel", None, "cancel"),
        ("cancel", {"reason": "Changed her mind"}, "cancel"),
    ],
)
def test_each_step_is_one_function_call(w: World, path: str, body: Any, action: str) -> None:
    r = w.call("POST", f"/visits/{V1}/{path}", "a_sales", body)
    assert r.status_code == 200
    sent = w.db.last("visit_step")
    assert sent["action"] == action and sent["id"] == V1
    assert sent["reason"] == (body or {}).get("reason")
    assert r.json()["visit"]["id"] == V1


def test_a_step_cannot_carry_a_status_or_a_second_reason(w: World) -> None:
    assert (
        w.call("POST", f"/visits/{V1}/cancel", "a_owner", {"status": "booked"}).status_code == 422
    )
    assert (
        w.call("POST", f"/visits/{V1}/cancel", "a_owner", {"reason": "x" * 201}).status_code == 422
    )
    assert "visit_step" not in w.db.names()


ERRORS = [
    (VisitStateError, 409, "visit_state"),
    (CustomerErasedError, 409, "customer_erased"),
    (ShopClosedError, 409, "shop_closed"),
    (SlotInvalidError, 409, "slot_invalid"),
    (SlotFullError, 409, "slot_full"),
    (PastDateError, 409, "date_past"),
    (NoQuoteError, 409, "no_approved_quote"),
    (MfaRequired, 403, "mfa_required"),
]


@pytest.mark.parametrize(("error", "status", "code"), ERRORS)
def test_each_refusal_of_the_database_is_one_fixed_sentence(
    w: World, error: type[Exception], status: int, code: str
) -> None:
    w.db.raise_next = error("SMxxx")
    r = w.call("POST", "/visits", "a_owner", BOOK)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert "SMxxx" not in r.text, "nothing from the data layer reaches the client"


def test_an_unreachable_data_layer_is_a_502(w: World) -> None:
    w.db.raise_next = UpstreamError("down")
    r = w.call("GET", "/visits/settings", "a_owner")
    assert r.status_code == 502


def test_visits_are_unavailable_without_the_data_layer() -> None:
    client, _ = make_client()
    r = client.get(f"{BASE}/visits/today", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "visits_unavailable"


# ---------------------------------------------------------------------------------------------- messages through the outbox
def test_a_confirmation_is_made_from_the_fixed_words_in_india_time_and_goes_to_the_outbox(
    w: World,
) -> None:
    r = w.call(
        "POST", f"/visits/{V2}/messages", "a_sales", {"kind": "confirmation", "language": "en"}
    )
    assert r.status_code == 200
    sent = w.db.last("visit_send_message")
    assert (
        sent["p_kind"] == "confirmation"
        and sent["p_language"] == "en"
        and sent["p_uncertain"] is False
    )
    # V2 starts 10:30 UTC = 16:00 India time on Monday 5 October; it carries an advance of ₹500, so the words say so
    assert sent["p_body"] == (
        "Your visit is confirmed for Monday, 5 October at 4:00 pm. We look forward to seeing you at our shop. "
        "If your plans change, please let us know. An advance of ₹500.00 is requested to hold the slot."
    )
    body = r.json()
    assert body["message"]["category"] == "visit" and body["message"]["source"] == "system"
    assert body["message"]["id"] == sent["p_message_id"] and body["replayed"] is False
    assert body["dispatched"] is None, "Sales leaves delivery to the next dispatch"


def test_owner_and_admin_dispatch_right_after_and_a_replay_does_not(w: World) -> None:
    r = w.call("POST", f"/visits/{V2}/messages", "a_owner", {"kind": "reminder"})
    assert {k: r.json()["dispatched"][k] for k in ("sent", "failed")} == {"sent": 0, "failed": 0}
    assert "outbox_claim_due" in w.outbox.names()
    w.outbox.calls.clear()
    w.db.send_answer = {"replayed": True}
    again = w.call("POST", f"/visits/{V2}/messages", "a_admin", {"kind": "reminder"}).json()
    assert again["replayed"] is True and again["dispatched"] is None
    assert "outbox_claim_due" not in w.outbox.names()


def test_the_same_request_is_the_same_message_and_a_moved_visit_is_a_new_one(w: World) -> None:
    first = w.call("POST", f"/visits/{V2}/messages", "a_owner", {"kind": "confirmation"}).json()
    second = w.call("POST", f"/visits/{V2}/messages", "a_owner", {"kind": "confirmation"}).json()
    assert first["message"]["id"] == second["message"]["id"]
    reminder = w.call("POST", f"/visits/{V2}/messages", "a_owner", {"kind": "reminder"}).json()
    assert reminder["message"]["id"] != first["message"]["id"]
    w.db.rows[V2]["starts_at"] = "2026-10-06T10:30:00+00:00"
    moved = w.call("POST", f"/visits/{V2}/messages", "a_owner", {"kind": "confirmation"}).json()
    assert moved["message"]["id"] != first["message"]["id"], (
        "a visit that moved makes a new confirmation"
    )
    w.db.rows[V2]["advance_paise"] = 70000
    assert (
        w.call("POST", f"/visits/{V2}/messages", "a_owner", {"kind": "confirmation"}).json()[
            "message"
        ]["id"]
        != moved["message"]["id"]
    )


def test_words_nobody_has_checked_yet_are_sent_as_uncertain_so_a_person_decides(w: World) -> None:
    for language in ("te", "hi", "kn", "ta"):
        w.call(
            "POST",
            f"/visits/{V1}/messages",
            "a_owner",
            {"kind": "confirmation", "language": language},
        )
        assert w.db.last("visit_send_message")["p_uncertain"] is True, language
    w.call("POST", f"/visits/{V1}/messages", "a_owner", {"kind": "confirmation", "language": "en"})
    assert w.db.last("visit_send_message")["p_uncertain"] is False


def test_a_message_body_cannot_carry_words_of_its_own(w: World) -> None:
    r = w.call(
        "POST", f"/visits/{V1}/messages", "a_owner", {"kind": "reminder", "text": "Pay ₹500 now"}
    )
    assert r.status_code == 422 and "visit_send_message" not in w.db.names()
    assert (
        w.call("POST", f"/visits/{V1}/messages", "a_owner", {"kind": "goodbye"}).status_code == 422
    )
    assert (
        w.call(
            "POST", f"/visits/{V1}/messages", "a_owner", {"kind": "reminder", "language": "fr"}
        ).status_code
        == 422
    )


def test_a_visit_in_the_wrong_state_makes_no_message(w: World) -> None:
    w.db.raise_next = VisitStateError("SM501")
    r = w.call("POST", f"/visits/{V1}/messages", "a_owner", {"kind": "confirmation"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "visit_state"
    assert w.outbox.names().count("outbox_claim_due") == 0


# ---------------------------------------------------------------------------------------------- "offer a store visit"
def test_offering_a_visit_declines_the_call_and_makes_the_offer_in_one_call(w: World) -> None:
    r = w.call("POST", f"/call-requests/{C1}/offer-visit", "a_owner", {"language": "en"})
    assert r.status_code == 200
    sent = w.db.last("call_request_offer_visit")
    assert (
        sent["p_request_id"] == C1 and sent["p_language"] == "en" and sent["p_uncertain"] is False
    )
    assert sent["p_body"] == texts.render("offer", "en")
    assert "₹" not in sent["p_body"], "the offer says nothing about money"
    body = r.json()
    assert (
        body["request"]["status"] == "rejected"
        and body["request"]["decision_note"] == "offer_store_visit"
    )
    assert body["message"]["category"] == "visit" and body["message"]["source"] == "owner"
    assert body["replayed"] is False and {k: body["dispatched"][k] for k in ("sent", "failed")} == {
        "sent": 0,
        "failed": 0,
    }
    # only ONE database function was called to do both (so they succeed or fail together)
    assert [n for n in w.db.names() if n.startswith("call_request")] == ["call_request_offer_visit"]
    assert "call_request_decide" not in w.outbox.names()


def test_the_offer_defaults_to_english_with_no_body_and_replays(w: World) -> None:
    first = w.call("POST", f"/call-requests/{C1}/offer-visit", "a_owner").json()
    w.db.offer_answer = {"status": "rejected", "message": {"replayed": True}}
    again = w.call("POST", f"/call-requests/{C1}/offer-visit", "a_owner").json()
    assert first["message"]["id"] == again["message"]["id"]
    assert again["replayed"] is True and again["dispatched"] is None


def test_an_offer_in_a_language_nobody_has_checked_waits_for_a_person(w: World) -> None:
    w.call("POST", f"/call-requests/{C1}/offer-visit", "a_owner", {"language": "te"})
    assert w.db.last("call_request_offer_visit")["p_uncertain"] is True


def test_an_unknown_request_is_a_404_and_an_already_decided_one_a_409(w: World) -> None:
    assert w.call("POST", f"/call-requests/{NEW}/offer-visit", "a_owner").status_code == 404
    assert w.call("POST", "/call-requests/nope/offer-visit", "a_owner").status_code == 404
    w.db.raise_next = VisitStateError("SM501")
    r = w.call("POST", f"/call-requests/{C1}/offer-visit", "a_owner")
    assert r.status_code == 409 and r.json()["error"]["code"] == "visit_state"
    w.db.raise_next = OutboxStateError("SM501")
    assert w.call("POST", f"/call-requests/{C1}/offer-visit", "a_owner").status_code == 409


# ---------------------------------------------------------------------------------------------- the fixed words
START = datetime(2026, 10, 5, 8, 30, tzinfo=UTC)  # 14:00 India time, Monday


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn", "ta"])
@pytest.mark.parametrize("kind", ["confirmation", "reminder", "offer"])
def test_every_kind_exists_in_every_language_and_names_the_day_in_that_language(
    language: str, kind: str
) -> None:
    words = texts.render(kind, language, START)  # type: ignore[arg-type]
    assert 20 < len(words) < 500 and "{" not in words and "}" not in words
    if kind != "offer":
        assert texts.WEEKDAYS[language][0] in words, "Monday in the language"
        if (
            language == "ta"
        ):  # Tamil dates are numbers: the month names end in a word the policy reads as tax
            assert "5-10-2026" in words
        else:
            assert texts.MONTHS[language][9] in words, "October in the language"
        assert "5" in words
    assert "₹" not in words, "no money in a confirmation, a reminder or an offer without an advance"


def test_the_time_is_india_time_whatever_the_zone_of_the_instant() -> None:
    utc = datetime(2026, 10, 5, 19, 0, tzinfo=UTC)  # 00:30 on Tuesday the 6th, India time
    words = texts.render("reminder", "en", utc)
    assert "Tuesday, 6 October at 12:30 am" in words
    other_zone = utc.astimezone(__import__("zoneinfo").ZoneInfo("America/Los_Angeles"))
    assert texts.render("reminder", "en", other_zone) == words, (
        "the same instant gives the same words"
    )
    assert "00:30" in texts.render("reminder", "hi", utc) and "मंगलवार" in texts.render(
        "reminder", "hi", utc
    )


@pytest.mark.parametrize(
    ("at", "shown"),
    [
        (datetime(2026, 10, 5, 4, 30, tzinfo=UTC), "10:00 am"),
        (datetime(2026, 10, 5, 6, 30, tzinfo=UTC), "12:00 pm"),
        (datetime(2026, 10, 5, 18, 29, tzinfo=UTC), "11:59 pm"),
        (datetime(2026, 10, 5, 18, 30, tzinfo=UTC), "12:00 am"),
        (datetime(2026, 10, 5, 7, 5, tzinfo=UTC), "12:35 pm"),
    ],
)
def test_the_english_clock_is_12_hour(at: datetime, shown: str) -> None:
    assert shown in texts.render("confirmation", "en", at)


def test_an_advance_adds_the_amount_in_indian_grouping_to_a_confirmation_only() -> None:
    assert "₹1,25,000.00" in texts.render("confirmation", "en", START, 12_500_000)
    assert "₹" not in texts.render("reminder", "en", START, 12_500_000)
    assert "₹" not in texts.render("confirmation", "en", START, None)
    for language in ("te", "hi", "kn", "ta"):
        assert "₹500.00" in texts.render("confirmation", language, START, 50_000)


def test_only_english_is_checked_until_a_native_reader_has_read_the_rest() -> None:
    assert (
        texts.CHECKED_LANGUAGES == {"en"} and texts.is_checked("en") and not texts.is_checked("te")
    )


def test_a_confirmation_needs_the_start_of_the_visit() -> None:
    with pytest.raises(ValueError):
        texts.render("confirmation", "en")
    assert texts.render("offer", "en")


def test_message_ids_are_stable_and_distinct() -> None:
    v = uuid.UUID(V1)
    at = START
    a = service.message_id(v, "confirmation", at, "en", None)
    assert a == service.message_id(v, "confirmation", at, "en", None)
    assert (
        len(
            {
                a,
                service.message_id(v, "reminder", at, "en", None),
                service.message_id(v, "confirmation", at + timedelta(hours=1), "en", None),
                service.message_id(v, "confirmation", at, "te", None),
                service.message_id(v, "confirmation", at, "en", 5000),
                service.message_id(uuid.UUID(V2), "confirmation", at, "en", None),
            }
        )
        == 6
    )
    assert service.offer_message_id(uuid.UUID(C1), "en") != service.offer_message_id(
        uuid.UUID(C1), "te"
    )


# ---------------------------------------------------------------------------------------------- the boundary
def test_nothing_in_the_visits_package_reaches_a_network_or_a_channel_by_itself() -> None:
    import ast
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "app" / "visits"
    imports: set[str] = set()
    for path in root.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                imports |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module.split(".")[0])
    assert imports & {"socket", "smtplib", "requests", "urllib", "subprocess", "twilio"} == set()
    # only the repository talks HTTP (to the data layer, with the caller's token)
    assert {p.name for p in root.glob("*.py") if "httpx" in p.read_text()} == {"repository.py"}
