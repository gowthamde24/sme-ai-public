#!/usr/bin/env python3
"""Natural-voice bake-off (job natural-voice, 28 Oct 2026): Cartesia Sonic against Sarvam Bulbul v3 and Bulbul v4 Flash, Telugu / Hindi / Kannada / English.

OPT-IN: this is the one script of the job that calls real providers (the tests and CI never do). Keys come from the ENVIRONMENT only (CARTESIA_API_KEY, SARVAM_API_KEY) and are never printed or written.
HARD CAP: 3,000 characters of text per engine (counted in code before every request, every request including the latency probes); `usage.json` in the output folder shows what was spent.

    SARVAM_API_KEY=... CARTESIA_API_KEY=... python scripts/voice_bakeoff_natural.py [--plan] [--out DIR]

Writes DIR/<engine>/<lang>/<voice>/NN.wav (44.1 kHz mono), manifest.json, latency.json, usage.json and index.html (unlabeled A/B/C players with a reveal button)."""


from __future__ import annotations

import argparse
import base64
import html
import json
import os
import random
import statistics
import sys
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

CAP_PER_ENGINE = 3000
RATE = 44100
PROBE_TEXT = "హా అండీ, ఒక్క నిమిషం."  # 22 characters: the first thing the assistant says while it thinks
PROBE_RUNS = 5

# the lines: the six assistant lines of the reels (two per reel) and two tricky ones, in the everyday spoken register of native-lines/te.md (Telugu in Telugu script, English words as people say
# them, fillers where a person would use them). Hindi, Kannada and English are DRAFTS written the same way: for a native reader to check.
LINES: dict[str, list[dict[str, str]]] = {
    "te": [
        {"id": "reel1-a", "text": "హా అండీ, మిగతా ఎనిమిది మందికి నేను call చేస్తాను. Area, thickness, delivery date అడుగుతాను."},
        {"id": "reel1-b", "text": "Ready గా ఉంటాయండీ… మీరు ఓకే చేస్తే చాలు."},
        {"id": "reel2-a", "text": "ఓ… సరే అండీ, రేపటి నుంచి నేనే ముందు call చేస్తాను."},
        {"id": "reel2-b", "text": "వాళ్ళు అడిగిన colour లోనే, WhatsApp లో పంపుతానండీ."},
        {"id": "reel3-a", "text": "అబ్బా, exams time కదా… సరే అండీ, మిగతా వాళ్ళకి నేను రేపు పొద్దున్నే call చేస్తాను."},
        {"id": "reel3-b", "text": "అందరికీ visit book చేస్తానండీ. ముందు రోజు reminder కూడా పంపిస్తా."},
        {"id": "robot", "text": "అవునండీ, నేను shop వాళ్ళ AI assistant ని. మీకు ఏం కావాలో చెప్పండి, నేను help చేస్తాను."},
        {"id": "after6", "text": "సరేనండీ, no problem. సాయంత్రం ఆరు తర్వాత call చేస్తానండీ, ఓకేనా?"},
    ],
    "hi": [
        {"id": "reel1-a", "text": "हाँ जी, बाकी आठ लोगों को मैं call करती हूँ। Area, thickness और delivery date पूछ लूँगी।"},
        {"id": "reel1-b", "text": "Ready रहेंगे जी… बस आप OK कर दीजिए।"},
        {"id": "robot", "text": "जी हाँ, मैं shop की AI assistant हूँ। बताइए, आपको क्या चाहिए? मैं help करती हूँ।"},
        {"id": "after6", "text": "ठीक है जी, no problem। शाम छह बजे के बाद call करूँगी, चलेगा?"},
    ],
    "kn": [
        {"id": "reel1-a", "text": "ಹೌದು ಸರ್, ಉಳಿದ ಎಂಟು ಜನಕ್ಕೆ ನಾನು call ಮಾಡ್ತೀನಿ. Area, thickness, delivery date ಕೇಳ್ತೀನಿ."},
        {"id": "reel1-b", "text": "Ready ಇರುತ್ತೆ ಸರ್… ನೀವು OK ಮಾಡಿದ್ರೆ ಸಾಕು."},
        {"id": "robot", "text": "ಹೌದು ಸರ್, ನಾನು shop ನ AI assistant. ನಿಮಗೆ ಏನು ಬೇಕು ಹೇಳಿ, ನಾನು help ಮಾಡ್ತೀನಿ."},
        {"id": "after6", "text": "ಸರಿ ಸರ್, no problem. ಸಂಜೆ ಆರು ಗಂಟೆ ಆದ್ಮೇಲೆ call ಮಾಡ್ತೀನಿ, ಓಕೆನಾ?"},
    ],
    "en": [
        {"id": "reel1-a", "text": "Sure, I'll call the other eight today. Area, thickness, delivery date, I'll ask all three."},
        {"id": "reel1-b", "text": "They'll be ready, sir. Hmm… you just need to approve."},
        {"id": "robot", "text": "Yes, I'm the shop's AI assistant. Tell me what you need, I'll help."},
        {"id": "after6", "text": "Sure, no problem. I'll call you after six, does that work?"},
    ],
}
LANG_TAG = {"te": "te-IN", "hi": "hi-IN", "kn": "kn-IN", "en": "en-IN"}


