"""Job CV: the routes of voice notes and of the one reports API, with fakes (no database). The database's own rules (the doors, the second factor, the allowance, the disclosure, the worker's plan, the report figures)
are proved in supabase/tests/database/108 and 109 and tests/integration/test_cv_voice_reports.py; here: who may call what, the shapes, the closed requests, the preview (made with the fake speech provider, counted,
refused with a fixed sentence), and that no audio is ever stored or returned except the short preview."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import uuid
import wave
from io import BytesIO
from typing import Any

import pytest

from app.packs.errors import ModuleOffError
from app.voice.fake import FakeTts
from app.voice.interface import VoiceStack
from tests.cv_fakes import CAMPAIGN, FakeReports, FakeVoiceNotes
from tests.fakes import TENANT_A, auth, make_client

A = TENANT_A.id
V = f"/v1/tenants/{A}/voice-notes"
R = f"/v1/tenants/{A}/reports"
PREVIEW_ID = str(uuid.UUID(int=0x9E))
SETTINGS = {"enabled": True, "speed": 1.0, "call_from_hour": 9, "call_to_hour": 21}
ALL_THREE = ("a_owner", "a_admin", "a_sales")
OWNER_ADMIN = ("a_owner", "a_admin")
OWNER = ("a_owner",)


def world(tts: FakeTts | None = None) -> tuple[Any, FakeVoiceNotes]:
    fake = FakeVoiceNotes()
    client, _ = make_client(voice_notes=fake, voice=VoiceStack(stt=None, tts=tts or FakeTts()))
    return client, fake


MATRIX: list[tuple[str, str, Any, tuple[str, ...]]] = [
    ("GET", "/settings", None, OWNER_ADMIN),
    ("PUT", "/settings", SETTINGS, OWNER),
    ("GET", "/voices", None, OWNER_ADMIN),
    ("PUT", "/choices/en", {"voice_code": "fake-en"}, OWNER),
    ("GET", "/disclosure/en", None, ALL_THREE),
    ("GET", "/usage", None, ALL_THREE),
    ("POST", "/preview", {"preview_id": PREVIEW_ID, "language": "en"}, OWNER_ADMIN),
    ("GET", f"/campaigns/{CAMPAIGN}", None, ALL_THREE),
    ("PUT", f"/campaigns/{CAMPAIGN}", {"enabled": True}, ALL_THREE),
]


@pytest.mark.parametrize(("method", "path", "body", "who"), MATRIX, ids=[f"{m} {p.split('/')[1]}" for m, p, _b, _w in MATRIX])
def test_who_may_call_what(method: str, path: str, body: Any, who: tuple[str, ...]) -> None:
    client, fake = world()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.request(method, V + path, json=body, headers=auth(user))
        if user in who:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403, (user, r.status_code)
    assert client.request(method, V + path, json=body, headers=auth("b_owner")).status_code == 404, "another business"
    assert client.request(method, V + path, json=body).status_code == 401, "no token"
    # a refused caller never reaches the data layer: every allowed caller made exactly the calls one request makes (a preview makes two: the plan and the record; the fake's campaign switch reads the campaign back)
    assert len(fake.calls) == len(who) * (2 if (path == "/preview" or (method == "PUT" and path.startswith("/campaigns"))) else 1)


@pytest.mark.parametrize(
    "bad",
    [
        {**SETTINGS, "speed": 0.5}, {**SETTINGS, "speed": 2}, {**SETTINGS, "call_from_hour": 8}, {**SETTINGS, "call_to_hour": 22}, {**SETTINGS, "call_from_hour": 15, "call_to_hour": 15},
        {**SETTINGS, "call_from_hour": 18, "call_to_hour": 10}, {**SETTINGS, "recording": True}, {"enabled": True}, {**SETTINGS, "enabled": "yes please"},
    ],
)  # fmt: skip
def test_the_settings_request_is_closed_and_checked(bad: dict[str, Any]) -> None:
    client, fake = world()
    assert client.put(V + "/settings", json=bad, headers=auth("a_owner")).status_code == 422, bad
    assert fake.calls == []


@pytest.mark.parametrize("path", ["/choices/xx", "/choices/EN", "/disclosure/fr", "/disclosure/en%20"])
def test_a_language_is_one_of_the_five(path: str) -> None:
    client, fake = world()
    method = client.put if path.startswith("/choices") else client.get
    kwargs: dict[str, Any] = {"json": {"voice_code": "fake-en"}} if path.startswith("/choices") else {}
    assert method(V + path, headers=auth("a_owner"), **kwargs).status_code == 422
    assert fake.calls == []


def test_a_choice_can_be_removed_and_a_code_is_checked() -> None:
    client, fake = world()
    assert client.put(V + "/choices/te", json={"voice_code": None}, headers=auth("a_owner")).json()["choices"] == {}
    assert fake.calls[-1] == ("set_choice", (fake.calls[-1][1][0], "te", None))
    for bad in ({"voice_code": "Not A Code"}, {"voice_code": "a"}, {"voice_code": "x" * 41}, {"voice": "fake-en"}):
        assert client.put(V + "/choices/te", json=bad, headers=auth("a_owner")).status_code == 422, bad


def test_the_settings_say_recording_is_never_offered() -> None:
    client, _ = world()
    assert client.get(V + "/settings", headers=auth("a_owner")).json()["recording"] is False


def test_a_campaign_voice_change_is_passed_with_the_callers_token_and_an_unknown_id_is_a_404() -> None:
    client, fake = world()
    r = client.put(V + f"/campaigns/{CAMPAIGN}", json={"enabled": True}, headers=auth("a_sales"))
    assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["changed"] is True and r.json()["issues"] == ["voice_off"]
    assert fake.calls[0][0] == "set_campaign" and fake.calls[0][1][2] is True
    assert client.put(V + "/campaigns/not-a-uuid", json={"enabled": True}, headers=auth("a_sales")).status_code == 404
    assert client.put(V + f"/campaigns/{CAMPAIGN}", json={"enabled": "maybe"}, headers=auth("a_sales")).status_code == 422
    assert client.put(V + f"/campaigns/{CAMPAIGN}", json={"enabled": True, "voice_code": "x"}, headers=auth("a_sales")).status_code == 422


def test_a_module_that_is_off_is_refused_with_the_fixed_sentence() -> None:
    client, fake = world()
    fake.error = ModuleOffError("SM701")
    r = client.get(V + "/usage", headers=auth("a_owner"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off"


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the preview
def wav_seconds(data: bytes) -> float:
    with wave.open(BytesIO(data), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def test_a_preview_is_a_short_spoken_disclosure_counted_on_the_ledger() -> None:
    tts = FakeTts()
    client, fake = world(tts)
    r = client.post(V + "/preview", json={"preview_id": PREVIEW_ID, "language": "en"}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    body = r.json()
    audio = base64.b64decode(body["data"])
    assert body["content_type"] == "audio/wav" and body["encoding"] == "base64" and body["voice_code"] == "fake-en" and 1 <= body["seconds"] <= 20
    assert wav_seconds(audio) <= body["seconds"] and body["usage"]["today_seconds"] == body["seconds"]
    assert tts.calls == [(len(fake.plan["text"]), "en")], "the provider was asked once, for the disclosure line only"
    name, args = fake.calls[-1]
    assert name == "preview_record" and args[1] == uuid.UUID(PREVIEW_ID) and args[3] == body["seconds"] and args[4] == len(fake.plan["text"])


def test_a_preview_is_refused_before_any_audio_is_made_when_the_database_says_no() -> None:
    cases = {
        "no_voice_for_language": (409, "voice_not_chosen"), "disclosure_not_reviewed": (409, "disclosure_not_reviewed"),
        "allowance_used": (429, "voice_allowance_used"), "too_many_previews": (429, "too_many_previews"), "something_new": (409, "voice_not_ready"),
    }  # fmt: skip
    for reason, (status, code) in cases.items():
        tts = FakeTts()
        client, fake = world(tts)
        fake.plan = {"ok": False, "reason": reason}
        r = client.post(V + "/preview", json={"preview_id": PREVIEW_ID, "language": "en"}, headers=auth("a_owner"))
        assert (r.status_code, r.json()["error"]["code"]) == (status, code), reason
        assert tts.calls == [] and "preview_record" not in fake.names(), "nothing was made and nothing was counted"


def test_a_preview_is_unavailable_without_a_speech_provider_and_a_provider_failure_counts_nothing() -> None:
    client, fake = make_client(voice_notes=FakeVoiceNotes())[0], None
    r = client.post(V + "/preview", json={"preview_id": PREVIEW_ID, "language": "en"}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "voice_unavailable"
    client, fake = world(FakeTts(fail="timeout"))
    r = client.post(V + "/preview", json={"preview_id": PREVIEW_ID, "language": "en"}, headers=auth("a_owner"))
    assert r.status_code == 502 and r.json()["error"]["code"] == "voice_failed" and "timeout" not in r.text
    assert "preview_record" not in fake.names()


def test_a_preview_request_is_closed() -> None:
    client, fake = world()
    for bad in ({"language": "en"}, {"preview_id": "x", "language": "en"}, {"preview_id": PREVIEW_ID, "language": "en", "text": "say this instead"}, {"preview_id": PREVIEW_ID, "language": "xx"}):
        assert client.post(V + "/preview", json=bad, headers=auth("a_owner")).status_code == 422, bad
    assert fake.calls == []


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the one reports API
REPORT_MATRIX = [("GET", "/catalogue"), ("GET", "/run/construction.quotes")]


@pytest.mark.parametrize(("method", "path"), REPORT_MATRIX)
def test_reports_are_for_members_and_nobody_else(method: str, path: str) -> None:
    fake = FakeReports()
    client, _ = make_client(reports=fake)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        assert client.request(method, R + path, headers=auth(user)).status_code == 200, user
    assert client.request(method, R + path, headers=auth("b_owner")).status_code == 404
    assert client.request(method, R + path).status_code == 401
    assert client.request(method, R + path, headers=auth("outsider")).status_code in (403, 404)
    assert len(fake.calls) == 4


def test_a_report_is_one_shape_and_the_window_is_passed_through() -> None:
    fake = FakeReports()
    client, _ = make_client(reports=fake)
    r = client.get(R + "/run/construction.quotes?from=2026-09-01&to=2026-09-30", headers=auth("a_owner"))
    body = r.json()
    assert set(body) == {"report", "as_of", "from", "to", "kpis", "tables", "series"} and body["kpis"][0] == {"key": "quotes_sent", "value": 4, "unit": "count"}
    assert body["tables"][0]["columns"] == [{"key": "name", "type": "text"}, {"key": "revenue_paise", "type": "paise"}] and body["series"][0]["points"][0]["value"] == 3
    name, args = fake.calls[-1]
    assert name == "run" and args[1] == "construction.quotes" and str(args[2]) == "2026-09-01" and str(args[3]) == "2026-09-30"
    cat = client.get(R + "/catalogue", headers=auth("a_owner")).json()
    assert cat["items"][0]["code"] == "construction.quotes" and cat["items"][0]["window"] == "range"


@pytest.mark.parametrize("path", ["/run/Bad Code", "/run/nodot", "/run/construction.quotes?from=soon", "/run/construction.quotes?to=2026-13-40", "/run/" + "a" * 70 + ".b"])
def test_a_bad_report_request_is_a_422_and_never_reaches_the_database(path: str) -> None:
    fake = FakeReports()
    client, _ = make_client(reports=fake)
    assert client.get(R + path, headers=auth("a_owner")).status_code in (404, 422), path
    assert fake.calls == []


def test_a_report_of_a_module_that_is_off_is_refused() -> None:
    fake = FakeReports()
    fake.error = ModuleOffError("SM701")
    client, _ = make_client(reports=fake)
    r = client.get(R + "/run/education.collection", headers=auth("a_owner"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off"
