# ruff: noqa: E501
"""The answers of billing v2, in rupees. Strict; no field says "credits"."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanOut(_Out):
    id: str
    name: str
    monthly_paise: int
    yearly_paise: int
    monthly_text: str            # "₹1,999 a month"
    yearly_text: str             # "₹19,990 a year"
    yearly_saving_text: str      # "2 months free"
    included_minutes: int
    rate_paise_per_minute: int
    rate_text: str               # "₹4.50 a minute"
    numbers_included: int
    lead_finder: bool
    free_searches_month: int
    extra_search_paise: int
    lines: list[str]             # plain English lines for a plan card (drafts: the web may reword them)


class CatalogueOut(_Out):
    gst_percent: float
    gst_text: str                # "+18% GST on invoices"
    free_start_paise: int
    free_start_text: str         # "₹50 free to start, no card"
    plans: list[PlanOut]


class SubscriptionOut(_Out):
    interval: Literal["monthly", "yearly"]
    status: Literal["active", "past_due", "cancelled"]
    period_end: datetime
    cancel_at_period_end: bool
    price_locked_until: datetime | None


class BalanceOut(_Out):
    balance_paise: int
    balance_text: str            # "₹1,550"
    minutes_estimate: int
    summary_text: str            # "₹1,550 · about 310 call minutes"
    plan_id: str
    plan_name: str
    low: bool
    topup_available: bool
    free_start_granted: bool
    free_start_left_paise: int
    free_start_left_text: str | None
    included_minutes: int
    included_minutes_left: int
    subscription: SubscriptionOut | None


class FreeStartOut(_Out):
    granted: bool
    reason: Literal["already_granted", "phone_used"] | None
    balance_paise: int
    balance_text: str


class EstimateIn(_Out):
    calls: Annotated[int, Field(ge=1, le=100000)]
    avg_minutes: Annotated[float, Field(gt=0, le=120)]


class EstimateOut(_Out):
    calls: int
    avg_minutes: float
    total_minutes: float          # billed per 30 seconds: each call is rounded UP to the next half minute
    included_minutes_used: float
    paid_minutes: float
    rate_text: str
    cost_paise: int
    cost_text: str
    time_text: str                # "about 2 h 30 min of calling"
    balance_paise: int
    enough: bool
    shortfall_text: str | None
