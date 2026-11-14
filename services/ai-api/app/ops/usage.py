"""The per-provider usage ledger's writer (admin console, 13 Nov 2026): what each provider cost US, recorded when it happened, from MEASURED units (seconds, characters, tokens, messages, requests; never an estimate).

One small port, `UsageRecorder`, and three implementations: `PostgrestUsageRecorder` (the database function `public.ops_record_usage_batch`, called as the SYSTEM account: the registered scheduler account, the same sign-in
the worker and the phone server use), `FakeUsageRecorder` (tests) and None (not configured: nothing is recorded). The database is idempotent per (provider, unit, ref_kind, ref_id), so a retry changes nothing.

BEST EFFORT, always: a failure to record usage must never break a call, a message, a search or an answer. Callers use `record_best_effort`, which swallows every error and logs only the error's CLASS and a count
(never an id, a name, a number or a word of text). After a failure the recorder stays quiet for a short while (a circuit breaker) so a database that is down does not slow every send."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import re
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

from app.rpc_base import RpcClient
from app.tenancy.repository import TokenRejected

log = logging.getLogger("app.ops.usage")

MAX_BATCH = 50   # the database function takes at most this many lines at once
REF_ID = re.compile(r"^[A-Za-z0-9_.:-]{3,100}$")   # the database's own pattern for a reference
PROVIDERS = ("cartesia", "sarvam", "plivo", "anthropic", "meta", "google")
COOLDOWN_S = 30.0   # after a failed write, do not try again for this long (a breaker, not a queue: what was not recorded is not recorded)
TIMEOUT_S = 4.0     # a recorder never holds a call's end or a send for longer than this


@dataclass(frozen=True)
class UsageLine:
    """One provider line: `units` of `unit` from `provider`, belonging to `ref_kind` `ref_id` (a call, message, search or assistant turn)."""

    provider: str
    unit: str
    units: float | int | Decimal
    ref_kind: str
    ref_id: str


class UsageRecorder(Protocol):
    def record(self, tenant_id: uuid.UUID, lines: Sequence[UsageLine], *, occurred_at: datetime | None = None) -> None:
        """Write the lines (raises on any failure: callers go through `record_best_effort`)."""
        ...


GOOGLE_UNITS = ("search_ids", "search_pro", "search_enterprise", "details_pro", "details_enterprise")


def google_allowed(recorder: Any, unit: str, n: int = 1) -> bool:
    """May `n` more Google requests of this SKU go without leaving the free monthly cap? FAIL CLOSED: no recorder, no budget check, or any error means NO (nothing is spent without the owner's OK)."""
    check = getattr(recorder, "budget", None)
    if check is None or unit not in GOOGLE_UNITS or n < 1:
        return False
    try:
        return bool(check(unit, n))
    except Exception as exc:  # noqa: BLE001 - only the class is logged
        log.warning("google budget check failed: %s", exc.__class__.__name__)
        return False


class Principal(Protocol):
    def token(self) -> str: ...
    def invalidate(self) -> None: ...


def units_text(units: float | int | Decimal) -> str | None:
    """The units as the database reads them: a plain decimal with at most three places, or None when there is nothing to record (zero, negative, not a number)."""
    try:
        value = Decimal(str(units)).quantize(Decimal("0.001"))
    except (InvalidOperation, ValueError):
        return None
    if not value.is_finite() or value <= 0:
        return None
    return format(value.normalize(), "f")


def clean(lines: Sequence[UsageLine]) -> list[UsageLine]:
    """The lines worth sending: something was measured, and the reference is one the database accepts."""
    return [ln for ln in lines if ln.provider in PROVIDERS and units_text(ln.units) is not None and REF_ID.fullmatch(ln.ref_id)]


def record_best_effort(recorder: UsageRecorder | None, tenant_id: uuid.UUID | None, lines: Sequence[UsageLine], *, occurred_at: datetime | None = None) -> bool:
    """Record the lines, or do nothing. NEVER raises. True when the recorder took them."""
    if recorder is None or tenant_id is None:
        return False
    try:
        wanted = clean(lines)
        if not wanted:
            return False
        recorder.record(tenant_id, wanted, occurred_at=occurred_at)
        return True
    except Exception as exc:  # noqa: BLE001 - the thing that happened (a call, a message) must go on; only the class is logged
        log.warning("provider usage not recorded: %s (%d lines)", exc.__class__.__name__, len(lines))
        return False


class PostgrestUsageRecorder:
    """`public.ops_record_usage_batch` as the system account. `rpc` should have a short timeout (TIMEOUT_S); `principal` signs in as the registered scheduler account."""

    def __init__(self, rpc: RpcClient, principal: Principal, *, clock: Callable[[], float] = time.monotonic, cooldown_s: float = COOLDOWN_S) -> None:
        self._rpc, self._principal, self._clock, self._cooldown = rpc, principal, clock, cooldown_s
        self._quiet_until = 0.0

    def record(self, tenant_id: uuid.UUID, lines: Sequence[UsageLine], *, occurred_at: datetime | None = None) -> None:
        if self._clock() < self._quiet_until:
            return   # the last write failed a moment ago: skip (the failure was logged then)
        wanted = clean(lines)
        try:
            for start in range(0, len(wanted), MAX_BATCH):
                items: list[dict[str, Any]] = []
                for ln in wanted[start : start + MAX_BATCH]:
                    item: dict[str, Any] = {"tenant_id": str(tenant_id), "provider": ln.provider, "unit": ln.unit, "units": units_text(ln.units), "ref_kind": ln.ref_kind, "ref_id": ln.ref_id}
                    if occurred_at is not None:
                        item["occurred_at"] = occurred_at.isoformat()
                    items.append(item)
                self._rpc.call(self._principal.token(), "ops_record_usage_batch", {"p_items": items})
        except TokenRejected:
            self._principal.invalidate()
            self._quiet_until = self._clock() + self._cooldown
            raise
        except Exception:
            self._quiet_until = self._clock() + self._cooldown
            raise

    def budget(self, unit: str, n: int = 1) -> bool:
        """`public.ops_google_budget`: True when `n` more requests of this Google SKU stay inside the free monthly cap. Raises on any failure (callers use `google_allowed`, which fails closed)."""
        try:
            body = self._rpc.call(self._principal.token(), "ops_google_budget", {"p_unit": unit, "p_n": n})
        except TokenRejected:
            self._principal.invalidate()
            raise
        return isinstance(body, dict) and body.get("allowed") is True


class FakeUsageRecorder:
    """For tests: keeps every call. `fail` makes the next calls raise (a database that is down)."""

    def __init__(self, fail: Exception | None = None) -> None:
        self.calls: list[tuple[uuid.UUID, list[UsageLine], datetime | None]] = []
        self.fail = fail
        self.google_left: dict[str, int] | None = None   # None: every Google SKU has room; otherwise the requests left per unit
        self.budget_asked: list[tuple[str, int]] = []
        self.budget_fail: Exception | None = None   # the cap check cannot be answered (a database that is down)

    def budget(self, unit: str, n: int = 1) -> bool:
        self.budget_asked.append((unit, n))
        if self.budget_fail is not None:
            raise self.budget_fail
        return self.google_left is None or self.google_left.get(unit, 0) >= n

    def record(self, tenant_id: uuid.UUID, lines: Sequence[UsageLine], *, occurred_at: datetime | None = None) -> None:
        if self.fail is not None:
            raise self.fail
        self.calls.append((tenant_id, list(lines), occurred_at))

    @property
    def lines(self) -> list[UsageLine]:
        return [ln for _, lines, _ in self.calls for ln in lines]

    def find(self, provider: str, unit: str) -> UsageLine | None:
        return next((ln for ln in self.lines if ln.provider == provider and ln.unit == unit), None)


def build_usage_recorder(settings: Any, config: Any) -> PostgrestUsageRecorder | None:
    """The recorder of a process that holds the scheduler account (the worker, the phone server). None when that account is not configured: nothing is recorded, nothing breaks."""
    password = settings.scheduler_password.get_secret_value() if getattr(settings, "scheduler_password", None) is not None else ""
    if not getattr(settings, "scheduler_email", None) or not password:
        return None
    import httpx

    from app.scheduler.session import PrincipalSession

    principal = PrincipalSession(f"{config.supabase_url}/auth/v1", config.anon_key, settings.scheduler_email, password, client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)))
    return PostgrestUsageRecorder(RpcClient(config.rest_url, config.anon_key, timeout=TIMEOUT_S), principal)
