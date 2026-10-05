"""Token verification. Every rejection path must fail closed; one test per attack."""

from __future__ import annotations

import time
import uuid
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.jwt import AuthError, StaticKeyProvider, TokenVerifier
from tests.keys import (
    AUDIENCE,
    HS_SECRET,
    ISSUER,
    claims,
    forge_hs256_with_secret,
    forge_unsigned,
    make_ec_key,
    mint,
    public_pem,
)

KEY = make_ec_key()


def verifier(
    algorithms: tuple[str, ...] = ("ES256",), hs_secret: str | None = None
) -> TokenVerifier:
    return TokenVerifier(
        issuer=ISSUER,
        audience=AUDIENCE,
        algorithms=algorithms,
        asymmetric_keys=StaticKeyProvider(KEY.public_key()),
        hs256_secret=hs_secret,
    )


def test_valid_token_yields_principal() -> None:
    sub = str(uuid.uuid4())
    token = mint(KEY, claims(sub))
    principal = verifier().verify(token)
    assert str(principal.user_id) == sub
    assert principal.token == token
    assert token not in repr(principal)  # the bearer token must never reach logs via repr


def test_expired_token_rejected() -> None:
    past = int(time.time()) - 3600
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, claims(iat=past - 60, exp=past)))


def test_wrong_audience_rejected() -> None:
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, claims(aud="anon")))


def test_wrong_issuer_rejected() -> None:
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, claims(iss="https://evil.example/auth/v1")))


def test_bad_signature_rejected() -> None:
    other = make_ec_key()
    with pytest.raises(AuthError):
        verifier().verify(mint(other, claims()))


def test_tampered_payload_rejected() -> None:
    header, payload, signature = mint(KEY, claims()).split(".")
    forged_payload = mint(KEY, claims()).split(".")[1]
    assert payload != forged_payload
    with pytest.raises(AuthError):
        verifier().verify(f"{header}.{forged_payload}.{signature}")


def test_alg_none_rejected() -> None:
    with pytest.raises(AuthError, match="algorithm not allowed"):
        verifier().verify(forge_unsigned(claims()))


def test_alg_none_rejected_even_if_signature_part_is_present() -> None:
    token = forge_unsigned(claims()) + "AAAA"
    with pytest.raises(AuthError):
        verifier().verify(token)


def test_hs256_signed_with_public_key_rejected_when_only_es256_allowed() -> None:
    """Classic HS/RS confusion: sign with the (public) verification key as an HMAC secret."""
    token = forge_hs256_with_secret(public_pem(KEY), claims())
    with pytest.raises(AuthError, match="algorithm not allowed"):
        verifier().verify(token)


def test_hs256_signed_with_public_key_rejected_even_when_hs256_is_enabled() -> None:
    """With HS256 enabled, the HMAC secret is the configured one, never the JWKS key."""
    token = forge_hs256_with_secret(public_pem(KEY), claims())
    with pytest.raises(AuthError, match="invalid token"):
        verifier(("ES256", "HS256"), hs_secret=HS_SECRET).verify(token)


def test_rs256_header_rejected_when_only_es256_allowed() -> None:
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(claims(), rsa_key, algorithm="RS256")
    with pytest.raises(AuthError, match="algorithm not allowed"):
        verifier().verify(token)


def test_hs256_token_rejected_when_hs256_not_enabled() -> None:
    token = forge_hs256_with_secret(HS_SECRET.encode(), claims())
    with pytest.raises(AuthError, match="algorithm not allowed"):
        verifier(hs_secret=HS_SECRET).verify(token)


def test_hs256_accepted_only_with_the_configured_secret() -> None:
    legacy = verifier(("HS256",), hs_secret=HS_SECRET)
    assert legacy.verify(forge_hs256_with_secret(HS_SECRET.encode(), claims()))
    with pytest.raises(AuthError):
        legacy.verify(forge_hs256_with_secret(b"some-other-secret-0123456789abcdef", claims()))


def test_es256_token_rejected_by_hs256_only_deployment() -> None:
    with pytest.raises(AuthError, match="algorithm not allowed"):
        verifier(("HS256",), hs_secret=HS_SECRET).verify(mint(KEY, claims()))


def test_missing_sub_rejected() -> None:
    payload = claims()
    del payload["sub"]
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, payload))


@pytest.mark.parametrize("missing", ["exp", "iat", "iss", "aud"])
def test_other_required_claims_rejected_when_absent(missing: str) -> None:
    payload = claims()
    del payload[missing]
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, payload))


def test_non_uuid_subject_rejected() -> None:
    with pytest.raises(AuthError, match="uuid"):
        verifier().verify(mint(KEY, claims(sub="not-a-uuid")))


@pytest.mark.parametrize("role", ["anon", "service_role", "postgres", None])
def test_non_user_roles_rejected(role: str | None) -> None:
    """A service-role or anon token must never authenticate a user."""
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, claims(role=role)))


def test_anonymous_sign_in_rejected() -> None:
    with pytest.raises(AuthError, match="anonymous"):
        verifier().verify(mint(KEY, claims(is_anonymous=True)))


def test_not_yet_valid_token_rejected() -> None:
    with pytest.raises(AuthError):
        verifier().verify(mint(KEY, claims(nbf=int(time.time()) + 3600)))


@pytest.mark.parametrize("token", ["", "abc", "a.b", "a.b.c.d", "a.b.c.d.e", "...", " . . "])
def test_malformed_tokens_rejected(token: str) -> None:
    with pytest.raises(AuthError):
        verifier().verify(token)


def test_key_lookup_failure_rejected() -> None:
    class Broken:
        def key_for(self, token: str, algorithm: str) -> object:
            raise AuthError("no verification key: ConnectionError")

    v = TokenVerifier(
        issuer=ISSUER,
        audience=AUDIENCE,
        algorithms=("ES256",),
        asymmetric_keys=Broken(),
        hs256_secret=None,
    )
    with pytest.raises(AuthError):
        v.verify(mint(KEY, claims()))


# ---- the assurance level (ADR 0016)
@pytest.mark.parametrize(
    ("claim", "expected"),
    [
        ("aal2", "aal2"),
        ("aal1", "aal1"),
        (None, "aal1"),
        ("AAL2", "aal1"),
        ("aal3", "aal1"),
        ("", "aal1"),
        (2, "aal1"),
    ],
)
def test_the_assurance_level_is_read_from_the_signed_claim_and_defaults_to_aal1(
    claim: Any, expected: str
) -> None:
    token = mint(KEY, claims(str(uuid.uuid4()), aal=claim))
    assert verifier().verify(token).aal == expected
