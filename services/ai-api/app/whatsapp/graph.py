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

    def _call(self, method: str, path: str, token: str | None, params: dict[str, Any] | None = None) -> GraphResult:
        url = f"{self._base}/{self._version}/{path}"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            response = self._client.request(method, url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("whatsapp unreachable: %s", exc.__class__.__name__)
            return GraphResult(False, 0, transient=True)
        try:
            body = response.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        code = _error_of(body).get("code")
        return GraphResult(response.is_success, response.status_code, error_code=code if isinstance(code, int) else None, transient=response.status_code == 429 or response.status_code >= 500, body=body)

    def phone_details(self, phone_number_id: str, token: str) -> GraphResult:
        """The number's display form and verified name: proof that OUR token can reach this number (Embedded Signup granted it). `body` carries display_phone_number and verified_name."""
        return self._call("GET", phone_number_id, token, {"fields": "display_phone_number,verified_name,quality_rating"})

    def subscribe_app(self, waba_id: str, token: str) -> GraphResult:
        """Subscribe OUR app to this account's webhooks (messages and statuses)."""
        return self._call("POST", f"{waba_id}/subscribed_apps", token)

    def unsubscribe_app(self, waba_id: str, token: str) -> GraphResult:
        return self._call("DELETE", f"{waba_id}/subscribed_apps", token)

    def exchange_code(self, app_id: str, app_secret: str, code: str) -> GraphResult:
        """The short code Embedded Signup returned to the browser, exchanged for a business token: proof that the signup was made in OUR app. The token itself is not kept."""
        return self._call("GET", "oauth/access_token", None, {"client_id": app_id, "client_secret": app_secret, "code": code})

    def list_templates(self, waba_id: str, token: str) -> list[dict[str, Any]] | None:
        """The templates of a WhatsApp Business Account with Meta's decision on each: [{name, language, status, rejected_reason}]. None when Meta did not answer (the caller keeps what it has)."""
        out: list[dict[str, Any]] = []
        url: str | None = f"{self._base}/{self._version}/{waba_id}/message_templates"
        params: dict[str, Any] | None = {"fields": "name,language,status,rejected_reason", "limit": 100}
        for _ in range(10):   # at most ten pages of 100
            if url is None:
                break
            try:
                response = self._client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
            except httpx.HTTPError as exc:
                logger.error("whatsapp unreachable: %s", exc.__class__.__name__)
                return None
            if not response.is_success:
                logger.warning("whatsapp template list refused: http=%s", response.status_code)
                return None
            try:
                body = response.json()
            except ValueError:
                return None
            for item in body.get("data") or [] if isinstance(body, dict) else []:
                if isinstance(item, dict) and isinstance(item.get("name"), str) and isinstance(item.get("language"), str) and isinstance(item.get("status"), str):
                    out.append({"name": item["name"], "language": item["language"], "status": item["status"], "rejected_reason": item.get("rejected_reason")})
            nxt = (body.get("paging") or {}).get("next") if isinstance(body, dict) and isinstance(body.get("paging"), dict) else None
            url, params = (nxt if isinstance(nxt, str) and nxt.startswith(self._base) else None), None
        return out
