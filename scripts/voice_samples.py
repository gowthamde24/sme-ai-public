#!/usr/bin/env python3
"""Listening samples and the speech-to-text check, with Sarvam (night 3, ADR 0101). OPT-IN: never part of make check, never run by CI.

  make voice-samples            renders the call-opening and two follow-up lines in en, te, hi, kn, ta, ml (3 voices, 2 styles) into ~/Desktop/stack19-jobs/voice-samples/<lang>/<voice>-<style>-<n>.wav and writes index.html
  make voice-stt-check          transcribes two of those clips per language back and reports the word accuracy (voice-samples/stt-report.md)
  python scripts/voice_samples.py --dry-run     counts what a run would send; opens no connection, reads no key

HARD CAPS, counted BEFORE anything is sent and kept across runs in usage.json: 9,000 characters of text-to-speech and 180 seconds of audio for speech-to-text. The key is read from SARVAM_API_KEY or from
Secret Manager (sme-sarvam-api-key) into a variable; it is never printed, logged or written. Synthetic lines only."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "ai-api"))

from app.voice.interface import VoiceError  # noqa: E402
from app.voice.samples import (  # noqa: E402
    STT_SECOND_CAP,
    STYLES,
    TTS_CHAR_CAP,
    Clip,
    index_html,
    plan,
    stt_picks,
    wav_seconds,
    within_cap,
    word_accuracy,
)
from app.voice.sarvam import SarvamStt, SarvamTts  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"
SECRET = "sme-sarvam-api-key"
DEFAULT_OUT = Path.home() / "Desktop" / "stack19-jobs" / "voice-samples"


def read_key() -> str:
    key = os.environ.get("SARVAM_API_KEY", "").strip()
    if key:
        return key
    done = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={SECRET}", f"--project={PROJECT}"], capture_output=True, text=True, check=False)
    if done.returncode != 0 or not done.stdout.strip():
        raise SystemExit("cannot read the Sarvam key from Secret Manager (skipping): the run needs SARVAM_API_KEY or access to sme-sarvam-api-key")
    return done.stdout.strip()


def load_usage(out: Path) -> dict:
    path = out / "usage.json"
    if path.exists():
        return json.loads(path.read_text())
    return {"chars_total": 0, "stt_seconds_total": 0.0, "runs": []}


def save_usage(out: Path, usage: dict) -> None:
    (out / "usage.json").write_text(json.dumps(usage, ensure_ascii=False, indent=1))


def existing(out: Path, clips: list[Clip]) -> list[Clip]:
    return [c for c in clips if (out / c.path).exists()]


def render(out: Path, dry: bool) -> None:
    out.mkdir(parents=True, exist_ok=True)
    usage = load_usage(out)
    todo = [c for c in plan() if not (out / c.path).exists()]
    fits, chars = within_cap(todo, TTS_CHAR_CAP, usage["chars_total"])
    print(f"clips planned {len(plan())}, already rendered {len(plan()) - len(todo)}, to send {len(fits)} ({chars} characters; {usage['chars_total']} already spent of the {TTS_CHAR_CAP} cap)")
    if len(fits) < len(todo):
        print(f"STOPPED AT THE CAP: {len(todo) - len(fits)} clips will not be rendered")
    if dry:
        return
    tts = SarvamTts(read_key(), "bulbul:v3")
    sent_chars = requests = 0
    stopped = len(fits) < len(todo)
    for clip in fits:
        style = STYLES[clip.style]
        for attempt in (1, 2):
            try:
                speech = tts.synthesize(clip.text, clip.lang, speaker=clip.voice, pace=style["pace"], temperature=style["temperature"])
                break
            except VoiceError as exc:
                if exc.code == "http_429" and attempt == 1:
                    time.sleep(6)
                    continue
                print(f"a clip failed ({exc.code}): {clip.path}; stopping so no more is spent")
                stopped = True
                speech = None
                break
        if speech is None:
            break
        requests += 1
        sent_chars += len(clip.text)
        usage["chars_total"] += len(clip.text)   # counted when the request was made, success or not the provider billed the text
        target = out / clip.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(speech.audio)
        save_usage(out, usage)
        time.sleep(0.25)
    usage["runs"].append({"at": datetime.now(UTC).isoformat(timespec="seconds"), "kind": "tts", "chars": sent_chars, "requests": requests, "stopped_early": stopped})
    save_usage(out, usage)
    (out / "index.html").write_text(index_html(existing(out, plan()), usage), encoding="utf-8")
    print(f"done: {requests} requests, {sent_chars} characters this run, {usage['chars_total']} in total; page: {out / 'index.html'}")


def stt_check(out: Path, dry: bool) -> None:
    usage = load_usage(out)
    picks = stt_picks(existing(out, plan()))
    chosen, seconds = [], 0.0
    for clip in picks:
        length = wav_seconds((out / clip.path).read_bytes())
        if usage["stt_seconds_total"] + seconds + length > STT_SECOND_CAP:
            print(f"STOPPED AT THE CAP before {clip.path}")
            break
        chosen.append((clip, length))
        seconds += length
    print(f"{len(chosen)} clips, {seconds:.1f} seconds of audio ({usage['stt_seconds_total']:.1f} already spent of the {STT_SECOND_CAP:.0f}-second cap)")
    if dry or not chosen:
        return
    stt = SarvamStt(read_key(), "saaras:v4")
    rows = []
    for clip, length in chosen:
        try:
            heard = stt.transcribe((out / clip.path).read_bytes(), "audio/wav", clip.lang).text
        except VoiceError as exc:
            heard = ""
            print(f"a clip failed ({exc.code}): {clip.path}")
        usage["stt_seconds_total"] += length
        save_usage(out, usage)
        rows.append({"clip": clip.path, "seconds": round(length, 1), "reference": clip.text, "heard": heard, "word_accuracy": round(word_accuracy(clip.text, heard), 3)})
        time.sleep(0.25)
    usage["runs"].append({"at": datetime.now(UTC).isoformat(timespec="seconds"), "kind": "stt", "seconds": round(seconds, 1), "clips": len(rows)})
    save_usage(out, usage)
    by_lang: dict[str, list[float]] = {}
    for r in rows:
        by_lang.setdefault(r["clip"].split("/")[0], []).append(r["word_accuracy"])
    (out / "stt-report.json").write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=1))
    lines = ["# Speech-to-text check (Sarvam saaras:v4, synthetic clips made with Bulbul v3)", "", "| language | clips | word accuracy |", "|---|---|---|"]
    lines += [f"| {lang} | {len(v)} | {sum(v) / len(v):.0%} |" for lang, v in by_lang.items()]
    lines += ["", f"Audio sent: {seconds:.1f} s this run, {usage['stt_seconds_total']:.1f} s in total (cap {STT_SECOND_CAP:.0f} s).", "", "| clip | reference | heard | accuracy |", "|---|---|---|---|"]
    lines += [f"| {r['clip']} | {r['reference']} | {r['heard']} | {r['word_accuracy']:.0%} |" for r in rows]
    (out / "stt-report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:4 + len(by_lang)]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--stt", action="store_true", help="the speech-to-text check instead of the samples")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    (stt_check if args.stt else render)(args.out, args.dry_run)


if __name__ == "__main__":
    main()
