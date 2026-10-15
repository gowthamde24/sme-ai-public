"""Job CV: the voice note on the worker's side, with fakes (no database, no network, no provider). Proved here: the hook asks the database whether a claimed message is a voice note and speaks only what the
database returned; seconds are recorded BEFORE the audio goes anywhere; every kind of trouble sends the TEXT alone; the audio is held in memory only (never in a log or a repr); the tick passes the hook to the release
phase and the worker builds it from the settings; the WhatsApp adapter sends the audio AFTER the text, inside the 24-hour window only, in a form WhatsApp accepts, best effort."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any

import httpx
import pytest

from app.outbox.adapter import AudioClip, LocalFakeAdapter, OutgoingMessage, SendContext
from app.outbox.service import dispatch_due
from app.outbox.voice_hook import VoiceNotes
from app.scheduler.tick import run_tick
from app.tenancy.repository import UpstreamError
from app.voice.fake import FakeTts, tone
from app.voice.interface import Speech
from app.whatsapp.adapter import WhatsAppCloudAdapter
from app.whatsapp.fake_graph import FakeGraph
from app.whatsapp.graph import GraphClient
from app.whatsapp.tokens import TokenResolver
from tests.scheduler_fakes import PHONE, FakeScheduler, claim_item

TOKEN = "worker-token"  # noqa: S105
T1 = uuid.UUID(int=0x71)
M1 = uuid.UUID(int=1)
PNI = "100000000000001"
WA_PHONE = "+919876543210"
PLAN: dict[str, Any] = {"voice": True, "voice_code": "fake-en", "speed": 1.0, "language": "en", "text": "This is an automated voice message from the AI assistant of Silks. Fee reminder: pay by Friday.", "chars": 88}


def world(plan: dict[str, Any] | None = PLAN, tts: Any = None) -> tuple[FakeScheduler, VoiceNotes, FakeTts]:
    db = FakeScheduler()
    db.listed = [T1]
    db.claims[T1] = [[claim_item(1)]]
    if plan is not None:
        db.voice_plans[M1] = plan
    speech = tts or FakeTts()
    return db, VoiceNotes(db, speech), speech


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the hook
def test_a_voice_note_is_made_from_the_text_the_database_returned_and_its_seconds_are_recorded() -> None:
    db, voice, tts = world()
    clip = voice.clip_for(TOKEN, T1, M1)
    assert clip is not None and clip.content_type == "audio/wav" and clip.seconds >= 1
    assert tts.calls == [(len(PLAN["text"]), "en")], "the provider was given the database's text and language, nothing else"
    (record,) = db.args("scheduler_voice_record")
    assert record == {"p_tenant_id": str(T1), "p_message_id": str(M1), "p_language": "en", "p_voice_code": "fake-en", "p_seconds": clip.seconds, "p_chars": len(PLAN["text"])}
    assert db.names() == ["scheduler_voice_plan", "scheduler_voice_record"]


def test_the_seconds_are_recorded_before_the_audio_is_handed_over_and_a_refused_record_means_no_audio() -> None:
    db, voice, _ = world()
    db.fail["scheduler_voice_record"] = UpstreamError("down")
    assert voice.clip_for(TOKEN, T1, M1) is None, "an unrecorded note is never sent"


@pytest.mark.parametrize("reason", ["module_off", "voice_off", "not_a_campaign_message", "campaign_text_only", "no_voice_for_language", "disclosure_not_reviewed", "allowance_used", "too_long"])
def test_every_reason_the_database_gives_means_the_text_goes_alone(reason: str) -> None:
    db, voice, tts = world({"voice": False, "reason": reason})
    assert voice.clip_for(TOKEN, T1, M1) is None
    assert tts.calls == [] and "scheduler_voice_record" not in db.names(), "nothing was spoken and nothing was counted"


def test_no_speech_provider_means_no_question_to_the_database_at_all() -> None:
    db, _, _ = world()
    assert VoiceNotes(db, None).clip_for(TOKEN, T1, M1) is None
    assert db.names() == []


@pytest.mark.parametrize(
    "plan",
    [
        {**PLAN, "text": ""}, {**PLAN, "text": "x" * 601}, {**PLAN, "text": None}, {**PLAN, "language": "fr"}, {**PLAN, "language": None}, {**PLAN, "voice_code": None}, {"voice": "yes"}, {"voice": True},
    ],
)  # fmt: skip
def test_a_plan_of_an_unexpected_shape_is_not_spoken(plan: dict[str, Any]) -> None:
    db, voice, tts = world(plan)
    assert voice.clip_for(TOKEN, T1, M1) is None and tts.calls == []


def test_a_provider_failure_or_unreadable_audio_or_a_database_error_sends_the_text_alone_and_never_raises() -> None:
    db, voice, _ = world(tts=FakeTts(fail="timeout"))
    assert voice.clip_for(TOKEN, T1, M1) is None and "scheduler_voice_record" not in db.names()

    class Junk:
        name = "junk"

        def synthesize(self, text: str, language: str) -> Speech:
            return Speech(b"not audio at all, just some bytes " * 20, "audio/wav")

    db, voice, _ = world(tts=Junk())
    assert voice.clip_for(TOKEN, T1, M1) is None and "scheduler_voice_record" not in db.names()

    class Long:
        name = "long"

        def synthesize(self, text: str, language: str) -> Speech:
            return Speech(tone(61.0, rate=8000), "audio/wav")

    db, voice, _ = world(tts=Long())
    assert voice.clip_for(TOKEN, T1, M1) is None and "scheduler_voice_record" not in db.names(), "over a minute is never sent"
    db, voice, _ = world()
    db.fail["scheduler_voice_plan"] = UpstreamError("down")
    assert voice.clip_for(TOKEN, T1, M1) is None


def test_neither_the_words_nor_the_audio_reach_a_log_or_a_repr(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    db, voice, _ = world(tts=FakeTts(fail="http_500"))
    voice.clip_for(TOKEN, T1, M1)
    db, voice, _ = world()
    clip = voice.clip_for(TOKEN, T1, M1)
    assert clip is not None
    assert "Fee reminder" not in caplog.text and "automated voice" not in caplog.text
    assert "RIFF" not in repr(clip) and "audio=" not in repr(clip).replace("seconds", ""), "the bytes are not in the repr"
    assert "Fee reminder" not in repr(OutgoingMessage(M1, PHONE, "Fee reminder", "en", audio=clip)), "the text is not in the repr either"


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the dispatch loop and the tick
def test_dispatch_hands_the_clip_to_the_adapter_with_the_text_and_marks_the_message_sent() -> None:
    db, voice, _ = world()
    adapter = LocalFakeAdapter()
    done = dispatch_due(db, adapter, TOKEN, T1, voice=voice.clip_for)
    assert (done.sent, done.failed) == (1, 0)
    (sent,) = adapter.sent
    assert sent.audio is not None and sent.audio.content_type == "audio/wav" and sent.body == claim_item(1)["body"], "the TEXT goes whatever the audio is"
    assert sent.audio_key == f"{M1}:audio"
    assert db.args("scheduler_mark")[0]["p_outcome"] == "sent"


def test_dispatch_without_a_hook_or_with_a_hook_that_says_no_sends_text_only() -> None:
    db, _, _ = world()
    adapter = LocalFakeAdapter()
    dispatch_due(db, adapter, TOKEN, T1)
    assert adapter.sent[0].audio is None and "scheduler_voice_plan" not in db.names()
    db, voice, _ = world({"voice": False, "reason": "voice_off"})
    adapter = LocalFakeAdapter()
    done = dispatch_due(db, adapter, TOKEN, T1, voice=voice.clip_for)
    assert done.sent == 1 and adapter.sent[0].audio is None


def test_a_hook_that_raises_is_not_trusted_to_be_polite_but_the_tick_does_not_stop() -> None:
    db, _, _ = world()

    def boom(token: str, tenant: uuid.UUID, message: uuid.UUID) -> AudioClip | None:
        raise RuntimeError("never raised by VoiceNotes; a bad custom hook must not lose the batch")

    result = run_tick(db, LocalFakeAdapter(), TOKEN, interval_seconds=60, voice=boom)
    assert result.tally.errors >= 1, "the release phase failed and was counted; the other phases still ran"
    assert "scheduler_mark_no_shows" in db.names()


def test_the_tick_passes_the_hook_to_the_release_phase() -> None:
    db, voice, _ = world()
    adapter = LocalFakeAdapter()
    result = run_tick(db, adapter, TOKEN, interval_seconds=60, voice=voice.clip_for)
    assert result.tally.sent == 1 and adapter.sent[0].audio is not None
    assert db.names().index("scheduler_voice_plan") > db.names().index("scheduler_claim_due")
    assert db.names().index("scheduler_voice_record") < db.names().index("scheduler_mark")


def test_a_message_offered_again_is_recorded_by_the_database_once_not_by_this_code() -> None:
    """The repeat of a lapsed claim asks the database again; the database's `on conflict do nothing` counts the message once (pgTAP 108). Here: the hook does not remember anything itself."""
    db, voice, _ = world()
    db.claims[T1] = [[claim_item(1)], [claim_item(1)]]
    adapter = LocalFakeAdapter()
    dispatch_due(db, adapter, TOKEN, T1, voice=voice.clip_for)
    dispatch_due(db, adapter, TOKEN, T1, voice=voice.clip_for)
    assert db.names().count("scheduler_voice_record") == 2 and all(m.audio is not None for m in adapter.sent)


