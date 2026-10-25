"""A stand-in for Meta's Graph API, for tests and for local runs (job BR). Same paths, same payload rules and the same refusals as the documented API, WITHOUT a network, an account or a cost:

  POST /{version}/{phone_number_id}/messages        text / image / template, bearer token required; a text or an image outside the customer's 24-hour window is refused with code 131047 (as
                                                    Meta does); a template that was not registered as approved is refused with 132001; every ATTEMPT is kept, because Meta does not
                                                    deduplicate (there is no idempotency key), so a test can see a repeated send
  POST /{version}/{waba_id}/message_templates       a template for review: answers {id, status: "PENDING", category}

`fail(to, status, code)` queues a refusal for the next send to that number (a test's way to make "Meta" misbehave). `transport()` is an httpx transport for an in-process client; the server script
`scripts/fake_whatsapp_server.py` puts the same object behind a local HTTP port. It is test code: it validates what a real call would be rejected for, not everything Meta checks."""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

_MESSAGES = re.compile(r"^/(?P<version>v[0-9.]+)/(?P<id>[0-9]+)/messages$")
_MEDIA = re.compile(r"^/(?P<version>v[0-9.]+)/(?P<id>[0-9]+)/media$")
_TEMPLATES = re.compile(r"^/(?P<version>v[0-9.]+)/(?P<id>[0-9]+)/message_templates$")


def _error(status: int, code: int, message: str) -> tuple[int, dict[str, Any]]:
    return status, {"error": {"message": message, "type": "OAuthException", "code": code, "error_data": {"messaging_product": "whatsapp", "details": message}, "fbtrace_id": "FAKE"}}


