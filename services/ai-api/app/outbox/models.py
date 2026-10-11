"""API-facing models of the outbox and of call requests (job AT, ADR 0066). The contract the web is built on: docs in the job AT report.

Every status, reason and flag is a closed word. `reason_text` is a fixed English sentence for the reason; the screen may word it itself. Nothing here carries a phone number, a key, a token or
another business's data."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints

Language = Literal["en", "te", "hi", "kn", "ta"]
Category = Literal["reply_to_inbound", "info", "visit", "followup", "order_status", "other"]
Source = Literal["assistant", "owner"]
Status = Literal["queued", "needs_approval", "sent", "blocked", "failed"]
Reason = Literal[
    "auto_allowed",
    "quiet_hours",
    "owner_approved",
    "money",
    "commitment",
    "complaint",
    "model_flagged",
    "uncertain",
    "category_other",
    "no_inbound_window",
    "auto_off",
    "switch_off",
    "no_contact",
    "no_phone",
    "stopped",
    "erased",
    "no_opt_in",
    "no_key",
    "daily_limit",
    "owner_rejected",
    "send_failed",
]
Flag = Literal["money", "commitment", "complaint"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=3000)]

REASON_TEXT: dict[str, str] = {
    "auto_allowed": "Allowed to go automatically.",
    "quiet_hours": "Waiting for 9 am: no messages between 9 pm and 9 am (India time).",
    "owner_approved": "A person approved it.",
    "money": "It mentions money (a price, an amount, a discount, GST, an advance, a payment...). A person decides.",
    "commitment": "It makes a promise or guarantee. A person decides.",
    "complaint": "It touches a complaint. A person decides.",
    "model_flagged": "The assistant marked it as sensitive. A person decides.",
    "uncertain": "The assistant was not sure about it. A person decides.",
    "category_other": "It is not one of the kinds that go automatically. A person decides.",
    "no_inbound_window": "A reply is automatic only within 24 hours of the customer's own message.",
    "auto_off": "Automatic sending is switched off for this business. A person decides.",
    "switch_off": "Sending is switched off for the whole system.",
    "no_contact": "This lead has no contact to message.",
    "no_phone": "The contact has no phone number.",
    "stopped": "The customer asked us to stop. Nothing more is sent.",
    "erased": "The customer's record was erased. Nothing more is sent.",
    "no_opt_in": "The customer has not agreed to WhatsApp messages and has never written to us.",
    "no_key": "The phone number has no suppression key on record, so it cannot be checked against stops.",
    "daily_limit": "The customer already has the daily limit of messages today.",
    "owner_rejected": "A person rejected it.",
    "send_failed": "The channel could not deliver it.",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SubmitMessageIn(_Strict):
    """One message to one lead's contact. The caller's id makes a retry safe. There is NO field for a phone number, a contact, a status, a reason or an approver: the database decides them."""

    message_id: uuid.UUID
    lead_id: uuid.UUID
    text: Text
    language: Language
    category: Category
    # the model's own doubt, never trusted to lower the bar: it can only make a message wait
    model_flagged: StrictBool = False
    uncertain: StrictBool = False
    source: Source = "owner"


class EditMessageIn(_Strict):
    text: Text


class OutboxMessageOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    contact_id: uuid.UUID | None
    customer: str | None
    city: str | None
    channel: Literal["whatsapp"]
    text: str
    language: Language
    category: Category
    source: Literal["assistant", "owner", "system"]
    status: Status
    reason: Reason
    reason_text: str
    flags: list[Flag]
    model_flagged: bool
    uncertain: bool
    disclosure_added: bool
    scheduled_for: datetime | None
    created_at: datetime
    edited_at: datetime | None
    decided_at: datetime | None
    sent_at: datetime | None
    failure_code: Literal["adapter_error", "timeout", "rejected"] | None


class DispatchOut(_Strict):
    """What a dispatch round did: messages handed to the channel and sent, handed over and failed. (Messages that were blocked at the re-check, held for quiet hours or held by the kill switch are
    not counted here: read them in the log.)"""

    sent: int
    failed: int


class SubmitResultOut(_Strict):
    message: OutboxMessageOut
    replayed: bool
    dispatched: DispatchOut | None = None


class DecisionOut(_Strict):
    """The message after a person's decision. `dispatched` is set when approving also handed due messages to the channel."""

    message: OutboxMessageOut
    dispatched: DispatchOut | None = None


class OutboxPageOut(_Strict):
    items: list[OutboxMessageOut]
    next_cursor: str | None


class OutboxSettingsOut(_Strict):
    platform_switch_on: bool
    auto_send_enabled: bool
    per_customer_daily_limit: int


class OutboxSettingsIn(_Strict):
    auto_send_enabled: StrictBool
    per_customer_daily_limit: Annotated[int, Field(ge=1, le=20)]


class CreateCallRequestIn(_Strict):
    request_id: uuid.UUID
    lead_id: uuid.UUID
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
    script_draft: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=2, max_length=4000)
    ]
    language: Language


class DecideCallIn(_Strict):
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class CallRequestOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    contact_id: uuid.UUID
    customer: str | None
    city: str | None
    reason: str
    script_draft: str
    language: Language
    status: Literal["requested", "approved", "rejected"]
    created_at: datetime
    decided_at: datetime | None
    decision_note: str | None


class CallRequestResultOut(_Strict):
    request: CallRequestOut
    replayed: bool


class CallRequestPageOut(_Strict):
    items: list[CallRequestOut]
    next_cursor: str | None