# ------------------------------------------------------------------------------------------------------------------------------------------------------ the WhatsApp adapter
def adapter_with(graph: FakeGraph) -> WhatsAppCloudAdapter:
    return WhatsAppCloudAdapter(GraphClient("https://graph.example.test", "v25.0", client=httpx.Client(transport=graph.transport())), TokenResolver("fake-token"))


def clip(content_type: str = "audio/ogg") -> AudioClip:
    return AudioClip(b"OggS" + b"\x00" * 400, content_type, 3)


def message(*, window: bool = True, audio: AudioClip | None = None, body: str = "Fee reminder: pay by Friday.") -> OutgoingMessage:
    return OutgoingMessage(M1, WA_PHONE, body, "en", (), 1, SendContext(PNI, "ref", window), audio=audio)


def test_the_audio_goes_after_the_text_inside_the_window() -> None:
    graph = FakeGraph()
    graph.inbound_from(WA_PHONE)
    result = adapter_with(graph).send(message(audio=clip()))
    assert result.ok and result.adapter_message_id == "wamid.FAKE000001", "the id of the message is the text's"
    assert [s["type"] for s in graph.sent] == ["text", "audio"]
    assert graph.sent[1]["payload"]["audio"] == {"id": graph.media_uploaded[0]["id"]} and graph.sent[1]["payload"]["biz_opaque_callback_data"] == f"{M1}:audio"
    assert graph.media_uploaded[0]["content_type"] == "audio/ogg"


