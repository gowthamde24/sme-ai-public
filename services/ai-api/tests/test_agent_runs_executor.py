"""The in-process worker pool: bounded, never logs the token, never lets a worker's failure
escape or leak text."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable

import pytest

from app.agent_runs.executor import ExecutorBusy, RunTask, ThreadRunExecutor

TOKEN = "TOKEN-CANARY-eyJhbGciOiJFUzI1NiJ9"
CANARY = "CANARY-77aa10"


def wait_for(condition: Callable[[], bool], seconds: float = 5.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return False


def task(n: int = 1) -> RunTask:
    return RunTask(run_id=uuid.UUID(int=n), token=TOKEN)


def test_a_task_never_shows_its_token() -> None:
    t = task()
    assert TOKEN not in repr(t) and TOKEN not in str(t) and t.token == TOKEN


def test_submitted_tasks_are_executed_with_their_token() -> None:
    seen: list[RunTask] = []
    done = threading.Event()

    def execute(t: RunTask) -> None:
        seen.append(t)
        done.set()

    pool = ThreadRunExecutor(execute, max_workers=1, max_queue=2)
    pool.submit(task())
    assert done.wait(5)
    pool.shutdown()
    assert seen[0].run_id == uuid.UUID(int=1) and seen[0].token == TOKEN


def test_capacity_is_bounded_and_a_full_pool_refuses_instead_of_queueing_forever() -> None:
    gate, started = threading.Event(), threading.Event()

    def execute(t: RunTask) -> None:
        started.set()
        gate.wait(5)

    pool = ThreadRunExecutor(execute, max_workers=1, max_queue=1)
    pool.submit(task(1))
    assert started.wait(5)
    pool.submit(task(2))  # fills the queue (1 running + 1 waiting = capacity)
    assert pool.has_capacity() is False
    with pytest.raises(ExecutorBusy):
        pool.submit(task(3))
    gate.set()
    pool.shutdown()


def test_capacity_is_released_when_a_task_finishes() -> None:
    gate = threading.Event()

    def hold(t: RunTask) -> None:
        gate.wait(5)

    pool = ThreadRunExecutor(hold, max_workers=1, max_queue=0)
    pool.submit(task(1))
    assert pool.has_capacity() is False
    gate.set()
    assert wait_for(pool.has_capacity)
    pool.shutdown()


def test_a_failing_task_is_contained_and_logged_by_class_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    done = threading.Event()

    def execute(t: RunTask) -> None:
        try:
            raise RuntimeError(f"{CANARY} {t.token}")
        finally:
            done.set()

    pool = ThreadRunExecutor(execute, max_workers=1, max_queue=1)
    pool.submit(task())
    assert done.wait(5)
    assert wait_for(pool.has_capacity), "a crashed task releases its slot"
    pool.shutdown()
    assert CANARY not in caplog.text and TOKEN not in caplog.text
    assert "RuntimeError" in caplog.text


def test_shutdown_does_not_hang_and_refuses_new_work() -> None:
    pool = ThreadRunExecutor(lambda t: None, max_workers=1, max_queue=1)
    pool.shutdown()
    with pytest.raises(ExecutorBusy):
        pool.submit(task())
