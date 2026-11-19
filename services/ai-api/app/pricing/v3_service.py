# ruff: noqa: E501
"""Pricing v3 (the owner's plans and pricing of 19 Nov 2026): the words and numbers of the wallet, built on the database rules (migrations 20261231986000 to 20261231986200). Payments (subscribe, change,
cancel, orders, invoices) are billing v2's own code with the INTERNAL plan ids mapped in and out here: the owner only ever sees Pay as you go / Pro / Business."""

from __future__ import annotations

import logging
import math
import time
import uuid
from typing import Any, Protocol

from app.billing.errors import WorkspaceReadOnlyError
from app.pricing.inr import group, inr
from app.pricing.models import FreeStartOut, InvoicesOut, OrderConfirmIn, OrderIn, OrderOut
from app.pricing.service import PricingService
from app.pricing.v3_models import (
    AccessOut,
    AiActionsLineOut,
    AutoTopupIn,
    AutoTopupOut,
    CallsLineOut,
    CatalogueV3Out,
    ChangeQuoteV3Out,
    CheckoutV3Out,
    EstimateV3In,
    EstimateV3Out,
    HeldNumberOut,
    HintOut,
    LeadFinderLineOut,
    LedgerItemOut,
    LedgerOut,
    LimitOut,
    LinesOut,
    NumbersLineOut,
    OrderV3In,
    PlanV3Out,
    SubscriptionV3Out,
    WalletOut,
    WarningOut,
    WhatsAppLineOut,
)
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.pricing.v3")
ACCESS_TTL_SECONDS = 30.0

# the INTERNAL plan ids (billing v2's rows, kept as they are) and the owner-facing ones: the mapping lives here and in pricing.plan_terms, nowhere a business can see
INTERNAL = {"payg": "payg", "pro": "sales_assistant", "business": "sales_lead_finder"}
PUBLIC = {v: k for k, v in INTERNAL.items()}
FEATURE_WORDS = {"calls": "calls", "lead_finder": "Lead Finder", "numbers": "numbers", "whatsapp": "WhatsApp"}


class SpendingLimitReachedError(RepositoryError):
    """SM993: the spending limit the Owner set for this feature is reached."""


class WalletEmptyError(RepositoryError):
    """SM994: the wallet cannot pay for it."""


class WorkspaceLapsedError(RepositoryError):
    """SM995: the workspace is read-only (its plan ended unpaid)."""


class SettingRefusedError(RepositoryError):
    """22023: a limit, an amount or a number the database does not accept."""