@dataclass(frozen=True)
class Voice:
    engine: str  # the cap is per engine: cartesia | sarvam_v3 | sarvam_v4
    name: str  # the provider's voice (shown only after "reveal")
    model: str
    langs: tuple[str, ...]
    params: dict[str, Any]


def plan_voices(cartesia_voices: dict[str, str]) -> list[Voice]:
    """Two or three voices per engine for Telugu, one for the other languages."""
    out: list[Voice] = []
    for name, langs in (("Ramya", ("te", "hi", "kn")), ("Sindhu", ("te",)), ("Saira", ("en",))):
        if name in cartesia_voices:
            out.append(Voice("cartesia", name, "sonic-3.6", langs, {"voice_id": cartesia_voices[name]}))
    for sp, langs in (("priya", ("te", "hi", "kn", "en")), ("kavya", ("te",)), ("neha", ("te",))):
        out.append(Voice("sarvam_v3", sp, "bulbul:v3", langs, {"speaker": sp, "pace": 1.05}))
    for sp, langs in (
        ("kavitha_te_conversation", ("te",)),
        ("pooja_te_conversation", ("te",)),
        ("kavya_hi_conversational", ("hi",)),
        ("chaitra_kn_conversation", ("kn",)),
        ("shalini_en_customer", ("en",)),
    ):
        out.append(Voice("sarvam_v4", sp, "bulbul:v4-flash", langs, {"speaker": sp, "pace": 1.05}))
    return out


class Spend:
    def __init__(self) -> None:
        self.chars: dict[str, int] = {}
        self.calls: dict[str, int] = {}

    def take(self, engine: str, text: str) -> None:
        n = self.chars.get(engine, 0) + len(text)
        if n > CAP_PER_ENGINE:
            raise SystemExit(f"cap: {engine} would pass {CAP_PER_ENGINE} characters; stopping")
        self.chars[engine] = n
        self.calls[engine] = self.calls.get(engine, 0) + 1


def write_wav(path: Path, pcm: bytes, rate: int = RATE) -> float:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = pcm[: len(pcm) // 2 * 2]
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return len(pcm) / 2 / rate


def synth(client: httpx.Client, v: Voice, lang: str, text: str, keys: dict[str, str]) -> bytes:
    """One whole utterance as 16-bit mono PCM at 44.1 kHz."""
    if v.engine == "cartesia":
        r = client.post(
            "https://api.cartesia.ai/tts/bytes",
            headers={"X-API-Key": keys["cartesia"], "Cartesia-Version": "2025-04-16"},
            json={"model_id": v.model, "transcript": text, "voice": {"mode": "id", "id": v.params["voice_id"]}, "language": lang, "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": RATE}},
        )
        r.raise_for_status()
        return r.content
    r = client.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": keys["sarvam"]},
        json={"text": text, "language_code": LANG_TAG[lang], "model": v.model, "speaker": v.params["speaker"], "pace": v.params["pace"], "speech_sample_rate": RATE, "output_audio_codec": "wav"},
    )
    r.raise_for_status()
    wav = base64.b64decode(r.json()["audios"][0])
    return wav[wav.index(b"data") + 8 :]


