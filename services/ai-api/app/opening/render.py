"""The assistant's opening line (job DT, ADR 0116): the Owner's own words with placeholders, the "mention that I'm an AI assistant" switch, and the defaults. Pure: no database, no network.

Placeholders: {customer} {assistant} {business} {agent_role}. Nothing else in braces is ever filled (the database refuses a line that holds other braces). A placeholder with no value is dropped with its
surrounding space, never spoken as a brace.

The switch (default ON): when ON the greeting always says it is an AI assistant (the Owner's line gets the short fixed disclosure when it does not already say so). When OFF the greeting is EXACTLY the Owner's
text (or the default without the disclosure). Either way the assistant never CLAIMS to be human and answers honestly when asked (app/opening/honesty.py): the switch only decides whether it volunteers it."""

from __future__ import annotations

import re

LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml", "mr", "bn")
PLACEHOLDERS = ("customer", "assistant", "business", "agent_role")
MAX_LINE = 300
_TOKEN = re.compile(r"\{(customer|assistant|business|agent_role)\}")
# a line "says it is an AI assistant" when it names AI in Latin letters or the local word for an artificial/computer assistant
_MENTIONS_AI = re.compile(r"\bAI\b|artificial|ఏఐ|एआई|ಎಐ|ஏஐ|എഐ|এআই", re.IGNORECASE)

# the fixed short disclosure, per language (everyday spoken style, the word "assistant" stays in English: job DS). hi, kn, ta, ml, mr, bn are drafts for a native reader.
DISCLOSURE = {
    "en": "I'm an AI assistant.",
    "te": "నేను AI assistant ని.",
    "hi": "मैं एक AI assistant हूँ।",
    "kn": "ನಾನು AI assistant.",
    "ta": "நான் ஒரு AI assistant.",
    "ml": "ഞാൻ ഒരു AI assistant ആണ്.",
    "mr": "मी एक AI assistant आहे.",
    "bn": "আমি একটি AI assistant।",
}
# The default greeting when the Owner wrote no line (job EE): ONE natural sentence pair per language, with {business} and NO name; a name is spoken only when the Owner set one ("named"). The "ai" lines already say
# it is an AI assistant (the switch is ON); the "plain" ones are used when it is OFF. The call speaks exactly these words (placeholders filled) and the screen shows exactly these words: one source of truth.
# te, en, hi, kn follow the owner's wording; ta, ml, mr, bn are drafts for a native reader (they have no named variant: the name is left out). The verbs avoid a gender where the language has one.
_ENQUIRY = {
    "en": "I'm calling about your enquiry. Is this a good time to talk?",
    "te": "మీ ఎంక్వైరీ గురించి కాల్ చేశాను, ఇప్పుడు మాట్లాడొచ్చా?",
    "hi": "आपकी पूछताछ के बारे में बात करनी थी, क्या अभी बात कर सकते हैं?",
    "kn": "ನಿಮ್ಮ ವಿಚಾರಣೆ ಬಗ್ಗೆ ಕರೆ ಮಾಡಿದ್ದೆ, ಈಗ ಮಾತಾಡಬಹುದಾ?",
    "ta": "உங்கள் விசாரணை பற்றி அழைத்தேன், இப்போது பேசலாமா?",
    "ml": "നിങ്ങളുടെ അന്വേഷണത്തെക്കുറിച്ച് വിളിച്ചതാണ്, ഇപ്പോൾ സംസാരിക്കാമോ?",
    "mr": "तुमच्या चौकशीबद्दल फोन केला होता, आता बोलता येईल का?",
    "bn": "আপনার অনুসন্ধান নিয়ে ফোন করেছি, এখন কথা বলা যাবে?",
}
_OPENERS: dict[str, dict[str, str]] = {
    "en": {"plain": "Hello, this is {business}.", "ai": "Hello, this is the AI assistant of {business}.", "plain_named": "Hello, this is {assistant} from {business}.", "ai_named": "Hello, this is {assistant}, the AI assistant of {business}."},
    "te": {"plain": "నమస్కారం అండీ, {business} నుంచి మాట్లాడుతున్నాను.", "ai": "నమస్కారం అండీ, నేను {business} నుంచి AI assistant ని మాట్లాడుతున్నాను.", "plain_named": "నమస్కారం అండీ, నేను {assistant}, {business} నుంచి మాట్లాడుతున్నాను.", "ai_named": "నమస్కారం అండీ, నేను {assistant}, {business} నుంచి AI assistant ని మాట్లాడుతున్నాను."},
    "hi": {"plain": "नमस्ते जी, {business} की तरफ़ से फ़ोन है।", "ai": "नमस्ते जी, {business} की AI assistant की तरफ़ से फ़ोन है।", "plain_named": "नमस्ते जी, यह {assistant} है, {business} से।", "ai_named": "नमस्ते जी, यह {assistant} है, {business} की AI assistant।"},
    "kn": {"plain": "ನಮಸ್ಕಾರ ಸರ್, {business} ಇಂದ ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ.", "ai": "ನಮಸ್ಕಾರ ಸರ್, ನಾನು {business} ಇಂದ AI assistant ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ.", "plain_named": "ನಮಸ್ಕಾರ ಸರ್, ನಾನು {assistant}, {business} ಇಂದ ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ.", "ai_named": "ನಮಸ್ಕಾರ ಸರ್, ನಾನು {assistant}, {business} ಇಂದ AI assistant ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ."},
    "ta": {"plain": "வணக்கம், {business} இலிருந்து பேசுகிறேன்.", "ai": "வணக்கம், நான் {business} இன் AI assistant பேசுகிறேன்."},
    "ml": {"plain": "നമസ്കാരം, {business} ൽ നിന്ന് വിളിക്കുന്നു.", "ai": "നമസ്കാരം, ഞാൻ {business} ന്റെ AI assistant ആണ്."},
    "mr": {"plain": "नमस्कार, {business} कडून बोलत आहे.", "ai": "नमस्कार, मी {business} ची AI assistant बोलत आहे."},
    "bn": {"plain": "নমস্কার, {business} থেকে বলছি।", "ai": "নমস্কার, আমি {business}-এর AI assistant বলছি।"},
}


