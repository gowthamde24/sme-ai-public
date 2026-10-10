"""JOB AK / K3: `make stt-bakeoff DIR=~/Desktop/voice-samples`. Which speech-to-text engine hears Telugu / Kannada / Hindi shop talk best, MEASURED on the owner's own voice samples. OPT-IN: never in
`make check`. No database is needed (the product words for the keyterms are read from the demo's price list when the local stack is up, and skipped quietly when it is not).

The folder is OUTSIDE the repository (the command refuses a folder inside it), is only read, and the report is written INTO the folder, never into the repository: what people said never
enters version control. For each `<name>.wav` or `<name>.m4a` the folder may hold

    <name>.truth.txt   what was really said (the reference the word error rate is computed against)
    <name>.txt         what Chrome's speech recognition produced for it (recorded as a third engine, nothing is sent anywhere for it)

Engines: Sarvam Saaras (needs SARVAM_API_KEY), Bhashini (needs BHASHINI_API_KEY and BHASHINI_ASR_SERVICE_ID from the owner's Bhashini account), and Chrome (the .txt files). Keys come only from
the environment. Word error rate = (substitutions + deletions + insertions) / words in the reference, on lower-cased words with punctuation removed; 0 % is perfect, 100 % or more is useless.
The product words (names of the price list's items) are sent as Saaras `keyterms` (at most 50, each at most 64 characters) to bias recognition toward the shop's own vocabulary."""

# ruff: noqa: E501, S608

from __future__ import annotations

import base64
import json
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

ROOT = Path(__file__).resolve().parents[2]
AUDIO_SUFFIXES = (".wav", ".m4a")
MAX_FILES = 40
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
SARVAM_URL = "https://api.sarvam.ai/speech-to-text"
BHASHINI_URL = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline"
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
class Engine(Protocol):
    name: str

    def transcribe(self, sample: Sample, keyterms: list[str]) -> str: ...


class EngineError(Exception):
    """A constant code: no provider text, no key, no URL."""


class Sarvam:
    name = "Sarvam Saaras"

    def __init__(
        self,
        key: str,
        model: str = "saaras:v4",
        language: str = "unknown",
        client: httpx.Client | None = None,
    ) -> None:
        self._key, self._model, self._language = key, model, language
        self._client = client or httpx.Client(timeout=120.0)

    def __repr__(self) -> str:
        return f"Sarvam(model={self._model})"

    def transcribe(self, sample: Sample, keyterms: list[str]) -> str:
        data: dict[str, str] = {"model": self._model, "language_code": self._language}
        if keyterms and self._model == "saaras:v4":  # keyterms are supported only by v4
            data["keyterms"] = json.dumps(keyterms, ensure_ascii=False)
        try:
            with sample.path.open("rb") as handle:
                response = self._client.post(
                    SARVAM_URL,
                    headers={"api-subscription-key": self._key},
                    data=data,
                    files={"file": (sample.path.name, handle)},
                )
        except httpx.TimeoutException:
            raise EngineError("timeout") from None
        except httpx.HTTPError as exc:
            raise EngineError(f"unreachable:{exc.__class__.__name__}") from None
        if not response.is_success:
            raise EngineError(f"http_{response.status_code}")
        try:
            transcript = response.json().get("transcript")
        except (ValueError, AttributeError):
            raise EngineError("bad_response") from None
        if not isinstance(transcript, str):
            raise EngineError("bad_response")
        return transcript


