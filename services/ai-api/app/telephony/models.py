"""The Calls page shapes (job phone-calls part 6). The contract for the web is docs/contracts/calls.md.

NOTE: no `from __future__ import annotations` (the models are attached to endpoint signatures at registration time)."""

# ruff: noqa: E501
import re
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    field_validator,
    model_validator,
)

CallState = Literal["queued", "ringing", "in_progress", "completed", "no_answer", "busy", "voicemail", "failed", "refused", "cancelled"]


class TurnOut(BaseModel):
    who: Literal["assistant", "caller"]
    text: str
    t: float | None = None
    # the line in English (owner, 7 Nov 2026): null when the line is English already or not translated yet; it may arrive a few seconds after the line
    text_en: str | None = Field(default=None, max_length=2000)


class CallOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    direction: Literal["outbound", "inbound"]
    state: CallState
    live: bool
    who: str                             # the contact's display name (name, else phone, else "Caller ending 998", else "New enquiry")
    can_take_over: bool = False          # true only when Take over works for THIS call: it is live, answered, on this server, and the person is an Owner or Admin
    assistant_name: str = "Priya"        # the assistant's name as it was on this call ("Priya" when the call has none noted)
    line: str | None = None              # the line the call came in on, by the name the operator gave it (Owner and Admin only; null for Sales)
    line_ending: str | None = None       # the last three digits of that line
    name: str | None = None              # only a REAL name (a contact's, or one the caller gave on the call): null otherwise, so a screen can say "What the caller wants"
    purpose: str | None
    language: str | None
    created_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None
    elapsed_s: int | None                # live calls: seconds since the call was ANSWERED (0 while it rings); finished: its length
    duration_s: int | None
    outcome: str | None
    category: str | None
    summary_short: str | None
    refuse_reason: str | None
    lead_id: str | None
    task_id: str | None
    sandbox: bool
    simulated: bool
    ai_disclosed: bool
    recorded: bool                       # always false: no audio is kept
    cost_paise: int
    callback_at: datetime | None = None


class CallsOut(BaseModel):
    items: list[CallOut]
    next_cursor: str | None
    updated_at: datetime
    poll_after_s: int = 5


class CorrectionOut(BaseModel):
    """"Correct it" (app v4): what a person fixed after the call. The AI's own summary and answers stay as they were."""

    model_config = ConfigDict(extra="forbid")

    summary: str | None = None
    captured: dict[str, str] | None = None
    note: str | None = None          # the person's note about how to talk / what the AI misunderstood: it goes into later calls' instructions
    corrected_at: datetime | None = None


class CorrectionIn(BaseModel):
    """Any of the three (at least one); an empty string or {} clears that field; a missing one keeps what is there."""

    model_config = ConfigDict(extra="forbid")

    summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)] | None = None
    captured: dict[Annotated[str, StringConstraints(min_length=1, max_length=40)], Annotated[str, StringConstraints(max_length=200)]] | None = None
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None


class CallDetailOut(CallOut):
    correction: CorrectionOut | None = None
    summary: str | None = None
    captured: dict[str, str] | None = None
    transcript: list[TurnOut] | None = None   # Owner and Admin only; Sales get null
    end_reason: str | None = None


class PlaceIn(BaseModel):
    """A test call from the business's Plivo line to a phone on the sandbox list."""

    model_config = ConfigDict(extra="forbid")

    to: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=20)] | None = None
    to_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=64)] | None = None   # an id from GET /calls/test-numbers, instead of a typed number
    language: Literal["en", "te", "hi", "kn", "ta", "ml", "mr"] = "en"
    goal: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=400)] | None = None   # what the call is for, in the owner's words (kept in memory until the callee answers; never in an address or a log)

    @model_validator(mode="after")
    def _one_target(self) -> Self:
        """Exactly one of `to` (a typed number) and `to_id` (a listed one)."""
        if (self.to is None) == (self.to_id is None):
            raise ValueError("to")
        return self

    @field_validator("goal")
    @classmethod
    def _goal(cls, value: str | None) -> str | None:
        """No phone number, address or link in a goal (it is spoken to a person and read by a model): the person is already named by `to`."""
        if value is None:
            return None
        if re.search(r"\d{6,}", value.replace(" ", "").replace("-", "")) or "@" in value or re.search(r"https?://|www\.", value, re.I) or any(ord(c) < 32 for c in value):
            raise ValueError("goal")
        return " ".join(value.split())


class TestNumberOut(BaseModel):
    __test__ = False   # (not a pytest class)
    id: str
    masked: str
    label: str | None = None


class TestNumbersOut(BaseModel):
    __test__ = False
    items: list[TestNumberOut]


class PlaceOut(BaseModel):
    call_id: str
    state: Literal["ringing"]


class TakeOverSettingOut(BaseModel):
    """The business's switch for live take-over (job TO). `announces`: the deployment plays a short spoken announcement to the caller when a person takes over (a flag, off by default)."""

    enabled: bool
    updated_at: datetime | None = None
    announces: bool = False


class TakeOverSettingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: StrictBool   # a real true or false: a safety switch is never turned on by "yes" or 1
