# ruff: noqa: E501
"""Job BG: the scripted development model has a catalogue path, so an Ask about sarees can be tried end to end (and the real-stack e2e can prove an answer with a saree link)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.agents.llm.interface import LlmRequest
from app.assistant import prompts
from app.assistant.dev_model import DevAssistantModel, catalogue_args
from app.assistant.router import CATALOGUE_TOOLS, CORE, offered_tools
from app.assistant.tools import TOOLS, Item
from app.catalogue.vocab import COLOURS, FABRIC_ALIASES

NOW = datetime(2026, 10, 11, 9, 0, tzinfo=UTC)
DELIMITER = "ab12cd34ef56"


def request(question: str, *, results: list[Any] | None = None, offered: frozenset[str] | None = None, turn: int = 1) -> LlmRequest:
    return prompts.build_request(
        turn=turn,
        delimiter=DELIMITER,
        question=question,
        language="en",
        history=[],
        results=results or [],
        notes=[],
        today=NOW,
        max_output_tokens=1500,
        offered=offered_tools(question) if offered is None else offered,
    )


@pytest.mark.parametrize(
    ("question", "args"),
    [
        ("Show me a maroon saree", {"colour": "maroon"}),
        ("Show me a maroon Kanchi pattu saree", {"colour": "maroon", "fabric": "kanchi pattu"}),
        ("send me photos of the green sarees", {"colour": "green"}),
        ("do we have any soft silk in stock?", {"fabric": "soft silk"}),
        ("Show me the catalogue", {}),
        ("what pictures do we have", {}),
    ],
)
def test_a_question_about_sarees_looks_in_the_catalogue(question: str, args: dict[str, str]) -> None:
    response = DevAssistantModel().complete(request(question))
    [call] = response.tool_calls
    assert call.name == "find_catalogue_items"
    assert dict(call.arguments) == args


@pytest.mark.parametrize(
    ("question", "tool"),
    [
        ("What needs me today?", "get_today"),
        ("what is the price of this saree", "find_price"),
        ("who hasn't paid on my orders", "list_orders"),
        ("which follow ups are due", "list_followups"),
    ],
)
def test_other_questions_are_not_taken_to_the_catalogue(question: str, tool: str) -> None:
    assert not (offered_tools(question) & CATALOGUE_TOOLS), "these questions do not offer the catalogue"
    [call] = DevAssistantModel().complete(request(question)).tool_calls
    assert call.name == tool


def test_the_catalogue_is_looked_up_only_when_it_was_offered() -> None:
    # the runner refuses a call to a tool that was not offered; the scripted model does not ask for one
    response = DevAssistantModel().complete(request("Show me a maroon saree", offered=CORE))
    [call] = response.tool_calls
    assert call.name != "find_catalogue_items"


def test_the_arguments_are_only_words_the_find_tool_accepts() -> None:
    for colour in COLOURS:
        assert catalogue_args(f"show {colour} sarees")["colour"] == colour
    for alias in FABRIC_ALIASES:
        assert catalogue_args(f"show {alias.replace('_', ' ')} sarees")["fabric"] in {a.replace("_", " ") for a in FABRIC_ALIASES}
    assert catalogue_args("bluebird sarees") == {}, "a colour is a whole word"


def test_the_answer_cites_the_saree_it_found() -> None:
    item = Item("s1", "catalogue_item", uuid.UUID(int=7), "Maroon Kanchi pattu", {"fabric": "Kanchi pattu", "colours": "maroon, gold"})
    block = prompts.result_block(DELIMITER, "find_catalogue_items", "ok", [item])
    final = DevAssistantModel().complete(request("Show me a maroon saree", results=[block], turn=2))
    assert final.tool_calls == ()
    assert final.structured is not None
    assert final.structured["kind"] == "answer" and final.structured["sources"] == ["s1"]
    assert "Maroon Kanchi pattu" in final.structured["answer"]


def test_nothing_found_is_said_plainly() -> None:
    block = prompts.result_block(DELIMITER, "find_catalogue_items", "no_matching_items", [])
    final = DevAssistantModel().complete(request("Show me a maroon saree", results=[block], turn=2))
    assert final.structured is not None and final.structured["kind"] == "refusal" and final.structured["sources"] == []


def test_the_tool_exists_in_the_registry_with_the_arguments_the_model_sends() -> None:
    spec = next(t for t in TOOLS if t.name == "find_catalogue_items")
    parsed = spec.args.model_validate(catalogue_args("Show me a maroon Kanchi pattu saree")).model_dump()
    assert parsed["colour"] == "maroon" and parsed["fabric"] == "kanchi pattu"
