"""Phone calls, part 2: Exotel's stream protocol, the resampler and the phone line as a socket, against the simulator (no account needed)."""

# ruff: noqa: E501
from __future__ import annotations

import array
import asyncio
import base64
import json

from app.browser_voice.audio import OUT_RATE
from app.telephony import exotel
from app.telephony.line import PhoneLine
from app.telephony.pcm import Resampler, pad_to_multiple, tone
from app.telephony.simulator import QueueWire, SimulatedExotel
from tests.test_dv_browser_voice import arun

# ---- the resampler ------------------------------------------------------------------------------------------------------------------------------


def samples(pcm: bytes) -> list[int]:
    a = array.array("h")
    a.frombytes(pcm)
    return list(a)


def crossings(pcm: bytes) -> int:
    s = samples(pcm)
    return sum(1 for a, b in zip(s, s[1:], strict=False) if (a < 0) != (b < 0))


def test_the_resampler_changes_the_length_by_the_ratio_and_keeps_the_pitch() -> None:
    for src, dst in ((24000, 16000), (24000, 8000), (16000, 8000), (8000, 16000), (16000, 24000)):
        pcm = tone(440.0, 1000, src)
        out = Resampler(src, dst).process(pcm)
        assert abs(len(out) / 2 - dst) <= 4, (src, dst, len(out) / 2)
        assert abs(crossings(out) - 880) <= 8, f"{src}->{dst}: the 440 Hz tone stays 440 Hz"


def test_a_stream_in_pieces_gives_the_same_samples_as_one_piece() -> None:
    pcm = tone(300.0, 500, 24000) + tone(900.0, 500, 24000)
    whole = Resampler(24000, 16000).process(pcm)
    r = Resampler(24000, 16000)
    pieces = b"".join(r.process(pcm[i : i + 1000]) for i in range(0, len(pcm), 1000))
    assert pieces == whole[: len(pieces)] and len(whole) - len(pieces) <= 4


def test_the_same_rate_is_untouched_and_odd_bytes_are_dropped() -> None:
    pcm = tone(440.0, 100, 16000)
    assert Resampler(16000, 16000).process(pcm) == pcm
    assert len(Resampler(24000, 16000).process(pcm + b"\x01")) % 2 == 0


def test_a_tone_above_the_band_does_not_fold_back_when_going_down_a_lot() -> None:
    high = tone(7000.0, 500, 24000)
    low = Resampler(24000, 8000).process(high)
    peak = max(abs(v) for v in samples(low)[200:])
    assert peak < 0.35 * 32767 * 0.3, "the 7 kHz tone is averaged away, not turned into a loud low tone"


# ---- the protocol -------------------------------------------------------------------------------------------------------------------------------


def test_every_message_kind_is_parsed() -> None:
    assert exotel.parse('{"event":"connected"}') == exotel.Connected()
    start = exotel.parse(json.dumps({"event": "start", "stream_sid": "XP1", "start": {"stream_sid": "XP1", "call_sid": "CA1", "account_sid": "AC1", "from": "+919876543210", "to": "+918000000000",
                                     "custom_parameters": {"c": "abc"}, "media_format": {"encoding": "raw/slin", "sample_rate": "16000", "bit_rate": "128kbps"}}}))
    assert isinstance(start, exotel.Start) and start.sample_rate == 16000 and start.custom == {"c": "abc"} and start.call_sid == "CA1" and start.to_number == "+918000000000"
    media = exotel.parse(json.dumps({"event": "media", "media": {"chunk": 2, "timestamp": "10", "payload": base64.b64encode(b"\x01\x00\x02\x00").decode()}}))
    assert media == exotel.Media(b"\x01\x00\x02\x00", 10)
    assert exotel.parse('{"event":"dtmf","dtmf":{"digit":"5","duration":"200"}}') == exotel.Dtmf("5")
    assert exotel.parse('{"event":"stop","stop":{"reason":"callended"}}') == exotel.Stop("callended")
    assert exotel.parse('{"event":"mark","mark":{"name":"turn-1"}}') == exotel.Mark("turn-1")


