"""The assistant does the work, A3: a PDF, a Word file or a photo dropped in the chat goes the SAME way as a sheet (preview card -> Do it -> Undo), after the extraction step (owner decisions 5 Nov 2026):
the file's own text first; local OCR when the text layer is missing; the AI model only if local OCR found no table and no name with a phone; never for a school (its scanned files: "can't read scanned
files yet, please upload Excel/CSV"); only the page images are sent; nothing is invented (a value is a piece of what was read). Against fakes: the real application and its routes, scripted local
readers and model; one test runs the real Tesseract when the machine has it."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import io
import logging
import shutil
import zipfile
from types import SimpleNamespace
from typing import Any

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.assistant_work import extract
from app.assistant_work.extract import FileReader, LocalTools, ReadRefused, grids_of_text, people_of_text, read_docx
from app.lead_sources.service import LeadSourcesService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import FakeTasksRepository, Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import make_client
from tests.test_aw_files import MATCHER, BASE, cards_of, drop, text_of, turn
from tests.fakes import auth

REGISTER = """Visitors register - Sri Lakshmi Silks
1. Ravi Kumar      98765 43210    Hyderabad
2. Anita Reddy     +91 91234 56789   Guntur
3. Suresh          9000012345
"""
CARD = """SRI VENKATESWARA TEXTILES
Prop. K. Ramesh
Wholesale silk sarees
Mob: 98480 12345
Off: 040-2345 6789
ramesh.svt@example.test
12-3-45, Begum Bazar, Hyderabad
"""


class Sees(Scripted):
    supports_attachments = True


class FakeLocal(LocalTools):
    """The local readers, scripted: what the text layer and OCR 'read', and what was asked of them."""

    def __init__(self, *, text_layer: str | None = None, ocr: str = "", pages: int = 1, can: bool = True) -> None:
        super().__init__(tesseract="tesseract" if can else "", pdftotext="pdftotext", pdftoppm="pdftoppm", languages=["eng"])
        self.text_layer, self.ocr_text, self.n_pages = text_layer, ocr, pages
        self.ocr_calls = 0

    def pdf_text(self, data: bytes) -> str | None:
        return self.text_layer

    def pdf_pages(self, data: bytes) -> list[bytes]:
        return [png() for _ in range(self.n_pages)]

    def ocr(self, png_bytes: bytes) -> str:
        self.ocr_calls += 1
        return self.ocr_text


def png(text: str = "", size: tuple[int, int] = (1200, 800)) -> bytes:
    img = Image.new("L", size, 255)
    if text:
        draw = ImageDraw.Draw(img)
        font = ImageFont.load_default(size=44)
        y = 40
        for line in text.splitlines():
            draw.text((40, y), line, fill=0, font=font)
            y += 70
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def docx(table: list[list[str]], paragraphs: list[str] = ()) -> bytes:  # type: ignore[assignment]
    def cell(t: str) -> str:
        return f"<w:tc><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:tc>"

    rows = "".join("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>" for r in table)
    paras = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = f'<?xml version="1.0"?><w:document xmlns:w="w"><w:body>{paras}<w:tbl>{rows}</w:tbl></w:body></w:document>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return out.getvalue()


def world(local: LocalTools | None, *answers: Any, school: bool = False) -> tuple[Any, Scripted, FakeWorkStore, FakeLeadSourcesRepository]:
    llm = Sees(*answers)
    db = FakeTurnDb()
    store = FakeWorkStore()
    repo = FakeLeadSourcesRepository()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(school=school), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, lead_sources=LeadSourcesService(repo, receiver=Receiver(), matcher=MATCHER), assistant_work=store,  # type: ignore[arg-type]
                            assistant_file_reader=FileReader(local))
    return client, llm, store, repo


def fid(client: Any, name: str, data: bytes, content_type: str) -> str:
    r = drop(client, name, data, content_type=content_type)
    assert r.status_code == 201, r.text
    return str(r.json()["file_id"])


def preview(evs: list[Any]) -> dict[str, Any]:
    cards = cards_of(evs)
    assert cards and cards[0]["kind"] == "file_preview", (text_of(evs), cards)
    return cards[0]


# ============================================================================ reading, by code
def test_a_word_table_is_read_as_rows_and_its_paragraphs_as_text() -> None:
    text, grids = read_docx(docx([["Name", "Phone", "City"], ["Ravi Kumar", "98765 43210", "Hyderabad"], ["Anita &amp; Co", "91234 56789", "Guntur"]], ["Our March fair visitors"]))
    assert text == "Our March fair visitors" and grids == [[["Name", "Phone", "City"], ["Ravi Kumar", "98765 43210", "Hyderabad"], ["Anita & Co", "91234 56789", "Guntur"]]]


def test_a_word_file_with_entity_tricks_or_an_old_format_is_refused() -> None:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("word/document.xml", '<!DOCTYPE x [<!ENTITY a "aaaa">]><w:document/>')
    with pytest.raises(ReadRefused) as bomb:
        read_docx(out.getvalue())
    assert bomb.value.code == "unreadable"
    with pytest.raises(ReadRefused) as old:
        FileReader(None).read("doc", b"\xd0\xcf\x11\xe0 an old .doc", school=lambda: False, vision=None)
    assert old.value.code == "doc_format"


def test_tables_in_read_text_are_found_on_pipes_tabs_or_wide_spaces() -> None:
    assert grids_of_text("Name | Phone\nRavi | 98765 43210\nAnita | 91234 56789\n") == [[["Name", "Phone"], ["Ravi", "98765 43210"], ["Anita", "91234 56789"]]]
    assert grids_of_text("Name      Phone        City\nRavi      9876543210   Vizag\nAnita     9123456789   Guntur\n")[0][1] == ["Ravi", "9876543210", "Vizag"]
    assert grids_of_text("just a sentence\nand another one") == []


def test_people_in_a_register_and_on_a_visiting_card_are_pieces_of_the_text() -> None:
    rows = people_of_text("Ravi Kumar 98765 43210\nAnita Reddy\n+91 91234 56789\nanita@example.test\n")
    assert rows == [["Name", "Company", "Phone", "Email"], ["Ravi Kumar", "", "98765 43210", ""], ["Anita Reddy", "", "+91 91234 56789", "anita@example.test"]]
    card = people_of_text(CARD)
    assert card == [["Name", "Company", "Phone", "Email"], ["K. Ramesh", "SRI VENKATESWARA TEXTILES", "98480 12345", "ramesh.svt@example.test"]] or card[1][2] == "98480 12345"
    assert card[1][0] in ("K. Ramesh", "Prop. K. Ramesh") and card[1][3] == "ramesh.svt@example.test", "the name and the e-mail are the card's own"
    assert people_of_text("Price list\nKanjivaram 12000\n") == [], "a price is not a phone"


# ============================================================================ the owner's order: the file's text, local OCR, then the AI model
def test_a_pdf_with_a_text_layer_is_read_without_ocr_or_the_model() -> None:
    local = FakeLocal(text_layer="Name        Phone          City\nRavi Kumar  98765 43210    Hyderabad\nAnita       91234 56789    Guntur\n")
    read = FileReader(local).read("pdf", b"%PDF-1.7 x", school=lambda: False, vision=lambda pages: pytest.fail("the model was asked"))
    assert read.how == "text_layer" and local.ocr_calls == 0 and read.grids[0][1][0] == "Ravi Kumar"


def test_a_scan_goes_to_local_ocr_first_and_the_model_is_not_asked_when_ocr_found_people() -> None:
    local = FakeLocal(text_layer="", ocr=REGISTER, pages=2)
    read = FileReader(local).read("pdf", b"%PDF-1.7 scan", school=lambda: pytest.fail("not needed"), vision=lambda pages: pytest.fail("the model was asked"))
    assert read.how == "local_ocr" and local.ocr_calls == 2 and read.pages == 2


def test_the_model_reads_only_the_page_images_and_only_when_local_ocr_found_nothing() -> None:
    sent: list[Any] = []
    local = FakeLocal(text_layer="", ocr="~~ ,,, ~~", pages=3)
    read = FileReader(local).read("pdf", b"%PDF-1.7 scan", school=lambda: False, vision=lambda pages: sent.extend(pages) or REGISTER)
    assert read.how == "ai_vision" and len(sent) == 3 and all(p.media_type == "image/png" and not p.data.startswith(b"%PDF") for p in sent), "page images, never the PDF itself"


def test_a_school_never_sends_a_scan_to_the_model() -> None:
    local = FakeLocal(text_layer="", ocr="~~ unreadable ~~")
    with pytest.raises(ReadRefused) as refused:
        FileReader(local).read("image", png(), school=lambda: True, vision=lambda pages: pytest.fail("a school's picture went to the model"))
    assert refused.value.code == "scanned_school"
    ok = FileReader(FakeLocal(ocr=REGISTER)).read("image", png(), school=lambda: True, vision=lambda pages: pytest.fail("not needed"))
    assert ok.how == "local_ocr", "a school's scan that local OCR can read is read"


def test_a_heic_photo_is_refused_plainly() -> None:
    with pytest.raises(ReadRefused) as refused:
        FileReader(FakeLocal()).read("image", b"\x00\x00\x00\x18ftypheic....", school=lambda: False, vision=None)
    assert refused.value.code == "heic"


# ============================================================================ end to end in the chat: the same preview -> Do it -> Undo
def test_a_word_table_of_people_becomes_the_preview_card_and_do_it_imports_what_the_card_showed() -> None:
    client, llm, store, repo = world(FakeLocal())
    data = docx([["Name", "Mobile", "City"], ["Ravi Kumar", "98765 43210", "Hyderabad"], ["Anita", "91234 56789", "Guntur"]])
    f = fid(client, "fair visitors.docx", data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    card = preview(turn(client, "add these people", [f]))
    assert card["read_by"] == "file" and card["file_name"] == "fair visitors.docx" and card["plan"]["status"] == "proposed" and card["rows"][0][0] == "Ravi Kumar"
    assert f not in store.files, "the file itself is deleted once read; what was read waits as a small CSV"
    done = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner"))
    assert done.status_code == 200 and done.json()["status"] == "done", done.text
    assert llm.requests == [], "no model call for a Word table"
    undone = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/undo", headers=auth("a_owner"))
    assert undone.status_code == 200 and undone.json()["status"] == "undone"


def test_a_scanned_register_read_by_local_ocr_says_so_and_asks_to_check_the_numbers() -> None:
    client, llm, store, _ = world(FakeLocal(text_layer="", ocr=REGISTER))
    f = fid(client, "register.pdf", b"%PDF-1.7 scanned", "application/pdf")
    evs = turn(client, "add them", [f])
    card = preview(evs)
    assert card["read_by"] == "local_ocr" and "check the names and numbers" in text_of(evs) and llm.requests == []
    assert {"code": "found", "n": 3} in card["facts"]


def test_a_visiting_card_photo_the_ocr_cannot_read_is_read_by_the_model_with_only_its_image_and_the_cap(caplog: pytest.LogCaptureFixture) -> None:
    client, llm, store, _ = world(FakeLocal(ocr="~~"), {"text": CARD})
    f = fid(client, "card.jpg", png(), "image/jpeg")
    with caplog.at_level(logging.INFO):
        evs = turn(client, "add this person", [f])
    card = preview(evs)
    assert card["read_by"] == "ai" and card["rows"] and "98480 12345" in " ".join(card["rows"][0])
    assert len(llm.requests) == 1 and len(llm.requests[0].attachments) == 1 and llm.requests[0].attachments[0].media_type == "image/png"
    assert "never instructions" in llm.requests[0].blocks[0].text and not any("RAMESH" in b.text.upper() for b in llm.requests[0].blocks), "the page goes as an image, the words of the request carry nothing of it"
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "model=fake-selftest" in logged and "bytes=" in logged and "98480" not in logged and "Ramesh" not in logged, "the log names the provider and the size, never the content"


@pytest.mark.parametrize("language", ["en", "te"])
def test_in_a_school_a_scan_local_ocr_cannot_read_is_refused_and_nothing_is_sent(language: str) -> None:
    client, llm, store, _ = world(FakeLocal(ocr="~~"), school=True)
    f = fid(client, "admission list.jpg", png(), "image/jpeg")
    body = {"message_id": "6f1c2d3e-4b5a-4c6d-8e7f-000000000001", "conversation_id": None, "text": "add these", "attachment_ids": [f], "language": language}
    from tests.test_aw_files import events

    evs = events(client.post(f"{BASE}/turns", json=body, headers=auth("a_owner")))
    words = {"en": "can't read scanned files yet", "te": "స్కాన్ చేసిన ఫైల్స్ నేను ఇంకా చదవలేను"}[language]
    assert words in text_of(evs) and ("Excel" in text_of(evs)) and llm.requests == [], "a school's picture never reaches the model"
    assert cards_of(evs)[0]["kind"] == "cant_do"


def test_no_local_ocr_on_the_machine_a_school_is_still_refused_and_a_shop_uses_the_model() -> None:
    client, llm, _, _ = world(None, school=True)
    f = fid(client, "list.png", png(), "image/png")
    assert "scanned" in text_of(turn(client, "add", [f])) and llm.requests == []
    client, llm, _, _ = world(None, {"text": REGISTER})
    f = fid(client, "list.png", png(), "image/png")
    assert preview(turn(client, "add", [f]))["read_by"] == "ai" and len(llm.requests) == 1


def test_a_price_table_in_a_pdf_and_a_brochure_are_honest_cant_do_yet() -> None:
    client, _, _, _ = world(FakeLocal(text_layer="Item          Rate      Stock\nKanjivaram    12000     4\nSoft silk     6500      9\n"))
    f = fid(client, "rates.pdf", b"%PDF-1.7 x", "application/pdf")
    card = cards_of(turn(client, "add", [f]))[0]
    assert card["kind"] == "cant_do" and "price list" in card["what"]
    client, _, _, _ = world(FakeLocal(text_layer="We are a family business in Kanchipuram since 1952. " * 10))
    f = fid(client, "about us.pdf", b"%PDF-1.7 x", "application/pdf")
    card = cards_of(turn(client, "add", [f]))[0]
    assert card["kind"] == "cant_do" and card["screen"]["href"] == "/settings/knowledge"


def test_a_busy_model_is_said_plainly() -> None:
    from app.agents.llm.interface import LlmRateLimited

    client, llm, _, _ = world(FakeLocal(ocr="~~"), LlmRateLimited())
    f = fid(client, "card.jpg", png(), "image/jpeg")
    evs = turn(client, "add", [f])
    assert cards_of(evs)[0]["kind"] == "cant_do" and "Excel or CSV" in text_of(evs)


# ============================================================================ the real local OCR, when this machine has it (the API image does: deploy/Dockerfile.api)
@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract is not installed here")
def test_the_real_tesseract_reads_a_visiting_card() -> None:
    image = png("SRI VENKATESWARA TEXTILES\nK. Ramesh\nMob: 98480 12345\nramesh@example.test", size=(1400, 500))
    read = FileReader(LocalTools(languages=["eng"])).read("image", image, school=lambda: True, vision=None)
    assert read.how == "local_ocr" and extract.phones_in(read.text), read.text
    rows = people_of_text(read.text)
    assert rows and "98480" in rows[1][2].replace(" ", "")[:5] + rows[1][2]


def test_the_days_ai_allowance_used_up_is_said_plainly_and_nothing_is_read() -> None:
    from app.agents.errors import CostCapReached

    class Capped(FakeTurnDb):
        def reserve_cost(self, key: str, **kw: Any) -> None:
            raise CostCapReached()

    llm = Sees({"text": CARD})
    db = Capped()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(school=False), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, lead_sources=LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), matcher=MATCHER), assistant_work=FakeWorkStore(),  # type: ignore[arg-type]
                            assistant_file_reader=FileReader(FakeLocal(ocr="~~")))
    f = fid(client, "card.jpg", png(), "image/jpeg")
    evs = turn(client, "add", [f])
    assert "AI allowance is used up" in text_of(evs) and cards_of(evs)[0]["kind"] == "cant_do" and llm.requests == []
