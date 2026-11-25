"""\"Say 'AI assistant' when greeting\" (owner decision of 20 Nov 2026, docs/contracts/greeting-disclosure.md): a SETTING, default OFF = the name only ("Hello, this is Priya from Sri Sai Homes"); a job may override it; in EVERY mode a customer who asks whether
they speak to a person, a robot or an AI gets the truthful answer, never a claim to be human. Offline: lines built by code, no model call, no key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.opening import greeting, honesty, render
from app.opening.honesty import ensure_honest, honest_answer, is_identity_question
from app.opening.resolve import say_ai_setting
from app.tasks import compose
from app.telephony import gate, persona, plivo_outbound
from app.telephony import tone as tone_mod
from app.telephony.gate import Hours, OutboundFacts, Settings
from app.telephony.phone_llm import PhoneLlm

LANGS = ("en", "te", "hi", "kn", "ta", "ml", "mr")
ASKS = ("te", "hi", "kn", "en", "ta", "ml", "mr")
IST = ZoneInfo("Asia/Kolkata")


# ---- the setting and its resolver -------------------------------------------------------------------------------------------------------------------


def test_the_resolver_follows_the_job_then_the_business_then_off() -> None:
    f = greeting.resolve_greeting_disclosure
    assert f(None) is True and f(None, None) is True and f(None, "business") is True, "default ON (the lawyer's opinion, 25 Nov 2026)"
    assert f(True) is True and f(True, "business") is True and f(False, "business") is False
    assert f(False, "on") is True and f(None, "on") is True and f(True, "off") is False and f(None, "off") is False
    assert f(True, "nonsense") is True and f(False, "nonsense") is False, "an unknown word follows the business"
    assert greeting.JOB_OVERRIDES == ("business", "on", "off")


def test_the_setting_is_read_from_the_talk_training_document_and_an_unreadable_one_is_on() -> None:
    undertaking = {"ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}}
    assert greeting.setting_of({"say_ai_when_greeting": True}) is True and greeting.setting_of({"say_ai_when_greeting": False, **undertaking}) is False
    assert greeting.setting_of({"say_ai_when_greeting": False}) is None, "an OFF without the stored undertaking is read as not chosen (ON)"
    assert greeting.setting_of({}) is None and greeting.setting_of(None) is None and greeting.setting_of({"say_ai_when_greeting": "yes"}) is None
    repo = SimpleNamespace(get=lambda token, tenant: {"doc": {"say_ai_when_greeting": True}})
    assert greeting.from_repo(repo, "t", "x") is True and greeting.from_repo(repo, "t", "x", "off") is False

    def boom(token: str, tenant: object) -> dict[str, object]:
        raise RuntimeError("down")

    assert greeting.from_repo(SimpleNamespace(get=boom), "t", "x") is True and greeting.from_repo(None, "t", "x") is True
    ctx = SimpleNamespace(principal=SimpleNamespace(token="t"), tenant=SimpleNamespace(id="x"))
    assert say_ai_setting(SimpleNamespace(talk_training=repo), ctx) is True and say_ai_setting(SimpleNamespace(talk_training=None), ctx) is True  # type: ignore[arg-type]


# ---- the greeting follows the setting: calls ---------------------------------------------------------------------------------------------------------


def test_the_example_of_the_owner_the_name_only() -> None:
    assert persona.opening_line("en", business="Sri Sai Homes", assistant="Priya", customer=None, inbound=True, mention_ai=False) == "Hello, this is Priya from Sri Sai Homes. How can I help you?"
    assert "AI assistant" in persona.opening_line("en", business="Sri Sai Homes", assistant="Priya", customer=None, inbound=True, mention_ai=True)


@pytest.mark.parametrize("language", LANGS)
def test_an_inbound_call_says_ai_only_when_the_setting_is_on(language: str) -> None:
    off = persona.opening_line(language, business="Sri Sai Homes", assistant="Priya", customer=None, inbound=True, mention_ai=False)
    on = persona.opening_line(language, business="Sri Sai Homes", assistant="Priya", customer=None, inbound=True, mention_ai=True)
    assert not render.says_ai(off) and "Sri Sai Homes" in off and "Priya" in off, language
    assert render.says_ai(on) and gate.has_ai_disclosure(on) and off != on, language
    assert gate.has_ai_disclosure(on), "ON keeps the words the gate and the disclosure test know"


def test_with_the_setting_on_the_standard_opening_words_are_exactly_as_they_were() -> None:
    # (the pin of 20 Nov 2026, rewritten: the words are unchanged when the setting is ON; the default is no longer "always")
    assert persona.INBOUND_OPENING["en"] == "Hello, I'm {assistant}, the AI assistant from {business}. How can I help you?"
    assert persona.INBOUND_OPENING["te"] == "హలో, నేను {business} నుంచి {assistant}, AI అసిస్టెంట్‌ని. చెప్పండి, నేను మీకు ఎలా help చేయగలను?"
    assert tone_mod.opener("en", "friendly") == "Hello, this is the AI assistant of {business}. Is this a good time to talk?"
    assert tone_mod.opener("te", "friendly") == "హలో, నేను {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?"
    assert tone_mod.honest_line("en", "friendly") == "Yes, I'm an AI assistant." and tone_mod.honest_line("te", "friendly") == "అవును, నేను AI assistant ని."


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn", "ta", "ml", "mr"])
@pytest.mark.parametrize("kind", ["test", "goal", "task"])
def test_a_call_we_place_says_ai_only_when_the_setting_is_on(language: str, kind: str) -> None:
    off = plivo_outbound.opening_for(kind, language, "friendly", None, False)
    on = plivo_outbound.opening_for(kind, language, "friendly", None, True)
    assert off and on and "{business}" in off and "{business}" in on
    assert not render.says_ai(off) and render.says_ai(on) and off != on, (language, kind)
    for tone in ("respectful", "quick") if kind != "test" else ():
        plain = plivo_outbound.opening_for(kind, language, tone, None, False)
        assert plain and not render.says_ai(plain), (language, tone)


def test_the_tone_openers_in_telugu_and_english_are_plain_when_off_and_differ_by_tone() -> None:
    for language in ("te", "en"):
        plain = {t: tone_mod.opener(language, t, None, False) or "" for t in tone_mod.CHOICES}
        assert len(set(plain.values())) == 3 and all("{business}" in p and not render.says_ai(p) for p in plain.values()), language
    assert persona.opening_line("te", business="B", assistant=None, customer=None, owner_line=plivo_outbound.opening_for("goal", "te", "friendly", None, False), inbound=False, mention_ai=False).count("AI") == 0
    assert "AI" in persona.opening_line("te", business="B", assistant=None, customer=None, owner_line=plivo_outbound.opening_for("goal", "te", "friendly", None, True), inbound=False, mention_ai=True)


def test_the_opening_line_resolver_and_the_previews_follow_the_same_setting() -> None:
    off = render.compose_opening("en", owner_line=None, mention_ai=False, assistant="Priya", business="Sri Sai Homes")
    on = render.compose_opening("en", owner_line=None, mention_ai=True, assistant="Priya", business="Sri Sai Homes")
    assert off.startswith("Hello, this is Priya from Sri Sai Homes.") and "AI" not in off and "AI assistant" in on
    own = "Namaste {customer}, Priya here from {business}."
    assert render.compose_opening("en", owner_line=own, mention_ai=False, assistant="Priya", business="B") == "Namaste, Priya here from B.", "the Owner's own words as they are"
    assert render.compose_opening("en", owner_line=own, mention_ai=True, assistant="Priya", business="B").endswith(render.DISCLOSURE["en"])


# ---- the outbound gate follows the resolved setting ------------------------------------------------------------------------------------------------


def _facts(opening: str, say_ai: bool) -> OutboundFacts:
    return OutboundFacts(number="+919876543210", purpose="visit_reminder", now=datetime(2026, 11, 3, 11, 0, tzinfo=IST), hours=Hours(days=[1, 2, 3, 4, 5, 6], from_minute=9 * 60, to_minute=20 * 60),
                         approval="plan", approval_valid=True, can_contact=True, dnd="no", opening_line=opening, say_ai=say_ai)


def test_the_gate_requires_the_ai_words_only_when_the_setting_is_on() -> None:
    sandbox = Settings(mode="sandbox", sandbox_numbers=frozenset({"+919876543210"}))
    plain, spoken = "Hello, this is Priya from Sri Textiles. Is this a good time to talk?", "Hello, this is the AI assistant of Sri Textiles. Is this a good time to talk?"
    assert gate.check_outbound(sandbox, _facts(plain, False)) == gate.Allowed(promotional=False), "OFF: not required"
    assert gate.check_outbound(sandbox, _facts(spoken, False)) == gate.Allowed(promotional=False), "OFF and said anyway: fine"
    refused = gate.check_outbound(sandbox, _facts(plain, True))
    assert isinstance(refused, gate.Refused) and refused.reason == "no_ai_disclosure", "ON: required"
    assert gate.check_outbound(sandbox, _facts(spoken, True)) == gate.Allowed(promotional=False)
    assert OutboundFacts.__dataclass_fields__["say_ai"].default is True, "a caller that forgets to say keeps the stricter rule"
    assert replace(_facts(plain, True), say_ai=False).say_ai is False


def test_the_gate_still_recognises_the_ai_words_in_every_language() -> None:
    for text in ("this is the AI assistant", "నేను AI assistant ని", "मैं AI असिस्टेंट हूँ", "ನಾನು AI assistant"):
        assert gate.has_ai_disclosure(text), text


# ---- WhatsApp -----------------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn", "ta", "ml"])
def test_a_whatsapp_opening_says_ai_only_when_the_setting_is_on(language: str) -> None:
    for make in (compose.ask_text, compose.summary_text):
        off, on = make(language, "Sri Sai Homes"), make(language, "Sri Sai Homes", True)
        assert "Sri Sai Homes" in off and not render.says_ai(off) and render.says_ai(on) and off != on, (make.__name__, language)
        assert make(language, "Sri Sai Homes", False) == off, "the default is OFF"


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn"])
def test_the_consent_message_says_ai_only_when_the_setting_is_on(language: str) -> None:
    off, on = compose.consent_ask_text(language, "Sri Sai Homes"), compose.consent_ask_text(language, "Sri Sai Homes", True)
    assert not render.says_ai(off) and render.says_ai(on) and "STOP" in off and "OK" in off and "STOP" in on, language


# ---- the honest answer: the same in both settings, in code ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("language", ASKS)
def test_the_question_is_detected_in_every_call_language_and_the_answer_is_truthful(language: str) -> None:
    asks = honesty.eval_set()["ask"][language]
    assert asks and all(is_identity_question(q) for q in asks), language
    answer = honest_answer(language, "Sri Sai Homes")
    assert "AI assistant" in answer and "Sri Sai Homes" in answer and not honesty.claims_to_be_human(answer), language
    for statement in honesty.eval_set()["not_ask"][language]:
        assert not is_identity_question(statement), statement


class _Model:
    def __init__(self) -> None:
        self.asked = 0

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.asked += 1
        yield "I am a real person, no robot here."


async def _ask(llm: PhoneLlm, question: str) -> str:
    return "".join([c async for c in llm.stream("s", [{"role": "user", "content": question}], "m")])


@pytest.mark.parametrize("language", ["te", "hi", "kn", "en"])
def test_the_phone_answers_the_question_by_code_and_never_asks_the_model(language: str) -> None:
    for question in honesty.eval_set()["ask"][language][:3]:
        inner = _Model()
        said = asyncio.run(_ask(PhoneLlm(inner, "Sri Sai Homes", lambda: language), question))
        assert said == persona.HONEST_AI[language] and inner.asked == 0 and "AI" in said, (language, question)


@pytest.mark.parametrize("language", ["te", "hi", "kn", "en"])
def test_whatsapp_answers_the_question_truthfully_whatever_the_model_planned(language: str) -> None:
    question = honesty.eval_set()["ask"][language][0]
    honest, honest_en = honest_answer(language, "Sri Sai Homes"), honest_answer("en", "Sri Sai Homes")
    # the model claimed to be human: replaced
    assert ensure_honest(question, "I am a real person.", "I am a real person.", language, "Sri Sai Homes") == (honest, honest_en)
    # the model said nothing about it: the honest answer goes first, the plan follows
    said, gloss = ensure_honest(question, "Our shop opens at ten.", "Our shop opens at ten.", language, "Sri Sai Homes")
    assert said.startswith(honest) and said.endswith("Our shop opens at ten.") and gloss.startswith(honest_en)
    # it already said it is an AI: left as it is
    assert ensure_honest(question, "Yes, an AI assistant.", "Yes, an AI assistant.", language, "B") == ("Yes, an AI assistant.", "Yes, an AI assistant.")
    # not the question: untouched
    assert ensure_honest("What time do you open?", "At ten.", "At ten.", language, "B") == ("At ten.", "At ten.")


def test_the_prompts_of_every_customer_facing_surface_carry_the_honesty_rule() -> None:
    from app.autoreply.drafter import build_prompt
    from app.opening.honesty import HONESTY_RULE

    system, _ = build_prompt({"business": "Sri Sai Homes", "assistant_name": "Priya", "facts": [], "history": [{"who": "customer", "text": "are you a robot?"}]}, "en")
    assert HONESTY_RULE in system
    for setting in (False, True):
        prompt = persona.system_prompt(business="Sri Sai Homes", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None, opening_says_ai=setting)
        assert "HONESTY" in prompt and "Never claim to be human" in prompt, setting
    assert "NOT say that you are an AI" in persona.system_prompt(business="B", assistant="P", language="en", purpose="inbound", facts=[], customer_first_name=None, opening_says_ai=False)


def test_no_inbound_opening_asks_the_person_who_rang_us_for_their_time() -> None:
    """26 Nov 2026: a caller who rang the shop is asked how we can help, never "do you have a minute?" (the outbound question).  Telugu too since 28 Nov 2026: the owner's own wording."""
    outbound_questions = ("ఒక నిమిషం మాట్లాడొచ్చా", "Do you have a minute", "एक मिनट बात कर सकते", "ಒಂದು ನಿಮಿಷ ಮಾತಾಡಬಹುದಾ", "ஒரு நிமிஷம் பேசலாமா", "ഒരു മിനിറ്റ് സംസാരിക്കാമോ", "एक मिनिट बोलू शकतो का")
    for table in (persona.INBOUND_OPENING, persona.PLAIN_INBOUND_OPENING):
        for language, text in table.items():
            assert not any(q in text for q in outbound_questions), (language, text)
    assert persona.PLAIN_INBOUND_OPENING["te"].endswith("చెప్పండి, నేను మీకు ఎలా help చేయగలను?")
    assert persona.PLAIN_INBOUND_OPENING["en"].endswith("How can I help you?") and persona.INBOUND_OPENING["en"].endswith("How can I help you?")
