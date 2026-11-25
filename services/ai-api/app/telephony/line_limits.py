"""How many calls one workspace may have at once (EXTRA_LINES; migration 20261231992500): 2 lines for each phone number it has + the extra lines it bought that work. The number is the database's
(`phone_workspace_lines`, the phone server's own account). It is remembered for a few seconds, so a call's admission does not wait for the database, and a line bought or paused applies within that time (the
phone line's own row is kept for minutes, which is why this is a separate, shorter memory). An answer we could not read is None: the call is then limited by the deployment's own cap alone, never refused for it."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from typing import Any

log = logging.getLogger("app.telephony.line_limits")
TTL_S = 15.0
MAX_KEPT = 2000


class WorkspaceLines:
    def __init__(self, rpc: Any, system_token: Callable[[], str], *, ttl: float = TTL_S, clock: Callable[[], float] = time.monotonic) -> None:
        self._rpc, self._token, self._ttl, self._clock = rpc, system_token, ttl, clock
        self._kept: dict[uuid.UUID, tuple[float, int]] = {}

    def total(self, tenant_id: uuid.UUID) -> int | None:
        """The lines of this workspace, or None when the database cannot be read right now. Blocking (a database call): run it in a thread."""
        now = self._clock()
        hit = self._kept.get(tenant_id)
        if hit is not None and now - hit[0] < self._ttl:
            return hit[1]
        try:
            out = self._rpc.call(self._token(), "phone_workspace_lines", {"p_tenant_id": str(tenant_id)})
        except Exception as exc:  # noqa: BLE001 - a lookup that fails never refuses a call; only the class is logged
            log.warning("workspace lines not read: %s", exc.__class__.__name__)
            return None
        if not isinstance(out, int) or isinstance(out, bool) or out < 0:
            return None
        if len(self._kept) >= MAX_KEPT:
            self._kept.clear()
        self._kept[tenant_id] = (now, out)
        return out

    def forget(self, tenant_id: uuid.UUID) -> None:
        """A line was bought or cancelled here: the next call asks again."""
        self._kept.pop(tenant_id, None)
