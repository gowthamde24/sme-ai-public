"""Shared pieces for the Main agent's tests on the real stack (job AG): an application with agents on, the operator's local switch, a server-sent-events reader."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import json
from collections.abc import Callable, Iterator
from typing import Any

import operator_sql
import pytest
from conftest import Stack
from fastapi.testclient import TestClient

from app.agents.llm.interface import LlmClient
from app.agents.llm.routing import ModelRouter
from app.config import Settings
from app.main import build_runtime, create_app


def assistant_app(
    stack: Stack, factory: Callable[[], LlmClient | ModelRouter] | None = None
) -> Iterator[TestClient]:
    """The real application with agents on (the stand-in model of development unless a scripted `factory` is given)."""
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        agents_enabled=True,
        llm_provider="fake",
    )
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.agents is not None
    if factory is not None:
        runtime = dataclasses.replace(
            runtime, agents=dataclasses.replace(runtime.agents, assistant_llm=factory)
        )
    with TestClient(create_app(settings, runtime=runtime)) as client:
        yield client


def enable_assistant(tenants: list[Any]) -> dict[str, Any]:
    """The operator turns the assistant on for these workspaces (all three switches) and lifts the start rate; returns what to restore."""
    saved: dict[str, Any] = {
        "flags": json.loads(
            operator_sql.sql("select json_object_agg(key, enabled) from public.platform_flags")
        ),
        "allowed": json.loads(
            operator_sql.sql(
                "select to_json(allowed_tenants) from public.agent_definitions where agent_name = 'assistant'"
            )
        ),
        "rate": operator_sql.sql(
            "select limit_value from public.agent_limits where limit_key = 'max_runs_per_hour'"
        ),
        "concurrent": operator_sql.sql(
            "select limit_value from public.agent_limits where limit_key = 'max_concurrent_runs'"
        ),
        "settings": json.loads(
            operator_sql.sql(
                "select coalesce(json_agg(row_to_json(s)), '[]') from public.tenant_agent_settings s"
            )
        ),
    }
    operator_sql.sql(
        "update public.agent_limits set limit_value = 100000 where limit_key in ('max_runs_per_hour', 'max_concurrent_runs')"
    )
    for tenant in tenants:
        slug = operator_sql.sql(f"select slug from public.tenants where id = '{tenant.id}'")
        operator_sql.sql(f"select app.operator_enable_assistant('{slug}')")
    return saved


def restore(saved: dict[str, Any]) -> None:
    for key, enabled in saved["flags"].items():
        operator_sql.sql(
            f"update public.platform_flags set enabled = {'true' if enabled else 'false'} where key = '{key}'"
        )
    allowed = ",".join(f"'{a}'" for a in saved["allowed"] or [])
    operator_sql.sql(
        f"update public.agent_definitions set allowed_tenants = array[{allowed}]::uuid[] where agent_name = 'assistant'"
    )
    operator_sql.sql(
        f"update public.agent_limits set limit_value = {int(saved['rate'])} where limit_key = 'max_runs_per_hour'"
    )
    operator_sql.sql(
        f"update public.agent_limits set limit_value = {int(saved['concurrent'])} where limit_key = 'max_concurrent_runs'"
    )


def events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    """Parse a server-sent-events body into (event, data) pairs."""
    out: list[tuple[str, dict[str, Any]]] = []
    for block in response.text.split("\n\n"):
        if not block.strip():
            continue
        name, data = "", ""
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = line[6:]
        out.append((name, json.loads(data)))
    return out


def text_of(evts: list[tuple[str, dict[str, Any]]]) -> str:
    return "".join(d["delta"] for e, d in evts if e == "text")


def sources_of(evts: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    return [d for e, d in evts if e == "source"]


def drafts_of(evts: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    return [d for e, d in evts if e == "draft"]


def conversation_of(evts: list[tuple[str, dict[str, Any]]]) -> str:
    """The chat's id, from the closing `done` event."""
    return str(next(d["conversation_id"] for e, d in evts if e == "done"))


@pytest.fixture
def anything() -> None:  # keeps pytest from treating this module as empty
    return None
