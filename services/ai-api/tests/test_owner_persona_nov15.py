"""The web orb is ALWAYS the owner persona (owner, 15 Nov 2026): a signed-in owner or teammate talking to their assistant, on any page, is a colleague, never a customer. The customer persona (call prompt, honesty
answer for callers) belongs to calls and WhatsApp from customers only. These tests fail if the web orb's prompt ever gets the customer words, or imports the customer persona."""

# ruff: noqa: E501

from __future__ import annotations

import pathlib

import pytest

from app.browser_voice.routes import system_prompt
from app.conversation.router import route

CUSTOMER_WORDS = ("on a phone call or voice note", "the customer asks", "the caller", "Your opening line already told the caller")


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn"])
@pytest.mark.parametrize("name", ["Meera", "the assistant"])
def test_web_orb_prompt_is_the_owner_persona(language: str, name: str) -> None:
    text = system_prompt(business="Neelambari Silks", assistant=name, language=language, opening_line="Hi, how can I help?", mention_ai=True)
    assert "signed-in owner or a member of the team" in text and "NEVER a customer" in text
    assert "your name is a setting the owner can change" in text
    for word in CUSTOMER_WORDS[:2]:
        assert word not in text
    assert "phone call" not in text.split("HOW TO SOUND")[0]


def test_web_orb_never_imports_the_customer_persona() -> None:
    folder = pathlib.Path(__file__).resolve().parent.parent / "app" / "browser_voice"
    for path in folder.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "telephony.persona" not in source, path.name
        assert "call_system_prompt" not in source, path.name
        assert "HONESTY_RULE" not in source, path.name


@pytest.mark.parametrize("said", ["Please remove your name Meera", "remove your name", "call yourself Vani", "change your name", "turn off the quiet hours", "from now on call yourself Asha",
                                  "నీ పేరు తీసేయ్", "अपना नाम हटा दो"])
def test_a_request_to_change_something_never_goes_to_the_fast_tier(said: str) -> None:
    assert route(said) == "strong"


@pytest.mark.parametrize("said", ["hello", "thanks", "what is your name", "how are you"])
def test_small_talk_stays_fast(said: str) -> None:
    assert route(said) == "fast"
