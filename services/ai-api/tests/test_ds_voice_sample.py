"""Job DS (C2's question 3): the voice picker's listening sample. Owner and Admin only; the sound itself; 404 when there is none (a synthetic voice); a cache, six a minute and a daily character cap per workspace (Sarvam credits are limited). A fake voice stands for Sarvam: no network, no key."""

from __future__ import annotations

import re
from typing import Any

import pytest

from app.voice.interface import Price, Speech, VoiceError
from app.voicesample import service as vs
from app.voicesample.service import VoiceSampleService
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/ai-assistant/voice-sample"
Q = "voice=female_warm&language=te&style=warm"


class RecordingTts:
    def __init__(self, name: str = "sarvam", audio: bytes = b"RIFF" + b"\0" * 40) -> None:
        self.name = name
        self.price = Price()
        self.audio = audio
        self.calls: list[dict[str, Any]] = []
        self.fail = False

    def synthesize(self, text: str, language: str, **kw: Any) -> Speech:
        if self.fail:
            raise VoiceError("voice_failed")
        self.calls.append({"text": text, "language": language, **kw})
        return Speech(audio=self.audio, content_type="audio/wav")


def world(tts: RecordingTts | None = None, **kw: Any) -> tuple[Any, RecordingTts, VoiceSampleService]:
    tts = tts or RecordingTts()
    service = VoiceSampleService(tts, **kw)
    client, _ = make_client(voice_sample=service)
    return client, tts, service


def test_an_owner_and_an_admin_get_the_sound_itself() -> None:
    client, tts, _ = world()
    for user in ("a_owner", "a_admin"):
        r = client.get(f"{URL}?{Q}", headers=auth(user))
        assert r.status_code == 200 and r.headers["content-type"].startswith("audio/wav") and r.content.startswith(b"RIFF"), user
        assert len(r.content) <= 2_000_000
    assert tts.calls[0]["speaker"] == "ritu" and tts.calls[0]["pace"] == 1.0 and tts.calls[0]["temperature"] == 0.7 and tts.calls[0]["language"] == "te"


def test_sales_viewers_strangers_and_other_workspaces_do_not_get_one() -> None:
    client, tts, _ = world()
    for user in ("a_sales", "a_viewer"):
        assert client.get(f"{URL}?{Q}", headers=auth(user)).status_code in (403, 404), user
    assert client.get(f"{URL}?{Q}").status_code == 401
    assert client.get(f"/v1/tenants/{TENANT_B.id}/ai-assistant/voice-sample?{Q}", headers=auth("a_owner")).status_code == 404
    assert tts.calls == []


def test_the_sample_says_it_is_an_ai_assistant_in_the_spoken_style_with_the_name_and_the_business() -> None:
    client, tts, _ = world()
    client.get(f"{URL}?voice=male_calm&language=hi&style=quick&name=Priya", headers=auth("a_owner"))
    spoken = tts.calls[0]["text"]
    assert "AI assistant" in spoken and "Priya" in spoken and TENANT_A.name in spoken
    assert re.search(r"[ऀ-ॿ]", spoken) and tts.calls[0]["speaker"] == "aditya" and tts.calls[0]["pace"] == 1.15 and tts.calls[0]["temperature"] == 0.4


@pytest.mark.parametrize("query", ["voice=bad&language=te", "voice=female_warm&language=xx", "voice=female_warm&language=te&style=loud", "voice=female_warm&language=te&name=" + "x" * 25, "voice=female_warm&language=te&name=%3Cb%3E", "language=te", "voice=female_warm"])
def test_a_bad_choice_is_a_422(query: str) -> None:
    client, tts, _ = world()
    assert client.get(f"{URL}?{query}", headers=auth("a_owner")).status_code == 422
    assert tts.calls == []


def test_a_synthetic_voice_or_no_voice_at_all_is_404_no_sample() -> None:
    client, tts, _ = world(RecordingTts("fake"))
    r = client.get(f"{URL}?{Q}", headers=auth("a_owner"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_sample" and tts.calls == []
    client2, _ = make_client()
    assert client2.get(f"{URL}?{Q}", headers=auth("a_owner")).status_code == 404
    off = VoiceSampleService(None)
    assert off.available() is False


def test_a_provider_failure_is_404_not_a_crash_and_costs_no_cache_entry() -> None:
    client, tts, _ = world()
    tts.fail = True
    assert client.get(f"{URL}?{Q}", headers=auth("a_owner")).status_code == 404
    tts.fail = False
    assert client.get(f"{URL}?{Q}", headers=auth("a_owner")).status_code == 200


def test_the_same_choice_is_cached_and_does_not_reach_the_provider_twice() -> None:
    client, tts, _ = world()
    for _ in range(3):
        assert client.get(f"{URL}?{Q}", headers=auth("a_owner")).status_code == 200
    assert len(tts.calls) == 1
    client.get(f"{URL}?voice=female_clear&language=te&style=warm", headers=auth("a_owner"))
    assert len(tts.calls) == 2, "another voice is another sample"


def test_six_a_minute_per_workspace_then_a_429_with_retry_after() -> None:
    clock = [0.0]
    client, tts, _ = world(clock=lambda: clock[0])
    voices = ["female_warm", "female_clear", "male_calm", "male_lively"]
    codes = []
    for i in range(8):
        codes.append(client.get(f"{URL}?voice={voices[i % 4]}&language={'te' if i < 4 else 'hi'}&style=warm", headers=auth("a_owner")).status_code)
    assert codes == [200] * 6 + [429, 429]
    limited = client.get(f"{URL}?voice=female_warm&language=kn&style=quick", headers=auth("a_owner"))
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limited" and int(limited.headers["retry-after"]) >= 1
    clock[0] = 61.0
    assert client.get(f"{URL}?voice=female_warm&language=kn&style=quick", headers=auth("a_owner")).status_code == 200


def test_a_daily_character_cap_protects_the_credits() -> None:
    clock = [0.0]
    tts = RecordingTts()
    service = VoiceSampleService(tts, clock=lambda: clock[0], today=lambda: "2026-10-27")
    sent = 0
    languages = ("en", "te", "hi", "kn", "ta", "ml")
    with pytest.raises(vs.RateLimited):
        for i in range(200):
            clock[0] += 20.0   # slowly: the minute limit is not the one tested
            service.sample(TENANT_A.id, "Shop", "female_warm", languages[i % 6], "warm", f"N{i}")
            sent = sum(len(c["text"]) for c in tts.calls)
    assert 2500 < sent <= 3000, sent
    assert service.sample(TENANT_A.id, "Shop", "female_warm", "en", "warm", "N0").audio, "a cached sample is still served after the cap"
    other = VoiceSampleService(tts, clock=lambda: clock[0], today=lambda: "2026-10-28")
    assert other.sample(TENANT_A.id, "Shop", "female_warm", "en", "warm", "New").audio, "a new day starts again"


def test_an_oversized_sound_is_refused() -> None:
    client, _, _ = world(RecordingTts(audio=b"RIFF" + b"\0" * 2_100_000))
    assert client.get(f"{URL}?{Q}", headers=auth("a_owner")).status_code == 404
