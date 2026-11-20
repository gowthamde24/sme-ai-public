"""How the assistant sounds (21 Nov 2026; owner findings of 19 Nov): the three tones change the WORDS and not the voice, one function decides voice + tone + speed for a call and for every preview, a voice falls back only to the same
language and gender (in either provider direction), the words reach both engines respelled, and the settings words are closed. Offline: prompts and lines built by code, fakes for the engines, no model call, no key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.conversation.fallback import FallbackTts
from app.conversation.preview import CallVoicePreview
from app.conversation.providers import CartesiaStreamTts, SarvamStreamTts
from app.conversation.sound import Stored, clamp_speed, resolve_sound
from app.conversation.sound_read import sound_of
from app.conversation.voices import VoiceChoice, default_config
from app.telephony import persona
from app.telephony import tone as tone_mod
from app.telephony.inbound_routes import phone_parts
from app.voice.interface import VoiceError
from app.voicesample import service as vs

CFG = default_config()
TONES = ("friendly", "respectful", "quick")


# ---- (2) the three tones change the words ------------------------------------------------------------------------------------------------------------


def _prompt(language: str, tone: str | None) -> str:
    """The prompt of a call with the per-call random marker taken out (so two prompts differ only in their words)."""
    return re.sub(r"[0-9a-f]{12}-(BEGIN|END)", r"MARK-\1", persona.system_prompt(business="Sample Stores", assistant="Vani", language=language, purpose="inbound", facts=[], customer_first_name=None, tone=tone))


@pytest.mark.parametrize("language", ["te", "en", "hi", "kn", "ta", "ml", "mr"])
def test_the_prompt_of_a_call_differs_in_every_tone_and_says_how(language: str) -> None:
    prompts = {t: _prompt(language, t) for t in TONES}
    assert len(set(prompts.values())) == 3, "three tones, three different prompts"
    assert "short and quick" in prompts["quick"] and "short and quick" not in prompts["friendly"] and "respectful" in prompts["respectful"].lower() and "respectful and polite" not in prompts["friendly"]
    assert prompts["friendly"] == _prompt(language, None), "friendly is the call's own base wording: nothing was taken away from it"


def test_the_openings_and_the_honest_answers_differ_in_telugu_and_english_and_all_say_it_is_an_ai() -> None:
    for language in ("te", "en"):
        openers = {t: tone_mod.opener(language, t) or "" for t in TONES}
        honest = {t: tone_mod.honest_line(language, t) or "" for t in TONES}
        assert len(set(openers.values())) == 3 and len(set(honest.values())) == 3, language
        assert all(o and "AI assistant" in o and "{business}" in o for o in openers.values())
        assert all(h and "AI assistant" in h for h in honest.values())
        assert len(openers["quick"]) < len(openers["friendly"]), "quick is shorter"
    assert "గారు" not in tone_mod.RULES["quick"].split("NEVER 'గారు'")[0] and "NEVER 'గారు'" in tone_mod.RULES["quick"], "quick never uses గారు"
    assert "అండి" in (tone_mod.opener("te", "respectful") or "") and "అండి" not in (tone_mod.opener("te", "friendly") or "") and "అండి" not in (tone_mod.opener("te", "quick") or "")


def test_the_preview_words_differ_per_tone_in_the_four_spoken_languages() -> None:
    for language in ("te", "en", "hi", "kn"):
        said = {s: vs.preview_text(language, s, "Vani", "Sample Stores") for s in ("warm", "respectful", "quick")}
        assert len(set(said.values())) == 3, language
        assert len(said["quick"]) < len(said["respectful"]), "short and quick is the shortest"
    assert vs.line_for("te", "respectful", "Vani", "X") != vs.line_for("te", "quick", "Vani", "X"), "respectful was once read as quick: its own line is spoken now"


def test_the_tone_never_changes_the_voice_or_the_speed() -> None:
    stored = Stored(choices={"te": "te-kavitha"}, speed=1.1)
    sounds = [resolve_sound(CFG, stored, "te", tone=t) for t in TONES]
    assert {s.voice.id for s in sounds} == {"te-kavitha"} and {s.pace for s in sounds} == {1.1} and [s.tone for s in sounds] == list(TONES)


def test_the_tone_in_force_is_the_saved_tone_then_the_assistant_style_then_the_pack_default() -> None:
    assert resolve_sound(CFG, Stored(training={"tone": "quick"}, style="respectful"), "te").tone == "quick"
    assert resolve_sound(CFG, Stored(style="respectful"), "te").tone == "respectful"
    assert resolve_sound(CFG, Stored(style="warm"), "te").tone == "friendly"
    assert resolve_sound(CFG, Stored(pack_tone="respectful"), "te").tone == "respectful"
    assert resolve_sound(CFG, Stored(), "te").tone == "friendly" and resolve_sound(CFG, Stored(training={"tone": "casual"}), "te").tone == "friendly", "casual is never a saved tone"


# ---- (5) one resolution for calls and previews ---------------------------------------------------------------------------------------------------------


def _runtime(choices: dict[str, str], gender: str, tone: str | None, speed: float, style: str) -> Any:
    settings = SimpleNamespace(saved=True, settings=SimpleNamespace(speed=speed, style=style))
    return SimpleNamespace(
        workspace=SimpleNamespace(voice_choices=lambda token, tenant: {"choices": choices, "gender": gender}),
        assistant_settings=SimpleNamespace(get=lambda token, tenant: settings),
        talk_training=SimpleNamespace(get=lambda token, tenant: {"doc": {"tone": tone}} if tone else None),
    )


def test_a_preview_and_a_real_call_resolve_to_exactly_the_same_sound() -> None:
    choices, gender, speed, style = {"hi": "hi-kabir", "te": "te-tarun"}, "male", 1.15, "quick"
    # the phone line's reader (the scheduler account's answer of public.call_sound_for_call, and the Talk training document) ...
    call_row = {"choices": choices, "gender": gender, "speed": speed, "style": style}
    # ... and a preview's reader (the signed-in member's reads) are two readers of the same values: one resolve_sound after both
    ctx = SimpleNamespace(principal=SimpleNamespace(token="t"), tenant=SimpleNamespace(id=uuid.uuid4()))
    for training_tone in (None, "respectful"):
        runtime = _runtime(choices, gender, training_tone, speed, style)
        for language in ("hi", "te", "en", "kn"):
            from_call = resolve_sound(CFG, Stored.from_call_row(call_row, {"tone": training_tone} if training_tone else None), language)
            from_preview = sound_of(runtime, ctx, language)  # type: ignore[arg-type]
            assert from_call == from_preview, (language, training_tone)
            assert from_call.public() == from_preview.public()
    assert resolve_sound(CFG, Stored.from_call_row(call_row), "hi").voice.id == "hi-kabir" and resolve_sound(CFG, Stored.from_call_row(call_row), "en").voice.id == "en-daniel", "another language's choice never leaks; the gender's default speaks"


def test_the_phone_call_speaks_the_workspaces_voice_tone_and_speed_not_the_default_woman() -> None:
    bv = SimpleNamespace(config=CFG, factory=lambda choice, language: None, sarvam_key="k", anthropic_key="k", fast_model="m", client=None, stt_modes={}, fillers=None)
    stored = Stored.from_call_row({"choices": {"te": "te-tarun"}, "gender": "male", "speed": 0.9, "style": "respectful"}, None)
    parts, _ = phone_parts(bv, "Sample Stores", "te", "anthropic", None, (), stored=stored)  # type: ignore[arg-type]
    assert parts.voice_for("te") == "te-tarun" and parts.voice_name("te") == "Tarun"
    assert parts.voice_for("hi") == "hi-rohan", "no choice for Hindi: the male default of Hindi"
    inner = parts.tts._inner if hasattr(parts.tts, "_inner") else parts.tts
    assert getattr(inner, "gender", "male") == "male" and getattr(inner, "pace", 0.9) == 0.9
    assert "respectful" in parts.system_for("te").lower()
    default_parts, _ = phone_parts(bv, "Sample Stores", "te", "anthropic", None, ())  # type: ignore[arg-type]
    assert default_parts.voice_for("te") == "te-ramya", "nothing saved: the same default as before"


def test_a_speed_is_clamped_to_the_settings_range() -> None:
    assert clamp_speed(None) == 1.0 and clamp_speed(3.0) == 1.25 and clamp_speed(0.1) == 0.75 and clamp_speed(1.1) == 1.1


# ---- providers: either direction, never across gender or language ------------------------------------------------------------------------------------


class Engine:
    sample_rate = 24000

    def __init__(self, name: str, fail: bool = False) -> None:
        self.name, self.fail = name, fail
        self.texts: list[str] = []

    async def prewarm(self) -> None: ...

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.texts.append(text)
        if self.fail:
            raise VoiceError("http_500")
        yield b"\x00\x01" * 400


def _speak(voice_id: str, language: str, gender: str, *, fail: set[str] = frozenset(), text: str = "హలో") -> tuple[FallbackTts, list[tuple[str, str]], dict[tuple[str, str], Engine]]:  # type: ignore[assignment]
    built: list[tuple[str, str]] = []
    engines: dict[tuple[str, str], Engine] = {}

    def factory(choice: VoiceChoice, lang: str) -> Engine:
        built.append((choice.engine, choice.voice))
        return engines.setdefault((choice.engine, choice.voice), Engine(choice.voice, fail=choice.engine in fail))

    tts = FallbackTts(CFG, factory, chosen={language: voice_id}, gender=gender)
    tts.begin_turn()

    async def go() -> None:
        _ = [c async for c in tts.stream(text, language)]

    asyncio.run(go())
    return tts, built, engines


def test_a_sarvam_voice_falls_back_to_the_cartesia_voice_of_the_same_language_and_gender_and_the_other_way_round() -> None:
    for voice_id, language, gender in (("te-kavitha", "te", "female"), ("te-tarun", "te", "male"), ("hi-kavya", "hi", "female"), ("kn-chetan", "kn", "male")):
        v = CFG.catalogue[voice_id]
        tts, built, _ = _speak(voice_id, language, gender, fail={"sarvam_v4"})
        assert built[0] == ("sarvam_v4", v.voices.primary.voice) and built[-1] == ("cartesia", v.voices.fallback.voice) and tts.served_engine == "cartesia" and tts.fallback_reason == "error", voice_id
        back = next(c for c in CFG.catalogue.values() if c.voices.primary.voice == v.voices.fallback.voice)
        assert back.language == language and back.gender == gender, "the Cartesia voice behind a Sarvam voice is of the same language and gender"
    tts, built, _ = _speak("te-ramya", "te", "female", fail={"cartesia"})
    assert tts.served_engine == "sarvam_v4" and built[-1] == ("sarvam_v4", "kavitha_te_conversation")


def test_no_fallback_in_the_catalogue_crosses_gender_or_language() -> None:
    tokens = {"te": "_te_", "hi": "_hi_", "kn": "_kn_", "en": "_en", "ta": "_ta_"}
    for c in CFG.catalogue.values():
        assert c.voices.fallback.gender == c.gender, c.id
        assert c.provider == ("cartesia" if c.voices.primary.engine == "cartesia" else "sarvam") and c.voices.primary.engine != c.voices.fallback.engine, c.id
        for choice in (c.voices.primary, c.voices.fallback):
            if choice.engine == "sarvam_v4" and c.language in ("te", "kn", "en") and c.voices.fallback.model == "bulbul:v4-flash":
                assert tokens[c.language] in choice.voice or c.language == "en", (c.id, choice.voice)   # a Sarvam persona is of its own language (English personas are "_en_" or "_enhi_")
    for language in ("te", "en", "hi", "kn", "ta", "ml"):
        for gender in ("female", "male"):
            for v in CFG.voices_of(language, gender, listed_only=True):
                assert CFG.resolve(language, v.id, gender).voices.fallback.gender == gender and v.language == language


def test_a_sarvam_voice_is_not_counted_against_the_cartesia_cap() -> None:
    built: list[tuple[str, str]] = []

    def factory(choice: VoiceChoice, lang: str) -> Engine:
        built.append((choice.engine, choice.voice))
        return Engine(choice.voice)

    tts = FallbackTts(CFG, factory, chosen={"te": "te-kavitha"}, gender="female")
    tts.set_primary_budget(0)   # the Cartesia allowance is used up (or switched off)
    tts.begin_turn()

    async def go() -> None:
        _ = [c async for c in tts.stream("హలో", "te")]

    asyncio.run(go())
    assert built == [("sarvam_v4", "kavitha_te_conversation")] and tts.served_engine == "sarvam_v4" and tts.fallback_reason == "" and tts.primary_chars == 0


def test_the_short_list_is_two_voices_of_each_gender_and_each_voice_says_who_speaks_it() -> None:
    for language in ("te", "en", "hi", "kn"):
        for gender in ("female", "male"):
            listed = CFG.voices_of(language, gender, listed_only=True)
            assert len(listed) == 2 and sum(v.default for v in listed) == 1, (language, gender)
            assert {v.provider for v in listed} == {"cartesia", "sarvam"}, "one voice of each provider: they sound clearly different"
    assert all(v.to_confirm for v in CFG.catalogue.values() if v.listed), "no native listener has confirmed the list yet"
    assert [v.id for v in CFG.voices_of("ml", listed_only=True)] == ["ml-latha", "ml-vijay"]


# ---- the speed reaches the engines; the words reach both engines respelled -----------------------------------------------------------------------------


def test_the_speed_goes_to_cartesia_only_when_it_is_not_normal_and_to_bulbul_as_its_pace() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=b"\x00\x01" * 100)

    async def go(speed: float | None) -> None:
        engine = CartesiaStreamTts("k", voice_id="v", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        if speed is not None:
            engine.set_pace(speed)
        _ = [c async for c in engine.stream("hello", "en")]

    asyncio.run(go(None))
    asyncio.run(go(1.0))
    asyncio.run(go(1.2))
    assert "generation_config" not in bodies[0] and "generation_config" not in bodies[1] and bodies[2]["generation_config"] == {"speed": 1.2}
    bulbul = SarvamStreamTts("k", speaker="s", pace=1.0)
    bulbul.set_pace(1.25)
    assert bulbul._pace == 1.25  # noqa: SLF001


def test_places_times_and_amounts_reach_both_engines_respelled_in_a_call_and_in_a_preview() -> None:
    said = "Come to Warangal at 6:30 pm, it is Rs. 2,600."
    # a call (FallbackTts) with the Cartesia voice failing: Bulbul v4 gets the words
    _, _, engines = _speak("en-janvi", "en", "female", fail={"cartesia"}, text=said)
    bulbul = next(e for (engine, _), e in engines.items() if engine == "sarvam_v4")
    assert bulbul.texts and "Wuh-run-gul" in bulbul.texts[0] and "six thirty" in bulbul.texts[0] and "two thousand six hundred rupees" in bulbul.texts[0]
    _, _, engines = _speak("en-janvi", "en", "female", text=said)
    cartesia = next(e for (engine, _), e in engines.items() if engine == "cartesia")
    assert "Wuh-run-gul" in cartesia.texts[0] and "six thirty" in cartesia.texts[0]
    # the preview (CallVoicePreview speaks through the same FallbackTts)
    made: dict[tuple[str, str], Engine] = {}

    def factory(choice: VoiceChoice, lang: str) -> Engine:
        return made.setdefault((choice.engine, choice.voice), Engine(choice.voice))

    asyncio.run(CallVoicePreview(CFG, factory, today=lambda: "2026-11-21").speak(uuid.uuid4(), "en", "en-shalini", said, "female"))
    heard = next(e for (engine, _), e in made.items() if engine == "sarvam_v4").texts[0]
    assert "Wuh-run-gul" in heard and "six thirty" in heard
    # in Telugu the Latin place name is never sent raw to Bulbul either
    _, _, engines = _speak("te-ramya", "te", "female", fail={"cartesia"}, text="Warangal లో 6:30 pm కి")
    assert "Warangal" not in next(e for (engine, _), e in engines.items() if engine == "sarvam_v4").texts[0]
