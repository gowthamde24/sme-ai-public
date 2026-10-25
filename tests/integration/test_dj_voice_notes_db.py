"""Job DJ on the real local stack: the provider and speaker of a voice reach the worker's plan, a real voice nobody listened to cannot exist, and a campaign cannot carry a child's field into the words that are
spoken or sent. Its own education workspace, template and guardian, the scheduler worker with the LOCAL FAKE channel. Synthetic data only; no key; no network."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import operator_sql
import pytest
from conftest import TEST_SUPPRESSION_KEY, bearer
from fastapi.testclient import TestClient
from pydantic import SecretStr
from test_cv_voice_reports import BASE, pin
from test_outbox_api import restore_clock
from test_scheduler_api import Sched

from app.config import Settings
from app.main import build_runtime, create_app
from app.outbox.voice_hook import VoiceNotes
from app.scheduler.worker import Worker
from app.voice.fake import FakeTts
from app.voice.interface import VoiceStack


class Scene:
    template = str(uuid.uuid4())
    guardian = str(uuid.uuid4())
    tts: FakeTts = FakeTts()


@pytest.fixture(scope="module")
def scene(stack: Any, eval_world: Any, signup: Any) -> Iterator[Any]:
    a = eval_world.a
    pack = "(select max(version) from packs.pack_versions where code = 'education')"
    operator_sql.sql(f"update packs.workspace_pack set pack_code = 'education', pack_version = {pack}, source = 'operator' where tenant_id = '{a.id}'")
    operator_sql.sql(f"select app.apply_pack_fields('{a.id}', 'education', {pack}, '{a.users['owner'].id}')")
    user = signup("dj-scheduler", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    pin(BASE - timedelta(days=1), "12:00")
    settings = Settings(_env_file=None, api_env="development", supabase_url=stack.url, supabase_anon_key=stack.anon_key, suppression_hmac_key=SecretStr(TEST_SUPPRESSION_KEY))  # type: ignore[call-arg]
    runtime = build_runtime(settings)
    assert runtime is not None
    runtime = dataclasses.replace(runtime, voice=VoiceStack(stt=None, tts=Scene.tts))
    try:
        with TestClient(create_app(settings, runtime=runtime)) as app:
            owner = a.users["owner"]
            assert app.put(f"/v1/tenants/{a.id}/outbox/settings", json={"auto_send_enabled": True, "per_customer_daily_limit": 5}, headers=bearer(owner)).status_code == 200
            operator_sql.sql(
                "insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status) "
                f"values ('{Scene.template}', '{a.id}', 'school_notice', 'en', 'utility', 'reminder', 'Hello, a notice from the school: {{{{1}}}} Thank you.', 'approved')"
            )
            r = app.post(f"/v1/tenants/{a.id}/contacts", json={"id": Scene.guardian, "full_name": "Parent Dj", "phone": f"+00 9{uuid.uuid4().int % 10**9:09d}"}, headers=bearer(owner))
            assert r.status_code == 201, r.text
            c = app.post(
                f"/v1/tenants/{a.id}/contacts/{Scene.guardian}/record-consent",
                json={"channel": "whatsapp", "status": "granted", "basis": "explicit_consent", "evidence_type": "web_form", "evidence_ref": "ref:dj"},
                headers=bearer(owner),
            )
            assert c.status_code == 200, c.text
            yield app, Sched(stack, user)
    finally:
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")
        restore_clock()


def make_worker(sched: Any) -> tuple[Worker, Any]:
    worker, adapter = sched.worker()
    repo = sched.repo()
    return Worker(repo, adapter, sched.session(), interval_seconds=60, voice=VoiceNotes(repo, Scene.tts)), adapter


def forget_voices() -> None:
    """The voices these tests add are real-provider rows in the shared catalogue: remove them (and any choice of them) so no other module is offered them (a voice that was spoken stays, switched off, because the usage ledger refers to it)."""
    operator_sql.sql(
        "delete from public.voice_choices where voice_code like 'sarvam-kavya-%'; "
        "delete from voice.voices v where v.code like 'sarvam-kavya-%' and not exists (select 1 from public.voice_note_usage u where u.voice_code = v.code); "
        "update voice.voices set active = false where code like 'sarvam-kavya-%'"   # a voice that was used stays in the catalogue (the ledger refers to it) but is no longer offered
    )


def uid() -> str:
    return str(uuid.uuid4())


def test_a_real_voice_must_have_been_listened_to_and_the_operator_function_is_the_only_door(eval_world: Any, scene: Any) -> None:
    code = f"sarvam-kavya-te-{uuid.uuid4().hex[:6]}"
    try:
        _register(code)
    finally:
        forget_voices()


def _register(code: str) -> None:
    refused = operator_sql.sql_result(f"select app.operator_register_voice('{code}', 'sarvam', 'te', 'Kavya, Telugu', 'kavya')")[0]
    assert refused != 0, "a real voice with no reviewer is refused by the table's CHECK"
    operator_sql.sql(f"select app.operator_register_voice('{code}', 'sarvam', 'te', 'Kavya, Telugu', 'kavya', 'a native Telugu speaker (synthetic test)')")
    row = operator_sql.sql(f"select provider || '/' || speaker || '/' || synthetic::text || '/' || (reviewed_by is not null)::text from voice.voices where code = '{code}'").strip()
    assert row == "sarvam/kavya/false/true"
    assert operator_sql.sql_result("select app.operator_register_voice('fake-x', 'fake', 'te', 'x', null)")[0] != 0, "the fake provider has no door here"


def test_the_plan_names_the_voices_provider_and_speaker_and_the_hook_speaks_with_them(eval_world: Any, scene: Any) -> None:
    app, sched = scene
    a = eval_world.a
    owner = a.users["owner"]
    code = f"sarvam-kavya-en-{uuid.uuid4().hex[:6]}"
    operator_sql.sql(f"select app.operator_register_voice('{code}', 'sarvam', 'en', 'Kavya, English', 'kavya', 'a native English speaker (synthetic test)')")
    assert app.put(f"/v1/tenants/{a.id}/voice-notes/settings", json={"enabled": True, "speed": 1.0, "call_from_hour": 9, "call_to_hour": 21}, headers=bearer(owner)).status_code == 200
    assert app.put(f"/v1/tenants/{a.id}/voice-notes/choices/en", json={"voice_code": code}, headers=bearer(owner)).status_code == 200
    try:
        # a campaign with voice on, approved, whose first step is due: the real worker asks for the plan
        cid = uid()
        path = f"/v1/tenants/{a.id}/campaigns/{cid}"
        sales = a.users["sales"]
        body = {"name": "DJ day", "kind": "event", "language": "en", "wa_template_id": Scene.template, "message_text": "Dear {{name}}, the picnic is on {{due_date}}.", "steps": [{"offset_days": -1, "time": "11:00"}]}
        assert app.put(path, json=body, headers=bearer(sales)).status_code == 200
        assert app.post(path + "/recipients", json={"rows": [{"contact_id": Scene.guardian, "due_date": (BASE + timedelta(days=9)).isoformat()}]}, headers=bearer(sales)).json()["added"] == 1
        assert app.put(f"/v1/tenants/{a.id}/voice-notes/campaigns/{cid}", json={"enabled": True}, headers=bearer(sales)).status_code == 200
        sha = app.get(path + "/preview", headers=bearer(sales)).json()["samples_sha256"]
        assert app.post(path + "/approve", json={"samples_sha256": sha}, headers=bearer(owner)).status_code == 200
        pin(BASE + timedelta(days=8), "11:30")

        class Spy(FakeTts):
            name = "sarvam"   # the configured provider: the voice above belongs to it

        Scene.tts = Spy()
        asked: list[Any] = []
        original = Scene.tts.synthesize

        def spy(text: str, language: str, *, speaker: str | None = None, pace: float | None = None) -> Any:
            asked.append((language, speaker, pace))
            return original(text, language)

        Scene.tts.synthesize = spy  # type: ignore[method-assign]
        worker, adapter = make_worker(sched)
        assert worker.tick_once() is not None
        picnic = [m for m in adapter.sent if "picnic" in m.body]
        plan = sched.repo().voice_plan(sched.session().token(), a.id, picnic[0].message_id) if picnic else {}
        assert len(picnic) == 1 and picnic[0].audio is not None, f"the voice of the matching provider is spoken; the plan was {plan}"
        assert asked and asked[-1][0] == "en" and asked[-1][1] == "kavya" and asked[-1][2] == 1.0, asked
    finally:
        app.put(f"/v1/tenants/{a.id}/voice-notes/choices/en", json={"voice_code": "fake-en"}, headers=bearer(owner))
        Scene.tts = FakeTts()
        forget_voices()


def test_a_campaign_cannot_carry_a_childs_field_into_the_words(eval_world: Any, scene: Any) -> None:
    app, _ = scene
    a = eval_world.a
    sales, owner = a.users["sales"], a.users["owner"]
    for field in ("child_name", "student", "child_label", "admission_no", "programme"):
        cid = uid()
        path = f"/v1/tenants/{a.id}/campaigns/{cid}"
        body = {"name": f"No child {field}", "kind": "event", "language": "en", "wa_template_id": Scene.template, "message_text": "Dear {{name}}, {{" + field + "}} is invited on {{due_date}}.", "steps": [{"offset_days": -1, "time": "11:00"}]}
        put = app.put(path, json=body, headers=bearer(sales))
        assert put.status_code in (200, 422), put.text
        if put.status_code == 422:
            continue
        assert app.post(path + "/recipients", json={"rows": [{"contact_id": Scene.guardian, "due_date": (BASE + timedelta(days=12)).isoformat()}]}, headers=bearer(sales)).status_code in (200, 422)
        pre = app.get(path + "/preview", headers=bearer(sales))
        approve = app.post(path + "/approve", json={"samples_sha256": pre.json().get("samples_sha256", "0" * 64)}, headers=bearer(owner)) if pre.status_code == 200 else pre
        assert approve.status_code in (409, 422), f"{field}: a campaign with a child's field must not be approvable ({approve.status_code})"
        assert app.get(path, headers=bearer(sales)).json()["status"] != "approved"
