"""How an OUTBOUND goal call sounds (owner, 11 Nov 2026, after his brother's test calls): three tones and the lines that follow them.

  respectful  the current register: the polite particle in most sentences (Telugu "అండీ"), "మీరు" forms.
  friendly    the DEFAULT: "మీరు" forms, the particle rarely, never "గారు", never a gendered word of address.
  casual      like a friend: informal "you" and verb endings (Telugu "నువ్వు", "చూశావా"), no "అండీ", no "గారు", no "మీరు". English and Telugu only; any other language falls back to friendly.

The tone of a call is chosen by CODE, never by the model: an OWNER test call's goal may say "casual" / "close friend" / "respectful" (`tone_from_goal`); a Lead Desk task call to a customer is ALWAYS friendly (`for_task_call`).
The honest "I am an AI" words are in the opening of every tone and in the answer to "are you a robot?" of every tone. Every Telugu line below is a DRAFT for a native reader (the owner's brother).
The fixed lines, the rules and the examples are data here; the code that uses them is in persona.py (prompt), plivo_outbound.py (opening) and talk_training/guard.py (what is spoken)."""

# ruff: noqa: E501

from __future__ import annotations

import re

TONES = ("respectful", "friendly", "casual")
DEFAULT_TONE = "friendly"
CASUAL_LANGUAGES = frozenset({"te", "en"})   # the languages whose informal register has been written out; the others stay friendly

_CASUAL = re.compile(r"\bcasual(?:ly)?\b|\binformal(?:ly)?\b|\bclose friend\b|\blike a friend\b|\bas a friend\b|\bfriend\b|\bbuddy\b|ఫ్రెండ్|స్నేహితుడి|నువ్వు", re.IGNORECASE)
_RESPECTFUL = re.compile(r"\brespectful(?:ly)?\b|\bformal(?:ly)?\b|\bvery polite\b|మర్యాదగా", re.IGNORECASE)


def tone_from_goal(goal: str | None) -> str:
    """The tone an OWNER's test-call goal asks for: "respectful"/"formal" -> respectful; "casual"/"friend"/"informal" -> casual; otherwise the default. (A goal that says "friendly" is the default, not casual.)"""
    text = goal or ""
    if _RESPECTFUL.search(text):
        return "respectful"
    if _CASUAL.search(text):
        return "casual"
    return DEFAULT_TONE


def for_task_call(requested: str | None = None) -> str:
    """A Lead Desk task call to a customer: casual is never selectable here, whatever is asked."""
    return "respectful" if requested == "respectful" else DEFAULT_TONE


def usable(tone: str | None, language: str) -> str:
    """The tone this language can really speak: casual only where it has been written out."""
    if tone not in TONES:
        return DEFAULT_TONE
    return DEFAULT_TONE if tone == "casual" and language not in CASUAL_LANGUAGES else tone


