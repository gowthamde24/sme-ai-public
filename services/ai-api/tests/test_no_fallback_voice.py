"""NO FALLBACK VOICES (owner, 26 Nov 2026): a person always hears the voice they chose. In strict mode (the owner's live talk, the phone, the previews) only the chosen voice's own engine speaks: it is tried again (the same voice),
and when it cannot speak, or is over our cap, the piece raises a closed VoiceError and the screen shows the words; the other engine is never asked."""

# ruff: noqa: E501

from __future__ import annotations

import pytest

from app.conversation.fallback import FallbackTts
from app.conversation.voices import default_config
from app.voice.interface import VoiceError
from tests.test_nv_voices import CARTESIA_FIRST, Engine, run, speak


def strict(primary: Engine, fallback: Engine) -> FallbackTts:
    return FallbackTts(default_config(), lambda choice, language: primary if choice.engine == "cartesia" else fallback, chosen=CARTESIA_FIRST, strict=True)


def test_a_primary_that_works_is_the_only_voice_that_speaks() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = strict(primary, fallback)
    tts.begin_turn()
    assert run(speak(tts, "hello there"))
    assert len(primary.calls) == 1 and not fallback.calls and tts.served_engine == "cartesia"


def test_a_primary_that_is_down_is_tried_again_and_the_fallback_is_never_asked() -> None:
    primary, fallback = Engine("c", "error"), Engine("s")
    tts = strict(primary, fallback)
    tts.begin_turn()
    with pytest.raises(VoiceError) as err:
        run(speak(tts, "hello there"))
    assert err.value.code == "tts_unavailable"
    assert len(primary.calls) == 3, "the same voice was tried three times"
    assert not fallback.calls, "another voice never speaks in its place"


def test_a_slow_start_is_waited_for_not_replaced() -> None:
    primary, fallback = Engine("c", "slow", delay=1.0), Engine("s")
    tts = strict(primary, fallback)
    tts.begin_turn()
    assert run(speak(tts, "hello there")), "1 s is no reason to sound like somebody else (the first-sound wait is 2.5 s)"
    assert not fallback.calls and tts.served_engine == "cartesia"


def test_over_our_cap_the_piece_is_refused_not_given_to_another_voice() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = strict(primary, fallback)
    tts.set_primary_budget(5)
    tts.begin_turn()
    with pytest.raises(VoiceError) as err:
        run(speak(tts, "ten chars!"))
    assert err.value.code == "tts_budget" and not primary.calls and not fallback.calls


def test_a_text_the_voice_refuses_is_not_said_by_another_voice() -> None:
    class Refusing(Engine):
        async def stream(self, text, language):  # type: ignore[no-untyped-def]
            self.calls.append((text, language))
            raise VoiceError("http_400")
            yield b""

    primary, fallback = Refusing("c"), Engine("s")
    tts = strict(primary, fallback)
    tts.begin_turn()
    with pytest.raises(VoiceError):
        run(speak(tts, "hello there"))
    assert not fallback.calls


def test_the_old_behaviour_is_still_there_when_strict_is_off() -> None:
    primary, fallback = Engine("c", "error"), Engine("s")
    tts = FallbackTts(default_config(), lambda choice, language: primary if choice.engine == "cartesia" else fallback, chosen=CARTESIA_FIRST)
    tts.begin_turn()
    assert run(speak(tts, "hello there")) and fallback.calls
