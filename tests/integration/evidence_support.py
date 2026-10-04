"""Shared helpers for the evidence integration suites."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import jsonschema
from conftest import Stack, User

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "packages/contracts/evidence.schema.json").read_text()
)

SALES_PLUS = {"owner", "admin", "sales"}
ADMIN_PLUS = {"owner", "admin"}

CANARY_URL = "https://canary-host-qq77.example/in/jane-canary?token=canary-qq77"
CANARY_SNIPPET = "Jane Canary Qq77 said something personal"
CANARY_WORDS = ("canary", "qq77")


def uid() -> str:
    return str(uuid.uuid4())


def check_schema(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


def body(**over: Any) -> dict[str, Any]:
    return {
        "id": uid(),
        "kind": "web_page",
        "url": "https://example.test/it",
        "snippet": "integration snippet",
        **over,
    }


def pg(
    stack: Stack,
    user: User | None,
    method: str,
    path: str,
    *,
    json: Any = None,
    representation: bool = True,
) -> httpx.Response:
    """A direct PostgREST call, skipping our API (the data layer must refuse by itself)."""
    extra = {"Prefer": "return=representation" if representation else "return=minimal"}
    return httpx.request(
        method,
        f"{stack.rest}{path}",
        headers=stack.headers(user.token if user else None, **extra),
        json=json,
        timeout=20,
    )


def code_of(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return ""
    return str(payload.get("code", "")) if isinstance(payload, dict) else ""


def denied(response: httpx.Response) -> bool:
    """Refused by privilege / RLS (401 / 403 + 42501), or a filtered write that touched nothing."""
    if response.status_code in (401, 403):
        return code_of(response) == "42501"
    return response.status_code == 200 and response.json() == []
