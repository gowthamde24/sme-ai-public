"""Job DJ (ADR 0093): real voice notes groundwork with fakes (no network, no key, no ffmpeg needed). The Sarvam adapter's request for each language, the choice of provider (fake by default only in development),
the hook that pairs a voice with ITS provider, speaks with the chosen speaker and pace, codes the audio for WhatsApp and records the seconds, the WhatsApp adapter sending an OGG/Opus clip, and the rule that
no child's name or field can reach the speech."""

from __future__ import annotations

import base64
import json
import re
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.outbox.adapter import OutgoingMessage, SendContext
from app.outbox.voice_hook import VoiceNotes
from app.voice.convert import CONTENT_TYPE, FfmpegConverter
from app.voice.factory import build_note_voice
from app.voice.fake import FakeTts, tone
from app.voice.interface import VoiceError
from app.voice.sarvam import SarvamTts
from app.whatsapp.adapter import WhatsAppCloudAdapter
from app.whatsapp.fake_graph import FakeGraph
from app.whatsapp.graph import GraphClient
from app.whatsapp.tokens import TokenResolver
from tests.scheduler_fakes import FakeScheduler, claim_item
from tests.test_dj_convert import OGG, runner

APP = Path(__file__).resolve().parents[1] / "app"
SECRET = "sk_test_fake_do-not-log_0123456789"  # noqa: S105 - a fixture
TOKEN = "worker-token"  # noqa: S105
T1 = uuid.UUID(int=0x71)
M1 = uuid.UUID(int=1)
WAV = tone(1.2)


def settings(**env: Any) -> Settings:
    return Settings(_env_file=None, api_env=env.pop("api_env", "development"), **env)  # type: ignore[call-arg]


# ------------------------------------------------------------------------------------------------ the Sarvam adapter
def sarvam(handler: Any) -> SarvamTts:
    return SarvamTts(SECRET, client=httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.mark.parametrize(("language", "tag"), [("te", "te-IN"), ("hi", "hi-IN"), ("kn", "kn-IN"), ("en", "en-IN"), ("ta", "ta-IN")])
def test_each_language_is_asked_for_in_its_own_tag_with_the_chosen_speaker_and_pace(language: str, tag: str) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append({"json": json.loads(request.read()), "key": request.headers.get("api-subscription-key"), "url": str(request.url)})
        return httpx.Response(200, json={"audios": [base64.b64encode(WAV).decode()]})

    speech = sarvam(handler).synthesize("Namaste", language, speaker="kavya", pace=1.1)
    assert speech.audio == WAV and speech.content_type == "audio/wav"
    (call,) = seen
    assert call["url"] == "https://api.sarvam.ai/text-to-speech" and call["key"] == SECRET
    body = call["json"]
    assert body["language_code"] == tag and body["speaker"] == "kavya" and body["pace"] == 1.1
    assert body["model"] == "bulbul:v3" and body["output_audio_codec"] == "wav", "v3 refuses opus: the converter makes it"
    assert body["speech_sample_rate"] == 24000


def test_the_pace_is_kept_inside_what_the_provider_takes_and_the_speaker_falls_back_to_the_settings() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.read()))
        return httpx.Response(200, json={"audios": [base64.b64encode(WAV).decode()]})

    tts = SarvamTts(SECRET, speaker="shubh", client=httpx.Client(transport=httpx.MockTransport(handler)))
    tts.synthesize("x y", "hi", pace=9.0)
    tts.synthesize("x y", "hi", pace=0.01)
    tts.synthesize("x y", "hi", speaker="ritu")
    assert [b.get("pace") for b in bodies] == [2.0, 0.5, None]
    assert [b["speaker"] for b in bodies] == ["shubh", "shubh", "ritu"]


