"""API-facing models of the Main agent (job AG). Requests are closed: an unknown field is a 422, so a client can never send a price, a tenant or a role."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.assistant.language import Language

SourceType = Literal[
    "quote", "lead", "enquiry", "order", "company", "price_item", "followup_draft", "reply_draft"
]
DraftType = Literal["quote", "followup_draft", "reply_draft", "enquiry"]
OpenType = Literal["quote", "lead", "enquiry", "order"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MessageIn(_Strict):
    """One thing the owner says. `message_id` is the caller's (an exact retry replays and spends nothing); `conversation_id` is the caller's too: leave it out to start a chat."""

    message_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class OpenTarget(_Strict):
    """Where "Open" goes for a source or a draft card."""

    type: OpenType
    id: uuid.UUID


class SourceOut(_Strict):
    """Something the answer rests on, found by a read tool in THIS owner's business. `label` is a short plain name (read fresh, never stored)."""

    type: SourceType
    id: uuid.UUID
    label: str
    open: OpenTarget | None = None


class DraftCardOut(_Strict):
    """A DRAFT the assistant left. Nothing was sent, approved or priced by it: approval stays where it is today (`open` goes there)."""

    type: DraftType
    id: uuid.UUID
    label: str
    status: Literal["draft"] = "draft"
    open: OpenTarget | None = None
    # a customer-reply draft only: the text in the customer's language, its English gloss, and the mark that a machine wrote it
    language: Language | None = None
    preview: str | None = None
    gloss_en: str | None = None
    machine_draft: bool = False


class MessageOut(_Strict):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    text: str
    language: Language | None
    sources: list[SourceOut]
    drafts: list[DraftCardOut]
    created_at: datetime


class ConversationOut(_Strict):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    messages: list[MessageOut]
