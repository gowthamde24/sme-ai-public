"""The lawyer's written opinion (25 Nov 2026), outside the gate: the AI mention defaults to ON and can be switched off only after the stored undertaking; the monitoring line; the number-usage statement, registered
consent and complaint routes; the staff abandoned-call report."""

# ruff: noqa: E501
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.errors import ApiError
from app.opening import greeting
from app.talk_training.repository import PostgrestTalkTraining
from app.telephony import persona
from app.telephony.call_opening import call_opening
from tests.fakes import TENANT_A, auth, make_client

UNDERTAKING = {"at": "2026-11-26T09:00:00+00:00", "by": "11111111-1111-1111-1111-111111111111", "version": "2026-11"}


# ------------------------------------------------------------------------------------------------ the AI mention: default ON, off only with the undertaking
def test_the_mention_is_on_by_default_and_an_off_needs_the_stored_undertaking() -> None:
    assert greeting.DEFAULT is True and greeting.resolve_greeting_disclosure(None) is True
    assert greeting.resolved_from({"say_ai_when_greeting": False}) is True, "an off without the undertaking is read as on"
    assert greeting.resolved_from({"say_ai_when_greeting": False, "ai_off_undertaking": UNDERTAKING}) is False
    assert greeting.resolved_from({"say_ai_when_greeting": True, "ai_off_undertaking": UNDERTAKING}) is True
    assert greeting.resolved_for_job({"say_ai_by_job": {"followups": "off"}}, "followups") is True
    assert greeting.resolved_for_job({"say_ai_by_job": {"followups": "off"}, "ai_off_undertaking": UNDERTAKING}, "followups") is False
    assert greeting.has_undertaking({"ai_off_undertaking": {"at": "x"}}) is False, "when and who, both"


