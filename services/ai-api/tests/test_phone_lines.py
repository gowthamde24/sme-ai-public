# ruff: noqa: E501
"""Calls at once (28 Nov 2026): the lines of the Phone numbers page, from our own live-call counter; nothing but counts."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

from app.telephony.live import LiveCalls
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/phone-lines"


def world(total: int | None = 3, calls: int = 0) -> Any:
    live = LiveCalls()
    for _ in range(calls):
        live.add(uuid.uuid4(), uuid.uuid4(), SimpleNamespace())  # type: ignore[arg-type]
    inbound = SimpleNamespace(gate_settings=SimpleNamespace(max_concurrent=total)) if total is not None else None
    client, _ = make_client(live_calls=live, phone_inbound=inbound)
    return client


def test_the_lines_show_how_many_calls_run_and_nothing_else() -> None:
    r = world(3, 1).get(URL, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"total": 3, "in_use": 1, "lines": [{"n": 1, "state": "on_call"}, {"n": 2, "state": "open"}, {"n": 3, "state": "open"}]}
    assert r.headers["cache-control"] == "no-store"
    text = r.text
    assert "+91" not in text and "tenant" not in text and "caller" not in text


def test_more_calls_than_lines_still_shows_every_line_busy_and_nothing_negative() -> None:
    r = world(2, 5).get(URL, headers=auth("a_admin"))
    assert r.json()["in_use"] == 2 and [x["state"] for x in r.json()["lines"]] == ["on_call", "on_call"]


def test_only_owner_and_admin_may_look_and_a_server_without_telephony_shows_no_lines() -> None:
    client = world(2, 0)
    for user in ("a_sales", "a_viewer"):
        assert client.get(URL, headers=auth(user)).status_code == 403
    assert client.get(URL, headers=auth("outsider")).status_code == 404
    none = world(None, 0).get(URL, headers=auth("a_owner"))
    assert none.json() == {"total": 0, "in_use": 0, "lines": []}
