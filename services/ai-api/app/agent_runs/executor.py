"""A bounded in-process worker pool for agent runs (no sweeper, no privileged principal: ADR
0013, option A).

A task carries the run id and the STARTING USER's token; the token is not in `repr`, not in a
log line, and reaches no tool. The pool refuses (ExecutorBusy) when its workers and its small
queue are full instead of queueing forever. A restart loses the runs in flight; they stay
`running` until their expiry, which the API shows lazily as `expired`."""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Protocol

logger = logging.getLogger("app.agent_runs.executor")


class ExecutorBusy(Exception):
    """No free worker or queue slot (or the pool is shutting down)."""


@dataclass(frozen=True)
class RunTask:
    run_id: uuid.UUID
    token: str = field(repr=False)
    agent: str = "selftest"


class RunSubmitter(Protocol):
    def has_capacity(self) -> bool: ...

    def submit(self, task: RunTask) -> None: ...

    def shutdown(self) -> None: ...


class ThreadRunExecutor:
    def __init__(
        self, execute: Callable[[RunTask], None], *, max_workers: int = 2, max_queue: int = 8
    ) -> None:
        self._execute = execute
        self._capacity = max_workers + max_queue
        self._in_flight = 0
        self._closed = False
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="agent-run")

    def has_capacity(self) -> bool:
        with self._lock:
            return not self._closed and self._in_flight < self._capacity

    def submit(self, task: RunTask) -> None:
        with self._lock:
            if self._closed or self._in_flight >= self._capacity:
                raise ExecutorBusy
            self._in_flight += 1
        try:
            self._pool.submit(self._run, task)
        except RuntimeError:
            self._release()
            raise ExecutorBusy from None

    def _run(self, task: RunTask) -> None:
        try:
            self._execute(task)
        except Exception as exc:  # a worker must never take the process down or leak text
            logger.error("agent run %s crashed: %s", task.run_id, exc.__class__.__name__)
        finally:
            self._release()

    def _release(self) -> None:
        with self._lock:
            self._in_flight -= 1

    def shutdown(self) -> None:
        with self._lock:
            self._closed = True
        self._pool.shutdown(wait=True, cancel_futures=True)
