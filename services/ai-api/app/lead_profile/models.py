"""The profile of a lead as the API shows it (job EE, contract-context-sources.md B3). Everything is optional: a lead nobody has guessed yet shows what the CRM knows and empty guesses."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Confidence = Literal["high", "medium", "low"]
Urgency = Literal["low", "normal", "high"]
Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
JunkReason = Literal["spam", "test", "no_contact", "abuse"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class JunkOut(_Strict):
    reason: JunkReason


class LeadProfileOut(_Strict):
    name: str | None = None
    phone_e164: str | None = None
    email: str | None = None
    city: str | None = None
    area: str | None = None
    need: str | None = None
    quantity: str | None = None
    budget: str | None = None
    timeline: str | None = None
    urgency: Urgency | None = None
    language: Language | None = None
    source: str | None = None
    campaign: str | None = None
    original_text: str | None = None
    confidence: dict[str, Confidence] = Field(default_factory=dict)
    duplicate_of: uuid.UUID | None = None
    merged_count: int = 0
    junk: Literal[False] | JunkOut = False
    fixed_by_you: list[str] = Field(default_factory=list)


class ProfileFix(_Strict):
    """`PATCH /leads/{id}/profile`: any of these, a value fixes the field, null clears it (and it stays fixed). Name, phone and e-mail belong to the contact: `PATCH /contacts/{id}`."""

    need: Short | None = None
    quantity: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    area: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    city: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    budget: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    timeline: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    campaign: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    urgency: Urgency | None = None
    language: Language | None = None
    junk: JunkReason | None = None


class NormaliseIn(_Strict):
    lead_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)


class NormaliseOut(_Strict):
    improved: list[uuid.UUID]
    skipped: list[uuid.UUID]
