"""The PostgREST adapter for the reads: the caller's JWT and the anon key only, the three rpc names, and classified failures (never data-layer text)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from app.tenancy.repository import Forbidden, TokenRejected, UpstreamError
from app.today.repository import PostgrestTodayRepository

TENANT = uuid.UUID(int=2)
TOKEN = "user.jwt.token"


def repo_with(handler: Any) -> tuple[PostgrestTodayRepository, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result: httpx.Response = handler(request)
        return result

    client = httpx.Client(
        base_url="http://postgrest.test/rest/v1", transport=httpx.MockTransport(recording)
    )
    return PostgrestTodayRepository(
        "http://postgrest.test/rest/v1", "anon-key", client=client
    ), seen


@pytest.mark.parametrize(
    ("method", "rpc"),
    [
        ("today_summary", "today_summary"),
        ("agents_status", "agents_status"),
        ("ai_usage", "ai_usage_today"),
        ("ai_usage_percent", "ai_usage"),
        ("paused_until", "ai_paused_until"),
    ],
)
def test_each_read_is_one_rpc_with_the_callers_token_and_only_the_tenant(
    method: str, rpc: str
) -> None:
    repo, seen = repo_with(lambda r: httpx.Response(200, json={"ok": True}))
    assert getattr(repo, method)(TOKEN, TENANT) == {"ok": True}
    request = seen[0]
    assert request.method == "POST" and request.url.path.endswith(f"/rpc/{rpc}")
    assert json.loads(request.content) == {"p_tenant_id": str(TENANT)}
    assert (
        request.headers["authorization"] == f"Bearer {TOKEN}"
        and request.headers["apikey"] == "anon-key"
    )
    assert len(seen) == 1


@pytest.mark.parametrize(
    ("status", "code", "expected"), [(403, "42501", Forbidden), (401, "PGRST303", TokenRejected)]
)
def test_refusals_are_classified_by_sqlstate_only(
    status: int, code: str, expected: type[Exception]
) -> None:
    repo, _ = repo_with(
        lambda r: httpx.Response(
            status, json={"code": code, "message": "secret text 10.1.2.3", "details": "x"}
        )
    )
    with pytest.raises(expected) as caught:
        repo.today_summary(TOKEN, TENANT)
    assert "secret" not in str(caught.value) and "10.1.2.3" not in str(caught.value)


def test_an_unreachable_or_non_json_data_layer_is_an_upstream_error_without_its_text() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom at 10.0.0.9")

    repo, _ = repo_with(down)
    with pytest.raises(UpstreamError) as caught:
        repo.agents_status(TOKEN, TENANT)
    assert "10.0.0.9" not in str(caught.value) and caught.value.__cause__ is None
    repo2, _ = repo_with(lambda r: httpx.Response(200, content=b"<html>"))
    with pytest.raises(UpstreamError):
        repo2.ai_usage(TOKEN, TENANT)
