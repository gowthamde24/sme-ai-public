"""The all-voices speak check (app/conversation/voice_check.py): fake engines only, no key, no network."""

# ruff: noqa: E501
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from app.conversation import voice_check as vc
from app.conversation.fakes import silence, tone
from app.conversation.voices import default_config, sample_text
from tests.test_dv_browser_voice import arun


class Engine:
    sample_rate = 16000

    def __init__(self, kind: str) -> None:
        self.kind = kind

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        if self.kind == "boom":
            raise RuntimeError("down")
        if self.kind == "none":
            return
        yield {"ok": tone(1500), "short": tone(300), "silent": silence(1500)}[self.kind]


def factory(kinds: dict[str, str]) -> Any:
    return lambda choice, language: Engine(kinds.get(choice.voice, "ok"))


def prepare(text: str, language: str, engine: str) -> str:
    return text


def some(n: int = 4) -> list[Any]:
    return [v for v in default_config().catalogue.values() if v.language == "te"][:n]


@arun
async def test_each_failure_kind_gets_its_own_closed_word_and_one_dead_voice_does_not_stop_the_run() -> None:
    vs = some(5)
    kinds = {vs[0].voices.primary.voice: "boom", vs[1].voices.primary.voice: "none", vs[2].voices.primary.voice: "short", vs[3].voices.primary.voice: "silent"}
    results, sent = await vc.run(vs, factory(kinds), prepare, {"cartesia": 10**6, "sarvam_v4": 10**6})
    assert [r.reason for r in results] == ["error:RuntimeError", "no_audio", "too_short", "silent", ""]
    assert [r.ok for r in results] == [False, False, False, False, True]
    text = vc.report(results, sent)
    assert "FAILED: " in text and "characters sent" in text and text.count("FAIL") >= 4


@arun
async def test_the_character_cap_stops_a_run_before_it_is_passed_and_counts_what_was_sent() -> None:
    vs = [v for v in default_config().catalogue.values() if v.language == "hi" and v.voices.primary.engine == "sarvam_v4"][:6]
    one = len(sample_text("hi"))
    results, sent = await vc.run(vs, factory({}), prepare, {"cartesia": 10**6, "sarvam_v4": one * 3 + 1})
    assert [r.ok for r in results] == [True, True, True, False, False, False] and results[3].reason == "cap"
    assert sent["sarvam_v4"] == one * 3


def test_the_full_run_costs_about_what_the_owner_was_told() -> None:
    cfg, speech = default_config(), None
    chars = {"sarvam_v4": 0, "cartesia": 0}
    for v in cfg.catalogue.values():
        if v.language in vc.LANGUAGES:
            chars[v.voices.primary.engine] += len(sample_text(v.language))
    assert 19_000 <= chars["sarvam_v4"] <= 21_000 and 3_500 <= chars["cartesia"] <= 4_500 and speech is None
    assert chars["sarvam_v4"] < vc.SARVAM_CAP and chars["cartesia"] < vc.CARTESIA_CAP


def test_rms_tells_silence_from_sound() -> None:
    assert vc.rms(silence(500)) < vc.SILENT_RMS < vc.rms(tone(500)) and vc.rms(b"") == 0.0
