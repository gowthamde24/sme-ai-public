# ruff: noqa: E501
"""Live talk has its own budget (owner, 30 Oct): small talk and general help open LIGHT runs that do not count against the runs-per-hour allowance; a data or action turn counts as before."""

from __future__ import annotations

import pytest

from app.turns.service import _is_light


@pytest.mark.parametrize("text", [
    "hi, how are you?", "Tell me a joke", "I'm so tired today", "హాయ్, ఎలా ఉన్నారు?", "ఈ రోజు చాలా అలసిపోయాను", "Ee roju chala tired ga undi", "Tell me about Dharmavaram silk", "ధర్మవరం పట్టు చీరల గురించి చెప్పండి",
])
def test_small_talk_and_general_help_are_light(text: str) -> None:
    assert _is_light(text)


@pytest.mark.parametrize("text", [
    "How many enquiries came in today?", "Call Ramesh about the quote", "Remind Suresh tomorrow", "ఈ రోజు ఎన్ని ఎంక్వైరీలు వచ్చాయి", "Ravi ki call cheyyi", "Show me the leads that are due",
])
def test_questions_about_the_records_and_instructions_are_not_light(text: str) -> None:
    assert not _is_light(text)
