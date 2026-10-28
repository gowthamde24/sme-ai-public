"""API-facing models of the owner's notes (job EB part A). Requests are closed: an unknown field is a 422."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.assistant_context.rules import MAX_NOTES

Section = Literal["prices", "delivery", "timings", "payment", "always_say", "never_say", "discounts", "handover", "tone", "faq", "products", "other"]
Warning = Literal["cells_cut", "illegible_part", "looks_like_personal_data", "dropped_unverified"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PersonRef(_Strict):
    id: uuid.UUID
    name: str | None = None


class PromptOut(_Strict):
    key: str
    label: str
    hint: str


class ContextOut(_Strict):
    notes: str
    version: int
    updated_at: datetime | None
    updated_by: PersonRef | None
    prompts: list[PromptOut]
    used_by: list[str]


class ContextIn(_Strict):
    notes: Annotated[str, StringConstraints(max_length=MAX_NOTES)]
    expected_version: Annotated[int, Field(ge=0)]


class VersionItem(_Strict):
    version: int
    updated_at: datetime
    updated_by: PersonRef | None
    size: int
    change: str


class VersionsOut(_Strict):
    items: list[VersionItem]


class VersionOut(VersionItem):
    notes: str


class RestoreIn(_Strict):
    expected_version: Annotated[int, Field(ge=0)]


class UnderstandIn(_Strict):
    kind: Literal["paste", "file", "voice"]
    text: Annotated[str, StringConstraints(max_length=60_000)] | None = None
    filename: Annotated[str, StringConstraints(max_length=200)] | None = None
    content_base64: Annotated[str, StringConstraints(max_length=5_000_000)] | None = None
    language: Literal["te", "en", "hi", "kn"] | None = None


class Understood(_Strict):
    section: Section
    text: Annotated[str, StringConstraints(max_length=2000)]


class SourceRef(_Strict):
    kind: Literal["paste", "file", "voice"]
    filename: str | None = None


class UnderstandOut(_Strict):
    preview_id: str
    understood: list[Understood]
    notes_markdown: str
    source: SourceRef
    warnings: list[Warning]
    expires_at: datetime


class SaveUnderstoodIn(_Strict):
    notes_markdown: Annotated[str, StringConstraints(max_length=MAX_NOTES)]
    mode: Literal["append", "replace"]
    expected_version: Annotated[int, Field(ge=0)]


class TestIn(_Strict):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    language: Literal["te", "en", "hi", "kn", "ta", "ml"] | None = None


class UsedFrom(_Strict):
    from_: Literal["notes", "facts"] = Field(alias="from")
    snippet: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class TestOut(_Strict):
    answer: str
    language: str
    used: list[UsedFrom]
    would_hand_over: bool
    reason: Literal["asked_for_a_person", "asked_about_money", "complaint", "unsure"] | None
