"""Test-only key material and token minting. Never used outside tests."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ISSUER = "https://project.supabase.example/auth/v1"
AUDIENCE = "authenticated"
HS_SECRET = "test-only-hs256-secret-with-more-than-32-chars"


def make_ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def public_pem(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def claims(sub: str | None = None, **overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    base: dict[str, Any] = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": sub if sub is not None else str(uuid.uuid4()),
        "role": "authenticated",
        "is_anonymous": False,
        "iat": now,
        "exp": now + 3600,
        # most tests are about something else: they hold a second-factor session unless told
        # otherwise (ADR 0016)
        "aal": "aal2",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def mint(key: Any, payload: dict[str, Any], algorithm: str = "ES256") -> str:
    return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": "test"})


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def forge_hs256_with_secret(secret: bytes, payload: dict[str, Any]) -> str:
    """Hand-built HS256 token (PyJWT refuses to HMAC with a PEM key, an attacker would not)."""
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(payload).encode())
    sig = hmac.new(secret, f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{b64(sig)}"


def forge_unsigned(payload: dict[str, Any]) -> str:
    header = b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    return f"{header}.{b64(json.dumps(payload).encode())}."
