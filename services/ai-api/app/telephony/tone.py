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


def tone_keyword(goal: str | None) -> str | None:
    """The tone an Owner's test-call goal asks for in WORDS, or None when it says nothing about tone."""
    text = goal or ""
    if _RESPECTFUL.search(text):
        return "respectful"
    if _CASUAL.search(text):
        return "casual"
    return None


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
    "respectful": "నమస్కారం అండి, నేను {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "friendly": "హలో, నేను {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?",
    "casual": "హాయ్! నేను {business} AI assistant ని. ఒక్క నిమిషం మాట్లాడతావా?",
}
OPENERS_EN = {
    "respectful": "Hello, this is the AI assistant of {business}. Is this a good time to talk?",
    "friendly": "Hello, this is the AI assistant of {business}. Is this a good time to talk?",
    "casual": "Hey! I'm the AI assistant of {business}. Got a minute to chat?",
}
HONEST_TE = {   # "are you a robot / a person?": honest, and no promise in it (the inbound line says "I will get your work done")
    "respectful": "అవును అండి, నేను AI assistant ని.",
    "friendly": "అవును, నేను AI assistant ని.",
    "casual": "అవును, నేను AI assistant ని, మనిషిని కాదు.",
}
HONEST_EN = {"respectful": "Yes, I'm an AI assistant.", "friendly": "Yes, I'm an AI assistant.", "casual": "Yes, I'm an AI assistant, not a person."}
CHECK_IN_TE = {"respectful": "హలో, ఉన్నారా అండి?", "friendly": "హలో, ఉన్నారా?", "casual": "హలో, ఉన్నావా?"}
BYE_TE = {"respectful": "సరే, thank you, bye!", "friendly": "సరే, thank you, bye!", "casual": "సరే, thanks, bye bye!"}
BYE_EN = {"respectful": "Okay, thank you, bye!", "friendly": "Okay, thanks, bye!", "casual": "Okay, cool, bye!"}
INTERRUPTED_TE = {"respectful": "ఆ, చెప్పండి", "friendly": "ఆ, చెప్పండి", "casual": "ఆ, చెప్పు"}
ACKS_TE = {"respectful": "సరే / అలాగా / అవునా / అవును అండి", "friendly": "సరే / అలాగా / అవునా", "casual": "ఓహో / సరే / అవునా"}
CANT_TE = {   # the true line said instead of any promise (promises.py), and a model example of "I can't arrange that"
    "respectful": "అది నేను ఈ కాల్ లో చేయలేను.",
    "friendly": "అది నేను ఈ కాల్ లో చేయలేను.",
    "casual": "అది నేను ఈ కాల్ లో చేయలేను.",
}
CANT_EN = "I can't arrange that on this call."
QUESTION_TE = {"respectful": "మీరు ఈ నెల stock గురించి ఏమైనా చూశారా?", "friendly": "మీరు ఈ నెల stock గురించి ఏమైనా చూశారా?", "casual": "నువ్వు ఈ నెల stock గురించి ఏమైనా చూశావా?"}
ONLY_PARENTS_TE = {   # the whole answer to a person who is not the one the goal allows to hear it: no subject, no marks, nothing else
    "respectful": "ఈ విషయం parents తో మాత్రమే మాట్లాడగలం అండి.",
    "friendly": "ఈ విషయం parents తో మాత్రమే మాట్లాడగలం.",
    "casual": "ఈ విషయం parents తో మాత్రమే మాట్లాడగలం.",
}
CLOSE_TE = {"respectful": "సరే అండి, ఇంకేమైనా ఉంటే చెప్పండి.", "friendly": "సరే, ఇంకేమైనా ఉంటే చెప్పండి.", "casual": "సరే, ఇంకేమైనా ఉంటే చెప్పు."}   # the short closing line BEFORE the goodbye
AS_THE_SCHOOL_TE = {
    "respectful": "నా దగ్గర ఈ marks మాత్రమే ఉన్నాయి అండి; class teacher ఎక్కువ చెప్పగలరు.",
    "friendly": "నా దగ్గర ఈ marks మాత్రమే ఉన్నాయి; class teacher ఎక్కువ చెప్పగలరు.",
    "casual": "నా దగ్గర ఈ marks మాత్రమే ఉన్నాయి; class teacher నీకు ఎక్కువ చెప్పగలరు.",
}
ACK_LINE_TE = {"respectful": "సరే, అర్థమైంది.", "friendly": "సరే, అర్థమైంది.", "casual": "ఓహో, సరే, అర్థమైంది."}

