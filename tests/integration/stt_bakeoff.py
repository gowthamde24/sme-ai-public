"""JOB AK / K3, extended by JOB BD: `make stt-bakeoff` (DIR defaults to ~/Desktop/voice-samples). Which speech engine hears Telugu / Hindi / Kannada / English shop talk best, MEASURED on the owner's own
voice samples. OPT-IN: never in `make check`. No database is needed (the product words for the keyterms are read from the demo's price list when the local stack is up, and skipped quietly when not).

The folder is OUTSIDE the repository (the command refuses a folder inside it) and is only read; the report goes to ~/Desktop/v2-overnight/voice-bakeoff.md (REPORT=... to change it), also outside the
repository: what people said never enters version control. For each `<name>.wav` or `<name>.m4a` the folder may hold

    <name>.truth.txt   what was really said (the reference the error rates are computed against)
    <name>.txt         what Chrome's speech recognition produced for it (a further engine; nothing is sent anywhere for it)

The language of a file is the start of its name (`te-03-...`, `hi-`, `kn-`, `en-`, `ta-`), else STT_LANGUAGE, else the engine detects it. Engines are the adapters of app/voice, each switched on by its own
environment variables and nothing else: Sarvam (SARVAM_API_KEY), Bhashini (BHASHINI_API_KEY + BHASHINI_ASR_SERVICE_ID), Google Cloud (GOOGLE_API_KEY), an AI4Bharat model behind an address you run
(AI4BHARAT_STT_URL, optional AI4BHARAT_TOKEN), and Chrome (the .txt files). Keys come only from the environment (enter them hidden: read -rs). Scores: word error rate and character error rate
(substitutions + deletions + insertions over the reference, on lower-cased text with punctuation removed; 0 % is perfect, 100 % or more is useless), the median time a request took, and the cost per minute
from each provider's own price list (research, not a bill) with the estimated cost of THIS run, which is printed first and refused above MAX_SPEND_INR (default 100) unless CONFIRM_SPEND=1.
If a text-to-speech adapter is configured too (VOICE_TTS_PROVIDER-style: the same keys), the reference sentences are also spoken by it: time and characters are reported and the audio is written to
<folder>/tts-out/ for you to LISTEN to (nothing scores a voice automatically)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import os
import statistics
import sys
import time
import unicodedata
import wave
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import httpx
import pytest

from app.voice.audio import AudioRefused, inspect_audio
from app.voice.fake import FakeTts  # noqa: F401  (kept importable for tests)
from app.voice.interface import Price, SpeechToText, TextToSpeech, VoiceError

ROOT = Path(__file__).resolve().parents[2]
AUDIO_SUFFIXES = (".wav", ".m4a")
MAX_FILES = 120
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 400 * 1024 * 1024
MAX_KEYTERMS, MAX_KEYTERM_CHARS = 50, 64


# ============================================================================ words and word error rate (pure)
def words(text: str) -> list[str]:
    """Lower-cased words with punctuation and symbols removed; letters and the marks that belong to them (Indian scripts) stay."""
    # the Indic joiners (U+200C, U+200D) are removed, not turned into spaces: an engine and a reference may differ in them and that is not an error
    text = unicodedata.normalize("NFC", text).replace("\u200c", "").replace("\u200d", "")
    cleaned = "".join(
        " " if unicodedata.category(ch)[0] in "PSZC" else ch for ch in text.casefold()
    )
    return cleaned.split()


def edit_distance(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref, hyp = words(reference), words(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)


def _tokens(name: str) -> list[str]:
    """Runs of letters, digits and the marks that belong to letters (so a Telugu word is not cut at its vowel signs)."""
    out: list[str] = []
    current: list[str] = []
    for ch in unicodedata.normalize("NFC", name):
        if unicodedata.category(ch)[0] in "LMN":
            current.append(ch)
        elif current:
            out.append("".join(current))
            current = []
    if current:
        out.append("".join(current))
    return out


def keyterms_from(names: list[str]) -> list[str]:
    """Product words from item names: words of at least three characters that are not numbers, each once (case-insensitive), at most 50, each at most 64 characters."""
    seen: set[str] = set()
    out: list[str] = []
    for name in names:
        for word in _tokens(name):
            key = word.casefold()
            if (
                len(word) >= 3
                and not word.isdigit()
                and key not in seen
                and len(word) <= MAX_KEYTERM_CHARS
            ):
                seen.add(key)
                out.append(word)
                if len(out) == MAX_KEYTERMS:
                    return out
    return out


# ============================================================================ the folder
@dataclass(frozen=True)
class Sample:
    path: Path
    truth: str | None
    chrome: str | None

    @property
    def name(self) -> str:
        return self.path.stem

    @property
    def language(self) -> str | None:
        """The language from the start of the file name (te-, hi-, kn-, en-, ta-), else None."""
        prefix = self.path.stem.split("-", 1)[0].lower()
        return prefix if prefix in ("te", "hi", "kn", "en", "ta") else None


class FolderError(Exception):
    """A plain sentence for the owner."""


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip() if path.is_file() else None
    except (OSError, UnicodeDecodeError):
        return None


def discover(folder: Path) -> list[Sample]:
    resolved = folder.expanduser().resolve()
    if not resolved.is_dir():
        raise FolderError(f"{folder} is not a folder")
    if resolved == ROOT or ROOT in resolved.parents:
        raise FolderError(
            "the folder is inside the repository: keep voice samples outside it, so they can never be committed"
        )
    files = sorted(
        p
        for p in resolved.iterdir()
        if p.is_file() and not p.is_symlink() and p.suffix.lower() in AUDIO_SUFFIXES
    )
    if not files:
        raise FolderError(f"no .wav or .m4a files in {folder}")
    if len(files) > MAX_FILES:
        raise FolderError(
            f"{len(files)} audio files: the limit is {MAX_FILES} (each is a paid request)"
        )
    sizes = [p.stat().st_size for p in files]
    if max(sizes) > MAX_FILE_BYTES or sum(sizes) > MAX_TOTAL_BYTES:
        raise FolderError(
            f"the files are too big (limit {MAX_FILE_BYTES // 2**20} MB each, {MAX_TOTAL_BYTES // 2**20} MB together)"
        )
    return [
        Sample(p, read_text(p.with_name(p.stem + ".truth.txt")), read_text(p.with_suffix(".txt")))
        for p in files
    ]


def wav_seconds(path: Path) -> float | None:
    if path.suffix.lower() != ".wav":
        return None
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except (wave.Error, EOFError, OSError):
        return None


# ============================================================================ the engines
USD_INR = (
    88.0  # an ASSUMED rate, only to put dollar price lists next to rupee ones; say so in the report
)
MAX_SPEND_INR_DEFAULT = 100.0


class EngineError(Exception):
    """A constant code: no provider text, no key, no URL."""


class Engine(Protocol):
    name: str
    price: Price

    def transcribe(self, sample: Sample, keyterms: list[str]) -> str: ...


class AdapterEngine:
    """An app/voice speech-to-text adapter run over a sample."""

    def __init__(self, adapter: SpeechToText, default_language: str | None = None) -> None:
        self._adapter, self._default = adapter, default_language
        self.name = adapter.name
        self.price = adapter.price

    def transcribe(self, sample: Sample, keyterms: list[str]) -> str:
        data = sample.path.read_bytes()
        try:
            info = inspect_audio(data)
            return self._adapter.transcribe(
                data, info.content_type, sample.language or self._default, keyterms
            ).text
        except AudioRefused as exc:
            raise EngineError(f"audio_{exc.code}") from None
        except VoiceError as exc:
            raise EngineError(exc.code) from None


class Chrome:
    """Chrome's speech recognition, recorded by the owner into `<name>.txt`: nothing is sent anywhere for this engine."""

    name = "chrome"
    price = Price(inr_per_minute=0.0, note="free (the browser)")

    def transcribe(self, sample: Sample, keyterms: list[str]) -> str:
        if sample.chrome is None:
            raise EngineError("no_file")
        return sample.chrome


