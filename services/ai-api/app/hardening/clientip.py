"""Who is calling, for rate limits and logs (job CB, ADR 0082). Behind a proxy the socket's address is the proxy's, so the real caller is read from X-Forwarded-For, but only as far as the configured number of
trusted proxy hops goes (TRUSTED_PROXY_HOPS): the Nth address from the RIGHT is the one the Nth proxy saw. A client can write anything at the left of that header, so with hops = 0 (the default) the header is
ignored. The address is used as a key and a short hash of it is logged; it is never stored."""

from __future__ import annotations

import hashlib
import ipaddress
from collections.abc import Mapping
from typing import Any


def client_ip(scope: Mapping[str, Any], hops: int) -> str:
    client = scope.get("client")
    peer = str(client[0]) if client else "unknown"
    if hops <= 0:
        return peer
    values: list[str] = []
    for name, value in scope.get("headers", []):
        if name == b"x-forwarded-for":
            values += [part.strip() for part in value.decode("latin-1").split(",") if part.strip()]
    if len(values) < hops:
        return peer
    candidate = values[-hops]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return peer


def short_hash(text: str) -> str:
    """Eight hex characters: enough to tell one caller from another in a log line, not enough to find the address again."""
    return hashlib.sha256(text.encode()).hexdigest()[:8]
