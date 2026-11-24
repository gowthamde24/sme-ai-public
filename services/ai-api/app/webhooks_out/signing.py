"""Signing a webhook body (docs/contracts/webhooks-out.md section 3). `Stack19-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`; the HMAC is over `"<t>.<raw body>"` with the endpoint's secret.
The receiver recomputes it, compares in constant time and refuses a `t` older than five minutes. `verify` is what a receiver does (the tests and the contract's samples use it)."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import string

TOLERANCE_S = 300
_ALPHABET = string.ascii_letters + string.digits
_HEADER = re.compile(r"^t=(\d{1,12}),v1=([0-9a-f]{64})$")


def new_secret() -> str:
    """`whsec_` and 32 random letters and digits. Shown to the Owner once; never stored in the database, never logged."""
    return "whsec_" + "".join(secrets.choice(_ALPHABET) for _ in range(32))


def last4(secret: str) -> str:
    return secret[-4:]


def signature(secret: str, timestamp: int, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("ascii") + body, hashlib.sha256).hexdigest()


def header(secret: str, timestamp: int, body: bytes) -> str:
    return f"t={timestamp},v1={signature(secret, timestamp, body)}"


def verify(secret: str, header_value: str, body: bytes, now: int, tolerance_s: int = TOLERANCE_S) -> bool:
    """The receiver's check: well-formed, recent (either way), and the same HMAC (constant time)."""
    found = _HEADER.fullmatch(header_value or "")
    if found is None:
        return False
    timestamp = int(found.group(1))
    if abs(now - timestamp) > tolerance_s:
        return False
    return hmac.compare_digest(found.group(2), signature(secret, timestamp, body))
