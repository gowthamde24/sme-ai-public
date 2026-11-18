"""The hourly limit of assistant runs (30 a business an hour) is said plainly, with the time (18 Nov 2026; the limit itself is unchanged)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.agent_runs import pause
from app.agents.errors import LimitReached
from app.assistant.routes import _refusal
from app.errors import ApiError
from app.turns import words


def iso(minutes: int) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


class Repo:
    def __init__(self, answer: Any) -> None:
        self.answer = answer

    def runs_reopen_at(self, token: str, tenant: Any) -> Any:
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_the_sentence_has_the_india_time_or_says_a_few_minutes() -> None:
    at = datetime(2026, 11, 18, 12, 50, tzinfo=UTC)   # 18:20 India time
    assert "18:20 (India time)" in words.run_limit_sentence("en", at) and "asked a lot this hour" in words.run_limit_sentence("en", at)
    assert "18:20" in words.run_limit_sentence("te", at) and "18:20" in words.run_limit_sentence("hi", at) and "18:20" in words.run_limit_sentence("kn", at)
    assert "in a few minutes" in words.run_limit_sentence("en", None)
    for table in (words.RUN_LIMIT, words.RUN_LIMIT_SOON):
        assert set(table) == set(words.CANNOT_PLAN), "every language of the product has the sentence"


def test_the_reopen_time_is_read_and_a_failed_or_past_read_is_not_known() -> None:
    assert pause.runs_reopen_at(Repo(iso(25)), "t", uuid.uuid4()) is not None
    assert pause.runs_reopen_at(Repo(None), "t", uuid.uuid4()) is None
    assert pause.runs_reopen_at(Repo(iso(-5)), "t", uuid.uuid4()) is None
    assert pause.runs_reopen_at(Repo(RuntimeError("down")), "t", uuid.uuid4()) is None
    assert pause.runs_reopen_at(None, "t", uuid.uuid4()) is None


def test_the_refusal_at_the_start_of_a_turn_says_when_and_carries_until() -> None:
    err = _refusal(LimitReached(), Repo(iso(25)), "t", "tenant")  # type: ignore[arg-type]
    assert isinstance(err, ApiError) and err.status_code == 429 and err.code == "run_limit_reached"
    assert "asked a lot this hour" in err.message and "(India time)" in err.message and "until" in err.extra and err.retry_after is not None and err.retry_after > 60
    soon = _refusal(LimitReached(), Repo(None), "t", "tenant")  # type: ignore[arg-type]
    assert "in a few minutes" in soon.message and soon.extra == {}


def test_a_request_that_cannot_be_planned_because_of_the_limit_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tasks.service import TasksService
    from tests.test_aw_settings import say, world

    client, _ = world()

    def refuse(*a: Any, **k: Any) -> Any:
        raise ApiError(429, "run_limit_reached", "Too many agent runs. Try again later.")

    monkeypatch.setattr(TasksService, "plan", refuse)
    from tests.test_aw_files import text_of

    said = text_of(say(client, "Call all my new leads from the website and ask about a visit"))
    assert "could not make a plan" not in said and "asked a lot this hour" in said, said
