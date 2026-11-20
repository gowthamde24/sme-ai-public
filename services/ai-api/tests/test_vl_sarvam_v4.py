"""Bulbul v4 on the REST paths (voice notes, WhatsApp voice replies, samples, previews): "We move to Bulbul v4" (owner, 21 Nov 2026). The speakers are not shared between the two models, so a v3 speaker name is replaced by the catalogue's listed Sarvam
voice of the language and gender, and a language v4 Flash does not have (Malayalam) keeps v3. A fake HTTP client checks the payload of every call: no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
from typing import Any

import httpx
import pytest

from app.conversation.voices import default_config
from app.voice.sarvam import SarvamTts

WAV = b"RIFF" + b"\0" * 40
V4 = "bulbul:v4-flash"


def say(model: str, language: str, **kw: Any) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.read()))
        return httpx.Response(200, json={"audios": [base64.b64encode(WAV).decode()]})

    speaker = kw.pop("default_speaker", None)
    SarvamTts("k", model, speaker, client=httpx.Client(transport=httpx.MockTransport(handler))).synthesize("hello there", language, **kw)
    return seen


def test_bulbul_v3_is_sent_exactly_as_before() -> None:
    sent = say("bulbul:v3", "te", speaker="ritu", pace=1.1, temperature=0.7)
    assert sent["model"] == "bulbul:v3" and sent["speaker"] == "ritu" and sent["pace"] == 1.1 and sent["temperature"] == 0.7 and sent["language_code"] == "te-IN"
    assert "speaker" not in say("bulbul:v3", "te"), "no speaker: the model's own default"


@pytest.mark.parametrize(
    ("language", "v3_speaker", "expected"),
    [
        ("te", "ritu", "kavitha_te_conversation"), ("te", "priya", "kavitha_te_conversation"), ("te", None, "kavitha_te_conversation"),
        ("te", "aditya", "tarun_te_narration"), ("te", "rahul", "tarun_te_narration"),
        ("hi", "ritu", "kavya_hi_conversational"), ("hi", "rahul", "kabir_hi_conversational"),
        ("kn", "priya", "chaitra_kn_conversation"), ("kn", "aditya", "chetan_kn_conversation"),
        ("en", None, "shalini_en_customer"), ("en", "rahul", "shubh_enhi_customer"),
    ],
)
def test_on_v4_a_v3_speaker_becomes_the_listed_sarvam_voice_of_the_language_and_gender(language: str, v3_speaker: str | None, expected: str) -> None:
    sent = say(V4, language, speaker=v3_speaker)
    assert sent["model"] == V4 and sent["speaker"] == expected, (language, v3_speaker)
    assert sent["language_code"] == {"te": "te-IN", "hi": "hi-IN", "kn": "kn-IN", "en": "en-IN"}[language] and sent["output_audio_codec"] == "wav" and sent["speech_sample_rate"] == 24000


def test_the_default_speaker_of_the_settings_is_mapped_too() -> None:
    assert say(V4, "te", default_speaker="priya")["speaker"] == "kavitha_te_conversation"
    assert say(V4, "te")["speaker"] == "kavitha_te_conversation", "nothing named at all: the woman's listed voice, as the default always was"


def test_a_v4_persona_is_used_as_it_is() -> None:
    sent = say(V4, "hi", speaker="aditya_hi_conversational")
    assert sent["model"] == V4 and sent["speaker"] == "aditya_hi_conversational"


@pytest.mark.parametrize(("language", "speaker"), [("ml", "ritu"), ("ml", None), ("ta", "priya"), ("ta", None), ("ml", "aditya")])
def test_a_language_with_no_listed_sarvam_v4_voice_keeps_v3_for_that_call(language: str, speaker: str | None) -> None:
    sent = say(V4, language, speaker=speaker)
    assert sent["model"] == "bulbul:v3", language
    assert sent.get("speaker") == speaker, "the v3 speaker it was given (or none: v3's own default)"
    assert not any(v.provider == "sarvam" and v.listed and v.language == language for v in default_config().catalogue.values())


def test_a_v3_name_we_cannot_place_on_v4_is_spoken_by_v3_not_refused() -> None:
    sent = say(V4, "te", speaker="shubh")
    assert sent["model"] == "bulbul:v3" and sent["speaker"] == "shubh"


def test_pace_and_temperature_are_the_same_range_on_both_models_so_they_are_sent_on_v4_too() -> None:
    # docs.sarvam.ai (POST /text-to-speech, read 21 Nov 2026): pace 0.5 to 2.0 and temperature 0.01 to 1.0 apply to bulbul:v3 AND bulbul:v4-flash
    sent = say(V4, "te", speaker="ritu", pace=3.0, temperature=0.0)
    assert sent["pace"] == 2.0 and sent["temperature"] == 0.01
    assert "pace" not in say(V4, "te") and "temperature" not in say(V4, "te")


def test_the_voice_note_speakers_all_map_in_every_voiced_language_that_has_a_sarvam_voice() -> None:
    for language in ("te", "hi", "kn", "en"):
        for name, gender in (("ritu", "female"), ("priya", "female"), ("aditya", "male"), ("rahul", "male")):
            sent = say(V4, language, speaker=name)
            listed = [v.voices.primary.voice for v in default_config().voices_of(language, gender, listed_only=True) if v.provider == "sarvam"]
            assert sent["speaker"] in listed, (language, name)
