"""te<->en and hi<->en language following on a phone call (humanness audit, 23 Nov 2026): the call stays in its language through greetings, fillers and code-mixing; two full sentences in the other language, or a request, switch it; and it can switch back."""

# ruff: noqa: E501
from __future__ import annotations

import pytest

from tests.test_pl_phone_language import follow

EN1, EN2 = "I want to know the price of silk sarees", "Do you deliver to Vijayawada by Friday?"
TE1, TE2 = "నాకు పట్టు చీరల ధర తెలుసుకోవాలి", "శుక్రవారం లోపల డెలివరీ చేస్తారా"
HI1, HI2 = "मुझे साड़ी की कीमत जाननी है", "क्या शुक्रवार तक डिलीवरी हो जाएगी"


@pytest.mark.parametrize(("start", "one", "two", "back", "other"), [("te", EN1, EN2, TE1, "en"), ("hi", EN1, EN2, HI1, "en"), ("en", TE1, TE2, EN1, "te"), ("en", HI1, HI2, EN1, "hi")])
def test_two_full_sentences_in_the_other_language_switch_and_one_does_not(start: str, one: str, two: str, back: str, other: str) -> None:
    assert follow([one], start=start) == (start, [start]), "one sentence is not enough"
    assert follow([one, two], start=start) == (other, [start, other])
    assert follow([one, two, back, back], start=start)[0] == start, "and it comes back when they go back (two sentences)"


@pytest.mark.parametrize(("start", "mixed"), [("te", "mee shop lo delivery untada, price entha?"), ("te", "ఈ saree price ఎంత, delivery ఉందా?"), ("hi", "price kitna hai, delivery hoti hai kya?"), ("hi", "ye saree ka price kya hai, delivery होती है?")])
def test_code_mixed_speech_never_switches_the_call_even_repeated(start: str, mixed: str) -> None:
    assert follow([mixed, mixed, mixed], start=start)[0] == start


@pytest.mark.parametrize(("start", "ask", "lang"), [("te", "English lo matladandi", "en"), ("te", "please speak in English", "en"), ("hi", "English mein baat karo", "en"), ("hi", "please talk in English", "en"), ("en", "Telugu lo cheppandi", "te"), ("en", "हिंदी में बात करो", "hi"), ("en", "can you speak in Hindi", "hi")])
def test_a_request_to_change_language_switches_at_once(start: str, ask: str, lang: str) -> None:
    assert follow([ask], start=start)[0] == lang


@pytest.mark.parametrize("start", ["te", "hi", "en"])
def test_greetings_numbers_names_and_fillers_never_switch(start: str) -> None:
    turns = ["Hello", "hello hello can you hear me", "ok", "yes", "thank you", "hmm", "1500", "Ramesh", "Sri Textiles", "bye bye"]
    assert follow(turns, start=start)[0] == start


def test_tenglish_repeated_on_an_english_call_moves_it_to_telugu_by_design() -> None:
    """Owner, 31 Oct 2026: Latin-letter Telugu is Telugu, never English; a caller who keeps speaking it gets Telugu."""
    assert follow(["ok price entha, delivery undi na", "naaku booking kavali, repu vastanu"], start="en")[0] == "te"
