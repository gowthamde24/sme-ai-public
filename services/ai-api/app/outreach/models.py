"""Speed to lead and "approve once" (job DR part A3): the request and answer shapes. The contract is ~/Desktop/stack19-jobs/contract-speed-approvals.md and packages/contracts/outreach.*. Strict: an unknown field is a 422."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Goal = Literal["site_visit", "counselling", "appointment", "qualify", "test_drive", "site_measurement", "quote", "trial", "callback", "general"]
Channel = Literal["call", "whatsapp", "both"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
Action = Literal["call_within_minutes", "whatsapp_first", "whatsapp_then_call"]
Source = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_.-]{1,64}$")]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=160)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=600)]
Captured = dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")], str | int | float | bool]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    """What the database answers; a field it adds later does not break the route."""

    model_config = ConfigDict(extra="ignore")


class PolicyIn(_Strict):
    night_call_minute: Annotated[int, Field(ge=540, le=720, multiple_of=15, strict=True)] | None = None
    max_attempts: Annotated[int, Field(ge=1, le=6, strict=True)] | None = None
    retry_gap_hours: Annotated[int, Field(ge=1, le=48, strict=True)] | None = None
    then_whatsapp: bool | None = None
    whatsapp_after_hours: bool | None = None
    handoff_reminder_minutes: Annotated[int, Field(ge=5, le=120, strict=True)] | None = None
    call_paise_per_minute: Annotated[int, Field(ge=0, le=5000, strict=True)] | None = None

    def as_settings(self) -> dict[str, int | bool]:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class HoursOut(_Out):
    days: list[int]
    from_minute: int
    to_minute: int
    from_: Literal["assistant", "call_settings", "default"] = Field(alias="from")

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class PolicyOut(_Out):
    night_call_minute: int
    max_attempts: int
    retry_gap_hours: int
    then_whatsapp: bool
    whatsapp_after_hours: bool
    handoff_reminder_minutes: int
    call_paise_per_minute: int
    hours: HoursOut
    saved: bool


class WhoContacts(_Strict):
    contact_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=2000)]


class WhoLeads(_Strict):
    lead_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=2000)]


class SourceFilter(_Strict):
    source: Source
    status: Literal["new", "contacted", "qualified", "disqualified"] | None = None
    since: date | None = None


class WhoSource(_Strict):
    source: SourceFilter


class BatchIn(_Strict):
    batch_id: uuid.UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    goal: Goal
    channel: Channel
    language: Language
    who: WhoContacts | WhoLeads | WhoSource
    questions: Annotated[list[Question], Field(max_length=8)] = Field(default_factory=list)
    message_text: Text | None = None
    window_days: Annotated[int, Field(ge=1, le=14, strict=True)] = 7
    max_calls_per_day: Annotated[int, Field(ge=1, le=5000, strict=True)] | None = None
    max_total_minutes: Annotated[int, Field(ge=1, le=100000, strict=True)] | None = None

    @model_validator(mode="after")
    def _whatsapp_needs_its_text(self) -> BatchIn:
        if self.channel in ("whatsapp", "both") and not self.message_text:
            raise ValueError("a WhatsApp step needs the approved text")
        return self

    def as_document(self) -> dict[str, object]:
        doc = self.model_dump(mode="json", exclude_none=True)
        doc["who"] = self.who.model_dump(mode="json", exclude_none=True)
        return doc


class ExcludeIn(_Strict):
    contact_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=2000)]


class ApproveIn(_Strict):
    plan_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class CapsIn(_Strict):
    max_calls_per_day: Annotated[int, Field(ge=1, le=5000, strict=True)] | None = None
    max_total_minutes: Annotated[int, Field(ge=1, le=100000, strict=True)] | None = None


class RuleIn(_Strict):
    rule_id: uuid.UUID
    source: Source
    action: Action
    within_minutes: Annotated[int, Field(ge=1, le=120, strict=True)] = 2
    goal: Goal
    channel: Channel
    language: Language
    questions: Annotated[list[Question], Field(max_length=8)] = Field(default_factory=list)
    message_text: Text | None = None
    max_calls_per_day: Annotated[int, Field(ge=1, le=5000, strict=True)] | None = None
    max_total_minutes: Annotated[int, Field(ge=1, le=100000, strict=True)] | None = None

    @model_validator(mode="after")
    def _the_combination_makes_sense(self) -> RuleIn:
        if self.action in ("whatsapp_first", "whatsapp_then_call") and (self.channel == "call" or not self.message_text):
            raise ValueError("a WhatsApp action needs the WhatsApp channel and the approved text")
        if self.channel in ("whatsapp", "both") and not self.message_text:
            raise ValueError("a WhatsApp step needs the approved text")
        return self

    def as_document(self) -> dict[str, object]:
        doc = self.model_dump(mode="json", exclude_none=True)
        doc["rule_id"] = str(self.rule_id)
        return doc


class OutcomeResultIn(_Strict):
    outcome: Literal["positive", "negative", "unclear"]
    category: Literal["interested", "visit_booked", "order_likely", "not_interested", "wrong_number", "too_costly", "already_bought", "call_back_later"] | None = None
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)] | None = None
    callback_at: datetime | None = None
    captured: Captured | None = None


class ResultIn(_Strict):
    result: Literal["no_answer", "busy", "voicemail", "connected", "failed"]
    outcome: OutcomeResultIn | None = None
    minutes: Annotated[float, Field(ge=0, le=120)] = 0
    stop: bool = False

    def outcome_document(self) -> dict[str, object] | None:
        return self.outcome.model_dump(mode="json", exclude_none=True) if self.outcome is not None else None


class SourceCostIn(_Strict):
    source: Source
    cost_per_lead_paise: Annotated[int, Field(ge=0, le=10_000_000, strict=True)]


class SourceCostsIn(_Strict):
    costs: Annotated[list[SourceCostIn], Field(max_length=50)]


# --------------------------------------------------------------------------------------------------- answers
class SampleOut(_Out):
    contact_id: uuid.UUID
    name_masked: str
    city: str | None


class PlanOut(_Out):
    count: int
    ready: int
    skipped: dict[str, int]
    sample: list[SampleOut]
    window: dict[str, date]
    estimated_minutes: int
    estimated_messages: int
    estimated_cost_paise: int
    caps: dict[str, int | None]


class BatchOut(_Out):
    id: uuid.UUID
    name: str
    status: Literal["planned", "running", "paused", "done", "cancelled"]
    paused_reason: Literal["owner", "cap_calls", "cap_minutes", "billing"] | None
    goal: Goal
    channel: Channel
    language: Language
    questions: list[str]
    message_text: str | None
    window_days: int
    max_calls_per_day: int | None
    max_total_minutes: int | None
    plan_sha256: str
    created_at: datetime
    approved_at: datetime | None
    finished_at: datetime | None


class ProgressOut(_Out):
    total: int
    waiting: int
    done: int
    calls_made: int
    connected: int
    interested: int
    minutes_used: float


class BatchAnswer(_Out):
    batch: BatchOut
    plan: PlanOut
    progress: ProgressOut | None = None


class ItemOut(_Out):
    id: uuid.UUID
    contact_id: uuid.UUID
    lead_id: uuid.UUID | None
    name: str
    status: Literal["planned", "waiting", "done", "stopped", "skipped"]
    reason: str | None
    attempts: int
    next_action: Literal["call", "whatsapp"] | None
    next_at: datetime | None
    last_result: str | None
    created_at: datetime


class UsageOut(_Out):
    leads: int
    calls_today: int
    minutes_used: float


class RuleOut(_Out):
    id: uuid.UUID
    source: str
    action: Action
    within_minutes: int
    goal: Goal
    channel: Channel
    language: Language
    questions: list[str]
    message_text: str | None
    max_calls_per_day: int | None
    max_total_minutes: int | None
    active: bool
    paused_reason: Literal["owner", "cap_calls", "cap_minutes", "billing"] | None
    paused_at: datetime | None
    approved_at: datetime
    usage: UsageOut


class ResultOut(_Out):
    item_id: uuid.UUID
    status: Literal["waiting", "stopped"]
    reason: str | None = None
    next_at: datetime | None = None


class HandoffOut(_Out):
    id: uuid.UUID
    lead_id: uuid.UUID | None
    contact_id: uuid.UUID
    contact_name: str
    summary: str
    assigned_to: uuid.UUID
    notified_at: datetime
    reminder_sent_at: datetime | None
    acted_at: datetime | None


class SourceRowOut(_Out):
    source: str
    leads: int
    first_touch_median_seconds: int | None
    calls: int
    connected_rate: float
    interested_pct: float
    bookings: int
    call_cost_paise: int
    lead_cost_paise: int
    cost_per_booking_paise: int | None


class TotalOut(_Out):
    leads: int
    calls: int
    connected_rate: float
    interested_pct: float
    bookings: int
    call_cost_paise: int
    lead_cost_paise: int
    cost_per_booking_paise: int | None


class ReportOut(_Out):
    from_day: date
    to_day: date
    by_source: list[SourceRowOut]
    total: TotalOut


class SourceCostOut(_Out):
    source: str
    cost_per_lead_paise: int


class ItemsOut(_Out):
    items: list[ItemOut]
    next_cursor: str | None
