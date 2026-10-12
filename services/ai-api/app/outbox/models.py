"""API-facing models of the outbox and of call requests (job AT, ADR 0066). The contract the web is built on: docs in the job AT report.

Every status, reason and flag is a closed word. `reason_text` is a fixed English sentence for the reason; the screen may word it itself. Nothing here carries a phone number, a key, a token or
another business's data."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints

Language = Literal["en", "te", "hi", "kn", "ta"]
Category = Literal["reply_to_inbound", "info", "visit", "followup", "order_status", "other"]
Source = Literal["assistant", "owner"]
Status = Literal["queued", "needs_approval", "sent", "blocked", "failed"]
Tab = Literal["waiting", "scheduled", "sent", "blocked"]
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

# job BR: why a message the channel accepted did not reach the customer (the `reason` of a `delivery_failed` step); closed words, one fixed sentence each
DELIVERY_TEXT: dict[str, str] = {
    "window_closed": "WhatsApp only allows an approved template after 24 hours of silence from the customer.",
    "unreachable": "WhatsApp could not deliver it to that number (not on WhatsApp, or an old version).",
    "not_delivered_health": "WhatsApp held it back to keep conversations healthy.",
    "rate_limited": "WhatsApp is limiting how fast this number can send.",
    "throughput": "WhatsApp is limiting how fast this number can send.",
    "spam_limited": "WhatsApp limited this number for too many messages that were not wanted.",
    "opted_out_marketing": "The customer stopped marketing messages on WhatsApp.",
    "unsupported_type": "The customer's WhatsApp cannot show this kind of message.",
    "media_error": "WhatsApp could not fetch the photo.",
    "template_params": "The template's words did not fit.",
    "template_missing": "WhatsApp does not know that template.",
    "template_paused": "WhatsApp paused that template.",
    "template_disabled": "WhatsApp disabled that template.",
    "token_expired": "The connection to WhatsApp has expired. The Owner must reconnect it.",
    "bad_request": "WhatsApp did not accept the message.",
    "other_error": "WhatsApp could not deliver it.",
}


REASON_TEXT: dict[str, str] = {
    "auto_allowed": "Allowed to go automatically.",
    "quiet_hours": "Waiting for the morning: this business sends no messages during its quiet hours (India time).",
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
    # up to 4 catalogue photos, by id, in order. The caption (`text`) is what the policy reads: a price or an amount in it makes the message wait for a person.
    photo_ids: Annotated[list[uuid.UUID], Field(max_length=4)] = []
    # when true the server logs the lead touch at the moment the message is really SENT (never when it is queued, never for a message that is blocked or fails)
    keep_record: StrictBool = False
    # the English gloss of `text` when it is written in another language (what the owner reads to understand it); personal data like the words, erased with them
    gloss_en: Text | None = None


class MediaOut(_Strict):
    """A photo the message carries. `thumb_url` is a signed URL that expires in minutes (null when it could not be made); fetch it again when it has."""

    photo_id: uuid.UUID
    position: int
    thumb_url: str | None


class EditMessageIn(_Strict):
    text: Text
    # the gloss of the NEW words; leaving it out clears the old gloss (it would describe other words)
    gloss_en: Text | None = None


EventKind = Literal[
    "made",
    "queued",
    "held",
    "needs_approval",
    "approved",
    "rejected",
    "edited",
    "blocked",
    "sent",
    "failed",
    # job BR: what the channel reports after a message was handed over
    "delivered",
    "read",
    "delivery_failed",
]
ActorKind = Literal["person", "assistant", "worker", "system"]


class ActorOut(_Strict):
    """Who did a step. `name` is the person's display name when they are in the business (null for the worker and the system, or someone since removed); never an e-mail address or phone number."""

    kind: ActorKind
    user_id: uuid.UUID | None
    name: str | None


class EventOut(_Strict):
    """One step of a message. NO message text, phone number or name of the customer is ever in an event: `reason` is a closed word (and `reason_text` its fixed sentence)."""

    kind: EventKind
    reason: str | None
    reason_text: str | None
    at: datetime
    actor: ActorOut


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
    failure_code: (
        Literal[
            "adapter_error",
            "timeout",
            "rejected",
            "window_closed",
            "template_required",
            "recipient_unreachable",
            "rate_limited",
            "not_configured",
        ]
        | None
    )
    keep_record: bool
    media: list[MediaOut]
    # the English gloss of `text`, or null
    gloss_en: str | None = None
    # the steps of the message in order (queued, held, approved, edited, sent ...). Present in the DETAIL (GET /outbox/messages/{id}); null in the log and the approvals list
    events: list[EventOut] | None = None


class DispatchOut(_Strict):
    """What a dispatch round did: messages handed to the channel and sent, handed over and failed. (Messages that were blocked at the re-check, held for quiet hours or held by the kill switch are
    not counted here: read them in the log.)"""

    sent: int
    failed: int
    # messages the channel was not given because its photos could not be given a signed address this time: they stay claimed for two minutes and are offered again (0 in the usual case)
    retry_later: int = 0
    # only on POST /outbox/dispatch (the Dispatch button): what is still waiting after the round. null elsewhere.
    still_due: int | None = None
    held_for_later: int | None = None
    platform_switch_on: bool | None = None


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
    # quiet hours, India time, whole hours: no message goes from `quiet_hours_start`:00 until `quiet_hours_end`:00 (default 21 and 9)
    quiet_hours_start: int = 21
    quiet_hours_end: int = 9


class OutboxSettingsIn(_Strict):
    auto_send_enabled: StrictBool
    per_customer_daily_limit: Annotated[int, Field(ge=1, le=20)]
    # optional: leave a field out to keep its value. The start may be 19 to 23, the end 7 to 10 (the Owner with a second factor, like every setting here).
    quiet_hours_start: Annotated[StrictInt, Field(ge=19, le=23)] | None = None
    quiet_hours_end: Annotated[StrictInt, Field(ge=7, le=10)] | None = None


class OutboxSummaryOut(_Strict):
    """The counts behind the tabs of the log (the same customer and date filters as the list) and what the Dispatch button would act on (not filtered)."""

    waiting: int
    scheduled: int
    sent: int
    blocked: int
    due_now: int
    held_for_later: int


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
