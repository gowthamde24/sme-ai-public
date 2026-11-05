"""API-facing models: the Today screen, AI usage, the helpers' status (job AD / D3).

Money is integer paise.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

AgentKey = Literal[
    "main",
    "lead_finder",
    "researcher",
    "requirement_analyst",
    "quote_writer",
    "followup_desk",
    "order_desk",
]
# the order the office shows them in, always all seven
AGENT_ORDER: tuple[AgentKey, ...] = (
    "main",
    "lead_finder",
    "researcher",
    "requirement_analyst",
    "quote_writer",
    "followup_desk",
    "order_desk",
)


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TodayCards(_Out):
    waiting: int
    money_held_paise: int
    orders_open: int


class Target(_Out):
    """Where "Open" goes for an item: a quote, a lead (its follow-ups), an enquiry, an order, a message held for approval or a call request."""

    # material_quote: the building-materials quote; campaign: a message campaign; fees: the school's fee list (the id is the workspace's)
    type: Literal["quote", "lead", "enquiry", "order", "outbox_message", "call_request", "outreach_batch", "billing", "material_quote", "campaign", "fees", "phone_call"]
    id: uuid.UUID


class NeedsYouItem(_Out):
    kind: Literal[
        "quote_approval",
        "followup_due",
        "order_money_held",
        "outbox_approval",
        "call_approval",
        "outreach_paused",
        "hot_lead_waiting",
        "topup_low",
        "topup_empty",
        # 4 Nov 2026 (migration 20261228100000): a draft materials quote, a draft campaign, a school's overdue fees (a count and a total, no name)
        "material_quote_approval",
        "campaign_approval",
        "fees_overdue",
        # 5 Nov 2026 (migration 20261231160000): a caller asked for a person; the team calls back (POST /calls/{id}/handled takes it off)
        "person_requested",
    ]
    id: uuid.UUID
    customer: str
    city: str | None
    agent: Literal["quote_writer", "followup_desk", "order_desk"]
    summary: str
    at: datetime
    amount_paise: int | None
    target: Target


class RecentStep(_Out):
    kind: Literal["order_step"]
    order_ref: str
    customer: str
    text: str
    at: datetime
    target: Target


class TodayOut(_Out):
    cards: TodayCards
    needs_you: list[NeedsYouItem]
    recent: list[RecentStep]


class AiUsageOut(_Out):
    spent_paise: int
    cap_paise: int
    left_paise: int


class AiUsagePercentOut(_Out):
    """AI usage as the owner sees it (job AK / K2): how much of today's and this month's allowance is used, never an amount. `state`: ok, warn (80 % or more of either), light (100 % of either: a lighter model answers until the reset, nothing stops) or paused (300 % of either: only the AI pauses)."""

    today_percent: int
    month_percent: int
    resets_at_today: datetime
    resets_at_month: datetime
    state: Literal["ok", "warn", "light", "paused"]


class AiUsageWeekOut(_Out):
    """This week's (Monday to Sunday, India time) use of the AI allowance as one percentage, never an amount or a count: an even share of the month's allowance (job AS)."""

    week_percent: int
    resets_at_week: datetime


class LastEvent(_Out):
    text: str
    at: datetime
    # the screen that shows what happened (a quote, a lead, an enquiry, an order); null when it has none (a chat with the Main agent)
    target: Target | None = None


class AgentStatusOut(_Out):
    agent: AgentKey
    state: Literal["idle", "working", "not_available", "switched_off"]
    job: str
    last_event: LastEvent | None


class CallMinutes(_Out):
    used: int
    total: int | None   # None: no ceiling (pay as you go)


class AiUsageMeter(_Out):
    used_paise: int
    allowance_paise: int | None
    period: Literal["month"]


class NavCountsOut(_Out):
    """The sidebar's counts (docs/contracts/nav-counts.md). Every number may be null: not known, or not for this person; 0 means known, none."""

    needs_you: int | None
    prospects_needing_owner: int | None
    new_leads: int | None
    live_calls: int | None
    unread_chats: int | None
    followups_due: int | None
    visits_today: int | None
    quotes_waiting: int | None
    ai_team_working: int | None
    call_minutes: CallMinutes | None
    ai_usage: AiUsageMeter | None
    plan: str | None
    as_of: datetime


class AgentSwitchOut(_Out):
    """One helper's own switch for this workspace (docs/contracts/agents-switches.md). `can_switch` false: `reason_locked` says why (`platform`: the platform has it off; `workspace_off`: the
    workspace's AI helpers are off; `not_built`: this helper is a feature, not an agent, and has no switch of its own yet)."""

    agent: AgentKey
    enabled: bool
    can_switch: bool
    reason_locked: Literal["platform", "workspace_off", "not_built"] | None
    done_today: int | None


class AgentSwitchIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)   # only true or false: "no" or 0 is refused
    enabled: bool
