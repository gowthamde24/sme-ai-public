"""A request with several steps (owner, 14 Nov 2026): split into at most four self-contained steps, the first goes through the turn's own path, the reply's last line carries the rest, and "next" takes the
next one. Nothing is done because a chain was started: each step is its own checked action."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant.runner import Reply
from app.assistant_work import chain
from app.turns import service
from app.turns.models import TurnIn


@pytest.mark.parametrize("text", [
    "Add Ravi Teja 9876543210 as a lead, then call him and ask if he wants a store visit",
    "Find 10 jewellery shops in Jayanagar, save them as leads and send them our catalogue",
    "Check who has not replied for 3 days and then send them a reminder",
    "కొత్త లీడ్స్ అందరికీ మెసేజ్ పంపి, రేపు ఉదయం 11కి విజిట్ బుక్ చేయి",
])
def test_requests_that_may_hold_several_steps_are_noticed(text: str) -> None:
    assert chain.looks_chained(text)


@pytest.mark.parametrize("text", ["call Ravi", "What is my balance?", "send Kalyani: how are you?", "set calling hours 10 to 7", "how many leads did I get this week and which source"])
def test_one_step_requests_are_not_chains(text: str) -> None:
    assert not chain.looks_chained(text)


def test_next_is_only_a_short_word() -> None:
    for text in ("next", "Next step", "ok next", "continue", "go ahead", "తరువాత", "आगे"):
        assert chain.is_next(text), text
    for text in ("next week call Ravi", "continue the campaign for Diwali", "call him next"):
        assert not chain.is_next(text), text


def test_the_marker_round_trips_in_every_language_and_keeps_the_order() -> None:
    steps = ["Call Ravi Teja and ask if he wants a store visit", "Book a visit for Ravi Teja tomorrow 11:00"]
    for lang in ("en", "te", "hi", "kn"):
        line = chain.marker(steps, lang)
        assert chain.rest_of(f"Done.\n\n{line}") == steps, lang
    assert chain.rest_of("No chain here") == []
    assert chain.rest_of(f"Plan below.\n\n{chain.marker(['one step left'], 'en')}") == ["one step left"]


def test_a_split_must_have_two_steps_and_may_not_invent_a_number() -> None:
    text = "add Ravi 9876543210 then call him"
    assert chain.check({"steps": ["Add Ravi 9876543210 as a lead", "Call Ravi and ask if he wants a visit"]}, text) == ["Add Ravi 9876543210 as a lead", "Call Ravi and ask if he wants a visit"]
    assert chain.check({"steps": ["Add Ravi 9876543210 as a lead"]}, text) == [], "one step is not a chain"
    assert chain.check({"steps": ["Add Ravi 9123456789 as a lead", "Call Ravi"]}, text) == [], "a number the owner never said"
    assert len(chain.check({"steps": [f"step {i}" for i in range(4)]}, "x")) == 4
    assert chain.check({"steps": []}, "x") == []


class _Runner:
    def __init__(self) -> None:
        self.replies: list[Reply] = []
        self.owner_notes = "notes"

    def finish_with(self, reply: Reply, message_id: uuid.UUID, emit: Any, extra: tuple[Any, ...] = ()) -> str:
        self.replies.append(reply)
        return "finished"


def _ctx() -> Any:
    return SimpleNamespace(principal=SimpleNamespace(token="t"), tenant=SimpleNamespace(id=uuid.uuid4()))


def _run(monkeypatch: pytest.MonkeyPatch, text: str, split_to: list[str], history: list[dict[str, Any]] | None = None) -> tuple[list[tuple[str, Any]], list[dict[str, Any]], Any]:
    seen: list[dict[str, Any]] = []
    events: list[tuple[str, Any]] = []
    monkeypatch.setattr(chain, "split", lambda *a, **k: split_to)

    def dispatch(runtime: Any, ctx: Any, db: Any, body: Any, language: Any, hist: Any, last: Any, runner: Any, emit: Any, reply_id: Any, **kw: Any) -> Any:
        seen.append({"text": body.text, "chained": kw.get("chained")})
        return runner.finish_with(Reply("Plan for the step.", "en", "confirm_action"), reply_id, emit)

    monkeypatch.setattr(service, "_dispatch", dispatch)
    body = TurnIn(message_id=uuid.uuid4(), text=text)
    runner = _Runner()
    out = service._chain_turn(SimpleNamespace(), _ctx(), None, body, "en", history or [], None, runner, lambda n, d: events.append((n, d)), uuid.uuid4(), object(), None)   # type: ignore[arg-type]
    assert str(out) == "finished"
    return events, seen, runner


def test_the_first_step_runs_and_the_reply_says_what_is_left(monkeypatch: pytest.MonkeyPatch) -> None:
    events, seen, runner = _run(monkeypatch, "Add Ravi Teja 9876543210 as a lead, then call him and ask if he wants a visit", ["Add Ravi Teja 9876543210 as a lead", "Call Ravi Teja and ask if he wants a visit"])
    assert seen == [{"text": "Add Ravi Teja 9876543210 as a lead", "chained": True}], "the step is dispatched once and never splits again"
    assert chain.rest_of(runner.replies[0].text) == ["Call Ravi Teja and ask if he wants a visit"]
    assert events == [("chain", {"type": "chain", "step": "Add Ravi Teja 9876543210 as a lead", "remaining": ["Call Ravi Teja and ask if he wants a visit"]})]


def test_the_last_step_leaves_no_line(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = {"role": "assistant", "body": f"Done.\n\n{chain.marker(['Book a visit for Ravi tomorrow 11:00'], 'en')}"}
    events, seen, runner = _run(monkeypatch, "next", [], history=[previous, {"role": "user", "body": "next"}])
    assert seen[0]["text"] == "Book a visit for Ravi tomorrow 11:00"
    assert runner.replies[0].text == "Plan for the step." and events[0][1]["remaining"] == []


def test_next_with_nothing_left_is_an_ordinary_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "_dispatch", lambda *a, **k: pytest.fail("not a chain"))
    body = TurnIn(message_id=uuid.uuid4(), text="next")
    assert service._chain_turn(SimpleNamespace(), _ctx(), None, body, "en", [{"role": "assistant", "body": "Hello"}], None, _Runner(), lambda n, d: None, uuid.uuid4(), object(), None) is None   # type: ignore[arg-type]


def test_a_request_the_model_calls_one_step_goes_on_as_before(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chain, "split", lambda *a, **k: [])
    monkeypatch.setattr(service, "_dispatch", lambda *a, **k: pytest.fail("not a chain"))
    body = TurnIn(message_id=uuid.uuid4(), text="Find shops and then call them")
    assert service._chain_turn(SimpleNamespace(), _ctx(), None, body, "en", [], None, _Runner(), lambda n, d: None, uuid.uuid4(), object(), None) is None   # type: ignore[arg-type]
