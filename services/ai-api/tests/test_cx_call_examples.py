"""The few-shot example calls and the persona eval's data (owner, 6 Nov 2026): five example calls per language reach the call prompt as STYLE; every assistant line keeps the owner's rules
(short, no digits, no gendered address, the brand as a placeholder); the eval's scripted callers cover every language and persona and ask the robot question and name the brand."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

from app.telephony import persona

DATA = Path(persona.__file__).with_name("data")
LANGS = ("te", "hi", "kn", "ta", "ml", "en", "mr")
EXAMPLES = json.loads((DATA / "call_examples.json").read_text(encoding="utf-8"))
PERSONAS = json.loads((DATA / "eval_personas.json").read_text(encoding="utf-8"))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import call_persona_eval as E  # noqa: E402


@pytest.mark.parametrize("lang", LANGS)
def test_five_example_calls_per_language_and_every_assistant_line_keeps_the_rules(lang: str) -> None:
    calls = EXAMPLES["languages"][lang]
    assert [c["persona"] for c in calls] == ["elder", "casual", "confused", "annoyed", "robot"]
    said = [t["assistant"].replace(persona.END_MARK, "").strip() for c in calls for t in c["turns"] if "assistant" in t]
    assert said and all(E.short(s) for s in said), "at most 25 words, 2 sentences, no list, no long number"
    assert not any(re.search(r"\d", s) for s in said), "no digits read out"
    assert all(E.in_language(s, lang) for s in said), "every reply in the call's language"
    robot = calls[4]["turns"][1]["assistant"]
    assert "AI" in robot and not E.HUMAN_CLAIM.search(robot), "the robot question gets the honest answer"


@pytest.mark.parametrize("lang", LANGS)
def test_the_examples_reach_the_call_prompt_as_style_only(lang: str) -> None:
    prompt = persona.system_prompt(business="Padma Silks", assistant="Priya", language=lang, purpose="inbound", facts=[], customer_first_name=None)
    first = EXAMPLES["languages"][lang][0]["turns"][1]["assistant"].replace("{business}", "Padma Silks")
    assert first in prompt and "Copy the STYLE only" in prompt and "never copy a fact" in prompt
    assert "{business}" not in prompt and "{assistant}" not in prompt


@pytest.mark.parametrize("lang", LANGS)
def test_the_eval_callers_cover_every_persona_ask_the_robot_question_and_name_the_brand(lang: str) -> None:
    script = PERSONAS["languages"][lang]
    assert set(script) == {"angry", "confused", "code_mixed", "elder", "casual"} and all(len(lines) == 4 for lines in script.values())
    lines = [x for v in script.values() for x in v]
    assert any(E.ROBOT.search(x) for x in lines) and any("Stack19" in x for x in lines)
    from app.conversation.turntaking import is_goodbye

    assert is_goodbye(script["casual"][3]), "the casual caller ends with a bye (the eval checks the call ends)"


def test_the_scorer_catches_each_kind_of_failure() -> None:
    op = persona.opening_line("te", business="Stack19", assistant="Priya", customer=None, inbound=True)
    good = E.score("te", "elder", op, [("హలో", "నమస్కారం అండీ, మీకు ఏం కావాలో చెప్పండి.")], ["హలో, నేను Stack Nineteen నుంచి Priya"])
    assert good == {"language_kept": 1.0, "disclosure": True, "tone_matched": True, "short_turns": True, "brand_right": True}
    assert E.score("te", "elder", op, [("హలో", "Hello, how can I help you today?")], [])["language_kept"] == 0.0
    assert E.score("te", "angry", "హలో, నేను Priya.", [("robot ఆ?", "కాదు, నేను మనిషిని అండీ.")], [])["disclosure"] is False
    assert E.score("te", "casual", op, [("హాయ్", "ఏరా, ఏం కావాలి?")], [])["tone_matched"] is False, "never over-familiar first"
    long = "ఇది చాలా పెద్ద వాక్యం " * 8
    assert E.score("te", "elder", op, [("హలో", long + "అండీ.")], [])["short_turns"] is False
    assert E.score("te", "elder", op, [("హలో", "స్టాక్ పంతొమ్మిది నుంచి మాట్లాడుతున్నాను అండీ.")], [])["brand_right"] is False
    assert E.score("te", "elder", op, [("హలో", "సరే అండీ.")], ["Stack పంతొమ్మిది"])["brand_right"] is False, "the voice must be given Stack Nineteen"
