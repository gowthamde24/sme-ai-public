"""The owner's persona (owner prompt A, 14 Nov 2026): the assistant talks to the owner like our live calls do, and every payload says which language it is in."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.agents.llm.interface import Trust
from app.assistant import prompts
from app.assistant.voice import owner_voice, region_for

NOW = datetime(2026, 11, 14, 8, 0, tzinfo=UTC)


def test_the_owner_block_says_spoken_not_bookish_and_no_lists_in_every_language() -> None:
    for language in ("en", "te", "hi", "kn", "ta", "ml", "mr"):
        text = owner_voice(language)
        assert "no bullet points" in text and "₹24,500" in text and "AI" in text, language
        assert "sir" in text.casefold() or "address" in text.casefold(), "the no-gendered-address rule stays"
    te = owner_voice("te", "telangana")
    assert "అండీ" in te and "అయిపోయింది" in te and "చూస్తాను" in te and "Telangana" in te and "ధన్యవాదాలు -> థాంక్స్" in te


def test_the_compact_block_keeps_the_tool_path_small() -> None:
    assert len(owner_voice("te", compact=True)) < len(owner_voice("te")) / 2
    assert "అండీ" in owner_voice("te", compact=True) and "no list" in owner_voice("te", compact=True).replace("never a list", "no list")


def _chat(language: str, region: str = "neutral") -> Any:
    return prompts.build_chat_request(delimiter="abcdef12", question="cricket score ఎంత?", language=language, history=[], today=NOW, assistant_name="Lakshmi", business_name="Neelambari Silks", small=False, region=region)  # type: ignore[arg-type]


def test_a_general_question_is_asked_with_the_owner_voice_and_stays_in_friend_mode() -> None:
    request = _chat("te", "coastal")
    trusted = [b.text for b in request.blocks if b.trust == Trust.TRUSTED]
    assert any("HOW TO TALK TO THE OWNER" in t and "అండీ" in t for t in trusted)
    system = next(b.text for b in request.blocks if b.trust == Trust.SYSTEM)
    assert "Never say you cannot talk about something" in system and "cricket" not in system and "only help" not in system.lower()
    assert "festivals" in system and "general-knowledge" in system


def test_the_business_question_gets_the_compact_voice_and_the_old_system_block_is_unchanged() -> None:
    request = prompts.build_request(turn=1, delimiter="abcdef12", question="ఈ రోజు ఎన్ని enquiries?", language="te", history=[], results=[], notes=[], today=NOW, max_output_tokens=1400, offered=None, region="telangana")
    assert next(b.text for b in request.blocks if b.trust == Trust.SYSTEM) == prompts.SYSTEM_PROMPT
    assert any("quick, trusted member of staff" in b.text for b in request.blocks if b.trust == Trust.TRUSTED)


def test_the_region_is_read_once_per_language_from_how_my_assistant_speaks() -> None:
    calls: list[str] = []

    class Speaking:
        def style_for(self, token: str, tenant: uuid.UUID, language: str) -> tuple[str, str]:
            calls.append(language)
            return "everyday_mixed", "telangana" if language == "te" else "neutral"

    class Runtime:
        speaking = Speaking()

    of = region_for(Runtime(), "tok", uuid.uuid4())
    assert of is not None and of("te") == "telangana" and of("te") == "telangana" and of("hi") == "neutral" and calls == ["te", "hi"]
    assert region_for(object(), "tok", uuid.uuid4()) is None
