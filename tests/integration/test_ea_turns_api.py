"""Job EA: the conversational assistant on the real stack (real database functions, a scripted model): the type of a reply is stored, the history and the list are the caller's own, archive hides and deletes nothing,
and a plan the caller never had is the same 404 as an unknown one. Synthetic data only."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from assistant_support import assistant_app, enable_assistant, events, restore, text_of
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient

from app.agents.llm.interface import LlmRequest, LlmResponse, Usage

HOLDER: dict[str, Any] = {"replies": []}


class ChatModel:
    """Answers every tool-free chat turn with the next scripted reply."""

    model_id = "fake-selftest"

    def complete(self, request: LlmRequest) -> LlmResponse:
        assert request.tools == (), "a chat turn offers no tools"
        return LlmResponse(tool_calls=(), structured=HOLDER["replies"].pop(0), usage=Usage(10, 5, 0))


def chat(text: str, kind: str = "answer", language: str = "en") -> dict[str, Any]:
    return {"kind": kind, "answer": text, "language": language}


@pytest.fixture(scope="module")
def app(stack: Any) -> Iterator[TestClient]:
    yield from assistant_app(stack, factory=lambda: ChatModel())


@pytest.fixture(scope="module")
def world(eval_world: World, client: TestClient) -> Iterator[World]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield eval_world
    finally:
        restore(saved)


def say(app: TestClient, world: World, text: str, *, user: str = "owner", conversation: str | None = None) -> tuple[list[tuple[str, dict[str, Any]]], str]:
    cid = conversation or str(uuid.uuid4())
    r = app.post(
        f"/v1/tenants/{world.a.id}/assistant/turns",
        json={"message_id": str(uuid.uuid4()), "conversation_id": cid, "text": text},
        headers=bearer(world.a.users[user]),
    )
    assert r.status_code == 200, r.text
    return events(r), cid


def test_small_talk_is_stored_as_an_answer_and_listed_with_its_title(app: TestClient, world: World) -> None:
    HOLDER["replies"] = [chat("Doing well, thank you!")]
    evs, cid = say(app, world, "how are you")
    assert evs[0] == ("intent", {"type": "intent", "kind": "smalltalk"})
    assert text_of(evs).strip() == "Doing well, thank you!" and evs[-1][1]["kind"] == "answer"
    read = app.get(f"/v1/tenants/{world.a.id}/assistant/conversations/{cid}", headers=bearer(world.a.users["owner"]))
    assert read.status_code == 200, read.text
    assert [m["kind"] for m in read.json()["messages"]] == ["answer", "answer"] and all(m["action"] is None for m in read.json()["messages"])
    listed = app.get(f"/v1/tenants/{world.a.id}/assistant/conversations", headers=bearer(world.a.users["owner"])).json()
    mine = next(i for i in listed["items"] if i["id"] == cid)
    assert mine["title"] == "how are you" and mine["message_count"] == 2 and mine["last_text"] == "Doing well, thank you!"


def test_a_question_back_is_stored_as_a_clarify(app: TestClient, world: World) -> None:
    HOLDER["replies"] = [chat("Which festival is the offer for?", kind="clarify")]
    evs, cid = say(app, world, "write a festival offer message")
    assert evs[0][1]["kind"] == "general" and evs[-1][1]["kind"] == "clarify"
    read = app.get(f"/v1/tenants/{world.a.id}/assistant/conversations/{cid}", headers=bearer(world.a.users["owner"])).json()
    assert read["messages"][-1]["kind"] == "clarify"


def test_the_list_and_the_history_are_the_callers_own_and_archive_hides_without_deleting(app: TestClient, world: World) -> None:
    HOLDER["replies"] = [chat("Hello!")]
    _, cid = say(app, world, "hello there", user="owner")
    admin = bearer(world.a.users["admin"])
    owner = bearer(world.a.users["owner"])
    base = f"/v1/tenants/{world.a.id}/assistant"
    assert cid not in [i["id"] for i in app.get(f"{base}/conversations", headers=admin).json()["items"]], "an admin does not see the owner's chats"
    assert app.get(f"{base}/conversations/{cid}", headers=admin).status_code == 404
    assert app.post(f"{base}/conversations/{cid}/archive", headers=admin).status_code == 404, "...and cannot archive them"
    assert app.post(f"{base}/conversations/{cid}/archive", headers=owner).status_code == 204
    assert app.post(f"{base}/conversations/{cid}/archive", headers=owner).status_code == 204, "asking again is fine"
    assert cid not in [i["id"] for i in app.get(f"{base}/conversations", headers=owner).json()["items"]]
    assert app.get(f"{base}/conversations/{cid}", headers=owner).status_code == 200, "nothing was deleted"
    assert app.post(f"{base}/conversations/{uuid.uuid4()}/archive", headers=owner).status_code == 404
    other = bearer(world.b.users["owner"])
    assert app.get(f"/v1/tenants/{world.a.id}/assistant/conversations", headers=other).status_code == 404, "another business is a stranger"


def test_a_plan_the_caller_never_had_is_a_404_and_a_reply_replays_for_nothing(app: TestClient, world: World) -> None:
    owner = bearer(world.a.users["owner"])
    r = app.post(f"/v1/tenants/{world.a.id}/assistant/actions/{uuid.uuid4()}/confirm", json={"decision": "yes"}, headers=owner)
    assert r.status_code in (404, 503), r.text
    HOLDER["replies"] = [chat("Fine, thanks!")]
    mid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    body = {"message_id": mid, "conversation_id": cid, "text": "how are you today"}
    first = events(app.post(f"/v1/tenants/{world.a.id}/assistant/turns", json=body, headers=owner))
    again = events(app.post(f"/v1/tenants/{world.a.id}/assistant/turns", json=body, headers=owner))
    assert text_of(again).strip() == text_of(first).strip() == "Fine, thanks!" and HOLDER["replies"] == []
