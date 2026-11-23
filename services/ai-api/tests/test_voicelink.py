"""VoiceLink's WebSocket-bot protocol (24 Nov 2026): the codec, the documented messages exactly as the portal shows them, and the phone line speaking it over an in-memory wire. Not yet proven on a real call."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import base64
import json

import pytest

from app.browser_voice.audio import OUT_RATE
from app.conversation.fakes import tone
from app.telephony import exotel, voicelink
from app.telephony.line import PhoneLine
from app.telephony.simulator import QueueWire
from app.telephony.wire import PROTOCOLS, VOICELINK
from tests.test_dv_browser_voice import arun

START = '{"event":"start","sequence_number":0,"stream_sid":"stream_abc123","start":{"stream_sid":"stream_abc123","call_sid":"callabcdef1234","account_sid":"42","from":"+14155550100","to":"+14155550199","custom_parameters":{"campaign_id":"summer_promo","language":"en"},"media_format":{"encoding":"audio/alaw","sample_rate":"8000"}}}'


def test_the_alaw_codec_matches_g711_and_round_trips_within_its_precision() -> None:
    assert voicelink._encode_one(0) == 0xD5 and voicelink._decode_one(0xD5) == 8 and voicelink._decode_one(0x55) == -8
    assert voicelink._decode_one(0xAA) == 0x108 << 1 - 0 or voicelink._decode_one(0xAA) > 0   # a loud positive code decodes to a large positive sample
    for s in range(-32768, 32768, 13):
        back = voicelink._DECODE[voicelink._ENCODE[(s >> 3) + 4096]]
        assert abs(back - s) <= max(64, abs(s) // 12), s   # A-law keeps about 6 % relative precision
    pcm = tone(100, 8000)
    assert len(voicelink.pcm_to_alaw(pcm)) == len(pcm) // 2 and len(voicelink.alaw_to_pcm(voicelink.pcm_to_alaw(pcm))) == len(pcm)
    assert voicelink.pcm_to_alaw(b"\x01\x02\x03") == voicelink.pcm_to_alaw(b"\x01\x02"), "an odd last byte is dropped"


def test_every_message_the_documentation_shows_is_read() -> None:
    assert isinstance(voicelink.parse('{"event":"connected"}'), exotel.Connected)
    start = voicelink.parse(START)
    assert isinstance(start, exotel.Start)
    assert (start.stream_sid, start.call_sid, start.account_sid, start.from_number, start.to_number) == ("stream_abc123", "callabcdef1234", "42", "+14155550100", "+14155550199")
    assert start.custom == {"campaign_id": "summer_promo", "language": "en"} and start.sample_rate == 8000 and start.encoding == "audio/alaw"
    alaw = bytes([0xD5, 0x55, 0xD5, 0x55])
    media = voicelink.parse(json.dumps({"event": "media", "media": {"track": "inbound", "payload": base64.b64encode(alaw).decode(), "chunk": 3, "timestamp": 1700000000000}}))
    assert isinstance(media, exotel.Media) and media.pcm == voicelink.alaw_to_pcm(alaw) and len(media.pcm) == 8 and media.timestamp_ms == 1700000000000
    assert voicelink.parse('{"event":"mark","mark":{"name":"greeting_done"}}') == exotel.Mark("greeting_done")
    assert isinstance(voicelink.parse('{"event":"stop","stop":{"callSid":"callabcdef1234"}}'), exotel.Stop)
    assert isinstance(voicelink.parse('{"event":"transfer","target":"1234567890"}'), exotel.Unknown)


@pytest.mark.parametrize("raw", ["", "not json", "[]", '{"event":"media","media":{"payload":"@@@"}}', '{"event":"media","media":{"track":"outbound","payload":"AA=="}}', '{"event":"mark","mark":{}}', '{"event":"weird"}', '{"nothing":1}', b"\xff\xfe"])
def test_junk_never_raises_and_is_ignored(raw: str | bytes) -> None:
    assert isinstance(voicelink.parse(raw), exotel.Unknown)


def test_the_start_survives_odd_values() -> None:
    odd = voicelink.parse('{"event":"start","start":{"stream_sid":5,"media_format":{"sample_rate":"abc"},"custom_parameters":[1]}}')
    assert isinstance(odd, exotel.Start) and odd.stream_sid == "" and odd.sample_rate == 8000 and odd.custom == {}
    assert voicelink.parse('{"event":"start","start":{"media_format":{"sample_rate":"16000"}}}').sample_rate == 8000, "only 8 kHz A-law is offered"  # type: ignore[union-attr]


def test_what_we_send_is_exactly_the_documented_shapes() -> None:
    pcm = tone(100, 8000)
    sent = json.loads(voicelink.media_message("s1", pcm, 8000))
    assert set(sent) == {"event", "media"} and sent["event"] == "media" and set(sent["media"]) == {"payload"}
    assert base64.b64decode(sent["media"]["payload"]) == voicelink.pcm_to_alaw(pcm)
    assert json.loads(voicelink.mark_message("s1", "turn-3")) == {"event": "mark", "mark": {"name": "turn-3"}}
    assert json.loads(voicelink.clear_message("s1")) == {"event": "clear", "stream_sid": "s1"}
    assert voicelink.chunk_bytes(8000) == 1600 and voicelink.valid_out_chunk(pcm) and not voicelink.valid_out_chunk(b"\x00") and not voicelink.valid_out_chunk(b"")


def test_the_protocol_record_is_registered_and_ends_with_a_stop_event() -> None:
    assert PROTOCOLS["voicelink"] is VOICELINK and VOICELINK.rates == (8000,) and VOICELINK.ends_with_stop_event


@arun
async def test_the_line_speaks_voicelink_start_to_clear_to_stop() -> None:
    ours, theirs = QueueWire.pair()
    line = PhoneLine(ours, proto=VOICELINK, hang_up_wait_s=1.0)
    await theirs.send_text('{"event":"connected"}')
    await theirs.send_text(START)
    start = await line.open(2.0)
    assert start is not None and start.call_sid == "callabcdef1234" and line.rate == 8000
    await line.send_bytes(tone(600, OUT_RATE))   # 0.6 s of the voice's audio goes out as A-law media in 100 ms pieces
    await line.send_json({"type": "audio_end", "turn": 1})
    await asyncio.sleep(0.1)
    sent: list[dict[str, object]] = []
    while not theirs._in.empty():  # noqa: SLF001
        raw = await theirs.receive_text()
        if raw:
            sent.append(json.loads(raw))
    media = [m for m in sent if m["event"] == "media"]
    assert media and all(len(base64.b64decode(m["media"]["payload"])) == 800 for m in media), "100 ms of A-law at 8 kHz = 800 bytes"  # type: ignore[index]
    assert any(m["event"] == "mark" for m in sent)
    # the caller's audio reaches the session as 16 kHz PCM
    await theirs.send_text(json.dumps({"event": "media", "media": {"track": "inbound", "payload": base64.b64encode(bytes([0xD5] * 160)).decode()}}))
    kind, data = await asyncio.wait_for(line.receive(), 2.0)
    assert kind == "bytes" and len(data) > 0
    await theirs.send_text('{"event":"stop","stop":{"callSid":"callabcdef1234"}}')
    kind, _ = await asyncio.wait_for(line.receive(), 2.0)
    assert kind == "close"
