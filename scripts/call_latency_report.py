#!/usr/bin/env python3
"""Phone-call latency per stage (owner, Track C, 15 Nov 2026): reads the `phone_turn` log line the voice session writes for every phone turn (numbers and closed words only, never a word that was said) from Cloud
Logging and prints p50 / p95 / max per stage, overall and by model tier and voice engine.

Stages (all in ms, the caller's last word is t = 0):
  eot            end-of-speech detection: how long we waited after the last speech before deciding the turn was over   (wait_end_of_turn_ms)
  stt_final      the speech-to-text final transcript after that point                                                  (transcript_ms)
  llm_first      the model's first token after the final transcript                                                    (model_first_token_ms)
  tts_first      the voice's first audio after the first words of the reply                                            (voice_first_audio_ms)
  after_final    final transcript to the first sound we send (llm_first + tts_first + glue)                            (since_transcript_ms)
  first_sound    the caller's last word to the first sound we send: what the caller feels, before the carrier           (to_first_sound_ms)
  route          final transcript to the model request: model choice, prompt and context                              (route_ms, from 15 Nov)
  piece_wait     the model's first token to the first piece handed to the voice                                         (piece_wait_ms, from 15 Nov)
The carrier's own playback delay (Plivo) is not in our log; `--probe` is for the barge-in and carrier tests with a sandbox call.

  python3 scripts/call_latency_report.py --days 7                 print the table
  python3 scripts/call_latency_report.py --days 1 --since 2026-11-15T00:00:00Z
  python3 scripts/call_latency_report.py --days 7 --write docs/plans/call-latency.md   also write the report file"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

PROJECT = "project-2757c07e-37d2-4167-88f"
STAGES = (("eot", "wait_end_of_turn_ms"), ("stt_final", "transcript_ms"), ("llm_first", "model_first_token_ms"), ("tts_first", "voice_first_audio_ms"), ("after_final", "since_transcript_ms"), ("first_sound", "to_first_sound_ms"), ("route", "route_ms"), ("piece_wait", "piece_wait_ms"))
LINE = re.compile(r"(?:phone|talk)_turn n=(\d+) " + " ".join(rf"{key}=(\S+)" for _, key in STAGES[:6]) + r"(?: route_ms=(\S+) piece_wait_ms=(\S+))? tier=(\S+) engine=(\S+) filler=(\S+) speculative=(\S+) interrupted=(\S+) held_ms=(\S+)(?: lang=(\S+))?")
TARGET_P50, TARGET_P95 = 1200, 1500


def pull(days: int, since: str | None, kind: str = "phone") -> list[dict[str, str]]:
    flt = f'resource.type="cloud_run_revision" AND (textPayload:"{kind}_turn n=" OR jsonPayload.msg:"{kind}_turn n=")'
    if since:
        flt += f' AND timestamp>="{since}"'
    out = subprocess.run(["gcloud", "logging", "read", flt, "--project", PROJECT, "--limit", "20000", "--freshness", f"{days}d", "--format", "json"], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        sys.exit("gcloud logging read failed: " + out.stderr.strip().splitlines()[-1][:200])
    rows = []
    for entry in json.loads(out.stdout or "[]"):
        text = entry.get("textPayload") or (entry.get("jsonPayload") or {}).get("msg") or ""
        m = LINE.search(text)
        if m and f"{kind}_turn n=" in text:
            g = m.groups()
            row = {"ts": entry.get("timestamp", ""), "n": g[0]}
            for (name, _), value in zip(STAGES[:6], g[1:7], strict=True):
                row[name] = value
            row["route"], row["piece_wait"] = g[7] or "-", g[8] or "-"   # older lines (before 15 Nov) do not carry these two
            row.update({"tier": g[9], "engine": g[10], "filler": g[11], "speculative": g[12], "interrupted": g[13], "held": g[14], "lang": g[15] or "-"})
            rows.append(row)
    return rows


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def table(rows: list[dict[str, str]], title: str) -> list[str]:
    lines = [f"### {title} ({len(rows)} turns)", "", "| stage | p50 ms | p95 ms | max ms | n |", "|---|---:|---:|---:|---:|"]
    for name, _ in STAGES:
        vals = [float(r[name]) for r in rows if r[name] not in ("-", "")]
        p50, p95 = pct(vals, 0.5), pct(vals, 0.95)
        lines.append(f"| {name} | {'-' if p50 is None else round(p50)} | {'-' if p95 is None else round(p95)} | {'-' if not vals else round(max(vals))} | {len(vals)} |")
    return lines + [""]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--since", default=None)
    ap.add_argument("--write", default=None)
    ap.add_argument("--talk", action="store_true", help="read the browser Talk turns (`talk_turn`, from 15 Nov) instead of phone turns; adds a table per language")
    a = ap.parse_args()
    kind = "talk" if a.talk else "phone"
    rows = [r for r in pull(a.days, a.since, kind) if r["interrupted"] != "True"]   # a turn the caller talked over has no honest "first sound"
    if not rows:
        print(f"no {kind} turns in that window")
        return 1
    out = [f"# {'Browser Talk' if a.talk else 'Phone-call'} latency per stage (staging, {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC)", "", f"Target: first sound p50 < {TARGET_P50} ms, p95 < {TARGET_P95} ms. Turns the caller interrupted are left out.", ""]
    out += table(rows, f"All {kind} turns")
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in rows:
        groups[f"model tier {r['tier']}, voice {r['engine']}"].append(r)
    for key in sorted(groups):
        if len(groups[key]) >= 5:
            out += table(groups[key], key)
    if a.talk:
        by_lang: dict[str, list[dict[str, str]]] = defaultdict(list)
        for r in rows:
            by_lang[f"language {r['lang']}"].append(r)
        for key in sorted(by_lang):
            if len(by_lang[key]) >= 3:
                out += table(by_lang[key], key)
    fs = [float(r["first_sound"]) for r in rows if r["first_sound"] not in ("-", "")]
    p50, p95 = pct(fs, 0.5), pct(fs, 0.95)
    out.append(f"First sound: p50 {'-' if p50 is None else round(p50)} ms ({'meets' if p50 is not None and p50 < TARGET_P50 else 'misses'} {TARGET_P50}), p95 {'-' if p95 is None else round(p95)} ms ({'meets' if p95 is not None and p95 < TARGET_P95 else 'misses'} {TARGET_P95}).")
    print("\n".join(out))
    if a.write:
        open(a.write, "w").write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
