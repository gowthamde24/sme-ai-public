"""The task API shapes (job DR B1). Strict: an unknown field is a 422. The contract is packages/contracts/tasks.* and docs/contracts/tasks.md.

The PLAN is written by the API from the model's structured answer and checked here: closed words, bounded lengths, and a question key that is a plain identifier. Money is paise, computed by code from counts."""

from __future__ import annotations

import re
import uuid
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.crm.models import ApiUuid

Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
TemplateId = Literal["call_new_leads", "reengage_old_leads", "confirm_appointments", "collect_feedback", "payment_reminder", "supplier_price_enquiry", "offer_invite", "custom"]
Channel = Literal["call", "whatsapp", "both"]
Status = Literal["needs_answer", "planned", "approved", "running", "paused", "done", "cancelled"]
QuestionType = Literal["text", "amount", "date", "yesno"]
_KEY = re.compile(r"^[a-z][a-z0-9_]{1,30}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------------------------------------ requests
class ProvidedContact(_Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=32)]


class PlanIn(_Strict):
    task_id: ApiUuid | None = None
    instruction: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=1500)]
    language: Language | None = None
    contacts: Annotated[list[ProvidedContact], Field(max_length=500)] | None = None


class AnswerIn(_Strict):
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class ExcludeIn(_Strict):
    contact_ids: Annotated[list[ApiUuid], Field(min_length=1, max_length=500)]
    excluded: bool = True


class ApproveIn(_Strict):
    plan_sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    cap_paise: Annotated[int, Field(ge=0, le=10_000_000)] | None = None


class CapIn(_Strict):
    cap_paise: Annotated[int, Field(ge=0, le=10_000_000)]


# ------------------------------------------------------------------------------------------------ the plan (what the model may say; checked here)
class Question(_Strict):
    key: str
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
    type: QuestionType = "text"

    @field_validator("key")
    @classmethod
    def _identifier(cls, value: str) -> str:
        if not _KEY.match(value):
            raise ValueError("a question key is a short lower-case identifier")
        return value


class Window(_Strict):
    date: str = "today"
    from_minute: Annotated[int, Field(ge=540, le=1260, multiple_of=15)] = 600
    to_minute: Annotated[int, Field(ge=540, le=1260, multiple_of=15)] = 1140

    @model_validator(mode="after")
    def _ordered(self) -> Window:
        if self.from_minute >= self.to_minute:
            raise ValueError("the window must start before it ends")
        if self.date not in ("today", "tomorrow"):
            try:
                date.fromisoformat(self.date)
            except ValueError:
                raise ValueError("the date is today, tomorrow or YYYY-MM-DD") from None
        return self


class FollowUp(_Strict):
    kind: Literal["none", "whatsapp_summary", "call_back"] = "none"
    after_hours: Annotated[int, Field(ge=1, le=168)] = 24


class Selector(_Strict):
    """Who, described: the API resolves it against the workspace's OWN contacts. The model never names an id."""

    segment: Literal["all_leads", "new_leads", "old_leads", "recent_leads", "provided_list"] | None = None
    days: Annotated[int, Field(ge=1, le=365)] | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _tidy(cls, data: Any) -> Any:
        """A model often sends the unused field as null or empty, or both fields: empty ones are dropped, and when both are given the name (the narrower one, fewer people) wins."""
        if not isinstance(data, dict):
            return data
        data = {k: v for k, v in data.items() if v not in (None, "", 0)}
        if "name" in data and "segment" in data:
            data = {k: v for k, v in data.items() if k not in ("segment", "days")}
        return data

    @model_validator(mode="after")
    def _one(self) -> Selector:
        if (self.segment is None) == (self.name is None):
            raise ValueError("a selector is a segment or a name")
        return self


