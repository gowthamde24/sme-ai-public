#!/usr/bin/env python3
"""Real-provider latency of the streaming conversation loop (job natural-voice, part 2). OPT-IN: the one script of the job that runs the loop against live Sarvam, Cartesia and Anthropic (tests and CI use the fakes).

    SARVAM_API_KEY=... CARTESIA_API_KEY=... ANTHROPIC_API_KEY=... python scripts/voice_latency_live.py [--out DIR] [--turns 6]

Keys come from the environment only and are never printed or written. SPEND: text sent to a voice is counted in code and the run stops at the per-engine caps below; the characters and the seconds of recognised audio
are in the output (`latency-live.json`). The "caller" is a pre-rendered Telugu utterance played into the recogniser in real time (the telephony line is fake); the machine and its network are this Mac's, not Cloud
Run's in Mumbai, so read the numbers as an upper bound for the network legs.

Measures per turn: end-of-turn wait, speech-recogniser final, model first token, voice first audio, final-transcript-to-first-audio (the part the loop controls) and last-word-to-first-audio (what the caller feels),
for the STREAMING loop with each voice, and for the OLD way (whole reply from the model, then the whole voice clip) on the same sentences."""


from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import statistics
import sys
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.fakes import FakePlayout, silence
from app.conversation.fillers import FillerBank
from app.conversation.parts import Session, SttEvent
from app.conversation.pipeline import Conversation
from app.conversation.providers import (
    AnthropicStream,
    CartesiaStreamTts,
    SarvamChatStream,
    SarvamRealtimeStt,
    SarvamStreamTts,
)
from app.opening.prompt import call_system_prompt

MODELS = {"fast": "claude-haiku-5-5", "strong": "claude-sonnet-5-5"}
SARVAM_MODELS = {"fast": "sarvam-105b", "strong": "sarvam-105b"}
CALLER_PHRASES = ["హలో అండీ, చెప్పండి", "ఓకే అండీ", "ఆ saree ధర ఎంత అండీ?", "రేపు visit book చేయగలరా?"]
CALLER_VOICE = "82c2afc8-ebbc-4802-8ccf-036dc0fa1e3b"  # Cartesia "Charan", a Telugu male voice: the caller
RAMYA = "cf061d8b-a752-4865-81a2-57570a6e0565"  # Cartesia "Ramya", the assistant
CAPS = {"cartesia": 2800, "sarvam_v4": 700, "sarvam_v3": 360}  # across ALL runs of this script (the ledger), on top of the bake-off's own use  # characters of text sent to each voice in this run (the caller's phrases and the fillers count)
SPENT: dict[str, int] = {"cartesia": 2000, "sarvam_v4": 640, "sarvam_v3": 230}  # seeded with what the first runs of this script used, rounded up; the total is written to the output folder
FRAME = 320  # bytes: 10 ms of 16 kHz mono 16-bit


def spend(engine: str, text: str) -> None:
    SPENT[engine] = SPENT.get(engine, 0) + len(text)
    if SPENT[engine] > CAPS[engine]:
        raise SystemExit(f"cap: {engine} would pass {CAPS[engine]} characters; stopping")


class CountingTts:
    """Wraps a voice: counts characters against its cap."""

    def __init__(self, inner: Any, engine: str) -> None:
        self.inner, self.engine, self.sample_rate = inner, engine, inner.sample_rate

    async def prewarm(self) -> None:
        await self.inner.prewarm()

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        spend(self.engine, text)
        async for chunk in self.inner.stream(text, language):
            yield chunk


class RealtimeSource:
    """The caller: speech played in real time (10 ms frames), then a second and a half of quiet for the recogniser's VAD."""

    def __init__(self, pcm: bytes, trailing_ms: int = 1500) -> None:
        self.pcm, self.trailing_ms = pcm, trailing_ms
        self.speech_ended_at: float | None = None
        self.speech_started_at: float | None = None

    async def frames(self) -> AsyncIterator[bytes]:
        t0 = time.perf_counter()
        sent = 0
        for i in range(0, len(self.pcm), FRAME):
            if i == 0:
                self.speech_started_at = time.perf_counter()
            yield self.pcm[i : i + FRAME]
            sent += 1
            await asyncio.sleep(max(0.0, t0 + sent * 0.01 - time.perf_counter()))
        self.speech_ended_at = time.perf_counter()
        for _ in range(self.trailing_ms // 10):
            yield silence(10)
            sent += 1
            await asyncio.sleep(max(0.0, t0 + sent * 0.01 - time.perf_counter()))


class TimedStt:
    """Records when the recogniser's VAD said speech started, relative to the first sound we sent."""

    def __init__(self, inner: SarvamRealtimeStt) -> None:
        self.inner, self.sample_rate = inner, inner.sample_rate
        self.speech_start_at: float | None = None

    async def events(self, frames: AsyncIterator[bytes]) -> AsyncIterator[SttEvent]:
        async for ev in self.inner.events(frames):
            if ev.kind == "speech_start" and self.speech_start_at is None:
                self.speech_start_at = time.perf_counter()
            yield ev


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, round(p * (len(s) - 1)))]


