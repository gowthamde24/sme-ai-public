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
    """The screen of this business that shows a source, or approves a draft: `{type, id}` (the web builds the path from it)."""

    type: OpenType
    id: uuid.UUID


class SourceOut(_Strict):
    """Something the answer rests on, found by a read tool in THIS owner's business. `label` is a short plain name (read fresh, never stored). `target` is the screen that
    shows it (null when the record has no page of its own: a company, a price item)."""

    kind: SourceType
    id: uuid.UUID
    label: str
    target: OpenTarget | None = None


DRAFT_SUMMARY: dict[str, str] = {
    "quote": "A draft quote, priced by the quote engine. Check and approve it on the quote page.",
    "followup_draft": "A draft follow-up message. Check and approve it on the lead's follow-up page. Nothing has been sent.",
    "enquiry": "An enquiry recorded from what you pasted. Check it on the enquiry page.",
}


def draft_summary(kind: str, body: str | None = None) -> str:
    """What a draft card says under its title: a reply draft shows its own text (the customer's language); the others a fixed sentence."""
    if kind == "reply_draft":
        return (body or "").strip()[:300]
    return DRAFT_SUMMARY.get(kind, "")


class DraftCardOut(_Strict):
    """A DRAFT the assistant left. Nothing was sent, approved or priced by it: a person approves it on the screen `target` names (a reply draft has no approving screen yet:
    `target` is the lead or enquiry it is about)."""

    id: uuid.UUID
    kind: DraftType
    title: str
    summary: str
    status: Literal["draft"] = "draft"
    target: OpenTarget | None = None
    # a customer-reply draft only: its language, its English gloss, and the mark that a machine wrote it
    language: Language | None = None
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
