"""Job EC: notes from a PDF or a photo. The reader turns them into an attachment for the model (never text here), the Anthropic payload carries them as image/document blocks before the words, the cost bound counts
them, and the notes flow keeps its guards: a school sends none, a model that cannot see says so, what was read is flagged `read_from_picture`, and a list of people is still not context."""

# ruff: noqa: E501

from __future__ import annotations

import base64
from types import SimpleNamespace
from typing import Any

import pytest

from app.agents.llm.anthropic import AnthropicClient, AnthropicConfig
from app.agents.llm.interface import Attachment, Block, LlmRequest, TaskClass, Trust
from app.agents.runtime import input_token_bound
from app.assistant_context import extract
from app.assistant_context.service import ContextService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.dr_tasks_fakes import FakeDb, FakeOutbox, FakeTasksRepository, Scripted
from tests.eb_fakes import FakeContextRepository
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant/context"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 200
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"0" * 100
GIF = b"GIF89a" + b"0" * 100


def pdf(pages: int = 2, extra: bytes = b"") -> bytes:
    return b"%PDF-1.4\n" + b"".join(b"%d 0 obj << /Type /Page /Parent 2 0 R >> endobj\n" % (i + 3) for i in range(pages)) + b"2 0 obj << /Type /Pages /Count %d >> endobj\n" % pages + extra + b"%%EOF"


class Sees(Scripted):
    """A scripted model that can read attachments (the main Claude model can)."""

    supports_attachments = True


def understood(*sections: tuple[str, str]) -> dict[str, Any]:
    return {"sections": [{"section": s, "text": t} for s, t in sections]}


def world(*answers: Any, model: type[Scripted] = Sees, school: bool = False) -> tuple[Any, Scripted]:
    llm = model(*answers)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: FakeDb(), assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(school=school), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, outbox=FakeOutbox(), assistant_context=ContextService(FakeContextRepository(), b"k" * 32))  # type: ignore[arg-type]
    return client, llm


def send(client: Any, name: str, data: bytes) -> Any:
    return client.post(f"{BASE}/understand", json={"kind": "file", "filename": name, "content_base64": base64.b64encode(data).decode()}, headers=auth("a_owner"))


