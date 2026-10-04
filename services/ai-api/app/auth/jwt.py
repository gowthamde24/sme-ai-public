"""Verification of Supabase Auth access tokens.

Rules (fail closed on every one):
- The algorithm must be in the configured allow-list. The token header never chooses it, so
  `alg=none` and algorithm-confusion tokens are rejected before any key is looked up.
- Asymmetric algorithms verify only against keys fetched from the JWKS endpoint; HS256 verifies
  only against the configured shared secret. A public key is never used as an HMAC secret.
- `exp`, `iat`, `iss`, `aud` and `sub` are required; issuer and audience must match exactly.
- The token must be an authenticated, non-anonymous user token with a UUID subject.
- Only identity is read from the token (the subject). Roles and tenants come from the database,
  never from claims, so revoking a membership takes effect immediately.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

import jwt
from jwt import PyJWKClient

from app.config import ASYMMETRIC_JWT_ALGORITHMS, AuthConfig

LEEWAY_SECONDS = 10


class AuthError(Exception):
    """Token rejected. The message is for server logs only; clients get a generic 401."""


@dataclass(frozen=True)
class Principal:
    """The authenticated caller. `token` is forwarded to PostgREST so RLS applies as this user."""

    user_id: uuid.UUID
    token: str = field(repr=False)


class KeyProvider(Protocol):
    """Source of verification keys. Behind an interface so tests (and other IdPs) can swap it."""

    def key_for(self, token: str, algorithm: str) -> Any: ...


class JwksKeyProvider:
    """Fetches (and caches) public keys from the Supabase Auth JWKS endpoint."""

    def __init__(self, jwks_url: str, *, timeout: int = 5, lifespan: int = 600) -> None:
        self._client = PyJWKClient(
            jwks_url, cache_keys=True, cache_jwk_set=True, lifespan=lifespan, timeout=timeout
        )

    def key_for(self, token: str, algorithm: str) -> Any:
        try:
            return self._client.get_signing_key_from_jwt(token).key
        except Exception as exc:  # network failure, unknown kid, malformed JWKS
            raise AuthError(f"no verification key: {exc.__class__.__name__}") from exc


class StaticKeyProvider:
    """Fixed key material (HS256 secret, or a pinned public key). Used for HS256 and in tests."""

    def __init__(self, key: Any) -> None:
        self._key = key

    def key_for(self, token: str, algorithm: str) -> Any:
        return self._key


class TokenVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        algorithms: tuple[str, ...],
        asymmetric_keys: KeyProvider | None,
        hs256_secret: str | None,
    ) -> None:
        if not algorithms:
            raise ValueError("at least one algorithm is required")
        self._issuer = issuer
        self._audience = audience
        self._algorithms = algorithms
        self._asymmetric_keys = asymmetric_keys
        self._hs256_secret = hs256_secret

    @classmethod
    def from_config(cls, config: AuthConfig) -> TokenVerifier:
        keys: KeyProvider | None = None
        if any(a in ASYMMETRIC_JWT_ALGORITHMS for a in config.algorithms):
            if config.jwks_url is None:  # build_auth_config guarantees this; fail closed anyway
                raise ValueError("JWKS URL missing for asymmetric algorithms")
            keys = JwksKeyProvider(config.jwks_url)
        return cls(
            issuer=config.issuer,
            audience=config.audience,
            algorithms=config.algorithms,
            asymmetric_keys=keys,
            hs256_secret=config.hs256_secret,
        )

    def verify(self, token: str) -> Principal:
        if not token or token.count(".") != 2:
            raise AuthError("malformed token")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise AuthError("unreadable header") from exc

        algorithm = header.get("alg")
        if not isinstance(algorithm, str) or algorithm not in self._algorithms:
            # Covers alg=none and any algorithm the deployment did not opt into.
            raise AuthError(f"algorithm not allowed: {algorithm!r}")

        key: Any
        if algorithm == "HS256":
            if not self._hs256_secret:
                raise AuthError("HS256 not configured")
            key = self._hs256_secret
        else:
            if self._asymmetric_keys is None:
                raise AuthError("asymmetric verification not configured")
            key = self._asymmetric_keys.key_for(token, algorithm)

        try:
            claims = jwt.decode(
                token,
                key=key,
                algorithms=[algorithm],
                audience=self._audience,
                issuer=self._issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise AuthError(f"invalid token: {exc.__class__.__name__}") from exc

        return _principal_from_claims(claims, token)


def _principal_from_claims(claims: dict[str, Any], token: str) -> Principal:
    # `aud` may be a list in general; jwt.decode already matched ours, but the *role* must be a
    # signed-in user: reject anon/service_role tokens and anonymous sign-ins.
    if claims.get("role") != "authenticated":
        raise AuthError("not an authenticated-user token")
    if claims.get("is_anonymous") is True:
        raise AuthError("anonymous users are not accepted")
    subject = claims.get("sub")
    if not isinstance(subject, str):
        raise AuthError("missing subject")
    try:
        user_id = uuid.UUID(subject)
    except ValueError as exc:
        raise AuthError("subject is not a uuid") from exc
    return Principal(user_id=user_id, token=token)
