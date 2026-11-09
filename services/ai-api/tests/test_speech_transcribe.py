"""Typing by voice: POST /v1/tenants/{t}/speech/transcribe (owner, 9 Nov 2026). A recording in, the words out; nothing stored, the words never logged, the day's seconds counted against the workspace's
existing talking-time ledger and a per-person allowance, and the four friendly errors (too_long, empty, cap_reached, unsupported). The speech service is a fake here; the real one was checked on synthetic clips."""

# ruff: noqa: E501

from __future__ import annotations

import io
import logging
import struct
import wave
from typing import Any

import httpx
import pytest

import app.voice.transcribe as T
from app.browser_voice.limits import Ledger, Limits
from app.pronunciation.brand import write_brand
from app.voice.interface import Transcript, VoiceError
from app.voice.sarvam import SarvamStt
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dv_browser_voice import bv_of

URL = f"/v1/tenants/{TENANT_A.id}/speech/transcribe"
REAL_STT_FOR = T.stt_for   # (the fixture below replaces T.stt_for with a fake)


def wav(seconds: float = 1.0, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<h", 1000) * int(seconds * rate))
    return buf.getvalue()


WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 4000   # what MediaRecorder starts with on Android Chrome; the bytes after are not read here


class FakeStt:
    calls: list[tuple[str, str, str | None]] = []   # (what, content type, language hint)

    def __init__(self, reply: str = "ఈ చీర ధర ఎంత?", language: str | None = "te", error: str | None = None) -> None:
        self.reply, self.language, self.error = reply, language, error

    def transcribe(self, audio: bytes, content_type: str, language: str | None, keyterms: Any = ()) -> Transcript:
        FakeStt.calls.append(("heard", content_type, language))
        if self.error:
            raise VoiceError(self.error)
        return Transcript(self.reply, self.language)


@pytest.fixture(autouse=True)
def fresh(monkeypatch: pytest.MonkeyPatch) -> FakeStt:
    FakeStt.calls = []
    fake = FakeStt()
    monkeypatch.setattr(T, "stt_for", lambda key, language: fake)
    monkeypatch.setattr(T, "ALLOWANCE", T.PersonAllowance())
    return fake


def post(client: Any, user: str | None = "a_owner", audio: bytes | None = None, name: str = "a.wav", ctype: str = "audio/wav", language: str | None = "te") -> Any:
    files = {"audio": (name, audio if audio is not None else wav(), ctype)}
    return client.post(URL, files=files, data={"language": language} if language is not None else {}, headers=auth(user) if user else {})


def client_of(limits: Limits | None = None) -> Any:
    lim = limits or Limits()
    bv = bv_of(lim)
    bv.ledger = Ledger(lim)
    return make_client(browser_voice=bv)[0]


def test_a_recording_becomes_words_in_the_apps_own_forms_and_the_hint_reaches_the_recogniser(fresh: FakeStt) -> None:
    fresh.reply, fresh.language = "ఇది స్టాక్ 19 నుంచి, ₹2600 మొత్తం ₹125000 అవుతుంది.", "te"
    c = client_of()
    got = post(c)
    assert got.status_code == 200 and got.json() == {"text": "ఇది Stack19 నుంచి, ₹2,600 మొత్తం ₹1,25,000 అవుతుంది.", "language": "te"}
    assert FakeStt.calls == [("heard", "audio/wav", "te")]
    post(c, language="auto")
    assert FakeStt.calls[-1] == ("heard", "audio/wav", None), "auto: no language hint, the recogniser detects it"
    assert post(c, audio=WEBM, name="a.webm", ctype="audio/webm").status_code == 200 and FakeStt.calls[-1][1:2] == ("audio/webm",), "what Android Chrome sends"
    assert post(c, language=None).status_code == 200, "no language field means auto"


def test_the_stt_is_chosen_by_the_language() -> None:
    named, auto = REAL_STT_FOR("k", "kn"), REAL_STT_FOR("k", "auto")
    assert (named._model, named._mode) == ("saaras:v4", None) and (auto._model, auto._mode) == ("saaras:v3", "codemix")  # noqa: SLF001


def test_the_mode_goes_to_the_speech_service_only_for_saaras_v3() -> None:
    sent: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.content)
        return httpx.Response(200, json={"transcript": "ok", "language_code": "te-IN"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    SarvamStt("k", model="saaras:v3", client=client, mode="codemix").transcribe(wav(), "audio/wav", None)
    SarvamStt("k", model="saaras:v4", client=client, mode="codemix").transcribe(wav(), "audio/wav", "te")
    assert b'name="mode"' in sent[0] and b"codemix" in sent[0] and b"unknown" in sent[0]
    assert b'name="mode"' not in sent[1] and b"te-IN" in sent[1]


def test_nothing_the_person_said_reaches_the_log_only_numbers(caplog: pytest.LogCaptureFixture, fresh: FakeStt) -> None:
    fresh.reply = "నా పేరు రమేష్, ఫోన్ తొమ్మిది ఎనిమిది"
    with caplog.at_level(logging.DEBUG):
        assert post(client_of()).status_code == 200
    log = " ".join(r.getMessage() for r in caplog.records)
    assert "రమేష్" not in log and "తొమ్మిది" not in log and "transcript" not in log.lower()
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("speech_transcribe "))
    assert "seconds=1" in line and "language=te" in line and "chars=" in line and "ms=" in line and "cost_inr=0.01" in line, line


@pytest.mark.parametrize(("audio", "name", "ctype", "language", "code", "status"), [
    (b"RIFF" + b"\x00" * 50, "a.wav", "audio/wav", "te", "empty", 422),   # too short to hold a word
    (b"this is not audio at all" * 20, "a.bin", "application/octet-stream", "te", "unsupported", 415),
    (wav(31.0), "long.wav", "audio/wav", "te", "too_long", 422),   # past 30 seconds (the speech service's own limit)
    (WEBM + b"\x00" * 1_600_000, "big.webm", "audio/webm", "te", "too_long", 422),
    (wav(), "a.wav", "audio/wav", "fr", "unsupported", 415),   # a language that is not offered
])
def test_the_friendly_errors(audio: bytes, name: str, ctype: str, language: str, code: str, status: int) -> None:
    got = post(client_of(), audio=audio, name=name, ctype=ctype, language=language)
    assert got.status_code == status and got.json()["error"]["code"] == code and FakeStt.calls == [], "refused before any audio went to the speech service"


def test_a_body_that_is_not_a_recording_upload_is_unsupported() -> None:
    c = client_of()
    assert c.post(URL, content=wav(), headers={**auth("a_owner"), "Content-Type": "audio/wav"}).json()["error"]["code"] == "unsupported"
    assert c.post(URL, files={"other": ("x.txt", b"hello", "text/plain")}, headers=auth("a_owner")).json()["error"]["code"] == "unsupported"


def test_silence_is_empty_and_is_still_charged(fresh: FakeStt) -> None:
    fresh.reply = "   "
    lim = Limits(day_seconds=100)
    bv = bv_of(lim)
    bv.ledger = Ledger(lim)
    c = make_client(browser_voice=bv)[0]
    got = post(c)
    assert got.status_code == 422 and got.json()["error"]["code"] == "empty"
    assert bv.ledger.seconds_left(TENANT_A.id) == 99, "the speech service was paid for that second"


def test_the_workspaces_daily_talking_time_is_the_existing_ledger_and_it_is_refused_not_cut() -> None:
    lim = Limits(day_seconds=3)
    bv = bv_of(lim)
    bv.ledger = Ledger(lim)
    c = make_client(browser_voice=bv)[0]
    assert [post(c, audio=wav(1.0)).status_code for _ in range(3)] == [200, 200, 200]
    got = post(c, audio=wav(1.0))
    assert got.status_code == 429 and got.json()["error"]["code"] == "cap_reached" and got.json()["error"]["retry_after"] > 0
    assert len(FakeStt.calls) == 3, "nothing went to the speech service past the cap"
    assert bv.ledger.seconds_left(TENANT_A.id) == 0, "Live talk and dictation draw on the same seconds"


def test_one_persons_day_and_minute(monkeypatch: pytest.MonkeyPatch) -> None:
    c = client_of()
    monkeypatch.setattr(T, "ALLOWANCE", T.PersonAllowance(day_seconds=2, per_minute=10))
    assert [post(c, audio=wav(1.0)).status_code for _ in range(3)] == [200, 200, 429]
    assert post(c, user="a_admin").status_code == 200, "another person has their own allowance"
    monkeypatch.setattr(T, "ALLOWANCE", T.PersonAllowance(day_seconds=1000, per_minute=2))
    got = [post(c, user="a_sales") for _ in range(3)]
    assert [g.status_code for g in got] == [200, 200, 429] and got[2].json()["error"]["code"] == "cap_reached" and 1 <= got[2].json()["error"]["retry_after"] <= 60


def test_the_allowance_counts_a_day_in_india_time_and_gives_back_a_failed_recording() -> None:
    day = ["2026-11-09"]
    clock = [0.0]
    allowance = T.PersonAllowance(day_seconds=10, per_minute=100, clock=lambda: clock[0], today=lambda: day[0])
    import uuid

    t, u = uuid.uuid4(), uuid.uuid4()
    assert allowance.reserve(t, u, 6) is None and allowance.reserve(t, u, 6) is not None
    allowance.refund(t, u, 6)
    assert allowance.reserve(t, u, 10) is None and allowance.reserve(t, u, 1) is not None
    day[0] = "2026-11-10"
    assert allowance.reserve(t, u, 10) is None, "a new day"


@pytest.mark.parametrize(("error", "audio", "ctype", "name", "code", "status"), [
    ("timeout", None, "audio/wav", "a.wav", "timeout", 504),
    ("http_500", None, "audio/wav", "a.wav", "unavailable", 503),
    ("http_400", WEBM, "audio/webm", "a.webm", "too_long", 422),   # a WebM's length is unknown to us: the service refusing it is almost always "over 30 seconds"
    ("http_400", None, "audio/wav", "a.wav", "unsupported", 415),   # a WAV's length is measured: that was not it
    ("unsupported_audio", None, "audio/wav", "a.wav", "unsupported", 415),
])
def test_a_failed_recognition_is_a_friendly_error_and_is_not_charged(fresh: FakeStt, error: str, audio: bytes | None, ctype: str, name: str, code: str, status: int) -> None:
    fresh.error = error
    lim = Limits(day_seconds=100)
    bv = bv_of(lim)
    bv.ledger = Ledger(lim)
    c = make_client(browser_voice=bv)[0]
    got = post(c, audio=audio, ctype=ctype, name=name)
    assert got.status_code == status and got.json()["error"]["code"] == code
    assert bv.ledger.seconds_left(TENANT_A.id) == 100, "a request that failed costs nothing"


def test_who_may_use_it_and_when_it_is_off() -> None:
    c = client_of()
    assert post(c, user="a_sales").status_code == 200 and post(c, user="a_admin").status_code == 200
    assert post(c, user="a_viewer").status_code == 403
    assert post(c, user="b_owner").status_code == 404, "another workspace's owner"
    assert post(c, user=None).status_code == 401
    off = make_client()[0]
    assert post(off).status_code == 503 and post(off).json()["error"]["code"] == "unavailable"


def test_the_written_forms() -> None:
    assert write_brand("స్టాక్ 19, Stack Nineteen, ಸ್ಟ್ಯಾಕ್ 19 and Stack 19") == "Stack19, Stack19, Stack19 and Stack19"
    assert write_brand("a backstack 19 shelf") == "a backstack 19 shelf", "only the brand"
    assert [T.indian_grouping(d) for d in ("999", "1000", "2600", "20000", "125000", "1250000", "12345678")] == ["999", "1,000", "2,600", "20,000", "1,25,000", "12,50,000", "1,23,45,678"]
    assert T.tidy("₹2600 మొత్తం ₹5200") == "₹2,600 మొత్తం ₹5,200"
    assert T.tidy("2600 రూపాయలు, 20000 ರೂಪಾಯಿ") == "2,600 రూపాయలు, 20,000 ರೂಪಾಯಿ"
    assert T.tidy("₹1,25,000 ఇప్పటికే, 2వ తేదీ, 2026 లో") == "₹1,25,000 ఇప్పటికే, 2వ తేదీ, 2026 లో", "grouped amounts, ordinals and years are left alone"
    assert T.tidy("a  b\n c") == "a b c"
