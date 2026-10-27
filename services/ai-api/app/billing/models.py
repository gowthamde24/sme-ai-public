"""The plans and billing API shapes (job DI, ADR 0092). Committed EARLY as a contract (packages/contracts/billing.*): the Plan screens are built against it.

What an owner sees is ONLY: the plan, its price (null until the owner of the product sets it), how many call minutes and WhatsApp messages are used, the allowance, the percentage, and one notice at 80 percent and
one at 100. AI itself is "included, fair use": its rupees, tokens and allowances are never part of any shape here (a test reads the generated schema to prove it)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

PlanKind = Literal["trial", "main", "calls"]
MeterKind = Literal["call_minutes", "whatsapp_messages"]
# ok: under 80 percent. notice: from 80 percent. stopped: 100 percent used (or nothing included): that kind stops for this workspace until a top-up or the next period.
MeterState = Literal["ok", "notice", "stopped"]
# trial_pending: the plan is chosen and a payment method is on file, but WhatsApp is not connected yet, so the 14 days have not begun (nothing is charged; sending, AI calls and campaigns stay off until it is)
SubscriptionStatus = Literal["trial_pending", "trialing", "active", "past_due", "cancelled"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanNameOut(_Strict):
    en: str
    te: str | None = None
    hi: str | None = None
    kn: str | None = None


class PlanAllowancesOut(_Strict):
    # minutes of AI calls in a billing period; null = pay as you go: no included minutes and no ceiling (billed by use)
    call_minutes: int | None
    # business-initiated WhatsApp messages in a billing period; null = pay as you go: nothing included, no ceiling, billed per message
    whatsapp_messages: int | None


class PlanLimitsOut(_Strict):
    users: int
    workspaces: int


class PlanOut(_Strict):
    id: str
    kind: PlanKind
    sort: int
    name: PlanNameOut
    # paise a month; null until the owner of the product sets the price (the screens show "price to be announced")
    price_paise_monthly: int | None
    # pay-as-you-go plans only: paise a minute; null until set
    price_paise_per_minute: int | None = None
    # pay-as-you-go plans only: paise a business-initiated WhatsApp message; null until set
    price_paise_per_message: int | None = None
    price_set: bool
    allowances: PlanAllowancesOut
    limits: PlanLimitsOut
    # AI is included under fair use on every plan
    ai: Literal["included_fair_use"]


class TrialRulesOut(_Strict):
    days: int
    # when the trial days start counting: `whatsapp_connected` = the day the workspace's WhatsApp is connected (owner decision 25 Oct 2026); `sign_up` = the day of sign-up (catalogue version 1)
    starts_on: Literal["sign_up", "whatsapp_connected"]
    # a workspace that has not connected WhatsApp yet may set up this many days from the day it was made before it lapses (the trial clock only waits; nothing else does)
    setup_days_without_whatsapp: int
    # the trial starts with a payment method on file (nothing is charged during the trial)
    payment_method_at_start: bool
    grace_days_after_failed_payment: int


class PlansOut(_Strict):
    catalogue_version: int
    status: Literal["draft", "published"]
    currency: Literal["INR"]
    trial: TrialRulesOut
    plans: list[PlanOut]


class OverageOut(_Strict):
    enabled: bool
    # units beyond the plan and every pack this period (minutes with one decimal, or messages)
    units: float
    spent_paise: int
    cap_paise: int
    rate_paise_per_unit: int


class MeterOut(_Strict):
    kind: MeterKind
    unit: Literal["minutes", "messages"]
    # minutes with one decimal, or a count of messages
    used: float
    # allowance of the period including top-ups; null = pay as you go (no ceiling)
    allowance: int | None
    remaining: float | None
    # whole percent of the allowance used, 0 to 100; null when there is no ceiling
    percent: int | None
    state: MeterState
    # false when the plan includes none of this kind (allowance 0): the screen offers an upgrade instead of a bar
    included: bool
    # extra units added by the operator's top-up in this period (already inside `allowance`)
    topup: int
    # night 4 (job DS part E2, docs/contracts/topups.md): all additive, with defaults so an older answer still reads
    # the plan's own part of `allowance` (minutes or messages); null = pay as you go
    plan_allowance: int | None = None
    # unexpired top-up pack units still unused
    topup_balance: float = 0.0
    # the India date the oldest unused pack expires
    next_topup_expiry: date | None = None
    # the India date the allowance runs out at this period's pace; null when nothing is used, when it will last, or when there is no ceiling
    projected_run_out_on: date | None = None
    runs_out_before_period_end: bool = False
    # a new unit of this kind really cannot start now (billing on, used up, no overage covering it)
    blocked: bool = False
    overage: OverageOut | None = None
    # call_minutes: leads whose call waits for minutes; whatsapp_messages: messages held in the outbox
    queued: int = 0


class UsageOut(_Strict):
    call_minutes: MeterOut
    whatsapp_messages: MeterOut


class PeriodOut(_Strict):
    # India days; `end` is the last day of the period
    start: date
    end: date
    timezone: Literal["Asia/Kolkata"]
    days_left: int


class NoticeOut(_Strict):
    kind: MeterKind
    level: Literal[80, 100]
    period_start: date
    at: datetime


class SubscriptionOut(_Strict):
    status: SubscriptionStatus
    plan_id: str
    provider: str
    trial_ends_at: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool
    # a failed payment keeps the plan until this time
    grace_until: datetime | None = None
    # true when a payment method is on file; the method itself is never stored here
    payment_method_on_file: bool
    # "whatsapp" while the status is trial_pending: `trial_ends_at` is null and the 14 days begin on the day WhatsApp is connected; null otherwise
    trial_waiting_for: Literal["whatsapp"] | None


class UsageViewOut(_Strict):
    period: PeriodOut
    usage: UsageOut
    notices: list[NoticeOut]
    # leads whose call waits for minutes (status waiting_for_minutes)
    queued_calls: int = 0


class AccessOut(_Strict):
    """Whether the workspace can be changed. `access` is `read_only` after the trial (or the paid period) ended unpaid: signing in, viewing and exporting stay; sending, AI, calls and every change stop,
    so the web shows view and export only and switches the edit buttons off. Always `full` while the platform's billing switch is off. The data is kept until `delete_on` (90 days after
    `read_only_since`)."""

    access: Literal["full", "read_only"]
    read_only_since: date | None
    delete_on: date | None
    data_days_left: int | None
    # true when the plan has lapsed (the trial or the paid period ended unpaid, or it was cancelled): the Owner can pay again with POST /billing/resume, no new trial
    can_resume: bool
    # `off` while the workspace is read-only OR still waiting for WhatsApp: sending, AI, calls and campaigns are held (the API answers 403 workspace_read_only / waiting_for_whatsapp)
    sending: Literal["on", "off"]
    # `whatsapp` while the workspace chose a plan but has not connected WhatsApp (status trial_pending)
    waiting_for: Literal["whatsapp"] | None
    # job DQ (DPDP): when the e-mail went to the Owners that the workspace will be erased in 48 hours (null until it did; only read-only workspaces have one)
    erasure_warning_sent_at: datetime | None = None
    # job DQ: a demo workspace (synthetic data, sending switched off) and a workspace exempt from billing (Customer Zero, the demos); set by the operator only
    demo: bool = False
    exempt: bool = False


class BillingOut(_Strict):
    # the plan whose allowances apply now (the trial plan while a subscription is trialing)
    plan: PlanOut
    subscription: SubscriptionOut | None
    period: PeriodOut
    usage: UsageOut
    notices: list[NoticeOut]
    # false once a subscription exists (a trial is started once)
    can_start_trial: bool
    # true when the plan has lapsed: show "Choose a plan to continue" and send POST /billing/resume (no new trial)
    can_resume: bool
    # the day the workspace's WhatsApp was first connected (the trial's 14 days count from it); null while it is not connected
    whatsapp_connected_at: datetime | None
    # the plain word the web switches on: `read_only` = view and export only (see AccessOut)
    access: Literal["full", "read_only"]
    read_only_since: date | None
    delete_on: date | None
    data_days_left: int | None


class TrialStartIn(_Strict):
    # a plan of kind main or calls (not the trial plan itself)
    plan_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
    # the reference the provider's checkout returned for the payment method (the fake provider: pm_fake_ok, pm_fake_declines_on_renewal, pm_fake_declined)
    checkout_ref: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class ResumeIn(_Strict):
    # a plan of kind main or calls
    plan_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
    # the reference the provider's checkout returned for the payment method (the fake provider: pm_fake_ok, pm_fake_declined)
    checkout_ref: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


# --------------------------------------------------------------------------------------------------- night 4, job DS part E2: top-ups, auto top-up, overage, upgrade, invoices
PackCode = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{3,30}$")]


class TopupPackOut(_Strict):
    code: str
    kind: MeterKind
    units: int
    # GST-exclusive price in paise; a placeholder until the owner of the product sets it
    price_paise: int
    gst_rate_bp: int
    gst_paise: int
    total_paise: int
    price_is_placeholder: bool


class LotOut(_Strict):
    purchase_id: uuid.UUID
    units_left: float
    purchased_at: datetime
    expires_at: datetime


class BalanceKindOut(_Strict):
    units: float
    lots: list[LotOut]


class BalanceOut(_Strict):
    call_minutes: BalanceKindOut
    whatsapp_messages: BalanceKindOut


class TopupSettingsOut(_Strict):
    auto_minutes_pack: str | None
    auto_messages_pack: str | None
    auto_monthly_cap_paise: int
    overage_minutes: bool
    overage_messages: bool
    overage_monthly_cap_paise: int
    overage_rate_paise_per_minute: int
    overage_rate_paise_per_message: int
    auto_spent_paise: int
    overage_spent_paise: int


class TopupPurchaseOut(_Strict):
    id: uuid.UUID
    pack_code: str
    kind: MeterKind
    units: int
    source: Literal["manual", "auto"]
    price_paise: int
    total_paise: int
    purchased_at: datetime
    expires_at: datetime
    units_left: float
    expired: bool
    invoice_id: uuid.UUID


class TopupsOut(_Strict):
    packs: list[TopupPackOut]
    balance: BalanceOut
    settings: TopupSettingsOut
    history: list[TopupPurchaseOut]


class SellerOut(_Strict):
    name: str
    state_code: str
    gstin: str | None


class BuyerOut(_Strict):
    gstin: str | None
    state_code: str | None


class InvoiceOut(_Strict):
    id: uuid.UUID
    number: str
    kind: Literal["topup", "upgrade", "overage"]
    description: str
    issued_at: datetime
    period_start: date | None
    taxable_paise: int
    gst_rate_bp: int
    cgst_paise: int
    sgst_paise: int
    igst_paise: int
    total_paise: int
    seller: SellerOut
    buyer: BuyerOut
    fake: bool
    payment_status: Literal["paid_fake"]


class InvoicesOut(_Strict):
    items: list[InvoiceOut]
    next_cursor: str | None


class TopupBuyIn(_Strict):
    # chosen by the client: the same id with the same pack changes nothing
    purchase_id: uuid.UUID
    pack_code: PackCode
    # the reference the (fake) checkout returned: pm_fake_ok or pm_fake_declined
    checkout_ref: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class TopupBuyOut(_Strict):
    purchase: TopupPurchaseOut
    invoice: InvoiceOut
    usage: UsageOut


class TopupSettingsIn(_Strict):
    auto_minutes_pack: PackCode | None
    auto_messages_pack: PackCode | None
    auto_monthly_cap_paise: Annotated[int, Field(ge=0, le=1_000_000_000, strict=True)]
    overage_minutes: Annotated[bool, Field(strict=True)]
    overage_messages: Annotated[bool, Field(strict=True)]
    overage_monthly_cap_paise: Annotated[int, Field(ge=0, le=1_000_000_000, strict=True)]


class NewAllowancesOut(_Strict):
    call_minutes: int | None
    whatsapp_messages: int | None


class UpgradePreviewOut(_Strict):
    from_plan_id: str
    to_plan_id: str
    price_set: bool
    days_in_period: int
    days_left: int
    # (new monthly price - old monthly price) x days left / days in the period, whole paise, half up; 0 during the trial; null while a price is not set
    prorated_paise: int | None
    gst_paise: int | None
    total_paise: int | None
    new_allowances: NewAllowancesOut
    effective: Literal["now"]
    note: str


class UpgradeIn(_Strict):
    plan_id: str = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
    checkout_ref: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class UpgradeOut(_Strict):
    billing: BillingOut
    invoice: InvoiceOut | None
