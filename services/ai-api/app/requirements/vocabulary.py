"""The closed vocabularies of a requirement and the small synonym lists that support them.

PLACEHOLDERS for the family to replace (owner change F): the codes start from the silk-wholesale ICP template. The codes are
installed in the database too (`app.requirement_vocab`, migration 20261015090000); `tests/test_requirements_vocabulary.py`
fails when the two differ. A synonym list is what the value-in-span check (owner change D) accepts as "the quote says this":
a whole word or phrase, compared case-insensitively.
"""

from __future__ import annotations

import re

LINE_KEYS = ("saree_type", "fabric", "colour", "quantity")
ORDER_KEYS = ("budget", "deadline", "delivery_city", "payment_terms")
FIELD_KEYS = LINE_KEYS + ORDER_KEYS
CERTAINTIES = ("stated", "implied", "ambiguous")
STATES = ("proposed", "confirmed", "corrected", "rejected")
MAX_LINES = 5

# caps aligned with the quote engine's operational bounds (docs/plans/t009-quote-engine.md; owner change H)
MAX_QUANTITY = 10_000
MAX_UNIT_BUDGET_PAISE = 100_000_000
MAX_TOTAL_BUDGET_PAISE = 1_000_000_000
MAX_NET_DAYS = 180
MAX_CITY_CHARS = 60

VOCAB: dict[str, tuple[str, ...]] = {
    "saree_type": (
        "kanjivaram", "banarasi", "mysore_silk", "paithani", "dharmavaram_pattu", "patola", "chanderi", "other",
    ),
    "fabric": ("silk", "cotton_silk", "tussar", "organza", "georgette", "crepe", "cotton", "other"),
    "colour": (
        "red", "maroon", "pink", "orange", "yellow", "green", "blue", "navy", "purple", "black", "white",
        "cream", "gold", "silver", "brown", "grey", "other",
    ),
    "payment_terms": ("advance_full", "advance_partial", "net_days", "cash_on_delivery"),
}  # fmt: skip

# code -> the words or phrases a quote may use for it (lower case)
SYNONYMS: dict[str, dict[str, tuple[str, ...]]] = {
    "saree_type": {
        "kanjivaram": ("kanjivaram", "kanjeevaram", "kanjipuram", "kanchipuram", "kanchi"),
        "banarasi": ("banarasi", "banaras", "benarasi", "benaras", "varanasi"),
        "mysore_silk": ("mysore silk", "mysore", "mysuru"),
        "paithani": ("paithani",),
        "dharmavaram_pattu": ("dharmavaram pattu", "dharmavaram silk", "dharmavaram", "pattu"),
        "patola": ("patola", "patan patola"),
        "chanderi": ("chanderi",),
    },
    "fabric": {
        "silk": ("silk", "pure silk", "mulberry"),
        "cotton_silk": ("cotton silk", "silk cotton"),
        "tussar": ("tussar", "tasar", "tussah"),
        "organza": ("organza",),
        "georgette": ("georgette",),
        "crepe": ("crepe", "crape"),
        "cotton": ("cotton",),
    },
    "colour": {
        "red": ("red", "crimson", "scarlet", "laal", "lal"),
        "maroon": ("maroon", "wine", "burgundy"),
        "pink": ("pink", "rani", "gulabi", "magenta"),
        "orange": ("orange", "narangi", "saffron"),
        "yellow": ("yellow", "mustard", "haldi", "peela"),
        "green": ("green", "mehendi", "mehndi", "parrot", "bottle green", "hara"),
        "blue": ("blue", "royal blue", "peacock", "sky blue", "neela"),
        "navy": ("navy", "navy blue"),
        "purple": ("purple", "violet", "lavender", "mauve"),
        "black": ("black", "kaala", "kala"),
        "white": ("white", "safed"),
        "cream": ("cream", "ivory", "off white", "off-white"),
        "gold": ("gold", "golden"),
        "silver": ("silver",),
        "brown": ("brown", "chocolate", "coffee"),
        "grey": ("grey", "gray"),
    },
    "payment_terms": {
        "advance_full": ("advance", "upfront", "prepaid", "full payment"),
        "advance_partial": ("advance", "upfront", "deposit", "part payment"),
        "net_days": ("net", "credit", "days", "after delivery", "after receipt", "payment after"),
        "cash_on_delivery": ("cod", "cash on delivery", "pay on delivery", "payment on delivery"),
    },
}  # fmt: skip

_WORD = re.compile(r"[a-z0-9]+(?:[-'][a-z0-9]+)*")


def tokens(text: str) -> list[str]:
    return _WORD.findall(text.casefold())


def phrase_in(text: str, phrase: str) -> bool:
    """Is `phrase` in `text` as whole words (case-insensitive)?"""
    want = tokens(phrase)
    have = tokens(text)
    if not want:
        return False
    return any(have[i : i + len(want)] == want for i in range(len(have) - len(want) + 1))


def code_for(key: str, word_or_phrase: str) -> str | None:
    """A vocabulary code for a code or a synonym ('Kanchipuram' -> 'kanjivaram'), else None.

    A phrase that CONTAINS a synonym ('mehendi green saree') maps to the code of the longest synonym it contains;
    two codes with equally long matches are ambiguous and map to nothing.
    """
    cleaned = " ".join(tokens(word_or_phrase.replace("_", " ")))
    if not cleaned:
        return None
    for code in VOCAB.get(key, ()):
        if code != "other" and cleaned == code.replace("_", " "):
            return code
    best: dict[str, int] = {}
    for code, words in SYNONYMS.get(key, {}).items():
        for word in (code.replace("_", " "), *words):
            n = len(tokens(word))
            if phrase_in(cleaned, word):
                best[code] = max(best.get(code, 0), n)
    if not best:
        return None
    top = max(best.values())
    winners = [c for c, n in best.items() if n == top]
    return winners[0] if len(winners) == 1 else None


def supports(key: str, code: str, quote: str) -> bool:
    """Does the quote contain a word from the synonym list of `code` (or the code itself, spelled out)?"""
    if code == "other":
        return bool(tokens(quote))
    words = (code.replace("_", " "), *SYNONYMS.get(key, {}).get(code, ()))
    return any(phrase_in(quote, word) for word in words)
