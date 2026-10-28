"""The id of a preview ("Here is what I understood", job EB part A): a SIGNED, expiring token, so no instance needs to remember it (Cloud Run may answer the save on another instance). It names the
workspace and the person; the words themselves come back from the screen (the owner edits them), so nothing is stored."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid

PREVIEW_SECONDS = 30 * 60


def _mac(key: bytes, body: bytes) -> str:
    return base64.urlsafe_b64encode(hmac.new(key, b"context-preview:" + body, hashlib.sha256).digest()).decode().rstrip("=")


def make(key: bytes, tenant_id: uuid.UUID, user_id: uuid.UUID, now: float | None = None) -> tuple[str, float]:
    expires = (now if now is not None else time.time()) + PREVIEW_SECONDS
    body = base64.urlsafe_b64encode(json.dumps({"t": str(tenant_id), "u": str(user_id), "e": int(expires)}, separators=(",", ":")).encode())
    return f"{body.decode().rstrip('=')}.{_mac(key, body)}", expires


def check(key: bytes, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, now: float | None = None) -> str:
    """'ok', 'expired' or 'invalid'."""
    try:
        raw, mac = token.split(".", 1)
        body = (raw + "=" * (-len(raw) % 4)).encode()
        if not hmac.compare_digest(mac, _mac(key, body)):
            return "invalid"
        data = json.loads(base64.urlsafe_b64decode(body))
    except (ValueError, TypeError):
        return "invalid"
    if data.get("t") != str(tenant_id) or data.get("u") != str(user_id):
        return "invalid"
    return "ok" if int(data.get("e", 0)) >= (now if now is not None else time.time()) else "expired"