def test_junk_is_unknown_and_never_raises() -> None:
    for raw in ("", "not json", "[]", '{"event":"nope"}', '{"event":"media","media":{"payload":"!!!"}}', '{"event":"dtmf","dtmf":{"digit":"Z"}}', b"\xff\xfe", '{"event":"media"}'):
        assert isinstance(exotel.parse(raw), exotel.Unknown | exotel.Media), raw
    assert exotel.parse('{"event":"media","media":{"payload":"!!!"}}') == exotel.Unknown()


def test_the_start_message_survives_odd_values() -> None:
    odd = exotel.parse(json.dumps({"event": "start", "start": {"custom_parameters": "lead=42&loc=blr", "media_format": {"sample_rate": "44100"}}}))
    assert isinstance(odd, exotel.Start) and odd.custom == {"lead": "42", "loc": "blr"} and odd.sample_rate == exotel.DEFAULT_RATE


def test_outgoing_messages_and_the_chunk_rule() -> None:
    pcm = b"\x00\x01" * 1600
    msg = json.loads(exotel.media_message("XP1", pcm, 7))
    assert msg["event"] == "media" and msg["stream_sid"] == "XP1" and base64.b64decode(msg["media"]["payload"]) == pcm
    assert json.loads(exotel.clear_message("XP1")) == {"event": "clear", "stream_sid": "XP1"}
    assert json.loads(exotel.mark_message("XP1", "t", 3))["mark"] == {"name": "t"}
    assert exotel.valid_out_chunk(b"\x00" * 3200) and exotel.valid_out_chunk(b"\x00" * 320) and not exotel.valid_out_chunk(b"\x00" * 321) and not exotel.valid_out_chunk(b"\x00" * 100_160)


def test_padding_makes_a_whole_number_of_units() -> None:
    assert len(pad_to_multiple(b"\x01" * 100, 3200)) == 3200 and len(pad_to_multiple(b"\x01" * 3200, 3200)) == 3200


# ---- the line -----------------------------------------------------------------------------------------------------------------------------------


async def connected(rate: int = 16000, **kw: object) -> tuple[PhoneLine, SimulatedExotel]:
    ours, theirs = QueueWire.pair()
    sim = SimulatedExotel(theirs, rate=rate, pace=0, **kw)  # type: ignore[arg-type]
    line = PhoneLine(ours)
    await sim.connect()
    assert await line.open(2.0) is not None
    return line, sim


@arun
async def test_the_line_learns_who_is_calling_and_the_rate() -> None:
    line, sim = await connected(8000, custom={"c": "call-1"}, from_number="+919876543210", to_number="+918000000000")
    assert line.rate == 8000 and line.start is not None and line.start.custom == {"c": "call-1"} and line.start.from_number == "+919876543210"
    await sim.close()


@arun
async def test_the_line_gives_up_when_the_provider_never_says_start() -> None:
    ours, theirs = QueueWire.pair()
    line = PhoneLine(ours)
    assert await line.open(0.1) is None
    theirs.close()


@arun
async def test_audio_from_the_caller_reaches_the_session_at_16_khz_whatever_the_line_rate() -> None:
    for rate, factor in ((16000, 1), (8000, 2)):
        line, sim = await connected(rate)
        await sim.say(tone(300.0, 200, rate))
        got = b""
        while len(got) < 6300:
            kind, payload = await asyncio.wait_for(line.receive(), 2)
            assert kind == "bytes"
            got += payload
        assert abs(len(got) / 2 - 3200) <= 40 * factor, (rate, len(got))
        await sim.close()


@arun
async def test_a_hang_up_and_a_closed_wire_end_the_session() -> None:
    line, sim = await connected()
    await sim.hang_up()
    assert (await asyncio.wait_for(line.receive(), 2)) == ("close", None)
    line2, sim2 = await connected()
    await sim2.close()
    assert (await asyncio.wait_for(line2.receive(), 2)) == ("close", None)


@arun
async def test_a_key_press_is_an_event_for_the_session() -> None:
    line, sim = await connected()
    await sim.press("1")
    assert (await asyncio.wait_for(line.receive(), 2)) == ("text", {"type": "dtmf", "digit": "1"}) and line.dtmf == ["1"]
    await sim.close()


