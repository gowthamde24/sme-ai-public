""""Find new retailers in Jayanagar" -> a search plan (ADR 0119). en, te, kn, hi; typed or transcribed. Deterministic: no model decides what is searched or where.

Returns None when the words are not a request to find new businesses (the assistant then answers as usual). The WHAT is the words the owner used (or the business type's default when they said only
"customers" / "retailers"); the WHERE is the place after "in" / before "లో" / "में" / "ನಲ್ಲಿ"."""

# ruff: noqa: E501

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.lead_finder.packdata import PackLeadFinder

# the verbs of finding, per language
_FIND = re.compile(
    r"\b(find|search|look\s+for|get\s+me|show\s+me|discover|locate)\b"
    r"|వెతుకు|వెతకు|వెతకండి|వెతికి|కనుక్కో|కనిపెట్టు|చూడు|ढूंढ|ढूँढ|खोज|ಹುಡುಕು|ಹುಡುಕಿ|ಪತ್ತೆ",
    re.IGNORECASE,
)
# the words for the kind of business sought (any language; the English loanwords are common in all four)
_WHO = re.compile(
    r"\b(new\s+)?(retailers?|retail\s+shops?|shops?|stores?|boutiques?|contractors?|builders?|developers?|dealers?|buyers?|customers?|clients?|saree\s+shops?|textile\s+shops?|"
    r"construction\s+companies|civil\s+contractors?|businesses)\b"
    r"|రీటైలర్లు|షాపులు|షాపుల|దుకాణాలు|కాంట్రాక్టర్లు|బిల్డర్లు|కస్టమర్లు|బొటిక్|दुकान|दुकानें|ठेकेदार|बिल्डर|ग्राहक|रिटेलर|ಅಂಗಡಿ|ಅಂಗಡಿಗಳು|ಕಾಂಟ್ರಾಕ್ಟರ್|ಬಿಲ್ಡರ್|ಗ್ರಾಹಕರು|ರಿಟೇಲರ್",
    re.IGNORECASE,
)
_GENERIC = re.compile(r"^(new\s+)?(retailers?|retail\s+shops?|shops?|stores?|buyers?|customers?|clients?|businesses)$", re.IGNORECASE)
_EN_PLACE = re.compile(r"\b(?:in|at|near|around)\s+([A-Za-z][A-Za-z .'-]{1,80}?)\s*(?:[?.!,]|$|\bfor\b|\bplease\b|\band\b)", re.IGNORECASE)
_EN_WHAT = re.compile(r"\b(?:find|search(?:\s+for)?|look\s+for|get\s+me|show\s+me|discover|locate)\s+(?:me\s+)?(?:some\s+|more\s+|the\s+)?(.{2,60}?)\s+(?:in|at|near|around)\b", re.IGNORECASE)
# "<place> లో" / "<place> में" / "<place> ನಲ್ಲಿ": the word(s) before the postposition (a place name may be in either script)
_IN_POST = re.compile(r"([\w .'-]{2,60}?)\s*(?:లో|లోని|में|ನಲ್ಲಿ|ದಲ್ಲಿ)(?:\s|$|[?.!,])")
_CATEGORY = {"retailer": ("retail", "shop", "store", "రీటైల", "షాప", "దుకాణ", "दुकान", "रिटेल", "ಅಂಗಡಿ", "ರಿಟೇಲ"), "boutique": ("boutique", "బొటిక్"),
             "contractor": ("contractor", "కాంట్రాక్ట", "ठेकेदार", "ಕಾಂಟ್ರಾಕ್ಟ"), "builder": ("builder", "developer", "బిల్డర్", "बिल्डर", "ಬಿಲ್ಡರ್"), "dealer": ("dealer",)}


@dataclass(frozen=True)
class SearchPlan:
    query: str
    area: str | None
    category_hint: str


def _clean(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).split())


def wants_lead_finder(text: str) -> bool:
    t = _clean(text)
    return bool(_FIND.search(t) and _WHO.search(t))


def parse(text: str, data: PackLeadFinder) -> SearchPlan | None:
    t = _clean(text)[:300]
    if not wants_lead_finder(t):
        return None
    area: str | None = None
    m = _EN_PLACE.search(t)
    if m:
        area = m.group(1).strip(" .'-")
    else:
        m2 = _IN_POST.search(t)
        if m2:
            words = m2.group(1).split()
            area = " ".join(words[-2:]).strip(" .'-") if words else None
    what = None
    w = _EN_WHAT.search(t)
    if w:
        what = re.sub(r"^(new|more)\s+", "", w.group(1).strip(), flags=re.IGNORECASE)
    who = _WHO.search(t)
    hint = data.category_hint
    probe = (what or (who.group(0) if who else "")).casefold()
    for code, words in _CATEGORY.items():
        if any(x in probe for x in words):
            hint = code
            break
    # a generic word, or a non-Latin request: search with the business type's own words (Places reads English best)
    if not what or _GENERIC.match(what) or not re.match(r"^[A-Za-z][A-Za-z &'-]+$", what):
        what = data.default_query.get("en") or "shops"
        if hint == "boutique":
            what = "boutiques"
    return SearchPlan(query=what[:120], area=(area or None) and area[:120], category_hint=hint if hint in ("retailer", "boutique", "contractor", "builder", "dealer") else "other")