# ============================================================================ the reader
@pytest.mark.parametrize(("data", "media"), [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp"), (GIF, "image/gif")])
def test_a_picture_is_recognised_by_its_first_bytes_not_its_name(data: bytes, media: str) -> None:
    read = extract.read_file("anything.txt", data)
    assert read.text == "" and read.attachment is not None and read.attachment.kind == "image" and read.attachment.media_type == media
    assert read.attachment.max_tokens == extract.TOKENS_PER_IMAGE and "bytes" in repr(read.attachment) and "0000" not in repr(read.attachment), "the bytes never reach a log"


def test_a_pdf_becomes_a_document_attachment_with_a_cost_bound_that_follows_its_pages() -> None:
    small, big = extract.read_file("a.pdf", pdf(2)).attachment, extract.read_file("a.pdf", pdf(10)).attachment
    assert small is not None and big is not None and small.kind == "document" and small.media_type == "application/pdf"
    assert small.max_tokens == 2 * extract.TOKENS_PER_PAGE + 1_000 and big.max_tokens == 10 * extract.TOKENS_PER_PAGE + 1_000


def test_a_long_a_locked_or_a_lying_file_is_refused_in_plain_codes() -> None:
    with pytest.raises(extract.Unreadable) as long:
        extract.read_file("a.pdf", pdf(extract.MAX_PDF_PAGES + 1))
    assert long.value.code == "file_too_long"
    with pytest.raises(extract.Unreadable) as locked:
        extract.read_file("a.pdf", pdf(2, b"trailer << /Encrypt 9 0 R >>"))
    assert locked.value.code == "file_unreadable"
    with pytest.raises(extract.Unreadable):
        extract.read_file("fake.pdf", b"just some words, not a pdf at all")
    with pytest.raises(extract.Unreadable) as huge:
        extract.read_file("a.png", PNG + b"0" * 3_100_000)
    assert huge.value.code == "file_too_large"
    assert extract.read_file("prices.csv", b"Item,Price\nPaver,45\n").attachment is None, "a spreadsheet is still read as text"


# ============================================================================ the model request
def test_the_anthropic_payload_puts_the_pictures_first_as_base64_blocks_and_the_words_after() -> None:
    client = AnthropicClient(AnthropicConfig(api_key="k", model="claude-haiku-5-5", input_micros_per_mtok=1, output_micros_per_mtok=1))
    request = LlmRequest(
        blocks=(Block(Trust.SYSTEM, "sys"), Block(Trust.TRUSTED, "Make notes."), Block(Trust.UNTRUSTED, "data")),
        tools=(), max_output_tokens=100, task_class=TaskClass.SIMPLE,
        attachments=(Attachment("image", "image/png", b"PNGDATA", 10), Attachment("document", "application/pdf", b"%PDF", 10)),
    )
    content = client._payload(request)["messages"][0]["content"]  # noqa: SLF001
    assert [c["type"] for c in content] == ["image", "document", "text", "text"]
    assert content[0]["source"] == {"type": "base64", "media_type": "image/png", "data": base64.b64encode(b"PNGDATA").decode()} and content[1]["source"]["media_type"] == "application/pdf"
    assert client.supports_attachments is True
    plain = client._payload(LlmRequest(blocks=(Block(Trust.TRUSTED, "hi"),), tools=(), max_output_tokens=10, task_class=TaskClass.SIMPLE))["messages"][0]["content"]  # noqa: SLF001
    assert [c["type"] for c in plain] == ["text"], "a request without attachments is unchanged"


def test_the_cost_reservation_counts_what_reading_the_attachments_costs() -> None:
    base = LlmRequest(blocks=(Block(Trust.TRUSTED, "x"),), tools=(), max_output_tokens=10, task_class=TaskClass.SIMPLE)
    with_pdf = LlmRequest(blocks=base.blocks, tools=(), max_output_tokens=10, task_class=TaskClass.SIMPLE, attachments=(Attachment("document", "application/pdf", b"%PDF", 7_000),))
    assert input_token_bound(with_pdf) == input_token_bound(base) + 7_000


# ============================================================================ the notes flow
def test_a_photo_is_read_by_the_model_and_the_preview_says_to_check_the_numbers() -> None:
    client, llm = world(understood(("prices", "Paver 6 inch: 45 rupees\nPaver 8 inch: 52 rupees"), ("timings", "Open 9 to 7")))
    r = send(client, "board.jpg", JPEG)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Paver 8 inch: 52 rupees" in body["notes_markdown"] and body["warnings"] == ["read_from_picture"] and body["source"]["filename"] == "board.jpg"
    request = llm.requests[0]
    assert [(a.kind, a.media_type) for a in request.attachments] == [("image", "image/jpeg")] and request.tools == ()
    assert "attached as a picture or a PDF" in request.blocks[0].text and not any("0000" in b.text for b in request.blocks)


def test_a_pdf_is_sent_as_a_document_and_the_owner_still_reads_before_saving() -> None:
    client, llm = world(understood(("delivery", "Free delivery within 10 km")))
    r = send(client, "terms.pdf", pdf(3))
    assert r.status_code == 200 and "read_from_picture" in r.json()["warnings"] and r.json()["understood"][0]["section"] == "delivery"
    assert llm.requests[0].attachments[0].kind == "document" and llm.requests[0].attachments[0].max_tokens == 3 * extract.TOKENS_PER_PAGE + 1_000


def test_a_picture_of_a_list_of_people_gives_no_notes() -> None:
    people = "\n".join(f"Ravi {i}, 98{i:08d}" for i in range(7))
    client, _ = world(understood(("other", people)))
    r = send(client, "customers.png", PNG)
    assert r.status_code == 200 and r.json()["notes_markdown"] == "" and r.json()["warnings"] == ["looks_like_personal_data"]


def test_a_school_never_sends_a_picture_or_a_pdf_to_a_model() -> None:
    client, llm = world(school=True)
    for name, data in (("fees.png", PNG), ("marks.pdf", pdf(1))):
        r = send(client, name, data)
        assert r.status_code == 422 and r.json()["error"]["code"] == "not_for_schools" and r.json()["error"]["reason"] == "children", name
    assert llm.requests == []


def test_a_model_that_cannot_see_and_a_too_long_pdf_are_said_plainly() -> None:
    client, llm = world(model=Scripted)
    r = send(client, "board.jpg", JPEG)
    assert r.status_code == 503 and r.json()["error"]["code"] == "vision_unavailable" and llm.requests == []
    long = send(client, "big.pdf", pdf(extract.MAX_PDF_PAGES + 1))
    assert long.status_code == 422 and long.json()["error"]["code"] == "file_too_long" and "25" in long.json()["error"]["message"]
    locked = send(client, "locked.pdf", pdf(1, b"/Encrypt 1 0 R"))
    assert locked.status_code == 422 and locked.json()["error"]["code"] == "file_unreadable"
