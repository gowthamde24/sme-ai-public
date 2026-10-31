"""The Calls page shapes (job phone-calls part 6). The contract for the web is docs/contracts/calls.md.

NOTE: no `from __future__ import annotations` (the models are attached to endpoint signatures at registration time)."""

# ruff: noqa: E501
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

CallState = Literal["queued", "ringing", "in_progress", "completed", "no_answer", "busy", "voicemail", "failed", "refused", "cancelled"]


class TurnOut(BaseModel):
    who: Literal["assistant", "caller"]
    text: str
    t: float | None = None


class CallOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    direction: Literal["outbound", "inbound"]
    state: CallState
    live: bool
    who: str                             # the contact's display name (name, else phone, else "New enquiry")
    purpose: str | None
    language: str | None
    created_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None
    elapsed_s: int | None                # live calls: seconds since the call began; finished: its length
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


class CallDetailOut(CallOut):
    summary: str | None = None
    captured: dict[str, str] | None = None
    transcript: list[TurnOut] | None = None   # Owner and Admin only; Sales get null
    end_reason: str | None = None
