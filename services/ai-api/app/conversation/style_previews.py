# ruff: noqa: E501
"""Pre-recorded style previews (docs/contracts/voice-styles.md; owner 24 Nov 2026: previews are files, never live AI for the listener).

A Cloud Run job on the API's image (keys from Secret Manager): for each RECOMMENDED voice of te, hi, kn, en (2 women + 2 men each = 16 voices) x the 7 styles it speaks the style's shop line once on its PRIMARY engine, with the style's real voice settings
(app/conversation/style_voice.py: pitch, loudness, temperature, volume, emotion where the provider supports them). Checks audio, length > 1 s, not silent; keeps each good clip as `<voice>.<style>.<language>.wav` plus manifest.json (status `draft`: the te/hi/kn lines and the
settings are drafts to be listened to); prints only ok/FAIL per file and the characters per engine. Stops at the character caps. About 5,900 Sarvam + 2,800 Cartesia characters for the 112 clips."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.conversation import style_voice
from app.conversation.engines import real_engine_factory
from app.conversation.fallback import EngineFactory
from app.conversation.voice_check import MIN_SECONDS, SILENT_RMS, rms, wav_bytes
from app.conversation.voices import CatalogueVoice, default_config
from app.pronunciation.speech import SpeechText
from app.telephony import tone

LANGUAGES = ("te", "hi", "kn", "en")
SARVAM_CAP = 12_000
CARTESIA_CAP = 6_000
LINES = Path(__file__).resolve().parent / "data" / "style_lines.json"


@dataclass
class Item:
    voice: CatalogueVoice
    style: str
    language: str
    line: str
    review: str

    @property
    def name(self) -> str:
        return f"{self.voice.id}.{self.style}.{self.language}"


@dataclass
class Clip:
    name: str
    engine: str
    ok: bool
    reason: str
    seconds: float = 0.0
    pcm: bytes = b""
    rate: int = 24000
    line: str = ""
    review: str = ""


def items(languages: tuple[str, ...] = LANGUAGES) -> list[Item]:
    data = json.loads(LINES.read_text(encoding="utf-8"))
    business = data["business"]
    out: list[Item] = []
    for voice in sorted(default_config().catalogue.values(), key=lambda v: (v.language, v.gender, v.id)):
        if voice.language in languages and voice.recommended and voice.listed:
            for style in tone.CHOICES:
                row = data["styles"][style][voice.language]
                out.append(Item(voice, style, voice.language, str(row["line"]).replace("{shop}", business), str(row["review"])))
    return out


async def speak(item: Item, make: EngineFactory, prepare: Any) -> Clip:
    choice = item.voice.voices.primary
    text = prepare(item.line, item.language, choice.engine)
    try:
        engine = make(choice, item.language)
        set_style = getattr(engine, "set_style", None)
        if set_style is not None:
            set_style(style_voice.settings_for(item.style, "cartesia" if choice.engine == "cartesia" else "sarvam"))
        pcm = b"".join([c async for c in engine.stream(text, item.language)])
    except Exception as exc:  # noqa: BLE001 - one bad clip must not stop the run
        return Clip(item.name, choice.engine, False, f"error:{exc.__class__.__name__}")
    if not pcm:
        return Clip(item.name, choice.engine, False, "no_audio")
    rate = int(getattr(engine, "sample_rate", 24000) or 24000)
    seconds = len(pcm) / 2 / rate
    if seconds < MIN_SECONDS:
        return Clip(item.name, choice.engine, False, "too_short", seconds)
    if rms(pcm) < SILENT_RMS:
        return Clip(item.name, choice.engine, False, "silent", seconds)
    return Clip(item.name, choice.engine, True, "", seconds, pcm, rate, item.line, item.review)


async def run(todo: list[Item], make: EngineFactory, prepare: Any, caps: dict[str, int], pause_s: float = 0.0) -> tuple[list[Clip], dict[str, int]]:
    sent = {"cartesia": 0, "sarvam_v4": 0}
    clips: list[Clip] = []
    for item in todo:
        engine = item.voice.voices.primary.engine
        chars = len(prepare(item.line, item.language, engine))
        if sent.get(engine, 0) + chars > caps.get(engine, 0):
            clips.append(Clip(item.name, engine, False, "cap"))
            continue
        sent[engine] = sent.get(engine, 0) + chars
        clips.append(await speak(item, make, prepare))
        if pause_s:
            await asyncio.sleep(pause_s)
    return clips, sent


def keep(clips: list[Clip], out: Path) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    for c in clips:
        if not c.ok:
            continue
        audio = wav_bytes(c.pcm, c.rate)
        (out / f"{c.name}.wav").write_bytes(audio)
        voice, style, language = c.name.split(".")
        rows.append({"name": c.name, "voice_id": voice, "style": style, "language": language, "engine": c.engine, "seconds": round(c.seconds, 2), "sha256": hashlib.sha256(audio).hexdigest(), "line": c.line, "status": "draft" if language != "en" or c.review != "ok" else "final-text-draft-voice"})
    manifest = {"files": rows, "settings": style_voice.STYLE_VOICE}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


def report(clips: list[Clip], sent: dict[str, int]) -> str:
    lines = [f"{c.name:46s} {'ok  ' if c.ok else 'FAIL'} {c.engine:10s} {c.seconds:5.1f}s {c.reason}".rstrip() for c in clips]
    bad = [c for c in clips if not c.ok]
    lines.append(f"clips {len(clips)}  ok {len(clips) - len(bad)}  failed {len(bad)}  characters sent: sarvam {sent.get('sarvam_v4', 0)}, cartesia {sent.get('cartesia', 0)}")
    lines.append("FAILED: " + (", ".join(f"{c.name} ({c.reason})" for c in bad) if bad else "none"))
    return "\n".join(lines)


async def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--keep", default="", help="a folder (the mounted bucket): keep each good clip as a WAV plus manifest.json there")
    ap.add_argument("--sarvam-cap", type=int, default=SARVAM_CAP)
    ap.add_argument("--cartesia-cap", type=int, default=CARTESIA_CAP)
    args = ap.parse_args(argv)
    ck, sk = os.environ.get("CARTESIA_API_KEY", ""), os.environ.get("SARVAM_API_KEY", "")
    if not ck or not sk:
        print("both CARTESIA_API_KEY and SARVAM_API_KEY must be bound from Secret Manager", file=sys.stderr)
        return 2
    clips, sent = await run(items(), real_engine_factory(cartesia_key=ck, sarvam_key=sk), SpeechText().prepare, {"sarvam_v4": args.sarvam_cap, "cartesia": args.cartesia_cap}, pause_s=0.2)
    if args.keep:
        keep(clips, Path(args.keep))
    print(report(clips, sent))
    return 0 if all(c.ok for c in clips) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
