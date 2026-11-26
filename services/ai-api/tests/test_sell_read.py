# ruff: noqa: E501
"""The reading call of "What you sell" (28 Nov 2026): a sheet, a printed page or the owner's words become DRAFTS (nothing saved); a price is the digits the file holds, never guessed; the closed notes the web has sentences for."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.assistant_work.extract import FileReader
from app.jobs import sell_read
from app.jobs.wiring import JobsRuntime
from app.lead_sources.service import LeadSourcesService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import FakeTasksRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.test_aw_files import MATCHER
from tests.test_aw_files_read import FakeLocal, fid

URL = f"/v1/tenants/{TENANT_A.id}/what-you-sell"
PRINTED = "Item               Rate        Stock\nKanjivaram red     12,000      4\nSoft silk green    6500        9\nMysore crepe       Rs. 4,800   12\nNew design 7       call us     2\n"


def test_a_price_is_the_digits_the_file_holds_in_whole_paise_and_anything_else_is_not_a_price() -> None:
    for cell, paise in (("12,000", 1_200_000), ("₹1,250", 125_000), ("Rs. 4,800", 480_000), ("899.50", 89_950), ("1250/-", 125_000)):
        assert sell_read.paise_of(cell) == paise, cell
    for cell in ("call us", "", "1200-1500", "from 500", "0", "12 pieces", "99999999999"):
        assert sell_read.paise_of(cell) is None, cell


def test_a_pricelist_draft_has_the_rate_at_the_smallest_order_and_says_what_it_could_not_read() -> None:
    table = [["Item", "Rate", "MOQ", "Unit"], ["Cotton saree", "900", "10", "piece"], ["Silk saree", "call us", "", "pcs"], ["Dupatta", "250", "", ""]]
    got = sell_read.drafts_from_table("pricelist", table)
    assert got.drafts[0] == {"name": "Cotton saree", "moq": 10, "unit": "piece", "rates": [{"from_qty": 10, "rate_paise": 90_000}], "good_until": None}
    assert got.drafts[1]["rates"] == [{"from_qty": 1, "rate_paise": None}] and "unit" in got.drafts[1]
    assert "unit" not in got.drafts[2] and got.drafts[2]["rates"][0]["rate_paise"] == 25_000
    assert {"code": "price_missing", "row": 2} in got.notes and {"code": "unit_missing", "row": 3} in got.notes and got.unclear is False


def test_each_style_has_its_own_amount_field_and_more_than_twenty_rows_are_cut_with_a_note() -> None:
    table = [["Name", "Fee"], *[[f"Row {i}", "100"] for i in range(25)]]
    got = sell_read.drafts_from_table("courses", table)
    assert len(got.drafts) == 20 and got.drafts[0] == {"name": "Row 0", "fee_paise": 10_000} and {"code": "too_many"} in got.notes
    assert sell_read.drafts_from_table("services", [["Service", "Price"], ["Haircut", "300"]]).drafts == [{"name": "Haircut", "price_paise": 30_000}]
    assert sell_read.drafts_from_table("properties", [["Property", "Price"], ["Plot 4", "2500000"]]).drafts == [{"name": "Plot 4", "price_paise": 250_000_000}]


def test_a_table_with_no_price_column_or_no_rows_is_unclear_not_invented() -> None:
    for table in ([["Colour", "Size"], ["red", "M"]], [["Item", "Price"]], []):
        got = sell_read.drafts_from_table("services", table)
        assert got.drafts == [] and got.unclear is True and got.notes == [{"code": "unreadable"}]


def test_the_owners_words_one_item_a_line() -> None:
    table = sell_read.table_from_text("Fall and pico 150\nBlouse stitching: Rs 600/-\nsome other sentence that has no price")
    assert table == [["Item", "Price"], ["Fall and pico", "150"], ["Blouse stitching", "600"]]
    assert sell_read.table_from_text("hello there\nhow are you") == []


class World:
    def __init__(self, text: str = PRINTED) -> None:
        tasks = TasksService(FakeTasksRepository(school=False), FakeDialer(), FixedKnowledge([]))
        self.client, _ = make_client(jobs=JobsRuntime(), tasks=tasks, lead_sources=LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), matcher=MATCHER), assistant_work=FakeWorkStore(),  # type: ignore[arg-type]
                                     assistant_file_reader=FileReader(FakeLocal(text_layer=text)))

    def read(self, style: str, body: dict[str, Any], user: str = "a_owner") -> Any:
        return self.client.post(f"{URL}/{style}/read", json=body, headers=auth(user))


@pytest.fixture
def w() -> World:
    return World()


def test_a_csv_sheet_becomes_pricelist_drafts_and_nothing_is_saved(w: World) -> None:
    csv = b"Item,Rate,MOQ\nCotton saree,900,10\nSilk saree,4200,1\n"
    f = fid(w.client, "rates.csv", csv, "text/csv")
    r = w.read("pricelist", {"kind": "sheet", "file_id": f, "language": "en"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["style"] == "pricelist" and body["unclear"] is False and body["notes"] == [{"code": "unit_missing", "row": 1}]
    assert [d["name"] for d in body["drafts"]] == ["Cotton saree", "Silk saree"] and body["drafts"][1]["rates"] == [{"from_qty": 1, "rate_paise": 420_000}]


def test_a_printed_page_is_read_by_the_assistants_reader_and_an_unreadable_price_is_a_note(w: World) -> None:
    f = fid(w.client, "rates.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf")
    r = w.read("services", {"kind": "photo", "file_id": f, "language": "te"})
    body = r.json()
    assert r.status_code == 200 and [d["name"] for d in body["drafts"]][:3] == ["Kanjivaram red", "Soft silk green", "Mysore crepe"]
    assert body["drafts"][0]["price_paise"] == 1_200_000 and {"code": "price_missing", "row": 4} in body["notes"]


def test_the_owners_words_and_the_refusals(w: World) -> None:
    r = w.read("services", {"kind": "talk", "text": "Fall and pico 150\nBlouse stitching 600", "language": "en"})
    assert r.status_code == 200 and [d["price_paise"] for d in r.json()["drafts"]] == [15_000, 60_000]
    assert w.read("services", {"kind": "talk", "text": "  "}).status_code == 422
    assert w.read("services", {"kind": "sheet"}).status_code == 422
    assert w.read("products", {"kind": "talk", "text": "x 1"}).status_code == 422, "products have their own reading (a photo or a PDF by file_id: tests/test_products_read.py); the sheet, photo and talk body is not theirs"
    assert w.read("services", {"kind": "sheet", "file_id": str(uuid.uuid4())}).status_code == 404
    assert w.read("services", {"kind": "talk", "text": "Haircut 300"}, "a_sales").status_code == 403
    assert w.read("services", {"kind": "talk", "text": "Haircut 300", "extra": 1}).status_code == 422


def test_a_long_hostile_line_is_read_in_linear_time_and_is_not_a_price_line() -> None:
    import time

    hostile = "a " * 90 + "1" * 5000
    started = time.perf_counter()
    assert sell_read.table_from_text(hostile + "\n" + hostile) == []
    assert time.perf_counter() - started < 0.5
    assert sell_read.table_from_text("Haircut Rs 300\nFacial 800/-") == [["Item", "Price"], ["Haircut", "300"], ["Facial", "800"]]
