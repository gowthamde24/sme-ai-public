"""Teach this (13 Nov 2026): a corrected answer on one line of a call or a chat becomes a fact in the owner's words, with an undo. Fakes only."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

from app.crm.repository import NotFoundError
from app.knowledge.service import KnowledgeService
from tests.dr_fakes import FakeKnowledgeRepository
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/knowledge"
CALL = "11111111-1111-4111-8111-111111111111"
CHAT = "22222222-2222-4222-8222-222222222222"
LINES = [SimpleNamespace(who="caller", text="Do you have red sarees?"), SimpleNamespace(who="assistant", text="No, sorry.")]


def world() -> tuple[Any, FakeKnowledgeRepository]:
    repo = FakeKnowledgeRepository()

    def get(token: str, tenant: uuid.UUID, call_id: uuid.UUID) -> Any:
        if str(call_id) != CALL:
            raise NotFoundError("23503")
        return SimpleNamespace(transcript=LINES)

    def thread(token: str, tenant: uuid.UUID, lead: uuid.UUID, limit: int, before: Any) -> dict[str, Any]:
        if str(lead) != CHAT:
            raise NotFoundError("23503")
        return {"items": [{"text": "hi"}, {"text": "hello"}]}

    client, _ = make_client(knowledge=KnowledgeService(repo), calls=SimpleNamespace(get=get), whatsapp=SimpleNamespace(repository=SimpleNamespace(conversation_thread=thread)))
    return client, repo


def body(**over: Any) -> dict[str, Any]:
    return {"source": "call", "source_id": CALL, "line_index": 1, "corrected_answer": "Yes, we have red sarees in stock every week.", **over}


def test_a_corrected_line_of_a_call_becomes_an_approved_fact() -> None:
    client, repo = world()
    r = client.post(f"{URL}/corrections", json=body(), headers=auth("a_owner"))
    assert r.status_code == 201, r.text
    got = r.json()
    assert got["state"] == "saved" and got["kind"] == "faq" and got["text"] == "Yes, we have red sarees in stock every week."
    assert [f["text"] for f in repo.approved("t", TENANT_A.id)] == ["Yes, we have red sarees in stock every week."], "the assistant may state it now"


def test_the_same_correction_twice_changes_nothing_and_another_wording_is_another_fact() -> None:
    client, repo = world()
    a = client.post(f"{URL}/corrections", json=body(), headers=auth("a_admin")).json()
    b = client.post(f"{URL}/corrections", json=body(), headers=auth("a_admin")).json()
    assert a["id"] == b["id"] and len(repo.facts_) == 1
    c = client.post(f"{URL}/corrections", json=body(corrected_answer="We stock red sarees every week."), headers=auth("a_admin")).json()
    assert c["id"] != a["id"] and len(repo.facts_) == 2


def test_an_answer_that_states_an_amount_waits_for_the_owner() -> None:
    client, repo = world()
    r = client.post(f"{URL}/corrections", json=body(corrected_answer="A red silk saree starts at Rs. 4500."), headers=auth("a_owner")).json()
    assert r["state"] == "waiting_for_owner" and r["kind"] == "price"
    assert repo.approved("t", TENANT_A.id) == [], "a price is not used until the Owner approves it with a second factor"


def test_undo_takes_it_back_and_is_safe_to_repeat() -> None:
    client, repo = world()
    made = client.post(f"{URL}/corrections", json=body(), headers=auth("a_owner")).json()
    for _ in range(2):
        undone = client.post(f"{URL}/corrections/{made['id']}/undo", headers=auth("a_owner"))
        assert undone.status_code == 200 and undone.json()["state"] == "undone"
    assert repo.approved("t", TENANT_A.id) == []
    assert client.post(f"{URL}/corrections/not-an-id/undo", headers=auth("a_owner")).status_code == 404


def test_the_line_must_exist_and_be_the_assistants_own() -> None:
    client, _ = world()
    assert client.post(f"{URL}/corrections", json=body(line_index=0), headers=auth("a_owner")).json()["error"]["code"] == "not_an_answer"
    assert client.post(f"{URL}/corrections", json=body(line_index=9), headers=auth("a_owner")).json()["error"]["code"] == "line_not_found"
    assert client.post(f"{URL}/corrections", json=body(source_id=CHAT), headers=auth("a_owner")).status_code == 404, "a call that is not this business's"
    chat = client.post(f"{URL}/corrections", json=body(source="chat", source_id=CHAT, line_index=1), headers=auth("a_owner"))
    assert chat.status_code == 201
    assert client.post(f"{URL}/corrections", json=body(source="chat", source_id=CHAT, line_index=5), headers=auth("a_owner")).json()["error"]["code"] == "line_not_found"


def test_owner_and_admin_only_and_a_strict_body() -> None:
    client, repo = world()
    for user in ("a_sales", "a_viewer"):
        assert client.post(f"{URL}/corrections", json=body(), headers=auth(user)).status_code == 403
    assert client.post(f"{URL}/corrections", json=body()).status_code == 401
    assert client.post(f"{URL}/corrections", json=body(extra=1), headers=auth("a_owner")).status_code == 422
    assert client.post(f"{URL}/corrections", json=body(corrected_answer="see https://x.example"), headers=auth("a_owner")).status_code == 422
    assert client.post(f"{URL}/corrections", json=body(source="email"), headers=auth("a_owner")).status_code == 422
    assert repo.facts_ == {}
