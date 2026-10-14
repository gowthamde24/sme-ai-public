"""Job CP: the scheduler's campaign phase. The tick hands the database one call per business ("run the due campaign steps and the call list"); the database decides everything (both switches, the module, the approval,
each person's consent and STOP). Here: the phase runs between the reminders and the release, its counts are reported with the reminders, a failure is counted and does not stop the other phases or businesses, and
nothing in the tick knows a name, an amount or a word of a campaign."""

from __future__ import annotations

import uuid

from app.outbox.adapter import LocalFakeAdapter
from app.scheduler.tick import TickResult, run_tick
from app.tenancy.repository import TokenRejected, UpstreamError
from tests.scheduler_fakes import FakeScheduler

TOKEN = "worker-token"
T1 = uuid.UUID(int=0x71)
T2 = uuid.UUID(int=0x72)


def tick(db: FakeScheduler, adapter: LocalFakeAdapter | None = None) -> TickResult:
    return run_tick(db, adapter or LocalFakeAdapter(), TOKEN, interval_seconds=60)


def test_the_campaign_phase_runs_between_the_reminders_and_the_release_for_every_listed_business() -> None:
    db = FakeScheduler()
    db.listed = [T1, T2]
    tick(db)
    names = db.names()
    firsts = [names.index(n) for n in ("scheduler_due_reminders", "scheduler_campaign_run", "scheduler_claim_due", "scheduler_mark_no_shows")]
    assert firsts == sorted(firsts), "the first business: reminders, then campaigns, then the release, then no-shows"
    reverse = names[::-1]
    lasts = [len(names) - 1 - reverse.index(n) for n in ("scheduler_due_reminders", "scheduler_campaign_run", "scheduler_claim_due", "scheduler_mark_no_shows")]
    assert lasts == sorted(lasts), "and so the last"
    assert names.count("scheduler_campaign_run") == 2 and [a["tenant"] for a in db.args("scheduler_campaign_run")] == [str(T1), str(T2)]


def test_what_was_handed_over_is_reported_with_the_reminders_and_errors_with_the_errors() -> None:
    db = FakeScheduler()
    db.listed = [T1]
    db.campaign[T1] = {"queued": 5, "held": 1, "blocked": 2, "skipped": 4, "errors": 1, "calls": 3, "done": 1}
    result = tick(db)
    assert db.args("scheduler_record") == [{"tenant": str(T1), "sent": 0, "failed": 0, "reminders": 8, "no_shows": 0, "errors": 1}]
    assert result.tally.campaign_steps == 8 and result.tally.errors == 1 and not result.tally.idle()


def test_a_quiet_tick_with_no_campaign_is_idle() -> None:
    db = FakeScheduler()
    db.listed = [T1]
    assert tick(db).tally.idle()


def test_a_failing_campaign_phase_is_counted_and_the_other_phases_and_businesses_still_run() -> None:
    db = FakeScheduler()
    db.listed = [T1, T2]
    db.fail_for[("scheduler_campaign_run", T1)] = UpstreamError("down")
    result = tick(db)
    assert db.names().count("scheduler_claim_due") == 2 and db.names().count("scheduler_mark_no_shows") == 2
    recorded = {a["tenant"]: a for a in db.args("scheduler_record")}
    assert recorded[str(T1)]["errors"] == 1 and recorded[str(T2)]["errors"] == 0 and result.tally.errors == 1


def test_a_refused_token_still_ends_the_tick() -> None:
    db = FakeScheduler()
    db.listed = [T1]
    db.fail["scheduler_campaign_run"] = TokenRejected("expired")
    try:
        tick(db)
    except TokenRejected:
        return
    raise AssertionError("a refused token must stop the tick so that the worker signs in again")
