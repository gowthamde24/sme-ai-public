"""An order in a file (a purchase order, a customer's list of items and quantities) -> what is short, against the catalogue (job assistant-does-the-work A2b part 4; owner, 5 Nov 2026: "order PDF ->
order + shortage").

READ-ONLY and all code: the order's table is found by its header (an item column and a quantity column), each row is matched to a catalogue item by its name (no guessing), and the answer says,
per line, what the catalogue says about its stock: in stock, few left (check before you promise), made to order (not in stock), or not in the catalogue. The catalogue keeps a stock WORD, not a
count, so the answer never claims a number it does not have. The order itself is not made here: an order starts from an approved quote (its figures are the quote's), so the assistant says so."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.assistant_work.prices import norm
from app.assistant_work.understand import _ITEM_HEAD, _QTY_HEAD, Understanding

MAX_LINES = 30
_QTY = re.compile(r"^\s*(\d{1,6})\s*(?:pcs|pieces|nos|no\.?|units|sarees|sets)?\s*$", re.IGNORECASE)

WORDS = {
    "in_stock": {"en": "in stock", "te": "స్టాక్‌లో ఉంది", "hi": "स्टॉक में है", "kn": "ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇದೆ"},
    "few_left": {"en": "few left: check before you promise", "te": "కొన్నే ఉన్నాయి: మాట ఇచ్చే ముందు చూసుకోండి", "hi": "थोड़े ही बचे हैं: वादा करने से पहले देख लें", "kn": "ಕೆಲವೇ ಉಳಿದಿವೆ: ಮಾತು ಕೊಡುವ ಮೊದಲು ನೋಡಿ"},
    "made_to_order": {"en": "made to order: not in stock", "te": "ఆర్డర్ మీద తయారీ: స్టాక్‌లో లేదు", "hi": "ऑर्डर पर बनता है: स्टॉक में नहीं", "kn": "ಆರ್ಡರ್ ಮೇಲೆ ತಯಾರಿ: ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇಲ್ಲ"},
    "missing": {"en": "not in your catalogue", "te": "మీ కేటలాగ్‌లో లేదు", "hi": "आपके कैटलॉग में नहीं है", "kn": "ನಿಮ್ಮ ಕ್ಯಾಟಲಾಗ್‌ನಲ್ಲಿ ಇಲ್ಲ"},
}
HEAD = {
    "en": "Against your catalogue, the {n} lines of '{name}':",
    "te": "మీ కేటలాగ్‌తో పోల్చి, '{name}' లోని {n} లైన్లు:",
    "hi": "आपके कैटलॉग से मिलाकर, '{name}' की {n} पंक्तियाँ:",
    "kn": "ನಿಮ್ಮ ಕ್ಯಾಟಲಾಗ್‌ಗೆ ಹೋಲಿಸಿ, '{name}' ನ {n} ಸಾಲುಗಳು:",
}
SHORT = {
    "en": "{short} of them may be short.",
    "te": "వాటిలో {short} తక్కువ పడవచ్చు.",
    "hi": "इनमें से {short} कम पड़ सकती हैं।",
    "kn": "ಅವುಗಳಲ್ಲಿ {short} ಕಡಿಮೆ ಆಗಬಹುದು.",
}
NONE_SHORT = {"en": "Nothing looks short.", "te": "ఏదీ తక్కువ పడేలా లేదు.", "hi": "कुछ भी कम नहीं लगता।", "kn": "ಯಾವುದೂ ಕಡಿಮೆ ಆಗುವಂತಿಲ್ಲ."}


@dataclass(frozen=True)
class Line:
    name: str
    qty: int


def order_lines(u: Understanding) -> list[Line]:
    """The lines of the file's order table: (the item's name as written, the quantity). The first table with an item column and a quantity column."""
    for table in u.tables:
        if len(table) < 2:
            continue
        header = table[0]
        qty_col = next((i for i, h in enumerate(header) if _QTY_HEAD.search(h or "")), None)
        item_col = next((i for i, h in enumerate(header) if _ITEM_HEAD.search(h or "") and i != qty_col), None)
        if qty_col is None or item_col is None:
            continue
        lines = []
        for r in table[1:]:
            if max(item_col, qty_col) >= len(r):
                continue
            m = _QTY.match(r[qty_col])
            if m and r[item_col].strip() and int(m.group(1)) > 0:
                lines.append(Line(r[item_col].strip()[:200], int(m.group(1))))
        if lines:
            return lines[:MAX_LINES]
    return []


def check(lines: list[Line], items: list[dict[str, Any]], file_name: str, language: str) -> tuple[str, int]:
    """(the answer, how many lines may be short). Every word of it is the catalogue's or the file's."""
    by_name: dict[str, dict[str, Any]] = {}
    for item in items:
        by_name.setdefault(norm(str(item.get("name") or "")), item)
    out = [HEAD.get(language, HEAD["en"]).format(n=len(lines), name=file_name)]
    short = 0
    for line in lines:
        found = by_name.get(norm(line.name))
        state = str(found.get("stock_status") or "") if found is not None else "missing"
        state = state if state in WORDS else "missing"
        short += state != "in_stock"
        out.append(f"• {line.name} × {line.qty}: {WORDS[state].get(language, WORDS[state]['en'])}")
    out.append((SHORT.get(language, SHORT["en"]).format(short=short)) if short else NONE_SHORT.get(language, NONE_SHORT["en"]))
    return "\n".join(out), short
