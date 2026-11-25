"""What the routes share: the repository, the vault of the connections' secrets, the guarded HTTP client, and the Test button's pacing."""

# ruff: noqa: E501

from __future__ import annotations

import time
from collections.abc import Callable

from app.connector_vault import ConnectorVault
from app.notify_out.repository import NotifyRepository
from app.outbound_http import GuardedHttp

TEST_EVERY_S = 10.0   # the Test button: at most one message each 10 seconds per channel


class NotifyOut:
    def __init__(self, repo: NotifyRepository, vault: ConnectorVault | None, http: GuardedHttp | None = None, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.repo = repo
        self.vault = vault
        self.http = http or GuardedHttp()
        self._clock = clock
        self._tested: dict[tuple[str, str], float] = {}

    def test_allowed(self, tenant: str, kind: str) -> bool:
        now = self._clock()
        last = self._tested.get((tenant, kind))
        if last is not None and now - last < TEST_EVERY_S:
            return False
        if len(self._tested) > 5000:
            self._tested.clear()
        self._tested[(tenant, kind)] = now
        return True
