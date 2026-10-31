"""The Live talk standard's eval (owner, 31 Oct 2026, job live-conversation-standard E): 40 voice dialogues (te 15, en 10, kn 8, hi 7) over the rules of sections A to D, run through the REAL conversation loop with fakes
for the audio, on a time scale (no microphone, no model for the turn-taking parts). tests/evals/live/dialogues.jsonl holds the dialogues; `run_all()` gives the numbers of the quality-bar table.

  turn       a caller's turn with mid-sentence pauses: premature cut-offs (the reply began before they finished) and over-holding (a finished turn made to wait)
  interrupt  a sound while the assistant speaks: the line pauses within 200 ms, a cough / click / "hmm" / TV lets the reply go on, real words stop it, and the history keeps only what was heard
  silence    the check-in after ~8 s and the end after ~30 s
  goodbye    'bye', 'thank you, that's all', 'ఇంక చాలు'
  style      the speaking rules (short, no markup, no gendered address, the caller's script, read back before acting, no invented fact): checked on a model's answer (live, opt-in) or on canned ones (CI)
The latency numbers (user stops -> first audio) are not here: they need the real stack (scripts/live_standard_eval.py --staging)."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.agents.register.address import gendered_words
from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts, ScriptedStt, Segment
from app.conversation.parts import Session, TurnTimings
from app.conversation.pipeline import Conversation
from app.conversation.turntaking import (
    RESUME_AFTER_MS,
    classify_interruption,
    is_goodbye,
    silence_action,
)

ROOT = Path(__file__).resolve().parents[4]
DIALOGUES = ROOT / "tests" / "evals" / "live" / "dialogues.jsonl"
SCALE = 0.05
SCRIPTS = {"te": (0x0C00, 0x0C7F), "kn": (0x0C80, 0x0CFF), "hi": (0x0900, 0x097F), "ta": (0x0B80, 0x0BFF), "ml": (0x0D00, 0x0D7F)}


def load(path: Path = DIALOGUES) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class _Source:
    speech_ended_at: float | None = None

    async def frames(self) -> AsyncIterator[bytes]:
        if False:
            yield b""


def _conversation(stt: Any, language: str, **kw: Any) -> tuple[Conversation, FakePlayout]:
    playout = FakePlayout(rate=16000)
    conv = Conversation(stt=stt, llm=kw.pop("llm", FakeLlm()), tts=kw.pop("tts", FakeTts()), playout=playout, session=Session(system="", language=language), models={"fast": "f", "strong": "s"}, semantic_turns=True, **kw)
    return conv, playout


# ---- turn ----------------------------------------------------------------------------------------------------------------------------------------

@dataclass
class TurnResult:
    id: str
    language: str
    expect_joined: bool
    hard: bool
    merged: int
    total: int
    held_ms: int
    cut_off: bool = False    # they were going on and we took the turn
    over_hold: bool = False  # they were done and we waited / joined the next thing
    waited_for_complete: int = 0


async def run_turn(dialogue_id: str, language: str, beat: dict[str, Any]) -> TurnResult:
    segments = [Segment(s["text"], s["speech_ms"], s["gap_ms"]) for s in beat["segments"]]
    stt = ScriptedStt(segments, scale=SCALE)
    conv, _ = _conversation(stt, language)
    tm = TurnTimings()
    text = await asyncio.wait_for(conv.listen(_Source(), tm), timeout=30)
    texts = [s.text for s in segments]
    merged = next((k for k in range(len(texts), 0, -1) if text == " ".join(texts[:k])), 0)
    expect = bool(beat["expect"]["segments_joined"])
    held = int(tm.held_ms)
    return TurnResult(dialogue_id, language, expect, bool(beat.get("hard")), merged, len(texts), held, cut_off=expect and merged < len(texts), over_hold=(not expect) and (merged > 1 or held > 0),
                      waited_for_complete=0 if expect else held)


# ---- interrupt -----------------------------------------------------------------------------------------------------------------------------------

@dataclass
class InterruptResult:
    id: str
    language: str
    sound: str
    expect: str
    decided: str
    stop_ms: float
    ok: bool
    problems: list[str] = field(default_factory=list)
    tv: bool = False


async def run_interrupt(dialogue_id: str, language: str, beat: dict[str, Any]) -> InterruptResult:
    reply = ("Sure, I can help with that. ", "The price is two thousand six hundred rupees. ", "Shall I send you the photos on WhatsApp?")
    tts = FakeTts(chunks=10, chunk_ms=100, chunk_gap=0.02)
    llm = FakeLlm(reply, gap=0.02)
    conv, playout = _conversation(ScriptedStt([]), language, llm=llm, tts=tts)
    task = asyncio.ensure_future(conv.respond("hello"))
    for _ in range(400):
        if len(playout.writes) >= 4:
            break
        await asyncio.sleep(0.005)
    problems: list[str] = []
    verdict = classify_interruption(int(beat["speech_ms"]), beat.get("text"))
    ms = await conv.pause()
    stop_ms = float(ms or 0.0)
    if ms is None or stop_ms > 200:
        problems.append(f"the line was not paused within 200 ms ({stop_ms:.0f})")
    decided = "stop" if verdict == "barge_in" else "resume"
    if decided == "resume":
        await asyncio.sleep(RESUME_AFTER_MS / 1000.0 * SCALE)
        await conv.resume()
        tm = await asyncio.wait_for(task, timeout=15)
        full = sum(len(p) for p in ("".join(reply),))
        if tm.interrupted or tm.spoken_text != tm.reply_text or not tm.reply_text:
            problems.append("the reply did not go on to its end")
        if playout.bytes_written < 2 * 16000 * 0.1 * 10 * 3 - 10:
            problems.append("the audio cut off by the pause was not said again")
        del full
    else:
        await conv.interrupt()
        tm = await asyncio.wait_for(task, timeout=15)
        if not tm.interrupted or len(tm.spoken_text) >= len(tm.reply_text) or not tm.reply_text.startswith(tm.spoken_text.rstrip("…").rstrip()):
            problems.append("the history does not keep exactly what was heard")
        if conv.session.history and conv.session.history[-1].get("content") == tm.reply_text:
            problems.append("the stored turn is the whole reply, not what was heard")
    return InterruptResult(dialogue_id, language, str(beat["sound"]), str(beat["expect"]), decided, stop_ms, decided == beat["expect"] and not problems, problems, bool(beat.get("tv")))


# ---- silence / goodbye ---------------------------------------------------------------------------------------------------------------------------

def run_silence(beat: dict[str, Any]) -> bool:
    checked, got = False, []
    for q in beat["quiet_s"]:
        action = silence_action(float(q), checked)
        checked = checked or action == "check_in"
        got.append(action)
    return bool(got == beat["expect"])


def run_goodbye(beat: dict[str, Any]) -> bool:
    return is_goodbye(beat["text"]) == bool(beat["expect"])


# ---- style (the checks; the answers come from a model live, or are canned in CI) ---------------------------------------------------------------------

_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐⭕]")
_MARKUP = re.compile(r"[*#_`|]|\]\(|https?://|www\.|^\s*(?:[-•]|\d+[.)])\s", re.MULTILINE)
_SENTENCE = re.compile(r"(?<=[.?!।॥])\s+")
UNKNOWN = {
    "en": ["don't know", "do not know", "not sure", "no information", "don't have", "do not have", "can't find", "cannot find", "no record"],
    "te": ["తెలియదు", "తెలీదు", "లేదు", "లేవు", "లేదండీ", "కనిపించలేదు", "తెలియదండీ"],
    "kn": ["ಗೊತ್ತಿಲ್ಲ", "ತಿಳಿದಿಲ್ಲ", "ಮಾಹಿತಿ ಇಲ್ಲ", "ಇಲ್ಲ"],
    "hi": ["नहीं पता", "पता नहीं", "जानकारी नहीं", "नहीं है", "नहीं मिला"],
}


def dominant_script(text: str) -> str:
    counts = dict.fromkeys(SCRIPTS, 0)
    latin = 0
    for ch in text:
        o = ord(ch)
        for code, (lo, hi) in SCRIPTS.items():
            if lo <= o <= hi:
                counts[code] += 1
                break
        else:
            latin += ch.isascii() and ch.isalpha()
    best = max(counts, key=lambda c: counts[c])
    return best if counts[best] >= 3 and counts[best] >= latin else "en"


def style_problems(answer: str, checks: list[str], language: str, keys: list[str] | None = None) -> list[str]:
    out: list[str] = []
    text = answer.strip()
    sentences = [s for s in _SENTENCE.split(text) if s.strip()]
    if "short" in checks and len(sentences) > 3:
        out.append(f"too long ({len(sentences)} sentences)")
    if "no_markup" in checks and (_MARKUP.search(text) or _EMOJI.search(text)):
        out.append("markup, a link or an emoji")
    if "no_gender" in checks and gendered_words(text):
        out.append("a gendered address")
    if "mirror_script" in checks and dominant_script(text) != language:
        out.append(f"not in the caller's script ({dominant_script(text)})")
    if "readback_or_confirm" in checks:
        if "?" not in text and "？" not in text:
            out.append("no confirmation question")
        if keys and not any(k.lower() in text.lower() for k in keys):
            out.append("does not read the value back")
    if "no_invent" in checks and not any(w.lower() in text.lower() for w in UNKNOWN.get(language, UNKNOWN["en"])):
        out.append("does not say it does not know")
    return out


# ---- all ------------------------------------------------------------------------------------------------------------------------------------------

async def run_all(dialogues: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    dialogues = dialogues or load()
    turns: list[TurnResult] = []
    interrupts: list[InterruptResult] = []
    silences: list[bool] = []
    byes: list[bool] = []
    styles: list[tuple[str, dict[str, Any]]] = []
    for d in dialogues:
        for beat in d["beats"]:
            kind = beat["kind"]
            if kind == "turn":
                turns.append(await run_turn(d["id"], d["lang"], beat))
            elif kind == "interrupt":
                interrupts.append(await run_interrupt(d["id"], d["lang"], beat))
            elif kind == "silence":
                silences.append(run_silence(beat))
            elif kind == "goodbye":
                byes.append(run_goodbye(beat))
            elif kind == "style":
                styles.append((d["lang"], beat))
    return {"dialogues": len(dialogues), "turns": turns, "interrupts": interrupts, "silences": silences, "goodbyes": byes, "styles": styles}


def summary(result: dict[str, Any]) -> dict[str, Any]:
    turns: list[TurnResult] = result["turns"]
    thinking = [t for t in turns if t.expect_joined]
    done = [t for t in turns if not t.expect_joined]
    ints: list[InterruptResult] = result["interrupts"]
    noise = [i for i in ints if i.expect == "resume"]
    real = [i for i in ints if i.expect == "stop"]
    return {
        "premature_cut_off_pct": round(100 * sum(t.cut_off for t in thinking) / max(1, len(thinking)), 1),
        "premature_cut_off_without_hard_pct": round(100 * sum(t.cut_off for t in thinking if not t.hard) / max(1, sum(1 for t in thinking if not t.hard)), 1),
        "thinking_turns": len(thinking),
        "over_hold_pct": round(100 * sum(t.over_hold for t in done) / max(1, len(done)), 1),
        "finished_turns": len(done),
        "false_interruption_pct": round(100 * sum(i.decided != "resume" for i in noise) / max(1, len(noise)), 1),
        "false_interruption_without_tv_pct": round(100 * sum(i.decided != "resume" for i in noise if not i.tv) / max(1, sum(1 for i in noise if not i.tv)), 1),
        "noise_sounds": len(noise),
        "real_interruptions_stopped_pct": round(100 * sum(i.decided == "stop" and i.ok for i in real) / max(1, len(real)), 1),
        "pause_ms_max": round(max((i.stop_ms for i in ints), default=0.0), 1),
        "pause_ms_p50": round(sorted(i.stop_ms for i in ints)[len(ints) // 2], 1) if ints else 0.0,
        "mechanics_failures": sum(1 for i in ints if i.problems),
        "silence_ok": f"{sum(result['silences'])}/{len(result['silences'])}",
        "goodbye_ok": f"{sum(result['goodbyes'])}/{len(result['goodbyes'])}",
    }


def now() -> float:
    return time.perf_counter()
