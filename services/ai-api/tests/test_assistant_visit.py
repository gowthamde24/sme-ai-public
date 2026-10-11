"""Job AS (ADR 0067): Agent OWL can PROPOSE a store visit. The tool books a visit that is only booked (a person confirms it), under the caller's own token, with a stable id, and it can name no
amount, no status and no tenant. The database decides hours, slots and places; the tool turns its refusals into closed notes for the model. The real stack is tests/integration/test_visits_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app.assistant.models import DRAFT_SUMMARY, DraftCardOut
from app.assistant.tools import ACTION_TOOLS, Ctx, ProposeVisitArgs, State, propose_visit
from app.tenancy.repository import Forbidden, UpstreamError
from app.visits import errors as visit_errors
from tests.visits_fakes import FakeVisits

TENANT = uuid.UUID(int=1)
RUN = uuid.UUID(int=2)
LEAD = uuid.UUID(int=3)


def ctx(visits: FakeVisits | None) -> Ctx:
    return Ctx(
        db=None,  # type: ignore[arg-type]
        runtime=SimpleNamespace(visits=visits),  # type: ignore[arg-type]
        token="caller-token",
        tenant=TENANT,
        run_id=RUN,
        state=State(),
    )


def args(**over: Any) -> ProposeVisitArgs:
    base: dict[str, Any] = {"lead_id": LEAD, "date": "2026-10-06", "time": "11:00"}
    return ProposeVisitArgs(**{**base, **over})


def test_it_books_a_visit_for_a_person_to_confirm_and_leaves_a_card() -> None:
    db = FakeVisits()
    c = ctx(db)
    out = propose_visit(c, args())
    assert out.note == "ok" and len(out.items) == 1 and out.items[0].type == "store_visit"
    sent = db.last("visit_book")
    assert sent["p_source"] == "assistant", "the visit remembers that Agent OWL proposed it"
    assert sent["p_advance_paise"] is None and sent["p_note"] is None
    assert sent["p_tenant_id"] == str(TENANT) and sent["p_lead_id"] == str(LEAD)
    assert (sent["p_date"], sent["p_slot_start"], sent["p_party_size"], sent["p_purpose"]) == (
        "2026-10-06",
        "11:00",
        1,
        None,
    )
    assert db.calls[0][1] == "caller-token", "under the caller's own rights"
    (card,) = c.state.drafts
    assert isinstance(card, DraftCardOut) and card.kind == "store_visit" and card.status == "draft"
    assert (
        card.target is not None
        and card.target.type == "store_visit"
        and card.target.id == uuid.UUID(sent["p_visit_id"])
    )
    assert (
        card.summary == DRAFT_SUMMARY["store_visit"]
        and "not confirmed" in card.summary
        and "Nothing has been sent" in card.summary
    )


def test_the_same_ask_twice_is_the_same_visit_and_another_ask_another_one() -> None:
    db = FakeVisits()
    propose_visit(ctx(db), args())
    propose_visit(ctx(db), args())
    propose_visit(ctx(db), args(time="11:30"))
    ids = [c[2]["p_visit_id"] for c in db.calls]
    assert ids[0] == ids[1] != ids[2]


@pytest.mark.parametrize(
    ("error", "note"),
    [
        (visit_errors.ShopClosedError("SM511"), "shop_closed_that_day"),
        (visit_errors.SlotInvalidError("SM512"), "not_a_visit_time"),
        (visit_errors.SlotFullError("SM513"), "that_time_is_full"),
        (visit_errors.PastDateError("SM514"), "date_has_passed"),
        (visit_errors.VisitStateError("SM501"), "customer_already_booked_then"),
        (visit_errors.CustomerErasedError("SM502"), "customer_erased"),
        (Forbidden("42501"), "not_allowed_for_this_person"),
    ],
)
def test_the_databases_refusals_become_closed_notes_and_no_card(
    error: Exception, note: str
) -> None:
    db = FakeVisits()
    db.raise_next = error
    c = ctx(db)
    out = propose_visit(c, args())
    assert out.note == note and out.items == () and c.state.drafts == []


def test_an_unreachable_data_layer_is_not_hidden_as_a_note() -> None:
    db = FakeVisits()
    db.raise_next = UpstreamError("down")
    with pytest.raises(UpstreamError):
        propose_visit(ctx(db), args())


def test_without_the_visits_repository_or_with_a_date_that_does_not_exist_it_refuses() -> None:
    assert propose_visit(ctx(None), args()).note == "unavailable"
    db = FakeVisits()
    assert propose_visit(ctx(db), args(date="2026-02-30")).note == "not_a_date"
    assert db.calls == []


@pytest.mark.parametrize(
    "bad",
    [
        {"advance_paise": 5000},
        {"status": "confirmed"},
        {"tenant_id": str(TENANT)},
        {"amount": 100},
        {"date": "6 October"},
        {"date": "2026-10-6"},
        {"time": "11"},
        {"time": "24:00"},
        {"time": "9:30"},
        {"party_size": 2},
        {"purpose": "Bridal sarees"},
        {"date": "2026-10-06 "},
        {"date": "20261006"},
        {"time": "11:00:00"},
        {"lead_id": "not-a-uuid"},
    ],
)
def test_the_arguments_are_closed(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        args(**bad)


def test_it_is_an_action_tool_and_the_only_way_it_acts_is_to_book() -> None:
    tool = next(t for t in ACTION_TOOLS if t.name == "propose_visit")
    assert tool.action is True and tool.handler is propose_visit
    assert "confirm" in tool.description.lower()
    for forbidden in ("send", "confirm", "approve", "cancel", "complete", "order"):
        assert forbidden not in tool.name
