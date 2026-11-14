"""The link's secrets, in Secret Manager ONLY (the workspace-secrets store, kind google_calendar, `sme-ws-<workspace>-google_calendar`): the refresh token and the push channel's token, one JSON value.

The database knows where the secret is and a fingerprint (an HMAC of the refresh token, to tell "the same grant again" without the token); never the value. Nothing here logs a value."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from app.workspace_secrets import SecretStore, SecretStoreError

KIND = "google_calendar"


@dataclass(frozen=True)
class LinkSecret:
    refresh_token: str
    channel_token: str

    def __repr__(self) -> str:
        return "LinkSecret(<redacted>)"


def secret_name(tenant_id: uuid.UUID) -> str:
    return f"sme-ws-{tenant_id}-{KIND}"


class Vault:
    def __init__(self, store: SecretStore, fingerprint_key: bytes, *, ttl_s: float = 120.0, clock: Callable[[], float] = time.monotonic) -> None:
        self._store = store
        self._fp_key = fingerprint_key
        self._ttl = ttl_s
        self._clock = clock
        self._seen: dict[str, tuple[float, LinkSecret | None]] = {}

    def __repr__(self) -> str:
        return "Vault(<store>)"

    def fingerprint(self, tenant_id: uuid.UUID, refresh_token: str) -> str:
        return hmac.new(self._fp_key, f"{tenant_id}:{KIND}:".encode() + refresh_token.encode("utf-8"), hashlib.sha256).hexdigest()[:16]

    def new_channel_token(self) -> str:
        return secrets.token_urlsafe(32)

    def put(self, name: str, secret: LinkSecret) -> None:
        self._store.put(name, json.dumps({"v": 1, "refresh_token": secret.refresh_token, "channel_token": secret.channel_token}, separators=(",", ":")))
        self._seen.pop(name, None)

    def get(self, name: str, *, cached: bool = False) -> LinkSecret | None:
        """The secret, or None when there is none (or it is not ours in shape). `cached`: the push door may use a copy up to `ttl_s` old (a notification burst reads Secret Manager once)."""
        now = self._clock()
        if cached:
            hit = self._seen.get(name)
            if hit is not None and now - hit[0] < self._ttl:
                return hit[1]
        raw = self._store.access(name)
        found: LinkSecret | None = None
        if raw:
            try:
                data = json.loads(raw)
                if isinstance(data, dict) and isinstance(data.get("refresh_token"), str) and isinstance(data.get("channel_token"), str) and data["refresh_token"]:
                    found = LinkSecret(data["refresh_token"], data["channel_token"])
            except ValueError:
                found = None
        self._seen[name] = (now, found)
        return found

    def delete(self, name: str) -> None:
        self._seen.pop(name, None)
        self._store.delete(name)


__all__ = ["KIND", "LinkSecret", "SecretStoreError", "Vault", "secret_name"]
