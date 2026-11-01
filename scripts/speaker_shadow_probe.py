"""The speaker check in shadow on STAGING: how long it takes on Cloud Run, and what it says (owner decision 31 Oct 2026).

Opens a few sessions as ONE synthetic demo owner (the owner's own test recordings are the voice: they go only to our staging test session and our speech recogniser). Per session: two spoken questions build the
session's signature, then three times: a question is asked, the assistant starts to answer, a sound interrupts (`barge_in` with `verify`, then the audio of another recording of the same voice), and the `speaker`
message the server sends is read: `same`, `score`, `ms` (the check's own time in the server). Nothing is kept except those numbers. Costs a few hundred Cartesia characters a session.

  python scripts/speaker_shadow_probe.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> --audio-dir <folder with voice-N.wav 16 kHz mono> [--sessions 5] [--pack education]"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
import wave
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
from staging_smoke_api import Owner  # noqa: E402

FRAME = 640
VERBOSE = False
T0 = time.perf_counter()


def wav(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        return w.readframes(w.getnframes())


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered), max(1, round(p / 100 * len(ordered)))) - 1]


async def session(url: str, token: str, audio: dict[int, bytes]) -> list[dict[str, Any]]:
    import websockets

    results: list[dict[str, Any]] = []
    seen: list[str] = []
    async with websockets.connect(url, max_size=None) as ws:
        inbox: asyncio.Queue[tuple[float, Any]] = asyncio.Queue()

        async def reader() -> None:
            try:
                async for msg in ws:
                    if isinstance(msg, str):
                        seen.append(msg[:160])
                        if VERBOSE:
                            print(f"    {time.perf_counter() - T0:6.1f}s  {msg[:110]}", flush=True)
                    inbox.put_nowait((time.perf_counter(), msg))
            finally:
                inbox.put_nowait((time.perf_counter(), None))

        task = asyncio.ensure_future(reader())

        async def next_msg(timeout: float) -> tuple[float, Any]:
            return await asyncio.wait_for(inbox.get(), timeout)

        async def send_audio(pcm: bytes, tail_s: float = 1.2) -> None:
            for i in range(0, len(pcm), FRAME):
                await ws.send(pcm[i : i + FRAME])
                await asyncio.sleep(0.02)
            for _ in range(int(tail_s / 0.02)):
                await ws.send(b"\x00" * FRAME)
                await asyncio.sleep(0.02)

        async def until_type(kind: str, timeout: float = 40.0) -> dict[str, Any] | None:
            end = time.perf_counter() + timeout
            while time.perf_counter() < end:
                try:
                    _, msg = await next_msg(end - time.perf_counter())
                except TimeoutError:
                    return None
                if msg is None:
                    return None
                if isinstance(msg, str):
                    data = json.loads(msg)
                    if data.get("type") == kind:
                        return data
                    if data.get("type") == "error" and data.get("fatal"):
                        raise SystemExit(f"fatal: {data.get('code')}")
            return None

        try:
            await _run(ws, token, audio, results, next_msg, send_audio, until_type, inbox)
        except Exception as exc:   # noqa: BLE001 - say what the server last said
            print("  stopped:", type(exc).__name__, "| last server messages:", [m for m in seen if '"type":"limit"' in m or '"type": "limit"' in m or '"fatal"' in m][-2:] or seen[-3:])
        task.cancel()
    return results


async def _run(ws: Any, token: str, audio: dict[int, bytes], results: list[dict[str, Any]], next_msg: Any, send_audio: Any, until_type: Any, inbox: Any) -> None:
    if True:
        await ws.send(json.dumps({"type": "start", "access_token": token, "language": "en"}))
        if not await until_type("ready", 20):
            raise SystemExit("no ready")
        await until_type("audio_end", 45)   # the greeting (a cold server can take 15 s to speak it)
        await asyncio.sleep(0.6)
        for enrol in (1, 7):   # two spoken questions in the owner's voice: the signature is made as soon as the words are confirmed
            await send_audio(audio[enrol])
            while True:
                data = await until_type("caption", 40)
                if data is None or (data.get("who") == "user" and data.get("final")):
                    break
            await ws.send(json.dumps({"type": "barge_in"}))   # (the answer to a business question is slow and not what is measured: stop it)
            await until_type("timings", 40)
        for interrupter in (5, 3, 1):
            while not inbox.empty():   # (what is left of the last answer)
                inbox.get_nowait()
            await send_audio(audio[0])   # a casual question in another voice (the Mac's), so the assistant speaks at length quickly
            while True:   # until the first audio byte of the answer
                try:
                    _, msg = await next_msg(40)
                except TimeoutError:
                    break
                if isinstance(msg, bytes):
                    break
            await ws.send(json.dumps({"type": "barge_in", "verify": True}))
            paused = await until_type("paused", 5)
            sent_at = time.perf_counter()
            await send_audio(audio[interrupter], tail_s=1.6)
            speaker = await until_type("speaker", 12)
            decided = time.perf_counter()
            results.append({"interrupter": interrupter, "paused_ms": None if paused is None else paused.get("ms"), "speaker": speaker, "decided_after_last_frame_s": round(decided - sent_at - len(audio[interrupter]) / 32000 - 1.6, 2)})
            await ws.send(json.dumps({"type": "barge_in"}))   # (stop whatever follows: it is only a probe)
            await until_type("timings", 25)
        await ws.send(json.dumps({"type": "stop"}))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--audio-dir", required=True, type=Path)
    ap.add_argument("--trigger-wav", required=True, type=Path, help="a casual question (the Mac's `say`), 16 kHz mono: the assistant answers it at length")
    ap.add_argument("--sessions", type=int, default=5)
    ap.add_argument("--pack", default="education")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    global VERBOSE
    VERBOSE = args.verbose
    import argparse as _ap

    ss.guard(_ap.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
    owner = Owner(ss.Seeder(args.api_url), args.pack)
    tenant = owner.t.rsplit("/", 1)[-1]
    url = args.api_url.replace("https://", "wss://", 1).rstrip("/") + f"/v1/tenants/{tenant}/voice-chat"
    audio = {n: wav(args.audio_dir / f"voice-{n}.wav") for n in (1, 3, 5, 7)}
    audio[0] = wav(args.trigger_wav)
    rows: list[dict[str, Any]] = []
    for i in range(args.sessions):
        got = asyncio.run(session(url, owner.token, audio))
        rows += got
        print(f"session {i + 1}: " + ", ".join(f"{r['interrupter']}->{(r['speaker'] or {}).get('score')}/{(r['speaker'] or {}).get('ms')}ms" for r in got), flush=True)
        time.sleep(12)   # (the server admits 6 sessions a minute)
    ms = [float(r["speaker"]["ms"]) for r in rows if r["speaker"] and r["speaker"].get("ms") is not None]
    scores = [float(r["speaker"]["score"]) for r in rows if r["speaker"] and r["speaker"].get("score") is not None]
    print(f"\n{len(rows)} interruptions, {len(ms)} scored ({len(rows) - len(ms)} with no score)")
    if ms:
        print(f"speaker check time in the server: p50 {statistics.median(ms):.0f} ms, p95 {percentile(ms, 95):.0f} ms, max {max(ms):.0f} ms")
    if scores:
        print(f"scores: min {min(scores):.2f}, median {statistics.median(scores):.2f}, max {max(scores):.2f}; same-voice {sum(s >= 0.40 for s in scores)}/{len(scores)}")
    if args.out:
        args.out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
