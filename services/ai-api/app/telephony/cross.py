"""Calls across API instances (migration 20261231990900). With more than one instance a live call lives on one of them; the others reach it through the database:

  * `platform_live`: how many calls are live platform-wide (the concurrent-call limit counts it, see LiveCalls.count);
  * commands: a whisper or a hang-up asked of an instance that does not hold the call is written to the database; the instance that holds it takes it within about a second, does it and says so.

The words of a whisper are kept only until the instance takes them. Take-over (a live audio stream) is not moved: it stays "call_not_here" on the wrong instance and the web retries the connection."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Protocol

from app.telephony.live import LiveCalls

log = logging.getLogger("app.telephony.cross")

IDLE_S = 3.0      # no call here: look at the platform count this often
BUSY_S = 1.0      # a call here: look for commands this often
WAIT_S = 2.5      # the owner's request waits this long for the other instance


class CommandStore(Protocol):
    def live_count(self) -> int: ...
    def push(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, kind: str, body: str | None) -> dict[str, Any]: ...
    def status(self, token: str, tenant_id: uuid.UUID, command_id: uuid.UUID) -> dict[str, Any]: ...
    def claim(self, call_ids: list[uuid.UUID]) -> list[dict[str, Any]]: ...
    def finish(self, command_id: uuid.UUID, ok: bool) -> None: ...


class RpcCommandStore:
    """The database's door: the owner's token for push and status, the phone server's own account for the count, the claim and the finish."""

    def __init__(self, rpc: Any, system_token: Any) -> None:
        self._rpc, self._system = rpc, system_token

    def live_count(self) -> int:
        out = self._rpc.call(self._system(), "phone_live_count", {})
        return out if isinstance(out, int) and not isinstance(out, bool) else 0

    def push(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, kind: str, body: str | None) -> dict[str, Any]:
        out: dict[str, Any] = self._rpc.object(token, "call_command_push", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_kind": kind, "p_body": body})
        return out

    def status(self, token: str, tenant_id: uuid.UUID, command_id: uuid.UUID) -> dict[str, Any]:
        state: dict[str, Any] = self._rpc.object(token, "call_command_status", {"p_tenant_id": str(tenant_id), "p_id": str(command_id)})
        return state

    def claim(self, call_ids: list[uuid.UUID]) -> list[dict[str, Any]]:
        out = self._rpc.call(self._system(), "call_command_claim", {"p_call_ids": [str(c) for c in call_ids]})
        return [x for x in out if isinstance(x, dict)] if isinstance(out, list) else []

    def finish(self, command_id: uuid.UUID, ok: bool) -> None:
        self._rpc.call(self._system(), "call_command_finish", {"p_id": str(command_id), "p_ok": ok})


async def ask_other_instance(store: CommandStore, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, kind: str, body: str | None = None) -> bool:
    """True when the instance that holds the call did it within WAIT_S. False: the call is not live, or nobody took it in time."""
    pushed = await asyncio.to_thread(store.push, token, tenant_id, call_id, kind, body)
    raw = pushed.get("id")
    if not pushed.get("queued") or not isinstance(raw, str):
        return False
    command_id = uuid.UUID(raw)
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        await asyncio.sleep(0.4)
        state = await asyncio.to_thread(store.status, token, tenant_id, command_id)
        if state.get("done"):
            return bool(state.get("ok"))
    return False


async def apply_commands(live: LiveCalls, store: CommandStore) -> int:
    """Take the commands for the calls held here and do them. Returns how many were handled."""
    ids = live.call_ids()
    if not ids:
        return 0
    handled = 0
    for command in await asyncio.to_thread(store.claim, ids):
        ok = False
        try:
            tenant = uuid.UUID(str(command["tenant_id"]))
            call = uuid.UUID(str(command["call_id"]))
            if command.get("kind") == "whisper":
                ok = live.whisper(tenant, call, str(command.get("body") or ""))
            elif command.get("kind") == "hang_up":
                ok = await live.hang_up(tenant, call)
        except Exception as exc:  # noqa: BLE001 - only the class is logged (never the words)
            log.warning("call command failed: %s", exc.__class__.__name__)
        try:
            await asyncio.to_thread(store.finish, uuid.UUID(str(command["id"])), ok)
        except Exception as exc:  # noqa: BLE001
            log.warning("call command could not be closed: %s", exc.__class__.__name__)
        handled += 1
    return handled


async def run_worker(live: LiveCalls, store: CommandStore, stop: asyncio.Event) -> None:
    """The loop of one instance: keep the platform count fresh, and take commands while a call is held here."""
    while not stop.is_set():
        busy = bool(live.call_ids())
        try:
            live.platform_live = await asyncio.to_thread(store.live_count)
            live.platform_at = time.monotonic()
            if busy:
                await apply_commands(live, store)
        except Exception as exc:  # noqa: BLE001
            log.warning("call coordination failed: %s", exc.__class__.__name__)
        try:
            await asyncio.wait_for(stop.wait(), BUSY_S if busy else IDLE_S)
        except TimeoutError:
            pass
