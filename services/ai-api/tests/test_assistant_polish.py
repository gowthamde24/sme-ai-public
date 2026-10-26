"""Job AO: an answer about today's list drops nothing, and a question is a small request.

Pure tests: the runner's judgment of a final reply with a scripted state, and the prompt builder. No database, no network."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant import prompts
from app.assistant.language import LANGUAGES, PLAIN_WORDS, WAITING_ALSO
from app.assistant.prompts import FINAL_TURN, FIXED_NOTES, build_request, compact_schema
from app.assistant.runner import MAX_TURNS, AssistantRunner, Reply
from app.assistant.tools import TOOLS, State


def runner_with_today(waiting: int = 3, recent: int = 1) -> tuple[AssistantRunner, State]:
    state = State()
    for n in range(waiting):
        kind, id_ = ["quote", "lead", "order"][n % 3], uuid.uuid4()
        item = state.add(
            kind, id_, f"Customer {n}: thing {n} waits", {"waiting_for_you": "x"}, (kind, id_)
        )
        state.waiting.append(item.handle)
    for n in range(recent):
        id_ = uuid.uuid4()
        item = state.add("order", id_, f"Order {n}: a step", {"recent_step": "x"}, ("order", id_))
        state.today_recent.append(item.handle)
    ctx = SimpleNamespace(run_id=uuid.uuid4(), state=state)
    return AssistantRunner(db=None, llm=None, ctx=ctx), state  # type: ignore[arg-type]


def answer(*handles: str, kind: str = "answer", language: str = "en") -> dict[str, Any]:
    return {
        "kind": kind,
        "answer": PLAIN_WORDS[language],  # type: ignore[index]  # any sentence in the right script
        "language": language,
        "sources": list(handles),
    }


def test_an_answer_that_names_every_waiting_item_is_shown_as_it_is() -> None:
    runner, state = runner_with_today()
    out = runner._judge(answer(*state.waiting), "en", set(), 2)
    assert isinstance(out, Reply) and out.text == PLAIN_WORDS["en"]
    assert [s.id for s in out.sources] == [state.items[h].id for h in state.waiting]


def test_an_answer_that_drops_one_is_asked_again_once() -> None:
    runner, state = runner_with_today()
    repaired: set[str] = set()
    out = runner._judge(answer(*state.waiting[1:]), "en", repaired, 2)
    assert out == prompts.NOTE_REPAIR_COMPLETE and "complete" in repaired
    assert prompts.NOTE_REPAIR_COMPLETE in FIXED_NOTES


def test_if_it_still_drops_one_the_code_adds_it_from_the_tools_own_list() -> None:
    runner, state = runner_with_today()
    out = runner._judge(answer(*state.waiting[1:]), "en", {"complete"}, 3)
    assert isinstance(out, Reply)
    dropped = state.items[state.waiting[0]]
    assert out.text.endswith(f"{WAITING_ALSO['en']} {dropped.label}")
    assert {s.id for s in out.sources} == {state.items[h].id for h in state.waiting}


def test_on_the_last_turn_there_is_no_time_to_ask_so_it_is_added_at_once() -> None:
    runner, state = runner_with_today()
    out = runner._judge(answer(*state.waiting[:1]), "en", set(), MAX_TURNS)
    assert isinstance(out, Reply)
    assert {s.id for s in out.sources} == {state.items[h].id for h in state.waiting}
    assert out.text.count(WAITING_ALSO["en"]) == 1


@pytest.mark.parametrize("language", LANGUAGES)
def test_the_added_line_is_said_in_the_owners_language(language: str) -> None:
    runner, state = runner_with_today()
    out = runner._judge(answer(*state.waiting[1:], language=language), language, {"complete"}, 3)  # type: ignore[arg-type]
    assert isinstance(out, Reply) and WAITING_ALSO[language] in out.text  # type: ignore[index]


def test_an_answer_that_cites_only_recent_steps_is_still_an_answer_about_today() -> None:
    runner, state = runner_with_today()
    out = runner._judge(answer(*state.today_recent), "en", {"complete"}, 3)
    assert isinstance(out, Reply)
    assert {s.id for s in out.sources} >= {state.items[h].id for h in state.waiting}


def test_an_answer_to_another_question_is_left_alone() -> None:
    runner, state = runner_with_today()
    id_ = uuid.uuid4()
    other = state.add("quote", id_, "Quote 9 for Somebody", {"status": "draft"}, ("quote", id_))
    out = runner._judge(answer(other.handle), "en", set(), 2)
    assert isinstance(out, Reply) and out.text == PLAIN_WORDS["en"]
    assert [s.id for s in out.sources] == [other.id]


@pytest.mark.parametrize("kind", ["refusal", "clarify"])
def test_a_refusal_or_a_question_is_left_alone(kind: str) -> None:
    runner, state = runner_with_today()
    out = runner._judge(answer(*state.waiting[:1], kind=kind), "en", set(), 2)
    assert isinstance(out, Reply) and out.text == PLAIN_WORDS["en"]


def test_a_run_that_never_asked_for_today_is_left_alone() -> None:
    runner, state = runner_with_today(waiting=0, recent=0)
    item = state.add("quote", uuid.uuid4(), "Quote 1", {})
    out = runner._judge(answer(item.handle), "en", set(), 2)
    assert isinstance(out, Reply) and out.text == PLAIN_WORDS["en"]


# ---- the request is small
def request(turn: int, history: list[dict[str, Any]] | None = None) -> Any:
    return build_request(
        turn=turn,
        delimiter="ab" * 8,
        question="What needs me today?",
        language="en",
        history=history or [],
        results=[],
        notes=[],
        today=datetime(2026, 10, 10, tzinfo=UTC),
        max_output_tokens=1500,
    )


def test_the_first_turns_offer_every_tool_and_the_answering_turns_only_the_reply_tool() -> None:
    assert [t.name for t in request(1).tools] == [t.name for t in TOOLS]
    assert [t.name for t in request(FINAL_TURN - 1).tools] == [t.name for t in TOOLS]
    for turn in (FINAL_TURN, FINAL_TURN + 1):
        late = request(turn)
        assert (
            late.tools == () and late.final_result is not None and late.final_result.name == "reply"
        )
    assert "answer now" in prompts.TURN_HINTS[FINAL_TURN - 1].lower()


def test_a_tool_definition_keeps_what_the_model_needs_and_loses_the_noise() -> None:
    specs = {t.name: t.input_schema for t in request(1).tools}
    quote = specs["draft_quote"]
    assert set(quote["required"]) == {"enquiry_id", "customer_kind", "delivery_state"}
    assert quote["properties"]["customer_kind"]["enum"] == ["new", "repeat"]
    assert quote["properties"]["enquiry_id"]["format"] == "uuid"
    reply_spec = specs["draft_reply"]
    assert reply_spec["properties"]["language"]["enum"] == ["en", "te", "hi", "kn", "ta", "ml"]
    assert set(reply_spec["required"]) == {"language", "text", "gloss_en"}
    text = json.dumps([specs, request(1).final_result.input_schema])
    for noise in ('"title"', '"default"', '"null"', "additionalProperties"):
        assert noise not in text, noise
    assert "description" not in json.dumps(specs), "the class docstrings are not sent"


def test_compact_schema_turns_an_optional_field_into_a_plain_one() -> None:
    schema = {
        "title": "X",
        "description": "docstring",
        "type": "object",
        "properties": {
            "a": {
                "anyOf": [{"type": "string", "format": "uuid"}, {"type": "null"}],
                "default": None,
                "title": "A",
            }
        },
    }
    assert compact_schema(schema) == {
        "type": "object",
        "properties": {"a": {"type": "string", "format": "uuid"}},
    }


def test_the_closed_argument_models_still_refuse_an_unknown_field() -> None:
    # the schema sent to the model no longer says additionalProperties: false, the application still does
    for tool in TOOLS:
        assert tool.args.model_json_schema().get("additionalProperties") is False


def test_old_chat_lines_are_cut_short_and_the_data_markers_hold() -> None:
    long_line = "x" * 5000
    history = [{"role": "assistant", "body": long_line}, {"role": "user", "body": "short"}]
    blocks = [b for b in request(1, history).blocks if "earlier in this chat" in b.text]
    assert len(blocks) == 1
    assert long_line not in blocks[0].text and "x" * prompts.HISTORY_LINE_CHARS in blocks[0].text
    assert "x" * (prompts.HISTORY_LINE_CHARS + 1) not in blocks[0].text
    assert blocks[0].trust.value == "untrusted"


# ------------------------------------------------------- job AY CI fix: a failed run says why in the log
def _tool_that_raises(exc: Exception) -> Any:
    def handler(ctx: Any, args: Any) -> None:
        raise exc

    return SimpleNamespace(name="get_today", handler=handler)


def test_a_data_layer_failure_of_a_tool_leaves_a_trace_with_the_code_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from app.agents.errors import AgentDbError
    from app.errors import ApiError

    runner, _ = runner_with_today()
    with caplog.at_level("WARNING", logger="app.assistant.runner"):
        status, *_ = runner._execute(_tool_that_raises(AgentDbError()), None)
        assert status == "failed"
        status, *_ = runner._execute(
            _tool_that_raises(ApiError(502, "upstream_error", "private words")), None
        )
        assert status == "refused"
        # a plain refusal (4xx) is the tool saying no, not a failure: no warning
        runner._execute(_tool_that_raises(ApiError(404, "not_found", "private words")), None)
    lines = [r.getMessage() for r in caplog.records if r.name == "app.assistant.runner"]
    assert len(lines) == 2
    assert "data_layer_error" in lines[0] and "502 upstream_error" in lines[1]
    assert not any("private words" in line for line in lines)


def test_the_fixed_reply_names_the_repairs_that_were_asked_for(
    caplog: pytest.LogCaptureFixture,
) -> None:
    runner, _ = runner_with_today()
    with caplog.at_level("WARNING", logger="app.assistant.runner"):
        runner._note_fallback(4, {"sources", "complete"})
    (line,) = [r.getMessage() for r in caplog.records if r.name == "app.assistant.runner"]
    assert "after 4 turn(s)" in line and line.endswith("repairs asked: complete,sources")
