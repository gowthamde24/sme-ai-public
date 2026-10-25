"""Plans and billing: what the routes and the worker call (job DI, ADR 0092). The provider is behind an interface; only the fake one exists.

Order of the two things that must agree, a subscription at the provider and its record in our database:
  * START: ask the database whether a trial may start (a cheap read), create the subscription at the provider (no charge), then record it. If the record fails the provider's subscription is cancelled at once, so
    nothing keeps running that we do not know of.
  * CANCEL: cancel at the provider FIRST (it is safe to repeat), then record the cancel. If the record fails the owner is told and tries again; no charge can happen after the provider was told.
  * EVENTS (renewals, failed payments): the provider's events are applied by the registered channel account; the database applies each event id once, so a repeated delivery changes nothing."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.billing.errors import (
    NothingToCancelError,
    PlanLimitReachedError,
    PlanUnknownError,
    TrialAlreadyStartedError,
    WorkspaceReadOnlyError,
)
from app.billing.provider import BillingProvider, CreateSubscription, ProviderEvent
from app.billing.repository import BillingRepository
from app.crm.repository import NotFoundError
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.billing")
ACCESS_TTL_SECONDS = 30.0
KINDS = ("call_minutes", "whatsapp_messages")


@dataclass(frozen=True)
class AppliedEvent:
    event_id: str
    tenant_id: str
    kind: str
    status: str | None


def _now() -> datetime:
    return datetime.now(UTC)


class BillingService:
    def __init__(self, repository: BillingRepository, provider: BillingProvider, *, clock: Callable[[], datetime] = _now) -> None:
        self._repo = repository
        self._provider = provider
        self._clock = clock
        self._access_cache: dict[uuid.UUID, tuple[float, str]] = {}

    # ------------------------------------------------------------------ reads
    def plans(self, token: str) -> dict[str, Any]:
        return self._repo.plans(token)

    def billing(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.billing(token, tenant_id)

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.usage(token, tenant_id)

    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.access(token, tenant_id)

    def forget(self, tenant_id: uuid.UUID | str) -> None:
        """Drop the remembered access state of a workspace (after its plan changed, and in tests)."""
        self._access_cache.pop(uuid.UUID(str(tenant_id)), None)

    def ensure_writable(self, token: str, tenant_id: uuid.UUID) -> None:
        """The gate of every change a person makes (job DI): a read-only workspace refuses it. The answer is kept for 30 seconds per workspace; a failure to ask lets the change through (a billing hiccup must
        never lock a business out: the database holds the sending anyway)."""
        now = time.monotonic()
        cached = self._access_cache.get(tenant_id)
        if cached is None or cached[0] < now:
            try:
                state = str(self._repo.access(token, tenant_id).get("access"))
            except RepositoryError as exc:
                logger.warning("billing: the access state could not be read (%s); the change goes through", exc.__class__.__name__)
                return
            cached = (now + ACCESS_TTL_SECONDS, state)
            self._access_cache[tenant_id] = cached
        if cached[1] == "read_only":
            raise WorkspaceReadOnlyError(str(tenant_id))

    # ------------------------------------------------------------------ the owner's two actions
    def start_trial(self, token: str, tenant_id: uuid.UUID, plan_id: str, checkout_ref: str) -> dict[str, Any]:
        catalogue = self._repo.plans(token)
        plan = next((p for p in catalogue["plans"] if p["id"] == plan_id and p["kind"] in ("main", "calls")), None)
        if plan is None:
            raise PlanUnknownError(plan_id)
        if not self._repo.billing(token, tenant_id)["can_start_trial"]:
            raise TrialAlreadyStartedError(str(tenant_id))
        created = self._provider.create_subscription(
            CreateSubscription(
                tenant_id=str(tenant_id),
                plan_id=plan_id,
                checkout_ref=checkout_ref,
                trial_days=int(catalogue["trial"]["days"]),
                price_paise=plan["price_paise_monthly"],
                started_at=self._clock(),
            )
        )
        self.forget(tenant_id)
        try:
            return self._repo.start_trial(token, tenant_id, plan_id, created.provider, created.reference)
        except RepositoryError:
            self._provider.cancel_subscription(created.reference, at_period_end=False, now=self._clock())
            raise

    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        sub = self._repo.subscription_ref(token, tenant_id)
        if sub is None or sub["status"] == "cancelled":
            raise NothingToCancelError(str(tenant_id))
        self._provider.cancel_subscription(str(sub["provider_ref"]), at_period_end=sub["status"] == "active", now=self._clock())
        self.forget(tenant_id)
        return self._repo.cancel(token, tenant_id)

    # ------------------------------------------------------------------ the worker's: provider events -> our records
    def apply(self, worker_token: str, event: ProviderEvent) -> AppliedEvent:
        result = self._repo.apply_event(worker_token, uuid.UUID(event.tenant_id), event.event_id, event.kind, event.amount_paise, event.occurred_at)
        return AppliedEvent(event.event_id, event.tenant_id, event.kind, result.get("status"))

    def advance(self, worker_token: str, now: datetime | None = None) -> list[AppliedEvent]:
        """Apply every event the provider says has fallen due (the fake provider's schedule; a real provider uses a webhook instead). Safe to run again: an applied event changes nothing."""
        applied: list[AppliedEvent] = []
        for event in self._provider.events_until(now or self._clock()):
            try:
                applied.append(self.apply(worker_token, event))
            except NotFoundError:
                # an event for a subscription we have no record of (a start whose record failed and was cancelled again): nothing to apply, and no reason to stop the others
                logger.warning("billing: an event for an unknown subscription was skipped (%s)", event.kind)
        return applied


class UsageGate:
    """The enforcement hook for the places that START a metered thing. A call about to begin asks `ensure_allowed(token, tenant, "call_minutes")`; the answer comes from the database meter, which already
    knows the plan, the top-ups and the platform switch. When a kind is stopped it raises PlanLimitReachedError (the API says `plan_limit_reached`). Quotes, orders, follow-ups and customers never ask.
    Business-initiated WhatsApp messages need no call here: the outbox's claim holds them in the database (migration 20261127090200). The call provider's seconds are recorded with `record_call_seconds`."""

    def __init__(self, repository: BillingRepository) -> None:
        self._repo = repository

    def ensure_allowed(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        if kind not in KINDS:
            raise ValueError("kind must be call_minutes or whatsapp_messages")
        answer = self._repo.check_usage(token, tenant_id, kind)
        if not answer["allowed"]:
            raise PlanLimitReachedError(kind)
        return answer

    def record_call_seconds(self, channel_token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, seconds: int) -> dict[str, Any]:
        return self._repo.record_usage(channel_token, tenant_id, "call_minutes", call_id, seconds)
