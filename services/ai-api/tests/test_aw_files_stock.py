"""The assistant does the work, A2b part 4: an order in the chat (a purchase order, a list of items with quantities) -> what is short against the catalogue, read-only (owner, 5 Nov 2026: "order PDF ->
order + shortage"). Code finds the order's table, matches each line to a catalogue item by its name and says what the catalogue says about its stock (a WORD: the catalogue keeps no counts, so the
answer claims none). The order itself is not made: an order starts from an approved quote, and the assistant says so."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.assistant_work.extract import grids_of_text
from app.assistant_work.stock import check, order_lines
from app.assistant_work.understand import understand
from tests.catalogue_fakes import item_row
from tests.fakes import auth
from tests.test_aw_files import BASE, cards_of, events, text_of
from tests.test_aw_files_prices import CREPE, GREEN, RED
from tests.test_aw_files_prices import world as prices_world
from tests.test_aw_files_read import fid

ORDER = "PURCHASE ORDER\nPO No: 2231   Date: 02/11/2026\nItem               Qty      Rate\nKanjivaram red     10       12000\nSoft silk green    15       6500\nBanarasi blue      4        9000\n"
STOCK = {"decision": "do", "actions": [{"action": "check_stock"}], "cant": "order_from_file"}


def world(*answers: Any) -> tuple[Any, Any, Any]:
    client, llm, cat = prices_world(*answers, text=ORDER)
    cat.items[RED]["stock_status"] = "in_stock"
    cat.items[GREEN]["stock_status"] = "few_left"
    cat.items[CREPE]["stock_status"] = "made_to_order"
    return client, llm, cat


def ask(client: Any, text: str, language: str = "en") -> list[tuple[str, dict[str, Any]]]:
    f = fid(client, "po 2231.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf")
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "attachment_ids": [f], "language": language}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth("a_owner")))


def test_the_order_lines_are_read_by_code() -> None:
    u = understand("po.pdf", "file", ORDER, grids_of_text(ORDER))
    assert u.kind == "order" and [(x.name, x.qty) for x in order_lines(u)] == [("Kanjivaram red", 10), ("Soft silk green", 15), ("Banarasi blue", 4)]


def test_each_line_gets_the_catalogues_stock_word_and_nothing_more() -> None:
    lines = order_lines(understand("po.pdf", "file", ORDER, grids_of_text(ORDER)))
    items = [item_row(RED, name="Kanjivaram Red", stock_status="in_stock"), item_row(GREEN, name="Soft silk green", stock_status="few_left")]
    answer, short = check(lines, items, "po.pdf", "en")
    assert short == 2
    assert "• Kanjivaram red × 10: in stock" in answer and "• Soft silk green × 15: few left: check before you promise" in answer and "• Banarasi blue × 4: not in your catalogue" in answer
    assert "2 of them may be short." in answer


def test_in_the_chat_the_stock_is_answered_read_only_and_the_order_is_said_plainly() -> None:
    client, llm, cat = world(STOCK)
    before = {k: dict(v) for k, v in cat.items.items()}
    evs = ask(client, "make this order and tell me what is short")
    said = text_of(evs)
    assert cards_of(evs) == [] and "may be short" in said and "the order itself: an order starts from an approved quote" in said
    assert {k: dict(v) for k, v in cat.items.items()} == before, "read-only: nothing changed"


def test_telugu() -> None:
    client, _, _ = world(STOCK)
    said = text_of(ask(client, "ఈ ఆర్డర్ చేసి స్టాక్ చూడండి", language="te"))
    assert "కొన్నే ఉన్నాయి" in said and "ఆమోదించిన కొటేషన్" in said


def test_a_file_with_no_order_table_is_not_a_stock_check() -> None:
    client, _, _ = prices_world(STOCK, text="Please send your catalogue and the delivery terms. We are a shop in Guntur and we sell sarees. " * 2)
    evs = ask(client, "check stock for this")
    assert "What shall I do with it?" in text_of(evs)
