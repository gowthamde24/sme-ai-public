"""The owner's real recordings through our speech pipeline (31 Oct 2026). CODE ONLY: the audio stays where the owner put it (`--audio-dir`, converted to 16 kHz wav in a scratch folder), is sent only to our own speech
recogniser (Sarvam) and the staging test session, and nothing of it is written to the repository. What is written (`--out-dir`) is text and timings.

  transcribe   each file through the recogniser in each mode (transcribe, verbatim) at the normal quiet setting AND with a long one (the whole thing as one piece = the working "truth" to confirm), with when every event came
  turns        the real conversation loop (hold for an unfinished thought) on each file, text rules alone against the audio turn model (shadow and on): what the loop heard as ONE turn, cut-offs, the model's chance at each stop
  interrupt    each file played as a caller while the assistant is speaking: the session's verified barge-in (pause, judge the sound, resume or stop), with the recogniser's words

Keys come from Secret Manager into memory; nothing is printed that came from a key."""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.providers import SarvamRealtimeStt  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"
FRAME_MS = 20
INTENT = {
    1: "ఈరోజు కొత్త ఎంక్వైరీలు ఏమైనా వచ్చాయా?", 2: "Ramesh కి ... రేపు పొద్దున కాల్ చేయి", 3: "2000 sq ft ki ... paver blocks rate entha?", 4: "Lakshmi గారికి quote పంపించు, 40 sarees",
    5: "(a sentence with a cough in the middle)", 6: "(speech with TV or YouTube behind)", 7: "Who should I call first today?", 8: "I want to ... send a follow-up to all leads from last week",
}


def secret(name: str) -> str:
    return subprocess.run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={PROJECT}"], capture_output=True, text=True, check=True).stdout.strip()


def load(path: Path) -> bytes:
    with wave.open(str(path)) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, "16 kHz mono 16-bit wav"
        return w.readframes(w.getnframes())


async def frames(pcm: bytes, tail_s: float, started: list[float]) -> Any:
    """The recording at the pace of a real line, then quiet."""
    size = 16000 * 2 * FRAME_MS // 1000
    started.append(time.perf_counter())
    for i in range(0, len(pcm), size):
        yield pcm[i : i + size]
        await asyncio.sleep(FRAME_MS / 1000)
    for _ in range(int(tail_s * 1000 / FRAME_MS)):
        yield b"\x00" * size
        await asyncio.sleep(FRAME_MS / 1000)


async def run_stt(key: str, pcm: bytes, *, mode: str, silence_ms: int, language: str = "auto", tail_s: float = 4.0) -> list[tuple[float, str, str]]:
    stt = SarvamRealtimeStt(key, language=language, silence_ms=silence_ms, mode=mode)
    started: list[float] = []
    events: list[tuple[float, str, str]] = []
    try:
        async for ev in stt.events(frames(pcm, tail_s, started)):
            events.append((round(time.perf_counter() - started[0], 2), ev.kind, ev.text))
    except Exception as exc:   # noqa: BLE001 - a failed run is a result
        events.append((round(time.perf_counter() - started[0], 2), "error", type(exc).__name__))
    return events


