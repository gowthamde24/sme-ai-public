"""The morning stand-up over HTTP and in the worker (docs/contracts/ai-team.md, "The stand-up"; migration 20261231400000, pgTAP 171 pins the database: once a day for the worker, 3 by hand, roles).
Here: who may read and make it, the text is made from the real day numbers (no customer name), the limit answer, language fallback, "no audio" said honestly, and the worker runner (isolation, once, errors)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest

from app.ai_team import routes as R
from app.ai_team.standup_runner import StandupRunner
from app.tenancy.repository import TokenRejected
from tests.fakes import TENANT_A, auth, make_client
from tests.test_at_ai_team import mark, raw_day

BASE = f"/v1/tenants/{TENANT_A.id}/ai-team/standup"
IST = timezone(timedelta(hours=5, minutes=30))


class FakeStore:
    """Answers as the database functions do: the stored stand-up per (tenant, day, language); the worker saves once a day; by hand at most 3 a day per workspace."""

    def __init__(self, raw: dict[str, Any]) -> None:
        self.raw = raw
        self.rows: dict[tuple[uuid.UUID, str, str], dict[str, Any]] = {}
        self.manual = 0
        self.saves: list[dict[str, Any]] = []
        self.due: list[dict[str, Any]] = []
        self.fail_for: set[uuid.UUID] = set()

    def day(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]:
        return dict(self.raw, date=on.isoformat())

    def day_as_scheduler(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any]:
        if tenant_id in self.fail_for:
            raise RuntimeError("boom")
        return self.day(token, tenant_id, on)

    def standups_due(self, token: str, limit: int = 50) -> list[dict[str, Any]]:
        return self.due

    def standup_get(self, token: str, tenant_id: uuid.UUID, on: date, language: str) -> dict[str, Any] | None:
        return self.rows.get((tenant_id, on.isoformat(), language))

    def standup_save(self, token: str, tenant_id: uuid.UUID, on: date, built: dict[str, Any]) -> dict[str, Any]:
        self.saves.append(built)
        key = (tenant_id, on.isoformat(), built["language"])
        by_hand = token != "worker"   # the worker signs in with its own token
        if not by_hand:
            self.rows.setdefault(key, self._row(built, "schedule", on))
            return {"ok": True, **self.rows[key]}
        if key in self.rows and self.rows[key]["text"] == built["text"]:
            return {"ok": True, **self.rows[key]}
        if self.manual >= 3:
            return {"ok": False, "reason": "standup_limit", "retry_after_s": 4321}
        self.manual += 1
        self.rows[key] = self._row(built, "owner", on)
        return {"ok": True, **self.rows[key]}

    def _row(self, built: dict[str, Any], by: str, on: date) -> dict[str, Any]:
        return {"date": on.isoformat(), "language": built["language"], "text": built["text"], "lines": built["lines"], "numbers": built["numbers"], "draft": built["draft"], "by": by,
                "generated_at": datetime.now(IST).isoformat(), "left_today": 3 - self.manual}


@pytest.fixture(autouse=True)
def _no_cache() -> None:
    R._cache.clear()  # noqa: SLF001


def world(raw: dict[str, Any] | None = None) -> tuple[Any, FakeStore]:
    store = FakeStore(raw or raw_day(marks=[mark("caller", "call", 5, seconds=84), mark("lead_catcher", "lead_in", 1)]))
    client, _ = make_client(ai_team=store)
    return client, store


def test_nothing_is_made_until_it_is_made() -> None:
    client, _ = world()
    r = client.get(BASE, headers=auth("a_owner"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_generated"


@pytest.mark.parametrize("who", ["a_sales", "a_viewer", "b_owner"])
def test_only_the_owner_and_an_admin_read_or_make_it(who: str) -> None:
    client, _ = world()
    assert client.get(BASE, headers=auth(who)).status_code in (403, 404)
    assert client.post(BASE, headers=auth(who), json={}).status_code in (403, 404)


def test_making_it_uses_the_real_day_numbers_and_says_there_is_no_audio() -> None:
    client, store = world()
    r = client.post(BASE, headers=auth("a_owner"), json={})
    assert r.status_code == 200
    got = r.json()
    assert got["language"] == "en" and got["draft"] is False and got["by"] == "owner"
    assert got["audio"] is None and got["audio_reason"] == "voice_off", "text only: the page is told, honestly, why there is no audio"
    assert "ok" not in got
    # every number in the text is listed, with where it came from, and the flow strip of the fake day is the source
    keys = {n["key"] for n in got["numbers"]}
    assert "yesterday.leads_in" in keys
    assert all(line["source"] for line in got["lines"]) and got["text"] == " ".join(line["text"] for line in got["lines"])
    assert store.saves[0]["text"] == got["text"]
    # and reading it back gives the same
    again = client.get(BASE, headers=auth("a_admin")).json()
    assert again["text"] == got["text"] and again["audio"] is None


def test_no_customer_name_is_ever_in_the_text() -> None:
    marks = [dict(mark("caller", "call", 5, seconds=84), label="Call with Lakshmi Devi about the red saree"), dict(mark("quote_writer", "quote", 30, needs=True), label="Quote for Ramesh Traders")]
    client, _ = world(raw_day(marks=marks))
    text = client.post(BASE, headers=auth("a_owner"), json={}).json()["text"]
    assert "Lakshmi" not in text and "Ramesh" not in text and "saree" not in text


def test_a_language_without_a_stand_up_gets_english_and_telugu_is_a_draft() -> None:
    client, _ = world()
    assert client.post(BASE, headers=auth("a_owner"), json={"language": "ta"}).json()["language"] == "en"
    te = client.post(BASE, headers=auth("a_owner"), json={"language": "te"}).json()
    assert te["language"] == "te" and te["draft"] is True
    assert client.get(f"{BASE}?language=te", headers=auth("a_owner")).json()["text"] == te["text"]
    assert client.get(f"{BASE}?language=ta", headers=auth("a_owner")).json()["language"] == "en"


def test_an_unknown_field_is_refused() -> None:
    client, _ = world()
    assert client.post(BASE, headers=auth("a_owner"), json={"language": "en", "date": "2026-01-01"}).status_code == 422


def test_the_fourth_by_hand_is_a_429_with_the_seconds_to_wait() -> None:
    client, store = world()
    for i in range(3):
        store.raw = raw_day(marks=[mark("lead_catcher", "lead_in", 1)] * (i + 1), flow={"steps": [{"key": "leads_in", "count": i + 1}], "extra": []})
        assert client.post(BASE, headers=auth("a_owner"), json={}).status_code == 200
    store.raw = raw_day(flow={"steps": [{"key": "leads_in", "count": 9}], "extra": []})
    r = client.post(BASE, headers=auth("a_admin"), json={})
    assert r.status_code == 429 and r.json()["error"]["code"] == "standup_limit" and r.json()["error"]["retry_after"] == 4321 and r.headers["retry-after"] == "4321"


def test_the_same_text_again_is_not_a_new_one() -> None:
    client, store = world()
    client.post(BASE, headers=auth("a_owner"), json={})
    client.post(BASE, headers=auth("a_owner"), json={})
    assert store.manual == 1


# ---- the worker

def runner(store: FakeStore) -> StandupRunner:
    return StandupRunner(store, clock=lambda: datetime(2026, 11, 9, 9, 5, tzinfo=IST))  # type: ignore[arg-type]


def test_the_worker_makes_each_due_stand_up_once_in_the_language_asked() -> None:
    store = FakeStore(raw_day(marks=[mark("lead_catcher", "lead_in", 1)]))
    a, b = uuid.uuid4(), uuid.uuid4()
    store.due = [{"tenant_id": str(a), "language": "te", "date": "2026-11-09"}, {"tenant_id": str(b), "language": "en", "date": "2026-11-09"}]
    assert runner(store).run("worker") == 2
    assert {s["language"] for s in store.saves} == {"te", "en"}
    assert store.rows[(a, "2026-11-09", "te")]["by"] == "schedule"
    store.due = []   # the database no longer lists them: nothing more is made
    assert runner(store).run("worker") == 0 and len(store.saves) == 2


def test_one_workspace_failing_does_not_stop_the_others() -> None:
    store = FakeStore(raw_day())
    bad, good = uuid.uuid4(), uuid.uuid4()
    store.fail_for = {bad}
    store.due = [{"tenant_id": str(bad), "language": "en", "date": "2026-11-09"}, {"tenant_id": str(good), "language": "en", "date": "2026-11-09"}]
    assert runner(store).run("worker") == 1
    assert (good, "2026-11-09", "en") in store.rows and (bad, "2026-11-09", "en") not in store.rows


def test_a_refused_token_is_passed_up_so_the_worker_signs_in_again() -> None:
    store = FakeStore(raw_day())
    store.due = [{"tenant_id": str(uuid.uuid4()), "language": "en", "date": "2026-11-09"}]

    def refuse(*_: Any, **__: Any) -> dict[str, Any]:
        raise TokenRejected("no")

    store.day_as_scheduler = refuse  # type: ignore[method-assign]
    with pytest.raises(TokenRejected):
        runner(store).run("worker")


def test_asking_what_is_due_failing_makes_nothing_and_does_not_raise() -> None:
    store = FakeStore(raw_day())

    def boom(*_: Any, **__: Any) -> list[dict[str, Any]]:
        raise RuntimeError("down")

    store.standups_due = boom  # type: ignore[method-assign]
    assert runner(store).run("worker") == 0