# ---- the fixed lines (Telugu is the reviewed set; other languages keep the lines in persona.py / tasks/dialer.py)
OPENERS_TE = {
    "respectful": "నమస్కారం అండీ, నేను {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "friendly": "హలో, నేను {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "casual": "హాయ్! నేను {business} AI assistant ని. ఒక్క నిమిషం మాట్లాడతావా?",
}
OPENERS_EN = {
    "respectful": "Hello, this is the AI assistant of {business}. Is this a good time to talk?",
    "friendly": "Hello, this is the AI assistant of {business}. Is this a good time to talk?",
    "casual": "Hey! I'm the AI assistant of {business}. Got a minute to chat?",
}
HONEST_TE = {   # "are you a robot / a person?": honest, and no promise in it (the inbound line says "I will get your work done")
    "respectful": "అవునండీ, నేను AI assistant ని.",
    "friendly": "అవును, నేను AI assistant ని.",
    "casual": "అవును, నేను AI assistant ని, మనిషిని కాదు.",
}
HONEST_EN = {"respectful": "Yes, I'm an AI assistant.", "friendly": "Yes, I'm an AI assistant.", "casual": "Yes, I'm an AI assistant, not a person."}
CHECK_IN_TE = {"respectful": "హలో, ఉన్నారా అండీ?", "friendly": "హలో, ఉన్నారా?", "casual": "హలో, ఉన్నావా?"}
BYE_TE = {"respectful": "సరే అండీ, thank you, bye!", "friendly": "సరే, thank you, bye!", "casual": "సరే, thanks, bye bye!"}
BYE_EN = {"respectful": "Okay, thank you, bye!", "friendly": "Okay, thanks, bye!", "casual": "Okay, cool, bye!"}
INTERRUPTED_TE = {"respectful": "ఆ, చెప్పండి అండీ", "friendly": "ఆ, చెప్పండి", "casual": "ఆ, చెప్పు"}
ACKS_TE = {"respectful": "సరేనండీ / అలాగా / అవునా", "friendly": "సరే / అలాగా / అవునా", "casual": "ఓహో / సరే / అవునా"}
CANT_TE = {   # the true line said instead of any promise (promises.py), and a model example of "I can't arrange that"
    "respectful": "అది నేను ఈ కాల్ లో చేయలేనండీ, మీరే business ని నేరుగా అడగండి.",
    "friendly": "అది నేను ఈ కాల్ లో చేయలేను, మీరే business ని నేరుగా అడగొచ్చు.",
    "casual": "అది నేను ఈ కాల్ లో చేయలేను, నువ్వే నేరుగా అడుగు.",
}
CANT_EN = "I can't arrange that on this call, you can ask the business directly."
QUESTION_TE = {"respectful": "మీరు ఈ నెల stock గురించి ఏమైనా చూశారా అండీ?", "friendly": "మీరు ఈ నెల stock గురించి ఏమైనా చూశారా?", "casual": "నువ్వు ఈ నెల stock గురించి ఏమైనా చూశావా?"}
ACK_LINE_TE = {"respectful": "సరేనండీ, అర్థమైందండీ.", "friendly": "సరే, అర్థమైంది.", "casual": "ఓహో, సరే, అర్థమైంది."}

# ---- the instructions the model reads (English), per tone; Telugu has its own because that is where the register was wrong
RULES = {
    "respectful": "TONE: respectful. Use the polite 'మీరు' forms and the polite particle 'అండీ' in most sentences. Never 'గారు', never a gendered word of address.",
    "friendly": (
        "TONE: friendly, relaxed, like a helpful person on the phone. Use the 'మీరు' forms, but the polite particle 'అండీ' AT MOST once in every three or four sentences and never at the end of every sentence. "
        "NEVER 'గారు', never a gendered word of address. Short natural spoken sentences, no bookish words."
    ),
    "casual": (
        "TONE: casual, like talking to a close friend, warm and kind. Address the person with the informal 'నువ్వు / నీకు / నీ' and the informal verb endings (చూశావా, మాట్లాడతావా, చెప్పు, అడుగు). "
        "NEVER 'అండీ' or 'అండి', NEVER 'గారు', never a gendered word of address, NEVER 'మీరు / మీకు / మీ'. Do not use 'రా' or 'రే' (you do not know the person's gender). Never rude, no slang insults. "
        "Everyday English words stay English (stock, price, OK, thanks, bye)."
    ),
}
RULES_EN = {
    "respectful": "TONE: respectful. Polite words, please and thank you. Never a gendered word of address.",
    "friendly": "TONE: friendly and relaxed, like a helpful person on the phone. Never a gendered word of address.",
    "casual": "TONE: casual, like talking to a close friend: contractions, short and relaxed, still kind. Never a gendered word of address.",
}
EXAMPLES_TE = {
    "respectful": [OPENERS_TE["respectful"], QUESTION_TE["respectful"], ACK_LINE_TE["respectful"] + " ఇంకొక విషయం అడగొచ్చా అండీ?", CANT_TE["respectful"], BYE_TE["respectful"]],
    "friendly": [OPENERS_TE["friendly"], QUESTION_TE["friendly"], ACK_LINE_TE["friendly"] + " ఇంకొక విషయం అడగొచ్చా?", CANT_TE["friendly"], BYE_TE["friendly"]],
    "casual": [OPENERS_TE["casual"], QUESTION_TE["casual"], ACK_LINE_TE["casual"] + " ఇంకొక విషయం అడగొచ్చా?", CANT_TE["casual"], BYE_TE["casual"]],
}


GREET_TE = {"respectful": "నమస్కారం అండీ,", "friendly": "హలో,", "casual": "హాయ్!"}
ASK_TE = {"respectful": "ఒక్క నిమిషం మాట్లాడొచ్చా?", "friendly": "ఒక్క నిమిషం మాట్లాడొచ్చా?", "casual": "ఒక్క నిమిషం మాట్లాడతావా?"}
GREET_EN = {"respectful": "Hello,", "friendly": "Hello,", "casual": "Hey!"}
ASK_EN = {"respectful": "Is this a good time to talk?", "friendly": "Is this a good time to talk?", "casual": "Got a minute to chat?"}


def opener(language: str, tone: str, introduce: object | None = None) -> str | None:
    """The tone's own opening (with {business} left in for the business form), or None: the language keeps its standard opening. `introduce` (an app.talk_training.introduce.Introduce) replaces "of {business}" by the owner's name or the
    Owner's own words; the AI-assistant words are in every form (the Introduce rules insist on them)."""
    from app.talk_training import introduce as intro_mod

    tone = usable(tone, language)
    if introduce is not None and isinstance(introduce, intro_mod.Introduce):
        said = intro_mod.phrase(language, introduce)
        if said is not None and language == "te":
            return f"{GREET_TE[tone]} {said} {ASK_TE[tone]}"
        if said is not None and language == "en":
            return f"{GREET_EN[tone]} {said} {ASK_EN[tone]}"
    return {"te": OPENERS_TE, "en": OPENERS_EN}.get(language, {}).get(tone)


def honest_line(language: str, tone: str) -> str | None:
    tone = usable(tone, language)
    return {"te": HONEST_TE, "en": HONEST_EN}.get(language, {}).get(tone)


_BOY = re.compile(r"\b(?:boy|son|his\s+(?:marks|result|exam)|he\b)|అబ్బాయి|కొడుకు|వాడు", re.IGNORECASE)


def child_is_boy(goal: str | None) -> bool:
    """True only when the owner's goal itself says the child is a boy: then "వాడు" may be used. Otherwise the child is called by name; we never guess a child's gender."""
    return bool(_BOY.search(goal or ""))


def spoken_telugu_rules(goal: str | None = None) -> str:
    """The SPOKEN TELUGU block of a Telugu goal call (owner, 11 Nov 2026, after the school role-play calls: the Telugu was written, not spoken). Same in every tone."""
    from app.agents import register

    child = ("refer to the child by name, or with \"వాడు\" (the goal says it is a boy)" if child_is_boy(goal) else "refer to the child by NAME only (you do not know the child's gender: no \"వాడు\", no \"ఆయన\")")
    return (
        "SPOKEN TELUGU, not written Telugu: short sentences people really say on the phone. When you speak for the organisation say \"మేము\" (never \"school వారు\" or a third person); "
        f"{child}, and never with an honorific; keep common English words in English (parents, marks, school, maths, science, thanks, OK); say the organisation's name ONCE in the call; "
        "the goodbye is one short line. " + register.bookish_rules("te")
    )


def register_rules(language: str, tone: str, goal: str | None = None) -> str:
    """The tone paragraph of the prompt; examples (Telugu) follow as 'copy the register, never a fact'."""
    tone = usable(tone, language)
    if language == "te":
        shots = "\n".join(f"  * {line}" for line in EXAMPLES_TE[tone])
        return f"{RULES[tone]}\n{spoken_telugu_rules(goal)}\nExamples of this tone (copy the register only, never a fact; they are drafts for a native reader):\n{shots}"
    if language == "en":
        return RULES_EN[tone]
    return ""


# ---- what is SPOKEN (code, after the model): the particles a tone does not allow are taken out of the line
_GARU = re.compile(r"(?:\s+|\u200c)(?:గారు|గారూ|గారి(?:కి|ని|తో|కీ|నుంచి|యొక్క|ది|దే)?(?![\u0C00-\u0C7F]))|\s+(?:garu|gaaru|gari|gaariki|gaaritho)\b", re.IGNORECASE)   # every case form of the honorific as a word of its own (after a space or a joiner): not inside "బంగారు" (gold)
_KEEP = {"గారికి": " కి", "గారికీ": " కీ", "గారితో": " తో", "గారిని": " ని", "గారినుంచి": " నుంచి", "gariki": " కి", "gaariki": " కి", "garitho": " తో", "gaaritho": " తో"}
_ANDI_WORD = re.compile(r"[,\s]*(?<![ఀ-౿])(?:అండీ|అండి|andi)(?![ఀ-౿])", re.IGNORECASE)
_ANDI_ENDINGS = (("ందండీ", "ంది"), ("ందండి", "ంది"), ("సరేనండీ", "సరే"), ("సరేనండి", "సరే"), ("అవునండీ", "అవును"), ("అవునండి", "అవును"), ("లేదండీ", "లేదు"), ("లేదండి", "లేదు"))


def honorifics_in(text: str) -> int:
    """How many honorifics ("గారు", "గారి", "గారికి", garu ...) a line holds as words of their own: what `soften` would take out."""
    return len(_GARU.findall(text))


def soften(text: str, tone: str, language: str) -> str:
    """Friendly and casual: no 'గారు'. Casual (Telugu): also no 'అండీ' (the standalone particle, and the joined forms of the common words). Respectful: unchanged."""
    tone = usable(tone, language)
    if tone == "respectful" or language != "te" and language != "en":
        return text
    out = _GARU.sub(lambda m: _KEEP.get(m.group(0).strip(), ""), text)   # the honorific goes; the case ending it carried (కి, తో, ని) stays on the name
    if tone == "casual":
        for joined, plain in _ANDI_ENDINGS:
            out = out.replace(joined, plain)
        out = _ANDI_WORD.sub("", out)
    return re.sub(r"\s{2,}", " ", out).strip() or text
