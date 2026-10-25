"""In-memory double of the billing repository for job DI (no database). It keeps the subscription state the way the database functions do, closely enough to test the SERVICE (the order of the provider and the
record, the events, the gate); the database's own rules are proved in supabase/tests/database/111_di_billing.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.billing.errors import NothingToCancelError, PlanUnknownError, TrialAlreadyStartedError
from app.crm.repository import NotFoundError

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
EXAMPLES = json.loads((CONTRACTS / "billing.examples.json").read_text())


class FakeBillingRepository:
    def __init__(self, *, price_paise: int | None = None) -> None:
        self.catalogue: dict[str, Any] = copy.deepcopy(EXAMPLES["plans"])
        for plan in self.catalogue["plans"]:
            if plan["kind"] in ("main", "calls") and price_paise is not None:
                plan["price_paise_monthly"] = price_paise
                plan["price_set"] = True
        self.subs: dict[uuid.UUID, dict[str, Any]] = {}
        self.events: list[tuple[uuid.UUID, str, str]] = []
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.fail_start: Exception | None = None
        self.stopped: set[str] = set()
        self.usage_records: list[tuple[str, uuid.UUID, str, uuid.UUID, int]] = []
        self.plan_of: dict[uuid.UUID, str] = {}
        self.read_only: set[uuid.UUID] = set()
        self.fail_access: Exception | None = None
        # job DM: the trial is 14 days counted from the day WhatsApp is connected; tenant -> that day (a workspace not in here is waiting for WhatsApp)
        self.trial_days = 14
        self.connected: dict[uuid.UUID, datetime] = {}
        self.clock_marked: set[uuid.UUID] = set()

    def _go(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))

    def plans(self, token: str) -> dict[str, Any]:
        self._go("plans", token)
        return copy.deepcopy(self.catalogue)

    def _plan(self, tenant_id: uuid.UUID) -> dict[str, Any]:
        wanted = self.plan_of.get(tenant_id, "free_trial")
        return next(p for p in self.catalogue["plans"] if p["id"] == wanted)

    def billing(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("billing", token)
        base: dict[str, Any] = copy.deepcopy(EXAMPLES["billing_no_subscription_ok"])
        base["plan"] = self._plan(tenant_id)
        sub = self.subs.get(tenant_id)
        base["subscription"] = None if sub is None else {k: v for k, v in sub.items() if k not in ("provider_ref",)}
        base["can_start_trial"] = sub is None
        connected = self.connected.get(tenant_id)
        base["whatsapp_connected_at"] = connected.isoformat() if connected else None
        base.update(self.access(token, tenant_id))
        return base

    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("access", token)
        if self.fail_access is not None:
            raise self.fail_access
        if tenant_id in self.read_only:
            return {"access": "read_only", "read_only_since": "2026-10-14", "delete_on": "2027-01-12", "data_days_left": 79}
        return {"access": "full", "read_only_since": None, "delete_on": None, "data_days_left": None}

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("usage", token)
        b = self.billing(token, tenant_id)
        return {"period": b["period"], "usage": b["usage"], "notices": b["notices"]}

    def check_usage(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        self._go("check_usage", token, kind)
        meter = copy.deepcopy(EXAMPLES["billing_no_subscription_ok"]["usage"][kind])
        return {"allowed": kind not in self.stopped, "meter": meter}

    def subscription_ref(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        self._go("subscription_ref", token)
        sub = self.subs.get(tenant_id)
        return None if sub is None else {"provider": sub["provider"], "provider_ref": sub["provider_ref"], "status": sub["status"], "trial_ends_at": sub["trial_ends_at"]}

    def start_trial(self, token: str, tenant_id: uuid.UUID, plan_id: str, provider: str, provider_ref: str) -> dict[str, Any]:
        self._go("start_trial", token, plan_id, provider, provider_ref)
        if self.fail_start is not None:
            raise self.fail_start
        if not any(p["id"] == plan_id and p["kind"] in ("main", "calls") for p in self.catalogue["plans"]):
            raise PlanUnknownError(plan_id)
        if tenant_id in self.subs:
            raise TrialAlreadyStartedError(str(tenant_id))
        connected = self.connected.get(tenant_id)
        self.subs[tenant_id] = {
            "status": "trialing", "plan_id": plan_id, "provider": provider, "provider_ref": provider_ref,
            "trial_ends_at": (connected + timedelta(days=self.trial_days)).isoformat() if connected else None, "current_period_end": None,
            "cancel_at_period_end": False, "grace_until": None, "payment_method_on_file": True, "trial_waiting_for_whatsapp": connected is None,
        }
        return self.billing(token, tenant_id)

    def connect_whatsapp(self, tenant_id: uuid.UUID, at: datetime) -> None:
        """What the database trigger does when the number first becomes active: a trial that was waiting gets its end."""
        self.connected.setdefault(tenant_id, at)
        sub = self.subs.get(tenant_id)
        if sub is not None and sub["status"] == "trialing" and sub["trial_ends_at"] is None:
            sub.update(trial_ends_at=(at + timedelta(days=self.trial_days)).isoformat(), trial_waiting_for_whatsapp=False)

    def trial_clocks_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        self._go("trial_clocks_due", token)
        return [
            {"tenant_id": str(t), "provider": s["provider"], "provider_ref": s["provider_ref"], "trial_ends_at": s["trial_ends_at"]}
            for t, s in self.subs.items()
            if s["status"] == "trialing" and s["trial_ends_at"] is not None and t not in self.clock_marked
        ][:limit]

    def trial_clock_mark(self, token: str, tenant_id: uuid.UUID) -> None:
        self._go("trial_clock_mark", token)
        self.clock_marked.add(tenant_id)

    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("cancel", token)
        sub = self.subs.get(tenant_id)
        if sub is None or sub["status"] == "cancelled":
            raise NothingToCancelError(str(tenant_id))
        if sub["status"] in ("trialing", "past_due"):
            sub.update(status="cancelled", payment_method_on_file=False, grace_until=None)
            self.plan_of[tenant_id] = "free_trial"
        else:
            sub["cancel_at_period_end"] = True
        return self.billing(token, tenant_id)

    def record_usage(self, token: str, tenant_id: uuid.UUID, kind: str, ref_id: uuid.UUID, units: int) -> dict[str, Any]:
        self._go("record_usage", token, kind, units)
        self.usage_records.append((token, tenant_id, kind, ref_id, units))
        return copy.deepcopy(EXAMPLES["billing_no_subscription_ok"]["usage"][kind])

    def apply_event(self, token: str, tenant_id: uuid.UUID, event_id: str, kind: str, amount_paise: int | None, at: datetime) -> dict[str, Any]:
        self._go("apply_event", token, event_id, kind)
        if tenant_id not in self.subs:
            raise NotFoundError("23503")
        sub = self.subs[tenant_id]
        if any(e[1] == event_id for e in self.events if e[0] == tenant_id):
            return {k: v for k, v in sub.items() if k != "provider_ref"}
        self.events.append((tenant_id, event_id, kind))
        if sub["status"] == "cancelled" and kind != "cancelled":
            pass
        elif kind == "charge_succeeded":
            sub.update(status="active", grace_until=None, current_period_end=(at + timedelta(days=30)).isoformat())
            self.plan_of[tenant_id] = sub["plan_id"]
        elif kind == "charge_failed":
            sub.update(status="past_due", grace_until=sub["grace_until"] or (at + timedelta(days=7)).isoformat())
        elif kind in ("halted", "cancelled"):
            sub.update(status="cancelled", payment_method_on_file=False, grace_until=None)
            self.plan_of[tenant_id] = "free_trial"
        return {k: v for k, v in sub.items() if k != "provider_ref"}
