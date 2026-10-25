"""The door to the channel for a marks message (job DP part 2). Only the FAKE exists: it sends nothing, keeps nothing and only counts. A real sender is a later, separate job (a WhatsApp template per kind and
language, approved by Meta); it will implement this same interface and will be given the guardian's contact id and the finished text, nothing else."""

from __future__ import annotations

import uuid
from typing import Protocol


class SendRefused(Exception):
    """The channel refused this message (a number that is not on WhatsApp, a template that is not approved)."""


class SendUnreachable(Exception):
    """The channel could not be reached; the message was not sent."""


class GuardianSender(Protocol):
    def send(self, tenant_id: uuid.UUID, contact_id: uuid.UUID, template_id: str, text: str) -> None:
        """Send one message or raise SendRefused / SendUnreachable."""
        ...


class FakeGuardianSender:
    """Sends nothing. It keeps no text: only how many messages it was asked to send (and, in tests, which contacts and template ids, never the words)."""

    def __init__(self) -> None:
        self.sent = 0
        self.calls: list[tuple[uuid.UUID, str]] = []

    def send(self, tenant_id: uuid.UUID, contact_id: uuid.UUID, template_id: str, text: str) -> None:
        self.sent += 1
        self.calls.append((contact_id, template_id))
