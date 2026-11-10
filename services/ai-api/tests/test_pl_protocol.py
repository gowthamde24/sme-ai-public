"""Plivo's audio-streaming protocol as the phone line reads and writes it (job 3 phase A). The shapes are the ones seen on real calls on 10 Nov 2026."""

from __future__ import annotations

import base64
import json
from typing import Any

from app.telephony import exotel, plivo, wire
from app.telephony.exotel import Dtmf, Mark, Media, Start, Unknown

START: dict[str, Any] = {"event": "start", "sequenceNumber": 1, "start": {"callId": "11111111-2222-3333-4444-555555555555", "streamId": "sid-1", "accountId": "MAXXXX", "tracks": ["inbound"],
         "mediaFormat": {"encoding": "audio/x-l16", "sampleRate": 8000}}, "extra_headers": "{X-PH-variant: a}"}


def test_start_carries_the_call_the_stream_the_account_the_rate_and_the_encoding_and_no_numbers() -> None:
    event = plivo.parse(json.dumps(START))
    assert isinstance(event, Start)
    assert (event.call_sid, event.stream_sid, event.account_sid, event.sample_rate, event.encoding) == ("11111111-2222-3333-4444-555555555555", "sid-1", "MAXXXX", 8000, "audio/x-l16")
    assert event.from_number == "" and event.to_number == "", "Plivo's start has no from / to: they come from the signed answer request"
    assert event.custom == {"X-PH-variant": "a"} and "streamId" in event.fields


def test_a_start_with_another_rate_or_none_is_read_safely() -> None:
    other = {**START, "start": {**START["start"], "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 12345}}}
    event = plivo.parse(json.dumps(other))
    assert isinstance(event, Start) and event.sample_rate == 8000 and event.encoding == "audio/x-mulaw", "the encoding is reported so the caller can refuse what it cannot read"
    assert isinstance(plivo.parse(json.dumps({"event": "start"})), Start)


def test_media_is_raw_little_endian_pcm_and_an_odd_byte_is_dropped() -> None:
    pcm = b"\x01\x00\x02\x00" * 80
    event = plivo.parse(json.dumps({"event": "media", "streamId": "s", "media": {"track": "inbound", "timestamp": "1700", "chunk": 3, "payload": base64.b64encode(pcm + b"\x09").decode()}}))
    assert isinstance(event, Media) and event.pcm == pcm and event.timestamp_ms == 1700


def test_dtmf_a_played_checkpoint_and_the_rest() -> None:
    assert plivo.parse(json.dumps({"event": "dtmf", "dtmf": {"digit": "5"}})) == Dtmf("5")
    assert isinstance(plivo.parse(json.dumps({"event": "dtmf", "dtmf": {"digit": "Z"}})), Unknown)
    assert plivo.parse(json.dumps({"event": "playedStream", "name": "turn-3"})) == Mark("turn-3")
    for raw in ('{"event": "clearedAudio"}', '{"event": "weird"}', "not json", "[1]", '{"event": "media", "media": {"payload": "%%%"}}', b"\xff\xfe"):
        assert isinstance(plivo.parse(raw), Unknown)


def test_what_we_send_has_exactly_the_shape_plivo_accepted_on_real_calls() -> None:
    pcm = b"\x00\x01" * 800
    play = json.loads(plivo.media_message("sid-1", pcm, 8000))
    assert play == {"event": "playAudio", "media": {"contentType": "audio/x-l16", "sampleRate": 8000, "payload": base64.b64encode(pcm).decode()}}
    assert json.loads(plivo.mark_message("sid-1", "turn-1")) == {"event": "checkpoint", "streamId": "sid-1", "name": "turn-1"}
    assert json.loads(plivo.clear_message("sid-1")) == {"event": "clearAudio", "streamId": "sid-1"}


def test_chunks_are_100_ms_of_16_bit_audio() -> None:
    assert plivo.chunk_bytes(8000) == 1600 and plivo.chunk_bytes(16000) == 3200
    assert plivo.valid_out_chunk(b"\x00" * 1600) and not plivo.valid_out_chunk(b"\x00" * 1601) and not plivo.valid_out_chunk(b"")


def test_the_answer_xml_streams_both_ways_keeps_the_call_up_and_escapes_what_it_holds() -> None:
    xml = plivo.stream_xml("wss://api.example/v1/telephony/plivo/stream/abc?x=1&y=2", 8000, status_callback="https://api.example/v1/telephony/plivo/stream-status")
    assert 'bidirectional="true"' in xml and 'keepCallAlive="true"' in xml and 'contentType="audio/x-l16;rate=8000"' in xml
    assert ">wss://api.example/v1/telephony/plivo/stream/abc?x=1&amp;y=2</Stream>" in xml, "the ampersand is escaped"
    assert 'statusCallbackUrl="https://api.example/v1/telephony/plivo/stream-status"' in xml and xml.startswith("<?xml")
    assert plivo.hangup_xml().endswith("<Response><Hangup/></Response>")


def test_the_two_providers_are_two_records_of_one_shape_and_exotel_is_untouched() -> None:
    assert set(wire.PROTOCOLS) == {"exotel", "plivo"} and wire.EXOTEL.ends_with_stop_event and not wire.PLIVO.ends_with_stop_event
    assert wire.EXOTEL.default_rate == exotel.DEFAULT_RATE == 8000 and wire.PLIVO.rates == (8000, 16000)
    exo = json.loads(wire.EXOTEL.media_message("s", b"\x00" * 320, 8000))
    assert set(exo) == {"event", "stream_sid", "media"} and set(exo["media"]) == {"payload"}, "Exotel's message is still exactly its documented shape"
