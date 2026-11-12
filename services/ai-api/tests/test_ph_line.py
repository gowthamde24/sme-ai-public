"""Phone calls, part 2: Exotel's stream protocol, the resampler and the phone line as a socket, against the simulator (no account needed)."""

# ruff: noqa: E501
from __future__ import annotations

import array
import asyncio
import base64
import json

import pytest

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
    msg = json.loads(exotel.media_message("XP1", pcm))
    assert msg["event"] == "media" and msg["stream_sid"] == "XP1" and base64.b64decode(msg["media"]["payload"]) == pcm
    assert set(msg) == {"event", "stream_sid", "media"} and set(msg["media"]) == {"payload"}, "exactly Exotel's documented shape: no sequence_number, no chunk"
    assert json.loads(exotel.clear_message("XP1")) == {"event": "clear", "stream_sid": "XP1"}
    assert json.loads(exotel.mark_message("XP1", "t")) == {"event": "mark", "stream_sid": "XP1", "mark": {"name": "t"}}
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
    await sim.speak_for(800)
    seen = await drain(line)
    assert ("text", {"type": "barge_in", "verify": False}) in seen, "real speech (longer than STOP_SPEECH_MS) while it speaks stops it"
    assert line.interruptions == {"stopped": 1, "ignored": 0}
    await sim.close()


@arun
async def test_a_backchannel_while_it_speaks_does_not_stop_it_and_is_logged() -> None:
    """Owner, 6 Nov 2026: "haa", "hmm", "avunu", "sare", "ji" (short sounds) let her keep talking."""
    line, sim = await connected()
    await line.send_bytes(tone(300.0, 3000, OUT_RATE))
    await sim.speak_for(350)            # "avunu"
    await sim.quiet_for(400)
    seen = await drain(line)
    assert not any(k == "text" for k, _ in seen) and line.interruptions == {"stopped": 0, "ignored": 1}
    await sim.close()