def first_audio_ms(client: httpx.Client, v: Voice, lang: str, text: str, keys: dict[str, str]) -> float:
    """Milliseconds from sending the request to the first audio bytes of a STREAMED response (this Mac's network, not Cloud Run's)."""
    t0 = time.perf_counter()
    if v.engine == "cartesia":
        req = client.build_request(
            "POST",
            "https://api.cartesia.ai/tts/bytes",
            headers={"X-API-Key": keys["cartesia"], "Cartesia-Version": "2025-04-16"},
            json={"model_id": v.model, "transcript": text, "voice": {"mode": "id", "id": v.params["voice_id"]}, "language": lang, "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 24000}},
        )
    else:
        req = client.build_request(
            "POST",
            "https://api.sarvam.ai/text-to-speech/stream",
            headers={"api-subscription-key": keys["sarvam"]},
            json={"text": text, "language_code": LANG_TAG[lang], "model": v.model, "speaker": v.params["speaker"], "pace": v.params["pace"], "output_audio_codec": "wav", "speech_sample_rate": 24000},
        )
    resp = client.send(req, stream=True)
    try:
        resp.raise_for_status()
        for chunk in resp.iter_bytes():
            if len(chunk) > 64:  # more than a header
                return (time.perf_counter() - t0) * 1000
    finally:
        resp.close()
    raise RuntimeError("no audio")


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, round(p * (len(s) - 1)))]


def cartesia_voice_ids(client: httpx.Client, key: str) -> dict[str, str]:
    found: dict[str, str] = {"Saira": "1e9b9b3d-d2ce-4cac-9d05-bc36a63fa28e"}  # an English voice that is not on the first page of the list
    for lang in ("te", "hi", "kn", "en"):
        r = client.get("https://api.cartesia.ai/voices", params={"language": lang, "limit": 100}, headers={"X-API-Key": key, "Cartesia-Version": "2025-04-16"})
        r.raise_for_status()
        for v in r.json().get("data", []):
            found.setdefault(v["name"].split(" - ")[0], v["id"])
    return found


PRICE = {  # published list prices, 28 Oct 2026 (docs / pricing pages); INR at 90 per dollar like the AI ledger
    "cartesia": "about 1 credit per character; Pro $65 per million credits (Rs 5.85 per 1,000 characters), Startup $45 (Rs 4.05), Scale $38 (Rs 3.42)",
    "sarvam_v3": "Rs 3.00 per 1,000 characters (Rs 2.60 at the top tier)",
    "sarvam_v4": "Rs 1.00 per 1,000 characters now (the announcement says half price until 12 Nov: the list price after that is to be confirmed)",
}


