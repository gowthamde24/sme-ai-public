# ruff: noqa: E501
"""Does every voice of the catalogue really speak? (planner brief 23 Nov 2026; owner: "test it ... all").

A Cloud Run job on the API's image (keys bound from Secret Manager, nothing typed in a shell): for each listed voice of the chosen languages it speaks the voice's own sample line ONCE on its PRIMARY engine (no fallback, so a dead voice cannot hide behind
its fallback) and checks that audio came back, is longer than MIN_SECONDS and is not silent. It prints one line per voice id (ok / FAIL + a closed reason word) and the characters sent per engine. No audio is kept. Characters are counted before each voice and
the run stops when SARVAM_CAP (or CARTESIA_CAP) would be passed. The cost is the characters of the sample lines: about 19,900 Sarvam + 3,950 Cartesia for te, hi, kn, en."""

from __future__ import annotations

import argparse
import array
import asyncio
import math
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass

from app.conversation.engines import real_engine_factory
from app.conversation.fallback import EngineFactory
from app.conversation.voices import (  # noqa: F401 - sample_text is re-used by the tests
    CatalogueVoice,
    default_config,
    sample_text,
)
from app.pronunciation.speech import SpeechText

MIN_SECONDS = 1.0
SILENT_RMS = 40.0          # 16-bit samples: below this the clip is silence
SARVAM_CAP = 40_000        # characters; the owner's cap for one run is Rs 200 (about 60,000 characters at Rs 30 per 10,000: this stops well before)
CARTESIA_CAP = 12_000
LANGUAGES = ("te", "hi", "kn", "en")


@dataclass
class Result:
    voice_id: str
    engine: str
    ok: bool
    reason: str      # "" when ok, else a closed word: no_audio | too_short | silent | error:<ExceptionName> | cap
    seconds: float = 0.0


def rms(pcm: bytes) -> float:
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    return math.sqrt(sum(s * s for s in samples) / len(samples)) if samples else 0.0


async def check_one(voice: CatalogueVoice, make: EngineFactory, prepare: Callable[[str, str, str], str]) -> Result:
    choice = voice.voices.primary
    text = prepare(sample_text(voice.language), voice.language, choice.engine)
    try:
        engine = make(choice, voice.language)
        pcm = b"".join([chunk async for chunk in engine.stream(text, voice.language)])
    except Exception as exc:  # noqa: BLE001 - one dead voice must not stop the run
        return Result(voice.id, choice.engine, False, f"error:{exc.__class__.__name__}")
    if not pcm:
        return Result(voice.id, choice.engine, False, "no_audio")
    rate = int(getattr(engine, "sample_rate", 24000) or 24000)
    seconds = len(pcm) / 2 / rate
    if seconds < MIN_SECONDS:
        return Result(voice.id, choice.engine, False, "too_short", seconds)
    if rms(pcm) < SILENT_RMS:
        return Result(voice.id, choice.engine, False, "silent", seconds)
    return Result(voice.id, choice.engine, True, "", seconds)


async def run(voices: list[CatalogueVoice], make: EngineFactory, prepare: Callable[[str, str, str], str], caps: dict[str, int], pause_s: float = 0.0) -> tuple[list[Result], dict[str, int]]:
    sent = {"cartesia": 0, "sarvam_v4": 0}
    results: list[Result] = []
    for voice in voices:
        engine = voice.voices.primary.engine
        chars = len(prepare(sample_text(voice.language), voice.language, engine))
        if sent.get(engine, 0) + chars > caps.get(engine, 0):
            results.append(Result(voice.id, engine, False, "cap"))
            continue
        sent[engine] = sent.get(engine, 0) + chars
        results.append(await check_one(voice, make, prepare))
        if pause_s:
            await asyncio.sleep(pause_s)
    return results, sent


def report(results: list[Result], sent: dict[str, int]) -> str:
    lines = [f"{r.voice_id:34s} {'ok  ' if r.ok else 'FAIL'} {r.engine:10s} {r.seconds:5.1f}s {r.reason}".rstrip() for r in results]
    bad = [r for r in results if not r.ok]
    lines.append(f"voices {len(results)}  ok {len(results) - len(bad)}  failed {len(bad)}  characters sent: sarvam {sent.get('sarvam_v4', 0)}, cartesia {sent.get('cartesia', 0)}")
    lines.append("FAILED: " + (", ".join(f"{r.voice_id} ({r.reason})" for r in bad) if bad else "none"))
    return "\n".join(lines)


async def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--languages", default=",".join(LANGUAGES))
    ap.add_argument("--only-recommended", action="store_true", help="only the recommended voices (a small, cheap run)")
    ap.add_argument("--sarvam-cap", type=int, default=SARVAM_CAP)
    ap.add_argument("--cartesia-cap", type=int, default=CARTESIA_CAP)
    args = ap.parse_args(argv)
    ck, sk = os.environ.get("CARTESIA_API_KEY", ""), os.environ.get("SARVAM_API_KEY", "")
    if not ck or not sk:
        print("both CARTESIA_API_KEY and SARVAM_API_KEY must be bound from Secret Manager", file=sys.stderr)
        return 2
    cfg, speech = default_config(), SpeechText()
    wanted = set(args.languages.split(","))
    voices = [v for v in cfg.catalogue.values() if v.language in wanted and (v.recommended or not args.only_recommended)]
    voices.sort(key=lambda v: (v.language, v.gender, v.id))
    results, sent = await run(voices, real_engine_factory(cartesia_key=ck, sarvam_key=sk), speech.prepare, {"sarvam_v4": args.sarvam_cap, "cartesia": args.cartesia_cap}, pause_s=0.2)
    print(report(results, sent))
    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
