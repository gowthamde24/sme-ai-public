# ruff: noqa: E501
"""Billing v2 reads and the free start (the owner's final pricing of 13 Nov 2026). The database holds the rules (migration 20261231560000); here they are turned into the words and numbers a screen shows, all in rupees."""

from __future__ import annotations

import math
import uuid
from typing import Any, Protocol

from app.billing.errors import NotSupportedError
from app.billing.provider import BillingProvider, CreateSubscription, OrderRequest, ProviderEvent
from app.pricing.inr import inr, minutes_text
from app.pricing.models import (
    BalanceOut,
    CatalogueOut,
    ChangeQuoteOut,
    EstimateIn,
    EstimateOut,
    FreeStartOut,
    InvoiceOut,
    InvoicesOut,
    OrderIn,
    OrderOut,
    PlanOut,
    SubscriptionCheckoutOut,
    SubscriptionOut,
)
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

LOW_MINUTES = 20   # a balance under about 20 minutes of calling is "low"


class FairUseError(RepositoryError):
    """SM992: a plan with Lead Finder is unlimited up to a fair-use number of searches a month."""


class OrderRefusedError(RepositoryError):
    """22023: the amount or the plan of an order is not allowed (a top-up outside Rs 100 to Rs 1,00,000, a change with nothing to pay, an unknown plan)."""


class PaymentNotVerifiedError(Exception):
    """The provider's signature on a payment did not check: nothing was credited."""


