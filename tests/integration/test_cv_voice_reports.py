"""Job CV on the real local stack: voice notes and the one reports API. Real GoTrue, PostgREST and Postgres; our API in-process with the caller's own token and the FAKE speech provider (no key, no cost, no
network); the scheduler worker signed in as its OWN registered account with the LOCAL FAKE channel. All data is synthetic (the real-data gate stays closed).

What these prove that the pgTAP files (108, 109) and the unit tests cannot:
  * the voice settings journey through HTTP: off by default, the Owner (with a second factor) switches it on and chooses a voice, the spoken disclosure line, a short preview that is counted in seconds;
  * a campaign with voice switched on is a different approval (an approved campaign goes back to draft), and the real worker then hands the channel the TEXT plus an audio clip that begins with the AI
    disclosure, counts the seconds on the ledger once, and sends nothing but text once the allowance is used up;
  * the audio is never stored: no table of the database holds audio bytes or the spoken words;
  * the reports of a school answer in the one shape (validated against the generated contract), another pack's reports are refused as a module that is off, and a Viewer sees the catalogue only."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import jsonschema
import operator_sql
import pytest
from conftest import TEST_SUPPRESSION_KEY, aal1_token, bearer
from fastapi.testclient import TestClient
from pydantic import SecretStr
from test_outbox_api import restore_clock
from test_scheduler_api import Sched

from app.config import Settings
from app.main import build_runtime, create_app
from app.outbox.voice_hook import VoiceNotes
from app.scheduler.worker import Worker
from app.voice.fake import FakeTts
from app.voice.interface import VoiceStack

ROOT = Path(__file__).resolve().parents[2]
VOICE = json.loads((ROOT / "packages" / "contracts" / "voice_notes.schema.json").read_text(encoding="utf-8"))
REPORTS = json.loads((ROOT / "packages" / "contracts" / "reports.schema.json").read_text(encoding="utf-8"))
IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).date()
BASE = TODAY + timedelta(days=30)
DUE = BASE + timedelta(days=2)


def conforms(instance: Any, definition: str, contract: dict[str, Any]) -> None:
    jsonschema.Draft202012Validator({"$schema": contract["$schema"], "$ref": f"#/$defs/{definition}", "$defs": contract["$defs"]}, format_checker=jsonschema.FormatChecker()).validate(instance)


def uid() -> str:
    return str(uuid.uuid4())


def pin(day: Any, clock: str) -> None:
    h, m = (int(p) for p in clock.split(":"))
    at = datetime.combine(day, datetime.min.time(), tzinfo=IST).replace(hour=h, minute=m)
    operator_sql.sql(f"create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '{at.isoformat()}' $b$")


class Scene:
    template = uid()
    campaign = uid()
    plain = uid()
    guardian = ""
    tts: FakeTts


@pytest.fixture(scope="module")
def scene(stack: Any, eval_world: Any, signup: Any) -> Iterator[Any]:
    a = eval_world.a
    pack = "(select max(version) from packs.pack_versions where code = 'education')"
    operator_sql.sql(f"update packs.workspace_pack set pack_code = 'education', pack_version = {pack}, source = 'operator' where tenant_id = '{a.id}'")
    operator_sql.sql(f"select app.apply_pack_fields('{a.id}', 'education', {pack}, '{a.users['owner'].id}')")
    user = signup("cv-scheduler", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    pin(BASE - timedelta(days=1), "12:00")
    settings = Settings(_env_file=None, api_env="development", supabase_url=stack.url, supabase_anon_key=stack.anon_key, suppression_hmac_key=SecretStr(TEST_SUPPRESSION_KEY))  # type: ignore[call-arg]
    runtime = build_runtime(settings)
    assert runtime is not None
    Scene.tts = FakeTts()
    runtime = dataclasses.replace(runtime, voice=VoiceStack(stt=None, tts=Scene.tts))
    try:
        with TestClient(create_app(settings, runtime=runtime)) as app:
            owner = a.users["owner"]
            assert app.put(f"/v1/tenants/{a.id}/outbox/settings", json={"auto_send_enabled": True, "per_customer_daily_limit": 5}, headers=bearer(owner)).status_code == 200
            operator_sql.sql(
                "insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) "
                f"values ('{Scene.template}', '{a.id}', 'school_notice', 'en', 'utility', 'reminder', 'Hello, a notice from the school: {{{{1}}}} Thank you.', 'approved')"
            )
            yield app, Sched(stack, user)
    finally:
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")
        restore_clock()


def v(tenant: Any, tail: str) -> str:
    return f"/v1/tenants/{tenant.id}/voice-notes{tail}"


def make_worker(sched: Any, voice: bool = True) -> tuple[Worker, Any]:
    worker, adapter = sched.worker()
    repo = sched.repo()
    return Worker(repo, adapter, sched.session(), interval_seconds=60, voice=VoiceNotes(repo, Scene.tts) if voice else None), adapter


# ============================================================================================================ gates
def test_a_workspace_without_the_module_has_no_voice(eval_world: Any, scene: Any) -> None:
    app, _ = scene
    b = eval_world.b
    for method, tail, body in (("GET", "/settings", None), ("GET", "/usage", None), ("GET", "/voices", None), ("POST", "/preview", {"preview_id": uid(), "language": "en"})):
        r = app.request(method, v(b, tail), json=body, headers=bearer(b.users["owner"]))
        assert r.status_code == 403 and r.json()["error"]["code"] == "module_off", (tail, r.status_code, r.text)


# ============================================================================================================ the settings journey
def test_voice_is_off_until_the_owner_with_a_second_factor_switches_it_on(scene: Any, eval_world: Any, stack: Any) -> None:
    app, _ = scene
    a = eval_world.a
    owner, admin, sales = a.users["owner"], a.users["admin"], a.users["sales"]
    first = app.get(v(a, "/settings"), headers=bearer(admin)).json()
    conforms(first, "VoiceSettingsOut", VOICE)
    assert first["enabled"] is False and first["choices"] == {} and first["recording"] is False
    assert app.get(v(a, "/settings"), headers=bearer(sales)).status_code == 403
    body = {"enabled": True, "speed": 1.0, "call_from_hour": 9, "call_to_hour": 21}
    assert app.put(v(a, "/settings"), json=body, headers=bearer(admin)).status_code == 403, "only the Owner"
    weak = {"Authorization": f"Bearer {aal1_token(stack, owner)}"}
    assert app.put(v(a, "/settings"), json=body, headers=weak).json()["error"]["code"] == "mfa_required"
    ok = app.put(v(a, "/settings"), json=body, headers=bearer(owner))
    assert ok.status_code == 200 and ok.json()["enabled"] is True, ok.text
    voices = app.get(v(a, "/voices"), headers=bearer(admin)).json()
    conforms(voices, "VoicesOut", VOICE)
    assert {x["code"] for x in voices["items"]} >= {"fake-en", "fake-te"} and all(x["synthetic"] for x in voices["items"]), "only machine voices exist; no human voice is imitated"
    assert app.put(v(a, "/choices/en"), json={"voice_code": "fake-te"}, headers=bearer(owner)).status_code == 404, "a Telugu voice cannot be chosen for English"
    chosen = app.put(v(a, "/choices/en"), json={"voice_code": "fake-en"}, headers=bearer(owner))
    assert chosen.status_code == 200 and chosen.json()["choices"] == {"en": "fake-en"}, chosen.text
    assert app.put(v(a, "/choices/en"), json={"voice_code": "fake-en"}, headers=weak).json()["error"]["code"] == "mfa_required"


def test_the_spoken_disclosure_names_the_business_and_waits_for_a_native_speaker_once_the_gate_opens(scene: Any, eval_world: Any) -> None:
    app, _ = scene
    a = eval_world.a
    d = app.get(v(a, "/disclosure/en"), headers=bearer(a.users["sales"])).json()
    conforms(d, "DisclosureOut", VOICE)
    name = operator_sql.sql(f"select name from public.tenants where id = '{a.id}'").strip()
    assert d["status"] == "draft" and name in d["text"] and "AI" in d["text"] and "{{" not in d["text"]
    assert d["usable"] is True, "a draft may be spoken while the workspace holds synthetic data only"
    assert app.get(v(a, "/disclosure/en"), headers=bearer(a.users["viewer"])).status_code == 403


def test_a_preview_is_short_counted_in_seconds_and_limited(scene: Any, eval_world: Any) -> None:
    app, _ = scene
    a = eval_world.a
    admin = a.users["admin"]
    before = app.get(v(a, "/usage"), headers=bearer(admin)).json()
    conforms(before, "UsageOut", VOICE)
    pid = uid()
    r = app.post(v(a, "/preview"), json={"preview_id": pid, "language": "en"}, headers=bearer(admin))
    assert r.status_code == 200, r.text
    conforms(r.json(), "PreviewOut", VOICE)
    secs = r.json()["seconds"]
    assert 1 <= secs <= 20 and r.json()["usage"]["today_seconds"] == before["today_seconds"] + secs
    again = app.post(v(a, "/preview"), json={"preview_id": pid, "language": "en"}, headers=bearer(admin))
    assert again.status_code == 200 and again.json()["usage"]["today_seconds"] == r.json()["usage"]["today_seconds"], "a retry with the same id counts once"
    assert app.post(v(a, "/preview"), json={"preview_id": uid(), "language": "te"}, headers=bearer(admin)).json()["error"]["code"] == "voice_not_chosen"
    assert app.post(v(a, "/preview"), json={"preview_id": uid(), "language": "en"}, headers=bearer(a.users["sales"])).status_code == 403
    codes = [app.post(v(a, "/preview"), json={"preview_id": uid(), "language": "en"}, headers=bearer(admin)).status_code for _ in range(10)]
    assert 429 in codes, "at most ten previews an hour"


# ============================================================================================================ a campaign with a voice note
def test_a_campaign_voice_switch_is_part_of_what_the_owner_approves(scene: Any, eval_world: Any) -> None:
    app, _ = scene
    a = eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    guardian = uid()
    r = app.post(f"/v1/tenants/{a.id}/contacts", json={"id": guardian, "full_name": "Parent Voice", "phone": f"+00 9{uuid.uuid4().int % 10**9:09d}"}, headers=bearer(owner))
    assert r.status_code == 201, r.text
    c = app.post(
        f"/v1/tenants/{a.id}/contacts/{guardian}/record-consent",
        json={"channel": "whatsapp", "status": "granted", "basis": "explicit_consent", "evidence_type": "web_form", "evidence_ref": "ref:voice"},
        headers=bearer(owner),
    )
    assert c.status_code == 200, c.text
    Scene.guardian = guardian
    path = f"/v1/tenants/{a.id}/campaigns/{Scene.campaign}"
    body = {
        "name": "Annual day", "kind": "event", "language": "en", "wa_template_id": Scene.template,
        "message_text": "Dear {{name}}, our annual day is on {{due_date}}. We look forward to seeing you.",
        "steps": [{"offset_days": -2, "time": "10:00"}],
    }  # fmt: skip
    assert app.put(path, json=body, headers=bearer(sales)).status_code == 200
    rows = {"rows": [{"contact_id": guardian, "due_date": (BASE + timedelta(days=2)).isoformat()}]}
    assert app.post(path + "/recipients", json=rows, headers=bearer(sales)).json()["added"] == 1
    state = app.get(v(a, f"/campaigns/{Scene.campaign}"), headers=bearer(sales)).json()
    conforms(state, "CampaignVoiceOut", VOICE)
    assert state["enabled"] is False and state["issues"] == [] and state["voice_code"] == "fake-en"
    seen = app.get(path + "/preview", headers=bearer(sales)).json()
    assert app.post(path + "/approve", json={"samples_sha256": seen["samples_sha256"]}, headers=bearer(owner)).status_code == 200
    assert app.get(path, headers=bearer(sales)).json()["status"] == "approved"
    on = app.put(v(a, f"/campaigns/{Scene.campaign}"), json={"enabled": True}, headers=bearer(sales))
    assert on.status_code == 200 and on.json()["enabled"] is True and on.json()["changed"] is True, on.text
    assert app.get(path, headers=bearer(sales)).json()["status"] == "draft", "the approved campaign went back to draft"
    same = app.put(v(a, f"/campaigns/{Scene.campaign}"), json={"enabled": True}, headers=bearer(sales))
    assert same.json()["changed"] is False, "the same switch again changes nothing"
    after = app.get(path + "/preview", headers=bearer(sales)).json()
    assert after["content_sha256"] != seen["content_sha256"], "what the Owner approves is bound to the voice too"
    assert app.post(path + "/approve", json={"samples_sha256": after["samples_sha256"]}, headers=bearer(owner)).status_code == 200
    assert app.get(path, headers=bearer(sales)).json()["status"] == "approved"


def test_the_worker_sends_the_text_with_a_spoken_copy_and_counts_the_seconds_once(scene: Any, eval_world: Any) -> None:
    app, sched = scene
    a = eval_world.a
    worker, adapter = make_worker(sched)
    pin(BASE - timedelta(days=1), "12:00")
    assert worker.tick_once() is not None and adapter.sent == []
    pin(BASE, "10:30")
    before = app.get(v(a, "/usage"), headers=bearer(a.users["owner"])).json()
    assert before["today_seconds"] == 0, "a new India day: the previews of yesterday are not today's"
    assert worker.tick_once() is not None
    (msg,) = [m for m in adapter.sent if "annual day" in m.body]
    assert msg.audio is not None and msg.audio.content_type == "audio/wav" and msg.audio.seconds >= 1, "the text AND the audio"
    assert "Parent Voice" in msg.body
    spoken = [c for c in Scene.tts.calls][-1]
    assert spoken[1] == "en" and spoken[0] > len(msg.body) - 120, "the provider was asked to speak the disclosure plus the approved words"
    after = app.get(v(a, "/usage"), headers=bearer(a.users["owner"])).json()
    assert after["today_seconds"] == msg.audio.seconds and after["month_seconds"] >= msg.audio.seconds
    rows = operator_sql.sql(f"select count(*) from public.voice_note_usage where tenant_id = '{a.id}' and ref_id = '{msg.message_id}' and kind = 'note'").strip()
    assert rows == "1"
    # a second worker pass offers nothing again, and a message offered twice is counted once (primary key)
    assert worker.tick_once() is not None
    assert operator_sql.sql(f"select count(*) from public.voice_note_usage where tenant_id = '{a.id}' and ref_id = '{msg.message_id}'").strip() == "1"


def test_audio_and_the_spoken_words_are_stored_nowhere(eval_world: Any, scene: Any) -> None:
    a = eval_world.a
    cols = operator_sql.sql(
        "select string_agg(table_name || '.' || column_name || ':' || data_type, ',') from information_schema.columns where table_schema = 'public' and (table_name like 'voice%' or table_name = 'campaign_voice')"
    ).split(",")
    assert cols and not [c for c in cols if c.endswith(":bytea")], "no table of the voice notes holds bytes"
    names = {c.split(":")[0].split(".")[1] for c in cols}
    assert not names & {"audio", "transcript", "words", "script", "body", "message", "text", "clip", "file", "path"}, names
    assert operator_sql.sql(f"select count(*) from public.outbox_messages where tenant_id = '{a.id}' and body ilike '%automated voice message%'").strip() == "0", "the disclosure is spoken, not added to the stored text"


def test_when_the_allowance_is_used_up_the_text_still_goes_alone(scene: Any, eval_world: Any) -> None:
    app, sched = scene
    a = eval_world.a
    owner, sales = a.users["owner"], a.users["sales"]
    cid = uid()
    path = f"/v1/tenants/{a.id}/campaigns/{cid}"
    body = {
        "name": "Sports day", "kind": "event", "language": "en", "wa_template_id": Scene.template,
        "message_text": "Dear {{name}}, sports day is on {{due_date}}. See you there.", "steps": [{"offset_days": -1, "time": "11:00"}],
    }  # fmt: skip
    assert app.put(path, json=body, headers=bearer(sales)).status_code == 200
    assert app.post(path + "/recipients", json={"rows": [{"contact_id": Scene.guardian, "due_date": (BASE + timedelta(days=3)).isoformat()}]}, headers=bearer(sales)).json()["added"] == 1
    assert app.put(v(a, f"/campaigns/{cid}"), json={"enabled": True}, headers=bearer(sales)).status_code == 200
    sha = app.get(path + "/preview", headers=bearer(sales)).json()["samples_sha256"]
    assert app.post(path + "/approve", json={"samples_sha256": sha}, headers=bearer(owner)).status_code == 200
    # the whole day's allowance is used (the operator's placeholder numbers): usage says paused
    pin(BASE + timedelta(days=2), "11:30")
    secs = app.get(v(a, "/usage"), headers=bearer(owner)).json()
    allowance = int(operator_sql.sql(f"select a.daily_seconds from public.plan_voice_allowances a join public.tenants t on t.plan = a.plan where t.id = '{a.id}'").strip())
    fill = allowance - secs["today_seconds"] + 1
    if fill > 0:
        operator_sql.sql(f"insert into public.voice_note_usage (tenant_id, ref_id, kind, seconds, chars, voice_code, language) values ('{a.id}', '{uuid.uuid4()}', 'note', {fill}, 10, 'fake-en', 'en')")
    assert app.get(v(a, "/usage"), headers=bearer(owner)).json()["state"] == "paused"
    worker, adapter = make_worker(sched)
    assert worker.tick_once() is not None
    sent = [m for m in adapter.sent if "sports day" in m.body]
    assert len(sent) == 1 and sent[0].audio is None, "paused: the text goes, the audio does not"
    assert app.post(v(a, "/preview"), json={"preview_id": uid(), "language": "en"}, headers=bearer(owner)).json()["error"]["code"] == "voice_allowance_used"


def test_a_worker_without_a_speech_provider_sends_only_text(scene: Any, eval_world: Any) -> None:
    _, sched = scene
    worker, adapter = make_worker(sched, voice=False)
    pin(BASE + timedelta(days=5), "11:30")
    assert worker.tick_once() is not None
    assert all(m.audio is None for m in adapter.sent)


# ============================================================================================================ reports
def test_a_school_reports_in_the_one_shape_and_other_packs_reports_are_off(scene: Any, eval_world: Any) -> None:
    app, _ = scene
    a = eval_world.a
    r = f"/v1/tenants/{a.id}/reports"
    cat = app.get(r + "/catalogue", headers=bearer(a.users["sales"])).json()
    conforms(cat, "CatalogueOut", REPORTS)
    codes = {i["code"] for i in cat["items"]}
    assert {"education.collection", "education.today", "education.pending", "education.funnel"} <= codes
    assert not any(c.startswith("construction.") for c in codes), "another pack's reports are not offered"
    assert app.get(r + "/catalogue", headers=bearer(a.users["viewer"])).json() == {"items": []}, "a Viewer is offered no report"
    assert app.get(r + "/run/education.collection", headers=bearer(a.users["viewer"])).status_code == 403
    assert app.get(r + "/run/weekly.summary", headers=bearer(a.users["sales"])).status_code == 403, "the weekly summary is the Owner's and Admin's"
    got = app.get(r + "/run/education.today", headers=bearer(a.users["owner"]))
    assert got.status_code == 200, got.text
    conforms(got.json(), "ReportOut", REPORTS)
    off = app.get(r + "/run/construction.quotes", headers=bearer(a.users["owner"]))
    assert off.status_code == 403 and off.json()["error"]["code"] == "module_off"
    unknown = app.get(r + "/run/nothing.here", headers=bearer(a.users["owner"]))
    assert unknown.status_code in (404, 422)
    w = app.get(r + "/run/weekly.summary", headers=bearer(a.users["owner"]))
    assert w.status_code == 200, w.text
    conforms(w.json(), "ReportOut", REPORTS)
    assert app.get(f"/v1/tenants/{eval_world.b.id}/reports/catalogue", headers=bearer(a.users["owner"])).status_code == 404, "another business"
