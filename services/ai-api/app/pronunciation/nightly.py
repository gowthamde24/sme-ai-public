"""The nightly pronunciation round trip (job pronunciation-quality): a small, capped slice of the lexicon spoken through the SAME speech path as live talk, written back by Sarvam, scored (app/pronunciation/qa.py).
Runs as a Cloud Run job (`python -m app.pronunciation.nightly --out /mnt/pron-qa`, started by Cloud Scheduler) and, with the same pieces, from scripts/pronunciation_qa.py by hand.

  * Keys come from the environment only (CARTESIA_API_KEY, SARVAM_API_KEY); nothing is read from or written to a place that holds them. The log carries only ids, ok/LIST, scores and character counts.
  * Cartesia characters are the budget: a night is capped (--cap, default 600) and a MONTH is capped (--month-cap, default 20000; the count is kept in <out>/usage-YYYY-MM.txt), both counted in code before anything is sent.
  * Each night covers three of the six languages, the next three the night after, and the canaries (Dharmavaram, Anantapur) are always in the slice. Results, the report and the clips land in <out>/<date>/ for the weekly review
    export; folders older than --keep-days are removed.
  * The recogniser cannot hear accent: a pass means the right words came back, not that the sound is perfect. The weekly human-ear pack (scripts/pronunciation_review_export.py) covers that."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import array
import asyncio
import io
import json
import os
import random
import shutil
import sys
import wave
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx

from app.agents import register
from app.conversation.providers import CartesiaStreamTts
from app.conversation.voices import default_config
from app.pronunciation import qa
from app.pronunciation.lexicon import shared
from app.pronunciation.routes import _CARRIER
from app.pronunciation.speech import SpeechText

RATE = 24000
THRESHOLD = 300   # 16-bit amplitude under which a sample counts as silence at the ends
KEEP_MS = 60
ALL_LANGUAGES = ("te", "en", "kn", "hi", "ta", "ml")


def trim(pcm: bytes) -> bytes:
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    loud = [i for i, v in enumerate(samples) if abs(v) > THRESHOLD]
    if not loud:
        return pcm
    keep = RATE * KEEP_MS // 1000
    return samples[max(0, loud[0] - keep) : min(len(samples), loud[-1] + keep)].tobytes()


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


def languages_for(day: date, per_night: int = 3) -> list[str]:
    """Three languages a night, rotating, so every language is covered every other night."""
    start = (day.toordinal() * per_night) % len(ALL_LANGUAGES)
    return [ALL_LANGUAGES[(start + i) % len(ALL_LANGUAGES)] for i in range(per_night)]


def month_used(out: Path, day: date) -> int:
    try:
        return int((out / f"usage-{day:%Y-%m}.txt").read_text(encoding="utf-8").strip() or 0)
    except (OSError, ValueError):
        return 0


async def round_trip(languages: list[str], per_language: int, only_lexicon: bool, cap: int, out: Path, seed: int, report: str, title: str) -> tuple[list[qa.Result], int]:
    """Speak, write back, score. Returns the results and the characters sent. `cap` is checked before every clip."""
    ck, sk = os.environ.get("CARTESIA_API_KEY", ""), os.environ.get("SARVAM_API_KEY", "")
    cfg, speech, rng = default_config(), SpeechText(), random.Random(seed)  # noqa: S311  (which words to try tonight, not a secret)
    results: list[qa.Result] = []
    sent = 0
    async with httpx.AsyncClient(timeout=60) as http:
        for language in languages:
            voice = cfg.resolve(language, None, "female")
            choice = voice.voices.primary
            engine = CartesiaStreamTts(ck, voice_id=choice.voice, model=choice.model)
            clips = out / "clips" / language
            clips.mkdir(parents=True, exist_ok=True)
            for item in corpus(language, per_language, only_lexicon, rng):
                written = str(item["written"])
                spoken = speech.prepare(written, language, choice.engine)
                if sent + len(spoken) > cap:
                    print(f"stopping before {item['id']}: {sent} + {len(spoken)} characters would pass the cap of {cap}")
                    break
                pcm = trim(b"".join([c async for c in engine.stream(spoken, language)]))
                sent += len(spoken)
                audio = wav_bytes(pcm)
                (clips / f"{item['id']}.wav").write_bytes(audio)
                r = await http.post("https://api.sarvam.ai/speech-to-text", headers={"api-subscription-key": sk}, data={"model": "saaras:v4", "language_code": STT_CODE[language]}, files={"file": ("a.wav", audio, "audio/wav")})
                heard = r.json().get("transcript", "") if r.status_code == 200 else f"(speech-to-text failed: {r.status_code})"
                result = qa.score(str(item["id"]), language, voice.id, str(item["kind"]), written, spoken, heard, list(item["spellings"]))  # type: ignore[call-overload]
                result.clip = f"clips/{language}/{item['id']}.wav"
                results.append(result)
                print(f"{result.id:28s} {'ok  ' if result.ok else 'LIST'} {result.score}")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps([r.__dict__ for r in results], ensure_ascii=False, indent=1), encoding="utf-8")
    (out / report).write_text(qa.report(results, title=title, chars_sent=sent), encoding="utf-8")
    return results, sent


def prune(root: Path, today: date, keep_days: int) -> None:
    for child in root.iterdir() if root.is_dir() else []:
        try:
            when = date.fromisoformat(child.name)
        except ValueError:
            continue   # not one of ours (usage files, anything else)
        if child.is_dir() and when < today - timedelta(days=keep_days):
            shutil.rmtree(child, ignore_errors=True)


async def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="a folder that survives the run (a mounted bucket on Cloud Run)")
    ap.add_argument("--languages", nargs="+", choices=ALL_LANGUAGES, help="default: tonight's three")
    ap.add_argument("--per-language", type=int, default=int(os.environ.get("PRON_QA_PER_LANGUAGE", "4")))
    ap.add_argument("--cap", type=int, default=int(os.environ.get("PRON_QA_CAP", "600")), help="characters one night may send to Cartesia")
    ap.add_argument("--month-cap", type=int, default=int(os.environ.get("PRON_QA_MONTH_CAP", "20000")), help="characters one calendar month may send")
    ap.add_argument("--keep-days", type=int, default=int(os.environ.get("PRON_QA_KEEP_DAYS", "30")))
    args = ap.parse_args(argv)
    if not os.environ.get("CARTESIA_API_KEY") or not os.environ.get("SARVAM_API_KEY"):
        print("pronunciation-nightly: CARTESIA_API_KEY and SARVAM_API_KEY must be set in the environment", file=sys.stderr)
        return 2
    today = datetime.now(UTC).date()
    root = Path(args.out).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    used = month_used(root, today)
    room = min(args.cap, args.month_cap - used)
    if room <= 0:
        print(f"pronunciation-nightly: {used} of the month's {args.month_cap} characters are used; nothing is spoken tonight")
        return 0
    languages = args.languages or languages_for(today)
    results, sent = await round_trip(languages, args.per_language, True, room, root / today.isoformat(), seed=today.toordinal(), report="report.md", title=f"Pronunciation round trip: {today.isoformat()}")
    (root / f"usage-{today:%Y-%m}.txt").write_text(str(used + sent), encoding="utf-8")
    prune(root, today, args.keep_days)
    listen = [r.id for r in qa.rank(results) if not r.ok]
    print(f"pronunciation-nightly {today.isoformat()}: {len(results)} clips in {','.join(languages)}, {sum(r.ok for r in results)} passed, {len(listen)} to listen to: {' '.join(listen) or 'none'}; characters sent {sent}; month {used + sent} of {args.month_cap}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
