"""A provider-neutral SMS port.

India's SMS rules (DLT: a registered sender id and an approved template per message kind) make the gateway a decision for later; this port is what the rest of the code calls, so choosing one is one
new class that implements `send` and one more value of SMS_PROVIDER. Until then: `off` (nothing can send; a caller gets `SmsUnavailable`) and `fake` (keeps the message in memory; nothing leaves the process).

A message carries the DLT `template` name the gateway will need; the fake ignores it. A phone number and a message text are never logged here."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
MAX_TEXT = 480   # three SMS parts: more is a mistake, not a message


class SmsUnavailable(Exception):
    """No gateway is configured, or it failed: the caller says "try again later"."""


@dataclass(frozen=True)
class SmsMessage:
    to: str                      # E.164, e.g. +919876543210
    text: str
    template: str = ""           # the gateway's approved template (DLT) this text is an instance of
    idempotency_key: str = ""    # the same key twice sends once, where the gateway supports it

    def __post_init__(self) -> None:
        if not E164.match(self.to):
            raise ValueError("the number must be in international form (+91...)")
        if not self.text.strip() or len(self.text) > MAX_TEXT:
            raise ValueError("the text must be 1 to 480 characters")


class SmsSender(Protocol):
    name: str

    def send(self, message: SmsMessage) -> None: ...


class NoSms:
    name = "off"

    def send(self, message: SmsMessage) -> None:
        raise SmsUnavailable()


class FakeSms:
    """Local and tests: remembers every message in memory (newest last), sends nothing."""

    name = "fake"

    def __init__(self) -> None:
        self.sent: list[SmsMessage] = []
        self._keys: set[str] = set()
        self.fail_next = False

    def send(self, message: SmsMessage) -> None:
        if self.fail_next:
            self.fail_next = False
            raise SmsUnavailable()
        if message.idempotency_key:
            if message.idempotency_key in self._keys:
                return
            self._keys.add(message.idempotency_key)
        self.sent.append(message)

    def last_to(self, number: str) -> SmsMessage | None:
        return next((m for m in reversed(self.sent) if m.to == number), None)


def build_sms_sender(provider: str) -> SmsSender:
    if provider == "off":
        return NoSms()
    if provider == "fake":
        return FakeSms()
    raise ValueError("SMS_PROVIDER must be off or fake (no real gateway is built yet)")


class SmsCodeSender:
    """The signup phone code through SMS (SIGNUP_PHONE_SENDER=sms): the same `send(phone, code)` the WhatsApp sender has."""

    TEMPLATE = "signup_code"

    def __init__(self, sms: SmsSender) -> None:
        self._sms = sms

    def send(self, phone_e164: str, code: str) -> None:
        from app.signup.sender import PhoneCodeUnavailable

        try:
            self._sms.send(SmsMessage(to=phone_e164, text=f"{code} is your Stack19 code. It works for 10 minutes. Do not share it.", template=self.TEMPLATE))
        except (SmsUnavailable, ValueError):
            raise PhoneCodeUnavailable() from None
