"""API-facing models of reminder campaigns and the call list (job CP, ADR 0086; modules `campaigns` and `call_list`). Requests are closed: an unknown field is a 422.

A campaign is a list of people the business already deals with, one approved WhatsApp template, a fixed text with merge fields (name, amount, due_date, reference, business) and up to five steps that are OFFSETS from
each person's own date. The amount in a message is a NUMBER from the list or the ledger, never a model's. The Owner approves the WHOLE campaign once (with a second factor) after seeing the rendered samples; any change
after that sends it back to draft. Every message is an ordinary outbox message under every per-message rule (consent, STOP, quiet hours, daily limit, kill switches)."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

Kind = Literal["payment_due", "delivery_update", "fee_due", "event", "exam", "holiday"]
Status = Literal["draft", "approved", "running", "paused", "done", "cancelled"]
Language = Literal["en", "te", "hi", "kn", "ta"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=600)]
Reference = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$")]
Sha = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
# a message carries an amount of at most Rs 10 lakh (the cap is the database's too)
Paise = Annotated[StrictInt, Field(ge=1, le=100_000_000)]
MAX_ROWS = 5000
PART = 500
_TIME = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StepIn(_Strict):
    """One step: `offset_days` from the person's own date (negative is before, 0 the day itself) and the time of day, India time, as HH:MM. At most five steps, in order."""

    offset_days: Annotated[StrictInt, Field(ge=-60, le=180)]
    time: str

    @field_validator("time")
    @classmethod
    def _time_ok(cls, v: str) -> str:
        if not _TIME.match(v):
            raise ValueError("a time of day as HH:MM")
        return v


class CampaignIn(_Strict):
    """The whole campaign (a PUT: the same id again changes it). The kind never changes. A change to a campaign that was approved sends it back to draft."""

    name: Name
    kind: Kind
    language: Language
    wa_template_id: uuid.UUID | None = None
    message_text: Text
    steps: Annotated[list[StepIn], Field(min_length=1, max_length=5)]
    # after this step, a person who did not reply and has not paid goes on the call list (money reminders only)
    call_after_step: Annotated[StrictInt, Field(ge=1, le=5)] | None = None
    call_wait_hours: Annotated[StrictInt, Field(ge=1, le=168)] = 24

    @model_validator(mode="after")
    def _ordered(self) -> CampaignIn:
        keys = [(s.offset_days, s.time) for s in self.steps]
        if keys != sorted(set(keys)):
            raise ValueError("the steps must be in order, each at its own moment")
        return self


class StepOut(_Strict):
    offset_days: int
    time: str


class CampaignOut(_Strict):
    id: uuid.UUID
    name: str
    kind: Kind
    status: Status
    language: Language
    wa_template_id: uuid.UUID | None
    message_text: str
    steps: list[StepOut]
    call_after_step: int | None
    call_wait_hours: int
    audience_kind: Literal["import", "filter"]
    audience_filter: dict[str, Any] | None
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    approved_recipients: int | None
    approved_total_paise: int | None
    created_at: datetime
    updated_at: datetime
    paused_at: datetime | None
    cancelled_at: datetime | None
    completed_at: datetime | None
    recipients: int
    total_amount_paise: int


class CampaignDetailOut(CampaignOut):
    """One campaign, with what still stands between a draft and its approval (closed words, each with a fixed sentence in `issue_text`) and whether the worker may send (both switches on)."""

    issues: list[str]
    issue_text: dict[str, str]
    sending_on: bool


class CampaignSavedOut(_Strict):
    campaign: CampaignOut
    created: bool
    back_to_draft: bool


class CampaignListOut(_Strict):
    items: list[CampaignOut]
    next_cursor: str | None


class RecipientRowIn(_Strict):
    """One person by contact id or by phone number (the number only FINDS an existing contact of this business; it is not stored), with the date the reminder is about, an amount for a money reminder and a short
    label (an invoice number, a fee head) when the text uses one."""

    contact_id: uuid.UUID | None = None
    phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=20, pattern=r"^[0-9+ ()-]+$")] | None = None
    due_date: date
    amount_paise: Paise | None = None
    reference: Reference | None = None

    @model_validator(mode="after")
    def _one(self) -> RecipientRowIn:
        if (self.contact_id is None) == (self.phone is None):
            raise ValueError("name the person by contact_id or by phone, not both")
        return self


class RecipientsIn(_Strict):
    rows: Annotated[list[RecipientRowIn], Field(min_length=1, max_length=MAX_ROWS)]


