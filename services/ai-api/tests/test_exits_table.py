"""Graceful exits (humanness audit item 3, 23 Nov 2026): every way a call can end has the right recorded outcome AND a spoken close in every call language, in that language's own script."""

# ruff: noqa: E501
from __future__ import annotations

import re
from typing import Any

import pytest

from app.telephony import persona
from app.telephony.outcome import deterministic

LANGS = ("en", "te", "hi", "kn", "ta", "ml", "mr")
SCRIPT = {"te": "ఀ-౿", "kn": "ಀ-೿", "hi": "ऀ-ॿ", "mr": "ऀ-ॿ", "ta": "஀-௿", "ml": "ഀ-ൿ"}
ALL_INDIC = "ऀ-ൿ"
CALLER = [{"who": "caller", "text": "hello"}]
ASSISTANT = [{"who": "assistant", "text": "hi"}]

# (exit, what the line showed, expected state, category, do_not_call, handover)
EXITS: list[tuple[str, dict[str, Any], str, str | None, bool, bool]] = [
    ("nobody picked up", {"answered": False, "transcript": []}, "no_answer", None, False, False),
    ("voicemail", {"answered": True, "voicemail": True, "transcript": ASSISTANT}, "voicemail", None, False, False),
    ("a no / stop calling", {"answered": True, "stop_requested": True, "transcript": CALLER}, "completed", "do_not_call", True, False),
    ("asked for a person", {"answered": True, "handover": True, "transcript": CALLER}, "completed", "call_back_later", False, True),
    ("silence: nobody ever spoke", {"answered": True, "transcript": ASSISTANT, "end_reason": "idle"}, "completed", None, False, False),
    ("goodbye after a talk", {"answered": True, "transcript": ASSISTANT + CALLER}, "completed", None, False, False),
]


@pytest.mark.parametrize(("name", "shown", "state", "category", "dnc", "handover"), EXITS, ids=[e[0] for e in EXITS])
def test_every_exit_is_recorded_the_right_way(name: str, shown: dict[str, Any], state: str, category: str | None, dnc: bool, handover: bool) -> None:
    kw: dict[str, Any] = {"answered": True, "end_reason": None, "voicemail": False, "stop_requested": False, "handover": False} | shown
    out = deterministic(**kw)
    assert out.state == state and out.category == category and out.do_not_call is dnc and out.handover is handover, name
    assert not (out.do_not_call and out.handover), "a stop request is never also a hand-over"


# (exit, the table that carries the close, a format dict for the {business} lines)
SPOKEN: list[tuple[str, dict[str, str], dict[str, str]]] = [
    ("a no / stop calling", persona.STOP_ACK, {}),
    ("asked for a person", persona.HANDOVER_ACK, {}),
    ("voicemail", persona.VOICEMAIL_MESSAGE, {"business": "Sri Textiles"}),
    ("after hours", persona.AFTER_HOURS, {"business": "Sri Textiles"}),
    ("goodbye after a talk", persona.CALL_BYE, {}),
    ("silence: the short bye", persona.CALL_BYE_QUIET, {}),
    ("silence: are you there", persona.CALL_CHECK_IN, {}),
    ("interrupted: go ahead", persona.INTERRUPTED_ACK, {}),
]


@pytest.mark.parametrize(("name", "table", "fmt"), SPOKEN, ids=[s[0] for s in SPOKEN])
def test_every_spoken_close_exists_in_every_call_language_in_its_own_script(name: str, table: dict[str, str], fmt: dict[str, str]) -> None:
    for lang in LANGS:
        said = (table.get(lang) or "").format(**fmt) if fmt else (table.get(lang) or "")
        assert said.strip(), f"{name}: no line in {lang}"
        assert "{" not in said and "}" not in said, f"{name}/{lang}: an unfilled placeholder"
        if lang == "en":
            assert not re.search(f"[{ALL_INDIC}]", said), f"{name}/en has an Indian letter"
        else:
            assert re.search(f"[{SCRIPT[lang]}]", said), f"{name}/{lang} has no {lang} letters"
            others = "".join(r for k, r in SCRIPT.items() if r != SCRIPT[lang] and not (lang in ("hi", "mr") and k in ("hi", "mr")))
            assert not re.search(f"[{others}]", said), f"{name}/{lang} mixes in another script"


def test_a_stop_close_says_it_will_not_call_again_and_a_handover_close_promises_a_person_not_a_time() -> None:
    assert "not call" in persona.STOP_ACK["en"].lower()
    for lang in LANGS:
        assert not re.search(r"\d", persona.HANDOVER_ACK[lang]), f"{lang}: a hand-over close never promises a clock time"
