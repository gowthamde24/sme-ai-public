"""Streams a recorded wav to the browser voice endpoint of STAGING and reports the first-audio latency (job DV). Synthetic speech only; real providers, so it costs a few characters per turn.

  python scripts/browser_voice_latency.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> --wav question.wav [--turns 6] [--pack real_estate] [--language en]

The wav is 16 kHz, mono, 16-bit (make one on a Mac: `say -o q.aiff "What time do you open?"; afconvert -f WAVE -d LEI16@16000 -c 1 q.aiff question.wav`). It signs in as one synthetic demo owner (the password and the
authenticator secret are read from Secret Manager into memory, never printed), opens ONE session, waits for the greeting to finish, then per turn streams the wav in real time (20 ms frames), then 1.2 s of silence, and
measures from the LAST speech frame sent to the FIRST audio byte received: the number a person feels. The server's own `timings` message (from the final transcript to the first audio) is reported next to it.
Run it with the project's Python (it needs `websockets`). Exit 0 = every turn got audio."""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
from staging_smoke_api import Owner  # noqa: E402

FRAME_MS = 20
FLAGS: list[bool] = []   # per turn: did the server say the reply was started early (speculative)?


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile (p in 0..100) of a non-empty list."""
    ordered = sorted(values)
    rank = max(1, round(p / 100 * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


def read_wav(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16000, 1, 2):
            raise SystemExit("the wav must be 16 kHz, mono, 16-bit")
        return w.readframes(w.getnframes())


async def run(url: str, token: str, pcm: bytes, turns: int, language: str) -> tuple[list[float], list[float]]:
    import websockets

    frame = 16000 * 2 * FRAME_MS // 1000
    client_ms: list[float] = []
    server_ms: list[float] = []
    async with websockets.connect(url, max_size=None) as ws:
        inbox: asyncio.Queue[tuple[float, str | bytes | None]] = asyncio.Queue()

        async def reader() -> None:
            """Stamp every message the moment it arrives (reading only after the silence was sent would make the first audio look late)."""
            try:
                async for msg in ws:
                    inbox.put_nowait((time.perf_counter(), msg))
            finally:
                inbox.put_nowait((time.perf_counter(), None))

        read_task = asyncio.ensure_future(reader())
        await ws.send(json.dumps({"type": "start", "access_token": token, "language": language}))
        _, first_msg = await asyncio.wait_for(inbox.get(), timeout=15.0)
        ready = json.loads(first_msg) if isinstance(first_msg, str) else {}
        if ready.get("type") != "ready":
            raise SystemExit(f"refused: {ready.get('code')}")
        # let the greeting finish (its audio_end has turn 0); a workspace without one just waits a few seconds
        try:
            while True:
                _, msg = await asyncio.wait_for(inbox.get(), timeout=4.0)
                if isinstance(msg, str) and json.loads(msg).get("type") == "audio_end":
                    break
        except TimeoutError:
            pass
        for turn in range(1, turns + 1):
            last_sent = 0.0
            for i in range(0, len(pcm), frame):
                await ws.send(pcm[i : i + frame])
                last_sent = time.perf_counter()
                await asyncio.sleep(FRAME_MS / 1000)
            for _ in range(60):  # 1.2 s of silence: the end of the turn
                await ws.send(b"\x00" * frame)
                await asyncio.sleep(FRAME_MS / 1000)
            first: float | None = None
            while True:
                at, msg = await asyncio.wait_for(inbox.get(), timeout=45.0)
                if msg is None:
                    raise SystemExit("the server closed the socket")
                if isinstance(msg, bytes):
                    if first is None:
                        first = at
                    continue
                data = json.loads(msg)
                if data.get("type") == "timings":
                    FLAGS.append(bool(data.get("speculative")))
                    if data.get("after_final_ms") is not None:
                        server_ms.append(float(data["after_final_ms"]))
                    break
                if data.get("type") == "error" and data.get("fatal"):
                    raise SystemExit(f"fatal error: {data.get('code')}")
            if first is not None:
                client_ms.append((first - last_sent) * 1000)
            print(f"turn {turn}: last word -> first audio {'-' if first is None else round((first - last_sent) * 1000)} ms")
        await ws.send(json.dumps({"type": "stop"}))
        read_task.cancel()
    return client_ms, server_ms


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--wav", required=True, type=Path)
    ap.add_argument("--turns", type=int, default=6)
    ap.add_argument("--pack", default="real_estate")
    ap.add_argument("--language", default="en", choices=["te", "en", "hi", "kn"])
    args = ap.parse_args()
    try:
        ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
        owner = Owner(ss.Seeder(args.api_url), args.pack)
    except ss.SeedError as e:
        print(f"browser-voice-latency: {e}", file=sys.stderr)
        return 2
    tenant = owner.t.rsplit("/", 1)[-1]
    url = args.api_url.replace("https://", "wss://", 1).rstrip("/") + f"/v1/tenants/{tenant}/voice-chat"
    client_ms, server_ms = asyncio.run(run(url, owner.token, read_wav(args.wav), args.turns, args.language))
    if not client_ms:
        print("no audio came back")
        return 1
    print(f"\nfirst audio after the last word (client side, {len(client_ms)} turns): p50 {statistics.median(client_ms):.0f} ms, p95 {percentile(client_ms, 95):.0f} ms")
    if server_ms:
        print(f"final transcript -> first audio (server side): p50 {statistics.median(server_ms):.0f} ms, p95 {percentile(server_ms, 95):.0f} ms")
    return 0 if len(client_ms) == args.turns else 1


if __name__ == "__main__":
    raise SystemExit(main())
