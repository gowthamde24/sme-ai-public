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
# the default greeting WITHOUT the disclosure (used when the switch is OFF and the Owner wrote no line); te follows native-lines/te.md
DEFAULT_PLAIN = {
    "en": "Hello {customer}, this is {assistant} from {business}. Do you have a minute?",
    "te": "నమస్కారం {customer} గారు, నేను {assistant}, {business} నుంచి. ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "hi": "नमस्ते {customer} जी, मैं {assistant}, {business} से बोल रही हूँ। क्या एक मिनट बात कर सकते हैं?",
    "kn": "ನಮಸ್ಕಾರ {customer} ಅವರೇ, ನಾನು {assistant}, {business} ಇಂದ. ಒಂದು ನಿಮಿಷ ಮಾತಾಡಬಹುದಾ?",
    "ta": "வணக்கம் {customer}, நான் {assistant}, {business} இலிருந்து. ஒரு நிமிடம் பேசலாமா?",
    "ml": "നമസ്കാരം {customer}, ഞാൻ {assistant}, {business} ൽ നിന്ന്. ഒരു മിനിറ്റ് സംസാരിക്കാമോ?",
    "mr": "नमस्कार {customer}, मी {assistant}, {business} कडून बोलत आहे. एक मिनिट बोलता येईल का?",
    "bn": "নমস্কার {customer}, আমি {assistant}, {business} থেকে বলছি। এক মিনিট কথা বলা যাবে?",
}


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
    out = re.sub(r"\s+([,.!?।])", r"\1", out)   # a dropped placeholder leaves no space before punctuation
    return re.sub(r"\s{2,}", " ", out).strip()


def compose_opening(
    language: str,
    *,
    owner_line: str | None,
    mention_ai: bool,
    assistant: str,
    business: str,
    customer: str | None = None,
    agent_role: str | None = None,
    ai_intro: str | None = None,
) -> str:
    """What the customer hears first. `ai_intro` is the fixed introduction of the AI-assistant settings (it already says "AI assistant"): the default when the switch is ON and the Owner wrote no line."""
    lang = language if language in DISCLOSURE else "en"
    if owner_line:
        text = fill(owner_line, customer=customer, assistant=assistant, business=business, agent_role=agent_role)
        if mention_ai and not says_ai(text):
            text = f"{text} {DISCLOSURE[lang]}"
        return text
    if mention_ai:
        if ai_intro:
            return ai_intro
        text = fill(DEFAULT_PLAIN[lang], customer=customer, assistant=assistant, business=business, agent_role=agent_role)
        return f"{text} {DISCLOSURE[lang]}"
    return fill(DEFAULT_PLAIN[lang], customer=customer, assistant=assistant, business=business, agent_role=agent_role)


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
