""""Find new retailers in Jayanagar" -> a search plan (ADR 0119). en, te, kn, hi; typed or transcribed (a transcript may write the English words in the Indian script: "ఫైండ్ న్యూ రీటైలర్స్ ఇన్ జయనగర్").
Deterministic: no model decides what is searched or where.

Two questions, two strengths:
  * `is_find_request(text)`: the CHAT router's test (app/turns/intent.py, rule 0). Strict, because a miss only means the assistant answers as usual, while a false hit would turn "find customers who have not
    paid" into a search. It needs a verb of finding AND either a word for a business we do not know yet (retailers, shops, boutiques, contractors, builders, dealers) together with "new" or a place, or a word
    for customers together with "new"/"more"; and NO word about this business's own records (my, our, paid, due, order, quote, enquiry, stock ...).
  * `parse(text, data)`: the plan itself (POST /lead-finder/plan {text}). Looser (a screen's search box says what it is), and it returns None when the words are not a request to find businesses.

The WHAT is the words the owner used (or the business type's default when they said only "customers" / "retailers" or spoke an Indian language: Places reads English best); the WHERE is the place after
"in" / "near" / "ఇన్", or before "లో" / "में" / "ನಲ್ಲಿ" (written apart or joined to the place: "జయనగర్‌లో", "ಜಯನಗರದಲ್ಲಿ")."""

# ruff: noqa: E501

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.lead_finder.packdata import PackLeadFinder

_JOINERS = dict.fromkeys((0x200C, 0x200D, 0x200B, 0x2060, 0xFEFF))

# ---- the verbs of finding. Latin words at a word start; Indian-script stems anywhere inside a word (those languages put endings on the verb)
_FIND_LATIN = re.compile(r"(?<![a-z])(find|search|look\s+for|looking\s+for|get\s+me|show\s+me|discover|locate|vetuku|vetaku|vethuku|vetakandi|dhoondo|dhundo|dhoondho|khojo|hudaku)(?![a-z])")
_FIND_INDIAN = ("వెతుక", "వెతక", "వెతికి", "కనుక్కో", "కనిపెట్ట", "ఫైండ్", "సెర్చ్", "ढूंढ", "ढूँढ", "ढूढ", "खोज", "तलाश", "फाइंड", "सर्च", "ಹುಡುಕ", "ಪತ್ತೆ", "ಫೈಂಡ್", "ಸರ್ಚ್")

