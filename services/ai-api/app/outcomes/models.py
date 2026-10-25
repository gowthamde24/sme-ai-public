"""The outcome API shapes (job DM, C1 part). Committed EARLY as a contract (packages/contracts/outcomes.*, docs/contracts/outcomes.md): the customer timeline and Today are built against it.

An outcome is what came of one call or one WhatsApp follow-up conversation: positive, negative or unclear, a category and a short reason. The AI records it; the owner can correct it. NO CHILD DATA: nothing here
refers to a student, and in an education workspace `reason` is always null (the web shows the category's fixed words)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

OutcomeWord = Literal["positive", "negative", "unclear"]
CategoryWord = Literal["interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "call_back_later"]
KindWord = Literal["call", "whatsapp_followup"]

# the category belongs to its outcome (the database holds the same rule)
CATEGORIES_OF: dict[str, tuple[str | None, ...]] = {
    "positive": ("interested", "visit_booked", "order_likely"),
    "negative": ("not_interested", "wrong_number", "too_costly"),
    "unclear": (None, "call_back_later"),
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _check_pair(outcome: str, category: str | None) -> None:
    if category not in CATEGORIES_OF[outcome]:
        raise ValueError("the category does not belong to the outcome")


class OutcomeIn(_Strict):
    contact_id: uuid.UUID
    lead_id: uuid.UUID | None = None
    kind: KindWord
    # the call, or the customer's message, this outcome is about; the same source twice is one outcome
    source_id: uuid.UUID
    outcome: OutcomeWord
    category: CategoryWord | None = None
    reason: str | None = Field(default=None, min_length=2, max_length=200)
    occurred_at: datetime

    @model_validator(mode="after")
    def _pair(self) -> OutcomeIn:
        _check_pair(self.outcome, self.category)
        return self


class OutcomeCorrectionIn(_Strict):
    outcome: OutcomeWord
    category: CategoryWord | None = None
    reason: str | None = Field(default=None, min_length=2, max_length=200)

    @model_validator(mode="after")
    def _pair(self) -> OutcomeCorrectionIn:
        _check_pair(self.outcome, self.category)
        return self


class OutcomeOut(_Strict):
    id: uuid.UUID
    contact_id: uuid.UUID
    lead_id: uuid.UUID | None
    kind: KindWord
    source_id: uuid.UUID
    outcome: OutcomeWord
    category: CategoryWord | None
    # one line on why; null in an education workspace (no child data can slip in through a sentence) and when none was given
    reason: str | None
    # who first wrote it: "ai" (the registered channel account) or "person"
    recorded_by: Literal["ai", "person"]
    # true when the owner (or an admin) changed what the AI said
    corrected: bool
    corrected_at: datetime | None
    # what the AI said before a person corrected it (null on an outcome a person made)
    ai_outcome: OutcomeWord | None
    ai_category: CategoryWord | None
    occurred_at: datetime
    recorded_at: datetime


class OutcomeRecordedOut(OutcomeOut):
    # true when this source (or this conversation) already had an outcome: nothing changed
    replayed: bool


class CustomerOutcomeOut(_Strict):
    """One line of a customer's page (C2's shape): the outcome as the screen draws it."""

    id: str
    channel: Literal["call", "whatsapp"]
    at: datetime
    result: OutcomeWord
    category: CategoryWord | None
    reason: str | None
    corrected: bool


class CustomerCorrectionIn(_Strict):
    """C2's correction body: the result and the category; the old reason is dropped unless a new one is given (it described the old word)."""

    result: OutcomeWord
    category: CategoryWord | None = None
    reason: str | None = Field(default=None, min_length=2, max_length=200)

    @model_validator(mode="after")
    def _pair(self) -> CustomerCorrectionIn:
        _check_pair(self.result, self.category)
        return self


class OutcomeListOut(_Strict):
    items: list[OutcomeOut]
    has_more: bool
    # pass it back as `cursor` for the next page; null when there is no more
    next_cursor: str | None


class CategoryCountsOut(_Strict):
    interested: int
    visit_booked: int
    order_likely: int
    not_interested: int
    wrong_number: int
    too_costly: int
    call_back_later: int


class OutcomeDayOut(_Strict):
    day: date
    positive: int
    negative: int
    unclear: int
    by_category: CategoryCountsOut


class OutcomeTotalsOut(_Strict):
    from_day: date
    to_day: date
    # every day from `from_day` to `to_day`, zero-filled, oldest first (India days)
    days: list[OutcomeDayOut]
    total: OutcomeTotalOut


class OutcomeTotalOut(_Strict):
    positive: int
    negative: int
    unclear: int


OutcomeTotalsOut.model_rebuild()
