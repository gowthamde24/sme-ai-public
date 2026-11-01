"""Owner decision 31 Oct 2026: the speaker check, browser Live talk only. A different voice does not interrupt; no signature, too little speech or an unclear score is treated as the person; the signature lives in memory for
one session. The numbers (separation, latency) are in docs/runbooks/speaker-check.md; here the logic is pinned with a fake model, and the real model when a file is given."""

# ruff: noqa: E501
from __future__ import annotations

import array
import asyncio
import builtins
import os
import time
from typing import Any

import pytest

from app.browser_voice.limits import Limits
from app.browser_voice.session import Parts, VoiceSession
from app.conversation import speaker
from app.conversation.fakes import silence, tone
from tests.test_dv_browser_voice import FakeSocket, arun, session_of, until
from tests.test_oq_live_standard import long_answer_parts

RUNNING: list[asyncio.Future[str]] = []


class FakeVoice:
    """Stands in for SessionVoice: returns a fixed score, remembers what it was given."""

    def __init__(self, score: float | None) -> None:
        self.score = score
        self.ready = True
        self.enrolled: list[int] = []
        self.checked: list[int] = []
        self.closed = False

    def similarity(self, pcm: bytes) -> float | None:
        self.checked.append(len(pcm))
        return self.score

    def enrol(self, pcm: bytes) -> tuple[bool, float]:
        self.enrolled.append(len(pcm))
        return True, 1.0

    def close(self) -> None:
        self.closed = True


def parts_with(later: str) -> Parts:
    parts: Parts = long_answer_parts(later=later)
    return parts


