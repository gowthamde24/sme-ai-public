"""Small Plivo clean-ups (11 Nov 2026): one stop is one clear and one fade, even when it is told twice."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio

from app.browser_voice.audio import OUT_RATE
from app.telephony.exotel import event_name
from app.telephony.pcm import tone
from tests.test_dv_browser_voice import arun
from tests.test_ph_line import connected


@arun
async def test_the_same_interruption_told_twice_clears_and_fades_once() -> None:
    line, sim = await connected(8000)
    await line.send_bytes(tone(300.0, 1000, OUT_RATE))
    await asyncio.sleep(0.2)
    before = len(sim.heard.media)
    await line.send_json({"type": "audio_stop"})
    await line.send_json({"type": "audio_stop"})   # the session told us twice
    await asyncio.sleep(0.2)
    assert len(sim.heard.clears) == 1 and len(line.fade_ms) == 1, "one clear, one fade"
    tail = b"".join(p for _, p in sim.heard.media[before:])
    assert tail, "the faded tail was sent once and not cut by a second clear"
    # new speech, then a new interruption: that one is a real second interruption
    await line.send_bytes(tone(300.0, 1000, OUT_RATE))
    await asyncio.sleep(0.2)
    await line.send_json({"type": "audio_stop"})
    await asyncio.sleep(0.2)
    assert len(sim.heard.clears) == 2 and len(line.fade_ms) == 2
    await sim.close()


def test_event_names_in_the_log_include_camel_case_and_still_never_a_value() -> None:
    assert event_name('{"event": "playedStream"}') == "playedStream" and event_name('{"event": "clearedAudio"}') == "clearedAudio" and event_name('{"event": "media"}') == "media"
    assert event_name('{"event": "9502380998"}') == "other" and event_name('{"event": "a b"}') == "other" and event_name('{"event": "' + "x" * 30 + '"}') == "other"
    assert event_name("not json") == "unreadable"
