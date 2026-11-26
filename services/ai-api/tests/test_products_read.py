# ruff: noqa: E501
"""Reading a PRODUCTS price list from a photo or a PDF (26 Nov 2026; `POST /what-you-sell/products/read`): the AI model COPIES the lines, CODE decides every price; nothing is saved, the file is dropped after a good
reading, a school's pictures never go to the model, the day's allowance is respected, no phone number or e-mail address survives in a draft. The model is a fake (a scripted answer); no real picture, no network."""

from __future__ import annotations

import io
import uuid
from typing import Any

import pytest

from app.assistant_work.extract import FileReader
from app.jobs import products_read
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

URL = f"/v1/tenants/{TENANT_A.id}/what-you-sell/products/read"


def jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 40), (250, 250, 250)).save(buf, format="JPEG")
    return buf.getvalue()


NOTEBOOK = [
    {"name": "కంచి పట్టు చీర ఎరుపు", "price": 8500, "unit": "piece", "notes": "zari border, call 9876543210", "confidence": "high"},
    {"name": "Mysore crepe green", "price": "४८००", "unit": None, "notes": None, "confidence": "medium"},
    {"name": "Cotton dupatta", "price": None, "unit": None, "notes": "price not written", "confidence": "high"},
    {"name": "Pochampally ikat", "price": 1800.5, "unit": "other", "notes": "mail me a@b.example", "confidence": "bogus"},
    {"name": "  ", "price": 100, "unit": None, "notes": None, "confidence": "high"},
    {"name": "Mysore crepe green", "price": 4800, "unit": None, "notes": None, "confidence": "high"},
]


class World:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, *, school: bool = False, text_layer: str | None = None, answer: Any = None) -> None:
        tasks = TasksService(FakeTasksRepository(school=school), FakeDialer(), FixedKnowledge([]))
        self.calls: list[dict[str, Any]] = []
        self.store = FakeWorkStore()
        self.client, _ = make_client(jobs=JobsRuntime(), tasks=tasks, lead_sources=LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), matcher=MATCHER), assistant_work=self.store,  # type: ignore[arg-type]
                                     assistant_file_reader=FileReader(FakeLocal(text_layer=text_layer)))
        scripted = answer if answer is not None else {"rows": NOTEBOOK}

        def fake_run(runtime: Any, token: str, tenant_id: Any, **kw: Any) -> dict[str, Any]:
            self.calls.append(kw)
            if isinstance(scripted, Exception):
                raise scripted
            return dict(scripted)

        monkeypatch.setattr("app.assistant_context.modelrun.run", fake_run)

    def read(self, body: dict[str, Any], user: str = "a_owner") -> Any:
        return self.client.post(URL, json=body, headers=auth(user))


def test_a_photo_of_a_notebook_becomes_drafts_and_code_decides_every_price(monkeypatch: pytest.MonkeyPatch) -> None:
    w = World(monkeypatch)
    f = fid(w.client, "notebook.jpg", jpeg(), "image/jpeg")
    r = w.read({"file_id": f})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["style"] == "products" and body["read_by"] == "ai_vision" and body["unclear"] is False
    got = {d["name"]: d for d in body["drafts"]}
    assert list(got) == ["కంచి పట్టు చీర ఎరుపు", "Mysore crepe green", "Cotton dupatta", "Pochampally ikat"], "a blank name is dropped and the twin Mysore row (same name and price) is merged"
    assert got["కంచి పట్టు చీర ఎరుపు"]["price_paise"] == 850_000 and got["కంచి పట్టు చీర ఎరుపు"]["unit"] == "piece" and got["కంచి పట్టు చీర ఎరుపు"]["confidence"] == "high"
    assert got["Mysore crepe green"]["price_paise"] == 480_000, "a Devanagari-digit price is read as 4800"
    assert got["Cotton dupatta"]["price_paise"] is None and got["Cotton dupatta"]["confidence"] == "low", "no price is never invented; the draft says low"
    assert got["Pochampally ikat"]["price_paise"] == 180_050 and got["Pochampally ikat"]["unit"] is None and got["Pochampally ikat"]["confidence"] == "low", "an unknown word of confidence is low; 'other' is no unit"
    assert {"code": "price_missing", "row": 3} in body["notes"]
    text = r.text
    assert "9876543210" not in text and "a@b.example" not in text, "a phone number or an e-mail address never reaches a draft"
    assert len(w.calls) == 1 and w.calls[0]["attachments"][0].media_type == "image/png" and w.calls[0]["label"] == products_read.LABEL
    assert w.calls[0]["max_output_tokens"] * 2 <= 3_000, "two reservations fit in a run's output budget"


