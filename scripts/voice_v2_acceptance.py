#!/usr/bin/env python3
"""Voice system v2: acceptance A1 to A5 against STAGING with a socket client (job-voice-system-v2). SYNTHETIC workspace only (the demo textiles owner of scripts/seed_staging.py).

  python3 -I scripts/voice_v2_acceptance.py --api-url https://<api> [--out ~/Desktop/stack19-jobs/voice-v2-check]

What it does, per case: the "microphone" is a question spoken by Sarvam TTS (16 kHz), streamed in real time to /voice-chat; EVERY frame the server sends is captured per turn; it then checks that
  * the turn announces ONE voice ({type:"voice"}) before its first binary chunk, `audio_end` repeats the same voice_id and language, and no other voice message appears inside the turn;
  * that voice is the one the workspace chose (or the default of its gender) for the reply language;
  * the engine that spoke is Cartesia (a Sarvam outage fallback is reported as a FAIL: the chosen voice did not speak);
  * Sarvam speech-to-text of the captured answer comes back in the language's own script, with no English words except names (reported, not asserted for names).
A3 flips the workspace to male and repeats; A5 changes the Telugu voice and checks the next Telugu turn and "Hear it" (X-Voice-Id). The workspace is put back to female with no choices at the end.
Keys come from Secret Manager / the Supabase CLI inside seed_staging (memory only). Two turns (te, en) are saved as .m4a for a person to listen to.
"""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import array
import asyncio
import base64
import io
import json
import re
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any

import httpx
import websockets

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "services" / "ai-api"))
import seed_staging as S  # noqa: E402

TENANT_PACK = "textiles"
DEMO_TEXTILES = "e00d4db1-2c99-46a9-a273-07b9b9ff764c"   # the synthetic demo textiles workspace on staging
SCRIPT = {"te": (0x0C00, 0x0C7F), "hi": (0x0900, 0x097F), "kn": (0x0C80, 0x0CFF), "ta": (0x0B80, 0x0BFF), "ml": (0x0D00, 0x0D7F)}
QUESTIONS = {
    "te": "ఈ రోజు కొత్త లీడ్స్ ఏమైనా వచ్చాయా?",
    "en": "How many new leads came in today?",
    "hi": "आज कितने नए लीड्स आए हैं?",
    "kn": "ಇವತ್ತು ಎಷ್ಟು ಹೊಸ ಲೀಡ್ಸ್ ಬಂದಿವೆ?",
}
TAG = {"te": "te-IN", "en": "en-IN", "hi": "hi-IN", "kn": "kn-IN"}


