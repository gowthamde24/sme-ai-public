"""A phone call's language, opening, brand and manner (owner, 6 Nov 2026, after test calls on the Telugu line):
- the call starts in the line's language and stays: "hello", fillers and code-mixed speech never switch it; a request, or a full sentence in another language twice in a row, does;
- the first sentence says it is an AI assistant, with the assistant's and the business's names from the workspace;
- "Stack19" is always said "Stack Nineteen" in English, never as a number or translated;
- the model is told the languages it speaks, the brand rule, honesty, tone mirroring and short spoken turns."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Any

import pytest

from app.pronunciation.speech import SpeechText
from app.telephony import language_rule, persona
from app.telephony.call_session import CallVoiceSession
from tests.test_dv_browser_voice import arun
from tests.test_nv_voices import Engine, build, run, speak


def follow(turns: list[str], start: str = "te") -> tuple[str, list[str]]:
    """The language after each turn, by the rule alone."""
    current, seen = start, []
    streak: tuple[str | None, int] = (None, 0)
    for text in turns:
        d = language_rule.decide(current, text, streak)
        streak = d.streak
        if d.switch_to:
            current = d.switch_to
        seen.append(current)
    return current, seen


# ---- the owner's cases ----------------------------------------------------------------------------------------------------------------------

def test_hello_then_telugu_stays_telugu() -> None:
    assert follow(["Hello", "నాకు పట్టు చీరల ధర తెలుసుకోవాలి"]) == ("te", ["te", "te"])


def test_hello_alone_stays_telugu() -> None:
    assert follow(["Hello"]) == ("te", ["te"])
    assert follow(["hello hello, can you hear me?", "ok", "Yes", "thank you", "sorry", "hmm", "haan"])[0] == "te", "greetings and fillers never switch"


@pytest.mark.parametrize("mixed", ["Price ఎంత?", "booking ఎప్పుడు చేయొచ్చు", "ఆ saree price ఎంత అండీ, delivery ఉందా?", "naaku booking kavali, price entha?"])
def test_code_mixed_telugu_is_telugu(mixed: str) -> None:
    assert language_rule.main_language(language_rule.content_words(mixed)) == "te"
    assert follow([mixed, mixed]) == ("te", ["te", "te"])


def test_a_full_hindi_sentence_twice_switches_to_hindi() -> None:
    hindi = "मुझे साड़ी की कीमत जाननी है"
    assert follow([hindi]) == ("te", ["te"]), "once is not enough"
    assert follow([hindi, "क्या आज डिलीवरी हो सकती है"]) == ("hi", ["te", "hi"]), "twice in a row switches"


def test_a_telugu_sentence_between_breaks_the_run() -> None:
    hindi = "मुझे साड़ी की कीमत जाननी है"
    assert follow([hindi, "సరే, తెలుగులో చెప్పండి ధర", hindi])[0] == "te"


@pytest.mark.parametrize("ask, lang", [("please speak English", "en"), ("English lo matladandi", "en"), ("हिंदी में बात करो", "hi"), ("Can you talk in Kannada?", "kn"),
                                       ("Tamil la pesunga please", "ta"), ("తెలుగులో మాట్లాడండి", "te")])
def test_asking_for_a_language_switches_at_once(ask: str, lang: str) -> None:
    start = "en" if lang == "te" else "te"
    assert follow([ask], start=start) == (lang, [lang])


def test_one_english_sentence_does_not_switch_but_two_do() -> None:
    assert follow(["I want to know the price of silk sarees"]) == ("te", ["te"])
    assert follow(["I want to know the price of silk sarees", "Do you deliver to Vijayawada?"])[0] == "en"


@arun
async def test_the_phone_session_follows_the_rule_and_logs_each_switch() -> None:
    session: Any = CallVoiceSession.__new__(CallVoiceSession)
    session.language = "te"
    switched: list[str] = []

    async def set_language(lang: str) -> None:
        switched.append(lang)
        session.language = lang

    session._set_language = set_language
    session._speakable = lambda lang: lang
    for text in ("Hello", "Price ఎంత?", "ok", "please speak English", "price of the silk saree"):
        await session._follow_language(text)
    assert switched == ["en"] and session.language_switches == [{"from": "te", "to": "en", "why": "request"}]


# ---- the opening and the disclosure ----------------------------------------------------------------------------------------------------------

def test_the_telugu_opening_is_the_owners_words_with_the_workspace_names() -> None:
    assert persona.opening_line("te", business="Stack19", assistant=None, customer=None, inbound=True) == "హలో, నేను Stack19 నుంచి Priya, AI అసిస్టెంట్‌ని. ఇప్పుడు ఒక నిమిషం మాట్లాడొచ్చా?"
    assert persona.opening_line("te", business="Padma Silks", assistant="Lakshmi", customer=None, inbound=True).startswith("హలో, నేను Padma Silks నుంచి Lakshmi, AI అసిస్టెంట్‌ని.")


@pytest.mark.parametrize("lang", ["te", "hi", "kn", "ta", "ml", "en", "mr"])
def test_the_ai_disclosure_is_in_the_first_sentence_in_every_language(lang: str) -> None:
    said = persona.opening_line(lang, business="Stack19", assistant="Priya", customer=None, inbound=True)
    assert "AI" in persona.first_sentence(said) and "Priya" in persona.first_sentence(said) and "Stack19" in persona.first_sentence(said)
    trained = persona.opening_line(lang, business="Stack19", assistant="Priya", customer=None, inbound=True, greeting="Welcome to {business}! How can we help?")
    assert "AI" in persona.first_sentence(trained), "a trained greeting without 'AI' gets the disclosure BEFORE it"
    own = persona.opening_line(lang, business="Stack19", assistant="Priya", customer=None, inbound=True, greeting="Hi, I am the AI assistant of {business}. Tell me.")
    assert own == "Hi, I am the AI assistant of Stack19. Tell me.", "a trained greeting that discloses first is used as it is"


@arun
async def test_the_call_uses_the_workspaces_names_from_the_line() -> None:
    from app.telephony import inbound_routes as R
    from tests.test_ph_inbound import TENANT, FakeStore, service, start

    store = FakeStore()
    store.line = {"tenant_id": str(TENANT), "inbound_on": True, "business": "Padma Silks", "assistant": "Lakshmi"}
    svc = service(store=store)
    svc.parts_for = None
    seen: dict[str, Any] = {}

    def fake_parts(bv: Any, business: str, language: str, llm_choice: str, training: Any = None, labels: Any = (), assistant: str | None = None, corrections: Any = ()) -> Any:
        seen.update(business=business, assistant=assistant)
        parts = type("P", (), {"greeting_for": lambda self, lang: "x", "tts": None})()
        return parts, "m"

    saved = R.phone_parts
    R.phone_parts = fake_parts  # type: ignore[assignment]
    try:
        await R._prepare(svc, None, start())
    finally:
        R.phone_parts = saved
    assert seen == {"business": "Padma Silks", "assistant": "Lakshmi"}


# ---- the brand ---------------------------------------------------------------------------------------------------------------------------

NUMBER_WORDS = re.compile(r"19|౧౯|१९|೧೯|పంతొమ్మిది|పందొమ్మిది|उन्नीस|ಹತ್ತೊಂಬತ್ತು|nineteen(?! )", re.IGNORECASE)


@pytest.mark.parametrize("lang, reply", [
    ("te", "Stack19 నుంచి మాట్లాడుతున్నాను, మీకు ఎలా సహాయం చేయగలను?"),
    ("te", "స్టాక్ 19 టీమ్ మీకు కాల్ చేస్తుంది."),
    ("te", "Stack పంతొమ్మిది నుంచి Priya ని."),
    ("hi", "मैं Stack 19 से बोल रही हूँ।"),
    ("hi", "स्टैक 19 की टीम आपको कॉल करेगी।"),
    ("kn", "ನಾನು Stack19 ಇಂದ ಮಾತಾಡ್ತಿದ್ದೀನಿ."),
    ("kn", "Stack-19 ಟೀಮ್ ಕಾಲ್ ಮಾಡುತ್ತೆ."),
])
def test_the_voice_is_given_stack_nineteen_never_digits_or_a_translated_number(lang: str, reply: str) -> None:
    for engine in ("cartesia", "sarvam_v4"):
        out = SpeechText().prepare(reply, lang, engine)
        assert "Stack Nineteen" in out, (engine, out)
        assert not NUMBER_WORDS.search(out.replace("Stack Nineteen", "")), (engine, out)


def test_both_voice_engines_receive_stack_nineteen_through_the_call_voice() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = build(primary, fallback)
    tts.begin_turn()
    run(speak(tts, "నేను Stack19 AI అసిస్టెంట్‌ని.", "te"))
    assert "Stack Nineteen" in primary.calls[0][0]
    down = build(Engine("c", "error"), fallback)
    down.begin_turn()
    run(speak(down, "मैं Stack 19 से हूँ।", "hi"))
    assert "Stack Nineteen" in fallback.calls[-1][0], "Sarvam is given the same English brand"


# ---- what the model is told -----------------------------------------------------------------------------------------------------------------

def test_the_model_is_told_the_languages_the_brand_honesty_tone_and_short_turns() -> None:
    prompt = persona.system_prompt(business="Stack19", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None)
    for words in ("NEVER say you cannot speak", "Telugu, Kannada, Tamil, Malayalam, Hindi, English and Marathi", 'written exactly "Stack19"', "Never translate it", "never write its number as a word",
                  "నేను AI అసిస్టెంట్‌ని అండీ", "Never claim to be human", "Mirror the caller", "friendly shop assistant", "NOT in every sentence", "INTERRUPTED", "ఆ, చెప్పండి", "[END]", "సరే అండీ, bye!", "about 25 words", "ONE question", "own script"):
        assert words in prompt, words
    assert "Speak Telugu" in prompt


def test_the_language_rule_never_reads_the_words_into_a_log() -> None:
    import inspect

    src = inspect.getsource(CallVoiceSession._follow_language)
    assert "text" not in src.split("log.info(", 1)[1].split(")", 1)[0], "only codes and the reason are logged"



# ---- how a call ends (owner, 6 Nov 2026) ------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("said", ["ok bye", "ఓకే బాయ్", "థాంక్స్, బాయ్!", "సరే, ఉంటాను", "ఉంటానండి", "ठीक है जी, बाय", "ठीक है, रखता हूँ", "ಸರಿ, ಓಕೆ ಬಾಯ್!", "thanks, bye"])
def test_the_ways_people_say_bye_end_the_call(said: str) -> None:
    from app.conversation.turntaking import is_goodbye

    assert is_goodbye(said)


@pytest.mark.parametrize("said", ["నేను ఇంట్లో ఉంటాను", "నాకు బాయ్ ఫ్రెండ్ కోసం చీర కావాలి", "sare", "avunu", "ok"])
def test_words_that_only_look_like_bye_do_not(said: str) -> None:
    from app.conversation.turntaking import is_goodbye

    assert not is_goodbye(said)


@pytest.mark.parametrize("lang", ["te", "hi", "kn", "ta", "ml", "mr", "en"])
def test_the_closing_words_are_a_natural_bye_never_a_literal_one(lang: str) -> None:
    for line in (persona.CALL_BYE[lang], persona.CALL_BYE_QUIET[lang]):
        assert "bye" in line.casefold() and "మంచిరోజు" not in line and "शुभ" not in line
    assert persona.CALL_BYE["te"] == "సరే అండీ, bye!" and persona.CALL_CHECK_IN["te"] == "హలో, ఉన్నారా?"
    assert CallVoiceSession.silence_s == (4.0, 8.0), "about 4 s quiet: one check; about 8 s in all: bye and hang up"


@arun
async def test_the_end_mark_is_never_spoken_and_ends_the_call_after_the_line() -> None:
    from app.telephony.phone_llm import PhoneLlm

    class Model:
        async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
            for piece in ("సరే అండీ, ", "bye! [E", "ND]"):
                yield piece

    events: list[str] = []
    llm = PhoneLlm(Model(), "Stack19", lambda: "te", on_event=events.append)
    said = "".join([p async for p in llm.stream("s", [{"role": "user", "content": "ఇంక చాలు అనుకుంటా"}], "m")])
    assert said == "సరే అండీ, bye! " and events == ["end"], "the mark is cut out even when it arrives in pieces, and the call ends after the line"

    class Plain:
        async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
            for piece in ("ధర [", "team] చెప్తారు"):
                yield piece

    events.clear()
    llm = PhoneLlm(Plain(), "Stack19", lambda: "te", on_event=events.append)
    assert "".join([p async for p in llm.stream("s", [{"role": "user", "content": "ధర?"}], "m")]) == "ధర [team] చెప్తారు" and events == [], "a bracket that is not the mark is spoken"
