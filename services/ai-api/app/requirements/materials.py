"""The requirement of a BUILDING-MATERIALS enquiry (job CN, ADR 0085, blueprint section 5.2): what the Requirement Analyst ("Site Measurer") proposes and what a person confirms.

A line (1 to 5) is one product the customer wants: its product type, thickness (mm), and ONE measure: an area (sq ft or sq m), or a length and a width (ft or m), or a quantity in the item's own unit (bags,
tonnes, pieces ...). The whole enquiry has an application (driveway, footpath ...), a site location, whether laying is needed, and the needed-by date, budget and payment terms the saree flow already has.

Everything here is deterministic and the same shape as the saree flow (normalise.py, span.py, policy.py, questions.py): the model points at WORDS, this code turns them into typed values (integer hundredths for
areas and lengths, whole millimetres), the value must be SUPPORTED by the quote, and a closed vocabulary is checked against the database's (`app.requirement_vocab`; a test keeps the two equal). A value the
analyst is not sure of is `ambiguous` or `implied` and goes to the owner as a question; nothing here calculates a price or a quantity of material (that is the quote engine's, from the confirmed values)."""

from __future__ import annotations

import re
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from app.requirements import span as saree_span
from app.requirements import vocabulary as V
from app.requirements.normalise import (
    Normalised,
    Refused,
    Value,
    _to_decimal,
    normalise_budget,
    normalise_deadline,
    normalise_payment,
    numbers_in,
)
from app.requirements.policy import ACCEPTED, Assessment, FieldView, Flag

PROFILE = "materials"
LINE_KEYS = ("product_type", "thickness", "area", "length", "width", "quantity")
ORDER_KEYS = ("application", "site_location", "laying", "deadline", "budget", "payment_terms")
ONLY_KEYS = ("product_type", "thickness", "area", "length", "width", "application", "site_location", "laying")
ALL_KEYS = LINE_KEYS + ORDER_KEYS
NEEDED_ORDER_KEYS = ("site_location", "laying")
QUESTION_ORDER = ("product_type", "area", "length", "width", "quantity", "thickness", "site_location", "laying", "application", "deadline", "budget", "payment_terms")
RANGE_KEYS = ("quantity", "area", "length", "width", "budget", "payment_terms")

MAX_AREA_X100 = 100_000_000
MAX_LENGTH_X100 = 10_000_000
MAX_SITE_CHARS = 120

VOCAB: dict[str, tuple[str, ...]] = {
    "application": ("driveway", "footpath", "parking", "industrial_yard", "garden", "road", "other"),
    "product_type": ("paver_block", "kerb_stone", "brick", "tile", "cement", "sand", "aggregate", "other"),
    "laying": ("yes", "no"),
}
SYNONYMS: dict[str, dict[str, tuple[str, ...]]] = {
    "application": {
        "driveway": ("driveway", "drive way", "car porch", "porch"),
        "footpath": ("footpath", "pathway", "walkway", "pavement", "sidewalk"),
        "parking": ("parking", "car park", "parking area", "parking lot"),
        "industrial_yard": ("industrial yard", "factory yard", "godown yard", "yard", "industrial"),
        "garden": ("garden", "lawn", "landscape", "landscaping", "terrace"),
        "road": ("road", "street", "lane", "colony road"),
    },
    "product_type": {
        "paver_block": ("paver block", "paver blocks", "paver", "pavers", "interlocking", "interlock", "interlocking block", "interlocking blocks", "cobble", "cobblestone", "cobbles"),
        "kerb_stone": ("kerb stone", "kerb stones", "kerbstone", "kerbstones", "kerb", "curb stone", "curb stones", "curb", "kerbs"),
        "brick": ("brick", "bricks", "red brick", "red bricks", "fly ash brick", "fly ash bricks", "wire cut brick"),
        "tile": ("tile", "tiles", "floor tile", "floor tiles", "paving tile", "paving tiles"),
        "cement": ("cement", "opc", "ppc", "portland cement"),
        "sand": ("sand", "river sand", "m sand", "msand", "manufactured sand", "plastering sand"),
        "aggregate": ("aggregate", "aggregates", "jelly", "gravel", "chips", "stone chips", "metal"),
    },
    "laying": {
        "yes": ("laying", "with laying", "laying needed", "laying also", "laying also needed", "supply and laying", "supply and fix", "supply and fixing", "installation", "labour included", "fixing"),
        "no": ("no laying", "without laying", "supply only", "material only", "only material", "laying not needed", "laying not required", "no labour", "we will lay", "own labour"),
    },
}

