"""A real Talk live session against STAGING (13 Nov 2026): streams wav files as the "microphone" into /v1/tenants/{id}/voice-chat as one synthetic demo owner and prints every event with its time.
Synthetic speech only; real providers (Sarvam recognition, the assistant, Cartesia voice), so it costs a few rupees of the demo workspace's daily allowance. Nothing is started: use --decline to answer a plan card with No.

  say -v Geeta -o q.aiff "ఈ రోజు కొత్తగా ఎన్ని విచారణలు వచ్చాయి?"; afconvert -f WAVE -d LEI16@16000 -c 1 q.aiff q.wav      (a Mac; wav = 16 kHz, mono, 16-bit)
  python scripts/talk_live_session.py --pack textiles --lang te [--decline] [--barge stopword.wav] q1.wav [q2.wav ...]

Each wav is one turn; the next is sent when the reply ends. Replies are saved as reply_turnN.wav (24 kHz) and the event log as transcript.txt in the current folder. The password and the second factor of the demo owner are read
from Secret Manager into memory (scripts/seed_staging.py), never printed. Run it with the project's Python (it needs `websockets`)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss
import websockets
from staging_smoke_api import Owner

API = "https://sme-api-620338396268.asia-south1.run.app"
FRAME = 640  # 20 ms of 16 kHz s16


def read(p):
    with wave.open(p, "rb") as w:
        return w.readframes(w.getnframes())


async def main(a):
    ss.guard(
        argparse.Namespace(
            i_know_this_loads_demo_data_into_staging=True,
            project_ref="uiallwgywitryxatcqxf",
        )
    )
    owner = Owner(ss.Seeder(API), a.pack)
    tenant = owner.t.rsplit("/", 1)[-1]
    url = API.replace("https://", "wss://") + f"/v1/tenants/{tenant}/voice-chat"
    t0 = time.perf_counter()
    audio = {}  # turn index -> bytes
    cur = [0]
    log = []
    done = asyncio.Event()
    heard = {"speaking_at": None}

    def say(kind, d=""):
        line = f"{time.perf_counter() - t0:7.2f}s {kind:14s} {d}"
        print(line, flush=True)
        log.append(line)

    async with websockets.connect(url, max_size=None, origin=a.origin) as ws:

        async def reader():
            try:
                async for m in ws:
                    if isinstance(m, bytes):
                        audio.setdefault(cur[0], bytearray()).extend(m)
                        continue
                    d = json.loads(m)
                    t = d.get("type")
                    if t in ("state",):
                        say("state", f"{d.get('state')} {d.get('step') or ''}")
                        if d.get("state") == "speaking":
                            heard["speaking_at"] = time.perf_counter()
                    elif t == "transcript":
                        say(
                            "transcript",
                            f"{'FINAL' if d.get('final') else 'partial'}: {d.get('text')}",
                        )
                    elif t == "caption":
                        say(
                            "caption",
                            f"{d.get('who')} final={d.get('final')} spoken={d.get('spoken')}: {d.get('text')}",
                        )
                    elif t == "audio_end":
                        say(
                            "audio_end",
                            f"turn {d.get('turn')} bytes={len(audio.get(cur[0], b''))}",
                        )
                        done.set()
                    elif t == "confirm_action":
                        say(
                            "CONFIRM_ACTION",
                            json.dumps(
                                {k: d[k] for k in d if k != "type"}, ensure_ascii=False
                            )[:700],
                        )
                        if a.decline:
                            await asyncio.sleep(1.5)
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "confirm",
                                        "action_id": d.get("action_id"),
                                        "decision": "no",
                                    }
                                )
                            )
                            say(
                                "SENT",
                                "confirm decision=no (the owner taps No: nothing starts)",
                            )
                    elif t == "error":
                        say(
                            "error",
                            json.dumps({k: d[k] for k in d if k != "type"})[:300],
                        )
                        done.set()
                    elif t in ("timings",):
                        say("timings", json.dumps({k: d[k] for k in d if k != "type"}))
                    else:
                        say(t, json.dumps({k: d[k] for k in d if k != "type"})[:300])
            except Exception as e:  # noqa: BLE001 - the log line carries the class only
                say(
                    "reader-ended",
                    e.__class__.__name__ + " " + str(getattr(e, "code", "")),
                )

        rt = asyncio.ensure_future(reader())
        await ws.send(
            json.dumps(
                {
                    "type": "start",
                    "access_token": owner.token,
                    "language": a.lang,
                    "stt_language": a.lang,
                }
            )
        )
        await asyncio.sleep(6)  # greeting
        for i, wavp in enumerate(a.wav, 1):
            cur[0] = i
            done.clear()
            heard["speaking_at"] = None
            say("SEND", f"turn {i}: {wavp}")
            pcm = read(wavp)
            for off in range(0, len(pcm), FRAME):
                await ws.send(pcm[off : off + FRAME])
                await asyncio.sleep(0.02)
            for _ in range(60):
                await ws.send(b"\x00" * FRAME)
                await asyncio.sleep(0.02)
            if a.barge and i == 1:
                for _ in range(
                    600
                ):  # wait up to 30 s for the assistant to start speaking, then cut in 2 s later
                    if (
                        heard["speaking_at"]
                        and heard["speaking_at"] > time.perf_counter() - 600
                    ):
                        break
                    await asyncio.sleep(0.05)
                await asyncio.sleep(2.0)
                say(
                    "BARGE-IN",
                    "client hears the owner over the assistant: sends barge_in and streams the words",
                )
                await ws.send(json.dumps({"type": "barge_in"}))
                bp = read(a.barge)
                for off in range(0, len(bp), FRAME):
                    await ws.send(bp[off : off + FRAME])
                    await asyncio.sleep(0.02)
                for _ in range(60):
                    await ws.send(b"\x00" * FRAME)
                    await asyncio.sleep(0.02)
            try:
                await asyncio.wait_for(done.wait(), timeout=a.wait)
            except TimeoutError:
                say("TIMEOUT", "no audio_end/error in time")
            done.clear()
            await asyncio.sleep(1.0)
        await ws.send(json.dumps({"type": "stop"}))
        await asyncio.sleep(1.5)
        rt.cancel()
    for k, b in audio.items():
        out = Path(f"reply_turn{k}.wav")
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(bytes(b))
        say("saved", f"{out} {len(b) / 48000:.1f}s of audio")
    Path("transcript.txt").write_text("\n".join(log), encoding="utf8")


ap = argparse.ArgumentParser()
ap.add_argument("--pack", default="textiles")
ap.add_argument("--lang", default="te")
ap.add_argument("--wait", type=float, default=60)
ap.add_argument("--origin", default="https://staging.stack19.com")
ap.add_argument("--barge", default=None)
ap.add_argument("--decline", action="store_true")
ap.add_argument("wav", nargs="+")
asyncio.run(main(ap.parse_args()))