# ---- the businesses we do not know yet (a stranger), and the word "customers" (which is often about our own)
_STRANGER_LATIN = re.compile(r"(?<![a-z])(retailers?|retail\s+shops?|shops?|stores?|boutiques?|contractors?|builders?|developers?|dealers?|businesses)(?![a-z])")
_STRANGER_INDIAN = (
    "రీటైలర్", "రిటైలర్", "షాప", "దుకాణ", "కాంట్రాక్టర్", "బిల్డర్", "బొటిక్", "బొటీక్", "బోటిక్", "డీలర్", "స్టోర్",
    "रिटेलर", "दुकान", "ठेकेदार", "कॉन्ट्रैक्टर", "कांट्रेक्टर", "बिल्डर", "बुटीक", "डीलर", "स्टोर", "शॉप",
    "ರಿಟೇಲರ್", "ರಿಟೈಲರ್", "ಅಂಗಡಿ", "ಶಾಪ್", "ಕಾಂಟ್ರಾಕ್ಟರ್", "ಗುತ್ತಿಗೆದಾರ", "ಬಿಲ್ಡರ್", "ಬೊಟಿಕ್", "ಡೀಲರ್", "ಸ್ಟೋರ್",
)
_CUSTOMER_LATIN = re.compile(r"(?<![a-z])(customers?|clients?|buyers?)(?![a-z])")
_CUSTOMER_INDIAN = ("కస్టమర్", "వినియోగదార", "ఖాతాదార", "కొనుగోలుదార", "ग्राहक", "कस्टमर", "खरीदार", "ಗ್ರಾಹಕ", "ಕಸ್ಟಮರ್", "ಖರೀದಿದಾರ")
_NEW_LATIN = re.compile(r"(?<![a-z])(new|more|fresh|kotha|kottha|naye|naya|nayi|hosa)(?![a-z])")
_NEW_INDIAN = ("కొత్త", "న్యూ", "నూతన", "नए", "नये", "नई", "नयी", "नया", "न्यू", "ಹೊಸ", "ನ್ಯೂ")
# ---- words about THIS business's own records: such a message is a question for the records, never a search
_OWN_LATIN = re.compile(
    r"(?<![a-z])(my|our|existing|old|regular|who|whom|which|paid|pay|unpaid|due|dues|owe|owes|owing|order|orders|quote|quotes|quotation|invoice|invoices|enquir\w*|inquir\w*|pending|follow[- ]?up|"
    r"stock|catalog\w*|list|lead|leads|last\s+(?:week|month|year)|yesterday|haven'?t|hasn'?t|didn'?t|price|prices|rate|rates)(?![a-z])"
)
_OWN_INDIAN = (
    " నా ", " మా ", " మన ", "పాత", "ఆర్డర్", "కొటేషన్", "బకాయి", "ఎంక్వైరీ", "విచారణ", "చెల్లించ", "లీడ్", "స్టాక్", "ఎవరు", "ధర",
    "मेरे", "मेरी", "मेरा", "हमारे", "हमारी", "पुराने", "ऑर्डर", "कोटेशन", "बकाया", "पूछताछ", "भुगतान", "लीड", "स्टॉक", "कौन", "कीमत",
    "ನನ್ನ", "ನಮ್ಮ", "ಹಳೆಯ", "ಆರ್ಡರ್", "ಕೊಟೇಶನ್", "ಬಾಕಿ", "ಪಾವತಿ", "ಲೀಡ್", "ಸ್ಟಾಕ್", "ಯಾರು", "ಬೆಲೆ",
)

# ---- the place
_EN_PLACE = re.compile(r"(?<![a-z])(?:in|at|near|around|inside|across)\s+([a-z][a-z0-9 .'-]{1,80}?)\s*(?:[?.!,]|$|(?<![a-z])(?:for|please|and|today|tomorrow|now|which|that|who)(?![a-z]))", re.IGNORECASE)
_NOT_A_PLACE = {"me", "us", "here", "my area", "our area", "the area", "this area", "the city", "my city", "town", "the shop", "my shop", "our shop", "the store", "stock", "the market", "area", "city"}
# "near me" names no place we can search, but it is still a request (the assistant asks where)
_NEAR_ME = re.compile(r"(?<![a-z])(?:near\s+(?:me|us|here)|nearby|around\s+here|close\s+by)(?![a-z])")
_PLACE_ARTICLE = re.compile(r"^(?:the|a|an|this|that)\s+")
# written apart from the place ("Jayanagar లో", "जयनगर में", "ಜಯನಗರ ನಲ್ಲಿ", "జయనగర్ దగ్గర")
_POST_WORDS = {"లో", "లోని", "లోనూ", "దగ్గర", "చుట్టూ", "में", "मे", "पास", "आसपास", "ನಲ್ಲಿ", "ದಲ್ಲಿ", "ಯಲ್ಲಿ", "ಹತ್ತಿರ", "ಸುತ್ತ"}
# joined to it ("జయనగర్‌లో" once the joiner is gone is "జయనగర్లో"; "ಜಯನಗರದಲ್ಲಿ")
_POST_SUFFIXES = ("లోని", "లోనూ", "లో", "ದಲ್ಲಿ", "ನಲ್ಲಿ", "ಯಲ್ಲಿ", "ಲ್ಲಿ")
# English word order in an Indian script ("ఇన్ జయనగర్", "इन जयनगर")
_PRE_WORDS = {"ఇన్", "నియర్", "इन", "नियर", "ಇನ್", "ನಿಯರ್"}
_STOP_TOKENS = {
    "please", "pls", "find", "new", "more", "some", "the", "a", "me", "and",
    "నాకు", "మాకు", "దయచేసి", "కొత్త", "న్యూ", "కొన్ని", "మరిన్ని", "ఇంకా", "ఒక", "మీరు",
    "मुझे", "हमें", "कृपया", "नए", "नये", "नई", "कुछ", "और", "आप", "ज़रा", "जरा", "के",
    "ನನಗೆ", "ನಮಗೆ", "ದಯವಿಟ್ಟು", "ಹೊಸ", "ಕೆಲವು", "ಇನ್ನಷ್ಟು", "ನೀವು",
}
_TOKEN_SPLIT = re.compile(r"[\s,;:!?।|()\"“”]+")