_UNIT_WORDS: dict[str, tuple[str, ...]] = {
    "bag": ("bag", "bags", "sack", "sacks"),
    "tonne": ("tonne", "tonnes", "ton", "tons", "mt"),
    "cft": ("cft", "cubic feet", "cubic foot"),
    "truckload": ("truckload", "truckloads", "truck load", "truck loads", "truck", "trucks", "lorry", "lorries", "load", "loads"),
    "box": ("box", "boxes", "carton", "cartons"),
    "piece": ("piece", "pieces", "pc", "pcs", "nos", "no", "number", "numbers"),
}


def code_for(key: str, raw: str) -> str | None:
    """A vocabulary code for a code or a synonym ('Interlocking blocks' -> 'paver_block'); the longest synonym wins, a tie is ambiguous and maps to nothing."""
    cleaned = " ".join(V.tokens(raw.replace("_", " ")))
    if not cleaned:
        return None
    for code in VOCAB.get(key, ()):
        if code != "other" and cleaned == code.replace("_", " "):
            return code
    best: dict[str, int] = {}
    for code, words in SYNONYMS.get(key, {}).items():
        for word in (code.replace("_", " "), *words):
            if V.phrase_in(cleaned, word):
                best[code] = max(best.get(code, 0), len(V.tokens(word)))
    if not best:
        return None
    top = max(best.values())
    winners = [c for c, n in best.items() if n == top]
    return winners[0] if len(winners) == 1 else None


def supports_code(key: str, code: str, quote: str) -> bool:
    if code == "other":
        return bool(V.tokens(quote))
    words = (code.replace("_", " "), *SYNONYMS.get(key, {}).get(code, ()))
    return any(V.phrase_in(quote, w) for w in words)


# ---------------------------------------------------------------------------------------------- numbers with units
_NUM = r"(?P<n>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
_AREA_UNITS = (
    r"(?P<u>sq\.?\s*feet|sq\.?\s*foot|sq\.?\s*ft\.?|sqft|sft|square\s+f(?:ee|oo)t|ft2|ft²|sq\.?\s*meters?|sq\.?\s*metres?|sq\.?\s*mtrs?\.?|sq\.?\s*m\b\.?|sqm|square\s+met(?:er|re)s?|m2|m²)"
)
_AREA = re.compile(rf"(?<![\w.]){_NUM}\s*{_AREA_UNITS}", re.IGNORECASE)
_AREA_RANGE = re.compile(rf"(?<![\w.]){_NUM}\s*(?:-|–|to)\s*(?P<n2>\d[\d,]*(?:\.\d+)?)\s*{_AREA_UNITS}", re.IGNORECASE)
_LENGTH = re.compile(rf"(?<![\w.]){_NUM}\s*(?P<u>feet|foot|ft\.?|metres?|meters?|mtrs?\.?|mtr|m\b\.?|')", re.IGNORECASE)
_THICKNESS = re.compile(rf"(?<![\w.]){_NUM}\s*(?P<u>millimet(?:er|re)s?|mm|cm|centimet(?:er|re)s?)", re.IGNORECASE)
_APPROX = re.compile(r"\b(?:about|around|approx(?:imately)?|nearly|roughly|almost|close to|upto|up to)\b|~", re.IGNORECASE)


def _hundredths(n: str) -> Decimal | None:
    d = _to_decimal(n)
    if d is None:
        return None
    return (d * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)


def _area_basis(unit: str) -> str:
    u = unit.casefold().replace(".", "").replace(" ", "")
    return "sq_m" if u in ("sqm", "sqmeter", "sqmeters", "sqmetre", "sqmetres", "sqmtr", "sqmtrs", "squaremeter", "squaremeters", "squaremetre", "squaremetres", "m2", "m²") else "sq_ft"


