"""Builders of Meta-shaped webhook notifications and send answers, for the local fake server and the tests (job BR). They follow the documented shapes in webhook.py's header."""

from __future__ import annotations

import json
from typing import Any


def _envelope(phone_number_id: str, value: dict[str, Any]) -> dict[str, Any]:
    value = {"messaging_product": "whatsapp", "metadata": {"display_phone_number": "15550000000", "phone_number_id": phone_number_id}, **value}
    return {"object": "whatsapp_business_account", "entry": [{"id": "100000000000001", "changes": [{"field": "messages", "value": value}]}]}


def inbound(phone_number_id: str, sender: str, wamid: str, *, text: str | None = "hello", kind: str = "text", name: str | None = "Test Customer", timestamp: int = 1_760_000_000) -> dict[str, Any]:
    message: dict[str, Any] = {"from": sender, "id": wamid, "timestamp": str(timestamp), "type": kind}
    if kind == "text":
        message["text"] = {"body": text}
    elif kind in ("image", "video", "document", "audio"):
        message[kind] = {"id": "media-1", "mime_type": "image/jpeg", **({"caption": text} if text else {})}
    elif kind == "button":
        message["button"] = {"text": text, "payload": text}
    elif kind == "interactive":
        message["interactive"] = {"type": "button_reply", "button_reply": {"id": "b1", "title": text}}
    value: dict[str, Any] = {"messages": [message]}
    if name is not None:
        value["contacts"] = [{"profile": {"name": name}, "wa_id": sender}]
    return _envelope(phone_number_id, value)


def status(phone_number_id: str, wamid: str, state: str, recipient: str = "919876543210", *, error_code: int | None = None, callback: str | None = None, timestamp: int = 1_760_000_100) -> dict[str, Any]:
    item: dict[str, Any] = {"id": wamid, "status": state, "timestamp": str(timestamp), "recipient_id": recipient}
    if error_code is not None:
        item["errors"] = [{"code": error_code, "title": "failed", "message": "failed", "error_data": {"details": "details"}, "href": "/documentation/business-messaging/whatsapp/support/error-codes"}]
    if callback is not None:
        item["biz_opaque_callback_data"] = callback
    return _envelope(phone_number_id, {"statuses": [item]})


def raw(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
