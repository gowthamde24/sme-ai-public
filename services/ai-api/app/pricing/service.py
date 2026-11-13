# ruff: noqa: E501
"""Billing v2 reads and the free start (the owner's final pricing of 13 Nov 2026). The database holds the rules (migration 20261231560000); here they are turned into the words and numbers a screen shows, all in rupees."""

from __future__ import annotations

import math
import uuid
from typing import Any, Protocol

from app.pricing.inr import inr, minutes_text
from app.pricing.models import (
    BalanceOut,
    CatalogueOut,
    EstimateIn,
    EstimateOut,
    FreeStartOut,
    PlanOut,
    SubscriptionOut,
)
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

LOW_MINUTES = 20   # a balance under about 20 minutes of calling is "low"


class FairUseError(RepositoryError):
    """SM992: a plan with Lead Finder is unlimited up to a fair-use number of searches a month."""


class PricingRepository(Protocol):
    def catalogue(self, token: str) -> dict[str, Any]: ...
    def balance(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None) -> dict[str, Any]: ...


class PostgrestPricingRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM992": FairUseError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def catalogue(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_catalogue", {})

    def balance(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_balance", {"p_tenant_id": str(tenant_id)})

    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_free_start_grant", {"p_tenant_id": str(tenant_id), "p_phone_hash": phone_hash})


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
    def __init__(self, repository: PricingRepository) -> None:
        self._repo = repository

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