@arun
async def test_the_voices_audio_goes_out_in_chunks_the_provider_accepts() -> None:
    line, sim = await connected()
    await line.send_bytes(tone(300.0, 1234, OUT_RATE))
    await line.send_json({"type": "audio_end", "turn": 1})
    await asyncio.sleep(0.05)
    assert sim.heard.problems == [] and sim.heard.media, sim.heard.problems
    assert all(exotel.valid_out_chunk(p) and len(p) == 3200 for _, p in sim.heard.media)
    assert abs(sim.heard.audio_bytes / 2 / 16000 - 1.234) < 0.1, "all of the audio arrives, the last chunk padded with silence"
    assert [m for _, m in sim.heard.marks] == [f"turn-{line._seq}"] and line.playing()  # noqa: SLF001
    await sim.close()


@arun
async def test_an_eight_khz_line_gets_eight_khz_audio() -> None:
    line, sim = await connected(8000)
    await line.send_bytes(tone(300.0, 1000, OUT_RATE))
    await line.flush()
    await asyncio.sleep(0.05)
    assert abs(sim.heard.audio_bytes / 2 / 8000 - 1.0) < 0.2 and sim.heard.problems == []
    await sim.close()


@arun
async def test_a_stop_clears_what_was_not_played_and_drops_what_was_waiting() -> None:
    line, sim = await connected()
    await line.send_bytes(tone(300.0, 80, OUT_RATE))   # less than a chunk: waiting
    await line.send_json({"type": "audio_stop"})
    await asyncio.sleep(0.05)
    assert len(sim.heard.clears) == 1 and not line.playing()
    await line.flush()
    await asyncio.sleep(0.05)
    assert sim.heard.audio_bytes == 0, "nothing of the stopped speech is sent afterwards"
    await sim.close()


async def drain(line: PhoneLine, wait: float = 0.2) -> list[tuple[str, object]]:
    """Everything the session would be handed now."""
    out: list[tuple[str, object]] = []
    while True:
        try:
            out.append(await asyncio.wait_for(line.receive(), wait))
        except TimeoutError:
            return out


@arun
async def test_the_caller_talking_over_the_assistant_is_a_barge_in_but_only_while_it_speaks() -> None:
    line, sim = await connected()
    await sim.speak_for(400)           # the assistant is quiet: no barge-in, however loud
    quiet = await drain(line)
    assert quiet and all(k == "bytes" for k, _ in quiet)
    await line.send_bytes(tone(300.0, 2000, OUT_RATE))   # now it is speaking for two seconds
    await sim.speak_for(400)
    seen = await drain(line)
    assert ("text", {"type": "barge_in", "verify": True}) in seen
    await sim.close()


@arun
async def test_a_short_blip_while_it_speaks_is_not_a_barge_in() -> None:
    line, sim = await connected()
    await line.send_bytes(tone(300.0, 2000, OUT_RATE))
    await sim.speak_for(60)            # a click, shorter than the minimum
    seen = await drain(line)
    assert not any(k == "text" for k, _ in seen)
    await sim.close()


@arun
async def test_only_finished_caption_lines_become_the_transcript() -> None:
    line, sim = await connected()
    await line.send_json({"type": "caption", "who": "user", "text": "hello th", "final": False})
    await line.send_json({"type": "caption", "who": "user", "text": "hello there", "final": True})
    await line.send_json({"type": "caption", "who": "assistant", "text": "Hi, how can I help?", "final": True, "spoken": True})
    await line.send_json({"type": "state", "state": "thinking"})
    await line.send_json({"type": "caption", "who": "assistant", "text": "   ", "final": True})
    assert [(t["who"], t["text"]) for t in line.transcript] == [("caller", "hello there"), ("assistant", "Hi, how can I help?")]
    await sim.close()


@arun
async def test_a_closed_line_sends_nothing_more() -> None:
    line, sim = await connected()
    await sim.hang_up()
    await asyncio.wait_for(line.receive(), 2)
    await line.send_bytes(tone(300.0, 500, OUT_RATE))
    await line.flush()
    await asyncio.sleep(0.05)
    assert sim.heard.audio_bytes == 0
    await sim.close()