def test_an_answer_of_several_pieces_or_none_is_refused_and_no_error_holds_the_key() -> None:
    bad_bodies: list[dict[str, Any]] = [{"audios": []}, {"audios": [base64.b64encode(WAV).decode()] * 2}, {"audios": [3]}, {"nope": 1}]
    for body in bad_bodies:
        with pytest.raises(VoiceError) as caught:
            sarvam(lambda r, b=body: httpx.Response(200, json=b)).synthesize("x y", "te")
        assert caught.value.code == "bad_response" and SECRET not in str(caught.value) and SECRET not in repr(caught.value)
    with pytest.raises(VoiceError) as refused:
        sarvam(lambda r: httpx.Response(429, json={"error": {"message": "slow down"}})).synthesize("x y", "te")
    assert SECRET not in str(refused.value) and SECRET not in repr(sarvam(lambda r: httpx.Response(200)))


# ------------------------------------------------------------------------------------------------ the choice of provider
def test_with_nothing_configured_development_speaks_with_the_fake_and_a_deployment_not_at_all() -> None:
    tts, converter = build_note_voice(settings())
    assert isinstance(tts, FakeTts) and converter is None
    assert build_note_voice(settings(api_env="production")) == (None, None)


def test_a_key_selects_sarvam_and_sarvam_needs_ffmpeg_so_the_process_stops_at_start_without_it() -> None:
    cfg = dict(sarvam_api_key=SecretStr(SECRET), voice_note_ffmpeg="no-such-ffmpeg-program")
    with pytest.raises(ConfigurationError, match="ffmpeg"):
        build_note_voice(settings(**cfg))
    with pytest.raises(ConfigurationError, match="SARVAM_API_KEY"):
        build_note_voice(settings(voice_note_tts_provider="sarvam"))


def test_the_other_values_are_checked() -> None:
    with pytest.raises(ConfigurationError):
        build_note_voice(settings(voice_note_tts_provider="banana"))
    with pytest.raises(ConfigurationError, match="development"):
        build_note_voice(settings(api_env="production", voice_note_tts_provider="fake"))
    assert build_note_voice(settings(voice_note_tts_provider="off")) == (None, None)
    # the older switch still works for the worker
    tts, _ = build_note_voice(settings(voice_tts_provider="fake"))
    assert isinstance(tts, FakeTts)


# ------------------------------------------------------------------------------------------------ the hook
PLAN: dict[str, Any] = {"voice": True, "voice_code": "sarvam-kavya-te", "provider": "sarvam", "speaker": "kavya", "speed": 0.9, "language": "te",
                        "text": "This is an automated voice message from the AI assistant of Silks. Fee reminder: pay by Friday."}


class Recording(FakeTts):
    name = "sarvam"

    def __init__(self) -> None:
        super().__init__()
        self.asked: list[dict[str, Any]] = []

    def synthesize(self, text: str, language: str, *, speaker: str | None = None, pace: float | None = None) -> Any:
        self.asked.append({"text": text, "language": language, "speaker": speaker, "pace": pace})
        return super().synthesize(text, language)


def world(plan: dict[str, Any], tts: Any, converter: Any = None) -> tuple[FakeScheduler, VoiceNotes]:
    db = FakeScheduler()
    db.listed = [T1]
    db.claims[T1] = [[claim_item(1)]]
    db.voice_plans[M1] = plan
    return db, VoiceNotes(db, tts, converter)


def test_the_voice_is_spoken_with_its_speaker_and_pace_coded_for_whatsapp_and_the_seconds_come_from_the_providers_wav() -> None:
    tts = Recording()
    db, voice = world(PLAN, tts, FfmpegConverter(runner=runner()))
    clip = voice.clip_for(TOKEN, T1, M1)
    assert clip is not None and clip.audio == OGG and clip.content_type == CONTENT_TYPE == "audio/ogg; codecs=opus"
    assert tts.asked == [{"text": PLAN["text"], "language": "te", "speaker": "kavya", "pace": 0.9}]
    (record,) = db.args("scheduler_voice_record")
    assert record["p_seconds"] == clip.seconds >= 1 and record["p_voice_code"] == "sarvam-kavya-te" and record["p_language"] == "te"


@pytest.mark.parametrize("language", ["te", "hi", "kn", "en"])
def test_each_language_reaches_the_provider_as_itself(language: str) -> None:
    tts = Recording()
    _, voice = world({**PLAN, "language": language}, tts, FfmpegConverter(runner=runner()))
    assert voice.clip_for(TOKEN, T1, M1) is not None and tts.asked[0]["language"] == language