@arun
async def test_a_stop_fades_out_instead_of_cutting() -> None:
    """The voice is not cut mid-word: what Exotel had queued is cleared and the next ~200 ms are sent again, the volume going down to silence."""
    line, sim = await connected(8000)
    await line.send_bytes(tone(300.0, 1000, OUT_RATE))   # a second of voice sent (paced 0.3 s ahead)
    await asyncio.sleep(0.2)   # (the simulated Exotel has read everything sent so far)
    before = len(sim.heard.media)
    await line.send_json({"type": "audio_stop"})
    await asyncio.sleep(0.2)
    tail = b"".join(p for _, p in sim.heard.media[before:])
    assert len(sim.heard.clears) == 1 and tail, "the queue is cleared, then a short faded tail is sent"
    assert line.fade_ms and 40 <= line.fade_ms[0] <= 250
    samples = array.array("h")
    samples.frombytes(tail)
    head, end = samples[: len(samples) // 4], samples[-len(samples) // 4 :]
    assert max(abs(x) for x in end) < max(abs(x) for x in head), "it gets quieter towards the end"
    assert max(abs(x) for x in samples[-40:]) < 0.1 * max(abs(x) for x in head) and samples[-1] == 0, "and ends in silence"
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


@arun
async def test_a_person_takes_the_call_over_and_hands_it_back() -> None:
    """Take over (app v4): the AI stops (the same faded stop), the caller's audio reaches the person, the person's audio reaches the caller at the call's rate, no barge-in meanwhile; hand back ends it."""
    line, sim = await connected(8000)
    await line.send_bytes(tone(300.0, 2000, OUT_RATE))   # the AI is talking
    caller = line.take_over()
    seen = await drain(line, 0.1)
    assert ("text", {"type": "barge_in", "verify": False}) in seen, "the AI's voice stops"
    await sim.speak_for(800)                               # the caller talks over the person: never a barge-in
    seen = await drain(line, 0.1)
    assert not any(k == "text" for k, _ in seen) and caller.qsize() > 0, "the caller's audio goes to the person"
    before = sim.heard.audio_bytes
    await line.send_owner_audio(tone(250.0, 500, 16000))  # half a second of the person's voice (16 kHz)
    await asyncio.sleep(0.3)
    assert abs((sim.heard.audio_bytes - before) / 2 / 8000 - 0.5) < 0.15 and sim.heard.problems == [], "it reaches the caller at 8 kHz, in Exotel's chunks"
    line.hand_back()
    await sim.speak_for(100)
    assert not line.taken_over and caller.qsize() >= 0
    before = sim.heard.audio_bytes
    await line.send_owner_audio(tone(250.0, 300, 16000))
    assert sim.heard.audio_bytes == before, "after hand back the person's audio goes nowhere"
    await sim.close()


# ---- 11 Nov 2026: 450 ms, spoken stop words, backchannel words; the rule that fired is logged
def test_the_stop_and_backchannel_words() -> None:
    from app.telephony.line import has_stop_word, only_backchannel

    for yes in ("ఆగండి", "ఆగండి ఒక్క నిమిషం", "stop", "Wait a second", "hold on please", "అయ్యో ఆగు", "ఒక్క నిమిషం!"):
        assert has_stop_word(yes), yes
    for no in ("అవును", "waiting for you", "stopping by", "ఆగస్టు నెల", "ok hmm", ""):
        assert has_stop_word(no) is None, no
    for back in ("ఆ", "ఆ, ఆ", "అవును అండీ", "ok", "hmm ok", "హా అవును"):
        assert only_backchannel(back), back
    for real in ("ఆగండి", "ఆ కానీ marks ఎంత", "no", "", "ధర ఎంత"):
        assert not only_backchannel(real), real


class _Logs:
    """The records of the line's logger (the async tests here cannot take pytest fixtures)."""

    def __init__(self) -> None:
        import logging

        self.records: list[str] = []
        self._handler = logging.Handler()
        self._handler.emit = lambda record: self.records.append(record.getMessage())  # type: ignore[method-assign]
        self._logger = logging.getLogger("app.telephony.line")
        self._old = self._logger.level
        self._logger.addHandler(self._handler)
        self._logger.setLevel(logging.INFO)

    def text(self) -> str:
        return "\n".join(self.records)

    def close(self) -> None:
        self._logger.removeHandler(self._handler)
        self._logger.setLevel(self._old)


@arun
async def test_a_sound_of_500_ms_is_an_interruption_now_and_one_of_400_ms_is_not() -> None:
    logs = _Logs()
    try:
        line, sim = await connected()
        await line.send_bytes(tone(300.0, 4000, OUT_RATE))
        await sim.speak_for(400)
        await sim.quiet_for(400)
        await drain(line)
        assert line.interruptions == {"stopped": 0, "ignored": 1}, "400 ms: still a short sound"
        line.note_caller_text("మీరు ఏమన్నారు")   # the recogniser has real words by then
        await sim.speak_for(520)
        seen = await drain(line)
        assert line.interruptions["stopped"] == 1 and ("text", {"type": "barge_in", "verify": False}) in seen
        assert "rule=audio_450ms" in logs.text() and "words=2" in logs.text(), "the rule that fired is logged, with the number of words (never the words)"
        await sim.close()
    finally:
        logs.close()


@arun
async def test_a_long_sound_whose_words_are_only_a_backchannel_is_ignored_and_a_real_one_is_not() -> None:
    logs = _Logs()
    try:
        line, sim = await connected()
        await line.send_bytes(tone(300.0, 5000, OUT_RATE))
        line.note_caller_text("అవును అండీ")
        await sim.speak_for(900)
        await sim.quiet_for(400)
        await drain(line)
        assert line.interruptions["stopped"] == 0 and "rule=backchannel_words" in logs.text()
        await sim.close()
        line2, sim2 = await connected()
        await line2.send_bytes(tone(300.0, 5000, OUT_RATE))
        line2.note_caller_text("ఆ, కానీ")
        await sim2.speak_for(900)
        await drain(line2)
        assert line2.interruptions["stopped"] == 1
        await sim2.close()
    finally:
        logs.close()


@arun
async def test_a_spoken_stop_word_stops_it_at_once_whatever_the_length_but_only_while_it_speaks() -> None:
    logs = _Logs()
    try:
        line, sim = await connected()
        line.note_caller_text("ఆగండి")                       # the assistant is quiet: nothing to stop
        assert line.interruptions == {"stopped": 0, "ignored": 0}
        await line.send_bytes(tone(300.0, 3000, OUT_RATE))
        line.note_caller_text("ఆ")                           # a backchannel word: nothing
        assert line.interruptions["stopped"] == 0
        line.note_caller_text("ఆగండి ఒక్క నిమిషం")           # a stop word, no long sound at all
        seen = await drain(line)
        assert line.interruptions["stopped"] == 1 and ("text", {"type": "barge_in", "verify": False}) in seen
        assert "rule=stop_word" in logs.text()
        line.note_caller_text("stop stop")
        assert line.interruptions["stopped"] == 1, "one stop per sound run"
        await sim.close()
    finally:
        logs.close()


def test_the_call_session_hands_the_callers_live_words_to_the_line(monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from app.browser_voice.session import VoiceSession
    from app.conversation.parts import SttEvent
    from app.telephony.call_session import CallVoiceSession

    monkeypatch.setattr(VoiceSession, "_on_stt", lambda self, ev: None)
    heard: list[str] = []
    probe = object.__new__(CallVoiceSession)
    probe.socket = SimpleNamespace(_line=SimpleNamespace(note_caller_text=heard.append))
    probe._on_stt(SttEvent("partial", "ఆగండి"))
    probe._on_stt(SttEvent("final", "ఆగండి ఒక్క నిమిషం"))
    probe._on_stt(SttEvent("speech_end", ""))
    probe._on_stt(SttEvent("partial", ""))
    assert heard == ["ఆగండి", "ఆగండి ఒక్క నిమిషం"], "partials and finals with words; nothing else"


# ---- 12 Nov 2026: a goodbye is heard in full ------------------------------------------------------------------------------------------------------


async def closed_within(line: PhoneLine, seconds: float) -> bool:
    try:
        return (await asyncio.wait_for(line.receive(), seconds)) == ("close", None)
    except TimeoutError:
        return False


@arun
async def test_the_line_closes_only_after_the_closing_line_has_played_and_a_short_pause() -> None:
    import time

    line, sim = await connected()
    line.close_pause_s, line.mark_wait_s = 0.3, 0.2
    line.hang_up_after_next_turn("goodbye", interruptible=True)
    await line.send_bytes(tone(300.0, 600, OUT_RATE))
    until = line._play_until  # noqa: SLF001
    await line.send_json({"type": "audio_end", "turn": 1})
    assert await closed_within(line, 3.0)
    assert time.monotonic() >= until + 0.29, "not before the last audio has played, plus the pause"
    assert line.end_reason == "goodbye"
    await sim.close()


@arun
async def test_the_line_waits_for_the_providers_own_played_word_for_the_last_checkpoint() -> None:
    line, sim = await connected()
    line.close_pause_s, line.mark_wait_s = 0.1, 1.5
    line.hang_up_after_next_turn("goodbye")
    await line.send_bytes(tone(300.0, 200, OUT_RATE))
    task = asyncio.ensure_future(line.send_json({"type": "audio_end", "turn": 1}))
    await asyncio.sleep(0.7)   # our own estimate of the playing time is over; the provider has not said it played
    assert not line._closed, "still waiting for the provider's word"  # noqa: SLF001
    line._on_event(exotel.Mark(f"turn-{line._seq}"))  # noqa: SLF001, SLF001
    await task
    assert await closed_within(line, 1.0)
    await sim.close()


@arun
async def test_a_caller_speaking_over_the_closing_line_cancels_the_hang_up_and_the_call_goes_on() -> None:
    line, sim = await connected()
    line.close_pause_s = 0.05
    cancelled: list[int] = []
    line.on_hang_up_cancelled = lambda: cancelled.append(1)
    line.hang_up_after_next_turn("goodbye", interruptible=True)
    await line.send_bytes(tone(300.0, 400, OUT_RATE))
    await line.send_json({"type": "audio_stop"})   # the 450 ms rule: the caller spoke over it
    await line.send_json({"type": "audio_end", "turn": 1})   # the interrupted turn ends
    assert not await closed_within(line, 0.5), "no hang-up: the caller is talking"
    assert cancelled == [1] and line.goodbye_interrupted == 1 and line.end_reason is None
    await sim.close()


@arun
async def test_a_stop_request_or_a_hand_over_still_ends_the_call_even_if_the_caller_speaks_over_the_acknowledgement() -> None:
    line, sim = await connected()
    line.close_pause_s, line.mark_wait_s = 0.05, 0.1
    line.hang_up_after_next_turn("goodbye")   # not interruptible: the caller asked not to be called
    await line.send_bytes(tone(300.0, 200, OUT_RATE))
    await line.send_json({"type": "audio_stop"})
    await line.send_json({"type": "audio_end", "turn": 1})
    assert await closed_within(line, 2.0) and line.end_reason == "goodbye"
    await sim.close()


# ---- 12 Nov 2026: a backchannel is never an interruption, even when its words arrive late; the closing line needs a stop word or 800 ms ------------------


async def speaking_line() -> tuple[PhoneLine, SimulatedExotel, _Logs]:
    logs = _Logs()
    line, sim = await connected()
    await line.send_bytes(tone(300.0, 6000, OUT_RATE))
    return line, sim, logs


@arun
async def test_a_long_sound_whose_words_have_not_arrived_is_given_a_moment_and_a_backchannel_that_arrives_late_is_ignored() -> None:
    line, sim, logs = await speaking_line()
    try:
        await sim.speak_for(520)    # past 450 ms and the recogniser has produced nothing yet: not stopped yet
        await drain(line)
        assert line.interruptions["stopped"] == 0 and not line._stopped_run  # noqa: SLF001
        line.note_caller_text("ఆ")  # the word "ఆ" arrives late: a backchannel
        await sim.speak_for(100)
        await sim.quiet_for(400)
        await drain(line)
        assert line.interruptions == {"stopped": 0, "ignored": 1}
        assert "rule=backchannel_words" in logs.text() and "words=1" in logs.text()
        await sim.close()
    finally:
        logs.close()


@arun
async def test_a_long_sound_with_no_words_at_all_is_an_interruption_after_the_grace() -> None:
    line, sim, logs = await speaking_line()
    try:
        await sim.speak_for(900)
        await drain(line)
        assert line.interruptions["stopped"] == 1 and "rule=audio_700ms_no_words" in logs.text()
        await sim.close()
    finally:
        logs.close()


@arun
async def test_every_backchannel_word_is_ignored_even_when_the_sound_is_long() -> None:
    for word in ("ఆ", "సరే", "హా", "ok", "hmm", "ఆ సరే"):
        line, sim, logs = await speaking_line()
        try:
            line.note_caller_text(word)
            await sim.speak_for(1200)
            await sim.quiet_for(300)
            await drain(line)
            assert line.interruptions == {"stopped": 0, "ignored": 1}, word
            await sim.close()
        finally:
            logs.close()


@arun
async def test_during_the_closing_line_a_sound_needs_800_ms_or_a_stop_word() -> None:
    line, sim, logs = await speaking_line()
    try:
        line.hang_up_after_next_turn("goodbye", interruptible=True)   # the closing line is playing
        line.note_caller_text("ఇంకేమి లేదు")
        await sim.speak_for(600)       # real words, past 450 ms: not enough while the goodbye plays
        await drain(line)
        assert line.interruptions["stopped"] == 0
        await sim.speak_for(400)       # 1000 ms in all (the run continues)
        await drain(line)
        assert line.interruptions["stopped"] == 1 and "rule=audio_800ms_closing" in logs.text()
        await sim.close()
    finally:
        logs.close()
    line, sim, logs = await speaking_line()
    try:
        line.hang_up_after_next_turn("goodbye", interruptible=True)
        line.note_caller_text("ఆగండి")   # a stop word stops it at once, whatever the length
        assert line.interruptions["stopped"] == 1 and "rule=stop_word" in logs.text()
        await sim.close()
    finally:
        logs.close()
