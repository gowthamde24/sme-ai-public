"""The channel adapter port (job AT). A message leaves the system ONLY through an adapter, and the only adapter that exists is a LOCAL FAKE: it opens no socket, sends nothing to anyone and
keeps what it was asked to send in memory so a developer (or a test) can look at it. A real WhatsApp adapter is a later job behind this same interface (non-negotiable 9) and needs the
owner's written approval first (ADR 0017); until then `OUTBOX_ADAPTER` accepts only `fake`.

The adapter never sees a tenant, a token or a lead: only what it must deliver. The phone number and the text are never logged by this module."""

from __future__ import annotations

import hashlib
import threading
import uuid
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class OutgoingMessage:
    message_id: uuid.UUID
    to_phone: str = field(repr=False)
    body: str = field(repr=False)
    language: str


@dataclass(frozen=True)
class SendResult:
    ok: bool
    adapter_message_id: str | None = None
    failure_code: str | None = None  # adapter_error | timeout | rejected


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
            self.sent.append(message)
        digest = hashlib.sha256(message.message_id.bytes).hexdigest()[:16]
        return SendResult(True, f"fake-{digest}", None)


def build_adapter(name: str) -> ChannelAdapter:
    """The adapter named by OUTBOX_ADAPTER. Only `fake` exists: anything else stops the process at start rather than silently sending nowhere or somewhere."""
    if name == "fake":
        return LocalFakeAdapter()
    raise ValueError("OUTBOX_ADAPTER must be 'fake': no real channel exists yet")
