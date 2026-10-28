"""(k) Web call widget: the business puts a button on its own website and a visitor talks to the assistant. This is the SESSION part: a short-lived signed token the embedded script gets for one visitor, the
rules for what a session may do, and a fake media channel. The embeddable script is apps/web/public/widget.js; real audio (WebRTC to the voice stack) is not built. Pure."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

TTL_SECONDS = 600
MAX_SESSION_SECONDS = 300


def make_session(secret: str, workspace_id: str, origin: str, *, now: int | None = None) -> str:
    """A token for ONE visitor of ONE website (the origin is inside it): `<payload>.<mac>`."""
    payload = json.dumps({"w": workspace_id, "o": origin, "e": (now if now is not None else int(time.time())) + TTL_SECONDS}, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return f"{body}.{hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()}"


def read_session(secret: str, token: str, origin: str, *, now: int | None = None) -> str | None:
    """The workspace id when the token is genuine, unexpired and was made for THIS website; else None."""
    try:
        body, mac = token.split(".", 1)
        if not hmac.compare_digest(hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest(), mac):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    if data.get("o") != origin or data.get("e", 0) < (now if now is not None else int(time.time())):
        return None
    return str(data["w"])


class FakeMedia:
    """Until real audio exists the widget gets this: it answers with the greeting text and records nothing."""

    def greeting(self, text: str) -> dict[str, str]:
        return {"mode": "fake", "text": text}
