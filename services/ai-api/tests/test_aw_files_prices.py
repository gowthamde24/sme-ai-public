"""The assistant does the work, A2b part 2: a price list in the chat -> the catalogue's prices, old -> new on the card BEFORE anything changes (owner, 5 Nov 2026). Code finds the price table, parses
each price as written and matches each row to a catalogue item by its name (no guessing: a name that is not in the catalogue is counted and left out). It is MONEY: the plan is the Owner's, needs the
card's second tap and the sign-in's second factor (the catalogue route asks for it). Undo puts every item back as it was. The model never writes a price."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant_work.extract import FileReader
from app.assistant_work.prices import match, norm, paise_of, price_rows, rupees
from app.assistant_work.understand import understand
from app.lead_sources.service import LeadSourcesService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.catalogue_fakes import FakeCatalogue, FakeStorage, item_row
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import FakeTasksRepository
from tests.ea_fakes import FakeTurnDb
from tests.fakes import auth, make_client
from tests.test_aw_files import BASE, MATCHER, cards_of, events, text_of
from tests.test_aw_files_read import FakeLocal, Sees, fid

PRICES = "Item               Rate        Stock\nKanjivaram red     12,000      4\nSoft silk green    6500        9\nMysore crepe       Rs. 4,800   12\nNew design 7       9,900       2\n"
RED, GREEN, CREPE = (str(uuid.uuid4()) for _ in range(3))
UPDATE = {"decision": "do", "actions": [{"action": "update_prices"}]}


def world(*answers: Any, text: str = PRICES) -> tuple[Any, Sees, FakeCatalogue]:
    llm = Sees(*answers)
    db = FakeTurnDb()
    cat = FakeCatalogue()
    cat.items[RED] = item_row(RED, name="Kanjivaram Red", price_paise=None)
    cat.items[GREEN] = item_row(GREEN, name="Soft Silk Green", price_paise=650_000)
    cat.items[CREPE] = item_row(CREPE, name="Mysore  Crepe", price_paise=420_000)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(school=False), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, lead_sources=LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), matcher=MATCHER), assistant_work=FakeWorkStore(),  # type: ignore[arg-type]
                            catalogue=cat, catalogue_storage=FakeStorage(), assistant_file_reader=FileReader(FakeLocal(text_layer=text)))
    return client, llm, cat


def ask(client: Any, text: str, user: str = "a_owner", language: str = "en") -> list[tuple[str, dict[str, Any]]]:
    f = fid(client, "rates nov.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf") if user == "a_owner" else None
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "attachment_ids": [f], "language": language}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth(user)))


def decide(client: Any, plan_id: str, *, confirmed: bool, user: str = "a_owner", **claims: Any) -> Any:
    return client.post(f"{BASE}/plans/{plan_id}/decide", json={"decision": "do", "confirmed": confirmed}, headers=auth(user, **claims))


# ============================================================================ by code
@pytest.mark.parametrize(("cell", "paise"), [("12,000", 1_200_000), ("6500", 650_000), ("Rs. 4,800", 480_000), ("₹4,800.50", 480_050), ("1,20,000", 12_000_000), ("1200/-", 120_000),
                                              ("12k", None), ("1000-1200", None), ("call us", None), ("0", None), ("", None)])
def test_a_price_is_parsed_only_as_written(cell: str, paise: int | None) -> None:
    assert paise_of(cell) == paise


def test_rupees_are_shown_the_indian_way_and_names_match_without_guessing() -> None:
    assert rupees(1_200_000) == "₹12,000" and rupees(12_000_000) == "₹1,20,000" and rupees(480_050) == "₹4,800.50" and rupees(None) == "—"
    assert norm("Mysore  Crepe!") == norm("mysore crepe") and norm("Mysore crepe 2") != norm("Mysore crepe")


def test_the_price_table_is_matched_to_the_catalogue_by_name() -> None:
    from app.assistant_work.extract import grids_of_text

    u = understand("rates.pdf", "file", PRICES, grids_of_text(PRICES))
    rows = price_rows(u)
    assert [(r.name, r.paise) for r in rows] == [("Kanjivaram red", 1_200_000), ("Soft silk green", 650_000), ("Mysore crepe", 480_000), ("New design 7", 990_000)]
    items = [item_row(RED, name="Kanjivaram Red"), item_row(GREEN, name="Soft Silk Green", price_paise=650_000), item_row(CREPE, name="Mysore Crepe", price_paise=420_000)]
    changes, unchanged, missing = match(rows, items)
    assert [(c.item["id"], c.old, c.new) for c in changes] == [(RED, None, 1_200_000), (CREPE, 420_000, 480_000)] and unchanged == 1 and missing == 1


# ============================================================================ in the chat
def test_the_card_shows_every_old_and_new_price_and_nothing_changes_before_the_ok() -> None:
    client, llm, cat = world(UPDATE)
    evs = ask(client, "update my catalogue prices from this")
    card = cards_of(evs)[0]
    assert card["kind"] == "file_preview" and card["destination"] == "catalogue" and card["columns"] == ["Item", "Now", "New"]
    assert card["rows"] == [["Kanjivaram Red", "—", "₹12,000"], ["Mysore  Crepe", "₹4,200", "₹4,800"]]
    assert {f["code"]: f["n"] for f in card["facts"]} == {"found": 4, "changed": 2, "unchanged": 1, "not_in_catalogue": 1}
    plan = card["plan"]
    assert plan["sensitive"] == "money" and plan["owner_only"] is True and plan["needs_second_factor"] is True
    assert [s["summary"] for s in plan["steps"]] == ["Kanjivaram Red: — → ₹12,000", "Mysore  Crepe: ₹4,200 → ₹4,800"]
    assert "2 different from your catalogue" in text_of(evs) and "Only the Owner" in text_of(evs)
    assert cat.items[RED]["price_paise"] is None and cat.items[CREPE]["price_paise"] == 420_000, "nothing changed before the OK"
    assert "12000" not in str(llm.requests[0].tools) and all("price_paise" not in str(b.text) for b in llm.requests[0].blocks), "the model never writes or sees a price field"


def test_the_owner_with_the_second_factor_and_the_second_tap_changes_them_and_undo_puts_them_back() -> None:
    client, _, cat = world(UPDATE)
    plan_id = cards_of(ask(client, "update prices"))[0]["plan"]["plan_id"]
    assert decide(client, plan_id, confirmed=False).json()["error"]["code"] == "confirm_needed"
    done = decide(client, plan_id, confirmed=True)
    assert done.status_code == 200 and done.json()["status"] == "done", done.text
    assert cat.items[RED]["price_paise"] == 1_200_000 and cat.items[CREPE]["price_paise"] == 480_000 and cat.items[GREEN]["price_paise"] == 650_000
    assert cat.items[CREPE]["name"] == "Mysore  Crepe" and cat.items[CREPE]["fabric"] == "kanchi_pattu", "only the price changes"
    undone = client.post(f"{BASE}/plans/{plan_id}/undo", headers=auth("a_owner"))
    assert undone.status_code == 200 and undone.json()["status"] == "undone", undone.text
    assert cat.items[RED]["price_paise"] is None and cat.items[CREPE]["price_paise"] == 420_000, "every item back as it was"


def test_without_the_second_factor_the_database_refuses_and_no_price_changes() -> None:
    client, _, cat = world(UPDATE)
    plan_id = cards_of(ask(client, "update prices"))[0]["plan"]["plan_id"]
    from app.tenancy.repository import MfaRequired

    def refuse(token: str, args: dict[str, Any]) -> dict[str, Any]:   # the database refuses a price change without the second factor (SM306)
        raise MfaRequired("SM306")

    cat.save_item = refuse  # type: ignore[method-assign]
    done = decide(client, plan_id, confirmed=True, aal="aal1").json()
    assert done["status"] == "failed" and done["steps"][0]["error"] == "forbidden" and done["steps"][1]["status"] == "skipped"
    assert cat.items[RED]["price_paise"] is None and cat.items[CREPE]["price_paise"] == 420_000


def test_an_admin_cannot_run_a_price_plan() -> None:
    client, _, cat = world(UPDATE)
    plan_id = cards_of(ask(client, "update prices"))[0]["plan"]["plan_id"]
    assert decide(client, plan_id, confirmed=True, user="a_admin").status_code in (403, 404)
    assert cat.items[CREPE]["price_paise"] == 420_000


def test_the_same_prices_change_nothing() -> None:
    same = "Item               Rate\nSoft silk green    6500\nUnknown saree      1000\n"
    client, _, _ = world(UPDATE, text=same)
    evs = ask(client, "update prices")
    card = cards_of(evs)[0]
    assert card["plan"] is None and "none is different" in text_of(evs) and {f["code"]: f["n"] for f in card["facts"]}["not_in_catalogue"] == 1


def test_a_file_with_no_price_table_is_not_a_price_plan() -> None:
    client, _, cat = world(UPDATE, text="We are open every day from 10 am to 8 pm and deliver across Andhra Pradesh. " * 3)
    evs = ask(client, "update prices from this")
    assert cards_of(evs) == [] and "What shall I do with it?" in text_of(evs)


def test_telugu() -> None:
    client, _, _ = world(UPDATE)
    evs = ask(client, "ఈ ధరలను కేటలాగ్‌లో మార్చండి", language="te")
    assert "కేటలాగ్‌కు భిన్నంగా" in text_of(evs) and cards_of(evs)[0]["plan"]["sensitive"] == "money"
