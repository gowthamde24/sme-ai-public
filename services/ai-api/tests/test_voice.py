"""Job BD (ADR 0071): voice. The audio checks (container read from the first bytes, exact length for WAV and M4A, strict limits), every provider adapter against a fake HTTP transport (the request it
sends, the key only in a header, constant error codes, nothing secret in a repr), the factory (OFF unless a provider is named; a provider without its key stops the process), the usage charge, and
the route's refusals that happen before anything is spent. The full stream (transcript, answer, audio, ledger) runs on the real stack in tests/integration/test_voice_api.py. No network."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import struct
import uuid
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.voice import usage
from app.voice.ai4bharat import Ai4BharatStt, Ai4BharatTts
from app.voice.audio import MAX_COMPRESSED_BYTES, AudioRefused, inspect_audio
from app.voice.bhashini import BhashiniStt, BhashiniTts
from app.voice.factory import build_voice
from app.voice.fake import FakeStt, FakeTts, tone
from app.voice.google import GoogleStt, GoogleTts
from app.voice.interface import VoiceError, VoiceStack, language_of_tag
from app.voice.sarvam import SarvamStt, SarvamTts
from tests.fakes import TENANT_A, auth, make_client

SECRET = "sk-test-voice-key-1234567890"  # noqa: S105 - a fixture
WAV = tone(1.0)


def m4a(seconds: float, timescale: int = 1000) -> bytes:
    """The smallest MP4 the parser reads: ftyp, then moov holding an mvhd (version 0) of the given duration."""
    ftyp = struct.pack(">I4s", 24, b"ftyp") + b"M4A \x00\x00\x00\x00M4A mp42"
    mvhd_body = struct.pack(">B3xIIII", 0, 0, 0, timescale, int(seconds * timescale)) + b"\x00" * 80
    mvhd = struct.pack(">I4s", 8 + len(mvhd_body), b"mvhd") + mvhd_body
    moov = struct.pack(">I4s", 8 + len(mvhd), b"moov") + mvhd
    return ftyp + moov + b"\x00" * 300


def handler_to_client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


# ---------------------------------------------------------------------------------------------- the audio
def test_a_wav_is_measured_exactly() -> None:
    info = inspect_audio(tone(2.5))
    assert (
        info.content_type == "audio/wav"
        and info.seconds == pytest.approx(2.5, abs=0.01)
        and info.charged_seconds == 3
    )


def test_an_m4a_is_measured_from_its_movie_header() -> None:
    info = inspect_audio(m4a(12.4))
    assert (
        info.content_type == "audio/mp4"
        and info.seconds == pytest.approx(12.4, abs=0.01)
        and info.charged_seconds == 13
    )


def test_sixty_seconds_is_allowed_and_a_second_more_is_not() -> None:
    assert inspect_audio(tone(60.0, rate=8000)).charged_seconds == 60
    with pytest.raises(AudioRefused) as e:
        inspect_audio(tone(61.0, rate=8000))
    assert e.value.code == "too_long"
    with pytest.raises(AudioRefused) as e:
        inspect_audio(m4a(75))
    assert e.value.code == "too_long"


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "too_short"),
        (b"RIFF" + b"\x00" * 50, "too_short"),
        (b"%PDF-1.7" + b"\x00" * 400, "unsupported_audio"),
        (b"<html>" * 100, "unsupported_audio"),
        (b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 400, "unreadable_audio"),
        (b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 400, "unreadable_audio"),
    ],
)
def test_what_is_not_audio_is_refused_by_its_own_bytes(data: bytes, code: str) -> None:
    with pytest.raises(AudioRefused) as e:
        inspect_audio(data)
    assert e.value.code == code


def test_the_container_comes_from_the_bytes_not_from_what_the_client_says() -> None:
    assert inspect_audio(b"\x1a\x45\xdf\xa3" + b"\x00" * 400).content_type == "audio/webm"
    assert inspect_audio(b"OggS" + b"\x00" * 400).content_type == "audio/ogg"
    assert inspect_audio(b"fLaC" + b"\x00" * 400).content_type == "audio/flac"
    assert inspect_audio(b"ID3" + b"\x00" * 400).content_type == "audio/mpeg"


def test_a_compressed_recording_without_a_length_is_capped_by_size_and_estimated_for_the_charge() -> (
    None
):
    small = inspect_audio(b"OggS" + b"\x00" * 79_996)
    assert small.seconds is None and small.charged_seconds == 10, (
        "80 kB at 64 kbit/s is ten seconds"
    )
    with pytest.raises(AudioRefused) as e:
        inspect_audio(b"OggS" + b"\x00" * MAX_COMPRESSED_BYTES)
    assert e.value.code == "too_large"
    assert inspect_audio(b"OggS" + b"\x00" * 1_400_000).charged_seconds == 60, (
        "never more than a minute is charged"
    )


# ---------------------------------------------------------------------------------------------- the adapters
def test_sarvam_speech_to_text_sends_the_file_the_language_and_the_key_in_a_header() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(
            url=str(request.url),
            key=request.headers.get("api-subscription-key"),
            body=request.read(),
        )
        return httpx.Response(200, json={"transcript": " రేపు వస్తాను ", "language_code": "te-IN"})

    stt = SarvamStt(SECRET, client=handler_to_client(handler))
    out = stt.transcribe(WAV, "audio/wav", "te", ["Kanchi", "x" * 70])
    assert out.text == "రేపు వస్తాను" and out.language == "te"
    assert (
        seen["url"] == "https://api.sarvam.ai/speech-to-text"
        and seen["key"] == SECRET
        and SECRET not in seen["url"]
    )
    assert (
        b"te-IN" in seen["body"]
        and b"saaras:v4" in seen["body"]
        and b"Kanchi" in seen["body"]
        and b"xxxxxxxxxx" not in seen["body"]
    ), "a keyterm over 64 characters is dropped"
    assert SECRET not in repr(stt)


def test_sarvam_auto_detects_when_no_language_is_given() -> None:
    bodies: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(request.read())
        return httpx.Response(200, json={"transcript": "hello", "language_code": "en-IN"})

    out = SarvamStt(SECRET, client=handler_to_client(handler)).transcribe(WAV, "audio/wav", None)
    assert b"unknown" in bodies[0] and out.language == "en"


def test_sarvam_text_to_speech_decodes_the_audio() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = json.loads(request.read())
        return httpx.Response(200, json={"audios": [base64.b64encode(WAV).decode()]})

    speech = SarvamTts(SECRET, speaker="shubh", client=handler_to_client(handler)).synthesize(
        "నమస్కారం", "te"
    )
    assert speech.audio == WAV and speech.content_type == "audio/wav"
    assert (
        seen["json"]["language_code"] == "te-IN"
        and seen["json"]["model"] == "bulbul:v3"
        and seen["json"]["speaker"] == "shubh"
    )
    with pytest.raises(VoiceError) as e:
        SarvamTts(SECRET, client=handler_to_client(handler)).synthesize("x", "fr")
    assert e.value.code == "unsupported_language"


def test_bhashini_speech_to_text_and_text_to_speech_use_the_pipeline_shape() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        seen.append(
            {"auth": request.headers.get("authorization"), "task": body["pipelineTasks"][0]}
        )
        if body["pipelineTasks"][0]["taskType"] == "asr":
            return httpx.Response(
                200, json={"pipelineResponse": [{"output": [{"source": "కొత్త చీరలు"}]}]}
            )
        return httpx.Response(
            200,
            json={
                "pipelineResponse": [{"audio": [{"audioContent": base64.b64encode(WAV).decode()}]}]
            },
        )

    client = handler_to_client(handler)
    assert (
        BhashiniStt(SECRET, "svc-asr", client=client).transcribe(WAV, "audio/wav", "kn").text
        == "కొత్త చీరలు"
    )
    assert BhashiniTts(SECRET, "svc-tts", client=client).synthesize("ನಮಸ್ಕಾರ", "kn").audio == WAV
    assert (
        seen[0]["auth"] == SECRET
        and seen[0]["task"]["config"]["serviceId"] == "svc-asr"
        and seen[0]["task"]["config"]["language"]["sourceLanguage"] == "kn"
    )
    assert (
        seen[1]["task"]["taskType"] == "tts" and seen[1]["task"]["config"]["serviceId"] == "svc-tts"
    )
    assert SECRET not in repr(BhashiniStt(SECRET, "svc-asr")) and "svc-asr" in repr(
        BhashiniStt(SECRET, "svc-asr")
    )


def test_google_sends_the_key_in_a_header_never_in_the_address_and_refuses_m4a() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            {
                "url": str(request.url),
                "key": request.headers.get("x-goog-api-key"),
                "json": json.loads(request.read()),
            }
        )
        if "speech:recognize" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"alternatives": [{"transcript": "namaste"}], "languageCode": "hi-in"}
                    ]
                },
            )
        return httpx.Response(200, json={"audioContent": base64.b64encode(b"MP3DATA").decode()})

    client = handler_to_client(handler)
    out = GoogleStt(SECRET, client=client).transcribe(WAV, "audio/wav", "hi")
    assert out.text == "namaste" and out.language == "hi"
    assert (
        seen[0]["key"] == SECRET and "key=" not in seen[0]["url"] and SECRET not in seen[0]["url"]
    )
    assert (
        seen[0]["json"]["config"]["languageCode"] == "hi-IN"
        and "encoding" not in seen[0]["json"]["config"]
    ), "a WAV carries its own format"
    speech = GoogleTts(SECRET, client=client).synthesize("నమస్కారం", "te")
    assert (
        speech.audio == b"MP3DATA"
        and speech.content_type == "audio/mpeg"
        and seen[1]["json"]["voice"]["languageCode"] == "te-IN"
    )
    with pytest.raises(VoiceError) as e:
        GoogleStt(SECRET, client=client).transcribe(m4a(3), "audio/mp4", "te")
    assert e.value.code == "unsupported_audio"
    assert SECRET not in repr(GoogleStt(SECRET)) and SECRET not in repr(GoogleTts(SECRET))


def test_google_with_no_language_listens_for_the_others_too_and_no_results_is_no_speech() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.read()))
        return httpx.Response(200, json={})

    with pytest.raises(VoiceError) as e:
        GoogleStt(SECRET, client=handler_to_client(handler)).transcribe(WAV, "audio/wav", None)
    assert e.value.code == "no_speech" and "hi-IN" in seen[0]["config"]["alternativeLanguageCodes"]


def test_ai4bharat_speaks_a_plain_contract_to_an_address_the_owner_runs() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/stt":
            return httpx.Response(200, json={"transcript": "ఇది ఒక పరీక్ష"})
        return httpx.Response(
            200, json={"audio_base64": base64.b64encode(WAV).decode(), "content_type": "audio/wav"}
        )

    client = handler_to_client(handler)
    assert (
        Ai4BharatStt("https://models.example.test/stt", "tok", client=client)
        .transcribe(WAV, "audio/wav", "te")
        .text
        == "ఇది ఒక పరీక్ష"
    )
    assert (
        Ai4BharatTts("https://models.example.test/tts", None, client=client)
        .synthesize("hello", "en")
        .audio
        == WAV
    )
    assert (
        seen[0].headers["authorization"] == "Bearer tok" and "authorization" not in seen[1].headers
    )
    for bad in ("http://models.example.test/stt", "ftp://x/stt", "file:///etc/passwd"):
        with pytest.raises(ValueError):
            Ai4BharatStt(bad)
    Ai4BharatStt("http://localhost:8080/stt")


@pytest.mark.parametrize(
    "adapter_call",
    [
        lambda c: SarvamStt(SECRET, client=c).transcribe(WAV, "audio/wav", "te"),
        lambda c: SarvamTts(SECRET, client=c).synthesize("x y", "te"),
        lambda c: BhashiniStt(SECRET, "s", client=c).transcribe(WAV, "audio/wav", "te"),
        lambda c: BhashiniTts(SECRET, "s", client=c).synthesize("x y", "te"),
        lambda c: GoogleStt(SECRET, client=c).transcribe(WAV, "audio/wav", "te"),
        lambda c: GoogleTts(SECRET, client=c).synthesize("x y", "te"),
        lambda c: Ai4BharatStt("https://m.example.test/s", client=c).transcribe(
            WAV, "audio/wav", "te"
        ),
        lambda c: Ai4BharatTts("https://m.example.test/t", client=c).synthesize("x y", "te"),
    ],
)
def test_every_adapter_turns_a_failure_into_a_constant_code_that_hides_the_key_and_the_providers_words(
    adapter_call: Any,
) -> None:
    def failing(
        status: int, text: str = "provider says: your key sk-test-voice-key-1234567890 is invalid"
    ) -> httpx.Client:
        return handler_to_client(lambda r: httpx.Response(status, text=text))

    for status, code in ((401, "http_401"), (429, "http_429"), (500, "http_500")):
        with pytest.raises(VoiceError) as e:
            adapter_call(failing(status))
        assert (
            e.value.code == code
            and SECRET not in str(e.value)
            and "provider says" not in str(e.value)
        )
    with pytest.raises(VoiceError) as e:
        adapter_call(handler_to_client(lambda r: httpx.Response(200, text="not json")))
    assert e.value.code == "bad_response"
    with pytest.raises(VoiceError) as e:
        adapter_call(handler_to_client(lambda r: httpx.Response(200, json={"unexpected": True})))
    assert e.value.code in ("bad_response", "no_speech")

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(VoiceError) as e:
        adapter_call(handler_to_client(slow))
    assert e.value.code == "timeout"

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(VoiceError) as e:
        adapter_call(handler_to_client(down))
    assert e.value.code == "unreachable:ConnectError"


def test_the_fakes_open_no_socket_and_keep_what_they_were_asked() -> None:
    stt, tts = FakeStt("hello there", "en"), FakeTts()
    assert stt.transcribe(WAV, "audio/wav", "te", ["a"]).text == "hello there" and stt.calls == [
        (len(WAV), "audio/wav", "te", ("a",))
    ]
    speech = tts.synthesize("some words", "hi")
    assert inspect_audio(speech.audio).content_type == "audio/wav" and tts.calls == [(10, "hi")]
    with pytest.raises(VoiceError):
        FakeStt(fail="timeout").transcribe(WAV, "audio/wav", None)


def test_language_tags() -> None:
    assert (
        language_of_tag("te-IN") == "te"
        and language_of_tag("EN") == "en"
        and language_of_tag("fr-FR") is None
        and language_of_tag(None) is None
    )


# ---------------------------------------------------------------------------------------------- the factory
def settings(**over: Any) -> Settings:
    return Settings(_env_file=None, api_env="development", **over)  # type: ignore[call-arg]


def test_voice_is_off_unless_a_provider_is_named() -> None:
    assert build_voice(settings()) is None
    assert build_voice(settings(sarvam_api_key=SecretStr(SECRET))) is None, (
        "a key alone switches nothing on"
    )


def test_a_named_provider_builds_and_text_to_speech_is_optional() -> None:
    stack = build_voice(settings(voice_stt_provider="sarvam", sarvam_api_key=SecretStr(SECRET)))
    assert (
        isinstance(stack, VoiceStack)
        and stack.stt is not None
        and stack.tts is None
        and stack.enabled
    )
    both = build_voice(
        settings(
            voice_stt_provider="google",
            voice_tts_provider="google",
            google_api_key=SecretStr(SECRET),
        )
    )
    assert both is not None and both.tts is not None
    assert build_voice(settings(voice_stt_provider="fake", voice_tts_provider="fake")) is not None


@pytest.mark.parametrize(
    "over",
    [
        {"voice_stt_provider": "sarvam"},
        {"voice_stt_provider": "bhashini", "bhashini_api_key": SecretStr(SECRET)},
        {"voice_stt_provider": "google"},
        {"voice_stt_provider": "ai4bharat"},
        {"voice_stt_provider": "ai4bharat", "ai4bharat_stt_url": "http://models.example.test/stt"},
        {"voice_stt_provider": "nonsense"},
        {"voice_tts_provider": "sarvam", "sarvam_api_key": SecretStr(SECRET)},
        {
            "voice_stt_provider": "sarvam",
            "sarvam_api_key": SecretStr(SECRET),
            "voice_tts_provider": "bhashini",
        },
    ],
)
def test_a_provider_without_what_it_needs_stops_the_process(over: dict[str, Any]) -> None:
    with pytest.raises(ConfigurationError):
        build_voice(settings(**over))


def test_the_fake_provider_is_for_development_only() -> None:
    with pytest.raises(ConfigurationError):
        build_voice(Settings(_env_file=None, api_env="production", voice_stt_provider="fake"))  # type: ignore[call-arg]


def test_keys_are_secrets_in_settings() -> None:
    s = settings(
        sarvam_api_key=SecretStr(SECRET),
        google_api_key=SecretStr(SECRET),
        bhashini_api_key=SecretStr(SECRET),
        ai4bharat_token=SecretStr(SECRET),
    )
    assert SECRET not in repr(s)


# ---------------------------------------------------------------------------------------------- the usage charge
def test_the_charge_is_reserved_and_settled_at_the_ceiling_price_and_the_conversion_is_fixed() -> (
    None
):
    class Ledger:
        def __init__(self) -> None:
            self.calls: list[Any] = []

        def reserve_cost(
            self, key: str, *, model: str, max_input_tokens: int, max_output_tokens: int
        ) -> None:
            self.calls.append(("reserve", key, model, max_input_tokens, max_output_tokens))

        def record_usage(self, key: str, u: Any) -> None:
            self.calls.append(("record", key, u.input_tokens, u.output_tokens, u.cost_micros))

    ledger = Ledger()
    usage.charge(ledger, "voice-stt", usage.STT_MODEL, usage.stt_tokens(7))
    assert ledger.calls == [
        ("reserve", "voice-stt", "voice-stt", 70, 0),
        ("record", "voice-stt", 70, 0, 70_000),
    ], "7 seconds = 70 tokens = 70,000 micros = Rs 0.07"
    assert usage.stt_tokens(60) * usage.MICROS_PER_TOKEN == 600_000, "a minute is Rs 0.60"
    assert usage.tts_tokens(1000) * usage.MICROS_PER_TOKEN == 4_000_000, "1,000 characters is Rs 4"
    assert usage.stt_tokens(0) == 10 and usage.tts_tokens(0) == 4, "never free"


def test_the_migration_prices_both_accounting_models_at_the_tables_ceiling() -> None:
    from pathlib import Path

    text = next(
        Path(__file__)
        .resolve()
        .parents[3]
        .joinpath("supabase", "migrations")
        .glob("*_bd_voice_prices.sql")
    ).read_text()
    assert (
        "('voice-stt', 1000000000, 1000000000)" in text
        and "('voice-tts', 1000000000, 1000000000)" in text
    )
    assert usage.STT_MODEL == "voice-stt" and usage.TTS_MODEL == "voice-tts"


# ---------------------------------------------------------------------------------------------- the route's refusals (nothing is spent)
BASE = f"/v1/tenants/{TENANT_A.id}/assistant/voice"
MID = str(uuid.uuid4())


def post(
    client: Any, user: str | None, data: bytes, query: str = "", content_type: str = "audio/wav"
) -> Any:
    headers = {**(auth(user) if user else {}), "Content-Type": content_type}
    return client.post(f"{BASE}?message_id={MID}{query}", content=data, headers=headers)


def test_voice_is_off_without_a_provider() -> None:
    client, _ = make_client()
    r = post(client, "a_owner", WAV)
    assert r.status_code == 503 and r.json()["error"]["code"] == "voice_unavailable"
    client, _ = make_client(voice=VoiceStack(stt=None))
    assert post(client, "a_owner", WAV).status_code == 503


def test_who_may_use_voice() -> None:
    stt = FakeStt()
    client, _ = make_client(voice=VoiceStack(stt=stt))
    assert post(client, None, WAV).status_code == 401
    assert post(client, "outsider", WAV).status_code == 404
    assert post(client, "b_owner", WAV).status_code == 404
    assert post(client, "a_viewer", WAV).status_code == 403
    assert stt.calls == [], "no audio was sent anywhere"


@pytest.mark.parametrize(
    ("query", "data", "status", "code"),
    [
        ("", b"", 422, "audio_too_short"),
        ("", b"not audio at all" * 40, 415, "audio_unsupported"),
        ("", tone(61.0), 422, "audio_too_long"),
        ("", b"OggS" + b"\x00" * 1_600_000, 413, "audio_too_large"),
        ("&language=fr", WAV, 422, "validation_error"),
        ("&speak=true", WAV, 422, "speech_unavailable"),
        ("&conversation_id=nope", WAV, 422, "validation_error"),
    ],
)
def test_a_bad_recording_or_request_is_refused_before_anything_is_sent(
    query: str, data: bytes, status: int, code: str
) -> None:
    stt = FakeStt()
    client, _ = make_client(voice=VoiceStack(stt=stt))
    r = post(client, "a_owner", data, query)
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text
    assert stt.calls == []


def test_a_message_id_that_is_not_a_uuid_is_refused() -> None:
    client, _ = make_client(voice=VoiceStack(stt=FakeStt()))
    r = client.post(f"{BASE}?message_id=nope", content=WAV, headers=auth("a_owner"))
    assert r.status_code == 422


def test_the_declared_size_is_refused_without_reading_the_body() -> None:
    client, _ = make_client(voice=VoiceStack(stt=FakeStt()))
    r = client.post(
        f"{BASE}?message_id={MID}",
        content=b"x",
        headers={**auth("a_owner"), "Content-Length": str(50 * 1024 * 1024)},
    )
    assert r.status_code in (400, 413, 422)


def test_an_allowance_that_is_used_up_refuses_before_any_audio_leaves() -> None:
    from datetime import UTC, datetime, timedelta

    class Today:
        def paused_until(self, token: str, tenant: Any) -> str:
            return (datetime.now(UTC) + timedelta(hours=3)).isoformat()

    stt = FakeStt()
    client, _ = make_client(voice=VoiceStack(stt=stt), today=Today())  # type: ignore[arg-type]
    r = post(client, "a_owner", WAV)
    assert (
        r.status_code == 429
        and r.json()["error"]["code"] == "ai_paused_until"
        and "until" in r.json()["error"]
    )
    assert stt.calls == []


def test_a_provider_failure_is_a_fixed_answer_without_the_providers_words() -> None:
    for failure, status, code in (
        ("timeout", 504, "voice_timeout"),
        ("http_500", 502, "voice_failed"),
        ("no_speech", 422, "no_speech"),
        ("unsupported_audio", 415, "audio_unsupported"),
        ("bad_response", 502, "voice_failed"),
    ):
        client, _ = make_client(voice=VoiceStack(stt=FakeStt(fail=failure)))
        r = post(client, "a_owner", WAV)
        assert r.status_code == status and r.json()["error"]["code"] == code, (failure, r.text)
    client, _ = make_client(voice=VoiceStack(stt=FakeStt(text="   ")))
    assert post(client, "a_owner", WAV).json()["error"]["code"] == "no_speech", (
        "an empty transcript is no speech"
    )
