"""API models for enquiries (T008). Responses are `extra="forbid"`: a column added to the
database cannot leak by accident.

An enquiry is UNTRUSTED CONTENT (CLAUDE.md #6): `subject` and `body` are data, rendered as plain
text by every client, never followed, never interpreted. They were scrubbed of e-mail addresses and
mobile numbers before storage (owner change A)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StringConstraints

from app.crm.models import ApiUuid, _Strict

Channel = Literal["email", "whatsapp", "form", "other"]


class EnquiryOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    company_id: uuid.UUID | None
    contact_id: uuid.UUID | None
    channel: Channel
    received_at: datetime
    subject: str | None
    body: str
    truncated_from: int | None
    created_by: uuid.UUID | None
    created_at: datetime
    archived_at: datetime | None


# ----------------------------------------------------------------------------- capture
class CaptureIn(_Strict):
    """Paste an enquiry onto a lead. The id is chosen by the caller (idempotent create). `text` and `subject` are what the person
    pasted: the API strips invisible characters and scrubs e-mail addresses and Indian mobile numbers BEFORE storing, and the
    original is kept nowhere (owner decision 1)."""

    id: ApiUuid
    channel: Channel
    received_at: AwareDatetime
    subject: Annotated[str, StringConstraints(max_length=2000)] | None = None
    text: Annotated[str, StringConstraints(min_length=1, max_length=200_000)]


class CaptureOut(_Strict):
    """What was stored, and whether it differs from what was pasted (so the person sees what changed)."""

    enquiry: EnquiryOut
    text_changed: bool
    truncated: bool


# ----------------------------------------------------------------------------- the requirement of an enquiry
FieldKey = Literal[
    "saree_type", "fabric", "colour", "quantity", "budget", "deadline", "delivery_city", "payment_terms"
]  # fmt: skip
Certainty = Literal["stated", "implied", "ambiguous"]
FieldState = Literal["proposed", "confirmed", "corrected", "rejected"]
RequirementStatus = Literal["draft", "confirmed", "superseded", "discarded"]
Origin = Literal["manual", "import", "agent"]


class FieldValueOut(_Strict):
    code: str | None
    int_value: int | None
    date_value: date | None
    text: str | None
    basis: str | None


class RequirementFieldOut(_Strict):
    """One field. `quote` is UNTRUSTED text from the enquiry (plain text only); `display` is our own wording of the typed value
    (the city is customer text: shown as text too). A manual field has no quote."""

    id: uuid.UUID
    line_no: int | None
    field_key: FieldKey
    value: FieldValueOut
    display: str
    certainty: Certainty
    state: FieldState
    conflict: bool
    created_via: Origin
    quote: str | None
    quote_start: int | None
    quote_end: int | None
    decided_by: uuid.UUID | None
    decided_at: datetime | None


class RequirementOut(_Strict):
    id: uuid.UUID
    status: RequirementStatus
    created_via: Origin
    agent_run_id: uuid.UUID | None
    confirmed_by: uuid.UUID | None
    confirmed_at: datetime | None
    created_at: datetime


class FlagOut(_Strict):
    kind: Literal["missing", "low_certainty", "conflicting"]
    field_key: FieldKey
    line_no: int | None


class QuestionOut(_Strict):
    """A clarifying question DRAFT, derived at read time from the flags through closed templates. Nothing about it is stored and
    nothing is ever sent: the screen shows the text and a Copy button."""

    code: str
    text: str
    field_key: FieldKey
    line_no: int | None


class RequirementViewOut(_Strict):
    """The requirement of an enquiry as a person reviews it. `confirmable`: a line whose saree type AND quantity a human confirmed
    or corrected. `ready_for_quote`: also the delivery city, deadline and payment terms. Neither is computed by a model."""

    requirement: RequirementOut | None
    fields: list[RequirementFieldOut]
    lines: list[int]
    confirmable: bool
    ready_for_quote: bool
    flags: list[FlagOut]
    questions: list[QuestionOut]


class DecisionIn(_Strict):
    """confirm | correct | reject one field. `value` is the corrected value in the person's own words ('30 days credit', 'Rs 5k
    each', 'next Friday'); the same normalisers as the agent's read it. A confirm and a reject carry none."""

    decision: Literal["confirm", "correct", "reject"]
    value: Annotated[str, StringConstraints(min_length=1, max_length=120)] | None = None


class AddFieldIn(_Strict):
    """A human adds a field the extraction missed. `line` (1-5) for saree_type, fabric, colour and quantity; none for the others.
    `quote`, if given, must be words of the stored enquiry text."""

    line: Annotated[int, Field(ge=1, le=5)] | None = None
    field: FieldKey
    value: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    quote: Annotated[str, StringConstraints(min_length=1, max_length=300)] | None = None


class FieldDecisionOut(_Strict):
    field_id: uuid.UUID
    state: FieldState
    replayed: bool


class FieldAddedOut(_Strict):
    field_id: uuid.UUID
    requirement_id: uuid.UUID
    replayed: bool


class RequirementActionOut(_Strict):
    requirement_id: uuid.UUID
    status: RequirementStatus
    replayed: bool
