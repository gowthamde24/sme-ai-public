"""Integration fixtures: a real local Supabase stack (GoTrue + PostgREST + Postgres).

Run with `make test-integration` (starts from `supabase start`). Only the public URL and public keys
are available here; there is no service-role key. Every user is created through the public signup
endpoint, exactly like a real client, and every request uses that user's own JWT.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app


@dataclass(frozen=True)
class User:
    label: str
    id: uuid.UUID
    # The default token is a SECOND-FACTOR (aal2) session: most suites are about something else
    # (ADR 0016). `aal1_token` gives the password-only session of the same person.
    token: str
    email: str = ""
    password: str = field(default="", repr=False)
    totp_secret: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class Stack:
    url: str
    anon_key: str

    @property
    def rest(self) -> str:
        return f"{self.url}/rest/v1"

    def headers(self, token: str | None = None, **extra: str) -> dict[str, str]:
        return {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {token or self.anon_key}",
            "Content-Type": "application/json",
            **extra,
        }


@pytest.fixture(scope="session")
def stack() -> Stack:
    # The suite runs with the PUBLISHABLE key; the legacy anon key is the fallback.
    url = os.environ.get("SUPABASE_URL")
    anon = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not anon:
        pytest.exit(
            "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set. Run `supabase start`, then "
            "`make test-integration` (it wires the environment for you).",
            returncode=2,
        )
    return Stack(url=url.rstrip("/"), anon_key=anon)


def totp_code(secret_b32: str, offset_steps: int = 0) -> str:
    """RFC 6238 (SHA-1, 6 digits, 30 s). Written out so no dependency is needed."""
    key = base64.b32decode(secret_b32.upper() + "=" * (-len(secret_b32) % 8))
    counter = int(time.time() // 30) + offset_steps
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 10**6
    return f"{value:06d}"


def _auth(stack: Stack, token: str | None = None) -> dict[str, str]:
    return {"apikey": stack.anon_key, "Authorization": f"Bearer {token or stack.anon_key}"}


def password_token(stack: Stack, email: str, password: str) -> str:
    """A password-only session: aal1, whatever factors the person has."""
    r = httpx.post(
        f"{stack.url}/auth/v1/token?grant_type=password",
        headers=_auth(stack),
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    return str(r.json()["access_token"])


def enroll_totp(stack: Stack, token: str) -> tuple[str, str]:
    """(factor id, secret) of a new, UNVERIFIED TOTP factor for the person behind `token`."""
    r = httpx.post(
        f"{stack.url}/auth/v1/factors",
        headers=_auth(stack, token),
        json={"factor_type": "totp", "friendly_name": f"it-{uuid.uuid4().hex[:6]}"},
        timeout=15,
    )
    r.raise_for_status()
    body = r.json()
    return str(body["id"]), str(body["totp"]["secret"])


def challenge_verify(stack: Stack, token: str, factor_id: str, secret: str) -> httpx.Response:
    """Answer a TOTP challenge (a code works once per 30 s step: a second use moves on)."""
    last: httpx.Response | None = None
    for offset in (0, 1, -1):
        c = httpx.post(
            f"{stack.url}/auth/v1/factors/{factor_id}/challenge",
            headers=_auth(stack, token),
            json={},
            timeout=15,
        )
        c.raise_for_status()
        last = httpx.post(
            f"{stack.url}/auth/v1/factors/{factor_id}/verify",
            headers=_auth(stack, token),
            json={"challenge_id": c.json()["id"], "code": totp_code(secret, offset)},
            timeout=15,
        )
        if last.status_code == 200:
            return last
    assert last is not None
    return last


def aal2_token(stack: Stack, user: User) -> str:
    """A second-factor session: sign in with the password, then answer the challenge."""
    assert user.totp_secret, "this user has no authenticator"
    base = password_token(stack, user.email, user.password)
    factors = (
        httpx.get(f"{stack.url}/auth/v1/user", headers=_auth(stack, base), timeout=15)
        .json()
        .get("factors", [])
    )
    factor_id = next(f["id"] for f in factors if f.get("status") == "verified")
    r = challenge_verify(stack, base, factor_id, user.totp_secret)
    r.raise_for_status()
    return str(r.json()["access_token"])


@pytest.fixture(scope="session")
def signup(stack: Stack) -> Any:
    def _signup(label: str, *, mfa: bool = True) -> User:
        email = f"{label}-{uuid.uuid4().hex[:10]}@it.example.test"
        password = uuid.uuid4().hex + "Aa1!"
        response = httpx.post(
            f"{stack.url}/auth/v1/signup",
            headers={"apikey": stack.anon_key},
            json={"email": email, "password": password},
            timeout=15,
        )
        response.raise_for_status()
        body = response.json()
        token, secret = body["access_token"], None
        if mfa:
            factor_id, secret = enroll_totp(stack, token)
            verified = challenge_verify(stack, token, factor_id, secret)
            verified.raise_for_status()
            token = verified.json()["access_token"]
        return User(
            label=label,
            id=uuid.UUID(body["user"]["id"]),
            token=token,
            email=email,
            password=password,
            totp_secret=secret,
        )

    return _signup


def aal1_token(stack: Stack, user: User) -> str:
    return password_token(stack, user.email, user.password)


TEST_SUPPRESSION_KEY = "synthetic-integration-key-0123456789"  # not a secret


@pytest.fixture(scope="session")
def client(stack: Stack) -> Iterator[TestClient]:
    """The real application: real JWKS verification, real PostgREST repository."""
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        # T010 (ADR 0020): a synthetic key (not a secret): contacts made through this app are keyed
        suppression_hmac_key=SecretStr(TEST_SUPPRESSION_KEY),
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def bearer(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {user.token}"}


def unique_slug(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


@pytest.fixture(scope="module")
def eval_world(client: TestClient, stack: Stack, signup: Any) -> Any:
    """Two FRESH tenants (and users) for ONE eval module.

    The agent limits are per tenant and rolling: `max_writes_per_day` counts every write step of the
    tenant in the last 24 hours (500), the daily cost cap counts its spend of the UTC day. The
    session-wide `crm_world` below is shared by every suite of one pytest session, so an eval that
    used it passed or failed by TEST ORDER: CI runs the whole directory in one session, the T008
    tests had already written 500 steps on the shared tenant, and the research golden set ended
    `failed/budget` on the businesses that write (CI run 14). `make check` runs the evals in a
    session of their own and never saw it. Evals start from a tenant that has done nothing: use
    this fixture, never `crm_world` (tests/integration/test_eval_harness.py enforces it)."""
    from crm_support import World

    return World(client, stack, signup)


@pytest.fixture(scope="session")
def crm_world(client: TestClient, stack: Stack, signup: Any) -> Any:
    """Two tenants, seven users, one base row per entity: built once, shared by the CRM suites."""
    from crm_support import World

    return World(client, stack, signup)
