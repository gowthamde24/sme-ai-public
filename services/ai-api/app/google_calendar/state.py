"""The OAuth `state`: {tenant, member, nonce, expiry} signed with HMAC-SHA256, good for 10 minutes; the nonce is used up ONCE in the database (scheduler_gcal_state_use).

The PKCE code_verifier is not stored anywhere: it is an HMAC of the nonce under the same key, so only this API can make it again at the callback (43 characters of URL-safe base64, RFC 7636)."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass

TTL_S = 600


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass(frozen=True)
class OAuthState:
    tenant_id: uuid.UUID
    member_id: uuid.UUID
    nonce: uuid.UUID
    expires: int


class StateSigner:
    def __init__(self, key: bytes, *, clock: object = time.time) -> None:
        if len(key) < 16:
            raise ValueError("the state key is too short")
        self._key = hashlib.sha256(b"stack19-gcal-state-v1|" + key).digest()
        self._clock = clock

    def __repr__(self) -> str:
        return "StateSigner(<key>)"

    def _now(self) -> float:
        return float(self._clock())  # type: ignore[operator]

    def sign(self, tenant_id: uuid.UUID, member_id: uuid.UUID, nonce: uuid.UUID) -> str:
        body = _b64(json.dumps({"t": str(tenant_id), "m": str(member_id), "n": str(nonce), "e": int(self._now()) + TTL_S}, separators=(",", ":")).encode())
        mac = _b64(hmac.new(self._key, body.encode("ascii"), hashlib.sha256).digest())
        return f"{body}.{mac}"

    def verify(self, state: str) -> OAuthState | None:
        """The state if it is ours, intact and not expired; None for anything else (one answer for every failure)."""
        if not isinstance(state, str) or len(state) > 400 or state.count(".") != 1:
            return None
        body, mac = state.split(".")
        want = _b64(hmac.new(self._key, body.encode("ascii", "replace"), hashlib.sha256).digest())
        if not hmac.compare_digest(want, mac):
            return None
        try:
            raw = json.loads(_unb64(body))
            parsed = OAuthState(uuid.UUID(raw["t"]), uuid.UUID(raw["m"]), uuid.UUID(raw["n"]), int(raw["e"]))
        except (ValueError, KeyError, TypeError):
            return None
        return parsed if parsed.expires > self._now() else None

    def code_verifier(self, nonce: uuid.UUID) -> str:
        return _b64(hmac.new(self._key, b"pkce|" + str(nonce).encode(), hashlib.sha256).digest())


def code_challenge(verifier: str) -> str:
    return _b64(hashlib.sha256(verifier.encode("ascii")).digest())
