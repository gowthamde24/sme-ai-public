"""The assistant does the work, A2: the file path end to end (owner, 4 Nov 2026): a file dropped in the chat -> what it is -> the lead import's own read and preview (rules and the AI column matcher, the
dedupe) -> the preview card with its plan -> "Do it" (the import route, with the person's token) -> Undo (the import's own undo route). Against fakes: the real application and its routes, an in-memory
database side (tests/aw_fakes.py; the real rules are supabase/tests/database/155_aw_files_plans.test.sql), no model call."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import uuid
from types import SimpleNamespace
from typing import Any

from app.assistant_tools import catalog
from app.assistant_work import files as wf
from app.assistant_work.service import facts_of
from app.lead_sources.service import LeadSourcesService
from tests.aw_fakes import FakeWorkStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.dr_tasks_fakes import Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/assistant"
CSV = "Name,Mob. No.,Email ID,City,Requirement\nRavi Kumar,98765 43210,ravi@example.test,Hyderabad,3BHK near the metro\nAnita,+91 91234 56789,,Guntur,Plot\nBad,12345,,,\nRavi Again,098765-43210,,,Brochure please\nNo number,,,,\n"
PRICES = "Item,Rate,Stock\nKanjivaram red,12000,4\nSoft silk green,6500,9\n"


class AskedMatcher:
    """The AI column matcher, recorded: it sees the headers it could not place and a few samples, never the file."""

    def __init__(self) -> None:
        self.asked: list[list[str]] = []

    def match(self, token: str, tenant_id: uuid.UUID, columns: list[Any], free: list[str]) -> dict[int, str]:
        self.asked.append([c.header for c in columns])
        return {}


MATCHER = AskedMatcher()


def world() -> tuple[Any, Scripted, FakeWorkStore, FakeLeadSourcesRepository]:
    llm = Scripted()
    db = FakeTurnDb()
    store = FakeWorkStore()
    repo = FakeLeadSourcesRepository()
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, lead_sources=LeadSourcesService(repo, receiver=Receiver(), matcher=MATCHER), assistant_work=store)  # type: ignore[arg-type]
    return client, llm, store, repo


def drop(client: Any, name: str, data: str | bytes, user: str = "a_owner", content_type: str = "text/csv") -> Any:
    raw = data.encode() if isinstance(data, str) else data
    return client.post(f"{BASE}/files", json={"name": name, "content_type": content_type, "size_bytes": len(raw), "data_base64": base64.b64encode(raw).decode()}, headers=auth(user))


def events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    assert response.status_code == 200, response.text
    out: list[tuple[str, dict[str, Any]]] = []
    for block in response.text.strip().split("\n\n"):
        lines = block.split("\n")
        out.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return out


def turn(client: Any, text: str, files: list[str], *, user: str = "a_owner", conversation: uuid.UUID | None = None, message: uuid.UUID | None = None) -> list[tuple[str, dict[str, Any]]]:
    body = {"message_id": str(message or uuid.uuid4()), "conversation_id": str(conversation) if conversation else None, "text": text, "attachment_ids": files}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth(user)))


def text_of(evs: list[tuple[str, dict[str, Any]]]) -> str:
    return "".join(d["delta"] for n, d in evs if n == "text").strip()


def cards_of(evs: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    return [d["card"] for n, d in evs if n == "work_card"]


def offered(client: Any, user: str = "a_owner") -> tuple[dict[str, Any], list[tuple[str, dict[str, Any]]]]:
    f = drop(client, "march leads.csv", CSV, user)
    assert f.status_code == 201, f.text
    evs = turn(client, "add these to my leads", [f.json()["file_id"]], user=user)
    cards = cards_of(evs)
    assert len(cards) == 1, [n for n, _ in evs]
    return cards[0], evs


# ---------------------------------------------------------------------------------------------------------------------------------- 1. the drop
def test_a_file_is_taken_by_its_kind_and_refused_plainly_otherwise() -> None:
    client, _, store, _ = world()
    ok = drop(client, "C:\\Users\\me\\march leads.csv", CSV)
    assert ok.status_code == 201 and ok.json()["kind"] == "sheet" and ok.json()["name"] == "march leads.csv" and ok.json()["size_bytes"] == len(CSV.encode())
    assert drop(client, "contacts.vcf", "BEGIN:VCARD\nFN:Ravi\nTEL:9876543210\nEND:VCARD\n", content_type="text/vcard").json()["kind"] == "contacts"
    assert drop(client, "brochure.csv", b"%PDF-1.7 fake", content_type="application/pdf").json()["kind"] == "pdf", "the first bytes win over a wrong name"
    bad = drop(client, "setup.exe", b"MZ\x90\x00", content_type="application/octet-stream")
    assert bad.status_code == 415 and bad.json()["error"]["code"] == "file_type"
    empty = drop(client, "x.csv", b"")
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "file_empty"
    assert drop(client, "x.csv", CSV, user="a_viewer").status_code == 403, "a Viewer drops no file"
    big = client.post(f"{BASE}/files", json={"name": "big.csv", "content_type": "text/csv", "size_bytes": 1, "data_base64": base64.b64encode(b"a" * (wf.MAX_FILE_BYTES + 1)).decode()}, headers=auth("a_owner"))
    assert big.status_code in (413, 422), big.text
    assert all(f["by"] == "a_owner" for f in store.files.values())


# ---------------------------------------------------------------------------------------------------------------------------------- 2. the turn: what it is, the preview, the plan; nothing written
def test_a_lead_list_becomes_the_preview_card_with_its_plan_and_nothing_is_written() -> None:
    client, llm, store, repo = world()
    card, evs = offered(client)
    assert card["kind"] == "file_preview" and card["destination"] == "leads" and card["file_name"] == "march leads.csv"
    facts = {f["code"]: f["n"] for f in card["facts"]}
    assert facts["found"] == 2 and facts["existing"] == 0 and facts.get("no_phone", 0) >= 1, facts
    assert card["columns"][:2] == ["Name", "Mob. No."] and card["rows"][0][:2] == ["Ravi Kumar", "98765 43210"], "the sample, as written in the file"
    plan = card["plan"]
    assert plan["status"] == "proposed" and plan["title"] == "Add 2 leads from 'march leads.csv'" and plan["sensitive"] is None and not plan["owner_only"]
    assert [s["tool"] for s in plan["steps"]] == ["lead-imports.import_leads"] and plan["steps"][0]["undoable"] is True
    assert "call" not in plan["steps"][0] and "undo" not in plan["steps"][0], "the card never shows a step's arguments"
    assert "2 new" in text_of(evs) and "Nobody is sent anything" in text_of(evs)
    assert ("intent", {"type": "intent", "kind": "action"}) in evs
    assert llm.requests == [], "no model call: code decides what the file is"
    assert repo.parts == {}, "the preview writes nothing (a dry run)"
    assert "content_base64" not in json.dumps(store.plans), "the plan keeps no file bytes"


def test_the_turn_answers_in_the_owners_language() -> None:
    client, _, _, _ = world()
    f = drop(client, "march leads.csv", CSV).json()["file_id"]
    evs = events(client.post(f"{BASE}/turns", json={"message_id": str(uuid.uuid4()), "conversation_id": None, "text": "ఇవి లీడ్స్‌లో చేర్చు", "attachment_ids": [f], "language": "te"}, headers=auth("a_owner")))
    assert "చేర్చమంటారా" in text_of(evs) and cards_of(evs)[0]["plan"] is not None


# ---------------------------------------------------------------------------------------------------------------------------------- 3. Do it
def test_do_it_runs_the_import_once_logs_it_and_deletes_the_file() -> None:
    client, _, store, repo = world()
    card, _ = offered(client)
    pid = card["plan"]["plan_id"]
    done = client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner"))
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "done" and done.json()["steps"][0]["status"] == "done" and done.json()["steps"][0]["error"] is None
    assert len(repo.parts) == 1 and next(iter(repo.parts.values()))["out"]["counts"]["ready"] == 2, "the import route ran, for real"
    assert store.files == {}, "the file is deleted once its plan ran"
    action = store.actions[0]
    assert action["tool"] == "lead-imports.import_leads" and action["status"] == "done" and action["changed"]["leads_added"] == 2
    assert action["undo"]["kind"] == "inverse" and action["undo"]["tool"] == "lead-imports.undo_import" and action["undo"]["path"]["import_id"] == action["changed"]["import_id"]
    again = client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "plan_state", "a second tap runs nothing"
    assert len(repo.parts) == 1


def test_cancel_runs_nothing_and_deletes_the_file() -> None:
    client, _, store, repo = world()
    card, _ = offered(client)
    out = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/decide", json={"decision": "cancel"}, headers=auth("a_owner"))
    assert out.status_code == 200 and out.json()["status"] == "cancelled"
    assert repo.parts == {} and store.files == {} and store.actions == []


# ---------------------------------------------------------------------------------------------------------------------------------- 4. Undo
def test_undo_archives_what_the_import_created_through_its_own_route() -> None:
    client, _, store, repo = world()
    card, _ = offered(client)
    pid = card["plan"]["plan_id"]
    client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do"}, headers=auth("a_owner"))
    undone = client.post(f"{BASE}/plans/{pid}/undo", headers=auth("a_owner"))
    assert undone.status_code == 200, undone.text
    assert undone.json()["status"] == "undone" and undone.json()["steps"][0]["status"] == "undone"
    assert "import_undo" in repo.calls and store.actions[0]["status"] == "undone"
    twice = client.post(f"{BASE}/plans/{pid}/undo", headers=auth("a_owner"))
    assert twice.status_code == 409


def test_a_sales_member_imports_but_only_the_owner_or_an_admin_undoes_an_import() -> None:
    client, _, _, repo = world()
    card, _ = offered(client, user="a_sales")
    pid = card["plan"]["plan_id"]
    assert client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do"}, headers=auth("a_sales")).json()["status"] == "done"
    refused = client.post(f"{BASE}/plans/{pid}/undo", headers=auth("a_sales"))
    assert refused.status_code == 403 and "import_undo" not in repo.calls, "archiving is the Owner's or an Admin's: the route itself refuses"
    assert client.post(f"{BASE}/plans/{pid}/undo", headers=auth("a_owner")).json()["status"] == "undone"


def test_the_import_route_declares_its_undo_in_the_catalogue() -> None:
    client, _, _, _ = world()
    decisions = {d.op.name: d for d in catalog.decide(catalog.operations(client.app.openapi()))}
    imp = decisions["lead-imports.import_leads"]
    assert imp.tool and imp.level == "write" and imp.undo == "inverse" and imp.undo_via == "lead-imports.undo_import"
    assert decisions["lead-imports.undo_import"].tool
    for name in ("assistant.drop_file", "assistant.decide_plan", "assistant.undo_plan", "assistant.get_plan"):
        assert not decisions[name].tool and decisions[name].screen_only == "assistant_itself", name


# ---------------------------------------------------------------------------------------------------------------------------------- what is not a lead list, and other people's files
def test_a_price_list_a_brochure_and_someone_elses_file_get_plain_answers() -> None:
    client, _, store, _ = world()
    prices = drop(client, "rates.csv", PRICES).json()["file_id"]
    card = cards_of(evs := turn(client, "add this", [prices]))
    assert card and card[0]["kind"] == "cant_do" and card[0]["reason"] == "not_yet" and "price list" in card[0]["what"] and "price list" in text_of(evs)
    assert ["Item", "Rate", "Stock"] in MATCHER.asked, "the AI column matcher was asked about the columns the rules could not place"
    pdf = drop(client, "brochure.pdf", b"%PDF-1.7 fake", content_type="application/pdf").json()["file_id"]
    card = cards_of(turn(client, "add this", [pdf]))
    assert card[0]["kind"] == "cant_do" and card[0]["screen"]["href"].startswith("/")
    theirs = drop(client, "march leads.csv", CSV, user="a_sales").json()["file_id"]
    evs = turn(client, "add this", [theirs])
    assert cards_of(evs) == [] and "no longer here" in text_of(evs), "only the person who dropped a file reads it"
    assert store.plans == {}


def test_two_files_in_one_message_get_a_card_each() -> None:
    client, _, _, _ = world()
    a = drop(client, "march leads.csv", CSV).json()["file_id"]
    b = drop(client, "rates.csv", PRICES).json()["file_id"]
    kinds = [c["kind"] for c in cards_of(turn(client, "add these", [a, b]))]
    assert kinds == ["file_preview", "cant_do"]


def test_a_replay_and_the_stored_chat_show_the_card_in_its_state_now() -> None:
    client, _, _, _ = world()
    f = drop(client, "march leads.csv", CSV).json()["file_id"]
    conversation, message = uuid.uuid4(), uuid.uuid4()
    first = cards_of(turn(client, "add these", [f], conversation=conversation, message=message))[0]
    client.post(f"{BASE}/plans/{first['plan']['plan_id']}/decide", json={"decision": "do"}, headers=auth("a_owner"))
    again = cards_of(turn(client, "add these", [f], conversation=conversation, message=message))
    assert again and again[0]["id"] == first["id"] and again[0]["plan"]["status"] == "done" and again[0]["rows"] == [], "the replay reads the plan now; the rows are not kept"
    stored = client.get(f"{BASE}/conversations/{conversation}", headers=auth("a_owner")).json()
    cards = [c for m in stored["messages"] for c in m.get("work_cards") or []]
    assert len(cards) == 1 and cards[0]["plan"]["status"] == "done"


# ---------------------------------------------------------------------------------------------------------------------------------- the plan's rules
def test_a_sensitive_plan_needs_the_second_tap_and_the_owner() -> None:
    client, _, store, _ = world()
    card, _ = offered(client)
    plan = store.plans[card["plan"]["plan_id"]]
    plan["sensitive"], plan["owner_only"] = "money", True
    pid = plan["plan_id"]
    assert client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do", "confirmed": True}, headers=auth("a_admin")).status_code == 403
    need = client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do", "confirmed": False}, headers=auth("a_owner"))
    assert need.status_code == 409 and need.json()["error"]["code"] == "confirm_needed"
    assert client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do", "confirmed": True}, headers=auth("a_owner")).json()["status"] == "done"


def test_an_expired_plan_does_not_run() -> None:
    client, _, store, repo = world()
    card, _ = offered(client)
    store.plans[card["plan"]["plan_id"]]["expires_at"] = "2026-01-01T00:00:00+00:00"
    out = client.post(f"{BASE}/plans/{card['plan']['plan_id']}/decide", json={"decision": "do"}, headers=auth("a_owner"))
    assert out.status_code == 409 and out.json()["error"]["code"] == "plan_expired" and repo.parts == {}


def test_the_facts_by_closed_code() -> None:
    facts = facts_of({"ready": 34, "duplicates_merged": 3, "already_imported": 1, "duplicates_in_file": 2, "invalid": 3}, [{"row": 4, "reason": "no_contact_way"}, {"row": 5, "reason": "invalid_number"}, {"row": 9, "reason": "row_refused"}], 40)
    assert facts == [{"code": "found", "n": 38}, {"code": "existing", "n": 4}, {"code": "no_phone", "n": 2}, {"code": "duplicate", "n": 2}, {"code": "unreadable", "n": 1}]


def test_the_facts_split_every_refused_row_though_the_import_names_at_most_50() -> None:
    named = [{"row": i, "reason": "no_contact_way"} for i in range(40)] + [{"row": 100 + i, "reason": "row_refused"} for i in range(10)]
    facts = {f["code"]: f["n"] for f in facts_of({"ready": 4400, "invalid": 200}, named, 5000)}
    assert facts["no_phone"] == 160 and facts["unreadable"] == 40


def test_the_kind_of_a_file() -> None:
    assert wf.kind_of("leads.xlsx", "application/octet-stream", b"PK\x03\x04") == "sheet"
    assert wf.kind_of("x", "image/png", b"\x89PNG") == "image"
    assert wf.kind_of("notes.txt", "text/plain", b"Ravi 98765 43210") == "text"
    assert wf.kind_of("a.bin", "application/octet-stream", b"\x00\x01") is None
    assert wf.clean_name("../../etc/passwd\x00") == "passwd"
