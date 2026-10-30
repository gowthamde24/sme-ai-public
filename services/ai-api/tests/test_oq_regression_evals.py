"""Every bug the owner has found is a permanent case (tests/evals/regression/cases.jsonl). Offline and deterministic; runs in the api CI job, so nothing ships that fails one. See the README next to the cases: a fix without a case is not
finished."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.agents import register
from app.agents.register.address import address_rule, clean, gendered_words
from app.assistant import prompts
from app.assistant.language import detect_owner_language
from app.browser_voice.routes import stt_mode_for
from app.conversation.fillers import BANK_LINES, FILLERS, MALE_BANK_LINES
from app.conversation.voices import default_config
from app.pronunciation.speech import SpeechText
from app.turns.intent import classify
from tests.test_oq_no_gendered_address import ABOUT_THE_WORDS, APP, _strings

ROOT = Path(__file__).resolve().parents[3]
CASES = [json.loads(line) for line in (ROOT / "tests" / "evals" / "regression" / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
SCRIPT_RANGE = {"te": (0x0C00, 0x0C7F), "hi": (0x0900, 0x097F), "kn": (0x0C80, 0x0CFF), "ta": (0x0B80, 0x0BFF), "ml": (0x0D00, 0x0D7F)}
RETIRED = re.compile(r"(?<![A-Za-z])(?:Tara|Vani|Vijaya|Vijay)(?![A-Za-z])|(?<![ಀ-೿])(?:ವಿಜಯ|ವಾಣಿ)(?![ಀ-೿])|విజయ(?![ా-ౌ-ఀ-౿ం])|वाणी|विजया|விஜயா|வாணி|വിജയ|వాణి")


# ---- the checks ----------------------------------------------------------------------------------------------------------------------------------------


def shipped_lines_no_gendered() -> None:
    found = {}
    for path in sorted(APP.rglob("*")):
        if path.suffix in {".py", ".json", ".md"} and "__pycache__" not in path.parts and str(path.relative_to(APP)) not in ABOUT_THE_WORDS:
            words = [w for text in _strings(path) for w in gendered_words(text)]
            if words:
                found[str(path.relative_to(APP))] = sorted(set(words))
    assert not found, found


def model_text_clean(model_said: str, cleaned: str) -> None:
    assert clean(model_said) == cleaned and not gendered_words(clean(model_said))


def address_rule_in_prompts() -> None:
    for language in ("te", "hi", "kn", "ta", "ml", "en"):
        assert address_rule(language) in register.register_block(language)
    request = prompts.build_chat_request(delimiter="ab12cd34", question="hi", language="kn", history=[], today=datetime(2026, 10, 30, tzinfo=UTC), assistant_name="the assistant", business_name="Shop", small=True)
    assert "never call anyone sir, madam" in " ".join(b.text for b in request.blocks)


def router_kind(text: str, kind: str) -> None:
    assert classify(text).kind == kind


def owner_language(text: str, language: str) -> None:
    assert detect_owner_language(text) == language


def fillers_in_voice_language() -> None:
    for table in (BANK_LINES, FILLERS, MALE_BANK_LINES):
        for language, lines in table.items():
            for line in lines:
                if language in SCRIPT_RANGE:
                    lo, hi = SCRIPT_RANGE[language]
                    assert any(lo <= ord(c) <= hi for c in line), (language, line, "a filler of a non-English language must be spoken in that language")
                else:
                    assert not any(0x0900 <= ord(c) <= 0x0DFF for c in line), (language, line)


def one_voice_per_language() -> None:
    cfg = default_config()
    for voice in cfg.catalogue.values():
        assert voice.voices.fallback.gender == voice.gender, f"{voice.id}: the fallback voice must have the gender of its catalogue entry"
    for language in ("te", "en", "hi", "kn", "ta", "ml"):
        for gender in ("female", "male"):
            assert cfg.resolve(language, None, gender).id == cfg.resolve(language, None, gender).id
            assert cfg.resolve(language, None, gender).gender == gender


def spoken_tone_rules() -> None:
    assert "Talk the way people talk" in register.register_block("en") and "Short sentences" in register.register_block("te")
    assert "no bullet list" in prompts.CHAT_SYSTEM_PROMPT and "natural, short by default" in prompts.CHAT_SYSTEM_PROMPT
    for language in ("te", "hi", "kn", "ta", "ml"):
        assert not [t for _, t in register.examples(language) if register.formal_forms_in(language, t)]


def indian_languages_get_the_larger_budget() -> None:
    assert prompts.CHAT_TOKENS_INDIAN >= 2400 > prompts.CHAT_TOKENS_EN
    request = prompts.build_chat_request(delimiter="ab12cd34", question="ధర్మవరం గురించి చెప్పండి", language="te", history=[], today=datetime(2026, 10, 30, tzinfo=UTC), assistant_name="the assistant", business_name="Shop", small=False)
    assert request.max_output_tokens >= 2400


def chat_prompt_welcomes_casual_talk() -> None:
    text = prompts.CHAT_SYSTEM_PROMPT
    assert "never refuse it" in text and "Do not steer back to leads" in text and "Never say you cannot talk about something" in text


def no_retired_names_in_shipped_lines() -> None:
    found = {}
    for path in sorted(APP.rglob("*")):
        rel = str(path.relative_to(APP))
        if path.suffix not in {".py", ".json", ".md"} or "__pycache__" in path.parts or rel in {"pronunciation/data/lexicon.json", "conversation/data/voices.json"}:   # the lexicon lists personal names people have, and the catalogue the names of its voices (a voice is called Vijay): neither is the assistant's name
            continue
        hits = [m.group(0) for text in _strings(path) for m in RETIRED.finditer(text)]
        if hits:
            found[rel] = sorted(set(hits))
    assert not found, found


def recogniser_mode(language: str, mode: str) -> None:
    assert stt_mode_for(language) == mode


def small_talk_is_light(text: str, light: bool) -> None:
    from app.turns.service import _is_light  # (the live-talk budget, #229)

    assert _is_light(text) is light


def lead_title(name: str | None, phone: str | None, expected: str) -> None:
    from app.display_name import (
        lead_title as title,  # (the name, else the phone, else "New enquiry"; never an id)
    )

    assert title(name, phone) == expected


def speech_text(language: str, written: str, spoken: str) -> None:
    assert SpeechText().prepare(written, language) == spoken


CHECKS: dict[str, Callable[..., None]] = {
    f.__name__: f
    for f in (shipped_lines_no_gendered, model_text_clean, address_rule_in_prompts, router_kind, owner_language, fillers_in_voice_language, one_voice_per_language, spoken_tone_rules, indian_languages_get_the_larger_budget,
              chat_prompt_welcomes_casual_talk, no_retired_names_in_shipped_lines, recogniser_mode, small_talk_is_light, speech_text, lead_title)
}


# ---- the runner ----------------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_the_bug_stays_fixed(case: dict[str, Any]) -> None:
    if "covered_by" in case:
        path, _, name = case["covered_by"].partition("::")
        source = (ROOT / "services" / "ai-api" / path).read_text(encoding="utf-8")
        assert re.search(rf"def {re.escape(name)}\(", source), f"the test that covers '{case['id']}' is gone: {case['covered_by']}"
        return
    CHECKS[case["check"]](**case.get("args", {}))


def test_every_case_says_what_went_wrong_who_found_it_and_when_and_ids_are_unique() -> None:
    assert len({c["id"] for c in CASES}) == len(CASES)
    for c in CASES:
        assert c["bug"].strip() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", c["found"]) and c["by"].strip(), c["id"]
        assert ("check" in c) != ("covered_by" in c), c["id"]
        assert "check" not in c or c["check"] in CHECKS, c["id"]
    assert len(CASES) >= 20


def test_the_owner_found_findings_of_the_thirtieth_are_all_here() -> None:
    needed = {"sir-for-women", "dharmavaram-read-as-dhara", "english-filler-before-telugu", "robotic-report-tone", "fixed-refusal-long-telugu", "retired-names", "mixed-voices"}
    assert needed <= {c["id"] for c in CASES}
