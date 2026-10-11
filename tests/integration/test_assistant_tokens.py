"""Job AO: how big is the model's input for one question? The Main agent runs on free tiers that allow a few thousand tokens a minute, so one question (all its model calls) must fit.

The five questions of `make assistant-smoke` plus a chat with history are asked through the real application on the local stack with the development stand-in model, and every request the model
is shown is measured: the text of every block plus the tool definitions, in bytes, and an ESTIMATE of tokens (bytes / 4; no tokenizer is shipped, a real model's count differs a little but
moves the same way). `pytest -s` prints the table. The ceilings below are what job AO brought it down to (it was about 4,400 to 4,850 per question and 2,150 to 2,670 per call before); a change that makes the requests bigger again fails here."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import math
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from assistant_support import assistant_app, conversation_of, enable_assistant, events, restore
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient
from test_today_api import Scene

from app.agents.llm.interface import LlmRequest, LlmResponse
from app.assistant.dev_model import DevAssistantModel

QUESTIONS = {
    "today": "What needs me today?",
    "unpaid": "Who hasn't paid?",
    "price": "Price 50 sarees, temple border",
    "telugu": "Draft a reply to the waiting customer in Telugu",
    "enquiry": "What does the newest enquiry say?",
}
# ceilings in ESTIMATED tokens: a whole question (all its model calls), and one call
# job AS added ONE tool (propose_visit: 77 estimated tokens, sent with each of the two calls = +154 a question); the ceiling went from 3400 to 3450 for exactly that. The tool is kept to three small
# fields for this reason. Anything beyond it fails here.
QUESTION_CEILING = 3450
CALL_CEILING = 2000


def size_bytes(request: LlmRequest) -> int:
    total = sum(len(b.text.encode("utf-8")) for b in request.blocks)
    for tool in (*request.tools, *([request.final_result] if request.final_result else [])):
        total += len(
            json.dumps([tool.name, tool.description, tool.input_schema], ensure_ascii=False).encode(
                "utf-8"
            )
        )
    return total


def tokens(n_bytes: int) -> int:
    return math.ceil(n_bytes / 4)


class Recording(DevAssistantModel):
    def __init__(self) -> None:
        self.sizes: list[int] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.sizes.append(size_bytes(request))
        return super().complete(request)


@pytest.fixture(scope="module")
def recorder() -> Recording:
    return Recording()


@pytest.fixture(scope="module")
def app(stack: Any, recorder: Recording) -> Iterator[TestClient]:
    yield from assistant_app(stack, lambda: recorder)


@pytest.fixture(scope="module")
def scene(eval_world: World, client: TestClient) -> Iterator[Scene]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield Scene(eval_world, client)
    finally:
        restore(saved)


def ask(
    app: TestClient, scene: Scene, text: str, conversation: str | None = None
) -> list[tuple[str, Any]]:
    body: dict[str, Any] = {"message_id": str(uuid.uuid4()), "text": text}
    if conversation:
        body["conversation_id"] = conversation
    r = app.post(
        f"/v1/tenants/{scene.a.id}/assistant/messages",
        json=body,
        headers=bearer(scene.a.users["owner"]),
    )
    assert r.status_code == 200, r.text
    return events(r)


def test_one_question_fits_a_free_tier_per_minute_budget(
    app: TestClient, scene: Scene, recorder: Recording
) -> None:
    rows: list[tuple[str, int, int, int]] = []
    conversation: str | None = None
    for key, text in QUESTIONS.items():
        recorder.sizes.clear()
        evts = ask(app, scene, text, conversation)
        assert evts[-1][0] == "done", (key, evts[-1])
        if key == "today":
            conversation = conversation_of(evts)  # the later questions of the chat carry its history
        sizes = list(recorder.sizes)
        rows.append((key, len(sizes), tokens(sum(sizes)), tokens(max(sizes))))
    print("\nTOKENS per question (estimate = bytes / 4):")
    for key, calls, total, biggest in rows:
        print(f"TOKENS {key:8} calls={calls} total={total:5} biggest_call={biggest:5}")
    for key, _calls, total, biggest in rows:
        assert total <= QUESTION_CEILING, (key, total)
        assert biggest <= CALL_CEILING, (key, biggest)
