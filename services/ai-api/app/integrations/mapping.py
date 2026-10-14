"""Which column is which. A DETERMINISTIC suggestion (the same file gives the same answer, no model, no network) from the header text, in English, Telugu, Hindi, Kannada and Tamil. The person always sees
and can change the suggestion before anything is imported.

Header text is normalised (Unicode NFKC, lower case, zero-width joiners removed, punctuation to spaces). A column scores 3 for an exact synonym, 2 when a synonym is a whole word group inside the header,
1 when it shares a word with one. Fields and columns are paired greedily by score, then by the column order, each used at most once. A generic header 'name' becomes the company/party name when no other
column claims that field (a shop's customer list usually has one name column)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# field -> (label, required, synonyms)
CUSTOMER_FIELDS: dict[str, tuple[str, bool, tuple[str, ...]]] = {
    "company_name": ("Customer or shop name", True, (
        "company", "company name", "firm", "firm name", "party", "party name", "customer", "customer name", "shop", "shop name", "business", "business name", "buyer", "client", "account name",
        "కంపెనీ", "కంపెనీ పేరు", "పార్టీ", "పార్టీ పేరు", "కస్టమర్", "కస్టమర్ పేరు", "దుకాణం", "దుకాణం పేరు", "షాపు", "షాప్ పేరు", "వ్యాపారం",
        "कंपनी", "कंपनी का नाम", "फर्म", "फर्म का नाम", "पार्टी", "पार्टी का नाम", "ग्राहक", "ग्राहक का नाम", "दुकान", "दुकान का नाम", "व्यापारी", "ग्राहक नाम",
        "ಕಂಪನಿ", "ಗ್ರಾಹಕ", "ಅಂಗಡಿ", "ಪಾರ್ಟಿ", "நிறுவனம்", "வாடிக்கையாளர்", "கடை", "கடை பெயர்")),
    "contact_name": ("Contact person", False, (
        "contact", "contact name", "contact person", "person", "owner", "owner name", "proprietor", "name", "full name", "attention",
        "సంప్రదింపు", "సంప్రదింపు వ్యక్తి", "పేరు", "యజమాని", "యజమాని పేరు",
        "संपर्क", "संपर्क व्यक्ति", "संपर्क नाम", "नाम", "मालिक", "मालिक का नाम", "ಸಂಪರ್ಕ", "ಹೆಸರು", "தொடர்பு", "பெயர்")),
    "contact_phone": ("Phone or WhatsApp number", False, (
        "phone", "phone no", "phone number", "mobile", "mobile no", "mobile number", "whatsapp", "whatsapp no", "whatsapp number", "contact no", "contact number", "cell", "tel", "telephone",
        "ఫోన్", "ఫోన్ నంబర్", "మొబైల్", "మొబైల్ నంబర్", "వాట్సాప్", "फोन", "फ़ोन", "फोन नंबर", "मोबाइल", "मोबाइल नंबर", "व्हाट्सएप", "वाट्सऐप", "ಫೋನ್", "ಮೊಬೈಲ್", "தொலைபேசி", "மொபைல்")),
    "contact_email": ("E-mail", False, (
        "email", "e mail", "email id", "email address", "mail", "mail id",
        "ఈమెయిల్", "ఇమెయిల్", "ఈ మెయిల్", "ईमेल", "ई मेल", "ईमेल पता", "ಇಮೇಲ್", "மின்னஞ்சல்")),
    "contact_job_title": ("Role", False, ("designation", "role", "job title", "title", "position", "హోదా", "पद", "पदनाम", "ಹುದ್ದೆ", "பதவி")),
    "city": ("City", False, (
        "city", "town", "place", "location", "district", "area", "నగరం", "ఊరు", "పట్టణం", "ప్రాంతం", "जिला", "शहर", "नगर", "स्थान", "क्षेत्र", "ನಗರ", "ಊರು", "நகரம்", "ஊர்")),
    "country": ("Country", False, ("country", "దేశం", "देश", "ದೇಶ", "நாடு")),
    "website": ("Website", False, ("website", "web", "site", "url", "website url", "వెబ్‌సైట్", "వెబ్సైట్", "वेबसाइट")),
    "industry": ("Line of business", False, ("industry", "category", "type", "business type", "line of business", "వర్గం", "శ్రేణి", "श्रेणी", "प्रकार", "कारोबार")),
    "source": ("Where we got them", False, ("source", "lead source", "reference", "referred by", "మూలం", "सूत्र", "स्रोत", "संदर्भ")),
}  # fmt: skip
STOCK_FIELDS: dict[str, tuple[str, bool, tuple[str, ...]]] = {
    "item_name": ("Saree name", True, (
        "item", "item name", "name", "product", "product name", "saree", "saree name", "design", "design name", "design no", "article", "title", "description",
        "ఐటెమ్", "వస్తువు", "చీర", "చీర పేరు", "డిజైన్", "పేరు", "सामान", "वस्तु", "साड़ी", "साड़ी का नाम", "डिज़ाइन", "डिजाइन", "आइटम", "नाम", "ಸೀರೆ", "ಹೆಸರು", "புடவை", "பெயர்")),
    "stock_status": ("Stock status", False, (
        "stock", "stock status", "status", "availability", "available", "in stock", "స్టాక్", "స్టాక్ స్థితి", "లభ్యత", "स्टॉक", "स्टॉक स्थिति", "उपलब्धता", "ಸ್ಟಾಕ್", "இருப்பு")),
    "quantity": ("Quantity in stock", False, (
        "qty", "quantity", "pieces", "pcs", "no of pieces", "count", "balance", "closing stock", "stock qty", "stock quantity", "units",
        "సంఖ్య", "పరిమాణం", "ముక్కలు", "మిగిలిన", "मात्रा", "संख्या", "नग", "पीस", "बचे", "शेष", "ಪ್ರಮಾಣ", "அளவு", "எண்ணிக்கை")),
}  # fmt: skip
FIELDS = {"customers": CUSTOMER_FIELDS, "stock": STOCK_FIELDS}

_PUNCT = re.compile(r"[^\w\s]|_", re.UNICODE)


def normalise(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).lower().replace("‌", "").replace("‍", "")
    s = _PUNCT.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class Suggestion:
    index: int
    header: str
    field: str | None
    confidence: str  # exact | partial | weak | none


def _score(header: str, synonyms: tuple[str, ...]) -> int:
    h = normalise(header)
    if not h:
        return 0
    best = 0
    words = set(h.split())
    for syn in synonyms:
        s = normalise(syn)
        if h == s:
            return 3
        if f" {s} " in f" {h} ":
            best = max(best, 2)
        elif words & set(s.split()) and len(s.split()) == 1:
            best = max(best, 1)
    return best


def suggest(headers: list[str], kind: str) -> list[Suggestion]:
    fields = FIELDS[kind]
    scored: list[tuple[int, int, int, str]] = []  # (-score, column, field order, field)
    order = {f: i for i, f in enumerate(fields)}
    for ci, header in enumerate(headers):
        for f, (_label, _req, syn) in fields.items():
            s = _score(header, syn)
            if s:
                scored.append((-s, ci, order[f], f))
    scored.sort()
    used_cols: set[int] = set()
    chosen: dict[str, tuple[int, int]] = {}
    for neg, ci, _o, f in scored:
        if ci in used_cols or f in chosen:
            continue
        chosen[f] = (ci, -neg)
        used_cols.add(ci)
    first = "company_name" if kind == "customers" else "item_name"
    second = "contact_name" if kind == "customers" else None
    # a lone generic "name" column is the main name
    if first not in chosen and second and second in chosen and normalise(headers[chosen[second][0]]) in {"name", "full name", "పేరు", "नाम", "ಹೆಸರು", "பெயர்"}:
        ci, _s = chosen.pop(second)
        chosen[first] = (ci, 1)
    by_col = {ci: (f, s) for f, (ci, s) in chosen.items()}
    out: list[Suggestion] = []
    for ci, header in enumerate(headers):
        if ci in by_col:
            f, s = by_col[ci]
            out.append(Suggestion(ci, header[:60], f, {3: "exact", 2: "partial", 1: "weak"}[s]))
        else:
            out.append(Suggestion(ci, header[:60], None, "none"))
    return out


def mapping_from(suggestions: list[Suggestion]) -> dict[str, int]:
    return {s.field: s.index for s in suggestions if s.field}


def validate_mapping(mapping: object, kind: str, width: int, custom_codes: frozenset[str] = frozenset()) -> dict[str, int]:
    """A mapping from the client: {field: column index}. Every field must be known, every index inside the file, no column used twice, the required field present.
    A customers file may also map `custom:<code>` for an active contact custom field (job CK, ADR 0084 part 2); `custom_codes` is the list of those codes."""
    fields = FIELDS[kind]
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError("mapping_invalid")
    out: dict[str, int] = {}
    for f, idx in mapping.items():
        known = f in fields or (kind == "customers" and isinstance(f, str) and f.startswith("custom:") and f[len("custom:") :] in custom_codes)
        if not known or isinstance(idx, bool) or not isinstance(idx, int) or not 0 <= idx < width:
            raise ValueError("mapping_invalid")
        out[f] = idx
    if len(set(out.values())) != len(out):
        raise ValueError("mapping_invalid")
    for f, (_l, required, _s) in fields.items():
        if required and f not in out:
            raise ValueError("mapping_required_missing")
    return out