class PricingRepository(Protocol):
    def catalogue(self, token: str) -> dict[str, Any]: ...
    def balance(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None) -> dict[str, Any]: ...
    def subscribe(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, provider: str, provider_ref: str | None, payment_ref: str) -> dict[str, Any]: ...
    def change_quote(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> dict[str, Any]: ...
    def change_apply(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, ref: str) -> dict[str, Any]: ...
    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def order_create(self, token: str, tenant_id: uuid.UUID, order_id: str, purpose: str, amount_paise: int | None, plan_id: str | None, interval: str | None) -> dict[str, Any]: ...
    def order_settle(self, token: str, tenant_id: uuid.UUID, order_id: str, payment_ref: str) -> dict[str, Any]: ...
    def provider_event(self, token: str, tenant_id: uuid.UUID, event_id: str, kind: str, amount_paise: int | None) -> dict[str, Any]: ...
    def invoices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...


class PostgrestPricingRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM992": FairUseError, "22023": OrderRefusedError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def catalogue(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_catalogue", {})

    def balance(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_balance", {"p_tenant_id": str(tenant_id)})

    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_free_start_grant", {"p_tenant_id": str(tenant_id), "p_phone_hash": phone_hash})

    def subscribe(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, provider: str, provider_ref: str | None, payment_ref: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_subscribe", {"p_tenant_id": str(tenant_id), "p_plan_id": plan_id, "p_interval": interval, "p_provider": provider, "p_provider_ref": provider_ref, "p_payment_ref": payment_ref})

    def change_quote(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_change_quote", {"p_tenant_id": str(tenant_id), "p_plan_id": plan_id, "p_interval": interval})

    def change_apply(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, ref: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_change_apply", {"p_tenant_id": str(tenant_id), "p_plan_id": plan_id, "p_interval": interval, "p_payment_ref": ref})

    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_cancel", {"p_tenant_id": str(tenant_id)})

    def order_create(self, token: str, tenant_id: uuid.UUID, order_id: str, purpose: str, amount_paise: int | None, plan_id: str | None, interval: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_order_create", {"p_tenant_id": str(tenant_id), "p_order_id": order_id, "p_purpose": purpose, "p_amount_paise": amount_paise, "p_plan_id": plan_id, "p_interval": interval})

    def order_settle(self, token: str, tenant_id: uuid.UUID, order_id: str, payment_ref: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_order_settle", {"p_tenant_id": str(tenant_id), "p_order_id": order_id, "p_payment_ref": payment_ref})

    def provider_event(self, token: str, tenant_id: uuid.UUID, event_id: str, kind: str, amount_paise: int | None) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_provider_event", {"p_tenant_id": str(tenant_id), "p_event_id": event_id, "p_kind": kind, "p_amount_paise": amount_paise})

    def invoices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return list(self._rpc.array(token, "pricing_invoices", {"p_tenant_id": str(tenant_id)}))


def _plan_lines(p: dict[str, Any]) -> list[str]:
    lines = [f"{inr(p['monthly_paise'])} a month" + (" for your business number and the app" if p["included_minutes"] == 0 else "")]
    lines.append(f"{p['included_minutes']:,} call minutes included, then {inr(p['rate_paise_per_minute'])} a minute" if p["included_minutes"] else f"{inr(p['rate_paise_per_minute'])} a minute for calls")
    lines.append("Your business number is included" if p["numbers_included"] == 1 and p["included_minutes"] else f"Up to {p['numbers_included']} business number" + ("s" if p["numbers_included"] != 1 else ""))
    lines.append("Lead Finder: unlimited searches (fair use)" if p["lead_finder"] else f"Lead Finder: 1 free search a month, then {inr(p['extra_search_paise'])} each")
    lines.append("Billed per 30 seconds. Calls nobody answers are free.")
    return lines


def plan_out(p: dict[str, Any]) -> PlanOut:
    return PlanOut(
        id=p["id"], name=p["name"], monthly_paise=p["monthly_paise"], yearly_paise=p["yearly_paise"], monthly_text=f"{inr(p['monthly_paise'])} a month", yearly_text=f"{inr(p['yearly_paise'])} a year",
        yearly_saving_text="2 months free", included_minutes=p["included_minutes"], rate_paise_per_minute=p["rate_paise_per_minute"], rate_text=f"{inr(p['rate_paise_per_minute'])} a minute",
        numbers_included=p["numbers_included"], lead_finder=bool(p["lead_finder"]), free_searches_month=p["free_searches_month"], extra_search_paise=p["extra_search_paise"], lines=_plan_lines(p),
    )


def catalogue_out(doc: dict[str, Any]) -> CatalogueOut:
    gst = float(doc["gst_percent"])
    return CatalogueOut(gst_percent=gst, gst_text=f"+{gst:g}% GST on invoices", free_start_paise=int(doc["free_start_paise"]), free_start_text=f"{inr(int(doc['free_start_paise']))} free to start, no card",
                        plans=[plan_out(p) for p in doc["plans"]])


def balance_out(doc: dict[str, Any], rate: int | None = None) -> BalanceOut:
    paise = int(doc["balance_paise"])
    minutes = int(doc.get("minutes_estimate") or 0)
    left_half = max(int(doc["included_minutes"]) * 2 - int(doc.get("included_half_used") or 0), 0)
    sub = doc.get("subscription")
    free_left = int(doc.get("free_start_left_paise") or 0)
    return BalanceOut(
        balance_paise=paise, balance_text=inr(paise), minutes_estimate=minutes, summary_text=f"{inr(paise)} · {minutes_text(minutes)}", plan_id=doc["plan_id"], plan_name=doc["plan_name"],
        low=minutes < LOW_MINUTES, topup_available=True, free_start_granted=bool(doc.get("free_start_granted")), free_start_left_paise=free_left,
        free_start_left_text=inr(free_left) if free_left else None, included_minutes=int(doc["included_minutes"]), included_minutes_left=left_half // 2,
        subscription=SubscriptionOut.model_validate(sub) if isinstance(sub, dict) else None,
    )


class PricingService:
    def __init__(self, repository: PricingRepository, provider: BillingProvider | None = None) -> None:
        self._repo = repository
        self._provider = provider

    def catalogue(self, token: str) -> CatalogueOut:
        return catalogue_out(self._repo.catalogue(token))

    def balance(self, token: str, tenant_id: uuid.UUID) -> BalanceOut:
        return balance_out(self._repo.balance(token, tenant_id))

    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None = None) -> FreeStartOut:
        got = self._repo.free_start(token, tenant_id, phone_hash)
        paise = int(got["balance_paise"])
        return FreeStartOut(granted=bool(got["granted"]), reason=got.get("reason"), balance_paise=paise, balance_text=inr(paise))

    def estimate(self, token: str, tenant_id: uuid.UUID, body: EstimateIn) -> EstimateOut:
        """Time and rupees for a planned job: calls x average minutes x the rate of THIS business's plan, each call rounded up to the next half minute (billed per 30 seconds), the plan's included minutes used first."""
        doc = self._repo.balance(token, tenant_id)
        rate = int(doc["rate_paise_per_minute"])
        per_call_half = math.ceil(body.avg_minutes * 2 - 1e-9)
        total_half = per_call_half * body.calls
        left_half = max(int(doc["included_minutes"]) * 2 - int(doc.get("included_half_used") or 0), 0)
        included_half = min(total_half, left_half)
        paid_half = total_half - included_half
        cost = paid_half * (rate // 2)
        balance = int(doc["balance_paise"])
        hours, mins = divmod(int(round(total_half / 2)), 60)
        time_text = "about " + (f"{hours} h " if hours else "") + f"{mins} min of calling"
        return EstimateOut(
            calls=body.calls, avg_minutes=body.avg_minutes, total_minutes=total_half / 2, included_minutes_used=included_half / 2, paid_minutes=paid_half / 2, rate_text=f"{inr(rate)} a minute",
            cost_paise=cost, cost_text=inr(cost), time_text=time_text, balance_paise=balance, enough=balance >= cost, shortfall_text=None if balance >= cost else f"{inr(cost - balance)} more needed",
        )

    # ------------------------------------------------------------------------------------------------ paying: subscribe, change, cancel, orders, invoices
    def _plan(self, token: str, plan_id: str) -> dict[str, Any]:
        plan = next((p for p in self._repo.catalogue(token)["plans"] if p["id"] == plan_id), None)
        if plan is None:
            raise OrderRefusedError("22023")
        return dict(plan)

    def _need_provider(self) -> BillingProvider:
        if self._provider is None:
            raise NotSupportedError("no payment provider")
        return self._provider

    def _base(self, token: str, plan_id: str, interval: str) -> int:
        plan = self._plan(token, plan_id)
        return int(plan["yearly_paise"] if interval == "yearly" else plan["monthly_paise"])

    def subscription_checkout(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> SubscriptionCheckoutOut:
        """Step 1 of subscribing: the subscription the provider's checkout will authorise (nothing is charged yet). The fake provider has no such step."""
        from datetime import UTC, datetime

        base, provider = self._base(token, plan_id, interval), self._need_provider()
        key_id: str | None = None
        sub_id: str | None = None
        begin = getattr(provider, "begin_checkout", None)
        if begin is not None:
            session = begin(CreateSubscription(tenant_id=str(tenant_id), plan_id=plan_id, checkout_ref="", trial_days=0, price_paise=base, started_at=datetime.now(UTC), interval=interval))
            key_id, sub_id = session.key_id, session.subscription_id
        gst = _gst(base, self._repo.catalogue(token))
        return SubscriptionCheckoutOut(provider=provider.name, key_id=key_id, subscription_id=sub_id, plan_id=plan_id, interval=interval, amount_text=inr(base), gst_text=inr(gst), total_text=inr(base + gst))  # type: ignore[arg-type]

    def subscribe(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, checkout_ref: str) -> BalanceOut:
        """Step 2: the checkout returned its reference; the provider checks it (a wrong signature refuses), then the plan is recorded and the first invoice written, once per payment."""
        from datetime import UTC, datetime

        base, provider = self._base(token, plan_id, interval), self._need_provider()
        made = provider.create_subscription(CreateSubscription(tenant_id=str(tenant_id), plan_id=plan_id, checkout_ref=checkout_ref, trial_days=0, price_paise=base, started_at=datetime.now(UTC), interval=interval))
        parts = checkout_ref.split(".")
        payment_ref = parts[1] if provider.name == "razorpay" and len(parts) == 3 else f"pay_{made.reference}"[:100]
        self._repo.subscribe(token, tenant_id, plan_id, interval, provider.name, made.reference, payment_ref)
        return self.balance(token, tenant_id)

    def change_quote(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> ChangeQuoteOut:
        q = self._repo.change_quote(token, tenant_id, plan_id, interval)
        due, gst, total, credit = int(q["amount_due_paise"]), int(q["gst_paise"]), int(q["total_due_paise"]), int(q["credit_paise"])
        return ChangeQuoteOut(from_plan=q["from_plan"], to_plan=q["to_plan"], days_left=int(q["days_left"]), days_in_period=int(q["days_in_period"]), amount_text=inr(due), gst_text=inr(gst), total_text=inr(total),
                              total_paise=total, credit_text=f"{inr(credit)} goes to your balance" if credit else None, needs_payment=total > 0)

    def downgrade(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> BalanceOut:
        """A change with nothing to pay: the plan changes now and the unused share is credited to the balance. Refused (OrderRefusedError) when something is due: that goes through an order."""
        import hashlib

        quote = self._repo.change_quote(token, tenant_id, plan_id, interval)
        if int(quote["amount_due_paise"]) > 0:
            raise OrderRefusedError("22023")
        sub = self._repo.balance(token, tenant_id).get("subscription") or {}
        ref = "chg_" + hashlib.sha256(f"{tenant_id}|{plan_id}|{interval}|{sub.get('period_end')}".encode()).hexdigest()[:24]
        self._repo.change_apply(token, tenant_id, plan_id, interval, ref)
        return self.balance(token, tenant_id)

    def cancel(self, token: str, tenant_id: uuid.UUID) -> BalanceOut:
        """Cancel at the end of the paid period. The provider is told too (it stops charging); nothing is refunded; the data stays."""
        from datetime import UTC, datetime

        got = self._repo.cancel(token, tenant_id)
        ref, name = got.pop("provider_ref", None), got.pop("provider", None)
        if self._provider is not None and ref and name == self._provider.name:
            self._provider.cancel_subscription(str(ref), at_period_end=True, now=datetime.now(UTC))
        return balance_out(got)

    def create_order(self, token: str, tenant_id: uuid.UUID, body: OrderIn) -> OrderOut:
        import uuid as _uuid

        provider = self._need_provider()
        if body.purpose == "topup":
            if body.amount_paise is None:
                raise OrderRefusedError("22023")
            base = int(body.amount_paise)
        elif body.purpose == "payg_fee":
            base = int(self._plan(token, "payg")["monthly_paise"])
        else:
            if body.plan_id is None or body.interval is None:
                raise OrderRefusedError("22023")
            base = int(self._repo.change_quote(token, tenant_id, body.plan_id, body.interval)["amount_due_paise"])
        gst = _gst(base, self._repo.catalogue(token))
        made = provider.create_order(OrderRequest(tenant_id=str(tenant_id), purpose=body.purpose, amount_paise=base + gst, receipt=_uuid.uuid4().hex[:30]))
        stored = self._repo.order_create(token, tenant_id, made.order_id, body.purpose, body.amount_paise, body.plan_id, body.interval)
        if int(stored["total_paise"]) != base + gst:   # the database's own sum differs from what the provider was asked: never let the customer pay a different amount
            raise OrderRefusedError("22023")
        return OrderOut(provider=made.provider, order_id=made.order_id, key_id=made.key_id, purpose=body.purpose, amount_text=inr(base), gst_text=inr(gst), total_paise=base + gst, total_text=inr(base + gst))  # type: ignore[arg-type]

    def confirm_order(self, token: str, tenant_id: uuid.UUID, order_id: str, payment_id: str, signature: str) -> BalanceOut:
        """The browser returned the payment id and its signature: checked here, then the stored order is settled once (the balance credited / the plan changed / the fee recorded)."""
        if not self._need_provider().verify_order_payment(order_id, payment_id, signature):
            raise PaymentNotVerifiedError(order_id)
        self._repo.order_settle(token, tenant_id, order_id, payment_id)
        return self.balance(token, tenant_id)

    def invoices(self, token: str, tenant_id: uuid.UUID) -> InvoicesOut:
        return InvoicesOut(items=[InvoiceOut(number=i["number"], kind=i["kind"], subtotal_text=inr(int(i["subtotal_paise"])), gst_text=inr(int(i["gst_paise"])), total_text=inr(int(i["total_paise"])),
                                             total_paise=int(i["total_paise"]), issued_at=i["issued_at"]) for i in self._repo.invoices(token, tenant_id)])

    def apply_events(self, worker_token: str, events: list[ProviderEvent]) -> int:
        """The provider's signed events, applied once each: a renewal, a halt, a cancel, a paid order (the browser may have settled it already: then nothing happens)."""
        done = 0
        for e in events:
            tenant = uuid.UUID(e.tenant_id)
            if e.kind == "order_paid":
                if e.order_id and e.payment_id:
                    self._repo.order_settle(worker_token, tenant, e.order_id, e.payment_id)
            else:
                self._repo.provider_event(worker_token, tenant, e.event_id, e.kind, e.amount_paise)
            done += 1
        return done


def _gst(base: int, catalogue: dict[str, Any]) -> int:
    """GST added on top, rounded half up to the paisa: the same sum as the database's pricing.gst_of."""
    return int((base * round(float(catalogue["gst_percent"]) * 100) + 5000) // 10000)

