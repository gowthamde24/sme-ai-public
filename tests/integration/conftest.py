"""Integration fixtures: a real local Supabase stack (GoTrue + PostgREST + Postgres).

Run with `make test-integration` (starts from `supabase start`). Only the public URL and anon key
are available here; there is no service-role key. Every user is created through the public signup
endpoint, exactly like a real client, and every request uses that user's own JWT.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@dataclass(frozen=True)
class User:
    label: str
    id: uuid.UUID
    token: str


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
    url, anon = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_ANON_KEY")
    if not url or not anon:
        pytest.exit(
            "SUPABASE_URL / SUPABASE_ANON_KEY not set. Run `supabase start`, then "
            "`make test-integration` (it wires the environment for you).",
            returncode=2,
        )
    return Stack(url=url.rstrip("/"), anon_key=anon)


@pytest.fixture(scope="session")
def signup(stack: Stack) -> Any:
    def _signup(label: str) -> User:
        email = f"{label}-{uuid.uuid4().hex[:10]}@it.example.test"
        response = httpx.post(
            f"{stack.url}/auth/v1/signup",
            headers={"apikey": stack.anon_key},
            json={"email": email, "password": uuid.uuid4().hex + "Aa1!"},
            timeout=15,
        )
        response.raise_for_status()
        body = response.json()
        return User(label=label, id=uuid.UUID(body["user"]["id"]), token=body["access_token"])

    return _signup


@pytest.fixture(scope="session")
def client(stack: Stack) -> Iterator[TestClient]:
    """The real application: real JWKS verification, real PostgREST repository."""
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def bearer(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {user.token}"}


def unique_slug(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"
