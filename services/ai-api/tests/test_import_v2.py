"""File import v2 (owner, 14 Nov 2026; docs/contracts/file-import.md): a people list is shown as an editable table (unsure cells marked, duplicates and bad numbers flagged), corrected, given a
destination and a consent source, and only then becomes the usual plan card. Against fakes: the real application and its routes."""

# ruff: noqa: E501

from __future__ import annotations

import base64
from types import SimpleNamespace
from typing import Any

from app.assistant_work.extract import FileReader
from app.lead_sources.service import LeadSourcesService
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.service import TasksService
from tests.aw_fakes import FakeWorkStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import FakeTasksRepository, Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import auth, make_client
from tests.test_aw_files import BASE, MATCHER, cards_of, drop, events
from tests.test_aw_files_read import FakeLocal, Sees, fid, png

SHEET = "Name,Mobile,Interested in\nRavi Kumar,98765 43210,Kanjivaram\nAnita,+91 91234 56789,Soft silk\nBad Number,12345,Mysore\nRavi Again,098765-43210,Brochure\n,99999 11111,No name\n"


def world(local: FakeLocal | None = None, *answers: Any) -> tuple[Any, FakeWorkStore]:
    llm = Sees(*answers) if answers else Scripted()
    db = FakeTurnDb()
    store = FakeWorkStore()
    store.known_phones = {"9123456789": {"lead_id": "11111111-1111-4111-8111-111111111111", "name": "Anita S"}}   # type: ignore[attr-defined]
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    tasks = TasksService(FakeTasksRepository(), FakeDialer(), FixedKnowledge([]))
    client, _ = make_client(agents=agents, tasks=tasks, lead_sources=LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver(), matcher=MATCHER), assistant_work=store,  # type: ignore[arg-type]
                            assistant_file_reader=FileReader(local), assistant_import_v2=True)
    return client, store


def turn(client: Any, text: str, files: list[str]) -> list[tuple[str, dict[str, Any]]]:
    import uuid

    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "attachment_ids": files, "language": "en"}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth("a_owner")))


def preview_of(client: Any, data: str | bytes = SHEET, name: str = "march leads.csv", content_type: str = "text/csv") -> dict[str, Any]:
    f = drop(client, name, data, content_type=content_type)
    assert f.status_code == 201, f.text
    cards = cards_of(turn(client, "add these to my leads", [f.json()["file_id"]]))
    assert len(cards) == 1 and cards[0]["kind"] == "file_preview" and cards[0].get("version") == 2, cards
    return cards[0]


def test_a_people_list_becomes_an_editable_preview_with_flags_and_nothing_is_written() -> None:
    client, _ = world()
    card = preview_of(client)
    assert card["destination"] == "leads" and card["state"] == "ready" and card["read_by"] == "file" and card["consent"] == {"required": True, "options": ["walk_in", "asked_us", "existing_customer"], "chosen": None}
    assert [c["key"] for c in card["columns"]] == ["name", "phone", "interest", "source"]
    by_name = {r["cells"]["name"]["value"]: r for r in card["rows"]}
    assert by_name["Ravi Kumar"]["cells"]["phone"]["value"] == "+919876543210" and by_name["Ravi Kumar"]["include"] is True
    assert by_name["Bad Number"]["flags"]["invalid_phone"] is True and by_name["Bad Number"]["include"] is False, "a number that is not Indian is left out by default"
    assert by_name["Anita"]["flags"]["duplicate_of"] == {"lead_id": "11111111-1111-4111-8111-111111111111", "name": "Anita S"} and by_name["Anita"]["include"] is False
    assert by_name["Ravi Again"]["flags"]["duplicate_of"] == {"lead_id": None, "name": "Ravi Kumar"}, "the same number twice in the file"
    assert card["counts"] == {"rows": 5, "new": 1, "existing": 2, "invalid_phone": 1, "unsure": 0, "included": 1}


def test_the_owner_corrects_cells_and_the_counts_follow() -> None:
    client, store = world()
    card = preview_of(client)
    rid = {r["cells"]["name"]["value"]: r["row_id"] for r in card["rows"]}
    url = f"{BASE}/imports/{card['import_id']}"
    out = client.patch(f"{url}/rows", json={"edits": [{"row_id": rid["Bad Number"], "cell": "phone", "value": "98480 12345"}, {"row_id": rid[""], "cell": "name", "value": "Gopal"}], "include": []}, headers=auth("a_owner"))
    assert out.status_code == 200, out.text
    assert out.json()["counts"]["invalid_phone"] == 0 and out.json()["counts"]["included"] == 3
    again = client.get(url, headers=auth("a_owner")).json()
    row = next(r for r in again["rows"] if r["row_id"] == rid["Bad Number"])
    assert row["cells"]["phone"] == {"value": "+919848012345", "unsure": False, "valid": True} and row["include"] is True
    off = client.patch(f"{url}/rows", json={"edits": [], "include": [{"row_id": rid["Ravi Kumar"], "include": False}]}, headers=auth("a_owner"))
    assert off.json()["counts"]["included"] == 2
    assert client.patch(f"{url}/rows", json={"edits": [{"row_id": "r999", "cell": "name", "value": "x"}], "include": []}, headers=auth("a_owner")).status_code == 422
    assert client.get(url, headers=auth("a_viewer")).status_code == 403


