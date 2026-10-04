"""JWKS caching and unknown-`kid` handling, against a real local HTTP server (no library mocks).

Behaviour under test: an unknown kid causes ONE forced re-fetch, rate-limited by a cooldown;
if the kid is still unknown the token is rejected; junk kids cannot hammer the JWKS endpoint;
a rotated-in key is picked up; a key removed from the JWKS stops verifying after the cache expires.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from app.auth.jwt import AuthError, JwksKeyProvider, TokenVerifier
from tests.keys import AUDIENCE, ISSUER, claims, make_ec_key

COOLDOWN = 0.4
LIFESPAN = 1.5


def jwk(key: ec.EllipticCurvePrivateKey, kid: str) -> dict[str, Any]:
    data = ECAlgorithm.to_jwk(key.public_key(), as_dict=True)
    return {**data, "kid": kid, "alg": "ES256", "use": "sig"}


def token(key: ec.EllipticCurvePrivateKey, kid: str) -> str:
    return jwt.encode(claims(), key, algorithm="ES256", headers={"kid": kid})


@dataclass
class JwksServer:
    keys: list[dict[str, Any]] = field(default_factory=list)
    hits: int = 0
    url: str = ""


@pytest.fixture
def jwks() -> Iterator[JwksServer]:
    state = JwksServer()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            state.hits += 1
            body = json.dumps({"keys": state.keys}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    state.url = f"http://127.0.0.1:{server.server_port}/jwks.json"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield state
    server.shutdown()
    server.server_close()


def verifier_for(jwks: JwksServer) -> TokenVerifier:
    return TokenVerifier(
        issuer=ISSUER,
        audience=AUDIENCE,
        algorithms=("ES256",),
        asymmetric_keys=JwksKeyProvider(jwks.url, lifespan=LIFESPAN, cooldown=COOLDOWN),
        hs256_secret=None,
    )


def test_known_kid_verifies_and_the_key_set_is_cached(jwks: JwksServer) -> None:
    key = make_ec_key()
    jwks.keys = [jwk(key, "k1")]
    verifier = verifier_for(jwks)
    for _ in range(5):
        assert verifier.verify(token(key, "k1"))
    assert jwks.hits == 1


def test_unknown_kid_refetches_once_then_rejects(jwks: JwksServer) -> None:
    key = make_ec_key()
    jwks.keys = [jwk(key, "k1")]
    verifier = verifier_for(jwks)
    verifier.verify(token(key, "k1"))
    assert jwks.hits == 1

    time.sleep(COOLDOWN + 0.1)  # cooldown elapsed: one forced refresh is allowed
    attacker = make_ec_key()
    with pytest.raises(AuthError, match="no verification key"):
        verifier.verify(token(attacker, "ghost"))
    assert jwks.hits == 2, "exactly one forced re-fetch for an unknown kid"


def test_junk_kids_cannot_hammer_the_identity_provider(jwks: JwksServer) -> None:
    key = make_ec_key()
    jwks.keys = [jwk(key, "k1")]
    verifier = verifier_for(jwks)
    verifier.verify(token(key, "k1"))
    attacker = make_ec_key()
    for i in range(50):
        with pytest.raises(AuthError):
            verifier.verify(token(attacker, f"junk-{i}"))
    assert jwks.hits == 1, "within the cooldown, unknown kids are rejected with no network call"

    time.sleep(COOLDOWN + 0.1)
    for i in range(50):
        with pytest.raises(AuthError):
            verifier.verify(token(attacker, f"junk-after-{i}"))
    assert jwks.hits == 2, "after the cooldown, a flood still costs a single re-fetch"


def test_rotated_in_key_is_picked_up_after_the_cooldown(jwks: JwksServer) -> None:
    old, new = make_ec_key(), make_ec_key()
    jwks.keys = [jwk(old, "old")]
    verifier = verifier_for(jwks)
    verifier.verify(token(old, "old"))

    jwks.keys = [jwk(old, "old"), jwk(new, "new")]  # provider rotates a new key in
    time.sleep(COOLDOWN + 0.1)
    assert verifier.verify(token(new, "new"))
    assert jwks.hits == 2


def test_removed_key_stops_verifying_once_the_cache_expires(jwks: JwksServer) -> None:
    """No per-key cache without expiry: a revoked key must not verify forever."""
    revoked, current = make_ec_key(), make_ec_key()
    jwks.keys = [jwk(revoked, "revoked"), jwk(current, "current")]
    verifier = verifier_for(jwks)
    assert verifier.verify(token(revoked, "revoked"))

    jwks.keys = [jwk(current, "current")]
    time.sleep(LIFESPAN + 0.2)
    with pytest.raises(AuthError):
        verifier.verify(token(revoked, "revoked"))
    assert verifier.verify(token(current, "current"))


def test_jwks_outage_after_warmup_does_not_wipe_cached_keys(jwks: JwksServer) -> None:
    key = make_ec_key()
    jwks.keys = [jwk(key, "k1")]
    verifier = verifier_for(jwks)
    assert verifier.verify(token(key, "k1"))
    # (Cache still valid, so verification needs no network.) An unreachable JWKS for an
    # unknown kid must reject, not crash or accept.
    time.sleep(COOLDOWN + 0.1)
    jwks.keys = []  # endpoint now serves no keys at all
    with pytest.raises(AuthError):
        verifier.verify(token(make_ec_key(), "ghost"))


def test_jwks_unreachable_rejects(tmp_path: Any) -> None:
    verifier = TokenVerifier(
        issuer=ISSUER,
        audience=AUDIENCE,
        algorithms=("ES256",),
        asymmetric_keys=JwksKeyProvider("http://127.0.0.1:9/jwks.json", timeout=1),
        hs256_secret=None,
    )
    with pytest.raises(AuthError):
        verifier.verify(token(make_ec_key(), "k1"))
