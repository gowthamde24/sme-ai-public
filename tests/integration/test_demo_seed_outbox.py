"""`make seed-demo-outbox` (job AT): the local demo for the outbox. It refuses a non-local stack before any network call, holds no secret, is idempotent, and what it seeds shows in the approval
queue and on Today (real stack, real application). Nothing it makes is sent to anyone: the only channel is a stand-in inside the application."""

# ruff: noqa: E501, S608

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import Stack
from fastapi.testclient import TestClient

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
SCRIPT = SCRIPTS / "seed_demo_outbox.py"
sys.path.insert(0, str(SCRIPTS))
import seed_demo_manual as manual  # noqa: E402
from seed_demo import Config  # noqa: E402

spec = importlib.util.spec_from_file_location("seed_demo_outbox", SCRIPT)
assert spec and spec.loader
seed: Any = importlib.util.module_from_spec(spec)
sys.modules["seed_demo_outbox"] = seed
spec.loader.exec_module(seed)

NOT_A_NETWORK = httpx.Client(
    transport=httpx.MockTransport(lambda r: pytest.fail("the seed made a network call"))
)


def config(stack: Stack, **over: str) -> Any:
    values = {
        "supabase_url": stack.url,
        "anon_key": stack.anon_key,
        "api_url": "http://localhost:8000",
    }
    return Config(**{**values, **over})


@pytest.fixture(scope="module")
def demo(stack: Stack, client: TestClient) -> Any:
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    http = httpx.Client()
    manual.run(
        config(stack), api=client, http=http
    )  # the demo workspace first, as the runbook says
    first = seed.run(config(stack), api=client, http=http)
    second = seed.run(config(stack), api=client, http=http)
    try:
        yield first, second, client
    finally:
        operator_sql.sql(
            "update public.platform_flags set enabled = false where key = 'outbox_enabled'"
        )


@pytest.mark.parametrize(
    "over",
    [
        {"supabase_url": "https://abcdefgh.supabase.co"},
        {"supabase_url": "http://127.0.0.1.evil.example:54321"},
        {"api_url": "https://api.example.com"},
        {"api_url": "http://0.0.0.0:8000"},
    ],
)
def test_it_refuses_anything_but_a_local_stack_before_any_network_call(
    stack: Stack, over: dict[str, str]
) -> None:
    with pytest.raises(seed.SeedError, match="Refusing to run"):
        seed.run(config(stack, **over), api=NOT_A_NETWORK, http=NOT_A_NETWORK)


def test_the_script_holds_no_secret_and_is_not_used_by_the_application() -> None:
    text = SCRIPT.read_text()
    assert not re.search(
        r"SERVICE_ROLE|SUPABASE_SERVICE|service_role|JWT_SECRET|supabase\.co", text
    )
    for path in (Path(__file__).resolve().parents[2] / "services" / "ai-api" / "app").rglob("*.py"):
        assert "seed_demo_outbox" not in path.read_text(), path


def test_it_makes_the_rows_it_says_and_a_second_run_changes_nothing(demo: Any) -> None:
    first, second, _client = demo
    assert first.tenant_id == second.tenant_id
    states = {line.split(":")[0].strip(): line for line in first.lines}
    assert (
        "needs_approval (money)" in states["m2"]
        and "needs_approval (complaint)" in states["m3"]
        and "blocked (no_opt_in)" in states["m4"]
    )
    assert states["m1"].split(": ")[1].startswith(("queued", "sent")) or "quiet" in states["m1"]
    assert "requested" in states["call request"] or "requested" in second.lines[-1]
    assert [ln.split(":")[0] for ln in first.lines] == [ln.split(":")[0] for ln in second.lines]


def test_the_owner_sees_them_in_the_queue_and_on_today(demo: Any, stack: Stack) -> None:
    first, _second, client = demo
    from test_demo_seed_manual import (
        owner,  # the demo owner, signed in with the local second factor
    )

    token = owner(stack).token
    headers = {"Authorization": f"Bearer {token}"}
    queue = client.get(f"/v1/tenants/{first.tenant_id}/outbox/approvals", headers=headers).json()[
        "items"
    ]
    assert {m["reason"] for m in queue} >= {"money", "complaint"}
    assert all(m["status"] == "needs_approval" for m in queue)
    today = client.get(f"/v1/tenants/{first.tenant_id}/today", headers=headers).json()["needs_you"]
    kinds = {i["kind"] for i in today}
    assert {"outbox_approval", "call_approval"} <= kinds
    log = client.get(f"/v1/tenants/{first.tenant_id}/outbox/messages", headers=headers).json()[
        "items"
    ]
    assert len([m for m in log if m["customer"] and m["customer"].startswith("DEMO ")]) >= 4