def _secret(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key, "").strip()
    return value or None


def stt_adapters_from(
    env: Mapping[str, str], client: httpx.Client | None = None
) -> list[SpeechToText]:
    from app.voice.ai4bharat import Ai4BharatStt
    from app.voice.bhashini import BhashiniStt
    from app.voice.google import GoogleStt
    from app.voice.sarvam import SarvamStt

    found: list[SpeechToText] = []
    if key := _secret(env, "SARVAM_API_KEY"):
        found.append(SarvamStt(key, _secret(env, "SARVAM_STT_MODEL") or "saaras:v4", client))
    if (key := _secret(env, "BHASHINI_API_KEY")) and (
        svc := _secret(env, "BHASHINI_ASR_SERVICE_ID")
    ):
        found.append(BhashiniStt(key, svc, client=client))
    if key := _secret(env, "GOOGLE_API_KEY"):
        found.append(GoogleStt(key, client))
    if url := _secret(env, "AI4BHARAT_STT_URL"):
        found.append(Ai4BharatStt(url, _secret(env, "AI4BHARAT_TOKEN"), client))
    return found


def tts_adapters_from(
    env: Mapping[str, str], client: httpx.Client | None = None
) -> list[TextToSpeech]:
    from app.voice.ai4bharat import Ai4BharatTts
    from app.voice.bhashini import BhashiniTts
    from app.voice.google import GoogleTts
    from app.voice.sarvam import SarvamTts

    found: list[TextToSpeech] = []
    if key := _secret(env, "SARVAM_API_KEY"):
        found.append(
            SarvamTts(
                key,
                _secret(env, "SARVAM_TTS_MODEL") or "bulbul:v3",
                _secret(env, "SARVAM_TTS_SPEAKER"),
                client,
            )
        )
    if (key := _secret(env, "BHASHINI_API_KEY")) and (
        svc := _secret(env, "BHASHINI_TTS_SERVICE_ID")
    ):
        found.append(BhashiniTts(key, svc, client))
    if key := _secret(env, "GOOGLE_API_KEY"):
        found.append(GoogleTts(key, client))
    if url := _secret(env, "AI4BHARAT_TTS_URL"):
        found.append(Ai4BharatTts(url, _secret(env, "AI4BHARAT_TOKEN"), client))
    return found


