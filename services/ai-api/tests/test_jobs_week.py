"""GET /jobs/week (docs/contracts/jobs-week.md): per job the last seven days in whole numbers, for the Jobs list. Fakes of every subsystem, no database."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from app.jobs import listing
from app.jobs import week as week_mod
from app.jobs.wiring import JobsRuntime
from tests.fakes import TENANT_A, auth, make_client
from tests.test_jobs_s2_detail import PACKS, World

JOBS = f"/v1/tenants/{TENANT_A.id}/jobs"


@pytest.fixture(autouse=True)
def _fresh_cache() -> Any:
    week_mod._kept.clear()   # noqa: SLF001 - the answers are kept for 30 s per person: every test starts empty
    yield
    week_mod._kept.clear()   # noqa: SLF001


def call(*, direction: str = "inbound", answered: bool = True, days_ago: float = 1, seconds: int = 90, simulated: bool = False) -> Any:
    at = datetime.now(UTC) - timedelta(days=days_ago)
    return SimpleNamespace(direction=direction, answered_at=at if answered else None, created_at=at, duration_s=seconds, simulated=simulated)


def calls_of(*rows: Any) -> Any:
    return SimpleNamespace(list=lambda token, tenant_id, state, limit, before: SimpleNamespace(items=list(rows)))


def week(w: World, user: str | None = "a_owner") -> Any:
    return w.client.get(f"{JOBS}/week", headers=auth(user) if user else {})


def test_every_job_has_a_row_with_closed_keys() -> None:
    body = week(World()).json()
    assert body["days"] == 7 and [i["kind"] for i in body["items"]] == [k for k in listing.KINDS if k in {i["kind"] for i in body["items"]}]
    assert body["items"] and all(set(i) == {"id", "kind", "calls", "visits", "cost", "numbers"} for i in body["items"])
    assert all(i["cost"] is None for i in body["items"]), "money is metered for the month only, never per job: null, not a guess"


def test_speed_to_lead_shows_its_calls_and_visits() -> None:
    row = next(i for i in week(World()).json()["items"] if i["kind"] == "speed_to_lead")
    assert (row["calls"], row["visits"]) == (10, 2) and row["numbers"] == {"called": 10, "picked_up": 5, "visits": 2}


def test_answer_calls_counts_the_answered_inbound_calls_of_the_week_not_tests_or_missed() -> None:
    w = World(calls=calls_of(call(), call(days_ago=3, seconds=30), call(answered=False), call(direction="outbound"), call(days_ago=9), call(simulated=True)))
    row = next(i for i in week(w).json()["items"] if i["kind"] == "answer_calls")
    assert row["calls"] == 2 and row["visits"] is None and row["numbers"] == {"answered": 2, "minutes": 2}


def test_a_job_that_cannot_be_read_gives_nulls_and_the_list_still_answers() -> None:
    def down(*args: Any) -> Any:
        raise RuntimeError("down")

    w = World(calls=SimpleNamespace(list=down))
    row = next(i for i in week(w).json()["items"] if i["kind"] == "answer_calls")
    assert week(w).status_code == 200 and row["calls"] is None and row["numbers"] == {}


def test_a_job_without_a_call_has_null_calls() -> None:
    items = {i["kind"]: i for i in week(World()).json()["items"]}
    assert items["followups"]["calls"] is None and items["followups"]["visits"] is None


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 200), ("outsider", 404), (None, 401)])
def test_every_member_reads_it(user: str | None, status: int) -> None:
    assert week(World(), user).status_code == status


def test_with_jobs_off_it_is_404() -> None:
    assert week(World(on=False)).status_code == 404


def test_the_word_path_wins_over_the_job_id() -> None:
    client, _ = make_client(jobs=JobsRuntime(directory=PACKS))
    assert client.get(f"{JOBS}/week", headers=auth("a_owner")).status_code != 422


def test_a_business_that_never_has_the_lead_finder_has_no_researcher_row() -> None:
    client, _ = make_client(jobs=JobsRuntime(directory=PACKS), lead_finder=SimpleNamespace(availability=lambda t, tid: SimpleNamespace(reason="not_for_this_business", available=False, access="hidden")))
    kinds = [i["kind"] for i in client.get(f"{JOBS}/week", headers=auth("a_owner")).json()["items"]]
    assert "researcher" not in kinds and kinds == [k for k in listing.KINDS if k != "researcher"]


def test_the_answer_is_kept_for_a_short_time_per_person_and_never_shared() -> None:
    reads: list[int] = []

    def counting(token: str, tenant_id: Any, state: str, limit: int, before: Any) -> Any:
        reads.append(1)
        return SimpleNamespace(items=[call()])

    w = World(calls=SimpleNamespace(list=counting))
    first = week(w).json()
    again = week(w).json()
    assert first == again and len(reads) == 1, "the second look inside half a minute reads nothing"
    other = week(w, "a_admin").json()
    assert len(reads) == 2 and other["items"], "another person is computed with their own token, never handed the owner's answer"
    week_mod._kept.clear()   # noqa: SLF001
    week(w)
    assert len(reads) == 3, "after the time (or a restart) it is read again"


def test_an_answer_older_than_the_time_is_read_again(monkeypatch: pytest.MonkeyPatch) -> None:
    reads: list[int] = []
    w = World(calls=SimpleNamespace(list=lambda *a: (reads.append(1), SimpleNamespace(items=[]))[1]))
    clock = {"t": 1000.0}
    monkeypatch.setattr(week_mod.time, "monotonic", lambda: clock["t"])
    week(w)
    clock["t"] += week_mod.TTL_S - 1
    week(w)
    assert len(reads) == 1
    clock["t"] += 2
    week(w)
    assert len(reads) == 2