class PricingV3Repository(Protocol):
    def catalogue(self, token: str) -> dict[str, Any]: ...
    def wallet(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def ledger(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def limit_set(self, token: str, tenant_id: uuid.UUID, feature: str, limit_paise: int | None) -> dict[str, Any]: ...
    def auto_topup_set(self, token: str, tenant_id: uuid.UUID, enabled: bool, amount: int, below: int, monthly_limit: int) -> dict[str, Any]: ...
    # the system (worker, channel account): usage, the gate, the queue, the warnings, the automatic top-up, the month's number tick
    def charge_call(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, seconds: int, answered: bool) -> dict[str, Any]: ...
    def charge_search(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]: ...
    def charge_whatsapp(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, cost_paise: int) -> dict[str, Any]: ...
    def feature_gate(self, token: str, tenant_id: uuid.UUID, feature: str) -> dict[str, Any]: ...
    def call_gate(self, token: str, tenant_id: uuid.UUID, call_ref: uuid.UUID) -> dict[str, Any]: ...
    def queue_release(self, token: str, tenant_id: uuid.UUID, limit: int) -> dict[str, Any]: ...
    def warnings_take(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def auto_topup_due(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def auto_topup_record(self, token: str, tenant_id: uuid.UUID, payment_ref: str, amount_paise: int) -> dict[str, Any]: ...
    def numbers_renew(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    # the phone-line code, as the Owner: a number taken at the provider, given back, taken back
    def number_taken(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]: ...
    def number_released(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]: ...
    def number_reclaim(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]: ...


class PostgrestPricingV3Repository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(
            rest_url, anon_key,
            {"SM993": SpendingLimitReachedError, "SM994": WalletEmptyError, "SM995": WorkspaceLapsedError, "22023": SettingRefusedError},
            client=client,
        )

    def close(self) -> None:
        self._rpc.close()

    def catalogue(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_catalogue", {})

    def wallet(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_wallet", {"p_tenant_id": str(tenant_id)})

    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_access", {"p_tenant_id": str(tenant_id)})

    def ledger(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return list(self._rpc.array(token, "pricing_v3_ledger", {"p_tenant_id": str(tenant_id), "p_limit": limit}))

    def limit_set(self, token: str, tenant_id: uuid.UUID, feature: str, limit_paise: int | None) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_limit_set", {"p_tenant_id": str(tenant_id), "p_feature": feature, "p_limit_paise": limit_paise})

    def auto_topup_set(self, token: str, tenant_id: uuid.UUID, enabled: bool, amount: int, below: int, monthly_limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_auto_topup_set", {"p_tenant_id": str(tenant_id), "p_enabled": enabled, "p_amount_paise": amount, "p_below_paise": below, "p_monthly_limit_paise": monthly_limit})

    def charge_call(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, seconds: int, answered: bool) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_charge_call", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_seconds": seconds, "p_answered": answered})

    def charge_search(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_charge_search", {"p_tenant_id": str(tenant_id), "p_search_id": str(search_id)})

    def charge_whatsapp(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, cost_paise: int) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_charge_whatsapp", {"p_tenant_id": str(tenant_id), "p_message_id": str(message_id), "p_cost_paise": cost_paise})

    def feature_gate(self, token: str, tenant_id: uuid.UUID, feature: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_feature_gate", {"p_tenant_id": str(tenant_id), "p_feature": feature})

    def call_gate(self, token: str, tenant_id: uuid.UUID, call_ref: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_call_gate", {"p_tenant_id": str(tenant_id), "p_call_ref": str(call_ref)})

    def queue_release(self, token: str, tenant_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_queue_release", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    def warnings_take(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_warnings_take", {"p_tenant_id": str(tenant_id)})

    def auto_topup_due(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_auto_topup_due", {"p_tenant_id": str(tenant_id)})

    def auto_topup_record(self, token: str, tenant_id: uuid.UUID, payment_ref: str, amount_paise: int) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_auto_topup_record", {"p_tenant_id": str(tenant_id), "p_payment_ref": payment_ref, "p_amount_paise": amount_paise})

    def numbers_renew(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_numbers_renew", {"p_tenant_id": str(tenant_id)})

    def number_taken(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_number_taken", {"p_tenant_id": str(tenant_id), "p_number": number})

    def number_released(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_number_released", {"p_tenant_id": str(tenant_id), "p_number": number})

    def number_reclaim(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_v3_number_reclaim", {"p_tenant_id": str(tenant_id), "p_number": number})


# ---------------------------------------------------------------------------------------------------------------------------------
# words
# ---------------------------------------------------------------------------------------------------------------------------------
def _minutes(half: int | float) -> float:
    return float(half) / 2


def _mtext(minutes: float) -> str:
    return f"{minutes:g}"


def plan_lines(p: dict[str, Any], extra_number_paise: int) -> list[str]:
    inc, rate = int(p["included_minutes"]), int(p["minute_paise"])
    lines = [f"{inr(p['monthly_paise'])} a month" + (" for your business number and the app" if p["id"] == "payg" else "")]
    lines.append(f"{group(inc)} call minutes included, then {inr(rate)} a minute" if inc else f"{inr(rate)} a minute for calls")
    lines.append(f"Lead Finder: {p['free_searches_month']} free searches a month, then {inr(p['search_paise'])} each")
    lines.append(f"{p['numbers_included']} business number included, {inr(extra_number_paise)} a month for each extra one")
    lines.append("Priority onboarding" if p["onboarding"] == "priority" else "Set up on your own, with the assistant's help")
    lines.append("Billed per 30 seconds. Calls nobody answers are free.")
    return lines


def plan_out(p: dict[str, Any], extra_number_paise: int) -> PlanV3Out:
    return PlanV3Out(
        id=p["id"], name=p["name"], popular=bool(p["popular"]), monthly_paise=p["monthly_paise"], yearly_paise=p["yearly_paise"], monthly_text=f"{inr(p['monthly_paise'])} a month",
        yearly_text=f"{inr(p['yearly_paise'])} a year", yearly_saving_text="2 months free", included_minutes=p["included_minutes"], minute_paise=p["minute_paise"], minute_text=f"{inr(p['minute_paise'])} a minute",
        numbers_included=p["numbers_included"], free_searches_month=p["free_searches_month"], search_paise=p["search_paise"], onboarding=p["onboarding"], lines=plan_lines(p, extra_number_paise),
    )


def catalogue_out(doc: dict[str, Any]) -> CatalogueV3Out:
    gst = float(doc["gst_percent"])
    extra = int(doc["extra_number_paise"])
    months = int(doc["launch_lock_months"])
    return CatalogueV3Out(
        gst_percent=gst, gst_text=f"+{gst:g}% GST on invoices", free_start_paise=int(doc["free_start_paise"]), free_start_text=f"{inr(int(doc['free_start_paise']))} free to start, no card",
        launch_lock_months=months, launch_lock_text=f"Launch prices are locked for {months} months", extra_number_paise=extra, extra_number_text=f"{inr(extra)} a month for each extra number",
        number_hold_days=int(doc["number_hold_days"]), warn_pct=int(doc["warn_pct"]), data_days=int(doc["data_days"]), payg_to_pro_minutes=int(doc["payg_to_pro_minutes"]),
        plans=[plan_out(p, extra) for p in doc["plans"]],
    )


def _limit(v: Any) -> int | None:
    return None if v is None else int(v)


def lines_out(doc: dict[str, Any]) -> LinesOut:
    c, lf, n, w = doc["calls"], doc["lead_finder"], doc["numbers"], doc["whatsapp"]
    inc = int(c["included_minutes"])
    used, left = _minutes(c["included_half_used"]), _minutes(c["included_half_left"])
    calls = CallsLineOut(
        billed_minutes=_minutes(c["billed_half_minutes"]), included_minutes=inc, included_minutes_used=used, included_minutes_left=left, rate_text=f"{inr(c['rate_paise_per_minute'])} a minute",
        charged_paise=int(c["charged_paise"]), charged_text=inr(int(c["charged_paise"])), unpaid_paise=int(c["unpaid_paise"]), limit_paise=_limit(c["limit_paise"]),
        summary_text=(f"{_mtext(used)} of {group(inc)} included minutes used" if inc else f"{_mtext(_minutes(c['billed_half_minutes']))} minutes billed at {inr(c['rate_paise_per_minute'])} a minute"),
    )
    left_n = int(lf["free_left"])
    lead = LeadFinderLineOut(
        searches=int(lf["searches"]), free_searches=int(lf["free_searches"]), free_left=left_n, search_paise=int(lf["search_paise"]), charged_paise=int(lf["charged_paise"]),
        charged_text=inr(int(lf["charged_paise"])), limit_paise=_limit(lf["limit_paise"]),
        summary_text=(f"{left_n} free search{'' if left_n == 1 else 'es'} left this month, then {inr(lf['search_paise'])} each" if left_n else f"No free searches left this month: {inr(lf['search_paise'])} each"),
    )
    act, inc_n, extra = int(n["active"]), int(n["included"]), int(n["extra"])
    numbers = NumbersLineOut(
        active=act, included=inc_n, extra=extra, extra_number_paise=int(n["extra_number_paise"]), charged_paise=int(n["charged_paise"]), charged_text=inr(int(n["charged_paise"])),
        held=[HeldNumberOut.model_validate(h) for h in n["held"]], limit_paise=_limit(n["limit_paise"]),
        summary_text=f"{act} number{'' if act == 1 else 's'}: {inc_n} included" + (f", {extra} extra at {inr(n['extra_number_paise'])} a month each" if extra else ""),
    )
    whatsapp = WhatsAppLineOut(messages=int(w["messages"]), charged_paise=int(w["charged_paise"]), charged_text=inr(int(w["charged_paise"])), limit_paise=_limit(w["limit_paise"]), summary_text="At Meta's own cost, no mark-up")
    return LinesOut(calls=calls, lead_finder=lead, numbers=numbers, whatsapp=whatsapp, ai_actions=AiActionsLineOut(charged_paise=0, summary_text="No charge for AI actions"))


def warning_text(scope: str, level: int) -> str:
    if scope == "wallet":
        return "Your wallet is empty. New calls wait in a queue until you add money." if level == 100 else f"You have used {level}% of your wallet. Add money to keep calls running."
    word = FEATURE_WORDS[scope]
    return f"You have reached your {word} spending limit. It stops until next month or until you raise it." if level == 100 else f"You have used {level}% of your {word} spending limit."


def access_out(a: dict[str, Any]) -> AccessOut:
    text = None
    if a["access"] == "read_only":
        text = f"Your plan has ended. Your workspace is read-only and your data is kept for {a['data_days_left']} more days. Choose a plan to continue."
    return AccessOut(access=a["access"], read_only_since=a["read_only_since"], delete_on=a["delete_on"], data_days_left=a["data_days_left"], text=text)


def hint_out(h: dict[str, Any], names: dict[str, str]) -> HintOut:
    minutes = _minutes(h["billed_half_minutes"])
    text = None
    if h["has_hint"]:
        text = (f"In the last {h['days']} days you used {_mtext(minutes)} call minutes. {names[h['suggested_plan']]} would have cost {inr(h['suggested_cost_paise'])} instead of "
                f"{inr(h['current_cost_paise'])}: you would save {inr(h['saving_paise'])} a month.")
    return HintOut(
        has_hint=bool(h["has_hint"]), current_plan=h["current_plan"], suggested_plan=h["suggested_plan"], current_cost_paise=int(h["current_cost_paise"]),
        suggested_cost_paise=_limit(h["suggested_cost_paise"]), saving_paise=int(h["saving_paise"]), days=int(h["days"]), billed_minutes=minutes, searches=int(h["searches"]), text=text,
    )


def auto_topup_out(a: dict[str, Any]) -> AutoTopupOut:
    return AutoTopupOut(
        enabled=bool(a["enabled"]), amount_paise=int(a["amount_paise"]), below_paise=int(a["below_paise"]), monthly_limit_paise=int(a["monthly_limit_paise"]), used_this_month_paise=int(a["used_this_month_paise"]),
        summary_text=f"{inr(a['amount_paise'])} added when the wallet falls under {inr(a['below_paise'])}, up to {inr(a['monthly_limit_paise'])} a month" + ("" if a["enabled"] else " (switched off)"),
    )


NAMES = {"payg": "Pay as you go", "pro": "Pro", "business": "Business"}


def wallet_out(doc: dict[str, Any]) -> WalletOut:
    paise = int(doc["balance_paise"])
    free_left = int(doc.get("free_start_left_paise") or 0)
    sub = doc.get("subscription")
    topup = doc.get("auto_topup")
    return WalletOut(
        balance_paise=paise, balance_text=inr(paise), plan_id=doc["plan_id"], plan_name=doc["plan_name"], early_access=bool(doc["early_access"]), monthly_paise=int(doc["monthly_paise"]),
        monthly_text=f"{inr(doc['monthly_paise'])} a month", window_start=doc["window_start"], window_end=doc["window_end"], free_start_granted=bool(doc["free_start_granted"]), free_start_left_paise=free_left,
        free_start_left_text=inr(free_left) if free_left else None, subscription=SubscriptionV3Out.model_validate(sub) if isinstance(sub, dict) else None, lines=lines_out(doc["lines"]),
        warnings=[WarningOut(scope=w["scope"], level=w["level"], used_paise=int(w["used_paise"]), of_paise=int(w["of_paise"]), text=warning_text(w["scope"], int(w["level"]))) for w in doc["warnings"]],
        queued_calls=int(doc["queued_calls"]), auto_topup=auto_topup_out(topup) if isinstance(topup, dict) else None, access=access_out(doc["access"]), hint=hint_out(doc["hint"], NAMES),
    )


class PricingV3Service:
    def __init__(self, repository: PricingV3Repository, payments: PricingService | None = None) -> None:
        self._repo = repository
        self._pay = payments
        self._access_cache: dict[uuid.UUID, tuple[float, str]] = {}

    @property
    def payments(self) -> PricingService | None:
        """Billing v2's own payment code (orders, subscriptions, the provider's events); the webhook applies the provider's signed events through it."""
        return self._pay

    def _need_pay(self) -> PricingService:
        if self._pay is None:
            raise RepositoryError("no payment provider")
        return self._pay

    # ------------------------------------------------------------------------------------------------ reads
    def catalogue(self, token: str) -> CatalogueV3Out:
        return catalogue_out(self._repo.catalogue(token))

    def wallet(self, token: str, tenant_id: uuid.UUID) -> WalletOut:
        return wallet_out(self._repo.wallet(token, tenant_id))

    def ledger(self, token: str, tenant_id: uuid.UUID, limit: int = 50) -> LedgerOut:
        return LedgerOut(items=[
            LedgerItemOut(feature=i["feature"], at=i["at"], billed_minutes=_minutes(i["billed_half_minutes"]), included_minutes=_minutes(i["included_half"]), charged_paise=int(i["charged_paise"]),
                          charged_text=inr(int(i["charged_paise"])), unpaid_paise=int(i["unpaid_paise"]))
            for i in self._repo.ledger(token, tenant_id, limit)])

    def estimate(self, token: str, tenant_id: uuid.UUID, body: EstimateV3In) -> EstimateV3Out:
        """Time and rupees for a planned job: calls x average minutes, each call rounded UP to the next half minute (billed per 30 seconds), the plan's included minutes used first, the rest at the plan's minute rate."""
        doc = self._repo.wallet(token, tenant_id)
        c = doc["lines"]["calls"]
        rate = int(c["rate_paise_per_minute"])
        total_half = math.ceil(body.avg_minutes * 2 - 1e-9) * body.calls
        included_half = min(total_half, int(c["included_half_left"]))
        paid_half = total_half - included_half
        cost = 0 if doc["early_access"] else paid_half * (rate // 2)
        balance = int(doc["balance_paise"])
        hours, mins = divmod(int(round(total_half / 2)), 60)
        return EstimateV3Out(
            calls=body.calls, avg_minutes=body.avg_minutes, total_minutes=total_half / 2, included_minutes_used=included_half / 2, paid_minutes=paid_half / 2, rate_text=f"{inr(rate)} a minute",
            cost_paise=cost, cost_text=inr(cost), time_text="about " + (f"{hours} h " if hours else "") + f"{mins} min of calling", balance_paise=balance, enough=balance >= cost,
            shortfall_text=None if balance >= cost else f"{inr(cost - balance)} more needed",
        )

    # ------------------------------------------------------------------------------------------------ the Owner's own settings
    def limit_set(self, token: str, tenant_id: uuid.UUID, feature: str, limit_paise: int | None) -> LimitOut:
        got = self._repo.limit_set(token, tenant_id, feature, limit_paise)
        lim = _limit(got["limit_paise"])
        return LimitOut(feature=feature, limit_paise=lim, limit_text=None if lim is None else inr(lim))  # type: ignore[arg-type]

    def auto_topup_set(self, token: str, tenant_id: uuid.UUID, body: AutoTopupIn) -> AutoTopupOut:
        self._repo.auto_topup_set(token, tenant_id, body.enabled, body.amount_paise, body.below_paise, body.monthly_limit_paise)
        topup = self._repo.wallet(token, tenant_id).get("auto_topup")
        return auto_topup_out(topup)  # type: ignore[arg-type]

    # ------------------------------------------------------------------------------------------------ paying: billing v2's code, the owner's plan names
    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None = None) -> FreeStartOut:
        return self._need_pay().free_start(token, tenant_id, phone_hash)

    def checkout(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> CheckoutV3Out:
        got = self._need_pay().subscription_checkout(token, tenant_id, INTERNAL[plan_id], interval)
        return CheckoutV3Out(provider=got.provider, key_id=got.key_id, subscription_id=got.subscription_id, plan_id=plan_id, interval=got.interval, amount_text=got.amount_text, gst_text=got.gst_text, total_text=got.total_text)  # type: ignore[arg-type]

    def subscribe(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, checkout_ref: str) -> WalletOut:
        self._need_pay().subscribe(token, tenant_id, INTERNAL[plan_id], interval, checkout_ref)
        return self.wallet(token, tenant_id)

    def change_quote(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> ChangeQuoteV3Out:
        q = self._need_pay().change_quote(token, tenant_id, INTERNAL[plan_id], interval)
        return ChangeQuoteV3Out(from_plan=PUBLIC[q.from_plan], to_plan=PUBLIC[q.to_plan], days_left=q.days_left, days_in_period=q.days_in_period, amount_text=q.amount_text, gst_text=q.gst_text,  # type: ignore[arg-type]
                                total_text=q.total_text, total_paise=q.total_paise, credit_text=q.credit_text, needs_payment=q.needs_payment)

    def change(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> WalletOut:
        self._need_pay().downgrade(token, tenant_id, INTERNAL[plan_id], interval)
        return self.wallet(token, tenant_id)

    def cancel(self, token: str, tenant_id: uuid.UUID) -> WalletOut:
        self._need_pay().cancel(token, tenant_id)
        return self.wallet(token, tenant_id)

    def create_order(self, token: str, tenant_id: uuid.UUID, body: OrderV3In) -> OrderOut:
        return self._need_pay().create_order(token, tenant_id, OrderIn(purpose=body.purpose, amount_paise=body.amount_paise, plan_id=INTERNAL[body.plan_id] if body.plan_id else None, interval=body.interval))

    def confirm_order(self, token: str, tenant_id: uuid.UUID, order_id: str, body: OrderConfirmIn) -> WalletOut:
        self._need_pay().confirm_order(token, tenant_id, order_id, body.payment_id, body.signature)
        return self.wallet(token, tenant_id)

    def invoices(self, token: str, tenant_id: uuid.UUID) -> InvoicesOut:
        return self._need_pay().invoices(token, tenant_id)

    # ------------------------------------------------------------------------------------------------ the system's side: usage, the gate, the queue (the worker and the channel account; no route)
    def charge_call(self, system_token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, seconds: int, answered: bool) -> dict[str, Any]:
        return self._repo.charge_call(system_token, tenant_id, call_id, seconds, answered)

    def charge_search(self, system_token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        """Asked BEFORE a Lead Finder search runs. Raises SpendingLimitReachedError, WalletEmptyError or WorkspaceLapsedError when it must not run."""
        return self._repo.charge_search(system_token, tenant_id, search_id)

    def charge_whatsapp(self, system_token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, cost_paise: int) -> dict[str, Any]:
        """At Meta's own cost, no mark-up: the caller reports what Meta charged (0 for a reply inside the 24-hour window)."""
        return self._repo.charge_whatsapp(system_token, tenant_id, message_id, cost_paise)

    def feature_gate(self, system_token: str, tenant_id: uuid.UUID, feature: str) -> dict[str, Any]:
        return self._repo.feature_gate(system_token, tenant_id, feature)

    def call_gate(self, system_token: str, tenant_id: uuid.UUID, call_ref: uuid.UUID) -> dict[str, Any]:
        """May this call start? `{allowed, queued, reason}`: a call that cannot start is QUEUED (not a lost lead) and comes back through queue_release."""
        return self._repo.call_gate(system_token, tenant_id, call_ref)

    def queue_release(self, system_token: str, tenant_id: uuid.UUID, limit: int = 50) -> dict[str, Any]:
        return self._repo.queue_release(system_token, tenant_id, limit)

    def warnings_take(self, system_token: str, tenant_id: uuid.UUID) -> list[WarningOut]:
        """The 80% / 100% warnings that were NOT yet given; each is returned once, so the caller sends it once."""
        got = self._repo.warnings_take(system_token, tenant_id)
        return [WarningOut(scope=w["scope"], level=w["level"], used_paise=int(w["used_paise"]), of_paise=int(w["of_paise"]), text=warning_text(w["scope"], int(w["level"]))) for w in got["new"]]

    def auto_topup_due(self, system_token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.auto_topup_due(system_token, tenant_id)

    def auto_topup_record(self, system_token: str, tenant_id: uuid.UUID, payment_ref: str, amount_paise: int) -> dict[str, Any]:
        return self._repo.auto_topup_record(system_token, tenant_id, payment_ref, amount_paise)

    def numbers_renew(self, system_token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.numbers_renew(system_token, tenant_id)

    # ------------------------------------------------------------------------------------------------ numbers (the phone-line code calls these as the Owner, after the provider acted)
    def number_taken(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._repo.number_taken(token, tenant_id, number)

    def number_released(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._repo.number_released(token, tenant_id, number)

    def number_reclaim(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._repo.number_reclaim(token, tenant_id, number)

    # ------------------------------------------------------------------------------------------------ the read-only gate (app/auth/deps.py asks this for a change or a spend)
    def ensure(self, token: str, tenant_id: uuid.UUID, kind: str) -> None:
        """A workspace whose paid plan ended unpaid is read-only (viewing, signing in and exporting stay; every change, send, AI and call stops). The answer is kept for 30 seconds per workspace; a failure
        to ask lets the request through (a billing hiccup must never lock a business out)."""
        now = time.monotonic()
        cached = self._access_cache.get(tenant_id)
        if cached is None or cached[0] < now:
            try:
                state = str(self._repo.access(token, tenant_id).get("access"))
            except RepositoryError as exc:
                logger.warning("pricing v3: the access state could not be read (%s); the request goes through", exc.__class__.__name__)
                return
            cached = (now + ACCESS_TTL_SECONDS, state)
            self._access_cache[tenant_id] = cached
        if cached[1] == "read_only":
            raise WorkspaceReadOnlyError(str(tenant_id))

    def forget(self, tenant_id: uuid.UUID) -> None:
        self._access_cache.pop(tenant_id, None)