def normalise_area(raw: str) -> Normalised:
    certainty = "implied" if _APPROX.search(raw) else "stated"
    match = _AREA_RANGE.search(raw)
    if match is not None:
        certainty = "ambiguous"  # a range keeps its lower bound and goes to a person
    else:
        match = _AREA.search(raw)
    if match is None:
        raise Refused("unparsed")
    value = _hundredths(match.group("n"))
    if value is None or value < 1:
        raise Refused("under_floor")
    if value > MAX_AREA_X100:
        raise Refused("over_cap")
    return Normalised(Value(int_value=int(value), basis=_area_basis(match.group("u"))), certainty)


def normalise_length(raw: str) -> Normalised:
    certainty = "implied" if _APPROX.search(raw) else "stated"
    match = _LENGTH.search(raw)
    if match is None:
        raise Refused("unparsed")
    value = _hundredths(match.group("n"))
    if value is None or value < 1:
        raise Refused("under_floor")
    if value > MAX_LENGTH_X100:
        raise Refused("over_cap")
    unit = match.group("u").casefold()
    basis = "ft" if unit.startswith(("f", "'")) else "m"
    return Normalised(Value(int_value=int(value), basis=basis), certainty)


def normalise_thickness(raw: str) -> Normalised:
    certainty = "implied" if _APPROX.search(raw) else "stated"
    match = _THICKNESS.search(raw)
    if match is None:
        raise Refused("unparsed")
    d = _to_decimal(match.group("n"))
    if d is None:
        raise Refused("unparsed")
    if match.group("u").casefold().startswith("c"):
        d *= 10
    if d != d.to_integral_value():
        raise Refused("unparsed")
    mm = int(d)
    if mm < 10:
        raise Refused("under_floor")
    if mm > 300:
        raise Refused("over_cap")
    return Normalised(Value(int_value=mm, basis="mm"), certainty)


_QTY = re.compile(rf"(?<![\w.]){_NUM}(?:\s*(?P<s>k|thousand|lakhs?|lacs?)\b)?", re.IGNORECASE)
_SUFFIX = {"k": 1000, "thousand": 1000}


def normalise_quantity(raw: str) -> Normalised:
    """A quantity in the item's own unit: '120 bags', '5 tonne', '2 truck loads', '50 kerb stones' (no unit word = pieces, and a person confirms)."""
    certainty = "implied" if _APPROX.search(raw) else "stated"
    match = _QTY.search(raw)
    if match is None:
        raise Refused("unparsed")
    d = _to_decimal(match.group("n"))
    if d is None:
        raise Refused("unparsed")
    suffix = (match.group("s") or "").casefold()
    if suffix:
        d *= _SUFFIX.get(suffix, 100_000 if suffix.startswith(("lakh", "lac")) else 1)
    if d != d.to_integral_value():
        raise Refused("unparsed")
    n = int(d)
    if n < 1:
        raise Refused("under_floor")
    if n > V.MAX_QUANTITY:
        raise Refused("over_cap")
    tokens = V.tokens(raw[match.end() :])
    basis = None
    for unit, words in _UNIT_WORDS.items():
        if any(V.phrase_in(" ".join(tokens[:4]), w) for w in words):
            basis = unit
            break
    if basis is None:
        basis, certainty = "piece", ("implied" if certainty == "stated" else certainty)
    return Normalised(Value(int_value=n, basis=basis), certainty)


def _site_chars_ok(text: str) -> bool:
    import unicodedata

    return all(unicodedata.category(c)[0] in "LMN" or c in " .,'-/" for c in text) and bool(text) and unicodedata.category(text[0]).startswith(("L", "N"))


def normalise_site(raw: str) -> Normalised:
    if any(c in raw for c in "\r\n\t"):
        raise Refused("not_a_place")
    text = " ".join(raw.split()).strip(" .,;:-")
    if not text or len(text) > MAX_SITE_CHARS or not _site_chars_ok(text):
        raise Refused("not_a_place")
    return Normalised(Value(text=text), "stated")


def normalise_code(key: str, raw: str) -> Normalised:
    code = code_for(key, raw)
    if code is not None:
        return Normalised(Value(code=code), "stated")
    if key == "laying":
        raise Refused("unparsed")  # a yes or a no is never invented
    if not V.tokens(raw):
        raise Refused("unparsed")
    return Normalised(Value(code="other"), "implied")


