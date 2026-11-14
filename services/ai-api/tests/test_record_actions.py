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
LEADS: list[dict[str, Any]] = [
    {"id": "11111111-1111-4111-8111-000000000001", "contact_id": "22222222-2222-4222-8222-000000000001", "display_name": "Kalyani Gowda", "status": "new"},
    {"id": "11111111-1111-4111-8111-000000000002", "contact_id": "22222222-2222-4222-8222-000000000002", "display_name": "Kalyani Shetty", "status": "new"},
    {"id": "11111111-1111-4111-8111-000000000003", "contact_id": "22222222-2222-4222-8222-000000000003", "display_name": "యశ్వంత్ రెడ్డి", "status": "qualified"},
    {"id": "11111111-1111-4111-8111-000000000004", "contact_id": "22222222-2222-4222-8222-000000000004", "display_name": "Anita Devi", "status": "new", "profile": {"notes": "asked for a discount", "city": "Guntur"}},
]
VISITS = [{"id": "33333333-3333-4333-8333-000000000001", "lead_id": LEADS[3]["id"], "date": "2026-11-16", "starts_at": "2026-11-16T04:30:00Z"}]
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


def test_a_stored_utc_time_is_shown_and_undone_as_the_indian_clock_time() -> None:
    assert ra.local_hhmm("2026-11-21T04:30:00Z") == "10:00" and ra.local_hhmm("2026-11-21T10:30:00+05:30") == "10:30" and ra.local_hhmm("x") == ""


def test_a_name_in_telugu_or_english_finds_the_same_person_and_a_tie_is_not_a_guess() -> None:
    top, clear = ra.rank("Yashwanth Reddy", LEADS, "display_name")
    assert clear and top[0]["display_name"] == "యశ్వంత్ రెడ్డి"
    top, clear = ra.rank("Kalyani", LEADS, "display_name")
    assert not clear and {r["display_name"] for r in top} == {"Kalyani Gowda", "Kalyani Shetty"}
    assert ra.rank("Nobody", LEADS, "display_name") == ([], False)


# ============================================================================ acted at once, with Undo
CALLS: list[FakeTools] = []


def acted(action: str, **args: Any) -> tuple[str, dict[str, Any] | None, list[executor.Call]]:
    rt, tools = turn()
    STORES.append(rt.store)   # type: ignore[arg-type]
    sentence, card = rt.answer(TOKEN, uuid.uuid4(), SimpleRouted(action, args), message_id=uuid.uuid4(), conversation_id=None, language="en")   # type: ignore[arg-type]
    return sentence, card, [c for c in tools.calls if c.tool not in ("leads.list_leads", "visits.list_visits", "campaigns.list_campaigns", "catalogue.list_items", "catalogue.get_item")]


def done_steps(card: dict[str, Any] | None) -> list[dict[str, Any]]:
    assert card is not None and card["plan"]["status"] == "done", card
    return list(card["plan"]["steps"])


def test_a_clear_instruction_is_done_at_once_with_its_undo() -> None:
    sentence, card, writes = acted("lead_status", target="Anita", status="qualified")
    assert sentence.startswith("Done: Anita Devi: status new -> qualified") and [c.tool for c in writes] == ["leads.update_leads"] and writes[0].body == {"status": "qualified"} and writes[0].path == {"row_id": LEADS[3]["id"]}
    assert done_steps(card)[0]["undoable"] is True and raw(card)["call"]["undo"] == {"tool": "leads.update_leads", "path": {"row_id": LEADS[3]["id"]}, "body": {"status": "new"}}
    _, consent, writes = acted("consent_record", target="Anita", channel="whatsapp")
    assert writes[0].tool == "contacts.record_consent" and writes[0].path == {"row_id": LEADS[3]["contact_id"]} and (writes[0].body or {})["evidence_type"] == "verbal" and done_steps(consent)[0]["undoable"] is True
    _, stop, writes = acted("stop_messaging", target="Anita")
    assert writes[0].tool == "contacts.suppress" and (writes[0].body or {})["reason"] == "opted_out" and stop is not None and stop["plan"]["status"] == "done" and stop["plan"]["sensitive"] is None, "always immediate, no confirmation"
    assert raw(stop)["call"]["undo"]["tool"] == "contacts.lift_suppression"
    _, archive, writes = acted("lead_archive", target="Anita")
    assert writes[0].tool == "leads.archive_leads" and done_steps(archive)[0]["undoable"] is True


