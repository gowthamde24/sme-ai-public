"""Meta's webhook, parsed (job BR). Pure functions: the signature check, the verification handshake and the reading of a notification into events. No I/O, nothing logged.

Documented behaviour (developers.facebook.com/documentation/business-messaging/whatsapp/webhooks, read 2026-10-12):
  * GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  -> compare the token, answer 200 with the challenge
  * POST body + header `X-Hub-Signature-256: sha256=<hex>`       -> HMAC-SHA256 of the body with the app secret; anything else is not Meta
  * answer 200 quickly; Meta retries a failure for days (and may batch up to 1,000 updates), so every event must be handled idempotently
  * shape: {object: "whatsapp_business_account", entry: [{id, changes: [{field: "messages", value: {metadata: {phone_number_id}, contacts: [{profile: {name}, wa_id}],
            messages: [{from, id, timestamp, type, text: {body}}], statuses: [{id, status, timestamp, recipient_id, biz_opaque_callback_data, errors: [{code}]}]}}]}]}

The signature is computed over the RAW body bytes, never over a parsed-and-rewritten body."""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

MAX_BODY_BYTES = 3 * 1024 * 1024  # Meta: payloads up to 3 MB
MAX_EVENTS = 1000  # Meta: up to 1,000 updates in one POST
TEXT_KINDS = {"text"}


def sign(body: bytes, secret: str) -> str:
    """The header value Meta would send: "sha256=<hex>"."""
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def signature_ok(body: bytes, header: str | None, secret: str | None) -> bool:
    if not secret or not header:
        return False
    return hmac.compare_digest(sign(body, secret), header.strip())


def verify_challenge(mode: str | None, token: str | None, challenge: str | None, expected: str | None) -> str | None:
    """The challenge to answer with, or None when this is not a valid verification (wrong mode, wrong token, no token configured). The challenge is an integer; anything else is refused."""
    if mode != "subscribe" or not expected or not token or challenge is None:
        return None
    if not hmac.compare_digest(token.encode(), expected.encode()):
        return None
    return challenge if challenge.isdigit() and len(challenge) <= 20 else None


@dataclass(frozen=True)
class Inbound:
    phone_number_id: str
    wamid: str
    sender: str = field(repr=False)  # digits with the country code
    name: str | None = field(repr=False)
    kind: str  # text, image, audio, video, document, location, button, interactive, sticker, contacts, unsupported
    text: str | None = field(repr=False)
    sent_at: datetime | None
    referral: dict[str, str] | None = field(default=None, repr=False)   # a Click-to-WhatsApp ad: {ad_id, headline, click_id} (the ad's own words, never the message)


@dataclass(frozen=True)
class Status:
    phone_number_id: str
    wamid: str
    status: str  # sent | delivered | read | failed
    at: datetime | None
    error_code: int | None
    callback: str | None


Event = Inbound | Status


def _when(raw: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(str(raw)), UTC)
    except (ValueError, OverflowError, OSError, TypeError):
        return None


def _text_of(message: dict[str, Any], kind: str) -> str | None:
    """What a person wrote, whichever way they wrote it: a text, a caption, a tapped button or list row."""
    if kind == "text":
        text = message.get("text")
        return text.get("body") if isinstance(text, dict) else None
    if kind == "button":
        button = message.get("button")
        return (button.get("text") or button.get("payload")) if isinstance(button, dict) else None
    if kind == "interactive":
        interactive = message.get("interactive")
        if isinstance(interactive, dict):
            for key in ("button_reply", "list_reply"):
                reply = interactive.get(key)
                if isinstance(reply, dict):
                    return reply.get("title") or reply.get("id")
        return None
    body = message.get(kind)
    return body.get("caption") if isinstance(body, dict) else None


def _referral(value: Any) -> dict[str, str] | None:
    """The ad a chat started from (WhatsApp Cloud API `referral`, source_type "ad"): only its id, headline and click id, in the shapes the database takes; anything else is not an ad."""
    if not isinstance(value, dict) or value.get("source_type") != "ad":
        return None
    out: dict[str, str] = {}
    for key, name, pattern in (("source_id", "ad_id", r"[A-Za-z0-9_.:-]{1,64}"), ("ctwa_clid", "click_id", r"[A-Za-z0-9_.:-]{1,200}")):
        got = value.get(key)
        if isinstance(got, str) and re.fullmatch(pattern, got):
            out[name] = got
    headline = value.get("headline")
    if isinstance(headline, str) and headline.strip():
        out["headline"] = " ".join(headline.split())[:120]
    return out or None


def parse(payload: Any) -> list[Event]:
    """Every message and status in a notification, in order. Malformed pieces are skipped, never raised: a bad entry must not stop the good ones (and must not make Meta retry for a week)."""
    events: list[Event] = []
    if not isinstance(payload, dict) or payload.get("object") != "whatsapp_business_account":
        return events
    for entry in payload.get("entry") or []:
        for change in (entry.get("changes") or []) if isinstance(entry, dict) else []:
            if not isinstance(change, dict) or change.get("field") != "messages" or not isinstance(change.get("value"), dict):
                continue
            value = change["value"]
            metadata = value.get("metadata")
            phone_number_id = metadata.get("phone_number_id") if isinstance(metadata, dict) else None
            if not isinstance(phone_number_id, str) or not phone_number_id:
                continue
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in value.get("contacts") or [] if isinstance(c, dict) and isinstance(c.get("profile"), dict)}
            for m in value.get("messages") or []:
                if not isinstance(m, dict) or not isinstance(m.get("id"), str) or not isinstance(m.get("from"), str):
                    continue
                kind = str(m.get("type") or "unsupported")
                if kind in ("reaction", "system", "request_welcome", "ephemeral"):
                    continue  # not a message to answer
                text = _text_of(m, kind)
                name = names.get(m["from"])
                events.append(Inbound(phone_number_id, m["id"], m["from"], name if isinstance(name, str) else None, kind, text if isinstance(text, str) else None, _when(m.get("timestamp")), _referral(m.get("referral"))))
            for s in value.get("statuses") or []:
                if not isinstance(s, dict) or not isinstance(s.get("id"), str) or s.get("status") not in ("sent", "delivered", "read", "failed"):
                    continue
                errors = s.get("errors")
                code = errors[0].get("code") if isinstance(errors, list) and errors and isinstance(errors[0], dict) else None
                callback = s.get("biz_opaque_callback_data")
                events.append(Status(phone_number_id, s["id"], s["status"], _when(s.get("timestamp")), code if isinstance(code, int) else None, callback if isinstance(callback, str) else None))
            if len(events) > MAX_EVENTS:
                return events[:MAX_EVENTS]
    return events
