"""API-facing models of the conversational assistant (job EA). Requests are closed: an unknown field is a 422, so a client can never send a mode, a price, a tenant or a role."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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
    language: Literal["auto", "te", "en", "hi", "kn", "ta", "ml", "mr"] | None = None
    # job assistant-does-the-work A2: files dropped in the chat with this message (each a `file_id` of POST /assistant/files, the caller's own, not expired). The router reads what each is and answers
    # with a `work_card` (a file's preview with its plan, or "can't do yet"); nothing is written before the plan's OK
    attachment_ids: Annotated[list[uuid.UUID], Field(max_length=5)] = Field(default_factory=list)


class ConfirmIn(_Strict):
    decision: Literal["yes", "no"]
    second_confirm: bool = False   # the owner's second yes to a plan of more than 50 people (a yes without it is refused: 409 second_yes_required)


class AskConsentIn(_Strict):
    """Ask the people a plan left out ("ask first": consent not known) for their consent. `how`: `owner_confirms` = the Owner says these people agreed (in the shop, on a call; Owner with the second factor; recorded in the consent ledger as spoken consent) and the plan is made again with them in; `whatsapp` = send each one a short WhatsApp message asking for OK (the outbox decides who may be written to)."""

    how: Literal["owner_confirms", "whatsapp"]
    contact_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)
    all_skipped: bool = False


class AskConsentOut(_Strict):
    how: Literal["owner_confirms", "whatsapp"]
    asked: int                                 # the people this reached (recorded, or a message submitted)
    queued: int = 0                            # whatsapp: messages the outbox accepted (queued or waiting for the Owner's OK)
    blocked: int = 0                           # whatsapp: messages the outbox refused (for example the person never wrote to the business)
    blocked_reasons: dict[str, int] = Field(default_factory=dict)
    template_status: Literal["not_needed", "none_registered"] = "none_registered"   # whatsapp: a business-started message outside the 24 hours needs an approved template; none is registered with Meta yet
    new_action: dict[str, Any] | None = None   # owner_confirms: the plan made again with these people in (a `confirm_action` card); the old plan is cancelled


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