def test_a_voice_of_another_provider_is_never_spoken() -> None:
    tts = Recording()   # configured as sarvam
    for provider in ("fake", "google"):
        _, voice = world({**PLAN, "provider": provider}, tts, FfmpegConverter(runner=runner()))
        assert voice.clip_for(TOKEN, T1, M1) is None
    assert tts.asked == [], "the provider was not even called"
    _, fake_voice = world({**PLAN, "provider": "fake", "speaker": None}, FakeTts())
    assert fake_voice.clip_for(TOKEN, T1, M1) is not None, "the synthetic voice is spoken by the fake provider"


def test_when_the_audio_cannot_be_coded_the_text_goes_alone_and_nothing_is_recorded() -> None:
    for broken in (FfmpegConverter(runner=runner(returncode=1)), FfmpegConverter(runner=runner(raises=FileNotFoundError())), FfmpegConverter(runner=runner(stdout=b"RIFF" + b"\x00" * 99))):
        db, voice = world(PLAN, Recording(), broken)
        assert voice.clip_for(TOKEN, T1, M1) is None
        assert db.args("scheduler_voice_record") == [], "seconds are recorded only for audio that goes out"


def test_without_a_converter_the_providers_own_form_is_passed_on_as_before() -> None:
    _, voice = world({**PLAN, "provider": "fake", "speaker": None}, FakeTts())
    clip = voice.clip_for(TOKEN, T1, M1)
    assert clip is not None and clip.content_type == "audio/wav"


# ------------------------------------------------------------------------------------------------ WhatsApp plays it
def test_the_whatsapp_adapter_uploads_and_sends_an_ogg_opus_note_after_the_text() -> None:
    graph = FakeGraph()
    graph.inbound_from("+919876543210")
    adapter = WhatsAppCloudAdapter(GraphClient("https://graph.example.test", "v25.0", client=httpx.Client(transport=graph.transport())), TokenResolver("fake-token"))
    from app.outbox.adapter import AudioClip

    msg = OutgoingMessage(M1, "+919876543210", "Fee reminder: pay by Friday.", "te", (), 1, SendContext("100000000000001", "ref", True), audio=AudioClip(OGG, CONTENT_TYPE, 3))
    assert adapter.send(msg).ok
    assert [s["type"] for s in graph.sent] == ["text", "audio"]
    assert graph.media_uploaded[0]["content_type"] == "audio/ogg; codecs=opus"


# ------------------------------------------------------------------------------------------------ the child-name rule
CHILD = re.compile(r"child_label|admission_no|\bstudents?\b|programme_groups|institution_profiles|EducationRepository|\.education\b|app\.education|guardian")


def test_no_voice_code_knows_about_a_child() -> None:
    """A voice note is the words the Owner approved: the campaign's text with the fields name, amount, due_date, reference and business (the database refuses any other), preceded by the spoken disclosure. No code on
    the speech path reads a student, a child label, an admission number or the education tables, so a child's name cannot be spoken or sent by it (the structural twin of tests/test_cr_child_fields.py)."""
    files = [APP / "voice" / "convert.py", APP / "voice" / "sarvam.py", APP / "voice" / "factory.py", APP / "voice" / "interface.py", APP / "outbox" / "voice_hook.py"]
    for path in files:
        code = "\n".join(line for line in path.read_text(encoding="utf-8").split("\n") if not line.lstrip().startswith(("#", '"""')))
        assert CHILD.search(code) is None, f"{path.name} names a child field"


def test_the_only_text_that_reaches_the_speech_is_the_plan_text() -> None:
    canary = "Zorbax-the-child"
    tts = Recording()
    db, voice = world({**PLAN, "text": "This is an automated voice message. Fee reminder for the guardian: pay by Friday."}, tts, FfmpegConverter(runner=runner()))
    db.canary = canary  # type: ignore[attr-defined]   # a child's name exists in the world; the hook has no way to read it
    voice.clip_for(TOKEN, T1, M1)
    assert all(canary not in call["text"] for call in tts.asked)
