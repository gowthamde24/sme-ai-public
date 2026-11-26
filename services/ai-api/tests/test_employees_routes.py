# ruff: noqa: E501
"""AI employees routes (26 Nov 2026): who may do what, the flag, closed refusals, strict request shapes, markup stripped on the way in, voices only from the catalogue. The database rules are proved in pgTAP 279."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.employees.repository import EmployeeRefused
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/employees"
EID = str(uuid.uuid4())


class FakeEmployees:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.refuse: str | None = None

    def _go(self, name: str, payload: Any, out: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, payload))
        if self.refuse:
            raise EmployeeRefused(self.refuse)
        return out

    def employees(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._go("list", None, {"employees": [], "limit": 1})

    def get(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID) -> dict[str, Any]:
        return self._go("get", str(employee_id), {"id": str(employee_id)})

    def create(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, role_code: str, name: str) -> dict[str, Any]:
        return self._go("create", (role_code, name), {"id": str(employee_id), "name": name, "status": "draft"})

    def update(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
        return self._go("update", patch, {"id": str(employee_id), **patch})

    def status(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._go("status", status, {"id": str(employee_id), "status": status})

    def voice(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, language: str, voice_code: str) -> dict[str, Any]:
        return self._go("voice", (language, voice_code), {"id": str(employee_id), "voices": {language: voice_code}})

    def phone(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, phone_number_id: uuid.UUID | None) -> dict[str, Any]:
        return self._go("phone", phone_number_id, {"id": str(employee_id)})

    def channels(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._go("channels", None, {"phone": True, "whatsapp": False, "web_chat": False, "whatsapp_connection": {"status": "none", "connected": False, "next_step": "connect_whatsapp"}})

    def activity(self, token: str, tenant_id: uuid.UUID, employee_id: uuid.UUID, limit: int, before: str | None) -> dict[str, Any]:
        return self._go("activity", (limit, before), {"calls": []})


@pytest.fixture
def w() -> tuple[Any, FakeEmployees]:
    repo = FakeEmployees()
    client, _ = make_client(employees=repo)
    return client, repo


def test_every_member_reads_and_only_owner_or_admin_writes(w: tuple[Any, FakeEmployees]) -> None:
    client, repo = w
    assert client.get(URL, headers=auth("a_viewer")).status_code == 200
    assert client.get(f"{URL}/{EID}", headers=auth("a_sales")).status_code == 200
    body = {"id": EID, "role_code": "sales", "name": "Priya"}
    for user in ("a_sales", "a_viewer"):
        assert client.post(URL, json=body, headers=auth(user)).status_code == 403
        assert client.put(f"{URL}/{EID}", json={"role_title": "Sales"}, headers=auth(user)).status_code == 403
        assert client.post(f"{URL}/{EID}/status", json={"status": "on"}, headers=auth(user)).status_code == 403
    assert not [c for c in repo.calls if c[0] in ("create", "update", "status")]
    assert client.post(URL, json=body, headers=auth("a_admin")).status_code == 201


def test_the_flag_off_is_a_404_for_every_route() -> None:
    client, _ = make_client()
    assert client.get(URL, headers=auth("a_owner")).status_code == 404
    assert client.post(URL, json={"id": EID, "role_code": "sales", "name": "x"}, headers=auth("a_owner")).status_code == 404


def test_markup_is_stripped_before_the_database_sees_a_word(w: tuple[Any, FakeEmployees]) -> None:
    client, repo = w
    client.post(URL, json={"id": EID, "role_code": "sales", "name": "<b>Priya</b>"}, headers=auth("a_owner"))
    assert ("create", ("sales", "Priya")) in repo.calls
    client.put(f"{URL}/{EID}", json={"role_title": "<i>Sales</i> lead", "never_say": ["<x>cheap</x>"], "extra_instructions": "Ask <b>fabric</b>."}, headers=auth("a_owner"))
    patch = [c for c in repo.calls if c[0] == "update"][-1][1]
    assert patch == {"role_title": "Sales lead", "never_say": ["cheap"], "extra_instructions": "Ask fabric."}


def test_only_the_sent_fields_are_in_the_patch(w: tuple[Any, FakeEmployees]) -> None:
    client, repo = w
    r = client.put(f"{URL}/{EID}", json={"hours": {"days": [1, 2], "from_minute": 660, "to_minute": 1140}, "autonomy": {"max_discount_percent": 5}}, headers=auth("a_owner"))
    assert r.status_code == 200
    assert [c for c in repo.calls if c[0] == "update"][-1][1] == {"hours": {"days": [1, 2], "from_minute": 660, "to_minute": 1140}, "autonomy": {"max_discount_percent": 5}}


@pytest.mark.parametrize("reason,status", [("employee_limit", 409), ("name_taken", 409), ("last_default", 409), ("hours_wider", 422), ("settings_elsewhere", 409)])
def test_each_database_refusal_is_a_closed_word_in_code_reason_and_fields(w: tuple[Any, FakeEmployees], reason: str, status: int) -> None:
    client, repo = w
    code = next(k for k, v in __import__("app.employees.repository", fromlist=["REASONS"]).REASONS.items() if v == reason)
    repo.refuse = code
    r = client.put(f"{URL}/{EID}", json={"role_title": "Sales"}, headers=auth("a_owner"))
    err = r.json()["error"]
    assert r.status_code == status and err["code"] == reason and err["reason"] == reason and err["fields"] == [reason]


def test_request_shapes_are_strict(w: tuple[Any, FakeEmployees]) -> None:
    client, repo = w
    bad = [
        (client.post, URL, {"id": EID, "role_code": "boss", "name": "x"}),
        (client.post, URL, {"id": EID, "role_code": "sales", "name": "x", "extra": 1}),
        (client.post, URL, {"id": "nope", "role_code": "sales", "name": "x"}),
        (client.put, f"{URL}/{EID}", {"speed": 3}),
        (client.put, f"{URL}/{EID}", {"languages": ["xx"]}),
        (client.put, f"{URL}/{EID}", {"autonomy": {"max_discount_percent": 101}}),
        (client.put, f"{URL}/{EID}", {"hours": {"days": [8], "from_minute": 660, "to_minute": 1140}}),
        (client.put, f"{URL}/{EID}", {"hours": {"days": [0], "from_minute": 660, "to_minute": 1140}}),
        (client.put, f"{URL}/{EID}", {"ask_first": ["teleport"]}),
        (client.post, f"{URL}/{EID}/status", {"status": "draft"}),
    ]
    for call, url, body in bad:
        assert call(url, json=body, headers=auth("a_owner")).status_code == 422, (url, body)
    assert not repo.calls


def test_a_voice_must_be_in_the_catalogue_for_that_language(w: tuple[Any, FakeEmployees]) -> None:
    client, repo = w
    assert client.put(f"{URL}/{EID}/voices/te", json={"voice_code": "te-ramya"}, headers=auth("a_owner")).status_code == 200
    assert client.put(f"{URL}/{EID}/voices/te", json={"voice_code": "en-janvi"}, headers=auth("a_owner")).status_code == 422
    assert client.put(f"{URL}/{EID}/voices/te", json={"voice_code": "te-nobody"}, headers=auth("a_owner")).status_code == 422
    assert [c for c in repo.calls if c[0] == "voice"] == [("voice", ("te", "te-ramya"))]


def test_a_phone_number_can_be_given_or_taken_away(w: tuple[Any, FakeEmployees]) -> None:
    client, repo = w
    n = uuid.uuid4()
    assert client.put(f"{URL}/{EID}/phone", json={"phone_number_id": str(n)}, headers=auth("a_owner")).status_code == 200
    assert client.put(f"{URL}/{EID}/phone", json={"phone_number_id": None}, headers=auth("a_owner")).status_code == 200
    assert [c[1] for c in repo.calls if c[0] == "phone"] == [n, None]


def test_the_preview_speaks_the_employees_own_voice_and_never_another_one(w: tuple[Any, FakeEmployees]) -> None:
    from types import SimpleNamespace

    class Voice:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str | None, str]] = []
            self.fail = False

        async def speak(self, tenant_id: Any, language: str, chosen: str | None, text: str, gender: str = "female", pace: float = 1.0) -> tuple[bytes, str, str]:
            from app.voice.interface import VoiceError

            self.calls.append((language, chosen, text))
            if self.fail:
                raise VoiceError("tts_unavailable")
            return b"RIFFxxxx", "cartesia", chosen or "te-sindhu"

    repo = FakeEmployees()
    repo.get = lambda token, tenant_id, employee_id: {"id": str(employee_id), "voices": {"te": "te-ramya"}, "opening_line": {"te": "నమస్కారం, నేను ప్రియ, AI అసిస్టెంట్."}}   # type: ignore[method-assign]
    voice = Voice()
    client, _ = make_client(employees=repo, call_voice=voice, workspace=SimpleNamespace(voice_choices=lambda token, tenant: {"choices": {}, "gender": "female"}))
    r = client.post(f"{URL}/{EID}/preview", json={"language": "te"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["voice_id"] == "te-ramya" and voice.calls == [("te", "te-ramya", "నమస్కారం, నేను ప్రియ, AI అసిస్టెంట్.")]
    assert client.post(f"{URL}/{EID}/preview", json={"language": "te"}, headers=auth("a_sales")).status_code == 403
    voice.fail = True
    down = client.post(f"{URL}/{EID}/preview", json={"language": "te", "text": "Hello there"}, headers=auth("a_owner"))
    assert down.status_code == 503 and down.json()["error"]["code"] == "voice_unavailable"


def test_the_channels_are_readable_by_every_member_and_404_while_the_flag_is_off(w: tuple[Any, FakeEmployees]) -> None:
    client, _ = w
    for user in ("a_viewer", "a_sales", "a_owner"):
        r = client.get(f"/v1/tenants/{TENANT_A.id}/channels", headers=auth(user))
        assert r.status_code == 200 and r.json()["whatsapp"] is False and r.json()["whatsapp_connection"]["next_step"] == "connect_whatsapp"
    off, _ = make_client()
    assert off.get(f"/v1/tenants/{TENANT_A.id}/channels", headers=auth("a_owner")).status_code == 404
