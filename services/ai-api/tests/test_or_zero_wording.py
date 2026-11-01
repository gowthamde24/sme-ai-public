"""Owner review 1 Nov 2026: the assistant never reads out a zero ("₹0.00 money is held" -> "No money is pending"). The rule is in the prompt; the check below is what the live evals (tests/evals/casual) apply to real replies."""

# ruff: noqa: E501
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.assistant import prompts
from app.assistant.wording import reads_a_zero

ROOT = Path(__file__).resolve().parents[3]

READS_A_ZERO = [
    "₹0.00 money is held.", "Money held on closed orders: ₹0.", "You have Rs 0 pending.", "Rs. 0.00 is due", "₹ 0 is waiting", "0 rupees are pending", "INR 0.00", "There are 0 new enquiries today.", "0 orders are waiting for you",
    "Zero orders today.", "You have 0 leads", "రూ.0 బాకీ ఉంది", "రూ. 0.00 ఆపి ఉంది", "0 రూపాయలు ఉన్నాయి", "సున్నా ఆర్డర్లు ఉన్నాయి", "0 ఎంక్వైరీలు వచ్చాయి", "₹0.00 कस्टमर का पैसा रुका है", "0 ऑर्डर बाकी हैं",
]
FINE = [
    "No money is pending.", "There are no new enquiries today.", "No orders are waiting.", "₹1,20,000.00 is held.", "₹10.50", "Rs 100 pending", "₹2,600 for the saree", "10 new enquiries", "20 orders", "You have 3 leads", "In the 10:00 slot",
    "2026-10-05", "100% paid", "డబ్బు ఏమీ పెండింగ్‌లో లేదు.", "కొత్త ఎంక్వైరీలు ఏవీ లేవు.", "रु. 500 बाकी", "50 पर्सेंट", "0.5 kg", "₹0.50 off",
]


@pytest.mark.parametrize("text", READS_A_ZERO)
def test_a_reply_that_reads_out_a_zero_is_caught(text: str) -> None:
    assert reads_a_zero(text), text


@pytest.mark.parametrize("text", FINE)
def test_replies_without_a_zero_are_not_flagged(text: str) -> None:
    assert not reads_a_zero(text), text


def test_the_rule_is_in_the_answer_prompt_with_and_without_the_catalogue_tools() -> None:
    for prompt in (prompts.SYSTEM_PROMPT, prompts.SYSTEM_PROMPT_NO_CATALOGUE):
        assert prompts.ZERO_RULE in prompt and "No money is pending" in prompt and "never '₹0'" in prompt


def test_the_live_cases_for_zero_amounts_exist_in_telugu_and_english() -> None:
    cases = [json.loads(line) for line in (ROOT / "tests" / "evals" / "zero" / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    zero = [c for c in cases if c.get("no_zero")]
    assert {c["language"] for c in zero} == {"en", "te"} and len(zero) >= 4
    assert any("money" in c["text"].lower() and "held" in c["text"].lower() for c in zero), "the owner's own question: How much customer money is held?"


def test_the_model_is_not_handed_a_zero_amount_or_a_zero_count_to_read_out() -> None:
    """A prompt rule alone let "₹0.00" through now and then (staging, 1 Nov 2026: 'money held on closed orders ₹0.00'), so the aggregate figures the model reads say "none" for a zero."""
    from pathlib import Path

    from app.assistant import tools

    assert tools._amount(0) == "none" and tools._amount(150000) == "₹1,500.00" and tools._count(0) == "none" and tools._count(3) == "3"  # noqa: SLF001
    source = (Path(tools.__file__)).read_text(encoding="utf-8")
    for key in ("waiting_for_you", "money_held_on_closed_orders", "open_orders"):
        line = next(ln for ln in source.splitlines() if f'("{key}",' in ln)
        assert "_amount(" in line or "_count(" in line, f"{key} must go through the zero-safe helpers: {line}"
    assert '"paid": _amount(paid)' in source and '"refunded": _amount(refunded)' in source
