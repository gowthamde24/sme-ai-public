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

from app.billing.errors import (
    CapRequiredError,
    NoSubscriptionError,
    NotAnUpgradeError,
    NothingToCancelError,
    NotLapsedError,
    PackUnknownError,
    PlanUnknownError,
    PurchaseIdUsedError,
    TrialAlreadyStartedError,
)
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
        # night 4, job DS part E2: top-ups, settings, invoices, the upgrade, the alerts (the database's own rules are proved in 129_ds_topups.test.sql)
        self.purchases: dict[uuid.UUID, dict[str, Any]] = {}
        self.invoice_rows: list[dict[str, Any]] = []
        self.topup_settings_row: dict[str, Any] | None = None
        self.alert_rows: list[dict[str, Any]] = []
        self.alerts_marked: list[tuple[uuid.UUID, str, int, str, str]] = []
        self.tick_invoices = 0

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
        base["can_start_trial"] = sub is None and not self.can_resume(tenant_id)
        base["can_resume"] = self.can_resume(tenant_id)
        connected = self.connected.get(tenant_id)
        base["whatsapp_connected_at"] = connected.isoformat() if connected else None
        base.update({k: v for k, v in self.access(token, tenant_id).items() if k not in ("can_resume", "sending", "waiting_for")})
        return base

    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("access", token)
        if self.fail_access is not None:
            raise self.fail_access
        sub = self.subs.get(tenant_id)
        waiting = "whatsapp" if sub is not None and sub["status"] == "trial_pending" else None
        if tenant_id in self.read_only:
            return {"access": "read_only", "read_only_since": "2026-10-14", "delete_on": "2027-01-12", "data_days_left": 79, "can_resume": self.can_resume(tenant_id), "sending": "off", "waiting_for": waiting}
        return {"access": "full", "read_only_since": None, "delete_on": None, "data_days_left": None, "can_resume": self.can_resume(tenant_id), "sending": "off" if waiting else "on", "waiting_for": waiting}

    def can_resume(self, tenant_id: uuid.UUID) -> bool:
        sub = self.subs.get(tenant_id)
        if sub is None:
            return tenant_id in self.read_only   # the free trial ended without a plan
        return sub["status"] != "trial_pending" and (sub["status"] == "cancelled" or tenant_id in self.read_only)

    def resume(self, token: str, tenant_id: uuid.UUID, plan_id: str, provider: str, provider_ref: str) -> dict[str, Any]:
        self._go("resume", token, plan_id, provider, provider_ref)
        if self.fail_start is not None:
            raise self.fail_start
        if not any(p["id"] == plan_id and p["kind"] in ("main", "calls") for p in self.catalogue["plans"]):
            raise PlanUnknownError(plan_id)
        if not self.can_resume(tenant_id):
            raise NotLapsedError(str(tenant_id))
        sub = self.subs.setdefault(tenant_id, {"status": "active", "plan_id": plan_id, "provider": provider, "provider_ref": provider_ref, "trial_ends_at": None, "current_period_end": None, "cancel_at_period_end": False, "grace_until": None, "payment_method_on_file": True, "trial_waiting_for": None})
        sub.update(status="active", plan_id=plan_id, provider=provider, provider_ref=provider_ref, cancel_at_period_end=False, grace_until=None, payment_method_on_file=True)
        self.plan_of[tenant_id] = plan_id
        self.read_only.discard(tenant_id)
        return self.billing(token, tenant_id)

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
        if tenant_id in self.subs or self.can_resume(tenant_id):
            raise TrialAlreadyStartedError(str(tenant_id))
        connected = self.connected.get(tenant_id)
        self.subs[tenant_id] = {
            "status": "trialing" if connected else "trial_pending", "plan_id": plan_id, "provider": provider, "provider_ref": provider_ref,
            "trial_ends_at": (connected + timedelta(days=self.trial_days)).isoformat() if connected else None, "current_period_end": None,
            "cancel_at_period_end": False, "grace_until": None, "payment_method_on_file": True, "trial_waiting_for": None if connected else "whatsapp",
        }
        return self.billing(token, tenant_id)

    def connect_whatsapp(self, tenant_id: uuid.UUID, at: datetime) -> None:
        """What the database trigger does when the number first becomes active: a trial that was waiting gets its end."""
        self.connected.setdefault(tenant_id, at)
        sub = self.subs.get(tenant_id)
        if sub is not None and sub["status"] == "trial_pending":
            sub.update(status="trialing", trial_ends_at=(at + timedelta(days=self.trial_days)).isoformat(), trial_waiting_for=None)

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
        if sub["status"] in ("trial_pending", "trialing", "past_due"):
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


    # ------------------------------------------------------------------------------------------------ night 4, job DS part E2
    PACKS = (("minutes_100", "call_minutes", 100, 40000), ("minutes_300", "call_minutes", 300, 108000), ("minutes_1000", "call_minutes", 1000, 340000),
             ("messages_100", "whatsapp_messages", 100, 6000), ("messages_300", "whatsapp_messages", 300, 16200), ("messages_1000", "whatsapp_messages", 1000, 51000))

    def _settings(self) -> dict[str, Any]:
        row = self.topup_settings_row or {"auto_minutes_pack": None, "auto_messages_pack": None, "auto_monthly_cap_paise": 0, "overage_minutes": False, "overage_messages": False, "overage_monthly_cap_paise": 0}
        return {**row, "overage_rate_paise_per_minute": 500, "overage_rate_paise_per_message": 70, "auto_spent_paise": 0, "overage_spent_paise": 0}

    def topups(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("topups", token)
        packs = [{"code": c, "kind": k, "units": u, "price_paise": p, "gst_rate_bp": 1800, "gst_paise": (p * 1800 + 5000) // 10000, "total_paise": p + (p * 1800 + 5000) // 10000, "price_is_placeholder": True} for c, k, u, p in self.PACKS]
        empty = {"units": 0.0, "lots": []}
        return {"packs": packs, "balance": {"call_minutes": dict(empty), "whatsapp_messages": dict(empty)}, "settings": self._settings(),
                "history": [h["purchase"] for h in reversed(list(self.purchases.values()))][:20]}

    def _invoice(self, kind: str, description: str, taxable: int) -> dict[str, Any]:
        gst = (taxable * 1800 + 5000) // 10000
        row = {"id": str(uuid.uuid4()), "number": f"S19-2611-{len(self.invoice_rows) + 1:06d}", "kind": kind, "description": description, "issued_at": "2026-11-02T05:30:00+00:00", "period_start": None,
               "taxable_paise": taxable, "gst_rate_bp": 1800, "cgst_paise": 0, "sgst_paise": 0, "igst_paise": gst, "total_paise": taxable + gst,
               "seller": {"name": "Stack19 (test seller)", "state_code": "36", "gstin": None}, "buyer": {"gstin": None, "state_code": None}, "fake": True, "payment_status": "paid_fake"}
        self.invoice_rows.append(row)
        return row

    def buy_topup(self, token: str, tenant_id: uuid.UUID, purchase_id: uuid.UUID, pack_code: str) -> dict[str, Any]:
        self._go("buy_topup", token, purchase_id, pack_code)
        pack = next((p for p in self.PACKS if p[0] == pack_code), None)
        if pack is None:
            raise PackUnknownError(pack_code)
        have = self.purchases.get(purchase_id)
        if have is not None:
            if have["purchase"]["pack_code"] != pack_code:
                raise PurchaseIdUsedError(str(purchase_id))
            return {"created": False, "purchase": have["purchase"], "invoice": have["invoice"], "usage": self.billing(token, tenant_id)["usage"]}
        if tenant_id not in self.subs or self.subs[tenant_id]["status"] not in ("trial_pending", "trialing", "active"):
            raise NoSubscriptionError(str(tenant_id))
        invoice = self._invoice("topup", f"Top-up: {pack[2]}", pack[3])
        purchase = {"id": str(purchase_id), "pack_code": pack[0], "kind": pack[1], "units": pack[2], "source": "manual", "price_paise": pack[3], "total_paise": invoice["total_paise"],
                    "purchased_at": "2026-11-02T05:30:00+00:00", "expires_at": "2027-01-31T05:30:00+00:00", "units_left": float(pack[2]), "expired": False, "invoice_id": invoice["id"]}
        self.purchases[purchase_id] = {"purchase": purchase, "invoice": invoice}
        return {"created": True, "purchase": purchase, "invoice": invoice, "usage": self.billing(token, tenant_id)["usage"]}

    def topup_settings(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        self._go("topup_settings", token, settings)
        for key, kind in (("auto_minutes_pack", "call_minutes"), ("auto_messages_pack", "whatsapp_messages")):
            if settings[key] is not None and not any(p[0] == settings[key] and p[1] == kind for p in self.PACKS):
                raise PackUnknownError(str(settings[key]))
        if ((settings["auto_minutes_pack"] or settings["auto_messages_pack"]) and settings["auto_monthly_cap_paise"] == 0) or ((settings["overage_minutes"] or settings["overage_messages"]) and settings["overage_monthly_cap_paise"] == 0):
            raise CapRequiredError("cap")
        self.topup_settings_row = dict(settings)
        return self._settings()

    def invoices(self, token: str, tenant_id: uuid.UUID, limit: int, after_at: datetime | None, after_id: uuid.UUID | None) -> list[dict[str, Any]]:
        self._go("invoices", token, limit)
        return list(reversed(self.invoice_rows))[:limit]

    def invoice(self, token: str, tenant_id: uuid.UUID, invoice_id: uuid.UUID) -> dict[str, Any]:
        self._go("invoice", token, invoice_id)
        row = next((r for r in self.invoice_rows if r["id"] == str(invoice_id)), None)
        if row is None:
            raise NotFoundError("23503")
        return row

    def upgrade_preview(self, token: str, tenant_id: uuid.UUID, plan_id: str) -> dict[str, Any]:
        self._go("upgrade_preview", token, plan_id)
        sub = self.subs.get(tenant_id)
        if sub is None or sub["status"] not in ("trial_pending", "trialing", "active"):
            raise NoSubscriptionError(str(tenant_id))
        target = next((p for p in self.catalogue["plans"] if p["id"] == plan_id and p["kind"] in ("main", "calls")), None)
        if target is None:
            raise PlanUnknownError(plan_id)
        current = next(p for p in self.catalogue["plans"] if p["id"] == sub["plan_id"])
        if target["sort"] <= current["sort"]:
            raise NotAnUpgradeError(plan_id)
        priced = target["price_paise_monthly"] is not None and current["price_paise_monthly"] is not None
        pro = None if not priced or sub["status"] != "active" else ((target["price_paise_monthly"] - current["price_paise_monthly"]) * 18 * 2 + 31) // 62
        if sub["status"] != "active":
            pro = 0
        gst = None if pro is None else (pro * 1800 + 5000) // 10000
        return {"from_plan_id": sub["plan_id"], "to_plan_id": plan_id, "price_set": priced, "days_in_period": 31, "days_left": 18, "prorated_paise": pro, "gst_paise": gst,
                "total_paise": None if pro is None else pro + (gst or 0), "new_allowances": {"call_minutes": target["allowances"]["call_minutes"], "whatsapp_messages": target["allowances"]["whatsapp_messages"]},
                "effective": "now", "note": "test"}

    def upgrade(self, token: str, tenant_id: uuid.UUID, plan_id: str) -> dict[str, Any]:
        self._go("upgrade", token, plan_id)
        preview = self.upgrade_preview(token, tenant_id, plan_id)
        sub = self.subs[tenant_id]
        sub["plan_id"] = plan_id
        invoice = None
        if sub["status"] == "active":
            self.plan_of[tenant_id] = plan_id
            invoice = self._invoice("upgrade", f"Upgrade to {plan_id}", int(preview["prorated_paise"] or 0))
        return {"billing": self.billing(token, tenant_id), "invoice": invoice}

    def topup_tick(self, token: str, limit: int) -> dict[str, Any]:
        self._go("topup_tick", token)
        return {"invoices": self.tick_invoices}

    def alerts_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        self._go("alerts_due", token)
        return list(self.alert_rows)[:limit]

    def alert_mark(self, token: str, tenant_id: uuid.UUID, kind: str, level: int, period_start: Any, channel: str) -> None:
        self._go("alert_mark", token, channel)
        self.alerts_marked.append((tenant_id, kind, level, str(period_start), channel))