class PlanDraft(_Strict):
    """The model's structured answer (tool `make_plan`)."""

    template: TemplateId = "custom"
    channel: Channel
    goal: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]
    questions: Annotated[list[Question], Field(max_length=8)] = Field(default_factory=list)
    script_notes: Annotated[str, StringConstraints(max_length=800)] = ""
    message_text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=400)] | None = None
    window: Window = Field(default_factory=Window)
    follow_up: FollowUp = Field(default_factory=FollowUp)
    selectors: Annotated[list[Selector], Field(max_length=10)] = Field(default_factory=list)
    clarifying_question: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _drop_empty_selectors(cls, data: Any) -> Any:
        """A selector with nothing in it (the model's way of saying "everyone") is not one: dropped, and the default people apply."""
        if isinstance(data, dict) and isinstance(data.get("selectors"), list):
            kept = [s for s in data["selectors"] if not (isinstance(s, dict) and not any(v not in (None, "", 0) for v in s.values()))]
            data = {**data, "selectors": kept}
        return data

    @model_validator(mode="after")
    def _unique_keys(self) -> PlanDraft:
        keys = [q.key for q in self.questions]
        if len(keys) != len(set(keys)):
            raise ValueError("question keys are unique")
        return self


# ------------------------------------------------------------------------------------------------ responses
class SampleContact(_Strict):
    contact_id: uuid.UUID
    name: str | None


class Unmatched(_Strict):
    name: str | None
    phone_last4: str


class PlanOut(_Strict):
    channel: Channel
    goal: str
    questions: list[Question]
    script_notes: str
    message_text: str | None
    window: Window
    follow_up: FollowUp
    contacts_total: int
    contacts_sample: list[SampleContact] = Field(default_factory=list)
    unmatched: list[Unmatched] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class Estimate(_Strict):
    contacts: int
    calls: int
    messages: int
    minutes: int
    cost_paise: int
    basis: str


class Progress(_Strict):
    total: int
    excluded: int
    waiting: int
    in_progress: int
    done: int
    failed: int
    skipped: int
    reached: int
    positive: int


class TaskOut(_Strict):
    id: uuid.UUID
    status: Status
    instruction: str
    language: Language
    template: TemplateId
    question: str | None
    plan: PlanOut | None
    estimate: Estimate | None
    cap_paise: int | None
    spent_paise: int
    pause_reason: Literal["cap", "owner"] | None
    progress: Progress
    plan_sha256: str | None
    simulated: bool = True
    wording: Literal["draft"] = "draft"
    created_at: str
    approved_at: str | None
    finished_at: str | None


class TaskContactOut(_Strict):
    id: uuid.UUID
    contact_id: uuid.UUID
    name: str
    phone_last4: str | None
    status: Literal["waiting", "excluded", "in_progress", "done", "failed", "skipped"]
    skip_reason: str | None
    outcome: str | None
    outcome_category: str | None
    captured: dict[str, Any] | None
    simulated: bool = True


class TaskContactsOut(_Strict):
    contacts: list[TaskContactOut]
    next_cursor: str | None


class TemplateOut(_Strict):
    id: str
    label: str
    channel_default: Channel
    needs_pack: str | None
    promotional: bool
    example_instruction: str


class TemplatesOut(_Strict):
    templates: list[TemplateOut]


class TranscriptLine(_Strict):
    who: Literal["assistant", "contact"]
    text: str


class ReportRow(_Strict):
    contact_id: uuid.UUID
    name: str
    phone_last4: str | None
    outcome: str
    category: str | None
    captured: dict[str, Any] | None
    transcript: list[TranscriptLine] | None
    recording_url: str | None = None
    simulated: bool = True
    message_status: str | None


class ReportTotals(_Strict):
    contacts: int
    reached: int
    positive: int
    negative: int
    unclear: int
    no_answer: int
    spent_paise: int


class ReportOut(_Strict):
    task_id: uuid.UUID
    status: Status
    short_answer: str
    short_answer_kind: Literal["cheapest", "counts"]
    totals: ReportTotals
    rows: list[ReportRow]
    simulated: bool = True
    wording: Literal["draft"] = "draft"