def resample_24k_to_16k(pcm: bytes) -> bytes:
    src = array.array("h")
    src.frombytes(pcm[: len(pcm) // 2 * 2])
    out = array.array("h")
    n = int(len(src) * 2 / 3)
    for i in range(n):
        pos = i * 1.5
        j = int(pos)
        frac = pos - j
        a = src[j]
        b = src[j + 1] if j + 1 < len(src) else a
        out.append(int(a + (b - a) * frac))
    return out.tobytes()


def wav_to_pcm(data: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(data)) as w:
        return w.readframes(w.getnframes()), w.getframerate()


def pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class Rig:
    def __init__(self, api: str, out: Path) -> None:
        self.api, self.out = api.rstrip("/"), out
        self.seeder = S.Seeder(api)
        self.sarvam = S.secret_get("sme-sarvam-api-key") or ""
        self.token = self.seeder.second_factor(TENANT_PACK, self.seeder.sign_in("demo-textiles@" + S.DEMO_DOMAIN, S.secret_get("sme-demo-textiles-password") or ""))
        self.tenant = DEMO_TEXTILES
        self.http = httpx.Client(timeout=90)
        self.rows: list[tuple[str, str, bool, str]] = []

    # ---- settings
    def api_call(self, method: str, path: str, body: Any = None) -> Any:
        st, out = self.seeder.call(self.token, method, f"/v1/tenants/{self.tenant}{path}", body)
        if st >= 300:
            raise RuntimeError(f"{method} {path}: {st} {out}")
        return out

    def voices(self) -> dict[str, Any]:
        return self.api_call("GET", "/ai-assistant/voices")

    def active(self, language: str) -> str:
        return next(x for x in self.voices()["languages"] if x["language"] == language)["active_id"]

    # ---- audio in
    def speak(self, language: str) -> bytes:
        r = self.http.post("https://api.sarvam.ai/text-to-speech", headers={"api-subscription-key": self.sarvam}, json={"text": QUESTIONS[language], "language_code": TAG[language], "model": "bulbul:v3", "output_audio_codec": "wav", "speech_sample_rate": 24000})
        r.raise_for_status()
        pcm, rate = wav_to_pcm(base64.b64decode(r.json()["audios"][0]))
        return resample_24k_to_16k(pcm) if rate == 24000 else pcm

    def transcribe(self, pcm24: bytes, language: str) -> str:
        r = self.http.post("https://api.sarvam.ai/speech-to-text", headers={"api-subscription-key": self.sarvam}, data={"model": "saaras:v4", "language_code": TAG[language]}, files={"file": ("a.wav", pcm_to_wav(pcm24, 24000), "audio/wav")})
        return r.json().get("transcript", "") if r.status_code == 200 else ""

    # ---- one turn over the socket
    async def turn(self, language: str, *, start_language: str = "en") -> dict[str, Any]:
        question = self.speak(language)
        url = self.api.replace("https://", "wss://") + f"/v1/tenants/{self.tenant}/voice-chat"
        events: list[dict[str, Any]] = []
        chunks: dict[int, list[bytes]] = {}
        current = [-1]
        async with websockets.connect(url, max_size=None, additional_headers={"Origin": "https://staging.stack19.com"}) as ws:
            await ws.send(json.dumps({"type": "start", "access_token": self.token, "language": start_language}))

            async def reader() -> None:
                async for raw in ws:
                    if isinstance(raw, bytes):
                        chunks.setdefault(current[0], []).append(raw)
                        continue
                    m = json.loads(raw)
                    events.append(m)
                    if m.get("type") == "voice":
                        current[0] = int(m["turn"])

            task = asyncio.ensure_future(reader())
            deadline = time.time() + 40
            while not any(e.get("type") == "audio_end" and e.get("turn") == 0 for e in events) and time.time() < deadline:   # the greeting first
                await asyncio.sleep(0.2)
            await asyncio.sleep(0.5)
            frame = 640   # 20 ms of 16 kHz s16le
            for i in range(0, len(question), frame):
                await ws.send(question[i : i + frame])
                await asyncio.sleep(0.02)
            for _ in range(80):   # 1.6 s of quiet: the server ends the utterance by itself
                await ws.send(b"\x00" * frame)
                await asyncio.sleep(0.02)
            end = time.time() + 60
            while not any(e.get("type") == "audio_end" and e.get("turn") == 1 for e in events) and time.time() < end:
                await asyncio.sleep(0.2)
            await asyncio.sleep(0.3)
            with __import__("contextlib").suppress(Exception):
                await ws.send(json.dumps({"type": "stop"}))
            task.cancel()
        return {"events": events, "chunks": chunks, "language": language}

    def judge(self, label: str, result: dict[str, Any], expect_voice: str, language: str, *, save: str | None = None) -> None:
        ev, chunks = result["events"], result["chunks"]
        voices = [e for e in ev if e.get("type") == "voice" and e.get("turn") == 1]
        ends = [e for e in ev if e.get("type") == "audio_end" and e.get("turn") == 1]
        timing = next((e for e in ev if e.get("type") == "timings" and e.get("turn") == 1), {})
        pcm = b"".join(chunks.get(1, []))
        first_voice_at = next((i for i, e in enumerate(ev) if e.get("type") == "voice" and e.get("turn") == 1), -1)
        notes: list[str] = []
        ok = True
        if len(voices) != 1:
            ok, _ = False, notes.append(f"{len(voices)} voice messages in the turn")
        elif voices[0]["voice_id"] != expect_voice or voices[0]["language"] != language:
            ok, _ = False, notes.append(f"spoke {voices[0]['voice_id']}/{voices[0]['language']}, expected {expect_voice}/{language}")
        if not ends or ends[0].get("voice_id") != expect_voice or ends[0].get("language") != language:
            ok, _ = False, notes.append(f"audio_end says {ends[0].get('voice_id') if ends else None}")
        if not pcm:
            ok, _ = False, notes.append("no audio")
        if first_voice_at < 0:
            ok, _ = False, notes.append("no voice message")
        problems = [f"{e.get('type')}:{e.get('code') or e.get('reason')}" for e in ev if e.get("type") in ("error", "limit")]
        if problems:
            notes.append("server said " + ",".join(problems))
        engine = timing.get("engine")
        if engine != "cartesia" or timing.get("fallback"):
            ok, _ = False, notes.append(f"engine {engine} (fallback {timing.get('fallback')!r}): the chosen Cartesia voice did not speak")
        heard = self.transcribe(pcm[: 24000 * 2 * 25], language) if pcm else ""   # the recogniser takes 30 s at most: the first 25 s say which language and script
        if language in SCRIPT:
            lo, hi = SCRIPT[language]
            letters = [c for c in heard if c.isalpha()]
            share = sum(1 for c in letters if lo <= ord(c) <= hi) / max(1, len(letters))
            if share < 0.5:
                ok, _ = False, notes.append(f"speech-to-text is only {share:.0%} {language} script: {heard[:60]!r}")
        elif not heard.strip() or re.search(r"[^\x00-\x7f]", heard):
            ok, _ = False, notes.append(f"English turn heard with other scripts: {heard[:60]!r}")
        self.rows.append((label, f"{language} {expect_voice}", ok, "; ".join(notes) or f"engine {engine}, {len(pcm) / 2 / 24000:.1f}s, heard {heard[:50]!r}"))
        if save and pcm:
            self.out.mkdir(parents=True, exist_ok=True)
            wav = self.out / f"{save}.wav"
            wav.write_bytes(pcm_to_wav(pcm, 24000))
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", str(wav), str(self.out / f"{save}.m4a")], check=False, capture_output=True)
            wav.unlink(missing_ok=True)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--out", default=str(Path.home() / "Desktop" / "stack19-jobs" / "voice-v2-check"))
    args = ap.parse_args()
    rig = Rig(args.api_url, Path(args.out))
    try:
        rig.api_call("PUT", "/ai-assistant/voices", {"gender": "male"})   # a flip clears every earlier choice ...
        rig.api_call("PUT", "/ai-assistant/voices", {"gender": "female"})   # ... so the run starts from the defaults
        for lang in ("te", "en", "hi", "kn"):
            await_result = await rig.turn(lang)
            rig.judge(f"A1/A2 {lang}", await_result, rig.active(lang), lang, save=f"{lang}-female" if lang in ("te", "en") else None)
        rig.api_call("PUT", "/ai-assistant/voices", {"gender": "male"})
        r = await rig.turn("te")
        rig.judge("A3 te male", r, rig.active("te"), "te")
        rig.api_call("PUT", "/ai-assistant/voices", {"gender": "female"})
        before = rig.active("te")
        other = next(v for v in next(x for x in rig.voices()["languages"] if x["language"] == "te")["voices"] if v["gender"] == "female" and v["id"] != before)
        rig.api_call("PUT", "/ai-assistant/voices", {"language": "te", "voice_id": other["id"]})
        r = await rig.turn("te")
        rig.judge("A5 te changed", r, other["id"], "te")
        hear = rig.http.get(f"{rig.api}/v1/tenants/{rig.tenant}/ai-assistant/voices/preview", params={"language": "te"}, headers={"Authorization": f"Bearer {rig.token}"})
        rig.rows.append(("A5 Hear it", f"te {other['id']}", hear.status_code == 200 and hear.headers.get("x-voice-id") == other["id"], f"status {hear.status_code}, X-Voice-Id {hear.headers.get('x-voice-id')}, engine {hear.headers.get('x-voice-engine')}"))
    finally:
        with __import__("contextlib").suppress(Exception):
            rig.api_call("PUT", "/ai-assistant/voices", {"gender": "female"})
    print("\n| check | voice | result | detail |\n|---|---|---|---|")
    for label, voice, ok, detail in rig.rows:
        print(f"| {label} | {voice} | {'PASS' if ok else 'FAIL'} | {detail} |")
    return 0 if all(ok for _, _, ok, _ in rig.rows) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
