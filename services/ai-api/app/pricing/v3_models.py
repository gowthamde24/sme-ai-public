# ruff: noqa: E501
"""The answers of pricing v3 (the owner's plans and pricing of 19 Nov 2026), in rupees. Strict; no field says "credits"; plans are Pay as you go / Pro / Business and nothing else."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PlanId = Literal["payg", "pro", "business"]
Feature = Literal["calls", "lead_finder", "numbers", "whatsapp"]
Interval = Literal["monthly", "yearly"]


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanV3Out(_Out):
    id: PlanId
    name: str                       # "Pay as you go" | "Pro" | "Business"
    popular: bool                   # Pro: "most popular"
    monthly_paise: int
    yearly_paise: int
    monthly_text: str               # "₹1,999 a month"
    yearly_text: str                # "₹19,990 a year"
    yearly_saving_text: str         # "2 months free"
    included_minutes: int
    minute_paise: int               # the rate of a minute (also for the extra minutes): 500
    minute_text: str                # "₹5 a minute"
    numbers_included: int
    free_searches_month: int
    search_paise: int               # the price of a Lead Finder search after the free ones
    onboarding: Literal["self_and_assistant", "priority"]
    lines: list[str]                # plain English lines for a card (drafts: the web may reword them)


class CatalogueV3Out(_Out):
    gst_percent: float
    gst_text: str                   # "+18% GST on invoices"
    free_start_paise: int
    free_start_text: str            # "₹50 free to start, no card"
    launch_lock_months: int
    launch_lock_text: str           # "Launch prices are locked for 12 months"
    extra_number_paise: int
    extra_number_text: str          # "₹299 a month for each extra number"
    number_hold_days: int
    warn_pct: int
    data_days: int
    payg_to_pro_minutes: int        # 300: Pay as you go costs the same as Pro at this many minutes a month
    plans: list[PlanV3Out]


class SubscriptionV3Out(_Out):
    interval: Interval
    status: Literal["active", "past_due", "cancelled"]
    period_end: datetime
    cancel_at_period_end: bool
    price_locked_until: datetime | None


class CallsLineOut(_Out):
    billed_minutes: float           # billed per 30 seconds: 12.5 means 12 minutes 30 seconds
    included_minutes: int
    included_minutes_used: float
    included_minutes_left: float
    rate_text: str                  # "₹5 a minute"
    charged_paise: int
    charged_text: str
    unpaid_paise: int
    limit_paise: int | None
    summary_text: str               # "125 of 500 included minutes used"


class LeadFinderLineOut(_Out):
    searches: int
    free_searches: int
    free_left: int
    search_paise: int
    charged_paise: int
    charged_text: str
    limit_paise: int | None
    summary_text: str               # "2 free searches left this month, then ₹49 each"


class HeldNumberOut(_Out):
    number: str
    hold_until: datetime


class NumbersLineOut(_Out):
    active: int
    included: int
    extra: int
    extra_number_paise: int
    charged_paise: int
    charged_text: str
    held: list[HeldNumberOut]
    limit_paise: int | None
    summary_text: str               # "3 numbers: 1 included, 2 extra at ₹299 a month each"


class WhatsAppLineOut(_Out):
    messages: int
    charged_paise: int
    charged_text: str
    limit_paise: int | None
    summary_text: str               # "At Meta's own cost, no mark-up"


class AiActionsLineOut(_Out):
    charged_paise: int              # always 0
    summary_text: str               # "No charge for AI actions"


class LinesOut(_Out):
    calls: CallsLineOut
    lead_finder: LeadFinderLineOut
    numbers: NumbersLineOut
    whatsapp: WhatsAppLineOut
    ai_actions: AiActionsLineOut


class WarningOut(_Out):
    scope: Literal["wallet", "calls", "lead_finder", "numbers", "whatsapp"]
    level: Literal[80, 100]
    used_paise: int
    of_paise: int
    text: str                       # "You have used 80% of your wallet."


class AutoTopupOut(_Out):
    enabled: bool
    amount_paise: int
    below_paise: int
    monthly_limit_paise: int
    used_this_month_paise: int
    summary_text: str               # "₹1,000 added when the wallet falls under ₹200, up to ₹3,000 a month"


class AccessOut(_Out):
    access: Literal["full", "read_only"]
    read_only_since: datetime | None
    delete_on: datetime | None
    data_days_left: int | None
    text: str | None                # what a banner says


class HintOut(_Out):
    has_hint: bool
    current_plan: PlanId
    suggested_plan: PlanId | None
    current_cost_paise: int
    suggested_cost_paise: int | None
    saving_paise: int
    days: int                       # the look-back (30)
    billed_minutes: float
    searches: int
    text: str | None                # "In the last 30 days you used 500 call minutes. Pro would have cost ₹1,999 instead of ₹2,999: you would save ₹1,000 a month."


class WalletOut(_Out):
    """ONE rupee wallet; a usage line per feature; the plan; the optional limits; the warnings; the queue; the upgrade hint; the access state."""

    balance_paise: int
    balance_text: str               # "₹1,550"
    plan_id: PlanId
    plan_name: str
    early_access: bool              # free early access: nothing is charged
    monthly_paise: int
    monthly_text: str
    window_start: datetime
    window_end: datetime
    free_start_granted: bool
    free_start_left_paise: int
    free_start_left_text: str | None
    subscription: SubscriptionV3Out | None
    lines: LinesOut
    warnings: list[WarningOut]
    queued_calls: int               # calls waiting for money or for the limit instead of being lost leads
    auto_topup: AutoTopupOut | None
    access: AccessOut
    hint: HintOut


class LedgerItemOut(_Out):
    feature: Feature
    at: datetime
    billed_minutes: float
    included_minutes: float
    charged_paise: int
    charged_text: str
    unpaid_paise: int


class LedgerOut(_Out):
    items: list[LedgerItemOut]


class LimitIn(_Out):
    limit_paise: Annotated[int, Field(ge=10000, le=100000000)] | None   # ₹100 to ₹10,00,000, or null: no limit


class LimitOut(_Out):
    feature: Feature
    limit_paise: int | None
    limit_text: str | None


class AutoTopupIn(_Out):
    enabled: bool
    amount_paise: Annotated[int, Field(ge=10000, le=10000000)]            # added each time (₹100 to ₹1,00,000), before GST
    below_paise: Annotated[int, Field(ge=0, le=10000000)]                 # when the wallet falls under this
    monthly_limit_paise: Annotated[int, Field(ge=10000, le=100000000)]    # never more than this in a month


class ChangeV3In(_Out):
    plan_id: PlanId
    interval: Interval


class SubscribeV3In(ChangeV3In):
    checkout_ref: Annotated[str, Field(min_length=3, max_length=200, pattern=r"^[A-Za-z0-9_.-]+$")]


class OrderV3In(_Out):
    purpose: Literal["topup", "payg_fee", "plan_change"]
    amount_paise: Annotated[int, Field(ge=10000, le=10000000)] | None = None
    plan_id: PlanId | None = None
    interval: Interval | None = None


class ChangeQuoteV3Out(_Out):
    from_plan: PlanId
    to_plan: PlanId
    days_left: int
    days_in_period: int
    amount_text: str
    gst_text: str
    total_text: str
    total_paise: int
    credit_text: str | None
    needs_payment: bool


class CheckoutV3Out(_Out):
    provider: Literal["razorpay", "fake"]
    key_id: str | None
    subscription_id: str | None
    plan_id: PlanId
    interval: Interval
    amount_text: str
    gst_text: str
    total_text: str


class EstimateV3In(_Out):
    calls: Annotated[int, Field(ge=1, le=100000)]
    avg_minutes: Annotated[float, Field(gt=0, le=120)]


class EstimateV3Out(_Out):
    calls: int
    avg_minutes: float
    total_minutes: float            # billed per 30 seconds: each call rounded UP to the next half minute
    included_minutes_used: float
    paid_minutes: float
    rate_text: str
    cost_paise: int
    cost_text: str
    time_text: str                  # "about 2 h 30 min of calling"
    balance_paise: int
    enough: bool
    shortfall_text: str | None
