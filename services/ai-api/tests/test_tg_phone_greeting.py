"""A phone call opens with the Owner's saved Talk training greeting, in every language the call may start in, and with the standard opening when none is saved (owner, 10 Nov 2026).

Pinned end to end, from the saved training (what the phone server reads for the call) to the words the caller hears and the model is told were already said: the greeting for the call's language is used; another
language's greeting is not; a greeting that does not say "AI" in its first sentence follows the standard first sentence (the AI mention is unchanged: job 2 decides whether it can be switched); {business} and
{assistant} are filled; with nothing saved, or the training unreadable, the call still opens with the standard line."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.browser_voice.limits import Ledger, Limits
from app.browser_voice.runtime import BrowserVoice
from app.conversation.fakes import FakeTts
from app.conversation.voices import default_config
from app.telephony import gate, persona
from app.telephony.inbound_routes import InboundService, _prepare_for, phone_parts
from tests.test_dv_browser_voice import arun
from tests.test_ph_inbound import FakeStore

TENANT = uuid.UUID(int=0x0B0E)
GREETINGS = {   # each says it is an AI in its FIRST sentence (a salutation such as "Namaste!" belongs to the sentence after it), so each is spoken exactly as written
    "te": "నమస్కారం! నేను {assistant}, {business} నుంచి AI అసిస్టెంట్‌ని. చెప్పండి, ఏం కావాలి?",
    "en": "Namaste! I am {assistant}, the AI assistant of {business}. How can I help you today?",
    "hi": "नमस्ते! मैं {assistant}, {business} की AI असिस्टेंट बोल रही हूँ। बताइए, क्या चाहिए?",
    "kn": "ನಮಸ್ಕಾರ! ನಾನು {assistant}, {business} ನಿಂದ AI ಅಸಿಸ್ಟೆಂಟ್. ಹೇಳಿ, ಏನು ಬೇಕು?",
}


def voice() -> Any:
    return BrowserVoice(config=default_config(), factory=lambda choice, language: FakeTts(), sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=Limits(greeting=True),
                        ledger=Ledger(Limits(greeting=True)), allowed_origins=(), client=cast(Any, SimpleNamespace()))


def said(parts: Any, language: str) -> str:
    text = parts.greeting_for(language)
    assert isinstance(text, str) and text
    return text


def standard(language: str, business: str = "Padma Silks", assistant: str = persona.DEFAULT_ASSISTANT) -> str:
    return persona.INBOUND_OPENING[language].replace("{business}", business).replace("{assistant}", assistant)


@pytest.mark.parametrize("language", ["te", "en", "hi", "kn"])
def test_the_saved_greeting_of_the_calls_language_is_what_the_caller_hears_and_the_model_is_told_it_was_said(language: str) -> None:
    parts, _ = phone_parts(voice(), "Padma Silks", language, "haiku", {"greeting": GREETINGS}, assistant=None)
    heard = said(parts, language)
    assert heard == GREETINGS[language].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)
    assert "{" not in heard and "Padma Silks" in heard, "the placeholders are filled"
    system = parts.system_for(language)
    assert heard in system and "ALREADY SAID" in system, "the model knows the caller has heard exactly this and does not introduce itself again"


def test_the_assistants_own_name_is_used_when_the_workspace_has_one() -> None:
    parts, _ = phone_parts(voice(), "Padma Silks", "en", "haiku", {"greeting": GREETINGS}, assistant="Meera")
    assert said(parts, "en").startswith("Namaste! I am Meera, the AI assistant of Padma Silks.")


def test_a_language_without_a_saved_greeting_gets_the_standard_opening_even_when_another_language_has_one() -> None:
    training = {"greeting": {"te": GREETINGS["te"]}}
    parts, _ = phone_parts(voice(), "Padma Silks", "en", "haiku", training)
    assert parts.greeting_for("en") == standard("en"), "the Telugu greeting is not spoken to an English call"
    assert parts.greeting_for("te") == GREETINGS["te"].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)
    assert parts.greeting_for("hi") == standard("hi")


@pytest.mark.parametrize("training", [None, {}, {"greeting": {}}, {"greeting": {"te": "   "}}, {"greeting": "not a dict"}, {"greeting": {"te": 5}}])
def test_with_nothing_usable_saved_the_standard_opening_is_spoken(training: Any) -> None:
    parts, _ = phone_parts(voice(), "Padma Silks", "te", "haiku", training)
    assert parts.greeting_for("te") == standard("te")


def test_a_greeting_that_does_not_say_it_is_an_ai_in_its_first_sentence_follows_the_standard_first_sentence_unchanged_by_this_change() -> None:
    """The owner's rule of 6 Nov 2026: the AI mention is in the FIRST sentence. A greeting that says it only in its second sentence ("Namaste! Thanks for calling X. I am Priya, the AI assistant.") is therefore preceded by the standard first sentence."""
    late = "Namaste! Thank you for calling {business}. I am {assistant}, the AI assistant. How can I help?"
    parts_late, _ = phone_parts(voice(), "Padma Silks", "en", "haiku", {"greeting": {"en": late}})
    heard_late = said(parts_late, "en")
    assert heard_late.startswith(persona.first_sentence(standard("en"))) and heard_late.endswith("How can I help?") and heard_late.count("AI assistant") == 2
    plain = "నమస్కారం! {business} కి స్వాగతం. ఏం కావాలో చెప్పండి."
    parts, _ = phone_parts(voice(), "Padma Silks", "te", "haiku", {"greeting": {"te": plain}})
    heard = said(parts, "te")
    first = persona.first_sentence(standard("te"))
    assert heard.startswith(first) and heard.endswith(plain.replace("{business}", "Padma Silks")), "the AI mention first, then the Owner's words"
    assert gate.has_ai_disclosure(persona.first_sentence(heard))


# ---- from the store, the way the phone server prepares a call -----------------------------------------------------------------------------------
class TrainingStore(FakeStore):
    def __init__(self, training: Any = None, *, raises: bool = False) -> None:
        super().__init__()
        self._training, self._raises = training, raises

    def talk_training(self, tenant_id: uuid.UUID) -> Any:
        if self._raises:
            raise RuntimeError("database down")
        return self._training


def service(store: TrainingStore, language: str = "te") -> InboundService:
    return InboundService(secret=b"s" * 48, public_base="https://api.example.test", gate_settings=gate.Settings(mode="sandbox", outbound=False), store=cast(Any, store), calls=None, cost_paise_per_minute=100,
                          language=language, business="Stack19 Owner Test")


@arun
async def test_the_call_is_prepared_with_the_greeting_the_phone_server_reads_for_the_workspace() -> None:
    prepared = await _prepare_for(service(TrainingStore({"greeting": GREETINGS})), voice(), TENANT, business="Padma Silks", assistant="Meera")
    assert prepared.text == GREETINGS["te"].replace("{business}", "Padma Silks").replace("{assistant}", "Meera")
    assert prepared.text in prepared.parts.system_for("te")


@arun
async def test_an_english_line_uses_the_english_greeting() -> None:
    prepared = await _prepare_for(service(TrainingStore({"greeting": GREETINGS}), "en"), voice(), TENANT, business="Padma Silks")
    assert prepared.text == GREETINGS["en"].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)


@arun
async def test_nothing_saved_or_an_unreadable_training_still_opens_the_call_with_the_standard_line() -> None:
    for store in (TrainingStore(None), TrainingStore(raises=True)):
        prepared = await _prepare_for(service(store), voice(), TENANT, business="Padma Silks")
        assert prepared.text == standard("te"), "a call without the training still follows every platform rule"