_CATEGORY = {"boutique": ("boutique", "బొటిక్", "బొటీక్", "బోటిక్", "बुटीक", "ಬೊಟಿಕ್"),
             "contractor": ("contractor", "కాంట్రాక్ట", "ठेकेदार", "कॉन्ट्रैक्ट", "कांट्रेक्ट", "ಕಾಂಟ್ರಾಕ್ಟ", "ಗುತ್ತಿಗೆ"),
             "builder": ("builder", "developer", "బిల్డర్", "बिल्डर", "ಬಿಲ್ಡರ್"),
             "dealer": ("dealer", "డీలర్", "डीलर", "ಡೀಲರ್"),
             "retailer": ("retail", "shop", "store", "రీటైల", "రిటైల", "షాప", "దుకాణ", "స్టోర్", "दुकान", "रिटेल", "स्टोर", "शॉप", "ಅಂಗಡಿ", "ರಿಟೇಲ", "ರಿಟೈಲ", "ಶಾಪ್", "ಸ್ಟೋರ್")}
_HINT_QUERY = {"boutique": "boutiques", "contractor": "contractors", "builder": "builders", "dealer": "dealers"}
_EN_WHAT = re.compile(r"(?<![a-z])(?:find|search(?:\s+for)?|look(?:ing)?\s+for|get\s+me|show\s+me|discover|locate)\s+(?:me\s+)?(?:some\s+|more\s+|the\s+)?(.{2,60}?)\s+(?:in|at|near|around)(?![a-z])")
_GENERIC = re.compile(r"^(?:new\s+|more\s+)?(?:retailers?|retail\s+shops?|shops?|stores?|buyers?|customers?|clients?|businesses)$")


@dataclass(frozen=True)
class SearchPlan:
    query: str
    area: str | None
    category_hint: str


def _clean(text: str, *, lower: bool = True) -> str:
    """NFC, zero-width joiners removed (so a word typed with or without them matches), one space between words, lower case for the Latin letters (not for a place: "HSR Layout" stays as typed)."""
    out = " ".join(unicodedata.normalize("NFC", text).translate(_JOINERS).split())
    return out.lower() if lower else out