# ---- the instructions the model reads (English), per tone; Telugu has its own because that is where the register was wrong
RULES = {
    "respectful": (
        "TONE: respectful and polite, still spoken and natural. Use the polite 'మీరు' forms and polite wording. Use the particle 'అండి' only at NATURAL points: the greeting, a thank-you, a request, the goodbye; "
        "NOT at the end of most sentences, and never twice in a row (a request such as 'చెప్పండి' already carries the politeness). Never 'గారు' and no honorific for a child, never a gendered word of address."
    ),
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
    chosen: [OPENERS_TE[chosen], QUESTION_TE[chosen], ACK_LINE_TE[chosen] + " ఇంకొక విషయం అడగొచ్చా?", CANT_TE[chosen], AS_THE_SCHOOL_TE[chosen], ONLY_PARENTS_TE[chosen], CLOSE_TE[chosen], BYE_TE[chosen]]
    for chosen in TONES
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
_GIRL = re.compile(r"\b(?:girl|daughter|her\s+(?:marks|result|exam)|she\b)|అమ్మాయి|కూతురు|కుమార్తె", re.IGNORECASE)


def child_is_boy(goal: str | None) -> bool:
    """True only when the owner's goal itself says the child is a boy. Otherwise the child is called by name; we never guess a child's gender."""
    return bool(_BOY.search(goal or "")) and not _GIRL.search(goal or "")


def child_is_girl(goal: str | None) -> bool:
    return bool(_GIRL.search(goal or "")) and not _BOY.search(goal or "")


# words that must never name a child in a Respectful call (owner, 11 Nov 2026): the metric counts them (data/bookish.json "child_terms")
def child_reference(goal: str | None, chosen: str) -> str:
    """The prompt sentence about naming the child. Respectful: the name, or "మీ అబ్బాయి" / "మీ అమ్మాయి" when the goal makes the gender clear; NEVER వాడు, వాడి, వాడిని, పిల్లవాడు, పిల్లవాడి, అది. Friendly and Casual: the name, or "వాడు" when the goal says it is a boy."""
    boy, girl = child_is_boy(goal), child_is_girl(goal)
    if chosen == "respectful":
        word = "\"మీ అబ్బాయి\"" if boy else "\"మీ అమ్మాయి\"" if girl else None
        use = f"refer to the child by NAME, or {word}" if word else "refer to the child by NAME only (the goal does not make the child's gender clear: no \"మీ అబ్బాయి\", no \"మీ అమ్మాయి\")"
        return use + "; NEVER \"వాడు\", \"వాడి\", \"వాడిని\", \"పిల్లవాడు\", \"పిల్లవాడి\", \"అది\" or \"ఆయన\" for the child"
    if boy:
        return "refer to the child by name, or with \"వాడు\" (the goal says it is a boy)"
    return "refer to the child by NAME only (you do not know the child's gender: no \"వాడు\", no \"ఆయన\")"


def spoken_telugu_rules(goal: str | None = None, chosen: str = DEFAULT_TONE) -> str:
    """The SPOKEN TELUGU block of a Telugu goal call (owner, 11 Nov 2026, after the school role-play calls: the Telugu was written, not spoken). Same vocabulary rule in every tone."""
    from app.agents import register

    return (
        "SPOKEN TELUGU, not written Telugu: short sentences people really say on the phone. When you speak for the organisation say \"మేము\" (never \"school వారు\" or a third person); "
        f"{child_reference(goal, chosen)}, and never with an honorific; keep common English words in English (parents, marks, school, maths, science, thanks, OK); say the organisation's name ONCE in the call; "
        "the goodbye is one short line. " + register.bookish_rules("te")
    )


def register_rules(language: str, tone: str, goal: str | None = None) -> str:
    """The tone paragraph of the prompt; examples (Telugu) follow as 'copy the register, never a fact'."""
    tone = usable(tone, language)
    if language == "te":
        shots = "\n".join(f"  * {line}" for line in EXAMPLES_TE[tone])
        return f"{RULES[tone]}\n{spoken_telugu_rules(goal, tone)}\nExamples of this tone (copy the register only, never a fact; they are drafts for a native reader):\n{shots}"
    if language == "en":
        return RULES_EN[tone]
    return ""


# ---- what is SPOKEN (code, after the model): the particles a tone does not allow are taken out of the line
_GARU = re.compile(r"(?:\s+|\u200c|(?<![\u0C00-\u0C7F\s]))(?:గారు|గారూ|గారి(?:కి|ని|తో|కీ|నుంచి|యొక్క|ది|దే)?(?![\u0C00-\u0C7F]))|\s+(?:garu|gaaru|gari|gaariki|gaaritho)\b", re.IGNORECASE)   # every case form of the honorific, as a word of its own OR glued to a Latin-script name (Yashreddyగారి); never inside a Telugu word ("బంగారు")
_KEEP = {"గారికి": " కి", "గారికీ": " కీ", "గారితో": " తో", "గారిని": " ని", "గారినుంచి": " నుంచి", "gariki": " కి", "gaariki": " కి", "garitho": " తో", "gaaritho": " తో"}
_ANDI_WORD = re.compile(r"[,\s]*(?<![ఀ-౿])(?:అండీ|అండి|andi)(?![ఀ-౿])", re.IGNORECASE)
_ANDI_ENDINGS = (("ందండీ", "ంది"), ("ందండి", "ంది"), ("సరేనండీ", "సరే"), ("సరేనండి", "సరే"), ("అవునండీ", "అవును"), ("అవునండి", "అవును"), ("లేదండీ", "లేదు"), ("లేదండి", "లేదు"))


def _name_before(text: str, at: int) -> str:
    """The word just before position `at` (the name an honorific is glued to or follows)."""
    found = re.search(r"([^\s,;:.!?()\"']+)[\s\u200c]*$", text[:at])
    return found.group(1).strip().casefold() if found else ""


def _is_the_addressed_name(word: str, addressed: str | None) -> bool:
    """True when `word` is the addressed person's own name (their first name, or any word of their name; case does not matter)."""
    if not addressed or not word:
        return False
    return word in {part.casefold() for part in re.split(r"[\s,.]+", addressed) if part}


def strip_honorifics(text: str, tone: str, language: str, addressed_name: str | None = None) -> tuple[str, int]:
    """Take the honorific ("గారు", "గారి", "గారికి" ...) out of a line and say HOW MANY were taken out (the number a call reports is exactly this). It survives ONLY in the Respectful tone and ONLY directly after the
    addressed person's own name ("Ramesh గారు"); a child, a third person, anyone else, and every other tone lose it (owner decision, 11 Nov 2026)."""
    tone = usable(tone, language)
    if language not in ("te", "en"):
        return text, 0
    stripped = 0

    def one(m: re.Match[str]) -> str:
        nonlocal stripped
        if tone == "respectful" and _is_the_addressed_name(_name_before(m.string, m.start()), addressed_name):
            return m.group(0)
        stripped += 1
        return _KEEP.get(m.group(0).strip(), "")   # the case ending it carried (కి, తో, ని) stays on the name

    return _GARU.sub(one, text), stripped


def honorifics_in(text: str, tone: str = DEFAULT_TONE, language: str = "te", addressed_name: str | None = None) -> int:
    """How many honorifics `soften` would take out of this line."""
    return strip_honorifics(text, tone, language, addressed_name)[1]


def soften(text: str, tone: str, language: str, addressed_name: str | None = None) -> str:
    """The honorific only after the addressed person's own name in Respectful, nowhere else; Casual (Telugu): also no 'అండీ' (the standalone particle, and the joined forms of the common words)."""
    tone = usable(tone, language)
    if language != "te" and language != "en":
        return text
    out, _ = strip_honorifics(text, tone, language, addressed_name)
    if tone == "casual":
        for joined, plain in _ANDI_ENDINGS:
            out = out.replace(joined, plain)
        out = _ANDI_WORD.sub("", out)
    return re.sub(r"\s{2,}", " ", out).strip() or text


# ---- how a tone addresses the person (owner, 11 Nov 2026: "How to address customers" is folded into Tone)
_MALE = re.compile(r"\b(?:father|dad|uncle|grandfather|brother|mr\.?|sir|he\b|his\b|gentleman)|తండ్రి|నాన్న|అంకుల్|అన్న|తాత", re.IGNORECASE)
_FEMALE = re.compile(r"\b(?:mother|mom|mum|aunt(?:y)?|grandmother|sister|mrs\.?|ms\.?|madam|ma'am|she\b|her\b|lady)|తల్లి|అమ్మ|ఆంటీ|అక్క|అమ్మమ్మ", re.IGNORECASE)


def addressee_gender(goal: str | None, contact_gender: str | None = None) -> str | None:
    """"male" or "female" only when the CONTACT record says so, or the goal says who is being called (father, mother, uncle ...); else None: no title is used."""
    if contact_gender in ("male", "female"):
        return contact_gender
    text = goal or ""
    male, female = bool(_MALE.search(text)), bool(_FEMALE.search(text))
    return "male" if male and not female else "female" if female and not male else None


def addressing_rule(chosen: str, language: str, name: str | None = None, gender: str | None = None) -> str:
    """The prompt paragraph that says how to address the person, per tone."""
    if chosen == "respectful":
        who = (f"The person you are calling is named {name}: address them as \"{name} గారు\" (the honorific ONLY directly after their own name, and not in every sentence); " if name else
               "You do not know the person's name: ")
        title = ("you may use \"sir\" (for a man) or \"madam\" (for a woman) SPARINGLY when the name is unknown and the gender is clear (here: " + (gender or "unknown") + "): at most twice in the whole call, never in consecutive sentences"
                 if gender and not name else "use no title (no sir, no madam) because " + ("the name is known" if name else "the gender is not known"))
        return ("ADDRESSING PEOPLE (respectful): use the polite 'మీరు' forms. " + who + title + ". A child or any third person is called by NAME, or \"మీ అబ్బాయి\" / \"మీ అమ్మాయి\" when the gender is clear from the goal; "
                "never \"గారు\", never \"వాడు\", \"అది\" or \"ఆయన\" for them.")
    use = f" Use their name ({name}) at most once in the call." if name else ""
    return ("ADDRESSING PEOPLE: use the 'మీరు' forms, no \"గారు\", no sir, no madam, no title of any kind." + use if chosen == "friendly" else
            "ADDRESSING PEOPLE: casual, the informal 'నువ్వు'; no \"గారు\", no sir, no madam, no title of any kind." + use)


_PARTICLE = re.compile(r"అండీ|అండి|ండీ")   # the polite particle (the imperative ending -ండి of "చెప్పండి" is not counted)
_SENTENCE_END = re.compile(r"[.?!]+")


def particles_in(text: str) -> int:
    return len(_PARTICLE.findall(text))


def sentences_in(text: str) -> int:
    """How many sentences a spoken piece holds (a piece with no end mark is one)."""
    parts = [p for p in _SENTENCE_END.split(text) if p.strip()]
    return max(1, len(parts)) if text.strip() else 0