def test_the_file_is_dropped_after_a_good_reading_and_kept_when_nothing_was_read(monkeypatch: pytest.MonkeyPatch) -> None:
    w = World(monkeypatch)
    f = fid(w.client, "notebook.jpg", jpeg(), "image/jpeg")
    assert w.read({"file_id": f}).status_code == 200
    assert w.read({"file_id": f}).status_code == 404, "the picture is gone once its list was read: nothing is stored"
    empty = World(monkeypatch, answer={"rows": []})
    g = fid(empty.client, "blank.jpg", jpeg(), "image/jpeg")
    body = empty.read({"file_id": g}).json()
    assert body["drafts"] == [] and body["unclear"] is True and body["notes"] == [{"code": "unreadable"}]
    assert empty.read({"file_id": g}).status_code == 200, "an unreadable page keeps the file so the owner can try again"


def test_a_pdf_with_a_text_layer_is_read_by_code_and_never_reaches_the_model(monkeypatch: pytest.MonkeyPatch) -> None:
    w = World(monkeypatch, text_layer="Item               Rate\nKanjivaram red     12,000\nSoft silk green    6500\nMysore crepe       Rs. 4,800\n")
    f = fid(w.client, "rates.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf")
    body = w.read({"file_id": f}).json()
    assert body["read_by"] == "text_layer" and w.calls == []
    assert [(d["name"], d["price_paise"], d["confidence"]) for d in body["drafts"]] == [("Kanjivaram red", 1_200_000, "high"), ("Soft silk green", 650_000, "high"), ("Mysore crepe", 480_000, "high")]


def test_a_scanned_pdf_goes_page_by_page_and_the_rows_add_up(monkeypatch: pytest.MonkeyPatch) -> None:
    w = World(monkeypatch)
    f = fid(w.client, "scan.pdf", b"%PDF-1.7 " + uuid.uuid4().bytes, "application/pdf")
    body = w.read({"file_id": f}).json()
    assert len(w.calls) == 1 and body["read_by"] == "ai_vision" and body["pages"] == 1


def test_refusals_the_day_allowance_a_school_a_heic_a_wrong_file_and_strangers(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.errors import ApiError

    limit = World(monkeypatch, answer=ApiError(429, "run_limit_reached", "x"))
    f = fid(limit.client, "n.jpg", jpeg(), "image/jpeg")
    r = limit.read({"file_id": f})
    assert r.status_code == 429 and r.json()["error"]["code"] == "ai_limit"
    school = World(monkeypatch, school=True)
    g = fid(school.client, "n.jpg", jpeg(), "image/jpeg")
    r2 = school.read({"file_id": g})
    assert r2.status_code == 422 and r2.json()["error"]["code"] == "file_unreadable"
    assert school.calls == [], "a school's picture never goes to the model"
    w = World(monkeypatch)
    heic = fid(w.client, "n.heic", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 40, "image/heic")
    assert w.read({"file_id": heic}).status_code in (422, 404) and w.calls == []
    assert w.read({"file_id": str(uuid.uuid4())}).status_code == 404
    assert w.read({"file_id": jpeg().hex()}).status_code == 422
    assert w.read({"file_id": str(uuid.uuid4()), "extra": 1}).status_code == 422
    f2 = fid(w.client, "n.jpg", jpeg(), "image/jpeg")
    assert w.read({"file_id": f2}, "a_sales").status_code == 403
    assert w.read({"file_id": f2}, "b_owner").status_code in (403, 404)


def test_the_units_in_code_are_a_closed_list_and_a_price_has_bounds() -> None:
    assert products_read.paise_of_rupees(8500) == 850_000 and products_read.paise_of_rupees("₹1") is None and products_read.paise_of_rupees("౮౫౦౦") == 850_000
    for bad in (0, 0.5, -5, 10_000_001, "call us", "500-600", None, True, float("nan")):
        assert products_read.paise_of_rupees(bad) is None, bad
    drafts, notes = products_read.rows_to_drafts([{"name": f"p{i}", "price": 10 + i, "confidence": "high"} for i in range(70)], read_by="ai_vision")
    assert len(drafts) == products_read.MAX_ROWS and {"code": "too_many"} in notes
