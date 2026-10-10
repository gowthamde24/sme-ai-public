"""The one refusal for a used-up AI allowance (job AK / K2): the code, the time and the fallback."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta, timezone

from app.agent_runs import pause

TENANT = uuid.UUID(int=1)
IST = timezone(timedelta(hours=5, minutes=30))


class Repo:
    def __init__(self, answer: object = None, boom: bool = False) -> None:
        self.answer, self.boom = answer, boom
        self.asked: list[tuple[str, uuid.UUID]] = []

    def paused_until(self, token: str, tenant_id: uuid.UUID) -> object:
        self.asked.append((token, tenant_id))
        if self.boom:
            raise RuntimeError("data layer text that must never reach a client")
        return self.answer


def test_the_next_indian_midnight_is_the_start_of_the_next_india_day() -> None:
    assert pause.next_india_midnight(datetime(2031, 3, 1, 18, 29, tzinfo=UTC)) == datetime(
        2031, 3, 2, 0, 0, tzinfo=IST
    )
    assert pause.next_india_midnight(datetime(2031, 3, 1, 18, 31, tzinfo=UTC)) == datetime(
        2031, 3, 3, 0, 0, tzinfo=IST
    )


def test_the_database_time_is_used_when_it_answers() -> None:
    repo = Repo("2031-03-14T18:30:00+00:00")
    assert pause.resolve_until(repo, "tok", TENANT) == datetime(2031, 3, 14, 18, 30, tzinfo=UTC)
    assert repo.asked == [("tok", TENANT)]


def test_a_failed_or_empty_read_falls_back_to_the_next_midnight_and_never_hides_the_refusal() -> (
    None
):
    for repo in (Repo(boom=True), Repo(None), Repo("not a time"), None):
        got = pause.resolve_until(repo, "tok", TENANT)
        assert got > datetime.now(UTC) and got - datetime.now(UTC) <= timedelta(days=1, minutes=1)
    assert pause.resolve_until(Repo("2031-03-14T18:30:00+00:00"), "tok", None) > datetime.now(
        UTC
    ) - timedelta(days=1)


def test_the_error_is_429_ai_paused_until_with_a_utc_time_and_the_good_news() -> None:
    error = pause.paused_error(datetime(2031, 3, 14, 18, 30, tzinfo=UTC))
    assert (error.status_code, error.code) == (429, "ai_paused_until")
    assert error.extra == {"until": "2031-03-14T18:30:00Z"}
    assert "Quotes, orders, follow-ups and customers keep working" in error.message