def repo_with(stored_doc: dict[str, Any] | None) -> tuple[PostgrestTalkTraining, list[dict[str, Any]]]:
    saved: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        if request.url.path.endswith("/rpc/talk_training_get"):
            return httpx.Response(200, json={"doc": stored_doc, "updated_at": "2026-11-26T09:00:00+00:00"} if stored_doc is not None else None)
        if request.url.path.endswith("/rpc/talk_training_save"):
            saved.append(body["p_doc"])
            return httpx.Response(200, json={"doc": body["p_doc"], "updated_at": "2026-11-26T09:01:00+00:00"})
        return httpx.Response(404)

    return PostgrestTalkTraining("http://rest", "anon", client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://rest")), saved


def test_a_new_off_without_the_undertaking_is_refused_and_a_client_cannot_give_itself_one() -> None:
    repo, saved = repo_with({"say_ai_when_greeting": None})
    with pytest.raises(ApiError) as caught:
        repo.save("tok", TENANT_A.id, {"say_ai_when_greeting": False})
    assert caught.value.status_code == 409 and caught.value.code == "ai_undertaking_required" and saved == []
    with pytest.raises(ApiError):
        repo.save("tok", TENANT_A.id, {"say_ai_by_job": {"offers": "off"}, "ai_off_undertaking": UNDERTAKING})   # sent by the client: ignored
    assert saved == []
    repo.save("tok", TENANT_A.id, {"say_ai_when_greeting": True, "ai_off_undertaking": UNDERTAKING})
    assert "ai_off_undertaking" not in saved[-1], "the client's key never reaches the database"


def test_the_stored_undertaking_is_kept_and_allows_the_off_and_a_stored_off_without_one_is_dropped() -> None:
    repo, saved = repo_with({"say_ai_when_greeting": True, "ai_off_undertaking": UNDERTAKING})
    repo.save("tok", TENANT_A.id, {"say_ai_when_greeting": False, "tone": "friendly"})
    assert saved[-1]["say_ai_when_greeting"] is False and saved[-1]["ai_off_undertaking"] == UNDERTAKING
    legacy, saved2 = repo_with({"say_ai_when_greeting": False, "say_ai_by_job": {"offers": "off"}})
    legacy.save("tok", TENANT_A.id, {"say_ai_when_greeting": False, "say_ai_by_job": {"offers": "off"}, "tone": "calm_caring"})   # an unrelated edit of an old document
    assert saved2[-1]["say_ai_when_greeting"] is None and saved2[-1]["say_ai_by_job"] == {} and saved2[-1]["tone"] == "calm_caring"


def test_accepting_the_undertaking_stores_when_and_who() -> None:
    repo, saved = repo_with({"say_ai_when_greeting": None})
    repo.save_undertaking("tok", TENANT_A.id, {"tone": None}, "user-1", "2026-11-26T09:00:00+00:00", "2026-11")
    assert saved[-1]["ai_off_undertaking"] == {"at": "2026-11-26T09:00:00+00:00", "by": "user-1", "version": "2026-11"} and greeting.has_undertaking(saved[-1])


# ------------------------------------------------------------------------------------------------ the monitoring line
def test_the_opening_says_the_call_may_be_monitored_only_when_asked_to() -> None:
    plain = call_opening("en", business="Sri Textiles", assistant="Priya", training=None, say_ai=True)
    said = call_opening("en", business="Sri Textiles", assistant="Priya", training=None, say_ai=True, monitor_notice=True)
    assert "monitored" not in plain and said.count("This call may be monitored.") == 1 and "AI" in said
    assert persona.with_monitoring_notice("en", said) == said, "said once"
    both = call_opening("en", business="Sri Textiles", assistant="Priya", training=None, say_ai=True, recording_notice=True, monitor_notice=True)
    assert "recorded" in both and "monitored" in both
    assert "This call may be monitored." in call_opening("te", business="X", assistant="P", training=None, say_ai=True, monitor_notice=True), "the English sentence until a native reader approves"


# ------------------------------------------------------------------------------------------------ the routes
class FakeCompliance:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    def usage_ack(self, token: str, tenant: Any) -> dict[str, Any]:
        self.calls.append(("usage_ack", tenant))
        return {"accepted": False}

    def accept_usage(self, token: str, tenant: Any, version: str) -> dict[str, Any]:
        self.calls.append(("accept_usage", version))
        return {"accepted": True, "accepted_at": "2026-11-26T09:00:00+00:00", "version": version}

    def register_consent(self, token: str, tenant: Any, contact: Any, registrar_id: str) -> None:
        self.calls.append(("register_consent", registrar_id))

    def record_complaint(self, token: str, tenant: Any, kind: str, call_id: Any) -> dict[str, Any]:
        self.calls.append(("complaint", kind))
        return {"id": "c1", "complaints_10d": 3, "warn": True, "paused": False}

    def abandoned_calls(self, token: str, hours: int) -> dict[str, Any]:
        self.calls.append(("abandoned", hours))
        return {"hours": hours, "answered": 40, "abandoned": 2, "rate_percent": 5.0, "alarm": True, "by_business": [], "complaints": []}


def test_the_usage_statement_registered_consent_and_complaint_routes() -> None:
    fake = FakeCompliance()
    client, _ = make_client(compliance=fake)
    base = f"/v1/tenants/{TENANT_A.id}"
    assert client.get(f"{base}/numbers/usage-ack", headers=auth("a_owner")).json() == {"accepted": False}
    got = client.post(f"{base}/numbers/usage-ack", json={"version": "2026-11"}, headers=auth("a_owner"))
    assert got.status_code == 201 and got.json()["accepted"] is True and ("accept_usage", "2026-11") in fake.calls
    assert client.post(f"{base}/numbers/usage-ack", json={"version": "Bad Version"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{base}/numbers/usage-ack", json={"version": "2026-11"}, headers=auth("a_admin")).status_code == 403, "only the Owner accepts"
    contact = "00000000-0000-0000-0000-0000000000c1"
    assert client.post(f"{base}/contacts/{contact}/registered-consent", json={"registrar_id": "REG-2026-000123"}, headers=auth("a_owner")).json() == {"recorded": True}
    assert ("register_consent", "REG-2026-000123") in fake.calls
    for bad in ("ab", "has space", "x" * 97, "semi;colon"):
        assert client.post(f"{base}/contacts/{contact}/registered-consent", json={"registrar_id": bad}, headers=auth("a_owner")).status_code == 422, bad
    assert client.post(f"{base}/contacts/{contact}/registered-consent", json={"registrar_id": "REG-2026-000123"}, headers=auth("a_sales")).status_code == 403
    out = client.post(f"{base}/call-complaints", json={"kind": "telecom_provider"}, headers=auth("a_admin"))
    assert out.status_code == 201 and out.json()["warn"] is True and ("complaint", "telecom_provider") in fake.calls
    assert client.post(f"{base}/call-complaints", json={"kind": "gossip"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{base}/call-complaints", json={"kind": "regulator"}, headers=auth("a_sales")).status_code == 403


def test_the_routes_answer_404_when_the_service_is_not_built() -> None:
    client, _ = make_client()
    assert client.get(f"/v1/tenants/{TENANT_A.id}/numbers/usage-ack", headers=auth("a_owner")).status_code == 404


def test_the_staff_abandoned_call_report_needs_staff() -> None:
    from app.admin.service import AdminService

    fake = FakeCompliance()
    repo: Any = SimpleNamespace()
    client, _ = make_client(compliance=fake, admin=AdminService(repo))
    got = client.get("/v1/admin/compliance/abandoned-calls", params={"hours": 24}, headers=auth("a_owner"))
    assert got.status_code == 200 and got.json()["alarm"] is True and ("abandoned", 24) in fake.calls
    assert client.get("/v1/admin/compliance/abandoned-calls", params={"hours": 0}, headers=auth("a_owner")).status_code == 422