def default_line(language: str, mention_ai: bool, *, named: bool = False) -> str:
    """The default opening, as a template with {business} (and {assistant} only when the Owner set a name)."""
    lang = language if language in _OPENERS else "en"
    kind = "ai" if mention_ai else "plain"
    opener = _OPENERS[lang].get(f"{kind}_named") if named else None
    return f"{opener or _OPENERS[lang][kind]} {_ENQUIRY[lang]}"


def says_ai(text: str) -> bool:
    return bool(_MENTIONS_AI.search(text))


def valid_line(text: str) -> bool:
    """The same rule the database enforces: 10 to 300 characters, only the four placeholders in braces."""
    t = text.strip()
    return 10 <= len(t) <= MAX_LINE and "{" not in _TOKEN.sub("", t) and "}" not in _TOKEN.sub("", t)


def fill(template: str, *, customer: str | None, assistant: str, business: str, agent_role: str | None) -> str:
    values = {"customer": customer, "assistant": assistant, "business": business, "agent_role": agent_role}

    def one(m: re.Match[str]) -> str:
        return values[m.group(1)] or ""

    out = _TOKEN.sub(one, template)
    out = re.sub(r"\s{1,20}([,.!?।])", r"\1", out)   # a dropped placeholder leaves no space before punctuation (bounded: the line may come from the screen)
    return " ".join(out.split())


def compose_opening(
    language: str,
    *,
    owner_line: str | None,
    mention_ai: bool,
    assistant: str | None,
    business: str,
    customer: str | None = None,
    agent_role: str | None = None,
) -> str:
    """What the customer hears first: the Owner's line (given the short disclosure when the switch is ON and it does not say so), or the default line of default_line(). `assistant` is the name the Owner
    set, or None: no name is ever made up."""
    lang = language if language in DISCLOSURE else "en"
    if owner_line:
        text = fill(owner_line, customer=customer, assistant=assistant or "", business=business, agent_role=agent_role)
        if mention_ai and not says_ai(text):
            text = f"{text} {DISCLOSURE[lang]}"
        return text
    return fill(default_line(lang, mention_ai, named=bool(assistant)), customer=customer, assistant=assistant or "", business=business, agent_role=agent_role)


def pick_line(lines: list[dict[str, object]], language: str, campaign_id: str | None) -> str | None:
    """The line in force: the campaign's own for this language, else the workspace's, else None (the default applies)."""
    best: str | None = None
    for row in lines:
        if row.get("language") != language:
            continue
        if campaign_id is not None and row.get("campaign_id") == campaign_id:
            return str(row["text"])
        if row.get("campaign_id") is None:
            best = str(row["text"])
    return best


def pick_mention(mention_ai: bool, overrides: list[dict[str, object]], campaign_id: str | None) -> bool:
    if campaign_id is not None:
        for row in overrides:
            if row.get("campaign_id") == campaign_id:
                return bool(row["mention_ai"])
    return mention_ai
