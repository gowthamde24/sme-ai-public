"""The pre-recorded style previews job (app/conversation/style_previews.py): fake engines only, no key, no network."""

# ruff: noqa: E501
from __future__ import annotations

import json
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from app.conversation import style_previews as sp
from app.conversation.fakes import tone
from app.telephony import tone as tone_mod
from tests.test_dv_browser_voice import arun


class Engine:
    sample_rate = 16000

    def __init__(self) -> None:
        self.settings: dict[str, Any] = {}

    async def prewarm(self) -> None: ...

    def set_style(self, settings: dict[str, Any]) -> None:
        self.settings = settings

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        yield tone(1500)


def prepare(text: str, language: str, engine: str) -> str:
    return text


def test_the_work_list_is_four_recommended_voices_per_language_times_seven_styles() -> None:
    todo = sp.items()
    assert len(todo) == 16 * 7 == 112
    assert {i.language for i in todo} == set(sp.LANGUAGES) and {i.style for i in todo} == set(tone_mod.CHOICES)
    assert all(i.voice.recommended and i.voice.listed and "{" not in i.line for i in todo)
    for lang in sp.LANGUAGES:
        assert len({i.voice.id for i in todo if i.language == lang}) == 4
    chars = {"sarvam_v4": 0, "cartesia": 0}
    for i in todo:
        chars[i.voice.voices.primary.engine] += len(i.line)
    assert 4_500 <= chars["sarvam_v4"] <= 8_000 and 2_000 <= chars["cartesia"] <= 4_000, chars


@arun
async def test_each_clip_is_spoken_with_its_styles_own_voice_settings_and_kept_with_a_manifest() -> None:
    def make(choice: Any, language: str) -> Engine:
        e = Engine()
        made.append(e)
        return e

    made: list[Engine] = []
    todo = [i for i in sp.items() if i.voice.language == "te"][:14]
    clips, sent = await sp.run(todo, make, prepare, {"cartesia": 10**6, "sarvam_v4": 10**6})
    assert all(c.ok for c in clips) and sum(sent.values()) == sum(len(i.line) for i in todo)
    calm = next(e for e, i in zip(made, todo, strict=True) if i.style == "calm_caring" and i.voice.voices.primary.engine == "sarvam_v4")
    assert calm.settings == {"pace": 0.88, "pitch": -0.08, "loudness": 0.9, "temperature": 0.55}
    plain = next(e for e, i in zip(made, todo, strict=True) if i.style == "friendly" and i.voice.voices.primary.engine == "sarvam_v4")
    assert plain.settings == {}
    out = Path(tempfile.mkdtemp())
    manifest = sp.keep(clips, out)
    assert len(list(out.glob("*.wav"))) == 14 and len(manifest["files"]) == 14
    on_disk = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert all(f["status"] == "draft" for f in on_disk["files"] if f["language"] == "te") and on_disk["settings"]["cheerful"]["sarvam"]["pitch"] == 0.1


@arun
async def test_the_cap_stops_the_run_and_a_dead_engine_is_a_closed_word() -> None:
    todo = sp.items()[:6]
    first = len(todo[0].line) + len(todo[1].line) + 1
    clips, sent = await sp.run(todo, lambda c, lang: Engine(), prepare, {"cartesia": first, "sarvam_v4": first})
    assert [c.reason for c in clips if not c.ok] and sum(sent.values()) <= 2 * first

    class Boom(Engine):
        async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
            raise RuntimeError("down")
            yield b""

    clips2, _ = await sp.run(todo[:2], lambda c, lang: Boom(), prepare, {"cartesia": 10**6, "sarvam_v4": 10**6})
    assert [c.reason for c in clips2] == ["error:RuntimeError"] * 2 and "FAILED:" in sp.report(clips2, {})


def test_the_public_route_serves_only_a_known_voice_style_and_language(monkeypatch: Any) -> None:
    from app.conversation import picker
    from tests.fakes import make_client

    folder = Path(tempfile.mkdtemp())
    (folder / "te-kavitha.calm_caring.te.mp3").write_bytes(b"ID3fake")
    monkeypatch.setattr(picker, "STYLE_SAMPLES", folder)
    client, _ = make_client()
    ok = client.get("/v1/voice-style-samples/te-kavitha.calm_caring.te.mp3")
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/mpeg" and "max-age" in ok.headers["cache-control"]
    for bad in ("te-kavitha.nonsense.te.mp3", "te-kavitha.calm_caring.xx.mp3", "nobody.calm_caring.te.mp3", "te-kavitha.calm_caring.te", "..%2f..%2fetc.calm_caring.te.mp3", "te-kavitha.cheerful.te.mp3"):
        assert client.get(f"/v1/voice-style-samples/{bad}").status_code == 404, bad
