"""Night 3 part 1 (ADR 0101): the one speech switch, Sarvam in six languages, the listening-sample planner with its hard caps, the word accuracy, and the sample/STT script against a fake provider.
No network and no key: the script's provider and key reader are replaced, and the recorded response is a generated tone."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import importlib.util
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.voice import samples
from app.voice.convert import FfmpegConverter
from app.voice.factory import build_note_voice, build_voice
from app.voice.fake import FakeTts, tone
from app.voice.interface import LANGUAGES, TAGS, Speech, Transcript
from app.voice.sarvam import SarvamStt, SarvamTts

KEY = "sk-test-sarvam-key-0987654321"  # noqa: S105 - a fixture
WAV = tone(5.0, rate=8000)
SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "voice_samples.py"


def settings(**over: Any) -> Settings:
    return Settings(_env_file=None, api_env="development", **over)  # type: ignore[call-arg]


def client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


# ------------------------------------------------------------------------------------ the one switch
def test_the_switch_is_empty_by_default_and_changes_nothing() -> None:
    assert settings().speech_provider == ""
    assert build_voice(settings()) is None
    assert build_voice(settings(sarvam_api_key=SecretStr(KEY))) is None, "a key alone still switches nothing on"


def test_sarvam_on_the_switch_builds_speech_to_text_and_text_to_speech() -> None:
    stack = build_voice(settings(speech_provider="sarvam", sarvam_api_key=SecretStr(KEY)))
    assert stack is not None and stack.stt is not None and stack.tts is not None
    assert stack.stt.name == "sarvam" and stack.tts.name == "sarvam"
    assert KEY not in repr(stack)


def test_sarvam_on_the_switch_without_a_key_stops_the_process() -> None:
    with pytest.raises(ConfigurationError):
        build_voice(settings(speech_provider="sarvam"))


def test_an_explicit_voice_provider_wins_over_the_switch() -> None:
    stack = build_voice(settings(speech_provider="sarvam", sarvam_api_key=SecretStr(KEY), voice_stt_provider="fake", voice_tts_provider="fake"))
    assert stack is not None and stack.stt is not None and stack.stt.name == "fake"


def test_the_fake_switch_is_for_development_and_a_wrong_word_is_refused() -> None:
    stack = build_voice(settings(speech_provider="fake"))
    assert stack is not None and stack.stt is not None and stack.stt.name == "fake"
    with pytest.raises(ConfigurationError):
        build_voice(Settings(_env_file=None, api_env="production", speech_provider="fake"))  # type: ignore[call-arg]
    with pytest.raises(ConfigurationError):
        build_voice(settings(speech_provider="cartesia"))


def test_voice_notes_follow_the_switch_and_sarvam_notes_are_always_coded_for_whatsapp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(FfmpegConverter, "available", lambda self: True)
    tts, converter = build_note_voice(settings(speech_provider="sarvam", sarvam_api_key=SecretStr(KEY)))
    assert tts is not None and tts.name == "sarvam" and converter is not None, "Sarvam gives WAV; the converter makes the OGG/Opus WhatsApp plays"
    monkeypatch.setattr(FfmpegConverter, "available", lambda self: False)
    with pytest.raises(ConfigurationError):
        build_note_voice(settings(speech_provider="sarvam", sarvam_api_key=SecretStr(KEY)))


def test_the_fake_switch_keeps_a_worker_that_has_a_key_silent() -> None:
    tts, converter = build_note_voice(settings(speech_provider="fake", sarvam_api_key=SecretStr(KEY)))
    assert isinstance(tts, FakeTts) and converter is None


# ------------------------------------------------------------------------------------ six languages
def test_malayalam_and_tamil_are_voice_languages() -> None:
    assert set(LANGUAGES) == {"en", "te", "hi", "kn", "ta", "ml"} and TAGS["ml"] == "ml-IN"


@pytest.mark.parametrize(("lang", "tag"), [("en", "en-IN"), ("te", "te-IN"), ("hi", "hi-IN"), ("kn", "kn-IN"), ("ta", "ta-IN"), ("ml", "ml-IN")])
def test_sarvam_text_to_speech_sends_the_tag_the_pace_and_the_temperature(lang: str, tag: str) -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"], seen["key"] = json.loads(request.read()), request.headers.get("api-subscription-key")
        return httpx.Response(200, json={"request_id": "r", "audios": [base64.b64encode(WAV).decode()]})

    speech = SarvamTts(KEY, client=client(handler)).synthesize("x y", lang, speaker="ritu", pace=3.0, temperature=0.0)
    assert speech.audio == WAV and speech.content_type == "audio/wav"
    assert seen["json"]["language_code"] == tag and seen["json"]["speaker"] == "ritu"
    assert seen["json"]["output_audio_codec"] == "wav", "Bulbul v3 refuses opus; WhatsApp audio is coded from this WAV by the converter"
    assert seen["json"]["pace"] == 2.0 and seen["json"]["temperature"] == 0.01, "both are held inside the provider's range"
    assert seen["key"] == KEY


def test_sarvam_speech_to_text_hears_malayalam() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert b"ml-IN" in request.read()
        return httpx.Response(200, json={"transcript": " നമസ്കാരം ", "language_code": "ml-IN"})

    assert SarvamStt(KEY, client=client(handler)).transcribe(WAV, "audio/wav", "ml") == Transcript("നമസ്കാരം", "ml")


# ------------------------------------------------------------------------------------ the sample planner
def test_the_plan_is_six_languages_three_voices_two_styles_three_lines() -> None:
    clips = samples.plan()
    assert len(clips) == 6 * 3 * 2 * 3 == 108
    assert len({c.path for c in clips}) == 108 and {c.lang for c in clips} == set(samples.LANGS)
    assert all(c.path.startswith(f"{c.lang}/") and c.path.endswith(".wav") for c in clips)


def test_the_whole_plan_fits_under_the_character_cap_and_the_first_pass_covers_every_language() -> None:
    clips = samples.plan()
    assert sum(len(c.text) for c in clips) <= samples.TTS_CHAR_CAP == 9000
    first = clips[:18]
    assert {(c.lang, c.n) for c in first} == {(lang, n) for lang in samples.LANGS for n in (1, 2, 3)}, "a stop at the cap leaves every language covered"


def test_the_cap_stops_before_it_is_passed_and_counts_earlier_runs() -> None:
    clips = samples.plan()
    kept, chars = samples.within_cap(clips, cap=1000)
    assert chars <= 1000 and kept == clips[: len(kept)] and len(kept) < len(clips)
    assert sum(len(c.text) for c in clips[: len(kept) + 1]) > 1000, "it stops at the first clip that does not fit"
    kept2, chars2 = samples.within_cap(clips, cap=1000, already_sent=990)
    assert chars2 <= 10 and len(kept2) == 0
    assert samples.within_cap(clips, cap=0) == ([], 0)


def test_the_opening_says_it_is_an_ai_assistant_and_the_school_line_never_speaks_of_money() -> None:
    for lang, (opening, saree, school) in samples.LINES.items():
        assert "AI" in opening, f"{lang}: the opening says it is an AI assistant"
        for text in (opening, saree, school):
            assert 0 < len(text) <= 100, "short, spoken lines"
        # a school line never speaks of fees, marks or dues
        assert not any(w in school.lower() for w in ("fee", "marks", "due", "ఫీజు", "फीस", "ಶುಲ್ಕ", "கட்டணம்", "ഫീസ്")), lang


def test_stt_picks_are_two_clips_per_language_from_the_first_voice() -> None:
    picks = samples.stt_picks(samples.plan())
    assert len(picks) == 12 and all(p.voice == samples.VOICES[0] and p.style == "warm" and p.n in (1, 2) for p in picks)
    assert samples.stt_picks([]) == []


def test_wav_seconds_and_word_accuracy() -> None:
    assert samples.wav_seconds(tone(2.0, rate=8000)) == pytest.approx(2.0, abs=0.01)
    assert samples.word_accuracy("Hello, my name is Vijaya.", "hello my name is vijaya") == 1.0
    assert samples.word_accuracy("a b c d", "a b x d") == 0.75
    assert samples.word_accuracy("a b", "") == 0.0 and samples.word_accuracy("", "") == 1.0 and samples.word_accuracy("a", "x y z") == 0.0
    assert samples.word_accuracy("నమస్తే నేను", "నమస్తే‌ నేను") == 1.0


def test_the_listening_page_escapes_the_text_and_has_no_script() -> None:
    clip = samples.Clip("en", "ritu", "warm", 1, "<b>hi</b> & bye")
    page = samples.index_html([clip], {"chars_total": 15})
    assert "&lt;b&gt;hi&lt;/b&gt; &amp; bye" in page and "<script" not in page and 'src="en/ritu-warm-1.wav"' in page and "15 of 9000" in page


# ------------------------------------------------------------------------------------ the script, with a fake provider
def load_script() -> Any:
    spec = importlib.util.spec_from_file_location("voice_samples_script", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RecordingTts:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None, float | None, float | None]] = []

    def synthesize(self, text: str, language: str, *, speaker: str | None = None, pace: float | None = None, temperature: float | None = None) -> Speech:
        self.calls.append((text, language, speaker, pace, temperature))
        return Speech(WAV, "audio/wav")


def test_the_script_renders_every_clip_once_and_resumes_without_paying_again(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    script = load_script()
    fake = RecordingTts()
    monkeypatch.setattr(script, "read_key", lambda: KEY)
    monkeypatch.setattr(script, "SarvamTts", lambda key, model: fake)
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    script.render(tmp_path, dry=False)
    assert len(fake.calls) == 108 and len(list(tmp_path.glob("*/*.wav"))) == 108
    usage = json.loads((tmp_path / "usage.json").read_text())
    assert usage["chars_total"] == sum(len(c.text) for c in samples.plan()) <= 9000
    assert (tmp_path / "index.html").exists()
    assert KEY not in capsys.readouterr().out and KEY not in (tmp_path / "index.html").read_text() + json.dumps(usage)
    script.render(tmp_path, dry=False)
    assert len(fake.calls) == 108, "a second run sends nothing"


def test_the_script_stops_at_the_cap_kept_across_runs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    fake = RecordingTts()
    (tmp_path / "usage.json").write_text(json.dumps({"chars_total": 8900, "stt_seconds_total": 0.0, "runs": []}))
    monkeypatch.setattr(script, "read_key", lambda: KEY)
    monkeypatch.setattr(script, "SarvamTts", lambda key, model: fake)
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    script.render(tmp_path, dry=False)
    sent = sum(len(call[0]) for call in fake.calls)
    assert sent <= 100 and json.loads((tmp_path / "usage.json").read_text())["chars_total"] <= 9000


def test_a_dry_run_reads_no_key_and_sends_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()

    def boom() -> str:
        raise AssertionError("no key may be read in a dry run")

    monkeypatch.setattr(script, "read_key", boom)
    script.render(tmp_path, dry=True)
    script.stt_check(tmp_path, dry=True)
    assert not list(tmp_path.glob("*/*.wav"))


def test_the_speech_to_text_check_reports_accuracy_and_keeps_to_the_seconds_cap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    for clip in samples.stt_picks(samples.plan()):
        (tmp_path / clip.path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / clip.path).write_bytes(WAV)   # 5 seconds each: 12 clips = 60 seconds

    class Hears:
        def transcribe(self, audio: bytes, content_type: str, language: str | None, keyterms: Any = ()) -> Transcript:
            return Transcript(next(c.text for c in samples.plan() if c.lang == language and c.voice == "ritu" and c.style == "warm" and c.n == 1))

    monkeypatch.setattr(script, "read_key", lambda: KEY)
    monkeypatch.setattr(script, "SarvamStt", lambda key, model: Hears())
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    script.stt_check(tmp_path, dry=False)
    rows = json.loads((tmp_path / "stt-report.json").read_text())["rows"]
    assert len(rows) == 12 and {r["word_accuracy"] for r in rows if r["clip"].endswith("-1.wav")} == {1.0}
    assert json.loads((tmp_path / "usage.json").read_text())["stt_seconds_total"] == pytest.approx(60.0, abs=0.5)
    # a later run cannot go over 180 seconds in total
    usage = json.loads((tmp_path / "usage.json").read_text())
    usage["stt_seconds_total"] = 178.0
    (tmp_path / "usage.json").write_text(json.dumps(usage))
    calls = len(rows)
    script.stt_check(tmp_path, dry=False)
    assert json.loads((tmp_path / "usage.json").read_text())["stt_seconds_total"] <= 183.0 and calls == 12
