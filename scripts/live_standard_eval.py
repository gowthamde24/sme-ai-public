#!/usr/bin/env python3
"""The Live talk standard's report (owner, 31 Oct 2026, job live-conversation-standard E). Three parts, each opt-in where it spends anything:

  python3 scripts/live_standard_eval.py --out ~/Desktop/stack19-jobs/voice-v2-check/live-standard.md
        the 40 dialogues through the real conversation loop with fakes (no network, no key): turn-taking, interruptions, the session workflow
  ... --style-live --model claude-haiku-5-5        + the speaking-style rules (C) on a real model's answers (ANTHROPIC_API_KEY in the environment, a few calls)
  ... --staging --i-know-this-is-staging --project-ref <ref> --api-url https://<api>
        + the latency and barge-in numbers on STAGING with a socket client (a SYNTHETIC demo owner; the caller is a question spoken by Sarvam TTS, streamed in real time; costs a few characters a turn)

Keys come from the environment / Secret Manager into memory only and are never printed or written. The report holds ids, numbers and pass/fail, not the words of any answer."""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import statistics
import sys
import time
import wave
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "services" / "ai-api"))
sys.path.insert(0, str(HERE))
from app.conversation import live_eval as ev  # noqa: E402

CASUAL = {
    "en": "Hello, how are you today?",
    "te": "హాయ్, ఎలా ఉన్నారు?",
    "hi": "नमस्ते, आप कैसे हैं?",
    "kn": "ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಿ?",
}
LONG_ASK = {"en": "Tell me about Dharmavaram silk sarees and what makes them special.", "te": "ధర్మవరం పట్టు చీరల గురించి చెప్పండి.", "hi": "धर्मवरम रेशमी साड़ियों के बारे में बताइए।", "kn": "ಧರ್ಮಾವರಂ ರೇಷ್ಮೆ ಸೀರೆಗಳ ಬಗ್ಗೆ ಹೇಳಿ."}
TAG = {"te": "te-IN", "en": "en-IN", "hi": "hi-IN", "kn": "kn-IN"}


def pct(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered), max(1, round(p / 100 * len(ordered)))) - 1]


# ---- style, live ----------------------------------------------------------------------------------------------------------------------------------

def style_live(model: str) -> list[tuple[str, str, list[str]]]:
    import httpx

    from app.agents.register import register_block
    from app.conversation.style import conversation_style_block

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise SystemExit("--style-live needs ANTHROPIC_API_KEY in the environment")
    out = []
    for d in ev.load():
        for beat in d["beats"]:
            if beat["kind"] != "style":
                continue
            lang = d["lang"]
            system = (
                "You are the AI assistant of a small business owner in India, talking to them on a live voice call. The business: Neelambari Silks, a saree shop. You can see their records only when a tool gives them to you; you have NONE in this call, so you must not state any figure or name as a fact. "
                + register_block(lang) + "\n" + conversation_style_block(lang, disclosure_on=False) + ("\n" + beat["context"] if beat.get("context") else "")
            )
            for form in ("disabled", "between_tools"):
                r = httpx.post("https://api.anthropic.com/v1/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=40,
                               json={"model": model, "max_tokens": 300, "system": system, "messages": [{"role": "user", "content": beat["user"]}], "thinking": {"type": form}})
                if r.status_code == 400 and form == "disabled" and "between_tools" in r.text:
                    continue
                break
            answer = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text") if r.status_code == 200 else ""
            problems = ev.style_problems(answer, beat["checks"], lang, beat.get("keys")) if answer else ["no answer"]
            out.append((d["id"], "PASS" if not problems else "FAIL", problems))
            print(f"{d['id']:8s} {'ok  ' if not problems else 'FAIL'} {'; '.join(problems)}")
    return out


# ---- staging ---------------------------------------------------------------------------------------------------------------------------------------