def engines_from(
    env: Mapping[str, str], samples: list[Sample], client: httpx.Client | None = None
) -> list[Engine]:
    language = _secret(env, "STT_LANGUAGE")
    found: list[Engine] = [AdapterEngine(a, language) for a in stt_adapters_from(env, client)]
    if any(s.chrome is not None for s in samples):
        found.append(Chrome())
    return found


# ============================================================================ characters, money
def cer(reference: str, hypothesis: str) -> float:
    """Character error rate on the same normalisation as the words (letters and marks, spaces between words kept as one)."""
    ref, hyp = list(" ".join(words(reference))), list(" ".join(words(hypothesis)))
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)


def inr_per_minute(price: Price) -> float | None:
    if price.inr_per_minute is not None:
        return price.inr_per_minute
    if price.usd_per_minute is not None:
        return price.usd_per_minute * USD_INR
    return None


def price_text(price: Price) -> str:
    if price.inr_per_minute is not None:
        return f"Rs {price.inr_per_minute:.2f}/min" if price.inr_per_minute else "free"
    if price.usd_per_minute is not None:
        return f"${price.usd_per_minute:.3f}/min (about Rs {price.usd_per_minute * USD_INR:.2f})"
    return "not published"


def audio_seconds(path: Path) -> float | None:
    """Measured from the container (WAV and M4A); None when it cannot be told."""
    try:
        return inspect_audio(path.read_bytes()).seconds
    except (AudioRefused, OSError):
        return None