async def interrupt(sock: FakeSocket, session: VoiceSession, speech_ms: int = 900) -> None:
    RUNNING.append(asyncio.ensure_future(session.run()))
    sock.feed_speech()
    await until(lambda: len(sock.audio) >= 2)
    sock.inbox.put_nowait(("text", {"type": "barge_in", "verify": True}))
    await until(lambda: "paused" in sock.types())
    for _ in range(speech_ms // 20):
        sock.inbox.put_nowait(("bytes", tone(20)))
    for _ in range(40):
        sock.inbox.put_nowait(("bytes", silence(20)))


def session_with(mode: str, score: float | None, later: str = "I meant five hundred") -> tuple[FakeSocket, VoiceSession, FakeVoice]:
    sock = FakeSocket()
    session = session_of(sock, parts_with(later), Limits(greeting=False))
    session.limits = Limits(greeting=False, speaker_check=mode)
    voice = FakeVoice(score)
    session._voice = voice   # type: ignore[assignment]  # noqa: SLF001
    return sock, session, voice


@arun
async def test_in_on_mode_a_voice_that_is_not_the_speaker_does_not_stop_the_reply() -> None:
    sock, session, voice = session_with("on", 0.10)
    await interrupt(sock, session)
    await until(lambda: "resumed" in sock.types(), seconds=8)
    speaker_msg = next(m for m in sock.json if m["type"] == "speaker")
    assert "interrupted" not in sock.types() and speaker_msg == {"type": "speaker", "mode": "on", "same": False, "ready": True, "score": 0.1, "ms": speaker_msg["ms"]}
    sock.inbox.put_nowait(("close", None))
    await asyncio.sleep(0.2)
    assert voice.closed and session._voice is None, "the signature is forgotten when the session ends"  # noqa: SLF001


@arun
async def test_the_same_voice_stops_the_reply_as_before() -> None:
    sock, session, _ = session_with("on", 0.80)
    await interrupt(sock, session)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    assert next(m for m in sock.json if m["type"] == "speaker")["same"] is True
    sock.inbox.put_nowait(("close", None))


@arun
async def test_no_signature_yet_or_too_little_speech_is_treated_as_the_person() -> None:
    sock, session, _ = session_with("on", None)
    await interrupt(sock, session)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    assert next(m for m in sock.json if m["type"] == "speaker")["same"] is None, "uncertain: stopping beats talking over the owner"
    sock.inbox.put_nowait(("close", None))


@arun
async def test_in_shadow_mode_it_measures_and_decides_nothing() -> None:
    sock, session, _ = session_with("shadow", 0.05)
    await interrupt(sock, session)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    assert next(m for m in sock.json if m["type"] == "speaker")["mode"] == "shadow"
    sock.inbox.put_nowait(("close", None))


@arun
async def test_a_stop_word_interrupts_whatever_the_voice() -> None:
    sock, session, voice = session_with("on", 0.02, later="wait one minute")
    await interrupt(sock, session, speech_ms=300)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    assert not voice.checked, "a stop word is not even scored"
    sock.inbox.put_nowait(("close", None))


@arun
async def test_a_confirmed_turn_is_added_to_the_signature_off_the_critical_path() -> None:
    sock = FakeSocket()
    session = session_of(sock, parts_with("x"), Limits(greeting=False))
    session.limits = Limits(greeting=False, speaker_check="on")
    voice = FakeVoice(0.9)
    session._voice = voice   # type: ignore[assignment]  # noqa: SLF001
    RUNNING.append(asyncio.ensure_future(session.run()))
    sock.feed_speech()
    await until(lambda: "timings" in sock.types(), seconds=10)
    assert len(voice.enrolled) == 1 and 32000 <= voice.enrolled[0] <= 8 * 32000 + 20000
    sock.inbox.put_nowait(("close", None))


def test_the_check_is_off_by_default_and_a_phone_call_never_has_one() -> None:
    from app.telephony.call_session import CallVoiceSession

    sock = FakeSocket()
    off = session_of(sock, parts_with("x"), Limits(greeting=False))
    assert off._voice is None   # noqa: SLF001
    call = CallVoiceSession(sock, parts_with("x"), tenant_id=off.tenant_id, user_id=off.user_id, language="en", limits=Limits(greeting=False, speaker_check="on", speaker_model="/nowhere.onnx"), ledger=off.ledger, usage=off.usage)
    assert call._voice is None, "never on a phone call, whatever the setting"   # noqa: SLF001
    assert Limits().speaker_check == "off"


def test_a_missing_model_means_no_check_and_no_crash(tmp_path: Any) -> None:
    speaker._cache.clear()   # noqa: SLF001
    assert speaker.load("") is None and speaker.load(str(tmp_path / "nothing.onnx")) is None and speaker.new_session_voice(None) is None


# ---- the signature itself (needs numpy; CI without it skips) -------------------------------------------------------------------------------------


class FakeModel:
    """Embeds a clip by its pitch: two clips with the same pitch are 'the same voice'."""

    def __init__(self, np: Any) -> None:
        self.np = np

    def embed(self, pcm: bytes) -> Any | None:
        np = self.np
        x = speaker.speech_only(pcm, np)
        if len(x) < speaker.MIN_SPEECH_S * speaker.SAMPLE_RATE:
            return None
        crossings = int(((x[:-1] < 0) != (x[1:] < 0)).sum())
        bucket = min(15, round(crossings / (len(x) / speaker.SAMPLE_RATE) / 100))
        v = np.zeros(16, dtype=np.float32)
        v[bucket] = 1.0
        return v


def voice_of_pitch(hz: float, seconds: float = 1.5) -> bytes:
    half = max(1, int(16000 / hz / 2))
    return array.array("h", [6000 if (i // half) % 2 == 0 else -6000 for i in range(int(16000 * seconds))]).tobytes()


def test_the_signature_logic() -> None:
    np = pytest.importorskip("numpy")
    voice = speaker.SessionVoice(FakeModel(np), np)
    owner, other = voice_of_pitch(500, 3.5), voice_of_pitch(1500)
    assert voice.same_voice(owner) is None, "no signature yet: no opinion (the caller treats it as the person)"
    voice.enrol(owner)
    voice.enrol(owner)
    assert voice.same_voice(owner) is True and voice.same_voice(other) is False
    assert voice.same_voice(silence(400) + b"") is None, "too little speech: no opinion"
    voice.enrol(other)   # a third turn that is not the same voice does not drift the signature
    assert voice.same_voice(owner) is True and voice.same_voice(other) is False
    voice.close()
    assert voice.same_voice(owner) is None, "forgotten"


def test_speech_only_drops_silence_and_nothing_is_written_to_disk(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    np = pytest.importorskip("numpy")
    clip = silence(500) + tone(1000) + silence(500)
    kept = speaker.speech_only(clip, np)
    assert abs(len(kept) / 16000 - 1.0) < 0.05
    real_open = builtins.open
    monkeypatch.chdir(tmp_path)

    def no_write(file: Any, mode: str = "r", *a: Any, **k: Any) -> Any:
        assert not any(c in mode for c in "wax+"), f"the signature must never be written: {file}"
        return real_open(file, mode, *a, **k)

    monkeypatch.setattr(builtins, "open", no_write)
    voice = speaker.SessionVoice(FakeModel(np), np)
    voice.enrol(voice_of_pitch(500))
    voice.similarity(voice_of_pitch(500))
    assert list(tmp_path.iterdir()) == []


def test_the_real_model_separates_voices_and_is_fast_when_a_file_is_given() -> None:
    path = os.environ.get("SPEAKER_MODEL_FOR_TESTS", "")
    if not path or not os.path.isfile(path):
        pytest.skip("set SPEAKER_MODEL_FOR_TESTS to the CAM++ ONNX file to run this")
    np = pytest.importorskip("numpy")
    pytest.importorskip("kaldi_native_fbank")
    speaker._cache.clear()   # noqa: SLF001
    model = speaker.load(path)
    assert model is not None
    rng = np.random.default_rng(1)
    clip = (np.sin(np.arange(24000) * 0.07) * 6000 + rng.normal(0, 800, 24000)).astype("<i2").tobytes()
    began = time.perf_counter()
    vector = model.embed(clip)
    assert vector is not None and vector.shape == (192,) and abs(float(np.linalg.norm(vector)) - 1.0) < 1e-3 and time.perf_counter() - began < 1.0
    assert model.embed(silence(300)) is None


@arun
async def test_the_shadow_run_logs_the_numbers_only() -> None:
    import logging

    records: list[str] = []

    class Catch(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record.getMessage())

    handler, logger = Catch(), logging.getLogger("app.browser_voice")
    logger.addHandler(handler)
    previous = logger.level
    logger.setLevel(logging.INFO)
    try:
        sock, session, _ = session_with("shadow", 0.37, later="I meant five hundred")
        await interrupt(sock, session)
        await until(lambda: "interrupted" in sock.types(), seconds=8)
        sock.inbox.put_nowait(("close", None))
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous)
    lines = [r for r in records if r.startswith("browser_voice_speaker mode=")]
    assert len(lines) == 1 and lines[0].startswith("browser_voice_speaker mode=shadow same=False ready=True score=0.37 ms="), lines
    enrols = [r for r in records if r.startswith("browser_voice_speaker_enrol")]
    assert all(__import__("re").fullmatch(r"browser_voice_speaker_enrol kept=(True|False) speech_s=[\d.]+ clip_s=[\d.]+", r) for r in enrols), enrols
    assert not any("five hundred" in r for r in records), "no words of the caller in any log line"


def test_a_clip_without_speech_does_not_use_up_a_free_first_turn() -> None:
    """The failure this prevents: the owner's first enrolment fails (little speech), so the NEXT voice (a television) would be admitted as the signature."""
    np = pytest.importorskip("numpy")
    voice = speaker.SessionVoice(FakeModel(np), np)
    assert voice.enrol(silence(500))[0] is False and voice.turns == 0
    owner, other = voice_of_pitch(500, 3.5), voice_of_pitch(1500)
    assert voice.enrol(owner)[0] is True and voice.enrol(owner)[0] is True
    assert voice.enrol(other)[0] is False, "the third voice is checked against the signature, not admitted"
    assert voice.same_voice(other) is False


def test_the_signature_is_not_used_before_enough_speech_is_enrolled() -> None:
    np = pytest.importorskip("numpy")
    voice = speaker.SessionVoice(FakeModel(np), np)
    owner, other = voice_of_pitch(500, 1.5), voice_of_pitch(1500, 1.5)
    voice.enrol(owner)
    voice.enrol(owner)
    assert not voice.ready and voice.same_voice(other) is None and voice.same_voice(owner) is None, "3 s of speech is not enough: no opinion, the sound interrupts"
    assert voice.similarity(other) is not None, "(the score itself is still measured, for the shadow log)"
    for _ in range(2):
        voice.enrol(voice_of_pitch(500, 2.0))
    assert voice.ready and voice.same_voice(other) is False and voice.same_voice(owner) is True
    voice.close()
    assert not voice.ready