def sarvam_wav(key: str, text: str, language: str, path: Path) -> None:
    import httpx

    r = httpx.post("https://api.sarvam.ai/text-to-speech", headers={"api-subscription-key": key}, timeout=60,
                   json={"text": text, "language_code": TAG[language], "model": "bulbul:v3", "output_audio_codec": "wav", "speech_sample_rate": 16000})
    r.raise_for_status()
    audio = base64.b64decode(r.json()["audios"][0])
    with wave.open(io.BytesIO(audio)) as w:
        pcm, rate = w.readframes(w.getnframes()), w.getframerate()
    if rate != 16000:
        raise SystemExit(f"the TTS gave {rate} Hz, 16000 wanted")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm)


async def ping_rtt_ms(url: str, token: str, n: int = 10) -> float:
    """The round trip of a tiny message (`ping` -> `pong`) on an open session: what the network between this machine and the server costs, so it can be told apart from what the server does."""
    import websockets

    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "start", "access_token": token, "language": "en"}))
        inbox: asyncio.Queue[tuple[float, Any]] = asyncio.Queue()

        async def reader() -> None:
            async for m in ws:
                inbox.put_nowait((time.perf_counter(), m))

        task = asyncio.ensure_future(reader())
        await asyncio.sleep(4)
        while not inbox.empty():
            inbox.get_nowait()
        rtts = []
        for _ in range(n):
            sent = time.perf_counter()
            await ws.send(json.dumps({"type": "ping"}))
            while True:
                at, m = await asyncio.wait_for(inbox.get(), timeout=5.0)
                if isinstance(m, str) and json.loads(m).get("type") == "pong":
                    rtts.append((at - sent) * 1000)
                    break
            await asyncio.sleep(0.3)
        await ws.send(json.dumps({"type": "stop"}))
        task.cancel()
    return float(statistics.median(rtts))


async def barge_in_ms(url: str, token: str, pcm: bytes, language: str, verify: bool) -> float | None:
    import websockets

    frame = 640
    async with websockets.connect(url, max_size=None) as ws:
        inbox: asyncio.Queue[tuple[float, Any]] = asyncio.Queue()

        async def reader() -> None:
            try:
                async for msg in ws:
                    inbox.put_nowait((time.perf_counter(), msg))
            finally:
                inbox.put_nowait((time.perf_counter(), None))

        task = asyncio.ensure_future(reader())
        await ws.send(json.dumps({"type": "start", "access_token": token, "language": language}))
        try:
            while True:
                _, m = await asyncio.wait_for(inbox.get(), timeout=6.0)
                if isinstance(m, str) and json.loads(m).get("type") == "audio_end":
                    break
        except TimeoutError:
            pass
        for i in range(0, len(pcm), frame):
            await ws.send(pcm[i : i + frame])
            await asyncio.sleep(0.02)
        for _ in range(60):
            await ws.send(b"\x00" * frame)
            await asyncio.sleep(0.02)
        got = 0
        while got < 4:   # let some of the answer reach the line
            _, m = await asyncio.wait_for(inbox.get(), timeout=40.0)
            got += isinstance(m, bytes)
        sent = time.perf_counter()
        await ws.send(json.dumps({"type": "barge_in", **({"verify": True} if verify else {})}))
        stopped: float | None = None
        for _ in range(200):
            at, m = await asyncio.wait_for(inbox.get(), timeout=10.0)
            if isinstance(m, str) and json.loads(m).get("type") in ("audio_stop", "paused", "interrupted"):
                stopped = (at - sent) * 1000
                break
        await ws.send(json.dumps({"type": "stop"}))
        task.cancel()
        return stopped


