"""Which tools does a question need? (job BB, ADR 0070.) A deterministic router: no model call, no randomness, no clock.

Every model call carries the definitions of the tools it may use, and the definitions are most of the request (about two thirds). Most questions ("what needs me today?", "who hasn't paid?",
"price this enquiry") never touch the catalogue or the store visits, so those tools are offered only when the question (or the last lines of the chat it continues) is about them:

  * CATALOGUE  (`find_catalogue_items`, `send_catalogue_items`): photos, pictures, the catalogue, designs, colours, fabrics, what is in stock, or sarees together with a verb of showing or sending;
  * VISITS     (`propose_visit`): a visit, an appointment, a slot, booking a time, coming to the shop.

Everything else is always offered (today, quotes, orders, customers, enquiries, prices, follow-ups, the three drafts, recording an enquiry). The router is a floor, not a promise: it decides what the
model is TOLD it may use, and the runner refuses a call to any tool that was not offered (the same "refused call" as an unknown tool). The word lists are plain data below, one per language (English,
Telugu, Hindi, Kannada, Tamil) and are tested one by one. A bare word such as "saree" is deliberately NOT a trigger: this is a saree business, and "what is the price of this saree?" needs the price list.

Matching: the text is lower-cased, normalised (NFC) and stripped of zero-width joiners (so a word typed with or without them matches); a Latin word must start at a word boundary ("photo" matches
"photos" and "photograph", not "microphotography"); an Indian-language word matches anywhere inside a word, because those languages put endings on the word (ఫోటోలు, तस्वीरें, புகைப்படங்கள்)."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence

CORE: frozenset[str] = frozenset(
    {
        "get_today",
        "list_quotes",
        "list_orders",
        "find_customers",
        "list_enquiries",
        "find_price",
        "list_followups",
        "draft_quote",
        "draft_followup",
        "draft_reply",
        "record_enquiry",
    }
)
CATALOGUE_TOOLS: frozenset[str] = frozenset({"find_catalogue_items", "send_catalogue_items"})
VISIT_TOOLS: frozenset[str] = frozenset({"propose_visit"})

# Latin-script words: each is matched at a word start (so "photo" finds "photos" and "photograph")
_LATIN_CATALOGUE = (
    "photo",
    "pic$",  # pic, pics (a trailing $ means "the word ends here"), picture(s)
    "pics$",
    "picture",
    "image",
    "catalog",  # catalogue, catalog
    "design",
    "colour",
    "color",
    "fabric",
    "in stock",
    "out of stock",
    "stock",
    "kanchi",
    "kanjivaram",
    "banaras",
    "pattu",
    "georgette",
    "chiffon",
    "tussar",
    "organza",
    "crepe",
)
_LATIN_VISIT = (
    "visit",
    "appointment",
    "book a",
    "booking",
    "slot",
    "come over",
    "come to the shop",
    "come to the store",
    "walk-in",
    "walk in",
    "drop by",
    "drop in",
)
# a saree, a fabric or a colour together with a verb of showing, sending or finding (in either order): "show me red sarees", "send the green mysore silk to Ravi"
_LATIN_SAREE = (
    "saree",
    "sari",
    "silk",
    "cotton",
    "mysore",
    "mysuru",
    "red",
    "maroon",
    "green",
    "blue",
    "yellow",
    "pink",
    "black",
    "white",
    "gold",
    "orange",
    "purple",
    "violet",
    "grey",
    "gray",
    "cream",
    "brown",
    "mustard",
    "magenta",
    "peach",
    "teal",
)
_LATIN_SHOW = (
    "show",
    "send",
    "share",
    "find",
    "search",
    "look for",
    "looking for",
    "have you got",
    "do we have",
    "do you have",
    "options",
    "suggest",
    "recommend",
)

# Indian-language words, matched anywhere in the text
_INDIAN_CATALOGUE = (
    # Telugu: photo, picture, catalogue, design, colour, stock, fabric
    "ఫోటో", "ఫొటో", "చిత్ర", "కేటలాగ్", "క్యాటలాగ్", "డిజైన్", "రంగు", "స్టాక్", "ఫ్యాబ్రిక్", "పట్టు",
    # Hindi
    "फोटो", "तस्वीर", "चित्र", "कैटलॉग", "कैटलोग", "डिज़ाइन", "डिजाइन", "रंग", "स्टॉक", "कपड़ा",
    # Kannada
    "ಫೋಟೋ", "ಫೊಟೋ", "ಚಿತ್ರ", "ಕ್ಯಾಟಲಾಗ್", "ಡಿಸೈನ್", "ಬಣ್ಣ", "ಸ್ಟಾಕ್", "ರೇಷ್ಮೆ",
    # Tamil
    "புகைப்பட", "போட்டோ", "படம்", "படங்கள்", "கேட்டலாக்", "டிசைன்", "நிறம்", "ஸ்டாக்", "பட்டு",
)  # fmt: skip
_INDIAN_VISIT = (
    # Telugu: visit, appointment, slot, book
    "సందర్శన", "అపాయింట్", "స్లాట్", "బుక్", "రావచ్చ", "షాపుకు రండి", "దుకాణానికి రండి", "కలవ",
    # Hindi
    "मुलाकात", "विज़िट", "विजिट", "अपॉइंटमेंट", "अपॉइन्टमेंट", "स्लॉट", "बुक", "दुकान आ", "आने का समय",
    # Kannada
    "ಭೇಟಿ", "ಅಪಾಯಿಂಟ್", "ಸ್ಲಾಟ್", "ಬುಕ್", "ಅಂಗಡಿಗೆ ಬ", 
    # Tamil
    "வருகை", "சந்திப்பு", "அப்பாயின்ட்", "அப்பாய்ன்ட்", "ஸ்லாட்", "புக்", "கடைக்கு வா",
)  # fmt: skip
# saree + a verb of showing or sending, in the four languages
_INDIAN_SAREE = ("చీర", "साड़ी", "साडी", "ಸೀರೆ", "புடவை", "சேலை")
_INDIAN_SHOW = (
    "చూపించ", "పంపు", "పంపించ", "ఉన్నాయా",  # Telugu
    "दिखा", "भेज", "है क्या", "मिलेंगी", "मिलेगी",  # Hindi
    "ತೋರಿಸ", "ಕಳುಹಿಸ", "ಇದೆಯಾ",  # Kannada
    "காட்ட", "அனுப்ப", "இருக்கா",  # Tamil
)  # fmt: skip

_JOINERS = dict.fromkeys((0x200C, 0x200D))


def _normal(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_JOINERS).lower()


def _latin(words: Iterable[str]) -> re.Pattern[str]:
    parts = [
        re.escape(w[:-1]) + r"(?![a-z0-9])" if w.endswith("$") else re.escape(w) for w in words
    ]
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(parts) + ")")


_CATALOGUE_LATIN = _latin(_LATIN_CATALOGUE)
_VISIT_LATIN = _latin(_LATIN_VISIT)
_SAREE_LATIN = _latin(_LATIN_SAREE)
_SHOW_LATIN = _latin(_LATIN_SHOW)


def _has_any(text: str, words: Iterable[str]) -> bool:
    return any(_normal(w) in text for w in words)


def wants_catalogue(text: str) -> bool:
    t = _normal(text)
    if _CATALOGUE_LATIN.search(t) or _has_any(t, _INDIAN_CATALOGUE):
        return True
    saree = bool(_SAREE_LATIN.search(t)) or _has_any(t, _INDIAN_SAREE)
    show = bool(_SHOW_LATIN.search(t)) or _has_any(t, _INDIAN_SHOW)
    return saree and show


def wants_visits(text: str) -> bool:
    t = _normal(text)
    return bool(_VISIT_LATIN.search(t)) or _has_any(t, _INDIAN_VISIT)


def offered_tools(question: str, history: Sequence[Mapping[str, object]] = ()) -> frozenset[str]:
    """The names of the tools to offer for this question, given the last lines of the chat it continues (a follow-up such as "yes, send them" belongs to the line before). Same input, same answer."""
    texts = [question, *(str(h.get("body") or "") for h in history)]
    offered = set(CORE)
    if any(wants_catalogue(t) for t in texts):
        offered |= CATALOGUE_TOOLS
    if any(wants_visits(t) for t in texts):
        offered |= VISIT_TOOLS
    return frozenset(offered)


__all__ = [
    "CATALOGUE_TOOLS",
    "CORE",
    "VISIT_TOOLS",
    "offered_tools",
    "wants_catalogue",
    "wants_visits",
]