def test_outside_the_window_the_template_goes_and_the_audio_is_left_out() -> None:
    graph = FakeGraph()
    graph.approve_template("fee_reminder", "en")
    from app.outbox.adapter import TemplateRef

    msg = OutgoingMessage(M1, WA_PHONE, "Fee reminder: pay by Friday.", "en", (), 1, SendContext(PNI, "ref", False, TemplateRef("fee_reminder", "en", "Hello {{1}}")), audio=clip())
    result = adapter_with(graph).send(msg)
    assert result.ok and [s["type"] for s in graph.sent] == ["template"] and graph.media_uploaded == []


def test_a_form_whatsapp_does_not_accept_is_left_out_and_the_text_still_goes() -> None:
    graph = FakeGraph()
    graph.inbound_from(WA_PHONE)
    result = adapter_with(graph).send(message(audio=clip("audio/wav")))
    assert result.ok and [s["type"] for s in graph.sent] == ["text"] and graph.media_uploaded == []


def test_a_refused_text_is_a_failed_message_with_or_without_audio_and_a_bad_token_is_not_configured() -> None:
    graph = FakeGraph()
    graph.inbound_from(WA_PHONE)
    graph.fail(WA_PHONE, 400, 131026, times=1)  # the first send is the text
    result = adapter_with(graph).send(message(audio=clip()))
    assert not result.ok and result.failure_code == "recipient_unreachable" and graph.media_uploaded == [], "no audio is uploaded for a message whose text was refused"
    graph = FakeGraph(tokens={"another"})
    graph.inbound_from(WA_PHONE)
    assert adapter_with(graph).send(message(audio=clip())).failure_code == "not_configured"


def test_a_refused_audio_message_does_not_change_the_outcome() -> None:
    class RefusesAudio(FakeGraph):
        def _message(self, phone_number_id: str, p: dict[str, Any]) -> tuple[int, dict[str, Any]]:
            if p.get("type") == "audio":
                return 400, {"error": {"code": 131053, "message": "refused"}}
            return super()._message(phone_number_id, p)

    graph = RefusesAudio()
    graph.inbound_from(WA_PHONE)
    result = adapter_with(graph).send(message(audio=clip()))
    assert result.ok and result.adapter_message_id == "wamid.FAKE000001" and [s["type"] for s in graph.sent] == ["text"]


def test_a_text_that_went_is_never_resent_because_the_audio_failed() -> None:
    class Flaky(FakeGraph):
        def _media(self, phone_number_id: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, Any]]:
            return 500, {"error": {"code": 1, "message": "down"}}

    graph = Flaky()
    graph.inbound_from(WA_PHONE)
    result = adapter_with(graph).send(message(audio=clip()))
    assert result.ok and result.retry is False and [s["type"] for s in graph.sent] == ["text"], "the message is sent; the audio is best effort"


def test_the_fake_graph_checks_what_meta_checks_for_audio() -> None:
    graph = FakeGraph()
    graph.inbound_from(WA_PHONE)
    status, _ = graph.handle("POST", "/v25.0/" + PNI + "/messages", {"authorization": "Bearer fake-token"}, b'{"messaging_product":"whatsapp","to":"+919876543210","type":"audio","audio":{"id":"never-uploaded"}}')
    assert status == 400, "an audio message must name a media id the business uploaded"
    status, _ = graph.handle("POST", "/v25.0/" + PNI + "/media", {"authorization": "Bearer fake-token", "content-type": "multipart/form-data; boundary=x"}, b"nothing useful")
    assert status == 400