def test_the_destination_can_be_changed_and_the_rows_follow() -> None:
    client, _ = world()
    card = preview_of(client, "Item,Price,Stock\nKanjivaram red,12000,4\nSoft silk green,6500,9\n", "prices.csv")
    url = f"{BASE}/imports/{card['import_id']}"
    prices = client.patch(url, json={"destination": "prices"}, headers=auth("a_owner"))
    assert prices.status_code == 200 and prices.json()["destination"] == "prices" and prices.json()["consent"]["required"] is False
    assert [c["key"] for c in prices.json()["columns"]] == ["item", "price", "stock", "unit"]
    assert prices.json()["rows"][0]["cells"]["item"]["value"] == "Kanjivaram red" and prices.json()["rows"][0]["cells"]["price"]["value"] == "12000"
    assert client.patch(url, json={"destination": "elsewhere"}, headers=auth("a_owner")).status_code == 422


def test_confirm_needs_the_consent_source_then_gives_the_plan_card_and_delete_ends_it() -> None:
    client, _ = world()
    card = preview_of(client)
    url = f"{BASE}/imports/{card['import_id']}"
    refused = client.post(f"{url}/confirm", json={}, headers=auth("a_owner"))
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "consent_source_required"
    done = client.post(f"{url}/confirm", json={"consent_source": "walk_in"}, headers=auth("a_owner"))
    assert done.status_code == 200, done.text
    plan = done.json()["plan"]
    assert plan["steps"][0]["tool"] == "lead-imports.import_leads" and plan["status"] == "proposed"
    assert client.get(url, headers=auth("a_owner")).json()["state"] == "importing"
    assert client.post(f"{url}/confirm", json={"consent_source": "walk_in"}, headers=auth("a_owner")).status_code == 409
    assert client.delete(url, headers=auth("a_owner")).status_code == 204
    assert client.get(url, headers=auth("a_owner")).status_code == 404


def test_a_handwritten_page_read_by_the_ai_has_every_cell_marked_unsure() -> None:
    client, _ = world(None, {"text": "Ravi Kumar 98765 43210\nAnita Devi 91234 56789\n"})
    f = fid(client, "list.png", png(), "image/png")
    cards = cards_of(turn(client, "add these", [f]))
    assert cards and cards[0]["version"] == 2 and cards[0]["read_by"] == "ai_handwriting"
    assert cards[0]["rows"] and all(c["unsure"] for r in cards[0]["rows"] for c in r["cells"].values()), "the owner always reviews a handwritten page"
    assert cards[0]["counts"]["unsure"] == cards[0]["counts"]["rows"]


def test_a_photo_read_by_local_ocr_marks_only_the_doubtful_cells() -> None:
    client, _ = world(FakeLocal(ocr="Rav1 Kumar 98765 43210\nAnita Devi 91234 56789\n"))
    f = fid(client, "list.png", png("Ravi"), "image/png")
    cards = cards_of(turn(client, "add these", [f]))
    assert cards and cards[0]["read_by"] == "local_ocr"
    flat = [c for r in cards[0]["rows"] for c in r["cells"].values()]
    assert any(c["unsure"] for c in flat) and any(not c["unsure"] for c in flat)


def test_a_program_or_a_file_with_macros_is_not_kept_and_the_limit_is_15_mb() -> None:
    import io
    import zipfile

    client, _ = world()
    exe = client.post(f"{BASE}/files", json={"name": "list.pdf", "content_type": "application/pdf", "size_bytes": 4, "data_base64": base64.b64encode(b"MZ\x90\x00 pdf").decode()}, headers=auth("a_owner"))
    assert exe.status_code == 422 and exe.json()["error"]["code"] == "file_unsafe", exe.text
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/vbaProject.bin", b"macros")
    macro = client.post(f"{BASE}/files", json={"name": "leads.xlsx", "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "size_bytes": 10, "data_base64": base64.b64encode(out.getvalue()).decode()}, headers=auth("a_owner"))
    assert macro.status_code == 422 and macro.json()["error"]["code"] == "file_unsafe"
    from app.assistant_work.files import MAX_FILE_BYTES

    assert MAX_FILE_BYTES == 15_000_000
    assert fid(client, "ok.csv", b"Name,Mobile\nA,9876543210\n", "text/csv")