def staging(args: argparse.Namespace) -> dict[str, Any]:
    import seed_staging as ss
    import browser_voice_latency
    from browser_voice_latency import FRAME_MS, read_wav, run  # noqa: F401
    from staging_smoke_api import Owner

    ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
    owner = Owner(ss.Seeder(args.api_url), args.pack)
    tenant = owner.t.rsplit("/", 1)[-1]
    url = args.api_url.replace("https://", "wss://", 1).rstrip("/") + f"/v1/tenants/{tenant}/voice-chat"
    key = ss.secret_get("sme-sarvam-api-key") or ""
    work = Path(os.environ.get("TMPDIR", "/tmp")) / "live-standard-wavs"
    work.mkdir(parents=True, exist_ok=True)
    out: dict[str, Any] = {"latency": {}, "barge": {}}
    time.sleep(12)
    out["rtt_ms"] = round(asyncio.run(ping_rtt_ms(url, owner.token)))
    all_client: list[float] = []
    all_server: list[float] = []
    for lang in ("en", "te", "hi", "kn"):
        wav = work / f"casual-{lang}.wav"
        sarvam_wav(key, CASUAL[lang], lang, wav)
        client, server = asyncio.run(run(url, owner.token, read_wav(wav), args.turns, lang))
        all_client += client
        all_server += server
        out["latency"][lang] = {"turns": len(client), "p50": round(statistics.median(client)) if client else None, "p95": round(pct(client, 95)) if client else None,
                                "server_p50": round(statistics.median(server)) if server else None}
    out["fillers_on_casual"] = f"{sum(browser_voice_latency.FILLER_FLAGS)}/{len(browser_voice_latency.FILLER_FLAGS)}"
    out["speculative_turns"] = f"{sum(browser_voice_latency.FLAGS)}/{len(browser_voice_latency.FLAGS)}"
    out["latency"]["all"] = {"turns": len(all_client), "p50": round(statistics.median(all_client)), "p95": round(pct(all_client, 95)), "server_p50": round(statistics.median(all_server)) if all_server else None}
    stops: dict[str, list[float]] = {"hard": [], "verify": []}
    for lang in ("en", "te"):
        wav = work / f"ask-{lang}.wav"
        sarvam_wav(key, LONG_ASK[lang], lang, wav)
        for mode in ("hard", "verify"):
            for _ in range(args.barge_runs):
                time.sleep(12)   # the server admits six sessions a minute
                ms = asyncio.run(barge_in_ms(url, owner.token, read_wav(wav), lang, mode == "verify"))
                if ms is not None:
                    stops[mode].append(ms)
    out["barge"] = {m: {"n": len(v), "p50": round(statistics.median(v)) if v else None, "max": round(max(v)) if v else None} for m, v in stops.items()}
    return out


# ---- the report -----------------------------------------------------------------------------------------------------------------------------------

