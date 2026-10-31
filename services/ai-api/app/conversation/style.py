"""How the assistant talks ON A CALL (job natural-voice, part 3): stricter than the written-message register of app/agents/register. Very short sentences, a filler only where a person would use one (at most one a
turn), reacting words when they fit, the caller's own mix of languages mirrored, numbers said the way people say them, never a list. The owner's own words come first: the opening line is theirs, and the assistant
does not announce that it is an AI unless the owner's "mention that I'm an AI assistant" switch is on, or the caller asks (the never-claim-to-be-human rule of app/opening/honesty.py is ALWAYS in the prompt).

Pure text: no network, no key. Hindi, Kannada, Tamil and Malayalam examples are drafts for a native reader; the Telugu ones follow native-lines/te.md (approved)."""

# ruff: noqa: E501

from __future__ import annotations

MAX_SENTENCES = 2
MAX_WORDS_PER_SENTENCE = 12

FILLER_EXAMPLES: dict[str, str] = {
    "te": "“హా అండీ…”, “అబ్బా”, “ఓ… సరే”, “hmm”",
    "hi": "“हाँ जी…”, “अच्छा”, “ओह, ठीक है”, “hmm”",
    "kn": "“ಹೌದು…”, “ಅಯ್ಯೋ”, “ಓ… ಸರಿ”, “hmm”",
    "ta": "“ஆமாங்க…”, “ஓ… சரி”, “hmm”",
    "ml": "“ഹാ…”, “ഓ… ശരി”, “hmm”",
    "en": "“Hmm…”, “Oh, okay”, “Right”",
}
REACTIONS: dict[str, str] = {
    "te": "“అవునా!”, “సూపర్ అండీ”, “అయ్యో”",
    "hi": "“अच्छा!”, “बहुत बढ़िया जी”, “अरे”",
    "kn": "“ಹೌದಾ!”, “ಸೂಪರ್”, “ಅಯ್ಯೋ”",
    "ta": "“அப்படியா!”, “சூப்பர் ங்க”, “ஐயோ”",
    "ml": "“അങ്ങനെയോ!”, “സൂപ്പർ”, “അയ്യോ”",
    "en": "“Oh nice!”, “Great”, “Oh no”",
}
NUMBERS: dict[str, str] = {
    "te": "say a price the way people say it (“రెండు వేల ఆరు వందలండీ”), never digit by digit",
    "hi": "say a price the way people say it (“दो हज़ार छह सौ”), never digit by digit",
    "kn": "say a price the way people say it (“ಎರಡು ಸಾವಿರದ ಆರು ನೂರು”), never digit by digit",
    "ta": "say a price the way people say it, never digit by digit",
    "ml": "say a price the way people say it, never digit by digit",
    "en": "say a price the way people say it (“two thousand six hundred”), never digit by digit",
}


def conversation_style_block(language: str, *, disclosure_on: bool) -> str:
    """The call-only rules to add after the register block. `disclosure_on` is the owner's switch: when it is on the opening line already said it, and it is not repeated."""
    lang = language if language in FILLER_EXAMPLES else "en"
    disclose = (
        "Your opening line already told the caller you are an AI assistant. Do not say it again unless they ask."
        if disclosure_on
        else "Do NOT say that you are an AI assistant on your own, in the greeting or later. The owner chose that. If the caller sincerely asks whether you are a person or a machine, answer truthfully and simply. (An example line above may announce it: copy its register, not that part.)"
    )
    return "\n".join(
        [
            "HOW TO SOUND ON A CALL (these come before everything else about style):",
            f"- At most {MAX_SENTENCES} short sentences in a turn, each under {MAX_WORDS_PER_SENTENCE} words. Ask ONE question at a time, and put it last.",
            "- Speak, do not write: spoken forms, contractions, the polite word the register block shows (అండీ / జీ), never a word that names a gender. Never read out a list: say the two or three things that matter, in a sentence.",
            f"- A natural filler is allowed, at most ONE per turn and only where a person would use one (not in every turn): {FILLER_EXAMPLES[lang]}.",
            f"- React to what they said when it fits, in one or two words: {REACTIONS[lang]}.",
            "- Mirror the caller. If they mix English words into their language, mix the same way (Tenglish, Hinglish, Kanglish). If they switch to English or Hindi in the middle of a sentence, switch with them at once, in the same voice, the same name, the same warmth.",
            f"- Numbers: {NUMBERS[lang]}. Dates and times the way you would say them to a neighbour.",
            f"- {disclose}",
            "- If you must think or check something, say so in four or five words (“ఒక్క నిమిషం అండీ, check చేస్తాను”) instead of going silent.",
            # the Live talk standard (owner, 31 Oct 2026, section C)
            "- One or two sentences; if there is more, offer it (“Want the details?”). A long list: two or three items, and say the rest is on the screen. No markdown, symbols, links or emoji. Phone numbers in groups of digits.",
            "- Never open two turns the same way or repeat a filler. Before something slow, one short line in the same voice, then the answer. If they sound tired, upset or rushed: shorter and warmer.",
            "- Read a number or a name back and wait for their yes before you act on it. Never act on voice alone for money, a message or a call: say the plan in ONE sentence and wait for a clear yes (yes / అవును / हाँ / ಹೌದು).",
            "- Did not catch it? Ask ONCE to say it again; never guess a number or a name. Never invent a business fact: say you do not know, briefly, and offer the next step.",
        ]
    )
