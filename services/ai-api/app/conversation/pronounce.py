"""Say it right (job natural-voice, owner decision of 28 Oct 2026): words a voice gets wrong ("Kannada" came out as "Canada" for every voice) are RESPELLED before the text reaches the engine, and rupee amounts are written the way a person says them. Engine-independent text, so Cartesia and the Bulbul fallback both
get it; the subtitles and the chat keep the real spelling.

  * `words` (data/pronunciations.json): Latin-script words only, whole words, any case, longest first. A workspace's own additions (its business and area names) come on top with `with_extra` and win over the base.
  * Money: "₹2,600", "Rs. 2,600", "INR 2600" become "two thousand six hundred rupees" in English (Indian grouping: "one lakh twenty thousand", "two crore"), and in the other languages the symbol becomes the word for rupees after the number. "1.5 lakh" is "one point five lakh rupees".

Pure text in, text out: no network, no key. Cartesia also offers a provider-side pronunciation dictionary (`pronunciation_dict_id`); this map does not need one and works for every engine."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "pronunciations.json"
RUPEES = {"en": "rupees", "te": "రూపాయలు", "hi": "रुपये", "kn": "ರೂಪಾಯಿ"}
_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_AMOUNT = r"(\d[\d,]*(?:\.\d+)?)"
_UNIT = r"(?:\s?(lakhs?|crores?|k)\b)?"
MONEY = re.compile(rf"(?:₹|\bRs\.?|\bINR)\s?{_AMOUNT}{_UNIT}|{_AMOUNT}{_UNIT}\s?(?:₹|rupees?\b)", re.IGNORECASE)


def _under_1000(n: int) -> str:
    out = []
    if n >= 100:
        out.append(f"{_ONES[n // 100]} hundred")
        n %= 100
    if n >= 20:
        out.append(_TENS[n // 10] + (f" {_ONES[n % 10]}" if n % 10 else ""))
    elif n or not out:
        out.append(_ONES[n])
    return " ".join(out)


def indian_words(n: int) -> str:
    """1,20,000 -> 'one lakh twenty thousand'; 25,00,00,000 -> 'twenty five crore'."""
    if n == 0:
        return "zero"
    parts = []
    crore, rest = divmod(n, 10_000_000)
    lakh, rest = divmod(rest, 100_000)
    thousand, rest = divmod(rest, 1000)
    for count, name in ((crore, "crore"), (lakh, "lakh"), (thousand, "thousand")):
        if count:
            parts.append(f"{indian_words(count) if count >= 1000 and name == 'crore' else _under_1000(count)} {name}")
    if rest:
        parts.append(_under_1000(rest))
    return " ".join(parts)


def _spoken_number(raw: str) -> str:
    clean = raw.replace(",", "")
    if "." in clean:
        whole, frac = clean.split(".", 1)
        return f"{indian_words(int(whole or '0'))} point {' '.join(_ONES[int(d)] for d in frac)}"
    return indian_words(int(clean))


def _money(match: re.Match[str], language: str) -> str:
    groups = [g for g in match.groups() if g is not None]
    amount, unit = groups[0], (groups[1].lower() if len(groups) > 1 else "")
    word = RUPEES.get(language, RUPEES["en"])
    unit = {"k": "thousand", "lakhs": "lakh", "crores": "crore"}.get(unit, unit)
    if language == "en":
        return f"{_spoken_number(amount)}{' ' + unit if unit else ''} {word}"
    return f"{amount}{' ' + unit if unit else ''} {word}"


class Pronunciations:
    def __init__(self, words: Mapping[str, str], engines: Mapping[str, Mapping[str, str]] | None = None) -> None:
        self._words = {k.lower(): v for k, v in words.items() if k.strip()}
        self._engines = {e: {k.lower(): v for k, v in m.items() if k.strip()} for e, m in (engines or {}).items()}
        self._patterns: dict[str | None, tuple[re.Pattern[str] | None, dict[str, str]]] = {}

    @property
    def words(self) -> dict[str, str]:
        return dict(self._words)

    def with_extra(self, extra: Mapping[str, str] | None) -> Pronunciations:
        """The base plus a workspace's own words; its extra wins over the base AND over any engine's own entry."""
        if not extra:
            return self
        add = {k.strip(): v for k, v in extra.items() if k.strip() and v.strip()}
        lowered = {k.lower() for k in add}
        return Pronunciations({**self._words, **add}, {e: {k: v for k, v in m.items() if k not in lowered} for e, m in self._engines.items()})

    def _for(self, engine: str | None) -> tuple[re.Pattern[str] | None, dict[str, str]]:
        if engine not in self._patterns:
            merged = {**self._words, **self._engines.get(engine or "", {})}
            keys = sorted(merged, key=len, reverse=True)
            pattern = re.compile(r"(?<![A-Za-z])(" + "|".join(re.escape(k) for k in keys) + r")(?![A-Za-z])", re.IGNORECASE) if keys else None
            self._patterns[engine] = (pattern, merged)
        return self._patterns[engine]

    def apply(self, text: str, language: str = "en", engine: str | None = None) -> str:
        """`engine` (cartesia | sarvam_v4) picks that engine's own entries over the common ones."""
        out = MONEY.sub(lambda m: _money(m, language), text)
        pattern, merged = self._for(engine)
        return pattern.sub(lambda m: merged[m.group(1).lower()], out) if pattern is not None else out


def load_words(path: str | Path | None = None) -> dict[str, str]:
    return _load(path)[0]


def _load(path: str | Path | None = None) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    data = json.loads(Path(path or DATA).read_text(encoding="utf-8"))
    words, engines = data.get("words"), data.get("engines", {})

    def ok(m: object) -> bool:
        return isinstance(m, dict) and all(isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip() for k, v in m.items())

    if not ok(words) or not isinstance(engines, dict) or not all(ok(m) for m in engines.values()):
        raise ValueError("pronunciations: 'words' and each engine's entries must map a word to its respelling")
    return dict(words), {e: dict(m) for e, m in engines.items()}


@lru_cache(maxsize=1)
def default_pronunciations() -> Pronunciations:
    words, engines = _load()
    return Pronunciations(words, engines)
