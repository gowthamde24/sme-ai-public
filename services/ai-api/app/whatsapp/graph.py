"""The door to Meta's WhatsApp Cloud API (Graph API), behind one small class so the adapter and the tests can use a fake server or an in-process fake. Documented behaviour used here (read 2026-10-12):

  POST {base}/{version}/{phone_number_id}/messages     JSON {messaging_product: "whatsapp", recipient_type: "individual", to, type: text|template|image, <type>: {...}, biz_opaque_callback_data?}
     answer: {messaging_product, contacts: [{input, wa_id}], messages: [{id: "wamid..."}]}   ("accepted", not "delivered": delivery comes by webhook)
  POST {base}/{version}/{waba_id}/message_templates     create a template (name, category, language, components)
  Authorization: Bearer <business token>.  There is NO documented idempotency key for sends: duplicates are avoided by our own claim and by `biz_opaque_callback_data` (see ADR 0076).

Nothing here logs a phone number, a text, a token or a provider message: only status codes and error codes."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("app.whatsapp.graph")


@dataclass(frozen=True)
class GraphResult:
    ok: bool
    status: int  # the HTTP status, 0 when nothing came back
    wamid: str | None = None
    error_code: int | None = None  # Meta's error.code
    detail: str | None = field(default=None, repr=False)  # never logged; kept for a person who asks
    transient: bool = False  # worth trying again (network trouble, 429, 5xx)
    body: dict[str, Any] = field(default_factory=dict, repr=False)


def _error_of(body: dict[str, Any]) -> dict[str, Any]:
    error = body.get("error")
    return error if isinstance(error, dict) else {}


class GraphClient:
    def __init__(self, base_url: str, version: str, *, client: httpx.Client | None = None) -> None:
        self._base = base_url.rstrip("/")
        self._version = version.strip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def _post(self, path: str, token: str, payload: dict[str, Any]) -> GraphResult:
        url = f"{self._base}/{self._version}/{path}"
        try:
            response = self._client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            logger.error("whatsapp unreachable: %s", exc.__class__.__name__)
            return GraphResult(False, 0, transient=True)
        try:
            body = response.json()
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        if response.is_success:
            messages = body.get("messages")
            wamid = messages[0].get("id") if isinstance(messages, list) and messages and isinstance(messages[0], dict) else None
            if isinstance(wamid, str) and wamid:
                return GraphResult(True, response.status_code, wamid=wamid, body=body)
            logger.error("whatsapp answered without a message id: http=%s", response.status_code)
            return GraphResult(False, response.status_code, body=body)
        error = _error_of(body)
        code = error.get("code")
        data = error.get("error_data")
        details = data.get("details") if isinstance(data, dict) else None
        logger.warning("whatsapp refused: http=%s code=%s", response.status_code, code if isinstance(code, int) else "-")
        return GraphResult(
            False,
            response.status_code,
            error_code=code if isinstance(code, int) else None,
            detail=details if isinstance(details, str) else None,
            transient=response.status_code == 429 or response.status_code >= 500,
            body=body,
        )

    def post_message(self, phone_number_id: str, token: str, payload: dict[str, Any]) -> GraphResult:
        return self._post(f"{phone_number_id}/messages", token, payload)

    def upload_media(self, phone_number_id: str, token: str, content: bytes, content_type: str) -> GraphResult:
        """Job CV: upload a voice note to Meta (multipart: messaging_product, type, file); a success carries the media id in `body["id"]` (there is no wamid here, so `ok` is judged on the HTTP status)."""
        url = f"{self._base}/{self._version}/{phone_number_id}/media"
        try:
            response = self._client.post(
                url,
                data={"messaging_product": "whatsapp", "type": content_type},
                files={"file": ("voice-note.ogg" if content_type.startswith("audio/ogg") else "voice-note", content, content_type)},
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            logger.error("whatsapp unreachable: %s", exc.__class__.__name__)
            return GraphResult(False, 0, transient=True)
        try:
            body = response.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        code = _error_of(body).get("code")
        return GraphResult(response.is_success and isinstance(body.get("id"), str), response.status_code, error_code=code if isinstance(code, int) else None, transient=response.status_code == 429 or response.status_code >= 500, body=body)

    def create_template(self, waba_id: str, token: str, payload: dict[str, Any]) -> GraphResult:
        """Ask Meta to review a template. A success carries Meta's template id in `body["id"]` (there is no wamid here, so `ok` is judged on the HTTP status)."""
        url = f"{self._base}/{self._version}/{waba_id}/message_templates"
        try:
            response = self._client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            logger.error("whatsapp unreachable: %s", exc.__class__.__name__)
            return GraphResult(False, 0, transient=True)
        try:
            body = response.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        code = _error_of(body).get("code")
        return GraphResult(response.is_success, response.status_code, error_code=code if isinstance(code, int) else None, transient=response.status_code >= 500, body=body)
