"""How a phone code reaches the person. A port, so the channel (WhatsApp, a voice call, SMS) is one decision and one class; none is chosen yet."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Protocol


class PhoneCodeUnavailable(Exception):
    """No sender is configured, or it failed: the person is told to try again later."""


class PhoneCodeSender(Protocol):
    def send(self, phone_e164: str, code: str) -> None: ...


class NoSender:
    """The default: nothing can send a code, so a sign-up cannot pass the phone step."""

    def send(self, phone_e164: str, code: str) -> None:
        raise PhoneCodeUnavailable()


class FakeSender:
    """Staging and tests: remembers the last code per phone in memory (never logged, never stored). With `echo` the route returns it to the caller (refused in production at start-up)."""

    def __init__(self, *, echo: bool = False) -> None:
        self.echo = echo
        self.last: dict[str, str] = {}

    def send(self, phone_e164: str, code: str) -> None:
        self.last[phone_e164] = code
