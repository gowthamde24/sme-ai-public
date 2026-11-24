"""How a phone code reaches the person. A port, so the channel (WhatsApp, a voice call, SMS) is one decision and one class; none is chosen yet."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any, Protocol


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


class WhatsAppCodeSender:
    """The code as a WhatsApp AUTHENTICATION template from Stack19's own number (Meta category "Authentication": the body carries the code, the one-tap button copies it).

    Needs the platform's own WhatsApp number id, a token that may send from it and an approved template name (owner steps in docs/runbooks/signup-opening.md). The code and the number are never logged."""

    def __init__(self, graph: Any, phone_number_id: str, token: str, template: str, language: str = "en") -> None:
        self._graph = graph
        self._number_id = phone_number_id
        self._token = token
        self._template = template
        self._language = language

    def send(self, phone_e164: str, code: str) -> None:
        payload = {
            "messaging_product": "whatsapp",
            "to": phone_e164.lstrip("+"),
            "type": "template",
            "template": {
                "name": self._template,
                "language": {"code": self._language},
                "components": [
                    {"type": "body", "parameters": [{"type": "text", "text": code}]},
                    {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": code}]},
                ],
            },
        }
        result = self._graph.post_message(self._number_id, self._token, payload)
        if not result.ok:
            raise PhoneCodeUnavailable()
