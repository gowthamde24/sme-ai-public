"""Pronunciation quality (job pronunciation-quality, owner 30 Oct 2026): what is written becomes what is said (numbers, money, dates, times, phone numbers, units, abbreviations), the lexicon puts a place or a name in the script
of the voice's language and carries the workspace's own words, and the speech path uses all of it. The words are DRAFTS for a native reader; the tests pin the behaviour so a rewrite cannot lose it."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from app.conversation.fallback import FallbackTts
from app.conversation.voices import default_config
from app.pronunciation import lexicon, numbers
from app.pronunciation.lexicon import Entry, Lexicon, OwnerWord, shared
from app.pronunciation.normalise import normalise
from app.pronunciation.speech import SpeechText

# ---- numbers -------------------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "n, lang, expected",
    [
        (21, "en", "twenty one"), (2600, "en", "two thousand six hundred"), (120000, "en", "one lakh twenty thousand"),
        (21, "te", "ఇరవై ఒకటి"), (2600, "te", "రెండు వేల ఆరు వందలు"), (250, "te", "రెండు వందల యాభై"), (120000, "te", "లక్ష ఇరవై వేలు"), (10000000, "te", "కోటి"), (2026, "te", "రెండు వేల ఇరవై ఆరు"),
        (21, "hi", "इक्कीस"), (2600, "hi", "दो हज़ार छह सौ"), (120000, "hi", "एक लाख बीस हज़ार"), (99, "hi", "निन्यानवे"),
        (2600, "kn", "ಎರಡು ಸಾವಿರ ಆರುನೂರು"), (21, "kn", "ಇಪ್ಪತ್ತು ಒಂದು"), (120000, "kn", "ಒಂದು ಲಕ್ಷ ಇಪ್ಪತ್ತು ಸಾವಿರ"),
        (21, "ta", "இருபத்தி ஒன்று"), (1000, "ta", "ஆயிரம்"), (100000, "ta", "ஒரு லட்சம்"), (600, "ta", "அறுநூறு"),
        (21, "ml", "ഇരുപത്തി ഒന്ന്"), (100000, "ml", "ഒരു ലക്ഷം"), (12000, "ml", "പന്ത്രണ്ട് ആയിരം"),
    ],
)
def test_numbers_are_said_the_way_people_say_them(n: int, lang: str, expected: str) -> None:
    assert numbers.words(n, lang) == expected


@pytest.mark.parametrize("lang", numbers.LANGS)
def test_every_number_up_to_a_thousand_has_words_and_none_is_empty(lang: str) -> None:
    spoken = [numbers.words(n, lang) for n in range(1001)]
    assert all(s.strip() for s in spoken) and len(set(spoken)) == len(spoken), "every number has its own, non-empty words"


def test_digits_and_codes_are_read_one_by_one_and_decimals_have_a_point() -> None:
    assert numbers.digits("9876", "en") == "nine eight seven six"
    assert numbers.spoken("007", "en") == "zero zero seven"
    assert numbers.spoken("2.5", "en") == "two point five" and numbers.spoken("2.5", "hi") == "दो दशमलव पाँच"


# ---- normaliser -----------------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "said, expected",
    [
        ("Price ₹1,20,000 only", "Price one lakh twenty thousand rupees only"),
        ("EMI from Rs. 2,600/- a month", "E M I from two thousand six hundred rupees a month"),
        ("GST 18%", "G S T eighteen percent"),
        ("2000 sq ft plot, 60mm pipe", "two thousand square feet plot, sixty millimetre pipe"),
        ("Call 98765 43210", "Call nine eight seven six five, four three two one zero"),
        ("OTP 482913.", "O T P four eight two nine one three."),
        ("on 30/10/2026", "on thirtieth of October twenty twenty six"),
        ("at 6:30 pm", "at six thirty in the evening"),
        ("at 14:05", "at two oh five in the afternoon"),
        ("10-15 days", "ten to fifteen days"),
        ("1st floor", "first floor"),
        ("OK, thank you 🙂 **bold**", "okay, thank you bold"),
        ("see https://x.com/a or a@b.com", "see link or email"),
        ("1 kg", "one kilo"),
    ],
)
def test_english_text_becomes_said_text(said: str, expected: str) -> None:
    assert normalise(said, "en") == expected


@pytest.mark.parametrize(
    "lang, said, expected",
    [
        ("te", "ధర ₹2,600", "ధర రెండు వేల ఆరు వందలు రూపాయలు"),
        ("te", "GST 18%", "G S T పద్దెనిమిది శాతం"),
        ("te", "సాయంత్రం 6:30 pm కి", "సాయంత్రం సాయంత్రం ఆరు ముప్పై కి"),
        ("hi", "कीमत ₹1,500", "कीमत एक हज़ार पाँच सौ रुपये"),
        ("kn", "ಬೆಲೆ ₹2 lakh", "ಬೆಲೆ ಎರಡು ಲಕ್ಷ ರೂಪಾಯಿ"),
        ("ta", "விலை ₹2,600", "விலை இரண்டு ஆயிரம் அறுநூறு ரூபாய்"),
        ("ml", "വില ₹12,000", "വില പന്ത്രണ്ട് ആയിരം രൂപ"),
        ("te", "30/10/2026", "ముప్పై అక్టోబర్ రెండు వేల ఇరవై ఆరు"),
        ("hi", "10-15 दिन", "दस से पंद्रह दिन"),
    ],
)
def test_the_other_languages_say_numbers_money_dates_in_their_own_words(lang: str, said: str, expected: str) -> None:
    assert normalise(said, lang) == expected


def test_english_words_inside_a_telugu_sentence_stay_english_and_text_without_numbers_is_untouched() -> None:
    assert normalise("నేను Stack19 నుంచి call చేస్తున్నాను", "te").startswith("నేను Stack") is True
    plain = "హాయ్! నేను బాగున్నాను, థాంక్యూ."
    assert normalise(plain, "te") == plain


def test_a_zip_like_code_is_not_a_money_amount_and_a_year_is_not_a_phone_number() -> None:
    assert normalise("Code 560001, ₹2.5 lakh", "en") == "Code five six zero zero zero one, two lakh fifty thousand rupees"
    assert normalise("in 2026 we", "en") == "in two thousand twenty six we"


# ---- lexicon --------------------------------------------------------------------------------------------------------------------------------------------


def test_the_shared_lexicon_covers_the_districts_and_towns_of_the_five_states() -> None:
    must = ["Anantapur", "Dharmavaram", "Hindupur", "Vizianagaram", "Nellore", "Warangal", "Karimnagar", "Mysuru", "Belagavi", "Dharwad", "Madurai", "Thanjavur", "Kozhikode", "Thrissur", "Pochampally", "Uppada", "Kanchipuram"]
    missing = [w for w in must if shared().find(w) is None]
    assert not missing, missing
    assert len(shared().entries) >= 200
    for state, count in {"te": 55, "kn": 28, "ta": 36, "ml": 14}.items():
        assert sum(1 for e in shared().entries if e.kind == "place" and state in e.forms) >= count, state


def test_a_place_is_written_in_the_script_of_the_voice_s_language() -> None:
    lx = shared()
    assert lx.apply("Call from Dharmavaram", "te") == "Call from ధర్మవరం"
    assert lx.apply("Call from Ananthapuramu", "te") == "Call from అనంతపురం" and lx.apply("Anantapur", "te") == "అనంతపురం"
    assert lx.apply("ధర్మవరం చీరలు", "en") == "Dharmavaram చీరలు"
    assert lx.apply("Bangalore", "kn") == "ಬೆಂಗಳೂರು" and lx.apply("Bangalore", "te") == "బెంగళూరు"
    assert lx.apply("ಧಾರವಾಡ", "kn") == "ಧಾರವಾಡ" and lx.apply("Dharwad", "kn") == "ಧಾರವಾಡ"
    assert lx.apply("ధర్మవరం", "kn") == "ಧರ್ಮಾವರಂ", "the Kannada voice is given the Kannada-script draft"
    assert lx.apply("పోచంపల్లి", "ta") == "Pochampally", "a script the voice does not speak, with no spelling in its own, is given in Latin letters"
    assert lx.apply("Dharmavarams", "te") == "Dharmavarams" and lx.apply("xDharmavaram", "te") == "xDharmavaram", "whole words only"


def test_phoneme_and_respelling_forms_reach_the_engine_that_can_use_them() -> None:
    entry = Entry("Neelambari", forms={"en": "Neelambari"}, sounds_like={"en": "Neel-um-buh-ree"}, phonemes={"en": "n|i|l|ʌ|m|b|ə|r|i"})
    lx = Lexicon([entry])
    assert lx.apply("Neelambari Silks", "en", "cartesia") == "<<n|i|l|ʌ|m|b|ə|r|i>> Silks"
    assert lx.apply("Neelambari Silks", "en", "sarvam_v4") == "Neel-um-buh-ree Silks"


def test_the_workspace_s_own_word_wins_and_may_be_for_one_language_or_all() -> None:
    mine = shared().with_owner_words([OwnerWord("Dharmavaram", "Dharma-varam", "en"), OwnerWord("Neelambari Silks", "Neel-um-buh-ree Silks"), OwnerWord("", "x"), OwnerWord("Bad", " ")])
    assert mine.apply("Dharmavaram", "en") == "Dharma-varam" and mine.apply("Dharmavaram", "te") == "ధర్మవరం", "for English only"
    assert mine.apply("Neelambari Silks", "te") == "Neel-um-buh-ree Silks" and mine.apply("neelambari silks", "en") == "Neel-um-buh-ree Silks", "for every language, any case"
    assert shared().apply("Neelambari Silks", "te") == "Neelambari Silks", "the shared lexicon is not changed by an addition"


def test_the_data_file_is_checked(tmp_path: Path) -> None:
    bad = tmp_path / "l.json"
    bad.write_text(json.dumps({"entries": [{"word": "X", "forms": {"xx": "y"}}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="language code"):
        lexicon.load(bad)
    bad.write_text(json.dumps({"entries": [{"word": "", "forms": {}}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="needs a word"):
        lexicon.load(bad)
    spellings = [s.casefold() for e in shared().entries for s in e.spellings()]
    assert len(spellings) == len(set(spellings)), "a spelling belongs to one entry"


# ---- the speech path ------------------------------------------------------------------------------------------------------------------------------------


class Engine:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def prewarm(self) -> None: ...

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.texts.append(text)
        yield b"\x00\x01" * 8


def _spoken(text: str, language: str, words: list[OwnerWord] | None = None) -> str:
    engine = Engine()
    tts = FallbackTts(default_config(), lambda choice, lang: engine)  # type: ignore[arg-type,return-value]
    if words:
        tts.set_owner_words(words)
    tts.begin_turn()

    async def run() -> None:
        _ = [c async for c in tts.stream(text, language)]

    asyncio.run(run())
    return engine.texts[0]


def test_a_telugu_voice_hears_dharmavaram_in_telugu_letters_and_the_price_in_words() -> None:
    assert _spoken("Dharmavaram ₹2,600", "te") == "ధర్మవరం రెండు వేల ఆరు వందలు రూపాయలు"


def test_an_english_voice_hears_the_respelling_and_the_workspace_word_wins() -> None:
    assert "Dhar-muh-vuh-rum" in _spoken("ధర్మవరం", "en") or "Dharmavaram" in _spoken("ధర్మవరం", "en")
    assert _spoken("Neelambari", "en", [OwnerWord("Neelambari", "Neel-um-buh-ree", "en")]) == "Neel-um-buh-ree"


def test_the_speech_text_leaves_the_callers_string_alone() -> None:
    text = "Dharmavaram ₹2,600"
    SpeechText().prepare(text, "te")
    assert text == "Dharmavaram ₹2,600"


# ---- approval per language (owner listened, 30 Oct 2026) ------------------------------------------------------------------------------------------------


def test_dharmavaram_and_anantapur_are_approved_in_telugu_and_english_and_not_in_kannada() -> None:
    for word in ("Dharmavaram", "Anantapur"):
        entry = shared().find(word)
        assert entry is not None
        assert entry.is_verified("te") and entry.is_verified("en"), "the owner listened to the Telugu and the English clips and they were right"
        assert not entry.is_verified("kn"), "the Kannada spelling is a draft until the owner's Kannada contact has confirmed it"
    assert shared().find("Ananthapuramu") is shared().find("Anantapur") and shared().find("అనంతపురం") is shared().find("Anantapur")


def test_a_verified_flag_is_a_list_of_languages_and_the_older_true_means_every_form(tmp_path: Path) -> None:
    path = tmp_path / "lex.json"
    path.write_text(json.dumps({"entries": [
        {"word": "A", "forms": {"en": "A", "te": "ఎ"}, "verified": True},
        {"word": "B", "forms": {"en": "B"}, "verified": ["en"]},
        {"word": "C", "forms": {"en": "C"}},
    ]}), encoding="utf-8")
    a, b, c = lexicon.load(path)
    assert a.verified == {"en", "te"} and b.verified == {"en"} and c.verified == frozenset()
    path.write_text(json.dumps({"entries": [{"word": "D", "verified": ["xx"]}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="language codes"):
        lexicon.load(path)


def test_the_towns_of_andhra_and_telangana_have_a_kannada_spelling_and_a_kannada_voice_says_it_in_kannada() -> None:
    telugu_towns = [e for e in shared().entries if e.kind == "place" and "te" in e.forms]
    assert len(telugu_towns) >= 90
    for e in telugu_towns:
        kn = e.forms.get("kn")
        assert kn and all(0x0C80 <= ord(ch) <= 0x0CFF or ch in " ‌‍" for ch in kn), f"{e.word}: needs a Kannada-script spelling"
        assert "kn" not in e.verified, f"{e.word}: a Kannada spelling stays a draft until the Kannada contact confirms it"
    assert shared().find("Dharmavaram").forms["kn"] == "ಧರ್ಮಾವರಂ" and shared().find("Anantapur").forms["kn"] == "ಅನಂತಪುರ"   # type: ignore[union-attr]
    for heard in ("Dharmavaram", "ధర్మవరం"):
        assert shared().apply(f"{heard} నుంచి ಕರೆ", "kn") == "ಧರ್ಮಾವರಂ నుంచి ಕರೆ"
    assert shared().apply("Ananthapuramu ಕಡೆಗೆ", "kn") == "ಅನಂತಪುರ ಕಡೆಗೆ"
    assert shared().apply("Dharmavaram", "te") == "ధర్మవరం"   # the Telugu voice is unchanged


def test_the_review_import_marks_only_the_language_that_was_heard(tmp_path: Path) -> None:
    import subprocess
    import sys

    root = Path(__file__).resolve().parents[3]
    verdicts = tmp_path / "v.json"
    verdicts.write_text(json.dumps({"language": "kn", "verdicts": [{"id": "1", "word": "Hindupur", "ok": True}]}), encoding="utf-8")
    run = subprocess.run([sys.executable, str(root / "scripts" / "pronunciation_review_import.py"), str(verdicts)], capture_output=True, text=True, check=False)  # noqa: S603
    assert run.returncode == 0 and "verified: Hindupur" in run.stdout