class FakeGraph:
    def __init__(self, tokens: set[str] | None = None, *, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self.tokens = tokens or {"fake-token"}
        self._clock = clock
        self._lock = threading.Lock()
        self.sent: list[dict[str, Any]] = []  # every accepted attempt: {phone_number_id, to, type, payload, wamid}
        self.refused: list[dict[str, Any]] = []
        self.templates_created: list[dict[str, Any]] = []
        self.media_uploaded: list[dict[str, Any]] = []  # {phone_number_id, content_type, size, id}: the bytes themselves are not kept
        self.approved_templates: set[tuple[str, str]] = set()
        self._last_inbound: dict[str, datetime] = {}
        self._fail: dict[str, list[tuple[int, int]]] = {}
        self._counter = 0

    # ---- the test's controls
    def inbound_from(self, number: str, at: datetime | None = None) -> None:
        """The customer wrote to us: their 24-hour window opens (or is renewed)."""
        with self._lock:
            self._last_inbound[self._digits(number)] = at or self._clock()

    def approve_template(self, name: str, language: str) -> None:
        self.approved_templates.add((name, language))

    def fail(self, to: str, status: int, code: int, times: int = 1) -> None:
        with self._lock:
            self._fail.setdefault(self._digits(to), []).extend([(status, code)] * times)

    @staticmethod
    def _digits(number: str) -> str:
        return "".join(ch for ch in number if ch.isdigit())

    # ---- the API
    def handle(self, method: str, path: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, Any]]:
        auth = headers.get("authorization", "")
        if not auth.startswith("Bearer ") or auth[7:] not in self.tokens:
            return _error(401, 190, "Invalid OAuth access token.")
        if method != "POST":
            return _error(405, 100, "Unsupported request.")
        media = _MEDIA.match(path)
        if media:
            return self._media(media.group("id"), headers, body)
        try:
            payload = json.loads(body)
        except ValueError:
            return _error(400, 100, "Invalid JSON.")
        if not isinstance(payload, dict):
            return _error(400, 100, "Invalid JSON.")
        found = _MESSAGES.match(path)
        if found:
            return self._message(found.group("id"), payload)
        found = _TEMPLATES.match(path)
        if found:
            return self._template(payload)
        return _error(404, 100, "Unknown path.")

    def _message(self, phone_number_id: str, p: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if p.get("messaging_product") != "whatsapp":
            return _error(400, 100, "messaging_product is required.")
        to = p.get("to")
        if not isinstance(to, str) or not re.fullmatch(r"\+?[0-9]{8,15}", to):
            return _error(400, 100, "Invalid parameter: to.")
        kind = p.get("type")
        if kind == "text":
            text = p.get("text")
            if not isinstance(text, dict) or not isinstance(text.get("body"), str) or not text["body"] or len(text["body"]) > 4096:
                return _error(400, 100, "Invalid parameter: text.body.")
        elif kind == "image":
            image = p.get("image")
            if not isinstance(image, dict) or not (isinstance(image.get("link"), str) and image["link"].startswith(("http://", "https://")) or isinstance(image.get("id"), str)):
                return _error(400, 100, "Invalid parameter: image.")
            if isinstance(image.get("caption"), str) and len(image["caption"]) > 1024:
                return _error(400, 100, "Invalid parameter: image.caption.")
        elif kind == "audio":
            audio = p.get("audio")
            if not isinstance(audio, dict) or not isinstance(audio.get("id"), str) or audio["id"] not in {m["id"] for m in self.media_uploaded}:
                return _error(400, 100, "Invalid parameter: audio.")
        elif kind == "template":
            template = p.get("template")
            if not isinstance(template, dict) or not isinstance(template.get("name"), str) or not isinstance(template.get("language"), dict) or not isinstance(template["language"].get("code"), str):
                return _error(400, 100, "Invalid parameter: template.")
            for component in template.get("components") or []:
                for parameter in component.get("parameters") or []:
                    text = parameter.get("text", "")
                    if parameter.get("type") == "text" and (not text or "\n" in text or "\t" in text or "    " in text):
                        return _error(400, 132000, "Number of parameters does not match the expected number of params.")
            if (template["name"], template["language"]["code"]) not in self.approved_templates:
                return _error(404, 132001, "Template name does not exist in the translation.")
        else:
            return _error(400, 100, "Unsupported message type.")
        digits = self._digits(to)
        with self._lock:
            queued = self._fail.get(digits)
            if queued:
                status, code = queued.pop(0)
                self.refused.append({"phone_number_id": phone_number_id, "to": digits, "type": kind, "code": code})
                return _error(status, code, "Refused by the fake.")
            if kind != "template":
                last = self._last_inbound.get(digits)
                if last is None or self._clock() - last > timedelta(hours=24):
                    self.refused.append({"phone_number_id": phone_number_id, "to": digits, "type": kind, "code": 131047})
                    return _error(400, 131047, "Re-engagement message: more than 24 hours have passed since the customer last replied.")
            self._counter += 1
            wamid = f"wamid.FAKE{self._counter:06d}"
            self.sent.append({"phone_number_id": phone_number_id, "to": digits, "type": kind, "payload": p, "wamid": wamid})
        return 200, {"messaging_product": "whatsapp", "contacts": [{"input": to, "wa_id": digits}], "messages": [{"id": wamid}]}

    def _media(self, phone_number_id: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, Any]]:
        """A multipart upload: accepted when it names messaging_product whatsapp and carries a file of an audio type WhatsApp takes; only its size and type are kept."""
        content_type = headers.get("content-type", "")
        if not content_type.startswith("multipart/form-data") or b'name="messaging_product"' not in body or b"whatsapp" not in body or b'name="file"' not in body:
            return _error(400, 100, "Invalid media upload.")
        found = re.search(rb'name="file".*?Content-Type: ([a-z/+.;= -]+)\r\n\r\n', body, re.S)
        kind = found.group(1).decode() if found else ""
        if kind not in ("audio/ogg; codecs=opus", "audio/ogg", "audio/mpeg", "audio/aac", "audio/mp4", "audio/amr"):
            return _error(400, 131053, "Media upload error: unsupported type.")
        with self._lock:
            self._counter += 1
            media_id = f"media.FAKE{self._counter:06d}"
            self.media_uploaded.append({"phone_number_id": phone_number_id, "content_type": kind, "size": len(body), "id": media_id})
        return 200, {"id": media_id}

    def _template(self, p: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if not isinstance(p.get("name"), str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,59}", p["name"]) or p.get("category") not in ("UTILITY", "MARKETING", "AUTHENTICATION") or not isinstance(p.get("language"), str):
            return _error(400, 100, "Invalid parameter.")
        components = p.get("components")
        if not isinstance(components, list) or not any(c.get("type") == "BODY" and isinstance(c.get("text"), str) for c in components if isinstance(c, dict)):
            return _error(400, 100, "A body component is required.")
        with self._lock:
            self.templates_created.append(p)
            number = len(self.templates_created)
        return 200, {"id": f"90000000000{number}", "status": "PENDING", "category": p["category"]}

    # ---- an httpx transport so a GraphClient can be pointed at this object without a socket
    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            status, body = self.handle(request.method, request.url.path, {k.lower(): v for k, v in request.headers.items()}, request.content)
            return httpx.Response(status, json=body)

        return httpx.MockTransport(handler)
