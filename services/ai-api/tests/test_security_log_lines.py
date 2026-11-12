"""Code-scanning alerts py/log-injection: a value a caller can influence is made one safe line before it is logged."""

# ruff: noqa: E501

from __future__ import annotations

from app.logging_safety import one_line


def test_a_value_becomes_one_short_line_without_control_characters() -> None:
    assert "\n" not in one_line("a\nINFO forged line") and "\r" not in one_line("a\r\nb")
    assert one_line("tab\there\x00nul\x1bescape") == "tab here nul escape"
    assert len(one_line("x" * 500)) == 80 and len(one_line("x" * 500, 400)) == 400
    assert one_line(None) == "None" and one_line(7) == "7"


def test_ordinary_words_are_unchanged() -> None:
    assert one_line("respectful") == "respectful" and one_line("model_failed") == "model_failed"
