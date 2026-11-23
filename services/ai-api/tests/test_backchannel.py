"""The assistant's small listening sounds (21-23 Nov 2026; reports/call-humanness-audit.md item 1): sparse, only in a pause of a long caller turn, never over her own speech, never over a question, never twice in 7 s, and never taken for a barge-in. Pure planner tests, then the line with a simulated provider."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio

from app.browser_voice.audio import OUT_RATE
from app.conversation.fakes import tone
from app.telephony import backchannel as bc
from tests.test_dv_browser_voice import arun
from tests.test_ph_line import connected


def feed(p: bc.Planner, talk_ms: int, quiet_ms: int, **kw: object) -> list[bool]:
    out = [p.feed(True, speaking=False, **kw) for _ in range(talk_ms // bc.FRAME_MS)]  # type: ignore[arg-type]
    out += [p.feed(False, speaking=False, **kw) for _ in range(quiet_ms // bc.FRAME_MS)]  # type: ignore[arg-type]
    return out


def test_a_short_turn_gets_no_listening_sound() -> None:
    assert not any(feed(bc.Planner(), 2000, 600))


def test_a_long_turn_gets_one_in_its_first_pause_and_only_one_per_pause() -> None:
    p = bc.Planner()
    fired = feed(p, 3000, 1000)
    assert fired.count(True) == 1 and fired.index(True) == 3000 // bc.FRAME_MS + bc.GAP_MS // bc.FRAME_MS - 1, "at the 320 ms mark of the pause, not before"


def test_the_pause_that_ends_the_turn_is_the_answers_not_a_hmm() -> None:
    assert not any(feed(bc.Planner(), 3000, 200)) and not any(bc.Planner().feed(False, speaking=False) for _ in range(100))


def test_never_more_than_one_every_seven_seconds_and_the_next_one_needs_new_talk() -> None:
    p = bc.Planner()
    assert feed(p, 3000, 400).count(True) == 1
    assert not any(feed(p, 3000, 400)), "6 seconds later: too soon"
    assert feed(p, 3600, 400).count(True) == 1, "after 7 seconds of the call and a fresh stretch of talking: again"


def test_never_while_she_speaks_never_when_a_person_has_the_call_never_when_off_never_over_a_question() -> None:
    p = bc.Planner()
    assert not any(p.feed(True, speaking=True) or p.feed(False, speaking=True) for _ in range(500))
    assert not any(feed(bc.Planner(), 3000, 600, taken_over=True))
    assert not any(feed(bc.Planner(enabled=False), 3000, 600))
    assert not any(feed(bc.Planner(), 3000, 600, caller_text="what is the price of this saree?"))


def test_every_call_language_has_words_and_the_clips_never_repeat_back_to_back() -> None:
    for lang in ("en", "te", "hi", "kn", "ta", "ml", "mr"):
        assert len(bc.words_of(lang)) >= 3 and all(w.strip() for w in bc.words_of(lang))
    assert bc.words_of("xx") == bc.WORDS["en"]
    clips = bc.Clips()
    assert clips.next() is None
    for i in range(3):
        clips.put(bytes([i + 1]) * 1000)
    seen = [clips.next() for _ in range(7)]
    assert all(a != b for a, b in zip(seen, seen[1:], strict=False)) and len(clips) == 3
    clips.put(b"")
    clips.put(b"x" * 10)
    assert len(clips) == 3, "an empty or too-short clip is never kept"


@arun
async def test_the_line_says_one_small_sound_in_a_pause_and_the_caller_going_on_is_not_a_barge_in() -> None:
    line, sim = await connected()
    line.backchannel.enabled = True
    line.backchannel_clips.put(tone(500, OUT_RATE))
    await sim.speak_for(3000)
    await sim.quiet_for(400)
    await asyncio.sleep(0.2)
    assert line.backchannels_said == 1 and sim.heard.media, "one clip went out in the pause"
    sim.heard.media.clear()
    await sim.speak_for(1500)   # the caller goes on talking over it
    await asyncio.sleep(0.1)
    assert line.interruptions == {"stopped": 0, "ignored": 0}, "talking over a listening sound is not a barge-in"
    assert line.backchannels_said == 1
    await sim.close()


@arun
async def test_enabled_but_without_a_clip_there_is_nothing_to_say() -> None:
    line, sim = await connected()
    line.backchannel.enabled = True
    await sim.speak_for(3000)
    await sim.quiet_for(500)
    await asyncio.sleep(0.2)
    assert line.backchannels_said == 0 and not sim.heard.media
    await sim.close()


@arun
async def test_a_clip_but_not_enabled_means_no_sound() -> None:
    line, sim = await connected()
    line.backchannel_clips.put(tone(500, OUT_RATE))
    await sim.speak_for(3000)
    await sim.quiet_for(500)
    await asyncio.sleep(0.2)
    assert line.backchannels_said == 0 and not sim.heard.media
    await sim.close()


@arun
async def test_render_keeps_what_the_voice_speaks_and_survives_a_failing_voice() -> None:
    class Voice:
        def __init__(self, fail_after: int) -> None:
            self.fail_after = fail_after
            self.said: list[str] = []

        def begin_turn(self) -> None: ...

        async def stream(self, text: str, language: str):  # type: ignore[no-untyped-def]
            self.said.append(text)
            if len(self.said) > self.fail_after:
                raise RuntimeError("down")
            yield tone(300, OUT_RATE)

    clips, voice = bc.Clips(), Voice(99)
    assert await bc.render(clips, voice, "te") == 3 and voice.said == list(bc.WORDS["te"])
    clips2 = bc.Clips()
    assert await bc.render(clips2, Voice(1), "hi") == 1, "a failure keeps what there is and never raises"
