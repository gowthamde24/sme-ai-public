"""Job EB part A: the owner's notes over HTTP with a scripted model and an in-memory store: who may read and write, the version check, the history and restore, "Here is what I understood" (paste, file, voice) with its
guards (no invented number, no list of people, no school fees), save, and "Test it" with its hand-over rules."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import io
import json
import time
import uuid
import zipfile
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant_context import extract, previewtoken, rules
from app.assistant_context.service import ContextService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.dr_tasks_fakes import FakeDb, FakeOutbox, FakeTasksRepository, Scripted
from tests.eb_fakes import FakeContextRepository
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant/context"
KEY = b"k" * 32


def understood(*sections: tuple[str, str]) -> dict[str, Any]:
    return {"sections": [{"section": s, "text": t} for s, t in sections]}


def reply(text: str, *, language: str = "en", used: list[str] | None = None, confidence: float = 0.9, wants_person: bool = False) -> dict[str, Any]:
    return {"text": text, "language": language, "used": used or [], "confidence": confidence, "wants_person": wants_person}


def world(*answers: Any, school: bool = False, voice: Any = None) -> tuple[Any, FakeContextRepository, Scripted, FakeDb]:
    repo, llm, db = FakeContextRepository(), Scripted(*answers), FakeDb()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(school=school), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, outbox=FakeOutbox(), assistant_context=ContextService(repo, KEY), voice=voice)  # type: ignore[arg-type]
    return client, repo, llm, db


def put(client: Any, notes: str, version: int, user: str = "a_owner") -> Any:
    return client.put(BASE, json={"notes": notes, "expected_version": version}, headers=auth(user))


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


# ============================================================================ the notes
def test_before_the_first_save_the_notes_are_empty_and_the_headings_are_offered() -> None:
    client, _, _, _ = world()
    r = client.get(BASE, headers=auth("a_viewer"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["notes"] == "" and body["version"] == 0 and body["updated_by"] is None
    assert [p["key"] for p in body["prompts"]][:3] == ["about", "prices", "delivery"] and {"chats", "calls", "ask", "drafts"} <= set(body["used_by"])


def test_the_owner_and_an_admin_save_and_everyone_reads() -> None:
    client, repo, _, _ = world()
    first = put(client, "We sell sarees.\nDelivery in Guntur is free.", 0)
    assert first.status_code == 200 and first.json()["version"] == 1 and first.json()["updated_by"]["name"] == "Owner One"
    assert repo.rows[TENANT_A.id][0]["change"] == "added 2 lines"
    second = put(client, "We sell sarees.\nDelivery in Guntur is free.\nOpen 9 to 7.", 1, user="a_admin")
    assert second.json()["version"] == 2 and repo.rows[TENANT_A.id][1]["change"] == "added 1 line"
    assert client.get(BASE, headers=auth("a_sales")).json()["notes"].endswith("Open 9 to 7.")
    assert put(client, "x", 2, user="a_sales").status_code == 403 and put(client, "x", 2, user="a_viewer").status_code == 403


def test_a_stale_version_is_a_409_that_carries_the_current_text_and_the_same_words_change_nothing() -> None:
    client, repo, _, _ = world()
    put(client, "One", 0)
    stale = put(client, "Two", 0)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "context_changed"
    assert stale.json()["error"]["current"]["notes"] == "One" and stale.json()["error"]["current"]["version"] == 1
    assert put(client, "One", 1).json()["version"] == 1 and len(repo.rows[TENANT_A.id]) == 1
    assert put(client, "", 0).status_code == 409, "an empty save at version 0 would be fine, but version 1 exists"


def test_blank_is_allowed_and_too_long_or_unclean_is_refused() -> None:
    client, _, _, _ = world()
    assert put(client, "", 0).json()["version"] == 0
    assert put(client, "x" * 20_001, 0).status_code == 422
    assert put(client, "bad\x01text", 0).status_code == 422


def test_the_history_lists_versions_newest_first_and_restore_makes_a_new_one() -> None:
    client, repo, _, _ = world()
    put(client, "Line one", 0)
    put(client, "Line one\nLine two", 1)
    listed = client.get(f"{BASE}/versions", headers=auth("a_sales")).json()["items"]
    assert [i["version"] for i in listed] == [2, 1] and listed[0]["change"] == "added 1 line" and "notes" not in listed[0]
    assert client.get(f"{BASE}/versions/1", headers=auth("a_sales")).json()["notes"] == "Line one"
    assert client.get(f"{BASE}/versions/9", headers=auth("a_sales")).status_code == 404
    restored = client.post(f"{BASE}/versions/1/restore", json={"expected_version": 2}, headers=auth("a_owner"))
    assert restored.status_code == 200 and restored.json()["version"] == 3 and restored.json()["notes"] == "Line one"
    assert repo.rows[TENANT_A.id][2]["change"] == "restored version 1"
    assert client.post(f"{BASE}/versions/1/restore", json={"expected_version": 2}, headers=auth("a_owner")).status_code == 409


def test_a_schools_notes_cannot_carry_fees_marks_dues_or_children() -> None:
    client, repo, _, _ = world(school=True)
    for text, reason in (("Fees are due on the 5th.", "fees"), ("Tell parents their marks are ready.", "marks"), ("Outstanding dues must be paid.", "dues"), ("Never share a child's details.", "children")):
        r = put(client, text, 0)
        assert r.status_code == 422 and r.json()["error"]["code"] == "not_for_schools" and r.json()["error"]["reason"] == reason, (text, r.text)
    assert put(client, "We are open 9 to 4. Visit the office for the prospectus.", 0).status_code == 200
    assert TENANT_A.id in repo.rows


# ============================================================================ understand
def test_a_pasted_price_list_becomes_clean_notes_and_nothing_is_saved() -> None:
    client, repo, llm, _ = world(understood(("prices", "Paver block 6 inch: 45 rupees each\nPaver block 8 inch: 52 rupees each"), ("delivery", "Free delivery within 10 km")))
    source = "Paver block 6 inch - 45 rupees each. Paver block 8 inch - 52 rupees each. Free delivery within 10 km."
    r = client.post(f"{BASE}/understand", json={"kind": "paste", "text": source}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["section"] for s in body["understood"]] == ["prices", "delivery"] and body["notes_markdown"].startswith("## Prices\n") and body["warnings"] == []
    assert body["source"] == {"kind": "paste", "filename": None} and body["preview_id"]
    assert TENANT_A.id not in repo.rows, "a preview saves nothing"
    system = llm.requests[0].blocks[0].text
    assert "exactly as written" in system.lower() or "EXACTLY as written" in system
    assert source in " ".join(b.text for b in llm.requests[0].blocks), "the document goes to the model as data"


def test_a_number_the_model_made_up_is_left_out() -> None:
    client, _, _, _ = world(understood(("prices", "Paver block: 45 rupees\nPaver block bulk: 39 rupees"), ("timings", "Open 9 to 7")))
    r = client.post(f"{BASE}/understand", json={"kind": "paste", "text": "Paver block 45 rupees. Open 9 to 7."}, headers=auth("a_owner"))
    body = r.json()
    assert "39" not in body["notes_markdown"] and "45 rupees" in body["notes_markdown"] and "Open 9 to 7" in body["notes_markdown"]
    assert "dropped_unverified" in body["warnings"]


def test_a_list_of_people_is_not_context_and_never_reaches_the_model() -> None:
    client, _, llm, _ = world()
    people = "\n".join(f"Customer {i}, 98{i:08d}" for i in range(7))
    r = client.post(f"{BASE}/understand", json={"kind": "paste", "text": people}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["notes_markdown"] == "" and r.json()["warnings"] == ["looks_like_personal_data"]
    assert llm.requests == []


def test_a_school_document_with_fees_is_refused_before_a_model_sees_it() -> None:
    client, _, llm, _ = world(school=True)
    r = client.post(f"{BASE}/understand", json={"kind": "paste", "text": "Class 5 fees are 40000 a year."}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_for_schools" and llm.requests == []


def test_files_are_read_by_what_they_are_and_pictures_need_a_model_that_can_see() -> None:
    sheet = b"Item,Price\nPaver 6 inch,45\nPaver 8 inch,52\n"
    client, _, llm, _ = world(understood(("prices", "Paver 6 inch: 45\nPaver 8 inch: 52")))
    ok = client.post(f"{BASE}/understand", json={"kind": "file", "filename": "prices.csv", "content_base64": b64(sheet)}, headers=auth("a_owner"))
    assert ok.status_code == 200 and "Paver 8 inch: 52" in ok.json()["notes_markdown"] and ok.json()["source"]["filename"] == "prices.csv"
    assert "Paver 6 inch | 45" in " ".join(b.text for b in llm.requests[0].blocks)
    for name, data in (("list.pdf", b"%PDF-1.4 x"), ("shop.jpg", b"\xff\xd8\xff\xe0x"), ("shop.png", b"\x89PNG\r\n\x1a\nx")):
        r = client.post(f"{BASE}/understand", json={"kind": "file", "filename": name, "content_base64": b64(data)}, headers=auth("a_owner"))
        assert r.status_code == 503 and r.json()["error"]["code"] == "vision_unavailable", (name, "a model that cannot read pictures says so in plain words")
    assert client.post(f"{BASE}/understand", json={"kind": "file", "filename": "x.txt", "content_base64": "not base64!!"}, headers=auth("a_owner")).json()["error"]["code"] == "file_unreadable"
    big = client.post(f"{BASE}/understand", json={"kind": "file", "filename": "x.txt", "content_base64": b64(b"a" * 3_100_000)}, headers=auth("a_owner"))
    assert big.status_code == 422 and big.json()["error"]["code"] == "file_too_large"


def test_word_files_are_read_without_an_xml_parser_and_a_bomb_is_refused() -> None:
    def docx(xml: str) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("word/document.xml", xml)
        return buf.getvalue()

    text, _ = extract.text_from_file("a.docx", docx("<w:document><w:p><w:r><w:t>Open 9 to 7</w:t></w:r></w:p><w:p><w:r><w:t>Free delivery</w:t></w:r></w:p></w:document>"))
    assert text == "Open 9 to 7\nFree delivery"
    with pytest.raises(extract.Unreadable):
        extract.text_from_file("a.docx", docx('<!DOCTYPE x [<!ENTITY a "aaaa">]><w:document><w:t>&a;</w:t></w:document>'))
    with pytest.raises(extract.Unreadable):
        extract.text_from_file("a.docx", b"PK\x03\x04 not really")


def test_saving_what_was_understood_appends_or_replaces_and_a_stale_or_bad_preview_is_refused() -> None:
    client, repo, _, _ = world(understood(("timings", "Open 9 to 7")))
    put(client, "We sell sarees.", 0)
    pid = client.post(f"{BASE}/understand", json={"kind": "paste", "text": "Open 9 to 7"}, headers=auth("a_owner")).json()["preview_id"]
    url = f"{BASE}/understand/{pid}/save"
    appended = client.post(url, json={"notes_markdown": "## Timings\nOpen 9 to 7 (edited)", "mode": "append", "expected_version": 1}, headers=auth("a_owner"))
    assert appended.status_code == 200 and appended.json()["notes"] == "We sell sarees.\n\n## Timings\nOpen 9 to 7 (edited)" and appended.json()["version"] == 2
    replaced = client.post(url, json={"notes_markdown": "Only this", "mode": "replace", "expected_version": 2}, headers=auth("a_owner"))
    assert replaced.json()["notes"] == "Only this" and repo.rows[TENANT_A.id][-1]["version"] == 3
    assert client.post(url, json={"notes_markdown": "x", "mode": "append", "expected_version": 1}, headers=auth("a_owner")).status_code == 409
    assert client.post(f"{BASE}/understand/garbage.token/save", json={"notes_markdown": "x", "mode": "append", "expected_version": 3}, headers=auth("a_owner")).status_code == 404
    assert client.post(url, json={"notes_markdown": "x", "mode": "append", "expected_version": 3}, headers=auth("a_admin")).status_code == 404, "a preview belongs to the person who made it"


def test_a_preview_expires_after_half_an_hour_and_is_tied_to_the_workspace_and_the_person() -> None:
    user = uuid.uuid4()
    token, expires = previewtoken.make(KEY, TENANT_A.id, user, now=1000.0)
    assert previewtoken.check(KEY, token, TENANT_A.id, user, now=1000.0 + 1799) == "ok"
    assert previewtoken.check(KEY, token, TENANT_A.id, user, now=expires + 1) == "expired"
    assert previewtoken.check(KEY, token, TENANT_B.id, user, now=1001.0) == "invalid" and previewtoken.check(KEY, token, TENANT_A.id, uuid.uuid4(), now=1001.0) == "invalid"
    assert previewtoken.check(b"x" * 32, token, TENANT_A.id, user, now=1001.0) == "invalid" and previewtoken.check(KEY, token + "0", TENANT_A.id, user, now=1001.0) == "invalid"


def test_a_voice_note_is_transcribed_then_understood_and_without_a_speech_service_it_says_so() -> None:
    client, _, _, _ = world(understood(("timings", "Open 9 to 7")))
    r = client.post(f"{BASE}/understand", json={"kind": "voice", "content_base64": b64(b"RIFF....WAVE")}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "voice_unavailable"


# ============================================================================ test it
NOTES = "We deliver in Guntur within two days.\nOpen 9 to 7, closed on Sundays."


def test_a_customer_question_is_answered_from_the_notes_with_the_pieces_it_used() -> None:
    client, _, llm, _ = world(reply("We are open 9 to 7, closed on Sundays.", used=["Open 9 to 7, closed on Sundays.", "this is invented"]))
    put(client, NOTES, 0)
    r = client.post(f"{BASE}/test", json={"question": "What time do you open?"}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "We are open 9 to 7, closed on Sundays." and body["would_hand_over"] is False and body["reason"] is None and body["language"] == "en"
    assert body["used"] == [{"from": "notes", "snippet": "Open 9 to 7, closed on Sundays."}], "a piece that is not in the notes is not shown as used"
    assert NOTES.splitlines()[0] in " ".join(b.text for b in llm.requests[0].blocks)


@pytest.mark.parametrize(
    ("question", "model", "reason"),
    [
        ("What is the price of paver blocks?", reply("It is cheap."), "asked_about_money"),
        ("Can I talk to a person please", reply("Sure."), "asked_for_a_person"),
        ("This is terrible service, I want a refund", reply("Sorry."), "complaint"),
        ("Do you deliver to Vizag?", reply("Maybe.", confidence=0.2), "unsure"),
        ("When do you open?", reply("We open at 9 and a block costs ₹45."), "asked_about_money"),
    ],
)
def test_a_price_a_person_a_complaint_or_doubt_waits_for_the_owner(question: str, model: dict[str, Any], reason: str) -> None:
    client, _, _, _ = world(model)
    put(client, NOTES, 0)
    body = client.post(f"{BASE}/test", json={"question": question}, headers=auth("a_owner")).json()
    assert body["would_hand_over"] is True and body["reason"] == reason and body["answer"] == "Let me check with the owner and come back to you." and body["used"] == []


def test_the_test_needs_notes_and_is_for_owner_and_admin_and_answers_in_the_customers_language() -> None:
    client, _, _, _ = world(reply("మేము ఉదయం 9 కి తెరుస్తాము.", language="te"))
    assert client.post(f"{BASE}/test", json={"question": "hi"}, headers=auth("a_owner")).json()["error"]["code"] == "no_notes"
    put(client, NOTES, 0)
    assert client.post(f"{BASE}/test", json={"question": "hi"}, headers=auth("a_sales")).status_code == 403
    body = client.post(f"{BASE}/test", json={"question": "ఎప్పుడు తెరుస్తారు?"}, headers=auth("a_owner")).json()
    assert body["language"] == "te" and "తెరుస్తాము" in body["answer"]


def test_the_requests_are_closed_and_the_rules_are_pure() -> None:
    client, _, _, _ = world()
    assert client.post(f"{BASE}/test", json={"question": "x", "extra": 1}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{BASE}/understand", json={"kind": "file"}, headers=auth("a_owner")).status_code in (422,)
    assert rules.change_label("", "a\nb") == "added 2 lines" and rules.change_label("a", "a\nb") == "added 1 line" and rules.change_label("a\nb", "a") == "removed 1 line"
    assert rules.change_label("a", "b") == "edited" and rules.change_label("a", "") == "cleared" and rules.change_label("a", "a", restored_from=3) == "restored version 3"
    assert rules.numbers_in("Rs 1,200.50 and 45") == {"1200.50", "45"} and time.time() > 0 and json.dumps({}) == "{}"