def normalise_material(key: str, text: str, received_at: datetime) -> Normalised:
    text = text.strip()
    if not text or len(text) > 120:
        raise Refused("unparsed")
    if key == "area":
        return normalise_area(text)
    if key in ("length", "width"):
        return normalise_length(text)
    if key == "thickness":
        return normalise_thickness(text)
    if key == "quantity":
        return normalise_quantity(text)
    if key == "site_location":
        return normalise_site(text)
    if key in ("application", "product_type", "laying"):
        return normalise_code(key, text)
    if key == "budget":
        return normalise_budget(text)
    if key == "deadline":
        return normalise_deadline(text, received_at)
    if key == "payment_terms":
        return normalise_payment(text)
    raise Refused("unknown_field")


def supports(key: str, value: Value, quote: str, received_at: datetime) -> bool:
    """Does the quote SUPPORT the typed value? A number must be one the quote states; a vocabulary value needs a word of its synonym list; a place must appear in the quote."""
    if key in ("area", "length", "width"):
        return value.int_value is not None and Decimal(value.int_value) / 100 in numbers_in(quote)
    if key == "thickness":
        return value.int_value is not None and (Decimal(value.int_value) in numbers_in(quote) or Decimal(value.int_value) / 10 in numbers_in(quote))
    if key == "quantity":
        return value.int_value is not None and Decimal(value.int_value) in numbers_in(quote)
    if key in ("application", "product_type", "laying"):
        return value.code is not None and supports_code(key, value.code, quote)
    if key == "site_location":
        return bool(value.text) and V.phrase_in(quote, value.text or "")
    return saree_span.supports(key, value, quote, received_at)  # budget, deadline and payment terms: the same rules as the saree flow


# ---------------------------------------------------------------------------------------------- wording
LABELS = {
    "paver_block": "paver block", "kerb_stone": "kerb stone", "brick": "brick", "tile": "tile", "cement": "cement", "sand": "sand", "aggregate": "aggregate", "other": "other",
    "driveway": "driveway", "footpath": "footpath", "parking": "parking", "industrial_yard": "industrial yard", "garden": "garden", "road": "road",
}  # fmt: skip
FIELD_NAMES = {
    "product_type": "product", "thickness": "thickness", "area": "area", "length": "length", "width": "width", "quantity": "quantity", "application": "use of the material",
    "site_location": "site location", "laying": "laying", "deadline": "needed-by date", "budget": "budget", "payment_terms": "payment terms",
}  # fmt: skip
_UNIT = {"sq_ft": "sq ft", "sq_m": "sq m", "ft": "ft", "m": "m", "mm": "mm"}
_QTY_UNIT = {"piece": "piece", "bag": "bag", "tonne": "tonne", "cft": "cft", "truckload": "truckload", "box": "box", "set": "set"}


def _group(n: int) -> str:
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts: list[str] = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join([*parts, tail])


def _hundredths_text(x100: int) -> str:
    whole, rest = divmod(x100, 100)
    return _group(whole) + (f".{rest:02d}".rstrip("0") if rest else "")


def display(key: str, value: Value) -> str:
    if key in ("area", "length", "width") and value.int_value is not None:
        return f"{_hundredths_text(value.int_value)} {_UNIT.get(value.basis or '', '')}".strip()
    if key == "thickness" and value.int_value is not None:
        return f"{value.int_value} mm"
    if key == "quantity" and value.int_value is not None:
        unit = _QTY_UNIT.get(value.basis or "piece", "piece")
        return f"{value.int_value} {unit}{'' if value.int_value == 1 else 's'}"
    if key in ("product_type", "application") and value.code is not None:
        return LABELS.get(value.code, value.code.replace("_", " "))
    if key == "laying" and value.code is not None:
        return "Laying needed" if value.code == "yes" else "No laying"
    if key == "site_location":
        return value.text or ""
    return ""


# ---------------------------------------------------------------------------------------------- what is missing, what is doubtful, and when a requirement may be confirmed
def _slot(fields: list[FieldView], key: str, line: int | None) -> FieldView | None:
    return next((f for f in fields if f.live and f.key == key and f.line == line), None)


def _accepted(fields: list[FieldView], key: str, line: int | None) -> bool:
    f = _slot(fields, key, line)
    return f is not None and f.state in ACCEPTED