async def cmd_transcribe(args: argparse.Namespace) -> None:
    key = secret("sme-sarvam-api-key")
    rows: dict[str, Any] = {}
    for n in range(1, 9):
        pcm = load(args.audio_dir / f"voice-{n}.wav")
        rows[str(n)] = {"seconds": round(len(pcm) / 32000, 1), "intent": INTENT[n]}
        for mode in ("transcribe", "verbatim"):
            for label, silence in (("normal", 350), ("long", 4000)):
                ev = await run_stt(key, pcm, mode=mode, silence_ms=silence)
                finals = [e for e in ev if e[1] == "final"]
                rows[str(n)][f"{mode}/{label}"] = {"text": " ".join(f[2] for f in finals), "events": [(t, k, x) for t, k, x in ev if k in ("speech_start", "speech_end", "final", "error")]}
                print(n, mode, label, "->", rows[str(n)][f"{mode}/{label}"]["text"][:100], flush=True)
    (args.out_dir / "transcripts.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


async def cmd_turns(args: argparse.Namespace) -> None:
    """The real loop (`Conversation.listen`, semantic turns on) with the real recogniser on each recording. `shadow` = the text rules decide (the audio model's chance is only recorded): that IS the text-only result;
    `on` = the audio model may move the hold by one step. Cut-off = the loop returned before the end of what was said."""
    from app.browser_voice.audio import FrameBus
    from app.conversation import audio_turn
    from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts
    from app.conversation.parts import Session, TurnTimings
    from app.conversation.pipeline import Conversation

    from app.conversation import turntaking

    if args.not_done is not None:
        turntaking.AUDIO_SURE_NOT_DONE = args.not_done   # (read by `blend` at every call)
    key = secret("sme-sarvam-api-key")
    model = audio_turn.load(str(args.model))
    if model is None:
        raise SystemExit("the audio turn model did not load")
    truth = json.loads((args.out_dir / "transcripts.json").read_text(encoding="utf-8"))
    rows: dict[str, Any] = {}
    for n in (int(x) for x in args.files.split(",")):
        pcm = load(args.audio_dir / f"voice-{n}.wav")
        rows[str(n)] = {}
        for variant in args.variants.split(","):
            calls: list[dict[str, Any]] = []

            class Logged:
                def probability_complete(self, data: bytes) -> float | None:
                    began = time.perf_counter()
                    p = model.probability_complete(data)
                    calls.append({"at": round(time.perf_counter() - t0, 2), "p": None if p is None else round(p, 3), "run_ms": round((time.perf_counter() - began) * 1000)})
                    return p

            bus = FrameBus()
            language = "en" if n in (7, 8) else "te"
            conv = Conversation(stt=SarvamRealtimeStt(key, language="auto", mode="transcribe"), llm=FakeLlm(("ok",)), tts=FakeTts(), playout=FakePlayout(rate=16000), session=Session(system="", language=language),
                                models={"fast": "f", "strong": "s"}, semantic_turns=True, audio_turn=Logged(), audio_turn_mode=variant, audio_tail=bus.recent, command_hold_ms=args.command_wait)
            finals: list[tuple[float, str]] = []
            timeline: list[dict[str, Any]] = []

            def on_stt(ev: Any) -> None:
                at = round(time.perf_counter() - t0, 2)
                if ev.kind == "final":
                    finals.append((at, ev.text))
                if ev.kind in ("speech_start", "speech_end", "final"):
                    timeline.append({"t": at, "event": ev.kind, **({"text": ev.text} if ev.kind == "final" else {})})

            conv.on_stt = on_stt

            async def feed() -> None:
                size = 16000 * 2 * FRAME_MS // 1000
                for i in range(0, len(pcm), size):
                    bus.push(pcm[i : i + size])
                    await asyncio.sleep(FRAME_MS / 1000)
                for _ in range(int(7.0 * 1000 / FRAME_MS)):
                    bus.push(b"\x00" * size)
                    await asyncio.sleep(FRAME_MS / 1000)
                bus.close()

            t0 = time.perf_counter()
            feeder = asyncio.ensure_future(feed())
            tm = TurnTimings()
            try:
                text = await asyncio.wait_for(conv.listen(bus, tm), 40)
            except TimeoutError:
                text = None
            decided_at = round(time.perf_counter() - t0, 2)
            feeder.cancel()
            reference = truth[str(n)]["transcribe/long"]["text"]
            rows[str(n)][variant] = {"text": text, "decided_at_s": decided_at, "speech_s": round(len(pcm) / 32000, 1), "held_ms": tm.held_ms, "command_turn": tm.command_turn, "pieces": [f[1] for f in finals], "timeline": timeline, "audio_calls": calls,
                                     "reference": reference, "words": len((text or "").split()), "reference_words": len(reference.split())}
            print(n, variant, "->", text, "| decided", decided_at, "s | held", tm.held_ms, "| pieces", len(finals), "| audio", [(c["p"], c["run_ms"]) for c in calls], flush=True)
    (args.out_dir / f"turns{args.tag}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


async def cmd_interrupt(args: argparse.Namespace) -> None:
    """What the session's verified barge-in would decide for these sounds. Each file is played as the caller's sound while the assistant speaks, whole, and in 1.5 s windows (a cough or a TV beat is one or two
    windows of a longer recording). The recogniser's words and the sound's length go through `classify_interruption`, exactly as `VoiceSession._judge_interruption` does."""
    from app.browser_voice.audio import FrameBus
    from app.conversation.endpointing import endpoint_ms, rms
    from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts
    from app.conversation.parts import Session, TurnTimings
    from app.conversation.pipeline import Conversation
    from app.conversation.turntaking import classify_interruption

    key = secret("sme-sarvam-api-key")

    async def judge(clip: bytes, language: str) -> dict[str, Any]:
        bus = FrameBus()
        conv = Conversation(stt=SarvamRealtimeStt(key, language="auto", mode="transcribe"), llm=FakeLlm(("ok",)), tts=FakeTts(), playout=FakePlayout(rate=16000), session=Session(system="", language=language),
                            models={"fast": "f", "strong": "s"}, semantic_turns=True)
        size = 16000 * 2 * FRAME_MS // 1000

        async def feed() -> None:
            for i in range(0, len(clip), size):
                bus.push(clip[i : i + size])
                await asyncio.sleep(FRAME_MS / 1000)
            for _ in range(int(2.0 * 1000 / FRAME_MS)):
                bus.push(b"\x00" * size)
                await asyncio.sleep(FRAME_MS / 1000)
            bus.close()

        feeder = asyncio.ensure_future(feed())
        tm = TurnTimings()
        try:
            text = await asyncio.wait_for(conv.listen(bus, tm, interrupt=False, hold=False), 20)
        except TimeoutError:
            text = None
        feeder.cancel()
        speech_ms = max(0, int((tm.eot_at - tm.speech_start_at) * 1000) - endpoint_ms(language)) if tm.eot_at is not None and tm.speech_start_at is not None else 0
        return {"text": text, "speech_ms": speech_ms, "kind": classify_interruption(speech_ms, text)}

    out: dict[str, Any] = {}
    for n in (int(x) for x in args.files.split(",")):
        pcm = load(args.audio_dir / f"voice-{n}.wav")
        language = "en" if n in (7, 8) else "te"
        out[str(n)] = {"whole": await judge(pcm, language), "windows": []}
        print(n, "whole ->", out[str(n)]["whole"], flush=True)
        if n in (5, 6):
            win = 16000 * 2 * 3 // 2   # 1.5 s
            for start in range(0, len(pcm), win):
                clip = pcm[start : start + win]
                loud = max((rms(clip[i : i + 640]) for i in range(0, len(clip), 640)), default=0.0)
                if loud < 500:
                    continue
                result = await judge(clip, language)
                result.update({"from_s": round(start / 32000, 1), "loudest_rms": round(loud)})
                out[str(n)]["windows"].append(result)
                print(n, "window", result, flush=True)
    (args.out_dir / "interrupt.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["transcribe", "turns", "interrupt"])
    ap.add_argument("--model", type=Path, default=Path("/private/tmp/claude-501/-Users-gowthamreddys/74038738-9dd6-4d5e-b8e9-a34e4cc5f4c9/scratchpad/turnspike/models/indic-smart-turn-base-int8.onnx"))
    ap.add_argument("--files", default="1,2,3,4,5,6,7,8")
    ap.add_argument("--variants", default="shadow,on")
    ap.add_argument("--not-done", type=float, default=None, help="try another 'the voice sounds unfinished' threshold for the audio model (default: the code's)")
    ap.add_argument("--command-wait", type=int, default=900, help="ms a finished-looking command waits for more (0: the behaviour before 31 Oct 2026)")
    ap.add_argument("--tag", default="", help="suffix of the output file, to keep several runs")
    ap.add_argument("--audio-dir", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    asyncio.run({"transcribe": cmd_transcribe, "turns": cmd_turns, "interrupt": cmd_interrupt}[args.command](args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
