"""Fillers only when the wait is real (owner, 31 Oct 2026): none on small talk; on a data turn only if the answer audio has not started by the configured time; at most one a turn, never on two turns in a row, never the
same line twice in a row; and one that the answer overtook is not played. Against the real loop with fakes."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
from typing import Any

from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts, ScriptedStt
from app.conversation.fillers import FillerBank
from app.conversation.parts import Session
from app.conversation.pipeline import Conversation
from tests.test_dv_browser_voice import arun

PCM = {"one": b"\x01\x00" * 500, "two": b"\x02\x00" * 500, "three": b"\x03\x00" * 500}   # (1,000 bytes: not the size of a voice chunk of the fake)


def conv_with(tier: str, *, first_token: float = 0.5, first_audio: float = 0.0, after_ms: int = 150, casual: bool = False, bank: FillerBank | None = None) -> tuple[Conversation, FakePlayout, FakeLlm]:
    bank = bank or FillerBank(seed=1)
    bank._audio[("en", "v")] = dict(PCM)   # noqa: SLF001
    playout = FakePlayout(rate=16000)
    llm = FakeLlm(("Here you go. ",), first_token_delay=first_token)
    chosen: Any = tier
    conv = Conversation(stt=ScriptedStt([]), llm=llm, tts=FakeTts(first_audio_delay=first_audio, chunks=2, chunk_ms=50), playout=playout, session=Session(system="", language="en"), models={"fast": "f", "strong": "s"},
                        fillers=bank, voice="v", filler_after_ms=after_ms, filler_on_casual=casual, router=lambda text, tools, turn: chosen)
    return conv, playout, llm


def filler_bytes(playout: FakePlayout) -> int:
    return sum(n for _, n in playout.writes if n == 1000)


@arun
async def test_small_talk_never_gets_a_filler_however_slow() -> None:
    conv, playout, _ = conv_with("fast", first_token=0.6)
    tm = await conv.respond("hello how are you")
    assert not tm.filler_played and filler_bytes(playout) == 0


@arun
async def test_a_data_turn_gets_a_filler_only_when_the_answer_is_late() -> None:
    conv, playout, _ = conv_with("strong", first_token=0.5, after_ms=150)
    tm = await conv.respond("how many leads came in today")
    assert tm.filler_played and filler_bytes(playout) == 1000, "late: the filler said it once"
    conv2, playout2, _ = conv_with("strong", first_token=0.02, after_ms=300)
    tm2 = await conv2.respond("how many leads came in today")
    assert not tm2.filler_played and filler_bytes(playout2) == 0, "on time: no filler"


@arun
async def test_a_filler_is_dropped_when_the_answer_audio_is_ready_first() -> None:
    conv, playout, _ = conv_with("strong", first_token=0.0, first_audio=0.1, after_ms=250)
    tm = await conv.respond("show me the pending quotes")
    assert not tm.filler_played and filler_bytes(playout) == 0


@arun
async def test_never_on_two_turns_in_a_row_and_at_most_one_a_turn() -> None:
    conv, playout, _ = conv_with("strong", first_token=0.4, after_ms=100)
    first = await conv.respond("one slow data question")
    second = await conv.respond("another slow data question")
    third = await conv.respond("and a third slow data question")
    assert [first.filler_played, second.filler_played, third.filler_played] == [True, False, True]
    assert filler_bytes(playout) == 2 * 1000, "one each on turns one and three, none on two"


@arun
async def test_casual_fillers_can_be_switched_on_by_configuration() -> None:
    conv, _, _ = conv_with("fast", first_token=0.4, after_ms=100, casual=True)
    assert (await conv.respond("hello")).filler_played


def test_the_bank_never_says_the_same_line_twice_in_a_row() -> None:
    bank = FillerBank(seed=3)
    bank._audio[("en", "v")] = dict(PCM)   # noqa: SLF001
    lines = [bank.pick("en", "v")[0] for _ in range(200)]   # type: ignore[index]
    assert all(a != b for a, b in zip(lines, lines[1:], strict=False)) and set(lines) == set(PCM)


def test_the_defaults_are_the_owner_s_numbers_and_come_from_configuration() -> None:
    from app.browser_voice.limits import Limits
    from app.config import Settings

    assert Limits().filler_after_ms == 1800 and Limits().filler_on_casual is False
    s = Settings(api_env="development")
    assert s.browser_voice_filler_after_ms == 1800 and s.browser_voice_filler_on_casual is False
    assert Settings(api_env="development", browser_voice_filler_after_ms=1000, browser_voice_filler_on_casual=True).browser_voice_filler_after_ms == 1000
    assert isinstance(asyncio, object)
    _: Any = None
