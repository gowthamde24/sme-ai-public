"""Job AW (ADR 0068): the scheduler's tick, worker loop and sign-in against an in-memory fake. What is tested here is what the PYTHON side owes: it asks the database before it does anything, does nothing
for a business the database does not list, carries out exactly what it is handed (one message id per reminder, however many workers ask; the words are the fixed templates; an unchecked language is
submitted uncertain), counts what happened, keeps going when a phase, a business or a whole tick fails, signs in again when the token is refused, and never logs a word, a phone number or a secret.

THE CLOCK. This side has no clock to pin: every decision about time (quiet hours 08:59 / 09:00 / 20:59 / 21:00, the evening window, a visit at 00:30, the 30-minute floor, the lease) is the database's and
is tested at pinned instants in pgTAP 79 and in tests/integration/test_scheduler_api.py. The only time here is the worker's schedule, which runs on a fake monotonic clock."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import threading
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.outbox.adapter import LocalFakeAdapter
from app.outbox.service import DISPATCH_BATCH
from app.scheduler import tick
from app.scheduler.session import PrincipalSession, SignInError
from app.scheduler.tick import MAX_BATCHES, reminder_message_id, run_tick
from app.scheduler.worker import Worker, build_worker
from app.tenancy.repository import TokenRejected, UpstreamError
from app.visits import texts
from tests.scheduler_fakes import (
    PHONE,
    TENANT_1,
    TENANT_2,
    VISIT,
    FakeScheduler,
    claim_item,
    due_item,
)

TOKEN = "worker-token"  # noqa: S105 - a fixture, not a secret


class FakeSession:
    """Stands in for PrincipalSession: counts the sign-ins."""

    def __init__(self) -> None:
        self.sign_ins = 0
        self.invalidated = 0
        self._valid = False

    def token(self) -> str:
        if not self._valid:
            self.sign_ins += 1
            self._valid = True
        return TOKEN

    def invalidate(self) -> None:
        self.invalidated += 1
        self._valid = False


def tick_once(db: FakeScheduler, adapter: LocalFakeAdapter | None = None) -> tick.TickResult:
    return run_tick(db, adapter or LocalFakeAdapter(), TOKEN, interval_seconds=60)


# ---------------------------------------------------------------------------------------------- safe by default
def test_a_tick_with_no_listed_business_asks_the_database_and_does_nothing_else() -> None:
    db = FakeScheduler()
    result = tick_once(db)
    assert db.names() == ["scheduler_tenants", "scheduler_heartbeat"]
    assert db.args("scheduler_heartbeat") == [{"interval": 60, "errors": 0}]
    assert result.tenants == 0 and result.tally.idle()


def test_every_call_carries_the_workers_token_and_nothing_names_a_business_it_was_not_given() -> (
    None
):
    db = FakeScheduler()
    db.listed = [TENANT_1]
    tick_once(db)
    assert {c[1] for c in db.calls} == {TOKEN}
    for call in db.calls:
        assert str(TENANT_2) not in repr(call[2])


# ---------------------------------------------------------------------------------------------- release
def test_due_messages_go_through_the_outbox_dispatch_loop_and_are_marked() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.claims[TENANT_1] = [[claim_item(1), claim_item(2)]]
    adapter = LocalFakeAdapter()
    result = tick_once(db, adapter)
    assert [m.message_id for m in adapter.sent] == [uuid.UUID(int=1), uuid.UUID(int=2)]
    marks = db.args("scheduler_mark")
    assert [(m["p_message_id"], m["p_outcome"], m["p_adapter"]) for m in marks] == [
        (str(uuid.UUID(int=n)), "sent", "fake") for n in (1, 2)
    ]
    assert all(m["p_adapter_message_id"].startswith("fake-") for m in marks)
    assert db.args("scheduler_record") == [
        {
            "tenant": str(TENANT_1),
            "sent": 2,
            "failed": 0,
            "reminders": 0,
            "no_shows": 0,
            "errors": 0,
        }
    ]
    assert result.tally.sent == 2


def test_a_channel_failure_is_reported_as_failed_with_its_code() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.claims[TENANT_1] = [[claim_item(1), claim_item(2)]]
    adapter = LocalFakeAdapter()
    adapter.fail_next(uuid.UUID(int=1), "timeout")
    result = tick_once(db, adapter)
    outcomes = {
        m["p_message_id"]: (m["p_outcome"], m.get("p_failure_code"))
        for m in db.args("scheduler_mark")
    }
    assert outcomes[str(uuid.UUID(int=1))] == ("failed", "timeout")
    assert outcomes[str(uuid.UUID(int=2))][0] == "sent"
    assert (result.tally.sent, result.tally.failed) == (1, 1)


def test_a_backlog_is_handed_over_in_batches_up_to_a_limit() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.claims[TENANT_1] = [
        [claim_item(b * 100 + n) for n in range(DISPATCH_BATCH)] for b in range(MAX_BATCHES + 3)
    ]
    result = tick_once(db)
    assert len(db.args("scheduler_claim_due")) == MAX_BATCHES, (
        "a backlog is finished by the next tick, not by one endless one"
    )
    assert result.tally.sent == MAX_BATCHES * DISPATCH_BATCH


def test_a_short_batch_ends_the_release() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.claims[TENANT_1] = [[claim_item(1)], [claim_item(2)]]
    tick_once(db)
    assert len(db.args("scheduler_claim_due")) == 1


# ---------------------------------------------------------------------------------------------- reminders
def test_a_due_reminder_is_queued_with_the_fixed_words_a_stable_id_and_its_language() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.due[TENANT_1] = [due_item("evening_before", "en", starts_at="2026-10-06T05:30:00+00:00")]
    result = tick_once(db)
    sent = db.args("scheduler_queue_reminder")
    assert len(sent) == 1
    starts = datetime(2026, 10, 6, 5, 30, tzinfo=UTC)
    assert sent[0] == {
        "p_tenant_id": str(TENANT_1),
        "p_visit_id": VISIT,
        "p_kind": "evening_before",
        "p_message_id": str(reminder_message_id(uuid.UUID(VISIT), "evening_before", starts, "en")),
        "p_body": "A reminder: your visit to our shop is on Tuesday, 6 October at 11:00 am. We look forward to seeing you.",
        "p_language": "en",
        "p_uncertain": False,
    }
    assert result.tally.reminders == 1


def test_two_workers_asking_for_the_same_reminder_make_the_same_message_id() -> None:
    starts = datetime(2026, 10, 6, 5, 30, tzinfo=UTC)
    a = reminder_message_id(uuid.UUID(VISIT), "heads_up", starts, "en")
    assert a == reminder_message_id(uuid.UUID(VISIT), "heads_up", starts, "en")
    assert a != reminder_message_id(uuid.UUID(VISIT), "evening_before", starts, "en"), (
        "the kind is part of the identity"
    )
    assert a != reminder_message_id(
        uuid.UUID(VISIT), "heads_up", datetime(2026, 10, 7, 5, 30, tzinfo=UTC), "en"
    ), "a visit that moved is a new appointment"
    assert a != reminder_message_id(uuid.UUID(VISIT), "heads_up", starts, "hi")


@pytest.mark.parametrize("language", ["te", "hi", "kn", "ta"])
def test_a_language_no_native_reader_has_checked_is_submitted_uncertain(language: str) -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.due[TENANT_1] = [due_item("heads_up", language)]
    tick_once(db)
    sent = db.args("scheduler_queue_reminder")[0]
    assert sent["p_uncertain"] is True and sent["p_language"] == language
    assert sent["p_body"] == texts.render(
        "reminder", language, datetime(2026, 10, 6, 5, 30, tzinfo=UTC)
    )


def test_an_unknown_language_falls_back_to_english_and_a_missing_one_too() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.due[TENANT_1] = [
        due_item("heads_up", "xx"),
        {**due_item("evening_before"), "language": None},
    ]
    tick_once(db)
    assert [a["p_language"] for a in db.args("scheduler_queue_reminder")] == ["en", "en"]


def test_only_a_queued_answer_counts_as_a_reminder() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.due[TENANT_1] = [due_item("heads_up"), due_item("evening_before")]
    db.queue_answer = {"status": "replayed", "replayed": True}
    assert tick_once(db).tally.reminders == 0
    db.queue_answer = {"status": "skipped", "reason": "not_due"}
    assert tick_once(db).tally.reminders == 0


def test_one_odd_reminder_is_counted_and_the_others_still_go() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.due[TENANT_1] = [
        {"visit_id": "not-a-uuid", "kind": "heads_up", "starts_at": "x"},
        {**due_item(), "kind": "birthday"},
        {**due_item(), "starts_at": "2026-10-06T11:00:00"},
        due_item("heads_up"),
    ]
    result = tick_once(db)
    assert len(db.args("scheduler_queue_reminder")) == 1
    assert (result.tally.reminders, result.tally.errors) == (1, 3)


def test_the_reminders_go_out_in_the_same_tick_that_queues_them() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.due[TENANT_1] = [due_item()]
    tick_once(db)
    names = db.names()
    assert names.index("scheduler_queue_reminder") < names.index("scheduler_claim_due"), (
        "queue first, then release"
    )


# ---------------------------------------------------------------------------------------------- no-show
def test_the_no_show_count_comes_from_the_database() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.no_shows[TENANT_1] = 3
    result = tick_once(db)
    assert result.tally.no_shows == 3
    assert db.args("scheduler_record")[0]["no_shows"] == 3


# ---------------------------------------------------------------------------------------------- failure isolation
def test_a_failing_phase_is_counted_and_the_others_still_run() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.fail["scheduler_due_reminders"] = UpstreamError("boom")
    db.claims[TENANT_1] = [[claim_item(1)]]
    db.no_shows[TENANT_1] = 1
    result = tick_once(db)
    assert (result.tally.errors, result.tally.sent, result.tally.no_shows) == (1, 1, 1)
    assert db.args("scheduler_heartbeat") == [{"interval": 60, "errors": 1}]


def test_a_failing_business_does_not_stop_the_others() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1, TENANT_2]
    db.fail_for[("scheduler_claim_due", TENANT_1)] = UpstreamError("boom")
    db.claims[TENANT_2] = [[claim_item(7)]]
    result = tick_once(db)
    recorded = {a["tenant"]: a for a in db.args("scheduler_record")}
    assert recorded[str(TENANT_1)]["errors"] == 1 and recorded[str(TENANT_1)]["sent"] == 0
    assert recorded[str(TENANT_2)]["sent"] == 1 and recorded[str(TENANT_2)]["errors"] == 0
    assert result.tally.sent == 1 and result.tally.errors == 1


def test_a_database_that_cannot_list_the_businesses_still_gets_a_heartbeat_with_the_error() -> None:
    db = FakeScheduler()
    db.fail["scheduler_tenants"] = UpstreamError("down")
    result = tick_once(db)
    assert result.tally.errors == 1
    assert db.args("scheduler_heartbeat") == [{"interval": 60, "errors": 1}]


def test_a_failed_record_or_heartbeat_does_not_raise() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.fail["scheduler_record"] = UpstreamError("down")
    db.fail["scheduler_heartbeat"] = UpstreamError("down")
    result = tick_once(db)
    assert result.tally.errors == 1


def test_a_refused_token_ends_the_tick_it_is_not_swallowed() -> None:
    for where in (
        "scheduler_tenants",
        "scheduler_due_reminders",
        "scheduler_claim_due",
        "scheduler_mark_no_shows",
        "scheduler_record",
        "scheduler_heartbeat",
    ):
        db = FakeScheduler()
        db.listed = [TENANT_1]
        db.fail[where] = TokenRejected("401")
        with pytest.raises(TokenRejected):
            tick_once(db)


def test_an_adapter_that_raises_marks_the_message_failed_and_the_batch_continues() -> None:
    class Broken(LocalFakeAdapter):
        def send(self, message: Any) -> Any:
            if message.message_id == uuid.UUID(int=1):
                raise RuntimeError("socket exploded with +00 912345 in the text")
            return super().send(message)

    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.claims[TENANT_1] = [[claim_item(1), claim_item(2)]]
    result = tick_once(db, Broken())
    assert (result.tally.sent, result.tally.failed) == (1, 1)


# ---------------------------------------------------------------------------------------------- logs
def test_logs_hold_counts_never_words_numbers_or_names(caplog: pytest.LogCaptureFixture) -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    db.claims[TENANT_1] = [
        [claim_item(1, "Dear Priya Sharma, your silk saree is ready at +00 912345")]
    ]
    db.due[TENANT_1] = [due_item()]
    db.fail["scheduler_record"] = UpstreamError("down +00 912345")
    with caplog.at_level(logging.DEBUG):
        tick_once(db)
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "scheduler tick: tenants=1 sent=1 failed=0 reminders=1 no_shows=0 errors=1" in text
    for forbidden in (PHONE, "Priya", "silk saree", str(TENANT_1), VISIT, TOKEN):
        assert forbidden not in text, forbidden


# ---------------------------------------------------------------------------------------------- the worker
def make_worker(
    db: FakeScheduler, session: FakeSession | None = None, clock: list[float] | None = None
) -> tuple[Worker, FakeSession]:
    session = session or FakeSession()
    ticks = clock if clock is not None else [0.0]
    worker = Worker(
        db, LocalFakeAdapter(), session, interval_seconds=60, monotonic=lambda: ticks[0]
    )
    return worker, session


def test_a_crashed_tick_is_answered_with_none_and_the_next_one_runs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    worker, _ = make_worker(db)
    real = tick.run_tick

    def crash(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("a bug with +00 912345 in it")

    monkeypatch.setattr("app.scheduler.worker.run_tick", crash)
    with caplog.at_level(logging.ERROR):
        assert worker.tick_once() is None
    assert "RuntimeError" in caplog.text and PHONE not in caplog.text, (
        "only the class of the error is kept"
    )
    monkeypatch.setattr("app.scheduler.worker.run_tick", real)
    result = worker.tick_once()
    assert result is not None and result.tenants == 1, "the next tick ran"


def test_a_refused_token_makes_the_worker_sign_in_again() -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    worker, session = make_worker(db)
    db.fail["scheduler_tenants"] = TokenRejected("PGRST301")
    assert worker.tick_once() is None
    assert session.invalidated == 1
    assert worker.tick_once() is not None
    assert session.sign_ins == 2, "signed in once at the start and once more after the refusal"


def test_a_sign_in_that_fails_is_logged_without_the_reason_and_the_worker_goes_on(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class Broken:
        def token(self) -> str:
            raise SignInError("the scheduler account could not sign in")

        def invalidate(self) -> None: ...

    db = FakeScheduler()
    worker = Worker(db, LocalFakeAdapter(), Broken(), interval_seconds=60)
    with caplog.at_level(logging.ERROR):
        assert worker.tick_once() is None
    assert db.calls == [], "nothing was asked of the database without a token"
    assert "could not sign in" in caplog.text


class ClockStop(threading.Event):
    """A stop event whose wait() costs no real time: it records what it was asked to wait and moves the fake clock on (a little late, as a real wait is)."""

    def __init__(self, now: list[float], late: float = 0.0) -> None:
        super().__init__()
        self.now, self.late, self.waits = now, late, []  # type: ignore[var-annotated]

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout or 0.0)
        self.now[0] += (timeout or 0.0) + self.late
        return self.is_set()


def test_the_loop_ticks_on_a_fixed_schedule_and_survives_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = FakeScheduler()
    db.listed = [TENANT_1]
    now = [0.0]
    stop = ClockStop(now, late=0.5)  # each wait ends half a second late
    worker, _ = make_worker(db, clock=now)
    real = tick.run_tick
    seen = {"ticks": 0}

    def counting(*args: Any, **kwargs: Any) -> Any:
        seen["ticks"] += 1
        if seen["ticks"] == 2:
            raise RuntimeError("a crash in the second tick")
        if seen["ticks"] == 4:
            stop.set()
        return real(*args, **kwargs)

    monkeypatch.setattr("app.scheduler.worker.run_tick", counting)
    worker.run_forever(stop)
    assert seen["ticks"] == 4, "the crashed second tick did not end the loop"
    assert len(db.args("scheduler_heartbeat")) == 3, "three ticks completed, one crashed"
    assert all(55.0 <= w <= 60.0 for w in stop.waits), stop.waits


def test_an_overrunning_tick_starts_the_next_one_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeScheduler()
    now = [0.0]
    stop = ClockStop(now)
    worker, _ = make_worker(db, clock=now)

    def slow(*args: Any, **kwargs: Any) -> Any:
        now[0] += 200.0  # longer than the interval
        stop.set()

    monkeypatch.setattr("app.scheduler.worker.run_tick", slow)
    worker.run_forever(stop)
    assert stop.waits == [0]


def test_the_worker_refuses_an_interval_outside_five_seconds_and_an_hour() -> None:
    for bad in (0, 4, 3601):
        with pytest.raises(ValueError, match="between 5 and 3600"):
            Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=bad)


# ---------------------------------------------------------------------------------------------- sign-in
def make_session(handler: Any, clock: list[float]) -> PrincipalSession:
    return PrincipalSession(
        "http://auth.local/auth/v1",
        "anon-key",
        "scheduler@system.example.test",
        "pw-fixture",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        monotonic=lambda: clock[0],
    )


def test_the_session_signs_in_once_and_again_after_three_quarters_of_the_tokens_life() -> None:
    requests: list[httpx.Request] = []
    now = [1000.0]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200, json={"access_token": f"tok-{len(requests)}", "expires_in": 3600}
        )

    session = make_session(handler, now)
    assert session.token() == "tok-1" and session.token() == "tok-1"
    assert len(requests) == 1
    assert requests[0].url.params["grant_type"] == "password"
    assert requests[0].headers["apikey"] == "anon-key"
    now[0] += 3600 * 0.75 - 1
    assert session.token() == "tok-1"
    now[0] += 2
    assert session.token() == "tok-2", "signed in again before the token ran out"


def test_an_invalidated_session_signs_in_again() -> None:
    n = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        n["i"] += 1
        return httpx.Response(200, json={"access_token": f"tok-{n['i']}", "expires_in": 3600})

    session = make_session(handler, [0.0])
    assert session.token() == "tok-1"
    session.invalidate()
    assert session.token() == "tok-2"


def test_a_refused_sign_in_raises_a_plain_error_and_logs_no_secret(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "error": "invalid_grant",
                "error_description": "Invalid login credentials pw-fixture scheduler@system.example.test",
            },
        )

    session = make_session(handler, [0.0])
    with caplog.at_level(logging.DEBUG), pytest.raises(SignInError) as raised:
        session.token()
    for text in (str(raised.value), caplog.text):
        assert (
            "pw-fixture" not in text
            and "scheduler@system.example.test" not in text
            and "Invalid login" not in text
        )


def test_an_unreachable_auth_service_and_an_odd_answer_are_sign_in_errors() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(SignInError):
        make_session(down, [0.0]).token()

    def odd(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"nope": 1})

    with pytest.raises(SignInError):
        make_session(odd, [0.0]).token()


# ---------------------------------------------------------------------------------------------- start-up
def settings(**over: Any) -> Settings:
    base: dict[str, Any] = {
        "api_env": "development",
        "scheduler_email": "scheduler@system.example.test",
        "scheduler_password": SecretStr("pw-fixture"),
        "supabase_publishable_key": "anon-key",
    }
    base.update(over)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


def test_the_worker_is_built_from_settings() -> None:
    worker = build_worker(settings(scheduler_interval_seconds=30))
    assert worker.interval_seconds == 30


@pytest.mark.parametrize(
    "over",
    [
        {"scheduler_email": None},
        {"scheduler_password": None},
        {"scheduler_password": SecretStr("")},
        {"scheduler_interval_seconds": 4},
        {"scheduler_interval_seconds": 3601},
        {"outbox_adapter": "whatsapp"},
    ],
)
def test_the_worker_refuses_to_start_when_it_is_set_up_wrongly(over: dict[str, Any]) -> None:
    with pytest.raises(ConfigurationError):
        build_worker(settings(**over))


def test_the_workers_password_is_a_secret_in_settings() -> None:
    assert "pw-fixture" not in repr(settings())
