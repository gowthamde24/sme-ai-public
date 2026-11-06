"""Job M1 (owner decision 5 Nov 2026): Marathi ("mr") joins the call and WhatsApp languages as a DRAFT for a native reader.

Pinned here: mr is accepted wherever ml is; Devanagari text is told apart as Hindi or Marathi by a few whole words; the core call and assistant texts have Marathi lines and every opening says "AI";
the stop / hand-over / voicemail triggers hear Marathi; Marathi is "draft" wherever a review status exists; a language with no voice in the catalogue yet is never spoken in (it degrades to Hindi in
the live talk, to "unsupported_language" elsewhere, never to an error); the feature texts that are not part of M1 fall back to English instead of failing."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.agents import register
from app.assistant import language as lang
from app.assistant_settings import data as settings_data
from app.assistant_settings import service as settings_service
from app.browser_voice import routes as bv_routes
from app.browser_voice.session import SAID, VoiceSession
from app.conversation import fillers, style, turntaking
from app.conversation.picker import out as voices_out
from app.conversation.voices import (
    DEFAULT_FILE,
    SPEAKS_INSTEAD,
    default_config,
    parse_config,
    sample_text,
)
from app.deliveries.messages import compose as delivery_text
from app.lead_profile.rules import language_of
from app.opening.render import NO_NAME_PHRASE
from app.parity import language as parity_language
from app.pronunciation.normalise import normalise
from app.pronunciation.numbers import words
from app.talk_training.guard import SAFE
from app.tasks.compose import ask_text
from app.telephony import persona, triggers
from app.turns import words as turn_words
from app.visits.texts import render as visit_text
from app.voice.interface import TAGS, VoiceError

APP = Path(__file__).resolve().parents[1] / "app"
LITERAL = re.compile(r"Literal\[((?:\s*\"[a-z]{2,4}\"\s*,?)+)\]")
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
OTHER_INDIC = re.compile(r"[ঀ-෿]")   # Bengali to Malayalam: never inside a Marathi line

HINDI = ["मुझे कल आना है", "क्या आपके पास हरी साड़ी है?", "मैं अभी नहीं आ सकता", "आपका ऑर्डर कब आएगा?"]
MARATHI = ["मला उद्या यायचे आहे", "तुमच्याकडे हिरवी साडी आहे का?", "मी आत्ता येऊ शकत नाही", "तुमची ऑर्डर कधी येईल?", "Synthetic product किंमत किती आहे?"]


# ------------------------------------------------------------------------------------------------ the allow-lists
def test_every_language_literal_that_lists_ml_lists_mr() -> None:
    missing: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        for found in LITERAL.finditer(path.read_text(encoding="utf-8")):
            codes = re.findall(r"\"([a-z]{2,4})\"", found.group(1))
            if "ml" in codes and "mr" not in codes:
                missing.append(f"{path.relative_to(APP)}: {codes}")
    assert missing == []


# ------------------------------------------------------------------------------------------------ detection
@pytest.mark.parametrize("text", HINDI)
def test_hindi_stays_hindi(text: str) -> None:
    assert lang.detect_language(text) == "hi"
    assert lang.detect_owner_language(text) == "hi"
    assert parity_language.detect_language(text) == "hi"
    assert lang.reply_matches(text, "hi") and not lang.reply_matches(text, "mr")


@pytest.mark.parametrize("text", MARATHI)
def test_marathi_is_marathi(text: str) -> None:
    assert lang.detect_language(text) == "mr"
    assert lang.detect_owner_language(text) == "mr"
    assert lang.reply_matches(text, "mr") and not lang.reply_matches(text, "hi")


def test_marathi_words_count_only_as_whole_words() -> None:
    assert lang.devanagari_language("कायदा क्या है?") == "hi", "काय inside कायदा is not the Marathi word"
    assert lang.devanagari_language("हमला हुआ") == "hi", "मला inside हमला is not the Marathi word"
    assert lang.devanagari_language("आहे।") == "mr", "a danda is not part of the word"
    assert lang.devanagari_language("साडी") == "hi", "a text with neither set of words stays Hindi, as before"
    assert lang.reply_matches("साडी", "mr") and lang.reply_matches("साडी", "hi"), "a short reply with no marker is accepted in either"


def test_romanised_marathi_is_marathi_and_romanised_hindi_is_not() -> None:
    assert lang.detect_owner_language("kaay zala, mala sanga") == "mr"
    assert lang.detect_owner_language("tumhi kuthe aahet?") == "mr"
    assert lang.detect_owner_language("aaj kya naya hai, batao") == "hi"
    assert lang.detect_owner_language("Please send the price list") == "en"


def test_the_other_detectors_tell_marathi_apart() -> None:
    from app.conversation.live_eval import dominant_script

    assert dominant_script("तुमची ऑर्डर कधी येईल?") == "mr" and dominant_script("आपका ऑर्डर कब आएगा?") == "hi"
    assert language_of("मला दोन साड्या हव्या आहेत, पुढच्या आठवड्यात") == ("mr", "medium")
    assert language_of("मुझे दो साड़ियाँ चाहिए, अगले हफ़्ते") == ("hi", "medium")
    assert turntaking.foreign_to_pin("मला उद्या यायचे आहे", "mr") is False, "Marathi heard with the Marathi pill"
    assert turntaking.foreign_to_pin("मुझे कल आना है", "mr") is False, "the same script is never 'another language'"
    assert turntaking.foreign_to_pin("నాకు రేపు రావాలి", "mr") is True, "another script while the pill says Marathi"


# ------------------------------------------------------------------------------------------------ the core texts
CORE_TABLES: dict[str, Any] = {
    "NO_ANSWER": lang.NO_ANSWER, "COULD_NOT_ANSWER": lang.COULD_NOT_ANSWER, "NO_MONEY_PENDING": lang.NO_MONEY_PENDING, "NO_RECORD_HELP": lang.NO_RECORD_HELP,
    "SCHOOL_REFUSAL": lang.SCHOOL_REFUSAL, "PLAIN_WORDS": lang.PLAIN_WORDS, "WEB_SOURCES": lang.WEB_SOURCES, "SEE_CARDS": lang.SEE_CARDS, "WAITING_ALSO": lang.WAITING_ALSO,
    "STOP_ACK": persona.STOP_ACK, "HANDOVER_ACK": persona.HANDOVER_ACK, "VOICEMAIL_MESSAGE": persona.VOICEMAIL_MESSAGE, "AFTER_HOURS": persona.AFTER_HOURS, "INBOUND_OPENING": persona.INBOUND_OPENING,
    "SAFE": SAFE, "CHECK_IN": turntaking.CHECK_IN, "GOODBYE_QUIET": turntaking.GOODBYE_QUIET, "GOODBYE_REPLY": turntaking.GOODBYE_REPLY, "SOFT_WARNING": turntaking.SOFT_WARNING,
    "OWNER_GREETING": bv_routes.OWNER_GREETING, "SAID.yes": SAID["yes"], "SAID.no": SAID["no"], "CONFIRM_LINES": settings_service.CONFIRM_LINES, "CUSTOMER_LINES": settings_service.CUSTOMER_LINES,
    "INTRO_UNNAMED": settings_data.INTRO_UNNAMED, "PLAN_SENTENCE": turn_words.PLAN_SENTENCE, "CANNOT_PLAN": turn_words.CANNOT_PLAN, "NO_NAME_PHRASE": NO_NAME_PHRASE,
}


@pytest.mark.parametrize("name", sorted(CORE_TABLES))
def test_each_core_text_has_a_marathi_line_in_devanagari_only(name: str) -> None:
    line = CORE_TABLES[name]["mr"]
    assert DEVANAGARI.search(line) and not OTHER_INDIC.search(line), name
    assert not re.search(r"\b(है|हैं|नहीं|मैं|आप)\b", line), f"{name}: a Hindi word in a Marathi line"


@pytest.mark.parametrize("name", ["NO_ANSWER", "COULD_NOT_ANSWER", "NO_MONEY_PENDING", "NO_RECORD_HELP", "SCHOOL_REFUSAL", "PLAIN_WORDS", "CANNOT_PLAN"])
def test_the_assistant_s_fixed_marathi_replies_pass_its_own_language_check(name: str) -> None:
    assert lang.reply_matches(CORE_TABLES[name]["mr"], "mr"), name


def test_every_marathi_opening_and_disclosure_says_it_is_an_ai() -> None:
    for line in (persona.INBOUND_OPENING["mr"], persona.VOICEMAIL_MESSAGE["mr"], settings_data.INTRO_UNNAMED["mr"]):
        assert "AI" in line
    assert "AI" in persona.opening_line("mr", business="Sample Stores", assistant=None, customer=None, inbound=True)
    assert "AI" in persona.opening_line("mr", business="Sample Stores", assistant=None, customer=None)
    for business, styles in settings_data.load()["samples"].items():
        for style_id, line in styles["mr"].items():
            assert "AI" in line and "assistant" in line, (business, style_id)
    assert "AI" in settings_data.load()["intro"]["mr"]
    robot = [text for label, text in register.examples("mr") if "Robot" in text]
    assert robot and "AI" in robot[0]


def test_no_marathi_line_states_a_price() -> None:
    lines = [t["mr"] for t in CORE_TABLES.values()] + [text for _, text in register.examples("mr")]
    assert not [line for line in lines if re.search(r"₹|\d", line)]


def test_the_persona_speaks_marathi_by_name() -> None:
    assert persona.LANGUAGE_NAMES["mr"] == "Marathi"
    assert "Speak Marathi" in persona.system_prompt(business="B", assistant=None, language="mr", purpose="inbound", facts=[], customer_first_name=None)


# ------------------------------------------------------------------------------------------------ the triggers
@pytest.mark.parametrize("said", ["पुन्हा फोन करू नका", "मला कॉल करू नका, धन्यवाद", "माझा नंबर काढून टाका"])
def test_a_marathi_stop_is_heard(said: str) -> None:
    assert triggers.stop_requested(said)


@pytest.mark.parametrize("said", ["मला माणसाशी बोलायचं आहे", "मॅनेजरशी बोलायचं आहे", "मालकाशी बोलायचे आहे"])
def test_a_marathi_request_for_a_person_is_heard(said: str) -> None:
    assert triggers.person_asked_explicitly(said) and triggers.person_requested(said)


@pytest.mark.parametrize("said", ["तुम्ही डायल केलेला क्रमांक सध्या उपलब्ध नाही", "बीपनंतर तुमचा संदेश ठेवा"])
def test_a_marathi_voicemail_is_heard(said: str) -> None:
    assert triggers.voicemail_greeting(said)


@pytest.mark.parametrize("said", ["हो, साडी आवडली", "मला हिरवी साडी हवी आहे"])
def test_ordinary_marathi_triggers_nothing(said: str) -> None:
    assert not triggers.stop_requested(said) and not triggers.person_requested(said) and not triggers.voicemail_greeting(said)


# ------------------------------------------------------------------------------------------------ draft status
def test_marathi_is_a_draft_wherever_a_review_status_exists() -> None:
    assert register.status("mr") == "draft"
    assert register.REGIONS["mr"] == ("neutral",)
    assert register.examples("mr"), "the native_lines file is read"
    assert "DRAFT" in (APP / "agents" / "register" / "data" / "native_lines" / "mr.md").read_text(encoding="utf-8").splitlines()[0]
    assert "(These examples are drafts for native review.)" in register.register_block("mr")
    assert register.formal_forms_in("mr", "कृपया थांबा") == ["कृपया"]
    from app.pronunciation.lexicon import shared

    assert not any(e.is_verified("mr") for e in shared().entries), "no lexicon entry is verified in Marathi"
    assert settings_data.load()["status"] == "draft" and "mr" in settings_data.load()["languages"]


# ------------------------------------------------------------------------------------------------ speech and numbers
def test_marathi_numbers_and_normalising() -> None:
    assert words(2600, "mr") == "दोन हजार सहाशे"
    assert words(150, "mr") == "एकशे पन्नास"
    assert words(120000, "mr") == "एक लाख वीस हजार"
    assert words(99, "mr") == "नव्याण्णव"
    said = normalise("₹2,600, 18% GST, 30/10/2026", "mr")
    assert "दोन हजार सहाशे रुपये" in said and "अठरा टक्के" in said and "ऑक्टोबर" in said
    assert TAGS["mr"] == "mr-IN"
    assert bv_routes.stt_mode_for("mr") == bv_routes.stt_mode_for("hi")


def test_marathi_has_the_style_and_filler_words_of_a_call() -> None:
    assert fillers.bank_lines("mr", "female") != fillers.bank_lines("mr", "male"), "Marathi verbs carry the speaker's gender"
    assert "mr" in fillers.FILLERS and "mr" in style.FILLER_EXAMPLES and "mr" in style.REACTIONS and "mr" in style.NUMBERS
    assert "mr" in sample_text("mr") or DEVANAGARI.search(sample_text("mr"))


# ------------------------------------------------------------------------------------------------ Marathi's voices (6 Nov 2026: Sarvam only, a draft)
def test_marathi_speaks_with_sarvam_only_and_its_fallback_is_another_sarvam_voice() -> None:
    cfg = default_config()
    assert cfg.has_voices("mr") and "mr" in [row.language for row in voices_out(cfg, {}).languages]
    for gender in ("female", "male"):
        v = cfg.for_language("mr", None, gender)
        assert v.primary.engine == v.fallback.engine == "sarvam_v4" and "_mr_" in v.primary.voice and "_mr_" in v.fallback.voice
        assert v.primary.voice != v.fallback.voice and v.fallback.gender == gender


def test_marathi_now_must_keep_its_voices_and_a_session_without_one_still_speaks_hindi() -> None:
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    raw["catalogue"] = [c for c in raw["catalogue"] if c["language"] != "mr"]
    with pytest.raises(ValueError, match="language mr needs exactly one"):
        parse_config(raw)
    assert SPEAKS_INSTEAD == {"mr": "hi"}, "a voice lookup that fails for Marathi still answers in Hindi rather than in silence (app/browser_voice/session.py _speakable)"


def test_only_a_one_engine_language_may_fall_back_to_the_same_engine_and_never_to_the_same_voice() -> None:
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    same_voice = copy.deepcopy(raw)
    mr = next(c for c in same_voice["catalogue"] if c["language"] == "mr")
    mr["fallback"]["voice"] = mr["primary"]["voice"]
    with pytest.raises(ValueError, match="different"):
        parse_config(same_voice)
    telugu_on_sarvam = copy.deepcopy(raw)
    te = next(c for c in telugu_on_sarvam["catalogue"] if c["language"] == "te")
    te["primary"] = {"engine": "sarvam_v4", "model": "bulbul:v4-flash", "voice": "tarun_te_narration"}
    with pytest.raises(ValueError, match="different engine"):
        parse_config(telugu_on_sarvam)


def test_the_six_voiced_languages_still_need_their_defaults() -> None:
    cfg = default_config()
    raw = {"catalogue": [{"id": c.id, "language": c.language, "name": c.name, "label": c.label, "gender": c.gender, "default": c.default,
                          "primary": {"engine": c.voices.primary.engine, "model": c.voices.primary.model, "voice": c.voices.primary.voice},
                          "fallback": {"engine": c.voices.fallback.engine, "model": c.voices.fallback.model, "voice": c.voices.fallback.voice, "gender": c.voices.fallback.gender}}
                         for c in cfg.catalogue.values() if c.language != "ml"]}
    with pytest.raises(ValueError, match="language ml needs exactly one"):
        parse_config(raw)
    everything = {"catalogue": [*raw["catalogue"], *[c for c in [
        {"id": c.id, "language": c.language, "name": c.name, "label": c.label, "gender": c.gender, "default": c.default,
         "primary": {"engine": c.voices.primary.engine, "model": c.voices.primary.model, "voice": c.voices.primary.voice},
         "fallback": {"engine": c.voices.fallback.engine, "model": c.voices.fallback.model, "voice": c.voices.fallback.voice, "gender": c.voices.fallback.gender}}
        for c in cfg.catalogue.values() if c.language == "ml"]]]}
    assert parse_config(everything).has_voices("mr"), "the real catalogue, rebuilt: Marathi has its voices"
    one_mr = dict(raw["catalogue"][0], id="mr-test", language="mr", default=True)
    with pytest.raises(ValueError, match="language mr needs exactly one"):
        parse_config({"catalogue": [*everything["catalogue"], one_mr]})   # Marathi needs exactly one default per gender, like every language


def _parts(voiced: set[str]) -> SimpleNamespace:
    def voice_for(language: str) -> str:
        if language not in voiced:
            raise VoiceError("unsupported_language")
        return f"{language}-voice"

    return SimpleNamespace(parts=SimpleNamespace(voice_for=voice_for))


def test_the_live_talk_never_switches_to_a_language_it_cannot_speak() -> None:
    without = _parts({"hi", "en", "te"})
    assert VoiceSession._speakable(without, "mr") == "hi", "Marathi without a voice is heard and answered as Hindi was before M1"   # type: ignore[arg-type]
    assert VoiceSession._speakable(without, "te") == "te"   # type: ignore[arg-type]
    assert VoiceSession._speakable(_parts({"mr", "hi"}), "mr") == "mr", "once the catalogue has Marathi voices, Marathi is spoken"   # type: ignore[arg-type]
    assert SPEAKS_INSTEAD == {"mr": "hi"}


# ------------------------------------------------------------------------------------------------ not in M1: English, never an error
def test_the_feature_texts_outside_m1_fall_back_to_english() -> None:
    from datetime import UTC, datetime

    assert delivery_text("delay", "mr", "AP 01 1234", None) == delivery_text("delay", "en", "AP 01 1234", None)
    assert ask_text("mr", "Sample Stores") == ask_text("en", "Sample Stores")
    at = datetime(2026, 11, 10, 6, 30, tzinfo=UTC)
    assert visit_text("reminder", "mr", at) == visit_text("reminder", "en", at)
