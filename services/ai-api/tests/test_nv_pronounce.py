"""The pronunciation map (job natural-voice, owner 28 Oct: "Kannada" came out as "Canada"): words respelled for the voice per engine, rupee amounts said the way people say them, a workspace's own additions on top. Pure text and fakes."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from app.conversation.fallback import FallbackTts
from app.conversation.pronounce import (
    Pronunciations,
    default_pronunciations,
    indian_words,
    load_words,
)
from app.conversation.voices import VoiceChoice, default_config

P = default_pronunciations()


def test_kannada_is_respelled_for_every_engine_and_the_subtitle_text_is_untouched() -> None:
    text = "Then I'll speak Kannada."
    cart, bulbul = P.apply(text, "en", "cartesia"), P.apply(text, "en", "sarvam_v4")
    assert "<<ˈ|k|ʌ|n|ə|d|ə>>" in cart and "Kannada" not in cart, "Cartesia gets its phoneme form (the sound 'Kun-nuh-dah')"
    assert bulbul == "Then I'll speak Kun-nuh-dah." and "<<" not in bulbul, "another engine gets the spelling it can read (the phoneme form would be read aloud)"
    assert P.apply(text) == bulbul, "no engine named: the common spelling"
    assert text == "Then I'll speak Kannada.", "the caller's string is never changed in place"


@pytest.mark.parametrize("said, expected", [("kannada", "Kun-nuh-dah"), ("KANNADA!", "Kun-nuh-dah!"), ("in Dharmavaram and Anantapur", "in Dhar-muh-vuh-rum and Anantha-poor"), ("Bengaluru, Telugu", "Ben-guh-loo-roo, Tel-uh-goo"), ("12 sarees", "twelve sah-rees")])
def test_words_match_whole_words_in_any_case_and_leave_punctuation_alone(said: str, expected: str) -> None:
    out = P.apply(said, "en", "sarvam_v4")
    assert out == expected or out.replace("12", "twelve") == expected


def test_only_whole_latin_words_change() -> None:
    for text in ("Kannadas", "Telugus are", "xKannada", "ಕನ್ನಡ", "తెలుగు మాట్లాడతాను", "कन्नड़"):
        assert P.apply(text, "en", "cartesia") == text, text
    assert P.apply("నేను Kannada మాట్లాడతాను", "te", "sarvam_v4") == "నేను Kun-nuh-dah మాట్లాడతాను", "a Latin word inside a Telugu sentence is respelled"


def test_the_names_that_were_checked_with_a_real_voice_and_came_back_wrong_are_in_the_map() -> None:
    assert P.apply("Gowtham garu", "te", "cartesia") == "Gow-tum garu"
    assert "sarees" in P.words and "saree" in P.words


# ---- money ------------------------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "said, expected",
    [
        ("It is ₹2,600 only.", "It is two thousand six hundred rupees only."),
        ("Rs. 1,20,000 total", "one lakh twenty thousand rupees total"),
        ("INR 2500000", "twenty five lakh rupees"),
        ("₹1.5 lakh", "one point five lakh rupees"),
        ("₹50k", "fifty thousand rupees"),
        ("Rs 2 crore", "two crore rupees"),
        ("₹2,600", "two thousand six hundred rupees"),
        ("25000 rupees", "twenty five thousand rupees"),
        ("₹0", "zero rupees"),
        ("₹10,00,00,000", "ten crore rupees"),
        ("₹999", "nine hundred ninety nine rupees"),
    ],
)
def test_rupee_amounts_are_said_the_way_people_say_them_in_english(said: str, expected: str) -> None:
    assert P.apply(said, "en") == expected


def test_in_the_other_languages_the_symbol_becomes_the_word_after_the_number() -> None:
    assert P.apply("ధర ₹2,600 అండీ", "te") == "ధర 2,600 రూపాయలు అండీ"
    assert P.apply("कीमत Rs. 1,500 है", "hi") == "कीमत 1,500 रुपये है"
    assert P.apply("ಬೆಲೆ ₹2 lakh", "kn") == "ಬೆಲೆ 2 lakh ರೂಪಾಯಿ"


def test_indian_grouping_words() -> None:
    assert [indian_words(n) for n in (0, 7, 15, 100, 1000, 100000, 123456, 10000000, 2500000000)] == ["zero", "seven", "fifteen", "one hundred", "one thousand", "one lakh", "one lakh twenty three thousand four hundred fifty six", "one crore", "two hundred fifty crore"]


# ---- a workspace's own words --------------------------------------------------------------------------------------------------------------------------------


def test_a_workspace_adds_its_own_names_and_its_entry_wins_even_over_an_engine_s_own() -> None:
    mine = P.with_extra({"Neelambari": "Neel-um-buh-ree", "Kannada": "Kan-na-da", " ": "x", "Bad": " "})
    assert mine.apply("Neelambari Silks", "en", "cartesia") == "Neel-um-buh-ree Silks"
    assert mine.apply("Kannada", "en", "cartesia") == "Kan-na-da" and mine.apply("Kannada", "en", "sarvam_v4") == "Kan-na-da"
    assert P.apply("Neelambari", "en") == "Neelambari" and P.with_extra(None) is P and P.with_extra({}) is P, "the base is not changed by an addition"
    assert "bad" not in mine.words and " " not in mine.words


def test_the_data_file_is_checked(tmp_path: Path) -> None:
    good = json.loads((Path(__file__).resolve().parents[1] / "app/conversation/data/pronunciations.json").read_text(encoding="utf-8"))
    assert load_words() == good["words"] and all(isinstance(v, str) and v for v in good["words"].values())
    bad = tmp_path / "p.json"
    bad.write_text(json.dumps({"words": {"Kannada": ""}}), encoding="utf-8")
    with pytest.raises(ValueError, match="must map a word"):
        load_words(bad)
    bad.write_text(json.dumps({"words": {"Kannada": "x"}, "engines": {"cartesia": {"A": 1}}}), encoding="utf-8")
    with pytest.raises(ValueError, match="engine"):
        from app.conversation.pronounce import _load

        _load(bad)


# ---- the voice applies it, per engine -----------------------------------------------------------------------------------------------------------------------


class Engine:
    sample_rate = 24000

    def __init__(self, fail: bool = False) -> None:
        self.fail, self.texts = fail, []  # type: ignore[var-annotated]

    async def prewarm(self) -> None: ...

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.texts.append(text)
        if self.fail:
            from app.voice.interface import VoiceError

            raise VoiceError("http_500")
        yield b"\x00\x01" * 8


def test_each_engine_hears_its_own_respelling_and_a_workspace_s_words_reach_both() -> None:
    async def speak(primary_fails: bool, pron: Pronunciations | None = None) -> tuple[Engine, Engine]:
        engines = {"cartesia": Engine(primary_fails), "sarvam_v4": Engine()}

        def factory(choice: VoiceChoice, language: str) -> Engine:
            return engines[choice.engine]

        tts = FallbackTts(default_config(), factory, pronunciations=pron)
        tts.begin_turn()
        _ = [c async for c in tts.stream("Then I'll speak Kannada, in Neelambari.", "en")]
        return engines["cartesia"], engines["sarvam_v4"]

    cart, bul = asyncio.run(speak(False))
    assert cart.texts == ["Then I'll speak <<ˈ|k|ʌ|n|ə|d|ə>>, in Neelambari."] and bul.texts == []
    cart, bul = asyncio.run(speak(True, P.with_extra({"Neelambari": "Neel-um-buh-ree"})))
    assert bul.texts == ["Then I'll speak Kun-nuh-dah, in Neel-um-buh-ree."], "when Cartesia fails the fallback gets the spelling IT can read"
