"""No gendered address (owner, 30 Oct 2026: Kannada fillers said "sir" (ಸರ್) to women).

The assistant does not know a person's gender, so it never says sir / madam / ma'am or their equivalents in any language (సార్, ಸರ್, सर, मैडम, சார், മാഡം ...). It uses a neutral polite form instead; a word of address is allowed
ONLY when the person chose it (the optional "How should I address you?" in the member's own profile, `address_as`) or the customer's own title is known and passed in `allow`.

Three layers use this module: the prompts (`address_rule`, one line in every register block and chat prompt), the model's output (`clean`, applied to every reply before it is shown or spoken), and a test over every line the product ships
(`tests/test_oq_no_gendered_address.py`). Pure text: no network, no key."""

from __future__ import annotations

import re

# The polite word that is right for everyone, per language (the owner's list): te "అండీ", hi "जी", kn none / "ಹೇಳಿ" / the name with "ಅವರೇ", ta the "-ங்க" ending, ml none, en none.
NEUTRAL: dict[str, str] = {
    "te": "అండీ",
    "hi": "जी",
    "kn": "ಹೇಳಿ",
    "ta": "-ங்க (an ending: ஆமாங்க, சொல்லுங்க)",
    "ml": "no form of address",
    "en": "no form of address",
}

# Words that name a gender when used to address someone. Whole words only (a Latin word between non-letters; an Indian-script word not inside a longer word, so ಸರ್ಕಾರ and सरकार stay).
_LATIN = ("sir", "sirji", "madam", "madame", "ma'am", "maam", "mam", "mem sahib", "sahib", "bhaiya", "bhaiyya", "didi")
_INDIC = (
    "సార్", "సర్", "మేడం", "మేడమ్", "మేడమ్‌",                  # Telugu
    "ಸರ್", "ಸಾರ್", "ಮೇಡಂ", "ಮೇಡಮ್", "ಮ್ಯಾಡಂ", "ಮ್ಯಾಮ್",       # Kannada
    "सर", "सर जी", "मैडम", "मैम", "मेम साहब", "भैया", "दीदी",   # Hindi
    "சார்", "சார்.", "மேடம்", "மேம்", "அண்ணா", "அக்கா",        # Tamil
    "സർ", "സാർ", "മാഡം", "മേഡം", "ചേട്ടാ", "ചേച്ചി",          # Malayalam
)
_LETTERS = r"A-Za-z0-9_ऀ-෿"
_WORD = re.compile(
    r"(?<![" + _LETTERS + r"'])(?:" + "|".join(re.escape(w) for w in sorted((*_LATIN, *_INDIC), key=len, reverse=True)) + r")(?![" + _LETTERS + r"'])",
    re.IGNORECASE,
)
_PUNCT_RUNS = re.compile(r"\s*([,;])(\s*[,;])+")


def address_rule(language: str = "en") -> str:
    """One prompt line, English (the model reads English instructions best): never gendered address; the neutral form for the language; a chosen form only when it is given below."""
    neutral = NEUTRAL.get(language, NEUTRAL["en"])
    return (
        "ADDRESSING PEOPLE: you do not know anyone's gender, so never call anyone sir, madam, ma'am, bhaiya, didi, anna or akka, or their equivalents in any language (సార్, ಸರ್, सर, मैडम, சார், മാഡം). "
        f"Use the neutral polite form instead: {neutral}, or the person's name, or nothing. Use a word of address only if this prompt says the person chose it or gives their title."
    )


def address_clause(language: str, address_as: str = "", *, rule: bool = True) -> str:
    """The prompt lines about addressing: the rule, and (only when the person chose one in their profile) the word they asked for. The word is their own typing, so it is cut to letters and quoted. `rule=False` leaves the
    rule out (the records path, whose prompt is held to a token ceiling, tests/integration/test_assistant_tokens.py: there the gate on the reply is what keeps sir and madam out)."""
    chosen = re.sub(r"[^\w .'-]", "", address_as or "", flags=re.UNICODE).strip()[:30]
    lead = address_rule(language) if rule else ""
    return f"{lead} This person asked to be addressed as \"{chosen}\": use exactly that when you address them.".strip() if chosen else lead


def gendered_words(text: str, allow: tuple[str, ...] = ()) -> list[str]:
    """The gendered words of address in `text` that are not in `allow` (the person's own chosen word)."""
    allowed = {a.strip().lower() for a in allow if a and a.strip()}
    return [m.group(0) for m in _WORD.finditer(text) if m.group(0).lower() not in allowed]


def clean(text: str, allow: tuple[str, ...] = ()) -> str:
    """`text` without the gendered words of address (except those in `allow`), the punctuation around them tidied: "ಹೌದು ಸರ್, ನೋಡ್ತೀನಿ" -> "ಹೌದು, ನೋಡ್ತೀನಿ"; "Sure, sir." -> "Sure."."""
    allowed = {a.strip().lower() for a in allow if a and a.strip()}
    if not text or not _WORD.search(text):
        return text

    def drop(match: re.Match[str]) -> str:
        return match.group(0) if match.group(0).lower() in allowed else ""

    out = _WORD.sub(drop, text)
    out = re.sub(r"[ \t]+([,.;!?…।])", r"\1", out)         # "ಹೌದು ," -> "ಹೌದು,"
    out = _PUNCT_RUNS.sub(r"\1", out)
    out = re.sub(r"^[\s,;]+", "", out)                        # a reply that began "Sir, ..."
    out = re.sub(r"([,;])\s*([.!?…।])", r"\2", out)           # "Sure, ." -> "Sure."
    return re.sub(r"[ \t]{2,}", " ", out).strip()