def test_a_leads_name_and_fields_are_edited_in_one_step_each_with_the_old_value_as_undo() -> None:
    _, card, writes = acted("lead_edit", target="Anita", fields={"name": "Anita Reddy", "city": "Guntur", "interest": "20 sarees"})
    assert [c.tool for c in writes] == ["contacts.update_contacts", "leads.fix_profile"]
    assert writes[0].body == {"full_name": "Anita Reddy"} and writes[1].body == {"city": "Guntur", "need": "20 sarees"} and writes[1].path == {"lead_id": LEADS[3]["id"]}
    assert raw(card)["call"]["undo"]["body"] == {"full_name": "Anita Devi"} and len(done_steps(card)) == 2


def test_the_telugu_name_is_found_and_two_matches_become_buttons() -> None:
    _, card, writes = acted("lead_status", target="Yashwanth Reddy", status="new")
    assert done_steps(card)[0]["summary"] == "యశ్వంత్ రెడ్డి: status qualified -> new" and writes[0].path == {"row_id": LEADS[2]["id"]}
    sentence, choose, writes = acted("lead_status", target="Kalyani", status="qualified")
    assert choose is not None and choose["kind"] == "choose" and [o["value"] for o in choose["options"]] == ["Kalyani Gowda", "Kalyani Shetty"] and sentence.startswith("Which Kalyani?") and writes == []
    sentence, none, writes = acted("lead_status", target="Zzz", status="new")
    assert none is None and "could not find" in sentence and writes == []


def test_visits_are_booked_moved_and_cancelled_at_once_and_each_has_an_undo() -> None:
    _, book, writes = acted("visit_book", target="Anita", date="2026-11-21", time="11:00")
    body = writes[0].body or {}
    assert writes[0].tool == "visits.book_visit" and body["lead_id"] == LEADS[3]["id"] and body["slot_start"] == "11:00" and body["date"] == "2026-11-21" and body["party_size"] == 1
    assert raw(book)["call"]["undo"] == {"tool": "visits.cancel_visit", "path": {"visit_id": body["visit_id"]}, "body": {}}
    _, move, writes = acted("visit_move", target="Anita", date="2026-11-22", time="16:00")
    assert writes[0].tool == "visits.change_visit" and writes[0].path == {"visit_id": VISITS[0]["id"]} and writes[0].body == {"date": "2026-11-22", "slot_start": "16:00"}
    assert raw(move)["call"]["undo"]["body"] == {"date": "2026-11-16", "slot_start": "10:00"}
    _, cancel, writes = acted("visit_cancel", target="Anita")
    assert writes[0].tool == "visits.cancel_visit" and raw(cancel)["call"]["undo"]["tool"] == "visits.book_visit" and raw(cancel)["call"]["undo"]["body"]["date"] == "2026-11-16"
    sentence, none, writes = acted("visit_cancel", target="Yashwanth")
    assert none is None and "no open visit" in sentence and writes == []


def test_money_and_sending_to_many_are_one_card_and_one_tap() -> None:
    _, price, writes = acted("price_set", target="Cream soft silk", price=8200)
    plan = plan_of(price)
    assert writes == [] and plan["status"] == "proposed" and plan["sensitive"] is None and plan["needs_second_factor"] is False and plan["owner_only"] is True, "ONE tap: no second tap, no second factor"
    assert raw(price)["call"]["body"]["price_paise"] == 820000 and "7,800" in plan["steps"][0]["summary"] and "8,200" in plan["steps"][0]["summary"]
    _, pause, writes = acted("campaign_pause", target="Diwali")
    assert writes[0].tool == "campaigns.pause" and plan_of(pause)["status"] == "done"
    _, approve, writes = acted("campaign_approve", target="Diwali offer")
    assert writes == [] and plan_of(approve)["status"] == "proposed" and plan_of(approve)["sensitive"] is None and plan_of(approve)["owner_only"] is True
    CAMPAIGNS[0]["recipients"] = "200"
    try:
        _, big, _ = acted("campaign_resume", target="Diwali offer")
    finally:
        del CAMPAIGNS[0]["recipients"]
    assert plan_of(big)["sensitive"] == "sending", "more than 50 people: the second tap, as for calls"



def test_a_note_is_added_to_what_is_there_and_the_old_text_is_the_undo() -> None:
    _, card, writes = acted("lead_edit", target="Anita", fields={"notes": "wants 20 sarees by Diwali"})
    assert [c.tool for c in writes] == ["leads.fix_profile"] and writes[0].body == {"notes": "asked for a discount\nwants 20 sarees by Diwali"}
    assert raw(card)["call"]["undo"]["body"] == {"notes": "asked for a discount"}
    assert not isinstance(ra.check("lead_edit", {"target": "Anita", "fields": {"notes": "wants 20 sarees"}}, "note that Anita wants 20 sarees", TODAY), str)
    assert ra.check("lead_edit", {"target": "Anita", "fields": {"notes": "wants 40 sarees"}}, "note that Anita wants 20 sarees", TODAY) == "notes", "a note is the owner's own words"
