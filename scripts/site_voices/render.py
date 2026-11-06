"""Render the landing page's "Hear it" clips with Cartesia and write their word timestamps (job landing-v2, part F1).

    CARTESIA_API_KEY=… python scripts/site_voices/render.py [--force] [--only hero-te,try-en]

Reads scripts/site_voices/clips.json (the design's own words and the app's catalogue voices). For each clip it calls Cartesia's
`POST /tts/sse` with word timestamps, encodes the audio twice (Opus 48 kbps in WebM, and AAC 48 kbps in MP4 for browsers without
Opus), and writes apps/web/public/audio/site/manifest.json, which the web reads. A clip whose words, voice and model did not change
is skipped (no cost). The key is read from the environment only and is never printed or written anywhere.

The timestamps are mapped onto the DISPLAYED words (the text split on spaces), so the web can light caption word i at words[i].start.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import wave
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name("clips.json")
OUT = ROOT / "apps" / "web" / "public" / "audio" / "site"
MANIFEST = OUT / "manifest.json"
CARTESIA = "https://api.cartesia.ai"
VERSION = "2025-04-16"
MODEL = "sonic-3.6"
RATE = 24_000


def sha(clip: dict[str, Any], voice: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps({"t": clip["text"], "v": voice["cartesia"], "l": voice["language"], "m": MODEL}, sort_keys=True).encode()).hexdigest()[:16]


def synthesize(client: httpx.Client, key: str, text: str, voice: dict[str, Any]) -> tuple[bytes, dict[str, list[Any]], str]:
    """(16-bit PCM at 24 kHz, Cartesia's word timestamps, the language actually used). Marathi falls back to Hindi if the model refuses it."""
    for language in [voice["language"]] + (["hi"] if voice["language"] == "mr" else []):
        body = {"model_id": MODEL, "transcript": text, "voice": {"mode": "id", "id": voice["cartesia"]}, "language": language,
                "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": RATE}, "add_timestamps": True}
        pcm = bytearray()
        stamps: dict[str, list[Any]] = {"words": [], "start": [], "end": []}
        refused = False
        with client.stream("POST", f"{CARTESIA}/tts/sse", headers={"X-API-Key": key, "Cartesia-Version": VERSION}, json=body) as resp:
            if resp.status_code in (400, 422) and language == "mr":
                refused = True
            elif resp.status_code != 200:
                raise SystemExit(f"Cartesia refused {text[:30]!r}: HTTP {resp.status_code}")
            else:
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    event = json.loads(line[5:].strip() or "{}")
                    kind = event.get("type")
                    if kind == "chunk" and event.get("data"):
                        pcm += base64.b64decode(event["data"])
                    elif kind == "timestamps":
                        wt = event.get("word_timestamps") or {}
                        for k in ("words", "start", "end"):
                            stamps[k] += list(wt.get(k) or [])
                    elif kind == "error":
                        raise SystemExit(f"Cartesia error for {text[:30]!r}: {str(event.get('error'))[:120]}")
        if not refused:
            return bytes(pcm), stamps, language
    raise SystemExit(f"no language worked for {text[:30]!r}")


def align(display: list[str], stamps: dict[str, list[Any]], duration: float) -> list[dict[str, Any]]:
    """Cartesia's words onto the displayed words: one to one when the counts agree, else by position (the j-th of n spoken words covers the
    same share of the line as the i-th of m displayed words)."""
    words, start, end = stamps["words"], stamps["start"], stamps["end"]
    n, m = len(words), len(display)
    if n == 0:   # no timestamps: spread evenly over the clip
        return [{"w": w, "start": round(duration * i / m, 3), "end": round(duration * (i + 1) / m, 3)} for i, w in enumerate(display)]
    out = []
    for i, w in enumerate(display):
        a = min(n - 1, (i * n) // m)
        b = min(n - 1, max(a, ((i + 1) * n) // m - 1))
        out.append({"w": w, "start": round(float(start[a]), 3), "end": round(float(end[b]), 3)})
    return out


def encode(pcm: bytes, stem: Path) -> float:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm[: len(pcm) // 2 * 2])
        for args, suffix in ((["-c:a", "libopus", "-b:a", "48k", "-application", "voip"], ".webm"), (["-c:a", "aac", "-b:a", "48k"], ".m4a")):
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ar", "48000", *args, str(stem.with_suffix(suffix))], check=True)
    return round(len(pcm) / 2 / RATE, 3)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="render every clip again")
    parser.add_argument("--only", default="", help="comma-separated clip ids")
    args = parser.parse_args()
    key = os.environ.get("CARTESIA_API_KEY", "").strip()
    if not key:
        print("CARTESIA_API_KEY is not set", file=sys.stderr)
        return 2
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    voices = source["voices"]
    old = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"clips": {}}
    only = {c for c in args.only.split(",") if c}
    OUT.mkdir(parents=True, exist_ok=True)
    clips: dict[str, Any] = {}
    made = 0
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        for clip in source["clips"]:
            voice = voices[clip["voice"]]
            digest = sha(clip, voice)
            previous = old["clips"].get(clip["id"])
            stem = OUT / clip["id"]
            fresh = previous and previous.get("sha") == digest and stem.with_suffix(".webm").exists() and stem.with_suffix(".m4a").exists()
            if fresh and not args.force and (not only or clip["id"] not in only):
                clips[clip["id"]] = previous
                continue
            pcm, stamps, used = synthesize(client, key, clip["text"], voice)
            duration = encode(pcm, stem)
            display = clip["text"].split()
            clips[clip["id"]] = {
                "group": clip["group"], "speaker": clip.get("speaker", "assistant"), "lang": voice["language"], "spoken_as": used,
                "voice": {"id": voice["id"], "name": voice["name"]}, "draft": bool(clip.get("draft") or voice.get("draft")),
                "text": clip["text"], "duration": duration, "words": align(display, stamps, duration),
                "sources": [{"src": f"/audio/site/{clip['id']}.webm", "type": "audio/webm; codecs=opus"}, {"src": f"/audio/site/{clip['id']}.m4a", "type": "audio/mp4"}],
                "sha": digest,
            }
            made += 1
            print(f"{clip['id']}: {duration:.1f} s, {len(stamps['words'])} timestamped words, {len(display)} shown")
    manifest = {
        "$comment": "Made by scripts/site_voices/render.py from scripts/site_voices/clips.json (job landing-v2, F1). Play sources[0] if the browser can, else sources[1]. Light caption word i from words[i].start to words[i].end (seconds from the start). draft = not yet checked by a native speaker. Every business named is a sample.",
        "version": 1, "model": f"cartesia {MODEL}", "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "groups": {g: [c["id"] for c in source["clips"] if c["group"] == g] for g in dict.fromkeys(c["group"] for c in source["clips"])},
        "clips": clips,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"rendered {made}, kept {len(clips) - made}; manifest {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