class LedgerFilterIn(_Strict):
    """The ledger list: every party with money open on claims due between `due_from` and `due_to` (at most 400 days), optionally only companies or contacts, optionally only at least `min_open_paise`."""

    due_from: date
    due_to: date
    party: Literal["company", "contact"] | None = None
    min_open_paise: Annotated[StrictInt, Field(ge=1, le=100_000_000_000)] | None = None


class SkippedOut(_Strict):
    row: int
    reason: str


class RecipientsAddedOut(_Strict):
    added: int
    skipped: list[SkippedOut]
    recipients: int


class RemovedOut(_Strict):
    removed: int


class StepStateOut(_Strict):
    step_no: int
    scheduled_for: datetime
    status: Literal["planned", "submitted", "skipped"]
    reason: str | None


class RecipientOut(_Strict):
    id: uuid.UUID
    seq: int
    contact_id: uuid.UUID
    contact_name: str
    due_date: date
    amount_paise: int | None
    reference: str | None
    closed_reason: Literal["paid", "promised", "wrong_number", "stopped"] | None
    promised_on: date | None
    steps: list[StepStateOut]


class SampleOut(_Strict):
    recipient_id: uuid.UUID
    labels: list[Literal["first", "longest", "highest_amount", "random"]]
    body: str
    amount_paise: int | None
    due_date: date


class PreviewOut(_Strict):
    """What the Owner sees before approving: the count, the total, the dates, the rendered samples (the first, the longest, the highest amount and three at random) and the hash of what was shown. The first message
    to a person also carries `disclosure`."""

    campaign: CampaignOut
    samples: list[SampleOut]
    samples_sha256: Sha
    content_sha256: Sha
    recipients: int
    total_amount_paise: int
    first_due: date | None
    last_due: date | None
    disclosure: str
    issues: list[str]
    issue_text: dict[str, str]
    sending_on: bool


class ApproveIn(_Strict):
    """The hash of the samples the Owner SAW: if the campaign changed since, the approval is refused (409 `samples_changed`)."""

    samples_sha256: Sha


class ApprovedOut(_Strict):
    campaign: CampaignOut
    planned_steps: int
    past_steps: int
    sending_on: bool


class ResultsOut(_Strict):
    """Counts derived from the outbox and the WhatsApp status table. States: planned, skipped (a reason), held (waiting for a person), waiting (queued), sent, delivered, read, failed, blocked (a reason)."""

    campaign_id: uuid.UUID
    status: Status
    recipients: int
    by_state: dict[str, int]
    by_reason: dict[str, int]
    by_day: list[dict[str, Any]]
    delivered_total: int
    replied: int
    paid_after_reminder: dict[str, int]
    closed: dict[str, int]
    calls: dict[str, Any]


# ----------------------------------------------------------------------------------------------------------------------------------------------------------------
# the call list
# ----------------------------------------------------------------------------------------------------------------------------------------------------------------
Outcome = Literal["paid", "promised", "call_later", "wrong_number", "stop"]


class CallItemOut(_Strict):
    """One person to call. The number is never shown: the call goes through the bridge (`call_request_id` is the approved request to start it with)."""

    id: uuid.UUID
    campaign_id: uuid.UUID
    campaign_name: str
    recipient_id: uuid.UUID
    contact_id: uuid.UUID
    contact_name: str
    amount_paise: int | None
    due_date: date
    reference: str | None
    step_no: int
    status: Literal["open", "done"]
    outcome: Outcome | None
    promised_on: date | None
    call_after: datetime | None
    attempts: int
    call_request_id: uuid.UUID
    created_at: datetime
    sort_at: datetime


class CallListOut(_Strict):
    items: list[CallItemOut]
    next_cursor: str | None


class OutcomeIn(_Strict):
    """What happened on the call: `paid`, `promised` (with a date from today to 60 days), `call_later` (with a time within 30 days), `wrong_number` or `stop` (the person is put on the do-not-contact list)."""

    outcome: Outcome
    promised_on: date | None = None
    call_after: datetime | None = None

    @model_validator(mode="after")
    def _fit(self) -> OutcomeIn:
        if (self.outcome == "promised") != (self.promised_on is not None):
            raise ValueError("a promise has its date, and only a promise does")
        if (self.outcome == "call_later") != (self.call_after is not None):
            raise ValueError("'call later' has its time, and only it does")
        return self


class OutcomeRecordedOut(_Strict):
    id: uuid.UUID
    status: Literal["open", "done"]
    outcome: Outcome
    replayed: bool
