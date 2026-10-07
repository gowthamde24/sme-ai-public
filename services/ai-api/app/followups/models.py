"""API models for touches, the cadence policy, follow-up drafts and question drafts (ADR 0022). Every model is `extra="forbid"`: a column added to the database cannot leak by accident, and a body
field that is not declared is a 422, never ignored. In particular NO request carries wording, a contact, a tenant, a status, a hash of the engine's or an approver: the wording is the closed template
the database copies, the contact is the lead's, the tenant is the URL's. Nothing here sends anything: a touch, a draft and an approval are RECORDS of what a person did outside the system."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictInt, StringConstraints

from app.crm.models import ApiUuid, _Strict

Direction = Literal["out", "in"]
TouchChannel = Literal["email", "whatsapp", "phone"]
DraftChannel = Literal["email", "whatsapp"]
DraftStatus = Literal["draft", "approved", "discarded", "recorded_sent"]
DiscardCode = Literal["person", "superseded", "reply_recorded", "suppressed", "erased"]
QuestionStatus = Literal["draft", "approved", "discarded"]
QuestionDiscardCode = Literal["person", "resolved", "superseded"]
HHMM = Annotated[str, StringConstraints(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]
Hex64 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


# ----------------------------------------------------------------------------- requests
class CreatePolicyIn(_Strict):
    """A cadence policy version (Owner, with a second factor). Weekdays are Monday = 0 .. Sunday = 6; the offset is the recipient's fixed UTC offset in minutes (India: 330)."""

    id: ApiUuid
    effective_from: date
    gap_days: list[Annotated[StrictInt, Field(ge=0, le=365)]] = Field(max_length=99)
    max_touches: Annotated[StrictInt, Field(ge=1, le=100)]
    quiet_start: HHMM
    quiet_end: HHMM
    allowed_weekdays: list[Annotated[StrictInt, Field(ge=0, le=6)]] = Field(
        min_length=1, max_length=7
    )
    holidays: list[date] = Field(max_length=366)
    min_gap_hours: Annotated[StrictInt, Field(ge=0, le=8760)]
    recipient_utc_offset_minutes: Annotated[StrictInt, Field(ge=-840, le=840)] = 330


class RecordTouchIn(_Strict):
    """A person's record: "I sent it" (out) or "they replied" (in). `occurred_at` is null for "now" (the database clock); a stated time is never after now, at most 7 days back and never
    before the lead existed; an outbound touch is never before the lead's latest outbound touch."""

    id: ApiUuid
    direction: Direction
    channel: TouchChannel
    occurred_at: AwareDatetime | None = None


class CreateDraftIn(_Strict):
    """Ask for a follow-up draft for a lead. No wording, no contact, no time: the database derives the contact and copies the closed template."""

    id: ApiUuid
    channel: DraftChannel


class ApproveDraftIn(_Strict):
    """The approval carries the fingerprint of the draft the person reviewed (`state_hash` of the draft as shown): a draft whose state moved since is refused as stale."""

    state_hash: Hex64


class RecordSentIn(_Strict):
    """ "I sent it" for an APPROVED draft. `occurred_at` is null for "now" (the database clock); a stated time is never after now and never before the approval."""

    touch_id: ApiUuid
    occurred_at: AwareDatetime | None = None


# ----------------------------------------------------------------------------- responses
class PolicyVersionOut(_Strict):
    id: uuid.UUID
    version_no: int
    effective_from: date
    gap_days: list[int]
    max_touches: int
    quiet_start: str
    quiet_end: str
    allowed_weekdays: list[int]
    holidays: list[date]
    min_gap_hours: int
    recipient_utc_offset_minutes: int
    created_at: datetime


class PolicyResultOut(_Strict):
    version_id: uuid.UUID
    version_no: int
    effective_from: date
    replayed: bool


class TouchOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    contact_id: uuid.UUID | None
    direction: Direction
    channel: TouchChannel
    occurred_at: datetime
    draft_id: uuid.UUID | None
    recorded_by: uuid.UUID | None
    recorded_at: datetime


class TouchResultOut(_Strict):
    touch_id: uuid.UUID
    lead_id: uuid.UUID
    direction: Direction
    replayed: bool


class DraftOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    contact_id: uuid.UUID
    touch_number: int
    status: DraftStatus
    channel: DraftChannel
    template_code: str
    body: str
    policy_version_id: uuid.UUID
    engine_version: str
    state_hash: str
    as_of: datetime
    created_by: uuid.UUID | None
    created_at: datetime
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    discarded_by: uuid.UUID | None
    discarded_at: datetime | None
    discard_code: DiscardCode | None


class DraftResultOut(_Strict):
    draft_id: uuid.UUID
    lead_id: uuid.UUID
    touch_number: int
    status: DraftStatus
    replayed: bool


class DraftStatusOut(_Strict):
    draft_id: uuid.UUID
    status: DraftStatus
    replayed: bool


class SentResultOut(_Strict):
    draft_id: uuid.UUID
    touch_id: uuid.UUID
    status: DraftStatus
    replayed: bool


class GateOut(_Strict):
    """Why a lead's follow-up is blocked or stopped, in closed words. `blocked`: contact | key | erased | consent | unkeyed | null (an erased marker on a key is shown as `key`)."""

    blocked: str | None
    stopped: str | None
    policy_in_force: bool


class DecisionOut(_Strict):
    """What the pinned engine says for this lead NOW (guidance for a screen, never approval: the database decides again when a draft is made). `touch_number` is the next touch."""

    action: Literal["wait", "draft_followup", "stop"] | None
    reason_code: str
    terminal: bool | None
    touch_number: int | None
    next_eligible_at: datetime | None
    engine_version: str


class LeadFollowupOut(_Strict):
    lead_id: uuid.UUID
    channel: DraftChannel
    gate: GateOut
    decision: DecisionOut | None
    policy_version_id: uuid.UUID | None
    touches: list[TouchOut]
    drafts: list[DraftOut]


class DueItemOut(_Strict):
    lead_id: uuid.UUID
    action: Literal["wait", "draft_followup", "stop"]
    reason_code: str
    touch_number: int
    next_eligible_at: datetime | None
    open_draft_id: uuid.UUID | None


class QuestionDraftOut(_Strict):
    id: uuid.UUID
    requirement_id: uuid.UUID
    line_no: int
    question_code: str
    question_text: str
    status: QuestionStatus
    created_by: uuid.UUID | None
    created_at: datetime
    decided_by: uuid.UUID | None
    decided_at: datetime | None
    discard_code: QuestionDiscardCode | None


class QuestionSyncOut(_Strict):
    requirement_id: uuid.UUID
    changed: int
    drafts: list[QuestionDraftOut]


class QuestionDecisionOut(_Strict):
    draft_id: uuid.UUID
    status: QuestionStatus
    replayed: bool