def estimated_spend_inr(engines: list[Engine], samples: list[Sample]) -> float:
    total_minutes = sum((audio_seconds(s.path) or 0.0) for s in samples) / 60
    return sum(
        (inr_per_minute(e.price) or 0.0) * total_minutes for e in engines if e.name != "chrome"
    )


# ============================================================================ running and reporting
@dataclass
class Row:
    engine: str
    sample: str
    language: str | None = None
    text: str | None = None
    error: str | None = None
    seconds: float = 0.0  # how long the request took
    audio_seconds: float | None = None
    wer: float | None = None
    cer: float | None = None


@dataclass
class Summary:
    rows: list[Row] = field(default_factory=list)
    prices: dict[str, Price] = field(default_factory=dict)

    def engines(self) -> list[str]:
        return list(dict.fromkeys(r.engine for r in self.rows))

    def languages(self) -> list[str]:
        return sorted({r.language or "?" for r in self.rows})

    def _scored(self, engine: str, language: str | None, attr: str) -> list[float]:
        return [
            getattr(r, attr)
            for r in self.rows
            if r.engine == engine
            and (language is None or (r.language or "?") == language)
            and getattr(r, attr) is not None
        ]

    def mean_wer(self, engine: str, language: str | None = None) -> str:
        values = self._scored(engine, language, "wer")
        return f"{100 * sum(values) / len(values):.1f}%" if values else "n/a"

    def mean_cer(self, engine: str, language: str | None = None) -> str:
        values = self._scored(engine, language, "cer")
        return f"{100 * sum(values) / len(values):.1f}%" if values else "n/a"

    def median_seconds(self, engine: str, language: str | None = None) -> str:
        times = [
            r.seconds
            for r in self.rows
            if r.engine == engine
            and r.text is not None
            and engine != "chrome"
            and (language is None or (r.language or "?") == language)
        ]
        return f"{statistics.median(times):.1f} s" if times else "n/a"

    def failed(self, engine: str) -> int:
        return sum(1 for r in self.rows if r.engine == engine and r.error not in (None, "no_file"))


def run(samples: list[Sample], engines: list[Engine], keyterms: list[str]) -> Summary:
    summary = Summary(prices={e.name: e.price for e in engines})
    for sample in samples:
        measured = audio_seconds(sample.path)
        for engine in engines:
            row = Row(engine.name, sample.name, sample.language, audio_seconds=measured)
            started = time.perf_counter()
            try:
                row.text = engine.transcribe(sample, keyterms)
            except EngineError as exc:
                row.error = str(exc)
            row.seconds = time.perf_counter() - started
            if row.text is not None and sample.truth is not None:
                row.wer = wer(sample.truth, row.text)
                row.cer = cer(sample.truth, row.text)
            summary.rows.append(row)
    return summary


