"""My assistant: the state and the lists made from the database's facts, the Owner's Go live / Pause, the closed refusal. A fake repository; the database rules are pgTAP 192."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.assistant_status.service import (
    AssistantStatusService,
    HeldBySupportError,
    NotReadyError,
    status_of,
)
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/assistant"


class FakeRepo:
    def __init__(self, **facts: Any) -> None:
        self.f = {"live": False, "ever_changed": False, "business_name_ok": True, "phone_number_ok": True, "voice_saved": False, "rules_saved": False, **facts}
        self.calls: list[str] = []

    def facts(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("facts")
        return dict(self.f)

    def go_live(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("go_live")
        if not (self.f["business_name_ok"] and self.f["phone_number_ok"]):
            raise NotReadyError("SM991")
        self.f.update(live=True, ever_changed=True)
        return dict(self.f)

    def pause(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append("pause")
        self.f.update(live=False, ever_changed=True)
        return dict(self.f)


def world(**facts: Any) -> tuple[Any, FakeRepo]:
    repo = FakeRepo(**facts)
    client, _ = make_client(assistant_status=AssistantStatusService(repo))
    return client, repo


def test_the_state_is_made_from_the_facts() -> None:
    assert status_of({"business_name_ok": True, "phone_number_ok": True}).state == "not_live"
    assert status_of({"business_name_ok": True, "phone_number_ok": True, "voice_saved": True}).state == "in_training"
    assert status_of({"business_name_ok": True, "phone_number_ok": True, "rules_saved": True}).state == "in_training"
    live = status_of({"live": True, "business_name_ok": True, "phone_number_ok": True})
    assert live.state == "live" and live.can_go_live and live.missing == [] and live.using_defaults == ["voice", "rules"]
    lost = status_of({"live": True, "business_name_ok": True, "phone_number_ok": False})
    assert lost.state == "not_live" and lost.missing == ["phone_number"] and not lost.can_go_live, "a live assistant whose number is gone is not live"
    nothing = status_of({})
    assert nothing.missing == ["business_name", "phone_number"] and nothing.using_defaults == ["voice", "rules"]


def test_any_member_reads_the_status() -> None:
    client, _ = world(voice_saved=True, phone_number_ok=False)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(f"{URL}/status", headers=auth(user))
        assert r.status_code == 200 and r.json() == {"state": "in_training", "can_go_live": False, "missing": ["phone_number"], "using_defaults": ["rules"], "held_by_support": False}
    assert client.get(f"{URL}/status").status_code == 401
    assert client.get(f"{URL}/status", headers=auth("b_owner")).status_code == 404


def test_the_owner_goes_live_and_pauses() -> None:
    client, repo = world()
    r = client.post(f"{URL}/go-live", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["state"] == "live"
    assert client.post(f"{URL}/pause", headers=auth("a_owner")).json()["state"] == "not_live"
    assert repo.calls == ["go_live", "pause"]


def test_only_the_owner_changes_it() -> None:
    client, repo = world()
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(f"{URL}/go-live", headers=auth(user)).status_code == 403
        assert client.post(f"{URL}/pause", headers=auth(user)).status_code == 403
    assert repo.calls == []


def test_going_live_without_a_name_or_a_number_is_a_closed_409_that_says_what_is_missing() -> None:
    client, _ = world(business_name_ok=False, phone_number_ok=False)
    r = client.post(f"{URL}/go-live", headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "assistant_not_ready" and r.json()["error"]["missing"] == ["business_name", "phone_number"]


def test_support_holding_the_assistant_shows_and_refuses_going_live() -> None:
    class Held(FakeRepo):
        def go_live(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            raise HeldBySupportError("SM992")

    repo = Held(staff_hold=True, ever_changed=True)
    client, _ = make_client(assistant_status=AssistantStatusService(repo))
    assert client.get(f"{URL}/status", headers=auth("a_owner")).json()["held_by_support"] is True
    r = client.post(f"{URL}/go-live", headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "held_by_support" and "support" in r.json()["error"]["message"]


def test_not_available_without_the_service() -> None:
    client, _ = make_client()
    assert client.get(f"{URL}/status", headers=auth("a_owner")).json()["error"]["code"] == "assistant_status_unavailable"
    _ = pytest
