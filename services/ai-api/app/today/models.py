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
    """Where "Open" goes for an item: a quote, a lead (its follow-ups), an enquiry or an order."""

    type: Literal["quote", "lead", "enquiry", "order"]
    id: uuid.UUID


class NeedsYouItem(_Out):
    kind: Literal["quote_approval", "followup_due", "order_money_held"]
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


class LastEvent(_Out):
    text: str
    at: datetime


class AgentStatusOut(_Out):
    agent: AgentKey
    state: Literal["idle", "working", "not_available"]
    job: str
    last_event: LastEvent | None