def table(summary: Summary, samples: list[Sample]) -> str:
    lines = [
        "| engine | files | with a reference | word error | character error | median time | failed | list price |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for e in summary.engines():
        mine = [r for r in summary.rows if r.engine == e and r.text is not None]
        lines.append(
            f"| {e} | {len(mine)}/{len(samples)} | {sum(r.wer is not None for r in mine)} | {summary.mean_wer(e)} | {summary.mean_cer(e)} | {summary.median_seconds(e)} | {summary.failed(e)} | {price_text(summary.prices.get(e, Price()))} |"
        )
    return "\n".join(lines)


def language_table(summary: Summary) -> str:
    engines = summary.engines()
    lines = [
        "| language | " + " | ".join(f"{e} word / char error, time" for e in engines) + " |",
        "|---|" + "---|" * len(engines),
    ]
    for lang in summary.languages():
        cells = [
            f"{summary.mean_wer(e, lang)} / {summary.mean_cer(e, lang)}, {summary.median_seconds(e, lang)}"
            for e in engines
        ]
        lines.append(f"| {lang} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


@dataclass
class TtsRow:
    engine: str
    sample: str
    language: str
    characters: int
    seconds: float = 0.0
    error: str | None = None
    saved: str | None = None
    bytes: int = 0


def run_tts(
    samples: list[Sample], engines: list[TextToSpeech], folder: Path, per_language: int
) -> list[TtsRow]:
    """Speak the reference sentences (a few per language); the audio goes to <folder>/tts-out/ to be listened to."""
    out_dir = folder.expanduser().resolve() / "tts-out"
    rows: list[TtsRow] = []
    taken: dict[str, int] = {}
    for sample in samples:
        lang = sample.language
        if lang is None or sample.truth is None or taken.get(lang, 0) >= per_language:
            continue
        taken[lang] = taken.get(lang, 0) + 1
        for engine in engines:
            row = TtsRow(engine.name, sample.name, lang, len(sample.truth))
            started = time.perf_counter()
            try:
                speech = engine.synthesize(sample.truth, lang)
                row.bytes = len(speech.audio)
                ext = {"audio/wav": "wav", "audio/mpeg": "mp3"}.get(speech.content_type, "bin")
                out_dir.mkdir(exist_ok=True)
                target = out_dir / f"{engine.name}-{sample.name}.{ext}"
                target.write_bytes(speech.audio)
                row.saved = target.name
            except VoiceError as exc:
                row.error = exc.code
            row.seconds = time.perf_counter() - started
            rows.append(row)
    return rows


def tts_table(rows: list[TtsRow], engines: list[TextToSpeech]) -> str:
    if not rows:
        return "No text-to-speech adapter was configured (or no sample had a language and a reference)."
    lines = [
        "| engine | sentences | characters | median time | failed | list price | listen in tts-out/ |",
        "|---|---|---|---|---|---|---|",
    ]
    for engine in engines:
        mine = [r for r in rows if r.engine == engine.name]
        ok = [r for r in mine if r.error is None]
        price = engine.price
        cost = (
            f"Rs {price.inr_per_1000_chars:.2f} per 1,000 characters"
            if price.inr_per_1000_chars is not None
            else f"${price.usd_per_1000_chars:.3f} per 1,000 characters"
            if price.usd_per_1000_chars is not None
            else "not published"
        )
        lines.append(
            f"| {engine.name} | {len(ok)}/{len(mine)} | {sum(r.characters for r in mine)} | {statistics.median([r.seconds for r in ok]):.1f} s | {len(mine) - len(ok)} | {cost} | {', '.join(r.saved for r in ok if r.saved)[:200]} |"
            if ok
            else f"| {engine.name} | 0/{len(mine)} | {sum(r.characters for r in mine)} | n/a | {len(mine)} | {cost} | |"
        )
    return "\n".join(lines)


def write_report(path: Path, summary: Summary, samples: list[Sample], tts: str = "") -> Path:
    resolved = path.expanduser().resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        raise FolderError(
            "the report would land inside the repository: what people said must never be committed"
        )
    resolved.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Voice bake-off",
        "",
        f"Run on {len(samples)} recordings. Error rates are against the owner's typed reference (lower is better; 0 % is perfect). List prices are each provider's own price list as researched for job BD, not a bill; dollar prices are shown at an assumed Rs {USD_INR:.0f} to the dollar.",
        "",
        "## Speech to text, overall",
        "",
        table(summary, samples),
        "",
        "## Speech to text, by language (word error / character error, median time)",
        "",
        language_table(summary),
        "",
    ]
    if tts:
        lines += ["## Text to speech", "", tts, ""]
    lines += ["## Every file", ""]
    for r in summary.rows:
        truth = next((s.truth for s in samples if s.name == r.sample), None)
        lines += [
            f"### {r.engine} / {r.sample}",
            f"- word error: {'n/a' if r.wer is None else f'{100 * r.wer:.1f}%'}; character error: {'n/a' if r.cer is None else f'{100 * r.cer:.1f}%'}; request: {r.seconds:.1f} s; error: {r.error or 'none'}",
            f"- said:  {truth!r}",
            f"- heard: {r.text!r}",
            "",
        ]
    resolved.write_text("\n".join(lines), encoding="utf-8")
    return resolved


def product_words() -> list[str]:
    """The names of the demo's price-list items (else its item types), for keyterms. Quietly empty when the local stack is not up."""
    try:
        import operator_sql

        slug = "demo-synthetic-sme"
        tenant = f"(select id from public.tenants where slug = '{slug}')"
        names = operator_sql.sql(
            f"select name from public.price_list_items where tenant_id = {tenant}"
        ).splitlines()
        if not names:
            names = operator_sql.sql(
                f"select name from public.item_types where tenant_id = {tenant}"
            ).splitlines()
        return keyterms_from(names)
    except (
        Exception,
        pytest.fail.Exception,
    ):  # the operator helper reports a SQL failure the way a test does; a missing stack is not an error here
        return []


DEFAULT_DIR = "~/Desktop/voice-samples"
DEFAULT_REPORT = "~/Desktop/v2-overnight/voice-bakeoff.md"


def main(
    argv: list[str] | None = None,
    env: Mapping[str, str] | None = None,
    client: httpx.Client | None = None,
    keyterms: list[str] | None = None,
) -> int:
    env = os.environ if env is None else env
    folder_text = (env.get("DIR") or (argv[0] if argv else "") or DEFAULT_DIR).strip()
    try:
        samples = discover(Path(folder_text))
    except FolderError as exc:
        print(f"stt-bakeoff: {exc}. Nothing was run.", file=sys.stderr)
        return 2
    engines = engines_from(env, samples, client)
    if not engines:
        print(
            "stt-bakeoff: no engine to run. In this terminal enter a key hidden, e.g.  read -rs 'K?Sarvam key: ' && export SARVAM_API_KEY=$K  (also: BHASHINI_API_KEY + BHASHINI_ASR_SERVICE_ID, GOOGLE_API_KEY, AI4BHARAT_STT_URL), or put Chrome's results in <name>.txt next to each file. Nothing was run.",
            file=sys.stderr,
        )
        return 2
    seconds = [s for s in (audio_seconds(x.path) for x in samples) if s is not None]
    spend = estimated_spend_inr(engines, samples)
    limit = float(env.get("MAX_SPEND_INR", MAX_SPEND_INR_DEFAULT))
    print(
        f"stt-bakeoff: {len(samples)} files ({sum(seconds):.0f} s of audio), engines: {', '.join(e.name for e in engines)}; estimated cost of this run at list prices: about Rs {spend:.2f} (limit Rs {limit:.0f})."
    )
    if spend > limit and env.get("CONFIRM_SPEND") != "1":
        print(
            f"stt-bakeoff: the estimate is above Rs {limit:.0f}. Run again with fewer files, or CONFIRM_SPEND=1 if you accept it. Nothing was run.",
            file=sys.stderr,
        )
        return 2
    terms = product_words() if keyterms is None else keyterms
    summary = run(samples, engines, terms)
    print(table(summary, samples))
    tts_adapters = tts_adapters_from(env, client)
    tts_text = ""
    if tts_adapters:
        per_language = int(env.get("TTS_PER_LANGUAGE", "3"))
        tts_rows = run_tts(samples, tts_adapters, Path(folder_text), per_language)
        tts_text = tts_table(tts_rows, tts_adapters)
        print("\n" + tts_text)
    report = write_report(Path(env.get("REPORT") or DEFAULT_REPORT), summary, samples, tts_text)
    print(
        f"\nstt-bakeoff: the full report (what was said, what was heard) is in {report} - outside the repository."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