def report(result: dict[str, Any], style: list[tuple[str, str, list[str]]] | None, stg: dict[str, Any] | None) -> str:
    s = ev.summary(result)
    def ok(cond: bool) -> str:
        return "PASS" if cond else "FAIL"
    rows = [
        ("Barge-in: line paused or stopped ≤ 200 ms (loop, fakes)", "≤ 200 ms", f"max {s['pause_ms_max']} ms", ok(s["pause_ms_max"] <= 200)),
        ("False interruptions on the noise set (cough, click, hmm, haan, ok, అవును; TV counted)", "< 5 %", f"{s['false_interruption_pct']} % of {s['noise_sounds']} (without the TV beat: {s['false_interruption_without_tv_pct']} %)", ok(s["false_interruption_pct"] < 5)),
        ("Real interruptions that stop the reply", "100 %", f"{s['real_interruptions_stopped_pct']} %", ok(s["real_interruptions_stopped_pct"] == 100)),
        ("Premature cut-offs on the thinking-pause set (te / kn / en / hi)", "< 5 %", f"{s['premature_cut_off_pct']} % of {s['thinking_turns']} (pauses with a cue in the words: {s['premature_cut_off_without_hard_pct']} %; the rest have no cue)", ok(s["premature_cut_off_pct"] < 5)),
        ("A finished turn made to wait or joined to the next", "0 %", f"{s['over_hold_pct']} % of {s['finished_turns']}", ok(s["over_hold_pct"] == 0)),
        ("Fillers only when the wait is real: none on small talk, a data turn only if late, never two turns in a row (the real loop, 10 sessions)", "all", s["filler_ok"], ok(s["filler_ok"].split("/")[0] == s["filler_ok"].split("/")[1])),
        ("Quiet line: check-in at ~8 s, end at ~30 s", "3/3", s["silence_ok"], ok(s["silence_ok"].split("/")[0] == s["silence_ok"].split("/")[1])),
        ("Goodbye phrases end the session, ordinary sentences do not", "all", s["goodbye_ok"], ok(s["goodbye_ok"].split("/")[0] == s["goodbye_ok"].split("/")[1])),
    ]
    if style is not None:
        passed = sum(1 for _, r, _ in style if r == "PASS")
        rows.append(("Speaking-style rules on a real model's answers (short, no markup, no gendered address, the caller's script, read back before acting, no invented fact)", "all", f"{passed}/{len(style)}", ok(passed == len(style))))
    if stg is not None:
        lat = stg["latency"]["all"]
        rtt = stg["rtt_ms"]
        rows += [
            ("User stops → first assistant audio, casual turn, p50 (staging, client side)", "≤ 1.2 s", f"{lat['p50']} ms over {lat['turns']} turns (server side p50 {lat['server_p50']} ms)", ok(lat["p50"] <= 1200)),
            ("User stops → first assistant audio, casual turn, p95", "≤ 2 s", f"{lat['p95']} ms", ok(lat["p95"] <= 2000)),
            ("…the same with the network taken out (one round trip of this machine to the server, " + str(rtt) + " ms, taken off): a user in India next to the server", "p50 ≤ 1.2 s", f"p50 {lat['p50'] - rtt} ms, p95 {lat['p95'] - rtt} ms", ok(lat["p50"] - rtt <= 1200)),
            ("Fillers on small-talk turns, staging (the turns of the latency run)", "0", str(stg.get("fillers_on_casual", "n/a")), ok(str(stg.get("fillers_on_casual", "")).startswith("0/"))),
            ("Barge-in stop, as the browser sees it (hard stop), staging", "≤ 200 ms", f"p50 {stg['barge']['hard']['p50']} ms, max {stg['barge']['hard']['max']} ms over {stg['barge']['hard']['n']} (network included)", ok((stg['barge']['hard']['max'] or 9999) <= 200)),
            ("Barge-in pause with verify, staging", "≤ 200 ms", f"p50 {stg['barge']['verify']['p50']} ms, max {stg['barge']['verify']['max']} ms over {stg['barge']['verify']['n']} (network included)", ok((stg['barge']['verify']['max'] or 9999) <= 200)),
        ]
    lines = ["# Live talk: the quality bar", "", f"Measured {time.strftime('%d %b %Y')} on the 40-dialogue set (te 15, en 10, kn 8, hi 7) through the real conversation loop with fakes for the audio" + (", and on staging with a socket client" if stg else "") + ".", "",
             "| Measure | Bar | Result | |", "|---|---|---|---|"]
    lines += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in rows]
    if stg is not None:
        lines += ["", f"Turns whose reply was started early (speculative start): {stg.get('speculative_turns', 'n/a')}", "", "Casual-turn latency per language (client side, ms): " + "; ".join(f"{k} p50 {v['p50']} / p95 {v['p95']} ({v['turns']} turns)" for k, v in stg["latency"].items() if k != "all")]
    lines += ["", "Thinking-pause turns that were cut (no cue in the words): " + (", ".join(t.id for t in result["turns"] if t.cut_off) or "none"),
              "TV beat decided as a real interruption (by text a TV has words): " + (", ".join(i.id for i in result["interrupts"] if i.tv and i.decided != "resume") or "none")]
    if style:
        lines += ["", "Style failures: " + ("; ".join(f"{i}: {', '.join(p)}" for i, r, p in style if r != "PASS") or "none")]
    lines += ["", "Not measured here: the real microphone (a person on a phone in a room), A3 speculative start (not built), the audio turn model (Indic Smart Turn: next step). See docs/runbooks/live-conversation-standard.md."]
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--style-live", action="store_true")
    ap.add_argument("--model", default="claude-haiku-5-5")
    ap.add_argument("--staging", action="store_true")
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref")
    ap.add_argument("--api-url")
    ap.add_argument("--pack", default="real_estate")
    ap.add_argument("--turns", type=int, default=6)
    ap.add_argument("--barge-runs", type=int, default=3)
    args = ap.parse_args()
    result = asyncio.run(ev.run_all())
    print(json.dumps(ev.summary(result)))
    style = style_live(args.model) if args.style_live else None
    stg = staging(args) if args.staging else None
    text = report(result, style, stg)
    if args.out:
        Path(args.out).expanduser().write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
