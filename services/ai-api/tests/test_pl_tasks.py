"""The Lead Desk call flow on Plivo (job 3 step 3, 10 Nov 2026). Fakes only: nobody is dialled.

Proven: an approved task's calls go through the gate (sandbox list, hours) and Plivo; a refused or failed dial marks the person `failed`, not done; a real call is never labelled simulated and writes no summary message;
the cap and a paused task stop the dials before the dialer is reached; the result says only what is known; the wiring never switches a real dialer on by accident."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.config import ConfigurationError
from app.tasks.dialer import FakeDialer, has_ai_disclosure
from app.tasks.runner import TaskRunner
from app.telephony.plivo_api import FakePlivoApi
from app.telephony.plivo_tasks import PlivoTaskDialer, goal_text
from app.telephony.wiring import build_tasks_dialer
from tests.dr_tasks_fakes import FakeOutbox
from tests.fakes import TENANT_A
from tests.test_dr_tasks import CALL_PLAN, run_world
from tests.test_pl_outbound import INDIA_3AM, FakeRepo, placer

PERSON = "+919876500001"   # the number the fake task database gives every person
TENANT = TENANT_A.id


def dialer_for(*, numbers: frozenset[str] = frozenset({PERSON}), end: str = "completed", seconds: int = 70, now: Any = None, api: FakePlivoApi | None = None) -> tuple[PlivoTaskDialer, FakeRepo, FakePlivoApi]:
    kw: dict[str, Any] = {"numbers": numbers, "api": api}
    if now is not None:
        kw["now"] = now
    out, repo, api = placer(**kw)

    def sleep(_: float) -> None:   # the call "happens" while we wait
        for row in repo.rows.values():
            if row["state"] == "ringing":
                row.update(state=end, duration_s=seconds)

    ticks = iter(range(10_000))
    return PlivoTaskDialer(out, repo, sleep=sleep, clock=lambda: float(next(ticks))), repo, api


def ask(dialer: PlivoTaskDialer, **kw: Any) -> Any:
    args: dict[str, Any] = dict(business="Padma Silks", language="en", questions=[{"key": "colour", "text": "Which colour do you want?", "type": "text"}], template="custom", seed="s", phone=PERSON, token="tok", tenant_id=TENANT, goal="Find out what she needs for the wedding.")
    args.update(kw)
    return dialer.call(**args)


def test_an_answered_call_is_real_unclear_and_says_only_what_is_known() -> None:
    dialer, repo, api = dialer_for()
    result = ask(dialer)
    assert len(api.placed) == 1 and result.simulated is False and result.outcome == "unclear" and result.captured == {} and result.category is None
    assert result.minutes == 2 and result.transcript and result.transcript[0]["who"] == "assistant" and has_ai_disclosure(result.transcript[0]["text"]) and "Padma Silks" in result.transcript[0]["text"]
    assert all(PERSON not in u for u in (api.placed[0]["answer_url"], api.placed[0]["hangup_url"])), "no number in an address"
    assert "k=goal" in api.placed[0]["answer_url"] and "Which colour" not in api.placed[0]["answer_url"]


def test_an_unanswered_call_costs_nothing_and_a_dead_one_is_failed() -> None:
    assert ask(dialer_for(end="no_answer", seconds=0)[0]).outcome == "no_answer"
    assert ask(dialer_for(end="busy", seconds=0)[0]).outcome == "no_answer"
    failed = ask(dialer_for(end="failed", seconds=0)[0])
    assert failed.outcome == "failed" and failed.minutes == 0 and failed.simulated is False


@pytest.mark.parametrize(("kw", "number", "reason"), [
    (dict(), "+919000000099", "not_on_sandbox_list"),
    (dict(now=INDIA_3AM), PERSON, "outside_window"),
])
def test_the_gate_stops_a_task_call_before_any_dial_and_the_refusal_is_kept(kw: dict[str, Any], number: str, reason: str) -> None:
    dialer, repo, api = dialer_for(**kw)
    result = ask(dialer, phone=number)
    assert result.outcome == "failed" and result.minutes == 0 and api.placed == []
    assert [r["refuse_reason"] for r in repo.rows.values()] == [reason]


def test_a_phone_service_failure_is_failed_not_a_crash() -> None:
    api = FakePlivoApi()
    api.fail_with = "unavailable"
    dialer, repo, _ = dialer_for(api=api)
    assert ask(dialer).outcome == "failed"


def test_missing_ingredients_dial_nothing() -> None:
    dialer, repo, api = dialer_for()
    for bad in (dict(phone=""), dict(token=""), dict(tenant_id=None)):
        assert ask(dialer, **bad).outcome == "failed"
    assert api.placed == [] and repo.rows == {}


def test_a_call_still_running_when_we_give_up_is_counted_and_failed() -> None:
    out, repo, api = placer(numbers=frozenset({PERSON}))
    ticks = iter(range(10_000))
    dialer = PlivoTaskDialer(out, repo, max_wait_s=130.0, sleep=lambda _: None, clock=lambda: float(next(ticks)) * 20.0)
    result = ask(dialer)
    assert result.outcome == "failed" and result.minutes == 3 and result.simulated is False


def test_the_plan_becomes_the_goal_in_the_owners_order_and_stays_inside_the_limit() -> None:
    text = goal_text("Find out what she needs.", [{"text": "Which colour?"}, {"text": "Which occasion?"}])
    assert text == "Find out what she needs. Ask, one at a time: Which colour?; Which occasion?."
    long = goal_text("g " * 300, [{"text": "q"}])
    assert len(long) <= 400 and not long.endswith(" ")
    assert goal_text("Just this.", []) == "Just this."


# ---------------------------------------------------------------------------------------------------------------------------------- inside the task runner
def runner_with(dialer: Any, plan: dict[str, Any] | None = None) -> tuple[Any, TaskRunner, uuid.UUID, FakeOutbox]:
    repo, _, tid, outbox = run_world(plan or CALL_PLAN)
    seen: list[dict[str, Any]] = []
    original = repo.result

    def result(token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, row_id: uuid.UUID, res: dict[str, Any]) -> dict[str, Any]:
        seen.append(res)
        return original(token, tenant_id, task_id, row_id, res)

    repo.result = result   # type: ignore[method-assign]
    repo.seen = seen   # type: ignore[attr-defined]
    return repo, TaskRunner(repo, dialer, outbox), tid, outbox  # type: ignore[arg-type]


def test_a_task_places_one_call_per_person_with_the_approvers_token_and_marks_them_real() -> None:
    dialer, drepo, api = dialer_for()
    repo, runner, tid, outbox = runner_with(dialer, {**CALL_PLAN, "follow_up": {"kind": "whatsapp_summary", "after_hours": 1}})
    runner.run("tok", TENANT, "Padma Silks", tid)
    assert len(api.placed) == 4 and set(drepo.tokens) == {"tok"}, "one call per person, with the approver's own token"
    assert all(r["simulated"] is False and r["outcome"] == "unclear" and r["status"] == "done" for r in repo.seen)
    assert outbox.sent == [], "a real call promises no summary: nothing is known of what was said"


def test_people_the_gate_refuses_are_failed_and_cost_nothing() -> None:
    dialer, drepo, api = dialer_for(numbers=frozenset({"+919000000099"}))
    repo, runner, tid, _ = runner_with(dialer)
    final = runner.run("tok", TENANT, "Padma Silks", tid)
    assert api.placed == [] and {r["status"] for r in repo.seen} == {"failed"} and repo.tasks[tid]["spent_paise"] == 0 and final["status"] == "done"
    assert len([r for r in drepo.rows.values() if r["state"] == "refused"]) == 4


def test_a_capped_or_paused_task_reaches_no_dialer() -> None:
    dialer, drepo, api = dialer_for()
    repo, runner, tid, _ = runner_with(dialer)
    repo.tasks[tid]["spent_paise"] = repo.tasks[tid]["cap_paise"]
    runner.run("tok", TENANT, "Padma Silks", tid)
    assert api.placed == [] and repo.tasks[tid]["status"] == "paused" and repo.tasks[tid]["pause_reason"] == "cap"
    repo2, runner2, tid2, _ = runner_with(dialer)
    repo2.tasks[tid2]["status"] = "paused"
    runner2.run("tok", TENANT, "Padma Silks", tid2)
    assert api.placed == []


def test_the_fake_dialer_still_marks_its_results_simulated() -> None:
    repo, runner, tid, _ = runner_with(FakeDialer())
    runner.run("tok", TENANT, "Padma Silks", tid)
    assert repo.seen and all(r["simulated"] is True for r in repo.seen)


# ---------------------------------------------------------------------------------------------------------------------------------- the wiring
class _Settings:
    def __init__(self, choice: str) -> None:
        self.tasks_dialer, self.telephony_max_call_s = choice, 180


class _Phone:
    def __init__(self, outbound: Any, repo: Any) -> None:
        self.outbound, self.outbound_repo = outbound, repo


def test_the_default_is_the_fake_and_plivo_needs_outbound_to_be_on() -> None:
    assert isinstance(build_tasks_dialer(_Settings(""), None), FakeDialer)
    assert isinstance(build_tasks_dialer(_Settings("fake"), None), FakeDialer)
    assert isinstance(build_tasks_dialer(_Settings("plivo"), None), FakeDialer), "no outbound calls here: the fake stays"
    assert isinstance(build_tasks_dialer(_Settings("plivo"), _Phone(None, None)), FakeDialer)
    out, repo, _ = placer()
    real = build_tasks_dialer(_Settings("plivo"), _Phone(out, repo))
    assert isinstance(real, PlivoTaskDialer) and real.name == "plivo"
    with pytest.raises(ConfigurationError):
        build_tasks_dialer(_Settings("exotel"), None)