def summary(values: list[float]) -> dict[str, float]:
    return {"p50": round(statistics.median(values), 1), "p95": round(pct(values, 0.95), 1), "min": round(min(values), 1), "max": round(max(values), 1), "n": len(values)} if values else {}


async def caller_audio(client: httpx.AsyncClient, key: str) -> dict[str, bytes]:
    out = {}
    for text in CALLER_PHRASES:
        spend("cartesia", text)
        r = await client.post("https://api.cartesia.ai/tts/bytes", headers={"X-API-Key": key, "Cartesia-Version": "2025-04-16"}, json={"model_id": "sonic-3.6", "transcript": text, "voice": {"mode": "id", "id": CALLER_VOICE}, "language": "te", "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 16000}})
        r.raise_for_status()
        out[text] = r.content
    return out


async def streaming_run(label: str, tts: CountingTts, voice: str, keys: dict[str, str], phrases: dict[str, bytes], turns: int, llm_kind: str = "anthropic") -> dict[str, Any]:
    prompt = call_system_prompt(business="Lakshmi Sarees", assistant="Vijaya", language="te", opening_line="నమస్కారం అండీ, నేను విజయ, లక్ష్మి సారీస్ నుంచి.", goal="Answer the customer's question about sarees; offer photos on WhatsApp.", facts=["Green silk saree: 2,600 rupees, in stock.", "Shop opens 10 to 7."], speaking_style="everyday_mixed")
    rows: list[dict[str, Any]] = []
    bank = FillerBank(seed=1)
    llm = AnthropicStream(keys["anthropic"]) if llm_kind == "anthropic" else SarvamChatStream(keys["sarvam"])
    await llm.warm()  # one connection for the whole call, as the real loop keeps

    async def render(text: str) -> bytes:
        return b"".join([c async for c in tts.stream(text, "te")])

    await bank.prepare("te", voice, render)
    order = [CALLER_PHRASES[i % len(CALLER_PHRASES)] for i in range(turns)]
    for text in order:
        stt = TimedStt(SarvamRealtimeStt(keys["sarvam"], language="te", silence_ms=350))
        conv = Conversation(stt=stt, llm=llm, tts=tts, playout=FakePlayout(rate=tts.sample_rate), session=Session(system=prompt, language="te"), models=MODELS if llm_kind == "anthropic" else SARVAM_MODELS, fillers=bank, voice=voice)  # type: ignore[arg-type]
        src = RealtimeSource(phrases[text])
        tm = await conv.run_turn(src)
        rows.append(
            {
                "caller": text,
                "heard": "",
                "tier": tm.model_tier,
                "reply": tm.reply_text,
                "eot_ms": tm.eot_ms,
                "stt_final_ms": tm.stt_final_ms,
                "llm_first_token_ms": tm.llm_first_token_ms,
                "tts_first_audio_ms": tm.tts_first_audio_ms,
                "after_final_ms": tm.after_final_ms,
                "total_ms": tm.total_ms,
                "first_sound_ms": tm.first_sound_ms,
                "filler": tm.filler_played,
                "clauses": tm.clauses,
                "vad_speech_start_ms": None if stt.speech_start_at is None or src.speech_started_at is None else (stt.speech_start_at - src.speech_started_at) * 1000,
            }
        )
        print(f"  {label}: {text[:22]:<24} tier={tm.model_tier:<6} total={tm.total_ms and round(tm.total_ms)} after_final={tm.after_final_ms and round(tm.after_final_ms)} llm1={tm.llm_first_token_ms and round(tm.llm_first_token_ms)} tts1={tm.tts_first_audio_ms and round(tm.tts_first_audio_ms)}", flush=True)
    fields = ["eot_ms", "stt_final_ms", "llm_first_token_ms", "tts_first_audio_ms", "after_final_ms", "total_ms", "first_sound_ms", "vad_speech_start_ms"]
    return {"label": label, "turns": rows, "summary": {f: summary([r[f] for r in rows if r[f] is not None]) for f in fields}, "fillers": sum(bool(r["filler"]) for r in rows)}


async def old_way(keys: dict[str, str], replies: list[str], questions: list[str]) -> dict[str, Any]:
    """Whole reply from the model, then the whole voice clip (Bulbul v3, REST): what the product did before. Time from 'the caller's words are known' to the first audio being available."""
    rows = []
    async with httpx.AsyncClient(timeout=60) as client:
        for q in questions:
            t0 = time.perf_counter()
            r = await client.post("https://api.anthropic.com/v1/messages", headers={"x-api-key": keys["anthropic"], "anthropic-version": "2023-06-01"}, json={"model": MODELS["fast"], "max_tokens": 400, "system": "Reply in everyday spoken Telugu, two short sentences.", "messages": [{"role": "user", "content": q}]})
            r.raise_for_status()
            text = "".join(b.get("text", "") for b in r.json()["content"]) or "సరే అండీ"
            t_llm = time.perf_counter()
            spend("sarvam_v3", text[:60])
            v = await client.post("https://api.sarvam.ai/text-to-speech", headers={"api-subscription-key": keys["sarvam"]}, json={"text": text[:60], "language_code": "te-IN", "model": "bulbul:v3", "speaker": "priya", "pace": 1.05, "speech_sample_rate": 24000, "output_audio_codec": "wav"})
            v.raise_for_status()
            base64.b64decode(v.json()["audios"][0])
            t1 = time.perf_counter()
            rows.append({"llm_whole_ms": (t_llm - t0) * 1000, "tts_whole_ms": (t1 - t_llm) * 1000, "after_final_ms": (t1 - t0) * 1000})
    return {"label": "old way (whole reply, then whole clip)", "turns": rows, "summary": {f: summary([r[f] for r in rows]) for f in ("llm_whole_ms", "tts_whole_ms", "after_final_ms")}}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.home() / "Desktop/stack19-jobs/voice-bakeoff"))
    ap.add_argument("--turns", type=int, default=6)
    ap.add_argument("--configs", default="A,B,C", help="which of A (Cartesia voice + Anthropic), B (Cartesia voice + Sarvam 105b), C (Sarvam v4 voice + Sarvam 105b) to run")
    ap.add_argument("--skip-old-way", action="store_true")
    args = ap.parse_args()
    keys = {"sarvam": os.environ.get("SARVAM_API_KEY", ""), "cartesia": os.environ.get("CARTESIA_API_KEY", ""), "anthropic": os.environ.get("ANTHROPIC_API_KEY", "")}
    missing = [k for k, v in keys.items() if not v]
    if missing:
        raise SystemExit(f"no key in the environment for: {', '.join(missing)}")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted = set(args.configs.split(","))
    path = out / "latency-live.json"
    result: dict[str, Any] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"streaming": []}
    result.update({"measured_at": time.strftime("%Y-%m-%d %H:%M"), "note": "this Mac's network, not Cloud Run in Mumbai; the caller is a pre-rendered utterance; telephony is fake", "caps": CAPS, "models": MODELS, "sarvam_models": SARVAM_MODELS})

    def save(run: dict[str, Any]) -> None:
        result["streaming"] = [r for r in result["streaming"] if r["label"] != run["label"]] + [run]
        result["characters_sent"] = SPENT
        path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")

    async with httpx.AsyncClient(timeout=60) as client:
        phrases = await caller_audio(client, keys["cartesia"])
        cart = CountingTts(CartesiaStreamTts(keys["cartesia"], voice_id=RAMYA, client=client), "cartesia")
        sarvam = CountingTts(SarvamStreamTts(keys["sarvam"], speaker="kavitha_te_conversation", language="te"), "sarvam_v4")
        if "A" in wanted:
            print("A: Cartesia Sonic 3.6 voice + Anthropic Haiku/Sonnet (thinking off):")
            save(await streaming_run("A cartesia + anthropic", cart, "ramya", keys, phrases, args.turns))
        if "B" in wanted:
            print("B: Cartesia Sonic 3.6 voice + Sarvam 105b model:")
            save(await streaming_run("B cartesia + sarvam-105b", cart, "ramya", keys, phrases, args.turns, "sarvam"))
        if "C" in wanted:
            print("C: Sarvam Bulbul v4 Flash voice + Sarvam 105b model:")
            save(await streaming_run("C sarvam_v4 + sarvam-105b", sarvam, "kavitha", keys, phrases, args.turns, "sarvam"))
    if not args.skip_old_way:
        print("old way:")
        result["old_way"] = await old_way(keys, [], ["ఆ saree ధర ఎంత అండీ?", "రేపు visit book చేయగలరా?"])
        result["characters_sent"] = SPENT
        path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"characters_sent": SPENT, **{r["label"]: r["summary"] for r in result["streaming"]}, "old_way": result.get("old_way", {}).get("summary")}, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
