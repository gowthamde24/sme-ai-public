"""What a speaking style does to the voice itself (app/conversation/style_voice.py): the table is inside the providers' documented ranges, friendly sends nothing extra, and each engine puts the style on the wire."""

# ruff: noqa: E501
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.conversation import style_voice as sv
from app.conversation.providers import CartesiaStreamTts
from app.telephony import tone
from tests.test_dv_browser_voice import arun


def test_every_style_is_in_the_table_and_every_value_inside_its_documented_range() -> None:
    assert list(sv.STYLE_VOICE) == list(tone.CHOICES)
    for style, engines in sv.STYLE_VOICE.items():
        for engine, values in engines.items():
            for name, value in values.items():
                if name != "emotion":
                    low, high = sv.RANGES[name]
                    assert low <= value <= high, (style, engine, name)


def test_friendly_and_unknown_send_nothing_extra_and_values_are_clamped() -> None:
    for style in ("friendly", None, "nonsense"):
        assert sv.settings_for(style, "sarvam") == {} and sv.settings_for(style, "cartesia") == {}
    assert sv.settings_for("calm_caring", "sarvam") == {"pace": 0.88, "pitch": -0.08, "loudness": 0.9, "temperature": 0.55}
    assert sv.clamp("pitch", 9) == 0.5 and sv.clamp("speed", 0.1) == 0.6 and sv.clamp("volume", 9) == 2.0


def test_the_styles_really_differ_from_each_other() -> None:
    seen = {s: (tuple(sorted(sv.settings_for(s, "sarvam").items())), tuple(sorted(sv.settings_for(s, "cartesia").items()))) for s in tone.CHOICES}
    assert len(set(seen.values())) == len(tone.CHOICES), "no two styles share the same voice settings"


class _Captured:
    def __init__(self) -> None:
        self.bodies: list[dict[str, Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(json.loads(request.content))
        return httpx.Response(200, content=b"\x00\x01" * 400)


async def spoken(style: str | None, language: str = "en", speed: float = 1.0) -> dict[str, Any]:
    cap = _Captured()
    tts = CartesiaStreamTts("k", voice_id="v", client=httpx.AsyncClient(transport=httpx.MockTransport(cap.handler)))
    tts.set_pace(speed)
    tts.set_style(sv.settings_for(style, "cartesia"))
    _ = [c async for c in tts.stream("hello", language)]
    return cap.bodies[0]


@arun
async def test_cartesia_gets_speed_volume_and_emotion_only_where_the_style_and_language_allow() -> None:
    assert "generation_config" not in await spoken("friendly"), "friendly (and no style) speaks exactly as before"
    calm = (await spoken("calm_caring"))["generation_config"]
    assert calm == {"speed": 0.88, "volume": 0.9, "emotion": "sympathetic"}
    assert "emotion" not in (await spoken("calm_caring", "te"))["generation_config"], "emotion is documented for English only"
    assert (await spoken("cheerful", speed=1.2))["generation_config"]["speed"] == 1.3, "the style's factor sits on the workspace speed"
    assert (await spoken("quick", speed=1.5))["generation_config"]["speed"] == 1.5, "never past the documented 1.5"


@pytest.mark.parametrize("style", ["respectful", "cheerful", "confident"])
def test_sarvam_config_carries_pitch_loudness_temperature_of_the_style(style: str) -> None:
    from app.conversation.providers import SarvamStreamTts

    tts = SarvamStreamTts("k", speaker="s", language="te")
    plain = tts._pace  # noqa: SLF001
    tts.set_style(sv.settings_for(style, "sarvam"))
    want = sv.settings_for(style, "sarvam")
    assert tts._style == want  # noqa: SLF001
    assert tts._pace != plain or "pace" not in want  # noqa: SLF001
    tts.set_style({})
    assert tts._pace == plain  # noqa: SLF001
