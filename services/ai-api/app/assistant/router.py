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
        "get_figures",  # job DG: fees, dues and trips totals (answers "not available" for a business type that has none of them)
        "draft_quote",
        "draft_followup",
        "draft_reply",
        "record_enquiry",
    }
)
CATALOGUE_TOOLS: frozenset[str] = frozenset({"find_catalogue_items", "send_catalogue_items"})
VISIT_TOOLS: frozenset[str] = frozenset({"propose_visit"})
# job BP: the web research tools, offered only when the owner has switched them on AND the question is about the web, the retailers or the gold and silver price
WEB_TOOLS: frozenset[str] = frozenset({"web_search", "read_page", "find_retailers", "get_metal_prices"})

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

# job BP: the web group. Latin words are matched at a word start; "gold" and "silver" alone are NOT triggers (a silver zari is a saree), only with a rate, a price or "of" in front.
_LATIN_WEB = (
    "google",
    "web search",
    "search the web",
    "search online",
    "search the internet",
    "on the internet",
    "online",
    "internet",
    "latest news",
    "news",
    "gold rate",
    "gold price",
    "gold bhav",
    "silver rate",
    "silver price",
    "silver bhav",
    "rate of gold",
    "price of gold",
    "rate of silver",
    "price of silver",
    "bullion",
    "retailer",
    "wholesaler",
    "find shops",
    "find stores",
    "shops near",
    "stores near",
    "competitor",
)
_INDIAN_WEB = (
    # Hindi: google, internet, online, gold/silver rate or price, news, retailer, wholesaler
    "गूगल", "इंटरनेट", "ऑनलाइन", "सोने का भाव", "सोने का रेट", "सोने की कीमत", "चांदी का भाव", "चाँदी का भाव", "चांदी का रेट", "चांदी की कीमत", "समाचार", "खबर", "रिटेलर", "थोक विक्रेता",
    # Telugu
    "గూగుల్", "ఇంటర్నెట్", "ఆన్‌లైన్", "బంగారం ధర", "బంగారం రేటు", "వెండి ధర", "వెండి రేటు", "వార్తలు", "రిటైలర్", "హోల్‌సేలర్",
    # Kannada
    "ಗೂಗಲ್", "ಇಂಟರ್ನೆಟ್", "ಆನ್‌ಲೈನ್", "ಚಿನ್ನದ ಬೆಲೆ", "ಚಿನ್ನದ ದರ", "ಬೆಳ್ಳಿ ಬೆಲೆ", "ಬೆಳ್ಳಿಯ ಬೆಲೆ", "ಸುದ್ದಿ", "ರಿಟೇಲರ್",
    # Tamil
    "கூகுள்", "இணையம்", "ஆன்லைன்", "தங்கம் விலை", "தங்க விலை", "வெள்ளி விலை", "செய்தி", "சில்லறை விற்பனை",
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
_WEB_LATIN = _latin(_LATIN_WEB)
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


_WEB_ADDRESS = re.compile(r"https?://", re.IGNORECASE)


def wants_web(text: str) -> bool:
    """A web word in any of the five languages, or a web address typed in the message (the owner pasted a link to be read)."""
    t = _normal(text)
    return bool(_WEB_LATIN.search(t)) or bool(_WEB_ADDRESS.search(t)) or _has_any(t, _INDIAN_WEB)


def wants_visits(text: str) -> bool:
    t = _normal(text)
    return bool(_VISIT_LATIN.search(t)) or _has_any(t, _INDIAN_VISIT)


# ---------------------------------------------------------------------------------------------- the safety net (job BD)
# WEAK signals: words that make a hidden group POSSIBLY useful without being a trigger on their own. If the model reaches for a tool that was not offered, or declines, and the question
# (or the chat so far) carries a weak signal for that group, the runner offers every tool once and logs the miss, so the word lists above can be improved. A question with no weak signal
# gets no second chance: the refusal stands.
_WEAK_CATALOGUE_LATIN = _latin(
    (
        "saree",
        "sari",
        "silk",
        "pic$",
        "pics$",
        "photo",
        "picture",
        "image",
        "design",
        "colour",
        "color",
        "stock",
    )
)
_WEAK_CATALOGUE_INDIAN = (
    "చీర", "ఫోటో", "रंग", "साड़ी", "साडी", "फोटो", "ಸೀರೆ", "ಫೋಟೋ", "புடவை", "சேலை", "புகைப்பட",
)  # fmt: skip
# nouns only: a verb such as "send" or "show" is in too many questions that must simply be refused (send the quote, show the orders)
_WEAK_VISIT_LATIN = _latin(
    (
        "visit",
        "appoint",
        "slot",
        "tomorrow",
        "next week",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "o'clock",
    )
)
_TIME_OF_DAY = re.compile(r"\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b")
_WEAK_VISIT_INDIAN = (
    "రేపు", "సందర్శన",  # Telugu: tomorrow, visit
    "कल", "ನಾಳೆ", "ಭೇಟಿ", "நாளை", "சந்தி", "வருகை", "मुलाकात",
)  # fmt: skip


def _weak(group: str, text: str) -> bool:
    t = _normal(text)
    if group == "catalogue":
        return bool(_WEAK_CATALOGUE_LATIN.search(t)) or _has_any(t, _WEAK_CATALOGUE_INDIAN)
    return (
        bool(_WEAK_VISIT_LATIN.search(t))
        or bool(_TIME_OF_DAY.search(t))
        or _has_any(t, _WEAK_VISIT_INDIAN)
    )


def group_of(tool_name: str) -> str | None:
    """The hidden group a tool belongs to (None for a core tool or an unknown name)."""
    if tool_name in CATALOGUE_TOOLS:
        return "catalogue"
    if tool_name in VISIT_TOOLS:
        return "visits"
    return None


def could_need(group: str, question: str, history: Sequence[Mapping[str, object]] = ()) -> bool:
    """Does the question, or the chat it continues, carry a weak signal for this group of tools?"""
    return any(_weak(group, t) for t in [question, *(str(h.get("body") or "") for h in history)])


def missed_group(
    offered: frozenset[str], question: str, history: Sequence[Mapping[str, object]] = ()
) -> str | None:
    """The first group NOT offered that the question could need (catalogue, then visits), else None."""
    for group, tools in (("catalogue", CATALOGUE_TOOLS), ("visits", VISIT_TOOLS)):
        if not tools <= offered and could_need(group, question, history):
            return group
    return None


ALL_TOOLS: frozenset[str] = CORE | CATALOGUE_TOOLS | VISIT_TOOLS


def offered_tools(
    question: str, history: Sequence[Mapping[str, object]] = (), web: frozenset[str] = frozenset()
) -> frozenset[str]:
    """The names of the tools to offer for this question, given the last lines of the chat it continues (a follow-up such as "yes, send them" belongs to the line before). Same input, same answer.
    `web`: the web tools the owner has switched on (job BP); they are offered only to a question that is about the web."""
    texts = [question, *(str(h.get("body") or "") for h in history)]
    offered = set(CORE)
    if any(wants_catalogue(t) for t in texts):
        offered |= CATALOGUE_TOOLS
    if any(wants_visits(t) for t in texts):
        offered |= VISIT_TOOLS
    if web and any(wants_web(t) for t in texts):
        offered |= web & WEB_TOOLS
    return frozenset(offered)


__all__ = [
    "ALL_TOOLS",
    "CATALOGUE_TOOLS",
    "CORE",
    "VISIT_TOOLS",
    "WEB_TOOLS",
    "could_need",
    "group_of",
    "missed_group",
    "offered_tools",
    "wants_catalogue",
    "wants_visits",
    "wants_web",
]
