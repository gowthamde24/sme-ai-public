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
# job BB: the router offers the catalogue tools only to a question about photos, designs, colours, fabrics or stock, and the visit tool only to a question about a visit; everything else is described with the
# core tools alone. So the ceilings are PER PATH, and each is strict (about 3% over what was measured): a change that makes the base path bigger again fails here.
PATH_QUESTIONS: dict[str, dict[str, str]] = {
    "base": QUESTIONS,
    "catalogue": {
        "photos": "Send photos of the maroon Kanchi pattu to Ravi",
        "show": "Show me red sarees",
    },
    "visits": {"book": "Book a visit for Lakshmi tomorrow at 11:00"},
    "both": {"both": "Book a visit for Ravi and send him photos of the Kanchi pattu"},
}
# ceilings in ESTIMATED tokens, PER PATH: (a whole question = all its model calls, one call)
# history: before job BB every question carried every tool: 3,705 to 3,986 a question and 1,855 to 2,190 a call (job AY: +2 catalogue tools = +600 a question over job AS's 3,450;
# job AS: +1 visit tool = +154). Job BB, measured: core 2,982 to 3,263 a question and 1,494 to 1,829 a call; catalogue 3,679 to 3,693 and 2,037 to 2,044; visits 3,277 and 1,836; both 3,855 and 2,125.
# Night merge 25 Oct (job DG put `get_figures` in the CORE tools, offered to every question): core 3,275 to 3,556 a question and 1,640 to 1,975 a call; visits 3,569 and 1,982 (catalogue and both did not grow past their ceilings).
# The base and visits ceilings are raised to those numbers + about 3%; whether `get_figures` should be routed like the catalogue tools (only for fees, dues and trips) is the owner's call, see night-report.md.
# 1 Nov 2026: the zero rule ("never read out a zero", ~31 tokens in every call, ~62 a question of two calls) is the owner's: all four ceilings go up by 70 a question and 40 a call (the rule cost, measured).
PATH_CEILINGS: dict[str, tuple[int, int]] = {
    "base": (3730, 2080),
    "catalogue": (3850, 2140),
    "visits": (3750, 2090),
    "both": (4020, 2220),
}


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
    rows: list[tuple[str, str, int, int, int]] = []
    first_call: dict[tuple[str, str], int] = {}  # the FIRST model call of a question (tools described, no tool results yet), in estimated tokens
    conversation: str | None = None
    for path, questions in PATH_QUESTIONS.items():
        for key, text in questions.items():
            recorder.sizes.clear()
            # the later base questions continue the chat of the first, so they carry its history
            evts = ask(app, scene, text, conversation if path == "base" else None)
            assert evts[-1][0] == "done", (key, evts[-1])
            if key == "today":
                conversation = conversation_of(evts)
            sizes = list(recorder.sizes)
            first_call[(path, key)] = tokens(sizes[0])
            rows.append((path, key, len(sizes), tokens(sum(sizes)), tokens(max(sizes))))
    print("\nTOKENS per question (estimate = bytes / 4):")
    for path, key, calls, total, biggest in rows:
        print(f"TOKENS {path:9} {key:8} calls={calls} total={total:5} biggest_call={biggest:5}")
    for path, key, _calls, total, biggest in rows:
        question_ceiling, call_ceiling = PATH_CEILINGS[path]
        assert total <= question_ceiling, (path, key, total)
        assert biggest <= call_ceiling, (path, key, biggest)
    # the router really offers less on the base path: a path that offers more tools costs more on average (a router that offered everything everywhere would make all four equal)
    mean_of = {
        p: sum(t for pp, _k, _c, t, _b in rows if pp == p) / len([r for r in rows if r[0] == p])
        for p in PATH_QUESTIONS
    }
    assert mean_of["base"] < mean_of["visits"] < mean_of["catalogue"] < mean_of["both"], mean_of
    # The catalogue tools are about 300 tokens in every call that describes them (600 a question of two calls). That is measured on the first call (the definitions and the question, no tool results yet): the total also holds the size of
    # what the scripted model's first tool returned, and since job BG it looks sarees up for a catalogue question (a small result) instead of reading Today (a big one), which would hide the definitions' cost.
    cost = first_call[("catalogue", "photos")] - first_call[("base", "today")]
    assert cost > 200, ("the catalogue tools are about 300 tokens a call", cost)
