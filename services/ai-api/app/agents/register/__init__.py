"""How the assistant TALKS (job DS, owner feedback 26 Oct 2026): everyday spoken language with the English words people really use, not the written (bookish) register. This module is pure: it holds

  * the speaking styles and regions (data/register.json),
  * the owner's example lines per language (data/native_lines/<lang>.md: Telugu is APPROVED by the owner; the others are drafts for a native reader, except Kannada: approved 30 Oct 2026, data/anchors/kn.json),
  * `register_block(language, style, region)`: the block that goes into every call-turn / WhatsApp-reply prompt (rules + few-shot examples),
  * `formal_forms_in(language, text)`: the written forms a spoken line should not contain (used by the model comparison).

Nothing here reads the network, a key or the database."""

from __future__ import annotations

import json
import re
import unicodedata
from functools import cache, lru_cache
from pathlib import Path
from typing import Any

from app.agents.register.address import address_rule

HERE = Path(__file__).resolve().parent
LANGUAGES: tuple[str, ...] = ("en", "te", "hi", "kn", "ta", "ml", "mr")
EXAMPLES_PER_BLOCK = 7   # keeps the block short: a prompt is paid for by the token


@lru_cache(maxsize=1)
def data() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((HERE / "data" / "register.json").read_text(encoding="utf-8"))
    return loaded


STYLES: tuple[str, ...] = tuple(data()["styles"])
DEFAULT_STYLE: str = data()["default_style"]
REGIONS: dict[str, tuple[str, ...]] = {lang: tuple(v) for lang, v in data()["regions"].items()}
# the data files per language, by a FIXED name: a language that is not one of ours never reaches a path (a request's value is only ever a key into this map)
_ANCHOR_FILES: dict[str, Path] = {lang: HERE / "data" / "anchors" / f"{lang}.json" for lang in LANGUAGES}
_LINE_FILES: dict[str, Path] = {lang: HERE / "data" / "native_lines" / f"{lang}.md" for lang in LANGUAGES}
NUMBERED = re.compile(r"^\s*(\d+)\.\s+([^:]{1,40}):\s*(.+?)\s*$")
BULLET = re.compile(r"^\s*-\s+(.+?)\s*$")


@cache
def anchors(language: str) -> tuple[tuple[str, str], ...]:
    """The lines a native reviewer heard and approved (data/anchors/<lang>.json), as (label, text). They are the style anchors of the prompt and the cases of the language's eval; none = the language has no reviewed set."""
    path = _ANCHOR_FILES.get(language)
    if path is None or not path.is_file():
        return ()
    doc = json.loads(path.read_text(encoding="utf-8"))
    return tuple((str(a["label"]), str(a["text"])) for a in doc["anchors"])


@cache
def examples(language: str) -> tuple[tuple[str, str], ...]:
    """The example lines of a language as (label, text), in the file's order. A missing file gives no examples (the rules alone are used and the block says so)."""
    path = _LINE_FILES.get(language)
    if path is None or not path.is_file():
        return ()
    out: list[tuple[str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        numbered = NUMBERED.match(raw)
        if numbered and numbered.group(2).strip() != "Often used":
            out.append((numbered.group(2).strip(), numbered.group(3)))
            continue
        bullet = BULLET.match(raw)
        if bullet:
            out.append(("Often used", bullet.group(1)))
    return tuple(out)


def status(language: str) -> str:
    """`approved` (the owner read it) or `draft` (waits for a native reader)."""
    return str(data()["status"].get(language, "draft"))


def valid_choice(language: str, style: str, region: str) -> bool:
    return language in LANGUAGES and style in STYLES and region in REGIONS.get(language, ())


def register_block(language: str, style: str = DEFAULT_STYLE, region: str = "neutral") -> str:
    """The register block of a prompt: how to talk in `language`, with the owner's own lines as examples. English instructions (the model reads them best), the examples in the language."""
    if language not in LANGUAGES:
        raise ValueError("unknown language")
    if not valid_choice(language, style, region):
        style, region = (style if style in STYLES else DEFAULT_STYLE), "neutral"
    d = data()
    lines = ["HOW TO TALK (register):", *[f"- {rule}" for rule in d["common"][style]]]
    if style != "formal":
        lines += [f"- {rule}" for rule in d["language_rules"].get(language, [])]
        hint = d.get("regions_hint", {}).get(language, {}).get(region)
        if hint:
            lines.append(f"- {hint}")
    shots = anchors(language) or examples(language)   # a language with a reviewed set is taught from exactly those lines
    if shots and style != "formal":
        lines.append("Examples of how the owner's own people talk (copy the register, not the facts):")
        lines += [f"  * {text}" for _, text in _spread(shots, EXAMPLES_PER_BLOCK)]
        if status(language) != "approved":
            lines.append("(These examples are drafts for native review.)")
    lines.append(f"- {address_rule(language)}")
    return "\n".join(lines)


def _spread(items: tuple[tuple[str, str], ...], count: int) -> list[tuple[str, str]]:
    """`count` items spread over the whole list (the first lines are openings; the later ones are replies), in order."""
    if len(items) <= count:
        return list(items)
    step = len(items) / count
    return [items[int(i * step)] for i in range(count)]


def formal_forms_in(language: str, text: str) -> list[str]:
    """The written (formal) forms from the small list that a spoken line contains. Empty = it passes."""
    return [form for form in data()["formal_forms"].get(language, []) if form in text]


@lru_cache(maxsize=1)
def _bookish() -> dict[str, tuple[tuple[str, str, str], ...]]:
    """The written words a spoken call should not use (data/bookish.json): per language, (bookish stem, what people say, status)."""
    doc = json.loads((HERE / "data" / "bookish.json").read_text(encoding="utf-8"))
    return {lang: tuple((str(w["bookish"]), str(w["say"]), str(w["status"])) for w in words) for lang, words in doc.items() if lang != "$comment"}


def bookish_list(language: str) -> tuple[tuple[str, str, str], ...]:
    return _bookish().get(language, ())


def _plain_line(text: str) -> str:
    return unicodedata.normalize("NFC", text).replace("\u200c", "").replace("\u200d", "")


def bookish_in(language: str, text: str) -> list[str]:
    """The bookish words (stems from the list) found in a spoken line, in list order, each once. Empty = it passes. Only COUNTS: nothing is swapped."""
    line = _plain_line(text)
    return [stem for stem, _, _ in bookish_list(language) if _plain_line(stem) in line]


def bookish_rules(language: str, limit: int = 12) -> str:
    """The 'avoid -> say' lines for a prompt (English instruction, the words in the language); empty when the language has no list."""
    pairs = [f"{stem} -> {say}" for stem, say, _ in bookish_list(language)][:limit]
    return "Written words to AVOID in speech, and what people say instead: " + "; ".join(pairs) + "." if pairs else ""
