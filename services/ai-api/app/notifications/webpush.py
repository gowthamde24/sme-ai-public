"""Web push, built on the standards and on the library PyJWT already requires (`cryptography`); no new dependency (job BY, ADR 0077).

  * RFC 8291 "Message Encryption for Web Push" with the `aes128gcm` content coding (RFC 8188): ECDH on P-256 between a fresh key of ours and the browser's key, HKDF with the browser's auth secret, AES-128-GCM.
  * RFC 8292 VAPID: an ES256 JWT {aud: the push service's origin, exp, sub: a contact} and our public key, in `Authorization: vapid t=<jwt>, k=<public key>`.
Pure functions plus one small sender. The VAPID private key comes from the environment only (VAPID_PRIVATE_KEY) and is never in a repr, a log line or an answer. `encrypt` takes the ephemeral key and the salt as
arguments ONLY so that the test can reproduce RFC 8291's own worked example byte for byte; the sender always draws fresh ones."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import struct
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("app.notifications.webpush")

RECORD_SIZE = 4096
MAX_PLAINTEXT = RECORD_SIZE - 86  # RFC 8291 section 4: 4096 minus the header (16 + 4 + 1 + 65) and the padding delimiter and tag


def b64d(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def b64e(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    out = b""
    block = b""
    counter = 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def _public_bytes(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def encrypt(plaintext: bytes, ua_public: bytes, auth_secret: bytes, *, as_private: ec.EllipticCurvePrivateKey | None = None, salt: bytes | None = None) -> bytes:
    """The body of a push request for one browser: salt(16) || record size(4) || key id length(1) || our public key(65) || ciphertext."""
    if len(plaintext) > MAX_PLAINTEXT or len(ua_public) != 65 or ua_public[0] != 4 or len(auth_secret) != 16:
        raise ValueError("not a valid push payload or subscription")
    as_private = as_private or ec.generate_private_key(ec.SECP256R1())
    salt = salt if salt is not None else os.urandom(16)
    as_public = _public_bytes(as_private)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = as_private.exchange(ec.ECDH(), ua_key)
    prk_key = hmac.new(auth_secret, shared, hashlib.sha256).digest()
    ikm = _hkdf_expand(prk_key, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)  # 0x02: the padding delimiter of the last (only) record
    return salt + struct.pack(">IB", RECORD_SIZE, len(as_public)) + as_public + ciphertext


@dataclass(frozen=True)
class VapidKeys:
    private: ec.EllipticCurvePrivateKey = field(repr=False)
    subject: str

    @property
    def public_b64(self) -> str:
        return b64e(_public_bytes(self.private))

    @staticmethod
    def parse(private: str, subject: str, public: str | None = None) -> VapidKeys:
        """`private`: the 32-byte key in URL-safe base64 (what the usual generators print) or a PEM. `subject`: a mailto: or https: contact. If `public` is given it must be the key's public half."""
        if not (subject.startswith("mailto:") or subject.startswith("https://")):
            raise ValueError("VAPID_SUBJECT must be a mailto: or https: address")
        if "BEGIN" in private:
            loaded = serialization.load_pem_private_key(private.encode(), password=None)
            if not isinstance(loaded, ec.EllipticCurvePrivateKey) or loaded.curve.name != "secp256r1":
                raise ValueError("VAPID_PRIVATE_KEY must be a P-256 key")
            key = loaded
        else:
            raw = b64d(private.strip())
            if len(raw) != 32:
                raise ValueError("VAPID_PRIVATE_KEY must be 32 bytes in URL-safe base64, or a PEM")
            key = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1())
        keys = VapidKeys(key, subject)
        if public and public.strip() != keys.public_b64:
            raise ValueError("VAPID_PUBLIC_KEY is not the public half of VAPID_PRIVATE_KEY")
        return keys

    def authorization(self, endpoint: str, *, now: float | None = None) -> str:
        parts = urlsplit(endpoint)
        audience = f"{parts.scheme}://{parts.netloc}"
        issued = int(now if now is not None else time.time())
        token = jwt.encode({"aud": audience, "exp": issued + 12 * 3600, "sub": self.subject}, self.private, algorithm="ES256")
        return f"vapid t={token}, k={self.public_b64}"


@dataclass(frozen=True)
class Subscription:
    id: str
    endpoint: str = field(repr=False)
    p256dh: str = field(repr=False)
    auth: str = field(repr=False)


@dataclass(frozen=True)
class PushResult:
    outcome: str  # ok | gone | failed
    status: int


class WebPushSender:
    def __init__(self, vapid: VapidKeys, *, client: httpx.Client | None = None, ttl: int = 3600) -> None:
        self._vapid = vapid
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))
        self._ttl = ttl

    def send(self, subscription: Subscription, payload: bytes, *, urgency: str = "normal") -> PushResult:
        try:
            body = encrypt(payload, b64d(subscription.p256dh), b64d(subscription.auth))
        except ValueError:
            return PushResult("failed", 0)
        headers = {
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(self._ttl),
            "Urgency": urgency,
            "Authorization": self._vapid.authorization(subscription.endpoint),
        }
        try:
            response = self._client.post(subscription.endpoint, content=body, headers=headers)
        except httpx.HTTPError as exc:
            logger.warning("push unreachable: %s", exc.__class__.__name__)
            return PushResult("failed", 0)
        if response.status_code in (404, 410):
            return PushResult("gone", response.status_code)  # the browser forgot the subscription
        if 200 <= response.status_code < 300:
            return PushResult("ok", response.status_code)
        logger.warning("push refused: http=%s", response.status_code)
        return PushResult("failed", response.status_code)
