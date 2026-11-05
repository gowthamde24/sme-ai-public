"""The assistant does the work, only in the workspaces that have it (ASSISTANT_WORK_TENANTS; owner, 5 Nov 2026: on staging, the owner's three test workspaces only). Elsewhere every door of it
answers 404 as if it were not there, and the chat turn goes on exactly as before: no router call, no plan card. Unset (local, tests): every workspace."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import uuid
from typing import Any

import pytest

from app.assistant_work.enabled import enabled, parse_tenants
from tests.fakes import TENANT_A, auth
from tests.test_aw_files import BASE, cards_of
from tests.test_aw_router import say, world

PAUSE = {"decision": "do", "action": "pause_source", "args": {"source": "IndiaMART"}}


def only(client: Any, *tenants: uuid.UUID) -> None:
    object.__setattr__(client.app.state.runtime, "assistant_work_tenants", frozenset(tenants))


def test_the_setting() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    assert parse_tenants(None) is None, "unset: every workspace"
    assert parse_tenants("") == frozenset() and parse_tenants("none") == frozenset(), "set but empty: no workspace"
    assert parse_tenants(f"{a};{b}") == frozenset({a, b}) and parse_tenants(f" {a} , {b} ") == frozenset({a, b})
    with pytest.raises(ValueError, match="workspace id"):
        parse_tenants(f"{a};lakshmi")
    runtime = type("R", (), {"assistant_work_tenants": None})()
    assert enabled(runtime, a)
    runtime.assistant_work_tenants = frozenset({a})
    assert enabled(runtime, a) and not enabled(runtime, b)


def test_a_listed_workspace_has_it() -> None:
    client, *_ = world(PAUSE)
    only(client, TENANT_A.id)
    assert cards_of(say(client, "pause IndiaMART"))[0]["kind"] == "plan"


def test_another_workspace_has_no_router_and_no_card_the_turn_goes_on_as_before() -> None:
    client, llm, _, _, sources = world("The chat answer.")
    only(client, uuid.uuid4())
    evs = say(client, "pause IndiaMART")
    assert cards_of(evs) == []
    assert all(r.final_result is None or r.final_result.name != "route" for r in llm.requests), "the router is never asked"
    assert sources.sources_[next(iter(sources.sources_))]["status"] == "active"


def test_another_workspace_gets_404_from_every_door() -> None:
    client, *_ = world()
    only(client)   # set but empty: no workspace
    owner = auth("a_owner")
    data = base64.b64encode(b"name,phone\nRavi,+00 00000 11111\n").decode()
    assert client.post(f"{BASE}/files", json={"name": "a.csv", "content_type": "text/csv", "size_bytes": 32, "data_base64": data}, headers=owner).status_code == 404
    pid = uuid.uuid4()
    assert client.get(f"{BASE}/plans/{pid}", headers=owner).status_code == 404
    assert client.post(f"{BASE}/plans/{pid}/decide", json={"decision": "do", "confirmed": False}, headers=owner).status_code == 404
    assert client.post(f"{BASE}/plans/{pid}/undo", headers=owner).status_code == 404
    assert client.get(f"{BASE}/actions", headers=owner).status_code == 404
    assert client.post(f"{BASE}/actions/{pid}/undo", headers=owner).status_code == 404
