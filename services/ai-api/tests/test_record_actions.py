"""Actions on one named record (owner, 14 Nov 2026): a visit, a campaign, a catalogue price, consent, stop messaging, a lead's status, archive. The record is FOUND through the screen's own read route
(any spelling or script), never guessed (nobody found or a tie: ONE question, a tie as buttons), every value is checked against the owner's words, and the answer is the usual plan card."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pytest

from app.assistant_tools import executor
from app.assistant_work import record_actions as ra
from app.assistant_work.routed import RouteTurn
from tests.aw_fakes import FakeWorkStore
from tests.fakes import auth

TOKEN = auth("a_owner")["Authorization"].split()[1]
TODAY = date(2026, 11, 14)   # a Saturday
LEADS = [
    {"id": "11111111-1111-4111-8111-000000000001", "contact_id": "22222222-2222-4222-8222-000000000001", "display_name": "Kalyani Gowda", "status": "new"},
    {"id": "11111111-1111-4111-8111-000000000002", "contact_id": "22222222-2222-4222-8222-000000000002", "display_name": "Kalyani Shetty", "status": "new"},
    {"id": "11111111-1111-4111-8111-000000000003", "contact_id": "22222222-2222-4222-8222-000000000003", "display_name": "యశ్వంత్ రెడ్డి", "status": "qualified"},
    {"id": "11111111-1111-4111-8111-000000000004", "contact_id": "22222222-2222-4222-8222-000000000004", "display_name": "Anita Devi", "status": "new"},
]
VISITS = [{"id": "33333333-3333-4333-8333-000000000001", "lead_id": LEADS[3]["id"], "date": "2026-11-16", "starts_at": "2026-11-16T10:00:00+05:30"}]
CAMPAIGNS = [{"id": "44444444-4444-4444-8444-000000000001", "name": "Diwali offer", "status": "running"}]
ITEMS = [{"id": "55555555-5555-4555-8555-000000000001", "name": "Cream soft silk", "price_paise": 780000, "fabric": "silk", "colours": ["cream"], "price_band": "mid", "zari": "none", "occasions": [], "stock_status": "in_stock", "active": True, "border": None}]


class FakeTools:
    def __init__(self) -> None:
        self.calls: list[executor.Call] = []

    async def run(self, tenant_id: uuid.UUID, token: str, call: executor.Call, message_id: uuid.UUID | None = None) -> executor.Result:
        self.calls.append(call)
        answers: dict[str, Any] = {"leads.list_leads": {"items": LEADS}, "visits.list_visits": {"items": VISITS}, "campaigns.list_campaigns": {"items": CAMPAIGNS},
                                   "catalogue.list_items": {"items": ITEMS}, "catalogue.get_item": ITEMS[0]}
        if call.tool == "visits.list_visits" and call.query.get("lead_id") != LEADS[3]["id"]:
            return executor.Result(True, 200, None, {"items": []}, None)
        return executor.Result(True, 200, None, answers.get(call.tool, {}), None)


def turn() -> tuple[RouteTurn, FakeTools]:
    tools = FakeTools()
    return RouteTurn(FakeWorkStore(), tools, None), tools   # type: ignore[arg-type]


STORES: list[FakeWorkStore] = []


def say(action: str, **args: Any) -> tuple[str, dict[str, Any] | None]:
    rt, _ = turn()
    STORES.append(rt.store)   # type: ignore[arg-type]
    return rt.answer(TOKEN, uuid.uuid4(), SimpleRouted(action, args), message_id=uuid.uuid4(), conversation_id=None, language="en")   # type: ignore[arg-type]


def plan_of(card: dict[str, Any] | None) -> dict[str, Any]:
    assert card is not None
    return dict(card["plan"])


def raw(card: dict[str, Any] | None) -> dict[str, Any]:
    """The stored first step of a plan card (the public card hides how a step is called)."""
    assert card is not None
    return dict(STORES[-1].plans[card["plan"]["plan_id"]]["steps"][0])


class SimpleRouted:  # a routed request as the router checked it
    decision = "do"
    question = ""
    screen = ""

    def __init__(self, record_action: str, args: dict[str, Any]) -> None:
        self.action = "record"
        self.args = {"record_action": record_action, **args}


def steps(card: dict[str, Any] | None) -> list[dict[str, Any]]:
    assert card is not None and card["kind"] == "plan", card
    return list(card["plan"]["steps"])


# ============================================================================ by code
@pytest.mark.parametrize(("action", "args", "text", "ok"), [
    ("visit_book", {"target": "Kalyani", "date": "2026-11-21", "time": "11:00"}, "Book Kalyani for a visit on Saturday at 11", True),
    ("visit_book", {"target": "Kalyani", "date": "2026-11-15", "time": "16:00"}, "book Kalyani tomorrow at 4 pm", True),
    ("visit_book", {"target": "Kalyani", "date": "2026-11-20", "time": "11:00"}, "book Kalyani on Saturday at 11", False),   # 20 Nov is a Friday
    ("visit_book", {"target": "Kalyani", "date": "2026-11-21", "time": "11:30"}, "book Kalyani on Saturday at 11", False),   # 11:30 was not said
    ("visit_book", {"target": "Kalyani", "date": "2026-11-18", "time": "10:00"}, "book Kalyani on 18 November at 10", True),
    ("visit_book", {"target": "Kalyani", "date": "2026-11-13", "time": "10:00"}, "book Kalyani yesterday at 10", False),
    ("visit_move", {"target": "Anita", "date": "2026-11-22", "time": "16:00"}, "Move Anita's visit to Sunday 4 pm", True),
    ("visit_move", {"target": "Anita", "date": "2026-11-15", "time": "16:00"}, "మార్చు Anita రేపు 4 గంటలకు", True),
    ("price_set", {"target": "Cream soft silk", "price": 8200}, "Set the price of Cream soft silk to 8,200", True),
    ("price_set", {"target": "Cream soft silk", "price": 9000}, "Set the price of Cream soft silk to 8,200", False),
    ("price_set", {"target": "Silk", "price": 8200}, "Set the price of Cream soft silk to 8,200", True),
    ("lead_status", {"target": "Anita", "status": "qualified"}, "Mark Anita as qualified", True),
    ("lead_status", {"target": "Anita", "status": "won"}, "Mark Anita as won", False),
    ("consent_record", {"target": "Anita", "channel": "whatsapp"}, "Anita agreed to get WhatsApp messages", True),
    ("consent_record", {"target": "Anita", "channel": "email"}, "Anita agreed to get email", False),
    ("stop_messaging", {"target": "Anita"}, "Stop messaging Anita", True),
    ("stop_messaging", {"target": "Ravi"}, "Stop messaging Anita", False),   # a name that is not in the words
    ("nothing", {"target": "Anita"}, "x Anita", False),
])
def test_every_value_is_checked_against_the_owners_words(action: str, args: dict[str, Any], text: str, ok: bool) -> None:
    assert (not isinstance(ra.check(action, args, text, TODAY), str)) is ok


def test_a_name_in_telugu_or_english_finds_the_same_person_and_a_tie_is_not_a_guess() -> None:
    top, clear = ra.rank("Yashwanth Reddy", LEADS, "display_name")
    assert clear and top[0]["display_name"] == "యశ్వంత్ రెడ్డి"
    top, clear = ra.rank("Kalyani", LEADS, "display_name")
    assert not clear and {r["display_name"] for r in top} == {"Kalyani Gowda", "Kalyani Shetty"}
    assert ra.rank("Nobody", LEADS, "display_name") == ([], False)


# ============================================================================ the plan cards
def test_a_lead_status_a_consent_and_a_stop_are_found_by_name_and_shown_as_plans() -> None:
    sentence, card = say("lead_status", target="Anita", status="qualified")
    step = steps(card)[0]
    assert step["tool"] == "leads.update_leads" and step["summary"] == "Anita Devi: status new -> qualified" and raw(card)["call"]["path"] == {"row_id": LEADS[3]["id"]} and raw(card)["call"]["body"] == {"status": "qualified"}
    _, consent = say("consent_record", target="Anita", channel="whatsapp")
    assert steps(consent)[0]["tool"] == "contacts.record_consent" and raw(consent)["call"]["path"] == {"row_id": LEADS[3]["contact_id"]} and raw(consent)["call"]["body"]["evidence_type"] == "verbal"
    _, stop = say("stop_messaging", target="Anita")
    assert steps(stop)[0]["tool"] == "contacts.suppress" and plan_of(stop)["sensitive"] == "sending" and plan_of(stop)["owner_only"] is True


def test_a_telugu_name_finds_the_person_and_two_matches_become_buttons() -> None:
    _, card = say("lead_status", target="Yashwanth Reddy", status="new")
    assert steps(card)[0]["summary"] == "యశ్వంత్ రెడ్డి: status qualified -> new"
    sentence, choose = say("lead_status", target="Kalyani", status="qualified")
    assert choose is not None and choose["kind"] == "choose" and [o["value"] for o in choose["options"]] == ["Kalyani Gowda", "Kalyani Shetty"] and sentence.startswith("Which Kalyani?")
    sentence, none = say("lead_status", target="Zzz", status="new")
    assert none is None and "could not find" in sentence


def test_visits_are_booked_moved_and_cancelled_through_the_visits_routes() -> None:
    _, book = say("visit_book", target="Anita", date="2026-11-21", time="11:00")
    body = raw(book)["call"]["body"]
    assert steps(book)[0]["tool"] == "visits.book_visit" and body["lead_id"] == LEADS[3]["id"] and body["slot_start"] == "11:00" and body["date"] == "2026-11-21" and body["visit_id"]
    _, move = say("visit_move", target="Anita", date="2026-11-22", time="16:00")
    assert steps(move)[0]["tool"] == "visits.change_visit" and raw(move)["call"]["path"] == {"visit_id": VISITS[0]["id"]} and "2026-11-16 -> 2026-11-22" in steps(move)[0]["summary"]
    _, cancel = say("visit_cancel", target="Anita")
    assert steps(cancel)[0]["tool"] == "visits.cancel_visit" and plan_of(cancel)["sensitive"] == "sending"
    sentence, none = say("visit_cancel", target="Yashwanth")
    assert none is None and "no open visit" in sentence


def test_campaigns_and_a_catalogue_price_are_plans_with_the_right_level() -> None:
    _, pause = say("campaign_pause", target="Diwali")
    assert steps(pause)[0]["tool"] == "campaigns.pause" and steps(pause)[0]["undoable"] is True and plan_of(pause)["sensitive"] is None
    _, approve = say("campaign_approve", target="Diwali offer")
    assert approve is not None and plan_of(approve)["sensitive"] == "sending"
    _, price = say("price_set", target="Cream soft silk", price=8200)
    step = steps(price)[0]
    assert step["tool"] == "catalogue.put_item" and plan_of(price)["sensitive"] == "money" and plan_of(price)["needs_second_factor"] is True and raw(price)["call"]["body"]["price_paise"] == 820000
    assert "7,800" in step["summary"] and "8,200" in step["summary"], step["summary"]