def _any(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def _has_find(t: str) -> bool:
    return bool(_FIND_LATIN.search(t)) or _any(t, _FIND_INDIAN)


def _has_stranger(t: str) -> bool:
    return bool(_STRANGER_LATIN.search(t)) or _any(t, _STRANGER_INDIAN)


def _has_customer(t: str) -> bool:
    return bool(_CUSTOMER_LATIN.search(t)) or _any(t, _CUSTOMER_INDIAN)


def _has_new(t: str) -> bool:
    return bool(_NEW_LATIN.search(t)) or _any(t, _NEW_INDIAN)


def _has_own(t: str) -> bool:
    return bool(_OWN_LATIN.search(t)) or _any(f" {t} ", _OWN_INDIAN)


def _is_stop(token: str) -> bool:
    return (token in _STOP_TOKENS or _any(token, _FIND_INDIAN) or _any(token, _STRANGER_INDIAN) or _any(token, _CUSTOMER_INDIAN) or _any(token, _NEW_INDIAN)
            or bool(_FIND_LATIN.fullmatch(token)) or bool(_STRANGER_LATIN.fullmatch(token)) or bool(_NEW_LATIN.fullmatch(token)) or bool(_CUSTOMER_LATIN.fullmatch(token)))


def _title(area: str) -> str:
    """A place as typed; one typed (or transcribed) all in small letters gets capitals: "jayanagar bengaluru" -> "Jayanagar Bengaluru". An Indian-script name is left as it is."""
    if area != area.lower():
        return area[:120]
    return " ".join(w[:1].upper() + w[1:] if w.isascii() else w for w in area.split())[:120]


def _strip_suffix(token: str) -> str | None:
    for suffix in _POST_SUFFIXES:
        if token.endswith(suffix) and len(token) > len(suffix) + 1:
            return token[: -len(suffix)]
    return None


def _usable(token: str) -> bool:
    return not _is_stop(token) and token not in _POST_WORDS and token not in _PRE_WORDS and not _has_find(token)


def area_of(text: str) -> str | None:
    """The place named in the words, or None (no place, or one we cannot use such as "near me")."""
    t = _clean(text, lower=False)[:300]
    m = _EN_PLACE.search(t)
    if m:
        area = _PLACE_ARTICLE.sub("", m.group(1).strip(" .'-"))
        if area and area.lower() not in _NOT_A_PLACE and not _is_stop(area.lower()):
            return _title(area)
    shown = [x.strip(".'-") for x in _TOKEN_SPLIT.split(t) if x.strip(".'-")]
    tokens = [x.lower() for x in shown]
    for i, tok in enumerate(tokens):
        if tok in _PRE_WORDS and i + 1 < len(tokens) and _usable(tokens[i + 1]):
            nxt = shown[i + 1]
            return _title(_strip_suffix(nxt) or nxt)
        if tok in _POST_WORDS and i > 0:
            j = i - 1
            while j > 0 and tokens[j] in _POST_WORDS | {"के"}:   # "जयनगर के पास", "జయనగర్ లో దగ్గర"
                j -= 1
            if not _usable(tokens[j]):
                continue
            parts = [shown[j]]
            if j > 0 and _usable(tokens[j - 1]):
                parts.insert(0, shown[j - 1])
            return _title(" ".join(parts))
        stem = _strip_suffix(tok)
        if stem is not None and _usable(stem):
            parts = [_strip_suffix(shown[i]) or stem]
            if i > 0 and _usable(tokens[i - 1]):
                parts.insert(0, shown[i - 1])
            return _title(" ".join(parts))
    return None


def wants_lead_finder(text: str) -> bool:
    """The loose test of a search box: a verb of finding and a word for businesses or customers."""
    t = _clean(text)
    return _has_find(t) and (_has_stranger(t) or _has_customer(t))


def is_find_request(text: str) -> bool:
    """The chat router's strict test (see the module note): only an unmistakable request to find businesses we do not know yet."""
    t = _clean(text)[:300]
    if not _has_find(t) or _has_own(t):
        return False
    if _has_stranger(t) and (_has_new(t) or _NEAR_ME.search(t) or area_of(text) is not None):
        return True
    return _has_customer(t) and _has_new(t)


def parse(text: str, data: PackLeadFinder) -> SearchPlan | None:
    t = _clean(text)[:300]
    if not wants_lead_finder(t):
        return None
    area = area_of(text)
    what = None
    w = _EN_WHAT.search(t)
    if w:
        what = re.sub(r"^(?:new|more)\s+", "", w.group(1).strip())
    hint = data.category_hint
    probe = what or t
    for code, words in _CATEGORY.items():
        if any(x in probe for x in words):
            hint = code
            break
    # a generic word, or a request not in English letters: search with the business type's own words (Places reads English best)
    if not what or _GENERIC.match(what) or not re.match(r"^[a-z][a-z &'-]+$", what):
        what = data.default_query.get("en") or "shops"
        if hint != data.category_hint and hint in _HINT_QUERY:
            what = _HINT_QUERY[hint]
    return SearchPlan(query=what[:120], area=area, category_hint=hint if hint in ("retailer", "boutique", "contractor", "builder", "dealer") else "other")
