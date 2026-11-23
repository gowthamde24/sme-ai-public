"""The seven speaking styles (docs/contracts/voice-styles.md, 24 Nov 2026): the list the screen gets, what a call's prompt says for each, and that the four new ones sit on the right base register."""

# ruff: noqa: E501
from __future__ import annotations

import pytest

from app.how_speaks import styles
from app.telephony import tone

NEW = ("professional", "calm_caring", "cheerful", "confident")
LANGS = ("en", "te", "hi", "kn", "ta", "ml", "mr")


def test_the_screen_gets_seven_objects_in_order_with_words_in_every_language() -> None:
    opts = styles.options()
    assert [o["id"] for o in opts] == ["friendly", "respectful", "quick", *NEW] == list(tone.CHOICES)
    for o in opts:
        assert set(o["label"]) == set(LANGS) == set(o["hint"]) and all(o["label"][lang].strip() and o["hint"][lang].strip() for lang in LANGS)
        assert o["best_for"] and o["reviewed"] is False
    assert opts[0]["label"]["en"] == "Friendly" and opts[2]["label"]["en"] == "Short and quick"


@pytest.mark.parametrize("style", NEW)
def test_each_new_style_has_a_base_register_and_never_breaks_a_lookup(style: str) -> None:
    base = tone.STYLE_BASE[style]
    assert base in ("friendly", "respectful") and tone.base(style) == base and tone.usable(style, "te") == base
    for lang in ("te", "en", "hi", "kn"):
        assert tone.opener(lang, style) == tone.opener(lang, base), "its opening is the base register's"
        assert tone.honest_line(lang, style) == tone.honest_line(lang, base)
    assert tone.register_rules("te", style) == tone.register_rules("te", base)
    assert tone.addressing_rule(style, "te") == tone.addressing_rule(base, "te")
    for text in ("చెప్పండి అండీ గారు", "ఆ అండి"):
        assert tone.strip_honorifics(text, style, "te") == tone.strip_honorifics(text, base, "te")


@pytest.mark.parametrize("style", NEW)
@pytest.mark.parametrize("language", ["en", "te", "hi", "kn"])
def test_an_inbound_call_prompt_gets_the_style_paragraph_on_top_of_the_base_rule(style: str, language: str) -> None:
    rule = tone.inbound_rule(language, style)
    assert rule is not None and tone.STYLE_RULES[style] in rule
    base_rule = tone.inbound_rule(language, tone.STYLE_BASE[style])
    assert (base_rule is None) or rule.startswith(base_rule), "the base register's own paragraph comes first"


def test_the_old_three_tones_are_unchanged() -> None:
    assert tone.inbound_rule("en", "friendly") is None and "respectful" in (tone.inbound_rule("en", "respectful") or "").lower()
    assert tone.inbound_rule("en", "quick") and tone.STYLE_RULES.keys() == set(NEW)


def test_no_style_rule_gives_the_model_a_price_a_promise_or_a_way_around_the_ai_line() -> None:
    for style, rule in tone.STYLE_RULES.items():
        low = rule.lower()
        assert "rs" not in low.split() and "₹" not in rule and "guarantee" not in low, style
        assert "pretend" not in low and "human" not in low, style
