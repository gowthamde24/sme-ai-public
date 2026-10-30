#!/usr/bin/env python3
"""The pronunciation round trip (job pronunciation-quality). OPT-IN: it spends Cartesia characters and Sarvam speech-to-text; both keys come from the environment only.

  CARTESIA_API_KEY=... SARVAM_API_KEY=... python scripts/pronunciation_qa.py --languages te en kn --per-language 14 --cap 4500 --out ~/Desktop/stack19-jobs/pron-review [--report first-report.md] [--only-lexicon]

For each language it builds a corpus (shared-lexicon words in a carrier sentence, example lines from native_lines/, and numeric sentences for the normaliser), gives each text to the SAME speech path as live talk (normalise -> lexicon -> engine), speaks it in the language's default female
catalogue voice, writes what Sarvam heard, and ranks the clips by how far the words are from what was meant (app/pronunciation/qa.py). Clips are kept under <out>/clips/<lang>/ for the weekly review export. Characters are counted in code and the run stops
before the cap. The recogniser cannot hear accent: it finds gross errors only."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import random
import sys
import wave
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.agents import register  # noqa: E402
from app.conversation.providers import CartesiaStreamTts  # noqa: E402
from app.conversation.voices import default_config  # noqa: E402
from app.pronunciation import qa  # noqa: E402
from app.pronunciation.lexicon import shared  # noqa: E402
from app.pronunciation.routes import _CARRIER  # noqa: E402
from app.pronunciation.speech import SpeechText  # noqa: E402
from voice_filler_bank import RATE, trim  # noqa: E402

STT_CODE = {"en": "en-IN", "te": "te-IN", "hi": "hi-IN", "kn": "kn-IN", "ta": "ta-IN", "ml": "ml-IN"}
NUMERIC = {   # sentences with numbers, money, dates, times, phone numbers and units, around a word of the language
    "en": ["The price is ₹1,20,000 for 2000 sq ft.", "Call 98765 43210 on 30/10/2026 at 6:30 pm.", "GST is 18% and EMI starts at Rs. 2,600."],
    "te": ["ధర ₹2,600 అండీ, GST 18%.", "30/10/2026 సాయంత్రం 6:30 కి కాల్ చేస్తాను.", "2000 sq ft స్థలం ₹1,20,000."],
    "hi": ["कीमत ₹1,500 है, GST 18%।", "30/10/2026 को शाम 6:30 बजे कॉल करूँगी।", "2000 sq ft ज़मीन ₹1,20,000 की है।"],
    "kn": ["ಬೆಲೆ ₹2,600, GST 18%.", "30/10/2026 ಸಂಜೆ 6:30 ಕ್ಕೆ call ಮಾಡ್ತೀನಿ.", "2000 sq ft ಜಾಗ ₹1,20,000."],
    "ta": ["விலை ₹2,600, GST 18%.", "30/10/2026 மாலை 6:30 மணிக்கு call பண்றேன்.", "2000 sq ft இடம் ₹1,20,000."],
    "ml": ["വില ₹12,000, GST 18%.", "30/10/2026 വൈകുന്നേരം 6:30 ന് വിളിക്കാം.", "2000 sq ft സ്ഥലം ₹1,20,000."],
}


def corpus(language: str, per_language: int, only_lexicon: bool, rng: random.Random) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    carrier = _CARRIER[language]
    places = [e for e in shared().entries if e.kind == "place"]
    names = [e for e in shared().entries if e.kind == "name"]
    own = [e for e in places if language in e.forms] or places
    picks = [e for e in ("Dharmavaram", "Anantapur") if shared().find(e)]
    chosen = [shared().find(w) for w in picks] + rng.sample(own, min(4, len(own))) + rng.sample(names, min(2, len(names)))
    seen: set[str] = set()
    for entry in chosen:
        if entry is None or entry.word in seen:
            continue
        seen.add(entry.word)
        items.append({"id": f"{language}-lex-{entry.word}", "kind": "lexicon", "written": carrier.format(w=entry.word), "spellings": list(entry.spellings())})
    if not only_lexicon:
        lines = [t for _, t in register.examples(language)] if language in register.LANGUAGES else []
        for n, text in enumerate(rng.sample(lines, min(3, len(lines)))):
            items.append({"id": f"{language}-line-{n + 1}", "kind": "sentence", "written": text, "spellings": []})
        for n, text in enumerate(NUMERIC[language]):
            items.append({"id": f"{language}-num-{n + 1}", "kind": "normaliser", "written": text, "spellings": []})
    return items[:per_language]


def wav_bytes(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--languages", nargs="+", default=["te", "en", "kn"])
    ap.add_argument("--per-language", type=int, default=14)
    ap.add_argument("--cap", type=int, default=4500, help="characters this run may send to Cartesia")
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", default="first-report.md")
    ap.add_argument("--only-lexicon", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--rescore", action="store_true", help="read <out>/results.json again and write the report with the current comparison rules (nothing is spoken, no characters are spent)")
    args = ap.parse_args()
    if args.rescore:
        out = Path(args.out).expanduser()
        old = json.loads((out / "results.json").read_text(encoding="utf-8"))
        again = [qa.score(r["id"], r["language"], r["voice"], r["kind"], r["written"], r["spoken"], r["heard"], r["spellings"]) for r in old]
        for fresh, row in zip(again, old, strict=True):
            fresh.clip = row["clip"]
        (out / "results.json").write_text(json.dumps([r.__dict__ for r in again], ensure_ascii=False, indent=1), encoding="utf-8")
        (out / args.report).write_text(qa.report(again, title="Pronunciation round trip: first report", chars_sent=sum(r.chars for r in again)), encoding="utf-8")
        print(f"{len(again)} clips, {sum(r.ok for r in again)} passed")
        return 0
    ck, sk = os.environ.get("CARTESIA_API_KEY", ""), os.environ.get("SARVAM_API_KEY", "")
    if not ck or not sk:
        print("pronunciation-qa: set CARTESIA_API_KEY and SARVAM_API_KEY in the environment", file=sys.stderr)
        return 2
    cfg, speech, rng = default_config(), SpeechText(), random.Random(args.seed)
    out = Path(args.out).expanduser()
    results: list[qa.Result] = []
    sent = 0
    async with httpx.AsyncClient(timeout=60) as http:
        for language in args.languages:
            voice = cfg.resolve(language, None, "female")
            choice = voice.voices.primary
            engine = CartesiaStreamTts(ck, voice_id=choice.voice, model=choice.model)
            clips = out / "clips" / language
            clips.mkdir(parents=True, exist_ok=True)
            for item in corpus(language, args.per_language, args.only_lexicon, rng):
                written = str(item["written"])
                spoken = speech.prepare(written, language, choice.engine)
                if sent + len(spoken) > args.cap:
                    print(f"stopping before {item['id']}: {sent} + {len(spoken)} characters would pass the cap of {args.cap}")
                    break
                pcm = trim(b"".join([c async for c in engine.stream(spoken, language)]))
                sent += len(spoken)
                audio = wav_bytes(pcm)
                (clips / f"{item['id']}.wav").write_bytes(audio)
                r = await http.post("https://api.sarvam.ai/speech-to-text", headers={"api-subscription-key": sk}, data={"model": "saaras:v4", "language_code": STT_CODE[language]}, files={"file": ("a.wav", audio, "audio/wav")})
                heard = r.json().get("transcript", "") if r.status_code == 200 else f"(speech-to-text failed: {r.status_code})"
                result = qa.score(str(item["id"]), language, voice.id, str(item["kind"]), written, spoken, heard, list(item["spellings"]))  # type: ignore[arg-type]
                result.clip = f"clips/{language}/{item['id']}.wav"
                results.append(result)
                print(f"{result.id:28s} {'ok  ' if result.ok else 'LIST'} {result.score}")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=1), encoding="utf-8")
    (out / args.report).write_text(qa.report(results, title="Pronunciation round trip: first report", chars_sent=sent), encoding="utf-8")
    print("characters sent to Cartesia:", sent)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
