"""The re-accept gate (job BN, ADR 0075): when the terms or the privacy notice change, a signed-in person must accept the new version before they use a workspace.

Off by default (setting POLICY_ENFORCE); a version applies from its effective date (TERMS_EFFECTIVE_FROM / PRIVACY_EFFECTIVE_FROM, empty = at once), so the owner can publish a version a few days
before it binds. The routes a person needs in order to read and accept (`/v1/me/*`, `/v1/policies/*`, `/v1/account/*`) never pass through the gate; every workspace route does, after the role check, so a
stranger still gets the plain 404 and a person with a lower role the plain 403. The answer of a person who HAS accepted is remembered for a minute (never an answer of 'not accepted')."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from datetime import UTC, date, datetime

from app.errors import ApiError
from app.integrations.policy import PolicyVersions
from app.integrations.repository import IntegrationsRepository

CACHE_SECONDS = 60.0
CACHE_LIMIT = 10_000


def needs_acceptance(versions: PolicyVersions, accepted: list[dict[str, str]], today: date) -> dict[str, bool]:
    have = {(a.get("kind"), a.get("version")) for a in accepted}
    out: dict[str, bool] = {}
    for kind, version, effective in (
        ("terms", versions.terms, versions.terms_effective_from),
        ("privacy", versions.privacy, versions.privacy_effective_from),
    ):
        binding = effective is None or today >= effective
        out[kind] = binding and (kind, version) not in have
    return out


class PolicyGate:
    def __init__(
        self,
        versions: PolicyVersions,
        *,
        enforce: bool = False,
        monotonic: Callable[[], float] = time.monotonic,
        today: Callable[[], date] = lambda: datetime.now(UTC).date(),
    ) -> None:
        self.versions = versions
        self.enforce = enforce
        self._monotonic = monotonic
        self._today = today
        self._ok_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def today(self) -> date:
        return self._today()

    def forget(self, user_id: str) -> None:
        with self._lock:
            self._ok_until.pop(user_id, None)

    def status(self, integrations: IntegrationsRepository, token: str) -> dict[str, bool]:
        return needs_acceptance(self.versions, integrations.policy_mine(token), self._today())

    def check(self, integrations: IntegrationsRepository | None, token: str, user_id: str) -> None:
        if not self.enforce or integrations is None:
            return
        now = self._monotonic()
        with self._lock:
            if self._ok_until.get(user_id, 0.0) > now:
                return
        needs = self.status(integrations, token)
        if any(needs.values()):
            raise ApiError(
                403,
                "policy_acceptance_required",
                "The terms or the privacy notice changed. Read and accept the new version to continue.",
                extra={"terms": "required" if needs["terms"] else "accepted", "privacy": "required" if needs["privacy"] else "accepted"},
            )
        with self._lock:
            if len(self._ok_until) >= CACHE_LIMIT:
                self._ok_until.clear()
            self._ok_until[user_id] = now + CACHE_SECONDS
