"""The browser's side of web-push, for the tests (job BY): decrypts an RFC 8291 `aes128gcm` body with the subscription's private key and auth secret. Written from the RFC independently of
`app.notifications.webpush.encrypt`; the unit tests also pin that function to the RFC's own worked example."""

from __future__ import annotations

import hashlib
import hmac
import struct

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def decrypt_push(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret: bytes) -> bytes:
    salt, record_size, id_len = body[:16], struct.unpack(">I", body[16:20])[0], body[20]
    as_public, ciphertext = body[21 : 21 + id_len], body[21 + id_len :]
    assert record_size == 4096 and id_len == 65
    ua_public = ua_private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    prk_key = hmac.new(auth_secret, shared, hashlib.sha256).digest()
    ikm = hmac.new(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01", hashlib.sha256).digest()
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = hmac.new(prk, b"Content-Encoding: aes128gcm\x00\x01", hashlib.sha256).digest()[:16]
    nonce = hmac.new(prk, b"Content-Encoding: nonce\x00\x01", hashlib.sha256).digest()[:12]
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert plain.endswith(b"\x02")
    return plain[:-1]
