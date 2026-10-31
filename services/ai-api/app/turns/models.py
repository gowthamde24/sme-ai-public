"""API-facing models of the conversational assistant (job EA). Requests are closed: an unknown field is a 422, so a client can never send a mode, a price, a tenant or a role."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

ActionStatus = Literal["proposed", "confirmed", "declined", "expired", "running", "done"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TurnIn(_Strict):
    """One thing the owner says. `message_id` is the caller's (an exact retry replays and spends nothing); `conversation_id: null` starts a conversation (the "New conversation" button).
    `language_hint`: the language of the app screen; used only for a very short message that carries no language of its own ("ok", "thanks")."""

    message_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    language_hint: Literal["en", "te", "hi", "kn"] | None = None
    # the language chosen on the assistant bar (owner, 31 Oct 2026): a language = the reply is in THAT language whatever the words inside it are; absent or "auto" = detected from the message, as before
    language: Literal["auto", "te", "en", "hi", "kn", "ta", "ml"] | None = None


class ConfirmIn(_Strict):
    decision: Literal["yes", "no"]


class TaskRef(_Strict):
    id: uuid.UUID
    status: str


class ConfirmOut(_Strict):
    action_id: uuid.UUID
    status: ActionStatus
    task: TaskRef


class ConversationItem(_Strict):
    id: uuid.UUID
    title: str
    updated_at: datetime
    message_count: int
    last_text: str


class ConversationListOut(_Strict):
    items: list[ConversationItem]
    next_before: datetime | None
