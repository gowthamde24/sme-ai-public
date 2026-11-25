"""Calls across API instances (migration 20261231990900; app/telephony/cross.py): the live count of the whole platform, and whisper / hang-up reaching the instance that holds the call. A fake store stands in for the database."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

import pytest

from app.telephony import cross
from app.telephony.live import LiveCalls
from tests.fakes import TENANT_A

CALL = uuid.uuid4()


class Line:
    def __init__(self) -> None:
        self.whispers: list[str] = []
        self.hung: list[str] = []
        self.transcript: list[Any] = []

    async def hang_up(self, reason: str) -> None:
        self.hung.append(reason)


class FakeStore:
    def __init__(self) -> None:
        self.live = 0
        self.queue: list[dict[str, Any]] = []
        self.done: dict[uuid.UUID, bool] = {}
        self.push_result: dict[str, Any] = {"queued": True}
        self.claims = 0

    def live_count(self) -> int:
        return self.live

    def push(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, kind: str, body: str | None) -> dict[str, Any]:
        if not self.push_result.get("queued"):
            return self.push_result
        cid = uuid.uuid4()
        self.queue.append({"id": str(cid), "tenant_id": str(tenant_id), "call_id": str(call_id), "kind": kind, "body": body})
        return {"queued": True, "id": str(cid)}

    def status(self, token: str, tenant_id: uuid.UUID, command_id: uuid.UUID) -> dict[str, Any]:
        return {"done": command_id in self.done, "ok": self.done.get(command_id, False), "known": True}

    def claim(self, call_ids: list[uuid.UUID]) -> list[dict[str, Any]]:
        self.claims += 1
        mine = [c for c in self.queue if uuid.UUID(c["call_id"]) in call_ids]
        self.queue = [c for c in self.queue if c not in mine]
        return mine

    def finish(self, command_id: uuid.UUID, ok: bool) -> None:
        self.done[command_id] = ok


def test_the_count_is_the_most_of_this_process_and_the_platform() -> None:
    live = LiveCalls()
    assert live.count() == 0
    live.add(TENANT_A.id, CALL, Line())  # type: ignore[arg-type]
    live.also_known_as(CALL, uuid.uuid4())   # one call known by two ids is still one call
    assert live.local_count() == 1 and live.count() == 1
    live.platform_live, live.platform_at = 5, time.monotonic()
    assert live.count() == 5
    live.platform_at = time.monotonic() - 60   # an old answer is ignored
    assert live.count() == 1
    live.platform_live, live.platform_at = 0, time.monotonic()
    assert live.count() == 1


def test_the_instance_that_holds_the_call_does_the_commands_and_says_so() -> None:
    async def scenario() -> None:
        live, store = LiveCalls(), FakeStore()
        line = Line()
        live.add(TENANT_A.id, CALL, line)  # type: ignore[arg-type]
        store.queue = [
            {"id": str(uuid.uuid4()), "tenant_id": str(TENANT_A.id), "call_id": str(CALL), "kind": "whisper", "body": "ask about the colour"},
            {"id": str(uuid.uuid4()), "tenant_id": str(TENANT_A.id), "call_id": str(CALL), "kind": "hang_up", "body": None},
            {"id": str(uuid.uuid4()), "tenant_id": str(uuid.uuid4()), "call_id": str(CALL), "kind": "whisper", "body": "another workspace"},
        ]
        assert await cross.apply_commands(live, store) == 3
        assert line.whispers == ["ask about the colour"] and line.hung == ["stopped"]
        assert sorted(store.done.values()) == [False, True, True]   # another workspace's whisper is refused, never done
        empty = LiveCalls()
        assert await cross.apply_commands(empty, store) == 0 and store.claims == 1   # nothing held here: the database is not even asked

    asyncio.run(scenario())


def test_asking_the_other_instance_waits_for_its_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    async def scenario() -> None:
        monkeypatch.setattr(cross, "WAIT_S", 2.0)
        store = FakeStore()

        async def other_instance() -> None:
            await asyncio.sleep(0.5)
            for command in store.queue:
                store.done[uuid.UUID(command["id"])] = True

        task = asyncio.create_task(other_instance())
        assert await cross.ask_other_instance(store, "t", TENANT_A.id, CALL, "whisper", "hello") is True
        await task
        store.done.clear()
        monkeypatch.setattr(cross, "WAIT_S", 0.5)
        assert await cross.ask_other_instance(store, "t", TENANT_A.id, CALL, "hang_up") is False   # nobody took it in time
        store.push_result = {"queued": False, "reason": "not_live"}
        assert await cross.ask_other_instance(store, "t", TENANT_A.id, CALL, "hang_up") is False

    asyncio.run(scenario())


def test_the_worker_keeps_the_count_fresh_and_stops() -> None:
    async def scenario() -> None:
        live, store = LiveCalls(), FakeStore()
        store.live = 3
        stop = asyncio.Event()
        task = asyncio.create_task(cross.run_worker(live, store, stop))
        await asyncio.sleep(0.2)
        assert live.platform_live == 3 and live.count() == 3
        stop.set()
        await asyncio.wait_for(task, 5)

    asyncio.run(scenario())


def test_two_instances_sharing_one_database_whisper_hang_up_and_count_across_each_other() -> None:
    """The multi-instance story end to end with two LiveCalls and two workers on ONE shared store (the database): a request that lands on instance A for a call held by B is done by B within a worker tick, and each sees the other's calls in the count."""

    class Shared(FakeStore):
        """One database for both instances: the count is every call held anywhere; a command waits for the instance that holds its call."""

        def __init__(self, a: LiveCalls, b: LiveCalls) -> None:
            super().__init__()
            self.instances = (a, b)

        def live_count(self) -> int:
            return sum(i.local_count() for i in self.instances)

    async def scenario() -> None:
        a, b = LiveCalls(), LiveCalls()
        shared = Shared(a, b)
        line = Line()
        b.add(TENANT_A.id, CALL, line)  # type: ignore[arg-type]
        stop = asyncio.Event()
        workers = [asyncio.create_task(cross.run_worker(i, shared, stop)) for i in (a, b)]
        await asyncio.sleep(0.2)
        assert a.count() == 1 and b.count() == 1, "A counts the call B holds"
        # a request lands on A: the call is not here, so it is asked of the other instance
        assert a.line_of(TENANT_A.id, CALL) is None
        assert await cross.ask_other_instance(shared, "tok", TENANT_A.id, CALL, "whisper", "ask about the colour") is True
        assert line.whispers == ["ask about the colour"]
        assert await cross.ask_other_instance(shared, "tok", TENANT_A.id, CALL, "hang_up") is True
        assert line.hung == ["stopped"]
        stop.set()
        await asyncio.wait_for(asyncio.gather(*workers), 5)

    saved = (cross.BUSY_S, cross.IDLE_S)
    cross.BUSY_S = cross.IDLE_S = 0.1
    try:
        asyncio.run(scenario())
    finally:
        cross.BUSY_S, cross.IDLE_S = saved
