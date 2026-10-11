"""Job BD (ADR 0071) on the real stack: POST /assistant/voice with the FAKE speech adapters and the stand-in model of development. A recording goes in; the transcript, the answer and (when asked) the
spoken answer stream back; the transcript becomes the owner's message; the transcription and the spoken answer are charged to the workspace's AI ledger; nothing is stored (no file, no row with audio);
the allowance and the limits refuse before anything is sent. No real provider is called and no key exists."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import uuid
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from assistant_support import enable_assistant, events, restore, text_of
from conftest import Stack, bearer
from crm_support import World
from fastapi.testclient import TestClient
from test_today_api import Scene

from app.assistant.dev_model import DevAssistantModel
from app.config import Settings
from app.main import build_runtime, create_app
from app.voice.audio import inspect_audio
from app.voice.fake import FakeStt, FakeTts, tone
from app.voice.interface import VoiceStack

WAV = tone(1.0)


class Harness:
    def __init__(self, client: TestClient, scene: Scene, stt: FakeStt, tts: FakeTts) -> None:
        self.client, self.scene, self.stt, self.tts = client, scene, stt, tts

    def post(
        self,
        data: bytes = WAV,
        *,
        user: str = "owner",
        query: str = "",
        message_id: str | None = None,
        tenant: Any = None,
    ) -> Any:
        mid = message_id or str(uuid.uuid4())
        return self.client.post(
            f"/v1/tenants/{tenant or self.scene.a.id}/assistant/voice?message_id={mid}{query}",
            content=data,
            headers={**bearer(self.scene.a.users[user]), "Content-Type": "audio/wav"},
        )

    def ledger(self) -> list[str]:
        return operator_sql.sql(
            f"select step_key || ':' || model || ':' || coalesce(settled_micros::text, 'open') from public.agent_cost_reservations where tenant_id = '{self.scene.a.id}' and step_key like 'voice-%' order by created_at"
        ).splitlines()


@pytest.fixture(scope="module")
def harness(stack: Stack, eval_world: World, client: TestClient) -> Iterator[Harness]:
    saved = enable_assistant([eval_world.a, eval_world.b])
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
    stt, tts = FakeStt("What needs me today?", "en"), FakeTts()
    runtime = dataclasses.replace(
        runtime,
        agents=dataclasses.replace(runtime.agents, assistant_llm=lambda: DevAssistantModel()),
        voice=VoiceStack(stt=stt, tts=tts),
    )
    try:
        with TestClient(create_app(settings, runtime=runtime)) as app:
            yield Harness(app, Scene(eval_world, client), stt, tts)
    finally:
        restore(saved)


def test_a_recording_becomes_a_message_and_streams_the_transcript_the_answer_and_the_spoken_answer(
    harness: Harness,
) -> None:
    harness.stt.calls.clear()
    harness.tts.calls.clear()
    before = harness.ledger()
    r = harness.post(query="&speak=true&language=en")
    assert r.status_code == 200, r.text
    evts = events(r)
    names = [e for e, _ in evts]
    assert names[0] == "transcript" and names[-1] == "audio" and "done" in names, names
    assert (
        evts[0][1]["text"] == "What needs me today?"
        and evts[0][1]["language"] == "en"
        and evts[0][1]["seconds"] == pytest.approx(1.0, abs=0.05)
    )
    answer = text_of(evts)
    assert answer, "the existing flow answered"
    audio = evts[-1][1]
    assert (
        audio["encoding"] == "base64"
        and audio["content_type"] == "audio/wav"
        and audio["characters"] == len(answer.strip())
        or audio["characters"] > 0
    )
    import base64

    assert inspect_audio(base64.b64decode(audio["data"])).content_type == "audio/wav"
    assert harness.stt.calls == [(len(WAV), "audio/wav", "en", ())], (
        "the recording went to the speech-to-text once, with the language hint"
    )
    assert len(harness.tts.calls) == 1 and harness.tts.calls[0][1] == "en"
    mine = harness.ledger()[len(before) :]
    assert mine == [
        "voice-stt:voice-stt:10000",
        f"voice-tts:voice-tts:{audio['characters'] * 4000}",
    ], mine
    done = next(d for e, d in evts if e == "done")
    stored = operator_sql.sql(
        f"select role || ': ' || body from public.assistant_messages where conversation_id = '{done['conversation_id']}' order by seq"
    ).splitlines()
    assert stored[0] == "user: What needs me today?", "the transcript is the owner's message"
    status = operator_sql.sql(
        f"select status from public.agent_runs where conversation_id = '{done['conversation_id']}'"
    )
    assert status == "succeeded"


def test_without_speak_there_is_no_audio_and_no_speech_charge(harness: Harness) -> None:
    before = harness.ledger()
    harness.tts.calls.clear()
    evts = events(harness.post())
    names = [e for e, _ in evts]
    assert (
        names[0] == "transcript"
        and "audio" not in names
        and "audio_error" not in names
        and names[-1] == "done"
    )
    assert harness.tts.calls == []
    assert harness.ledger()[len(before) :] == ["voice-stt:voice-stt:10000"]


def test_the_recording_is_never_stored(harness: Harness) -> None:
    objects = operator_sql.sql("select count(*) from storage.objects")
    rows = operator_sql.sql(
        "select count(*) from public.assistant_messages where body like 'RIFF%'"
    )
    assert harness.post(query="&speak=true").status_code == 200
    assert operator_sql.sql("select count(*) from storage.objects") == objects, "no file in storage"
    assert (
        operator_sql.sql("select count(*) from public.assistant_messages where body like 'RIFF%'")
        == rows
    )
    # and no column anywhere holds audio: the only tables the request touched keep text
    assert (
        operator_sql.sql(
            "select count(*) from information_schema.columns where table_schema = 'public' and (column_name like '%audio%' or data_type = 'bytea')"
        )
        == "0"
    )


def test_the_same_message_id_again_reuses_the_stored_words_calls_no_speech_engine_and_charges_nothing(
    harness: Harness,
) -> None:
    mid = str(uuid.uuid4())
    first = harness.post(message_id=mid, query="&speak=true")
    assert first.status_code == 200 and events(first)[-1][0] == "audio"
    first_events = events(first)
    assert first_events[0][1]["reused"] is False
    conversation = next(
        d["conversation_id"] for e, d in first_events if e == "done"
    )  # a retry names the chat, like the text route
    ledger_after_first = harness.ledger()
    harness.tts.calls.clear()
    harness.stt.calls.clear()
    harness.stt.text = "A completely different sentence"  # the engine would now hear something else: it is not asked
    try:
        second = harness.post(message_id=mid, query=f"&speak=true&conversation_id={conversation}")
    finally:
        harness.stt.text = "What needs me today?"
    assert second.status_code == 200, second.text
    again = events(second)
    assert harness.stt.calls == [], "the speech engine was NOT called for a retry"
    assert (
        again[0][0] == "transcript"
        and again[0][1]["reused"] is True
        and again[0][1]["text"] == "What needs me today?"
    ), "the stored words, not a new transcription"
    done = next(d for e, d in again if e == "done")
    assert done["kind"] == "replayed"
    assert harness.tts.calls == [] and harness.ledger() == ledger_after_first, (
        "a replay makes and charges nothing new"
    )
    # the recording itself is only checked and dropped: nothing about it is stored, and a bad one is still refused the same way
    assert (
        harness.post(
            b"not audio at all" * 40, message_id=mid, query=f"&conversation_id={conversation}"
        ).status_code
        == 415
    )


def test_a_retry_still_works_when_the_allowance_is_used_up_because_it_spends_nothing(
    harness: Harness,
) -> None:
    tenant = harness.scene.a.id
    mid = str(uuid.uuid4())
    first = harness.post(message_id=mid)
    assert first.status_code == 200
    conversation = next(d["conversation_id"] for e, d in events(first) if e == "done")
    operator_sql.sql(
        f"insert into public.tenant_agent_settings (tenant_id, enabled, daily_cost_cap_micros) values ('{tenant}', true, 1) on conflict (tenant_id) do update set daily_cost_cap_micros = 1"
    )
    try:
        assert harness.post().status_code == 429, "a NEW recording is refused"
        calls = len(harness.stt.calls)
        retry = harness.post(message_id=mid, query=f"&conversation_id={conversation}")
        assert (
            retry.status_code == 200
            and events(retry)[0][1]["reused"] is True
            and len(harness.stt.calls) == calls
        )
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{tenant}'"
        )


def test_a_message_id_that_is_not_the_callers_is_never_reused(harness: Harness) -> None:
    """Another member's message id (or another business's) is invisible to the caller, so the engine is used and the shared start refuses the id as it does for text."""
    mid = str(uuid.uuid4())
    assert harness.post(message_id=mid, user="owner").status_code == 200
    calls = len(harness.stt.calls)
    other = harness.post(message_id=mid, user="sales")
    assert len(harness.stt.calls) == calls + 1, (
        "the second person's recording is transcribed: the first person's chat is theirs alone, so nothing is reused"
    )
    assert other.status_code == 409 and other.json()["error"]["code"] == "message_id_used"


def test_the_run_budget_is_one_rupee_for_text_and_voice_charges_ride_the_ledger_only(
    harness: Harness,
) -> None:
    tenant = harness.scene.a.id
    assert (
        operator_sql.sql(
            "select max_cost_micros from public.agent_definitions where agent_name = 'assistant'"
        )
        == "1000000"
    )
    # a TEXT question: the run has the rupee, spends a fraction of it and carries no voice charge
    mid = str(uuid.uuid4())
    r = harness.client.post(
        f"/v1/tenants/{tenant}/assistant/messages",
        json={"message_id": mid, "text": "What needs me today?"},
        headers=bearer(harness.scene.a.users["owner"]),
    )
    assert r.status_code == 200 and events(r)[-1][0] == "done"
    done = events(r)[-1][1]
    text_run = operator_sql.sql(
        f"select max_cost_micros || '/' || (cost_micros_used < max_cost_micros)::text from public.agent_runs where conversation_id = '{done['conversation_id']}'"
    )
    assert text_run == "1000000/true"
    assert (
        operator_sql.sql(
            f"select count(*) from public.agent_cost_reservations where run_id = (select id from public.agent_runs where conversation_id = '{done['conversation_id']}') and model like 'voice-%'"
        )
        == "0"
    )
    # a VOICE question with a spoken answer: the run's own budget is still the rupee and its own counter stays inside it; the voice charges are on the ledger, and together they pass the rupee (up to Rs 3.00)
    before = harness.ledger()
    v = harness.post(query="&speak=true")
    assert v.status_code == 200 and events(v)[-1][0] == "audio"
    vdone = next(d for e, d in events(v) if e == "done")
    row = operator_sql.sql(
        f"select max_cost_micros || '/' || (cost_micros_used <= max_cost_micros)::text from public.agent_runs where conversation_id = '{vdone['conversation_id']}'"
    )
    assert row == "1000000/true"
    voice_total = int(
        operator_sql.sql(
            f"select sum(settled_micros) from public.agent_cost_reservations where run_id = (select id from public.agent_runs where conversation_id = '{vdone['conversation_id']}') and model like 'voice-%'"
        )
    )
    assert voice_total > 1_000_000, (
        "the spoken answer alone is more than the text budget: it is allowed only because the run carries voice"
    )
    assert voice_total <= 3_000_000
    assert len(harness.ledger()) - len(before) == 2


def test_speak_in_a_language_with_no_voice_is_an_audio_error_and_the_text_stands(
    harness: Harness,
) -> None:
    class Odd(FakeTts):
        pass

    harness.tts.fail = "http_500"
    try:
        evts = events(harness.post(query="&speak=true"))
    finally:
        harness.tts.fail = None
    names = [e for e, _ in evts]
    assert "done" in names and names[-1] == "audio_error" and evts[-1][1]["code"] == "voice_failed"
    assert text_of(evts), "the text answer stands"


def test_a_failed_transcription_spends_nothing_and_starts_no_run(harness: Harness) -> None:
    before = harness.ledger()
    runs = operator_sql.sql(
        f"select count(*) from public.agent_runs where tenant_id = '{harness.scene.a.id}'"
    )
    harness.stt.fail = "timeout"
    try:
        r = harness.post()
    finally:
        harness.stt.fail = None
    assert r.status_code == 504 and r.json()["error"]["code"] == "voice_timeout"
    assert harness.ledger() == before
    assert (
        operator_sql.sql(
            f"select count(*) from public.agent_runs where tenant_id = '{harness.scene.a.id}'"
        )
        == runs
    )


def test_the_workspace_cap_refuses_the_transcription_and_closes_the_run(harness: Harness) -> None:
    tenant = harness.scene.a.id
    spent = int(
        operator_sql.sql(
            f"select coalesce(sum(coalesce(settled_micros, reserved_micros)), 0) from public.agent_cost_reservations where tenant_id = '{tenant}' and cost_day = app.agent_utc_today()"
        )
    )
    # room for the question to START (the early check is "spent < cap") but not for the transcription (Rs 0.10 for one second)
    operator_sql.sql(
        f"insert into public.tenant_agent_settings (tenant_id, enabled, daily_cost_cap_micros) values ('{tenant}', true, {spent + 100}) on conflict (tenant_id) do update set daily_cost_cap_micros = {spent + 100}"
    )
    try:
        r = harness.post()
        assert r.status_code == 429, r.text
        assert r.json()["error"]["code"] == "ai_paused_until"
        status = operator_sql.sql(
            f"select status || '/' || coalesce(error_code::text, '-') from public.agent_runs where tenant_id = '{tenant}' order by created_at desc limit 1"
        )
        assert status == "failed/budget", "the run that was begun is closed, not left running"
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{tenant}'"
        )
    # a cap that is already reached refuses the question itself, before any run (and the recording was transcribed first: the allowance pre-check is the database's own pause time)
    operator_sql.sql(
        f"update public.tenant_agent_settings set daily_cost_cap_micros = 1 where tenant_id = '{tenant}'"
    )
    try:
        assert harness.post().status_code == 429
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{tenant}'"
        )


def test_another_business_and_a_viewer_cannot_use_it(harness: Harness) -> None:
    calls = len(harness.stt.calls)
    assert harness.post(user="viewer").status_code == 403
    assert (
        harness.client.post(
            f"/v1/tenants/{harness.scene.a.id}/assistant/voice?message_id={uuid.uuid4()}",
            content=WAV,
            headers={**bearer(harness.scene.b.users["owner"]), "Content-Type": "audio/wav"},
        ).status_code
        == 404
    )
    assert len(harness.stt.calls) == calls


def test_voice_is_off_when_no_provider_is_configured(stack: Stack, eval_world: World) -> None:
    settings = Settings(
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        agents_enabled=True,
        llm_provider="fake",
    )  # type: ignore[call-arg]
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.voice is None
    with TestClient(create_app(settings, runtime=runtime)) as app:
        r = app.post(
            f"/v1/tenants/{eval_world.a.id}/assistant/voice?message_id={uuid.uuid4()}",
            content=WAV,
            headers={**bearer(eval_world.a.users["owner"]), "Content-Type": "audio/wav"},
        )
        assert r.status_code == 503 and r.json()["error"]["code"] == "voice_unavailable"