def _measure_ok(fields: list[FieldView], line: int) -> bool:
    return _accepted(fields, "area", line) or _accepted(fields, "quantity", line) or (_accepted(fields, "length", line) and _accepted(fields, "width", line))


def assess(fields: list[FieldView]) -> Assessment:
    """confirmable: one line whose product type AND measure a person confirmed or corrected. ready_for_quote: every line has both, and the site location and laying are settled too. Nothing here is a model's."""
    live = [f for f in fields if f.live]
    lines = tuple(sorted({f.line for f in live if f.line is not None}))
    flags: list[Flag] = []
    for line in lines or (1,):
        if _slot(live, "product_type", line) is None:
            flags.append(Flag("missing", "product_type", line))
        has = {k: _slot(live, k, line) is not None for k in ("area", "length", "width", "quantity")}
        if not (has["area"] or has["quantity"] or (has["length"] and has["width"])):
            key = "width" if has["length"] else "length" if has["width"] else "area"
            flags.append(Flag("missing", key, line))
    for key in NEEDED_ORDER_KEYS:
        if _slot(live, key, None) is None:
            flags.append(Flag("missing", key, None))
    for f in live:
        if f.state in ACCEPTED:
            continue
        if f.conflict:
            flags.append(Flag("conflicting", f.key, f.line))
        elif f.certainty in ("implied", "ambiguous"):
            flags.append(Flag("low_certainty", f.key, f.line))
    confirmable = any(_accepted(live, "product_type", n) and _measure_ok(live, n) for n in lines)
    ready = confirmable and all(_accepted(live, "product_type", n) and _measure_ok(live, n) for n in lines) and all(_accepted(live, k, None) for k in NEEDED_ORDER_KEYS)
    order = {k: i for i, k in enumerate(QUESTION_ORDER)}
    kind_order = {"conflicting": 0, "missing": 1, "low_certainty": 2}
    flags.sort(key=lambda f: (kind_order[f.kind], f.line if f.line is not None else 99, order.get(f.key, 99)))
    return Assessment(confirmable, ready, tuple(flags), lines)


def _item(line: int | None, multi: bool) -> str:
    return f" for item {line}" if multi and line is not None else ""


def render_question(flag: Flag, fields: list[FieldView], multi: bool) -> tuple[str, str]:
    """(code, text) of the clarifying question for a flag: a closed template that echoes only closed labels and whole numbers, never the customer's words."""
    key, line = flag.key, flag.line
    item = _item(line, multi)
    field = next((f for f in fields if f.live and f.key == key and f.line == line), None)
    if flag.kind == "conflicting":
        return f"conflicting_{key}", f"Your message gives more than one {FIELD_NAMES[key]}{item}. Which one should we use?"
    if flag.kind == "missing":
        text = {
            "product_type": f"Which product would you like{item}? For example paver blocks, kerb stones, bricks, tiles, cement, sand or aggregate.",
            "area": f"What area do you need to cover{item}, in sq ft or sq m? Or tell us the length and the width.",
            "length": f"What is the length of the area{item}, in feet or metres?",
            "width": f"What is the width of the area{item}, in feet or metres?",
            "site_location": "Where should we deliver? The site location or its PIN code.",
            "laying": "Do you also need laying? Please answer yes or no.",
        }[key]
        return f"missing_{key}", text
    value = field.value if field is not None else Value()
    certainty = field.certainty if field is not None else "ambiguous"
    if key == "area" and value.int_value is not None and certainty == "implied":
        text = f"Just to confirm: is the area about {display('area', value)}{item}?"
    elif key == "product_type" and value.code in LABELS:
        text = f"Just to confirm: is it {LABELS[value.code]}{item}?"
    elif key == "thickness" and value.int_value is not None:
        text = f"Just to confirm: do you need {value.int_value} mm thickness{item}?"
    elif key == "deadline" and value.date_value is not None and certainty == "implied":
        text = f"Just to confirm: do you need it by {value.date_value.day} {_MONTHS[value.date_value.month - 1]} {value.date_value.year}?"
    elif key == "laying":
        text = "Could you confirm whether you need laying, yes or no?"
    else:
        text = f"Could you confirm the {FIELD_NAMES[key]}{item}?"
    return f"confirm_{key}", text


_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