def build_index(out: Path, manifest: dict[str, Any], latency: dict[str, Any]) -> None:
    rnd = random.Random(2810)
    rows: list[str] = []
    for lang, lines in manifest["lines"].items():
        rows.append(f'<h2 id="{lang}">{html.escape(manifest["lang_names"][lang])}</h2>')
        for line in lines:
            cands = [dict(c) for c in line["candidates"]]
            rnd.shuffle(cands)
            players = []
            for i, c in enumerate(cands):
                label = chr(65 + i)
                players.append(
                    f'<div class="cand"><b>{label}</b> <audio controls preload="none" src="{html.escape(c["file"])}"></audio> <span class="reveal" hidden>{html.escape(c["engine"])} / {html.escape(c["voice"])}</span></div>'
                )
            rows.append(f'<section><p class="line">{html.escape(line["text"])}</p>{"".join(players)}</section>')
    lat = "".join(
        f"<tr><td>{html.escape(k)}</td><td>{v['p50']:.0f}</td><td>{v['p95']:.0f}</td><td>{v['n']}</td></tr>" for k, v in latency.items()
    )
    cost = "".join(f"<li><b>{html.escape(k)}</b>: {html.escape(v)}</li>" for k, v in PRICE.items())
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice bake-off</title>
<style>body{{font:16px/1.5 system-ui;max-width:900px;margin:2rem auto;padding:0 1rem}}section{{border-top:1px solid #ccc;padding:.6rem 0}}.line{{font-size:1.15rem;margin:.2rem 0}}.cand{{display:flex;gap:.6rem;align-items:center;margin:.2rem 0}}.reveal{{color:#555;font-size:.9rem}}button{{font-size:1rem;padding:.4rem .9rem}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:.2rem .6rem;text-align:right}}td:first-child,th:first-child{{text-align:left}}</style></head><body>
<h1>Voice bake-off: listen, then reveal</h1>
<p>Each line is spoken by the same voices in a random order per line (A, B, C ...). Listen first, note the letters you like, then press <b>Reveal</b>. Hindi, Kannada and English lines are drafts for a native reader. Jump to: <a href="#te">Telugu</a> <a href="#hi">Hindi</a> <a href="#kn">Kannada</a> <a href="#en">English</a></p>
<p><button id="rv">Reveal engines and voices</button></p>
<details><summary>Time to first audio and cost (not blinded: open after listening)</summary>
<p>Time to first audio of a streamed reply, from this Mac (not from Cloud Run in Mumbai), the 22-character phrase "{html.escape(PROBE_TEXT)}", milliseconds:</p>
<table><tr><th>engine / voice</th><th>p50</th><th>p95</th><th>runs</th></tr>{lat}</table><p>List prices:</p><ul>{cost}</ul></details>
{"".join(rows)}
<script>document.getElementById('rv').onclick=function(){{document.querySelectorAll('.reveal').forEach(function(e){{e.hidden=false}});this.disabled=true}}</script></body></html>"""
    (out / "index.html").write_text(page, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="print the characters each engine would use; call nothing")
    ap.add_argument("--out", default=str(Path.home() / "Desktop/stack19-jobs/voice-bakeoff"))
    args = ap.parse_args()
    keys = {"cartesia": os.environ.get("CARTESIA_API_KEY", ""), "sarvam": os.environ.get("SARVAM_API_KEY", "")}
    out = Path(args.out)
    client = httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))
    ids = cartesia_voice_ids(client, keys["cartesia"]) if keys["cartesia"] and not args.plan else {"Ramya": "x", "Sindhu": "x", "Saira": "x"}
    voices = plan_voices(ids)
    if args.plan:
        plan: dict[str, int] = {}
        for v in voices:
            for lang in v.langs:
                plan[v.engine] = plan.get(v.engine, 0) + sum(len(x["text"]) for x in LINES[lang])
        first = {e: next(v for v in voices if v.engine == e) for e in plan}
        for e, v in first.items():
            plan[e] += PROBE_RUNS * len(PROBE_TEXT)
        print(json.dumps(plan, indent=1), "cap", CAP_PER_ENGINE)
        return
    for need in ("cartesia", "sarvam"):
        if not keys[need]:
            print(f"no {need} key in the environment: its engines are skipped", file=sys.stderr)
    spend = Spend()
    manifest: dict[str, Any] = {"lang_names": {"te": "Telugu", "hi": "Hindi (draft lines)", "kn": "Kannada (draft lines)", "en": "English (Indian accent)"}, "lines": {}}
    seconds: dict[str, float] = {}
    chars_spoken: dict[str, int] = {}
    for lang, lines in LINES.items():
        manifest["lines"][lang] = []
        for line in lines:
            cands = []
            for v in voices:
                if lang not in v.langs or not keys["cartesia" if v.engine == "cartesia" else "sarvam"]:
                    continue
                spend.take(v.engine, line["text"])
                try:
                    pcm = synth(client, v, lang, line["text"], keys)
                except httpx.HTTPError as e:
                    print(f"skip {v.engine}/{v.name}/{lang}/{line['id']}: {type(e).__name__}", file=sys.stderr)
                    continue
                rel = f"{v.engine}/{lang}/{v.name}/{line['id']}.wav"
                secs = write_wav(out / rel, pcm)
                key = f"{v.engine}/{v.name}"
                seconds[key] = seconds.get(key, 0) + secs
                chars_spoken[key] = chars_spoken.get(key, 0) + len(line["text"])
                cands.append({"engine": v.engine, "voice": v.name, "file": rel})
            manifest["lines"][lang].append({"id": line["id"], "text": line["text"], "candidates": cands})
    latency: dict[str, Any] = {}
    seen: set[str] = set()
    for v in voices:
        if v.engine in seen or not keys["cartesia" if v.engine == "cartesia" else "sarvam"]:
            continue
        seen.add(v.engine)
        runs = []
        for _ in range(PROBE_RUNS + 1):  # the first run warms the connection and is dropped
            spend.take(v.engine, PROBE_TEXT)
            runs.append(first_audio_ms(client, v, "te", PROBE_TEXT, keys))
        runs = runs[1:]
        latency[f"{v.engine} / {v.name} ({v.model})"] = {"p50": statistics.median(runs), "p95": pct(runs, 0.95), "n": len(runs), "runs_ms": [round(x) for x in runs]}
    manifest["seconds_per_voice"] = {k: round(s, 2) for k, s in seconds.items()}
    manifest["chars_per_second"] = {k: round(chars_spoken[k] / seconds[k], 1) for k in seconds}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "latency.json").write_text(json.dumps(latency, indent=1), encoding="utf-8")
    (out / "usage.json").write_text(json.dumps({"characters_per_engine": spend.chars, "requests_per_engine": spend.calls, "cap_per_engine": CAP_PER_ENGINE}, indent=1), encoding="utf-8")
    build_index(out, manifest, latency)
    print(json.dumps({"chars": spend.chars, "latency_p50_ms": {k: round(v["p50"]) for k, v in latency.items()}}, indent=1))


if __name__ == "__main__":
    main()