class Bhashini:
    name = "Bhashini"

    def __init__(
        self, key: str, service_id: str, language: str = "te", client: httpx.Client | None = None
    ) -> None:
        self._key, self._service, self._language = key, service_id, language.split("-")[0].lower()
        self._client = client or httpx.Client(timeout=120.0)

    def __repr__(self) -> str:
        return f"Bhashini(service={self._service})"

    def transcribe(
        self, sample: Sample, keyterms: list[str]
    ) -> str:  # keyterms are not part of this API
        audio = base64.b64encode(sample.path.read_bytes()).decode("ascii")
        body = {
            "pipelineTasks": [
                {
                    "taskType": "asr",
                    "config": {
                        "language": {"sourceLanguage": self._language},
                        "serviceId": self._service,
                        "audioFormat": sample.path.suffix.lstrip(".").lower(),
                        "samplingRate": 16000,
                    },
                }
            ],
            "inputData": {"audio": [{"audioContent": audio}]},
        }
        try:
            response = self._client.post(
                BHASHINI_URL,
                headers={"Authorization": self._key, "Content-Type": "application/json"},
                json=body,
            )
        except httpx.TimeoutException:
            raise EngineError("timeout") from None
        except httpx.HTTPError as exc:
            raise EngineError(f"unreachable:{exc.__class__.__name__}") from None
        if not response.is_success:
            raise EngineError(f"http_{response.status_code}")
        try:
            transcript = response.json()["pipelineResponse"][0]["output"][0]["source"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise EngineError("bad_response") from None
        if not isinstance(transcript, str):
            raise EngineError("bad_response")
        return transcript


class Chrome:
    """Chrome's speech recognition, recorded by the owner into `<name>.txt`: nothing is sent anywhere for this engine."""

    name = "Chrome"

    def transcribe(self, sample: Sample, keyterms: list[str]) -> str:
        if sample.chrome is None:
            raise EngineError("no_file")
        return sample.chrome


def engines_from(
    env: Mapping[str, str], samples: list[Sample], client: httpx.Client | None = None
) -> list[Engine]:
    language = env.get("STT_LANGUAGE", "").strip()
    found: list[Engine] = []
    if env.get("SARVAM_API_KEY", "").strip():
        found.append(
            Sarvam(
                env["SARVAM_API_KEY"].strip(),
                env.get("SARVAM_STT_MODEL", "saaras:v4").strip() or "saaras:v4",
                language or "unknown",
                client,
            )
        )
    if env.get("BHASHINI_API_KEY", "").strip() and env.get("BHASHINI_ASR_SERVICE_ID", "").strip():
        found.append(
            Bhashini(
                env["BHASHINI_API_KEY"].strip(),
                env["BHASHINI_ASR_SERVICE_ID"].strip(),
                language or "te",
                client,
            )
        )
    if any(s.chrome is not None for s in samples):
        found.append(Chrome())
    return found


# ============================================================================ running and reporting
@dataclass
class Row:
    engine: str
    sample: str
    text: str | None = None
    error: str | None = None
    seconds: float = 0.0
    wer: float | None = None


@dataclass
class Summary:
    rows: list[Row] = field(default_factory=list)

    def engines(self) -> list[str]:
        return list(dict.fromkeys(r.engine for r in self.rows))

    def mean_wer(self, engine: str) -> str:
        values = [r.wer for r in self.rows if r.engine == engine and r.wer is not None]
        return f"{100 * sum(values) / len(values):.1f}%" if values else "n/a"

    def median_seconds(self, engine: str) -> str:
        times = [
            r.seconds
            for r in self.rows
            if r.engine == engine and r.text is not None and engine != "Chrome"
        ]
        return f"{statistics.median(times):.1f} s" if times else "n/a"

    def failed(self, engine: str) -> int:
        return sum(1 for r in self.rows if r.engine == engine and r.error not in (None, "no_file"))


def run(samples: list[Sample], engines: list[Engine], keyterms: list[str]) -> Summary:
    summary = Summary()
    for sample in samples:
        for engine in engines:
            row = Row(engine.name, sample.name)
            started = time.perf_counter()
            try:
                row.text = engine.transcribe(sample, keyterms)
            except EngineError as exc:
                row.error = str(exc)
            row.seconds = time.perf_counter() - started
            if row.text is not None and sample.truth is not None:
                row.wer = wer(sample.truth, row.text)
            summary.rows.append(row)
    return summary


def table(summary: Summary, samples: list[Sample]) -> str:
    engines = summary.engines()
    lines = [
        "| engine | files | with a reference | mean word error rate | median time | failed |",
        "|---|---|---|---|---|---|",
    ]
    for e in engines:
        mine = [r for r in summary.rows if r.engine == e and r.text is not None]
        lines.append(
            f"| {e} | {len(mine)}/{len(samples)} | {sum(r.wer is not None for r in mine)} | {summary.mean_wer(e)} | {summary.median_seconds(e)} | {summary.failed(e)} |"
        )
    per_file = ["", "| file | " + " | ".join(engines) + " |", "|---|" + "---|" * len(engines)]
    for s in samples:
        cells = []
        for e in engines:
            r = next((x for x in summary.rows if x.engine == e and x.sample == s.name), None)
            cells.append(
                "n/a"
                if r is None or r.text is None
                else (f"{100 * r.wer:.0f}%" if r.wer is not None else "no reference")
            )
        per_file.append(f"| {s.name} | " + " | ".join(cells) + " |")
    return "\n".join([*lines, *per_file])


def write_report(folder: Path, summary: Summary, samples: list[Sample]) -> Path:
    path = folder.expanduser().resolve() / "stt-bakeoff-report.md"
    lines = ["# Speech-to-text bake-off", "", table(summary, samples), ""]
    for r in summary.rows:
        truth = next((s.truth for s in samples if s.name == r.sample), None)
        lines += [
            f"## {r.engine} / {r.sample}",
            f"- WER: {'n/a' if r.wer is None else f'{100 * r.wer:.1f}%'}; error: {r.error or 'none'}",
            f"- said:      {truth!r}",
            f"- heard:     {r.text!r}",
            "",
        ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


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


def main(
    argv: list[str] | None = None,
    env: Mapping[str, str] | None = None,
    client: httpx.Client | None = None,
    keyterms: list[str] | None = None,
) -> int:
    env = os.environ if env is None else env
    folder_text = (env.get("DIR") or (argv[0] if argv else "")).strip()
    if not folder_text:
        print(
            "stt-bakeoff: give the folder of voice samples (outside the repository): make stt-bakeoff DIR=~/Desktop/voice-samples. Nothing was run.",
            file=sys.stderr,
        )
        return 2
    try:
        samples = discover(Path(folder_text))
    except FolderError as exc:
        print(f"stt-bakeoff: {exc}. Nothing was run.", file=sys.stderr)
        return 2
    engines = engines_from(env, samples, client)
    if not engines:
        print(
            "stt-bakeoff: no engine to run. In this terminal run  export SARVAM_API_KEY='<your key>'  (and, for Bhashini, BHASHINI_API_KEY and BHASHINI_ASR_SERVICE_ID), or put Chrome's results in <name>.txt next to each file. Nothing was run.",
            file=sys.stderr,
        )
        return 2
    terms = product_words() if keyterms is None else keyterms
    seconds = [s for s in (wav_seconds(x.path) for x in samples) if s is not None]
    print(
        f"stt-bakeoff: {len(samples)} files ({sum(seconds):.0f} s of .wav audio), engines: {', '.join(e.name for e in engines)}, {len(terms)} product words as keyterms."
    )
    summary = run(samples, engines, terms)
    print(table(summary, samples))
    report = write_report(Path(folder_text), summary, samples)
    print(
        f"\nstt-bakeoff: the full report (what was said, what was heard) is in {report} - outside the repository."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
