"""Models of the knowledge base (job DR / A1): the sources the Owner gives and the facts the assistant may state once they are approved. Strict. The contract is docs/contracts/leads-pack.md section 3."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.crm.models import ApiUuid

FactKind = Literal["price", "offer", "product_service", "location", "hours", "policy", "faq", "contact", "other"]
FactStatus = Literal["draft", "approved", "rejected"]
MAX_PASTE_CHARS = 60_000
MAX_FILE_BYTES = 5 * 1024 * 1024
# the database's own rule, the same words: text that looks like a price can only be a `price` fact
PRICE_LOOKING = re.compile(r"(₹|\brs\.?\s?[0-9]|[0-9]\s?(rupees|lakh|crore)\b|\brupees\b)", re.IGNORECASE)
LINK = re.compile(r"(https?://|www\.)", re.IGNORECASE)

FactText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceIn(_Strict):
    source_id: ApiUuid
    kind: Literal["paste", "file"]
    title: Title
    text: Annotated[str, Field(max_length=MAX_PASTE_CHARS)] | None = None
    filename: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None = None
    content_type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=100)] | None = None
    # the raw file, base64 (this API takes no multipart); at most 5 MB once decoded
    content_base64: Annotated[str, Field(max_length=MAX_FILE_BYTES * 4 // 3 + 16)] | None = None

    @model_validator(mode="after")
    def _paste_or_file(self) -> SourceIn:
        if self.kind == "paste" and (not self.text or not self.text.strip() or self.content_base64 is not None):
            raise ValueError("a pasted source needs its text")
        if self.kind == "file" and (not self.content_base64 or not self.filename or self.text is not None):
            raise ValueError("a file source needs its name and content")
        return self


class FactIn(_Strict):
    fact_id: ApiUuid
    kind: FactKind
    text: FactText

    @field_validator("text")
    @classmethod
    def _clean(cls, value: str) -> str:
        return check_fact_text(value)


class FactEditIn(_Strict):
    text: FactText
    kind: FactKind | None = None

    @field_validator("text")
    @classmethod
    def _clean(cls, value: str) -> str:
        return check_fact_text(value)


class DecisionIn(_Strict):
    decision: Literal["approve", "reject"]


def check_fact_text(value: str) -> str:
    if LINK.search(value):
        raise ValueError("a fact carries no link")
    return value


class SourceFactsOut(_Strict):
    draft: int
    approved: int
    rejected: int


class SourceOut(_Strict):
    id: str
    title: str
    kind: Literal["paste", "file"]
    filename: str | None
    content_type: str | None
    chars: int
    status: Literal["read", "drafted", "discarded"]
    created_at: datetime
    facts: SourceFactsOut


class SourcesOut(_Strict):
    sources: list[SourceOut]


class FactOut(_Strict):
    id: str
    kind: FactKind
    text: str
    status: FactStatus
    edited: bool
    source_id: str | None
    created_at: datetime
    decided_at: datetime | None
    decided_by_you: bool


class FactsOut(_Strict):
    facts: list[FactOut]
    next_cursor: str | None = None


class DraftOut(_Strict):
    facts: list[FactOut]
