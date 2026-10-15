"""The channel adapter port (job AT). A message leaves the system ONLY through an adapter, and the only adapter that exists is a LOCAL FAKE: it opens no socket, sends nothing to anyone and
keeps what it was asked to send in memory so a developer (or a test) can look at it. A real WhatsApp adapter is a later job behind this same interface (non-negotiable 9) and needs the
owner's written approval first (ADR 0017); until then `OUTBOX_ADAPTER` accepts only `fake`.

The adapter never sees a tenant, a token or a lead: only what it must deliver. The phone number and the text are never logged by this module.

IDEMPOTENCY (job BB). Delivery is at-least-once: if the database cannot be told that a message was sent (the worker dies, the network drops), the claim lapses and the same message is offered
again, WITH THE SAME `message_id`. A real adapter must therefore send that id to the provider as its idempotency key (`OutgoingMessage.idempotency_key`), and for each photo of a message
`media_key(position)` (the message id and the photo's place, "<id>:1" ...), so a repeat of the same message creates no second message at the provider. The fake keeps every
attempt, so a test can see the repeat and its identical key."""

from __future__ import annotations

import hashlib
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class MediaRef:
    """A photo the message carries, BY REFERENCE (job AY): where it is stored and what it is. A real channel fetches it through a short-lived signed URL; the bytes are never in the outbox."""

    photo_id: uuid.UUID
    bucket: str
    path: str
    content_type: str
    # a signed URL the provider can fetch the image from, valid for minutes (CHANNEL_URL_SECONDS); never logged. None only for a message with no photos or in tests.
    url: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class TemplateRef:
    """An APPROVED message template the database named for this message (job BR): the guard is in the database, the adapter only uses what it is handed."""

    name: str
    language: str
    body: str = field(repr=False)


@dataclass(frozen=True)
class SendContext:
    """What the database tells a real channel about one claimed message (job BR): which number to send from, whose secret holds its token, whether the customer's 24-hour window is open, the approved template (if any)."""

    phone_number_id: str
    token_ref: str
    window_open: bool
    template: TemplateRef | None = None
    coexistence: bool = False


@dataclass(frozen=True)
class AudioClip:
    """A spoken copy of the message (job CV, ADR 0088): made at send time from the text the Owner approved (preceded by the spoken AI disclosure), held in memory for this one send, never stored,
    never logged. A channel that can carry audio sends it IN ADDITION to the text; one that cannot (or the customer's 24-hour window is closed) leaves it out and the text still goes."""

    audio: bytes = field(repr=False)
    content_type: str
    seconds: int


@dataclass(frozen=True)
class OutgoingMessage:
    message_id: uuid.UUID
    to_phone: str = field(repr=False)
    body: str = field(repr=False)
    language: str
    media: tuple[MediaRef, ...] = ()
    attempts: int = 1
    wa: SendContext | None = None
    audio: AudioClip | None = None

    @property
    def idempotency_key(self) -> str:
        """What a real provider is given as its idempotency key for the message: the message id, which is the same on every attempt."""
        return str(self.message_id)

    def media_key(self, position: int) -> str:
        """The idempotency key of one photo (1-based position in the message)."""
        return f"{self.message_id}:{position}"

    @property
    def audio_key(self) -> str:
        """The idempotency key of the voice note of the message."""
        return f"{self.message_id}:audio"


@dataclass(frozen=True)
class SendResult:
    ok: bool
    adapter_message_id: str | None = None
    # adapter_error | timeout | rejected | window_closed | template_required | recipient_unreachable | rate_limited | not_configured
    failure_code: str | None = None
    # a transient trouble (the provider is busy or unreachable): the message is not marked failed, it is offered again when its claim lapses, up to MAX_SEND_ATTEMPTS times
    retry: bool = False


class ChannelAdapter(Protocol):
    name: str

    def send(self, message: OutgoingMessage) -> SendResult: ...


class LocalFakeAdapter:
    """Delivers to a list in this process. `fail` maps a message id to the failure code to return for it (a test's way to make the channel misbehave)."""

    name = "fake"

    def __init__(self, fail: dict[uuid.UUID, str] | None = None) -> None:
        self._lock = threading.Lock()
        self._fail = dict(fail or {})
        self.sent: list[OutgoingMessage] = []

    def fail_next(self, message_id: uuid.UUID, code: str = "adapter_error") -> None:
        with self._lock:
            self._fail[message_id] = code

    def send(self, message: OutgoingMessage) -> SendResult:
        with self._lock:
            code = self._fail.pop(message.message_id, None)
            if code is not None:
                return SendResult(False, None, code)
            # every attempt is kept (a test can see that a lapsed claim offered the same message id again); a real provider would collapse them by `idempotency_key`
            self.sent.append(message)
        digest = hashlib.sha256(message.message_id.bytes).hexdigest()[:16]
        return SendResult(True, f"fake-{digest}", None)


def build_adapter(name: str, settings: Any = None) -> ChannelAdapter:
    """The adapter named by OUTBOX_ADAPTER: `fake` (the default) or `whatsapp` (job BR; needs the WHATSAPP_* settings and the owner's written approval, ADR 0017). Anything else stops the process
    at start rather than silently sending nowhere or somewhere."""
    if name == "fake":
        return LocalFakeAdapter()
    if name == "whatsapp":
        from app.whatsapp.factory import build_whatsapp_adapter

        return build_whatsapp_adapter(settings)
    raise ValueError("OUTBOX_ADAPTER must be 'fake' or 'whatsapp'")
